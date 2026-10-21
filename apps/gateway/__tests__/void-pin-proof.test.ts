// Implements: 12_Business_Rules.md BR-SEC-04 [CRITICAL] ("void receipt/ledger"
// requires PIN/biometric) + 07_Fees_and_Payments.md §9.10 + 10_Security.md
// §18.1 step 1 + BR-SEC-07 (a PIN is never persisted) + AGENTS.md §2 Rule 1
// (the ledger is append-only, so a void is the ONLY correction path).
//
// THE DEFECT THIS PINS. The void route accepted `{entryId, reason}` and
// nothing else. The PIN was verified in the WEB's server action — a
// caller-side control on a route the gateway itself exposes — so a request
// with a valid session and a valid Idempotency-Key could reverse a real
// receipt with no re-authentication at all. The ledger is append-only, so
// there is no second correction path: a void that should not have happened
// leaves the tutor's books wrong with no way back.
//
// The edge cannot evaluate argon2id (`settings.pin_hash`), but it CAN verify
// `settings.pin_proof` — an HMAC over the PIN under a server-side key — so
// the request now carries the tutor's PIN PROOF and the edge compares it in
// constant time, exactly as the secure-erase gate does.
//
// The negative control for this file: against the pre-fix route the void
// SUCCEEDED with no PIN material, so every refusal below fails.

import { describe, expect, it } from "vitest";
import { handleLedger } from "../routes/ledger.ts";
import type { DB } from "../lib/db.ts";
import { createLedgerFixture, type LedgerFixture } from "./sqlite-db.ts";

interface ApiBody {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

async function post(
  fixture: LedgerFixture,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: ApiBody }> {
  const req = new Request(`https://api.buddysaradhi.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const res = await handleLedger(
    req,
    // SAFETY: the SQLite fixture satisfies `SqlHandle` (lib/sql.ts), which is
    // the only capability the route uses at runtime.
    fixture.db as unknown as DB,
    fixture.tenantId,
    path,
    "POST",
    new URL(req.url),
    {},
  );
  if (!res) throw new Error(`no route matched POST ${path}`);
  return { status: res.status, body: (await res.json()) as ApiBody };
}

function rows(fixture: LedgerFixture, sql: string, args: unknown[] = []): Record<string, unknown>[] {
  return fixture.db.query(sql, args);
}

function count(fixture: LedgerFixture, sql: string, args: unknown[] = []): number {
  const row = rows(fixture, sql, args)[0];
  return Number(row?.c ?? 0);
}

/** A payment to void — the ledger's only correction path needs a target. */
async function paidEntry(fixture: LedgerFixture): Promise<string> {
  await post(fixture, "/api/v1/ledger/payment", {
    studentId: fixture.studentId,
    amount: 10000,
  });
  return String(
    rows(fixture, "SELECT id FROM ledger_entries WHERE type = 'PAYMENT_RECEIVED' ORDER BY rowid LIMIT 1")[0]
      ?.id,
  );
}

describe("BR-SEC-04 — the void route re-authenticates at the edge", () => {
  it("REFUSES a void with no PIN proof, and writes nothing", async () => {
    const f = createLedgerFixture();
    const entryId = await paidEntry(f);
    const voidsBefore = count(f, "SELECT COUNT(*) AS c FROM ledger_entries WHERE type = 'VOID'");
    const auditsBefore = count(f, "SELECT COUNT(*) AS c FROM audit_log WHERE action = 'ledger.void'");
    const outboxBefore = count(f, "SELECT COUNT(*) AS c FROM sync_outbox");

    const res = await post(f, "/api/v1/ledger/void", { entryId, reason: "no proof offered" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("PIN_PROOF_UNAVAILABLE");
    // Nothing was written: no reversing row, no audit row, no outbox row.
    expect(count(f, "SELECT COUNT(*) AS c FROM ledger_entries WHERE type = 'VOID'")).toBe(voidsBefore);
    expect(count(f, "SELECT COUNT(*) AS c FROM audit_log WHERE action = 'ledger.void'")).toBe(auditsBefore);
    expect(count(f, "SELECT COUNT(*) AS c FROM sync_outbox")).toBe(outboxBefore);
  });

  it("REFUSES a void whose proof does not match, and writes nothing", async () => {
    const f = createLedgerFixture();
    const entryId = await paidEntry(f);

    const res = await post(f, "/api/v1/ledger/void", {
      entryId,
      reason: "wrong pin",
      pinProof: "f".repeat(64),
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("PIN_PROOF_MISMATCH");
    expect(count(f, "SELECT COUNT(*) AS c FROM ledger_entries WHERE type = 'VOID'")).toBe(0);
    expect(count(f, "SELECT COUNT(*) AS c FROM audit_log WHERE action = 'ledger.void'")).toBe(0);
  });

  it("REFUSES a proof of the wrong length without comparing it", async () => {
    // `constantTimeCompare` walks the longer operand, so a wrong-length proof
    // is refused on the length check — the input is bounded before any
    // character-by-character work happens.
    const f = createLedgerFixture();
    const entryId = await paidEntry(f);

    const res = await post(f, "/api/v1/ledger/void", {
      entryId,
      reason: "short proof",
      pinProof: "abc",
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("PIN_PROOF_MISMATCH");
    expect(count(f, "SELECT COUNT(*) AS c FROM ledger_entries WHERE type = 'VOID'")).toBe(0);
  });

  it("REFUSES when the tenant has no PIN proof on record, even with a well-formed one", async () => {
    // A tenant who set their PIN before the edge could derive a proof has
    // none on record. The erase gate refuses in the same state and tells the
    // tutor to re-confirm their PIN; the void gate must not be the weaker one.
    const f = createLedgerFixture();
    const entryId = await paidEntry(f);
    f.db.raw
      .prepare("UPDATE settings SET pin_proof = NULL WHERE tenant_id = ?")
      .run(f.tenantId);

    const res = await post(f, "/api/v1/ledger/void", {
      entryId,
      reason: "no proof on record",
      pinProof: f.pinProof,
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("PIN_PROOF_UNAVAILABLE");
    expect(count(f, "SELECT COUNT(*) AS c FROM ledger_entries WHERE type = 'VOID'")).toBe(0);
  });

  it("REFUSES when the tenant has no PIN configured at all", async () => {
    const f = createLedgerFixture();
    const entryId = await paidEntry(f);
    f.db.raw
      .prepare("UPDATE settings SET pin_hash = NULL WHERE tenant_id = ?")
      .run(f.tenantId);

    const res = await post(f, "/api/v1/ledger/void", {
      entryId,
      reason: "no pin configured",
      pinProof: f.pinProof,
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("PIN_PROOF_UNAVAILABLE");
    expect(count(f, "SELECT COUNT(*) AS c FROM ledger_entries WHERE type = 'VOID'")).toBe(0);
  });

  it("ACCEPTS a void that carries the tenant's proof", async () => {
    const f = createLedgerFixture();
    const entryId = await paidEntry(f);

    const res = await post(f, "/api/v1/ledger/void", {
      entryId,
      reason: "duplicate collection",
      pinProof: f.pinProof,
    });

    expect(res.status).toBe(200);
    expect(count(f, "SELECT COUNT(*) AS c FROM ledger_entries WHERE type = 'VOID'")).toBe(1);
    // The audit row records that the sensitive action was RE-AUTHORISED.
    const audit = rows(f, "SELECT metadata FROM audit_log WHERE action = 'ledger.void'");
    expect(audit.length).toBe(1);
    expect(String(audit[0]?.metadata)).toContain("pin_verified");
  });

  it("never persists the proof — not in the audit row, not in the outbox (BR-SEC-07)", async () => {
    const f = createLedgerFixture();
    const entryId = await paidEntry(f);
    await post(f, "/api/v1/ledger/void", {
      entryId,
      reason: "duplicate collection",
      pinProof: f.pinProof,
    });

    const audit = rows(f, "SELECT metadata FROM audit_log");
    const outbox = rows(f, "SELECT payload FROM sync_outbox");
    for (const row of [...audit, ...outbox]) {
      expect(JSON.stringify(row)).not.toContain(f.pinProof);
    }
  });

  it("the `pin_proof` spelling is accepted too (the sync-apply route's name)", async () => {
    const f = createLedgerFixture();
    const entryId = await paidEntry(f);

    const res = await post(f, "/api/v1/ledger/void", {
      entryId,
      reason: "duplicate collection",
      pin_proof: f.pinProof,
    });

    expect(res.status).toBe(200);
    expect(count(f, "SELECT COUNT(*) AS c FROM ledger_entries WHERE type = 'VOID'")).toBe(1);
  });
});
