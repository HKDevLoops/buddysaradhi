// Implements: 10_Security.md §8 (replay protection) + 17_API_Gateway_System.md
// §3 + 12_Business_Rules.md BR-M-01 (one intent, one money effect).
//
// THE REGRESSION THIS FILE PINS.
//
// The gateway's nonce window (`lib/security.ts` `validateNonce`) lives in
// PROCESS MEMORY. A deployment is MANY isolates. A captured signed mutation
// replayed onto an isolate that had never seen the nonce was ACCEPTED — and
// because the request signature binds only
// `tenantId:dbUrl:dbToken:timestamp:nonce` (NOT the method, path, body or
// `Idempotency-Key`), the replay carried a NEW Idempotency-Key and therefore
// produced a SECOND effect.
//
// MEASURED on the local rig (two gateway processes over one shared tenant DB —
// the production topology minus the edge's PoP fan-out):
//
//   isolate A POST /api/v1/ledger/payment -> 200 receipt RCP-000011
//   isolate B POST /api/v1/ledger/payment -> 200 receipt RCP-000012
//            (same timestamp + nonce + signature, new Idempotency-Key)
//   isolate A POST /api/v1/ledger/payment -> 409 (its in-memory map knew it)
//
//   -> the ledger held TWO `PAYMENT_RECEIVED` rows of 4242 paise for ONE
//      captured request. That is a double charge.
//
// The fix records the nonce in the TENANT'S OWN DATABASE (`lib/replay.ts`), so
// the single-use property holds across isolates, across PoPs and across
// restarts.
//
// THE TESTS BELOW MODEL THE PRODUCTION TOPOLOGY DIRECTLY: two INDEPENDENT
// handles over ONE shared database file, which is exactly what two isolates
// are (separate memory, one tenant database).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { claimNonceOnce, deriveNonceClaimKey, NONCE_CLAIM_ROUTE } from "../lib/replay.ts";
import { SqliteGatewayDb } from "./sqlite-db.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TENANT = "018f0000-0000-7000-8000-00000d0c0001";
const OTHER_TENANT = "018f0000-0000-7000-8000-00000d0c0002";
const NONCE = "nonce-018f0000-0000-7000-8000-abcdef";

const INDEX_SRC = readFileSync(
  fileURLToPath(new URL("../index.ts", import.meta.url)),
  "utf8",
);

let dir: string;
let dbPath: string;
let isolateA: SqliteGatewayDb;
let isolateB: SqliteGatewayDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gw-replay-"));
  dbPath = join(dir, "tenant.db");
  // Two INDEPENDENT handles over ONE database file — two isolates, one tenant DB.
  isolateA = new SqliteGatewayDb(dbPath);
  isolateB = new SqliteGatewayDb(dbPath);
});

afterEach(() => {
  isolateA.close();
  isolateB.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("durable replay claim — the nonce is single-use ACROSS ISOLATES", () => {
  it("claims the nonce once per tenant database, not once per isolate", async () => {
    const first = await claimNonceOnce(isolateA, TENANT, NONCE);
    expect(first).toEqual({ claimed: true, replay: false });

    // THE REGRESSION: the SAME nonce, a DIFFERENT isolate, the SAME tenant DB.
    const second = await claimNonceOnce(isolateB, TENANT, NONCE);
    expect(second).toEqual({ claimed: false, replay: true });

    // And again on the first isolate.
    const third = await claimNonceOnce(isolateA, TENANT, NONCE);
    expect(third).toEqual({ claimed: false, replay: true });
  });

  it("scopes the claim to the tenant — another tenant may use the same nonce", async () => {
    const a = await claimNonceOnce(isolateA, TENANT, NONCE);
    expect(a.claimed).toBe(true);
    const b = await claimNonceOnce(isolateA, OTHER_TENANT, NONCE);
    expect(b).toEqual({ claimed: true, replay: false });
  });

  it("derives a stable, UUID-shaped, one-way key from (tenant, nonce)", async () => {
    const k1 = await deriveNonceClaimKey(TENANT, NONCE);
    const k2 = await deriveNonceClaimKey(TENANT, NONCE);
    expect(k1).toBe(k2);
    expect(k1).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // Different tenant, same nonce -> different key.
    expect(await deriveNonceClaimKey(OTHER_TENANT, NONCE)).not.toBe(k1);
    // The nonce itself is never stored: the key is a digest.
    expect(k1).not.toContain(NONCE);
  });

  it("stores the claim under a reserved route so it cannot shadow a real idempotency record", async () => {
    await claimNonceOnce(isolateA, TENANT, NONCE);
    const rows = isolateA.query(
      "SELECT route, \"key\", response_code FROM idempotency_keys WHERE tenant_id = ?",
      [TENANT],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].route).toBe(NONCE_CLAIM_ROUTE);
    // A real idempotency route is "METHOD /path" — the sentinel can never be one.
    expect(NONCE_CLAIM_ROUTE).not.toMatch(/^[A-Z]+ \//);
  });
});

describe("the transport actually calls the durable claim", () => {
  it("index.ts claims the nonce before the request is dispatched", () => {
    // Structural: the CALL must exist, on the mutation path, before the
    // handlers run. A comment mentioning the function would pass a naive
    // `toContain` check on a reverted file too, so the assertion pins the
    // call shape as well.
    expect(INDEX_SRC).toContain("claimNonceOnce(");
    expect(INDEX_SRC).toMatch(
      /await claimNonceOnce\([\s\S]{0,200}tenantId[\s\S]{0,200}nonce/,
    );
    // …and the refusal must be a typed 409, not a silent pass.
    expect(INDEX_SRC).toContain("security.nonce_replay_durable");
    expect(INDEX_SRC).toMatch(/securityFail\(409, requestId\)/);
  });

  it("the claim runs AFTER the database handle exists", () => {
    const claimAt = INDEX_SRC.indexOf("await claimNonceOnce(");
    const dbAt = INDEX_SRC.indexOf("const db: DB = getTurso(");
    expect(dbAt).toBeGreaterThan(-1);
    expect(claimAt).toBeGreaterThan(dbAt);
  });
});
