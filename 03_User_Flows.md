# 03 — User Flows

> The screen-by-screen journey map of Buddysaradhi. Every flow is reachable in ≤ 3 taps from any screen, works offline-first, and cites the screen spec (`04`–`09`), the business rule (`12`), and the edge case (`14`) it exercises. A release that breaks any flow's tap-count or offline guarantee is not shippable.

---

## 0. How to Read This Spec

This document is organised by **journey shape**, not by screen. A flow may start on the Dashboard, pass through Students, and end on Fees — that is the reality of a tutor's day, and our doc should mirror it.

Conventions used throughout:

| Notation | Meaning |
|---|---|
| `[Action]` | A tap, click, or keystroke the user performs. |
| `└─` | A system response or sub-step in an ASCII flow. |
| `(tap N)` | Tap counter — increments only on user-initiated taps, not system transitions. |
| **`BR-FEE-01`** | Business Rule ID — see `12_Business_Rules.md`. |
| **`EC-F-01`** | Edge Case ID — see `14_Edge_Cases.md`. |
| **P3 / P5 / P14** | Product Principle ID — see `01_Product_Principles.md`. |
| `04 §6.2` | Section reference into another spec file. |

> **The Two-Tap Rule (P3).** Every primary action in Buddysaradhi is reachable in ≤ 2 taps from the Dashboard, and ≤ 3 taps from any other screen. The Command Palette (`⌘K`) compresses this further to ≤ 2 keystrokes. Tap counts in this document are acceptance criteria, not aspirations.

> **Offline Invariant (P5).** Every flow tagged `[offline]` must complete end-to-end with the device in airplane mode and reconcile silently on reconnect. The sync engine (`02_Core_Logic.md §6`) handles reconciliation; flows must never block on it.

---

## 1. Persona-Grounded Flows

Buddysaradhi is built for tutors, not for "users". Every flow below is grounded in a real persona drawn from `00_Vision.md §4`. Four named personas cover the v1 surface:

### 1.1 Persona Quick Reference

| Persona | Scale | Primary Pain | Top 3 Flows Exercised |
|---|---|---|---|
| **Priya** — Solo home tutor | 8–15 students, 2 batches, home visits | Tracks dues on WhatsApp chats; loses receipts in chat scroll | §2 Onboarding · §4.4 Record Cash Payment · §5.3 Search → Profile → Record |
| **Arjun** — Test-prep coach | 40–80 students, 4 batches, weekend mocks | Spends 30 min on Sunday reconciling attendance + fees manually | §3 Day-in-the-Life · §4.3 Bulk Attendance · §5.5 Monthly Report PDF |
| **Meera** — Small-academy owner | 120–200 students, 6 batches, 2 co-tutors | Co-tutor marks attendance wrong; reconciliation disputes | §5.1 Cross-device Sync Conflict · §4.5 Bulk Import · §5.6 Restore on New Device |
| **Karthik** — Music teacher | 12 students, individual slots, weekly fees | Forgets who paid weekly; cancels and reschedules constantly | §4.4 Partial Payment · §5.2 Mark Attendance then Fee · §4.3 Lock/Unlock |

### 1.2 Priya — Solo Home Tutor

Priya teaches Class 8–10 Mathematics in a Tier-2 Indian city. She visits 4 students at their homes and runs two evening batches of 6 students each at her own place. Her phone is her only computer most days. She previously tracked fees on a paper register and shared receipts by photographing the register page.

**Her friction points:** scrollback fatigue in WhatsApp to confirm who paid last month, no clean receipt to share with parents, no quick way to see "who hasn't paid this month".

**Flows she exercises most:** the onboarding flow (§2) — she installs alone and must succeed in 7 minutes; the cash payment flow (§4.4) — 4–6 times per evening; the search-and-record cross-screen flow (§5.3) — when a parent calls and asks "what's my child's balance?". She never opens Settings after the first week.

### 1.3 Arjun — Test-Prep Coach

Arjun runs JEE/NEET coaching with 4 weekend batches. He has a laptop at the centre and a phone on the road. Sunday evenings are his reconciliation hell: cross-checking the attendance register against the fees sheet to find students who attended but haven't paid.

**His friction points:** attendance-vs-fees reconciliation (30+ min/week), generating monthly statements for tax filing, late-attendance corrections after the 48-hour lock.

**Flows he exercises most:** the bulk attendance flow (§4.3) — twice every Saturday and Sunday; the monthly collection report (§5.5) — once a month; the drill-down from dashboard heatmap (§4.1 Flow 4) — daily, to spot absentees who haven't paid.

### 1.4 Meera — Small-Academy Owner

Meera runs an academy with 180 students, 6 batches, and two part-time co-tutors. She is the only "admin" — co-tutors mark attendance but cannot void receipts. She owns a MacBook at the centre and an iPad at home.

**Her friction points:** co-tutor marks attendance wrong then leaves; she has to fix it after lock; backup discipline (her previous Excel sheet corrupted in 2024 and lost 6 months); student onboarding in batches of 30+ at the start of the academic year.

**Flows she exercises most:** bulk student import (§4.5 Flow 7) — twice a year; sync conflict resolution (§5.1) — weekly; void a receipt (§5.4) — monthly, when a parent disputes; restore on a new device (§5.6) — once a year, when hardware changes.

### 1.5 Karthik — Music Teacher

Karthik teaches Carnatic vocal and veena to 12 students in individual weekly slots. Fees are weekly, attendance is per-session, and cancellations are constant — students reschedule via WhatsApp and he forgets to update the ledger.

**His friction points:** weekly fee cycle (not monthly), frequent cancellations, partial payments ("I'll pay ₹500 now and ₹300 next week"), needing to lock each session individually because there's no batch.

**Flows he exercises most:** partial payment variant (§4.4); mark-attendance-then-fee (§5.2) — every session; lock/unlock per session (§4.3 Flow 11); void a receipt (§5.4) — when a student cancels after payment.

---

## 2. First-Run Onboarding Flow (≤ 7 Minutes)

**Goal:** A brand-new tutor, given only the app, reaches a working business state in ≤ 7 minutes — with one batch, one student, one attendance record, and one payment recorded. No manual opened (P12 — *the tutor's time is the metric*).

**Persona:** Priya. She installed the app at 9 PM after her last batch and has 7 minutes before her daughter needs the phone.

### 2.1 The 8-Step Sequence

```
[Signup /app]  ──────────────────────────────────────────────────────── 0:00
  └─ Supabase Auth (email or Google)
      └─ provision-db Edge Function → Turso DB created (10_security §2)
          └─ Client reads JWT → libSQL client init
              └─ Schema bootstrap (migrations 0001..N)
                  └─ Seed defaults (settings, Default Batch, 3 tags, welcome notification)

[Step 1 — Language Select]  ─────────────────────────────────────────── 0:30
  Screen: LanguageSelectSheet (glass, centered, 6 languages)
  User action: taps "English" (or हिन्दी / தமிழ் / తెలుగు / ಕನ್ನಡ / മലയാളം)
  System: settings.locale = 'en-IN'; UI re-renders; "Continue"
  Edge case: if user dismisses sheet, defaults to device locale

[Step 2 — Set 6-Digit PIN]  ─────────────────────────────────────────── 1:00
  Screen: PinSetupScreen (neumorphic keypad, bioluminescent emerald dots)
  User action: enters 6 digits → re-enters to confirm
  System: PBKDF2(pin, salt, 600k iters) → settings.pin_hash; audit_log(pin_set)
  Validation: weak PINs (123456, 000000, birth-year patterns) rejected with hint
  Edge case: 3 mismatches → sheet resets, hint shown, no lockout yet (first-run)

[Step 3 — Biometric Opt-In]  ────────────────────────────────────────── 1:30
  Screen: BiometricOptInSheet (FaceID/TouchID icon, "Skip" secondary)
  User action: taps "Enable FaceID" or "Skip for now"
  System: if enabled → SecureEnclave keypair generated; settings.biometric_enabled=true
  Note: biometric is convenience, NOT replacement for PIN (10_security §3)
  Edge case: hardware unavailable → sheet auto-skips with toast

[Step 4 — Backup Passphrase]  ────────────────────────────────────────── 2:00
  Screen: PassphraseSetupSheet (strength meter, "Why?" tooltip)
  User action: types ≥ 12-char passphrase → confirms
  System: argon2id(passphrase) → derived key; passphrase NEVER persisted (BR-BAT-01)
          hint stored separately, encrypted with PIN-derived key
  Validation: strength meter (red → amber → emerald); "correct-horse-battery-staple" suggestions
  Edge case: user skips → warning shown, "Create later" badge on Settings → Backup
             Dashboard shows amber banner until set

[Step 5 — First Batch Creation]  ─────────────────────────────────────── 3:00
  Screen: BatchCreateSheet (glass, name + schedule + fee model)
  User action: types "Evening Batch A" → picks Mon/Wed/Fri 6–7 PM → selects "Postpaid Monthly ₹2,000"
  System: INSERT batches + audit_log(batch_create)
  Default: "Default Batch" already seeded; user can rename or skip
  Edge case: if user picks Prepaid → fee_schedule auto-generated for next 3 months (BR-FEE-03)

[Step 6 — First Student Creation]  ───────────────────────────────────── 4:00
  Screen: StudentAddSheet (5 fields: name*, grade, phone, batch, fee_model)
  User action: types "Aarav Sharma" → Class 10 → +91… → Evening Batch A → Postpaid
  System: Zod validation → INSERT students + student_enrollments + audit_log
          Duplicate detection (BR-STU-02): if phone matches existing → interstitial
  Edge case: code auto-generated if blank (BR-STU-04); fee plan optional, can set later

[Step 7 — First Attendance Mark]  ────────────────────────────────────── 5:30
  Screen: AttendanceScreen, Daily Grid view, prefilled to today + Evening Batch A
  User action: taps "Mark all Present" → taps [Save]
  System: transactional INSERT attendance_records (BR-ATT-06 bulk mark)
          sync_outbox queued; status chip "Saved locally · 1 pending"
  Edge case: 1 student, so bulk vs single identical; long-press → late (amber)

[Step 8 — First Payment Record]  ─────────────────────────────────────── 6:30
  Screen: RecordPaymentSheet (prefilled: Aarav, ₹2,000, cash, today)
  User action: taps [Full due ₹2,000] → taps [Save]
  System: atomic ledger txn (BR-LED-01/L02):
          1. audit_log INSERT (fail-closed)
          2. ledger_entries INSERT (PAYMENT_RECEIVED, credit ₹2,000)
          3. receipts INSERT (RCP-000001, tamper_hash)
          4. db.invoice.update({ data: { status: "paid" } }) (unpaid → paid)
          5. sync_outbox INSERT
          Toast "Receipt RCP-000001 generated" + [View] [Share]
  Success: 7-minute timer stops ✓
```

### 2.2 Onboarding Acceptance

- Completes in ≤ 7 min wall-clock with no manual opened.
- Every empty state guides the next step (P15 — *honest empty states*).
- Backup passphrase is the only "delay-able" step; an amber banner persists on the Dashboard until set.
- Onboarding is resumable — closing the app at Step 4 returns to Step 4 on relaunch.

> **Cross-reference:** `08_Settings.md §6.2.6` (Security), `08_Settings.md §6.2.7` (Backup & Restore), `10_Security.md §2` (Authentication & Provisioning), `10_Security.md §3` (PIN/Biometric Architecture), `14_Edge_Cases.md §6` (Security Edge Cases).

---

## 3. Day-in-the-Life Flow

A real-time timeline of Arjun's Saturday — the busiest day in his week. Shows which of the 7 hidden engines (`02_Core_Logic.md §5`) fire when.

| Time | Event | User Action | Engine Fired | Spec Ref |
|---|---|---|---|---|
| **06:30** | Wake, open app | Unlock with FaceID | **Security Engine** — biometric check, last-screen restore | `10_Security.md §3` |
| **06:35** | Glance at Dashboard | View KPI cards + Due Today | **Report Engine** — KPI snapshot query (cached, 5-min TTL) | `04_Dashboard.md §9.1` |
| **07:00** | Morning batch (20 students) | Tap "Mark today's attendance" → bulk Present → Lock | **Audit Engine** (lock writes audit row) + **Sync Engine** (outbox flush) | `06_Attendance.md §9` |
| **08:30** | Breakfast, parent calls | Search "Aarav" via ⌘K → view profile → dictate balance | **Search Engine** — FTS5 query, grouped results | `05_Students.md §9.7` |
| **10:00** | Drive to centre | App backgrounded; auto-lock at 5-min idle | **Security Engine** — idle timeout, content blur | `10_Security.md §4` |
| **12:00** | Lunch break | Notification fires: "3 students have fees due today" | **Reminder Engine** — BR-RPT-01 due-fee reminder | `12_Business_Rules.md §6` |
| **12:05** | Record a cash payment | Tap notification → student drawer → Record Payment → Save | **Ledger Engine** (atomic txn) + **Receipt Engine** (PDF gen) | `07_Fees_and_Payments.md §9` |
| **14:00** | Afternoon mock test | Mark 40 students present in 2 batches | **Attendance Engine** — bulk mark, 1 txn per batch | `06_Attendance.md §9.3` |
| **17:00** | Evening batch | Mark attendance + immediately record partial fees for 6 students | **Ledger + Attendance** — cross-engine coordination | §5.2 below |
| **19:00** | Dinner | Parent disputes a receipt from last week | Void receipt (PIN-gated) | §5.4 below |
| **20:30** | Generate monthly statement | Reports → Monthly Collection → Export PDF | **Report Engine** (compute + render) + **Notification Engine** (signed URL) | `07_Fees_and_Payments.md §11` |
| **21:30** | Phone reconnects (was offline on metro) | sync_outbox flushes silently | **Sync Engine** — LWW conflict resolution | `02_Core_Logic.md §6` |
| **22:00** | End-of-day backup | Settings → Backup & Restore → Create Backup | **Backup Engine** — AES-256-GCM encrypt → file save | `09_Backup_and_Import_Export.md §4` |
| **22:05** | App backgrounded; auto-backup at 02:00 | (no user action) | **Backup Engine** — scheduled, if enabled | `08_Settings.md §6.2.7` |

> **Engine firing order matters.** The Ledger Engine is append-only and never blocks on Sync. The Sync Engine is background and never blocks the UI. The Security Engine gates Ledger mutations that touch money or exports. The Reminder Engine never fires during quiet hours (22:00–07:00 by default) — see §9.3 decision tree.

---

## 4. Per-Screen Primary Flows

The 5 persistent screens each have 3–5 flows that account for ≥ 80% of their daily traffic. Each flow below is a numbered step list with an ASCII diagram.

### 4.1 Dashboard (`04_Dashboard.md`)

**Flow 1 — Morning Glance (≤ 5 seconds)** `[offline]`
```
[Open app / unlock]
  └─ Dashboard renders with cached KPI snapshot (5-min TTL)
      ├─ C1 Collected This Month · ₹84,500 (↑18% vs last)
      ├─ C2 Due Till Date · ₹12,000 (↓ from ₹15k)
      └─ Due Today panel: 3 students listed
          └─ [Tap student] (tap 1) → Students drawer, pre-focused
```

**Flow 2 — Drill-Down from Heatmap** `[offline]`
```
[Click heatmap cell — student × day, status=absent]
  └─ Shell switches to Attendance screen (tap 0 — same-tap nav)
      └─ Pre-filtered: batch=student's batch, date=that day
          └─ Student's row highlighted, absent toggle shown
              └─ Tutor can re-mark (subject to lock rules) or inspect
```

**Flow 3 — Quick-Action: Record Payment** `[offline]`
```
[Dashboard "Record payment" quick-action] (tap 1)
  └─ RecordPaymentSheet opens (glass, recent students list)
      └─ [Select student] + [amount] + [Save] (tap 2)
          └─ Atomic ledger txn → Toast "Receipt RCP-000043 generated"
```

**Flow 4 — Review Activity Feed**
```
[Scroll Activity Feed]
  └─ AF renders last 50 events (audit_log-derived, 9_event_types)
      └─ [Tap event] (tap 1) → deep-links to source (receipt, student, session)
```

### 4.2 Students (`05_Students.md`)

**Flow 1 — Add a Student (≤ 20 seconds)** `[offline]`
```
[+ Add Student]  (tap 1)
  └─ Add Student sheet (glass, right-side on desktop / bottom sheet on mobile)
      ├─ Fields: first_name*, last_name, phone, grade, batch, fee_model
      └─ [Save]  (tap 2)
          ├─ Zod validation (BR-STU-04: code auto-gen if blank)
          ├─ Duplicate detection (BR-STU-02): if dup_key match → [Merge | Proceed]
          └─ INSERT students + student_enrollments + audit_log
              └─ Toast "Student added" + drawer opens to Profile tab
                  └─ [Set Fee Plan] (optional, tap 3) → FeePlanCard
```

**Flow 2 — Search & Open Profile**
```
[Type in search bar / ⌘K]  (keystroke)
  └─ FTS5 query → grouped results (Students · Receipts · Invoices)
      └─ [Tap student] (tap 1) → drawer opens at Overview tab
          └─ [Tap Ledger tab] (tap 2) → immutable ledger table renders
```

**Flow 3 — Edit Student Details**
```
[Student drawer → Edit] (tap 1)
  └─ EditStudentSheet (same fields as Add, prefilled)
      └─ [Save] (tap 2)
          ├─ Zod validation → db.student.update() + db.auditLog.create()
          └─ Toast "Student updated"
  Note: name/phone change does NOT re-trigger duplicate detection (only on insert)
```

**Flow 4 — Archive / Graduate Student**
```
[Student drawer → ⋯ → Archive] (tap 1)
  └─ Confirm sheet: "Archive Aarav Sharma? Ledger remains read-only."
      └─ [Type "ARCHIVE"] + [PIN] (tap 2) — BR-SEC-02
          ├─ db.student.update({ data: { status: "archived", archivedAt: now } })
          ├─ audit_log(student_archive)
          └─ Toast "Student archived"
  Variant: Graduate — same flow, status='graduated'; outstanding dues shown in confirm sheet
```

### 4.3 Attendance (`06_Attendance.md`)

**Flow 1 — Mark Today's Attendance (≤ 30 seconds for 30 students)** `[offline]`
```
[Attendance] (tap 1)
  └─ Defaults: today's date, most-recently-used batch, Daily Grid view
      └─ [Mark all Present] (tap 2) — bulk mark, one transaction (BR-ATT-06)
          ├─ Each row toggles to present (emerald glow + haptic)
          └─ Status chip: "Saved locally · 30 pending"
              └─ (background) sync_outbox flushes to Turso
                  └─ Chip: "Synced · 2m ago"
                      └─ [Lock] (tap 3, optional) → PIN/biometric → session locked
```

**Flow 2 — Individual Toggle + Late Cycling**
```
[Tap row toggle] → present ↔ absent
[Long-press toggle] → cycles to 'late' (amber)
[Long-press again] → cycles to 'excused' (muted-violet)
[Long-press again] → back to present
```

**Flow 3 — Mark Session as Holiday**
```
[Tap session header → ⋯ → Mark as Holiday] (tap 1)
  └─ Confirm sheet: "Mark Nov 12 Evening Batch as holiday?"
      └─ [Confirm] (tap 2) — BR-ATT-04
          ├─ db.attendanceRecord.update({ data: { status: "holiday" } }) (NOT deleted)
          ├─ audit_log(attendance_holiday)
          └─ Grid shows violet diagonal stripe + HolidayBadge
  Note: see 06_Attendance.md §9.5 for the implementation choice (status flip vs soft-delete)
```

**Flow 4 — Lock / Unlock Session** `[offline]`
```
[Lock] (tap 1) → PIN/biometric (tap 2)
  └─ session.locked_at = now → audit_log(attendance_lock)
      └─ Grid becomes read-only; lock icon shown (slate)

[Unlock — within 30 days]
  [Unlock] (tap 1) → PIN (tap 2) → audit_log(attendance_unlock)
      └─ Grid editable for corrections; every edit → audit_log(attendance_edit_locked)

[Unlock — after 30 days (hard lock, BR-LED-05)]
  [Request Unlock] (tap 1) → [Reason typed] → [PIN] (tap 2)
      └─ Session unlocked for 1 hour; all edits double-audited
          └─ Auto-relocks after 1h or on app background
```

### 4.4 Fees & Payments (`07_Fees_and_Payments.md`)

**Flow 1 — Record a Cash Payment (≤ 15 seconds)** `[offline]`
```
[Record Payment] (tap 1)
  └─ Sheet: student (prefilled if from row), amount, method=cash, date=today
      ├─ Quick-amount buttons: [Full due ₹4,500] [Half] [Custom]
      └─ [Save] (tap 2)
          ├─ Atomic txn (BR-LED-01/L02):
          │   BEGIN
          │   1. audit_log INSERT (fail-closed)
          │   2. ledger_entries INSERT (PAYMENT_RECEIVED, credit)
          │   3. receipts INSERT (RCP-next_seq, tamper_hash)
          │   4. db.invoice.update({ data: { status: "paid" | "partial" } })
          │   5. db.feeScheduleItem.update({ data: { status: ... } })
          │   6. sync_outbox INSERT
          │   COMMIT
          └─ Toast "Receipt RCP-000042 generated" + [View] [Share]
              └─ Receipt PDF rendered (BR-RC-02) → share via signed URL
```

**Flow 2 — Partial Payment**
```
[Record Payment] (tap 1)
  └─ Amount < due (e.g., ₹2,000 of ₹4,500)
      └─ [Save] (tap 2)
          ├─ invoice status → 'partial'; balance_due = ₹2,500
          ├─ Reminder Engine re-queues for remaining (BR-RPT-01)
          └─ Toast "Partial payment · ₹2,500 remaining"
```

**Flow 3 — Advance Payment (BR-LED-06)**
```
[Record Payment] (tap 1)
  └─ Amount > due (e.g., ₹5,000 of ₹4,500)
      └─ [Save] (tap 2)
          ├─ Split: ₹4,500 to PAYMENT_RECEIVED + ₹500 to ADVANCE_RECEIVED
          ├─ Student balance shows −₹500 (credit, EC-F-08)
          └─ Next invoice auto-applies the advance
```

**Flow 4 — Backdated Payment (PIN-gated, BR-SEC-02)**
```
[Record Payment] (tap 1) → date < today
  └─ [Save] (tap 2) → PIN prompt (tap 3)
      ├─ audit_log metadata: { backdated: true, original_date: <chosen> }
      ├─ If date is before attendance lock → warning shown, must confirm
      └─ Receipt stamped with the chosen date (not "recorded-on" date)
```

### 4.5 Settings (`08_Settings.md`)

**Flow 1 — Change PIN**
```
[Settings → Security → Change PIN] (tap 1)
  └─ Sheet: enter current PIN → enter new PIN → confirm
      └─ [Save] (tap 2)
          ├─ Verify old PIN (PBKDF2 compare)
          ├─ Re-derive: PBKDF2(new_pin, new_salt, 600k iters) → settings.pin_hash
          ├─ Re-encrypt backup passphrase hint with new PIN-derived key
          └─ audit_log(pin_change)
```

**Flow 2 — Generate & Send Monthly Statement**
```
[Fees → student row → ⋯ → Generate Statement] (tap 1)
  └─ Month picker (default: last month)
      └─ [Generate] (tap 2)
          ├─ Report Engine: charges + payments + discounts + refunds
          ├─ PDF rendered (statement layout, tamper hash)
          └─ [Share via Link] (tap 3) → signed URL (7-day TTL) copied to clipboard
              └─ Toast "Link copied — share with parent"
```

**Flow 3 — Export to Excel (3 worksheets)**
```
[Settings → Import & Export → Export to Excel] (tap 1)
  └─ Period picker (default: this month; option: all-time)
      └─ [Export] (tap 2)
          ├─ PIN prompt (BR-SEC-02 — exports data)
          ├─ Report Engine queries students + attendance + payments
          ├─ Excel writer: 3 worksheets (Students, Attendance, Payments — BR-BAT-03)
          └─ File save dialog → `Buddysaradhi_Export_20251115.xlsx`
              └─ Toast "Exported 47 students, 1,204 attendance, 89 payments"
```

---

## 5. Critical Cross-Screen Flows

These are the multi-screen journeys that a tutor performs dozens of times per week. Each must work in ≤ 3 taps across screens.

### 5.1 Record a Payment for a Student from the Dashboard

```
[Dashboard] → quick-action "Record payment" (tap 1)
  └─ RecordPaymentSheet opens
      └─ [Tap student field → recent-students dropdown opens]
          └─ [Tap "Aarav Sharma"] (tap 2)
              └─ Sheet auto-fills: amount=due ₹4,500, method=cash, date=today
                  └─ [Save] (tap 3)
                      └─ Atomic ledger txn → Toast "Receipt RCP-000044 generated"
                          └─ Dashboard KPI C1 increments by ₹4,500 (optimistic)
                              └─ Activity Feed prepends the new entry
```

### 5.2 Mark Attendance then Immediately Record a Fee for the Same Student

**Persona:** Karthik, after every music session.

```
[Attendance] → [Mark Aarav present] (tap 1) → [Save] (tap 2)
  └─ Status chip: "Saved locally · 1 pending"
      └─ [Tap Aarav's row] (tap 3) → context sheet opens
          └─ [Record Payment] (tap 4)
              └─ RecordPaymentSheet opens, prefilled with Aarav + today + weekly fee
                  └─ [Save] (tap 5)
                      └─ Ledger txn → Toast "Receipt generated"
                          └─ Attendance grid shows present + receipt-link chip
                              └─ Audit log: attendance_record + ledger_entry in same minute
```

### 5.3 Search for a Student from Any Screen → Open Profile → Record a Payment

```
[⌘K from any screen] → type "aarav" (keystrokes)
  └─ Search Engine returns grouped results
      └─ [Tap "Aarav Sharma" under Students] (tap 1)
          └─ Students drawer opens at Overview tab
              └─ [Tap Ledger tab] (tap 2) → view running balance
                  └─ [+ Payment] (tap 3) → RecordPaymentSheet (prefilled)
                      └─ [Save] (tap 4) → ledger txn → toast
```

### 5.4 Void a Ledger Entry (with PIN Gate) `[offline]`

```
[Fees → student ledger → receipt row → Void] (tap 1)
  └─ Confirmation sheet: "Void receipt RCP-000042? Reverses ₹4,500. A voiding entry will be posted."
      └─ [Reason] (optional) → [Type "VOID"] → [PIN] (tap 2)
          ├─ Atomic txn:
          │   1. audit_log (payment_void)
          │   2. ledger_entries INSERT (type=VOID, reverses_entry_id=original)
          │   3. db.receipt.update({ data: { voidedAt: now } }) + PDF re-stamped "VOID"
          │   4. db.invoice.update({ data: { status: "unpaid" | "partial" } }) (reverts paid → unpaid/partial)
          │   5. db.feeScheduleItem.update({ data: { status: ... } }) reverts
          │   6. sync_outbox INSERT
          └─ Toast "Receipt voided · student balance re-adjusted"
```

Original receipt remains visible (stamped VOID). Ledger shows both rows. Balance recomputed. Receipt number never reused (BR-RC-01).

### 5.5 Generate a Monthly Report and Export to PDF

```
[Fees screen → Reports → Monthly Collection] (tap 1)
  └─ Month picker (default: current)
      └─ [Generate] (tap 2)
          ├─ Report Engine: collected (BR-CALC-03), charged, dues, top payers, top defaulters
          ├─ On-screen glass card with charts (revenue bar, defaulter list)
          └─ [Export PDF] (tap 3)
              ├─ PIN prompt (BR-SEC-02 — exports data)
              ├─ PDF rendered (ReportLab, A4, statement layout, tamper hash)
              └─ File save dialog → `Buddysaradhi_Monthly_2025-11.pdf`
```

### 5.6 Restore from Backup on a New Device

**Persona:** Meera, the year her MacBook was stolen.

```
[Install Buddysaradhi on new MacBook] → [Signup with same Supabase account]
  └─ provision-db runs → NEW empty Turso DB created (⚠️ this is empty, not the old one)
      └─ Settings → Backup & Restore → Restore Backup
          └─ File picker → select `buddysaradhi-backup-….buddysaradhi`
              └─ [Passphrase] → [Type "RESTORE"] → [PIN]  (triple gate, BR-SEC-02)
                  ├─ Decrypt (AES-256-GCM + argon2id) → verify sha256 → parse JSONL
                  ├─ schema_version check → migrate if older (BR-SYN-04)
                  ├─ Conflict strategy: Overwrite (default) — restored rows overwrite by ID
                  └─ Transactional write (FK-aware order) + audit_log
                      └─ GlassShell reloads → all students, ledger, attendance, receipts restored
                          └─ <60s for 1k students ✓
```

> **Note:** The new Turso DB is overwritten by the restore. The old Turso DB (if still alive) is unaffected — restore is a local+cloud overwrite of the *current* tenant DB. See `09_Backup_and_Import_Export.md §6` and `14_Edge_Cases.md §11` (EC-RV-01..03).

---

## 6. Error & Recovery Flows

Buddysaradhi never silently fails (`AGENTS.md` Rule 9). Every error has a defined recovery path. The 7 most consequential error scenarios:

### 6.1 PIN Forgotten

```
[5 failed PIN attempts] → 30s lockout (EC-SEC-01)
  └─ Sheet shows: "Forgot PIN? Use passphrase to reset."
      └─ [Reset via Passphrase] (tap 1)
          └─ Enter backup passphrase (10_security §4)
              ├─ If correct: re-derive PIN hash, allow new PIN set
              ├─ If wrong 3 times: 5-min lockout, no passphrase reset for 1h
              └─ If wrong 5 times: 24h lockout; only restore-from-backup remains
                  └─ Settings → Backup & Restore → Restore (triple gate)
                      └─ Restore wipes local DB and rebuilds from backup; new PIN set in flow
```

### 6.2 Backup Passphrase Lost

```
[Settings → Backup & Restore → "Passphrase lost" link]
  └─ Sheet: "Without the passphrase, your existing backup files are unrecoverable.
             You can set a new passphrase for FUTURE backups, but old backups remain locked."
      └─ [Acknowledge + Set New Passphrase] (tap 1) → [PIN] (tap 2)
          ├─ New argon2id salt + derived key generated
          ├─ Old backups marked "unrecoverable" in UI (greyed out)
          └─ audit_log(passphrase_reset)
```

> **No backdoor.** Passphrase loss is unrecoverable for existing backups (10_security §5 — *Data Minimisation*). This is intentional: a backdoor for us is a backdoor for everyone.

### 6.3 Sync Conflict Detected

```
[Phone reconnects after offline period]
  └─ sync_outbox flushes attendance_records UPDATE
      └─ Turso detects conflict (same row, different updated_at)
          └─ LWW (BR-SYN-01): newer updated_at wins
              ├─ Loser version → audit_log(sync_conflict_lost, metadata={row, old, new})
              └─ Sync drawer shows: "1 conflict resolved (Attendance · Aarav · 2025-11-12)"
                  └─ [Tap entry] → views audit → [Manually Re-edit] if LWW picked wrong
                      └─ Manual edit creates a NEW attendance_records row (audit-logged)
```

Ledger is conflict-immune (BR-SYN-02): two devices posting different `PAYMENT_RECEIVED` entries both land; no merge needed.

### 6.4 Disk Full

```
[Any write operation: e.g. db.ledgerEntry.create()]
  └─ Prisma error → underlying SQLite error: SQLITE_FULL (disk full)
      └─ Toast (amber): "Storage full · changes saved in memory only"
          └─ Sticky footer turns amber: "⚠ Local storage full — free up space"
              └─ [Tap footer] → Diagnostics sheet: storage breakdown
                  └─ Suggestions: clear sync_outbox (already-synced rows), export & archive old data
                      └─ If sync_outbox clear fails → "Export backup, then Reset Local Cache"
```

### 6.5 Biometric Unavailable (EC-SEC-02)

```
[App unlock attempt — FaceID]
  └─ Native API returns BiometryLockout or BiometryNotAvailable
      └─ Auto-fallback to PIN sheet (no user action needed)
          └─ Subtitle: "FaceID unavailable — enter PIN"
              └─ After 3 successful PIN unlocks in a row:
                  └─ Banner: "Re-enable FaceID in Settings → Security"
```

### 6.6 Search Returns Zero Results

```
[Type "zzz" in ⌘K]
  └─ Search Engine returns empty result set (< 50ms)
      └─ Empty-state palette:
          ├─ "No matches for 'zzz'"
          ├─ Suggested: "Try a receipt number (RCP-000xxx) or invoice (INV-000xxx)"
          └─ [Add new student named "zzz"] (tap 1) → AddStudentSheet prefilled
```

### 6.7 Fee Voiding on a Locked Period

```
[Fees → receipt row → Void] where receipt.date is inside a locked attendance period
  └─ Confirmation sheet shows extra warning:
      "⚠ This receipt is dated inside a locked attendance period (Nov 1–30).
         Voiding it will NOT unlock attendance. The ledger will reverse,
         but attendance records remain locked."
      └─ [Type "VOID"] + [PIN] (tap 2)
          └─ Ledger void proceeds normally; attendance is untouched
              └─ If attendance MUST be edited → separate Unlock flow (§4.3 Flow 4)
```

---

## 7. Empty-State Flows

Each screen has a first-run empty state (P15 — *honest empty states*). The empty state never just says "no data" — it suggests the next action.

| Screen | Empty State Visual | Suggested Action | Primary CTA |
|---|---|---|---|
| **Dashboard** | Glass card with illustration of an empty desk + KPI cards showing `—` placeholders | "Add your first student to see KPIs here" | **[+ Add Student]** (emerald) |
| **Students** | Empty roster pane + illustration | "Import from Excel, or add one student" | **[+ Add Student]** primary · **[Import Excel]** secondary |
| **Attendance** | Empty grid with one row: "Default Batch · 0 students" | "Add students to this batch, then mark today's attendance" | **[+ Add Student]** primary · **[Switch Batch]** secondary |
| **Fees & Payments** | Empty ledger table | "Record your first payment — receipt auto-generated" | **[+ Record Payment]** (emerald) |
| **Settings** | Profile card empty + amber banner "Backup passphrase not set" | "Set your backup passphrase to enable restore" | **[Set Passphrase]** (amber) |

> **The empty-state promise.** A tutor who finishes onboarding (§2) will see exactly ONE empty state per screen, each with a single primary action. By the time onboarding completes, all five screens are populated.

---

## 8. Accessibility Flows

Buddysaradhi targets WCAG 2.1 AA (`13_UI_Guidelines.md §10`, `AGENTS.md` Rule 10). Below are the keyboard-only, screen-reader, large-text, and high-contrast journeys.

### 8.1 Keyboard-Only Navigation Through the 5 Screens

```
[Tab] → focuses first interactive element (sidebar Dashboard link)
  [Shift+Tab] → reverse direction
  [Enter / Space] → activate focused control
  [Arrow Up/Down] → navigate within lists (student roster, ledger table)
  [Arrow Left/Right] → switch tabs in segmented controls
  [Esc] → close sheet / drawer / palette
  [Cmd/Ctrl+K] → open command palette (global)
  [Cmd/Ctrl+1..5] → jump to screen 1..5 (Dashboard, Students, Attendance, Fees, Settings)
  [?] → open keyboard-shortcuts cheat sheet
```

**Focus indicators.** Every focusable element shows a 2px bioluminescent-cyan outline (`13_UI_Guidelines.md §10.3` — Focus-Visible Rings). Focus never disappears; the only way to lose focus is to close the active panel.

### 8.2 Screen-Reader Narration for the Ledger Table

The ledger table is the densest data surface. Narration order:

```
[Table caption]: "Ledger for Aarav Sharma, 7 entries, balance ₹2,500 credit"
[Column headers announced]: "Date · Description · Type · Debit · Credit · Balance · Receipt"
[Row 1]: "November 1, 2025 · Monthly fee November · CHARGE · 4,500 rupees debit · 4,500 balance"
[Row 2]: "November 3, 2025 · Payment received cash · PAYMENT · 2,000 rupees credit · 2,500 balance · Receipt RCP-000042"
[Row 3]: "November 3, 2025 · Void of RCP-000042 · VOID · 2,000 rupees debit · 4,500 balance"
…
[Footer]: "Ledger is append-only. PIN required to void entries. Last modified 22:00 today."
```

Each row is a `role="row"` with `role="cell"` children; the table has `aria-labelledby` pointing to the caption. Sort controls are `role="button"` with `aria-sort`. Void buttons expose `aria-label="Void receipt RCP-000042"`.

### 8.3 Large-Text Mode (Dynamic Type / Browser Zoom 200%)

At 200% zoom:
- All 5 screens reflow to single-column layouts (`13_UI_Guidelines.md §11` — Density Modes).
- The student roster collapses from 6 columns to 2 (name + balance); other fields move into the detail drawer.
- The ledger table becomes a stacked card list — one card per entry — preserving column semantics via `aria-label`.
- KPI cards on the Dashboard stack vertically; each card occupies full width.
- Touch targets remain ≥ 44×44 px (P15 — *accessibility commitments*).

### 8.4 High-Contrast Mode (Forced Colors / Windows High Contrast)

```
[OS high-contrast ON]
  └─ Buddysaradhi detects via `@media (forced-colors: active)`
      ├─ Glass backdrop-blur disabled (replaced with solid surface tokens)
      ├─ Accents remap to system colors:
      │   emerald → WindowText
      │   cyan   → HotTrack
      │   amber  → Highlight
      ├─ Borders thickened to 2px system-color
      └─ Heatmap cells use patterns (diagonal stripes) + color, not color alone
```

> **Never color-only.** Every status conveyed by color is also conveyed by icon, pattern, or text. Heatmaps pair color with a glyph (✓ present · ✗ absent · ⏱ late · ○ excused · ▒ holiday).

---

## 9. Flow Decision Trees

Three decision trees capture the most frequent "what should the system do?" branches.

### 9.1 Should This Fee Entry Be Voided or Reversed?

```
                  ┌─ Was the original entry a PAYMENT_RECEIVED?
                  │
            ┌─────┴─────┐
           YES          NO (it was a CHARGE / FEE_CHARGE)
            │           │
            ▼           ▼
    ┌─ Has a receipt     ┌─ Does the charge have payments
    │  been issued?      │  applied to it?
    │                    │
   YES        NO       YES        NO
    │         │         │          │
    ▼         ▼         ▼          ▼
  VOID       VOID    VOID +     VOID
  (posts     (posts  reverse    (only the
  reversing  void    payment    charge is
  entry,     entry,  first,     voided;
  receipt    no      then       no payment
  stamped    receipt  void      touch)
  VOID)      touch)  charge
```

### 9.2 Should This Attendance Edit Trigger a Re-Lock?

```
                  ┌─ Is the session currently locked?
                  │
            ┌─────┴─────┐
           NO           YES
            │           │
            ▼           ▼
   Edit freely    ┌─ Is the edit within 30 days of session date?
   (audit_log     │
   only)    ┌─────┴─────┐
            YES          NO (>30 days = hard lock, BR-LED-05)
             │           │
             ▼           ▼
       Unlock         Request Unlock
       (PIN only)     (Reason + PIN, 1h window)
             │           │
             ▼           ▼
       Apply edit    Apply edit (double-audited)
             │           │
             └─────┬─────┘
                   ▼
       Session re-locks automatically:
         - on Save (if user does not opt to stay unlocked)
         - on app background
         - after 1h (hard-lock case)
```

### 9.3 Should This Notification Fire Now or Be Deferred to Quiet Hours?

```
                  ┌─ Is current time within quiet hours (22:00–07:00)?
                  │
            ┌─────┴─────┐
           NO           YES
            │           │
            ▼           ▼
       Fire now    ┌─ Is the notification severity CRITICAL?
                    │
              ┌─────┴─────┐
             YES          NO
              │           │
              ▼           ▼
         Fire now     Defer to 07:00
         (override    (queued in notification_outbox)
          quiet       └─ On 07:00:
          hours;            ├─ flush queued
          log audit)        └─ batch into a single
                                "3 reminders" digest
```

> **Critical severity** = only: backup-passphrase-reset required, restore-required-on-new-device, or 15-failed-PIN-wipe-imminent. All fee reminders, attendance reminders, and inactive-student reminders are NON-critical and defer to quiet hours.

---

## 10. Happy Path vs Edge Path Comparison

For each of the top 10 flows, the happy path and the most likely edge path, with the divergence point and recovery.

| # | Flow | Happy Path | Edge Path | Divergence | Recovery |
|---|---|---|---|---|---|
| 1 | Add Student | Type name → Save → toast | Phone matches existing student (BR-STU-02) | Post-validation, pre-INSERT | Interstitial: [Merge] / [Proceed] / [Cancel] |
| 2 | Mark Attendance | Bulk Present → Save → synced | Two devices mark same student differently (EC-A-07) | sync_outbox flush | LWW; audit log entry; sync drawer shows conflict |
| 3 | Record Payment | Full due → Save → receipt generated | Amount > due (advance, BR-LED-06) | Amount validation | Auto-split: exact + `[ADVANCE]` surplus |
| 4 | Void Receipt | Void → PIN → reversing entry posted | Receipt is inside locked attendance period | Pre-confirmation check | Warning shown; void proceeds, attendance untouched |
| 5 | Generate Statement | Pick month → Generate → share link | Student has zero activity in that month | Report Engine returns empty | Empty-state card: "No activity · pick another month" + [Pick Different Month] |
| 6 | Create Backup | Passphrase + PIN → encrypted file | Disk fills mid-write (EC-IE-06) | Backup Engine write fails | Partial file deleted; toast "Backup failed · free up space and retry" |
| 7 | Restore Backup | Passphrase + RESTORE + PIN → all data back | Schema version newer than app (EC-IE-05) | Pre-restore schema check | Block restore; toast "Update Buddysaradhi first to restore this backup" |
| 8 | Export Excel | Pick period → PIN → file saved | Empty database export (EC-IE-04) | Report Engine returns 0 rows | File still generated; toast "Exported 0 students · nothing to export" |
| 9 | Bulk Import | Pick file → preview → confirm → toast | 3 invalid rows + 2 duplicates in same file | Per-row Zod validation | Invalid rows skipped + listed in report; duplicates → per-row interstitial |
| 10 | App Unlock | FaceID → unlocked | Biometric hardware unavailable (EC-SEC-02) | Native API rejection | Auto-fallback to PIN sheet; banner suggests re-enable in Settings |

---

## 11. Cross-Flow Invariants

Every flow above obeys:

1. **≤ 3 taps** to the goal (P3 — Two-Tap Rule).
2. **Offline-capable** for primary data (P5) — flows tagged `[offline]` work in airplane mode.
3. **Audit-logged** for sensitive mutations (BR-SEC-03) — payment, void, lock, unlock, backup, restore, export, archive, graduate all write `audit_log`.
4. **PIN-gated** for sensitive mutations (BR-SEC-02) — backdated payment, backup, restore, void, hard-lock unlock, export, archive.
5. **Ledger-append-only** — flow 5.4 (void) posts a reversing entry, never edits the original row.
6. **Sticky footer** always visible showing online/offline + pending sync count.
7. **Idempotent** — every flow is safe to retry; outbox de-dupes by idempotency_key (BR-SYN-03).
8. **Resumable** — onboarding and restore resume on relaunch; payment/void are atomic (all-or-nothing).
9. **No silent failures** (`AGENTS.md` Rule 9) — every error surfaces as a toast, banner, or sheet with a recovery path.
10. **Cross-referenced** — every flow cites the screen spec (`04`–`09`), business rule (`12`), and edge case (`14`) it exercises.

---

## 12. ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 (ASCII Art Conventions) for the User Flows doc. The flows here describe UI surfaces (sheets, modals, toasts) — so glass tiers (`.glass` / `.glass-strong` / `.glass-faint` per §5.5) and neumorphic recipes (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6) are annotated inline. The flow-shaped mockups are **funnels, cascades, and round-trip diagrams**, not screen layouts. Character set per §20.2. Accent colours named, never hexed. Cross-references use canonical IDs only.

### 12.1 Design System Reference — User Flows

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces encountered along these flows | Tier | Cross-ref |
|---|---|---|
| LanguageSelectSheet (onboarding step 1) | `glass` centered | §5.5, §8.7 |
| PinSetupScreen (onboarding step 2) | `glass-strong` + backdrop | §5.5, §8.7 |
| BiometricOptInSheet (step 3) | `glass` centered | §5.5, §8.7 |
| PassphraseSetupSheet (step 4) | `glass` centered + strength meter | §5.5, §8.7 |
| BatchCreateSheet (step 5) | `glass-strong` drawer | §5.5, §8.7 |
| StudentAddSheet (step 6) | `glass-strong` drawer | §5.5, §8.7 |
| RecordPaymentSheet (steps 8, 5.1, 5.2) | `glass-strong` drawer + backdrop | §5.5, §8.7 |
| Void confirmation sheet (5.4) | `glass-strong` + backdrop; typed-`VOID` input = `neumo-inset` | §5.5, §8.7, §8.9 |
| Restore-from-backup modal (5.6) | `glass-strong` + backdrop; triple-gate (passphrase + typed `RESTORE` + PIN) | §5.5, §8.7 |
| Toast (receipt generated / void complete) | `glass-strong` + 4px accent left-bar | §5.5, §8.8 |
| Status chip ("Saved locally · 1 pending") | `glass-faint` band | §5.5, §8.3 |
| Amber banner (passphrase not set) | `glass` + amber accent left-border (§5.4) | §5.4, §8.3 |

| Neumorphic controls encountered along these flows | Recipe | Cross-ref |
|---|---|---|
| PIN pad digit buttons (onboarding + gates) | `neumo-raised`; press = `neumo-pressed` + emerald dot fill | §6.6, §8.2 |
| Biometric opt-in primary button | `neumo-raised` (emerald glow) | §6.6, §8.2 |
| Passphrase input field | `neumo-inset` well | §6.6, §8.9 |
| "Mark all Present" button (attendance bulk) | `neumo-raised` (emerald glow); press = `neumo-pressed` | §6.6, §8.2 |
| Attendance mark buttons (Present/Absent/Late/Excused) | `neumo-raised`; active = `neumo-pressed` + accent glow | §6.6, §8.16 |
| Full-due quick-fill button (RecordPaymentSheet) | `neumo-raised` secondary (cyan glow) | §6.6, §8.2 |
| Save / Submit buttons (all sheets) | `neumo-raised` primary (emerald glow) | §6.6, §8.2 |
| Cancel / Skip buttons (all sheets) | `neumo-raised` secondary | §6.6, §8.2 |
| ⌘K command palette search field | `neumo-inset` tray | §6.6, §8.10 |
| Reason input (void flow) | `neumo-inset` well | §6.6, §8.9 |

> **References:** Nielsen Norman Group — *Task Flows vs. User Flows*; Apple HIG — *Onboarding*; Material Design 3 — *Onboarding Patterns*; Smashing Magazine — *Designing Better Onboarding Flows*; WCAG 2.1 AA §2.2.1 (timing — the 7-min onboarding gate); A List Apart — *The Art of the Confirmation* (typed-`VOID` pattern lineage); CSS-Tricks — *Glassmorphism Done Right* (the cosmic canvas + glass-faint status chip pairing).

### 12.2 Mockup F1 — The 7-Minute Onboarding Funnel

```
7-MINUTE ONBOARDING FUNNEL (§2) — Priya, brand-new tutor, no manual
   0:00 ───────────────────────────────────────────────────────────────────► 7:00 ✓
   │                                                                       │
   │  ┌─ [Signup /app] ─────────────────────────────────────────────────┐  │
   │  │  Supabase Auth (email/Google) → provision-db → Turso DB created  │  │
   │  │  Schema bootstrap (migrations 0001..N) + seed defaults           │  │
   │  └────────────────────────────────────────┬────────────────────────┘  │
   │                                           ▼                            │
   │  ┌─ Step 1 · LanguageSelectSheet (.glass centered) ── 0:30 ─────────┐  │
   │  │  "English" · हिन्दी · தமிழ் · తెలుగు · ಕನ್ನಡ · മലയാളം           │  │
   │  │  ↑ .neumo-raised pills; selected = .neumo-pressed (emerald glow) │  │
   │  └────────────────────────────────────────┬────────────────────────┘  │
   │                                           ▼                            │
   │  ┌─ Step 2 · PinSetupScreen (.glass-strong + backdrop) ── 1:00 ─────┐  │
   │  │  6-digit PIN · re-enter to confirm                                │  │
   │  │  ↑ .neumo-raised digit buttons; press = .neumo-pressed            │  │
   │  │  ↑ emerald dots fill as digits enter (P7 motion = meaning)        │  │
   │  │  ✕ weak PINs (123456, 000000, birth-year) rejected                │  │
   │  └────────────────────────────────────────┬────────────────────────┘  │
   │                                           ▼                            │
   │  ┌─ Step 3 · BiometricOptInSheet (.glass centered) ── 1:30 ─────────┐  │
   │  │  [Enable FaceID] (primary, .neumo-raised emerald)                │  │
   │  │  [Skip for now]   (secondary, .neumo-raised)                     │  │
   │  │  Note: biometric = convenience, NOT replacement for PIN          │  │
   │  └────────────────────────────────────────┬────────────────────────┘  │
   │                                           ▼                            │
   │  ┌─ Step 4 · PassphraseSetupSheet (.glass centered) ── 2:00 ────────┐  │
   │  │  ≥12-char passphrase · strength meter red→amber→emerald          │  │
   │  │  ↑ .neumo-inset input well                                       │  │
   │  │  · argon2id(passphrase) → derived key; passphrase NEVER persisted │  │
   │  │  · skip allowed → amber banner persists on Dashboard until set    │  │
   │  └────────────────────────────────────────┬────────────────────────┘  │
   │                                           ▼                            │
   │  ┌─ Step 5 · BatchCreateSheet (.glass-strong drawer) ── 3:00 ───────┐  │
   │  │  name + schedule (Mon/Wed/Fri 6–7 PM) + fee model (Postpaid ₹2k) │  │
   │  └────────────────────────────────────────┬────────────────────────┘  │
   │                                           ▼                            │
   │  ┌─ Step 6 · StudentAddSheet (.glass-strong drawer) ── 4:00 ────────┐  │
   │  │  5 fields: name* · grade · phone · batch · fee_model              │  │
   │  │  Zod validation → INSERT students + student_enrollments + audit   │  │
   │  └────────────────────────────────────────┬────────────────────────┘  │
   │                                           ▼                            │
   │  ┌─ Step 7 · AttendanceScreen + bulk mark ── 5:30 ──────────────────┐  │
   │  │  [Mark all Present] (.neumo-raised emerald) → [Save]              │  │
   │  │  Bulk INSERT attendance_records (BR-ATT-06) in one TX             │  │
   │  │  ↑ status chip "Saved locally · 1 pending" (.glass-faint)         │  │
   │  └────────────────────────────────────────┬────────────────────────┘  │
   │                                           ▼                            │
   │  ┌─ Step 8 · RecordPaymentSheet (.glass-strong drawer) ── 6:30 ─────┐  │
   │  │  prefilled: Aarav · ₹2,000 · cash · today                        │  │
   │  │  [Full due ₹2,000] (.neumo-raised cyan quick-fill) → [Save]      │  │
   │  │  Atomic 5-step TX (BR-LED-01/L02):                                │  │
   │  │    audit_log → ledger_entries → receipts (RCP-000001) →           │  │
   │  │    db.invoice.update() → db.syncOutbox.create()                  │  │
   │  └────────────────────────────────────────┬────────────────────────┘  │
   │                                           ▼                            │
   │  ● Toast (.glass-strong + emerald left-bar):                          │
   │    "Receipt RCP-000001 generated" + [View] [Share]                    │
   │                                                                       │
   └───────────────────────────────────────────────────────────────────────┘
                                    ↑ 7-minute timer stops ✓
   ↑ Acceptance: closes at ≤ 7:00 wall-clock, no manual opened (P12).
   ↑ Resumable: closing the app at Step 4 returns to Step 4 on relaunch.
   ↑ Backup passphrase is the only delay-able step; amber banner persists
     (.glass + amber accent border, §5.4) until the tutor completes it.
```

- ↑ **Steps 1–4 are authentication/security.** They take ≤ 2:30 of the 7:00 budget. The remaining 4:30 is real business setup — batch, student, attendance, payment (P12 — tutor's time is the metric).
- ↑ **The 7-min gate is a release criterion.** Success criterion #1 of `00_Vision.md §13.1`. A regression that adds even 30s requires a §Decision Protocol run (Q3: does it raise minutes-per-day? yes → defer or rewrite).
- ↑ **Glass surface escalation.** Sheets 1, 3, 4 are `.glass` (centered content, low elevation); sheets 2, 5, 6, 8 are `.glass-strong` (focus surface, backdrop dim). The PIN pad in step 2 is the only `.neumo-raised` digit cluster in the funnel — tactile friction is bounded (P11).

### 12.3 Mockup F2 — Record-Payment Happy Path (cross-screen, 3 taps)

```
RECORD-PAYMENT HAPPY PATH (§5.1) — Dashboard quick-action → toast, 3 taps
                                                          P3 two-tap rule honoured
                                                          (taps counted to flow entry)
   ┌─ Dashboard ─────────────────────────────────────────────────────────────┐
   │  ┌─ KPI Strip (.glass, §8.1) ─────────────────────────────────────────┐ │
   │  │ ▌Collected   ▌Due Today   ▌Present                                 │ │
   │  │ ▌₹ 2,45,500 ▌₹ 48,000    ▌92%                                    │ │
   │  └─────────────────────────────────────────────────────────────────────┘ │
   │  ┌─ Quick Actions Bar (sticky bottom) ─────────────────────────────────┐ │
   │  │  [+ Record Payment]   [+ Mark Attendance]   [+ Add Student]         │ │
   │  │   ↑ .neumo-raised primary (emerald glow)                            │ │
   │  │   ↑ tap 1 ─────────────│                                            │ │
   │  └────────────────────────┼────────────────────────────────────────────┘ │
   └──────────────────────────┼───────────────────────────────────────────────┘
                              ▼
   ┌─ RecordPaymentSheet (.glass-strong drawer + backdrop) ───────────────────┐
   │  Student:   [ Aarav Sharma          ▾ ]  ← recent-students dropdown      │
   │  Amount:    [ ₹ 4,500               ]  ← prefilled from due              │
   │  Method:    [ ● Cash  ○ UPI  ○ Cheque ]  ← segmented control (.neumo-inset) │
   │  Date:      [ Today, 27 Jun 2025    ]                                    │
   │                                                                          │
   │  [ Full due ₹4,500 ]   ← .neumo-raised cyan quick-fill (tap 2)          │
   │  [ Save ]              ← .neumo-raised emerald primary  (tap 3)         │
   │  [ Cancel ]            ← .neumo-raised secondary                       │
   └─────────────────────────────────────┬────────────────────────────────────┘
                                         │ atomic 5-step TX (BR-LED-01/L02)
                                         ▼
   ┌─ POST-COMMIT (async, never blocks UI) ───────────────────────────────────┐
   │  STEP 1.  audit_log INSERT (fail-closed)                                 │
   │  STEP 2.  ledger_entries INSERT (PAYMENT_RECEIVED, credit ₹4,500 paise)  │
   │           ↑ amount stored as i64 INTEGER paise (BR-M-01, AP-17)          │
   │           ↑ tamper_hash = SHA-256(prev_hash || payload || secret)        │
   │  STEP 3.  receipts INSERT (RCP-000044, tamper_hash, PDF rendered)        │
   │  STEP 4.  db.invoice.update({ data: { status: "paid" } }) (unpaid → paid) │
   │  STEP 5.  sync_outbox INSERT (idempotency_key = UUIDv7, BR-SYN-03)       │
   └─────────────────────────────────────┬────────────────────────────────────┘
                                         ▼
   ┌─ Toast (.glass-strong + emerald left-bar, §8.8) ─────────────────────────┐
   │  ● Receipt RCP-000044 generated                       [View]   [Share]   │
   └─────────────────────────────────────┬────────────────────────────────────┘
                                         ▼
   ┌─ Dashboard (optimistic re-render) ───────────────────────────────────────┐
   │  KPI C1 ₹2,45,500 → ₹2,50,000 (count-up animation, P7)                   │
   │  Activity Feed: prepends "● Payment ₹4,500 received from Aarav Sharma"   │
   └──────────────────────────────────────────────────────────────────────────┘

   ↑ No PIN gate here — recording a payment is NOT in the §12.3 sensitive-action
     allowlist of 02_Core_Logic.md. Only VOID / backdated / bulk-delete / export /
     restore / disable-biometric / change-PIN trigger the gate.
   ↑ The amount is stored as INTEGER paise — float money is AP-17, a hard reject
     at lint time (BR-M-01, BR-FEE-01).
   ↑ The toast's left-bar is emerald (success). A void toast would be flare
     (destructive); a sync-conflict toast would be amber (pending/partial).
```

- ↑ **P3 honoured.** Three taps: Dashboard quick-action → student quick-fill → Save. The two-tap rule is counted to the *entry* of the flow; the third tap is the commit (allowed per `01_Product_Principles.md` P3).
- ↑ **Optimistic UI.** Dashboard KPI C1 increments immediately; the 5-step TX commits in the background. If the TX fails (rare), the KPI rolls back and a flare toast surfaces.
- ↑ **No telemetry.** The toast's `[Share]` action opens the OS share sheet — no WhatsApp Cloud API upload (Case Study 1 of `01_Product_Principles.md`, AP-10).

### 12.4 Mockup F3 — Void-Receipt Cascade (PIN-gated, multi-row TX)

```
VOID-RECEIPT CASCADE (§5.4) — Fees screen → PIN gate → 6-step atomic TX
   ┌─ Fees & Payments → student ledger → receipt row ─────────────────────────┐
   │  RCP-000042 · ₹4,500 · PAYMENT_RECEIVED · 2025-06-20 · [Void]            │
   │                                                          ↑ .neumo-raised │
   │                                                          ↑ tap 1         │
   └──────────────────────────────────────────────────────────┬───────────────┘
                                                              ▼
   ┌─ Void Confirmation Sheet (.glass-strong + backdrop) ─────────────────────┐
   │  ⚠ Void receipt RCP-000042?                                              │
   │  Reverses ₹ 4,500. A voiding entry will be posted.                       │
   │  Original receipt remains visible, stamped VOID.                         │
   │                                                                          │
   │  Reason (optional): [ mis-logged amount              ] ← .neumo-inset   │
   │                                                                          │
   │  Type "VOID" to confirm: [ VOID                       ] ← .neumo-inset   │
   │  (typed confirm per AP-13; case-sensitive)                               │
   │                                                                          │
   │  [ PIN 6-digit ]  ← tap 2; opens PIN pad (.neumo-raised digits)          │
   │  [ Cancel ]      ← .neumo-raised secondary                              │
   └─────────────────────────────────────────┬────────────────────────────────┘
                                             │ E7 Security Engine gate (§12.3)
                                             │ argon2id verify (10_Security.md §3)
                                             ▼
   ┌─ BEGIN TRANSACTION (atomic, all-or-nothing) ─────────────────────────────┐
   │  STEP 1.  audit_log INSERT  (action='payment_void', actor='tutor')       │
   │  STEP 2.  ledger_entries INSERT                                           │
   │           · type='VOID'                                                   │
   │           · direction=opposite of original (debit ₹4,500)                │
   │           · reverses_entry_id → RCP-000042's ledger row                  │
   │           · amount_paise=450000 (INTEGER paise, BR-M-01)                  │
   │           · tamper_hash chained to student's prior entry                 │
   │  STEP 3.  db.receipt.update({ data: { voidedAt: now() } })              │
   │           · PDF re-stamped "VOID" overlay (watermark, flare accent)      │
   │           · receipt number NEVER reused (BR-RC-01, AP-11)                │
   │  STEP 4.  db.invoice.update({ data: { status: ... } }) (reverts paid)     │
   │  STEP 5.  db.feeScheduleItem.update({ data: { status: ... } }) (reverts)  │
   │  STEP 6.  sync_outbox INSERT (idempotency_key = UUIDv7, BR-SYN-03)       │
   │  COMMIT                                                                  │
   └─────────────────────────────────────────┬────────────────────────────────┘
                                             ▼
   ┌─ Post-commit fan-out (async) ────────────────────────────────────────────┐
   │  · student_balance_cache recompute (§15 of 11_Data_Model.md)             │
   │  · E2 Reminder Engine: if a 'due_fee' reminder was satisfied by the      │
   │    original payment, RESURRECT it (status='pending')                     │
   │  · E4 Report Engine: invalidate MTD aggregates                           │
   │  · E5 Notification: flare toast (see below)                              │
   └─────────────────────────────────────────┬────────────────────────────────┘
                                             ▼
   ┌─ Toast (.glass-strong + flare left-bar) ─────────────────────────────────┐
   │  ▲ Receipt voided · student balance re-adjusted · ₹4,500 now due         │
   └──────────────────────────────────────────────────────────────────────────┘

   ↑ Cascade constraint (BR-LED-04): void is BLOCKED if it would orphan dependent
     rows (e.g., voiding a FEE_CHARGED with credits applied against it). The
     block surfaces as a flare toast with reason; the tutor must void in
     dependency order.
   ↑ Lock-window (BR-LED-05): voiding an entry > 30 days old requires the
     request-unlock flow (typed reason + PIN + audit). Hard-locked entries
     cannot be voided — they require a WRITEOFF (waiver) instead.
   ↑ Receipt numbers are monotonic + gap-tolerant + NEVER recycled (BR-RC-01,
     AP-11). The voided RCP-000042 stays in the sequence; the next receipt is
     RCP-000045, never RCP-000042 again.
```

- ↑ **AP-13 enforced.** All 6 steps run in one SQLite transaction; skipping STEP 1 (audit) or STEP 6 (sync_outbox) is a P0 bug — the lint rule `principles/no-unaudited-mutation.py` blocks it at compile time.
- ↑ **P11 friction is bounded.** A void costs exactly 2 taps + a typed `VOID` + a 6-digit PIN. The friction is intentional and cannot grow without an amendment (`01_Product_Principles.md` P11).
- ↑ **Original row never edited.** The receipt's `voided_at` is set; the ledger row's `amount`/`direction` is never UPDATEd. The VOID entry is a *new* row that reverses the original (`11_Data_Model.md` §5, `BR-LED-03`).

### 12.5 Mockup F4 — Backup → Restore Round-Trip (the P10 sovereignty contract)

```
BACKUP → RESTORE ROUND-TRIP (§5.6) — Meera's MacBook stolen; restoring on new Mac
                                                                        < 60s target

   ┌─ OLD DEVICE (lost) ─────────────────────────────────────────────────────┐
   │  Local SQLite + receipts + audit_log + sync_outbox + .buddysaradhi backup on  │
   │  iCloud Drive (the tutor's choice — we never vendor-side a copy, P10)    │
   └────────────────────────────────────┬────────────────────────────────────┘
                                        │ monthly ritual backup
                                        ▼
   ┌─ .buddysaradhi ENVELOPE (AES-256-GCM + argon2id) ────────────────────────────┐
   │  ┌─ Header ──────────────────────────────────────────────────────────┐  │
   │  │  magic: "BUDDYSARADHI1"  ·  version: 1  ·  kdf: argon2id               │  │
   │  │  kdf_params: m=64MiB t=3 p=4 (RFC 9100)                          │  │
   │  │  cipher: aes-256-gcm  ·  salt: 16B random  ·  iv: 12B random     │  │
   │  └───────────────────────────────────────────────────────────────────┘  │
   │  ┌─ Body (encrypted) ────────────────────────────────────────────────┐  │
   │  │  sha256(plaintext) · JSONL stream of business-table rows          │  │
   │  │  · students · batches · ledger_entries · receipts · audit_log · … │  │
   │  │  · schema_version (BR-SYN-04) · seed_defaults                    │  │
   │  └───────────────────────────────────────────────────────────────────┘  │
   └────────────────────────────────────┬────────────────────────────────────┘
                                        │ tutor emails/pendrives to themselves
                                        ▼
   ┌─ NEW DEVICE (post-theft) ───────────────────────────────────────────────┐
   │  Install Buddysaradhi → Supabase sign-in (same account)                       │
   │  → provision-db Edge Function → NEW empty Turso DB (⚠️ empty, not the   │
   │    old one)                                                              │
   │  → Settings → Backup & Restore → Restore Backup                          │
   │      └─ File picker → select `buddysaradhi-backup-2025-06-26.buddysaradhi`         │
   │          └─ Triple-gate modal (.glass-strong + backdrop, §8.7):          │
   │              · Passphrase  (.neumo-inset input)                          │
   │              · Type "RESTORE" (.neumo-inset input — AP-13)               │
   │              · PIN 6-digit (.neumo-raised pad — BR-SEC-02)               │
   │                                                                          │
   │              ↓ E7 Security Engine verifies all three                     │
   │              ↓ argon2id(passphrase) → derive AES key                     │
   │              ↓ aes-256-gcm decrypt (RFC 8439)                            │
   │              ↓ sha256 verify integrity                                   │
   │              ↓ parse JSONL                                               │
   │                                                                          │
   │              ↓ schema_version check → migrate if older (BR-SYN-04)       │
   │              ↓ Conflict strategy: Overwrite (default) — restored rows    │
   │                overwrite by ID                                           │
   │              ↓ Transactional write (FK-aware order) + audit_log          │
   │              ↓ pre-restore snapshot saved as                              │
   │                `Buddysaradhi_PreRestore_<ts>.buddysaradhi` (safety net)            │
   │                                                                          │
   │              ↓ GlassShell reloads                                        │
   │              ↓ all students · ledger · attendance · receipts restored    │
   │              ↓ <60s for 1k students ✓                                    │
   └──────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   ┌─ Post-restore fan-out ──────────────────────────────────────────────────┐
   │  · audit_log records the full restore (rows written, conflicts,         │
   │    migration path) — the safety net snapshot is offered for download    │
   │  · E6 Sync Engine pushes the restored state to Turso Cloud (overwrite)  │
   │  · Dashboard KPIs re-aggregate                                          │
   │  · Footer: "Last sync: just now · Last backup: <ts>" (.glass-faint)     │
   └──────────────────────────────────────────────────────────────────────────┘

   ↑ P10 sovereignty: the .buddysaradhi file is the tutor's property. We have no
     vendor-side copy; the restore works without our servers being reachable
     (Supabase auth is needed to provision a new DB, but the restore itself
     is local decryption + local write).
   ↑ The triple gate (passphrase + typed RESTORE + PIN) is the strongest
     friction in the product (P11). Restoring OVERWRITES the local DB; the
     friction is the protection.
   ↑ EC-RV-01..03 cover the edge cases (wrong passphrase, schema too new,
     partial restore). See 14_Edge_Cases.md §11.
```

- ↑ **P10 is operational, not aspirational.** The `.buddysaradhi` envelope is portable, encrypted, and survives vendor loss. The restore works on any device the tutor signs into.
- ↑ **AP-7 honoured.** No "export is premium," no proprietary format the tutor cannot read with their own tools (the format is documented in `09_Backup_and_Import_Export.md` §3).
- ↑ **The old Turso DB is untouched.** Restore is a local+cloud overwrite of the *current* tenant DB; if the old device resurfaces, it can re-sync (with conflict resolution per `00_Vision.md` §10.3).

---

## 13. Glossary

| Term | Definition |
|---|---|
| **Happy path** | The flow that executes when no error, no conflict, and no edge case occurs. The "default reality". |
| **Edge path** | The flow that executes when an error, conflict, or edge case (EC-xxx) is encountered. Has a defined recovery. |
| **Empty state** | The first-run view of a screen with zero data. Must suggest the next action (P15). |
| **Quiet hours** | User-configured window (default 22:00–07:00) during which non-critical notifications are deferred and batched. |
| **PIN gate** | A PIN prompt that blocks a sensitive mutation (BR-SEC-02). Biometric can substitute on supported devices. |
| **Triple gate** | The three-factor gate for restore: passphrase (knowledge) + typed "RESTORE" (intent) + PIN (device). See §5.6. |
| **Deep link** | A URL or internal route that opens a specific entity (receipt, student, session) with context pre-filled. |
| **Drill-down** | A same-tap navigation from an aggregate view (heatmap cell, KPI card) to a filtered detail view. Zero re-filtering. |
| **LWW** | Last-Write-Wins — the sync conflict resolution strategy (BR-SYN-01). Newer `updated_at` wins; loser is audit-logged. |
| **Outbox** | The `sync_outbox` table that queues local writes for later sync. De-dupes by `idempotency_key`. Never blocks UI. |
| **Bulk mark** | A single-tap action that sets all students in a batch to the same status (typically Present). One transaction (BR-ATT-06). |
| **Hard lock** | An attendance session locked for > 30 days. Requires typed reason + PIN to unlock; auto-relocks after 1h (BR-LED-05). |
| **Reversing entry** | The ledger entry posted by a void — type=VOID, `reverses_entry_id` points to the original. The original row is never edited. |
| **Signed URL** | A time-limited (7-day) HMAC-signed URL that lets a parent view a receipt without an account (P14). |
| **Idempotency key** | A UUIDv7 generated per user action; lets the outbox de-dupe retries (BR-SYN-03). Same key → same effect, even if applied twice. |

---

These flows are the acceptance criteria for the product. A release that breaks any flow's tap-count, offline guarantee, or audit trail is not shippable. When a new feature is proposed, the question "which flow does this extend or add?" must be answerable in one sentence — otherwise the feature does not belong in v1.
