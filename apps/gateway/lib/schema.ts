// Implements: 11_Data_Model.md & AGENTS.md §3.4
// Self-Repairable Database Schema & Auto-Healing Manager
// Statement execution comes from lib/sql.ts (dependency-free) and `DB` is a
// type-only import, so the DDL itself stays importable by the integration
// tests that assert on it — see apps/gateway/__tests__/ledger-routes.test.ts.
import { batchExecute, oneRow, run, type SqlHandle } from "./sql.ts";
import type { DB } from "./db.ts";
import { logError } from "./log.ts";

const HEALED_TENANTS_MAX = 10_000;
const healedTenants = new Set<string>();

/** The complete gateway schema, including the append-only ledger triggers
 * (`trg_ledger_no_update` / `trg_ledger_no_delete`). Idempotent
 * `CREATE ... IF NOT EXISTS` — the only DDL the gateway is allowed to run
 * (AGENTS.md §3.4). Exported for the schema/ledger integration tests. */
export const CORE_DDL_STATEMENTS = [
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

  // Fee scheduling — added for B1. `invoices.fee_schedule_item_id` REFERENCES
  // `fee_schedule_items(id)`, which itself REFERENCES `fee_plans(id)`; with
  // foreign keys enabled the invoice INSERT below fails with
  // "no such table: main.fee_schedule_items" unless both parents exist. Both
  // are verbatim from `migrations/0001_init.sql:203-234` (AGENTS.md §3.4 — the
  // two schema authorities must not diverge on a referenced table either).
  `CREATE TABLE IF NOT EXISTS fee_plans (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    student_id TEXT NOT NULL REFERENCES students(id),
    batch_id TEXT REFERENCES batches(id),
    model TEXT NOT NULL CHECK(model IN ('postpaid','prepaid','mixed')),
    cycle TEXT NOT NULL CHECK(cycle IN ('monthly','quarterly','half_yearly','annual','one_time','custom')),
    base_amount INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    discount_type TEXT CHECK(discount_type IN ('fixed','percent') OR discount_type IS NULL),
    discount_value INTEGER,
    scholarship TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_plans_student ON fee_plans(student_id, is_active)`,

  `CREATE TABLE IF NOT EXISTS fee_schedule_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    fee_plan_id TEXT NOT NULL REFERENCES fee_plans(id),
    label TEXT NOT NULL,
    due_date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','invoiced','paid','partial','overdue','void')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_items_due   ON fee_schedule_items(due_date, status)`,
  `CREATE INDEX IF NOT EXISTS idx_items_plan  ON fee_schedule_items(fee_plan_id, status)`,

  // 11_Data_Model.md §4.12 verbatim — the ONLY invoices shape the gateway
  // writes (`lib/orm.ts`) and reads (`routes/ledger.ts`, `routes/analytics.ts`);
  // `packages/core/src/fees.ts` also needs `voided_at` for its open-invoice
  // filter. `IF NOT EXISTS` keeps an existing tenant's old table until
  // reprovisioning (AGENTS.md §3.4), so `__tests__/invoices-ddl-parity.test.ts`
  // pins this literal to `migrations/0001_init.sql` — the DDL
  // `packages/core/src/fees.integration.test.ts` runs.
  `CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    number TEXT NOT NULL,
    student_id TEXT NOT NULL REFERENCES students(id),
    fee_schedule_item_id TEXT REFERENCES fee_schedule_items(id),
    issue_date TEXT NOT NULL,
    due_date TEXT,
    subtotal INTEGER NOT NULL,
    discount INTEGER NOT NULL DEFAULT 0,
    extra_charges INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','partial','paid','void','overdue')),
    voided_at TEXT,
    void_reason TEXT,
    tamper_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, number)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices(student_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_due     ON invoices(due_date, status)`,

// Reconciled against `apps/gateway/migrations/0001_init.sql` (§3.4 — the two
  // runtime schema authorities must agree). This copy had drifted three ways:
  // `receipt_no` instead of `number` (which contradicts 07 §10.2 / BR-RC-01, where
  // `receipts.number = receipt_prefix + zero-pad(next_receipt_seq, 6)`), and no
  // `ledger_entry_id` at all — so a receipt written by `packages/core`'s
  // libsql dialect (the same statements the gateway vendors) could not land on a
  // self-healed tenant. A `CREATE TABLE IF NOT EXISTS` never alters an existing
  // table, so this only helps tenants provisioned from here on; the ALTERs below
  // are what repair the ones already in the wild.
  `CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    number TEXT NOT NULL,
    ledger_entry_id TEXT,
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (tenant_id, number)
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

  `CREATE TABLE IF NOT EXISTS attendance_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    session_date TEXT NOT NULL,
    topic TEXT,
    notes TEXT,
    locked_at TEXT,
    locked_by TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS attendance_records (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    status TEXT DEFAULT 'present',
    remarks TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Parity with migrations/0001_init.sql:263 (`UNIQUE (session_id,
  // student_id)`): the ORM's record upsert (`ON CONFLICT(session_id,
  // student_id) DO UPDATE`) aborts at prepare time when no matching unique
  // constraint exists — gateway attendance marking could never succeed
  // without this. A standalone idempotent index (not an inline table UNIQUE)
  // so tenant DBs created before this line still heal on next boot
  // (ensureSelfRepairingSchema runs every statement every time).
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_records_session_student ON attendance_records(session_id, student_id)`,
  `CREATE INDEX IF NOT EXISTS att_rec_student ON attendance_records (student_id, session_id)`,

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

  // RFC-004 C1 — the idempotency store. Composite PRIMARY KEY enforces the
  // contract scope tenant+route+key: the same UUID on two routes (or two
  // tenants) is two intents and can never shadow each other. `"key"` is quoted
  // (KEY is reserved in MySQL-family dialects). No UPDATE/DELETE triggers: the
  // TTL sweep (lazy delete-on-read + opportunistic purge in
  // lib/idempotency.ts) legitimately deletes expired rows.
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
    tenant_id TEXT NOT NULL,
    route TEXT NOT NULL,
    "key" TEXT NOT NULL,
    response_code INTEGER NOT NULL,
    response_body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, route, "key")
  )`,
  `CREATE INDEX IF NOT EXISTS idx_idempotency_ttl ON idempotency_keys(tenant_id, created_at)`,
];

export async function ensureSelfRepairingSchema(
  _db: DB,
  tenantId: string,
  dbUrl?: string,
  dbToken?: string,
): Promise<void> {
  if (healedTenants.has(tenantId)) return;

  // Enforce max size — evict oldest entries if over limit
  if (healedTenants.size >= HEALED_TENANTS_MAX) {
    const iter = healedTenants.values();
    for (let i = 0; i < HEALED_TENANTS_MAX / 4; i++) {
      const next = iter.next();
      if (next.done) break;
      healedTenants.delete(next.value);
    }
  }

  try {
    await batchExecute(CORE_DDL_STATEMENTS, dbUrl, dbToken);
    // `CREATE TABLE IF NOT EXISTS` cannot add columns to a table a previous
    // boot already created: tenant DBs healed before the lock columns existed
    // still lack them, and the lock route 500s on the missing column. Heal
    // those two columns idempotently (parity with migrations/0001_init.sql,
    // which carries locked_at/locked_by on attendance_sessions).
    await ensureColumn(_db, "attendance_sessions", "locked_at", "TEXT");
    await ensureColumn(_db, "attendance_sessions", "locked_by", "TEXT");
    // The receipts repair, same mechanism. `ledger_entry_id` is what
    // `packages/core`'s receipt insert names (07 §9.6 step 4), and without it a
    // payment could not be receipted on an already-healed tenant at all. The
    // `receipt_no` → `number` rename is a column RENAME, not an add, so it is
    // left to the forward-only migration rather than guessed at here.
    await ensureColumn(_db, "receipts", "ledger_entry_id", "TEXT");
    healedTenants.add(tenantId);
  } catch (err) {
    logError("schema.heal_failed", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Idempotent single-column heal for tables predating a DDL addition. Reads
 * `sqlite_master` (portable across the fixture SQLite and libSQL) and only
 * ALTERs when the column is absent — a second boot is a no-op. Confined to
 * this audited schema authority (AGENTS.md §3.4); never called from a route.
 */
async function ensureColumn(
  db: DB,
  table: string,
  column: string,
  decl: string,
): Promise<void> {
  const handle = db as unknown as SqlHandle;
  const row = await oneRow(handle, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [
    table,
  ]);
  const ddl = typeof row?.sql === "string" ? row.sql : "";
  if (ddl.toLowerCase().includes(column.toLowerCase())) return;
  await run(handle, `ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`, []);
}
