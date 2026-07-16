-- V0001__init.sql

CREATE TABLE IF NOT EXISTS settings (
  tenant_id               TEXT PRIMARY KEY,
  institute_name          TEXT NOT NULL DEFAULT 'My Tuition',
  institute_address       TEXT,
  institute_phone         TEXT,
  institute_email         TEXT,
  currency_code           TEXT NOT NULL DEFAULT 'INR'
                            CHECK(currency_code IN ('INR','USD','EUR','GBP','AED')),
  locale                  TEXT NOT NULL DEFAULT 'en-IN',
  timezone                TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  default_fee_model       TEXT NOT NULL DEFAULT 'postpaid'
                            CHECK(default_fee_model IN ('postpaid','prepaid','mixed')),
  invoice_prefix          TEXT NOT NULL DEFAULT 'INV-',
  receipt_prefix          TEXT NOT NULL DEFAULT 'RCP-',
  next_invoice_seq        INTEGER NOT NULL DEFAULT 1,
  next_receipt_seq        INTEGER NOT NULL DEFAULT 1,
  next_student_seq        INTEGER NOT NULL DEFAULT 1,
  attendance_lock_hours   INTEGER NOT NULL DEFAULT 48,
  session_timeout_min     INTEGER NOT NULL DEFAULT 5,
  theme                   TEXT NOT NULL DEFAULT 'system' CHECK(theme IN ('light','dark','system')),
  biometric_enabled       INTEGER NOT NULL DEFAULT 0 CHECK(biometric_enabled IN (0,1)),
  pin_hash                TEXT,
  backup_passphrase_hash  TEXT,
  tenant_secret           TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tutors (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  name         TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  role         TEXT NOT NULL DEFAULT 'tutor'
                 CHECK(role IN ('owner','tutor','assistant')),
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tutors_tenant ON tutors(tenant_id, is_active);

CREATE TABLE IF NOT EXISTS batches (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  tutor_id     TEXT REFERENCES tutors(id),
  name         TEXT NOT NULL,
  subject      TEXT,
  schedule     TEXT,
  archived_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_batches_tenant ON batches(tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_batches_tutor  ON batches(tutor_id, archived_at);

CREATE TABLE IF NOT EXISTS students (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  code            TEXT,
  first_name      TEXT NOT NULL,
  last_name       TEXT,
  dob             TEXT,
  gender          TEXT CHECK(gender IN ('M','F','O') OR gender IS NULL),
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  school          TEXT,
  grade           TEXT,
  board           TEXT,
  admission_date  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK(status IN ('active','inactive','graduated','archived')),
  fee_model       TEXT NOT NULL DEFAULT 'postpaid'
                  CHECK(fee_model IN ('postpaid','prepaid','mixed')),
  dup_key         TEXT NOT NULL,
  merged_into_id  TEXT REFERENCES students(id),
  custom_fields   TEXT,
  notes           TEXT,
  archived_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_students_tenant_status ON students(tenant_id, status, archived_at);
CREATE INDEX IF NOT EXISTS idx_students_name          ON students(tenant_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_students_dup           ON students(tenant_id, dup_key);

CREATE TABLE IF NOT EXISTS guardians (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  student_id   TEXT NOT NULL REFERENCES students(id),
  name         TEXT NOT NULL,
  relation     TEXT CHECK(relation IN ('Father','Mother','Guardian') OR relation IS NULL),
  phone        TEXT,
  email        TEXT,
  is_primary   INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guardians_student ON guardians(student_id);
CREATE INDEX IF NOT EXISTS idx_guardians_phone   ON guardians(tenant_id, phone);

CREATE TABLE IF NOT EXISTS student_enrollments (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  student_id   TEXT NOT NULL REFERENCES students(id),
  batch_id     TEXT NOT NULL REFERENCES batches(id),
  joined_on    TEXT NOT NULL,
  exited_on    TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(student_id, batch_id, joined_on)
);
CREATE INDEX IF NOT EXISTS idx_enroll_batch   ON student_enrollments(batch_id, exited_on);
CREATE INDEX IF NOT EXISTS idx_enroll_student ON student_enrollments(student_id);

CREATE TABLE IF NOT EXISTS tags (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  color       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(tenant_id, name)
);

CREATE TABLE IF NOT EXISTS student_tags (
  student_id  TEXT NOT NULL REFERENCES students(id),
  tag_id      TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY(student_id, tag_id)
);

CREATE TABLE IF NOT EXISTS student_notes (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  student_id   TEXT NOT NULL REFERENCES students(id),
  category     TEXT NOT NULL CHECK(category IN ('academic','payment','attendance','general')),
  body         TEXT NOT NULL,
  pinned       INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_student ON student_notes(student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS student_documents (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  student_id   TEXT NOT NULL REFERENCES students(id),
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
  batch_id      TEXT NOT NULL REFERENCES batches(id),
  session_date  TEXT NOT NULL,
  started_at    TEXT,
  locked_at     TEXT,
  locked_by     TEXT CHECK(locked_by IN ('pin','biometric','auto') OR locked_by IS NULL),
  is_holiday    INTEGER NOT NULL DEFAULT 0 CHECK(is_holiday IN (0,1)),
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(batch_id, session_date)
);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON attendance_sessions(session_date);

CREATE TABLE IF NOT EXISTS attendance_records (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  session_id   TEXT NOT NULL REFERENCES attendance_sessions(id),
  student_id   TEXT NOT NULL REFERENCES students(id),
  status       TEXT NOT NULL CHECK(status IN ('present','absent','late','excused','holiday')),
  marked_at    TEXT NOT NULL,
  marked_by    TEXT CHECK(marked_by IN ('tutor','system') OR marked_by IS NULL),
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(session_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_records_student ON attendance_records(student_id, session_id);
CREATE INDEX IF NOT EXISTS idx_records_status  ON attendance_records(session_id, status);

CREATE TABLE IF NOT EXISTS fee_plans (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  student_id     TEXT NOT NULL REFERENCES students(id),
  batch_id       TEXT REFERENCES batches(id),
  model          TEXT NOT NULL CHECK(model IN ('postpaid','prepaid','mixed')),
  cycle          TEXT NOT NULL CHECK(cycle IN ('monthly','quarterly','half_yearly','annual','one_time','custom')),
  base_amount    INTEGER NOT NULL,
  start_date     TEXT NOT NULL,
  end_date       TEXT,
  discount_type  TEXT CHECK(discount_type IN ('fixed','percent') OR discount_type IS NULL),
  discount_value INTEGER,
  scholarship    TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_student ON fee_plans(student_id, is_active);

CREATE TABLE IF NOT EXISTS fee_schedule_items (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  fee_plan_id   TEXT NOT NULL REFERENCES fee_plans(id),
  label         TEXT NOT NULL,
  due_date      TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','invoiced','paid','partial','overdue','void')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_due   ON fee_schedule_items(due_date, status);
CREATE INDEX IF NOT EXISTS idx_items_plan  ON fee_schedule_items(fee_plan_id, status);

CREATE TABLE IF NOT EXISTS invoices (
  id                     TEXT PRIMARY KEY,
  tenant_id              TEXT NOT NULL,
  number                 TEXT NOT NULL,
  student_id             TEXT NOT NULL REFERENCES students(id),
  fee_schedule_item_id   TEXT REFERENCES fee_schedule_items(id),
  issue_date             TEXT NOT NULL,
  due_date               TEXT,
  subtotal               INTEGER NOT NULL,
  discount               INTEGER NOT NULL DEFAULT 0,
  extra_charges          INTEGER NOT NULL DEFAULT 0,
  total                  INTEGER NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','partial','paid','void','overdue')),
  voided_at              TEXT,
  void_reason            TEXT,
  tamper_hash            TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  UNIQUE(tenant_id, number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices(student_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_due     ON invoices(due_date, status);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  student_id           TEXT NOT NULL REFERENCES students(id),
  batch_id             TEXT REFERENCES batches(id),
  invoice_id           TEXT REFERENCES invoices(id),
  type                 TEXT NOT NULL CHECK(type IN ('FEE_CHARGED','PAYMENT_RECEIVED','DISCOUNT_GRANTED','REFUND_ISSUED','ADJUSTMENT','WRITEOFF','VOID')),
  debit_paise          INTEGER NOT NULL DEFAULT 0 CHECK(debit_paise  >= 0),
  credit_paise         INTEGER NOT NULL DEFAULT 0 CHECK(credit_paise >= 0),
  balance_after_paise  INTEGER NOT NULL,
  description          TEXT,
  receipt_no           TEXT,
  payment_method       TEXT CHECK(payment_method IN ('cash','upi','card','bank','cheque','other') OR payment_method IS NULL),
  payment_ref          TEXT,
  prev_hash            TEXT,
  this_hash            TEXT NOT NULL,
  void_of_id           TEXT REFERENCES ledger_entries(id),
  locked_at            TEXT,
  occurred_on          TEXT NOT NULL,
  source               TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','import','auto','sync')),
  device_id            TEXT,
  created_by           TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(NOT (debit_paise > 0 AND credit_paise > 0)),
  CHECK(debit_paise + credit_paise > 0)
);
CREATE INDEX IF NOT EXISTS idx_ledger_student   ON ledger_entries(student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_invoice   ON ledger_entries(invoice_id);
CREATE INDEX IF NOT EXISTS idx_ledger_type      ON ledger_entries(tenant_id, type, occurred_on);
CREATE INDEX IF NOT EXISTS idx_ledger_receipt   ON ledger_entries(receipt_no);
CREATE INDEX IF NOT EXISTS idx_ledger_hash      ON ledger_entries(this_hash);
CREATE INDEX IF NOT EXISTS idx_ledger_void_of   ON ledger_entries(void_of_id);

CREATE TABLE IF NOT EXISTS receipts (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  number          TEXT NOT NULL,
  ledger_entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
  student_id      TEXT NOT NULL REFERENCES students(id),
  invoice_id      TEXT REFERENCES invoices(id),
  amount          INTEGER NOT NULL,
  payment_method  TEXT NOT NULL,
  payment_ref     TEXT,
  received_on     TEXT NOT NULL,
  tamper_hash     TEXT NOT NULL,
  voided_at       TEXT,
  pdf_blob_key    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(tenant_id, number)
);
CREATE INDEX IF NOT EXISTS idx_receipts_student ON receipts(student_id, received_on);
CREATE INDEX IF NOT EXISTS idx_receipts_ledger  ON receipts(ledger_entry_id);

CREATE TABLE IF NOT EXISTS reminders (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  category     TEXT NOT NULL CHECK(category IN ('due_fee','upcoming_due','missing_attendance','inactive_student')),
  ref_type     TEXT NOT NULL CHECK(ref_type IN ('student','invoice','batch')),
  ref_id       TEXT NOT NULL,
  due_at       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','snoozed','dismissed','acted')),
  snooze_until TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, due_at);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  category    TEXT NOT NULL CHECK(category IN ('reminder','ledger','attendance','system')),
  title       TEXT NOT NULL,
  body        TEXT,
  ref_type    TEXT,
  ref_id      TEXT,
  read_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(tenant_id, read_at, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  actor       TEXT NOT NULL CHECK(actor IN ('tutor','system','sync')),
  action      TEXT NOT NULL,
  ref_type    TEXT,
  ref_id      TEXT,
  metadata    TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(tenant_id, action, created_at);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  op          TEXT NOT NULL CHECK(op IN ('insert','update','soft_delete')),
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','conflict','dropped')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  flushed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON sync_outbox(status, created_at);

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
CREATE INDEX IF NOT EXISTS idx_backups_created ON backup_manifest(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_state (
  tenant_id        TEXT PRIMARY KEY,
  schema_version   INTEGER NOT NULL,
  app_lock_state   TEXT NOT NULL DEFAULT 'unlocked'
                     CHECK(app_lock_state IN ('unlocked','locked')),
  app_lock_until   TEXT,
  last_backup_at   TEXT,
  last_export_at   TEXT,
  last_sync_at     TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
