-- 0002_canonical_invoices_receipts.sql
--
-- FORWARD-ONLY. Never edit 0001 (AGENTS.md §3.4 / AP-8).
--
-- WHY THIS EXISTS — the money engine could not write a single row on any
-- tenant database provisioned before this migration.
--
-- `packages/core`'s canonical writers (AGENTS.md §3.5: the money logic lives
-- EXACTLY ONCE, in `feesFlow.ts`, with a libsql and an ORM dialect that the
-- parity gate holds identical) write the CURRENT grammar:
--
--   invoices: (id, tenant_id, number, student_id, issue_date, due_date,
--              subtotal, discount, extra_charges, total, status, tamper_hash,
--              voided_at, created_at, updated_at)
--   receipts: (id, tenant_id, number, ledger_entry_id, student_id, invoice_id,
--              amount, payment_method, payment_ref, received_on, tamper_hash,
--              voided_at, pdf_blob_key, created_at, updated_at)
--
-- Every tenant database created before this migration carries an OLDER grammar
-- whose columns are NOT NULL **with no default**:
--
--   invoices.invoice_number / period_start / period_end / subtotal_paise /
--            total_paise      NOT NULL, no default
--   receipts.receipt_no                       NOT NULL, no `number`,
--                                             no `ledger_entry_id`
--
-- `CREATE TABLE IF NOT EXISTS` cannot drop, relax or rename a column, so the
-- self-heal in `apps/gateway/lib/schema.ts` could never repair them, and the
-- observed production symptom was a hard, fail-closed refusal:
--
--   Not saved. SQLITE_CONSTRAINT: SQLite error: NOT NULL constraint failed:
--   invoices.invoice_number. Nothing was written.
--
-- The failure is at least HONEST — the transaction rolls back whole (Rule 7),
-- so no half-written payment ever reached a ledger. But the feature is simply
-- unavailable: a tutor with a month of dues could not record a payment at all,
-- and `receipts` could never gain a row, so `next_receipt_seq` was never
-- consumed and no receipt existed to show (07 §9.6 step 4/7, BR-RC-01).
--
-- WHAT IT DOES. SQLite cannot ALTER a column, so each table is rebuilt by the
-- standard procedure — new table, copy, drop, rename, recreate the indexes.
-- Rows are PRESERVED, including their `id` values, so every
-- `ledger_entries.invoice_id` and `receipts.ledger_entry_id` reference keeps
-- pointing at the same row.
--
-- APPLY ONLY TO A LEGACY-SHAPE TABLE, and check before applying:
--
--   SELECT name FROM pragma_table_info('invoices')  WHERE name = 'invoice_number';
--   SELECT name FROM pragma_table_info('receipts') WHERE name = 'receipt_no';
--
-- A row is non-empty if either returns a row. This file is a REPAIR for the
-- legacy grammar, so it is deliberately written to read ONLY the legacy column
-- names — those are the ones guaranteed present on such a table. It cannot be
-- made shape-agnostic, because the canonical grammar has no `invoice_number` at
-- all and SQLite rejects a statement that names a column the table does not
-- have, even inside a COALESCE. A database already on the canonical grammar
-- needs no repair and must not be handed this file.
-- `apps/gateway/lib/schema.ts` `ensureSelfRepairingSchema` performs exactly
-- this probe before applying DDL (AGENTS.md §3.4 — two runtime authorities, and
-- this file belongs to the migration side of that pair).
--
-- Because it reads only the legacy columns, a row that happened to carry a
-- canonical value ALONGSIDE its legacy one has that canonical value superseded.
-- That is the correct precedence: on such a row the legacy columns are NOT NULL,
-- so they are the authoritative record, and `tamper_hash` — which the legacy
-- shape never had — is written as an explicit `unverified-legacy:` placeholder
-- rather than a plausible-looking value that could read as a passed check.
--
-- Integrity first: the append-only triggers on `ledger_entries` are untouched
-- (Rule 1), and no ledger row is written, updated or deleted here. This is a
-- schema repair, not a data edit.

-- ---------------------------------------------------------------------------
-- 1. invoices -> canonical grammar
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS invoices_canonical;

CREATE TABLE invoices_canonical (
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
  status                 TEXT NOT NULL DEFAULT 'unpaid'
                           CHECK(status IN ('unpaid','partial','paid','void','overdue')),
  voided_at              TEXT,
  void_reason            TEXT,
  tamper_hash            TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  UNIQUE(tenant_id, number)
);

-- 'issued' is not in the canonical CHECK (which knows 'unpaid'), so the legacy
-- vocabulary is mapped rather than carried across and rejected on insert.
INSERT INTO invoices_canonical (
  id, tenant_id, number, student_id, fee_schedule_item_id, issue_date, due_date,
  subtotal, discount, extra_charges, total, status, voided_at, void_reason,
  tamper_hash, created_at, updated_at
)
SELECT
  id,
  tenant_id,
  CASE WHEN invoice_number IS NULL OR invoice_number = ''
       THEN 'INV-LEGACY-' || id ELSE invoice_number END,
  student_id,
  NULL,
  CASE WHEN period_start IS NULL OR period_start = ''
       THEN created_at ELSE period_start END,
  due_date,
  -- Integer money throughout (Rule 6). COALESCE means a row whose legacy
  -- amount is present keeps it exactly, instead of silently becoming zero.
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
  voided_at,
  NULL,
  'unverified-legacy:' || id,
  created_at,
  updated_at
FROM invoices;

DROP TABLE invoices;
ALTER TABLE invoices_canonical RENAME TO invoices;

CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices(student_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_due     ON invoices(due_date, status);

-- ---------------------------------------------------------------------------
-- 2. receipts -> canonical grammar
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS receipts_canonical;

CREATE TABLE receipts_canonical (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  number          TEXT NOT NULL,
  ledger_entry_id TEXT REFERENCES ledger_entries(id),
  student_id      TEXT NOT NULL,
  invoice_id      TEXT,
  amount          INTEGER NOT NULL,
  payment_method  TEXT NOT NULL DEFAULT 'manual',
  payment_ref     TEXT,
  received_on     TEXT NOT NULL,
  tamper_hash     TEXT,
  voided_at       TEXT,
  pdf_blob_key    TEXT,
  deleted_at      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(tenant_id, number)
);

-- `ledger_entry_id` is NULL: the legacy shape had no back-link, and inventing
-- one would fabricate an audit trail. 07 §9.6 requires the link for receipts
-- MINTED AFTER this migration, and `recordPaymentFlow` always supplies it.
INSERT INTO receipts_canonical (
  id, tenant_id, number, ledger_entry_id, student_id, invoice_id, amount,
  payment_method, payment_ref, received_on, tamper_hash, voided_at,
  pdf_blob_key, deleted_at, created_at, updated_at
)
SELECT
  id,
  tenant_id,
  CASE WHEN receipt_no IS NULL OR receipt_no = ''
       THEN 'RCP-LEGACY-' || id ELSE receipt_no END,
  NULL,
  student_id,
  invoice_id,
  amount,
  COALESCE(payment_method, 'manual'),
  payment_ref,
  received_on,
  COALESCE(tamper_hash, 'unverified-legacy:' || id),
  voided_at,
  pdf_blob_key,
  deleted_at,
  created_at,
  updated_at
FROM receipts;

DROP TABLE receipts;
ALTER TABLE receipts_canonical RENAME TO receipts;

CREATE INDEX IF NOT EXISTS idx_receipts_student ON receipts(student_id, received_on);
CREATE INDEX IF NOT EXISTS idx_receipts_ledger  ON receipts(ledger_entry_id);