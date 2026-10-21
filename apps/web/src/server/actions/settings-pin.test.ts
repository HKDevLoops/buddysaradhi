// Implements: 08_Settings.md BR-SEC-02 (mandatory app PIN; change requires
// current-PIN re-verification); 10_Security.md §3 (ladder, argon2id);
// AGENTS.md §2 Rule 7 (outbox+audit in the same transaction) + §7.3
// (mock-free DB: real file-backed libSQL, only the session seam stubbed).
//
// Proves: first-time setup without a current PIN, change with correct
// current PIN (old stops verifying, new verifies), wrong current PIN refuses
// with the hash untouched, bad formats refuse, and status reports presence
// without ever exposing the hash.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";
import { hashPin, pinProof, verifyPin } from "@/lib/crypto";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPrisma: vi.fn(),
  gatewayPost: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

vi.mock("@/server/get-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/get-db")>();
  return { ...actual, getAuthenticatedPrisma: mocks.getAuthenticatedPrisma, gatewayPost: mocks.gatewayPost };
});
vi.mock("@/lib/logger", () => ({ log: mocks.log }));

import {
  setPinAction,
  verifyPinAction,
  getPinStatusAction,
} from "@/server/actions/settings";

const TENANT = "t-pin-1";

async function createTestDb(): Promise<{ client: Client; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "pin-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  // Test setup DDL only — never runtime (AGENTS.md §3.4).
  await client.execute(
    "CREATE TABLE settings (tenant_id TEXT PRIMARY KEY, institute_name TEXT, tenant_secret TEXT, pin_hash TEXT, pin_proof TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, tenant_id TEXT, table_name TEXT, row_id TEXT, op TEXT CHECK(op IN ('insert','update','soft_delete')), payload TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, action TEXT, ref_type TEXT, ref_id TEXT, metadata TEXT, created_at TEXT)",
  );
  return { client, dir };
}

function wireSeam(client: Client): void {
  mocks.getAuthenticatedPrisma.mockResolvedValue({
    db: createLibsqlProxy(client),
    userId: TENANT,
    tenantId: TENANT,
  });
}

async function pinHashOf(client: Client): Promise<string | null> {
  const res = await client.execute({
    sql: "SELECT pin_hash FROM settings WHERE tenant_id = ?",
    args: [TENANT],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return (row?.pin_hash as string | null) ?? null;
}

let client: Client;
let dir: string;

beforeEach(() => {
  vi.clearAllMocks();
  // The sync-apply push runs on every successful setPinAction; default it to
  // applied so the pre-existing tests assert the local commit undisturbed.
  mocks.gatewayPost.mockResolvedValue({ success: true, data: { applied: true } });
});

afterEach(async () => {
  try {
    if (client) await Promise.resolve(client.close());
  } catch {
    // Best-effort: libSQL may already be closed.
  }
  client = undefined as unknown as Client; // SAFETY: reset between tests; recreated per test.
  if (dir) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    dir = undefined as unknown as string; // SAFETY: reset between tests; recreated per test.
  }
});

describe("getPinStatusAction", () => {
  it("reports unconfigured with no settings row and never exposes a hash", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    const res = await getPinStatusAction();
    expect(res).toEqual({ success: true, configured: false });
    expect(JSON.stringify(res)).not.toMatch(/argon2|\$2|hash/i);
  });

  it("reports configured once a PIN exists", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    expect((await setPinAction("135790")).success).toBe(true);
    expect(await getPinStatusAction()).toEqual({ success: true, configured: true });
  });
});

describe("setPinAction: setup + change", () => {
  it("sets a first PIN with no current PIN and it verifies", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    const res = await setPinAction("135790");
    expect(res.success).toBe(true);
    const stored = await pinHashOf(client);
    expect(stored).toBeTruthy();
    expect(await verifyPin("135790", stored as string)).toBe(true);
    expect(await verifyPin("000000", stored as string)).toBe(false);
  });

  it("changes the PIN with the correct current PIN and retires the old one", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    expect((await setPinAction("135790")).success).toBe(true);
    const changed = await setPinAction("246813", "135790");
    expect(changed.success).toBe(true);
    const stored = await pinHashOf(client);
    expect(await verifyPin("246813", stored as string)).toBe(true);
    expect(await verifyPin("135790", stored as string)).toBe(false);
    expect((await verifyPinAction("246813")).success).toBe(true);
  });

  it("refuses a wrong current PIN with the hash untouched", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    expect((await setPinAction("135790")).success).toBe(true);
    const before = await pinHashOf(client);
    const res = await setPinAction("246813", "000000");
    expect(res.success).toBe(false);
    expect(await pinHashOf(client)).toBe(before);
  });

  it("refuses to change an existing PIN when currentPin is omitted entirely", async () => {
    // Regression: the gate used to be `if (currentPin)`, so a caller that simply
    // did not send the argument skipped verification and replaced the PIN. That
    // collapsed backup export, tenant wipe, account erase, bulk import and ledger
    // void — every PIN-gated surface — to bare session auth.
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    expect((await setPinAction("135790")).success).toBe(true);
    const before = await pinHashOf(client);

    const res = await setPinAction("246813");
    expect(res.success).toBe(false);
    expect(res.code).toBe("PIN_REQUIRED");
    expect(await pinHashOf(client)).toBe(before);
    // The old PIN must still be the live one, not merely a byte-identical row.
    expect((await verifyPinAction("135790")).success).toBe(true);
  });

  it("still allows a first PIN with no current PIN (setup path unchanged)", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    const res = await setPinAction("135790");
    expect(res.success).toBe(true);
    expect((await verifyPinAction("135790")).success).toBe(true);
  });

  it("refuses bad formats without touching the store", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    for (const bad of ["123", "123456789", "12ab"]) {
      const res = await setPinAction(bad);
      expect(res.success).toBe(false);
    }
    expect(await pinHashOf(client)).toBeNull();
  });

  it("refuses 4- and 5-digit PINs at setup (BR-SEC-05 floor is 6)", async () => {
    // Implements: 12_Business_Rules.md BR-SEC-05 + 08_Settings.md pinSchema.
    // "1359" / "13580" are non-obvious (no constant step, no repeat), so the
    // refusal below comes from the length floor — not the obvious-PIN rule.
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    for (const short of ["1359", "13580"]) {
      const res = await setPinAction(short);
      expect(res.success).toBe(false);
      expect(res.error).toBe("PIN must be 6-8 digits");
    }
    expect(await pinHashOf(client)).toBeNull();
    expect((await client.execute("SELECT id FROM sync_outbox")).rows).toHaveLength(0);
    expect((await client.execute("SELECT id FROM audit_log")).rows).toHaveLength(0);
  });

  it("grandfathers an existing 4-digit PIN — verification is NOT floored", async () => {
    // BR-SEC-05 holds only NEW setups to 6. A tutor who set "1359" before the
    // floor existed must keep unlocking, voiding and erasing with it: refusing
    // to VERIFY would lock them out of their own books. Seeded directly (the
    // setup path now refuses this length, so it can only be a legacy row).
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    const now = new Date().toISOString();
    await client.execute({
      sql: "INSERT INTO settings (tenant_id, pin_hash, created_at, updated_at) VALUES (?, ?, ?, ?)",
      args: [TENANT, await hashPin("1359"), now, now],
    });
    expect((await verifyPinAction("1359")).success).toBe(true);
    expect((await verifyPinAction("000000")).success).toBe(false);
  });

  it("grandfathers an existing 5-digit PIN — verification is NOT floored", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    const now = new Date().toISOString();
    await client.execute({
      sql: "INSERT INTO settings (tenant_id, pin_hash, created_at, updated_at) VALUES (?, ?, ?, ?)",
      args: [TENANT, await hashPin("13580"), now, now],
    });
    expect((await verifyPinAction("13580")).success).toBe(true);
    expect((await verifyPinAction("000000")).success).toBe(false);
  });

  it("writes outbox + audit rows with the change", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    expect((await setPinAction("135790")).success).toBe(true);
    const outbox = await client.execute("SELECT op FROM sync_outbox");
    expect(outbox.rows.map((r) => String((r as Record<string, unknown>).op))).toContain("update");
    const audit = await client.execute("SELECT action FROM audit_log");
    expect(audit.rows.map((r) => String((r as Record<string, unknown>).action))).toContain("pin.update");
  });

  it("replicates the edge-verifiable proof inside the sync-outbox payload (N1)", async () => {    // Implements: BR-SEC-04 / 10_Security.md §18.1 — the edge erase gate reads
    // the gateway DB, so the proof AND the genuine hash must travel in the
    // outbox payload written in the SAME transaction as the hash (Rule 7). The
    // proof must equal what the edge verifies: HMAC proof for this tenant +
    // PIN, 64 lowercase hex. The hash must be byte-identical to the stored
    // column — the replica converges to the latest set, never to a proof
    // detached from its hash.
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    expect((await setPinAction("135790")).success).toBe(true);
    const rows = await client.execute("SELECT payload FROM sync_outbox");
    expect(rows.rows).toHaveLength(1);
    const payload = JSON.parse(String((rows.rows[0] as Record<string, unknown>).payload)) as {
      pin_updated_at?: unknown;
      pin_proof?: unknown;
      pin_hash?: unknown;
    };
    expect(typeof payload.pin_updated_at).toBe("string");
    expect(payload.pin_proof).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.pin_proof).toBe(await pinProof(TENANT, "135790"));
    // The stored column and the replicated payload agree — hash and proof can
    // never diverge across the sync channel.
    const stored = await client.execute("SELECT pin_hash, pin_proof FROM settings WHERE tenant_id = 't-pin-1'");
    const storedRow = stored.rows[0] as Record<string, unknown>;
    expect(String(storedRow.pin_proof)).toBe(payload.pin_proof);
    expect(typeof payload.pin_hash).toBe("string");
    expect(String(storedRow.pin_hash)).toBe(payload.pin_hash);

    // AUD-002 (P0) — the replication payload must NEVER carry the PIN itself.
    //
    // A `sync_outbox` row is DURABLE, REPLICATED (it is the sync channel's
    // own queue) and BACKED UP. A plaintext PIN in one is recoverable in
    // cleartext from the tenant DB, from any backup of it, and from any
    // replica that drained the outbox — which is exactly what BR-SEC-07
    // [CRITICAL] forbids ("No plaintext secret ever written to the DB. PIN
    // stored as `argon2id(pin)`").
    //
    // The proof and the hash that DO ride along are derived values, not
    // secrets: the hash is the prescribed storage form and the proof is an
    // HMAC under a pepper the client never sees. Neither can be turned back
    // into the PIN.
    const raw = String((rows.rows[0] as Record<string, unknown>).payload);
    expect(raw).not.toContain("135790");
    expect(Object.keys(payload)).not.toContain("pin");
    expect(Object.keys(payload).sort()).toEqual(["pin_hash", "pin_proof", "pin_updated_at"]);
  });
});

describe("setPinAction: sync-apply push (N1 follow-up)", () => {
  const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async function outboxPayload(): Promise<Record<string, unknown>> {
    const rows = await client.execute("SELECT payload FROM sync_outbox");
    return JSON.parse(String((rows.rows[0] as Record<string, unknown>).payload)) as Record<string, unknown>;
  }

  async function auditActions(): Promise<string[]> {
    const rows = await client.execute("SELECT action FROM audit_log");
    return rows.rows.map((r) => String((r as Record<string, unknown>).action));
  }

  it("pushes the outbox replica payload to sync-apply with an idempotency key", async () => {
    // Implements: BR-SEC-04 / BR-SYN-01 — the edge erase gate reads the
    // gateway DB, so the proof must leave this device after the local commit.
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    const res = await setPinAction("135790");
    expect(res.success).toBe(true);

    expect(mocks.gatewayPost).toHaveBeenCalledTimes(1);
    const [path, body, headers] = mocks.gatewayPost.mock.calls[0] as [
      string,
      Record<string, unknown>,
      Record<string, string>,
    ];
    expect(path).toBe("/api/v1/settings/sync-apply");
    // The pushed body carries the SAME DERIVED values as the outbox replica
    // row — proof and hash can never diverge across the sync channel — plus
    // the PIN itself, which rides the LIVE, TRANSIENT request only.
    //
    // AUD-002 (P0): the PIN must never reach the DURABLE outbox row. That row
    // is replicated and backed up, so a plaintext PIN in it is recoverable in
    // cleartext from the tenant DB, from any backup of it, and from any
    // replica that drained the outbox — BR-SEC-07 [CRITICAL] forbids it. The
    // body is not persisted anywhere: the edge consumes it with one HMAC and
    // stores only its own derived proof and the argon2id hash.
    const outbox = await outboxPayload();
    expect(body.pin_proof).toBe(outbox.pin_proof);
    expect(body.pin_hash).toBe(outbox.pin_hash);
    expect(body.pin_updated_at).toBe(outbox.pin_updated_at);
    expect(Object.keys(outbox)).not.toContain("pin");
    expect(body["pin_proof"]).toBe(await pinProof(TENANT, "135790"));
    // F-03: the PIN rides the LIVE payload so the EDGE derives the proof
    // rather than believing the caller's. A proof the edge cannot check is
    // the self-issued erase credential that let two requests destroy a tenant.
    expect(body["pin"]).toBe("135790");
    // RFC-004 C1: the route is fail-closed without an Idempotency-Key.
    expect(headers["Idempotency-Key"]).toMatch(UUID_SHAPE);
  });

  it("a failed push does NOT roll back the committed PIN — it is logged + audited", async () => {
    // Rule 9, both directions: the local write already committed, so the PIN
    // change still succeeds; the failure surfaces via the typed log AND a
    // `pin.sync_push_failed` audit row (never silent), and the outbox replica
    // row from the transaction remains the durable retry source.
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    mocks.gatewayPost.mockResolvedValueOnce({ success: false, error: "Gateway 503: service unavailable" });

    const res = await setPinAction("135790");
    expect(res.success).toBe(true);
    const stored = await pinHashOf(client);
    expect(stored).toBeTruthy();
    expect(await verifyPin("135790", stored as string)).toBe(true);

    const actions = await auditActions();
    expect(actions).toContain("pin.update");
    expect(actions).toContain("pin.sync_push_failed");
    expect(mocks.log.error).toHaveBeenCalledWith("pin_sync_push_failed", expect.any(String));

    // The replica payload survived for retry; the failure audit carries only
    // the marker + error, never the credentials.
    expect((await client.execute("SELECT id FROM sync_outbox")).rows).toHaveLength(1);
    const metaRows = await client.execute(
      "SELECT metadata FROM audit_log WHERE action = 'pin.sync_push_failed'",
    );
    expect(metaRows.rows).toHaveLength(1);
    const metadata = String((metaRows.rows[0] as Record<string, unknown>).metadata);
    expect(metadata).toContain("pin_updated_at");
    const proof = await pinProof(TENANT, "135790");
    expect(metadata).not.toContain(proof);
    expect(metadata).not.toContain(stored as string);
  });
});
