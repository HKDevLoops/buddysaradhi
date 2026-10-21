// Implements: 10_Security.md §18.1 step 4 (the secure-erase cascade) +
// 12_Business_Rules.md BR-SEC-04 (the erase removes ALL of the tenant's data).
//
// THE DEFECT THIS PINS.
//
// The erase cascade walked `eraseTables()` (lib/sql.ts `ERASE_TABLES`) — and
// `idempotency_keys` was NOT in that list. The table is not bookkeeping: every
// row stores the RESPONSE BODY of a mutation (RFC-004 C1), and in this product
// that body is a receipt number, a ledger projection and a running balance.
//
// So "securely erase all tutor data" left the tutor's financial responses
// sitting in the database — a data point the tutor asked to be gone, in the
// exact store a tutor would check.
//
// The fix deletes the tenant's idempotency rows inside the SAME cascade
// transaction (routes/security.ts), using the audited tenant-scoped DELETE
// builder. The erase's OWN idempotency record is written afterwards (it
// records the erase's own completion), so it survives — which is correct: it
// is the audit trail of the erase, not the erased data.
//
// Runs the REAL `handleSecurity` against in-memory SQLite (AGENTS.md §7.3).
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.GATEWAY_SHARED_SECRET = "test-secret-that-is-at-least-32-chars-long-ok";
  process.env.DATA_ENCRYPTION_KEY = "test-encryption-key-that-is-at-least-32-characters";
});

import { handleSecurity } from "../routes/security.ts";
import { pinProof } from "../lib/crypto.ts";
import { invalidateTenant } from "../lib/cache.ts";
import type { DB } from "../lib/db.ts";
import { SqliteGatewayDb } from "./sqlite-db.ts";

const OTHER_TENANT = "018f0000-0000-7000-8000-000000000e02";
const NOW = "2026-01-01T00:00:00.000Z";

let db: SqliteGatewayDb;
let TENANT = "";
let tenantSeq = 0;

beforeEach(() => {
  tenantSeq += 1;
  TENANT = `018f0000-0000-7000-8000-000000000e${String(tenantSeq).padStart(3, "0")}`;
  db = new SqliteGatewayDb();
  for (const [tenantId, name] of [[TENANT, "Fixture Tuition"], [OTHER_TENANT, "Other Tuition"]] as const) {
    db.raw.prepare(
      `INSERT INTO settings (tenant_id, institute_name, tenant_secret, next_invoice_seq,
                             next_receipt_seq, next_student_seq, plan, created_at, updated_at)
       VALUES (?, ?, 'fixture-tenant-secret-pepper', 7, 11, 3, 'free', ?, ?)`,
    ).run(tenantId, name, NOW, NOW);
  }
  invalidateTenant(TENANT);
  invalidateTenant(OTHER_TENANT);
});

function url(path: string): URL {
  return new URL(`https://api.buddysaradhi.app${path}`);
}

function seedIdempotencyRows(tenantId: string): void {
  // Two shapes: a real mutation record (whose response_body is the tenant's
  // financial data) and a nonce claim.
  db.raw.prepare(
    `INSERT INTO idempotency_keys (tenant_id, route, "key", response_code, response_body, created_at)
     VALUES (?, 'POST /api/v1/ledger/payment', ?, 200, ?, ?)`,
  ).run(
    tenantId,
    "018f0000-0000-7000-8000-000000000f01",
    JSON.stringify({ success: true, data: { receiptNo: "RCP-000042", newBalance: -125500 } }),
    NOW,
  );
  db.raw.prepare(
    `INSERT INTO idempotency_keys (tenant_id, route, "key", response_code, response_body, created_at)
     VALUES (?, 'NONCE-CLAIM', ?, 409, 'nonce-claim', ?)`,
  ).run(tenantId, "018f0000-0000-7000-8000-000000000f02", NOW);
}

function countIdempotencyRows(tenantId: string): number {
  const row = db.query("SELECT COUNT(*) AS c FROM idempotency_keys WHERE tenant_id = ?", [tenantId])[0];
  return Number(row.c);
}

/** Routes the tenant still holds a row for. */
function idempotencyRoutes(tenantId: string): string[] {
  return db
    .query("SELECT route FROM idempotency_keys WHERE tenant_id = ? ORDER BY route", [tenantId])
    .map((r) => String((r as { route: unknown }).route));
}

async function eraseWithProof(pin: string, tenantId = TENANT) {
  const proof = await pinProof(tenantId, pin);
  db.raw.prepare("UPDATE settings SET pin_hash = ?, pin_proof = ? WHERE tenant_id = ?")
    .run("$argon2id$v=19$m=65536,t=3,p=2$fake-hash", proof, tenantId);
  const res = await handleSecurity(
    new Request(url("/api/v1/security/erase"), {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ tutorId: tenantId, confirm: "ERASE", pinProof: proof }),
    }),
    db as unknown as DB,
    tenantId,
    "/api/v1/security/erase",
    "POST",
    url("/api/v1/security/erase"),
    {},
  );
  if (!res) throw new Error("handleSecurity did not match POST /api/v1/security/erase");
  return { status: res.status, body: (await res.json()) as { success: boolean; error?: string } };
}

describe("BR-SEC-04 — the erase removes the idempotency store too", () => {
  it("deletes the tenant's stored mutation responses", async () => {
    seedIdempotencyRows(TENANT);
    expect(countIdempotencyRows(TENANT)).toBe(2);

    const { status, body } = await eraseWithProof("9137");

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // Before the fix BOTH seeded rows survived the "secure erase" — including
    // the stored payment response (receipt number + running balance).
    expect(idempotencyRoutes(TENANT)).not.toContain("POST /api/v1/ledger/payment");
    expect(idempotencyRoutes(TENANT)).not.toContain("NONCE-CLAIM");
    // Exactly ONE row survives: the erase's OWN idempotency record, written
    // after the cascade. It is the audit trail of the erase, not the erased
    // data — and it is what makes a retried erase a replay rather than a
    // second cascade.
    expect(idempotencyRoutes(TENANT)).toEqual(["POST /api/v1/security/erase"]);
  });

  it("leaves another tenant's idempotency rows untouched", async () => {
    seedIdempotencyRows(TENANT);
    seedIdempotencyRows(OTHER_TENANT);

    await eraseWithProof("9137");

    expect(idempotencyRoutes(TENANT)).toEqual(["POST /api/v1/security/erase"]);
    expect(countIdempotencyRows(OTHER_TENANT)).toBe(2);
  });
});
