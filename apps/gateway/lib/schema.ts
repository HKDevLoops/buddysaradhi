// Implements: 11_Data_Model.md & AGENTS.md §3.4
// Self-Repairable Database Schema & Auto-Healing Manager
// Statement execution comes from lib/sql.ts (dependency-free) and `DB` is a
// type-only import, so the DDL itself stays importable by the integration
// tests that assert on it — see apps/gateway/__tests__/ledger-routes.test.ts.
import { batchExecute, oneRow, run, type SqlHandle } from "./sql.ts";
import type { DB } from "./db.ts";
import { logError } from "./log.ts";
import { withWriteTransaction, type TransactionalDb } from "./tx.ts";

const HEALED_TENANTS_MAX = 10_000;
const healedTenants = new Set<string>();

/**
 * The exact `CREATE TRIGGER` text the self-heal installs, by trigger name.
 *
 * Defined BEFORE `CORE_DDL_STATEMENTS` so the self-heal and the secure-erase
 * re-create path install BYTE-IDENTICAL guards — they cannot drift, because
 * there is only one copy of the text.
 */
const APPEND_ONLY_TRIGGER_DDL: Record<string, string> = {
  trg_ledger_no_update: `CREATE TRIGGER IF NOT EXISTS trg_ledger_no_update
   BEFORE UPDATE ON ledger_entries
   BEGIN
      SELECT RAISE(ABORT, 'P0 BUG: ledger_entries is append-only. UPDATE forbidden.');
    END`,
  trg_ledger_no_delete: `CREATE TRIGGER IF NOT EXISTS trg_ledger_no_delete
   BEFORE DELETE ON ledger_entries
   BEGIN
      SELECT RAISE(ABORT, 'P0 BUG: ledger_entries is append-only. DELETE forbidden.');
    END`,
};

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
    pin_proof TEXT,
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

  APPEND_ONLY_TRIGGER_DDL.trg_ledger_no_update,
  APPEND_ONLY_TRIGGER_DDL.trg_ledger_no_delete,

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

/**
 * The append-only guards on `ledger_entries`, as DROP and CREATE statements.
 *
 * AUD-003: the erase cascade issues `DELETE FROM ledger_entries`, which
 * `trg_ledger_no_delete` aborts - so the erase never committed and the
 * tutor's right to erasure never happened. The erase flow drops the guards
 * and re-creates them inside ONE transaction (SQLite DDL is transactional,
 * so a failed erase restores them).
 *
 * The CREATE text is the SAME literal the self-heal installs, so the guards
 * cannot drift. This lives here because `lib/schema.ts` is the audited DDL
 * authority (AGENTS.md 3.4).
 */
export const APPEND_ONLY_TRIGGERS: readonly string[] = [
  "trg_ledger_no_update",
  "trg_ledger_no_delete",
];

/**
 * Drop the append-only guards — ONLY for the audited secure-erase exception
 * (10_Security.md §18.1 LEDGER-4). The caller MUST re-create them in the
 * same transaction.
 */
export function stmtDropAppendOnlyTriggers(): string[] {
  return APPEND_ONLY_TRIGGERS.map((name) => `DROP TRIGGER IF EXISTS ${name}`);
}

/** Re-create the append-only guards after the audited secure-erase cascade. */
export function stmtCreateAppendOnlyTriggers(): string[] {
  return APPEND_ONLY_TRIGGERS.map((name) => APPEND_ONLY_TRIGGER_DDL[name] ?? "");
}

export function ensureSelfRepairingSchema(
  _db: DB,
  tenantId: string,
  dbUrl?: string,
  dbToken?: string,
): Promise<void> {
  if (healedTenants.has(tenantId)) return Promise.resolve();

  // F-06, part 2: COALESCE CONCURRENT HEALS PER TENANT.
  //
  // `healedTenants.add()` runs at the END of the heal, so two concurrent
  // first-requests for the same tenant both passed the guard above and both ran
  // the full repair. Wrapping the destructive tables in a transaction (below)
  // stops them corrupting each other, but it does not stop the wasted work or
  // the second caller blocking on a write lock it does not need.
  //
  // This mirrors the ONE pattern already proven correct in this repo —
  // `apps/web/src/server/cache.ts` `inflightLoads` — which sets the loader
  // SYNCHRONOUSLY with no intervening `await` so two callers cannot both become
  // the loader, and deletes in `finally` so a REJECTED promise is never cached
  // (caching a rejection would fail that tenant permanently).
  //
  // Keyed by tenant, so different tenants still heal in parallel — this is not a
  // global lock and must not become one.
  const inFlight = healingInFlight.get(tenantId);
  if (inFlight) return inFlight;

  // Assigned through a local first: `healingInFlight.set` must happen with NO
  // intervening `await`, or a second caller arriving in that gap becomes a
  // second loader. This is the `inflightLoads` pattern from
  // `apps/web/src/server/cache.ts`, which is the one already proven here.
  const heal = runHeal(_db, tenantId, dbUrl, dbToken);
  healingInFlight.set(tenantId, heal);
  // `finally` so a REJECTED heal is never cached — a cached rejection would
  // leave that tenant permanently unhealed for the life of the isolate.
  void heal.finally(() => {
    healingInFlight.delete(tenantId);
  });
  return heal;
}

/** In-flight heals by tenant. Bounded by HEALED_TENANTS_MAX via runHeal's
 *  eviction; entries are removed on settle, so this only ever holds tenants
 *  currently healing. */
const healingInFlight = new Map<string, Promise<void>>();

async function runHeal(
  _db: DB,
  tenantId: string,
  dbUrl?: string,
  dbToken?: string,
): Promise<void> {
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
    // BR-SEC-04 / 10_Security.md §18.1 step 1 — the destructive-erase PIN
    // PROOF. `pin_hash` is argon2id, which the Deno edge cannot evaluate
    // (WebCrypto offers PBKDF2/SHKDF; the npm argon2 package is a native addon
    // that will not bundle into an edge isolate). So the edge could check only
    // that a PIN *exists* — and a stolen session was therefore enough to destroy
    // a tutor's data. `pin_proof` closes that without needing argon2 at the
    // edge: it is an HMAC over the PIN under the tenant's own proof key, which
    // the edge CAN compute and compare in constant time.
    //
    // It is nullable on purpose, and there is NO fallback to the old presence gate:
    // a tenant with no `pin_proof` is REFUSED at the erase route with an
    // instruction to re-confirm their PIN in the app, which re-derives and writes
    // the proof on their next successful PIN change. (An earlier version of this
    // comment claimed a presence fallback existed. It never did, and believing it
    // would lead a future maintainer to think the insecure path was still live.)
    //
    // Adding the column is backwards-compatible: no existing tenant's rows are
    // rewritten and no backup is invalidated.
    await ensureColumn(_db, "settings", "pin_proof", "TEXT");
    await repairLegacyInvoicesAndReceipts(_db);
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

/**
 * `migrations/0002_canonical_invoices_receipts.sql`, applied here because this
 * module is the audited DDL authority for gateway-managed tenant databases
 * (AGENTS.md §3.4) and the forward-only file cannot be shipped to the edge on
 * its own.
 *
 * WHAT IT REPAIRS. A tenant database provisioned before the canonical money
 * grammar carries `invoices.invoice_number / period_start / period_end /
 * subtotal_paise / total_paise` as NOT NULL with no default, and a `receipts`
 * table keyed on `receipt_no` with no `number` and no `ledger_entry_id`.
 * `packages/core`'s canonical writers insert the CURRENT grammar, so on such a
 * database every payment that invoices failed with
 * `NOT NULL constraint failed: invoices.invoice_number` and no receipt could
 * ever be written at all — while `CREATE TABLE IF NOT EXISTS` could not repair
 * it, because SQLite cannot drop or relax a column.
 *
 * WHY THE PROBE IS MANDATORY. The repair reads the LEGACY column names, so it
 * can only be applied to a legacy-shaped table: on a table already canonical (or
 * freshly provisioned) it fails on the missing column. Probing first is what
 * makes it safe to run on every boot of every tenant, which is exactly the
 * population that needs it — a new tenant is already canonical and must not be
 * handed this. `packages/core/src/migration0002.test.ts` pins both halves: the
 * repair works on a legacy shape, and re-applying it to a canonical table
 * REFUSES rather than silently rewriting money.
 */
const LEGACY_INVOICES_REPAIR: string[] = [
  `DROP TABLE IF EXISTS invoices_canonical`,
  `CREATE TABLE invoices_canonical (
     id TEXT PRIMARY KEY,
     tenant_id TEXT NOT NULL,
     number TEXT NOT NULL,
     student_id TEXT NOT NULL,
     fee_schedule_item_id TEXT,
     issue_date TEXT NOT NULL,
     due_date TEXT,
     subtotal INTEGER NOT NULL,
     discount INTEGER NOT NULL DEFAULT 0,
     extra_charges INTEGER NOT NULL DEFAULT 0,
     total INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'unpaid'
       CHECK(status IN ('unpaid','partial','paid','void','overdue')),
     voided_at TEXT,
     void_reason TEXT,
     tamper_hash TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE(tenant_id, number)
   )`,
  // Integer money throughout (Rule 6): the legacy NOT NULL columns are the
  // authoritative amount, folded into the canonical ones rather than discarded.
  // 'issued' is not in the canonical CHECK, so the legacy vocabulary is mapped.
  // tamper_hash gets an explicit `unverified-legacy:` placeholder rather than a
  // plausible-looking value that could read as a passed verification.
  `INSERT INTO invoices_canonical (
     id, tenant_id, number, student_id, fee_schedule_item_id, issue_date, due_date,
     subtotal, discount, extra_charges, total, status, voided_at, void_reason,
     tamper_hash, created_at, updated_at
   )
   SELECT
     id, tenant_id,
     CASE WHEN invoice_number IS NULL OR invoice_number = ''
          THEN 'INV-LEGACY-' || id ELSE invoice_number END,
     student_id, NULL,
     CASE WHEN period_start IS NULL OR period_start = ''
          THEN created_at ELSE period_start END,
     due_date,
     COALESCE(subtotal_paise, 0),
     COALESCE(discount_paise, 0),
     COALESCE(tax_paise, 0),
     COALESCE(total_paise, subtotal_paise, 0),
     CASE status
       WHEN 'issued'  THEN 'unpaid'
       WHEN 'pending' THEN 'unpaid'
       WHEN 'settled' THEN 'paid'
       ELSE COALESCE(status, 'unpaid')
     END,
     voided_at, NULL, 'unverified-legacy:' || id, created_at, updated_at
   FROM invoices`,
  `DROP TABLE invoices`,
  `ALTER TABLE invoices_canonical RENAME TO invoices`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices(student_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_due     ON invoices(due_date, status)`,
];

const LEGACY_RECEIPTS_REPAIR: string[] = [
  `DROP TABLE IF EXISTS receipts_canonical`,
  `CREATE TABLE receipts_canonical (
     id TEXT PRIMARY KEY,
     tenant_id TEXT NOT NULL,
     number TEXT NOT NULL,
     ledger_entry_id TEXT,
     student_id TEXT NOT NULL,
     invoice_id TEXT,
     amount INTEGER NOT NULL,
     payment_method TEXT NOT NULL DEFAULT 'manual',
     payment_ref TEXT,
     received_on TEXT NOT NULL,
     tamper_hash TEXT,
     voided_at TEXT,
     pdf_blob_key TEXT,
     deleted_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE(tenant_id, number)
   )`,
  // ledger_entry_id stays NULL: the legacy shape had no back-link and inventing
  // one would fabricate an audit trail. Receipts MINTED after this repair always
  // carry it — `recordPaymentFlow` supplies it (07 §9.6 step 4).
  `INSERT INTO receipts_canonical (
     id, tenant_id, number, ledger_entry_id, student_id, invoice_id, amount,
     payment_method, payment_ref, received_on, tamper_hash, voided_at,
     pdf_blob_key, deleted_at, created_at, updated_at
   )
   SELECT
     id, tenant_id,
     CASE WHEN receipt_no IS NULL OR receipt_no = ''
          THEN 'RCP-LEGACY-' || id ELSE receipt_no END,
     NULL, student_id, invoice_id, amount,
     COALESCE(payment_method, 'manual'), payment_ref, received_on,
     COALESCE(tamper_hash, 'unverified-legacy:' || id),
     voided_at, pdf_blob_key, deleted_at, created_at, updated_at
   FROM receipts`,
  `DROP TABLE receipts`,
  `ALTER TABLE receipts_canonical RENAME TO receipts`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_student ON receipts(student_id, received_on)`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_ledger  ON receipts(ledger_entry_id)`,
];

/** True when `table` still carries `marker` — the probe that gates the repair. */
async function hasColumn(db: DB, table: string, marker: string): Promise<boolean> {
  const handle = db as unknown as SqlHandle;
  const row = await oneRow(handle, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [
    table,
  ]);
  const ddl = typeof row?.sql === "string" ? row.sql.toLowerCase() : "";
  return ddl.includes(marker.toLowerCase());
}

async function repairLegacyInvoicesAndReceipts(db: DB): Promise<void> {
  const handle = db as unknown as SqlHandle;
  // Each table is probed independently: a tenant could be legacy on one and
  // canonical on the other, and repairing only the legacy one is exactly right.
  //
  // F-06: BOTH ARRAYS NOW RUN INSIDE ONE TRANSACTION.
  //
  // These repair scripts are destructive by construction — they DROP the legacy
  // table and RENAME a rebuilt copy over it. Run unbatched, two concurrent
  // heals of the SAME tenant (two cold-isolate first-requests, which is the
  // normal case on an edge) interleave into total data loss:
  //
  //   A: DROP invoices_canonical -> CREATE -> INSERT (rows copied)
  //   B:                       -> DROP invoices_canonical  <- A's only copy
  //      B: CREATE (EMPTY)     -> DROP invoices            <- legacy gone
  //   A: ALTER ... RENAME      -> fails, table absent
  //
  // Both throw, the catch above logs `schema.heal_failed`, `healedTenants` never
  // records the tenant, and the NEXT request's `CORE_DDL_STATEMENTS` recreates an
  // EMPTY `invoices` table. Every invoice for that tutor is gone with no
  // `reconcileLedger` or `tamper_hash` evidence left to detect it.
  //
  // One transaction per table closes it: B's DROP/CREATE now blocks behind A's
  // open write transaction, so B cannot interleave into A's rebuild. The rename
  // is atomic with the drop, so a failure anywhere rolls the whole repair back
  // and leaves the legacy table intact for the next attempt — which is the
  // property an unbatched sequence could never offer.
  //
  // Invoices and receipts stay in SEPARATE transactions on purpose. They are
  // independent tables, and a shared transaction would hold a write lock across
  // both rebuilds for no correctness gain.
  // SAFETY: `ensureSelfRepairingSchema` receives the gateway's libsql `Client`,
  // which satisfies `TransactionalDb` structurally — `Client.transaction("write")`
  // is exactly what the gateways' ledger routes already use via
  // `withWriteTransaction` (routes/ledger.ts, routes/students.ts). `handle` is
  // widened only to satisfy the declared parameter type; the value is the same
  // client object. If a caller ever passed a handle without `.transaction`, the
  // heal would throw here and be caught by `schema.heal_failed` — fail-closed,
  // never a silent skip.
  const txDb = handle as unknown as TransactionalDb;

  if (await hasColumn(db, "invoices", "invoice_number")) {
    await withWriteTransaction(txDb, async (tx) => {
      for (const stmt of LEGACY_INVOICES_REPAIR) await run(tx, stmt, []);
    });
  }
  if (await hasColumn(db, "receipts", "receipt_no")) {
    await withWriteTransaction(txDb, async (tx) => {
      for (const stmt of LEGACY_RECEIPTS_REPAIR) await run(tx, stmt, []);
    });
  }
}
