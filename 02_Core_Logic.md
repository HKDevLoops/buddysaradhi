# 02 — Core Logic

> The engine room of Buddysaradhi: five visible screens, seven hidden engines, the algorithms they run, and the invariants that bind them. Every line of production logic in the app traces back to a sentence in this file.

---

## 1. The Shell — `GlassShell`

Every screen lives inside one shared shell. The shell is **persistent across navigation** — only the content pane re-renders, never the sidebar or topbar. This is the Discord inheritance.

```
┌───────────────────────────────────────────────────────────┐
│  Topbar: Tenant · Global Search · Command Palette · 👤    │
├──────────┬────────────────────────────────────────────────┤
│  Sidebar │         Content Pane (active screen)           │
│  ◉ Dash  │   ┌──────────────────────────────────────┐     │
│  ◉ Stud  │   │   One of 5 screens renders here      │     │
│  ◉ Attd  │   └──────────────────────────────────────┘     │
│  ◉ Fees  │                                                │
│  ◉ Sett  │                                                │
│  ⚙ Sync  │                                                │
│  ⚡ Cmd K │                                                │
└──────────┴────────────────────────────────────────────────┘
│  Sticky Footer: Status · Last sync · Version · © Buddysaradhi │
└───────────────────────────────────────────────────────────┘
```

### 1.1 Sidebar (five screens + two utilities)

| # | Screen | Logical Route | Icon |
|---|---|---|---|
| 1 | Dashboard | `/` | `LayoutDashboard` |
| 2 | Students | `/students` | `GraduationCap` |
| 3 | Attendance | `/attendance` | `CalendarCheck` |
| 4 | Fees & Payments | `/fees` | `Wallet` |
| 5 | Settings | `/settings` | `Settings` |

> **Routing note.** Only `/` is a real URL route in the web app (per `AGENTS.md` Rule 4 and §13 below). The "Logical Route" column lists the in-shell navigation identifier each sidebar item switches to via Zustand state — the shell never unmounts, and deep links use `?s=students&id=…` query params rather than new URL routes. The identifiers are kept URL-like so they read naturally in specs and audit logs.

Utilities (below the divider, always visible): **Sync status** (`CloudCheck`/`CloudOff`, tap → sync drawer) and **Command Palette** (`Command`, tap or `⌘K`).

### 1.2 Topbar
Tenant (institute) name + logo · global search input (always focused-ready) · date/period filter chip · notifications bell (in-app only) · profile avatar (tap → Settings → Profile).

### 1.3 Sticky Footer (MANDATORY)
Left: connection status (`Online · synced 2m ago` / `Offline · 14 pending`). Centre: app version + build hash. Right: `© Buddysaradhi Omni-Core`. The footer **sticks** to viewport bottom when content < 100vh and is **pushed down** naturally when content overflows (`13_UI_Guidelines.md` §6).

---

## 2. The Five Screens — Surface Map

| Screen | Primary Job | Primary Components | Engines Touched |
|---|---|---|---|
| **Dashboard** | One-glance truth | KPI cards, heatmaps, activity feed, quick actions | Ledger, Reminder, Report, Notification |
| **Students** | Student lifecycle + ledger | Master list, detail drawer, timeline, fee profile, invoices | Ledger, Search, Reminder, Security |
| **Attendance** | Mark, lock, audit | Date picker, batch grid, toggles, lock button, heatmap | Security, Sync, Report |
| **Fees & Payments** | Money truth + actions | Paid/Unpaid/Partial matrix, ledger, receipt generator, reminders | Ledger, Report, Notification, Security |
| **Settings** | Configure + protect | Profile, theme, biometrics/PIN, backups, import/export, rules | Security, Sync, Backup |

---

## 3. Screen State Machines

Each of the five persistent screens is a finite-state machine. Transitions are driven by user intent, engine events, and security gates. The diagrams use the convention `state --event/guard--> state`; mandatory actions are listed beneath each machine.

### 3.1 Dashboard State Machine

```
empty ──onMount──► loading ──data OK──► ready ──sync_completed──► refreshing ──► ready
                       │ error                                  ▲
                       ▼                                       │
                     error ──retry──► loading                (stale render kept)
```

**States:** `empty` · `loading` · `ready` · `refreshing` · `error` · **Guards:** `hasStudents`, `isOnline` · **Actions:** on `ready`, render KPI cards + heatmaps + activity feed; on `refreshing`, show a solar-flare spinner overlay (never block the prior render).

### 3.2 Students State Machine

```
list ──select──► detail_drawer ──edit──► edit_form ──save──► toast_OK ──► list
 │ filter          │ close                                     ▲
 ▼                 ▼                                          │ cancel
filtered         list ◄──────────────────────────────────────┘
 │ dup_key collision
 ▼
merge_confirm ──► list  (FK-aware merge: cascade-updates ledger_entries / attendance_records / student_enrollments .student_id)
```

**States:** `list` · `filtered` · `detail_drawer` · `edit_form` · `create_form` · `merge_confirm` · `delete_confirm` · **Guards:** `dup_key.exists` (BR-STU-02), `hasLedgerEntries` (blocks hard delete — EC-S-06), `PIN.verified` · **Actions:** `LEDGER_MUTATED` event emitted on every successful create/edit.

### 3.3 Attendance State Machine

```
date_picker ──pick date+batch──► batch_grid ──mark per student──► marking ──save──► locked_view
                                                                      ▲                  │ PIN unlock
                                                                      └── unlock_prompt ◄┘
                                                                  (48h elapsed OR manual lock → locked_view; audit-logged)
```

**States:** `date_picker` · `batch_grid` · `marking` · `locked_view` · `unlock_prompt` · `holiday_confirm` · `bulk_confirm` · **Guards:** `session.locked_at IS NULL`, `PIN.verified`, `date <= today` (EC-A-01), `student.status='active'` · **Actions:** `ATTENDANCE_LOCKED` event on lock; `audit_log` row written on every locked-session edit (`action='attendance_edit_locked'`).

### 3.4 Fees & Payments State Machine

```
matrix_view ──select student──► student_ledger ──record payment──► receipt_form ──submit──► commit+PDF
                                     │ void receipt
                                     ▼
                                 void_prompt ──PIN OK──► VOID (compensating entry)
                                     │ PIN fail
                                     ▼
                                 lockout_gate
```

**States:** `matrix_view` · `student_ledger` · `receipt_form` · `void_prompt` · `lockout_gate` · `invoice_generator` · `export_dialog` · **Guards:** `isLedgerEntryLocked(entry)` (24h soft-lock — §6.7), `PIN.verified`, `payment_ref.requiredForCheque` (EC-F-04) · **Actions:** atomic transaction posts `ledger_entries` + `receipts` + (optionally) `invoices.status` update; emits `LEDGER_MUTATED`; receipt PDF rendered synchronously.

### 3.5 Settings State Machine

```
tab_overview ──tab=security──► security_setup ──set PIN──► pin_create ──confirm──► pin_confirmed
                                     │ enable biometric
                                     ▼
                                biometric_enroll
                                     │ export
                                     ▼
                                export_dialog ──type EXPORT──► export_full
```

**States:** `tab_overview` · `profile_edit` · `security_setup` · `pin_create` · `biometric_enroll` · `backup_passphrase` · `restore_flow` · `export_full` · **Guards:** `PIN.verified` (for `export_full` and `restore_flow` — BR-SEC-02), `passphrase.strength >= 3` of 4 zxcvbn bars · **Actions:** `BACKUP_CREATED` / `EXPORT_REQUESTED` events emitted; `audit_log` row written with `actor='tutor'`.

---

## 4. The Seven Hidden Engines — Overview

These are **not** screens. They are subsystems invoked by the five screens, with no sidebar entries, exposing themselves only through panels, toasts, and background work. Each gets a deep dive in §6–§12.

| Engine | Scope | Key property |
|---|---|---|
| **Search** | Students, Payments, Attendance, Receipts, Invoices | SQLite FTS5; rebuilt on sync; grouped results (§8) |
| **Reminder** | Due fees, upcoming dues, missing attendance, inactive students | Local-only; fires on foreground + every 15 min + on sync (§7) |
| **Ledger (SPINE)** | All financial events | Append-only `ledger_entries`; corrections via `reverses_entry_id` (§6) |
| **Report** | Student/attendance/finance/collection | On-demand, never pre-materialised; cache invalidated on ledger mutation (§11) |
| **Notification** | In-app only (no push/email/SMS in v1) | `notifications` table capped at 200 (FIFO); bell + feed + toast (§10) |
| **Sync** | Turso embedded replica (libSQL) | LWW by `updated_at` vector clock; ledger conflict-immune; `sync_outbox` queue (§9) |
| **Security** | App/attendance/payment/bulk-delete locks | PIN/biometric; OS keychain + SQLCipher; every sensitive action audited (§12, `10_Security.md`) |

---

## 5. Engine State Machines

Each engine has an internal state machine (not user-visible; governs background work):

```
Search:    idle ──index_trigger──► indexing ──done──► ready ──query──► querying ──results──► ready
Reminder:  idle ──tick/foreground/sync──► evaluating ──due?──► firing ──► fired (or snoozed/dismissed)
Ledger:    validating ──schema OK──► pin_checking ──PIN OK──► appending ──► hashing ──► emitting_event ──► committed
Report:    idle ──request──► generating ──done──► ready (cache hit) ──LEDGER_MUTATED──► invalidated ──► idle
Notification: idle ──enqueue──► batch_window (≤60s) ──flush──► flushing ──► idle (P1–P3 deferred in quiet hours)
Sync:      idle ──connectivity──► pushing ──ack──► pulling ──apply──► resolving_conflicts ──► indexing_FTS ──► idle
Security:  unlocked ──idle_timeout/cold_start──► locked ──prompt──► pin_entry/biometric ──OK──► unlocked
                   (5x fail → lockout_30s; 10x → lockout_5min; 15x → wipe_local_cache)
```

---

## 6. The Ledger Engine — Deep Dive

The Ledger is the spine of Buddysaradhi. Every rupee that moves becomes one immutable row in `ledger_entries` (`11_Data_Model.md` §3.10). This section defines the engine's invariants, algorithms, and a worked example.

### 6.1 The Append-Only Invariant

> **INV-1 (load-bearing).** `ledger_entries` is INSERT-only. `db.ledgerEntry.update()` and `db.ledgerEntry.delete()` are blocked by Prisma middleware (`packages/core/src/ledgerGuard.ts`) and by SQLite triggers (`11_Data_Model.md` §10.1). Any attempt raises `E_LEDGER_IMMUTABLE` ('ledger_entries is append-only. Post a reversing entry.').

This is the single most important rule in Buddysaradhi. It makes offline-first sync conflict-immune (`12_Business_Rules.md` BR-SYN-02): two devices posting different rows for the same student both land; no merge is needed. It also makes the audit trail trustworthy — no `UPDATE` can silently rewrite history.

### 6.2 Double-Entry Bookkeeping Rules

Buddysaradhi does **not** implement classical double-entry across two named accounts. It uses a **single-account, signed-direction** model: each student has one implicit T-account; every entry carries a `direction` (`charge` increases what the student owes, `credit` decreases it) and a signed `amount` in integer minor units (`12_Business_Rules.md` BR-M-01, BR-LED-01).

The **two-row invariant** is enforced at the service layer: every `PAYMENT_RECEIVED` ledger entry must be accompanied by exactly one `receipts` row, linked via `receipt_id`, written in a single SQLite transaction. If either fails, both roll back — guaranteeing no "orphan receipt" (a fabricated proof of payment) or "orphan credit" (an unverifiable handshake) can exist.

### 6.3 Running-Balance Computation

A student's `balance_due` is **derived**, never stored on the `students` row. The algorithm (BR-CALC-01), implemented via Prisma ORM:

```ts
const balance_due_minor = await db.ledgerEntry.aggregate({
  where: {
    student_id: studentId,
    type: { not: 'VOID' },
    reverses_entry_id: null,
  },
  _sum: {
    debit_paise:  true,  // direction='charge'
    credit_paise: true,  // direction='credit'
  },
});
// balance_due_minor = (sum.debit_paise ?? 0) - (sum.credit_paise ?? 0)
```

The double filter (`type <> 'VOID'` AND `reverses_entry_id IS NULL`) is defence-in-depth: VOID entries are excluded directly, and any entry that reverses another is also excluded so the original isn't double-counted. The `idx_ledger_student` index makes this O(log n + k). Dashboard aggregates use a cached `student_balance_cache` view, invalidated on every `LEDGER_MUTATED` event.

### 6.4 Tamper-Hash Chain

Every `ledger_entries` row carries a `tamper_hash` (added by migration `0007_ledger_chain.sql`; see §22). The hash is computed as:

```
tamper_hash = sha256(prev_hash || entry_id || student_id || type || amount || occurred_on || tenant_secret)
```

`prev_hash` is the immediately preceding entry's hash **for the same `student_id`** (ordered by `occurred_on ASC, created_at ASC`); `tenant_secret` is the per-tenant random generated at provisioning (BR-FEE-05). The first entry uses a genesis hash of 64 zero chars. Tampering with any historical row breaks the chain, detectable by `verifyLedgerChain()` (§13.4). A mismatched hash surfaces a red "TAMPERED" badge and writes `audit_log` `action='ledger_tamper_detected'` (EC-SEC-03).

### 6.5 Receipt Number Generation

Receipt numbers use the canonical format **`RCT-YYYY-NNNNNN`** — `YYYY` = year of `received_on`, `NNNNNN` = per-tenant, per-year zero-padded sequence from `receipt_sequences(tenant_id, year, next_seq)` (separate from the legacy `settings.next_receipt_seq` flat counter):

```ts
// Atomic increment inside the enclosing db.$transaction — holds a row lock,
// eliminating the two-device race (EC-F-08 mirrors this for invoices).
const updated = await tx.receiptSequence.update({
  where: { tenant_id_year: { tenant_id: tenantId, year } },
  data: { next_seq: { increment: 1 } },
  select: { next_seq: true },
});
const seq = updated.next_seq - 1;  // formatted as RCT-{year}-{seq:06d}
```

The atomic increment inside `db.$transaction` holds a row lock for the enclosing transaction, eliminating the two-device race (EC-F-08 mirrors this for invoices). Voids never decrement the counter — gaps are intentional and auditable (BR-RC-01).

### 6.6 Void vs. Reverse Semantics

Buddysaradhi has **one** reversal mechanism: the `VOID` entry type. There is no separate "REVERSE" type in v1.

- **VOID**: A new `ledger_entries` row with `type='VOID'`, `direction` opposite to the original, `amount` equal, `reverses_entry_id` pointing at the original. The original row is **not modified** (append-only). Derived balances exclude both via the `reverses_entry_id IS NULL` filter; both rows remain for audit.
- **ADJUSTMENT**: For non-cancelling corrections (e.g., wrong `description`), post a new `ADJUSTMENT` entry that does **not** reference the original.
- **Cascade constraints**: Voiding a `FEE_CHARGED` that has `PAYMENT_RECEIVED` credits against it is **blocked** (`12_Business_Rules.md` BR-LED-04, `14_Edge_Cases.md` EC-F-06). The tutor must void the receipts first.

### 6.7 Lock-After-24h Rule

A ledger entry is **soft-locked** 24 hours after its `created_at`. The lock windows form a graduated escalation:

| Age | Void permission | Requirements |
|---|---|---|
| 0–24h | Free void | PIN (BR-SEC-02) |
| 24h–30d | Backdated void | PIN + typed reason + `audit_log` `action='backdated_ledger_void'` |
| > 30d | Hard-locked | "Request unlock" flow (tutor types reason; system unlocks for 1 hour; all edits double-audited) — mirrors attendance's BR-ATT-07 |

The `isLedgerEntryLocked()` predicate (§13.2) is the single source of truth. The 24h ledger window is distinct from the 48h attendance lock (BR-ATT-03); both are configurable, with different defaults because financial corrections carry different risk than attendance corrections.

### 6.8 Worked Example Ledger (with hash chain)

Student **Aarav Sharma** (`stu-aarav-001`), tenant secret `buddysaradhi-demo-secret-2025` (sample only — production secrets are 32-byte random). Six entries across Aug–Sep 2025. Hashes computed via `sha256(prev_hash || entry_id || student_id || type || amount || occurred_on || tenant_secret)`; prefixes shown for readability (full values are 64-char hex):

| # | type | dir | amount | date | reverses | prev_hash | tamper_hash | running balance |
|---|---|---|---|---|---|---|---|---|
| 1 | FEE_CHARGED | charge | 500000 | 2025-08-01 | — | `00000000` | `271c96bb` | +₹5,000 (Aug fee) |
| 2 | PAYMENT_RECEIVED | credit | 500000 | 2025-08-05 | — | `271c96bb` | `d423aeea` | ₹0 (paid in full) |
| 3 | FEE_CHARGED | charge | 500000 | 2025-09-01 | — | `d423aeea` | `5a651221` | +₹5,000 (Sep fee) |
| 4 | PAYMENT_RECEIVED | credit | 200000 | 2025-09-08 | — | `5a651221` | `a45058c4` | +₹3,000 (partial) |
| 5 | VOID | charge | 200000 | 2025-09-09 | entry #4 | `a45058c4` | `fd0d9903` | +₹5,000 (cheque bounced) |
| 6 | DISCOUNT_GRANTED | credit | 50000 | 2025-09-10 | — | `fd0d9903` | `836e0b39` | +₹4,500 (10% sibling) |

Running balance excludes the voided pair (#4, #5) via `reverses_entry_id IS NULL`. If an attacker edits entry #3's amount to 400000 directly in SQLite, the recomputed hash won't match `5a651221`; entry #4's `prev_hash` expects that value, so `verifyLedgerChain()` flags #3 as `broken_at`.

---

## 6.9 The Fee-Rate Engine — Deep Dive (the monthly-fee model)

The engine that operationalises `BR-FEE-20..25` and `BR-CALC-09..11`. It owns the **per-student monthly fee** — the base unit for every fee calculation in Buddysaradhi. The user's explicit ask: *"each student has a specific monthly amount … show quarterly and annually … use it in calculations as that is what happens in real."* This engine is the answer.

### 6.9.1 The Mental Model

```
   ┌─────────────────────────────────────────────────────────────────┐
   │  THE MONTHLY FEE IS THE BASE UNIT                                │
   │                                                                 │
   │  monthly_fee_paise  ──▶  the base (e.g. ₹1,500 = 150000 paise) │
   │       │                                                         │
   │       ├──▶ expectedForMonth  = monthly_fee                      │
   │       ├──▶ expectedForQuarter = monthly_fee × 3                 │
   │       ├──▶ expectedForYear   = monthly_fee × 12                 │
   │       │                                                         │
   │       └──▶ fee_frequency determines WHEN the charge is due:     │
   │             monthly  → 1 charge/month  (amount = monthly_fee)   │
   │             quarterly → 1 charge/3mo   (amount = monthly_fee×3) │
   │             annual   → 1 charge/year   (amount = monthly_fee×12)│
   │                                                                 │
   │  the monthly amount never changes because of frequency;          │
   │  frequency only changes the billing cadence.                     │
   └─────────────────────────────────────────────────────────────────┘
```

### 6.9.2 FeeRateEngine — API Surface

```ts
// packages/core/src/feeRateEngine.ts  (pure functions over a Prisma tx handle)

export const FeeRateEngine = {
  // Set the initial fee at enrolment. Creates the first student_fee_rates row
  // and the denormalised cache on students. Also seeds the fee_plan.
  async setInitialRate(tx, { studentId, monthlyFeePaise, frequency, effectiveFrom }) {
    // 1. validate: monthlyFeePaise >= 0, integer paise (BR-FEE-01)
    // 2. create student_fee_rates row (effectiveFrom, effectiveTo: null)
    // 3. update students.monthly_fee_paise + students.fee_frequency (cache)
    // 4. FeeEngine.regenerateSchedule(tx, studentId) — generates fee_schedule_items
    //    from the auto-created fee_plan (cycle=frequency, base_amount=monthly×multiplier)
    // ALL in the same tx (BR-FEE-21)
  },

  // Change the fee. Append-only: new row + close the prior row + update cache.
  async changeRate(tx, { studentId, newMonthlyFeePaise, effectiveFrom, reason, prorate }) {
    // 1. find current row (effective_to IS NULL)
    // 2. set prior.effective_to = dayBefore(effectiveFrom)
    // 3. create new row (effectiveFrom, effectiveTo: null, reason)
    // 4. update students cache
    // 5. FeeEngine.regenerateSchedule — diffs schedule items from effectiveFrom forward
    //    (past items untouched — they were charged at the old rate, correctly)
    // effectiveFrom defaults to first-of-next-month (BR-FEE-22); prorate is explicit opt-in
  },

  // Read the rate effective on a given date (for historical calculations).
  async rateOn(tx, { studentId, date }) {
    return tx.studentFeeRate.findFirst({
      where: { studentId, effectiveFrom: { lte: date },
               OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
      orderBy: { effectiveFrom: 'desc' },
    });
  },

  // Read the full history (for the fee-history timeline in the student detail).
  async history(tx, { studentId }) {
    return tx.studentFeeRate.findMany({
      where: { studentId }, orderBy: { effectiveFrom: 'asc' },
    });
  },
};
```

### 6.9.3 The Pure Calc Functions (`packages/shared/src/feeCalc.ts`)

These are **pure** — no side effects, no mutations, safe to call from any client or server. They take a `db` (or `tx`) handle and return integer paise. They are the single source of truth for "expected," "collected," and "arrears" everywhere in the product.

```ts
// ── EXPECTED ──────────────────────────────────────────────────────
export async function expectedForPeriod(db, studentId, fromMonth, toMonth): Promise<number> {
  // 1. fetch all fee_rate rows overlapping [fromMonth, toMonth]
  // 2. fetch the student's enrolment history (for paused/inactive months → 0)
  // 3. walk month-by-month from fromMonth..toMonth:
  //      rate = rateOn(studentId, firstOfMonth(month))
  //      active = enrolmentActive(studentId, month)   // BR-FEE-23
  //      expected += active ? rate.monthlyFeePaise : 0
  // 4. return sum (paise)
}

export const expectedForMonth  = (db, s, m) => expectedForPeriod(db, s, m, m);
export const expectedForQuarter = (db, s, year, q) =>
  expectedForPeriod(db, s, `${year}-${(q-1)*3+1}-01`.slice(0,7), `${year}-${q*3}-01`.slice(0,7));
export const expectedForYear   = (db, s, year) =>
  expectedForPeriod(db, s, `${year}-01`, `${year}-12`);

// ── COLLECTED ─────────────────────────────────────────────────────
export async function collectedForPeriod(db, studentId, fromDate, toDate): Promise<number> {
  const credits = await db.ledgerEntry.aggregate({
    where: { studentId, type: 'PAYMENT_RECEIVED', occurredOn: { gte: fromDate, lte: toDate } },
    _sum: { creditPaise: true },
  });
  const refunds = await db.ledgerEntry.aggregate({
    where: { studentId, type: 'REFUND_ISSUED', occurredOn: { gte: fromDate, lte: toDate } },
    _sum: { debitPaise: true },
  });
  return (credits._sum.creditPaise ?? 0) - (refunds._sum.debitPaise ?? 0);
}
export const collectedForMonth = (db, s, m) => collectedForPeriod(db, s, `${m}-01`, `${m}-31`);

// ── ARREARS ───────────────────────────────────────────────────────
export async function arrearsForPeriod(db, studentId, fromMonth, toMonth): Promise<number> {
  const expected  = await expectedForPeriod(db, studentId, fromMonth, toMonth);
  const collected = await collectedForPeriod(db, studentId, `${fromMonth}-01`, `${toMonth}-31`);
  const waivers   = await db.ledgerEntry.aggregate({
    where: { studentId, type: 'DISCOUNT_GRANTED', occurredOn: { gte: `${fromMonth}-01`, lte: `${toMonth}-31` } },
    _sum: { creditPaise: true },
  });
  return expected - collected - (waivers._sum.creditPaise ?? 0);
  // < 0 → advance (emerald, BR-M-04); > 0 → arrears (flare); = 0 → settled
}
export const arrearsForMonth = (db, s, m) => arrearsForPeriod(db, s, m, m);

// ── TENANT ROLLUP (Dashboard KPI) ─────────────────────────────────
export async function expectedThisMonthAcrossTenant(db, tenantId): Promise<number> {
  // O(1) thanks to the denormalised cache on students.monthly_fee_paise
  const result = await db.student.aggregate({
    where: { tenantId, status: 'active', monthlyFeePaise: { not: null } },
    _sum: { monthlyFeePaise: true },
  });
  return result._sum.monthlyFeePaise ?? 0;
}
```

### 6.9.4 Where These Functions Are Called

| Caller | Function | Purpose |
|---|---|---|
| Dashboard C1 "Collected This Month" | `collectedForMonth` (tenant rollup) | the real collected figure |
| Dashboard C3 "Expected This Month" | `expectedThisMonthMonthAcrossTenant` | the real target — sum of all monthly fees |
| Dashboard C2 "Arrears" | `arrearsForMonth` (tenant rollup) | expected − collected, to the paise |
| Fees screen overview row | `arrearsForMonth(student, currentMonth)` | per-student arrears column |
| Fees screen M/Q/Y toggle | `expectedForMonth/Quarter/Year` + `collectedForMonth/Quarter/Year` + `arrearsForMonth/Quarter/Year` | the three views the user asked for |
| Student detail → Fee tab | `FeeRateEngine.history` + `arrearsForYear` | fee-history timeline + annual expected |
| Reminder Engine | `arrearsForMonth(student, today's month)` | fire reminder iff arrears > 0 (BR-FEE-23: paused students have 0 arrears) |
| Report Engine → Monthly collection report | `expectedForMonth` + `collectedForMonth` per student | the report rows |
| Receipt "applied to month" | `expectedForMonth` to show which month the payment covers | receipt context |

### 6.9.5 Worked Example — Riya, ₹1,500/month, quarterly view

```
   Riya Sharma · STU-0007 · monthly_fee = ₹1,500 (150000 paise) · frequency = monthly

   ┌─ FEE HISTORY (student_fee_rates) ─────────────────────────────────┐
   │  2025-01-01 → (current)  ₹1,500/mo  reason: "Enrolment"           │
   │  2025-07-01 → (current)  ₹1,800/mo  reason: "Annual revision"     │
   │  (the Jan row's effective_to = 2025-06-30; July row is current)    │
   └───────────────────────────────────────────────────────────────────┘

   Q3 2025 (Jul–Sep) expected:
     expectedForMonth(Jul) = ₹1,800   (July rate)
     expectedForMonth(Aug) = ₹1,800
     expectedForMonth(Sep) = ₹1,800
     expectedForQuarter(Q3) = ₹5,400

   Q3 2025 collected:
     collectedForPeriod(2025-07-01, 2025-09-30) = ₹5,400  (paid Aug 5, Sep 5, Sep 28)

   Q3 2025 arrears:
     arrearsForQuarter(Q3) = ₹5,400 − ₹5,400 − ₹0 = ₹0  (settled)

   Annual 2025 expected:
     expectedForYear(2025) = (₹1,500 × 6) + (₹1,800 × 6) = ₹9,000 + ₹10,800 = ₹19,800
     (Jan–Jun at old rate, Jul–Dec at new rate — the effective-dated history makes this exact)

   The tutor sees, on the Fees screen, the M/Q/Y toggle:
   ┌──────────────────────────────────────────────────────┐
   │  Riya Sharma           [ Month | Quarter | Year ]    │
   │  Monthly fee: ₹1,800 (since Jul 2025)                │
   │                                                       │
   │  ● Quarter (Q3 2025)                                  │
   │    Expected   ₹ 5,400                                 │
   │    Collected  ₹ 5,400                                 │
   │    Arrears    ₹     0   ✓ settled                     │
   │                                                       │
   │  fee history: ₹1,500 (Jan–Jun) → ₹1,800 (Jul–now)    │
   └──────────────────────────────────────────────────────┘
```

This is the "use it in calculations as that is what happens in real" payoff: every number on every screen traces back to `monthly_fee_paise × period`, using the rate that was effective then.

---

## 7. The Reminder Engine — Deep Dive

### 7.1 Scheduling Model

Reminders are driven by **two clocks**: a cron-like tick (every 15 min while foregrounded + on `app.foreground` + on `SYNC_COMPLETED` — no background daemon in v1) and an ad-hoc hook (`LEDGER_MUTATED` and `ATTENDANCE_LOCKED` trigger immediate re-evaluation for the affected `student_id` / `batch_id`).

### 7.2 Channel Priority

When a reminder fires, it is dispatched through a strict cascade:

1. **In-app** (always) — bell badge + Dashboard panel.
2. **wa.me deep link** (on-demand, tutor-initiated) — the reminder card exposes a "Message on WhatsApp" button that opens `https://wa.me/<guardian_phone>?text=<prefilled>`. Buddysaradhi does **not** auto-send; the tutor taps.
3. **System notification** — only for `due_fee` and `missing_attendance` when backgrounded AND OS permission granted. Opt-in, off by default in v1.

### 7.3 Dedup Strategy

A reminder's identity is the composite key `(tenant_id, category, ref_type, ref_id, due_at::date)`. The engine upserts on this key — only one `pending` reminder per key. A second fire touches the existing reminder's `updated_at` and enqueues no new notification, preventing the "10 notifications for the same overdue fee" failure mode.

### 7.4 Snooze Semantics

Per BR-RPT-05: **Today end-of-day** (snooze_until = 23:59 local), **3 days** (now + 3 days), **Dismiss** (permanent — status=`dismissed`, never re-fires for this key unless the underlying condition changes, e.g., the invoice is paid and a new one is generated).

### 7.5 "No Engagement Notifications" Anti-Principle

Buddysaradhi will **never** send a notification of the form "You haven't opened the app in 3 days" or "Engagement dropped — log in now." These are anti-patterns from consumer social apps that have no place in a tool a tutor pays for. Every reminder must be **data-driven** (a real fee is due, a real session is missing) and **actionable** (tapping it opens the screen with the record pre-selected). Enforced by code review — no `REMINDER_DUE` event may carry `category='engagement'` or any synonym (`01_Product_Principles.md` AP-4).

---

## 8. The Search Engine — Deep Dive

### 8.1 FTS5 Schema

The Search Engine uses SQLite FTS5 over three virtual tables (`11_Data_Model.md` §6): `students_fts` (first_name, last_name, code, phone, email, school, grade), `invoices_fts` (number, student_name), `receipts_fts` (number, student_name, payment_ref). A `search_index` materialised view joins the three so a single query returns grouped results. Triggers keep each FTS table in sync on INSERT/UPDATE/DELETE.

### 8.2 Ranking Algorithm

The ranker combines three signals: `bm25_rank` (FTS5 native, normalised to [0,1]) + `0.30 * recency_factor` (`1 / (1 + days_since_updated)`) + `0.20 * user_weight` (`clicks_on_entity / max_clicks_any_entity`).

- **BM25** is the FTS5 default via the `rank` column. Exact prefix matches (e.g., query "RCT-2025-00" matching `RCT-2025-000042`) get an implicit boost — FTS5 tokenises hyphens as separators.
- **Recency factor** rewards recently-updated rows — a tutor searching "Aarav" probably means the Aarav they just marked present, not an archived Aarav from 2023.
- **User weight** is a per-tutor click histogram in `app_state.search_clicks` (JSON). Bounded so a single heavy-clicked entity can't dominate every query.

### 8.3 Indexing Triggers

- **`db.student.create()` / `db.student.update()` / `db.invoice.create()` / `db.receipt.create()`** (and the equivalent updates) → a Prisma `after`-hook updates the corresponding FTS table.
- **`SYNC_COMPLETED` event** → if `schema_version` changed or sync brought > 100 new rows, the engine issues a full FTS rebuild (`INSERT INTO …fts(fts) VALUES('rebuild')`). This is a SQLite-level FTS5 admin command with no Prisma ORM equivalent; it is invoked once per sync batch by `lib/search/rebuildFts.ts`, never in a per-row runtime hot path.
- **Soft-delete** (`archived_at` set) → FTS row is **not** deleted; it is demoted in rank (`recency_factor → 0`) and shown with a grey "archived" chip so historical searches still work.

### 8.4 "Searchable-From-Any-Screen" Principle

The topbar global search input is **always mounted** in `GlassShell`, never in any screen component. A tutor can type `⌘K` from anywhere and get grouped results. Tapping a result navigates the shell to the owning screen with the entity pre-selected. This is the **searchable-from-any-screen** invariant (INV-11, §14).

---

## 9. The Sync Engine — v1 Stub + v2 Design

### 9.1 v1 Stub (Local-Only)

In v1, the Sync Engine is a **stub**. The `sync_outbox` table exists and every mutation writes to it (INV-3, §14), but the flush routine is a no-op that logs intent:

```ts
async function flushOutbox() {
  const pending = await db.sync_outbox.count({ where: { status: 'pending' } });
  if (pending === 0) return;
  console.info(`[sync-stub] ${pending} rows pending flush — v1 is local-only`);
  // v2: actually push to Turso
}
```

v1 ships as a **local-first single-device app** with cloud-replica scaffolding in place. The Turso DB is provisioned (cloud login + JWT), but no data flows to it. The `sync_outbox` contract is exercised from day one, so when v2 ships, the only change is the flush implementation.

### 9.2 v2 Design — Vector Clocks & Conflict Resolution

v2 introduces bidirectional sync. Each row carries a **vector clock** (`Record<deviceId, lamportCounter>`) in a `sync_meta` sidecar table (avoids the append-only trigger on `ledger_entries`). `mergeClocks` is per-key max; `compareClocks` returns `'before' | 'after' | 'equal' | 'concurrent'` (concurrent = a has ≥1 key > b AND b has ≥1 key > a).

**Conflict resolution** by row type:

| Row type | Strategy | Rationale |
|---|---|---|
| `ledger_entries` | Append-only, no merge | UUID-keyed; both versions land (`12_Business_Rules.md` BR-SYN-02) |
| `receipts` | LWW by `updated_at` | Linked to ledger; if ledger is conflict-immune, receipt picks one version |
| `students`, `batches`, `fee_plans` | LWW by `updated_at` | Last edit wins; loser written to `audit_log` `action='sync_conflict_lost'` |
| `attendance_records` | LWW by `updated_at` | Same; `14_Edge_Cases.md` EC-A-07 |
| `settings` | Field-level merge | Non-destructive; each field takes the latest writer |

### 9.3 Push/Pull Protocol Sketch

```
1. PUSH  client → server: ≤50 sync_outbox rows (status='pending')
         server: apply each (LWW non-ledger, INSERT ledger) → ack with applied_at + conflicts[]
         client: mark rows 'sent' (or 'conflict' if lost LWW)
2. PULL  client → server: GET rows WHERE updated_at > last_pull_at
         server → client: ≤500 rows + new server vector_clock; client applies (same rules), updates last_pull_at
3. INDEX if schema_version changed OR >100 rows pulled → rebuild FTS
4. EVENT emit SYNC_COMPLETED { pending, conflicts }
```

Flush cadence: every 30s when online, immediately on `online` event, and on app background (mobile only). A row that fails 5 times is marked `status='conflict'` and surfaced in the Sync drawer for manual review (EC-SY-02).

---

## 10. The Notification Engine — Deep Dive

### 10.1 Channels & Priority Levels

| Priority | Triggers | Channels | Toast? |
|---|---|---|---|
| **P0** | Payment recorded, receipt voided, backup completed | Bell + toast | Yes (3s, dismissable) |
| **P1** | Reminder due (fee/attendance) | Bell + system notification (if permissioned) | No |
| **P2** | Sync status change, conflict detected | Footer only | No |
| **P3** | Audit/system events (e.g., tamper detected) | Bell only | No |

### 10.2 Quiet Hours

Configurable in Settings (default 22:00–07:00 local). **P0** still surfaces (a tutor recording a payment at 11 PM expects feedback); **P1–P3** are deferred to `deferred_queue` and flushed at quiet-hours-end in a single batch. The "missing attendance" reminder (BR-RPT-03) is an exception — it fires at 21:00 local, before quiet hours begin, so it is never deferred.

### 10.3 Batching

Notifications of the **same category** within a 60-second window collapse into one bell entry: "3 fees due — Aarav, Diya, Kabir." This prevents the "10 dings in a minute" failure mode on sync backlogs. The FIFO cap of 200 rows (`11_Data_Model.md` §3.13) is enforced after batching — 200 is the cap on **distinct** notifications, not raw events.

---

## 11. The Report Engine — Deep Dive

### 11.1 Period Closing Algorithm

The Report Engine never pre-materialises. Every report is computed on demand from `ledger_entries` + `attendance_records`. The `closeReportingPeriod()` algorithm (§13.5) takes `(tenant_id, start, end)` and produces a closed snapshot: (1) `audit_log` `action='period_closed'`; (2) compute aggregates (charged, collected, outstanding, attendance %); (3) bucket outstanding into aging buckets; (4) render (glass card / PDF / Excel); (5) cache in-memory keyed by `(tenant_id, start, end)` — invalidated on the next `LEDGER_MUTATED` or `ATTENDANCE_LOCKED`. Closing is **idempotent** and does **not** lock the underlying ledger — tutors can still backdate entries (PIN + audit, per BR-LED-05); the next report supersedes.

### 11.2 Fee-Aging Buckets

Outstanding balances are bucketed by how long the oldest unpaid charge has been overdue: **Current** (not yet due, emerald), **1–30** (amber), **31–60** (solar flare), **60+** (red). Computed per `fee_schedule_item` (not per student) so a student with one current item and one 60+ item appears in both. The Fees screen matrix shows the bucket as a chip on each row.

### 11.3 Attendance Rate Computation

Per `12_Business_Rules.md` BR-CALC-06: `pct = 100 * present / (present + absent + late)`. `excused` and `holiday` are excluded from the denominator; `late` counts as present in the numerator but is flagged separately in reports. Monthly attendance reports also surface `late_count` and `excused_count` as secondary columns.

### 11.4 Export Pipeline

`request → gather (SQL) → transform (JSON → worksheet rows) → render (ExcelJS / React-pdf) → cache (in-memory, 5 min TTL) → user downloads → audit_log (action='export', metadata={scope, format, rows})`. Excel exports use the 3-worksheet format (BR-BAT-03); PDFs are for single-student statements and receipts. Exports never block the UI — background job + toast on completion.

---

## 12. The Security Engine — Deep Dive

### 12.1 PIN Gate Flow

Every sensitive action (the allowlist in §12.3) passes through the same PIN gate: (1) action requested → Security Engine intercepts; (2) if `app_lock_state='locked'` → require unlock first (PIN or biometric); (3) even if unlocked → require PIN re-entry (defence-in-depth, BR-SEC-02); (4) PIN entered → argon2id verify against `settings.pin_hash`; (5a) OK → audit_log + proceed; (5b) fail → increment fail_count → lockout policy (§12.4).

The PIN is **never stored in plaintext**; only the argon2id hash lives in `settings.pin_hash`. The PIN itself is held in memory for ≤ 200ms during verification, then zeroed.

### 12.2 Biometric Fallback

If `settings.biometric_enabled=1`, biometric is tried **first**. **Success** → proceed (no PIN entry; audit log records `actor='biometric'`). **Fail 3×** or **hardware unavailable** → auto-fallback to PIN (EC-SEC-02). No data lockout; the tutor always has a PIN path. **Enrolment** happens in Settings → Security → Enable Biometric, and requires a current PIN (so biometric can't be set up by someone with momentary access).

### 12.3 Sensitive-Action Allowlist

Only these actions trigger the PIN gate (everything else is free):

| Action | Reason |
|---|---|
| Void a receipt / Backdated ledger entry | Reverses or pre-dates a financial record |
| Unlock attendance session | Edits frozen data |
| Bulk delete students | Destructive, irreversible |
| Full database export / Backup restore | Exfiltrates or overwrites local state |
| Disable biometric / Change PIN | Security-critical config |

### 12.4 Lockout Policy

Per `10_Security.md` §3.4 and `12_Business_Rules.md` BR-SEC-01:

| Failed | Consequence |
|---|---|
| 1–4 | Toast "Wrong PIN. N attempts left." |
| 5 | 30-second lockout |
| 6–9 | Toast + lockout extends |
| 10 | 5-minute lockout |
| 11–14 | Lockout extends |
| 15 | **Wipe local cache** (`audit_log` `action='pin_brute_force_wipe'`); cloud DB intact; force re-login |

The wipe is of the **local cache only** — the Turso cloud DB and `.buddysaradhi` backup files are untouched. The tutor re-logs in via Supabase and re-syncs.

---

## 13. Core Algorithms — Pseudocode Reference

The six algorithms below are the single source of truth. Re-implementing them in a second place is a P1 bug (`12_Business_Rules.md` §11).

### 13.1 `computeRunningBalance(studentId)`

```ts
async function computeRunningBalance(studentId: string): Promise<number> {
  const rows = await db.ledger_entries.findMany({
    where: { student_id: studentId, type: { not: 'VOID' }, reverses_entry_id: null },
    orderBy: [{ occurred_on: 'asc' }, { created_at: 'asc' }],
  });
  return rows.reduce((b, e) => b + (e.direction === 'charge' ? e.amount : -e.amount), 0);
}
```

For Dashboard aggregates, prefer the SQL version (§6.3) — it's O(log n + k) vs O(k) with network round-trips.

### 13.2 `isLedgerEntryLocked(entry)`

```ts
function isLedgerEntryLocked(entry: LedgerEntry, now: Date = new Date()): LockState {
  const ageHours = (now.getTime() - new Date(entry.created_at).getTime()) / 3_600_000;
  if (ageHours < 24)     return { state: 'soft_open',   reason: 'within_24h_window' };
  if (ageHours < 24 * 30) return { state: 'soft_locked', reason: 'backdated_void_requires_reason' };
  return { state: 'hard_locked', reason: 'request_unlock_flow_required' };
}
```

### 13.3 `shouldFireReminder(reminder, now)`

```ts
function shouldFireReminder(r: Reminder, now: Date, s: Settings): boolean {
  if (r.status !== 'pending') return false;
  if (r.snooze_until && new Date(r.snooze_until) > now) return false;
  if (new Date(r.due_at) > now) return false;
  // Quiet hours: P1 reminders (fee/attendance) deferred unless past 21:00 grace
  const h = now.getHours();
  const inQuiet = h >= s.quiet_hours_start || h < s.quiet_hours_end;
  const isP1 = r.category === 'due_fee' || r.category === 'missing_attendance';
  if (inQuiet && isP1 && h < 21) return false;
  return true;
}
```

### 13.4 `verifyLedgerChain(studentId)`

```ts
async function verifyLedgerChain(studentId: string): Promise<{ valid: boolean; broken_at?: string }> {
  const entries = await db.ledger_entries.findMany({
    where: { student_id: studentId }, orderBy: [{ occurred_on: 'asc' }, { created_at: 'asc' }],
  });
  const secret = await getTenantSecret();
  let prevHash = '0'.repeat(64);
  for (const e of entries) {
    const expected = sha256(`${prevHash}|${e.id}|${e.student_id}|${e.type}|${e.amount}|${e.occurred_on}|${secret}`);
    if (expected !== e.tamper_hash) return { valid: false, broken_at: e.id };
    prevHash = e.tamper_hash;
  }
  return { valid: true };
}
```

### 13.5 `closeReportingPeriod(tenantId, start, end)`

```ts
async function closeReportingPeriod(tenantId: string, start: string, end: string) {
  await db.$transaction(async (tx) => {
    const charged   = await sumLedger(tx, tenantId, 'FEE_CHARGED',     start, end);
    const collected = await sumLedger(tx, tenantId, 'PAYMENT_RECEIVED', start, end);
    const aging      = await computeAgingBuckets(tenantId, end);
    const attendance = await computeAttendanceRates(tenantId, start, end);
    await tx.audit_log.create({ data: { actor: 'tutor', action: 'period_closed',
      metadata: { start, end, charged, collected, outstanding: charged - collected, aging } } });
    reportCache.set(`${tenantId}:${start}:${end}`, { charged, collected, outstanding: charged - collected, aging, attendance });
  });
}
```

### 13.6 `voidLedgerEntry(entryId, actor, reason)` — PIN gate + compensating entry

```ts
async function voidLedgerEntry(entryId: string, actor: string, reason: string) {
  const original = await db.ledger_entries.findUnique({ where: { id: entryId } });
  if (!original) throw new NotFoundError('ledger_entry', entryId);
  await securityEngine.requirePin(`void_ledger:${entryId}`);  // 1. PIN gate (BR-SEC-02)

  // 2. Lock-window check (24h soft / 30d hard — §6.7)
  const lock = isLedgerEntryLocked(original);
  if (lock.state === 'hard_locked') throw new LockedError('ledger_entry_hard_locked', 'Use Request Unlock flow');
  if (lock.state === 'soft_locked' && !reason) throw new ValidationError('reason_required', 'Backdated voids require a typed reason');

  // 3. Cascade check (BR-LED-04): can't void a charge that has credits against it
  if (original.type === 'FEE_CHARGED') {
    const credits = await db.ledgerEntry.findMany({ where: { studentId: original.studentId,
      type: 'PAYMENT_RECEIVED', occurredOn: { gte: original.occurredOn } } });
    if (credits.length > 0) throw new ConflictError('fee_has_payments', 'Void the receipts first', { credits: credits.map(c => c.id) });
  }

  // 4. Post compensating VOID entry (append-only — never call db.ledgerEntry.update on the original)
  const voidEntry: LedgerEntry = {
    id: uuidv7(), tenantId: original.tenantId, studentId: original.studentId, invoiceId: original.invoiceId,
    type: 'VOID', amount: original.amount, direction: original.direction === 'charge' ? 'credit' : 'charge',
    reversesEntryId: original.id, description: `VOID: ${reason}`, occurredOn: todayLocal(),
    createdAt: nowIso(), source: 'manual', tamperHash: '',
  };
  voidEntry.tamperHash = await computeNextHash(original.studentId, voidEntry);

  // 5. Atomic txn: VOID entry + receipt.voided_at + audit_log + event
  await db.$transaction(async (tx) => {
    await tx.ledgerEntry.create({ data: voidEntry });
    if (original.receiptId) await tx.receipt.update({ where: { id: original.receiptId }, data: { voidedAt: nowIso() } });
    await tx.auditLog.create({ data: { actor, action: 'payment_void', refId: entryId, metadata: { reason, voidEntryId: voidEntry.id } } });
  });
  eventBus.emit({ type: 'LEDGER_MUTATED', studentId: original.student_id, entryId: voidEntry.id });
  return voidEntry;
}
```

---

## 14. Cross-Cutting Invariants

Every engine, screen, and migration must respect these. A PR that violates one is rejected at review.

| ID | Invariant | Enforced by |
|---|---|---|
| **INV-1** | Ledger is append-only. No UPDATE/DELETE on `ledger_entries`. | SQLite triggers (`11_Data_Model.md` §5) |
| **INV-2** | No network call from a screen component. All access via TanStack Query + engines. | ESLint `no-fetch-in-components` |
| **INV-3** | Every state mutation writes to `sync_outbox`. | Service-layer wrapper (`withOutbox()`) |
| **INV-4** | Every reminder respects quiet-hours. P0 excepted; P1–P3 deferred. | `shouldFireReminder()` (§13.3) |
| **INV-5** | Money is always integer minor units. No float arithmetic on currency. | Zod schema + branded type `MinorUnits` |
| **INV-6** | Every sensitive action writes `audit_log` in the same transaction as the mutation. | `withAudit()` decorator |
| **INV-7** | The shell never unmounts on navigation. Only the content pane re-renders. | Zustand `activeScreen` state |
| **INV-8** | Schema migrations are forward-only. No down migrations. | Migration runner refuses `DROP TABLE` without amendment |
| **INV-9** | All timestamps are ISO-8601 UTC. Local formatting happens only at render. | Zod `.datetime()` on every timestamp field |
| **INV-10** | No student auth in v1. No `password`/`last_login`/`session_token` on `students`. | `principles/no-student-auth.py` CI lint |
| **INV-11** | Global search is mounted in the shell, not in any screen. Works from every screen. | `GlassShell` layout test |
| **INV-12** | The footer is always visible (sticky or pushed). Never hidden by content overflow. | Playwright footer-visibility test |
| **INV-13** | No indigo or blue as a primary accent. Indigo→violet is the neutral canvas only. | ESLint `no-indigo-accent` (`13_UI_Guidelines.md` §1.3) |
| **INV-14** | Every receipt carries a `tamper_hash`. Mismatch surfaces a "TAMPERED" badge. | `verifyLedgerChain()` scheduled sweep |

---

## 15. Engine Dependency Graph

```
                         ┌──────────────┐
                         │   Security   │ ◄── every sensitive action passes through
                         └──────┬───────┘
                                │ gates
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
         ┌─────────┐      ┌─────────┐       ┌─────────┐
         │ Ledger  │◄────►│ Report  │       │ Search  │
         │ (spine) │      │ (reads) │       │ (FTS5)  │
         └────┬────┘      └────┬────┘       └────┬────┘
              │ emits          │                 │
              ▼ LEDGER_MUTATED │                 │
         ┌─────────┐           │                 │
         │Reminder │──────────►│                 │
         └────┬────┘           │                 │
              │ fires          ▼                 ▼
              ▼          ┌─────────┐      ┌─────────┐
         ┌──────────────┐│  Sync   │─────►│ reindex │
         │ Notification ││ (outbox)│      │   FTS   │
         │ (bell/toast) │└────┬────┘      └─────────┘
         └──────────────┘     │ SYNC_COMPLETED → triggers Reminder re-eval
```

Key edges: **Ledger ↔ Report** (Report reads aggregates; `LEDGER_MUTATED` invalidates Report cache). **Ledger → Reminder** (outstanding fees drive `due_fee` fires). **Reminder → Notification** (`REMINDER_DUE` is batched + surfaced). **Sync → Search** (on `SYNC_COMPLETED`, Search rebuilds FTS if schema or volume warrants). **Security ⊇ all** (every engine's sensitive path passes through the PIN gate). No engine imports another directly — all cross-engine communication goes through the event bus (§21), keeping the graph acyclic and testable in isolation.

---

## 16. Error Handling Taxonomy

### 16.1 Recoverable vs. Non-Recoverable

| Class | Examples | Strategy |
|---|---|---|
| **Recoverable — transient** | Network blip, Turso 503, sync conflict | Exponential backoff (1s, 2s, 4s, 8s, 16s); toast on first failure; silent retry thereafter |
| **Recoverable — user action** | Validation error, PIN wrong, missing cheque ref | Inline error + actionable guidance; no retry loop |
| **Recoverable — conflict** | LWW loser, duplicate UUID | Auto-resolve + surface in Sync drawer; tutor can re-edit |
| **Non-recoverable — block** | Schema drift, corrupt backup, audit log unavailable | Fail-closed; block the action; instruct the user; never partial-commit |
| **Non-recoverable — wipe** | 15 failed PIN attempts, lost device | Wipe local cache; force re-login; surface recovery path |

### 16.2 Retry Policy

```ts
// 5 attempts, exponential backoff: 1s, 2s, 4s, 8s, 16s.
async function withRetry<T>(fn: () => Promise<T>, opts: { retryable: (e: Error) => boolean }): Promise<T> { /* loop with sleep */ }
```

Retryable: network timeouts, 5xx, SQLite `SQLITE_BUSY`. **Not** retryable: validation errors, 4xx, PIN failures, schema-mismatch.

### 16.3 User-Facing Error Message Guidelines

- **No stack traces.** A toast that says `TypeError: Cannot read property 'amount' of undefined` is a bug in the toast, not the user's problem.
- **Actionable language.** "Couldn't save payment. Check your connection and try again." — not "Save failed."
- **Name the entity.** "Couldn't void receipt RCT-2025-000042. The cheque reference is missing." — not "Void failed."
- **Offer a next step.** Every non-trivial error toast has a button: [Retry], [Open Sync Drawer], [View Details].
- **Log the technical detail.** Full error + stack goes to `audit_log` (`action='error'`, `metadata={stack, context}`) for debugging — never to the toast.

---

## 17. Navigation State Model (Zustand)

A single client store governs shell-level state; screens own their own local state.

```ts
interface ShellState {
  activeScreen: 'dashboard' | 'students' | 'attendance' | 'fees' | 'settings';
  sidebarCollapsed: boolean; commandPaletteOpen: boolean; syncDrawerOpen: boolean;
  periodFilter: PeriodFilter; searchQuery: string;
  notifications: Notification[]; unreadCount: number;
  online: boolean; pendingSync: number; lastSyncAt: string | null;
}
```

Server-state (Turso data) is cached via TanStack Query keyed by `['students', periodFilter]`, etc. Mutations invalidate the relevant query keys and append to `sync_outbox`.

---

## 18. Routing Map (Web)

All routes live under `GlassShell`. The `/` route is the **only** user-facing entry per project rules; deeper screens are **in-shell navigations** (client-side state), not new URL routes, to preserve the persistent shell.

| Shell State | "Logical Route" | Notes |
|-------------|-----------------|-------|
| `dashboard` | `/` | Default landing. |
| `students` | `/` (state) | Master+detail inside content pane. |
| `attendance` | `/` (state) | Calendar + grid inside content pane. |
| `fees` | `/` (state) | Matrix + ledger inside content pane. |
| `settings` | `/` (state) | Tabbed drawer inside content pane. |

> **Project rule compliance:** Only `/` is exposed. Screen switching is Zustand-driven so the shell never unmounts. Deep-linking to a specific student/invoice is via URL `?s=students&id=…` query params parsed by the shell, **not** by new routes.

---

## 19. The Three Platform Bindings

| Concern | Web (Next.js) | Mobile (Expo) | Desktop (Tauri) |
|---|---|---|---|
| Shell | `GlassShell` RSC layout | `<Stack>` + custom drawer | `GlassShell` static export |
| Local DB | IndexedDB cache + Turso HTTP | `expo-sqlite` + libSQL | Rust `libsql` via `invoke` |
| Sync | Turso HTTP polling (30s) | libSQL embedded replica | libSQL embedded replica |
| Auth | Supabase SSR cookie | `expo-auth-session` Google | Supabase OAuth popup |
| Locks | PIN only (WebAuthn in v1.x) | FaceID/TouchID + PIN | OS biometric + PIN |
| Build | Vercel | EAS → Vercel Blob | GH Actions → Vercel Blob + `latest.json` |

---

## 20. The Provisioning Flow (1 User = 1 Turso DB)

```
[Web Signup] → Supabase Auth (email/Google) → [Auth Success]
   → Supabase Edge Function `provision-db` (webhook on user.created)
   → Turso API: create db `buddysaradhi-{user_uuid}` → Turso mints scoped JWT (db_url + db_token claims)
   → JWT stored in Supabase user_metadata → Client reads JWT from session
   → Client initialises libSQL client with db_url + db_token → Schema bootstrap (idempotent migrations)
   → [Ready: Dashboard renders empty-state]
```

This flow is **web-initiated** because Supabase Edge Functions and the Turso control plane are web-native. Mobile and desktop inherit the JWT via Supabase session sync.

---

## 21. Cross-Engine Event Bus

Engines communicate via a typed in-process event bus (Zustand middleware + TanStack Query invalidation). No engine imports another; they emit events.

```ts
type EngineEvent =
  | { type: 'LEDGER_MUTATED'; studentId: string; entryId: string }
  | { type: 'ATTENDANCE_LOCKED'; date: string; batchId: string }
  | { type: 'SYNC_COMPLETED'; pending: number; conflicts: number }
  | { type: 'REMINDER_DUE'; reminderId: string; category: ReminderCategory }
  | { type: 'BACKUP_CREATED'; filename: string; bytes: number }
  | { type: 'EXPORT_REQUESTED'; scope: ExportScope; format: 'xlsx' | 'pdf' };
```

Subscribers: `LEDGER_MUTATED` → invalidate `['students', id]`, `['fees']`, `['dashboard']`; recompute Reminders. `ATTENDANCE_LOCKED` → invalidate `['attendance', date]`; write `audit_log`. `SYNC_COMPLETED` → update footer; re-index Search if schema changed. `REMINDER_DUE` → push to Notification Engine. `BACKUP_CREATED`/`EXPORT_REQUESTED` → write `audit_log`; toast confirmation.

---

## 22. Versioning & Migrations

- Schema migrations are versioned (`migrations/0001_init.sql`, …) and stored in the user's Turso DB. Each is **idempotent** and **forward-only** (no down migrations). The client runs pending migrations on connect; `schema_version` table records the applied set. The UI refuses to render if `schema_version` is ahead of the app's supported max.
- Migration `0007_ledger_chain.sql` adds `tamper_hash` to `ledger_entries` and back-fills existing rows by recomputing the chain per `student_id`. Migration `0008_receipt_sequences.sql` introduces the per-year sequence table (§6.5).

---

## 23. The Five Screens → Engine Dependency Matrix

| Screen \ Engine | Search | Reminder | Ledger | Report | Notification | Sync | Security |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Dashboard | ◐ | ● | ● | ● | ● | ◐ | — |
| Students | ● | ◐ | ● | ◐ | — | ◐ | ● |
| Attendance | ◐ | ● | — | ◐ | ● | ● | ● |
| Fees & Payments | ● | ● | ● | ● | ● | ◐ | ● |
| Settings | — | — | — | ◐ | — | ● | ● |

`●` = primary dependency · `◐` = secondary/read · `—` = none

---

## 24. ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 (ASCII Art Conventions) for the Core Logic doc. Core Logic is not a screen spec — its mockups are **state machines, call graphs, and mutation-flow diagrams**, not UI layouts. Where a UI surface is mentioned, the glass tier (`.glass` / `.glass-strong` / `.glass-faint` per §5.5) or neumorphic recipe (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6) is annotated in the notes. Character set per §20.2. Accent colours named, never hexed. Cross-references use canonical IDs only.

### 24.1 Design System Reference — Core Logic

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces referenced by this doc | Tier | Cross-ref |
|---|---|---|
| Shell sidebar (the 5-screen geography) | `glass-strong` | §5.5, §1.1 |
| Shell topbar (search + notifications) | `glass-strong` sticky | §5.5, §1.2 |
| Sticky footer (sync status, MTD) | `glass-faint` | §5.5, §13, §1.3 |
| PIN/biometric challenge modal | `glass-strong` + backdrop | §5.5, §8.7 |
| Toast (engine status / sync conflict) | `glass-strong` + 4px accent left-bar | §5.5, §8.8 |

| Neumorphic controls referenced by this doc | Recipe | Cross-ref |
|---|---|---|
| Sidebar nav button (5 screens) | flat `bg-white/[0.02]`; active = `neumo-pressed` + accent stripe | §6.6, §8.6 |
| Topbar ⌘K search trigger | `neumo-inset` tray | §6.6, §8.10 |
| PIN pad digit buttons | `neumo-raised`; press = `neumo-pressed` | §6.6, §8.2 |
| Quick Action buttons (Record Payment, Mark Attendance) | `neumo-raised` primary (emerald glow) | §6.6, §8.2 |

> **References:** Martin Kleppmann — *Designing Data-Intensive Applications* (append-only ledger, LWW conflict resolution); Pat Helland — *Life beyond Distributed Transactions* (the local-first rationale for the sync_outbox); OWASP — *Authentication Cheat Sheet* (PIN/biometric defence-in-depth); RFC 8439 (AES-GCM, used by the Security Engine for the local SQLite at-rest encryption); Smashing Magazine — *State Machines In UX*; Nielsen Norman Group — *Microinteractions*.

### 24.2 Mockup C1 — Five-Screen In-Shell Navigation State Machine

```
FIVE-SCREEN NAVIGATION STATE MACHINE (Zustand store — §17)
                                     ┌──────────────────┐
                                     │   boot · loading  │
                                     └─────────┬─────────┘
                                               │ auth check (Supabase JWT)
                                  ┌────────────┴────────────┐
                                  ▼                         ▼
                          ┌───────────────┐         ┌───────────────┐
                          │ locked_screen │         │   dashboard   │ ← default
                          │  (PIN/bio)    │◀─────── │     (idle)    │   on auth OK
                          └───────┬───────┘  lock   └───────┬───────┘
                                  │ unlock (bio/PIN)        │ goto
                                  │ per §12.1 flow          ▼
                                  └────────────►┌──────────────────────┐
                                                │  sidebar / ⌘K (any)   │
                                                │  → Students           │
                                                │  → Attendance         │
                                                │  → Fees & Payments    │
                                                │  → Settings           │
                                                └────┬─────────┬────────┘
                                                     │         │
                                       ┌─────────────┘         └─────────────┐
                                       ▼                                     ▼
                              ┌─────────────────┐                   ┌─────────────────┐
                              │  students.list  │                   │ attendance.mark │
                              │  → drawer (row) │                   │  → toggle lock  │
                              │  → command (⌘K) │                   │  → bulk mark    │
                              └────────┬────────┘                   └────────┬────────┘
                                       │ goto                                 │ goto
                                       ▼                                      ▼
                              ┌─────────────────┐                   ┌─────────────────┐
                              │ fees.ledger     │                   │ settings.panel  │
                              │  → record pay   │                   │  → backup modal │
                              │  → void receipt │                   │  → export modal │
                              │  → export month │                   │  → reset device │
                              └────────┬────────┘                   └────────┬────────┘
                                       │                                     │
                                       └──────────────┬──────────────────────┘
                                                      ▼
                                       ┌──────────────────────────────┐
                                       │  GLOBAL: PIN challenge       │
                                       │  (sensitive mutation only)   │
                                       │  ↑ .glass-strong modal (§8.7)│
                                       │  ↑ .neumo-raised PIN pad    │
                                       └──────────────┬───────────────┘
                                                      │ verify (argon2id)
                                                      ▼
                                       ┌──────────────────────────────┐
                                       │  mutation committed          │
                                       │  → sync_outbox row (AP-13)   │
                                       │  → audit_log row (AP-13)     │
                                       │  → receipt PDF (if payment)  │
                                       └──────────────────────────────┘

   ↑ every transition is reachable via sidebar (.glass-strong, §1.1) or ⌘K (P3 —
     two-tap rule). State lives in Zustand `useShellStore` (§17).
   ↑ the PIN gate is entered ONLY for the §12.3 allowlist — non-sensitive mutations
     bypass it (P11 — tactile friction is bounded).
   ↑ the lock_screen state is reachable from ANY screen via Settings → Lock Now,
     or automatically after `settings.app_lock_timeout` (default 5 min — BR-SEC-04).
```

- ↑ **Five states, one shell.** The Zustand store holds `(activeScreen, drawerState, modalState)`; the shell chrome (sidebar + topbar + footer) is constant across all five screens (P2 — five screens, forever).
- ↑ **Modal-stack ceiling = 2 (AP-15).** The PIN modal can sit over a record-payment modal — that is the maximum; a third-level modal is a spec defect.
- ↑ **AP-13 honoured.** Every mutation path terminates in a sync_outbox + audit_log write, in the same transaction as the business mutation (`11_Data_Model.md` §13).

### 24.3 Mockup C2 — The 7-Engines Call Graph

```
SEVEN-ENGINE CALL GRAPH (§4–§12) — who calls whom, who owns what state
┌────────────────────────────────────────────────────────────────────────────────────┐
│  SHELL (5 screens)                                                                 │
│   ┌─ Dashboard ─┐  ┌─ Students ─┐  ┌─ Attendance ─┐  ┌─ Fees ─┐  ┌─ Settings ─┐   │
│   └──────┬──────┘  └──────┬──────┘  └──────┬───────┘  └───┬────┘  └─────┬─────┘   │
│          │                │                │               │             │          │
└──────────┼────────────────┼────────────────┼───────────────┼─────────────┼──────────┘
           │                │                │               │             │
           ▼                ▼                ▼               ▼             ▼
   ┌────────────────────────────────────────────────────────────────────────────────┐
   │  E1 SEARCH ENGINE (§8)        — invoked by ⌘K from any screen                  │
   │  · FTS5 over students, invoices, receipts · BM25 + recency + user-weight boosts │
   │  · stateless: no own row; reads from business tables (§8.1)                    │
   └────────────────────────────────────────────────────────────────────────────────┘
           ▲                                ▲                          ▲
           │ reads                          │ reads                    │ reads
           │                                │                          │
   ┌───────┴────────┐  ┌──────────────────┐│  ┌──────────────────────┴──────────┐
   │ E3 LEDGER (§6) │  │ E2 REMINDER (§7) ││  │ E4 REPORT (§11)                  │
   │ · append-only  │  │ · schedule + queue│ │ · period close (§11.1)           │
   │ · double-entry │  │ · channel priority│ │ · fee-aging buckets (§11.2)      │
   │ · tamper hash  │  │ · dedup + snooze  │ │ · attendance rate (§11.3)        │
   │ · VOID cascade │  │ · quiet hours     │ │ · Excel/CSV export (§11.4)       │
   │  ▲             │  │  ▲                │ │  ▲ reads ledger + attendance     │
   │  │ BR-LED-*    │  │  │ BR-REM-*       │ │  │ BR-RPT-*                       │
   └──┼─────────────┘  └──┼────────────────┘ └──┼───────────────────────────────┘
      │ writes             │ reads/writes        │ reads
      │                    │                     │
      ▼                    ▼                     ▼
   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │  business tables (SQLite local — the source of truth)                            │
   │   ledger_entries · receipts · students · batches · attendance · invoices · …    │
   │   ↑ every write enqueues sync_outbox row (AP-13, BR-SYN-02)                     │
   └────────────────────────────────────┬────────────────────────────────────────────┘
                                        │ enqueue (same TX as mutation)
                                        ▼
   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │  E6 SYNC ENGINE (§9)        — v1 stub (local-only); v2 pushes to Turso          │
   │  · push on network transition + 5 min foreground · pull on app launch           │
   │  · LWW + vector clocks (§9.2) · ledger conflict-free by construction            │
   └────────────────────────────────────┬────────────────────────────────────────────┘
                                        │ conflict detected (rare)
                                        ▼
   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │  E5 NOTIFICATION ENGINE (§10)   — surfaces sync conflicts + reminder firings    │
   │  · in-app toast (.glass-strong, §8.8) · v1.x system push (opt-in)               │
   │  · quiet hours (default 22:00–07:00) · P0 surfaces always                      │
   └─────────────────────────────────────────────────────────────────────────────────┘

   ┌─ E7 SECURITY ENGINE (§12) — wraps every sensitive mutation ─────────────────────┐
   │   · PIN gate (argon2id verify, §12.1)                                          │
   │   · biometric fallback (§12.2)                                                  │
   │   · lockout policy (1–4 toast, 5+30s, 10+5min, 15 wipe local cache — §12.4)     │
   │   · sits BETWEEN the screen UI and the business-table write — cannot be skipped │
   └─────────────────────────────────────────────────────────────────────────────────┘
```

- ↑ **Engines are stateless or own narrow state.** Search reads; Ledger writes; Reminder owns `reminders` rows; Sync owns `sync_outbox`; Security owns `settings.pin_hash` + `app_lock_state`. No engine owns the business tables they share.
- ↑ **E7 wraps all sensitive mutations.** A screen → business-table write that bypasses the Security Engine is a P0 bug (BR-SEC-02, AP-12).
- ↑ **E3 (Ledger) is conflict-free under sync.** UUIDv7 append-only rows cannot collide; only editable profile/note data conflicts via LWW + vector clocks (`00_Vision.md` §10.3).

### 24.4 Mockup C3 — sync_outbox Mutation Flow (the AP-13 contract)

```
SYNC_OUTBOX MUTATION FLOW — every db.<model>.create/update/delete on a business table (AP-13)
   screen UI (.neumo-raised button press)
        │
        ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  BEGIN TRANSACTION  (single SQLite TX — atomicity guarantee)             │
   │                                                                          │
   │  STEP A.  E7 SECURITY ENGINE gate (if action ∈ §12.3 allowlist)         │
   │           · biometric OR argon2id verify of PIN                          │
   │           · fail → increment fail_count → §12.4 lockout policy → ROLLBACK│
   │           · ok  → continue                                              │
   │                                                                          │
   │  STEP B.  write to business table (e.g. db.ledgerEntry.create())         │
   │           · enforce append-only trigger (BR-LED-01) on ledger_entries    │
   │           · enforce two-row invariant (PAYMENT_RECEIVED ↔ receipts)      │
   │           · compute tamper_hash = SHA-256(prev_hash || payload || secret)│
   │                                                                          │
   │  STEP C.  write the companion row(s)                                     │
   │           · receipt row for PAYMENT_RECEIVED                             │
   │           · VOID reverses_entry_id pointer for voids                     │
   │                                                                          │
   │  STEP D.  db.syncOutbox.create({ data: { ... } })                       │
   │           · idempotency_key = UUIDv7 (BR-SYN-03)                         │
   │           · payload = JSON snapshot of the mutation                      │
   │           · status = 'pending'                                           │
   │           · created_at = now()                                           │
   │                                                                          │
   │  STEP E.  db.auditLog.create({ data: { ... } })                         │
   │           · actor = 'tutor' | 'biometric'                                │
   │           · action = '<mutation_type>'                                   │
   │           · before/after JSON snapshot                                   │
   │           · ip = null (offline-first; no IP telemetry, AP-10)            │
   │                                                                          │
   │  STEP F.  recompute derived views (if cached)                            │
   │           · student_balance_cache (§15 of 11_Data_Model.md)              │
   │           · dashboard KPI aggregates                                     │
   │                                                                          │
   │  STEP G.  re-validate invariants                                         │
   │           · cascade constraint (BR-LED-04): void blocked if it orphans   │
   │             dependent rows                                               │
   │           · lock-window check (BR-LED-05): hard-locked > 30d → ROLLBACK  │
   │                                                                          │
   │  STEP H.  COMMIT  (all 7 steps atomically durable)                       │
   └─────────────────────────────────────┬────────────────────────────────────┘
                                         │
                                         ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  POST-COMMIT (out-of-band, never blocks UI)                              │
   │                                                                          │
   │  · E5 NOTIFICATION toast "Receipt #RC-2025-0007 created" (.glass-strong) │
   │  · E6 SYNC ENGINE picks up the pending sync_outbox row                   │
   │           · if online  → push to Turso (BR-SYN-02)                       │
   │           · if offline → row stays 'pending'; flushed on next network    │
   │             transition (Wi-Fi join / app foreground)                     │
   │           · on ACK from Turso → status='applied'; row kept 30d for audit │
   │                                                                          │
   │  · E2 REMINDER ENGINE recalculates                                       │
   │           · a payment may satisfy a 'due_fee' reminder → mark it paid    │
   │           · a void may resurrect a 'due_fee' reminder                    │
   │                                                                          │
   │  · E4 REPORT ENGINE invalidates cached aggregates                        │
   │           · MTD collected / due-today / collection-rate                  │
   └──────────────────────────────────────────────────────────────────────────┘

   ↑ STEP H COMMIT is the durability boundary. Steps D + E MUST be in the same TX
     as STEP B — skipping either is AP-13 (a silent ledger break).
   ↑ the post-commit fan-out is asynchronous. UI returns after STEP H; the user
     never waits on sync, notifications, or report invalidation (P5, P12).
   ↑ on rollback (STEP A fail or STEP G invariant breach), no row is written to
     any table. The mutation effectively never happened — audit_log records the
     ATTEMPT but not a successful mutation (BR-SEC-06).
```

- ↑ **The 7-step TX is the contract.** Any PR that adds a mutation path skipping STEP D or STEP E is a P0 review item and breaks AP-13. The lint rule `principles/no-unaudited-mutation.py` enforces this at compile time.
- ↑ **STEP D idempotency.** The UUIDv7 `idempotency_key` lets the Sync Engine retry safely (BR-SYN-03) — same key applied twice produces the same effect, never a duplicate ledger row.
- ↑ **STEP E has no IP column.** Audit logs are local-only; they record `actor`, `action`, `before`, `after` — never the network state of the device (AP-10, `10_Security.md` §17 TELE-1).

---

## 25. Glossary

| Term | Definition |
|---|---|
| **Append-only** | INSERT-only table; UPDATE/DELETE blocked by SQLite triggers. Ledger + audit_log are append-only. |
| **Compensating entry** | A new ledger row that reverses a prior row's effect (e.g., `VOID`). Original is never modified. |
| **Tamper hash** | SHA-256 of `prev_hash || payload || tenant_secret`, chained per student. Detects silent edits. |
| **Vector clock** | Per-device Lamport counter map used to order sync writes and detect concurrent updates. |
| **Lock window** | 24h (ledger) or 48h (attendance) period after which edits require escalated PIN + reason. Beyond 30d, hard-locked. |
| **Running balance** | Per-student `balance_due` derived via `computeRunningBalance()`. Never stored on `students`; cached in `student_balance_cache`. |
| **Sync outbox** | Pending mutation queue. Every state mutation writes here (INV-3); v1 flush is a stub, v2 pushes to Turso. |
| **LWW** | Last-Write-Wins. Conflict resolution by `updated_at`; loser's version preserved in `audit_log`. |
| **Soft delete** | `archived_at`/`deleted_at` set; row preserved for audit + historical search. Never a hard `DELETE`. |
| **Quiet hours** | Configurable off-hours window (default 22:00–07:00) during which P1–P3 notifications are deferred. P0 still surfaces. |
| **FTS5** | SQLite Full-Text Search 5 virtual table. Backs the Search Engine over `students`, `invoices`, `receipts`. |
| **BM25** | Okapi BM25 ranking function; FTS5's native relevance score, combined with recency + user-weight boosts. |
| **Two-row invariant** | Every `PAYMENT_RECEIVED` ledger entry must be accompanied by exactly one `receipts` row, written in one transaction. |
| **Cascade constraint** | A void is blocked if it would orphan dependent rows (e.g., voiding a `FEE_CHARGED` with credits against it — BR-LED-04). |

---

This core logic is the load-bearing wall of Buddysaradhi. A PR that changes an algorithm, invariant, or state machine here is a P0 review item and requires updating `12_Business_Rules.md` and `14_Edge_Cases.md` in the same PR.
