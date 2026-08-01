import { describe, it, expect, beforeEach } from "vitest";

const DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  tenant_id               TEXT PRIMARY KEY,
  institute_name          TEXT NOT NULL DEFAULT 'My Tuition',
  institute_address       TEXT,
  institute_phone         TEXT,
  institute_email         TEXT,
  currency_code           TEXT NOT NULL DEFAULT 'INR',
  locale                  TEXT NOT NULL DEFAULT 'en-IN',
  timezone                TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  default_fee_model       TEXT NOT NULL DEFAULT 'postpaid',
  invoice_prefix          TEXT NOT NULL DEFAULT 'INV-',
  receipt_prefix          TEXT NOT NULL DEFAULT 'RCP-',
  grace_days              INTEGER NOT NULL DEFAULT 0,
  auto_invoice            INTEGER NOT NULL DEFAULT 0,
  next_invoice_seq        INTEGER NOT NULL DEFAULT 1,
  next_receipt_seq        INTEGER NOT NULL DEFAULT 1,
  next_student_seq        INTEGER NOT NULL DEFAULT 1,
  attendance_lock_hours   INTEGER NOT NULL DEFAULT 48,
  default_attendance_status TEXT,
  holiday_list_json       TEXT,
  notify_due_fee          INTEGER NOT NULL DEFAULT 1,
  notify_upcoming_due     INTEGER NOT NULL DEFAULT 1,
  notify_missing_attendance INTEGER NOT NULL DEFAULT 1,
  notify_inactive_student INTEGER NOT NULL DEFAULT 1,
  session_timeout_min     INTEGER NOT NULL DEFAULT 5,
  theme                   TEXT NOT NULL DEFAULT 'system',
  biometric_enabled       INTEGER NOT NULL DEFAULT 0,
  pin_hash                TEXT,
  backup_passphrase_hash  TEXT,
  tenant_secret           TEXT NOT NULL,
  auto_archive_inactive_days INTEGER,
  palette                 TEXT NOT NULL DEFAULT 'aurora-cosmic',
  density                 TEXT,
  reduced_motion          INTEGER,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tutors (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  name         TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  role         TEXT NOT NULL DEFAULT 'tutor',
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tutors_tenant ON tutors(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS batches (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  tutor_id     TEXT,
  name         TEXT NOT NULL,
  subject      TEXT,
  schedule     TEXT,
  archived_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_batches_tenant ON batches(tenant_id, archived_at);

CREATE TABLE IF NOT EXISTS students (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  code            TEXT,
  first_name      TEXT NOT NULL,
  last_name       TEXT,
  dob             TEXT,
  gender          TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  school          TEXT,
  grade           TEXT,
  board           TEXT,
  admission_date  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  fee_model       TEXT NOT NULL DEFAULT 'postpaid',
  dup_key         TEXT NOT NULL,
  merged_into_id  TEXT,
  custom_fields   TEXT,
  base_fee_paise  INTEGER NOT NULL DEFAULT 0,
  balance_paise   INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  archived_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_students_tenant_status ON students(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_students_tenant_archived ON students(tenant_id, archived_at);

CREATE TABLE IF NOT EXISTS guardians (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  student_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  relation     TEXT,
  phone        TEXT,
  email        TEXT,
  is_primary   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guardians_student ON guardians(student_id);

CREATE TABLE IF NOT EXISTS student_enrollments (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  student_id   TEXT NOT NULL,
  batch_id     TEXT NOT NULL,
  joined_on    TEXT NOT NULL,
  exited_on    TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enroll_batch ON student_enrollments(batch_id, exited_on);
CREATE INDEX IF NOT EXISTS idx_enroll_student ON student_enrollments(student_id);

CREATE TABLE IF NOT EXISTS tags (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  color       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS student_tags (
  student_id  TEXT NOT NULL,
  tag_id      TEXT NOT NULL,
  PRIMARY KEY(student_id, tag_id)
);

CREATE TABLE IF NOT EXISTS student_notes (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  student_id   TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'general',
  body         TEXT NOT NULL,
  pinned       INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_student ON student_notes(student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS student_documents (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  student_id   TEXT NOT NULL,
  label        TEXT NOT NULL,
  blob_key     TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  uploaded_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_student ON student_documents(student_id);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  batch_id      TEXT NOT NULL,
  session_date  TEXT NOT NULL,
  started_at    TEXT,
  locked_at     TEXT,
  locked_by     TEXT,
  is_holiday    INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_tenant_date ON attendance_sessions(tenant_id, session_date);

CREATE TABLE IF NOT EXISTS attendance_records (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  student_id   TEXT NOT NULL,
  status       TEXT NOT NULL,
  marked_at    TEXT NOT NULL,
  marked_by    TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attendance_records_tenant ON attendance_records(tenant_id, session_id, student_id);

CREATE TABLE IF NOT EXISTS fee_plans (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  student_id     TEXT NOT NULL,
  batch_id       TEXT,
  model          TEXT NOT NULL DEFAULT 'postpaid',
  cycle          TEXT NOT NULL DEFAULT 'monthly',
  base_amount    INTEGER NOT NULL,
  start_date     TEXT NOT NULL,
  end_date       TEXT,
  discount_type  TEXT,
  discount_value INTEGER,
  scholarship    TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fee_schedule_items (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  fee_plan_id   TEXT NOT NULL,
  label         TEXT NOT NULL,
  due_date      TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id                     TEXT PRIMARY KEY,
  tenant_id              TEXT NOT NULL,
  number                 TEXT NOT NULL,
  student_id             TEXT NOT NULL,
  fee_schedule_item_id   TEXT,
  issue_date             TEXT NOT NULL,
  due_date               TEXT,
  subtotal               INTEGER NOT NULL,
  discount               INTEGER NOT NULL DEFAULT 0,
  extra_charges          INTEGER NOT NULL DEFAULT 0,
  total                  INTEGER NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'unpaid',
  voided_at              TEXT,
  void_reason            TEXT,
  tamper_hash            TEXT NOT NULL DEFAULT '',
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status_due ON invoices(tenant_id, status, due_date);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  student_id           TEXT NOT NULL,
  batch_id             TEXT,
  invoice_id           TEXT,
  type                 TEXT NOT NULL,
  debit_paise          INTEGER NOT NULL DEFAULT 0,
  credit_paise         INTEGER NOT NULL DEFAULT 0,
  balance_after_paise  INTEGER NOT NULL,
  description          TEXT,
  receipt_no           TEXT,
  payment_method       TEXT,
  payment_ref          TEXT,
  prev_hash            TEXT,
  this_hash            TEXT NOT NULL DEFAULT '',
  void_of_id           TEXT,
  locked_at            TEXT,
  occurred_on          TEXT NOT NULL,
  source               TEXT NOT NULL DEFAULT 'manual',
  device_id            TEXT,
  created_by           TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_tenant_type_occurred ON ledger_entries(tenant_id, type, occurred_on);
CREATE INDEX IF NOT EXISTS idx_ledger_tenant_student ON ledger_entries(tenant_id, student_id, occurred_on);

CREATE TABLE IF NOT EXISTS receipts (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  number          TEXT NOT NULL,
  ledger_entry_id TEXT NOT NULL,
  student_id      TEXT NOT NULL,
  invoice_id      TEXT,
  amount          INTEGER NOT NULL,
  payment_method  TEXT NOT NULL,
  payment_ref     TEXT,
  received_on     TEXT NOT NULL,
  tamper_hash     TEXT NOT NULL DEFAULT '',
  voided_at       TEXT,
  pdf_blob_key    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  category     TEXT NOT NULL,
  ref_type     TEXT NOT NULL,
  ref_id       TEXT NOT NULL,
  due_at       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  snooze_until TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'system',
  title       TEXT NOT NULL,
  body        TEXT,
  ref_type    TEXT,
  ref_id      TEXT,
  read_at     TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  ref_type    TEXT,
  ref_id      TEXT,
  metadata    TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_log(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  op          TEXT NOT NULL,
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  flushed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_tenant_status ON sync_outbox(tenant_id, status, created_at);

CREATE TABLE IF NOT EXISTS backup_manifest (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  filename          TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  schema_version    INTEGER NOT NULL,
  row_counts        TEXT NOT NULL,
  data_sha256       TEXT NOT NULL,
  encrypted_sha256  TEXT NOT NULL,
  key_kdf_salt      TEXT NOT NULL,
  key_kdf_params    TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  created_by        TEXT
);

CREATE TABLE IF NOT EXISTS app_state (
  tenant_id        TEXT PRIMARY KEY,
  schema_version   INTEGER NOT NULL,
  app_lock_state   TEXT NOT NULL DEFAULT 'unlocked',
  app_lock_until   TEXT,
  last_backup_at   TEXT,
  last_export_at   TEXT,
  last_sync_at     TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS trg_ledger_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
`;

const provisioned = new Set<string>();

async function applySchema(
  db: { execute: (stmt: string) => Promise<unknown> },
  tenantKey: string,
): Promise<void> {
  if (provisioned.has(tenantKey)) return;
  for (const stmt of DDL.split(";")) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    await db.execute(trimmed);
  }
  provisioned.add(tenantKey);
}

function createMockDb() {
  const executed: string[] = [];
  return {
    executed,
    execute: (stmt: string) => {
      executed.push(stmt);
      return Promise.resolve({ rows: [] });
    },
  };
}

beforeEach(() => {
  provisioned.clear();
});

const EXPECTED_TABLES = [
  "settings",
  "tutors",
  "batches",
  "students",
  "guardians",
  "student_enrollments",
  "tags",
  "student_tags",
  "student_notes",
  "student_documents",
  "attendance_sessions",
  "attendance_records",
  "fee_plans",
  "fee_schedule_items",
  "invoices",
  "ledger_entries",
  "receipts",
  "reminders",
  "notifications",
  "audit_log",
  "sync_outbox",
  "backup_manifest",
  "app_state",
];

const EXPECTED_INDEXES = [
  "idx_tutors_tenant",
  "idx_batches_tenant",
  "idx_students_tenant_status",
  "idx_students_tenant_archived",
  "idx_guardians_student",
  "idx_enroll_batch",
  "idx_enroll_student",
  "idx_notes_student",
  "idx_docs_student",
  "idx_attendance_sessions_tenant_date",
  "idx_attendance_records_tenant",
  "idx_invoices_tenant_status_due",
  "idx_ledger_tenant_type_occurred",
  "idx_ledger_tenant_student",
  "idx_audit_tenant_created",
  "idx_sync_outbox_tenant_status",
];

describe("applySchema", () => {
  it("executes DDL statements against the db", async () => {
    const db = createMockDb();
    await applySchema(db, "test-tenant");
    expect(db.executed.length).toBeGreaterThan(0);
  });

  it("splits DDL by semicolons and trims empty statements", async () => {
    const db = createMockDb();
    await applySchema(db, "test-tenant");
    const nonEmpty = db.executed.filter((s) => s.trim().length > 0);
    expect(nonEmpty.length).toBe(db.executed.length);
  });

  it("all 23 tables are mentioned in the DDL", async () => {
    const db = createMockDb();
    await applySchema(db, "test-tenant");
    const allSql = db.executed.join("\n");
    for (const table of EXPECTED_TABLES) {
      expect(allSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("all 16 performance indexes are present", async () => {
    const db = createMockDb();
    await applySchema(db, "test-tenant");
    const allSql = db.executed.join("\n");
    for (const idx of EXPECTED_INDEXES) {
      expect(allSql).toContain(`CREATE INDEX IF NOT EXISTS ${idx}`);
    }
  });

  it("both ledger triggers are created", async () => {
    const db = createMockDb();
    await applySchema(db, "test-tenant");
    const allSql = db.executed.join("\n");
    expect(allSql).toContain("trg_ledger_no_update");
    expect(allSql).toContain("trg_ledger_no_delete");
  });

  it("enables foreign keys via PRAGMA", async () => {
    const db = createMockDb();
    await applySchema(db, "test-tenant");
    expect(db.executed[0]).toContain("PRAGMA foreign_keys");
  });

  it("idempotent: calling twice with same tenantKey only runs DDL once", async () => {
    const db = createMockDb();
    await applySchema(db, "tenant-A");
    const firstCount = db.executed.length;
    expect(firstCount).toBeGreaterThan(0);

    await applySchema(db, "tenant-A");
    expect(db.executed.length).toBe(firstCount);
  });

  it("different tenantKeys get independent DDL runs", async () => {
    const db = createMockDb();
    await applySchema(db, "tenant-A");
    const countA = db.executed.length;

    const db2 = createMockDb();
    await applySchema(db2, "tenant-B");
    const countB = db2.executed.length;

    expect(countA).toBeGreaterThan(0);
    expect(countB).toBe(countA);
  });

  it("DDL creates exactly 23 tables", async () => {
    const db = createMockDb();
    await applySchema(db, "test-tenant");
    const tableStatements = db.executed.filter((s) => s.startsWith("CREATE TABLE"));
    expect(tableStatements.length).toBe(23);
  });

  it("DDL creates exactly 16 indexes", async () => {
    const db = createMockDb();
    await applySchema(db, "test-tenant");
    const indexStatements = db.executed.filter((s) => s.startsWith("CREATE INDEX"));
    expect(indexStatements.length).toBe(16);
  });

  it("DDL creates exactly 2 triggers", async () => {
    const db = createMockDb();
    await applySchema(db, "test-tenant");
    const triggerStatements = db.executed.filter((s) => s.startsWith("CREATE TRIGGER"));
    expect(triggerStatements.length).toBe(2);
  });

  it("PRAGMA is the first statement executed", async () => {
    const db = createMockDb();
    await applySchema(db, "test-tenant");
    expect(db.executed[0]).toMatch(/^PRAGMA foreign_keys/);
  });

  it("student table has all expected columns", async () => {
    const db = createMockDb();
    await applySchema(db, "test-tenant");
    const studentDdl = db.executed.find((s) => s.includes("CREATE TABLE IF NOT EXISTS students"));
    expect(studentDdl).toBeDefined();
    for (const col of [
      "id",
      "tenant_id",
      "code",
      "first_name",
      "last_name",
      "dob",
      "gender",
      "phone",
      "email",
      "address",
      "school",
      "grade",
      "board",
      "admission_date",
      "status",
      "fee_model",
      "dup_key",
      "base_fee_paise",
      "balance_paise",
      "created_at",
      "updated_at",
    ]) {
      expect(studentDdl).toContain(col);
    }
  });

  it("ledger_entries table has append-only columns", async () => {
    const db = createMockDb();
    await applySchema(db, "test-tenant");
    const ledgerDdl = db.executed.find((s) =>
      s.includes("CREATE TABLE IF NOT EXISTS ledger_entries"),
    );
    expect(ledgerDdl).toBeDefined();
    for (const col of [
      "debit_paise",
      "credit_paise",
      "balance_after_paise",
      "void_of_id",
      "this_hash",
      "prev_hash",
    ]) {
      expect(ledgerDdl).toContain(col);
    }
  });

  it("receipts table preserves financial history columns", async () => {
    const db = createMockDb();
    await applySchema(db, "test-tenant");
    const receiptsDdl = db.executed.find((s) => s.includes("CREATE TABLE IF NOT EXISTS receipts"));
    expect(receiptsDdl).toBeDefined();
    expect(receiptsDdl).toContain("ledger_entry_id");
    expect(receiptsDdl).toContain("tamper_hash");
  });

  it("sync_outbox has status and attempts columns", async () => {
    const db = createMockDb();
    await applySchema(db, "test-tenant");
    const outboxDdl = db.executed.find((s) => s.includes("CREATE TABLE IF NOT EXISTS sync_outbox"));
    expect(outboxDdl).toBeDefined();
    expect(outboxDdl).toContain("status");
    expect(outboxDdl).toContain("attempts");
    expect(outboxDdl).toContain("flushed_at");
  });

  it("audit_log has actor and action columns", async () => {
    const db = createMockDb();
    await applySchema(db, "test-tenant");
    const auditDdl = db.executed.find((s) => s.includes("CREATE TABLE IF NOT EXISTS audit_log"));
    expect(auditDdl).toBeDefined();
    expect(auditDdl).toContain("actor");
    expect(auditDdl).toContain("action");
    expect(auditDdl).toContain("ref_type");
    expect(auditDdl).toContain("metadata");
  });
});
