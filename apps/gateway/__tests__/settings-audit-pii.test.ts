// Implements: RFC-010 §4.3 (audit metadata names the FIELD, never its VALUE)
// + AGENTS.md §2 Rules 7/9 + §3.4 (no runtime raw SQL outside the two
// audited DDL authorities).
//
// THE DEFECT. The gateway's settings PATCH wrote the WHOLE normalised body
// into `audit_log.metadata` — institute name, address, phone, email. Audit
// rows are exactly what RFC-010 proposes to expose to an admin (metadata
// only; the books stay tutor-only). A table being opened up must not already
// be carrying tutor PII in its free-text column.
//
// WHAT IS PINNED, in order of worth:
//   1. the audit row names the changed FIELDS and carries none of their
//      values — the email/phone/address never appear in `audit_log.metadata`;
//   2. the OUTBOX row still carries the full body — the replica needs values
//      to apply, so narrowing the audit must not have gutted the sync path;
//   3. the write itself still lands (the settings row has the new value) —
//      a "fix" that quietly dropped the write would pass a metadata-only
//      assertion.
//
// The DB is a REAL in-memory SQLite through the production builders — only
// the HTTP layer is hand-built (AGENTS.md §7.3: never mock the DB).
import { describe, expect, it, beforeEach } from "vitest";
import { handleSettings } from "../routes/settings.ts";
import { invalidateTenant } from "../lib/cache.ts";
import type { DB } from "../lib/db.ts";
import { SqliteGatewayDb } from "./sqlite-db.ts";

const NOW = "2026-01-01T00:00:00.000Z";

let db: SqliteGatewayDb;
let TENANT = "";
let tenantSeq = 0;

beforeEach(() => {
  tenantSeq += 1;
  TENANT = `018f0000-0000-7000-8000-000000000c${String(tenantSeq).padStart(3, "0")}`;
  db = new SqliteGatewayDb();
  db.raw.prepare(
    `INSERT INTO settings (tenant_id, institute_name, institute_email, institute_phone,
                           tenant_secret, next_invoice_seq, next_receipt_seq, next_student_seq,
                           plan, created_at, updated_at)
     VALUES (?, 'Fixture Tuition', 'old@example.com', '+91 90000 00000',
             'fixture-tenant-secret-pepper', 7, 11, 3, 'free', ?, ?)`,
  ).run(TENANT, NOW, NOW);
  invalidateTenant(TENANT);
});

function url(path: string): URL {
  return new URL(`https://api.buddysaradhi.app${path}`);
}

async function patch(body: unknown) {
  const req = new Request(url("/api/v1/settings"), {
    method: "PATCH",
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const res = await handleSettings(
    req, db as unknown as DB, TENANT, "/api/v1/settings", "PATCH", url("/api/v1/settings"), {},
  );
  if (!res) throw new Error("handleSettings did not match PATCH /api/v1/settings");
  return { status: res.status, body: (await res.json()) as { success: boolean; error?: string } };
}

function auditMetadata(): string[] {
  return db
    .query("SELECT metadata FROM audit_log WHERE tenant_id = ? AND action = 'settings.update'", [TENANT])
    .map((row) => String((row as { metadata: unknown }).metadata ?? ""));
}

describe("RFC-010 §4.3 — the gateway audit row names fields, not values", () => {
  it("writes an allowed field and still persists it", async () => {
    const { status } = await patch({ instituteName: "Kabir Academy" });
    expect(status).toBe(200);
    const row = db.query("SELECT institute_name FROM settings WHERE tenant_id = ?", [TENANT])[0];
    expect(String((row as { institute_name: unknown }).institute_name)).toBe("Kabir Academy");
  });

  it("the audit metadata names the changed field and carries NO value", async () => {
    await patch({ instituteName: "Kabir Academy" });
    const rows = auditMetadata();
    expect(rows).toHaveLength(1);
    const metadata = rows[0] ?? "";
    expect(metadata).toContain("instituteName");
    expect(metadata).not.toContain("Kabir Academy");
    expect(metadata).not.toContain("value");
  });

  it("PII fields never reach the audit trail", async () => {
    await patch({
      instituteEmail: "tutor@example.com",
      institutePhone: "+91 98888 77777",
      instituteAddress: "12 MG Road, Nagpur",
    });
    const blob = auditMetadata().join("\n");
    expect(blob).not.toContain("tutor@example.com");
    expect(blob).not.toContain("98888 77777");
    expect(blob).not.toContain("MG Road");
    // The field NAMES are still there — accountability is preserved.
    expect(blob).toContain("instituteEmail");
    expect(blob).toContain("institutePhone");
    expect(blob).toContain("instituteAddress");
  });

  it("the OUTBOX row STILL carries the full body — narrowing must not gut sync", async () => {
    await patch({ instituteName: "Kabir Academy" });
    const rows = db.query(
      "SELECT payload FROM sync_outbox WHERE tenant_id = ? AND table_name = 'settings'",
      [TENANT],
    );
    expect(rows).toHaveLength(1);
    expect(String((rows[0] as { payload: unknown }).payload)).toContain("Kabir Academy");
  });
});
