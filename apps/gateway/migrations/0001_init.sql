-- 0001_init.sql — BuddySaradhi schema on Supabase Postgres
-- Tenant-scoped: every row carries tenant_id (the Supabase auth user id).
-- Money is INTEGER paise (Constitution Rule 6). All times TIMESTAMPTZ.

CREATE TABLE IF NOT EXISTS settings (
  tenant_id                TEXT PRIMARY KEY,
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
  default_attendance_status TEXT NOT NULL DEFAULT 'present',
  holiday_list_json       TEXT NOT NULL DEFAULT '[]',
  notify_due_fee          INTEGER NOT NULL DEFAULT 1,
  notify_upcoming_due     INTEGER NOT NULL DEFAULT 1,
  notify_missing_attendance INTEGER NOT NULL DEFAULT 1,
  notify_inactive_student INTEGER NOT NULL DEFAULT 1,
  session_timeout_min     INTEGER NOT NULL DEFAULT 5,
  biometric_enabled       INTEGER NOT NULL DEFAULT 0,
  pin_hash                TEXT,
  backup_passphrase_hash  TEXT,
  auto_archive_inactive_days INTEGER NOT NULL DEFAULT 90,
  theme                   TEXT NOT NULL DEFAULT 'system',
  density                 TEXT NOT NULL DEFAULT 'comfortable',
  reduced_motion          INTEGER NOT NULL DEFAULT 0,
  tenant_secret           TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tutors (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  role        TEXT NOT NULL DEFAULT 'tutor',
  is_active   INTEGER NOT NULL DEFAULT 1,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tutors_tenant_active ON tutors (tenant_id, is_active);

CREATE TABLE IF NOT EXISTS batches (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  tutor_id    TEXT,
  name        TEXT NOT NULL,
  subject     TEXT,
  schedule    TEXT,
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS batches_tenant_archived ON batches (tenant_id, archived_at);

CREATE TABLE IF NOT EXISTS students (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  code          TEXT,
  first_name    TEXT NOT NULL,
  last_name     TEXT,
  dob           TEXT,
  gender        TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  school        TEXT,
  grade         TEXT,
  board         TEXT,
  admission_date TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  fee_model     TEXT NOT NULL DEFAULT 'postpaid',
  base_fee_paise INTEGER NOT NULL DEFAULT 0,
  balance_paise INTEGER NOT NULL DEFAULT 0,
  dup_key       TEXT NOT NULL,
  merged_into_id TEXT,
  custom_fields TEXT,
  notes         TEXT,
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS students_tenant_status ON students (tenant_id, status, archived_at);
CREATE INDEX IF NOT EXISTS students_tenant_dup ON students (tenant_id, dup_key);
CREATE INDEX IF NOT EXISTS students_tenant_balance ON students (tenant_id, balance_paise);

CREATE TABLE IF NOT EXISTS guardians (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  student_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  relation    TEXT,
  phone       TEXT,
  email       TEXT,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guardians_student ON guardians (student_id);

CREATE TABLE IF NOT EXISTS student_enrollments (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  student_id  TEXT NOT NULL,
  batch_id    TEXT NOT NULL,
  joined_on   TEXT NOT NULL,
  exited_on   TEXT,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, batch_id, joined_on)
);
CREATE INDEX IF NOT EXISTS enrollments_batch ON student_enrollments (batch_id, exited_on);

CREATE TABLE IF NOT EXISTS fee_plans (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  student_id    TEXT NOT NULL,
  batch_id      TEXT,
  model         TEXT NOT NULL,
  cycle         TEXT NOT NULL,
  base_amount   INTEGER NOT NULL,
  start_date    TEXT NOT NULL,
  end_date      TEXT,
  discount_type TEXT,
  discount_value INTEGER,
  scholarship   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fee_plans_student ON fee_plans (student_id, is_active);

CREATE TABLE IF NOT EXISTS fee_schedule_items (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  fee_plan_id TEXT NOT NULL,
  label       TEXT NOT NULL,
  due_date    TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fsi_duedate ON fee_schedule_items (due_date, status);

CREATE TABLE IF NOT EXISTS invoices (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  number            TEXT NOT NULL,
  student_id        TEXT NOT NULL,
  fee_schedule_item_id TEXT,
  issue_date        TEXT NOT NULL,
  due_date          TEXT,
  subtotal          INTEGER NOT NULL,
  discount          INTEGER NOT NULL DEFAULT 0,
  extra_charges     INTEGER NOT NULL DEFAULT 0,
  total             INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'unpaid',
  voided_at         TIMESTAMPTZ,
  void_reason       TEXT,
  tamper_hash       TEXT,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);
CREATE INDEX IF NOT EXISTS invoices_student ON invoices (student_id, status);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  student_id          TEXT NOT NULL,
  batch_id            TEXT,
  invoice_id          TEXT,
  type                TEXT NOT NULL,
  debit_paise         INTEGER NOT NULL DEFAULT 0,
  credit_paise        INTEGER NOT NULL DEFAULT 0,
  balance_after_paise INTEGER NOT NULL DEFAULT 0,
  description         TEXT,
  receipt_no          TEXT,
  payment_method      TEXT,
  payment_ref         TEXT,
  prev_hash           TEXT,
  this_hash           TEXT,
  void_of_id          TEXT,
  locked_at           TIMESTAMPTZ,
  occurred_on         TEXT NOT NULL,
  source              TEXT NOT NULL DEFAULT 'manual',
  device_id           TEXT,
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_student ON ledger_entries (student_id, created_at);
CREATE INDEX IF NOT EXISTS ledger_invoice ON ledger_entries (invoice_id);
CREATE INDEX IF NOT EXISTS ledger_receipt ON ledger_entries (receipt_no);

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
  tamper_hash     TEXT,
  voided_at       TIMESTAMPTZ,
  pdf_blob_key    TEXT,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  batch_id    TEXT NOT NULL,
  session_date TEXT NOT NULL,
  started_at  TIMESTAMPTZ,
  locked_at   TIMESTAMPTZ,
  locked_by   TEXT,
  is_holiday  INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, session_date)
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  student_id  TEXT NOT NULL,
  status      TEXT NOT NULL,
  marked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  marked_by   TEXT,
  notes       TEXT,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id)
);
CREATE INDEX IF NOT EXISTS att_rec_student ON attendance_records (student_id, session_id);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  category    TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  ref_type    TEXT,
  ref_id      TEXT,
  read_at     TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notif_tenant ON notifications (tenant_id, read_at, created_at);

CREATE TABLE IF NOT EXISTS reminders (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  category    TEXT NOT NULL,
  ref_type    TEXT NOT NULL,
  ref_id      TEXT NOT NULL,
  due_at      TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  snooze_until TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reminders_status ON reminders (status, due_at);
