// Implements: 11_Data_Model.md & AGENTS.md §3.4
// Self-Repairable Database Schema & Auto-Healing Manager
import { DB, run } from "./db.ts";

const healedTenants = new Set<string>();

const CORE_DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS settings (
    tenant_id TEXT PRIMARY KEY,
    institute_name TEXT DEFAULT 'My Tuition',
    institute_address TEXT,
    institute_phone TEXT,
    institute_email TEXT,
    currency_code TEXT DEFAULT 'INR',
    locale TEXT DEFAULT 'en-IN',
    timezone TEXT DEFAULT 'Asia/Kolkata',
    default_fee_model TEXT DEFAULT 'postpaid',
    invoice_prefix TEXT DEFAULT 'INV-',
    receipt_prefix TEXT DEFAULT 'RCP-',
    grace_days INTEGER DEFAULT 0,
    auto_invoice INTEGER DEFAULT 0,
    next_invoice_seq INTEGER DEFAULT 1,
    next_receipt_seq INTEGER DEFAULT 1,
    next_student_seq INTEGER DEFAULT 1,
    attendance_lock_hours INTEGER DEFAULT 48,
    default_attendance_status TEXT DEFAULT 'present',
    holiday_list_json TEXT DEFAULT '[]',
    notify_due_fee INTEGER DEFAULT 1,
    notify_upcoming_due INTEGER DEFAULT 1,
    notify_missing_attendance INTEGER DEFAULT 1,
    notify_inactive_student INTEGER DEFAULT 1,
    session_timeout_min INTEGER DEFAULT 5,
    biometric_enabled INTEGER DEFAULT 0,
    pin_hash TEXT,
    backup_passphrase_hash TEXT,
    auto_archive_inactive_days INTEGER DEFAULT 90,
    theme TEXT DEFAULT 'system',
    palette TEXT DEFAULT 'aurora-cosmic',
    density TEXT DEFAULT 'comfortable',
    reduced_motion INTEGER DEFAULT 0,
    plan TEXT DEFAULT 'free',
    tenant_secret TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS tutors (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    role TEXT DEFAULT 'tutor',
    is_active INTEGER DEFAULT 1,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    tutor_id TEXT,
    name TEXT NOT NULL,
    subject TEXT,
    schedule TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    code TEXT,
    first_name TEXT NOT NULL,
    last_name TEXT,
    dob TEXT,
    gender TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    school TEXT,
    grade TEXT,
    board TEXT,
    admission_date TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    fee_model TEXT DEFAULT 'postpaid',
    base_fee_paise INTEGER DEFAULT 0,
    balance_paise INTEGER DEFAULT 0,
    dup_key TEXT NOT NULL,
    merged_into_id TEXT,
    custom_fields TEXT,
    notes TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS student_enrollments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    joined_on TEXT NOT NULL,
    left_on TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    batch_id TEXT,
    invoice_id TEXT,
    type TEXT NOT NULL,
    debit_paise INTEGER DEFAULT 0,
    credit_paise INTEGER DEFAULT 0,
    balance_after_paise INTEGER NOT NULL,
    description TEXT,
    receipt_no TEXT,
    payment_method TEXT,
    payment_ref TEXT,
    prev_hash TEXT,
    this_hash TEXT,
    void_of_id TEXT,
    locked_at TEXT,
    occurred_on TEXT NOT NULL,
    source TEXT DEFAULT 'manual',
    device_id TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    invoice_number TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    due_date TEXT NOT NULL,
    subtotal_paise INTEGER NOT NULL,
    discount_paise INTEGER DEFAULT 0,
    tax_paise INTEGER DEFAULT 0,
    total_paise INTEGER NOT NULL,
    paid_paise INTEGER DEFAULT 0,
    status TEXT DEFAULT 'issued',
    notes TEXT,
    pdf_blob_key TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    receipt_no TEXT NOT NULL,
    student_id TEXT NOT NULL,
    invoice_id TEXT,
    amount INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    payment_ref TEXT,
    received_on TEXT NOT NULL,
    tamper_hash TEXT,
    voided_at TEXT,
    pdf_blob_key TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS sync_outbox (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    op TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    flushed_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    ref_type TEXT,
    ref_id TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    ref_type TEXT,
    ref_id TEXT,
    read_at TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL
  )`,

  `CREATE TRIGGER IF NOT EXISTS trg_ledger_no_update
   BEFORE UPDATE ON ledger_entries
   BEGIN
     SELECT RAISE(ABORT, 'P0 BUG: ledger_entries is append-only. UPDATE forbidden.');
   END`,

  `CREATE TRIGGER IF NOT EXISTS trg_ledger_no_delete
   BEFORE DELETE ON ledger_entries
   BEGIN
     SELECT RAISE(ABORT, 'P0 BUG: ledger_entries is append-only. DELETE forbidden.');
   END`,
];

export async function ensureSelfRepairingSchema(db: DB, tenantId: string): Promise<void> {
  if (healedTenants.has(tenantId)) return;

  try {
    for (const ddl of CORE_DDL_STATEMENTS) {
      await run(db, ddl).catch((err) => {
        console.warn("DDL statement warning:", err);
      });
    }

    healedTenants.add(tenantId);
  } catch (err) {
    console.error("Self-repairing schema initialization completed with warning:", err);
  }
}
