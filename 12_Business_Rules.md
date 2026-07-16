# 12 — Business Rules

> The rulebook of Buddysaradhi Omni-Core. Every behaviour the application must enforce is written here as a numbered rule with a stable ID (`BR-XXX-NN`) that other specs, code, tests, and PRs cite by name. If a behaviour is not defined here, it does not exist. Where this file and another spec disagree on the *behaviour* in dispute, this file wins. Where they disagree on the *principle* behind the behaviour, `01_Product_Principles.md` wins.

---

## How to Read This File

Each rule carries five fields: **Statement** (the rule; a `[CRITICAL]` tag marks load-bearing rules), **Rationale** (the pain prevented), **Enforced-by** (engine + spec section), **If-violated** (system response), **Related** (sibling rules, principles, edge cases). A `[CRITICAL]` rule is load-bearing: violating it is a P0 review block, not a P1. Critical rules are mirrored in `01_Product_Principles.md`'s Code Map.

When two rules conflict in a concrete situation, the **Conflicts Matrix** (§15) decides which wins; when the matrix is silent, the **Precedence Defaults** (§14) decide. If neither covers the case, the rule goes through the Amendment Process (§16) before any code is shipped.

A PR that adds, retires, renumbers, or rewrites a rule here MUST also update: (a) every spec citing the rule, (b) the test `tests/business-rules/<rule-id>.spec.ts`, (c) `src/data/business-rules-registry.ts` (so the landing-page counter stays correct), and (d) this file's "Last Amended" footer. Skipping any of those four steps is itself a P1 review block.

Rules are presented in per-domain tables. Read across each row: the ID is the citation key, the Statement is the contract, the Rationale is the "why," Enforced-by names the gate, If-violated names the failure response, and Related is the cross-reference graph.

---

## 1. Rule Taxonomy & ID Scheme

Rule IDs are stable, citable strings of the form `BR-<DOMAIN>-<NN>` where `<DOMAIN>` is one of the eleven three-letter codes below and `<NN>` is a zero-padded sequence that **never reuses** a retired ID. Within a domain, IDs are assigned in chronological order of ratification; a retired ID is marked `[RETIRED]` in place and never reused. New rules take the next free number even if a gap exists. Other specs cite rules as `BR-FEE-04`, `BR-ATT-07`, etc.; code, tests, and audit logs use the same string. The landing-page spec index reads rule counts from `src/data/business-rules-registry.ts`, generated from this file — that generator is the source of truth for the "X business rules" stat shown on the public site.

| Domain | Code | Scope | Owner spec |
|---|---|---|---|
| Fees & Money | `BR-FEE` | Currency, fee plans, schedule, discounts, late fees, refunds, waivers, dual model | `07_Fees_and_Payments.md` |
| Attendance | `BR-ATT` | Sessions, status vocabulary, locking, make-up, holidays | `06_Attendance.md` |
| Students | `BR-STU` | Codes, lifecycle, duplicates, archival, graduation, transfer | `05_Students.md` |
| Batches | `BR-BAT` | Batch creation, schedule, capacity, archival, merge/split | `02_Core_Logic.md` §2 |
| Ledger | `BR-LED` | Append-only, double-entry, voids, hash chain, locking | `11_Data_Model.md` §3.10 |
| Reminders | `BR-REM` | Quiet hours, dedup, snooze, escalation, anti-marketing | `02_Core_Logic.md` §3.2 |
| Reports | `BR-RPT` | Period close, aging buckets, formulas, formats, no-telemetry | `04_Dashboard.md` |
| Sync | `BR-SYN` | Outbox, conflict resolution, schema drift, v2 vector clocks | `02_Core_Logic.md` §3.6 |
| Security | `BR-SEC` | PIN, biometric, lockout, allowlist, passphrase, no-plaintext | `10_Security.md` |
| UI | `BR-UI` | Five-screen doctrine, no indigo/blue, touch targets, dark-only | `13_UI_Guidelines.md` |
| Import/Export | `BR-IMP` | CSV/Excel schema, backup blob, restore flow, no auto-cloud | `09_Backup_and_Import_Export.md` |

---

## 2. Fee & Money Rules (BR-FEE)

Currency representation, fee plans, schedule generation, invoicing, discounts, late fees, refunds, waivers, and the dual-model (monthly + per-session).

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-FEE-01** [CRITICAL]| All money is integer minor units (paise INR, cents else). No REAL/float; division rounds half-to-even. | Float drift is invisible until a receipt is off by. | Zod, SQL CHECK, CI lint | Migration aborts; Zod throws | `BR-FEE-05`, P6, EC-F-01 |
|**BR-FEE-02**| `settings.currency_code` set at provisioning (default `INR`), immutable after first ledger entry. | Mid-stream currency change is a full restatement. | `settings` singleton; `ledgerEngine.post` | UI shows 🔒 chip; save disabled | `BR-FEE-01`, EC-F-07 |
|**BR-FEE-03**| `ledger_entries.amount` for `direction='charge'` always ≥ 0. Refunds are `direction='credit'` rows. | Signed-amount + direction is the classic double-count bug source. | SQL CHECK; Zod | INSERT aborts | `BR-LED-01`, EC-F-04 |
|**BR-FEE-04**| A `PAYMENT_RECEIVED` cannot push balance below zero unless tagged `[ADVANCE]` in description. | Silent over-payments become invisible advances. | `ledgerEngine.splitIfOverpayment` | Engine splits into exact + `[ADVANCE]` rows; toast. | `BR-FEE-15`, EC-F-02, EC-F-08 |
|**BR-FEE-05**| Balance comparisons use a 1-minor-unit tolerance. "Paid in full" iff ` | balance_due | ≤ 1`. | Half-to-even rounding leaves a half-paisa drift; tolerance absorbs. | `studentBalance.isPaidInFull()` |UI shows "due ₹0.01" forever|`BR-FEE-01`, `BR-RPT-04`, EC-F-01|
|**BR-FEE-06**| `fee_plans.model ∈ {postpaid, prepaid, mixed}`. Postpaid: due on cycle-end + grace. Prepaid: due on cycle-start. Mixed: per item. | Indian centres use prepaid; Western tutors postpaid; some mix. | `fee_plans.model` CHECK; `FeeEngine.generateSchedule` | Plan creation aborts | `BR-FEE-07`, `BR-FEE-16` |
|**BR-FEE-08**| On plan create, engine generates `fee_schedule_items` from `start_date` to `end_date` (or +12 cycles). | Schedule items are the unit of invoicing, reminders, aging; destroying. | `FeeEngine.regenerateSchedule` | Plan save aborts | `BR-FEE-09`, `BR-LED-01` |
|**BR-FEE-09**| Invoice generated when item's `due_date` within ±7 days, OR manual trigger, OR auto-invoice on + item `pending`. | Lazy generation keeps the invoice list honest; hash detects silent. | `InvoiceEngine`; atomic CTE on `next_invoice_seq` | Sequence fails; rollback; red "TAMPERED" badge on mismatch | `BR-LED-06`, EC-F-08, EC-SEC-03 |
|**BR-FEE-10**| `discount_type='fixed'` → minor units; `discount_type='percent'` → basis points (1000 = 10%). Discounts post a paired `DISCOUNT_GRANTED` credit alongside `FEE_CHARGED`. | Burying a discount in the charge row makes the ledger. | `FeeEngine.applyDiscount` | Ledger shows inflated charges with no offset | `BR-FEE-11`, EC-F-07 |
|**BR-FEE-13**| A `WRITEOFF` entry requires (a) non-empty `reason`, (b) PIN/biometric per `BR-SEC-04`, (c) `audit_log` `action='fee_waiver'`. | Waivers erase money; the PIN gate prevents casual erasure, the. | `SecurityEngine.challenge`; `ledgerEngine.writeoff` | Transaction aborts | `BR-SEC-04`, `BR-LED-01`, P6 |
|**BR-FEE-14**| Refunds are `REFUND_ISSUED` (`direction='charge'`). Cannot exceed advance + outstanding. Larger refunds require paired `ADJUSTMENT` with description + PIN. | Refunds drain money; the engine must not let a typo. | `ledgerEngine.issueRefund`; PIN per `BR-SEC-04` | UI blocks: "Cannot refund more than the advance. | `BR-FEE-03`, `BR-FEE-15`, EC-F-06 |
|**BR-FEE-15**| Over-payment split: exact `PAYMENT_RECEIVED` + `[ADVANCE]` `PAYMENT_RECEIVED`. Advances auto-apply to next `FEE_CHARGED` via `PAYMENT_RECEIVED` tagged `[ADVANCE_APPLIED]` for `min(advance_balance, charge_amount)`. | The tutor's intent was to record a payment; the engine. | `ledgerEngine.splitIfOverpayment`; `ledgerEngine.post` checks advance first | Reports show "due −₹500"; balances drift | `BR-FEE-04`, EC-F-02, EC-F-08 |
|**BR-FEE-16**| A student may be in a monthly-billed batch (`cycle='monthly'`) AND take ad-hoc per-session extras (`cycle='one_time'`, one plan per session). | Coaching centres run monthly batches + ad-hoc exam-prep extras. | Multiple active `fee_plans` per student allowed | Engine rejects second plan with "Duplicate active plan". | `BR-FEE-06`, `BR-FEE-08` |
|**BR-FEE-17**| Late fee = `round(item.amount × late_fee_bps / 10000)` per `late_fee_grace_days` (default 7) past `due_date`. | Common in coaching centres but optional per tutor. | `FeeEngine.applyLateFees` | Tutors who want late fees get none; those. | `BR-FEE-08`, `BR-REM-02` |
|**BR-FEE-18**| Mid-cycle enrollment: first schedule item pro-rated = `round(base_amount × days_remaining / total_days_in_cycle)`. Subsequent items full. | Charging a full month to a student who joined on. | `FeeEngine.generateSchedule` reads `student_enrollments.joined_on` | Unjust full-month charge or unjust free month | `BR-FEE-08`, `BR-STU-08` |
|**BR-FEE-19**| Prepaid unpaid students show amber "Fee pending" chip on attendance grid. | Hard block punishes the student for the parent's delay; visible. | `AttendanceGrid` component; `ReminderEngine` | Lost revenue (hard block) or lost visibility (silent. | `BR-ATT-02`, `BR-REM-02`, EC-F-02 |
|**BR-FEE-20** [CRITICAL]| **Every student has a monthly fee** (`student_fee_rates.monthly_fee_paise`), set at enrolment. The monthly amount is the **base unit** for all fee calculations. Quarterly amount = `monthly × 3`; annual amount = `monthly × 12` — always derived, never stored as separate figures. The `fee_frequency` field (`monthly`/`quarterly`/`annual`) determines *when* the charge is due (every month / every 3 months / every 12 months), not *how much* per month. | The user's explicit ask: *"each student has a specific monthly amount … show quarterly and annually … use it in calculations as that is what happens in real."* Real tutors think in monthly fees; the system must too. Deriving Q/Y from monthly keeps one source of truth — no drift between a stored "quarterly amount" and 3× the monthly. | `StudentFeeRate` schema; `FeeRateEngine.setRate`; UI enrolment form requires `monthly_fee_paise` | Student has no fee set → expected/arrears = null → Dashboard KPI wrong | `BR-CALC-09`, `BR-FEE-21`, `11_Data_Model.md §4.4a`, `05_Students.md` enrolment |
|**BR-FEE-21**| Fee changes are **append-only**: a new `student_fee_rates` row with `effective_from`; the prior row's `effective_to` is set to the day before. `students.monthly_fee_paise` + `students.fee_frequency` (the denormalised cache) are updated in the **same `$transaction`**. Never UPDATE a rate row's `monthly_fee_paise` — that would silently rewrite history and break `expectedForMonth` for past months. | A fee revision (₹1,500 → ₹1,800 from July) must not retroactively change January's expected. The effective-dated history is the only honest model; the cache is a read optimisation kept in sync transactionally. | `FeeRateEngine.changeRate` (inside `db.$transaction`); `idx_fee_rates_current` partial unique index | Past-month expected silently changes; arrears drift; audit trail lost | `BR-FEE-20`, `BR-CALC-09`, `11_Data_Model.md §4.4a`, EC-F-18 |
|**BR-FEE-22**| `effective_from` defaults to the **first of the next month** when a tutor changes a fee mid-month (the clean boundary). Proration mid-month is an explicit opt-in (`FeeRateEngine.changeRate({ prorate: true })`), not the default — because tutors rarely prorate (a student who commits mid-month pays the full month in practice). | Mid-month fee changes with proration produce fractional months that confuse tutors and parents. The first-of-next-month default is the 95% case; proration is the 5% that must be a deliberate choice. | `FeeRateEngine.changeRate`; UI date-picker defaults to next month's 1st | Tutor accidentally prorates; revenue understated; or tutor can't change the fee cleanly | `BR-FEE-21`, `BR-FEE-18`, EC-F-18 |
|**BR-FEE-23**| A student whose enrolment is `paused` (`student_enrollments.status='paused'`) contributes **0** to `expectedForMonth` for the paused months. Resume (`paused → active`) re-enables the expected from the resume month. The fee rate row is NOT ended on pause (the rate resumes unchanged); only the enrolment status flips. | A student who takes a month off (family trip, exam break) should not accumulate arrears for that month. Pausing the enrolment — not ending the rate — is the clean model: the rate is unchanged, the months are just zeroed. | `StudentEngine.pause`/`resume`; `expectedForPeriod` checks enrolment status per month | Paused student racks up fake arrears; reminder engine harasses them | `BR-STU-02`, `BR-CALC-09`, EC-S-06 |
|**BR-FEE-24**| `fee_frequency='annual'` students: the single annual charge (`monthly × 12`) is due on the `effective_from` anniversary. An optional **annual discount** is modelled as a `DISCOUNT_GRANTED` credit (BR-FEE-10) posted alongside the `FEE_CHARGED`, never as a reduced `base_amount` — so the ledger always shows the full annual fee + the discount as separate, auditable lines. | Annual payers often get a discount (pay 11, get 12). Burying the discount in a reduced base_amount loses the audit trail and breaks `expectedForYear` (which would under-count). The discount-as-credit keeps the expected honest and the discount visible. | `FeeRateEngine` generates the annual `fee_plan` with `base_amount = monthly × 12`; `FeeEngine.applyDiscount` posts the credit | Annual payer's expected understated; discount invisible in reports | `BR-FEE-10`, `BR-FEE-20`, `BR-CALC-09`, EC-F-21 |
|**BR-FEE-25**| `fee_frequency='quarterly'` students: the quarterly charge (`monthly × 3`) is due every 3 months from `effective_from`. No discount by default (quarterly = exactly 3× monthly). The schedule generates 4 items per year at the quarter boundaries. | Quarterly is the middle ground — no discount (unlike annual), less frequent than monthly. The 4-items-per-year schedule is what the `FeeEngine.regenerateSchedule` produces from the quarterly `fee_plan`. | `FeeRateEngine` → quarterly `fee_plan` → 4 `fee_schedule_items`/year | Quarterly payer charged wrong amount or wrong months | `BR-FEE-20`, `BR-FEE-08`, `BR-CALC-09` |

---

## 3. Attendance Rules (BR-ATT)

Session creation, five-state status vocabulary, 24-hour lock (critical), bulk marking, holidays, make-up sessions, and the graduated unlock flow.

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-ATT-01**| One `attendance_sessions` row per `(batch_id, session_date)`. Re-marking same day updates the existing session, not a new one. | A session is a calendar event for a batch, not. | `UNIQUE` | INSERT aborts; engine retries as UPDATE | `BR-ATT-02`, `BR-ATT-03` |
|**BR-ATT-02**| `status ∈ {present, absent, late, excused, holiday}`. Present/absent toggles (default present). Late counts as present for %, flagged separately. | Five states cover every real case; six would clutter, four. | CHECK constraint; Zod | INSERT aborts | `BR-ATT-05`, `BR-RPT-05`, `BR-FEE-19` |
|**BR-ATT-03**| Marks are per-student. "Bulk present" sets all to present in one txn. "Bulk absent" requires typed `ABSENT` confirmation (rare intent). | Most days everyone is present — bulk is the fast. | `AttendanceEngine.bulkMark`; UI dialog | Silent bulk-absent erases a day's revenue signal | `BR-ATT-06`, EC-A-05 |
|**BR-ATT-04**| Marking a session as `holiday` soft-deletes all `attendance_records` for that `(batch_id, session_date)`, sets `attendance_sessions.status = 'holiday'`, excludes the date from attendance-percentage denominators, and displays a "HOLIDAY" badge on the calendar/heatmap. The session row is preserved (never deleted) so the audit trail retains the fact that a session was scheduled but cancelled. | A holiday is a real calendar event — erasing the session row would hide the fact that class was supposed to happen. The `holiday` status (not `deleted_at`) preserves provenance and lets `BR-CALC-06` exclude it from the denominator. | `AttendanceEngine.markHoliday`; `CHECK (status IN (...))`; `BR-CALC-06` excludes `holiday` | Holiday silently absorbed; attendance % drops without explanation | `BR-ATT-02`, `BR-ATT-09`, `BR-CALC-06`, EC-A-04, `06_Attendance.md §10.4` |
|**BR-ATT-05**| A session may be re-opened for editing within 24–72h with PIN; beyond 72h requires passphrase. Beyond 30 days, no re-open (correct via reversing entries on the ledger, not by editing history). | The graduated unlock matches the tutor's error-discovery curve. | `AttendanceEngine.requestUnlock`; `SecurityEngine.challenge` | Silent history rewrite | `BR-ATT-07`, `BR-ATT-08`, `BR-SEC-04`, EC-A-03 |
|**BR-ATT-06**| Bulk mark only affects unlocked sessions. Locked session → no-op with toast "Session locked — unlock first (PIN required)." | Locking freezes the audit trail; bulk-override would silently rewrite it. | `AttendanceEngine.bulkMark` checks `locked_at` | Locked attendance silently rewritten | `BR-ATT-07`, `BR-ATT-08` |
|**BR-ATT-07** [CRITICAL]| A session auto-locks 24h after `session_date` ends (configurable via `attendance_lock_hours`, default 24). | 24h matches the tutor's next-day review cycle. | `AttendanceEngine.lockIfDue`; `SecurityEngine.challenge`; trigger on `attendance_records` | Trigger aborts; toast "Session locked. | `BR-ATT-08`, `BR-LED-08`, EC-A-03 |
|**BR-ATT-08**| Editing a locked session requires PIN + audit delta `{before, after, student_id, session_id}`. | 24h–30d is "I noticed a mistake"; beyond 30d is "reopening. | `AttendanceEngine.requestUnlock`; `SecurityEngine.challenge` | Trigger aborts | `BR-ATT-07`, `BR-SEC-04`, EC-A-03 |
|**BR-ATT-09**| Marking a session `holiday` soft-deletes all `attendance_records`, excludes date from % denominators, shows "HOLIDAY" badge. Session row preserved. | A holiday is a real event; erasing the session row. | `AttendanceEngine.markHoliday` | Holiday silently absorbed; attendance drops unexplained | `BR-ATT-02`, EC-A-04 |
|**BR-ATT-10**| A make-up is a normal session with `notes` containing `[MAKEUP]` + reference to missed date. | Make-ups are extras, not replacements — the missed day is. | `AttendanceEngine.createMakeup`; `ReminderEngine.scanMakeups` | Double-counted attendance (inflated %) or no make-up tracking | `BR-ATT-02`, `BR-REM-04` |
|**BR-ATT-12**| Graduated/archived students excluded from the active enrollment roster. | Showing archived students invites marking errors and inflates the denominator. | Grid filters by `exited_on IS NULL` | Marks land on archived students; reports drift | `BR-STU-02`, `BR-STU-06`, EC-A-02 |

---

## 4. Student Rules (BR-STU)

Code generation, lifecycle transitions, duplicate detection, 30-day soft-delete grace, auto-archival, batch transfer, and graduation. Students are data, never the user (P1).

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-STU-01**| If `students.code` blank on create, assign `STU-<YYYY>-<NNNN>` from a per-tenant counter scoped to admission year. Unique per tenant, never reused. | The `STU-YYYY-NNNN` format is self-describing when read aloud by a. | `StudentEngine.assignCode`; `UNIQUE` | INSERT aborts; engine retries | `BR-BAT-01` |
|**BR-STU-02**| `active ⇄ inactive`; `active → graduated` (manual); `active/inactive → archived` (soft-delete, ledger frozen but readable); `archived → active` (restore, audit-logged). | Freezing on exit prevents accidental charges to students no longer. | `StudentEngine.transition`; `ledgerEngine.post` checks status | Charge posted to a graduated student | `BR-FEE-08`, EC-S-01, EC-S-05 |
|**BR-STU-03**| On create, compute `dup_key = lower(first_name + last_name + phone_last4)`. | Tutors add the same student twice more often than they. | `StudentEngine.detectDuplicate`; UI interstitial | Silent duplicates accumulate; reports double-count | EC-S-02 |
|**BR-STU-04**| During bulk import, if a student row has a blank `code` field, the engine auto-assigns `STU-<YYYY>-<NNNN>` per `BR-RC-02` using the import batch's admission year. If the `code` field is provided, it must be unique per tenant (else the row is rejected with an inline error in the import preview). | Bulk import is the primary onboarding path for tutors migrating from Excel. Auto-generating codes removes a field they don't care about; rejecting duplicates preserves the `UNIQUE` constraint. The inline error (not a modal) lets them fix and re-upload without losing the rest of the preview. | `ImportEngine.parseStudents`; `StudentEngine.assignCode`; `UNIQUE(tenant_id, code)` | Duplicate codes silently overwrite; import fails halfway | `BR-STU-01`, `BR-RC-02`, `BR-IMP-04`, `08_Settings.md §8`, `09_Backup_and_Import_Export.md §12` |
|**BR-STU-05** [CRITICAL]| v1 has no parent auth. No `students.password`, `last_login`, or `session_token` column. No parent login flow ships. | Per P1, the tutor is the user; parent auth would. | Schema lint `principles/no-student-auth.py` fails CI | CI fails; PR blocked | P1, `15_Future_Roadmap.md` v2.x |
|**BR-STU-06**| Archiving sets `archived_at = now()`. For 30 days, restore to `active` without data loss. | The 30-day window catches "I archived the wrong student" without. | `StudentEngine.archive/restore`; audit log | Tutors lose data permanently on a misclick | `BR-STU-02`, EC-S-01 |
|**BR-STU-07**| A student with zero `attendance_records` in 365 days AND `status='inactive'` is auto-archived by the nightly job. | Long-inactive students clutter the roster and inflate report denominators. | `NightlyJob.autoArchive`; `NotificationEngine` | Roster grows unbounded; reports drift | `BR-STU-06`, `BR-REM-04` |
|**BR-STU-08**| Transfer creates a new `student_enrollments` row (`joined_on = today`), sets `exited_on = today` on prior. | Transfer is forward-looking, not retroactive. | `StudentEngine.transfer`; `FeeEngine.regenerateSchedule` | Retroactive rewrites or duplicated charges | `BR-FEE-08`, `BR-FEE-18`, `BR-BAT-04` |
|**BR-STU-09**| `graduated` (manual only). Appears in Fees "Dues" filter with "Graduated" badge if outstanding. Excluded from active rosters; ledger remains collectable. | Graduation is forward: the student is no longer taught but. | `StudentEngine.transition`; `FeesScreen` filter | Graduated students disappear (revenue lost) or clutter the. | `BR-STU-02`, EC-S-05 |
|**BR-STU-10**| Selecting N students and "Delete" is blocked if any have ledger entries. | Deleting a student with ledger rows would orphan the immutable. | `StudentEngine.bulkDelete` pre-check; UI dialog | Orphaned ledger rows; reports fail | `BR-LED-01`, `BR-SEC-04`, EC-S-06 |
|**BR-STU-11** [CRITICAL]| **Free-tier student soft-guidance milestone: 250 per tutor (internal infra-cost guidance).** `StudentEngine.create` does NOT block at 250 — when a tutor's 251st student is created, it logs a `student_count_milestone` event to the audit log and surfaces a friendly, dismissable "tell us your story" prompt on the Dashboard (linking to founder email `hello@buddysaradhi.app`). There is NO hard cap in v1 — all 251+ students remain fully accessible (attendance, fees, receipts, sync, export, biometric login, all 5 screens). The soft-guidance milestone never applies to tutors on `pro`, `pro_scholarship`, or `institute` tiers (`settings.tier`). The 250 milestone is **grandfathered** as soft guidance for any tutor who signed up pre-trigger — see `BR-PRC-02`. | The 250-student milestone is internal infra-cost guidance (the threshold above which our Turso row-count and Vercel Blob backup-storage bills start to matter — see `product/05_Pricing_and_Plans.md §1.2`). It is NOT a user-facing cap. 250 covers ~99% of Indian private tutors while keeping our Turso/Vercel Blob usage inside the free bands. | `StudentEngine.create` count check (logs milestone, does NOT block); `pricingEngine.isFreeTierEligible(tutorId)`; ESLint `no-251st-student-paywall` (fails any PR that adds a hard block at 250) | A 251st student is silently blocked (regressing to the old paywall model); OR the soft-guidance prompt is mistakenly shown as an upgrade nag; OR the milestone is retroactively lowered post-trigger, breaking the grandfather clause | `BR-PRC-01`, `BR-PRC-02`, `BR-PRC-03`, `product/05_Pricing_and_Plans.md §1.2`, EC-PRC-01 |

---

## 5. Batch Rules (BR-BAT)

Code generation, capacity, weekly recurrence, archival, merge, and split — all forward-looking; history is never rewritten.

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-BAT-01**| If `batches.code` blank on create, assign `BAT-<YYYY>-<NNNN>` per-tenant counter scoped to creation year. Unique per tenant, never reused. | Mirrors `BR-STU-01` for batches. | `BatchEngine.assignCode`; `UNIQUE` | INSERT aborts | `BR-STU-01` |
|**BR-BAT-02**| A batch has a configurable `max_students` (default 30, editable in Settings → Profile). | Default matches the typical centre cap; per-batch override would invite. | `BatchEngine.enroll` checks active enrollment count | Over-enrolled batches; overcrowding invisible | `BR-STU-08` |
|**BR-BAT-03**| `batches.schedule = {days: ['MON','WED','FRI'], time: '18:00', duration_min: 90}`. Reminder Engine uses this to detect missing attendance. | Weekly recurrence on selected weekdays is the universal batch pattern. | `batches.schedule TEXT` ; `ReminderEngine.scanMissingAttendance` | Missing-attendance reminders fire on non-class days | `BR-REM-03`, `BR-ATT-01` |
|**BR-BAT-04**| Archiving sets `archived_at = now()`. Batch disappears from active selectors on Attendance/Fees. | A batch ending should retire the schedule, not delete the. | `BatchEngine.archive`; cascade to `fee_plans.active=0` | Students orphaned or ghost charges continue | `BR-FEE-08`, `BR-STU-08` |
|**BR-BAT-05**| Merging B into A moves `student_enrollments` from B to A (`joined_on = today`), marks B `archived_at = now()`, preserves all. | Merge is forward: "From today, B is part of A. | `BatchEngine.merge`; PIN + audit per `BR-SEC-04` | Duplicated charges or retroactive rewrites | `BR-BAT-04`, `BR-STU-08` |
|**BR-BAT-06**| Splitting A into A + B creates B with the same schedule, transfers selected students per `BR-STU-08`, preserves history on. | Split is the inverse of merge; same forward-looking semantics. | `BatchEngine.split`; PIN + audit | Duplicated charges or retroactive rewrites | `BR-BAT-05`, `BR-STU-08` |

---

## 6. Ledger Rules (BR-LED)

Append-only invariant, double-entry balance, numbering, void mechanism (PIN + compensating entry), hash chain, backdated entries, 24-hour lock aligned with attendance, and no-edit-only-void.

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-LED-01** [CRITICAL]| `ledger_entries` is INSERT-only. `db.ledgerEntry.update()` and `db.ledgerEntry.delete()` are blocked by Prisma middleware and SQLite triggers. Corrections are new rows with `reverses_entry_id`. | The ledger is the spine of trust. | `packages/core/src/ledgerGuard.ts` middleware + `trg_ledger_no_update` + `trg_ledger_no_delete` triggers | Prisma middleware raises `E_LEDGER_IMMUTABLE`; trigger aborts as defence-in-depth | `BR-LED-02`, `BR-LED-04`, `BR-LED-10` |
|**BR-LED-02**| Every entry has `direction ∈ {charge, credit}`. `balance_due = Σ(charge) − Σ(credit)` over non-VOID, non-reversed rows. | Double-entry is the centuries-old defence against accounting errors. | `student_balance` derived view | Reports disagree with reality | `BR-FEE-01`, `BR-RPT-04` |
|**BR-LED-03**| `receipts.number = receipt_prefix + zero-pad(next_receipt_seq, 6)`; `invoices.number = invoice_prefix + zero-pad(next_invoice_seq, 6)`. | Gap-tolerance preserves the audit trail; reusing numbers erases it. | Atomic CTE on sequence columns; UNIQUE constraints | INSERT aborts; engine retries with next sequence | `BR-FEE-09`, EC-F-03, EC-F-08 |
|**BR-LED-04** [CRITICAL]| Voiding requires (a) PIN/biometric per `BR-SEC-04`, (b) a new `VOID` row mirroring the original (opposite direction, equal amount, `reverses_entry_id` set). | Voids are the legitimate correction path; making them easy invites. | `ledgerEngine.void`; `SecurityEngine.challenge`; trigger cascade | Trigger aborts | `BR-LED-01`, `BR-LED-05`, `BR-LED-08` |
|**BR-LED-05**| A `VOID` entry cannot itself be voided. | Recursive voids create a chain that's hard to audit and. | `ledgerEngine.void` checks `target.type <> 'VOID'` | UI blocks: "Cannot void a void. | `BR-LED-04`, `BR-FEE-12` |
|**BR-LED-06**| Each row carries `prev_hash = sha256(prev_row.id ‖ prev_row. | Per-row tamper hashes detect single-row tampering; a chain detects row. | `ledgerEngine.post`; `NightlyJob.verifyChain` | Red "CHAIN BROKEN at entry X" in Diagnostics. | `BR-FEE-09`, `10_Security.md` §14, EC-SEC-03 |
|**BR-LED-07**| Posting with `occurred_on` earlier than the last locked session date is allowed but requires (a) PIN per `BR-SEC-04` and (b). | Tutors legitimately record past payments; blocking would force them to. | `ledgerEngine.post` checks date delta; `SecurityEngine.challenge` | Trigger aborts without PIN | `BR-ATT-07`, `BR-SEC-04`, EC-F-05 |
|**BR-LED-08** [CRITICAL]| For ledger entries linked to an attendance session, the 24h lock of `BR-ATT-07` applies: within 24h, free void + repost; | Aligning the two locks prevents the inconsistency where attendance is. | `ledgerEngine.void` checks linked session's `locked_at` | Ledger and attendance disagree about the same day | `BR-ATT-07`, `BR-LED-04`, `BR-ATT-08` |
|**BR-LED-09**| Voiding a `FEE_CHARGED` is permitted only if no `PAYMENT_RECEIVED` credits it. | Voiding a paid charge would leave an orphan credit. | `ledgerEngine.void` checks for crediting payments; UI shows "Void | Orphan credits; balances drift | `BR-LED-04`, EC-F-06 |
|**BR-LED-10** [CRITICAL]| No `UPDATE` to a ledger row for any field. Corrections are exclusively via `VOID` + new entry. | "Edit" is the gateway to silent history rewriting. | Trigger `trg_ledger_no_update`; UI lacks edit affordance | Trigger aborts | `BR-LED-01`, `BR-LED-04` |

---

## 7. Reminder Rules (BR-REM)

Exclusively about the tutor's obligations — never app usage (BR-REM-01) or marketing (BR-REM-09). Quiet hours, snooze limits, dedup, and the in-app → wa.me → system escalation ladder.

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-REM-01** [CRITICAL]| Zero engagement notifications. No "you haven't opened the app," no "weekly summary," no "streak lost. | Per P9, engagement notifications are spam dressed as helpfulness. | `ReminderEngine` category whitelist; CI lint | CI fails; PR blocked | P9, `15_Future_Roadmap.md` Explicitly Never |
|**BR-REM-02**| Generated when a `fee_schedule_items.status` flips to `overdue` (due_date < today AND no linked payment). | Overdue fees are the tutor's revenue signal; surfacing the day. | `ReminderEngine.scanDueFees` + `dedup` | Tutor misses overdue fees; revenue slips | `BR-FEE-17`, `BR-REM-07` |
|**BR-REM-03**| Generated when today is a scheduled batch day AND no `attendance_sessions` row exists by 21:00 local. Snoozeable to "tomorrow." | Forgetting to mark attendance is the most common tutor mistake. | `ReminderEngine.scanMissingAttendance` | Attendance gaps accumulate; reports show holes | `BR-BAT-03`, `BR-ATT-01` |
|**BR-REM-04**| Generated when a student has zero `attendance_records` in 14 days AND `status='active'`. Surfaced weekly (not daily) to avoid spam. | Inactive students are the tutor's churn signal; weekly surfacing keeps. | `ReminderEngine.scanInactive` | Tutor loses touch with at-risk students | `BR-STU-07`, `BR-ATT-10` |
|**BR-REM-05** [CRITICAL]| No reminder fires during 22:00–07:00 local. Reminders that become due during quiet hours are held and fire at 07:00. | A 23:30 "fee overdue" ping wakes the tutor and their. | `NotificationEngine.dispatch` checks local hour | Tutors mute the app entirely; reminders become useless | P9, `BR-REM-01` |
|**BR-REM-06**| A reminder may be snoozed at most 3 times. On the 4th attempt, only "Dismiss" or "Act now" offered. | Unlimited snoozing is procrastination-as-a-feature; the cap forces a decision. | `reminders.snooze_count`; `ReminderEngine.snooze` | Tutors snooze forever | `BR-REM-07` |
|**BR-REM-08**| v1 has in-app notifications only (bell + Dashboard). For forwarding to a parent, UI offers "Share via WhatsApp" → `https://wa.me/?text=<prefilled>`. | Buddysaradhi refuses to be the parent's notification channel; the tutor. | `NotificationEngine` ; UI "Share via WhatsApp" button | Tutor becomes our SMS gateway operator | `BR-STU-05`, `BR-REM-01`, `15_Future_Roadmap.md` v1.x |
|**BR-REM-09** [CRITICAL]| Zero marketing reminders. No "upgrade to v2," no "rate us," no "refer a friend. | Marketing notifications betray the tutor's trust in the app's calm. | `notifications.category` CHECK constraint; CI lint | CI fails; PR blocked | `BR-REM-01`, P9 |

---

## 8. Report Rules (BR-RPT)

Derived views — never pre-materialised. Monthly period close, fee-aging buckets, single-source-of-truth formulas, export formats, and the no-telemetry contract.

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-RPT-01**| Monthly periods close on the 1st at 00:00 local. | Closing gives the tutor a clean "August is done" boundary. | `NightlyJob.periodClose` | Reports drift as old periods get re-edited | `BR-FEE-17`, `BR-LED-04` |
|**BR-RPT-02**| The Student Ledger Report lists every `ledger_entries` row for a student chronologically, with `type`, `direction`, `amount` (in ₹ with `tabular-nums`), `occurred_on`, `receipt_no` (if linked), and `void` status. Voided entries show as strikethrough rows with the reversing entry's `receipt_no`. The report is printable (A4 portrait) and exportable as PDF. | The ledger is the spine (P4); the Student Ledger Report is its human-readable projection. A parent who demands "show me every payment" gets this report in two taps. The strikethrough-on-void convention is the same as the on-screen Fees ledger, so the tutor recognises it instantly. | `ReportEngine.studentLedger`; `04_Dashboard.md §6` (print) | Reports disagree with the Fees screen; voids invisible | `BR-RPT-04`, `BR-LED-02`, `BR-FEE-09`, `07_Fees_and_Payments.md §12` |
|**BR-RPT-03**| Overdue fees shown in 4 buckets: `0–7d`, `8–30d`, `31–90d`, `90+d`. Lower bound inclusive. | Aging is the universal receivables signal; 4 buckets are enough. | `ReportEngine.feeAging` | Tutors can't see which fees are truly stale | `BR-FEE-17`, `BR-REM-02` |
|**BR-RPT-04** [CRITICAL]| `balance_due = Σ(amount where direction='charge' AND type<>'VOID' AND reverses_entry_id IS NULL) − Σ(amount where direction='credit' AND type<>'VOID' AND reverses_entry_id IS. | Single-source-of-truth formula; re-implementing elsewhere is a P1 bug. | `student_balance` derived view; `BR-FEE-05` tolerance | Reports disagree with the ledger drawer | `BR-LED-02`, `BR-FEE-05` |
|**BR-RPT-05** [CRITICAL]| `pct = 100 × present / (present + absent + late)`. `excused` and `holiday` excluded from denominator. | Excluding `excused`/`holiday` prevents medical days and holidays from punishing the. | `ReportEngine.attendancePct`; CHECK constraint | Reports disagree with the heatmap | `BR-ATT-02`, `BR-RPT-04` |
|**BR-RPT-07** [CRITICAL]| Reports contain zero telemetry. No "how many tutors use this," no "average fee in your region," no benchmarking. | Per P14, benchmarking is a privacy violation dressed as helpfulness. | `ReportEngine` has no network calls except sync; CI | CI fails; PR blocked | P14, `BR-SEC-08` |
|**BR-RPT-08**| `collected_this_month = Σ(amount where type='PAYMENT_RECEIVED' AND direction='credit' AND occurred_on ∈ [month_start, month_end])`. Excludes VOID. Surfaced on Dashboard KPI. | The headline revenue number; must be unambiguous. | `ReportEngine.monthlyCollection`; Dashboard KPI | Dashboard shows wrong revenue | `BR-RPT-04`, `BR-LED-02` |

---

## 9. Sync Rules (BR-SYN)

v1 has a local-only sync stub (BR-SYN-01). Append-only outbox, LWW conflict resolution, ledger conflict-immunity, schema-drift refusal, and v2.0 vector clocks.

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-SYN-01** [CRITICAL]| v1 ships with a local-only sync stub. | Per `15_Future_Roadmap.md`, multi-device sync is v2. | `SyncEngine.flush` is a stub; `BR-SYN-07` governs v2 unlock | v1 gains an undeclared cloud dependency | `15_Future_Roadmap.md` v2.0, P5 |
|**BR-SYN-02**| `sync_outbox` is INSERT-only for `pending → sent`. `payload` is immutable once written. | The outbox is the audit trail of mutations intended for. | Trigger on `sync_outbox.payload`; status transition CHECK | Trigger aborts | `BR-LED-01`, EC-SY-01 |
|**BR-SYN-03**| For non-ledger rows, conflicts resolve by Last-Write-Wins on `updated_at` (Lamport counter for ties). | LWW is the simplest correct policy for non-financial data; surfacing. | `SyncEngine.resolveConflict` | Silent overwrite; data loss | `BR-SYN-04`, EC-A-07 |
|**BR-SYN-04**| Ledger entries are UUID v7-keyed and append-only; two devices posting different entries for the same student both land. | The ledger's append-only + UUID design exists precisely to make. | `ledger_entries` PK is UUID v7; no `db.ledgerEntry.update()` path | Double-counted payments | `BR-LED-01`, EC-SY-03 |
|**BR-SYN-05**| If device's `schema_version` < server's, refuse to sync (would corrupt). Prompt to update. Local data readable; sync paused. | Syncing an old client against a new schema would silently. | `SyncEngine.checkSchemaVersion`; migration runner | Data corruption | EC-SY-03, EC-SY-04, `02_Core_Logic.md` §9 |
|**BR-SYN-06**| The web client polls Turso every 30 seconds via HTTP (not WebSocket). Each poll fetches delta rows since the last `sync_cursor`. The poll is non-blocking; the UI never waits on it. | HTTP polling is simpler, cheaper, and CDN-friendly. WebSockets add a connection-management burden disproportionate to a tutor's data volume (a 50-student DB is ~200 KB total). 30s is fast enough for a multi-tab workflow without hammering Turso. | `SyncEngine.pollLoop` in the web client; `sync_cursor` stored in `app_state` | Stale data across tabs for up to 30s; user sees a "synced 12s ago" badge | `02_Core_Logic.md` §9, `web/02_State_and_Data_Flow.md` §3 |
|**BR-SYN-07**| v2.0 introduces vector clocks (per-device Lamport counter) for non-ledger conflict resolution, replacing LWW. Stored in `app_state. | LWW loses legitimate concurrent edits; vector clocks detect true concurrency. | v2.0 `SyncEngine`; gated by P5 amendment | v2 ships with LWW; concurrent edits silently lost | `15_Future_Roadmap.md` v2.0, `BR-SYN-03` |
|**BR-SYN-08**| If a sync poll fails (network error, 5xx, timeout), the client retries with exponential backoff (1s, 2s, 4s, 8s, max 30s) and never shows an error toast unless 3 consecutive polls fail (>90s offline). The "synced Xs ago" badge turns amber after 60s stale, flare after 180s. | Tutors on flaky Indian railway Wi-Fi should not see error toasts every 30 seconds. The badge colour is the honest signal; the toast is reserved for genuine outage. | `SyncEngine.pollLoop` backoff wrapper; `useSyncStatus` hook | Silent staleness beyond 180s without a flare badge | `14_Edge_Cases.md` EC-SY-05, `13_UI_Guidelines.md` §7 (status badges) |
|**BR-SYN-09** [CRITICAL]| A new device signing in for the first time downloads the full database from Turso in a single streaming pass (`db.student.findMany()` + `db.ledgerEntry.findMany()` + ... per table, batched by cursor), then builds the local IndexedDB (web) / SQLite (mobile/desktop) replica. The download is resumable: if interrupted, it resumes from the last `id` cursor checkpoint. Until the initial sync completes, the app shows an honest empty state ("Syncing your data… 47 of 120 students") — never partial data. | A tutor who signs in on a new phone and sees an empty dashboard will panic. The honest progress state is the contract. Resumability prevents re-downloading 200 KB on a 2G connection that drops at 80%. | `SyncEngine.initialFetch`; `useInitialSyncProgress` hook; `sync_state` table | Tutor sees empty dashboard on new device; tutor sees partial data | `01_Product_Principles.md` P15, `10_Security.md` §BR-SEC-04, `web/03_Auth_and_Provisioning.md` §7 |

---

## 10. Security Rules (BR-SEC)

Defence-in-depth: app lock, escalating lockout, sensitive-action allowlist, PIN/passphrase floors, no-plaintext-secrets, fail-closed audit, and session revocation.

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-SEC-01**| App locks after `session_timeout_min` (default 5) idle, or on cold start. Unlock via biometric (preferred) or PIN. | A tutor's phone holds every student's financial data; auto-lock is. | `SecurityEngine.lockIfIdle`; lock screen component | Data exposed on a lost/unattended device | `BR-SEC-02`, `10_Security.md` §3 |
|**BR-SEC-03** [CRITICAL]| 5 wrong PINs → 30s lockout. 10 → 5 min. 15 → wipe local cache (cloud intact); re-login + re-sync. | Brute-force defence; wipe threshold (15) is below 6-digit PIN entropy. | `SecurityEngine.trackFailedAttempts` | Brute-force succeeds | `BR-SEC-04`, EC-SEC-01, `10_Security.md` §3.4 |
|**BR-SEC-04** [CRITICAL]| The following require PIN/biometric even when app is unlocked: void receipt/ledger, unlock/edit locked attendance, backdated ledger, bulk delete, fee waiver. | App-unlocked ≠ authorised-for-everything. | `SecurityEngine.challenge`; CI lint that every action is wrapped | Sensitive mutation without challenge; P0 bug | `BR-LED-04`, `BR-ATT-08`, `BR-FEE-13` |
|**BR-SEC-05**| PIN ≥ 6 digits. Setup rejects shorter with inline error. No maximum (longer alphanumeric passphrase allowed). | 4-digit PINs (1 in 10k) fall to the 15-attempt wipe. | Zod `pin.length >= 6`; setup screen | Setup blocks save | `BR-SEC-03`, `10_Security.md` §3.2 |
|**BR-SEC-06**| Backup passphrase ≥ 12 chars. No complexity rules (no required uppercase/symbol) — length is the enforced dimension. | Length beats complexity for entropy; 12 lowercase chars × 26. | Zod `passphrase.length >= 12` | Setup blocks save | `BR-IMP-01`, `10_Security.md` §13 |
|**BR-SEC-07** [CRITICAL]| No plaintext secret ever written to the DB. PIN stored as `argon2id(pin)`. Backup passphrase stored as `argon2id(passphrase)`. | Plaintext secrets in the DB mean a stolen backup file. | CI lint forbidding plaintext-secret columns; `SecurityEngine.storeSecret` | CI fails; PR blocked | `BR-SEC-06`, `BR-FEE-09`, `10_Security.md` §6 |
|**BR-SEC-08**| Every `BR-SEC-04` action writes `audit_log` with `actor`, `action`, `ref_type`, `ref_id`, `metadata` (JSON), `created_at`. Audit log is itself append-only (trigger-guarded). | An unaudited sensitive action is worse than no audit —. | `audit_log` triggers; `SecurityEngine.challenge` wraps audit write in same | Trigger aborts; whole action rolls back | `BR-SEC-04`, EC-AU-02, EC-AU-03 |
|**BR-SEC-10**| Tutor can revoke all other sessions from Settings → Security → "Revoke sessions". | Lost-device recovery requires a one-click nuke. | `SecurityEngine.revokeSessions`; Supabase admin API | Lost device remains authenticated forever | EC-SEC-04, `10_Security.md` §17 |

---

## 11. UI Rules (BR-UI)

Five-screen doctrine, no bottom-tab "+", no indigo/blue accents (BR-UI-04, lint-enforced), dark-mode-only, glass panels, persistent shell.

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-UI-01** [CRITICAL]| v1 has exactly five top-level screens: Dashboard, Students, Attendance, Fees & Payments, Settings. | Per P2, the cognitive surface area of v1 is the. | Sidebar renders exactly 5 items; CI lint on | CI fails; PR blocked | P2, `02_Core_Logic.md` §1.1, `15_Future_Roadmap.md` |
|**BR-UI-02** [CRITICAL]| No bottom tab bar with a central "+" (the Instagram/Twitter pattern). | The central "+" signals "this app wants you to post. | Mobile layout lacks a central-tab affordance; CI lint | Wrong mental model imported | P1, `13_UI_Guidelines.md` §1 |
|**BR-UI-04** [CRITICAL]| Indigo and blue are forbidden as primary accent colours. | Indigo/blue are the default of every SaaS dashboard since 2018. | Tailwind config bans `indigo-*`/`blue-*` from primary scale; Stylelint | Stylelint fails; PR blocked | `13_UI_Guidelines.md` §1.4, `00_Vision.md` §9, P7 |
|**BR-UI-05**| v1 ships dark-mode only. The cosmic canvas (`#0f0c29` → `#24243e`) is the only theme. A light theme is v1. | The glass-and-neumorphism system is designed for dark backgrounds; light-mode glass. | `theme` column accepts `dark` only in v1; UI | Glass panels look washed-out in light mode; brand. | `13_UI_Guidelines.md` §1.3, `15_Future_Roadmap.md` v1.x |
|**BR-UI-07**| The shell persists across navigation. Only the content pane re-renders; sidebar and topbar never unmount. | Per P4, the Discord-style persistent flow is the inheritance; remounting. | Next.js app router has one route ; shell | Sidebar/topbar flicker on navigation; flow breaks | P4, `02_Core_Logic.md` §1, §5 |

---

## 12. Import/Export Rules (BR-IMP)

`.buddysaradhi` backup blob, integrity verification, CSV schema, Excel via SheetJS, restore-on-new-device flow, and the v1 no-auto-cloud-sync prohibition (critical).

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-IMP-01**| A `.buddysaradhi` file = gzipped tar: `data.jsonl` (all rows as NDJSON), `schema_version.txt`, `manifest.json` (counts, sha256 of `data.jsonl`, `created_at`, `tenant_id`). | A single self-describing file is portable and verifiable; AES-256-GCM +. | `BackupEngine.create`; `10_Security.md` §15 | Backup unreadable or insecure | `BR-SEC-06`, `BR-IMP-02`, EC-IE-06 |
|**BR-IMP-02**| On restore: (a) decrypt with argon2id key, (b) verify AES-GCM auth tag, (c) recompute sha256 of `data.jsonl`, compare to `manifest.json`. | A bit-flipped backup must not silently restore partial data. | `BackupEngine.verify` | Partial restore; corruption | `BR-IMP-01`, EC-IE-06 |
|**BR-IMP-03**| CSV imports/exports: header row required, UTF-8 with BOM, dates ISO `YYYY-MM-DD`, money as integer minor units, status fields lowercase enum. | A strict schema prevents the "Excel decided your date is. | Zod; `ImportEngine.parseCsv` | Import silently mangles data | `BR-IMP-04`, EC-IE-01, EC-IE-03 |
|**BR-IMP-04**| Excel `.xlsx` via SheetJS. Three worksheets: Students, Attendance, Payments. | SheetJS is the de facto browser-side Excel standard; streaming prevents. | `ImportEngine.parseXlsx`; `ExportEngine.exportXlsx` | Large imports crash the tab | `BR-IMP-03`, EC-IE-02, `09_Backup_and_Import_Export.md` §17 |
|**BR-IMP-05**| Restore on new device: (a) PIN + passphrase challenge, (b) integrity check per `BR-IMP-02`, (c) schema-version check (refuse if backup. | Restore is the highest-stakes operation; each gate prevents a specific. | `BackupEngine.restore`; `SecurityEngine.challenge` | Corrupt state; data loss | `BR-SEC-04`, `BR-SEC-06`, EC-IE-05 |
|**BR-IMP-06** [CRITICAL]| v1 has no automatic cloud sync. The `. | Auto-sync would undeclared-dependency v1 into a cloud product; per `15_Future_Roadmap. | No background sync job in v1; `SyncEngine.flush` is | v1 gains an undeclared cloud dependency; offline-first promise. | `BR-SYN-01`, `15_Future_Roadmap.md` v2.0, P5 |

---

## 12a. Record Code Rules (BR-RC)

Monotonic, gap-tolerant, never-recycled sequence generation for student codes, receipt numbers, and invoice numbers. These are the spine of auditability — a reused number is a silent ledger forgery (AP-11).

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-RC-01**| Receipt numbers are `RCT-<YYYY>-<NNNNNN>` — per-tenant, per-year, zero-padded to 6 digits, monotonic, gap-tolerant, **never recycled**. A voided receipt keeps its number; the next receipt takes the next number. Gaps (from voids) are audit features, not bugs. | A tutor who sees `RCT-2025-000042` knows it is the 42nd receipt of 2025. A gap at 000041 means "receipt 41 was voided" — the void is in the ledger. Recycling the number would make two receipts with the same ID, destroying the audit trail. | `ReceiptEngine.nextNumber`; `db.receiptSequence.update({ data: { nextSeq: { increment: 1 } } })` inside `db.$transaction` (atomic increment holds the row lock) | Duplicate receipt numbers; audit trail broken | `BR-LED-01`, `BR-FEE-09`, AP-11, `07_Fees_and_Payments.md §9` |
|**BR-RC-02**| Student codes are `STU-<YYYY>-<NNNN>` — per-tenant, per-admission-year, zero-padded to 4 digits, monotonic, gap-tolerant, **never recycled**. A deleted-then-archived student keeps its code; a new student takes the next number in the admission-year sequence. | Same rationale as `BR-RC-01`. A tutor reading `STU-2025-0147` knows this student was the 147th admitted in 2025. The admission year in the code is a human-readable provenance marker. | `StudentEngine.assignCode`; `UNIQUE(tenant_id, code)` | `db.student.create()` aborts on unique violation; engine retries with next number | `BR-STU-01`, AP-11, `05_Students.md §4` |
|**BR-RC-03**| Invoice numbers are `INV-<YYYY>-<NNNNNN>` — same rules as `BR-RC-01`. An invoice and its receipt share the same `YYYY` but have independent sequences. | Invoices and receipts are different artefacts (invoice = demand for payment, receipt = proof of payment); conflating their sequences conflates their semantics. | `InvoiceEngine.nextNumber`; `sequences` table | Duplicate invoice numbers; reconciliation fails | `BR-RC-01`, `BR-FEE-09`, AP-11 |

---

## 12b. Onboarding Rules (BR-ONBOARD)

The first 90 seconds determine whether a tutor stays. These rules govern the signup-to-first-student flow and are the operationalisation of P12 (minutes-per-day) and P15 (honest empty states).

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-ONBOARD-1** [CRITICAL]| A new tutor must reach their first dashboard view in ≤ 90 seconds from the signup form submit. The timer stops when the Dashboard renders with the empty-state CTA ("Add your first student"). The 90s budget includes: Supabase OTP send (≤5s), OTP verify (≤5s user + ≤3s server), Turso DB provisioning (≤15s), schema bootstrap (≤3s), JWT + cookie set (≤2s), route to `/dashboard` + first paint (≤3s). The remaining ~55s is human typing time. | A tutor who waits 3 minutes for a dashboard assumes the app is broken and leaves. The 90s target is generous for a Mumbai 4G connection yet tight enough to discipline the provisioning pipeline. The timer is measured in production via Vercel Speed Insights (aggregate, no PII). | `provision-db` Edge Function; `web/03_Auth_and_Provisioning.md §7`; Vercel Speed Insights custom event `onboarding_complete` | Tutor abandons signup; CAC wasted | P12, P15, `product/05_Pricing_and_Plans.md §4.3`, `web/03_Auth_and_Provisioning.md §7` |
|**BR-ONBOARD-2**| The Dashboard empty state (zero students) shows: (a) a single CTA "Add your first student" (emerald, 44×44px touch target), (b) a 30-second looping GIF of the dashboard with sample data (muted, respects `prefers-reduced-motion`), (c) a "Import from Excel" secondary link, (d) a "Watch the 90s tour" tertiary link. No "Welcome to Buddysaradhi" splash modal. | An empty dashboard is a teaching moment (P15), not a void. The GIF shows the tutor what "full" looks like. The CTA is the next action — no decision paralysis. A splash modal is a 6th screen (AP-9). | `DashboardEmptyState` component; `04_Dashboard.md §3` (empty state) | Tutor stares at a blank screen; no path forward | P15, P2, `04_Dashboard.md §3`, `13_UI_Guidelines.md §8` |

---

## 12c. Money & Display Rules (BR-M)

Integer-paise storage, en-IN display, tabular-nums, and the formatting utilities that enforce them. These are the operationalisation of Rule 6 (integer paise, never float) and AP-17 (no float paise inputs).

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-M-01** [CRITICAL]| All money is stored as `INTEGER` paise. `ledger_entries.amount`, `fee_items.amount`, `invoices.total`, `receipts.amount` — all `INTEGER NOT NULL`. The UI may display ₹ with decimals (₹1,24,500.00) but the data layer never stores a float. | Float math on money produces rounding drift. ₹1,24,500.00 stored as `124500.00` will eventually become `124499.99999` after enough arithmetic. Integer paise is exact, auditable, and matches the India accounting convention. | `INTEGER` columns in DDL; Zod `z.bigint()` or `z.number().int()` on inputs; ESLint `no-raw-rupee-format` | Balance drift; reconciliation fails | Rule 6, AP-17, `11_Data_Model.md §3`, `07_Fees_and_Payments.md §2` |
|**BR-M-02**| Money is displayed in en-IN format: `₹1,24,500` (lakh/crore grouping, not `₹124,500`). Use `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })`. The `formatINR()` utility in `@buddysaradhi/shared` is the single source. | Indian tutors read ₹1,24,500 as "one lakh twenty-four thousand five hundred" — the comma after the thousands place (₹124,500) is the Western convention and slows reading. en-IN grouping is the native convention. | `formatINR()` shared utility; ESLint `no-raw-rupee-format` fails any PR that hard-codes a rupee string | Tutors misread amounts; looks like a foreign product | `BR-M-01`, `13_UI_Guidelines.md §3` (Typography — locale formatting in §3.4), `product/05_Pricing_and_Plans.md §3` |
|**BR-M-03**| All money displays use `font-variant-numeric: tabular-nums` so digits align in columns. ESLint rule `require-tabular-nums-on-amounts` enforces this on any element displaying a currency value. | Misaligned digits in a ledger column make scanning impossible. Tabular-nums gives each digit a fixed width, so ₹1,24,500 aligns under ₹38,200. | CSS `tabular-nums`; ESLint `require-tabular-nums-on-amounts` | Ledger columns look ragged; scanning slows | `13_UI_Guidelines.md §3` (Typography — Numeric & Figure Features in §3.4), `11_Data_Model.md §3.5` |
|**BR-M-04**| Negative balances (advances) render as `−₹500` in emerald (not red). Red is reserved for overdue. An advance is money the tutor owes the student — it's positive for the student, not a danger state. | Colour semantics must match the user's mental model. An advance paid by the student is a good thing (they paid early); red would signal danger where none exists. Emerald signals "you have credit." | `formatINR()` with `negativeColor: 'emerald'` option; `07_Fees_and_Payments.md §4` | Tutors confuse advances with overdues; panic | `BR-FEE-04`, `13_UI_Guidelines.md §2`, EC-F-07 |
|**BR-M-05**| Rounding: all calculations round to the nearest paise using `Math.round(result)` (banker's rounding not used — Indian accounting convention is round-half-up). Rounding happens at the final display step, never mid-calculation. If a fee split produces fractional paise (e.g., ₹100 ÷ 3 = ₹33.33₹), the remainder goes to the last instalment. | Mid-calculation rounding accumulates drift. The last-instalment-gets-remainder rule ensures the sum of instalments always equals the original amount exactly. | `roundPaise()` utility; `FeeEngine.splitInstalments` | Instalment sum ≠ original amount; reconciliation fails | `BR-FEE-18`, `BR-CALC-03`, EC-F-01, `14_Edge_Cases.md` EC-F-01 |

---

## 12d. Calculation Rules (BR-CALC)

The named calculation IDs referenced throughout the specs. These are the formula contracts — each ID is a stable join key between the spec, the code, and the test suite. The formulas themselves live in §13 below.

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-CALC-01**| Negative-balance display: if `balance_due < 0`, display `−₹{abs(balance_due)}` in emerald per `BR-M-04`. The absolute value is formatted via `formatINR()`. | See `BR-M-04`. | `formatINR()` + `FeesScreen` render | Advance shown as red; tutor panics | `BR-M-04`, `BR-FEE-04`, EC-F-07 |
|**BR-CALC-02**| Payment status derivation: `paid` if `balance ≤ 1 paise` AND ≥1 `FEE_CHARGED`; `partial` if `0 < balance < latest_invoice.total`; `unpaid` if `balance ≥ latest_invoice.total`; `no dues` if no `FEE_CHARGED`. The 1-paise tolerance prevents float-dust from blocking "paid." | See `BR-RPT-04`. | `FeesScreen.deriveStatus`; `BR-RPT-04` formula | Wrong status label; tutor confused | `BR-RPT-04`, `BR-FEE-05` |
|**BR-CALC-03**| Instalment split: `instalment[i] = round(total / n)` for `i < n`; `instalment[n] = total − Σ(instalment[1..n-1])`. The last instalment absorbs the remainder so the sum is exact. | See `BR-M-05`. | `FeeEngine.splitInstalments` | Instalment sum ≠ total; reconciliation fails | `BR-M-05`, `BR-FEE-18`, EC-F-01 |
|**BR-CALC-04**| Late fee: `late_fee = round(item.amount × late_fee_bps / 10000)` applied per `grace_days` past `due_date`. `late_fee_bps` defaults to 0 (off). When enabled, it's configured per-tenant in Settings → Fee Rules. | See `BR-FEE-17`. | `FeeEngine.applyLateFees` (nightly) | Late fees never fire or fire wrong | `BR-FEE-17`, `BR-REM-02` |
|**BR-CALC-05**| Prorated first instalment: `prorated = round(base_amount × days_remaining / total_days_in_cycle)`. `days_remaining` = days from join date to cycle end (inclusive). | See `BR-FEE-18`. | `FeeEngine.regenerateSchedule` on enrollment | Mid-cycle joiner overpays or underpays | `BR-FEE-18`, `BR-STU-08` |
|**BR-CALC-06**| Attendance percentage: `pct = 100 × present / (present + absent + late)`. `excused` and `holiday` excluded from denominator. If denominator is 0, `pct = null` (display "—"). | See `BR-RPT-05`. | `ReportEngine.attendancePct` | Holiday/absent inflates or deflates % | `BR-RPT-05`, `BR-ATT-02`, `BR-ATT-04` |
|**BR-CALC-07**| Attendance heatmap cell colour: `present` → emerald, `absent` → red, `late` → amber, `excused` → grey, `holiday` → violet stripe, no session → empty. Colour is never the only signal — each cell also carries a text label and icon per AP-14. | See `12_Business_Rules.md §13` (heatmap row). The violet-stripe (not blue) complies with the no-blue-accent rule (AP-6). | `AttendanceHeatmap` component; `04_Dashboard.md §9.3` | Colour-blind tutors can't distinguish states | `BR-ATT-02`, `BR-ATT-04`, AP-6, AP-14, `13_UI_Guidelines.md §2` |
|**BR-CALC-08**| Payment heatmap cell colour: `paid-in-full` → emerald, `partial` → amber, `unpaid/overdue` → red, `no due that week` → grey. Same dual-signal rule (colour + label) per AP-14. | See `12_Business_Rules.md §13` (heatmap row). | `PaymentHeatmap` component; `04_Dashboard.md §9.4` | Colour-blind tutors can't distinguish states | `BR-CALC-02`, AP-14, `13_UI_Guidelines.md §2` |
|**BR-CALC-09** [CRITICAL]| **Expected for a period** = `Σ monthly_fee_paise` for each month in the period, using the `student_fee_rates` row effective on the 1st of that month. A month where the student was `inactive`/`paused`/not-yet-enrolled contributes 0. `expectedForMonth = rate effective on month-1st`; `expectedForQuarter = Σ 3 months`; `expectedForYear = Σ 12 months`. The monthly fee is the base unit; quarterly = 3×, annual = 12× — always derived, never stored separately. | "Expected" must be computable to the paise for any past period. Using today's fee for a past month is a silent lie; the effective-dated history is the only honest model. The user's explicit ask: *"each student has a specific monthly amount … show quarterly and annually … use it in calculations."* | `packages/shared/src/feeCalc.ts` `expectedForPeriod/Month/Quarter/Year`; Prisma ORM over `student_fee_rates` | Dashboard "expected this month" is wrong; arrears drift; tutor loses trust in numbers | `BR-FEE-20`, `BR-FEE-22`, `11_Data_Model.md §15.4`, `04_Dashboard.md §6.2 C3` |
|**BR-CALC-10**| **Collected for a period** = `Σ(credit_paise where type='PAYMENT_RECEIVED') − Σ(debit_paise where type='REFUND_ISSUED')` over the period's date range. Voided entries excluded. | Collected is the hard cash that landed, minus what was returned. Refunds are charges (money out), so they subtract. | `packages/shared/src/feeCalc.ts` `collectedForPeriod/Month/Quarter/Year`; Prisma `aggregate` | Collected overstates (refunds not subtracted); reconciliation fails | `BR-LED-02`, `BR-FEE-14`, `11_Data_Model.md §15.4` |
|**BR-CALC-11**| **Arrears for a period** = `expectedForPeriod − collectedForPeriod − Σ(credit_paise where type='DISCOUNT_GRANTED')`. A negative result is an **advance** (the student paid ahead), displayed in emerald per `BR-M-04`. Arrears are never silently negative-to-zero clamped — the sign is information. | Arrears = what the tutor is owed for the period, accounting for waivers. The advance case (negative) is a good thing (early payment), not a danger state. | `packages/shared/src/feeCalc.ts` `arrearsForPeriod/Month/Quarter/Year` | Arrears wrong; advances hidden; reminder engine fires on students who prepaid | `BR-CALC-09`, `BR-CALC-10`, `BR-FEE-13`, `BR-M-04`, EC-F-08 |

---

## 12e. Pricing & Tier-Evolution Rules (BR-PRC)

The cost-anchored free-model rules. These operationalise the pricing spec in `product/05_Pricing_and_Plans.md §1.6` — the Free tier is ₹0/mo for up to 250 students per tutor while our backend infra stays inside its free bands; Pro (₹299/mo) and Institute (₹999/mo) launch on the §1.6 trigger. These rules are the contract every cross-reference in the spec package points to.

| ID | Statement | Rationale | Enforced-by | If-violated | Related |
|---|---|---|---|---|---|
|**BR-PRC-01** [CRITICAL]| **Free for everyone, for now.** ₹0/mo for every tutor, every feature, no card required. The public pricing page shows a single 'Free — Start free →' tier (one card, one CTA, one commitment block — see `product/05_Pricing_and_Plans.md §3`). Paid tiers (Pro ₹299/mo, Institute ₹999/mo) are internal-only future tiers (Appendix A of `product/05_Pricing_and_Plans.md`) — they are NOT shown on the public pricing page until the §1.6 trigger fires and `NEXT_PUBLIC_PAID_TIERS_LIVE` flips to `true`. The 250-student number is internal infra-cost guidance only (see `BR-STU-11`) — there is NO hard cap, NO paywall, NO waitlist in v1. | The cost-anchored free model: our infra bill today is ₹0/mo (Vercel Hobby, Turso free, Vercel Blob free, Razorpay UPI-0% all inside free bands), so the tutor's price is ₹0/mo. Charging ₹299/mo while our cost-to-serve is ₹0.0006/mo would be a tax on trust, not a business model. See `product/05_Pricing_and_Plans.md §1.6`. | `pricingEngine.isFreeTierEligible(tutorId)` always returns `true` pre-trigger; ESLint `no-waitlist-cta-on-pricing-page` (fails any PR adding a waitlist CTA); CI lint `pricing-surface-state.test.ts` (when `NEXT_PUBLIC_PAID_TIERS_LIVE=false`, exactly one Free card renders) | A waitlist CTA or future-tier card appears on the public pricing page in v1; OR a 251st student is blocked (regressing to the old paywall model); OR a hard cap is enforced at 250 | `BR-STU-11`, `BR-PRC-03`, `BR-PRC-10`, `product/05_Pricing_and_Plans.md §1`, `§1.6`, `§3`, EC-PRC-01 |
|**BR-PRC-02** [CRITICAL]| **Grandfather clause.** When the §1.6 trigger fires and paid tiers launch, every tutor who signed up before the trigger keeps Free access forever — every feature, every screen, every student, ₹0/mo. We do not retroactively lower the soft-guidance milestone, add a paywall, or remove features. A v1 Free user with 200 students on Day-0-post-trigger continues to operate at the 250 soft-guidance milestone — the friendly 'tell us your story' prompt remains the only 250-related surface, never a paywall, never an upgrade nag (see `BR-PRC-03`). | Breaking the grandfather clause is a bait-and-switch that destroys the trust the cost-anchored free model was built to earn. The 'Free for everyone, for now' promise is a public commitment (`product/05_Pricing_and_Plans.md §1.6.5`), not a marketing tactic. | `settings.tier` field — `free` vs `free_grandfathered` values; `pricingEngine.applyGrandfatherClause(tutorId, signupDate)`; CI lint `grandfather-clause-accuracy.test.ts` | Tutors hit a paywall at 25/250 students post-trigger; trust destroyed; mass churn | `BR-PRC-01`, `BR-PRC-03`, `product/05_Pricing_and_Plans.md §1.6.3`, EC-PRC-03 |
|**BR-PRC-03** [CRITICAL]| **NO paywall in v1.** The 250-student milestone is internal soft guidance only (see `BR-STU-11`). Crossing 250 triggers a friendly, dismissable 'tell us your story' prompt on the Dashboard (linking to founder email `hello@buddysaradhi.app`), NOT a paywall, NOT a waitlist, NOT an upgrade nag. All student data (251, 500, 1,000+ students) remains fully accessible — attendance, fees, receipts, sync, export, biometric login, all 5 screens. `StudentEngine.create` does NOT block at 250. There is NO hard cap in v1, pre-trigger or post-trigger. | A paywall at 250 would be a dark pattern that erodes the 'Free for everyone, for now' promise. The tutor's data is their property (P10); the 250 number is our internal infra-cost guidance, not a limit on the tutor. Locking the 251st student behind a paywall would be a bait-and-switch. | `pricingEngine.checkPaywallScope(action)` always returns `allow` in v1 (no action is ever blocked); `StudentEngine.create` logs `student_count_milestone` at 250 but does NOT return `E_FREE_TIER_LIMIT`; ESLint `no-251st-student-paywall` (fails any PR that adds a hard block at 250); ESLint `no-data-lock-in-paywall` | A 251st student is silently blocked (regressing to the old paywall model); OR the soft-guidance prompt is mistakenly shown as an upgrade nag; OR existing student data becomes read-only or inaccessible | `BR-PRC-01`, `BR-STU-11`, P10, `product/05_Pricing_and_Plans.md §1.2`, `§1.6.3`, EC-PRC-01, EC-PRC-02 |
|**BR-PRC-04**| **60-day notice.** When the §1.6 trigger fires (any of T1–T5 in `product/05_Pricing_and_Plans.md §1.6.2` for 3 consecutive months), the pricing page migrates from the single Free card (`§3`) to the 3-tier layout (Appendix A — Free + Pro + Institute with 'Start free →' / 'Upgrade to Pro →' / 'Upgrade to Institute →' CTAs) only after a 60-day public notice period. During the notice, a banner appears on every Free-tier dashboard: 'Heads up: Pro and Institute are launching on `[date]`. Your Free access does not change — every feature, every screen, every student stays free. The new tiers are for tutors who want unlimited students + priority support (Pro) or multi-tutor + GST invoice (Institute).' | The 60-day notice is part of the public commitment (`product/05_Pricing_and_Plans.md §1.6.5`). It gives Free-tier tutors time to decide whether to upgrade or stay on Free (which is forever, per the grandfather clause `BR-PRC-02`). | `pricingEngine.triggerFired()` schedules `paidTiersLaunchDate = now + 60 days`; `DashboardBanner` renders when `now < paidTiersLaunchDate`; CI lint `sixty-day-notice-accuracy.test.ts` | Paid tiers launch without notice; tutors surprised; trust eroded | `BR-PRC-01`, `BR-PRC-02`, `product/05_Pricing_and_Plans.md §1.6.2`, EC-PRC-04 |
|**BR-PRC-05**| **No ads, ever.** The Free tier never displays banner ads, interstitials, "upgrade to remove ads" prompts, or any advertising surface of any kind. The only "upgrade" surface is the dismissable banner in Settings → Billing that appears after a tutor crosses 200 students. | Ads in a tuition-management tool are unacceptable (`product/01_Product_Positioning.md §4.3`). The cost-anchored free model exists precisely so we never need to ads-monetize the Free tier. | ESLint `no-ad-component` fails any PR adding an ad surface; `pricingEngine.canShowAd()` always returns `false`; CI lint `no-ads-ever.test.ts` | Ads appear in Free tier; brand destroyed; tutors churn | `product/05_Pricing_and_Plans.md §1.6.3`, `product/01_Product_Positioning.md §4.3`, AP-9 |
|**BR-PRC-06**| **No sync throttling on Free.** A Free-tier tutor's sync frequency, sync_outbox flush rate, and Turso row-read quota are identical to a (future) Pro-tier tutor's. We do not throttle Free-tier sync to push tutors to Pro. | Throttling sync is a dark pattern that erodes the offline-first promise (P5). The cost-to-serve an additional Free-tier sync round-trip is ≈ ₹0.0001/mo — there is no cost justification to throttle. | `syncEngine.flush()` does not check `settings.tier`; CI lint `no-tier-based-sync-throttle.test.ts` | Free-tier sync degrades; tutors frustrated; "upgrade to sync faster" prompts appear | `BR-SYN-01`, P5, `product/05_Pricing_and_Plans.md §1.6.3` |
|**BR-PRC-07**| **No feature removal on Free.** The Free tier's feature set (5 screens, attendance, fees + receipts, encrypted backup export, cross-device sync, biometric login) is the full product. We do not remove features from Free to push tutors to Pro — ever. The only features Pro adds are: (a) unlimited students (vs 250), (b) priority email support (24h vs 5-business-day), (c) the ROI report (Institute only). | Removing features from Free to push upgrades is a bait-and-switch. The Free tier is the full product, capacity-limited only. | `featureFlags.ts` — `ENABLE_UNLIMITED_STUDENTS`, `ENABLE_PRIORITY_SUPPORT`, `ENABLE_ROI_REPORT` are the only Pro/Institute-gated flags; ESLint `no-new-free-tier-feature-gates` fails any PR adding a 4th flag | Free tier loses features over time; tutors surprised; trust eroded | `BR-PRC-01`, `product/05_Pricing_and_Plans.md §1.1`, EC-PRC-06 |
|**BR-PRC-08**| **The §1.6 trigger is monitored monthly.** The `pricing-trigger-monitor` GitHub Action runs on the 1st of every month, queries Vercel, Turso, Vercel Blob, and Razorpay billing APIs, and writes a row to `infra_cost_log` with the month's total. If any of T1–T5 fires for 3 consecutive months, the Action opens a "Pricing Trigger Fired" issue and emails the founder. The Action is the source of truth for trigger state — no human decision can override it. | The trigger is the contract. If it fires silently, we lose the 60-day notice window. If it fires manually, we lose the auditable trail. The Action makes the trigger objective and auditable. | `.github/workflows/pricing-trigger-monitor.yml`; `infra_cost_log` table; `pricingEngine.evaluateTriggers()` | Trigger fires silently; paid tiers launch without notice; OR trigger never fires; we lose money on infra | `BR-PRC-04`, `product/05_Pricing_and_Plans.md §1.6.2`, EC-PRC-07 |
|**BR-PRC-09**| **Scholarship honoured pre-trigger and post-trigger.** A government-school / NGO / first-generation educator who emails hello@buddysaradhi.app is upgraded to Pro (when Pro launches) free, forever. Pre-trigger, they are Free like everyone else (Free for everyone, for now — every feature, every screen, no card required). Post-trigger, they get Pro (unlimited students, priority support) at ₹0/mo. We do not ask for proof; we do not audit. | The scholarship is a values claim, not a marketing tactic (`product/05_Pricing_and_Plans.md §6.2`). Breaking it removes the page's moral centre. | `settings.tier = 'pro_scholarship'` flag set by admin tool; CI lint `scholarship-honoured.test.ts` checks scholarship recipients keep `pro_scholarship` indefinitely | Scholarship recipient asked to pay; values claim broken | `product/05_Pricing_and_Plans.md §6`, EC-PRC-08 |
|**BR-PRC-10**| **The `NEXT_PUBLIC_PAID_TIERS_LIVE` feature flag is the single source of truth for paid-tier state.** When `false` (default in v1), the pricing page shows a **single Free card** (one card, one 'Start free →' CTA, one commitment block — see `product/05_Pricing_and_Plans.md §3`), the monthly/yearly toggle is hidden, the payment-method icon row is hidden, and Razorpay checkout routes return `503 Service Unavailable`. When `true`, the pricing page migrates to the 3-tier layout (Appendix A — Free + Pro + Institute with 'Upgrade →' CTAs), the toggle renders, the payment-method icon row renders, and Razorpay checkout goes live. The flag is set by the founder after the §1.6 trigger fires and the 60-day notice period elapses. | A single feature flag makes the trigger state machine auditable and testable. Multiple ad-hoc flags would create drift between pricing-page UI, checkout routes, and dashboard banners. | `featureFlags.ts` — `NEXT_PUBLIC_PAID_TIERS_LIVE`; ESLint `no-ad-hoc-paid-tier-flag` fails any PR adding a second flag; CI lint `pricing-surface-state.test.ts` (when `false`, exactly one Free card renders; when `true`, exactly three cards render); CI lint `featured-tier-accuracy.test.ts` | Pricing page shows 3-tier layout but checkout returns 503; OR checkout works but pricing page shows single Free card; UI/contract drift | `BR-PRC-04`, `product/05_Pricing_and_Plans.md §1.6.4`, `§3`, Appendix A, EC-PRC-09 |

---

## 13. Calculation Reference

These formulas are the single source of truth. Re-implementing them in a second place is a P1 bug. The formula IDs mirror the rule IDs that own them.

| ID | Formula | Used by |
|---|---|---|
| `BR-RPT-04` | `balance_due = Σ(charges, type≠VOID, reverses IS NULL) − Σ(credits, type≠VOID, reverses IS NULL)` | Fees, Dashboard, Reports |
| `BR-RPT-05` | `attendance_pct = 100 × present / (present + absent + late)` | Attendance, Reports |
| `BR-RPT-08` | `collected_this_month = Σ(PAYMENT_RECEIVED credits, occurred_on ∈ month)` | Dashboard KPI |
| `BR-FEE-04` | `advance_balance = max(0, −balance_due)` | Fees screen, Student drawer |
| `BR-FEE-15` | auto-apply `PAYMENT_RECEIVED` tagged `[ADVANCE_APPLIED]` = `min(advance_balance, charge_amount)` | `ledgerEngine.post()` |
| `BR-FEE-17` | `late_fee = round(item.amount × late_fee_bps / 10000)` per `grace_days` past `due_date` | FeeEngine nightly |
| `BR-FEE-18` | `prorated_first_item = round(base_amount × days_remaining / total_days_in_cycle)` | FeeEngine on enrollment |
| `BR-RPT-03` | aging bucket = `floor(days_overdue / bucket_width)` with buckets [7, 30, 90, ∞] | Fees screen |
| Payment status | `paid` if `balance ≤ 1 minor unit` AND ≥1 `FEE_CHARGED`; `partial` if `0 < balance < latest_invoice.total`; `unpaid` if `balance ≥ latest_invoice.total`; `no dues` if no `FEE_CHARGED` | Fees screen |
| Heatmap (attendance) | green=present, red=absent, amber=late, grey=excused, violet stripe=holiday, empty=no session | Attendance, Dashboard |
| Heatmap (payment) | emerald=paid-in-full, amber=partial, red=unpaid/overdue, grey=no due that week | Dashboard |

---

## 14. Rule Precedence Defaults

When the Conflicts Matrix (§15) is silent, the following defaults apply in strict order:

1. **Immutability wins over convenience.** (`BR-LED-01`, `BR-LED-10`, `BR-LED-05`.) If a rule says "you can edit" and another says "the ledger is append-only," the append-only rule wins; the edit becomes a void-then-repost.
2. **Audit wins over performance.** (`BR-SEC-08`.) If a rule says "skip the audit log for speed" and another says "audit everything sensitive," the audit rule wins.
3. **Offline-first wins over fresh-data freshness.** (`BR-SYN-01`, `BR-IMP-06`.) If a rule says "always show the latest cloud state" and another says "v1 is local-only," the local-only rule wins.
4. **Tutor intent wins over automated defaults** — but only after the above three are satisfied. (P1.) If a rule says "auto-apply the advance" and the tutor explicitly says "don't," the tutor's explicit confirmation wins.

These defaults are not a substitute for the Conflicts Matrix. They are the tie-breaker when no matrix entry covers the case.

---

## 15. Rule Conflicts & Precedence Matrix

Read row-first: the situation is the row, the conflict is the column pair, the cell names the winning rule.

| # | Situation | Rule A | Rule B | Winner | Resolution |
|---|---|---|---|---|---|
| 1 | Ledger entry linked to a session within 24h; tutor wants to void | `BR-LED-04` (void needs PIN) | `BR-ATT-07` (lock after 24h) | `BR-LED-04` | Void allowed with PIN; session not yet locked. |
| 2 | Same as #1 but session is 48h old | `BR-LED-04` | `BR-ATT-07` + `BR-LED-08` | `BR-LED-08` | Void allowed with PIN; audit `backdated_ledger` + `attendance_edit_locked`. |
| 3 | Same as #1 but session is 35 days old | `BR-LED-04` | `BR-LED-08` (30-day hard lock) | `BR-LED-08` | Void forbidden except via request-unlock flow. |
| 4 | Prepaid student marked present without payment | `BR-FEE-19` (soft block) | `BR-ATT-02` (mark any status) | Both | Mark allowed; amber chip persists per `BR-FEE-19`. |
| 5 | Tutor voids a payment that already closed an invoice | `BR-LED-04` (void) | `BR-FEE-09` (invoice closed) | `BR-LED-04` | Void proceeds; invoice reverts to `unpaid`/`partial` per cascade. |
| 6 | Tutor voids a fee charge that has payments against it | `BR-LED-04` (void) | `BR-LED-09` (no void with credits) | `BR-LED-09` | Void blocked; tutor must void credits first. |
| 7 | Auto-archive fires on a student with outstanding dues | `BR-STU-07` (auto-archive) | `BR-STU-02` (dues collectable) | Both | Archive proceeds; dues remain collectable per `BR-STU-02`. |
| 8 | Late-fee computation fires on a fee with a discount | `BR-FEE-17` (late fee) | `BR-FEE-10` (discount) | Both | Late fee computed on post-discount `item.amount`. |
| 9 | Reminder fires during quiet hours | `BR-REM-02` (due fee) | `BR-REM-05` (quiet hours) | `BR-REM-05` | Reminder held to 07:00. |
| 10 | Tutor snoozes a reminder for the 4th time | `BR-REM-07` (snooze options) | `BR-REM-06` (max 3 snoozes) | `BR-REM-06` | Snooze blocked; only Dismiss or Act now. |
| 11 | Two devices post the same payment offline | `BR-SYN-04` (ledger conflict-immune) | `BR-FEE-04` (no negative balance) | Both | Both land; overpayment splits per `BR-FEE-04` + `BR-FEE-15`. |
| 12 | Restore backup over a DB with overlapping student IDs | `BR-IMP-05` (restore) | `BR-STU-03` (duplicate detection) | `BR-IMP-05` | Restore overwrites by ID; pre-restore state audited. |
| 13 | Bulk delete attempted on students with ledger rows | `BR-STU-10` (bulk delete blocked) | `BR-LED-01` (append-only) | `BR-STU-10` | Blocked; archive offered instead. |
| 14 | Export attempted without PIN | `BR-SEC-04` (sensitive action) | (none) | `BR-SEC-04` | PIN required; after 3 fails, 30s lockout. |
| 15 | Currency change attempted after first ledger entry | `BR-FEE-02` (one currency) | (none) | `BR-FEE-02` | Blocked; 🔒 chip shown. |

When a new conflict is identified in production, it is added here in the next spec amendment. A conflict not yet in the matrix is decided by the §14 defaults and then back-filled here.

---

## 16. Rule Amendment Process

Mirroring `01_Product_Principles.md`'s Amendment Process, business-rule amendments follow a four-stage flow:

### 16.1 RFC (anyone may propose)
Any tutor, engineer, or spec reader may file a Business Rule RFC as a GitHub issue tagged `br-rfc`. The RFC must state: (a) the rule to add/retire/rewrite, (b) the motivating situation, (c) the proposed five fields (statement + rationale + enforcement + if-violated + related), (d) which existing rules need cross-reference updates. An RFC without all fields is auto-closed.

### 16.2 14-Day Cooling-Off
Once labelled `br-discuss`, the RFC enters a 14-calendar-day cooling-off for reading, debate, and revision. No PR may merge a rule change while its RFC is in cooling-off. The cooling-off prevents reactive rule additions ("a tutor emailed us, let's ship a rule today").

### 16.3 Ratification
After 14 days, a maintainer labels the RFC `br-ratify` or `br-reject`. Ratification requires: (a) the rule fits within an existing domain (or §1 is updated for a new one), (b) cross-references are queued, (c) a test file is queued, (d) the registry generator is updated. Recorded in `worklog.md` and the footer.

### 16.4 Implementation
A PR may then implement the ratified rule: this file, cited specs, test, and registry in one PR. CI enforces no rule PR merges without `br-ratify`. Security emergencies follow the fast-track in `10_Security.md` §22 (CVE response), which can ratify in 48 hours with two maintainer sign-offs.

### 16.5 Retirement
Retiring a rule follows the same RFC → 14-day → ratify flow. A retired rule is marked `[RETIRED]` in place with a one-line reason and a citation to the superseding rule. The ID is never reused.

---

## 17. ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 (ASCII Art Conventions) for the Business Rules doc. The mockups here are **coverage maps, money-flow state machines, and conflict-resolution decision trees**, with UI surfaces (chips, banners, lockouts) annotated inline. Glass tiers (`.glass` / `.glass-strong` / `.glass-faint` per §5.5) and neumorphic recipes (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6) annotated. Character set per §20.2. Accent colours named, never hexed. Cross-references use canonical IDs only (`§5.4`, `§5.5`, `§6.6`, `BR-*`, `EC-*`, `P*`, `AP-*`).

### 17.1 Design System Reference — Business Rules

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces rendered by rule enforcement | Tier | Cross-ref |
|---|---|---|
| Currency-locked chip (after first ledger entry — BR-FEE-02) | `glass-faint` band, 🔒 icon | §5.5, §8.3 |
| Amber prepaid chip (BR-FEE-19 — soft block) | `glass-faint` band, amber accent | §5.4, §8.3 |
| Soft-block interstitial (prepaid student, mark present) | `glass-strong` + backdrop | §5.5, §8.7 |
| PIN gate modal (BR-SEC-02 — sensitive action) | `glass-strong` + backdrop | §5.5, §8.7 |
| Lockout countdown overlay (BR-SEC-01 — fail 3+) | `glass-faint` recede | §5.5 |
| Bulk-delete blocked banner (BR-STU-10) | `glass` + flare accent left-border | §5.4, §8.3 |
| Late-fee amber chip on receipt (BR-FEE-17) | `glass-faint` band, amber accent | §5.4, §8.3 |
| Toast (rule-allowed / rule-blocked / rule-locked) | `glass-strong` + 4px accent left-bar | §5.5, §8.8 |

| Neumorphic controls rendered by rule enforcement | Recipe | Cross-ref |
|---|---|---|
| PIN pad digit buttons (BR-SEC-02 gate) | `neumo-raised`; press = `neumo-pressed` | §6.6, §8.2 |
| Snooze / Dismiss / Act-now buttons (BR-REM-06 max-3) | `neumo-raised` secondary; primary = emerald | §6.6, §8.2 |
| Reason input (backdated void — BR-LED-08) | `neumo-inset` well | §6.6, §8.9 |
| Typed-confirm input (EXPORT / VOID / RESTORE / ERASE) | `neumo-inset` well (case-sensitive, AP-13) | §6.6, §8.9 |
| Archive-instead-of-delete button (BR-STU-10 fallback) | `neumo-raised` secondary | §6.6, §8.2 |

> **References:** Martin Kleppmann — *Designing Data-Intensive Applications* (the append-only ledger rule, BR-LED-01); OWASP — *Input Validation Cheat Sheet* (the Zod + SQL CHECK enforcement pattern); Nielsen Norman Group — *Confirmation Dialogs* (the typed-confirm pattern); WCAG 2.1 AA §3.3.2 (labels — the 🔒 chip on currency lock); Apple HIG — *Alerts* (the soft-block interstitial); Material Design 3 — *Snackbars* (the rule-allowed/blocked toast).

### 17.2 Mockup R1 — BR-Domain Coverage Map (11 domains)

```
BR-DOMAIN COVERAGE MAP — 11 domains, 89 rules total (per footer count)
                          (each domain owns its slice of the spec surface)
┌─────────────────────────────────────────────────────────────────────────────────┐
│  DOMAIN            │ RULES │ OWNER SPEC                  │ SCREEN SURFACE       │
├─────────────────────────────────────────────────────────────────────────────────┤
│  BR-FEE  Fees&Money│  16   │ 07_Fees_and_Payments.md     │ Fees & Payments      │
│         (CRITICAL:  │      │ · currency, fee plans,      │ + receipt PDF        │
│          BR-FEE-01) │      │   discounts, late fees,     │                      │
│                    │      │   refunds, waivers, dual     │                      │
│                    │      │   model                      │                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  BR-ATT  Attendance│  9    │ 06_Attendance.md            │ Attendance           │
│         (CRITICAL:  │      │ · sessions, status vocab,   │ + mark buttons       │
│          BR-ATT-07) │      │   locking, make-up, holiday │   (.neumo-raised)    │
├─────────────────────────────────────────────────────────────────────────────────┤
│  BR-STU  Students  │  9    │ 05_Students.md              │ Students             │
│         (CRITICAL:  │      │ · codes, lifecycle, dups,   │ + drawer             │
│          BR-STU-02) │      │   archival, graduation      │   (.glass-strong)    │
├─────────────────────────────────────────────────────────────────────────────────┤
│  BR-BAT  Batches   │  6    │ 02_Core_Logic.md §2         │ Students (batch chip)│
│                    │      │ · creation, schedule,       │                      │
│                    │      │   capacity, archival        │                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  BR-LED  Ledger    │  10   │ 11_Data_Model.md §8         │ Fees (ledger view)   │
│         (CRITICAL:  │      │ · append-only (BR-LED-01),  │ + receipt PDF        │
│          BR-LED-01, │      │   double-entry, voids,      │                      │
│          BR-LED-04, │      │   hash chain, locking       │                      │
│          BR-LED-05) │      │                              │                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  BR-REM  Reminders │  8    │ 02_Core_Logic.md §7         │ Dashboard feed       │
│         (CRITICAL:  │      │ · quiet hours, dedup,       │ + Fees (remind chip) │
│          BR-REM-02) │      │   snooze, anti-marketing    │                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  BR-RPT  Reports   │  6    │ 04_Dashboard.md             │ Dashboard (export)   │
│         (CRITICAL:  │      │ · period close, aging       │ + PDF export         │
│          BR-RPT-03) │      │   buckets, formulas, no-tel │                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  BR-SYN  Sync      │  6    │ 02_Core_Logic.md §9         │ (invisible —         │
│         (CRITICAL:  │      │ · outbox (BR-SYN-02),       │  surfaces only on    │
│          BR-SYN-02) │      │   conflict resolution,      │  conflict)           │
│                    │      │   schema drift, v2 vectors  │                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  BR-SEC  Security  │  8    │ 10_Security.md              │ Lock screen + PIN    │
│         (CRITICAL:  │      │ · PIN, biometric, lockout,  │   pad (.neumo-       │
│          BR-SEC-02, │      │   allowlist, passphrase,    │    raised)           │
│          BR-SEC-06) │      │   no-plaintext              │                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  BR-UI   UI        │  5    │ 13_UI_Guidelines.md         │ (all 5 screens —     │
│         (CRITICAL:  │      │ · 5-screen, no indigo/blue, │  design system is    │
│          BR-UI-01)  │      │   touch targets, dark-only  │  the rule)           │
├─────────────────────────────────────────────────────────────────────────────────┤
│  BR-IMP  Import/   │  6    │ 09_Backup_and_Import_       │ Settings (backup/    │
│         Export     │      │   Export.md                  │  restore modal +     │
│         (CRITICAL:  │      │ · CSV/Excel schema, backup  │   CSV import         │
│          BR-IMP-05) │      │   blob, restore flow        │   preview)           │
├─────────────────────────────────────────────────────────────────────────────────┤
│  BR-RC   Record    │  (in  │ 12 §12a                     │ Fees (receipt no.    │
│         Codes      │   §12a)│ · monotonic, gap-tolerant, │  chip on receipt)    │
│                    │      │   never recycled             │                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  BR-ONBOARD Onboard│  (in  │ 12 §12b                     │ Onboarding 8-step    │
│                    │   §12b)│ · 7-min gate, resumable,    │  funnel              │
│                    │      │   amber banner on skip      │                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  BR-M    Money&Disp│  (in  │ 12 §12c                     │ (all 5 screens —     │
│         (CRITICAL:  │   §12c)│ · INTEGER paise, en-IN    │  every ₹ display)    │
│          BR-M-01)  │      │   grouping, tabular-nums    │                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  BR-CALC Calc Ref  │  (in  │ 12 §12d + §13               │ Dashboard KPIs +     │
│         (CRITICAL:  │   §12d)│ · running balance, aging  │  Fees reports        │
│          BR-CALC-03)│      │   buckets, attendance %     │                      │
└─────────────────────────────────────────────────────────────────────────────────┘

   ↑ 11 primary domains (BR-FEE through BR-IMP) + 4 sub-domain tables (BR-RC,
     BR-ONBOARD, BR-M, BR-CALC) = 89 total rules.
   ↑ Each [CRITICAL] rule is mirrored in 01_Product_Principles.md's Code Map and
     in tests/business-rules/<rule-id>.spec.ts. A [CRITICAL] violation is a P0
     review block, not a P1.
   ↑ The "X business rules" stat on the public site is generated from
     src/data/business-rules-registry.ts, which is itself generated from this
     file. The generator is the source of truth — never hand-edit the counter.
```

- ↑ **Every domain maps to exactly one owner spec.** A rule without an owner spec is a spec defect (§How to Read This File).
- ↑ **Critical rules are load-bearing.** Violating BR-FEE-01 (integer paise), BR-LED-01 (append-only), BR-SEC-02 (PIN gate), or BR-SYN-02 (sync_outbox) is a P0 review block.
- ↑ **BR-UI is enforced by lint, not by code.** The `no-indigo-accent` and `no-blue-accent` ESLint rules block AP-6 violations at compile time (BR-UI-01).

### 17.3 Mockup R2 — Money-Flow State Machine (charge → discount → pay → refund → void → writeoff)

```
MONEY-FLOW STATE MACHINE — the life cycle of a fee (BR-FEE-*, BR-LED-*)
   each transition is one or more ledger_entries rows; balances are derived

   ┌─ DRAFT (invoice created, not yet charged) ───────────────────────────────┐
   │  · invoices.status = 'draft'                                              │
   │  · no ledger_entries row yet                                              │
   │  · editable freely (P6 — defaults sacred, override available)            │
   └────────────────────────────────────┬──────────────────────────────────────┘
                                        │ BR-FEE-03 (charge invoice)
                                        │ → ledger_entries INSERT (type=FEE_CHARGED,
                                        │   debit_paise = invoice.amount_paise)
                                        ▼
   ┌─ CHARGED (fee is on the student's balance) ──────────────────────────────┐
   │  · invoices.status = 'unpaid'                                             │
   │  · ledger_entries row written; balance_due_paise increased                │
   │  · ↑ amber chip "Due ₹2,000" on Students row (.glass-faint, §8.3)        │
   └────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                ┌───────────────────────┼────────────────────────┐
                │                       │                        │
                ▼                       ▼                        ▼
   ┌─ DISCOUNT applied ─┐   ┌─ PARTIAL PAYMENT ────┐   ┌─ FULL PAYMENT ────────┐
   │  · BR-FEE-10        │   │  · BR-FEE-04         │   │  · BR-FEE-04           │
   │  · ledger_entries   │   │  · PAYMENT_RECEIVED  │   │  · PAYMENT_RECEIVED    │
   │    INSERT (type=    │   │    credit_paise <    │   │    credit_paise =      │
   │    DISCOUNT,        │   │    debit_paise       │   │    debit_paise         │
   │    credit_paise =   │   │  · receipts row +    │   │  · receipts row +      │
   │    discount_amount) │   │    tamper_hash (1:1) │   │    tamper_hash (1:1)   │
   │  · invoice.amount   │   │  · invoices.status   │   │  · invoices.status =   │
   │    _paise reduced   │   │    = 'partial'       │   │    'paid'              │
   │  · ↑ emerald chip   │   │  · ↑ amber chip      │   │  · ↑ emerald "Paid"    │
   │    "Discount ₹200"  │   │    "Partial ₹1,500   │   │    chip (.glass-faint, │
   │    (.glass-faint)   │   │     of ₹2,000"       │   │    emerald accent,     │
   │                     │   │    (.glass-faint)    │   │    §5.4)               │
   └─────────┬───────────┘   └──────────┬───────────┘   └──────────┬─────────────┘
             │                          │                          │
             └─────────────┬────────────┴──────────────────────────┘
                           │ (any time within lock window)
                           ▼
   ┌─ REFUND (rare; tutor owes student) ──────────────────────────────────────┐
   │  · BR-FEE-15 (refund)                                                     │
   │  · ledger_entries INSERT (type=ADJUSTMENT, debit_paise = refund_amount)   │
   │  · reduces balance_due_paise (can go negative — BR-FEE-04 forbids < 0    │
   │    EXCEPT for documented advance payments, BR-LED-06)                     │
   │  · ↑ cyan chip "Refund ₹500" (.glass-faint, cyan accent, §5.4)           │
   └───────────────────────────────────────────────────────────────────────────┘
                           │
                           │ (if the charge was a mistake or the payment was
                           │  logged to the wrong student)
                           ▼
   ┌─ VOID (reverses a specific entry; original row preserved) ───────────────┐
   │  · BR-LED-04 (void needs PIN), BR-LED-03 (reversing entry)               │
   │  · ledger_entries INSERT (type=VOID, debit/credit = OPPOSITE of original, │
   │    void_of_id = original.id)                                              │
   │  · receipts.voided_at = now(); PDF re-stamped "VOID" (flare overlay)     │
   │  · invoice.status reverts (paid → unpaid or partial)                     │
   │  · receipt_no NEVER reused (BR-RC-01, AP-11)                              │
   │  · ↑ flare chip "VOID" on receipt row (.glass-faint, flare accent)       │
   │                                                                            │
   │  · void BLOCKED if:                                                       │
   │    (a) entry > 30 days old (BR-LED-05 hard-lock → request-unlock flow)   │
   │    (b) entry is a FEE_CHARGED with payments against it (BR-LED-09        │
   │        no-void-with-credits → tutor must void credits first)             │
   │    (c) entry is itself a VOID (BR-LED-03 — can't void a void)            │
   └───────────────────────────────────────────────────────────────────────────┘
                           │
                           │ (if the debt is uncollectable — tutor writes it off)
                           ▼
   ┌─ WRITEOFF (waiver; erases a portion of the due) ─────────────────────────┐
   │  · BR-FEE-18 (waiver)                                                     │
   │  · requires: PIN + typed reason + audit_log (sensitive action, AP-12)    │
   │  · ledger_entries INSERT (type=WRITEOFF, credit_paise = waived_amount)    │
   │  · balance_due_paise reduced (cannot go below 0)                          │
   │  · ↑ violet chip "Waiver ₹500" (.glass-faint, violet accent, §5.4)       │
   │    (violet = manual / human-in-the-loop action — §2.4 of 13_UI_Guidelines)│
   └───────────────────────────────────────────────────────────────────────────┘

   ↑ Each transition is ONE OR MORE ledger_entries rows in ONE transaction.
     The original row is NEVER edited — correction is always via a new row.
   ↑ The balance_due_paise is a derived view (§15.1 of 11_Data_Model.md) —
     sum of non-VOID debits minus sum of non-VOID credits.
   ↑ Money is INTEGER paise at every transition (BR-FEE-01, BR-M-01, AP-17).
     No float arithmetic; no rounding drift; no REAL column type.
```

- ↑ **Each transition is auditable.** Every INSERT into `ledger_entries` carries a `tamper_hash` chained to the prior row, so the entire money-flow is reconstructable from the ledger alone (`11_Data_Model.md` §8.1).
- ↑ **VOID ≠ DELETE.** The original row is preserved; the VOID row reverses its effect. A tutor reading the ledger sees both rows, with the VOID stamped and the original marked "voided by le-XXX."
- ↑ **WRITEOFF is the only path that erases a debt without reversal.** It requires the strongest friction (PIN + typed reason + audit), because it is the one transition that does not preserve the original obligation (BR-FEE-18, AP-12).

### 17.4 Mockup R3 — Conflict-Resolution Decision Tree (when two BR-* strain)

```
CONFLICT-RESOLUTION DECISION TREE — extends §15 Rule Conflicts & Precedence Matrix
                                      (the matrix is the leaf-node table; this is the routing)

   START: a concrete situation strains two (or more) BR-* rules
          │
          ▼
   ┌─ Q1. Is the conflict already in the §15 matrix? ─────────────────────────┐
   │   (rows 1–15 cover the known patterns)                                    │
   └─────────────────────────────────────┬─────────────────────────────────────┘
                                         │
                          ┌──────────────┴──────────────┐
                          ▼                             ▼
                        yes                            no
                          │                             │
                          │                             ▼
                          │             ┌─ Q2. Does §14 Precedence Defaults cover it? ─┐
                          │             │  (foundational > structural > surface > ops)   │
                          │             └──────────────────────┬─────────────────────────┘
                          │                                    │
                          │              ┌─────────────────────┴─────────────────────┐
                          │              ▼                                            ▼
                          │            yes                                           no
                          │              │                                            │
                          │              ▼                                            ▼
                          │     apply §14 default              ┌─ Q3. Is a [CRITICAL] rule   ┐
                          │     document in PR description     │  involved (BR-FEE-01,        │
                          │     back-fill to §15 in next amend │  BR-LED-01, BR-LED-04,       │
                          │                                    │  BR-LED-05, BR-SEC-02,       │
                          │                                    │  BR-SEC-06, BR-SYN-02,       │
                          │                                    │  BR-IMP-05, BR-M-01,         │
                          │                                    │  BR-CALC-03, BR-ATT-07)?     │
                          │                                    └──────────────┬────────────────┘
                          │                                                   │
                          │                          ┌────────────────────────┴───────────────┐
                          │                          ▼                                        ▼
                          │                        yes                                       no
                          │                          │                                        │
                          │                          ▼                                        ▼
                          │              ┌─ [CRITICAL] always wins ─┐    ┌─ Q4. Which rule serves the  ┐
                          │              │  (overrides §14 default;  │    │  north-star (minutes/day)?  │
                          │              │   no amendment needed if  │    │  the one that LOWERS        │
                          │              │   the matrix said so;     │    │  minutes-per-day wins       │
                          │              │   amendment needed if not)│    │  (P12, §14.2 of             │
                          │              │  document resolution in   │    │  01_Product_Principles)     │
                          │              │  PR; back-fill to §15     │    └──────────────┬──────────────┘
                          │              └───────────────────────────┘                   │
                          │                                                              ▼
                          │                                              ┌─ Q5. Is the conflict bounded  ┐
                          │                                              │  by a context rule?            │
                          │                                              │  (e.g., "in quiet hours,       │
                          │                                              │   BR-REM-05 wins")             │
                          │                                              └──────────────┬─────────────────┘
                          │                                                             │
                          │                                          ┌──────────────────┴──────────────┐
                          │                                          ▼                                   ▼
                          │                                        yes                                  no
                          │                                          │                                   │
                          │                                          ▼                                   ▼
                          │                              apply the context rule         ┌─ STOP — file a BR-RFC     ┐
                          │                              (e.g., BR-REM-05 wins          │  (§16 Amendment Process)  │
                          │              ┌───────────►   in quiet hours)               │  · 14-day cooling-off     │
                          │              │              document in PR                 │  · maintainer ratify      │
                          │              │              back-fill to §15               │  · test + registry update │
                          │              │                                              │  · cross-ref updates      │
                          │              │                                              └───────────────────────────┘
                          ▼              ▼
   ┌─ SHIP ──────────────────────────────────────────────────────────────────────────┐
   │  · CI passes (lint + tests, including the new conflict-row test)                │
   │  · PR description cites the §15 row (or "back-fill pending — RFC #N")           │
   │  · 12_Business_Rules.md updated in the SAME PR (§15 row added if new)           │
   │  · 14_Edge_Cases.md updated if the conflict produces a new EC-*                 │
   │  · audit_log records the resolution rationale at runtime                        │
   └──────────────────────────────────────────────────────────────────────────────────┘

   ↑ §15 matrix is the leaf-node table — the canonical answers. This tree is
     the routing to find the leaf; the leaf is the contract.
   ↑ [CRITICAL] rules always win (Q3). A new conflict involving a [CRITICAL]
     rule does NOT need an amendment if the matrix already covers it; it DOES
     need one if it's a new pattern.
   ↑ If no rule covers the conflict (Q5 → no), the rule does not ship. File
     a BR-RFC (§16); the 14-day cooling-off prevents reactive rule additions.
```

- ↑ **The matrix is canonical; the tree is routing.** Q1 short-circuits to the matrix when the conflict is already known; Q2–Q5 handle new patterns.
- ↑ **[CRITICAL] rules override §14 defaults.** A conflict between BR-LED-01 (append-only) and any other rule always resolves in BR-LED-01's favour — the ledger is the spine.
- ↑ **No silent resolutions.** Every conflict resolution is documented in the PR description and back-filled to §15 in the next spec amendment (`§How to Read This File`).

---

## 18. Glossary

- **Append-only** — A table where INSERT is the only permitted mutation; UPDATE/DELETE blocked by triggers.
- **Attendance lock** — The state where an `attendance_sessions` row's `locked_at` is set, after which edits require PIN + audit (`BR-ATT-07`).
- **Batch** — A grouping of students taught together on a recurring schedule. A student may be in multiple batches.
- **Charge direction** — A `ledger_entries` row with `direction='charge'` increases balance due; `direction='credit'` decreases it. Refunds are charges.
- **Compensating entry** — A new ledger row that reverses a prior row, identified by `reverses_entry_id`. Voids are the canonical case (`BR-LED-04`).
- **Critical rule** — A rule tagged `[CRITICAL]` whose violation is a P0 review block.
- **Cycle** — A billing period for a fee plan: monthly, quarterly, half-yearly, annual, one-time, or custom.
- **Derived view** — A computed result (e.g., `student_balance`) that is not stored as a table but recomputed on read.
- **Excused (off)** — An attendance status that excludes the student from the % denominator (medical, competition). Not the same as `holiday`.
- **Fee plan** — A `fee_plans` row defining how a student is billed: model (postpaid/prepaid/mixed), cycle, base amount, schedule.
- **Grace days** — Configurable days past `due_date` before a fee becomes overdue and late fees apply (`BR-FEE-17`, default 7).
- **Hash chain** — A per-row tamper hash that includes the previous row's hash, making mid-chain insertion/deletion detectable (`BR-LED-06`).
- **LWW (Last-Write-Wins)** — The v1.x conflict resolution policy for non-ledger rows: newer `updated_at` wins; loser audited (`BR-SYN-03`).
- **Minor unit** — The smallest currency unit (paise for INR, cents otherwise). All money stored as integer minor units (`BR-FEE-01`).
- **Pro-rata** — Fractional charge for a student who joins mid-cycle (`BR-FEE-18`).
- **Quiet hours** — 22:00–07:00 local, during which no reminder notifications fire (`BR-REM-05`).
- **Sensitive action** — Any mutation in the `BR-SEC-04` allowlist requiring PIN + audit even when the app is unlocked.
- **Soft delete** — Setting `archived_at` (or `deleted_at`) instead of DELETE. Students, batches, audit log entries are soft-deleted.
- **Tamper hash** — A per-row hash of immutable fields + tenant secret, computed at INSERT, verified on audit (`BR-FEE-09`, `BR-LED-06`).
- **Tenant** — The single tutor (or coaching institute, in v4 federation) who owns a Turso DB. Every row carries `tenant_id`.
- **Vector clock** — Per-device Lamport counter for non-ledger conflict resolution in v2.0 (`BR-SYN-07`).
- **Void** — A `ledger_entries` row of `type='VOID'` that reverses a prior entry by opposite direction and equal amount (`BR-LED-04`).
- **Waiver** — A `WRITEOFF` ledger entry that erases a portion of a student's due, requiring PIN + reason + audit.

---

*Last Amended: CRON-R3-d. Rule count: 89 rules across 11 domains (FEE 16, ATT 9, STU 9, BAT 6, LED 10, REM 8, RPT 6, SYN 6, SEC 8, UI 5, IMP 6). This document is the contract; a PR that changes a calculation, adds a rule, or retires one is a P0 review item and requires updating every cited spec in the same PR.*
