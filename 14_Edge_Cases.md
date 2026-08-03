# 14 — Edge Cases

> Everything that will go wrong, and how Buddysaradhi behaves. Every case has an ID (`EC-xxx`), a trigger, expected behaviour, and the rule/section it defers to. An engineer who hasn't read this file has not finished the feature.

---

## 0. Edge-Case Taxonomy & ID Scheme

### 0.1 ID Format

Every edge case carries a stable ID of the form **`EC-<DOMAIN>-<NN>`**, where `<DOMAIN>` is a three-letter code and `<NN>` is a zero-padded sequence. IDs are **never reused** — retired IDs are marked `[RETIRED]` in place. New cases take the next free number even if a gap exists. Other specs cite edge cases as `EC-F-03`, `EC-SEC-02`, etc.; code, tests, and audit logs use the same string. The ID is the **join key** between this file, `12_Business_Rules.md`, individual screen specs, and the test suite — changing an ID is a P0 review block because it breaks every cross-reference.

> **Why not just use the old `EC-M-01` / `EC-S-01` codes?** The original spec used ad-hoc two-letter prefixes (`EC-M` for money, `EC-S` for students). This expansion renumbers them into the domain-coded scheme for consistency with `12_Business_Rules.md` (which uses `BR-FEE`, `BR-ATT`, `BR-LED`, etc.) and for machine-parseability. The old IDs are marked `[RETIRED]` in the codebase registry; a migration script maps them.

| Domain | Code | Scope | Primary spec |
|---|---|---|---|
| Fees & Money | `EC-F` | Rounding, overpayment, zero-amount, refund, void, pro-rata | `07_Fees_and_Payments.md` |
| Attendance | `EC-A` | Lock windows, holidays, conflicts, bulk-mark, time-zone | `06_Attendance.md` |
| Ledger | `EC-L` | Hash chain, void-of-void, 24h lock, receipt gaps | `11_Data_Model.md` §3.10 |
| Sync | `EC-SY` | Conflict resolution, schema drift, outbox growth, clock drift | `02_Core_Logic.md` §9 |
| Security | `EC-SEC` | PIN lockout, biometric, passphrase, tamper detection | `10_Security.md` |
| Import/Export | `EC-IE` | Corrupt files, BOM, Excel dates, duplicates, version mismatch | `09_Backup_and_Import_Export.md` |
| Migration | `EC-M` | Schema drift, mid-way failure, downgrade, queued migrations | `11_Data_Model.md` §11 |
| Data / Date | `EC-D` | Leap year, timezone, month boundary, DST | `11_Data_Model.md` §1 |
| Receipts / Void | `EC-RV` | Restore overlap, interrupted restore, lost passphrase+device | `09_Backup_and_Import_Export.md` |
| Calculations | `EC-CALC` | Rate with zero sessions, aging boundaries, voids spanning months | `12_Business_Rules.md` §13 |
| UI | `EC-UI` | Rotation, long names, large rosters, small screens, RTL, a11y | `13_UI_Guidelines.md` |
| Student Lifecycle | `EC-S` | Archive/restore, duplicates, siblings, graduation, bulk delete | `05_Students.md` |

### 0.2 Edge-Case Record Structure

Each entry contains six fields:

| Field | Description |
|---|---|
| **ID** | Stable identifier, e.g. `EC-F-03` |
| **Trigger** | The precise condition that activates the case |
| **Expected Behaviour** | What the system does — block, auto-resolve, or prompt |
| **Recovery** | How the user or system restores normal state |
| **Governing Spec / BR** | The authoritative rule or spec section |
| **Severity** | `P0` (data loss/corruption), `P1` (silent wrong answer), `P2` (degraded UX), `P3` (cosmetic) |

Severity guides test priority: every **P0** case must have an automated test; **P1** cases need at least a manual test plan; **P2/P3** may rely on exploratory testing. The severity also determines incident response: P0 cases trigger an immediate hotfix; P1 cases must be resolved within the current sprint; P2/P3 are backlog items.

### 0.3 Severity Distribution Summary

| Severity | Count | Must-have |
|---|---|---|
| P0 | 8 | Automated test + hotfix SLA |
| P1 | 42 | Manual test plan + sprint SLA |
| P2 | 28 | Exploratory testing + backlog |
| P3 | 9 | Exploratory testing |

> Counts are approximate and will shift as new edge cases are discovered. The table above is a snapshot at the time of this writing.

---

## 1. Fees & Money Edge Cases

### EC-F-01 — Discount produces fractional paise
**Trigger:** 10% discount on ₹1,255.55 → 12555 paise × 0.10 = 1255.5 paise. The result is not a whole minor unit.
**Behaviour:** Round half-to-even on the minor unit (`BR-FEE-01`). The `DISCOUNT_GRANTED` entry uses the rounded amount (1256 paise = ₹12.56); the 0.5-paise drift is absorbed by `BR-FEE-05` (1-minor-unit tolerance for "paid in full"). This is the same rounding mode used in banking (ISO 4217 compliant) and is the single correct rounding rule for all money calculations in Buddysaradhi.
**Recovery:** Automatic — no user action required.
**Governing:** `BR-FEE-01`, `BR-FEE-05`. **P1**

### EC-F-02 — Overpayment beyond outstanding
**Trigger:** Student owes ₹4,500; tutor records ₹5,000.
**Behaviour:** `ledgerEngine.splitIfOverpayment` splits into two `PAYMENT_RECEIVED` rows (`BR-FEE-04`): ₹4,500 (exact, credits the invoice) + ₹500 (`[ADVANCE]`, tagged separately). Advance auto-applied to next `FEE_CHARGED` via `BR-FEE-15`. UI shows "Advance: ₹500" emerald chip on the student row. The advance row has its own receipt number.
**Recovery:** Advance auto-consumed on next charge; tutor may also refund via `REFUND_ISSUED` (see EC-F-04).
**Governing:** `BR-FEE-04`, `BR-FEE-15`. **P1**

### EC-F-03 — Zero-amount fee (100% discount)
**Trigger:** Fee plan with 100% discount; schedule item = 0.
**Behaviour:** Invoice `total=0`, auto-set to `paid`. Ledger posts `FEE_CHARGED` (0) + `DISCOUNT_GRANTED` (full). No receipt generated.
**Recovery:** N/A. **Governing:** `BR-FEE-06`. **P2**

### EC-F-04 — Refund of an advance
**Trigger:** Student with ₹500 advance leaves; tutor refunds the advance.
**Behaviour:** Post `REFUND_ISSUED` (`direction='charge'`) for ₹500, `description=Refund of advance`. Balance returns to zero.
**Recovery:** Automatic. **Governing:** `BR-FEE-03`, `BR-FEE-14`. **P1**

### EC-F-05 — Voiding a payment that closed an invoice
**Trigger:** Receipt RCP-000042 closed invoice INV-000017. Tutor voids RCP-000042.
**Behaviour:** Atomic txn: `VOID` ledger entry + receipt `voided_at` + invoice status reverts to `unpaid`/`partial` based on remaining credits. If another payment partially credited the same invoice after, the invoice stays `partial`.
**Recovery:** Invoice re-opens; tutor may re-record the payment.
**Governing:** `BR-LED-04`, `07_Fees_and_Payments.md` §9. **P0**

### EC-F-06 — Voiding a fee charge with payments against it
**Trigger:** Tutor tries to void a `FEE_CHARGED` that has a `PAYMENT_RECEIVED` crediting it.
**Behaviour:** Blocked (`BR-LED-09`). UI: "This fee has payments against it. Void those receipts first." Lists linked receipts with quick-void buttons.
**Recovery:** Void crediting receipts first, then void the charge.
**Governing:** `BR-LED-09`. **P1**

### EC-F-07 — Currency change after first ledger entry
**Trigger:** Tutor changes `settings.currency_code` from INR to USD after posting fees.
**Behaviour:** Blocked (`BR-FEE-02`). Currency select shows 🔒 chip: "Currency locks after the first fee is recorded."
**Recovery:** Not possible in v1; migration tool planned for v2.x.
**Governing:** `BR-FEE-02`. **P1**

### EC-F-08 — Negative balance (advance) on a student
**Trigger:** Advance payment leaves `balance_due < 0`.
**Behaviour:** Displayed as "Advance: ₹X" (emerald chip). `student_balance` view exposes `advance_balance` separately. `FEE_CHARGED` consumes advance first (`BR-FEE-15` auto-apply).
**Recovery:** Advance auto-consumed on next charge.
**Governing:** `BR-FEE-04`, `BR-FEE-15`. **P1**

### EC-F-09 — Concurrent payment on two devices
**Trigger:** Web records ₹4,500 cash; phone (offline) records ₹4,500 UPI for the same invoice.
**Behaviour:** Both `PAYMENT_RECEIVED` entries land (ledger conflict-immune, `BR-SYN-04`). Invoice overpaid → EC-F-02 advance logic. Sync drawer surfaces review prompt.
**Recovery:** Tutor voids the duplicate receipt.
**Governing:** `BR-SYN-04`, `BR-FEE-04`. **P1**

### EC-F-10 — Refund larger than outstanding
**Trigger:** Student owes ₹0 (advance ₹500); tutor issues ₹1,000 refund.
**Behaviour:** Blocked. UI: "Cannot refund more than advance balance (₹500)." For larger refunds, post `ADJUSTMENT` with PIN (`BR-FEE-14`).
**Recovery:** Issue correct-amount refund, or use `ADJUSTMENT`.
**Governing:** `BR-FEE-14`. **P1**

### EC-F-11 — Mid-month enrollment pro-rata
**Trigger:** Student joins batch on the 18th of a 30-day month; fee is ₹3,000/month.
**Behaviour:** First schedule item pro-rated = `round(300000 × 12 / 30) = 120000` paise = ₹1,200 (`BR-FEE-18`). Subsequent items full amount.
**Recovery:** N/A. Tutor may override via `ADJUSTMENT`.
**Governing:** `BR-FEE-18`. **P2**

### EC-F-12 — Late fee on top of late fee (compounding)
**Trigger:** A ₹5,000 fee is 14 days overdue; the ₹250 late fee itself is now 7 days past due.
**Behaviour:** Late fees are **not** recursively applied — `FeeEngine.applyLateFees` only scans `type='tuition'` items, not `type='late_fee'`. No late-on-late compounding (`BR-FEE-17`).
**Recovery:** N/A. **Governing:** `BR-FEE-17`. **P1**

### EC-F-13 — Discount exceeds outstanding
**Trigger:** Student owes ₹3,000; tutor applies ₹5,000 discount.
**Behaviour:** Blocked. UI: "Discount (₹5,000) exceeds outstanding (₹3,000)." `DISCOUNT_GRANTED` credit cannot exceed non-voided charges.
**Recovery:** Apply discount ≤ outstanding, or void existing charges first.
**Governing:** `BR-FEE-10`, `BR-FEE-03`. **P1**

### EC-F-14 — Refund when no payment received
**Trigger:** Only `FEE_CHARGED` rows exist; no `PAYMENT_RECEIVED`. Tutor tries to issue a refund.
**Behaviour:** Blocked. UI: "No payments to refund. Use a `WRITEOFF` to waive this fee."
**Recovery:** Use `WRITEOFF` (requires PIN + reason, `BR-FEE-13`).
**Governing:** `BR-FEE-14`, `BR-FEE-13`. **P1**

### EC-F-15 — Integer overflow (paise > 2³¹)
**Trigger:** Fee entered that would exceed Zod limit.
**Behaviour:** libSQL `INTEGER` is 64-bit; practical limit enforced by Zod: `amount ≤ 10_000_000_00` paise (₹1 crore). Inline error: "Amount exceeds per-entry limit."
**Recovery:** Split into multiple schedule items.
**Governing:** `BR-FEE-01`, `11_Data_Model.md` §6. **P2**

### EC-F-16 — Currency format edge (₹1 vs ₹1,00,000)
**Trigger:** A fee of ₹1 vs ₹1,00,000 — Indian lakh grouping.
**Behaviour:** `Intl.NumberFormat('en-IN', { style: 'currency', currency: code })` handles Indian grouping. All money passes through `formatCurrency()`.
**Recovery:** N/A. **Governing:** `13_UI_Guidelines.md` §3. **P2**

### EC-F-17 — Fee charged for student who just left batch
**Trigger:** Student's `exited_on` set yesterday; `FeeEngine.generateSchedule` runs today.
**Behaviour:** Engine filters `exited_on IS NULL`. No item created. Race condition: item created but invoice engine skips students with `exited_on < occurred_on`.
**Recovery:** Void the orphan charge.
**Governing:** `BR-FEE-08`, `BR-STU-08`. **P1**

### EC-F-18 — Fee change mid-month (the effective-dated boundary)
**Trigger:** Tutor changes Riya's fee from ₹1,500 to ₹1,800 on July 18th.
**Behaviour:** `FeeRateEngine.changeRate` defaults `effective_from` to **August 1st** (BR-FEE-22). July's expected stays ₹1,500 (the old rate); August onward is ₹1,800. A new `student_fee_rates` row is appended; the prior row's `effective_to` = July 31st. The `students.monthly_fee_paise` cache updates to ₹1,800 in the same `$transaction`. Past months' `expectedForMonth` are unaffected — the append-only history guarantees January's expected is still ₹1,500.
**Recovery:** If the tutor actually wanted the change effective July 1st (retroactive to start of month), they set `effective_from = 2025-07-01` explicitly; the engine closes the prior row at June 30th. True mid-month proration (`prorate: true`) splits July into `₹1,500 × 17/30 + ₹1,800 × 14/30` — but this is the rare 5% case, off by default.
**Governing:** `BR-FEE-21`, `BR-FEE-22`, `BR-CALC-09`. **P2**

### EC-F-19 — Student with no monthly fee set (the null cache)
**Trigger:** A student was created but `monthly_fee_paise` is NULL (no fee rate row exists).
**Behaviour:** `expectedForMonth` returns 0 for that student. The Dashboard "Expected This Month" tenant rollup skips them (the `where: { monthlyFeePaise: { not: null } }` filter). The Fees screen shows their row with "Monthly Fee: — / set fee" (an inline CTA). The tutor cannot record a fee charge for them (the `FEE_CHARGED` engine requires a rate). Reminder engine skips them (no expected → no arrears → no reminder).
**Recovery:** The tutor clicks "set fee" on the student row → the enrolment fee sheet → `FeeRateEngine.setInitialRate`. Once set, the student appears in all rollups.
**Governing:** `BR-FEE-20`, `BR-CALC-09`. **P2**

### EC-F-20 — Paused student accumulates no arrears
**Trigger:** Riya's enrolment is `paused` for August (family trip). The reminder engine's nightly tick runs.
**Behaviour:** `expectedForMonth(Riya, '2025-08')` returns **0** because the enrolment was inactive that month (BR-FEE-23). `arrearsForMonth(Riya, '2025-08')` = 0 − 0 − 0 = 0. The reminder engine sees arrears = 0 → no reminder fires. The fee rate row is NOT ended (the rate resumes unchanged when Riya returns). On September 1st, the tutor resumes the enrolment → September expected = ₹1,800 again.
**Recovery:** N/A — this is the correct behaviour. If the tutor wants to charge a paused student (e.g., holding the seat), they keep the enrolment `active` and post a `DISCOUNT_GRANTED` waiver for the month instead of pausing.
**Governing:** `BR-FEE-23`, `BR-CALC-09`, `BR-STU-02`. **P2**

### EC-F-21 — Annual payer with discount (the credit, not the reduced base)
**Trigger:** Karan pays annually. Monthly fee = ₹2,000. Annual charge = ₹24,000. Tutor offers "pay 11, get 12" → ₹2,000 discount.
**Behaviour:** `FeeRateEngine` generates the annual `fee_plan` with `base_amount = 2000 × 12 = 240000` paise (BR-FEE-24). The `FEE_CHARGED` ledger entry posts ₹24,000. A **paired** `DISCOUNT_GRANTED` credit of ₹2,000 posts in the same transaction (BR-FEE-10). The ledger shows both lines — the full fee + the discount — so the audit trail is honest. `expectedForYear(Karan, 2025)` = ₹24,000 (the full annual, NOT ₹22,000). `collectedForYear` = whatever Karan paid. `arrearsForYear` = 24000 − paid − 2000 (waiver). The discount is visible as a waiver, not buried in a reduced base.
**Recovery:** If the tutor wants to reverse the discount, they void the `DISCOUNT_GRANTED` entry (BR-LED-04); the arrears recompute.
**Governing:** `BR-FEE-24`, `BR-FEE-10`, `BR-CALC-09`, `BR-CALC-11`. **P2**

### EC-F-22 — Quarterly payer at the quarter boundary
**Trigger:** Priya pays quarterly. Monthly fee = ₹1,500. Q3 (Jul–Sep) charge = ₹4,500, due July 1st. It's now September 28th; Priya hasn't paid Q3.
**Behaviour:** The quarterly `fee_plan` generated one `fee_schedule_item` for Q3 (amount ₹4,500, due_date 2025-07-01). On Sep 28th it's `overdue` (90 days past due). `expectedForQuarter(Priya, 2025, Q3)` = ₹4,500. `collectedForQuarter` = 0. `arrearsForQuarter` = ₹4,500. The reminder engine fires (arrears > 0). The Q4 item (due Oct 1st) is `pending`. The tutor sees both on the Fees screen with the `Quarter` toggle selected.
**Recovery:** Priya pays ₹4,500 → `PAYMENT_RECEIVED` credits ₹4,500 → Q3 arrears = 0 → Q3 item flips to `paid`. The Q4 charge is still due Oct 1st.
**Governing:** `BR-FEE-25`, `BR-CALC-09`, `BR-CALC-11`. **P2**

### EC-F-23 — Fee change makes a past-quarter view shift (the historical-honesty proof)
**Trigger:** Tutor views Q2 2025 (Apr–Jun) expected for Riya in October 2025, after Riya's fee changed from ₹1,500 to ₹1,800 in July.
**Behaviour:** `expectedForQuarter(Riya, 2025, Q2)` uses the rate effective on each month's 1st: April = ₹1,500, May = ₹1,500, June = ₹1,500 → ₹4,500. The July fee change does NOT retroactively change Q2's expected. The append-only `student_fee_rates` history is the guarantee — the April/May/June rate row (effective_to = June 30) is immutable. The tutor can trust that last quarter's report from August is still correct in October.
**Recovery:** N/A — this is the invariant. If the tutor needs to restate a past quarter (rare, e.g., a fee was wrong from the start), they post an `ADJUSTMENT` with a reason + PIN (BR-SEC-04); the adjustment shows as a ledger line, not a silent rate rewrite.
**Governing:** `BR-FEE-21`, `BR-CALC-09`. **P1**

---

## 2. Attendance Edge Cases

### EC-A-01 — Marking attendance for a future date
**Trigger:** Tutor picks tomorrow's date.
**Behaviour:** Blocked. Date picker disables future dates. API-side Zod rejects (`date > today`).
**Recovery:** Select a valid date. **Governing:** `BR-ATT-01`. **P2**

### EC-A-02 — Marking attendance for graduated/archived student
**Trigger:** Student graduated yesterday; grid still shows them.
**Behaviour:** Excluded from active roster (`BR-ATT-12`). If stale row appears (race), marking blocked with toast: "Student is archived — restore first."
**Recovery:** Restore student to `active`. **Governing:** `BR-ATT-12`. **P2**

### EC-A-03 — Re-marking after auto-lock (24h)
**Trigger:** Tutor returns 3 days later to fix attendance.
**Behaviour:** Session auto-locked (`BR-ATT-07`). Unlock requires PIN (`BR-SEC-04`) + audit `attendance_unlock`. After 30 days: hard-lock + "Request unlock" flow.
**Recovery:** PIN unlock within 30 days. **Governing:** `BR-ATT-07`, `BR-ATT-08`. **P1**

### EC-A-04 — Holiday marked mid-session with records
**Trigger:** 20 students marked present; tutor realises today is a holiday.
**Behaviour:** "Mark as Holiday" confirms → all records soft-deleted, session flagged holiday (`BR-ATT-09`), excluded from %. Soft-deleted records remain in audit trail.
**Recovery:** Un-mark holiday restores the records.
**Governing:** `BR-ATT-09`. **P1**

### EC-A-05 — Bulk "Mark all absent" with some present
**Trigger:** 10 students present; tutor hits "Mark all absent".
**Behaviour:** Confirm dialog (typed `ABSENT`) overrides all 10. Each override writes `attendance_edit_locked` if locked (`BR-ATT-06`). Never silent.
**Recovery:** Re-mark individual students. **Governing:** `BR-ATT-03`, `BR-ATT-06`. **P1**

### EC-A-06 — Session with no enrollments (empty batch)
**Trigger:** Batch has 0 active students; tutor opens attendance.
**Behaviour:** Empty state: "This batch has no active students." No grid rendered.
**Recovery:** Enroll students. **Governing:** `06_Attendance.md` §11. **P3**

### EC-A-07 — Two devices mark the same student differently
**Trigger:** Phone marks present (offline); web marks absent.
**Behaviour:** LWW (`BR-SYN-03`): newer `updated_at` wins. Loser → `audit_log` `sync_conflict_lost`. Tutor can manually re-edit.
**Recovery:** Tutor corrects the wrong status. **Governing:** `BR-SYN-03`. **P1**

### EC-A-08 — Late sub-state cycling
**Trigger:** Present → long-press → late → long-press → ?
**Behaviour:** Cycle: present → late → present. Absent is separate toggle (tap toggles present↔absent; long-press present → late; long-press late → present).
**Recovery:** N/A. **Governing:** `BR-ATT-02`. **P3**

### EC-A-09 — Lock-window expires mid-edit
**Trigger:** Tutor begins editing at 23:55; 24h auto-lock fires at 00:00 mid-edit.
**Behaviour:** The save is checked at commit time, not continuously. If lock has fired, save auto-prompts for PIN, logs `attendance_edit_locked`, and completes. Tutor is never mid-keystroke-blocked.
**Recovery:** PIN prompt completes the save. **Governing:** `BR-ATT-07`. **P1**

### EC-A-10 — Student enrolled after session started
**Trigger:** Student enrolled at 6:15 PM; session started at 6:00 PM.
**Behaviour:** Student appears in grid immediately (reactive subscription). Can be marked present/late for current session. Attendance for sessions before enrollment is blocked.
**Recovery:** N/A. **Governing:** `BR-STU-08`. **P2**

### EC-A-11 — Batch schedule change mid-week
**Trigger:** Tutor changes batch schedule from MON/WED/FRI to TUE/THU/SAT on a Wednesday. Wednesday has attendance records.
**Behaviour:** Existing records preserved (append-only). New schedule applies going forward. Old sessions remain visible in Calendar view.
**Recovery:** N/A. **Governing:** `BR-BAT-03`. **P2**

### EC-A-12 — Time zone boundary (11:59 PM → midnight lock)
**Trigger:** Tutor marks at 11:55 PM; save takes 3 min due to network latency; midnight crosses.
**Behaviour:** `session_date` captured at session-open time, not save time (`06_Attendance.md` §9). Auto-lock timer uses `session_date`, not `created_at`.
**Recovery:** N/A. **Governing:** `BR-ATT-07`, P-DM7. **P1**

---

## 3. Ledger Edge Cases

### EC-L-01 — Hash chain break detection
**Trigger:** Edited ledger row; recomputed `tamper_hash` mismatches stored value.
**Behaviour:** `verifyLedgerChain()` flags the entry and all subsequent entries in the chain (since each depends on the prior's hash). Red "TAMPERED" badge + `audit_log` `ledger_tamper_detected`. "Verify integrity" in Settings → Diagnostics lists all mismatches; offers restore from last backup. The chain is per-student (not global), so a tamper in one student's ledger does not affect others.
**Recovery:** Restore from untampered backup. **Governing:** `BR-LED-06`, `10_Security.md` §14. **P0**

### EC-L-02 — Void of void (forbidden)
**Trigger:** Tutor tries to void a `VOID` entry.
**Behaviour:** Blocked (`BR-LED-05`). UI: "Cannot void a void. Post a compensating `ADJUSTMENT` instead." System offers quick-path to create one.
**Recovery:** Post a compensating `ADJUSTMENT`. **Governing:** `BR-LED-05`. **P1**

### EC-L-03 — Void within 24h vs. after 24h
**Trigger:** Voiding an entry that is 20h old vs. 5 days old.
**Behaviour:** 0–24h: free void (PIN only). 24h–30d: PIN + typed reason + `audit_log` `backdated_ledger_void`. > 30d: hard-locked, "Request unlock" flow.
**Recovery:** Follow graduated unlock path. **Governing:** `BR-LED-08`, `BR-SEC-04`. **P1**

### EC-L-04 — Ledger entry for an archived student
**Trigger:** Student archived; tutor posts `PAYMENT_RECEIVED`.
**Behaviour:** `PAYMENT_RECEIVED` **allowed** (collecting outstanding dues, `BR-STU-02`). New `FEE_CHARGED` blocked for archived students.
**Recovery:** N/A — correct behaviour. **Governing:** `BR-STU-02`, `BR-STU-09`. **P1**

### EC-L-05 — Balance goes negative after void
**Trigger:** Student had ₹500 advance. Tutor voids the `PAYMENT_RECEIVED` that created it.
**Behaviour:** `VOID` reverses the credit; `balance_due` increases. A same-amount void mathematically cannot produce a negative beyond the original state.
**Recovery:** N/A — mathematically impossible. **Governing:** `BR-LED-04`. **P1**

### EC-L-06 — Two voids in the same second
**Trigger:** Rapid succession voids share the same `created_at` second.
**Behaviour:** PK is UUID v7 (millisecond precision). Even same-second entries have distinct UUIDs. `prev_hash` chain computed in insertion order.
**Recovery:** N/A. **Governing:** `BR-LED-06`. **P2**

### EC-L-07 — Receipt number gap after void
**Trigger:** RCP-000042 voided; next receipt is RCP-000043.
**Behaviour:** Gap is intentional (`BR-LED-03`). `next_receipt_seq` never decrements. Voided number never reused. Audit log retains the void.
**Recovery:** N/A. **Governing:** `BR-LED-03`. **P2**

### EC-L-08 — Receipt number reuse after void
**Trigger:** Tutor assumes RCP-000042 can be reissued after voiding.
**Behaviour:** Permanently consumed. Monotonic counter + `UNIQUE(tenant_id, number)` constraint blocks reuse. Gaps are auditable; reuse is fraud.
**Recovery:** N/A — correct behaviour. **Governing:** `BR-LED-03`. **P1**

### EC-L-09 — Two invoices generated simultaneously (race)
**Trigger:** Two devices generate invoices at the same instant.
**Behaviour:** Atomic CTE sequence increment. One gets N, the other N+1. `UNIQUE` constraint rejects any collision; loser retries with next sequence.
**Recovery:** Automatic retry. **Governing:** `BR-LED-03`. **P1**

### EC-L-10 — Backdated ledger entry in locked period
**Trigger:** Payment dated 2 weeks ago (within locked attendance period).
**Behaviour:** PIN required (`BR-SEC-04`) + audit `backdated_ledger`. `occurred_on` = business date; `created_at` = now. Reports use `occurred_on`.
**Recovery:** N/A — correct with PIN gate. **Governing:** `BR-LED-07`. **P1**

---

## 4. Student Lifecycle Edge Cases

### EC-S-01 — Restore archived student with new payments
**Trigger:** Student archived 3 months ago; parent returns with a back-payment.
**Behaviour:** Restore (`BR-STU-02`) sets status `active`. Ledger was frozen but readable; new `PAYMENT_RECEIVED` can be posted. 3-month gap visible in timeline.
**Recovery:** N/A. **Governing:** `BR-STU-02`. **P2**

### EC-S-02 — Two students with identical name + phone
**Trigger:** Tutor adds "Aarav Sharma, 98765…" twice.
**Behaviour:** Duplicate detection (`BR-STU-03`) surfaces interstitial: [Skip] [Merge] [Proceed as separate]. Merge is FK-aware, audited; secondary soft-deleted with `merged_into_id`.
**Recovery:** Restore from merge record (30-day grace).
**Governing:** `BR-STU-03`. **P1**

### EC-S-03 — Guardian shared across students (siblings)
**Trigger:** Two students share a primary guardian phone.
**Behaviour:** Both flagged "Sibling" badge. v1 surfaces only; sibling discounts are v1.x.
**Recovery:** N/A — informational. **Governing:** `BR-STU-03`. **P3**

### EC-S-04 — Student enrolled in multiple batches
**Trigger:** Aarav in "Class 10 Maths" and "Class 10 Science".
**Behaviour:** Multiple `student_enrollments` rows. Attendance grid has batch selector. Fee plans per-batch (`BR-FEE-16`). No conflict.
**Recovery:** N/A. **Governing:** `BR-FEE-16`. **P2**

### EC-S-05 — Graduated student with outstanding dues
**Trigger:** Tutor marks student `graduated` but ₹2,000 due remains.
**Behaviour:** `graduated` freezes new charges; dues remain collectable (`BR-STU-09`). Appears in Fees "Dues" filter with "Graduated" badge. `PAYMENT_RECEIVED` still allowed.
**Recovery:** Collect dues. **Governing:** `BR-STU-09`. **P1**

### EC-S-06 — Bulk delete with ledger entries
**Trigger:** Tutor selects 5 students → "Delete".
**Behaviour:** Blocked if any has ledger entries. UI: "3 have financial records — cannot delete. Archive instead?" PIN + typed "DELETE" required regardless (`BR-SEC-04`).
**Recovery:** Archive instead. **Governing:** `BR-SEC-04`, `BR-LED-01`. **P0**

---

## 5. Sync Edge Cases

### EC-SY-01 — 72-hour offline session
**Trigger:** Tutor offline for 3 days, marks attendance + records payments.
**Behaviour:** All writes hit local SQLite + `sync_outbox`. UI shows "Offline · N pending". On reconnect, outbox flushes FIFO. Ledger entries (UUID-keyed) land without conflict. Zero data loss.
**Recovery:** Automatic on reconnect. **Governing:** `BR-SYN-01`, `BR-SYN-04`. **P1**

### EC-SY-02 — Outbox row fails 5 times
**Trigger:** A `sync_outbox` row repeatedly fails (schema mismatch).
**Behaviour:** Marked `status='conflict'` (`BR-SYN-03`). Sync drawer: [Retry] [Discard] [View payload]. Discard writes `audit_log` `sync_outbox_dropped`.
**Recovery:** Retry or discard. **Governing:** `BR-SYN-03`. **P1**

### EC-SY-03 — Conflict on same ledger entry from two devices
**Trigger:** Two devices INSERT `PAYMENT_RECEIVED` for same student/invoice.
**Behaviour:** Both land — ledger is conflict-immune (`BR-SYN-04`). UUID v7 guarantees unique PKs. Invoice overpaid → EC-F-02 advance logic.
**Recovery:** Void the duplicate receipt. **Governing:** `BR-SYN-04`. **P1**

### EC-SY-04 — Sync during backup
**Trigger:** Backup running; `sync_outbox` flushes simultaneously.
**Behaviour:** Advisory lock — sync pauses during backup (`09_Backup_and_Import_Export.md` §11). Backup captures consistent snapshot. Sync resumes after.
**Recovery:** Automatic. **Governing:** `09_Backup_and_Import_Export.md` §11. **P2**

### EC-SY-05 — Sync outbox grows unbounded
**Trigger:** Device offline 30 days; 5,000+ outbox rows.
**Behaviour:** Outbox capped at 10,000 rows. Oldest `pending` rows marked `status='expired'` with audit. Tutor warned: "Sync backlog full — reconnect to sync."
**Recovery:** Reconnect and flush. **Governing:** `BR-SYN-02`. **P2**

### EC-SY-06 — Network returns mid-sync
**Trigger:** Sync push 50% complete when network drops.
**Behaviour:** Each outbox row pushed individually; pushed rows marked `sent`. Unsent remain `pending`. On reconnect, flush resumes from first `pending`.
**Recovery:** Automatic. **Governing:** `BR-SYN-02`. **P2**

### EC-SY-07 — Device clock drift
**Trigger:** Device clock 2 hours ahead of server.
**Behaviour:** `created_at` uses server time (Turso `CURRENT_TIMESTAMP`). `occurred_on` uses tutor's local date. Nightly lock job uses configured timezone, not device clock.
**Recovery:** Correct device clock; Buddysaradhi auto-heals on next sync.
**Governing:** P-DM7. **P2**

### EC-SY-08 — Schema drift (app older than DB)
**Trigger:** Turso DB `schema_version 7`; app supports up to 6.
**Behaviour:** Refuse to sync (`BR-SYN-05`). Prompt: "Update Buddysaradhi to continue syncing." Local data readable; sync paused.
**Recovery:** Update the app. **Governing:** `BR-SYN-05`. **P1**

---

## 6. Security Edge Cases

### EC-SEC-01 — 15 failed PIN attempts (brute force)
**Trigger:** Someone brute-forces the PIN.
**Behaviour:** 5 fails → 30s lockout; 10 → 5min; 15 → wipe local cache (`BR-SEC-03`). Cloud DB intact. Force re-login via Supabase. Audit `pin_lockout_wipe`. Cumulative count resets on a successful unlock. Lockout is per-device — a thief with one phone cannot drain attempts from another.
**Recovery:** Re-login with Supabase credentials; local cache re-syncs from Turso.
**Governing:** `BR-SEC-03`, `10_Security.md` §3.4. **P0**

### EC-SEC-02 — Biometric unavailable
**Trigger:** FaceID fails 3× or hardware unavailable.
**Behaviour:** Auto-fallback to PIN (`10_Security.md` §3.3). No data lockout. Biometric retry available next session.
**Recovery:** Enter PIN. **Governing:** `10_Security.md` §3.7. **P2**

### EC-SEC-03 — Tampered receipt (hash mismatch)
**Trigger:** Edited SQLite receipt; `tamper_hash` mismatches.
**Behaviour:** Red "TAMPERED" badge + `audit_log` `receipt_tamper_detected`. "Verify integrity" lists mismatches; offers backup restore.
**Recovery:** Restore from untampered backup. **Governing:** `10_Security.md` §14. **P0**

### EC-SEC-04 — Lost device
**Trigger:** Tutor's phone stolen.
**Behaviour:** Login on new device → "Revoke sessions" (`BR-SEC-10`). Turso token rotated. Old device cache inert. Restore from backup.
**Recovery:** Re-login + restore `.buddysaradhi`. **Governing:** `BR-SEC-10`. **P1**

### EC-SEC-05 — Export without PIN
**Trigger:** Someone with app access tries to export without knowing PIN.
**Behaviour:** PIN prompt (`BR-SEC-04`) blocks export. After 3 fails, 30s lockout. Audit `pin_failed_export`.
**Recovery:** Enter correct PIN. **Governing:** `BR-SEC-04`. **P1**

### EC-SEC-06 — Backup file with wrong passphrase
**Trigger:** Tutor forgets passphrase; 5 wrong attempts.
**Behaviour:** argon2id verify fails → toast "Wrong passphrase". After 5 fails, 60s lockout. No recovery possible (`10_Security.md` §13).
**Recovery:** No recovery — passphrase is the only key.
**Governing:** `10_Security.md` §13. **P1**

### EC-SEC-07 — Biometric enrolled then finger removed
**Trigger:** Tutor removes registered fingerprint from OS.
**Behaviour:** OS API returns "not enrolled." Auto-fallback to PIN. `audit_log` `biometric_reenrol` written — catches "enrol on someone else's phone" attack.
**Recovery:** Re-enrol biometric or continue with PIN.
**Governing:** `10_Security.md` §3.7. **P2**

### EC-SEC-08 — App data cleared while backup in progress
**Trigger:** Android "Clear data" or iOS uninstall during backup write.
**Behaviour:** Backup written to temp path, then atomically renamed. If killed mid-write, temp file incomplete but final `.buddysaradhi` doesn't exist. No corrupt file produced.
**Recovery:** Restore from a prior backup. **Governing:** `09_Backup_and_Import_Export.md` §6.1. **P0**

---

## 7. Import/Export Edge Cases

### EC-IE-01 — Excel import with mismatched headers
**Trigger:** `.xlsx` has "Student Name" instead of `first_name`.
**Behaviour:** Fuzzy-map maps unambiguous headers. Ambiguous headers prompt manual mapping. Invalid headers reported in preview.
**Recovery:** Fix headers or map manually. **Governing:** `BR-IMP-03`. **P2**

### EC-IE-02 — Import with 10,000 rows
**Trigger:** Large institute imports 10k students.
**Behaviour:** Streaming parse (exceljs), bounded memory. Progress bar. Transactional writes in batches of 100. Background job + toast on completion.
**Recovery:** N/A. **Governing:** `BR-IMP-04`. **P2**

### EC-IE-03 — Import row with invalid phone format
**Trigger:** Row has phone "abc123".
**Behaviour:** Zod rejects the row; skipped and listed in post-import report. Valid rows still import.
**Recovery:** Fix invalid data; re-import (idempotent UPSERT).
**Governing:** `BR-IMP-03`. **P2**

### EC-IE-04 — Export of empty database
**Trigger:** New tutor exports before adding students.
**Behaviour:** Valid `.xlsx` with 3 worksheets (headers + 0 rows). Toast: "Exported 0 students, 0 attendance, 0 payments."
**Recovery:** N/A. **Governing:** `BR-IMP-04`. **P3**

### EC-IE-05 — Backup from newer version
**Trigger:** Backup `schema_version 9`; app supports up to 8.
**Behaviour:** Refuse restore. Prompt: "This backup is from a newer Buddysaradhi. Update first."
**Recovery:** Update app, retry restore. **Governing:** `BR-IMP-05`. **P1**

### EC-IE-06 — Corrupted backup (sha256 mismatch)
**Trigger:** Bit-flip on the `.buddysaradhi` file.
**Behaviour:** AES-GCM auth tag catches most corruption. If passes but sha256 mismatches manifest: abort, toast "Backup integrity check failed."
**Recovery:** Obtain uncorrupted backup. **Governing:** `BR-IMP-02`. **P0**

### EC-IE-07 — CSV with BOM
**Trigger:** Import file starts with UTF-8 BOM (`EF BB BF`).
**Behaviour:** `ImportEngine.parseCsv` strips the BOM before parsing. Headers correctly mapped.
**Recovery:** N/A. **Governing:** `BR-IMP-03`. **P3**

### EC-IE-08 — Duplicate student on import
**Trigger:** Imported CSV has a student whose `dup_key` matches an existing student.
**Behaviour:** Dedup interstitial surfaces: [Skip] [Merge] [Proceed as separate]. Import pauses for this row; all duplicates batched into one interstitial where possible.
**Recovery:** Choose correct dedup action per row. **Governing:** `BR-STU-03`. **P1**

---

## 8. Migration Edge Cases

### EC-M-01 — Schema drift detection (app newer than DB)
**Trigger:** `app_state.schema_version = 5`; migrations define up to 8.
**Behaviour:** App runs migrations 0006–0008 (idempotent, forward-only) on connect. `schema_version` bumped to 8. Transparent to user.
**Recovery:** Automatic. **Governing:** P-DM8, `02_Core_Logic.md` §9. **P1**

### EC-M-02 — Migration fails mid-way
**Trigger:** Migration 0007 ALTER TABLE fails (disk full).
**Behaviour:** Transaction rolls back; `schema_version` stays at 6. Error: "Database migration failed. Free space and restart." Next startup retries from 0007.
**Recovery:** Free disk space; restart. **Governing:** `11_Data_Model.md` §11. **P0**

### EC-M-03 — Downgrade attempt
**Trigger:** Older app version installed over newer; DB at `schema_version 8`; app knows up to 6.
**Behaviour:** App detects `schema_version > max_supported`; refuses to start DB. Prompt: "Data from newer Buddysaradhi. Please update."
**Recovery:** Install newer app. **Governing:** P-DM8. **P1**

### EC-M-04 — Two migrations queued simultaneously
**Trigger:** Two app instances start at the same time and detect pending migrations.
**Behaviour:** Advisory lock — first acquires, runs migrations; second waits. Lock timeout 10s → "Migration in progress on another device."
**Recovery:** Wait for first instance; restart if needed.
**Governing:** `11_Data_Model.md` §11. **P2**

### EC-M-05 — Excel date format mismatch
**Trigger:** `.xlsx` has dates in `MM/DD/YYYY` (US locale) instead of `YYYY-MM-DD`.
**Behaviour:** SheetJS returns serial date numbers (not strings) — `ImportEngine` converts to ISO dates. String dates are rejected by Zod with "Date must be YYYY-MM-DD or valid Excel date."
**Recovery:** Fix date format; re-import. **Governing:** `BR-IMP-03`. **P2**

### EC-M-06 — Partial import failure (rollback?)
**Trigger:** Import reaches row 801 of 1,000; FK violation.
**Behaviour:** Transactional batches (100 rows/txn). Rows 701–800 committed; row 801 batch rolls back. Report: "800 imported, 200 failed." Committed rows not rolled back — partial import is correct.
**Recovery:** Fix 200 failed rows; re-import (idempotent UPSERT).
**Governing:** `BR-IMP-03`. **P2**

---

## 9. Date & Data Edge Cases

### EC-D-01 — Attendance on Feb 29 (leap year)
**Trigger:** Tutor marks attendance on 2028-02-29.
**Behaviour:** Normal. ISO date handles leap years. Year-over-year heatmap shows Feb 29 only in leap years.
**Recovery:** N/A. **Governing:** `11_Data_Model.md` §3.7. **P3**

### EC-D-02 — Tutor in different timezone from student
**Trigger:** Tutor in Dubai (GMT+4); student in Mumbai (GMT+5:30).
**Behaviour:** All dates stored as ISO date (no time). `occurred_on` = tutor's local business date. Reports group by tutor's locale.
**Recovery:** N/A. **Governing:** P-DM7. **P2**

### EC-D-03 — Month boundary during attendance marking
**Trigger:** Tutor marks at 11:55 PM Oct 31; saves at 12:01 AM Nov 1.
**Behaviour:** `session_date` captured at session-open time = Oct 31. Marks land on Oct 31.
**Recovery:** N/A. **Governing:** `06_Attendance.md` §9. **P1**

### EC-D-04 — DST transition
**Trigger:** Clocks fall back / spring forward.
**Behaviour:** Buddysaradhi uses dates, not times-with-timezones, for business logic. DST is a non-event.
**Recovery:** N/A. **Governing:** P-DM7. **P3**

---

## 10. Receipts / Void & Recovery Edge Cases

### EC-RV-01 — Restore over non-empty DB with overlapping IDs
**Trigger:** Restore backup onto DB with overlapping UUIDs from a prior partial restore.
**Behaviour:** Default: Overwrite by ID (pre-restore audited). Merge: per-row prompt. Skip: conflicting rows skipped + reported. Ledger rows: INSERT-OR-IGNORE only (`BR-LED-01`).
**Recovery:** Review conflict report; re-restore with different strategy.
**Governing:** `09_Backup_and_Import_Export.md` §10.6. **P1**

### EC-RV-02 — Restore interrupted (power loss)
**Trigger:** Restore at 60% when laptop dies.
**Behaviour:** Transactional per-batch (100 rows/txn). DB at last committed batch. `.buddysaradhi` untouched. Idempotent UPSERTs make retry safe. Toast: [Resume] [Abort to pre-restore snapshot].
**Recovery:** Resume or abort to snapshot. **Governing:** `09_Backup_and_Import_Export.md` §11. **P0**

### EC-RV-03 — Lost passphrase, lost device, no cloud
**Trigger:** Worst case: device gone, passphrase gone, no backup.
**Behaviour:** Offline `.buddysaradhi` data unrecoverable (`10_Security.md` §13). Turso cloud DB may still exist (if v2 sync was active); tutor can re-login via Supabase.
**Recovery:** Re-login via Supabase; cloud replica may have data.
**Governing:** `10_Security.md` §13. **P0**

---

## 11. Calculation Edge Cases

### EC-CALC-01 — Attendance rate with all sessions off
**Trigger:** All sessions in a month are holidays or all students excused.
**Behaviour:** Denominator = 0 → `attendance_pct = null` (displayed as "—", not "0%" or "100%"). `BR-RPT-05` excludes excused/holiday from denominator.
**Recovery:** N/A. **Governing:** `BR-RPT-05`. **P1**

### EC-CALC-02 — Fee aging bucket boundary (day 30 vs. 31)
**Trigger:** Fee exactly 30 days overdue.
**Behaviour:** Buckets `0–7d`, `8–30d`, `31–90d`, `90+d` (`BR-RPT-03`). Day 30 → `8–30d`. Day 31 → `31–90d`. Lower bound inclusive.
**Recovery:** N/A. **Governing:** `BR-RPT-03`. **P1**

### EC-CALC-03 — Monthly collection with voids spanning months
**Trigger:** Payment recorded in August, voided in September. August report already closed.
**Behaviour:** `collected_this_month` excludes VOIDs (`BR-RPT-08`). August closed report shows original collection; September shows negative adjustment. `student_balance` is always live-corrected.
**Recovery:** Re-run August report for adjusted figure.
**Governing:** `BR-RPT-08`, `BR-RPT-01`. **P1**

### EC-CALC-04 — Report period with zero transactions
**Trigger:** New tutor opens Dashboard; no fees or payments.
**Behaviour:** KPI cards show ₹0, 0 students. Heatmap empty. Zero-division guards return null → "—". No "NaN" or "undefined".
**Recovery:** N/A. **Governing:** `BR-RPT-08`. **P2**

### EC-CALC-05 — Pro-rata rounding across fee cycle
**Trigger:** Two students join on different days; pro-rata sums ≠ nominal batch fee.
**Behaviour:** Pro-rata is per-student, not per-batch. Sum of pro-rata charges will differ from nominal. 1-minor-unit tolerance (`BR-FEE-05`) absorbs residual drift.
**Recovery:** N/A. **Governing:** `BR-FEE-18`, `BR-FEE-05`. **P2**

### EC-CALC-06 — Balance due with 1-paise tolerance
**Trigger:** After discounts and partial payments, `balance_due = 1` paise.
**Behaviour:** "Paid in full" per `BR-FEE-05`: `|balance_due| ≤ 1`. Student shows emerald "Paid" chip.
**Recovery:** N/A. **Governing:** `BR-FEE-05`. **P2**

---

## 12. UI Edge Cases

### EC-UI-01 — 500-student list on low-end phone
**Trigger:** 500 students, Fees screen on mid-range device.
**Behaviour:** Virtualised list (FlashList/react-window). Only visible rows render. 55fps maintained.
**Recovery:** N/A. **Governing:** `13_UI_Guidelines.md` §5. **P2**

### EC-UI-02 — Heatmap with 3000 cells
**Trigger:** 100 students × 30 days attendance heatmap.
**Behaviour:** Pure `<div>` + className, `React.memo` per cell. Renders < 50ms.
**Recovery:** N/A. **Governing:** `04_Dashboard.md` §17. **P2**

### EC-UI-03 — Screen rotates during transaction
**Trigger:** Tutor on "Record Payment" sheet; phone rotates.
**Behaviour:** Sheet remains open; form state preserved. Sheet adapts to landscape. Orientation-lock hint during PIN entry.
**Recovery:** N/A. **Governing:** `13_UI_Guidelines.md` §3. **P2**

### EC-UI-04 — Very long student name / notes
**Trigger:** Name 200 chars; notes 5,000 chars.
**Behaviour:** Name truncated with ellipsis (tooltip shows full). Notes in scrollable area (`max-h-48 overflow-y-auto`). DB stores full text.
**Recovery:** N/A. **Governing:** `13_UI_Guidelines.md` §3. **P3**

### EC-UI-05 — 200+ students in roster
**Trigger:** 250 students across 8 batches.
**Behaviour:** Search + batch filter reduce visible set. Virtualised rendering. Batch selector groups by time-slot. ≤16ms/frame.
**Recovery:** N/A. **Governing:** `13_UI_Guidelines.md` §5. **P2**

### EC-UI-06 — Very small screen (320px width)
**Trigger:** Old iPhone SE or small Android.
**Behaviour:** < 640px → single-column, sidebar collapses to hamburger, grid hides secondary columns, bulk bar stacks vertically. Touch targets ≥ 44px.
**Recovery:** N/A. **Governing:** `13_UI_Guidelines.md` §4. **P2**

### EC-UI-07 — Accessibility mode + glass transparency conflict
**Trigger:** OS "High Contrast" or "Reduce Transparency" enabled.
**Behaviour:** `@media (prefers-contrast: high)` / `(prefers-reduced-transparency)` disables `backdrop-blur`, replaces glass with solid `rgba(255,255,255,0.12)`. Text contrast ≥ 7:1 (WCAG AAA). Canvas gradient dims to `#1a1a2e`.
**Recovery:** N/A. **Governing:** `13_UI_Guidelines.md` §8. **P2**

### EC-UI-08 — Reduced-motion preference
**Trigger:** OS "reduce motion" enabled.
**Behaviour:** Framer springs → 120ms fades. Count-up animations disabled; numbers appear final.
**Recovery:** N/A. **Governing:** `13_UI_Guidelines.md` §8. **P3**

### EC-UI-09 — RTL locale
**Trigger:** Locale set to `ar-SA`.
**Behaviour:** Tailwind logical properties flip. Sidebar moves right. Numbers stay LTR. v1 LTR-only with RTL readiness; full RTL in v1.x.
**Recovery:** N/A. **Governing:** `13_UI_Guidelines.md` §7. **P3**

---

## 13. Audit & Compliance Edge Cases

### EC-AU-01 — Audit log grows unbounded
**Trigger:** 5 years of usage; `audit_log` has 500k rows.
**Behaviour:** Retained indefinitely (`10_Security.md` §8.3). Viewer paginates + filters. Included in backups. v1.x cold-storage archival on roadmap.
**Recovery:** N/A. **Governing:** `10_Security.md` §8.3. **P2**

### EC-AU-02 — Audit log write fails mid-transaction
**Trigger:** Disk full; `audit_log` INSERT fails.
**Behaviour:** Fail-closed (`BR-SEC-08`). Whole transaction rolls back. Mutation does not happen. Error toast: "Could not complete — audit log unavailable."
**Recovery:** Free disk space; retry. **Governing:** `BR-SEC-08`. **P0**

### EC-AU-03 — Tampered audit log
**Trigger:** Someone deletes `audit_log` rows directly in SQLite.
**Behaviour:** Triggers block DELETE/UPDATE. If bypassed (root access), receipt tamper hashes + `reverses_entry_id` cross-references reveal inconsistencies in "Verify integrity."
**Recovery:** Restore from backup; investigate breach.
**Governing:** `10_Security.md` §8, §14. **P0**

---

## 13a. Pricing & Tier-Evolution Edge Cases

Edge cases for the "Free for everyone, for now" model (`product/05_Pricing_and_Plans.md §1.6`) and the BR-PRC-01..10 rules. These cover the 250-student soft-guidance milestone (pre-trigger and post-trigger), the grandfather clause, the 60-day notice period, the §1.6 trigger monitor, the no-ads/no-sync-throttling/no-feature-removal guarantees, and the `NEXT_PUBLIC_PAID_TIERS_LIVE` feature flag.

### EC-PRC-01 — Tutor crosses 250 students (pre-trigger)
**Trigger:** A Free-tier tutor with 250 active+inactive students creates their 251st student. The §1.6 trigger has NOT fired (paid tiers not yet live).
**Behaviour:** `StudentEngine.create` does NOT block — the 251st student is fully created, fully accessible, fully synced. The engine logs a `student_count_milestone` event to the audit log (BR-STU-11). A friendly, dismissable prompt appears on the Dashboard: "You've crossed 250 students — that's amazing! We'd love to hear your story. [Tell us how you use Buddysaradhi →]". The prompt links to founder email (`hello@buddysaradhi.app`) or a Typeform. There is NO paywall, NO waitlist, NO upgrade nag. All 251+ students remain fully accessible (attendance, fees, receipts, sync, export, biometric login, all 5 screens).
**Recovery:** N/A — the tutor's data keeps working. The prompt is dismissable; if dismissed, it does not reappear. **Governing:** `BR-PRC-01`, `BR-PRC-03`, `BR-STU-11`. **P3**

### EC-PRC-02 — Tutor crosses 250 students (post-trigger, declines upgrade)
**Trigger:** A Free-tier tutor with 250 students creates their 251st student after the §1.6 trigger has fired and Pro is live. They see the friendly "tell us your story" prompt and dismiss it.
**Behaviour:** The 251st student is fully created and accessible. The friendly prompt does NOT reappear on subsequent student creations (it surfaces once per milestone crossing). There is no nag, no degraded experience, no throttled sync — just the same friendly prompt at 250, never again. For pre-trigger signups, the soft-guidance model carries forward via the grandfather clause (BR-PRC-02). For post-trigger signups, the same soft-guidance model applies — Pro/Institute are voluntary upgrades, never required.
**Recovery:** Tutor can upgrade to Pro at any time from Settings → Billing → "Upgrade to Pro" (post-trigger only). **Governing:** `BR-PRC-01`, `BR-PRC-02`, `BR-PRC-03`, `BR-PRC-06`. **P3**

### EC-PRC-03 — Grandfathered tutor's 250 soft-guidance milestone is incorrectly lowered post-trigger
**Trigger:** A v1 Free user (signed up pre-trigger) crosses 250 students post-trigger. The system should show the friendly "tell us your story" prompt and let them keep adding students. The bug: the system incorrectly enforces a 25-student ceiling (or any ceiling) on grandfathered tutors.
**Behaviour:** `pricingEngine.applyGrandfatherClause(tutorId, signupDate)` checks `signupDate < triggerFiredDate`. If true, the tutor's soft-guidance milestone stays at 250 (and the friendly prompt fires, never a paywall). If the function is missing or buggy, the tutor sees a paywall at 25/250 students — a bait-and-switch that violates BR-PRC-02 and BR-PRC-03.
**Recovery:** The CI lint `grandfather-clause-accuracy.test.ts` fails the build if a grandfathered tutor's soft-guidance milestone is not 250 OR if any paywall blocks the 251st student. If the bug reaches production, the founder emails every affected tutor an apology, upgrades them to Pro free for 6 months, and the bug is fixed in an emergency patch. **Governing:** `BR-PRC-02`, `BR-PRC-03`. **P0**

### EC-PRC-04 — The §1.6 trigger fires but the founder does not flip `NEXT_PUBLIC_PAID_TIERS_LIVE`
**Trigger:** The `pricing-trigger-monitor` GitHub Action detects T1 (Vercel bandwidth bill > ₹0/mo) for 3 consecutive months. It opens a "Pricing Trigger Fired" issue and emails the founder. The founder goes on vacation and does not flip the flag.
**Behaviour:** The trigger fires but paid tiers do not launch. The pricing page continues to show the **single Free card** (one card, one "Start free →" CTA, one commitment block — `NEXT_PUBLIC_PAID_TIERS_LIVE` is still `false`). The 60-day notice banner does NOT appear (because the founder hasn't started the launch sequence). The result: we are paying for Vercel Pro out of pocket while collecting ₹0 in revenue.
**Recovery:** The Action's "Pricing Trigger Fired" issue is P0-tagged and pages the founder on Slack + email. If the founder does not respond within 7 days, the Action escalates to the co-founder. If no response within 14 days, the Action emails the entire team. **Governing:** `BR-PRC-04`, `BR-PRC-08`, `BR-PRC-10`. **P0**

### EC-PRC-05 — Tutor with 500+ students wants to pay us / insists on paying
**Trigger:** A Free-tier tutor with 500+ students emails hello@buddysaradhi.app insisting on paying for Buddysaradhi because they want to support the project. The §1.6 trigger has not fired.
**Behaviour:** We reply with: "Thank you for being willing to pay — that means a lot. We are not yet accepting payments because our backend infra bill is still ₹0/mo. The day that changes, we'll email you with a 60-day notice and a unique upgrade link. Until then, your Buddysaradhi account is free, every feature, every student — including your 500+. If you really want to support us, the best thing you can do is tell other tutors about Buddysaradhi." This is the **honour-system founder-contact**: rare, manual, audited, and only for tutors who explicitly ask. No automated paywall, no manual payment in v1.
**Recovery:** The founder logs the conversation in `audit_log` and may extend the tutor's free access indefinitely. When paid tiers launch, the founder contacts the tutor personally with a unique upgrade link. **Governing:** `BR-PRC-01`, `BR-PRC-09`. **P3**

### EC-PRC-06 — A Free-tier tutor tries to use a feature that does not exist (e.g., "ROI report")
**Trigger:** A Free-tier tutor reads the FAQ (`06_FAQ.md §6.2 Q7` mentions the Institute tier's ROI report as an internal-only future tier) or hears about the ROI report from a friend. They navigate to Reports and do not find it.
**Behaviour:** The Reports screen shows only the reports available on Free: attendance, fees, ledger. The ROI report is gated behind `featureFlags.ENABLE_ROI_REPORT`, which is `false` for Free-tier tutors. The UI does NOT show a greyed-out "ROI report (Institute tier only)" card — that would be a dark pattern (rubbing the upgrade in the tutor's face). The feature is simply absent from the Free-tier Reports screen. The public pricing page (single Free card) does not mention the ROI report; only the FAQ and Appendix A do.
**Recovery:** If the tutor asks "where is the ROI report?", the FAQ answer (06_FAQ.md §6.2 Q7) explains it is an Institute-tier feature that launches when the §1.6 trigger fires. **Governing:** `BR-PRC-07`. **P2**

### EC-PRC-07 — Razorpay UPI free band crosses ₹50,000/mo (T5 trigger) before any other trigger
**Trigger:** The §1.6 trigger T5 (Razorpay UPI volume > ₹50,000/mo) fires for 3 consecutive months. T1–T4 have not fired. The paid tiers are already live (T5 only matters post-Pro-launch).
**Behaviour:** We are paying 1.99% + ₹3 per UPI transaction above ₹50,000/mo. We absorb the fee (no-surcharge rule, BR-M-01 / `product/05_Pricing_and_Plans.md §4.1`). The Razorpay cost eats into Pro revenue. The `pricing-trigger-monitor` Action logs the T5 trigger and emails the founder. The founder reviews Pro pricing: do we raise Pro to ₹349/mo to cover the gateway fee? Do we keep ₹299/mo and accept the thinner margin? The decision is documented in `product/05_Pricing_and_Plans.md` amendment log.
**Recovery:** No user-facing change. The founder decides whether to raise Pro pricing or absorb the fee. Existing Pro subscribers keep their price (₹299/mo) for the remainder of their billing period; new subscribers pay the new price (if raised). **Governing:** `BR-PRC-08`, `product/05_Pricing_and_Plans.md §1.6.2 T5`. **P1**

### EC-PRC-08 — A scholarship recipient asks to be invoiced for tax purposes
**Trigger:** A government-school tutor on `pro_scholarship` tier emails asking for a GST invoice showing ₹0/mo "for their school's records."
**Behaviour:** We generate a PDF invoice with: `Tier: Pro (Scholarship)`, `Price: ₹0/mo (free, forever, per scholarship program)`, `GST: ₹0 (no consideration, no GST)`, `Billed to: [tutor name]`. The invoice is a courtesy document, not a tax document — there is no payment, so no GST applies. The invoice is signed by the founder and emailed.
**Recovery:** N/A. The scholarship recipient retains the invoice for their school's audit trail. **Governing:** `BR-PRC-09`, `product/05_Pricing_and_Plans.md §6`. **P3**

### EC-PRC-09 — `NEXT_PUBLIC_PAID_TIERS_LIVE` flag is set to `true` but Razorpay checkout routes still return 503
**Trigger:** The founder flips `NEXT_PUBLIC_PAID_TIERS_LIVE=true` after the 60-day notice period, but a deploy issue leaves the Razorpay checkout routes (`/api/billing/checkout`, `/api/billing/webhook`) still returning `503 Service Unavailable` (the pre-trigger stubs were not removed).
**Behaviour:** The pricing page migrates to the 3-tier layout (Appendix A — Free + Pro + Institute with "Upgrade →" CTAs). A tutor clicks "Upgrade to Pro →", fills the form, and sees a 503 error toast: "Checkout is temporarily unavailable. Please try again in a few minutes." The tutor cannot upgrade. Revenue is lost.
**Recovery:** The CI lint `featured-tier-accuracy.test.ts` checks that when `NEXT_PUBLIC_PAID_TIERS_LIVE=true`, the checkout routes do NOT return 503. If the lint fails, the deploy is blocked. If the bug reaches production, the founder reverts the flag to `false` (returning to the single Free card state), fixes the routes, and re-flips. Affected tutors are emailed an apology. **Governing:** `BR-PRC-10`. **P0**

### EC-PRC-10 — A tutor asks to never see the "tell us your story" prompt again
**Trigger:** A tutor crosses 250 students and sees the friendly "tell us your story" prompt. They dismiss it but email hello@buddysaradhi.app asking to never see it again.
**Behaviour:** The tutor's `settings.suppress_milestone_prompt` flag is set to `true` via the admin tool. The prompt does not reappear on subsequent milestone crossings (500, 1,000 students). Their Free-tier account is otherwise unaffected — all data keeps working. The flag is logged in `audit_log` (GDPR/DPDP right-to-control, `10_Security.md §17`).
**Recovery:** N/A. The tutor can re-enable the prompt from Settings → Notifications → "Milestone prompts" if they change their mind. **Governing:** `BR-PRC-01`, `BR-PRC-03`, `BR-STU-11`, `10_Security.md §17`. **P3**

---

## 14. Cross-Edge-Case Matrix

Some edge cases can fire simultaneously, creating compound scenarios. The **more severe** case takes precedence for the user-facing message; the system must handle both internally.

| # | Combination | Composite Behaviour |
|---|---|---|
| **X-1** | EC-SY-03 (sync conflict) + EC-L-02 (void-of-void) | Sync pushes two `VOID` entries for the same original. Both land (append-only). Second is a void-of-void, blocked at app layer but already in ledger. `verifyLedgerChain()` flags it. Manual fix: compensating `ADJUSTMENT`. |
| **X-2** | EC-A-03 (attendance lock) + EC-SEC-01 (PIN lockout) | Tutor fails PIN 5 times while unlocking attendance. 30s lockout applies; attendance remains locked. After lockout, tutor retries. |
| **X-3** | EC-F-05 (void receipt that closed invoice) + EC-SY-01 (72h offline) | Void created locally; lands on reconnect. Invoice re-opens on both devices. If other device recorded payment in interim, invoice stays `partial`. |
| **X-4** | EC-IE-06 (corrupt backup) + EC-RV-03 (lost device + passphrase) | Only backup is corrupt AND passphrase lost. Offline data unrecoverable. Tutor must rely on Turso cloud replica (v2 sync) or accept data loss. |
| **X-5** | EC-F-09 (concurrent payment) + EC-F-12 (late fee compounding) | Two devices record payments; one applies a late fee. Late fee is separate `FEE_CHARGED` row. All land. Invoice may be overpaid; advance logic applies. Late fee itself does not generate another late fee. |
| **X-6** | EC-A-09 (lock expires mid-edit) + EC-A-12 (timezone boundary) | Tutor edits at 23:58 across midnight. Lock timer uses `session_date` (not wall clock). Mid-edit save triggers PIN prompt after lock fires. Edit completes. |
| **X-7** | EC-M-02 (migration fails) + EC-SY-04 (sync during backup) | Migration failure rolls back; sync was paused (advisory lock). After rollback, sync resumes. `schema_version` unchanged; next startup retries. No corruption. |
| **X-8** | EC-SEC-07 (biometric removed) + EC-SEC-08 (data cleared mid-backup) | Biometric fallback to PIN. Backup interrupted; temp file incomplete. Final `.buddysaradhi` doesn't exist. Data cleared by OS. Recovery from *previous* backup. |
| **X-9** | EC-F-11 (pro-rata enrollment) + EC-F-12 (late fee compounding) | Student joins mid-month (pro-rata first item). The pro-rated item has a different `due_date`. Late fee is calculated on each schedule item independently. Pro-rated item may become overdue at a different time than full items. No compounding. |
| **X-10** | EC-A-04 (holiday mid-session) + EC-F-05 (void receipt that closed invoice) | Session marked holiday → attendance records soft-deleted. If a per-session fee was charged against that session, the fee is now orphaned. Tutor must void the fee (which requires voiding any linked payments first per EC-F-06). |

> **Rule:** When two edge cases fire simultaneously, the **more severe** one takes precedence for the user-facing message. The system must handle both internally; it must not silently drop the lower-severity case.

---

## 15. Glossary

| Term | Definition |
|---|---|
| **Lock window** | Configurable period (default 24h attendance, 24h ledger) after which records auto-lock and require PIN to edit. See `BR-ATT-07`, `BR-LED-08`. |
| **Hash chain break** | Detected mismatch in `prev_hash` → `tamper_hash` linkage in `ledger_entries`, indicating tampering. See `BR-LED-06`. |
| **Pro-rata** | Fractional billing for mid-cycle enrollment: `round(base × days_remaining / total_days)`. See `BR-FEE-18`. |
| **Compensating entry** | A new ledger entry (typically `ADJUSTMENT`) that corrects a previous entry without modifying the original, preserving append-only invariant. See `BR-LED-04`. |
| **BOM** | Byte Order Mark — 3-byte prefix (`EF BB BF`) on some UTF-8 files. Buddysaradhi strips it on CSV import. See EC-IE-07. |
| **Schema drift** | Version mismatch between app's expected `schema_version` and actual DB version. See `BR-SYN-05`. |
| **LWW** | Last-Write-Wins — v1 conflict resolution for non-ledger rows: row with latest `updated_at` survives. See `BR-SYN-03`. |
| **Advance balance** | Negative `balance_due` (tutor owes student). Displayed as "Advance: ₹X" emerald chip. Auto-consumed on next charge. See `BR-FEE-04`. |
| **Advisory lock** | Cooperative lock (not DB-enforced) preventing concurrent backup+sync or concurrent migrations. See `09_Backup_and_Import_Export.md` §11. |
| **Fail-closed** | Design principle where a failing subsystem (e.g., audit log write) causes the entire operation to abort rather than proceed without the failed step. See `BR-SEC-08`. |
| **Minor unit** | Smallest currency denomination (paise for INR, cents for USD). All money stored as integer minor units. See `BR-FEE-01`. |
| **Half-to-even rounding** | Banker's rounding: 0.5 rounds to nearest even integer. Used for discount and pro-rata calculations. See `BR-FEE-01`. |

---

## 16. Edge-Case Triage Protocol

When a new edge case is discovered in production:

1. **Reproduce** locally; capture exact trigger.
2. **Assign** an `EC-<DOMAIN>-<NN>` ID; add to this file.
3. **Decide** behaviour: block (fail-closed), auto-resolve (with audit), or prompt user.
4. **Cite** the BR/section that governs it; if none exists, amend `12_Business_Rules.md` first.
5. **Severity**: assign P0–P3 per §0.2.
6. **Test**: add test case per relevant screen's testing requirements. P0 → automated; P1 → manual test plan.
7. **Cross-reference**: if the case can combine with others, add a row to §14.
8. **Changelog**: append the new EC ID to release notes.

---

## 17. ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 (ASCII Art Conventions) for the Edge Cases doc. The mockups here are **coverage maps, compound-edge-case matrices, and migration flows**, with UI surfaces (lockout overlays, conflict interstitials, tamper banners) annotated inline. Glass tiers (`.glass` / `.glass-strong` / `.glass-faint` per §5.5) and neumorphic recipes (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6) annotated. Character set per §20.2. Accent colours named, never hexed. Cross-references use canonical IDs only (`§5.4`, `§5.5`, `§6.6`, `BR-*`, `EC-*`, `P*`, `AP-*`).

### 17.1 Design System Reference — Edge Cases

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces that surface edge cases | Tier | Cross-ref |
|---|---|---|
| Conflict interstitial (sync conflict — EC-SY-03) | `glass-strong` + backdrop; strategy segmented control = `neumo-inset` | §5.5, §8.7, §8.5 |
| Lockout countdown overlay (EC-SEC-01 — fail 3+) | `glass-faint` recede; countdown text in flare | §5.5 |
| Hash-chain break banner (EC-L-01) | `glass` + flare accent left-border | §5.4, §8.3 |
| "Downgrade attempt blocked" modal (EC-M-03) | `glass-strong` + backdrop; flare accent | §5.4, §8.7 |
| Migration progress bar (EC-M-02 mid-fail) | `glass-faint` track + amber fill (partial state) | §5.5, §8.13 |
| Concurrent-payment warning toast (EC-F-09) | `glass-strong` + amber left-bar | §5.5, §8.8 |
| Void-of-void blocked toast (EC-L-02) | `glass-strong` + flare left-bar | §5.5, §8.8 |
| Recovery-required interstitial (EC-RV-03) | `glass-strong` + backdrop; triple-gate | §5.5, §8.7 |
| P0 bug report modal (in Diagnostics) | `glass-strong` + backdrop | §5.5, §8.7 |

| Neumorphic controls on edge-case surfaces | Recipe | Cross-ref |
|---|---|---|
| PIN pad (gate during lockout recovery) | `neumo-raised`; press = `neumo-pressed` | §6.6, §8.2 |
| Conflict-strategy segmented control (overwrite/merge/skip) | `neumo-inset` well; active = `neumo-raised` pill | §6.6, §8.5 |
| "Retry migration" button (EC-M-02) | `neumo-raised` primary (emerald glow) | §6.6, §8.2 |
| "Restore from previous backup" button (EC-RV-03) | `neumo-raised` primary | §6.6, §8.2 |
| "Accept data loss" button (X-4 worst case) | `neumo-raised` secondary; flare glow on hover | §6.6, §8.2 |
| "Submit bug report" button (Diagnostics) | `neumo-raised` primary | §6.6, §8.2 |

> **References:** Nielsen Norman Group — *Error Recovery* (the lockout-countdown + retry pattern); OWASP — *Error Handling Cheat Sheet* (fail-closed design, BR-SEC-08); Pat Helland — *Life beyond Distributed Transactions* (the conflict-resolution tree); Martin Kleppmann — *Designing Data-Intensive Applications* (schema-drift handling, EC-M-01); Apple HIG — *Alerts*; Material Design 3 — *Error states*; WCAG 2.1 AA §3.3.1 (error identification — the flare accent + text label on every edge-case banner, AP-14).

### 17.2 Mockup E1 — EC-Domain Coverage Map

```
EC-DOMAIN COVERAGE MAP — 13 domains, 89+ edge cases (one per production-incident class)
                            (each domain mirrors a BR-* domain — see 12_Business_Rules §1)
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  EC DOMAIN       │ COUNT │ MIRROR BR DOMAIN  │ OWNER SPEC                  │ P-LEVEL │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  EC-F  Fees&Money│  17   │ BR-FEE            │ 07_Fees_and_Payments.md     │ P0–P2   │
│      (incl.      │       │ · EC-F-01 fractnl │ · §1, §11                   │         │
│       EC-F-15    │       │   paise; EC-F-09  │                             │         │
│       overflow)  │       │   concurrent pay; │                             │         │
│                  │       │   EC-F-06 void-   │                             │         │
│                  │       │   with-credits    │                             │         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  EC-A  Attendance│  12   │ BR-ATT            │ 06_Attendance.md            │ P1–P2   │
│      (incl.      │       │ · EC-A-03 auto-   │ · §4                        │         │
│       EC-A-12    │       │   lock; EC-A-12   │                             │         │
│       timezone)  │       │   TZ boundary     │                             │         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  EC-L  Ledger    │  (in  │ BR-LED            │ 11_Data_Model.md §8         │ P0      │
│      (CRITICAL:  │   §3) │ · EC-L-01 hash-   │ · §10 triggers              │         │
│       EC-L-01)   │       │   chain break;    │                             │         │
│                  │       │   EC-L-02 void-   │                             │         │
│                  │       │   of-void         │                             │         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  EC-S  Students  │ (§4)  │ BR-STU            │ 05_Students.md              │ P1–P2   │
│                  │       │ · lifecycle,      │                             │         │
│                  │       │   archival,       │                             │         │
│                  │       │   transfer        │                             │         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  EC-SY Sync      │ (§5)  │ BR-SYN            │ 02_Core_Logic.md §9         │ P0–P1   │
│      (CRITICAL:  │       │ · EC-SY-01 72h    │ · sync_outbox               │         │
│       EC-SY-04)  │       │   offline; EC-SY- │                             │         │
│                  │       │   03 conflict     │                             │         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  EC-SEC Security │ (§6)  │ BR-SEC            │ 10_Security.md              │ P0      │
│      (CRITICAL:  │       │ · EC-SEC-01 PIN   │ · §3.5 lockout              │         │
│       EC-SEC-08) │       │   lockout; EC-SEC │ · §18 secure-erase          │         │
│                  │       │   -08 data clear  │                             │         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  EC-IE Import/   │ (§7)  │ BR-IMP            │ 09_Backup_and_Import_       │ P0–P1   │
│       Export     │       │ · EC-IE-06 corrupt│   Export.md                 │         │
│                  │       │   backup          │                             │         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  EC-M  Migration │  6    │ BR-SYN-04         │ 11_Data_Model.md §11        │ P0–P1   │
│      (CRITICAL:  │       │ · EC-M-01 schema  │ · migrations/               │         │
│       EC-M-02)   │       │   drift; EC-M-02  │                             │         │
│                  │       │   fail mid-way    │                             │         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  EC-D  Date/Data │ (§9)  │ (cross-cutting)   │ 02_Core_Logic.md            │ P1–P2   │
│                  │       │ · TZ, DST, leap   │                             │         │
│                  │       │   sec, en-IN      │                             │         │
│                  │       │   grouping        │                             │         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  EC-RV Receipts/ │ (§10) │ BR-LED-03/04 +    │ 07_Fees_and_Payments.md §9  │ P0–P1   │
│       Void&Recov │       │ BR-RC-01          │ · void cascade              │         │
│                  │       │ · EC-RV-01..03    │                             │         │
│                  │       │   (lost device)   │                             │         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  EC-C  Calculation│ (§11)│ BR-CALC           │ 12_Business_Rules.md §13    │ P1      │
│                  │       │ · pro-rata,       │                             │         │
│                  │       │   aging buckets,  │                             │         │
│                  │       │   attendance %    │                             │         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  EC-UI UI        │ (§12) │ BR-UI             │ 13_UI_Guidelines.md         │ P1–P2   │
│                  │       │ · EC-UI-01 spinner│                             │         │
│                  │       │   no timeout (AP- │                             │         │
│                  │       │   18)             │                             │         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  EC-AC Audit&    │ (§13) │ BR-SEC-06         │ 10_Security.md §8           │ P0      │
│       Compliance │       │ · audit chain     │                             │         │
│                  │       │   break, tamper   │                             │         │
│                  │       │   detect          │                             │         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  X-*  Compound   │  10   │ (cross-domain)    │ 14_Edge_Cases.md §14        │ P0–P2   │
│       Edge Cases │       │ · X-1..X-10 —     │ · the matrix of edge cases  │         │
│       (§14)      │       │   two ECs that    │   that combine              │         │
│                  │       │   co-occur        │                             │         │
└─────────────────────────────────────────────────────────────────────────────────────┘

   ↑ Every EC-* domain mirrors a BR-* domain — a new BR-* domain triggers an
     EC-* sibling domain (see §0.1 taxonomy).
   ↑ P0 edge cases (EC-L-01, EC-SY-04, EC-SEC-08, EC-M-02, EC-AC-*) are
     automated-test-required; a regression in any is a release blocker.
   ↑ X-* compound edge cases (§14) are the discipline of "what happens when
     two edge cases co-occur?" — every production incident is a candidate
     X-* row, added in the next spec amendment.
```

- ↑ **Coverage is exhaustive, not illustrative.** A new BR-* domain without an EC-* sibling is a spec defect.
- ↑ **X-* compound edge cases are the second-order discipline.** A tutor hitting one edge case is rare; a tutor hitting two at once is rarer — but the spec must answer "what does the app do?" before production writes the answer.
- ↑ **The taxonomy mirrors `12_Business_Rules.md` §1.** Same domain codes, same ownership mapping, same cross-reference discipline.

### 17.3 Mockup E2 — X-1 to X-10 Compound Edge-Case Matrix

```
COMPOUND EDGE-CASE MATRIX (§14) — when two EC-* co-occur, what wins?

   Each X-* row names two EC-* IDs, the conflict, the resolution, and the P-level.
   Read row-first; the resolution is the contract.

   ┌────────┬───────────────────────────────────┬──────────────────────────────┬──────┐
   │  X-ID  │  EC-* pair                         │  resolution                   │ P-lvl│
   ├────────┼───────────────────────────────────┼──────────────────────────────┼──────┤
   │  X-1   │  EC-SY-03 (sync conflict)         │  both VOIDs land (append-    │ P1   │
   │        │  + EC-L-02 (void-of-void)         │  only); verifyLedgerChain()  │      │
   │        │                                   │  flags; manual ADJUSTMENT    │      │
   │        │                                   │  fix. (.glass flare banner)  │      │
   ├────────┼───────────────────────────────────┼──────────────────────────────┼──────┤
   │  X-2   │  EC-A-03 (attendance lock)        │  30s lockout applies;        │ P1   │
   │        │  + EC-SEC-01 (PIN lockout)        │  attendance stays locked;    │      │
   │        │                                   │  retry after lockout.        │      │
   │        │                                   │  (.glass-faint countdown)    │      │
   ├────────┼───────────────────────────────────┼──────────────────────────────┼──────┤
   │  X-3   │  EC-F-05 (void closed inv)        │  void lands on reconnect;    │ P1   │
   │        │  + EC-SY-01 (72h offline)         │  invoice re-opens; if other  │      │
   │        │                                   │  device paid in interim,     │      │
   │        │                                   │  invoice stays 'partial'.    │      │
   │        │                                   │  (amber toast)               │      │
   ├────────┼───────────────────────────────────┼──────────────────────────────┼──────┤
   │  X-4   │  EC-IE-06 (corrupt backup)        │  OFFLINE DATA UNRECOVERABLE. │ P0   │
   │        │  + EC-RV-03 (lost dev+passphr)    │  Rely on Turso cloud replica │      │
   │        │                                   │  (v2 sync) or accept data    │      │
   │        │                                   │  loss. (flare interstitial +  │      │
   │        │                                   │  .neumo-raised "Accept data  │      │
   │        │                                   │  loss" with flare hover)     │      │
   ├────────┼───────────────────────────────────┼──────────────────────────────┼──────┤
   │  X-5   │  EC-F-09 (concurrent payment)     │  all land (append-only);     │ P1   │
   │        │  + EC-F-12 (late fee compound)    │  invoice may be overpaid;    │      │
   │        │                                   │  advance logic applies; late │      │
   │        │                                   │  fee does NOT compound.      │      │
   ├────────┼───────────────────────────────────┼──────────────────────────────┼──────┤
   │  X-6   │  EC-A-09 (lock expires mid-edit)  │  lock uses session_date,     │ P2   │
   │        │  + EC-A-12 (TZ boundary)          │  not wall clock; edit saves  │      │
   │        │                                   │  after PIN prompt. No data   │      │
   │        │                                   │  loss across midnight.       │      │
   ├────────┼───────────────────────────────────┼──────────────────────────────┼──────┤
   │  X-7   │  EC-M-02 (migration fails)        │  migration rolls back; sync  │ P0   │
   │        │  + EC-SY-04 (sync during backup)  │  was paused (advisory lock); │      │
   │        │                                   │  schema_version unchanged;   │      │
   │        │                                   │  retry on next startup.      │      │
   │        │                                   │  (amber progress bar +       │      │
   │        │                                   │  .neumo-raised "Retry")      │      │
   ├────────┼───────────────────────────────────┼──────────────────────────────┼──────┤
   │  X-8   │  EC-SEC-07 (biometric removed)    │  biometric → PIN fallback;   │ P0   │
   │        │  + EC-SEC-08 (data cleared mid-   │  backup interrupted; temp    │      │
   │        │    backup)                        │  file incomplete; final      │      │
   │        │                                   │  .buddysaradhi doesn't exist;     │      │
   │        │                                   │  recover from PREVIOUS       │      │
   │        │                                   │  backup. (flare interstitial)│      │
   ├────────┼───────────────────────────────────┼──────────────────────────────┼──────┤
   │  X-9   │  EC-F-11 (pro-rata enroll)        │  pro-rated item has diff     │ P2   │
   │        │  + EC-F-12 (late fee compound)    │  due_date; late fee calc'd   │      │
   │        │                                   │  per schedule item; no       │      │
   │        │                                   │  compounding on the late fee│      │
   │        │                                   │  itself.                     │      │
   ├────────┼───────────────────────────────────┼──────────────────────────────┼──────┤
   │  X-10  │  EC-A-04 (holiday mid-session)    │  attendance records soft-    │ P1   │
   │        │  + EC-F-05 (void closed inv)      │  deleted; per-session fee    │      │
   │        │                                   │  is orphaned; tutor must     │      │
   │        │                                   │  void the fee (which first   │      │
   │        │                                   │  requires voiding any linked │      │
   │        │                                   │  payments per EC-F-06).      │      │
   │        │                                   │  (cascade blocked toast)     │      │
   └────────┴───────────────────────────────────┴──────────────────────────────┴──────┘

   ↑ Each X-* row is a real production scenario — the matrix is built from
     incidents, not from imagination. A new incident appends a new row.
   ↑ The resolution is the contract; if a real-world case differs, the matrix
     is amended (never silently re-resolved).
   ↑ P0 compound edge cases (X-4, X-7, X-8) involve data-loss potential —
     these are tested in the nightly release-candidate build (§16 triage).
```

- ↑ **X-4 is the worst case.** Corrupt backup + lost passphrase + lost device = data unrecoverable from offline sources. The Turso cloud replica is the only fallback (and only if v2 sync ran before the loss). The flare interstitial is honest about the trade-off (P15 — honest empty state analogue).
- ↑ **X-7 and X-8 involve the advisory lock.** Concurrent backup+sync (X-7) and concurrent biometric-change+backup (X-8) are prevented by the advisory lock documented in `09_Backup_and_Import_Export.md` §11.
- ↑ **X-1's manual ADJUSTMENT fix is the only non-automated resolution.** Every other X-* resolves automatically; X-1 requires the tutor (or support) to post a compensating `ADJUSTMENT` entry — the spec is honest about this (P15).

### 17.4 Mockup E3 — Migration Edge-Case Flow (EC-M-01 to EC-M-06)

```
MIGRATION EDGE-CASE FLOW (§8) — what happens at every branch of a schema migration
                                  (one EC-M-* per branch; all are P0–P1 release-blockers)

   ┌─ TRIGGER: app starts; reads PRAGMA user_version (SQLite admin cmd, no ORM eq) ┐
   │  · app_schema = app_state.schema_version (compiled-in)                       │
   │  · db_schema  = PRAGMA user_version (on-disk — set once per migration by the
   │                  generated migration.sql, never read by app code at runtime)  │
   └────────────────────────────────────┬─────────────────────────────────────────┘
                                        │
                                        ▼
   ┌─ Q. app_schema vs db_schema ? ─────────────────────────────────────────────┐
   └────────────────────────────────────┬─────────────────────────────────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                         ▼
        equal                  app > db                    app < db
        (no migration)         (normal upgrade)            (DOWNGRADE ATTEMPT)
              │                         │                         │
              │                         │                         ▼
              │                         │              ┌─ EC-M-03 — Downgrade attempt ─┐
              │                         │              │  · BLOCKED — flare modal:     │
              │                         │              │    "App version N cannot open  │
              │                         │              │     a v(N+1) database.         │
              │                         │              │     Please update the app."    │
              │                         │              │  · audit_log 'downgrade_block' │
              │                         │              │  · .glass-strong + backdrop    │
              │                         │              │    + flare accent (§5.4)       │
              │                         │              │  · .neumo-raised "Update app" │
              │                         │              │    primary button             │
              │                         │              └───────────────────────────────┘
              │                         │
              │                         ▼
              │              ┌─ EC-M-01 — Schema drift detection ──────────────────┐
              │              │  · app newer than DB — normal upgrade path           │
              │              │  · acquire advisory lock (blocks sync, §11 of 09)    │
              │              │  · progress bar 0% (.glass-faint, emerald fill)      │
              │              └────────────────────────┬────────────────────────────┘
              │                                       │
              │                                       ▼
              │              ┌─ MIGRATION RUNNER ───────────────────────────────────┐
              │              │  for each migration in (db_schema, app_schema]:       │
              │              │    · run migration file (SQL + JS transform)          │
              │              │    · on success: bump PRAGMA user_version             │
              │              │    · progress bar increments                          │
              │              └────────────────────────┬────────────────────────────┘
              │                                       │
              │                                       │
              │              ┌────────────────────────┴───────────────┐
              │              ▼                                        ▼
              │        success                                       failure
              │              │                                        │
              │              │                                        ▼
              │              │              ┌─ EC-M-02 — Migration fails mid-way ──┐
              │              │              │  · transactional rollback             │
              │              │              │  · PRAGMA user_version UNCHANGED      │
              │              │              │    (the bump is in the same TX)       │
              │              │              │  · audit_log 'migration_failed' + err │
              │              │              │  · sync resumes (advisory lock        │
              │              │              │    released by rollback)              │
              │              │              │  · progress bar stalls at amber       │
              │              │              │    (.glass-faint, amber fill)         │
              │              │              │  · toast "Migration failed; will      │
              │              │              │    retry on next launch" (.glass-     │
              │              │              │    strong + flare left-bar)           │
              │              │              │  · next startup retries automatically │
              │              │              └───────────────────────────────────────┘
              │              │
              │              ▼
              │     ┌─ migration complete ──────────────────────────────────────┐
              │     │  · PRAGMA user_version = app_schema                       │
              │     │  · audit_log 'migration_complete'                         │
              │     │  · progress bar 100% (emerald)                            │
              │     │  · release advisory lock → sync resumes                   │
              │     └───────────────────────────────────────────────────────────┘
              │
              ▼
   ┌─ app starts normally ──────────────────────────────────────────────────────┐
   │  (no migration branch)                                                     │
   └─────────────────────────────────────────────────────────────────────────────┘

   ┌─ OTHER EC-M-* (concurrent / partial) ─────────────────────────────────────┐
   │                                                                            │
   │  EC-M-04 — Two migrations queued simultaneously                            │
   │    · advisory lock prevents the second; second app instance waits, then    │
   │      sees the migrated schema and proceeds with no migration.              │
   │                                                                            │
   │  EC-M-05 — Excel date format mismatch (CSV import)                         │
   │    · dates parsed via dayfirst-detect (DD-MM-YYYY preferred for en-IN);    │
   │      ambiguous dates (e.g., 03/04/2025) prompt the tutor to disambiguate   │
   │      via a .glass-strong interstitial with a .neumo-inset date picker.     │
   │                                                                            │
   │  EC-M-06 — Partial import failure (rollback?)                              │
   │    · NO rollback — the import is row-by-row; failed rows are skipped +     │
   │      reported; successful rows are committed. The tutor sees a .glass-     │
   │      strong toast "Imported N rows · skipped M rows · [View skipped]"      │
   │      and can re-import the failed rows after fixing the CSV.               │
   │      (idempotent re-import per 09_Backup_and_Import_Export §10)            │
   └────────────────────────────────────────────────────────────────────────────┘

   ↑ Every migration runs in ONE transaction per migration file. A multi-file
     migration (db_schema 12 → 15) runs three TXs sequentially; if the second
     fails, the first stays committed (PRAGMA user_version = 13) and the third
     is never attempted. The next startup retries from 13 → 15.
   ↑ The advisory lock (09_Backup_and_Import_Export §11) prevents sync from
     racing the migration. Sync resumes automatically once the lock releases.
   ↑ EC-M-06 is the ONE edge case where partial failure is allowed. Every
     other migration edge case is all-or-nothing (atomic TX). The exception
     is documented because CSV import is row-level, not migration-level.
```

- ↑ **EC-M-02 (migration fails mid-way) is the most-tested edge case.** The rollback must be atomic; the `PRAGMA user_version` bump must be in the same TX as the schema change. The `ledger-no-delete.test.ts` and `migration-rollback.test.ts` integration tests enforce this (§24.1 of `10_Security.md`).
- ↑ **EC-M-03 (downgrade) is the only hard-block.** A v(N) app cannot open a v(N+1) database — the tutor must update the app. The flare modal is honest about this (P15).
- ↑ **EC-M-06 (partial import) is the exception, not the rule.** Every other migration is atomic; the CSV import's row-level partial-success is documented because CSV data is user-supplied and a single bad row must not block 999 good rows.

---

> This file is never "done." Every production incident appends a new EC. The discipline of naming edge cases is what separates Buddysaradhi from a spreadsheet.
