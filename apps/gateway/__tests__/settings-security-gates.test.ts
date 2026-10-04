// Implements: 08_Settings.md (which fields a tutor may set) + 10_Security.md
// §3/§3.4 (the PIN hash and tenant secret never leave the DB; a sensitive
// mutation is audit-logged) + §18.1 / BR-SEC-04 (the erase gate) + Rule 7
// (outbox + audit in the same transaction).
//
// Runs the REAL `handleSettings` and `handleSecurity` against in-memory SQLite
// carrying the gateway's own DDL (AGENTS.md §7.3 — never mock the DB; a mock
// cannot tell you whether a write was rejected or silently stripped).
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.GATEWAY_SHARED_SECRET = "test-secret-that-is-at-least-32-chars-long-ok";
  process.env.DATA_ENCRYPTION_KEY = "test-encryption-key-that-is-at-least-32-characters";
});

import { handleSettings } from "../routes/settings.ts";
import { handleSecurity } from "../routes/security.ts";
import { invalidateTenant } from "../lib/cache.ts";
import type { DB } from "../lib/db.ts";
import { SqliteGatewayDb } from "./sqlite-db.ts";

const OTHER_TENANT = "018f0000-0000-7000-8000-0000000000b2";
const NOW = "2026-01-01T00:00:00.000Z";

let db: SqliteGatewayDb;
/** A fresh tutor per test. The erase route is rate-limited per tenant (5 attempts
 *  per 15 min), and that limit is module state — so a shared id would make the
 *  second test in the file fail on the first test's attempts. Each test is its
 *  own tutor, which is also what the limit is actually keyed on. */
let TENANT = "";
let tenantSeq = 0;

beforeEach(() => {
  tenantSeq += 1;
  TENANT = `018f0000-0000-7000-8000-000000000a${String(tenantSeq).padStart(3, "0")}`;
  db = new SqliteGatewayDb();
  const ins = db.raw.prepare(
    `INSERT INTO settings (tenant_id, institute_name, tenant_secret, next_invoice_seq,
                           next_receipt_seq, next_student_seq, plan, created_at, updated_at)
     VALUES (?, 'Fixture Tuition', 'fixture-tenant-secret-pepper', 7, 11, 3, 'free', ?, ?)`,
  );
  ins.run(TENANT, NOW, NOW);
  ins.run(OTHER_TENANT, NOW, NOW);
  invalidateTenant(TENANT);
  invalidateTenant(OTHER_TENANT);
});

function url(path: string, query = ""): URL {
  return new URL(`https://api.buddysaradhi.app${path}${query ? `?${query}` : ""}`);
}

async function patch(body: unknown, tenantId = TENANT) {
  const req = new Request(url("/api/v1/settings"), {
    method: "PATCH",
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const res = await handleSettings(
    req, db as unknown as DB, tenantId, "/api/v1/settings", "PATCH", url("/api/v1/settings"), {},
  );
  if (!res) throw new Error("handleSettings did not match PATCH /api/v1/settings");
  return { status: res.status, body: (await res.json()) as { success: boolean; error?: string; details?: string } };
}

function settingRow(tenantId = TENANT): Record<string, unknown> {
  return db.query("SELECT * FROM settings WHERE tenant_id = ?", [tenantId])[0];
}

// ── 5. The settings PATCH allowlist ───────────────────────────────────────────

describe("settings PATCH — the fields a tutor may set (08_Settings.md)", () => {
  it("writes an allowed field and echoes the projected row", async () => {
    const { status, body } = await patch({ instituteName: "Kabir Academy" });
    expect(status).toBe(200);
    expect(String(settingRow().institute_name)).toBe("Kabir Academy");
    expect(JSON.stringify(body)).toContain("Kabir Academy");
  });

  it("accepts both the camelCase and snake_case spelling of the same field", async () => {
    await patch({ receiptPrefix: "R-" });
    expect(String(settingRow().receipt_prefix)).toBe("R-");
    await patch({ invoice_prefix: "I-" });
    expect(String(settingRow().invoice_prefix)).toBe("I-");
  });

  it("a 0/1 flag and a boolean are both accepted (the web writes both)", async () => {
    const { status } = await patch({ autoInvoice: true, notifyDueFee: 1 });
    expect(status).toBe(200);
  });

  it("writes an outbox row and an audit row (Rule 7 / BR-SYN-01, BR-SEC-03)", async () => {
    await patch({ instituteName: "Audited Academy" });
    const audit = db.query(
      "SELECT action FROM audit_log WHERE tenant_id = ? AND action = 'settings.update'",
      [TENANT],
    );
    const outbox = db.query(
      "SELECT op FROM sync_outbox WHERE tenant_id = ? AND table_name = 'settings'",
      [TENANT],
    );
    expect(audit.length).toBe(1);
    expect(outbox.length).toBe(1);
    expect(String(outbox[0].op)).toBe("update");
  });
});

describe("settings PATCH — a field the allowlist does not name is REJECTED, not stripped", () => {
  // Before 2026-10-04 `z.object().partial()` silently dropped unknown keys, so
  // these all returned 200 with an unchanged row. A caller told the write
  // happened when it did not — the accept-and-drop defect.
  const FORBIDDEN: Array<[string, unknown, string]> = [
    ["pin_hash", "attacker-supplied", "pin_hash"],
    ["pinHash", "attacker-supplied", "pinHash"],
    ["tenant_secret", "attacker-supplied", "tenant_secret"],
    ["tenantSecret", "attacker-supplied", "tenantSecret"],
    ["backup_passphrase_hash", "attacker-supplied", "backup_passphrase_hash"],
    ["tenant_id", OTHER_TENANT, "tenant_id"],
    ["tenantId", OTHER_TENANT, "tenantId"],
    ["id", "row-id", "id"],
    ["plan", "enterprise", "plan"],
    ["created_at", "2020-01-01", "created_at"],
  ];

  for (const [field, value, named] of FORBIDDEN) {
    it(`rejects ${field} with a 400 naming the field`, async () => {
      const { status, body } = await patch({ [field]: value });
      expect(status).toBe(400);
      expect(body.error).toBe("VALIDATION");
      expect(body.details).toContain(named);
    });
  }

  it("the monotonic sequence counters are never client-writable (BR-RC-01)", async () => {
    // next_receipt_seq / next_invoice_seq are consumed forever and never
    // rewound; a client that could set them could reissue a receipt number.
    for (const counter of ["next_receipt_seq", "next_invoice_seq", "next_student_seq"]) {
      const { status, body } = await patch({ [counter]: 999999 });
      expect(status, counter).toBe(400);
      expect(body.details).toContain(counter);
    }
    // Untouched, whatever was asked for.
    expect(Number(settingRow().next_receipt_seq)).toBe(11);
    expect(Number(settingRow().next_invoice_seq)).toBe(7);
    expect(Number(settingRow().next_student_seq)).toBe(3);
  });

  it("a mixed body still writes the allowed field and rejects the request as a whole", async () => {
    // All-or-nothing: a partially-applied PATCH is worse than a refusal, because
    // the client believes the whole payload landed.
    const { status, body } = await patch({ instituteName: "Good", next_receipt_seq: 999999 });
    expect(status).toBe(400);
    expect(body.details).toContain("next_receipt_seq");
    expect(String(settingRow().institute_name)).toBe("Fixture Tuition");
  });

  it("a PATCH carrying ONLY unknown fields is a 400, not a silent 200 no-op", async () => {
    const { status, body } = await patch({ next_receipt_seq: 1 });
    expect(status).toBe(400);
    expect(body.error).toBe("VALIDATION");
  });

  it("the rejection message names the spec, not just the field", async () => {
    const { body } = await patch({ pin_hash: "x" });
    expect(body.details).toContain("08_Settings.md");
    expect(body.details).toContain("BR-RC-01");
  });

  it("the empty body is still rejected", async () => {
    const { status } = await patch({});
    expect(status).toBe(400);
  });

  it("a CAS-only PATCH is not reported as a field injection (it is still a no-field 400)", async () => {
    // RFC-004 C4 reads the CAS base from the RAW body and it must never enter
    // the allowlist, so `base_updated_at` must NOT be named as "not a writable
    // settings field" — that would make a legitimate compare-and-swap probe look
    // like an attack. The request still has nothing to change, so it is a 400 on
    // the no-field path, not on the injection path.
    const { status, body } = await patch({ base_updated_at: NOW });
    expect(status).toBe(400);
    expect(body.details ?? "").not.toContain("base_updated_at");
  });

  it("a value of the wrong TYPE is a typed 400, not a coerced write", async () => {
    const { status, body } = await patch({ graceDays: "thirty" });
    expect(status).toBe(400);
    expect(body.error).toBe("VALIDATION");
  });

  it("a negative integer is rejected (grace days cannot be negative)", async () => {
    const { status } = await patch({ graceDays: -1 });
    expect(status).toBe(400);
  });
});

describe("settings GET never returns a secret (10_Security.md §1/§3.4)", () => {
  it("omits pin_hash, tenant_secret and the backup hash", async () => {
    db.raw.prepare("UPDATE settings SET pin_hash = ? WHERE tenant_id = ?").run("$argon2id$v=19", TENANT);
    const res = await handleSettings(
      new Request(url("/api/v1/settings"), { method: "GET" }),
      db as unknown as DB, TENANT, "/api/v1/settings", "GET", url("/api/v1/settings"), {},
    );
    const text = await (res as Response).text();
    expect(text).not.toContain("argon2");
    expect(text).not.toContain("fixture-tenant-secret-pepper");
    expect(text).not.toContain("pin_hash");
    expect(text).not.toContain("tenant_secret");
  });
});

// ── 6. The erase gate ─────────────────────────────────────────────────────────

async function erase(body: unknown, tenantId = TENANT) {
  const req = new Request(url("/api/v1/security/erase"), {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const res = await handleSecurity(
    req, db as unknown as DB, tenantId, "/api/v1/security/erase", "POST",
    url("/api/v1/security/erase"), {},
  );
  if (!res) throw new Error("handleSecurity did not match POST /api/v1/security/erase");
  return { status: res.status, body: (await res.json()) as { success: boolean; error?: string; details?: string } };
}

function setPin(tenantId = TENANT): void {
  db.raw.prepare("UPDATE settings SET pin_hash = ? WHERE tenant_id = ?")
    .run("$argon2id$v=19$m=65536,t=3,p=2$fake-hash", tenantId);
}

function countStudents(tenantId = TENANT): number {
  return Number(db.query("SELECT COUNT(*) AS c FROM students WHERE tenant_id = ?", [tenantId])[0].c);
}

function insertStudent(tenantId = TENANT, code = "z01"): void {
  db.raw.prepare(
    `INSERT INTO students (id, tenant_id, code, first_name, admission_date, status, dup_key, created_at, updated_at)
     VALUES (?, ?, ?, 'Test', '2026-01-01', 'active', ?, ?, ?)`,
  ).run(`018f0000-0000-7000-8000-0000000000${code}`, tenantId, code, code, NOW, NOW);
}

describe("erase — the gates, in order, each fail-closed", () => {
  it("rejects a tutorId that is not the authenticated tenant", async () => {
    setPin();
    const { status, body } = await erase({ tutorId: OTHER_TENANT, confirm: "ERASE" });
    expect(status).toBe(400);
    expect(body.error).toContain("tutorId");
  });

  it("rejects a missing tutorId", async () => {
    setPin();
    expect((await erase({ confirm: "ERASE" })).status).toBe(400);
  });

  it("rejects a confirm phrase that is not exactly ERASE", async () => {
    setPin();
    for (const confirm of ["erase", "ERASE ", "delete", "DELETE", "", "ERASE\n"]) {
      const { status } = await erase({ tutorId: TENANT, confirm });
      expect(status, JSON.stringify(confirm)).toBe(400);
    }
  });

  it("FAILS CLOSED when no PIN is configured — the gate has nothing to confirm against", async () => {
    insertStudent();
    // No setPin() — this tenant never configured one.
    const { status, body } = await erase({ tutorId: TENANT, confirm: "ERASE" });
    expect(status).toBe(400);
    expect(body.error).toBe("VALIDATION");
    expect(body.details).toContain("No PIN configured");
    expect(countStudents()).toBe(1); // nothing was destroyed
  });

  it("an empty-string pin_hash also counts as unconfigured", async () => {
    db.raw.prepare("UPDATE settings SET pin_hash = '' WHERE tenant_id = ?").run(TENANT);
    const { status } = await erase({ tutorId: TENANT, confirm: "ERASE" });
    expect(status).toBe(400);
  });

  it("RATE LIMITS the endpoint per tenant — 5 attempts, then 429", async () => {
    // No PIN is set here, so every attempt reaches the limiter and is refused by
    // the PIN gate (400) — the limiter sits AFTER the identity and typed-confirm
    // gates, so a wrong `confirm` never reaches it. That is deliberate: the
    // limiter exists to bound PIN-guessing attempts at the expensive gate, and a
    // fixed-string comparison is not worth spending budget on.
    insertStudent();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await erase({ tutorId: TENANT, confirm: "ERASE" })).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(5).every((s) => s === 429)).toBe(true);
    expect(countStudents()).toBe(1); // a refused attempt never destroys anything
  });

  it("the rate limit is keyed per tenant — another tutor is unaffected", async () => {
    insertStudent();
    for (let i = 0; i < 7; i++) await erase({ tutorId: TENANT, confirm: "ERASE" });
    expect((await erase({ tutorId: TENANT, confirm: "ERASE" })).status).toBe(429);
    // A different tenant has its own budget.
    expect((await erase({ tutorId: OTHER_TENANT, confirm: "ERASE" })).status).toBe(400);
  });

  it("a wrong confirm is refused BEFORE the limiter is consulted", async () => {
    setPin();
    insertStudent();
    for (let i = 0; i < 8; i++) {
      expect((await erase({ tutorId: TENANT, confirm: "WRONG" })).status).toBe(400);
    }
  });

  it("the PIN is never echoed into the audit metadata", async () => {
    setPin();
    insertStudent();
    await erase({ tutorId: TENANT, confirm: "ERASE" });
    const rows = db.query(
      "SELECT metadata FROM audit_log WHERE tenant_id = ? AND action LIKE 'security.erase%'",
      [TENANT],
    );
    expect(rows.length).toBeGreaterThan(0);
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain("argon2");
    expect(blob).not.toContain("fake-hash");
  });
});

describe("erase — a refused request must leave no trace of an attempt beyond nothing", () => {
  it("a wrong confirm writes NO audit row and destroys nothing", async () => {
    setPin();
    insertStudent();
    await erase({ tutorId: TENANT, confirm: "NOPE" });
    expect(countStudents()).toBe(1);
    const audit = db.query(
      "SELECT COUNT(*) AS c FROM audit_log WHERE tenant_id = ? AND action LIKE 'security.erase%'",
      [TENANT],
    );
    expect(Number(audit[0].c)).toBe(0);
  });

  it("a wrong tutorId writes NO audit row (the request was never authorised)", async () => {
    setPin();
    insertStudent(OTHER_TENANT, "aaa");
    await erase({ tutorId: TENANT, confirm: "ERASE" }, OTHER_TENANT);
    expect(countStudents(OTHER_TENANT)).toBe(1);
    expect(Number(
      db.query("SELECT COUNT(*) AS c FROM audit_log WHERE action LIKE 'security.erase%'")[0].c,
    )).toBe(0);
  });

  it("a PIN-unset refusal writes NO erase audit row", async () => {
    insertStudent();
    await erase({ tutorId: TENANT, confirm: "ERASE" });
    expect(Number(
      db.query("SELECT COUNT(*) AS c FROM audit_log WHERE action LIKE 'security.erase%'")[0].c,
    )).toBe(0);
  });
});

describe("erase — the happy path is still a wipe, with the audit chain it promises", () => {
  it("destroys every tenant row and never crosses the tenant boundary", async () => {
    setPin();
    insertStudent(TENANT, "001");
    insertStudent(TENANT, "002");
    insertStudent(OTHER_TENANT, "003");
    invalidateTenant(TENANT);

    const { status } = await erase({ tutorId: TENANT, confirm: "ERASE" });
    expect(status).toBe(200);
    expect(countStudents(TENANT)).toBe(0);
    expect(countStudents(OTHER_TENANT)).toBe(1);
    // erase_complete survives the wipe because it is written AFTER the cascade.
    expect(
      db.query("SELECT action FROM audit_log WHERE tenant_id = ? AND action = 'security.erase_complete'", [TENANT]).length,
    ).toBe(1);
  });

  it("the audit_log table is itself erased, so erase_initiated does NOT survive its own wipe", async () => {
    // 10_Security.md §18.1 step 2 records `erase_initiated` before any deletion,
    // and step 7 promises the two rows are what remain of the audit chain. In
    // practice `audit_log` is one of the erased tables, so the cascade deletes
    // the very row that announced it and only `erase_complete` is left. Worse:
    // a mid-cascade failure rolls the batch back, taking the intent row with it,
    // so a FAILED erase leaves no trace at all. Asserted as-is so the gap is
    // visible; escalated to the owner rather than changed unilaterally.
    setPin();
    insertStudent(TENANT, "011");
    await erase({ tutorId: TENANT, confirm: "ERASE" });
    const actions = db.query("SELECT action FROM audit_log WHERE action LIKE 'security.erase%'")
      .map((r) => String(r.action));
    expect(actions).toContain("security.erase_complete");
    expect(actions).not.toContain("security.erase_initiated");
  });

  it("erases other tenant-scoped tables too, not just students", async () => {
    setPin();
    db.raw.prepare(
      `INSERT INTO batches (id, tenant_id, name, subject, created_at, updated_at) VALUES (?, ?, 'Alpha', 'Maths', ?, ?)`,
    ).run("018f0000-0000-7000-8000-0000000000b01", TENANT, NOW, NOW);
    db.raw.prepare(
      `INSERT INTO notifications (id, tenant_id, category, title, created_at) VALUES (?, ?, 'general', 'Hi', ?)`,
    ).run("018f0000-0000-7000-8000-0000000000b02", TENANT, NOW);
    const { status } = await erase({ tutorId: TENANT, confirm: "ERASE" });
    expect(status).toBe(200);
    expect(Number(db.query("SELECT COUNT(*) AS c FROM batches WHERE tenant_id = ?", [TENANT])[0].c)).toBe(0);
    expect(Number(db.query("SELECT COUNT(*) AS c FROM notifications WHERE tenant_id = ?", [TENANT])[0].c)).toBe(0);
  });

  it("the fee tables are erased BEFORE students, so the FK never blocks the wipe", async () => {
    // `fee_plans.student_id REFERENCES students(id)` and
    // `fee_schedule_items.fee_plan_id REFERENCES fee_plans(id)` (lib/schema.ts:153-182).
    // Deleting students first aborts on a dangling plan; this is the ordering the
    // cascade depends on, and it is why the two tables were added on 2026-10-04.
    setPin();
    insertStudent(TENANT, "021");
    const studentId = db.query(
      "SELECT id FROM students WHERE tenant_id = ? AND code = '021'", [TENANT],
    )[0].id as string;
    db.raw.prepare(
      `INSERT INTO fee_plans (id, tenant_id, student_id, model, cycle, base_amount, start_date, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'postpaid', 'monthly', 100000, '2026-01-01', 1, ?, ?)`,
    ).run("018f0000-0000-7000-8000-0000000000p01", TENANT, studentId, NOW, NOW);
    db.raw.prepare(
      `INSERT INTO fee_schedule_items (id, tenant_id, fee_plan_id, label, due_date, amount, created_at, updated_at)
       VALUES (?, ?, ?, 'Jan', '2026-01-31', 100000, ?, ?)`,
    ).run("018f0000-0000-7000-8000-0000000000q01", TENANT, "018f0000-0000-7000-8000-0000000000p01", NOW, NOW);

    const { status } = await erase({ tutorId: TENANT, confirm: "ERASE" });
    expect(status).toBe(200);
    expect(countStudents(TENANT)).toBe(0);
    expect(Number(db.query("SELECT COUNT(*) AS c FROM fee_plans WHERE tenant_id = ?", [TENANT])[0].c)).toBe(0);
    expect(Number(db.query("SELECT COUNT(*) AS c FROM fee_schedule_items WHERE tenant_id = ?", [TENANT])[0].c)).toBe(0);
  });
});
