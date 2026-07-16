# 11 — Data Model

> **The schema bible of Buddysaradhi.** Every Turso per-user database conforms to this contract. Money is integer paise. IDs are UUID v7 (time-sortable). The ledger is append-only, hash-chained, and trigger-guarded. This file is the source of truth cited by `02_Core_Logic.md` (algorithms), `12_Business_Rules.md` (BR-* IDs), `10_Security.md` (crypto), and `14_Edge_Cases.md`.
>
> **Schema-as-code.** The canonical schema lives in `prisma/schema.prisma`. Migrations are produced and applied by `prisma migrate dev --name <desc>` (dev) / `prisma migrate deploy` (CI) / `bun run db:push` (sandbox). The DDL blocks below (§4 entity tables, §10 triggers, §11 migration SQL) are the **logical equivalent** of the Prisma schema, kept here so reviewers can verify trigger logic + column types without leaving the spec. No raw DDL runs at runtime — all DB access is via `import { db } from '@/lib/db'` using Prisma ORM methods (`findMany`, `create`, `aggregate`, `$transaction`, etc.). The only exceptions are SQLite admin commands with no ORM equivalent (`PRAGMA key`, `PRAGMA wal_checkpoint`, `PRAGMA foreign_keys=ON`); these run once at DB init or backup-verify time inside `lib/db/admin.ts`.

---

## 1. Design Principles

Eight non-negotiable principles shape the schema.

**P-DM1 — One database per tutor.** Each user gets their own libSQL/Turso DB (`buddysaradhi-{user_uuid}`). `tenant_id` on every table is constant within a DB — **defence-in-depth**, not a multi-tenancy sharding key.

**P-DM2 — Money is integer paise.** Every monetary column is `INTEGER` minor units (paise for INR, cents for USD/EUR/GBP, fils for AED). 1 rupee = 100 paise = `INTEGER 100`. No `REAL`, no float on the currency path. See §6.

**P-DM3 — The ledger is append-only and hash-chained.** `ledger_entries` accepts `INSERT` only; `UPDATE`/`DELETE` aborted by triggers (§10). Corrections are new `type='VOID'` rows referencing the original via `void_of_id`. Each row carries `this_hash = sha256(prev_hash || payload || created_at)`, a tamper-evident chain rooted in the tenant secret. See §8.

**P-DM4 — Soft-delete for entities, hard-block for the ledger.** Non-financial tables carry `archived_at TEXT`; never hard-deleted in v1. Justification: **reversibility + audit**. The ledger has **no soft-delete column** — append-only IS the soft-delete; a `VOID` row is the deletion, itself immutable. `audit_log` follows the same rule.

**P-DM5 — Denormalise only for read-path performance.** Most tables are 3NF. Three intentional denormalisations: `ledger_entries.balance_after_paise`, `invoices.tamper_hash`, `students.code`. Every other redundancy is a bug.

**P-DM6 — No NULL where a boolean suffices.** Binary columns are `INTEGER NOT NULL DEFAULT 0 CHECK(x IN (0,1))`. NULL is reserved for genuine "unknown." A nullable boolean is three states — Zod cannot distinguish "false" from "unset."

**P-DM7 — Store UTC, display local.** Timestamps are ISO-8601 UTC. Business dates (`session_date`, `occurred_on`, `due_date`) are ISO date only — no time component — so timezone drift cannot move a payment across a month boundary. See `14_Edge_Cases.md` EC-D-02, EC-D-04.

**P-DM8 — Forward-only migrations, never destructive in v1.x.** Additive only: new columns default to non-NULL constants, new tables are `IF NOT EXISTS`, `ALTER TABLE … DROP COLUMN` forbidden until v2. See §11.

---

## 2. Entity-Relationship Diagram

```
                  ┌──────────┐
                  │ settings │ (singleton — tenant profile, sequences, locks)
                  └────┬─────┘
                       │ 1
         ┌─────────────┼──────────────┐
         │             │              │
    ┌────▼────┐  ┌─────▼─────┐  ┌────▼────┐
    │ batches │  │  tutors   │  │  tags   │
    └────┬────┘  └─────┬─────┘  └────┬────┘
         │ 1           │ 1           │ 1
         │             │         ┌───┘ N:M (student_tags)
         │             │         │
    ┌────▼──────────┐  │      ┌──▼──────────┐
    │ attendance_   │  │      │  students   │──┬────────┐
    │   sessions    │  │      └──┬──────────┘  │        │
    └────┬──────────┘  │         │ 1           │ 1      │ 1
         │ 1:N         │         ├─┐           │        │
    ┌────▼──────────┐  │         │ │      ┌────▼────┐ ┌─▼─────────┐
    │ attendance_   │  │  ┌──────┘ │      │guardians│ │ student_  │
    │   records     │◄─┘  │        │      └─────────┘ │  notes    │
    └───────────────┘     │        │                  └───────────┘
         N:M via enroll   │        │
         ┌────────────────┘        │
         │  ┌──────────────────────┘
         │  │
    ┌────▼──────┐      ┌──────────────────┐
    │ fee_plans │─────►│ fee_schedule_    │
    └────┬──────┘  1:N │   items          │
         │ 1           └──────┬───────────┘
         │ 1:1 (opt)          │
    ┌────▼─────────┐  ┌───────▼──────────┐
    │   invoices   │◄─┤  ledger_entries  │═══► receipts (1:1 with
    └──────────────┘ N:1 │ (append-only,   │     PAYMENT_RECEIVED)
                          │  hash-chained)  │
                          └──────┬───────────┘
                                 │ self-ref (void_of_id)
                          ┌──────▼──────┐
                          │   receipts  │
                          └─────────────┘

   ┌────────────┐  ┌────────────┐  ┌─────────────┐  ┌──────────────┐
   │ reminders  │  │ audit_log  │  │ sync_outbox │  │backup_manifest│
   └────────────┘  │ (append-   │  │ (transient) │  └──────────────┘
                   │  only)     │  └─────────────┘
                   └────────────┘
   ┌───────────────┐  ┌──────────────┐
   │ notifications │  │  app_state   │ (singleton)
   │  (FIFO ≤200)  │  └──────────────┘
   └───────────────┘
```

**Cardinality legend.** `1:N` one-to-many; `N:M` many-to-many via junction; `1:1` one-to-one (rare); self-ref for `ledger_entries.void_of_id`.

---

## 3. Conventions Reference

| Convention | Rule |
|------------|------|
| ID type | `TEXT` UUID v7 — time-sortable, conflict-free offline |
| Timestamps / dates | ISO-8601 UTC / ISO date (P-DM7) |
| Money | `INTEGER` paise — never `REAL` (P-DM2; BR-M-01) |
| Soft delete | `archived_at IS NOT NULL`; ledger has none (P-DM4) |
| Tenant guard | `tenant_id TEXT NOT NULL` on every table (P-DM1) |
| Bool | `INTEGER NOT NULL DEFAULT 0 CHECK(x IN (0,1))` (P-DM6) |
| Enums | `TEXT NOT NULL` + `CHECK`; mirrored to Zod |
| Indexes | Every FK + every list-view filter column |
| FKs | enforced by Prisma schema relations + SQLite `PRAGMA foreign_keys = ON;` once at connection init (admin-only, `lib/db/admin.ts`) |
| JSON | `TEXT` validated JSON; Zod-parsed on read |

---

## 4. Per-Entity Schema

For each entity: DDL (SQLite types only, mirroring `prisma/schema.prisma`), purpose, lifecycle, and invariants. All `CREATE TABLE` statements are idempotent (`IF NOT EXISTS`) and applied by `prisma migrate deploy` against the generated `prisma/migrations/<timestamp>_<name>/migration.sql`. **Schema DDL never runs at runtime** — every runtime DB call uses Prisma ORM methods (`db.student.findMany()`, `db.ledgerEntry.create()`, etc.).

### 4.1 `settings` (singleton)

```sql
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
  pin_hash                TEXT,                          -- argon2id; NULL if unset
  backup_passphrase_hash  TEXT,                          -- hash; never the key
  tenant_secret           TEXT NOT NULL,                 -- 32-byte hex pepper
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);
```

**Purpose / Invariants.** Configures a tenant: identity, currency/locale, sequence counters, security toggles, `tenant_secret` pepper. Created at provisioning. Currency locks after first `FEE_CHARGED` (BR-M-02). `tenant_secret` never exported.

### 4.2 `tutors` (multi-tutor coaching institutes)

```sql
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
```

**Purpose / Invariants.** One row (the owner) in single-tutor deployments; multiple rows in coaching institutes. `batches.tutor_id` references it. `role='owner'` unique per tenant; tutors with active batches cannot be deactivated.

### 4.3 `batches`

```sql
CREATE TABLE IF NOT EXISTS batches (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  tutor_id     TEXT REFERENCES tutors(id),
  name         TEXT NOT NULL,
  subject      TEXT,
  schedule     TEXT,                  -- JSON { days, time, duration_min }
  archived_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_batches_tenant ON batches(tenant_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_batches_tutor  ON batches(tutor_id, archived_at);
```

**Purpose / Invariants.** A teaching unit ("Class 10 — Maths — 6pm"). Attendance and fee plans attach to a batch. Lifecycle: created → active → archived. A batch with active enrollments cannot be archived.

### 4.4 `students`

```sql
CREATE TABLE IF NOT EXISTS students (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  code            TEXT,                       -- "STU-0001"; auto-assigned (BR-STU-04)
  first_name      TEXT NOT NULL,
  last_name       TEXT,
  dob             TEXT,                       -- ISO date; NULL = unknown
  gender          TEXT CHECK(gender IN ('M','F','O') OR gender IS NULL),
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  school          TEXT,
  grade           TEXT,
  board           TEXT,                       -- CBSE/ICSE/State/IB
  admission_date  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK(status IN ('active','inactive','graduated','archived')),
  fee_model       TEXT NOT NULL DEFAULT 'postpaid'
                  CHECK(fee_model IN ('postpaid','prepaid','mixed')),
  monthly_fee_paise INTEGER,                  -- denormalised cache of current rate (§4.4a); NULL = no fee set
  fee_frequency   TEXT NOT NULL DEFAULT 'monthly'
                  CHECK(fee_frequency IN ('monthly','quarterly','annual')),  -- how the student pays
  dup_key         TEXT NOT NULL,              -- BR-STU-02 dup key
  merged_into_id  TEXT REFERENCES students(id),
  custom_fields   TEXT,                       -- JSON; Zod-validated on read
  notes           TEXT,
  archived_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_students_tenant_status ON students(tenant_id, status, archived_at);
CREATE INDEX IF NOT EXISTS idx_students_name          ON students(tenant_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_students_dup           ON students(tenant_id, dup_key);
```

**Purpose / Invariants.** The student master record. Status transitions per BR-STU-01: `active ⇄ inactive → graduated → archived` (restorable). Graduated/archived students' ledgers frozen (EC-S-05). `dup_key` recomputed on insert + name/phone change (BR-STU-02); `merged_into_id` set on merge (EC-S-02).

**Monthly-fee cache.** `monthly_fee_paise` + `fee_frequency` are **denormalised caches** of the current row in `student_fee_rates` (§4.4a). They exist so list views (Students, Fees, Dashboard) can render the fee in O(1) without a join. The source of truth is `student_fee_rates`; the cache is updated in the same `$transaction` as any fee-rate change (BR-FEE-21). `fee_frequency` determines the *billing cycle*: `monthly` → 1 charge/cycle, `quarterly` → 1 charge per 3 months (= 3× monthly), `annual` → 1 charge per 12 months (= 12× monthly). The **monthly equivalent** (`monthly_fee_paise`) is always the base unit; quarterly and annual amounts are pure derivations (BR-FEE-20).

### 4.4a `student_fee_rates` (effective-dated fee history — THE monthly-fee source of truth)

```sql
CREATE TABLE IF NOT EXISTS student_fee_rates (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  student_id        TEXT NOT NULL REFERENCES students(id),
  monthly_fee_paise INTEGER NOT NULL CHECK(monthly_fee_paise >= 0),  -- the base monthly amount, paise
  frequency         TEXT NOT NULL DEFAULT 'monthly'
                    CHECK(frequency IN ('monthly','quarterly','annual')),
  effective_from    TEXT NOT NULL,    -- ISO date; first-of-month by default (BR-FEE-22)
  effective_to      TEXT,             -- NULL = current rate; set when superseded
  reason            TEXT,             -- "Annual revision", "Sibling discount", "Batch change"
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  CHECK(effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_fee_rates_student ON student_fee_rates(student_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_fee_rates_current ON student_fee_rates(student_id) WHERE effective_to IS NULL;
```

**Purpose / Invariants.** The **append-only** history of a student's monthly fee over time. A student's fee changes (annual revision, sibling discount, batch change) are recorded as a **new row** with `effective_from`; the prior row's `effective_to` is set to the day before. Exactly one row per student has `effective_to IS NULL` at any moment (the "current rate"); enforced by a partial unique index `idx_fee_rates_current`. This table is what makes `expectedForMonth(student, pastMonth)` exact — historical calculations use the rate that was effective *on that month*, not today's rate (BR-FEE-20, BR-CALC-09).

**Why a separate table, not just a column on `students`?** Because the fee changes over time and every prior month's "expected" must be computed against the fee that was in effect then. A single `monthly_fee_paise` column on `students` would silently apply today's fee to last January — producing wrong arrears. The effective-dated history is the only honest model. The `students.monthly_fee_paise` cache is a *read optimisation*; it is always re-derivable from the latest row here.

**Lifecycle.** Created on enrolment (the first rate). Superseded on fee change (a new row; the old row's `effective_to` is set). Never deleted — even if a student is archived, the history is retained for audit (the ledger charges that were computed from a past rate must remain explainable). Secure-erase (`10_Security.md` §18) deletes this table alongside `students`.

**Relationship to `fee_plans` (§4.11).** `student_fee_rates` is the **primary, simple interface** — "Riya pays ₹1,500/month." The `FeeRateEngine` (§02_Core_Logic §6.9) auto-creates/updates a `fee_plans` row from each rate: `cycle = frequency`, `base_amount = monthly_fee_paise × cycle_multiplier` (monthly→1, quarterly→3, annual→12). The existing `fee_plans` + `fee_schedule_items` machinery (BR-FEE-06..19) continues to handle complex cases (ad-hoc extras, one-time charges, custom cycles, instalment splits). The two layers compose: the monthly fee is the *base rent*; fee_plans are the *schedule* generated from it.

### 4.5 `guardians`

```sql
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
```

**Purpose / Invariants.** Parents/guardians for siblings detection (BR-STU-03) and receipt delivery. At most one `is_primary=1` per student, enforced by partial unique index `WHERE is_primary=1`.

### 4.6 `student_enrollments` (student ⇄ batch junction)

```sql
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
```

**Purpose / Invariants.** Time-bounded membership of a student in a batch (EC-S-04). Re-enrolling after exit creates a new row. A student cannot have two active enrollments in the same batch.

### 4.7 `tags` + `student_tags`

```sql
CREATE TABLE IF NOT EXISTS tags (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  color       TEXT,                  -- hex token
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(tenant_id, name)
);
CREATE TABLE IF NOT EXISTS student_tags (
  student_id  TEXT NOT NULL REFERENCES students(id),
  tag_id      TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY(student_id, tag_id)
);
```

**Purpose / Invariants.** Free-form labelling. Sibling tag auto-applied when two students share a primary guardian phone (BR-STU-03). Tag deletion cascades. Three seeded at provisioning (§17).

### 4.8 `student_notes`

```sql
CREATE TABLE IF NOT EXISTS student_notes (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  student_id   TEXT NOT NULL REFERENCES students(id),
  category     TEXT NOT NULL CHECK(category IN ('academic','payment','attendance','general')),
  body         TEXT NOT NULL,
  pinned       INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  created_by   TEXT,                         -- tutor_id or NULL
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_student ON student_notes(student_id, created_at DESC);
```

**Purpose.** Free-text annotations on the Students drawer. Editable until 7 days, then immutable. Pinned notes appear at top of timeline.

### 4.9 `student_documents`

```sql
CREATE TABLE IF NOT EXISTS student_documents (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  student_id   TEXT NOT NULL REFERENCES students(id),
  label        TEXT NOT NULL,                 -- "Report Card Q1"
  blob_key     TEXT NOT NULL,                 -- local file path
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  uploaded_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_student ON student_documents(student_id);
```

**Purpose / Invariants.** Optional attachments (report cards, ID copies). On-device; not synced to Turso in v1. `sha256` verified on read.

### 4.10 `attendance_sessions` + `attendance_records`

```sql
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  batch_id      TEXT NOT NULL REFERENCES batches(id),
  session_date  TEXT NOT NULL,                -- ISO date
  started_at    TEXT,
  locked_at     TEXT,                         -- editable when NULL
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
```

**Purpose / Invariants.** One session per `(batch, date)` (BR-ATT-01); one record per `(session, student)` (BR-ATT-02). Editable while `locked_at IS NULL`; auto-locks after `attendance_lock_hours` (48h). Unlock requires PIN (BR-SEC-02). Hard-locked after 30 days (BR-ATT-07). Holiday sessions have zero records (BR-ATT-04).

### 4.11 `fee_plans` + `fee_schedule_items`

```sql
CREATE TABLE IF NOT EXISTS fee_plans (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  student_id     TEXT NOT NULL REFERENCES students(id),
  batch_id       TEXT REFERENCES batches(id),
  model          TEXT NOT NULL CHECK(model IN ('postpaid','prepaid','mixed')),
  cycle          TEXT NOT NULL CHECK(cycle IN ('monthly','quarterly','half_yearly','annual','one_time','custom')),
  base_amount    INTEGER NOT NULL,            -- paise per cycle
  start_date     TEXT NOT NULL,
  end_date       TEXT,                        -- NULL = open-ended
  discount_type  TEXT CHECK(discount_type IN ('fixed','percent') OR discount_type IS NULL),
  discount_value INTEGER,                     -- paise or bps
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
  label         TEXT NOT NULL,                -- "August 2025 Tuition"
  due_date      TEXT NOT NULL,
  amount        INTEGER NOT NULL,             -- paise, post-discount
  status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','invoiced','paid','partial','overdue','void')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_due   ON fee_schedule_items(due_date, status);
CREATE INDEX IF NOT EXISTS idx_items_plan  ON fee_schedule_items(fee_plan_id, status);
```

**Purpose / Invariants.** `fee_plans` is the contract; `fee_schedule_items` are instalments materialised by BR-FEE-03. Items transition `pending → invoiced → paid` (or `overdue`). Editing a plan diffs items — never deletes; marks removed ones `void`. `amount` post-discount (BR-FEE-06).

### 4.12 `invoices`

```sql
CREATE TABLE IF NOT EXISTS invoices (
  id                     TEXT PRIMARY KEY,
  tenant_id              TEXT NOT NULL,
  number                 TEXT NOT NULL,       -- "INV-000017"
  student_id             TEXT NOT NULL REFERENCES students(id),
  fee_schedule_item_id   TEXT REFERENCES fee_schedule_items(id),
  issue_date             TEXT NOT NULL,
  due_date               TEXT,
  subtotal               INTEGER NOT NULL,    -- paise
  discount               INTEGER NOT NULL DEFAULT 0,
  extra_charges          INTEGER NOT NULL DEFAULT 0,
  total                  INTEGER NOT NULL,    -- computed
  status                 TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','partial','paid','void','overdue')),
  voided_at              TEXT,
  void_reason            TEXT,
  tamper_hash            TEXT NOT NULL,       -- sha256(number||student_id||total||issue_date||tenant_secret)
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  UNIQUE(tenant_id, number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices(student_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_due     ON invoices(due_date, status);
```

**Purpose / Invariants.** A formal demand for payment (BR-FEE-04). Carries the tamper hash (BR-FEE-05). Status flow: `unpaid → partial → paid`; `unpaid/partial → void` (PIN); `unpaid → overdue` when `due_date < today`. `total` is CHECK-constrained (§10). `number` is unique and never reused.

### 4.13 `ledger_entries` — THE SPINE

```sql
CREATE TABLE IF NOT EXISTS ledger_entries (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  student_id           TEXT NOT NULL REFERENCES students(id),
  batch_id             TEXT REFERENCES batches(id),
  invoice_id           TEXT REFERENCES invoices(id),
  type                 TEXT NOT NULL CHECK(type IN ('FEE_CHARGED','PAYMENT_RECEIVED','DISCOUNT_GRANTED','REFUND_ISSUED','ADJUSTMENT','WRITEOFF','VOID')),
  debit_paise          INTEGER NOT NULL DEFAULT 0 CHECK(debit_paise  >= 0),
  credit_paise         INTEGER NOT NULL DEFAULT 0 CHECK(credit_paise >= 0),
  balance_after_paise  INTEGER NOT NULL,             -- running balance
  description          TEXT,
  receipt_no           TEXT,                          -- denormalised from receipts.number
  payment_method       TEXT CHECK(payment_method IN ('cash','upi','card','bank','cheque','other') OR payment_method IS NULL),
  payment_ref          TEXT,                          -- UTR / cheque no.
  prev_hash            TEXT,                          -- prior row hash
  this_hash            TEXT NOT NULL,                 -- sha256(prev_hash||payload||created_at)
  void_of_id           TEXT REFERENCES ledger_entries(id),
  locked_at            TEXT,                          -- past editable window
  occurred_on          TEXT NOT NULL,                 -- business date
  source               TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','import','auto','sync')),
  device_id            TEXT,
  created_by           TEXT,                          -- tutor_id
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(NOT (debit_paise > 0 AND credit_paise > 0)),  -- mutually exclusive
  CHECK(debit_paise + credit_paise > 0)               -- never a zero-row
);
CREATE INDEX IF NOT EXISTS idx_ledger_student   ON ledger_entries(student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_invoice   ON ledger_entries(invoice_id);
CREATE INDEX IF NOT EXISTS idx_ledger_type      ON ledger_entries(tenant_id, type, occurred_on);
CREATE INDEX IF NOT EXISTS idx_ledger_receipt   ON ledger_entries(receipt_no);
CREATE INDEX IF NOT EXISTS idx_ledger_hash      ON ledger_entries(this_hash);
CREATE INDEX IF NOT EXISTS idx_ledger_void_of   ON ledger_entries(void_of_id);
```

**Purpose / Invariants.** Every financial event is one row; every balance is a sum of rows; every correction is a new row. Append-only (§5). `debit_paise`/`credit_paise` mutually exclusive. `balance_after_paise` materialised by trigger. `this_hash` chains to `prev_hash`. `void_of_id` must point to a non-voided, non-locked entry. Deep dive in §8.

> **v1.0 → v1.1.** v1.0 used `amount` + `direction` (`'charge'`/`'credit'`); v1.1 normalises to `debit_paise`/`credit_paise` and adds the hash chain, `balance_after_paise`, `void_of_id`, `locked_at` (migration `0007_ledger_hash_chain.sql`, §11). Read `direction='charge'` in `12_Business_Rules.md` as `debit_paise > 0`.

### 4.14 `receipts`

```sql
CREATE TABLE IF NOT EXISTS receipts (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  number          TEXT NOT NULL,               -- "RCP-000042"
  ledger_entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
  student_id      TEXT NOT NULL REFERENCES students(id),
  invoice_id      TEXT REFERENCES invoices(id),
  amount          INTEGER NOT NULL,            -- paise, always positive
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
```

**Purpose / Invariants.** A payment artefact for the parent (PDF + shareable URL — BR-RC-02/03). One-to-one with a `PAYMENT_RECEIVED` ledger entry. `amount > 0`; `number` monotonic, gap-tolerant, never reused (BR-RC-01). Voiding cascades to a `VOID` ledger entry (BR-LED-03).

### 4.15 `reminders`

```sql
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
```

**Purpose / Invariants.** Surfaced by the Reminder Engine (02_Core_Logic §3.2). Derived from ledger + attendance. Dismissed never re-fire (BR-RPT-05); snoozed re-fire at `snooze_until`.

### 4.16 `notifications` (in-app, FIFO cap 200)

```sql
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
```

**Purpose / Invariants.** Bell-badge feed. Trigger prunes oldest read rows when tenant exceeds 200 (§10). Audit log exempt.

### 4.17 `audit_log` (append-only)

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  actor       TEXT NOT NULL CHECK(actor IN ('tutor','system','sync')),
  action      TEXT NOT NULL,                  -- enum: attendance_lock | payment_void | export | ...
  ref_type    TEXT,
  ref_id      TEXT,
  metadata    TEXT,                           -- JSON
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(tenant_id, action, created_at);
```

**Purpose / Invariants.** Append-only forensic trail (BR-SEC-03). `UPDATE`/`DELETE` blocked (§5). Retained indefinitely (EC-AU-01).

### 4.18 `sync_outbox` (transient)

```sql
CREATE TABLE IF NOT EXISTS sync_outbox (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  op          TEXT NOT NULL CHECK(op IN ('insert','update','soft_delete')),
  payload     TEXT NOT NULL,                  -- JSON snapshot of the row
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','conflict','dropped')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  flushed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON sync_outbox(status, created_at);
```

**Purpose / Invariants.** Durable queue for offline-first sync (02_Core_Logic §3.6, BR-SYN-03). See §13. 5 failures → `conflict`.

### 4.19 `backup_manifest` (one row per backup artefact)

```sql
CREATE TABLE IF NOT EXISTS backup_manifest (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  filename          TEXT NOT NULL,            -- "Buddysaradhi_2025-08-14.buddysaradhi"
  size_bytes        INTEGER NOT NULL,
  schema_version    INTEGER NOT NULL,
  row_counts        TEXT NOT NULL,            -- JSON counts
  data_sha256       TEXT NOT NULL,            -- sha256 of decrypted data.jsonl
  encrypted_sha256  TEXT NOT NULL,            -- file sha256
  key_kdf_salt      TEXT NOT NULL,            -- argon2id salt (hex)
  key_kdf_params    TEXT NOT NULL,            -- JSON {t,m,p}
  created_at        TEXT NOT NULL,
  created_by        TEXT
);
CREATE INDEX IF NOT EXISTS idx_backups_created ON backup_manifest(tenant_id, created_at DESC);
```

**Purpose / Invariants.** Tracks every `.buddysaradhi` file (Settings → Backup & Restore). `data_sha256` verified on restore (BR-BAT-02). Excluded from the backup payload (would be self-referential).

### 4.20 `app_state` (singleton)

```sql
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
```

**Purpose / Invariants.** Holds per-DB schema version + ephemeral lock state. App refuses to render if `schema_version > MAX_SUPPORTED_SCHEMA` (BR-SYN-04, EC-SY-03).

---

## 5. Immutability Triggers (ledger + audit)

`ledger_entries` + `audit_log` accept `INSERT` only — `BEFORE UPDATE`/`DELETE` triggers abort and instruct the caller to post a `VOID` entry (ledger) or accept append-only (audit). Sync metadata (`updated_at`) lives in a separate `ledger_entries_sync_meta` table to bypass the trigger. SQL in §10.1.

---

## 6. Integer-Paise Convention

**Rule.** Every monetary column is `INTEGER` storing minor units. For INR, 1 rupee = 100 paise; ₹1,255.50 = `INTEGER 125550`. Applies to `fee_plans.base_amount`, `fee_schedule_items.amount`, `student_fee_rates.monthly_fee_paise`, `students.monthly_fee_paise`, `invoices.subtotal/discount/extra_charges/total`, `ledger_entries.debit_paise/credit_paise/balance_after_paise`, `receipts.amount`.

**Why float is forbidden.** IEEE-754 double cannot represent 0.1 exactly. In JavaScript, `0.1 + 0.2 === 0.30000000000000004`. Over 10,000 entries this drift compounds to several rupees and is non-deterministic across platforms. Storing paise as `INTEGER` makes every sum exact and every equality check deterministic.

**Helper API** (`packages/shared/src/money.ts`):

```ts
export const rupeesToPaise = (r: number): number => Math.round(r * 100);
export const paiseToRupees = (p: number): number => p / 100;
export const formatCurrency = (p: number, currency = 'INR', locale = 'en-IN'): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(p / 100);
```

**Rounding.** Percent discounts round **half-to-even** on the paise (BR-M-01). ±0.5 paise drift absorbed by BR-M-05's 1-minor-unit tolerance for "paid in full."

**Display.** `tabular-nums` always (lint rule `require-tabular-nums-on-amounts`). Negative balances (advances) render as `−₹500.00` in emerald, per BR-CALC-01 / EC-F-08.

---

## 7. Enumerations Catalog

Every enum column has a `CHECK` in DDL, mirrored to Zod. Transitions are enforced in the application layer (state-machine modules).

### 7.1 `students.status`
| Value | Meaning | Transitions | Spec |
|-------|---------|-------------|------|
| `active` | Currently enrolled | → inactive, graduated, archived | BR-STU-01 |
| `inactive` | Not attending | → active, archived | BR-STU-01 |
| `graduated` | Completed programme | terminal; ledger frozen | BR-STU-01, EC-S-05 |
| `archived` | Soft-deleted (restorable) | → active (audit-logged) | BR-STU-01, EC-S-01 |

### 7.2 `fee_plans.model` / `students.fee_model` / `settings.default_fee_model`
| Value | Meaning | Spec |
|-------|---------|------|
| `postpaid` | Fee charged after cycle ends | BR-FEE-01 |
| `prepaid` | Fee charged before cycle starts (soft block on attendance) | BR-FEE-01, BR-FEE-08 |
| `mixed` | Per-cycle mix of both | BR-FEE-01 |

### 7.3 `ledger_entries.type`
| Value | Direction | Effect on balance_due | Reverses? | Spec |
|-------|-----------|-----------------------|:---------:|------|
| `FEE_CHARGED` | debit | +debit | — | BR-LED-01 |
| `PAYMENT_RECEIVED` | credit | −credit | — | BR-LED-01 |
| `DISCOUNT_GRANTED` | credit | −credit | — | BR-LED-01 |
| `REFUND_ISSUED` | debit | +debit | — | BR-LED-01 |
| `ADJUSTMENT` | either | ± | — | BR-LED-01 |
| `WRITEOFF` | credit | −credit (zeroes a due) | — | BR-LED-01 |
| `VOID` | mirrors | cancels reversed entry | ✓ | BR-LED-01, BR-LED-02 |

### 7.4 `attendance_records.status`
| Value | In %? | Spec |
|-------|:-----:|------|
| `present` | ✓ numerator | BR-ATT-02 |
| `absent` | ✓ denominator | BR-ATT-02 |
| `late` | ✓ numerator | BR-ATT-02, BR-ATT-05 |
| `excused` | excluded | BR-ATT-02 |
| `holiday` | excluded; only on `is_holiday=1` sessions | BR-ATT-02, BR-ATT-04 |

### 7.5 `invoices.status` / `fee_schedule_items.status`
| Value | Meaning | Spec |
|-------|---------|------|
| `pending` | Schedule item not invoiced | BR-FEE-03 |
| `invoiced` | Invoice generated, unpaid | BR-FEE-04 |
| `unpaid` | Invoice — full amount due | BR-CALC-02 |
| `partial` | Some payment received | BR-CALC-02 |
| `paid` | Balance ≤ 1 minor unit | BR-CALC-02, BR-M-05 |
| `overdue` | `due_date < today` AND not paid | BR-RPT-01 |
| `void` | Cancelled (PIN-gated) | BR-LED-04, EC-F-06 |

### 7.6 `payment_method` (receipts + ledger)
| Value | Notes | Spec |
|-------|-------|------|
| `cash` | Default | BR-RC-01 |
| `upi` | UTR in `payment_ref` | EC-F-04 |
| `card` | Card last-4 in `payment_ref` | — |
| `bank` | Bank transfer UTR | — |
| `cheque` | Cheque no. required (Zod) | EC-F-04 |
| `other` | Free-text ref | — |

### 7.7 `reminders.category` / `sync_outbox.*`
| Value | Meaning | Spec |
|-------|---------|------|
| `due_fee` / `upcoming_due` / `missing_attendance` / `inactive_student` | Reminder categories | BR-RPT-01..R04 |
| `pending` / `snoozed` / `dismissed` / `acted` | Reminder lifecycle | BR-RPT-05 |
| `insert` / `update` / `soft_delete` | Outbox op type | BR-SYN-01 |
| `pending` / `sent` / `conflict` / `dropped` | Outbox status (conflict = 5 failed attempts) | BR-SYN-03, EC-SY-02 |

---

## 8. Ledger Deep Dive

`ledger_entries` is the load-bearing wall of Buddysaradhi. Every financial truth is a row; every balance is a sum of rows; every correction is a new row.

### 8.1 Hash Chain Mechanics

Each row's `this_hash = sha256(prev_hash || canonical_payload || created_at)`, where `canonical_payload` is deterministic JSON of `{id, student_id, type, debit_paise, credit_paise, balance_after_paise, occurred_on, tenant_secret}`. The pepper prevents offline recomputation by an attacker with only the DB file. Verification walks the chain in `created_at` order, recomputes each hash, aborts on first mismatch — surfacing "Tampered ledger at entry {id}" in Settings → Diagnostics (10_Security §14).

### 8.2 `balance_after_paise` Invariant

```
balance_after_paise(new_row) = balance_after_paise(prev_row_for_student) + debit_paise − credit_paise
```

Enforced by a `BEFORE INSERT` trigger (§10) reading the prior row's `balance_after_paise` for the same `student_id` ordered by `created_at`. Mismatch aborts the insert. This makes the running balance **tamper-evident**: altering a debit breaks every downstream hash.

### 8.3 `void_of_id` Constraint

A `VOID` row's `void_of_id` must reference a non-voided, non-locked entry (trigger §10). Cascade: voiding a `PAYMENT_RECEIVED` cascades to `receipts.voided_at` and reverts `invoices.status` (BR-LED-03). Voiding a `FEE_CHARGED` with credits against it is blocked (BR-LED-04, EC-F-06).

### 8.4 Indexes & Query Patterns

| Pattern | Index |
|---------|-------|
| Student ledger timeline (most common) | `idx_ledger_student (student_id, created_at)` |
| Receipt lookup by number | `idx_ledger_receipt (receipt_no)` |
| Chain verification walk | `idx_ledger_hash (this_hash)` |
| Void cascade (find row being voided) | `idx_ledger_void_of (void_of_id)` |
| Monthly finance report | `idx_ledger_type (tenant_id, type, occurred_on)` |
| Invoice → entries join | `idx_ledger_invoice (invoice_id)` |

---

## 9. Indexes & Query Patterns (other entities)

Top 3 queries per major non-ledger entity + serving index. Algorithms in `02_Core_Logic.md` §3 and `12_Business_Rules.md` §11. All queries bind `tenant_id` first.

### 9.1 `students`
| Query | Index |
|-------|-------|
| Active roster, alphabetical | `idx_students_name (tenant_id, last_name, first_name)` |
| Filter by status | `idx_students_tenant_status (tenant_id, status, archived_at)` |
| Duplicate detection on insert | `idx_students_dup (tenant_id, dup_key)` |

### 9.2 `attendance_records`
| Query | Index |
|-------|-------|
| Per-session grid | PK on `(session_id, student_id)` via `UNIQUE` |
| Student attendance history | `idx_records_student (student_id, session_id)` |
| Status counts per session | `idx_records_status (session_id, status)` |

### 9.3 `invoices`
| Query | Index |
|-------|-------|
| Student's unpaid invoices | `idx_invoices_student (student_id, status)` |
| Overdue sweep (daily job) | `idx_invoices_due (due_date, status)` |
| Tamper verification | PK + `idx_invoices_student` for batched reads |

### 9.4 `sync_outbox`
| Query | Index |
|-------|-------|
| Next pending row (FIFO) | `idx_outbox_pending (status, created_at)` |
| Conflict list | partial scan `WHERE status='conflict'` |
| Stuck-row detection (attempts ≥ 5) | full scan; rare |

---

## 10. Triggers & Generated Columns

> **Schema-defence-in-depth.** The triggers below are DDL, applied by `prisma migrate deploy` as part of the migration SQL. They are the *second* line of defence — the *first* line is Prisma middleware (`packages/core/src/ledgerGuard.ts`) that rejects `db.ledgerEntry.update()` / `db.ledgerEntry.delete()` / `db.ledgerEntry.deleteMany()` calls before they reach the DB. No runtime code path issues raw `UPDATE ledger_entries` / `DELETE FROM ledger_entries` via `$queryRaw` / `$executeRaw` — the CI lint `no-ledger-mutation.py` enforces this. All runtime DB access uses Prisma ORM methods (`findMany`, `create`, `aggregate`, `$transaction`, etc.); the only raw-SQL exception in the entire codebase is `VACUUM` (admin-only, `lib/db/admin.ts`, no ORM equivalent).

### 10.1 Ledger + audit immutability

```sql
CREATE TRIGGER IF NOT EXISTS trg_ledger_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only. Post a reversing entry.'); END;
CREATE TRIGGER IF NOT EXISTS trg_ledger_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only. Post a VOID entry.'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only.'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only.'); END;
```

### 10.2 Ledger hash chain (BEFORE INSERT)

```sql
CREATE TRIGGER IF NOT EXISTS trg_ledger_hash BEFORE INSERT ON ledger_entries
WHEN NEW.this_hash IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.this_hash <> lower(hex(sha256(
    COALESCE(NEW.prev_hash,'') || '|' ||
    NEW.id || '|' || NEW.student_id || '|' || NEW.type || '|' ||
    NEW.debit_paise || '|' || NEW.credit_paise || '|' ||
    NEW.balance_after_paise || '|' || NEW.occurred_on || '|' ||
    (SELECT tenant_secret FROM settings) || '|' || NEW.created_at
  ))) THEN RAISE(ABORT, 'ledger_entries.this_hash invalid') END;
END;
```

### 10.3 `balance_after_paise` + `void_of_id` invariants (BEFORE INSERT)

```sql
CREATE TRIGGER IF NOT EXISTS trg_ledger_balance BEFORE INSERT ON ledger_entries
BEGIN
  SELECT CASE WHEN NEW.balance_after_paise <>
    COALESCE((SELECT balance_after_paise FROM ledger_entries
              WHERE student_id = NEW.student_id ORDER BY created_at DESC LIMIT 1), 0)
    + NEW.debit_paise - NEW.credit_paise
    THEN RAISE(ABORT, 'balance_after_paise invariant violated') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_void_valid BEFORE INSERT ON ledger_entries
WHEN NEW.void_of_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.type <> 'VOID' THEN RAISE(ABORT, 'void_of_id can only be set on type=VOID')
    WHEN NOT EXISTS (SELECT 1 FROM ledger_entries
                     WHERE id = NEW.void_of_id AND type <> 'VOID' AND locked_at IS NULL)
      THEN RAISE(ABORT, 'void_of_id must point to a non-voided, non-locked entry')
  END;
END;
```

### 10.4 Invoice-total CHECK + `updated_at` auto-touch + notification FIFO cap

```sql
CREATE TRIGGER IF NOT EXISTS trg_invoices_total BEFORE INSERT ON invoices
BEGIN
  SELECT CASE WHEN NEW.total <> NEW.subtotal - NEW.discount + NEW.extra_charges
    THEN RAISE(ABORT, 'invoices.total must equal subtotal - discount + extra_charges') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_students_touch AFTER UPDATE ON students
BEGIN UPDATE students SET updated_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS trg_notif_cap AFTER INSERT ON notifications
BEGIN
  DELETE FROM notifications WHERE id IN (
    SELECT id FROM notifications WHERE tenant_id = NEW.tenant_id AND read_at IS NOT NULL
    ORDER BY created_at ASC LIMIT -1 OFFSET 200);
END;
```

### 10.5 Full-Text Search (FTS5)

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS students_fts USING fts5(
  first_name, last_name, code, phone, email, school, grade,
  content='students', content_rowid='rowid', tokenize='porter unicode61'
);
CREATE VIRTUAL TABLE IF NOT EXISTS payments_fts USING fts5(
  receipt_no, student_name, description, content='', tokenize='porter unicode61'
);
```

The Search Engine (02_Core_Logic §3.1) rebuilds `payments_fts` from a join of `receipts`, `students`, `ledger_entries` on each sync. Ranking: recent-first, exact-match, then fuzzy (`bm25`).

---

## 11. Migration Strategy

Schema is versioned by Prisma Migrate. Each `prisma/migrations/<timestamp>_<name>/migration.sql` is generated by `prisma migrate dev --name <name>` and applied in order by `prisma migrate deploy`. The app's `app_state.schema_version` integer is bumped inside the migration SQL (a one-shot `UPDATE app_state SET schema_version = NN` inside the migration's final statement) so the runtime guard in `02_Core_Logic.md` §9 can refuse to render if the on-disk schema is ahead of `MAX_SUPPORTED_SCHEMA`. The SQLite `PRAGMA user_version` is a SQLite-level admin command with no Prisma ORM equivalent; it is written once per migration inside the generated `migration.sql` (a schema file, not a runtime code path).

**Forward-only.** No down-migrations. A rollback is a restore from the last `.buddysaradhi` backup.

**Idempotency.** Every Prisma migration uses `IF NOT EXISTS` for new tables and guards `ALTER TABLE ADD COLUMN` (SQLite lacks `ADD COLUMN IF NOT EXISTS`, so Prisma's migration generator probes `pragma_table_info` first). Example migration SQL (generated by `prisma migrate dev --name ledger_hash_chain`, then hand-verified before merge):

```sql
-- migrations/0007_ledger_hash_chain.sql
BEGIN;
ALTER TABLE ledger_entries ADD COLUMN debit_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ledger_entries ADD COLUMN credit_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ledger_entries ADD COLUMN balance_after_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ledger_entries ADD COLUMN prev_hash TEXT;
ALTER TABLE ledger_entries ADD COLUMN this_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE ledger_entries ADD COLUMN void_of_id TEXT REFERENCES ledger_entries(id);
ALTER TABLE ledger_entries ADD COLUMN locked_at TEXT;
UPDATE ledger_entries SET
  debit_paise = CASE WHEN direction='charge' THEN amount ELSE 0 END,
  credit_paise = CASE WHEN direction='credit' THEN amount ELSE 0 END;
-- balance_after_paise + hash chain rebuilt by app daemon (<5s for 10k rows)
PRAGMA user_version = 7;
UPDATE app_state SET schema_version = 7, updated_at = datetime('now');
COMMIT;
```

**No destructive `ALTER` in v1.x.** Deprecated columns are renamed `*_deprecated` and ignored.

**How to add a column.** (1) Add the field to the model in `prisma/schema.prisma`. (2) Run `bun run db:migrate --name <desc>` → Prisma generates a new `prisma/migrations/<timestamp>_<name>/migration.sql` containing the `ALTER TABLE ... ADD COLUMN ... DEFAULT <const>;` (non-NULL const required by SQLite). (3) Bump `MAX_SUPPORTED_SCHEMA` in `packages/shared`. (4) Update Zod. (5) Add a row to the migration test matrix.

**Schema drift.** EC-SY-03 (app older than DB), EC-SY-04 (DB older than app).

---

## 12. Backup & Serialization

A `.buddysaradhi` file is the offline artefact the tutor owns (BR-BAT-01). On-disk format: envelope-encrypted ciphertext; in-DB record is a `backup_manifest` row (§4.19). See `10_Security.md` §6.

**Envelope:** `argon2id(passphrase, salt) → 32-byte DEK` (derived; never stored) decrypts an AES-256-GCM block wrapping a gzipped tar of `data.jsonl` (NDJSON rows), `schema_version.txt`, and `manifest.json` (counts + checksums).

**Manifest format** (inside the tar and as a `backup_manifest` row):

```json
{
  "tenant_id": "01HXY...", "created_at": "2025-08-14T13:45:00Z", "schema_version": 7,
  "row_counts": { "students": 42, "ledger_entries": 317, "attendance_records": 1102 },
  "data_sha256": "a3f4...e91", "encrypted_sha256": "b8c2...d10",
  "key_kdf_salt": "9e7c...f1", "key_kdf_params": { "t": 3, "m": 65536, "p": 1 }
}
```

**Restore flow.** (1) Prompt passphrase; derive DEK. (2) AES-256-GCM decrypt; abort on auth-tag failure (EC-SEC-06). (3) Verify `encrypted_sha256` + `data_sha256`. (4) Refuse if `schema_version > MAX_SUPPORTED_SCHEMA` (EC-IE-05). (5) Transactional UPSERT in batches of 100 (BR-BAT-02, EC-RV-02).

**Backup never uploaded.** Per BR-BAT-05, `.buddysaradhi` is the user's offline artefact. The cloud copy is the Turso DB itself, synced via the outbox.

---

## 13. Sync Outbox (Deep Dive)

The `sync_outbox` table is the durable queue that bridges offline writes and the Turso cloud replica.

**Lifecycle.**
1. **App write.** A mutation writes `ledger_entries` + `receipts` in one transaction; a `sync_outbox` row (`op`, `payload` JSON snapshot, `status='pending'`) is inserted in the same transaction.
2. **Flush.** On app foreground + every 30s + network-change, Sync Engine runs `db.syncOutbox.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: 50 })` and POSTs each row to Turso. Success → `db.syncOutbox.update({ where: { id }, data: { status: 'sent' } })`. Failure → `db.syncOutbox.update({ where: { id }, data: { attempts: { increment: 1 } } })`, retry with backoff.
3. **Conflict.** After 5 failures → `status='conflict'`, surfaced in Sync drawer (BR-SYN-03, EC-SY-02).
4. **Drop.** Tutor discards a `conflict` row → `status='dropped'`, audit_log `sync_outbox_dropped`.

**Ledger is conflict-immune** (BR-SYN-02). Ledger rows are UUID-keyed and append-only; two devices posting different entries for the same student both land in Turso without merge. The outbox is still used for ledger rows (for ordering + retry) but never produces a `conflict` on the ledger itself.

**v2 sync consumption.** In v2 (`15_Future_Roadmap.md` v2.0), the outbox gains `vc TEXT` (vector-clock JSON) and `client_id` for CRDT-style resolution on non-ledger rows. v1 schema is forward-compatible.

---

## 14. Data Retention & Purge Policy

| Data | Retention | Authority |
|------|-----------|-----------|
| `ledger_entries`, `receipts`, `invoices` | **Forever.** Append-only financial history. | BR-LED-02, BR-RC-01, BR-FEE-04 |
| `audit_log` | Forever in v1; v1.x may archive >5y to cold storage. | EC-AU-01 |
| `students` (incl. archived) | Forever. Restore is first-class. | BR-STU-01, EC-S-01 |
| `attendance_records` | Forever (incl. holiday-soft-deleted). | BR-ATT-04 |
| `backup_manifest` | Forever (historical record of backups). | §4.19 |
| `notifications` | FIFO 200 read rows per tenant (trigger prunes). | §4.16 |
| `sync_outbox` (`sent`) | Purged after 14 days by nightly job. | §13 |
| `sync_outbox` (`dropped`) | Purged after 30 days. | §13 |
| `student_documents` blobs | Until student archived + 90 days, then OS-level prune (DB row stays). | §4.9 |
| Ledger rows past editable window | `locked_at` set; immutable, not purged. | BR-LED-05 |

Nightly local job (02:00 device time if app open, else next foreground) runs purge queries in one transaction + writes one `audit_log` row with counts.

---

## 15. Derived Views (computed, not materialised)

Not tables; queries run on demand. The Report Engine (02_Core_Logic §3.4) caches the last result, invalidated on any `LEDGER_MUTATED` event. Definitions: BR-CALC-01..08 in `12_Business_Rules.md` §11.

### 15.1 `student_balance`

Computed on demand via Prisma ORM (no raw SQL):

```ts
// One aggregate per student — equivalent to the SQL derived view.
const balances = await db.student.findMany({
  where: { tenantId, status: 'active' },
  select: {
    id: true,
    ledgerEntries: {
      where: { type: { not: 'VOID' } },
      select: { debitPaise: true, creditPaise: true },
    },
  },
});
// Or, equivalently, the trigger-maintained cache (O(1) per student):
const cached = await db.ledgerEntry.findMany({
  where: { tenantId, type: { not: 'VOID' } },
  orderBy: { createdAt: 'desc' },
  distinct: ['studentId'],
  select: { studentId: true, balanceAfterPaise: true },
});
```

Equivalent to the latest non-VOID entry's `balance_after_paise` — trigger-maintained, so this view is O(1) per student.

### 15.2 Monthly collection / charged

Computed via Prisma `groupBy` + `aggregate` (no raw SQL):

```ts
const monthly = await db.ledgerEntry.groupBy({
  by: ['occurredOn'],   // YYYY-MM-DD; the engine truncates to YYYY-MM in TS
  where: { tenantId, type: { not: 'VOID' } },
  _sum: {
    debitPaise: true,   // FEE_CHARGED debits
    creditPaise: true,  // PAYMENT_RECEIVED credits
  },
  orderBy: { occurredOn: 'desc' },
});
```

The engine then buckets rows by `strftime('%Y-%m', occurredOn)` in TS and filters by `type` to split `collected_paise` (sum of `credit_paise` where `type='PAYMENT_RECEIVED'`) from `charged_paise` (sum of `debit_paise` where `type='FEE_CHARGED'`).

### 15.3 Attendance %

Computed via Prisma `groupBy` + `count` (no raw SQL):

```ts
const perStudent = await db.attendanceRecord.groupBy({
  by: ['studentId'],
  where: {
    status: { notIn: ['excused', 'holiday'] },
    session: { tenantId },
  },
  _count: { _all: true },
});
const presentPerStudent = await db.attendanceRecord.groupBy({
  by: ['studentId'],
  where: {
    status: 'present',
    session: { tenantId },
  },
  _count: { _all: true },
});
// The engine joins the two maps in TS, divides, rounds to 1 decimal.
```

### 15.4 Expected vs Collected vs Arrears (per period — THE monthly-fee payoff)

The derived view that makes the per-student monthly fee usable in every calculation. Computed entirely via Prisma ORM (no raw SQL). Three pure functions in `packages/shared/src/feeCalc.ts` (BR-CALC-09, BR-CALC-10, BR-CALC-11):

```ts
// (1) EXPECTED for a period — the monthly fee × number of months in the period,
//     using the rate effective each month (so a mid-period fee change is exact).
//     A student who was inactive/paused for a month contributes 0 for that month.
function expectedForPeriod(studentId, fromMonth, toMonth): number {
  // fetch all fee_rate rows for the student overlapping [fromMonth, toMonth]
  const rates = await db.studentFeeRate.findMany({
    where: {
      studentId,
      effectiveFrom: { lte: toMonth + '-31' },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: fromMonth + '-01' } }],
    },
    orderBy: { effectiveFrom: 'asc' },
  });
  // walk month-by-month; for each month, find the rate effective on the 1st;
  // sum monthly_fee_paise across all months in the period
  return sumOfMonthlyFees;  // paise
}

// (2) COLLECTED for a period — sum of PAYMENT_RECEIVED ledger credits, minus refunds.
function collectedForPeriod(studentId, fromDate, toDate): number {
  const credits = await db.ledgerEntry.aggregate({
    where: { studentId, type: 'PAYMENT_RECEIVED', occurredOn: { gte: fromDate, lte: toDate } },
    _sum: { creditPaise: true },
  });
  const refunds = await db.ledgerEntry.aggregate({
    where: { studentId, type: 'REFUND_ISSUED', occurredOn: { gte: fromDate, lte: toDate } },
    _sum: { debitPaise: true },
  });
  return (credits._sum.creditPaise ?? 0) - (refunds._sum.debitPaise ?? 0);  // paise
}

// (3) ARREARS for a period — expected − collected − waivers. Can be negative (advance).
function arrearsForPeriod(studentId, fromMonth, toMonth): number {
  const expected  = expectedForPeriod(studentId, fromMonth, toMonth);
  const collected = collectedForPeriod(studentId, fromMonth + '-01', toMonth + '-31');
  const waivers   = await db.ledgerEntry.aggregate({
    where: { studentId, type: 'DISCOUNT_GRANTED', occurredOn: { gte: fromMonth + '-01', lte: toMonth + '-31' } },
    _sum: { creditPaise: true },
  });
  return expected - collected - (waivers._sum.creditPaise ?? 0);  // paise; <0 = advance
}
```

**Convenience wrappers** (the M/Q/Y the user asked for):

| Function | Period | Formula |
|---|---|---|
| `expectedForMonth(s, 'YYYY-MM')` | 1 month | the rate effective on the 1st of that month |
| `expectedForQuarter(s, Q)` | 3 months | `Σ expectedForMonth` for the 3 months of the quarter |
| `expectedForYear(s, 'YYYY')` | 12 months | `Σ expectedForMonth` for Jan..Dec of that year |
| `collectedForMonth/Quarter/Year(s, period)` | same | `collectedForPeriod` scoped to the period's date range |
| `arrearsForMonth/Quarter/Year(s, period)` | same | `arrearsForPeriod` scoped to the period |

**Tenant-wide rollup** (the Dashboard KPI — §04_Dashboard C1/C3):

```ts
// Expected this month across ALL active students = the tutor's target collection.
const expectedThisMonth = await db.student.aggregate({
  where: { tenantId, status: 'active', monthlyFeePaise: { not: null } },
  _sum: { monthlyFeePaise: true },
});
// This is O(1) thanks to the denormalised cache on students.monthly_fee_paise.
// For a historical month, fall back to summing expectedForMonth per student (slower, exact).
```

**Why this matters.** Before this view, "expected this month" was either absent or a guess. Now it is a real number: the sum of every active student's monthly fee. The Dashboard's "Collected This Month / Expected This Month / Arrears" trio is no longer a vanity metric — it is the tutor's actual revenue target vs actual collection, computable to the paise.

---

## 16. Sample Dataset

A minimal seed for QA. Hashes are illustrative (real values require the `tenant_secret`). Seeding runs through `prisma/seed.ts` using Prisma ORM methods (`db.batch.createMany()`, `db.student.createMany()`, `db.ledgerEntry.create()`, etc.) — no raw `INSERT` SQL.

```ts
// prisma/seed.ts — excerpt
import { db } from '@/lib/db';

await db.$transaction([
  db.batch.createMany({ data: [
    { id: 'b-001', tenantId: 't-1', name: 'Class 10 Maths 6pm', subject: 'Mathematics', createdAt: '2025-08-01T00:00:00Z', updatedAt: '2025-08-01T00:00:00Z' },
    { id: 'b-002', tenantId: 't-1', name: 'Class 9 Science 5pm',  subject: 'Science',     createdAt: '2025-08-01T00:00:00Z', updatedAt: '2025-08-01T00:00:00Z' },
  ], skipDuplicates: true }),

  db.student.createMany({ data: [
    { id: 's-001', tenantId: 't-1', code: 'STU-0001', firstName: 'Aarav',  lastName: 'Sharma', grade: 'Class 10', admissionDate: '2025-08-01', status: 'active',   feeModel: 'postpaid', dupKey: 'aaravsharma8765',  createdAt: '2025-08-01T00:00:00Z', updatedAt: '2025-08-01T00:00:00Z' },
    { id: 's-002', tenantId: 't-1', code: 'STU-0002', firstName: 'Diya',    lastName: 'Patel',  grade: 'Class 10', admissionDate: '2025-08-01', status: 'active',   feeModel: 'postpaid', dupKey: 'diyapatel2341',     createdAt: '2025-08-01T00:00:00Z', updatedAt: '2025-08-01T00:00:00Z' },
    { id: 's-003', tenantId: 't-1', code: 'STU-0003', firstName: 'Ishaan',  lastName: 'Gupta',  grade: 'Class 9',  admissionDate: '2025-08-01', status: 'active',   feeModel: 'prepaid',  dupKey: 'ishaangupta9912',   createdAt: '2025-08-01T00:00:00Z', updatedAt: '2025-08-01T00:00:00Z' },
    { id: 's-004', tenantId: 't-1', code: 'STU-0004', firstName: 'Saanvi',  lastName: 'Mehta',  grade: 'Class 10', admissionDate: '2025-08-01', status: 'active',   feeModel: 'postpaid', dupKey: 'saanvimehta5567',   createdAt: '2025-08-01T00:00:00Z', updatedAt: '2025-08-01T00:00:00Z' },
    { id: 's-005', tenantId: 't-1', code: 'STU-0005', firstName: 'Vivaan',  lastName: 'Jain',   grade: 'Class 9',  admissionDate: '2025-08-01', status: 'inactive', feeModel: 'mixed',    dupKey: 'vivaanjain7788',    createdAt: '2025-08-01T00:00:00Z', updatedAt: '2025-08-01T00:00:00Z' },
  ], skipDuplicates: true }),

  db.attendanceSession.createMany({ data: [
    { id: 'as-001', tenantId: 't-1', batchId: 'b-001', sessionDate: '2025-08-12', createdAt: '2025-08-12T00:00:00Z', updatedAt: '2025-08-12T00:00:00Z' },
    { id: 'as-002', tenantId: 't-1', batchId: 'b-002', sessionDate: '2025-08-12', createdAt: '2025-08-12T00:00:00Z', updatedAt: '2025-08-12T00:00:00Z' },
    { id: 'as-003', tenantId: 't-1', batchId: 'b-001', sessionDate: '2025-08-14', createdAt: '2025-08-14T00:00:00Z', updatedAt: '2025-08-14T00:00:00Z' },
  ], skipDuplicates: true }),

  db.attendanceRecord.createMany({ data: [
    { id: 'ar-001', tenantId: 't-1', sessionId: 'as-001', studentId: 's-001', status: 'present', markedAt: '2025-08-12T18:05:00Z', createdAt: '2025-08-12T18:05:00Z', updatedAt: '2025-08-12T18:05:00Z' },
    { id: 'ar-002', tenantId: 't-1', sessionId: 'as-001', studentId: 's-002', status: 'absent',  markedAt: '2025-08-12T18:05:00Z', createdAt: '2025-08-12T18:05:00Z', updatedAt: '2025-08-12T18:05:00Z' },
    { id: 'ar-003', tenantId: 't-1', sessionId: 'as-001', studentId: 's-004', status: 'late',    markedAt: '2025-08-12T18:05:00Z', createdAt: '2025-08-12T18:05:00Z', updatedAt: '2025-08-12T18:05:00Z' },
    { id: 'ar-004', tenantId: 't-1', sessionId: 'as-002', studentId: 's-003', status: 'present', markedAt: '2025-08-12T17:05:00Z', createdAt: '2025-08-12T17:05:00Z', updatedAt: '2025-08-12T17:05:00Z' },
    { id: 'ar-005', tenantId: 't-1', sessionId: 'as-002', studentId: 's-005', status: 'excused', markedAt: '2025-08-12T17:05:00Z', createdAt: '2025-08-12T17:05:00Z', updatedAt: '2025-08-12T17:05:00Z' },
    { id: 'ar-006', tenantId: 't-1', sessionId: 'as-003', studentId: 's-001', status: 'present', markedAt: '2025-08-14T18:05:00Z', createdAt: '2025-08-14T18:05:00Z', updatedAt: '2025-08-14T18:05:00Z' },
    { id: 'ar-007', tenantId: 't-1', sessionId: 'as-003', studentId: 's-002', status: 'present', markedAt: '2025-08-14T18:05:00Z', createdAt: '2025-08-14T18:05:00Z', updatedAt: '2025-08-14T18:05:00Z' },
    { id: 'ar-008', tenantId: 't-1', sessionId: 'as-003', studentId: 's-004', status: 'absent',  markedAt: '2025-08-14T18:05:00Z', createdAt: '2025-08-14T18:05:00Z', updatedAt: '2025-08-14T18:05:00Z' },
    { id: 'ar-009', tenantId: 't-1', sessionId: 'as-003', studentId: 's-005', status: 'present', markedAt: '2025-08-14T18:05:00Z', createdAt: '2025-08-14T18:05:00Z', updatedAt: '2025-08-14T18:05:00Z' },
    { id: 'ar-010', tenantId: 't-1', sessionId: 'as-002', studentId: 's-001', status: 'late',    markedAt: '2025-08-12T17:05:00Z', createdAt: '2025-08-12T17:05:00Z', updatedAt: '2025-08-12T17:05:00Z' },
  ], skipDuplicates: true }),

  // 5 ledger entries showing the hash chain for s-001 — each is its own create()
  // because this_hash depends on the prior row's this_hash.
  db.ledgerEntry.create({ data: { id: 'le-001', tenantId: 't-1', studentId: 's-001', batchId: 'b-001', type: 'FEE_CHARGED',      debitPaise: 500000, creditPaise: 0,      balanceAfterPaise: 500000, description: 'August 2025 Tuition',           occurredOn: '2025-08-05', source: 'manual', createdAt: '2025-08-05T10:00:00Z', updatedAt: '2025-08-05T10:00:00Z', prevHash: null,        thisHash: 'a1b2...c3d4' } }),
  db.ledgerEntry.create({ data: { id: 'le-002', tenantId: 't-1', studentId: 's-001', batchId: null,  type: 'PAYMENT_RECEIVED', debitPaise: 0,      creditPaise: 300000, balanceAfterPaise: 200000, description: 'Partial payment via UPI',         occurredOn: '2025-08-10', source: 'manual', createdAt: '2025-08-10T15:30:00Z', updatedAt: '2025-08-10T15:30:00Z', prevHash: 'a1b2...c3d4', thisHash: 'e5f6...7g8h' } }),
  db.ledgerEntry.create({ data: { id: 'le-003', tenantId: 't-1', studentId: 's-001', batchId: null,  type: 'DISCOUNT_GRANTED', debitPaise: 0,      creditPaise: 50000,  balanceAfterPaise: 150000, description: 'Sibling discount 10%',             occurredOn: '2025-08-11', source: 'manual', createdAt: '2025-08-11T09:00:00Z', updatedAt: '2025-08-11T09:00:00Z', prevHash: 'e5f6...7g8h', thisHash: 'i9j0...k1l2' } }),
  db.ledgerEntry.create({ data: { id: 'le-004', tenantId: 't-1', studentId: 's-001', batchId: null,  type: 'PAYMENT_RECEIVED', debitPaise: 0,      creditPaise: 200000, balanceAfterPaise: -50000, description: 'Overpayment [ADVANCE] ₹500',      occurredOn: '2025-08-13', source: 'manual', createdAt: '2025-08-13T11:00:00Z', updatedAt: '2025-08-13T11:00:00Z', prevHash: 'i9j0...k1l2', thisHash: 'm3n4...o5p6' } }),
  db.ledgerEntry.create({ data: { id: 'le-005', tenantId: 't-1', studentId: 's-001', batchId: null,  type: 'VOID',             debitPaise: 0,      creditPaise: 200000, balanceAfterPaise: 150000, description: 'VOID of le-004 (error)',           occurredOn: '2025-08-13', source: 'manual', createdAt: '2025-08-13T16:00:00Z', updatedAt: '2025-08-13T16:00:00Z', prevHash: 'm3n4...o5p6', thisHash: 'q7r8...s9t0', voidOfId: 'le-004' } }),
]);
```

Note: `prev_hash` of each row equals `this_hash` of the prior. `le-005` is a `VOID` reversing `le-004`, restoring balance to 150000 paise (₹1,500).

---

## 17. Seed Defaults (on provisioning)

A freshly provisioned Turso DB is seeded with: `settings` singleton, one `tutors` row (`role='owner'`), one `batches` row ("Default Batch"), `app_state` with `schema_version = <latest>`, three `tags` (Scholarship, Trial, Sibling), and one welcome `notifications` row. Seeding runs in one transaction by the Supabase Edge Function `provision-db` (02_Core_Logic §7).

---

## 18. ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 (ASCII Art Conventions) for the Data Model doc. The mockups here are **ER diagrams, hash-chain mechanics, and derived-view pipelines** — the data layer has no UI surfaces of its own, but the screens that render from these tables do. Where a UI surface is mentioned (e.g., the Diagnostics → Tamper Detection banner), the glass tier (`.glass` / `.glass-strong` / `.glass-faint` per §5.5) or neumorphic recipe (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6) is annotated. Character set per §20.2. Accent colours named, never hexed. Cross-references use canonical IDs only.

### 18.1 Design System Reference — Data Model

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces that render from this data model | Tier | Cross-ref |
|---|---|---|
| Students list rows (rendered from `students` + `student_balance`) | `glass-faint` band | §5.5, §8.4 |
| Student drawer (rendered from `students` + `ledger_entries` + `attendance_records`) | `glass-strong` | §5.5, §8.7 |
| Ledger timeline cards (rendered from `ledger_entries` JOIN `receipts`) | `glass` + accent left-border | §5.4, §8.1 |
| Tamper-detected banner (rendered when `verifyLedgerChain()` fails) | `glass` + flare accent left-border | §5.4, §8.3 |
| Settings → Diagnostics panel (chain verification result) | `glass` | §5.5 |
| Receipt PDF (rendered from `receipts` + `ledger_entries`) | (print — `glass` does not apply; §12.2) | §12.2 |
| Empty-state card (zero students / zero ledger entries) | `glass` centered | §5.5, §8.19 |

| Neumorphic controls on surfaces fed by this data model | Recipe | Cross-ref |
|---|---|---|
| Student drawer action buttons (Record Payment, Edit, Share Statement) | `neumo-raised` primary/secondary | §6.6, §8.2 |
| Ledger filter segmented control (All / Charges / Payments / Voids) | `neumo-inset` well; active = `neumo-raised` pill | §6.6, §8.5 |
| Diagnostics → Re-verify chain button | `neumo-raised` | §6.6, §8.2 |
| Settings → Export schema dump button | `neumo-raised` secondary | §6.6, §8.2 |

> **References:** Martin Kleppmann — *Designing Data-Intensive Applications* (append-only event log, derived views); Pat Helland — *Life beyond Distributed Transactions* (the per-tenant DB rationale); SQLite docs — *FTS5*, *Triggers*, *Generated Columns*; OWASP — *SQL Injection Prevention Cheat Sheet* (the tenant-predicate lint rule); RFC 4122 — *UUID v7* (time-sortable conflict-free IDs); Drizzle ORM docs — *SQLite column types* (the INTEGER-paise convention enforcement).

### 18.2 Mockup D1 — Full ER Diagram (all tables + relationships)

```
FULL ER DIAGRAM — Buddysaradhi per-tenant SQLite (one DB per tutor; v1 has no tenant_id
                  column — see 00_Vision §10.1; tenant_id is retained as a future-
                  proofing column for v4 federation, queryable but always one value
                  per DB in v1)
═══════════════════════════════════════════════════════════════════════════════════
                  ┌──────────────┐
                  │   settings   │  (singleton — tenant profile, sequences, locks)
                  │  PRIMARY KEY │  · pin_hash (argon2id) · biometric_enabled
                  │  tenant_id   │  · session_timeout_min · quiet_hours_*
                  └──────┬───────┘  · last_backup_at · schema_version
                         │ 1
        ┌────────────────┼─────────────────────┐
        │                │                     │
   ┌────▼─────┐    ┌─────▼─────┐         ┌────▼────┐
   │  batches │    │  tutors   │         │  tags   │
   │ (1:N→    │    │ (1:N→     │         │ (N:M   │
   │  sessions│    │  students │         │  via   │
   │  + plans)│    │  as lead) │         │ student│
   └────┬─────┘    └─────┬─────┘         │ _tags) │
        │ 1              │ 1             └────┬───┘
        │                │                    │ N:M
   ┌────▼──────────┐    │              ┌─────▼─────────┐
   │ attendance_   │    │              │   students    │──┬──────────┐
   │   sessions    │    │              │ (PK tenant_id │  │ 1        │ 1
   └────┬──────────┘    │              │  + id UUIDv7) │  │          │
        │ 1:N           │              └──┬────────────┘  │          │
   ┌────▼──────────┐    │                 │ 1             │          │
   │ attendance_   │◄───┘                 ├─┐             │          │
   │   records     │  (N:M via            │ │        ┌────▼────┐  ┌──▼──────────┐
   │ (PK session + │   student_           │ │        │guardians│  │ student_    │
   │  student)     │   enrollments)       │ │        │ (1:N)   │  │ notes (1:N) │
   └───────────────┘                      │ │        └─────────┘  └─────────────┘
                                          │ │
                              ┌───────────┘ │
                              │             │
                         ┌────▼─────────┐   │
                         │  fee_plans   │   │
                         │ (1:N→items;  │   │
                         │  1:1 opt→     │   │
                         │  invoices)    │   │
                         └────┬─────────┘   │
                              │ 1:N         │
                         ┌────▼─────────────▼┐
                         │ fee_schedule_items│ (the prepaid fee calendar)
                         └────┬──────────────┘
                              │ 1:1 (opt)
                         ┌────▼─────────┐
                         │   invoices   │◄──── (FK from ledger_entries.invoice_id)
                         │ (PK id;      │
                         │  status enum)│
                         └──────────────┘

   ┌══════════════════════════════════════════════════════════════════┐
   ║   ledger_entries  (APPEND-ONLY · hash-chained · BR-LED-01..L06)  ║
   ║   ════════════════                                                ║
   ║   · PK id (UUIDv7)                                                ║
   ║   · student_id (FK → students)                                    ║
   ║   · invoice_id (FK → invoices, nullable)                          ║
   ║   · type: FEE_CHARGED | PAYMENT_RECEIVED | VOID | WRITEOFF |      ║
   ║         ADJUSTMENT | DISCOUNT                                     ║
   ║   · debit_paise  (INTEGER, BR-M-01)                               ║
   ║   · credit_paise (INTEGER, BR-M-01)                               ║
   ║   · balance_after_paise (trigger-maintained — §8.2)               ║
   ║   · occurred_on (DATE)                                            ║
   ║   · void_of_id (self-ref → ledger_entries.id, nullable)           ║
   ║   · prev_hash → this_hash (chain — §8.1)                         ║
   ║   · tamper_hash = SHA-256(prev_hash || canonical_payload ||       ║
   ║                            tenant_secret)                         ║
   ║                                                                   ║
   ║   1:1 ─────► receipts (only for type=PAYMENT_RECEIVED)            ║
   ║              · PK id · receipt_no (BR-RC-01 monotonic)            ║
   ║              · tamper_hash · pdf_path · voided_at                 ║
   ╚══════════════════════════════════════════════════════════════════╝

   ┌────────────┐  ┌────────────┐  ┌─────────────┐  ┌──────────────────┐
   │ reminders  │  │ audit_log  │  │ sync_outbox │  │ backup_manifest  │
   │ (1:N per   │  │ (append-   │  │ (transient; │  │ (one row per     │
   │  student)  │  │  only;     │  │  purged     │  │  .buddysaradhi file)  │
   │            │  │  BR-SEC-06)│  │  after 30d) │  │                  │
   └────────────┘  └────────────┘  └─────────────┘  └──────────────────┘
   ┌───────────────┐  ┌──────────────┐
   │ notifications │  │  app_state   │  (singleton — lock state, sequences,
   │  (FIFO ≤200)  │  │              │   last_sync_at, feature_flags sunset)
   └───────────────┘  └──────────────┘

   ↑ Cardinality legend:  1:N one-to-many · N:M many-to-many via junction ·
                          1:1 one-to-one (rare) · self-ref for void_of_id
   ↑ Every table carries tenant_id (P-DM1) even though v1 has one tenant per DB;
     the column is future-proofing for v4 federation, queryable but always one
     value per DB in v1.
   ↑ FK enforcement: PRAGMA foreign_keys = ON; per connection (§3).
   ↑ Append-only tables (ledger_entries, audit_log) reject UPDATE/DELETE at the
     trigger level (§10.1) — correction is via new rows (VOID, BR-LED-03).
```

- ↑ **The ER diagram is the contract.** A PR that adds a column here must update `12_Business_Rules.md` and `14_Edge_Cases.md` in the same PR (`02_Core_Logic.md` closing note).
- ↑ **ledger_entries is the spine.** Every financial truth is a row; every balance is a sum of rows; every correction is a new row (P4, BR-LED-01).
- ↑ **The 1:1 between PAYMENT_RECEIVED and receipts is the two-row invariant** — they must be written in the same transaction (`02_Core_Logic.md` glossary; AP-13).

### 18.3 Mockup D2 — ledger_entries Tamper-Evident Hash Chain

```
TAMPER-EVIDENT HASH CHAIN (§8.1) — per-student, in created_at order

   For student s-001 (Aarav Sharma), the chain over 4 entries:

   ┌─ Entry 1 ─────────────────────────────────────────────────────────────────┐
   │  id: le-001  ·  type: FEE_CHARGED  ·  debit_paise: 200000  (₹2,000)       │
   │  credit_paise: 0  ·  balance_after_paise: 200000  ·  occurred_on: 2025-08-01│
   │  prev_hash: NULL (genesis entry for this student)                         │
   │  this_hash: sha256("" || canonical_payload(le-001) || tenant_secret)       │
   │            = "a1b2c3d4e5f6…7890"                                          │
   └────────────────────────────────────┬──────────────────────────────────────┘
                                        │ prev_hash for entry 2
                                        ▼
   ┌─ Entry 2 ─────────────────────────────────────────────────────────────────┐
   │  id: le-002  ·  type: PAYMENT_RECEIVED  ·  debit_paise: 0                  │
   │  credit_paise: 200000  (₹2,000)  ·  balance_after_paise: 0                │
   │  occurred_on: 2025-08-05                                                  │
   │  prev_hash: "a1b2c3d4e5f6…7890"  ← links to entry 1                       │
   │  this_hash: sha256("a1b2c3d4e5f6…7890" || canonical_payload(le-002) ||     │
   │                       tenant_secret)                                       │
   │            = "b2c3d4e5f6a7…8901"                                          │
   │  ↓ 1:1 companion row in receipts (RCP-000001)                              │
   └────────────────────────────────────┬──────────────────────────────────────┘
                                        │ prev_hash for entry 3
                                        ▼
   ┌─ Entry 3 ─────────────────────────────────────────────────────────────────┐
   │  id: le-003  ·  type: FEE_CHARGED  ·  debit_paise: 200000  (₹2,000)       │
   │  credit_paise: 0  ·  balance_after_paise: 200000  ·  occurred_on: 2025-09-01│
   │  prev_hash: "b2c3d4e5f6a7…8901"                                           │
   │  this_hash: sha256("b2c3d4e5f6a7…8901" || canonical_payload(le-003) ||     │
   │                       tenant_secret)                                       │
   │            = "c3d4e5f6a7b8…9012"                                          │
   └────────────────────────────────────┬──────────────────────────────────────┘
                                        │ prev_hash for entry 4
                                        ▼
   ┌─ Entry 4 (VOID of entry 2) ───────────────────────────────────────────────┐
   │  id: le-004  ·  type: VOID  ·  debit_paise: 200000  (₹2,000 — reverses)   │
   │  credit_paise: 0  ·  balance_after_paise: 200000  ·  occurred_on: 2025-09-02│
   │  void_of_id: le-002  ← self-reference to the voided entry                 │
   │  prev_hash: "c3d4e5f6a7b8…9012"                                           │
   │  this_hash: sha256("c3d4e5f6a7b8…9012" || canonical_payload(le-004) ||     │
   │                       tenant_secret)                                       │
   │            = "d4e5f6a7b8c9…0123"                                          │
   └────────────────────────────────────────────────────────────────────────────┘

   VERIFICATION WALK (verifyLedgerChain(studentId) — 02_Core_Logic §13.4):
   ┌─────────────────────────────────────────────────────────────────────────────┐
   │  for each row in created_at order:                                          │
   │    recompute = sha256(prev_hash || canonical_payload(row) || tenant_secret) │
   │    if recompute ≠ row.this_hash:                                            │
   │      return { valid: false, broken_at: row.id }                             │
   │  return { valid: true }                                                     │
   │                                                                             │
   │  · O(n) per student, n = ledger entries (typically < 100 per student)       │
   │  · surfaces "Tampered ledger at entry {id}" in Settings → Diagnostics       │
   │    (a .glass card with flare accent left-border, §5.4)                      │
   │  · the tutor sees a flare banner: "⚠ Ledger tamper detected at <date>"     │
   │    (.glass + flare accent left-border, §8.3)                                │
   └─────────────────────────────────────────────────────────────────────────────┘

   TAMPER ATTEMPT — what an attacker sees if they edit entry 2's debit_paise:
   ┌─────────────────────────────────────────────────────────────────────────────┐
   │  1. attacker opens the SQLite file directly (would need the SQLCipher key    │
   │     + tenant_secret — already two layers of failure, §25.2 of 10_Security)  │
   │  2. attacker calls db.ledgerEntry.update({ where: { id: 'le-002' },          │
   │       data: { debitPaise: 0 } })                                            │
   │     → BLOCKED by Prisma middleware (ledgerGuard.ts) at the ORM layer         │
   │     → defence-in-depth: SQLite trigger trg_ledger_no_update (§10.1) also     │
   │       aborts any UPDATE on the table                                        │
   │     → raises: "ledger_entries is append-only. Post a reversing entry."       │
   │  3. if the attacker disables triggers and edits anyway:                     │
   │     → this_hash no longer matches recompute                                 │
   │     → entry 3's prev_hash ≠ entry 2's this_hash                             │
   │     → verifyLedgerChain() returns broken_at: 'le-002'                       │
   │     → Diagnostics panel surfaces the break; the ledger is forensic evidence │
   └─────────────────────────────────────────────────────────────────────────────┘

   ↑ canonical_payload = deterministic JSON of
     {id, student_id, type, debit_paise, credit_paise, balance_after_paise,
      occurred_on, tenant_secret} — sorted keys, no whitespace.
   ↑ tenant_secret (32-byte hex in settings) is the pepper — an attacker with
     only the DB file cannot recompute the chain without it. The pepper is
     itself encrypted at rest (SQLCipher + OS keychain — §25.2 of 10_Security).
   ↑ The chain is PER-STUDENT (not global) — a tamper in Aarav's chain does not
     affect Priya's. Verification walks one student at a time (O(n) per student,
     n typically < 100).
```

- ↑ **The chain is tamper-evident, not tamper-proof.** The triggers make casual tamper impossible (UPDATE/DELETE are blocked); a determined attacker who disables triggers cannot recompute `this_hash` without `tenant_secret`, so the chain *detects* the tamper even if it cannot prevent the write.
- ↑ **balance_after_paise is the second line of defence.** A tamper that breaks the hash also breaks the running balance (§8.2 trigger); either detector surfaces the breach.
- ↑ **The verify walk is O(n) per student.** For a tutor with 1,000 students × 50 entries each, full verification is 50,000 SHA-256 ops — under 100ms on a mid-range Android. Run nightly by the Report Engine (`02_Core_Logic.md` §11).

### 18.4 Mockup D3 — student_balance Derived View (the O(1) read path)

```
STUDENT_BALANCE DERIVED VIEW (§15.1) — how the Dashboard KPI 'Due Today' renders

   ┌─ SOURCE TABLE ──────────────────────────────────────────────────────────────┐
   │  ledger_entries (append-only, hash-chained — §8)                            │
   │  ┌─────┬───────────┬──────────────┬──────────────┬──────────────────────┐  │
   │  │ id  │ student_id│ type         │ debit_paise  │ credit_paise         │  │
   │  ├─────┼───────────┼──────────────┼──────────────┼──────────────────────┤  │
   │  │le-001│ s-001    │ FEE_CHARGED  │ 200000       │ 0                    │  │
   │  │le-002│ s-001    │ PAYMENT_RECVD│ 0            │ 200000               │  │
   │  │le-003│ s-001    │ FEE_CHARGED  │ 200000       │ 0                    │  │
   │  └─────┴───────────┴──────────────┴──────────────┴──────────────────────┘  │
   │  (VOID rows are excluded by the view's `le.type <> 'VOID'` predicate;       │
   │   a VOID's reversal effect is carried by its own opposite-direction         │
   │   debit/credit, applied via the trigger-maintained balance_after_paise.)    │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        │
                                        │ the derived view:
                                        ▼
   ┌─ DERIVED VIEW: student_balance (§15.1) — computed via Prisma ORM, no raw SQL ─┐
   │  // O(1) per student via trigger-maintained cache:                          │
   │  db.ledgerEntry.findMany({                                                  │
   │    where: { tenantId, type: { not: 'VOID' } },                              │
   │    orderBy: { createdAt: 'desc' },                                          │
   │    distinct: ['studentId'],                                                 │
   │    select: { studentId: true, balanceAfterPaise: true },                    │
   │  })                                                                         │
   │  // O(n) full recomputation (used by verifyLedgerChain, §18.3):             │
   │  db.student.findMany({                                                      │
   │    where: { tenantId, status: 'active' },                                   │
   │    select: { id: true, ledgerEntries: {                                     │
   │      where: { type: { not: 'VOID' } },                                      │
   │      select: { debitPaise: true, creditPaise: true },                       │
   │    } },                                                                     │
   │  })                                                                         │
   │                                                                              │
   │  for s-001 (Aarav) — no VOIDs yet:                                           │
   │    non-VOID debits  = 200000 (le-001) + 200000 (le-003) = 400000             │
   │    non-VOID credits = 200000 (le-002)                             = 200000   │
   │    ⟹ balance_due_paise = 400000 - 200000 = 200000  (₹2,000 due)             │
   │                                                                              │
   │  ↑ equivalent to the latest non-VOID entry's balance_after_paise —          │
   │    trigger-maintained, so the view is O(1) per student via the cache.        │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        │
                                        │ cached in student_balance_cache (§15)
                                        ▼
   ┌─ CACHE TABLE: student_balance_cache (invalidated on LEDGER_MUTATED event) ──┐
   │  ┌───────────┬────────────────────┬──────────────────────┐                  │
   │  │ student_id│ balance_due_paise  │ last_recomputed_at   │                  │
   │  ├───────────┼────────────────────┼──────────────────────┤                  │
   │  │ s-001     │ 200000             │ 2025-09-02T18:05:00Z │                  │
   │  │ s-002     │ 0                  │ 2025-09-02T18:05:00Z │                  │
   │  │ s-003     │ 150000             │ 2025-09-02T18:05:00Z │                  │
   │  └───────────┴────────────────────┴──────────────────────┘                  │
   └────────────────────────────────────┬────────────────────────────────────────┘
                                        │ read by Dashboard KPI renderer
                                        ▼
   ┌─ Dashboard KPI Strip (4 × .glass cards, §8.1) ─────────────────────────────┐
   │  ┌─ KPI C1: Collected (.glass + emerald left-border, §5.4) ──────────────┐ │
   │  │  ₹ 2,45,500  ↑ 18%                                                    │ │
   │  └────────────────────────────────────────────────────────────────────────┘ │
   │  ┌─ KPI C2: Due Today (.glass + amber left-border, §5.4) ─────────────────┐ │
   │  │  ₹ 48,000   (sum of student_balance where balance_due_paise > 0       │ │
   │  │              AND the student has a batch meeting today)               │ │
   │  └────────────────────────────────────────────────────────────────────────┘ │
   │  ┌─ KPI C3: Present % (.glass + cyan left-border) ────────────────────────┐ │
   │  │  92%                                                                   │ │
   │  └────────────────────────────────────────────────────────────────────────┘ │
   │  ┌─ KPI C4: Students with Dues (.glass + amber left-border) ──────────────┐ │
   │  │  12  ↑ 2  (count of student_balance where balance_due_paise > 0)      │ │
   │  └────────────────────────────────────────────────────────────────────────┘ │
   └──────────────────────────────────────────────────────────────────────────────┘

   ↑ The derived view is the O(1) read path; the cache is invalidated on every
     LEDGER_MUTATED event (post-commit fan-out — §25.4 of 02_Core_Logic).
   ↑ The view is computed on demand for ad-hoc queries; the cache serves the
     Dashboard's KPI strip. The two are equivalent by construction (BR-CALC-03).
   ↑ Money is INTEGER paise at every layer — the view's SUM is integer math,
     never float (BR-M-01, AP-17). The UI divides by 100 only at render time,
     for display purposes.
```

- ↑ **The view is deterministic.** Two tutors with the same ledger rows compute the same balance — no floating-point drift, no timezone ambiguity (timestamps are UTC ISO-8601, P-DM7).
- ↑ **The cache is invalidated, not updated.** A mutation writes to `ledger_entries`; the post-commit fan-out sets a dirty flag on `student_balance_cache`; the next read recomputes and re-caches. This avoids read-time aggregation cost on the Dashboard's hot path.
- ↑ **The Dashboard KPI C2 (Due Today) joins `student_balance_cache` with `batches` and `attendance_sessions` to filter "students with a batch meeting today."** The join is O(students) and runs in < 5ms for 1,000 students (success criterion #5 of `00_Vision.md` §13.1).

---

## 19. Glossary

| Term | Definition |
|------|------------|
| **Paise** | Minor unit of INR (1 rupee = 100 paise); equivalent: cents for USD/EUR/GBP, fils for AED. All monetary columns are `INTEGER` paise. |
| **Tamper hash** | `sha256` over a row's canonical payload + tenant-secret pepper, stored on the row. Reveals silent edits (`10_Security.md` §14). |
| **Hash chain** | Sequence where each row's `this_hash` incorporates the prior row's `this_hash`. Tamper at row N breaks every hash from N on. |
| **Append-only** | Table that accepts `INSERT` only; `UPDATE`/`DELETE` aborted by triggers. Corrections are new rows. |
| **Soft delete** | Marking a row archived (`archived_at IS NOT NULL`). Reversible; preserves history. |
| **Sync outbox** | Durable queue (`sync_outbox` table) of pending mutations to flush to the cloud replica. |
| **Envelope encryption** | Two-layer: DEK encrypts payload, KEK (derived from passphrase) encrypts the DEK. Used for `.buddysaradhi`. |
| **FTS5** | SQLite's full-text search virtual table. Tokenises text, ranks by BM25. Powers Search. |
| **Tenant secret** | 32-byte hex in `settings`, pepper for `tamper_hash`/`this_hash`. Never exported in plaintext. |
| **UUID v7** | 128-bit ID with Unix-ms timestamp — time-sortable, conflict-free offline. |
| **PRAGMA user_version** | SQLite integer recording applied migration version. Bumped per migration. |
| **LWW** | Last-Write-Wins: newer `updated_at` (vector-clock-aware) wins for non-ledger rows. |
| **Void** | Ledger entry of `type='VOID'` that reverses a prior entry via `void_of_id`. |
| **Advance payment** | Payment exceeding outstanding; tracked as negative balance, auto-applied to next `FEE_CHARGED` (BR-LED-06). |

---

This schema is the contract. Every screen spec references these tables by name. Any change here is a spec amendment requiring review of `12_Business_Rules.md`, `14_Edge_Cases.md`, and `10_Security.md` in the same PR.
