# 07 — Fees & Payments

> The heart of Buddysaradhi. Where money stops being a spreadsheet column and becomes an immutable ledger. This screen is designed like accounting software — Kite-density, double-entry spirit, append-only spine — but felt like a glass-and-light consumer app. Every receipt is sacred (P9). Every balance is derived (P4). Every action is two taps away (P3).

---

## 1. Purpose

The **Fees & Payments** screen is the single surface where a tutor answers, at any moment, the four questions that decide their business:

1. **Who has paid?** — and how much, by what method, against which invoice, on what date, with what receipt number?
2. **Who hasn't paid?** — and what exactly do they owe, since when, and against which issued invoices?
3. **Who has paid partially?** — and what's the remaining balance, what's the last payment date, and what's the next due?
4. **What is the truth of my collections?** — this month, this cycle, this quarter, with auditable, receipt-grade integrity?

It is also where every financial mutation enters the system. Recording a payment, generating an invoice, applying a discount, issuing a refund, voiding a receipt, sending a reminder — all originate here (or are reachable from here in ≤ 2 taps). The screen is the front-end of the **Ledger Engine** (the spine, §3.3 of `02_Core_Logic.md`); it is the only screen that is allowed to write to `ledger_entries`, `invoices`, and `receipts`.

Because money is the most failure-sensitive surface in the product, this screen enforces three non-negotiable contracts everywhere it renders: **immutability** (BR-LED-01/L02), **integer minor units** (BR-M-01), and **tamper-evident artefacts** (BR-FEE-05, BR-RC-01). No balance field is ever mutated; all balances are derived views over the ledger. No receipt is ever silently edited; corrections are reversing entries. No invoice number is ever reused.

The screen ships in **two interlocking modes** that the tutor toggles with a segmented control at the top:

- **Overview mode** — the KPI strip + Paid/Unpaid/Partial matrix + per-student balance list. "Who owes what, right now."
- **Ledger mode** — the master student list + immutable per-student ledger table + invoice/receipt drill-downs. "Show me the receipts."

Both modes share the same data; the toggle is a presentation choice, not a navigation. The shell does not unmount.

---

## 2. Business Objective

The screen exists to satisfy three measurable outcomes that directly move the north-star metric ("minutes per day inside Buddysaradhi"):

1. **Reduce the time-to-record-a-payment to under 12 seconds** for a known student with a known amount, method, and invoice. Currently this takes 30–60s in a spreadsheet and 2–5 minutes in a school ERP. (P3, P12.)
2. **Eliminate "I don't know who owes me" as a sentence in a tutor's life.** The Overview mode answers this at one glance, without scrolling, for up to 500 students on a mid-range device. (P8, P15.)
3. **Make receipts defensible.** A parent who is handed a Buddysaradhi receipt can verify it independently (the tamper hash footer), print it, screenshot it, and forward it. A tutor who is challenged by a parent three months later can pull up the exact ledger entry, the linked invoice, and the void status in two taps. (P9, BR-FEE-05, BR-RC-01..03.)

Secondary objectives:

- Provide the data spine for the Dashboard's KPI cards and the monthly finance report (`08_Reports.md` companion surface inside Settings → Export).
- Provide the trigger surface for the Reminder Engine (`BR-RPT-01..R05`): every "Send reminder" action originates from a row in the matrix.
- Provide the audit trail every sensitive mutation writes to (`audit_log`) — void receipt, backdated payment, scholarship grant, refund issue.

The screen's success is measured by **reduction in spreadsheet usage** among tutors three months after onboarding. If a tutor still opens Excel to track fees, the screen has failed.

---

## 3. Navigation Entry

| Entry surface | Mechanic | Target state |
|---------------|----------|--------------|
| Sidebar item `◉ Fees` (icon `Wallet`) | Zustand `setActiveScreen('fees')` | Overview mode, default period = current month, default status tab = `unpaid` |
| Global Command Palette `⌘K` → "Record payment" | Opens `RecordPaymentSheet` with student field focused | Sheet, no student preselected |
| Global Command Palette `⌘K` → "Generate invoice" | Opens `GenerateInvoiceSheet` | Sheet, schedule-item picker focused |
| Dashboard KPI card "Due Today" (tap) | `setActiveScreen('fees')` + preset filter `status=unpaid&due<=today` | Overview, filtered |
| Dashboard "Activity feed → payment recorded" row (tap) | `setActiveScreen('fees')` + `setSelectedStudent(id)` + `setMode('ledger')` | Ledger mode, student selected, ledger scrolled to that entry |
| Students screen → student row → "View ledger" action | Same as above | Ledger mode, student selected |
| Students screen → student detail → "Record payment" button | `setActiveScreen('fees')` + open `RecordPaymentSheet` with student prefilled | Sheet, student prefilled |
| Receipt deep-link via signed URL (parent surface) | Reads `?r=<receipt_id>&sig=<hmac>`; renders read-only `ReceiptPreview` in a minimal chrome | Standalone receipt view (no shell) |
| Search result for `INV-000017` or `RCP-000042` | `setActiveScreen('fees')` + `setSelectedInvoice(id)` or `setSelectedReceipt(id)` | Invoice detail or receipt preview modal |
| Keyboard `G F` | Shell shortcut | Fees Overview |

All entries preserve the persistent `GlassShell` (per `02_Core_Logic.md` §5 — only `/` is exposed as a route; deeper screens are in-shell state). Deep-linking uses URL query params (`?s=fees&student=<id>&mode=ledger`) parsed by the shell, never new routes.

---

## 4. User Story

**As** Priya, a 38-year-old coaching-centre owner with 140 students across 6 batches,
**I want** to open the Fees screen and, in the first 3 seconds, see who has paid this month and who hasn't —
**so that** I can walk into my 6pm batch knowing exactly which parent to remind without opening a spreadsheet.

**As** Priya,
**I want** to record a ₹3,000 cash payment from Aarav's father in under 12 seconds and hand him a numbered receipt I can re-print anytime —
**so that** there is never a dispute about "I already paid" three months later.

**As** Priya,
**I want** to see Aarav's full immutable ledger — every charge, every payment, every discount, every void — in one scrollable table that I could show a CA if needed —
**so that** my books are defensible without me keeping a parallel paper register.

**As** Priya,
**I want** to apply a 10% sibling discount to Aarav's invoice and have it post a `DISCOUNT_GRANTED` credit alongside the `FEE_CHARGED` —
**so that** the discount is transparent in the ledger, not silently subtracted from a number.

**As** Priya,
**I want** to mark a ₹5,000 payment as "advance" when Aarav's father insists on paying for next month too —
**so that** the surplus sits in Aarav's advance wallet and auto-applies to the next cycle's charge without me remembering.

**As** Priya,
**I want** to void a receipt I issued by mistake (wrong student) with a PIN, and have the system post a `VOID` entry that reverses the original —
**so that** I correct mistakes without erasing history.

**As** Priya,
**I want** a monthly summary at the end of August showing collected, charged, dues, top payers, top defaulters — exportable to Excel —
**so that** I can file my own books and answer my landlord's "how's business" with a number.

---

## 5. UX Principles

This screen is governed by, and tension-tested against, the following `01_Product_Principles.md`:

| Principle | How it shows up here |
|-----------|----------------------|
| **P3 — Two-Tap Rule** | Record-payment sheet opens in 1 tap from any student row; submit is the 2nd tap. Generate-invoice is 1 tap from a schedule item. Send-reminder is 1 tap. |
| **P4 — Ledger Is Immutable Truth** | The Ledger mode table is the canonical view; balances are *derived* and labelled as such ("Balance: derived from 14 ledger entries"). No "edit amount" affordance exists. |
| **P5 — Offline-First** | Every query and mutation in this screen hits the local embedded replica first. Recording a cash payment in airplane mode writes to `ledger_entries` immediately, queued in `sync_outbox`, flushed on reconnect. |
| **P7 — Motion Is Meaning** | A payment lands → the student's row visibly settles: balance count-up animates 400ms, status chip morphs unpaid→paid with a spring, the receipt number flickers in cyan then locks. A void → chip morphs to flare-red with a haptic thunk. |
| **P8 — Density Without Clutter** | The matrix table shows 8 columns by default (name, code, balance_due, last_payment, last_payment_date, fee_model, status, actions) — every column is sortable/filterable. Hover reveals a 9th "advance_balance" if non-zero. Other fields live in the row's expandable detail. |
| **P9 — Receipts Are Sacred Artefacts** | The receipt preview renders a print-grade layout (A5, 24px margins, tamper hash footer) the *moment* it's generated. The PDF is the canonical artefact; the on-screen preview is a perfect mirror. |
| **P11 — Security Is Tactile** | Void receipt → fresh PIN prompt within 30s. Backdate payment (>3 days before today) → fresh PIN prompt. Bulk remind → 2-second haptic confirm. No "are you sure" double-dialogs. |
| **P12 — Tutor's Time Is the Metric** | Auto-reminders ship before custom receipt logo upload. The "Send reminder" action drafts the message body from the ledger (no typing). The "Generate invoice" sheet auto-suggests the next due schedule item. |
| **P15 — Honest Empty States** | First-ever visit shows: "No fees recorded yet — add a fee plan to your first student." with a single primary CTA. Never a blank grid. |

Additional screen-local principles:

- **No silent re-computation.** When a balance changes, the change is visually traceable: the row briefly highlights cyan, the balance number animates, and a toast links to the ledger entry that caused it.
- **Money never lies about itself.** Every amount is shown locale-formatted (`₹ 12,500` in `en-IN`, `$124.50` in `en-US`) with tabular-nums mono. The integer minor unit is the source of truth; the display string is a *view* over it.
- **Status is colour + icon + word.** Per `13_UI_Guidelines.md` §10.6 (Color Is Never the Only Signal) and §8.3 (Chip / Badge) — never colour alone. `Paid ✓` (emerald), `Partial ◐` (amber), `Unpaid ✕` (flare), `No dues —` (muted violet).
- **Receipt numbers are objects, not strings.** `RCP-000042` is clickable everywhere it appears — in a toast, in a ledger row, in a notification — and opens `ReceiptPreview`.

---

## 6. Screen Layout

### 6.1 Overview Mode — default landing

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  Topbar: Bright Minds Tuition · 🔍 Search · ⌘K · 🔔3 · 👤                                │
├──────────┬─────────────────────────────────────────────────────────────────────────┤
│          │ Fees & Payments                                                         │
│          │ ┌─────────────────────────────────────────────────────────────────────┐  │
│          │ │  [Overview] [Ledger]   Period: [Aug 2025 ▾]  Batch: [All ▾]  ⋮    │  │
│          │ └─────────────────────────────────────────────────────────────────────┘  │
│          │                                                                          │
│          │ ┌── KPI STRIP ────────────────────────────────────────────────────────┐ │
│          │ │ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │ │
│          │ │ │ COLLECTED    │ │ DUE TILL DATE│ │ DUE THIS MON │ │ COUNTS       │  │ │
│          │ │ │ THIS MONTH   │ │              │ │              │ │              │  │ │
│          │ │ │              │ │              │ │              │ │ ✓ 84 Paid    │  │ │
│          │ │ │ ₹ 1,24,500   │ │ ₹ 38,200     │ │ ₹ 22,500     │ │ ◐ 12 Partial │  │ │
│          │ │ │ ↑ 18% vs Jul │ │ across 19    │ │ across 11    │ │ ✕ 44 Unpaid  │  │ │
│          │ │ │              │ │ students     │ │ students     │ │ — 0 No dues  │  │ │
│          │ │ │ [sparkline]  │ │              │ │              │ │              │  │ │
│          │ │ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘  │ │
│          │ └──────────────────────────────────────────────────────────────────────┘ │
│          │                                                                          │
│          │ ┌── STATUS MATRIX ─────────────────────────────────────────────────────┐ │
│          │ │  [✕ Unpaid · 44]  [◐ Partial · 12]  [✓ Paid · 84]  [— No dues · 0]   │ │
│          │ │ ────────────────────────────────────────────────────────────────────│ │
│          │ │  Search 🔍  Sort: [Balance ▾]  Filter ▾  ·  10 / page ▾              │ │
│          │ │ ────────────────────────────────────────────────────────────────────│ │
│          │ │ Student        Code  Balance Due  Last Payment  Date       Model  St│ │
│          │ │ ────────────────────────────────────────────────────────────────────│ │
│          │ │ Aarav Sharma   STU-  ₹ 3,000      —             —          postp  ✕ │ │
│          │ │ ◉              0007                                                  ▤│ │
│          │ │ Diya Patel     STU-  ₹ 1,500      ₹ 1,500       12 Aug     postp  ◐ │ │
│          │ │                0011                                                  ▤│ │
│          │ │ Kabir Singh    STU-  ₹ 0          ₹ 3,000       14 Aug     postp  ✓ │ │
│          │ │                0019                                                  ▤│ │
│          │ │ ... (44 rows total, virtualised)                                    │ │
│          │ │ ────────────────────────────────────────────────────────────────────│ │
│          │ │  Row actions: [ + Record ] [ 📄 Ledger ] [ 🧾 Invoice ] [ 🔔 Remind ]│ │
│          │ └──────────────────────────────────────────────────────────────────────┘ │
│  ◉ Dash  │                                                                          │
│  ◉ Stud  │ ┌── MONTHLY SUMMARY PREVIEW (collapsible) ─────────────────────────────┐│
│  ◉ Attd  │ │  Aug 2025: collected ₹1,24,500 · charged ₹1,62,700 · dues ₹38,200    ││
│  ◉ Fees  │ │  [ View full report ]   [ Export Excel ]   [ Export PDF ]            ││
│  ◉ Sett  │ └──────────────────────────────────────────────────────────────────────┘│
│          │                                                                          │
│  ⚙ Sync  │                                                                          │
│  ⚡ Cmd K │                                                                          │
└──────────┴─────────────────────────────────────────────────────────────────────────┘
│  Sticky Footer: Online · synced 2m ago · v1.0.0-abc1234 · © Buddysaradhi                │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Element notes:**

- **Segmented control `[Overview] [Ledger]`** — pill-style, cyan inset on active per `13_UI_Guidelines.md` §8.5 (Segmented Control) + §6.6 (Neumorphic Component Coverage). Switching does NOT re-fetch; it re-arranges the same TanStack cache.
- **Period selector** — defaults to current month. Options: This Month, Last Month, This Quarter, Custom Range, All Time. Tied to `shellStore.periodFilter`. Changing it invalidates `['fees','overview',periodFilter]`.
- **Batch filter** — `All Batches` or a specific batch from `batches` table. Filters the matrix rows to students enrolled in that batch (via `student_enrollments`).
- **KPI strip** — 4 cards. Each card is glass with a coloured left border: Collected = emerald, Due Till Date = amber, Due This Month = flare, Counts = violet. Amounts in mono tabular-nums, count-up animation on first paint per session only (P7). Sparkline on Collected card shows last 6 months.
- **Status matrix segmented control** — 4 segments with counts. The number after the dot updates live as payments land. Switching tabs swaps the row list (virtualised, no full re-render).
- **Per-student row** — see §6.5 for the full row anatomy.
- **Row actions** — 4 icon buttons revealed on hover (desktop) or always visible (mobile, condensed). Each is a 2-tap path to a primary action.
- **Monthly summary preview** — collapsible at the bottom; expanded shows 6-month sparkline + top-3 payers + top-3 defaulters; collapsed is a single line.

### 6.2 Overview Mode — Per-student row anatomy (expanded)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ Aarav Sharma                                              [ + Record ] [ 📄 Ledger ] │
│ STU-0007 · Class 10 — Maths — 6pm · Postpaid Monthly              [ 🧾 Invoice ] [ 🔔 ] │
│                                                                                    │
│  Monthly Fee      Balance Due          Last Payment       Status                    │
│  ₹ 1,500 /mo      ₹ 3,000              —                  ✕ UNPAID                  │
│  (since Jul 2025) (3 ledger entries)   (none recorded)    Due 5 days ago            │
│                                                                                    │
│  ┌─ Period toggle ──────────────────────────────────────────────────────────────┐  │
│  │  [● Month ] [ Quarter ] [ Year ]      ◀ Aug 2025 ▶                            │  │
│  │                                                                              │  │
│  │   Expected    ₹ 1,500      (monthly_fee × 1)                                 │  │
│  │   Collected   ₹     0      (no PAYMENT_RECEIVED this month)                  │  │
│  │   Arrears     ₹ 1,500      ✕ UNPAID   (expected − collected − waivers)       │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                    │
│  [expand ▾]  advance wallet: ₹ 0  ·  next due: 5 Aug  ·  last invoice: INV-000017  │
│              fee history: ₹1,500 (Jan–Jun) → ₹1,800 (Jul–now) · [change fee]       │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- Row height default `h-14`, expands to `h-40` on click of `[expand ▾]` (taller now — the period toggle + expected/collected/arrears trio is the heart of the screen).
- The **Monthly Fee** column replaces the old "Fee Model" column. It shows `students.monthly_fee_paise` (the cache) formatted as `₹ X /mo`, with the effective-since date below. This is the base unit from which every other number derives (BR-FEE-20).
- The **Period toggle** (`Month | Quarter | Year`) switches the Expected/Collected/Arrears trio between:
  - **Month** — `expectedForMonth`, `collectedForMonth`, `arrearsForMonth` (BR-CALC-09/10/11). Default.
  - **Quarter** — the same functions for the 3-month quarter. Expected = `monthly × 3` (at the rate effective each month).
  - **Year** — the same functions for the 12-month year. Expected = `monthly × 12` (summed at each month's effective rate).
- The trio is always: `Expected` (emerald-tinted label), `Collected` (cyan-tinted), `Arrears` (flare if > 0, emerald if < 0 = advance, muted if 0). All three are integer paise, formatted via `formatINR()`. They reconcile to the paise: `Expected − Collected − Waivers = Arrears`.
- The **fee history** line (`₹1,500 (Jan–Jun) → ₹1,800 (Jul–now)`) is from `FeeRateEngine.history` (§02_Core_Logic §6.9.2). The `[change fee]` link opens the fee-change sheet (append-only, BR-FEE-21).
- Status chip is colour + icon + word per P15/§13.8. `✕ UNPAID` flare, `◐ PARTIAL` amber, `✓ PAID` emerald, `— NO DUES` muted violet.
- "Due 5 days ago" — computed from the latest `fee_schedule_items.due_date` where status ∈ (`pending`,`invoiced`,`partial`,`overdue`). Past due = flare text.
- `[ + Record ]` opens `RecordPaymentSheet` with this student prefilled and the latest open invoice auto-linked.
- `[ 📄 Ledger ]` switches to Ledger mode with this student selected.
- `[ 🧾 Invoice ]` opens `GenerateInvoiceSheet` scoped to this student's pending schedule items.
- `[ 🔔 ]` opens `ReminderTrigger` popover with a drafted message (see §6.7).

**Why the period toggle is the heart of the screen.** The user's explicit ask: *"each student has a specific monthly amount … show quarterly and annually … use it in calculations."* The toggle makes the same monthly fee visible at three granularities, and every figure is derived from `monthly_fee_paise` via the pure functions in `packages/shared/src/feeCalc.ts` (§02_Core_Logic §6.9.3). A tutor who wants to know "how much should Riya have paid this quarter?" taps `Quarter` and sees `₹5,400` — not a guess, the exact sum of 3 months at the effective rate.

### 6.2a Fee Change Sheet (append-only, BR-FEE-21)

```
┌──────────────────────────────────────────────────────────────┐
│  Change Monthly Fee — Aarav Sharma                            │
│                                                                │
│  Current fee:   ₹ 1,500 /mo  (effective since Jul 2025)       │
│                                                                │
│  New monthly fee    [ ₹ 1,800          ] /mo                  │
│  Effective from     [ 2025-10-01 ▾ ]   (defaults to 1st)      │
│  Reason             [ Annual revision        ]                │
│                                                                │
│  ☐ Prorate mid-month (rare — see BR-FEE-22)                   │
│                                                                │
│  Preview:                                                      │
│    Sep 2025 expected: ₹ 1,500  (old rate — unchanged)         │
│    Oct 2025 expected: ₹ 1,800  (new rate)                     │
│    Past months:   unchanged (append-only — history is honest) │
│                                                                │
│           [ Cancel ]   [ Save — append to history ]           │
└──────────────────────────────────────────────────────────────┘
```

- The sheet calls `FeeRateEngine.changeRate` inside a `$transaction` (BR-FEE-21): new `student_fee_rates` row + prior row's `effective_to` closed + `students.monthly_fee_paise` cache updated + `FeeEngine.regenerateSchedule` diffs forward items.
- `effective_from` defaults to the first of next month (BR-FEE-22). Proration is an explicit checkbox, off by default.
- The preview shows the tutor exactly which months change — past months are never touched (the append-only guarantee).

### 6.3 Ledger Mode — per-student immutable ledger

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  [Overview] [● Ledger]   Period: [All Time ▾]   Student: [Aarav Sharma ▾]          │
│ ────────────────────────────────────────────────────────────────────────────────────│
│                                                                                     │
│  ┌── STUDENT HEADER ─────────────────────────────────────────────────────────────┐  │
│  │ Aarav Sharma  STU-0007  · Class 10 — Maths — 6pm                               │  │
│  │ Phone: +91 98xxx · Parent: Rajesh Sharma (Father)                              │  │
│  │ ─────────────────────────────────────────────────────────────────────────────  │  │
│  │  Balance Due      Advance Wallet    Last Payment    Last Receipt               │  │
│  │  ₹ 3,000          ₹ 0               —               —                          │  │
│  │  (derived)        (derived)         (none)          (none)                     │  │
│  │ ─────────────────────────────────────────────────────────────────────────────  │  │
│  │  [ + Record Payment ]   [ 🧾 Generate Invoice ]   [ 📤 Statement ]   [ ⋮ ]    │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                     │
│  ┌── LEDGER TABLE (immutable, append-only) ──────────────────────────────────────┐  │
│  │  Date       Type              Description           Invoice    Receipt  Amount│  │
│  │ ──────────────────────────────────────────────────────────────────────────────│  │
│  │  01 Aug 25  FEE_CHARGED       August Tuition        INV-000017  —      ₹ 3,000│  │
│  │              charge           Postpaid monthly                                     │  │
│  │  ─────────────────────────────────────────────────────────────────────────────│  │
│  │  02 Aug 25  DISCOUNT_GRANTED  Sibling discount 5%   INV-000017  —     −₹  150│  │
│  │              credit           (scholarship: Sibling)                              │  │
│  │  ─────────────────────────────────────────────────────────────────────────────│  │
│  │  15 Aug 25  PAYMENT_RECEIVED  Cash                 INV-000017  RCP-0042 −₹1,500│  │
│  │              credit           Partial payment                                     │  │
│  │  ─────────────────────────────────────────────────────────────────────────────│  │
│  │  18 Aug 25  VOID              Reverses RCP-0042    INV-000017  —      +₹1,500│  │
│  │              charge           Reason: Wrong student (PIN: ✓)                   │  │
│  │  ─────────────────────────────────────────────────────────────────────────────│  │
│  │  Balance Due (derived):  ₹ 3,000 − ₹150 + ₹1,500 − ₹1,500 + ₹1,500 = ₹ ...   │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                     │
│  ┌── INVOICES (this student) ────────────────────────────────────────────────────┐  │
│  │  Number      Issued      Due         Total     Discount  Extra  Status        │  │
│  │  INV-000017  01 Aug 25   05 Aug 25   ₹ 3,000   ₹ 150     ₹ 0    Partial ◐    │  │
│  │  INV-000012  03 Jul 25   07 Jul 25   ₹ 3,000   ₹ 0       ₹ 0    Paid ✓       │  │
│  │  ...                                                                            │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- **Student header** — large glass card. Numbers count-up on first paint. All amounts are *labelled as derived* — "Balance Due (derived)" — to reinforce that this is a computed view, not a stored field.
- **Ledger table** — the spine. Rows are sorted by `occurred_on DESC, created_at DESC`. Each row is immutable; clicking a row opens a side drawer with full entry detail (device_id, source, created_by, tamper hash, reverses_entry_id).
- **Amount column** — signed. Charges positive (no sign shown), credits negative (`−₹`). Colour: charges white, credits emerald, VOID rows flare. Tabular-nums.
- **Invoice column** — clickable → opens `InvoiceDetail`.
- **Receipt column** — clickable → opens `ReceiptPreview`.
- **Description column** — wraps to 2 lines max; full text in expandable.
- **VOID rows** — visually distinct: flare-red left border, strike-through on the original entry it reverses (the original row shows a small "↺ voided by entry xxx" link).

### 6.4 Record Payment Sheet

```
                        ┌──────────────────────────────────────────┐
                        │  Record Payment                            │
                        │ ─────────────────────────────────────────  │
                        │                                            │
                        │  Student                                   │
                        │  ┌──────────────────────────────────────┐  │
                        │  │ Aarav Sharma · STU-0007         ✕    │  │
                        │  └──────────────────────────────────────┘  │
                        │  Balance Due: ₹ 3,000  ·  Advance: ₹ 0    │
                        │                                            │
                        │  Amount                          ▤ Quick  │
                        │  ┌──────────────────┐   [Full ₹3,000]    │
                        │  │ ₹                │   [Half ₹1,500]    │
                        │  └──────────────────┘   [Custom]          │
                        │                                            │
                        │  Method                                    │
                        │  ( Cash )( UPI )( Card )( Bank )( Chq )( Other ) │
                        │                                            │
                        │  Reference (UTR / Cheque no.)              │
                        │  ┌──────────────────────────────────────┐  │
                        │  │                                      │  │
                        │  └──────────────────────────────────────┘  │
                        │                                            │
                        │  Date                                      │
                        │  ┌──────────────────┐   📅 14 Aug 2025     │
                        │  │ 14 Aug 2025      │   (today)            │
                        │  └──────────────────┘                      │
                        │  ⚠ Backdate > 3 days requires PIN          │
                        │                                            │
                        │  Linked invoice                            │
                        │  ┌──────────────────────────────────────┐  │
                        │  │ INV-000017  ·  ₹3,000  ·  Partial ◐  │  │
                        │  └──────────────────────────────────────┘  │
                        │                                            │
                        │  ☐ Mark as advance payment                 │
                        │     (Surplus beyond balance → advance wallet)│
                        │                                            │
                        │  ─────────────────────────────────────────  │
                        │  After this payment:                       │
                        │   Balance: ₹ 0  ·  Status: ✓ Paid          │
                        │   Receipt: RCP-000043  ·  Hash: ••••a3f9   │
                        │  ─────────────────────────────────────────  │
                        │                                            │
                        │   [ Cancel ]            [ Record & Print ] │
                        └──────────────────────────────────────────┘
```

**Sheet behaviour:**

- Slides up from bottom on mobile (spring 320/32), slides in from right on desktop as a 480px drawer.
- Backdrop: glass blur 24px, tap to dismiss.
- **Student field** — autocomplete over `students_fts`. If prefilled (from row action), read-only with a `✕` to clear and re-pick. Selecting a student fetches `['fees','student',id,'ledger']` and updates the live preview block at the bottom.
- **Quick-amount buttons** — `Full Due`, `Half`, `Custom`. `Full Due` fills the exact balance (BR-CALC-01). `Half` rounds to nearest rupee (BR-M-05). Tapping one animates the amount input count-up (200ms).
- **Method** — segmented control, 6 options. Default = `cash` (most common per persona research). `cheque` reveals a sub-field for cheque date + bank name.
- **Reference** — optional for cash, required for upi/bank/cheque (validated client-side; UTR pattern `^\w{10,22}$`, cheque `^\d{6}$`).
- **Date** — defaults to today. Backdating (>3 days before today) surfaces the amber warning and gates submit behind a fresh PIN per BR-LED-05.
- **Linked invoice** — autocomplete over the student's open invoices. If the student has exactly one open invoice, it's auto-selected. "Mark as advance" disables this field (advance payments don't link to an invoice).
- **Live preview block** — computes the post-payment state optimistically. Shows resulting balance, status, and *the receipt number that will be assigned*. This is the magic moment — the tutor sees the receipt number before they commit.
- **Submit button** — emerald, `Record & Print`. On tap: optimistic UI inserts the row, atomic DB transaction fires (see §9), success toast + receipt preview opens. On failure: rollback + flare toast.

### 6.5 Generate Invoice Sheet

```
                        ┌──────────────────────────────────────────┐
                        │  Generate Invoice                          │
                        │ ─────────────────────────────────────────  │
                        │  Student                                   │
                        │  [ Aarav Sharma · STU-0007            ▾ ]  │
                        │                                            │
                        │  From schedule item                        │
                        │  ◉ August Tuition — due 05 Aug — ₹3,000    │
                        │  ○ September Tuition — due 05 Sep — ₹3,000 │
                        │  ○ Ad-hoc (no schedule item)               │
                        │                                            │
                        │  Issue date      Due date                  │
                        │  [ 01 Aug 25 ]   [ 05 Aug 25 ]             │
                        │                                            │
                        │  Line items                                │
                        │  ┌──────────────────────────────────────┐  │
                        │  │ Description         Amount            │  │
                        │  │ August Tuition      ₹ 3,000           │  │
                        │  │ + Exam fee          ₹   200           │  │
                        │  │ − Sibling discount  −₹   150 (5%)     │  │
                        │  │ ──────────────────────────────────    │  │
                        │  │ Subtotal            ₹ 3,000           │  │
                        │  │ Discount            −₹   150           │  │
                        │  │ Extra charges       ₹   200           │  │
                        │  │ Total               ₹ 3,050           │  │
                        │  └──────────────────────────────────────┘  │
                        │  [ + Add line ]   [ + Add discount ]       │
                        │                                            │
                        │  Scholarship label (optional)              │
                        │  [ Sibling                              ]  │
                        │                                            │
                        │  ─────────────────────────────────────────  │
                        │  Invoice number: INV-000018                │
                        │  Tamper hash: ••••a3f9                     │
                        │  ─────────────────────────────────────────  │
                        │                                            │
                        │   [ Cancel ]      [ Preview ]  [ Generate ]│
                        └──────────────────────────────────────────┘
```

- **Schedule item picker** — defaults to the next pending `fee_schedule_items` row for this student. "Ad-hoc" allows generation without a schedule item (one-off charges like exam fee, materials).
- **Line items** — editable table. `+ Add line` adds an extra charge (BR-FEE-07). `+ Add discount` adds a discount line (BR-FEE-06) with type toggle (`fixed`/`percent`).
- **Preview** — opens `InvoiceDetail` read-only before commit.
- **Generate** — atomic transaction: increment `next_invoice_seq`, insert `invoices` row with `tamper_hash`, post `FEE_CHARGED` ledger entry (amount = total), post `DISCOUNT_GRANTED` if discount > 0, update `fee_schedule_items.status='invoiced'`, write `audit_log`, sync_outbox.
- **Tamper hash** — `sha256(number || student_id || total || issue_date || tenant_secret)` per BR-FEE-05. Computed locally; shown as last-8 chars in the sheet and on the invoice PDF.

### 6.6 Invoice Detail

```
┌──────────────────────────────────────────────────────────────────────┐
│  Invoice INV-000018                                          [ ✕ ]    │
│ ──────────────────────────────────────────────────────────────────── │
│                                                                       │
│  Bright Minds Tuition                                                 │
│  12, MG Road, Pune · +91 98xxx · priya@brightminds.in                 │
│                                                                       │
│  Invoice: INV-000018              Issue date: 01 Aug 2025             │
│  Student: Aarav Sharma (STU-0007) Due date:  05 Aug 2025              │
│  Class 10 — Maths — 6pm                                               │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Description              Amount     Discount    Extra    Total  │  │
│  │ ────────────────────────────────────────────────────────────── │  │
│  │ August Tuition           ₹ 3,000   −₹ 150      ₹ 0      ₹ 2,850│  │
│  │ Exam fee                 ₹   200   —           ₹ 0      ₹   200│  │
│  │ ────────────────────────────────────────────────────────────── │  │
│  │ Subtotal                  ₹ 3,200                              │  │
│  │ Discount (5% sibling)    −₹   150                              │  │
│  │ Extra charges             ₹   200                              │  │
│  │ TOTAL                     ₹ 3,050                              │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  Status: ◐ Partial     Payments: ₹1,500 (RCP-000042)                  │
│  Balance Due: ₹ 1,550                                                │
│                                                                       │
│  Tamper verification: ✓ verified  (••••a3f9)                          │
│                                                                       │
│  Ledger entries: FEE_CHARGED, DISCOUNT_GRANTED, PAYMENT_RECEIVED, VOID│
│  ──────────────────────────────────────────────────────────────────── │
│  [ 📤 Share signed URL ]   [ 📥 Download PDF ]   [ Void invoice (PIN) ]│
└──────────────────────────────────────────────────────────────────────┘
```

- Renders as a modal overlay, A4 proportions on desktop, full-screen sheet on mobile.
- "Tamper verification" recomputes the hash on render. Mismatch → red `✕ TAMPERED` badge + audit log write.
- "Ledger entries" — clickable chips that scroll the Ledger mode to the entry.
- "Void invoice (PIN)" — for `FEE_CHARGED` voids; gated by BR-LED-04 (cannot void if credited payments exist unless those are voided first).

### 6.7 Receipt Preview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Receipt RCP-000043                                        [ ✕ ]      │
│ ──────────────────────────────────────────────────────────────────── │
│                                                                       │
│  Bright Minds Tuition                                                 │
│  12, MG Road, Pune · +91 98xxx · priya@brightminds.in                 │
│                                                                       │
│  Receipt No: RCP-000043           Date: 14 Aug 2025                   │
│  Student:    Aarav Sharma         Code: STU-0007                      │
│  Invoice:    INV-000017           Class: 10 — Maths — 6pm             │
│                                                                       │
│  ─────────────────────────────────────────────────────────────────── │
│                                                                       │
│       Received with thanks: ₹ 1,500                                   │
│       (Rupees One Thousand Five Hundred Only)                         │
│                                                                       │
│  ─────────────────────────────────────────────────────────────────── │
│  Method:    Cash                                                      │
│  Reference: —                                                         │
│  Towards:   August Tuition (partial)                                  │
│  Balance:   ₹ 1,500                                                   │
│                                                                       │
│  ─────────────────────────────────────────────────────────────────── │
│  Generated by Buddysaradhi Omni-Core                                       │
│  Verify: ••••a3f9                                                     │
│                                                                       │
│  [ 📤 Share signed URL ]   [ 📥 Download PDF ]   [ Print ]            │
│  [ Void receipt (PIN) ]                                               │
└──────────────────────────────────────────────────────────────────────┘
```

- A5 portrait, 24px margins per `13_UI_Guidelines.md` §8.7 (Modal / Sheet) + §12.2 (Print Stylesheet Exception — receipts print flat black-on-white, no glass blur).
- Big amount in emerald 28pt mono.
- Amount in words via `en-IN` locale (Rupees … Only). Computed client-side; cached per receipt.
- Hash footer = last 8 chars of `tamper_hash`.
- Share → signed URL with HMAC, 7-day TTL (BR-RC-03). On web: copies link + toast. On mobile: system share sheet with PDF + URL. On desktop: file save dialog.
- Void receipt (PIN) — fresh PIN prompt per BR-SEC-02; posts VOID ledger entry, sets `receipts.voided_at`, reverts invoice status, audit-logs.

### 6.8 Reminder Trigger Popover

```
            ┌──────────────────────────────────────────┐
            │  Send reminder                            │
            │ ─────────────────────────────────────────  │
            │  To: Rajesh Sharma (+91 98xxx)             │
            │  Student: Aarav Sharma                     │
            │  Balance: ₹ 3,000 · Due 5 days ago         │
            │                                            │
            │  Channel                                   │
            │  (● In-app )( ○ WhatsApp )( ○ SMS )        │
            │                                            │
            │  Message                                   │
            │  ┌──────────────────────────────────────┐  │
            │  │ Dear Rajesh, Aarav's August tuition  │  │
            │  │ of ₹3,000 is overdue by 5 days.      │  │
            │  │ Receipt of last payment: RCP-000042. │  │
            │  │ Statement: <signed URL>              │  │
            │  │ — Bright Minds Tuition               │  │
            │  └──────────────────────────────────────┘  │
            │                                            │
            │   [ Cancel ]              [ Send ]         │
            └──────────────────────────────────────────┘
```

- **v1**: In-app only. The message body is drafted from the ledger (no typing required, P12). The signed URL points to a read-only statement PDF (last 3 months of ledger entries).
- **v1.x**: WhatsApp deep-link (`wa.me/?text=...`) and SMS via a Supabase Edge Function (Twillio). Both flagged as "setup required" until the tutor adds credentials in Settings.
- Sending creates a `notifications` row + a `reminders` row (status `acted`) so the reminder doesn't re-fire the same day.

### 6.9 Empty State

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│                       [ line-art wallet illustration ]               │
│                         120×120, cyan + emerald                      │
│                                                                      │
│                       No fees recorded yet                           │
│                       Add a fee plan to your first student.          │
│                                                                      │
│                      [ + Add Fee Plan ]   ← emerald primary           │
│                                                                      │
│                   or import from Excel →   ← secondary text link      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

Shown when `ledger_entries` count for this tenant = 0. The "Add Fee Plan" CTA opens the fee-plan wizard (a sheet that walks through model, cycle, amount, schedule). Import-Excel opens the import template flow (BR-BAT-04).

---

## 7. Component Tree

```
FeesPage
├── FeesHeader
│   ├── ModeSegmentedControl        // Overview | Ledger
│   ├── PeriodFilter                // month / range / all
│   └── BatchFilter                 // All | specific batch
│
├── (mode === 'overview') FeesOverview
│   ├── KpiStrip
│   │   ├── KpiCard[variant=collected]      // BR-CALC-03
│   │   ├── KpiCard[variant=dueTillDate]    // BR-CALC-04
│   │   ├── KpiCard[variant=dueThisMonth]   // BR-CALC-05
│   │   └── KpiCard[variant=counts]         // paid/unpaid/partial/noDues counts
│   │
│   ├── StatusMatrix
│   │   ├── StatusTab[id=unpaid]    // badge count
│   │   ├── StatusTab[id=partial]
│   │   ├── StatusTab[id=paid]
│   │   ├── StatusTab[id=noDues]
│   │   └── StudentBalanceRow[]     // virtualised via @tanstack/react-virtual
│   │       ├── StudentIdentityCell
│   │       ├── BalanceDueCell      // mono, tabular-nums, derived
│   │       ├── LastPaymentCell     // amount + date + receipt link
│   │       ├── FeeModelCell
│   │       ├── StatusChip
│   │       └── RowActions
│   │           ├── RecordPaymentButton      // → opens RecordPaymentSheet
│   │           ├── ViewLedgerButton         // → switch to ledger mode + select student
│   │           ├── GenerateInvoiceButton    // → opens GenerateInvoiceSheet
│   │           └── RemindButton             // → opens ReminderTrigger popover
│   │
│   └── MonthlySummaryPreview        // collapsible
│       ├── MiniSparkline            // 6 months
│       ├── TopPayersList
│       ├── TopDefaultersList
│       └── ExportButtons            // Excel / PDF
│
├── (mode === 'ledger') FeesLedger
│   ├── StudentPicker                // searchable dropdown, defaults to first selected
│   ├── StudentHeaderCard
│   │   ├── StudentIdentity
│   │   ├── DerivedBalances          // BalanceDue + AdvanceWallet + LastPayment + LastReceipt
│   │   └── LedgerActions
│   │       ├── RecordPaymentButton
│   │       ├── GenerateInvoiceButton
│   │       └── StatementButton      // → opens statement PDF preview
│   │
│   ├── LedgerTable
│   │   └── LedgerEntryRow[]
│   │       ├── DateCell
│   │       ├── TypeChip             // FEE_CHARGED | PAYMENT_RECEIVED | DISCOUNT_GRANTED | REFUND_ISSUED | ADJUSTMENT | WRITEOFF | VOID
│   │       ├── DescriptionCell
│   │       ├── InvoiceLink          // → InvoiceDetail
│   │       ├── ReceiptLink          // → ReceiptPreview
│   │       └── AmountCell           // signed, coloured by direction
│   │
│   └── InvoiceList
│       └── InvoiceRow[]             // → opens InvoiceDetail
│
├── RecordPaymentSheet               // modal, opened from many surfaces
│   ├── StudentAutocomplete
│   ├── AmountInput + QuickAmountButtons
│   ├── MethodSegmentedControl
│   ├── ReferenceInput               // conditional required
│   ├── DatePicker                   // gates backdate behind PIN
│   ├── InvoiceAutocomplete          // disabled when "advance" toggle on
│   ├── AdvanceToggle
│   ├── LivePreviewBlock             // resulting balance + receipt number
│   └── SubmitBar
│
├── GenerateInvoiceSheet
│   ├── StudentAutocomplete
│   ├── ScheduleItemPicker           // radio: pending schedule items | ad-hoc
│   ├── DateFields                   // issue + due
│   ├── LineItemsTable               // editable
│   │   ├── ChargeLine
│   │   ├── ExtraChargeLine          // BR-FEE-07
│   │   └── DiscountLine             // BR-FEE-06, fixed/percent
│   ├── ScholarshipLabelInput
│   └── SubmitBar
│
├── ReceiptPreview                   // modal
│   ├── ReceiptHeader                // institute info
│   ├── ReceiptBody                  // number, date, student, amount, method
│   ├── AmountInWords
│   ├── TamperHashFooter
│   └── ReceiptActions               // share, download, print, void
│
├── InvoiceDetail                    // modal
│   ├── InvoiceHeader
│   ├── LineItemsDisplay
│   ├── PaymentSummary               // paid so far + balance + linked receipts
│   ├── TamperVerificationBadge
│   ├── LinkedLedgerEntries          // clickable chips
│   └── InvoiceActions               // share, download, void
│
├── ReminderTrigger                  // popover
│   ├── RecipientInfo
│   ├── ChannelPicker                // in-app (default) | whatsapp (v1.x) | sms (v1.x)
│   ├── DraftMessageEditor           // pre-drafted, editable
│   └── SendButton
│
└── PinPrompt                        // global, invoked by sensitive actions
    ├── BiometricFallback
    └── PinPad
```

**Prop types (selected, illustrative):**

```ts
interface FeesPageProps {
  initialMode?: 'overview' | 'ledger';
  initialStudentId?: string;
  initialInvoiceId?: string;
  initialReceiptId?: string;
  initialPeriodFilter?: PeriodFilter;
}

interface StudentBalanceRowProps {
  student: StudentWithBalance;     // { id, code, first_name, last_name, batch_name, fee_model, balance_due, advance_balance, last_payment_amount, last_payment_date, last_receipt_number, status, latest_due_date }
  onRecordPayment: (studentId: string) => void;
  onViewLedger: (studentId: string) => void;
  onGenerateInvoice: (studentId: string) => void;
  onRemind: (studentId: string) => void;
  isSelected: boolean;
}

interface RecordPaymentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillStudentId?: string;
  prefillInvoiceId?: string;
  onSubmit: (payload: PaymentPayload) => Promise<ReceiptResult>;
}

interface PaymentPayload {
  studentId: string;
  amountMinor: number;             // integer, > 0
  method: 'cash' | 'upi' | 'card' | 'bank' | 'cheque' | 'other';
  reference?: string;
  occurredOn: string;              // ISO date
  invoiceId?: string;              // omitted when isAdvance
  isAdvance: boolean;
  description?: string;
  deviceId: string;
}

interface LedgerEntryRowProps {
  entry: LedgerEntry;              // full row from §3.10
  studentId: string;
  onOpenInvoice: (invoiceId: string) => void;
  onOpenReceipt: (receiptId: string) => void;
  onVoid: (entryId: string) => void;   // gated by PIN upstream
}

interface KpiCardProps {
  variant: 'collected' | 'dueTillDate' | 'dueThisMonth' | 'counts';
  value: number;                   // minor units OR count
  delta?: number;                  // % vs previous period
  sparkline?: number[];            // 6 data points
  loading?: boolean;
}
```

---

## 8. State Management

### 8.1 Zustand slice — `feesStore`

```ts
// src/stores/fees-store.ts
interface FeesState {
  // Mode
  mode: 'overview' | 'ledger';
  setMode: (m: 'overview' | 'ledger') => void;

  // Filters
  periodFilter: PeriodFilter;          // shared with shellStore; mirrored here for selectivity
  batchFilter: string | 'all';
  setBatchFilter: (b: string | 'all') => void;

  // Status matrix tab
  activeStatusTab: 'unpaid' | 'partial' | 'paid' | 'noDues';
  setStatusTab: (t: FeesState['activeStatusTab']) => void;

  // Selection (ledger mode)
  selectedStudentId: string | null;
  setSelectedStudent: (id: string | null) => void;

  // Sheet state
  recordPaymentSheet: { open: boolean; prefillStudentId?: string; prefillInvoiceId?: string };
  generateInvoiceSheet: { open: boolean; prefillStudentId?: string; prefillScheduleItemId?: string };
  receiptPreview: { open: boolean; receiptId?: string };
  invoiceDetail: { open: boolean; invoiceId?: string };
  reminderTrigger: { open: boolean; studentId?: string };

  openRecordPayment: (prefill?: { studentId?: string; invoiceId?: string }) => void;
  closeRecordPayment: () => void;
  openGenerateInvoice: (prefill?: { studentId?: string; scheduleItemId?: string }) => void;
  closeGenerateInvoice: () => void;
  openReceiptPreview: (receiptId: string) => void;
  closeReceiptPreview: () => void;
  openInvoiceDetail: (invoiceId: string) => void;
  closeInvoiceDetail: () => void;
  openReminderTrigger: (studentId: string) => void;
  closeReminderTrigger: () => void;

  // Optimistic payment recording
  optimisticEntries: Record<string, LedgerEntry>;     // keyed by temp client uuid
  addOptimisticEntry: (entry: LedgerEntry) => void;
  confirmOptimisticEntry: (tempId: string, finalEntry: LedgerEntry) => void;
  rollbackOptimisticEntry: (tempId: string) => void;
}
```

The slice is **screen-scoped** — it does not bleed into `studentsStore` or `dashboardStore`. The shell's `setActiveScreen('fees')` resets the slice to defaults (mode=overview, statusTab=unpaid, periodFilter=current month) unless a deep-link payload overrides.

### 8.2 TanStack Query keys

| Key | Fetcher | Invalidate on |
|-----|---------|---------------|
| `['fees','overview',periodFilter,batchFilter]` | `getOverviewKpis()` + `getStudentBalances()` (combined in one round-trip) | `LEDGER_MUTATED`, period/batch change, `REMINDER_DUE` (for counts) |
| `['fees','student',studentId,'ledger']` | `getStudentLedger(studentId)` ordered by `occurred_on DESC` | `LEDGER_MUTATED` for that student |
| `['fees','student',studentId,'invoices']` | `getStudentInvoices(studentId)` | `LEDGER_MUTATED` for that student, invoice generation, void |
| `['fees','student',studentId,'scheduleItems']` | `getPendingScheduleItems(studentId)` | schedule item status change, fee plan edit |
| `['fees','receipt',receiptId]` | `getReceipt(receiptId)` | receipt void |
| `['fees','invoice',invoiceId]` | `getInvoice(invoiceId)` | `LEDGER_MUTATED` for its student, invoice void |
| `['fees','monthlySummary',periodFilter]` | `getMonthlySummary()` (derived from ledger) | any `LEDGER_MUTATED` in the period |

Stale time: 60s for overview, `Infinity` for ledger (re-fetched only on mutation invalidation — balances don't drift). `gcTime`: 5 min. Background refetch on window focus is **disabled** for fees (P5 — local is truth; refetching on focus would cause a visible flash that violates "no silent re-computation").

### 8.3 Optimistic payment recording with rollback

The `useRecordPayment` mutation:

1. **Pre-flight** — validate payload (Zod schema in `packages/shared`), compute temp client UUID v7, derive the post-state (new balance, new status, predicted receipt number from `next_receipt_seq`).
2. **Optimistic insert** — append a temp `LedgerEntry` to `optimisticEntries` and to the visible `LedgerTable`/`StudentBalanceRow` via `queryClient.setQueryData`. The temp entry is flagged `__optimistic: true` and rendered with a subtle cyan pulse.
3. **Atomic DB transaction** (see §9.6) — `BEGIN` → audit_log → ledger_entries INSERT → receipts INSERT → invoices UPDATE → fee_schedule_items UPDATE → settings.next_receipt_seq UPDATE → `COMMIT`. All inside one libSQL transaction.
4. **On success** — `confirmOptimisticEntry(tempId, finalEntry)`. The temp entry is replaced by the real one (same `id` because UUID v7 is client-generated), pulse stops, success toast fires with the receipt number, `ReceiptPreview` opens.
5. **On failure** — `rollbackOptimisticEntry(tempId)`. The temp entry is removed from the cache, the row reverts, a flare toast shows "Payment not recorded — <reason>". The `sync_outbox` is untouched (nothing was written).
6. **Sync** — the `sync_outbox` row is queued. On flush, the entries are already UUID-keyed and idempotent (BR-SYN-02). If a sync conflict occurs (rare, only on race for `next_receipt_seq`), the server-side atomic counter guarantees no duplicate numbers; the loser re-tries with a fresh seq.

This pattern is reused for invoice generation, void, discount, refund — all are optimistic with rollback.

---

## 9. Database Operations

All queries use `@libsql/client` prepared statements with bound parameters. Every query includes `WHERE tenant_id = ?` as the first predicate (defence-in-depth per `10_Security.md` §7). The `tenant_id` is sourced from the Supabase session JWT claim, never from client input.

### 9.1 Per-student balance due (BR-CALC-01)

```ts
// Single aggregate over the student's ledger entries (uses idx_ledger_student).
const result = await db.ledgerEntry.aggregate({
  where: { tenantId, studentId, type: { not: 'VOID' }, reversesEntryId: null },
  _sum: {
    amount: true,
    // Prisma's aggregate doesn't do conditional sums, so we fetch the rows
    // and reduce in TS for the direction-aware math.
  },
});

// For direction-aware sum + advance wallet, use findMany + TS reduce:
const rows = await db.ledgerEntry.findMany({
  where: { tenantId, studentId, type: { not: 'VOID' }, reversesEntryId: null },
  select: { direction: true, amount: true, type: true, description: true },
});
const balance_due_minor = rows.reduce((acc, le) =>
  acc + (le.direction === 'charge' ? le.amount : -le.amount), 0);
const advance_balance_minor = rows.reduce((acc, le) => {
  if (le.direction === 'credit' && le.type === 'PAYMENT_RECEIVED' && le.description.includes('[ADVANCE]'))
    return acc + le.amount;
  if (le.direction === 'charge' && le.description.includes('[ADVANCE_APPLY]'))
    return acc - le.amount;
  return acc;
}, 0);
```

The double guard (`type <> 'VOID'` AND `reverses_entry_id IS NULL`) per BR-LED-02. The advance wallet is derived similarly — credits tagged `[ADVANCE]` minus charges tagged `[ADVANCE_APPLY]`.

### 9.2 Status classification (BR-CALC-02)

```ts
// Two parallel calls: per-student balance/counts + latest invoice per student.
const [balances, latestInvoices] = await Promise.all([
  // Per-student ledger aggregates (charge count, payment count, balance due)
  db.ledgerEntry.groupBy({
    by: ['studentId'],
    where: { tenantId, type: { not: 'VOID' }, reversesEntryId: null,
             student: { status: 'active', archivedAt: null } },
    _count: { _all: true },
    // The engine post-processes to split charge_count vs payment_count and to sum balances.
  }),
  // Per-student ledger rows for direction-aware math (uses idx_ledger_student)
  db.ledgerEntry.findMany({
    where: { tenantId, type: { not: 'VOID' }, reversesEntryId: null,
             student: { status: 'active', archivedAt: null } },
    select: { studentId: true, direction: true, amount: true, type: true },
  }),
  // Latest non-void invoice per student
  db.invoice.findMany({
    where: { tenantId, status: { not: 'void' } },
    orderBy: { createdAt: 'desc' },
    distinct: ['studentId'],
    select: { studentId: true, total: true },
  }),
]);

// TS joins the three result sets and computes the status per BR-CALC-02:
//   charge_count === 0         → 'no_dues'
//   balance_due <= 1           → 'paid'
//   balance_due < latest_total → 'partial'
//   else                       → 'unpaid'
```

This is the workhorse query of the Overview mode. It runs on the local Prisma client (latency < 8ms for 500 students). Result is cached in TanStack at `['fees','overview',periodFilter,batchFilter]`.

### 9.3 Monthly collected (BR-CALC-03)

```ts
const result = await db.ledgerEntry.aggregate({
  where: {
    tenantId,
    type: 'PAYMENT_RECEIVED',
    direction: 'credit',
    reversesEntryId: null,
    occurredOn: { gte: monthStart, lt: monthEnd },
  },
  _sum: { amount: true },
});
const collected_minor = result._sum.amount ?? 0;
```

### 9.4 Total due till date (BR-CALC-04)

```ts
// Per-student balances (uses trigger-maintained balance_after_paise cache — O(1) per student)
const balances = await db.ledgerEntry.findMany({
  where: { tenantId, type: { not: 'VOID' }, reversesEntryId: null,
           student: { status: 'active', archivedAt: null } },
  orderBy: { createdAt: 'desc' },
  distinct: ['studentId'],
  select: { studentId: true, balanceAfterPaise: true, direction: true, amount: true },
});
const dues = balances.filter(b => b.balanceAfterPaise > 0);
const total_due_minor = dues.reduce((a, b) => a + b.balanceAfterPaise, 0);
const students_with_due = dues.length;
```

### 9.5 Due this month (BR-CALC-05)

```ts
const result = await db.invoice.aggregate({
  where: {
    tenantId,
    issueDate: { gte: monthStart, lt: monthEnd },
    status: { in: ['unpaid', 'partial', 'overdue'] },
    voidedAt: null,
  },
  _sum: { total: true },
  _count: { _all: true },
});
const due_this_month_minor = result._sum.total ?? 0;
const invoice_count = result._count._all;
```

### 9.6 Atomic payment recording (transaction boundary)

```ts
await db.$transaction(async (tx) => {
  // 1. Audit log FIRST (fail-closed per BR-SEC-03). If this fails, the whole txn aborts.
  await tx.auditLog.create({ data: {
    id: uuidv7(), tenantId, actor: 'tutor', action: 'payment_record',
    refType: 'student', refId: studentId, metadata: paymentPayload, createdAt: nowIso,
  } });

  // 2. Insert the ledger entry (append-only; trigger enforces immutability).
  const ledgerEntry = await tx.ledgerEntry.create({ data: {
    id: ledgerEntryId, tenantId, studentId, invoiceId,
    type: 'PAYMENT_RECEIVED', amount, direction: 'credit',
    paymentMethod, paymentRef, receiptId: null, reversesEntryId: null,
    description, occurredOn, createdAt: nowIso, source: 'manual',
    deviceId, createdBy: actor, updatedAt: nowIso,
  } });

  // 3. Insert the receipt (number from local seq; atomicity via row-level lock on settings).
  const receipt = await tx.receipt.create({ data: {
    id: receiptId, tenantId, number: receiptNumber, ledgerEntryId: ledgerEntry.id,
    studentId, invoiceId, amount, paymentMethod, paymentRef, receivedOn,
    tamperHash, voidedAt: null, pdfPath: null, createdAt: nowIso, updatedAt: nowIso,
  } });

  // 4. Back-link the ledger entry to the receipt (one-shot update; the immutability
  //    middleware allows this only inside the same TX as the INSERT, via a session
  //    flag `app_in_txn` set by the app layer).
  await tx.ledgerEntry.update({
    where: { id: ledgerEntry.id, tenantId },
    data: { receiptId: receipt.id, updatedAt: nowIso },
  });

  // 5. Update the linked invoice status (if any). Recompute its balance from the ledger.
  if (invoiceId) {
    const paid = await tx.ledgerEntry.aggregate({
      where: { invoiceId, tenantId, type: { not: 'VOID' }, reversesEntryId: null, direction: 'credit' },
      _sum: { amount: true },
    });
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId, tenantId } });
    const newStatus = (paid._sum.amount ?? 0) >= inv.total ? 'paid'
                    : (paid._sum.amount ?? 0) > 0 ? 'partial' : 'unpaid';
    await tx.invoice.update({ where: { id: invoiceId, tenantId }, data: { status: newStatus, updatedAt: nowIso } });
  }

  // 6. Update the linked fee_schedule_item status.
  if (invoiceId) {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId, tenantId } });
    if (inv.feeScheduleItemId) {
      const itemInvoices = await tx.invoice.findMany({
        where: { feeScheduleItemId: inv.feeScheduleItemId, tenantId },
        select: { status: true },
      });
      const newStatus = itemInvoices.some(i => i.status === 'paid') ? 'paid'
                      : itemInvoices.some(i => i.status === 'partial' || i.status === 'unpaid') ? 'partial'
                      : undefined;
      if (newStatus) {
        await tx.feeScheduleItem.update({ where: { id: inv.feeScheduleItemId }, data: { status: newStatus, updatedAt: nowIso } });
      }
    }
  }

  // 7. Atomically increment the receipt sequence (gap-tolerant; the voided receipt's number is never reused).
  await tx.settings.update({
    where: { tenantId },
    data: { nextReceiptSeq: { increment: 1 }, updatedAt: nowIso },
  });

  // 8. Queue sync_outbox rows (ledger_entry, receipt, invoice update, settings update).
  await tx.syncOutbox.createMany({ data: [
    { id: uuidv7(), tenantId, tableName: 'ledger_entries', rowId: ledgerEntry.id, op: 'insert', payload: ledgerEntry, status: 'pending', attempts: 0, createdAt: nowIso },
    { id: uuidv7(), tenantId, tableName: 'receipts',       rowId: receipt.id,      op: 'insert', payload: receipt,      status: 'pending', attempts: 0, createdAt: nowIso },
    ...(invoiceId ? [{ id: uuidv7(), tenantId, tableName: 'invoices', rowId: invoiceId, op: 'update', payload: { status: newStatus }, status: 'pending', attempts: 0, createdAt: nowIso }] : []),
    { id: uuidv7(), tenantId, tableName: 'settings', rowId: tenantId, op: 'update', payload: { nextReceiptSeq: { increment: 1 } }, status: 'pending', attempts: 0, createdAt: nowIso },
  ] });
});
```

**Transaction guarantees:**

- All 8 steps succeed or none do (Prisma's `db.$transaction` is atomic). A failure at step 5 (invoice status recompute) rolls back the ledger entry and receipt, leaving the DB exactly as before.
- The audit log is written **first**, not last. If audit write fails (e.g., trigger guard), the entire txn aborts — fail-closed per `10_Security.md` §4.
- The `next_receipt_seq` increment is the last write before commit, ensuring the sequence is only consumed if everything else succeeded. Gaps are still possible (a voided receipt consumed a seq), and that's by design — gaps are the audit trail.
- The `ledger_entries` immutability trigger (§10 of `11_Data_Model.md`) is bypassed only for the `receipt_id` back-link in step 4, controlled by a session-scoped flag `app_in_txn` set by the app layer. Outside this txn, any `db.ledgerEntry.update()` call always aborts — Prisma middleware in `packages/core/src/ledgerGuard.ts` rejects it before it reaches the DB.

### 9.7 Atomic invoice number sequence increment

```ts
// Atomic increment inside db.$transaction — holds a row lock on the settings row.
const updated = await tx.settings.update({
  where: { tenantId },
  data: { nextInvoiceSeq: { increment: 1 }, updatedAt: nowIso },
  select: { nextInvoiceSeq: true, invoicePrefix: true },
});
const seq = updated.nextInvoiceSeq - 1;
const invoice_number = `${updated.invoicePrefix}${String(seq).padStart(6, '0')}`;  // zero-pad to 6 digits
```

`String(seq).padStart(6, '0')` zero-pads to 6 digits per BR-FEE-04. The full number is `settings.invoice_prefix + zero-pad(seq, 6)`. The same pattern applies to `next_receipt_seq`.

### 9.8 Insert ledger entry (append-only, with trigger note)

```ts
const entry = await db.ledgerEntry.create({ data: {
  id: uuidv7(), tenantId, studentId, invoiceId,
  type, amount, direction,
  paymentMethod, paymentRef, receiptId, reversesEntryId,
  description, occurredOn, createdAt: nowIso, source: 'manual',
  deviceId, createdBy: actor, updatedAt: nowIso,
} });
```

The `trg_ledger_no_update` and `trg_ledger_no_delete` triggers (`11_Data_Model.md` §10) guarantee immutability post-insert. Prisma middleware (`packages/core/src/ledgerGuard.ts`) is the first line of defence — it rejects any `db.ledgerEntry.update()` / `db.ledgerEntry.delete()` call before the SQL reaches the DB. The `id` is a client-generated UUID v7 (time-sortable, conflict-free across offline devices per BR-SYN-02). The `reversesEntryId` is set only for `VOID` entries (BR-LED-02).

### 9.9 Insert receipt

```ts
const receipt = await db.receipt.create({ data: {
  id: uuidv7(), tenantId, number, ledgerEntryId, studentId, invoiceId,
  amount, paymentMethod, paymentRef, receivedOn,
  tamperHash, voidedAt: null, pdfPath: null, createdAt: nowIso, updatedAt: nowIso,
} });
```

The `tamperHash` is computed in the application layer (sha256 over `number || student_id || amount || received_on || tenant_secret` per BR-FEE-05) and passed as a field on the create payload — never computed in SQL (would require the secret in the DB layer).

### 9.10 Void receipt transaction

```ts
await db.$transaction(async (tx) => {
  // 1. Audit
  await tx.auditLog.create({ data: {
    id: uuidv7(), tenantId, actor: 'tutor', action: 'payment_void',
    refType: 'receipt', refId: receiptId, metadata: { reason }, createdAt: nowIso,
  } });

  // 2. VOID ledger entry mirroring the original (BR-LED-03)
  const original = await tx.ledgerEntry.findUniqueOrThrow({
    where: { id: originalEntryId, tenantId },
  });
  await tx.ledgerEntry.create({ data: {
    id: uuidv7(), tenantId, studentId: original.studentId, invoiceId: original.invoiceId,
    type: 'VOID', amount: original.amount,                    // same magnitude
    direction: original.direction === 'charge' ? 'credit' : 'charge',  // opposite direction
    paymentMethod: original.paymentMethod, paymentRef: original.paymentRef,
    receiptId: null, reversesEntryId: original.id,            // reverses_entry_id = original
    description: `VOID: ${reason}`, occurredOn: todayLocal(),
    createdAt: nowIso, source: 'manual', deviceId, createdBy: actor, updatedAt: nowIso,
  } });

  // 3. Mark receipt voided
  await tx.receipt.update({
    where: { id: receiptId, tenantId },
    data: { voidedAt: nowIso, updatedAt: nowIso },
  });

  // 4. Revert invoice status (same recompute as §9.6 step 5)
  const receipt = await tx.receipt.findUniqueOrThrow({ where: { id: receiptId, tenantId } });
  if (receipt.invoiceId) {
    const paid = await tx.ledgerEntry.aggregate({
      where: { invoiceId: receipt.invoiceId, tenantId, type: { not: 'VOID' }, reversesEntryId: null, direction: 'credit' },
      _sum: { amount: true },
    });
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: receipt.invoiceId, tenantId } });
    const newStatus = (paid._sum.amount ?? 0) >= inv.total ? 'paid'
                    : (paid._sum.amount ?? 0) > 0 ? 'partial' : 'unpaid';
    await tx.invoice.update({ where: { id: receipt.invoiceId, tenantId }, data: { status: newStatus, updatedAt: nowIso } });
  }

  // 5. Queue sync
  await tx.syncOutbox.createMany({ data: [
    { id: uuidv7(), tenantId, tableName: 'ledger_entries', rowId: voidEntryId, op: 'insert', payload: { voidOfId: original.id }, status: 'pending', attempts: 0, createdAt: nowIso },
    { id: uuidv7(), tenantId, tableName: 'receipts', rowId: receiptId, op: 'update', payload: { voidedAt: nowIso }, status: 'pending', attempts: 0, createdAt: nowIso },
  ] });
});
```

### 9.11 Advance payment split

When a `PaymentPayload` arrives with `amount > balance_due` and `isAdvance = true`:

```ts
// Application layer computes:
//   exact_credit   = balance_due         (BR-M-04: cannot exceed outstanding normally)
//   advance_credit = amount - balance_due
// Then inserts TWO ledger entries inside the same db.$transaction as §9.6:

await tx.ledgerEntry.create({ data: {
  ..., type: 'PAYMENT_RECEIVED', amount: exact_credit, direction: 'credit',
  description: normalDescription, ...,
} });

await tx.ledgerEntry.create({ data: {
  ..., type: 'PAYMENT_RECEIVED', amount: advance_credit, direction: 'credit',
  description: `[ADVANCE] ${normalDescription}`,   // tagged
  ...,
} });

// A single receipt is generated covering the full amount; the receipt's
// amount = exact_credit + advance_credit, with a line-item breakdown in the PDF.
```

Per BR-LED-06, the `[ADVANCE]` tag in description is the marker. Auto-apply on next `FEE_CHARGED`:

```ts
// On next FEE_CHARGED for this student, the app layer checks advance_balance_minor.
// If > 0, it inserts an additional ADJUSTMENT entry:
await tx.ledgerEntry.create({ data: {
  ..., type: 'ADJUSTMENT', amount: advance_to_apply, direction: 'credit',
  description: `[ADVANCE_APPLY] auto-applied to invoice ${invoiceNumber}`,
  ...,
} });
// This zeroes the advance wallet and reduces the new invoice's balance.
```

---

## 10. Business Rules

This screen is the primary enforcer of the fee, ledger, receipt, reminder, and calculation rules. Every rule below is cited from `12_Business_Rules.md` and walked through with its UI surface.

### 10.1 Money rules (BR-M-01..M05)

- **BR-M-01 — Integer minor units.** Every amount field in the UI is a *display string* over an integer minor-unit value. The `AmountInput` component parses user input (`"₹ 1,500"` or `"1500"`) → `150000` minor units (INR paise). The display layer formats via `Intl.NumberFormat(locale, { style: 'currency', currency })`. No floating-point arithmetic anywhere in the mutation path.
- **BR-M-02 — One currency per tenant.** The currency is shown in every amount label. After the first ledger entry, the currency becomes immutable; the Settings screen hides the currency selector and shows a tooltip "Locked after first payment (BR-M-02)".
- **BR-M-03 — No negative charges.** The `AmountCell` in the ledger table never renders a negative number for `direction='charge'` rows. `REFUND_ISSUED` is a charge-direction row but represents money returned to the tutor; its description clarifies "Refund issued to student".
- **BR-M-04 — Credits cannot exceed outstanding (soft guard).** The `RecordPaymentSheet` computes `excess = amount - balance_due` live. If `excess > 0` and `isAdvance = false`, the submit button is disabled with helper text "Amount exceeds balance due by ₹X. Enable 'Mark as advance' to record the surplus as an advance payment." Toggling advance re-enables submit.
- **BR-M-05 — Rounding tolerance.** Status classification uses `balance_due <= 1` (one minor unit) as the "paid in full" threshold. This absorbs percent-discount rounding (e.g., 5% of ₹3,000 = ₹150 exactly; but 7% of ₹3,000 = ₹210, while 7% of ₹2,999 = ₹209.93 → rounded to ₹210 minor-unit = 21000, exact).

### 10.2 Ledger grammar (BR-LED-01..L06)

- **BR-LED-01 — Entry types & direction.** The `LedgerTable` renders all 7 entry types with distinct icons and colours: `FEE_CHARGED` (cyan, `FilePlus`), `PAYMENT_RECEIVED` (emerald, `ArrowDownToLine`), `DISCOUNT_GRANTED` (violet, `Percent`), `REFUND_ISSUED` (flare, `ArrowUpFromLine`), `ADJUSTMENT` (cyan, `SlidersHorizontal`), `WRITEOFF` (muted violet, `Eraser`), `VOID` (flare with strike, `Ban`).
- **BR-LED-02 — Append-only, idempotent.** No row in `LedgerTable` has an "edit" affordance. The row context menu offers "Void" (which posts a reversing entry) and "Copy receipt link" — nothing else. The immutability is reinforced by the UI: every row has a small lock icon on hover with tooltip "Immutable. To correct, post a reversing entry."
- **BR-LED-03 — Voiding a payment.** Walk-through: tutor opens `ReceiptPreview` → taps "Void receipt (PIN)" → `PinPrompt` → enters PIN → confirm dialog with reason input → on confirm, the §9.10 transaction fires → the VOID row appears in the ledger with flare styling, the original `PAYMENT_RECEIVED` row gets a strike-through and a "↺ voided by VOID entry xxx" link → the linked invoice reverts to `unpaid` or `partial` → the receipt's PDF is re-rendered with a "VOID" watermark → audit log entry written.
- **BR-LED-04 — Voiding a fee charge.** The `InvoiceDetail` "Void invoice" action is gated: if any `PAYMENT_RECEIVED` credits the invoice, the action is disabled with helper text "Cannot void an invoice with credited payments. Void those receipts first." The helper lists the receipts to void.
- **BR-LED-05 — Re-opening a locked period.** The `DatePicker` in `RecordPaymentSheet` checks `occurred_on` against the most recent locked `attendance_sessions.session_date`. If earlier, the amber warning shows and submit requires a fresh PIN (within 30s). The audit log entry is `action='backdated_ledger'` with metadata `{ occurred_on, locked_session_date, reason }`.
- **BR-LED-06 — Advance payments.** Walk-through: tutor records ₹5,000 against a ₹3,000 balance, toggles "Mark as advance" → live preview shows "₹3,000 → invoice, ₹2,000 → advance wallet" → on submit, two `PAYMENT_RECEIVED` rows are inserted (exact + `[ADVANCE]`-tagged) inside one transaction → the receipt PDF itemises both → the student header card in Ledger mode now shows "Advance Wallet: ₹ 2,000" in violet → on the next `FEE_CHARGED`, an `ADJUSTMENT` entry auto-applies the advance (BR-LED-06 auto-apply).

### 10.3 Fee model rules (BR-FEE-01..F08)

- **BR-FEE-01 — Three models.** The `FeeModelCell` in the matrix shows `Postpaid` (default), `Prepaid`, or `Mixed`. The `StudentHeaderCard` in Ledger mode shows the model with a tooltip explaining the cycle direction. The model determines when schedule items become due and how the prepaid soft-block interacts with attendance.
- **BR-FEE-02 — Default model.** New students inherit `settings.default_fee_model` (default `postpaid`). The student creation flow in the Students screen exposes the model selector; this screen only reads it.
- **BR-FEE-03 — Schedule generation.** The `GenerateInvoiceSheet` "From schedule item" picker lists pending `fee_schedule_items`. Schedule items are generated by the fee-plan wizard (a sheet, not a screen) when the tutor creates a `fee_plan`. Editing a plan diff-generates new items and `void`s removed ones (no deletes).
- **BR-FEE-04 — Invoice generation.** Invoices are generated on demand (manual trigger from this screen or from a schedule item's row in the Students screen) or auto (default off, configurable per plan). The `next_invoice_seq` is incremented atomically per §9.7. Numbers are gap-tolerant: a voided invoice's number is never reused.
- **BR-FEE-05 — Invoice tamper hash.** Computed in the app layer (sha256 of `number || student_id || total || issue_date || tenant_secret`) and stored on `invoices.tamper_hash`. The `InvoiceDetail` "Tamper verification" badge recomputes on render; mismatch → red `✕ TAMPERED` badge + audit log `receipt_tamper_detected`.
- **BR-FEE-06 — Discounts.** The `GenerateInvoiceSheet` "Add discount" line supports `fixed` (minor units) or `percent` (basis points; 1000 = 10%). On generate, alongside the `FEE_CHARGED` entry, a `DISCOUNT_GRANTED` credit entry is posted for the discount amount — keeping the ledger transparent about *why* the balance is lower.
- **BR-FEE-07 — Extra charges.** The `GenerateInvoiceSheet` "Add line" adds extra charges (exam fee, materials). These roll into `invoices.extra_charges` and are included in the single `FEE_CHARGED` entry's `amount` (= `invoices.total`). No separate ledger entry per extra charge — one charge row per invoice, by design.
- **BR-FEE-08 — Prepaid soft block.** Prepaid unpaid students show an amber "Fee pending" chip on the Attendance grid (visible there, surfaced here in the `FeeModelCell` tooltip). The tutor *can* still mark them present — we never block education — but the chip persists and the Reminder Engine escalates.

### 10.4 Receipt rules (BR-RC-01..RC03)

- **BR-RC-01 — Numbering.** `receipts.number = settings.receipt_prefix + zero-pad(next_receipt_seq, 6)`. Monotonic, gap-tolerant, never decremented. The `RecordPaymentSheet` live preview shows the *predicted* receipt number (read from `settings.next_receipt_seq`); on commit, the actual number is assigned via §9.6 step 7. If two devices race, the server-side atomic increment resolves to one winner; the loser re-tries with the next seq (rare; only on near-simultaneous offline-then-sync).
- **BR-RC-02 — PDF generation.** On receipt create, a PDF is rendered. Web: server-side via a Supabase Edge Function (using `@react-pdf/renderer`); mobile/desktop: locally via the same library (no network needed). The PDF matches the on-screen `ReceiptPreview` exactly — A5 portrait, 24px margins, header with institute info, big emerald amount, table of charges, tamper hash footer "Verify: ••••a3f9", footer "Generated by Buddysaradhi Omni-Core".
- **BR-RC-03 — Share.** The receipt is shareable via signed URL (web, 7-day TTL via HMAC-SHA256 with the tenant_secret as key), system share sheet (mobile, includes the PDF file), file save (desktop). v1 has no parent auth — the signed URL is the trust boundary per Principle 14.

### 10.5 Reminder rules (BR-RPT-01..R05)

- **BR-RPT-01 — Due fee reminder.** When a `fee_schedule_items.status` flips to `overdue` (due_date < today AND no linked `PAYMENT_RECEIVED`), the Reminder Engine creates a `reminders` row with `category='due_fee'`. The Fees Overview `KpiCard[variant=counts]` reflects the count in the "Unpaid" segment; the bell badge in the topbar increments.
- **BR-RPT-02 — Upcoming due.** 3 days before `due_date` for `pending`/`invoiced` items, an `upcoming_due` reminder is created. The `StudentBalanceRow`'s "next due" date is highlighted amber when within 3 days.
- **BR-RPT-03..R04.** Missing attendance and inactive student reminders are owned by the Attendance screen; surfaced here only in the bell badge.
- **BR-RPT-05 — Snooze.** The `ReminderTrigger` popover offers snooze: "Today EOD", "3 days", "Dismiss". Snoozed reminders re-fire at `snooze_until`; dismissed reminders are permanent per-reminder.

### 10.6 Calculation reference (BR-CALC-01..08)

- **BR-CALC-01 — Student balance due.** Implemented in §9.1. The double-guard (`type <> 'VOID' AND reverses_entry_id IS NULL`) is critical — a VOID entry's effect is excluded twice, ensuring no accidental double-counting if one guard is bypassed.
- **BR-CALC-02 — Student payment status.** Implemented in §9.2. The "no dues" status (charge_count = 0) is what populates the "No dues" matrix tab. A new student with no fee plan yet appears here.
- **BR-CALC-03 — Monthly collected.** Implemented in §9.3. Drives `KpiCard[variant=collected]` with month-over-month delta and 6-month sparkline.
- **BR-CALC-04 — Total due till date.** Implemented in §9.4. Drives `KpiCard[variant=dueTillDate]`.
- **BR-CALC-05 — Due this month.** Implemented in §9.5. Drives `KpiCard[variant=dueThisMonth]`.
- **BR-CALC-06..08.** Attendance calculations; out of scope for this screen but surfaced in cross-links (a student's row links to their attendance %).

### 10.7 Payment scenario walk-throughs

Every scenario below is a literal step-by-step a tutor can perform on this screen. Each is tested in §19.

#### 10.7.1 Full payment of an invoice

1. Overview mode → Unpaid tab → tap Aarav's row → `[ + Record ]`.
2. `RecordPaymentSheet` opens with Aarav prefilled, `INV-000017` auto-linked, balance ₹3,000 shown.
3. Tap `[Full ₹3,000]` quick button → amount input fills ₹3,000.
4. Method defaults to `Cash`; tutor taps `UPI` (because Aarav's father just GPay'd).
5. Reference: tutor types the UTR `AXISBK123456789`.
6. Date defaults to today.
7. Live preview: "After: Balance ₹0 · Status ✓ Paid · Receipt RCP-000043 · Hash ••••a3f9".
8. Tap `[ Record & Print ]` → atomic txn (§9.6) fires → success toast "Payment recorded · RCP-000043" → `ReceiptPreview` opens.
9. Tutor taps `[ 📤 Share signed URL ]` → URL copied + toast "Signed URL copied (expires in 7 days)".
10. Back to Overview → Aarav's row has moved from Unpaid to Paid tab; the count `✓ Paid · 84` became `✓ Paid · 85`; the KPI "Collected This Month" count-up animates from ₹1,21,500 → ₹1,24,500.

#### 10.7.2 Partial payment

1. Same flow as above but tutor taps `[Half ₹1,500]` instead of Full.
2. Live preview: "After: Balance ₹1,500 · Status ◐ Partial · Receipt RCP-000043".
3. Submit → `invoices.status` updates to `partial`; `fee_schedule_items.status` updates to `partial`; the row stays in the Unpaid tab AND appears in the Partial tab (cross-listed by the `payment_count > 0 AND balance_due > 0` predicate).
4. The `LastPaymentCell` updates to "₹1,500 · 14 Aug · RCP-000043".

#### 10.7.3 Advance payment

1. Aarav's father pays ₹5,000 against a ₹3,000 balance (next month in advance).
2. Tutor types `5000` in amount → excess ₹2,000 detected → submit disabled with helper "Amount exceeds balance by ₹2,000. Enable 'Mark as advance' to record surplus."
3. Tutor toggles `☐ Mark as advance payment` → submit re-enabled.
4. Live preview: "₹3,000 → invoice · ₹2,000 → advance wallet · Receipt RCP-000044".
5. Submit → two `PAYMENT_RECEIVED` rows inserted (exact ₹3,000 + `[ADVANCE]` ₹2,000) in one txn → receipt PDF itemises both.
6. Ledger mode for Aarav now shows "Advance Wallet: ₹ 2,000" in violet.
7. Next month's `FEE_CHARGED` for Aarav auto-applies the advance: an `ADJUSTMENT` credit entry is inserted (`[ADVANCE_APPLY]`), the advance wallet drops to ₹0, and the new invoice's balance starts at ₹1,000 (₹3,000 − ₹2,000 advance-applied).

#### 10.7.4 Overpayment (treated as advance)

Same as 10.7.3 — there is no separate "overpayment" concept. Any payment exceeding outstanding is an advance (BR-M-04).

#### 10.7.5 Refund

1. Aarav's father accidentally paid ₹3,000 twice (once via cash, once via UPI). Tutor needs to refund the UPI one.
2. Ledger mode → Aarav → find the UPI `PAYMENT_RECEIVED` row → row context menu → "Issue refund".
3. `RefundSheet` opens: prefilled with the original entry, amount editable (defaults to full), method (defaults to `bank`), reference required.
4. On submit: a `REFUND_ISSUED` ledger entry is inserted with `direction='charge'` and `amount = refund_amount`. This *increases* the student's balance_due (money left the tutor's hands, returned to the student).
5. If the refund zeroes out a previously-paid invoice, the invoice reverts to `unpaid` or `partial` based on remaining credits.
6. The receipt for the original payment is **not** voided (the payment did happen; the refund is a separate event). A separate "Refund receipt" can be generated if the tutor wants documentation for the refund itself (optional; the ledger entry alone is the audit trail).

#### 10.7.6 Void receipt

1. Tutor issued a receipt to the wrong student (Aarav instead of Ananya).
2. ReceiptPreview for the wrong receipt → `[ Void receipt (PIN) ]` → `PinPrompt` → fresh PIN entered.
3. Confirm dialog with reason input: tutor types "Wrong student — should be Ananya STU-0011" → confirm.
4. §9.10 transaction fires: audit log → VOID ledger entry (mirrors original, opposite direction, `reverses_entry_id` set) → receipt `voided_at` set → linked invoice reverts to `unpaid`.
5. The receipt PDF is re-rendered with a "VOID" watermark; the on-screen `ReceiptPreview` shows a flare `VOIDED` banner.
6. The original `PAYMENT_RECEIVED` row in Ledger mode now has a strike-through and a "↺ voided by VOID entry xxx" link.
7. Tutor now records the payment correctly against Ananya.

#### 10.7.7 Discount at invoice time

1. Tutor generates Aarav's August invoice → opens `GenerateInvoiceSheet`.
2. Schedule item "August Tuition — ₹3,000" auto-selected.
3. Tutor taps `[ + Add discount ]` → type `percent`, value `500` (5% in basis points) → label "Sibling discount".
4. Line items table updates: subtotal ₹3,000, discount −₹150, total ₹2,850.
5. On generate: `invoices` row inserted with `discount=15000` minor units; `FEE_CHARGED` entry inserted with `amount=285000` (= total); `DISCOUNT_GRANTED` credit entry inserted with `amount=15000` and `description='Sibling discount 5%'`.
6. Ledger mode for Aarav now shows two entries for this invoice: the charge and the discount, both linked to `INV-000018`.

#### 10.7.8 Scholarship

1. Aarav has a merit scholarship covering 50% of fees. The tutor sets this on the fee plan (Students screen → fee plan wizard → scholarship label "Merit 50%" + discount percent 5000 basis points).
2. `fee_plans.scholarship = 'Merit 50%'` and `discount_type='percent'`, `discount_value=5000`.
3. When the next `fee_schedule_item` is invoiced, the `GenerateInvoiceSheet` auto-pre-fills the discount from the plan. The line items table shows "Scholarship: Merit 50% — −₹1,500".
4. The scholarship label appears in the `StudentHeaderCard` in Ledger mode as a violet chip "Scholarship: Merit 50%".

#### 10.7.9 Extra charges

1. Exam fee of ₹200 needs to be added to Aarav's August invoice.
2. `GenerateInvoiceSheet` → `[ + Add line ]` → description "Exam fee", amount ₹200, type "Extra charge".
3. Line items: subtotal ₹3,000, discount −₹150, extra ₹200, total ₹3,050.
4. On generate: `invoices.extra_charges=20000`; `FEE_CHARGED` entry `amount=305000` (the total). No separate ledger entry for the extra charge (BR-FEE-07).

#### 10.7.10 Custom billing cycle

1. Aarav's father wants to pay every 2 months instead of monthly.
2. Tutor edits Aarav's fee plan (Students screen) → cycle `custom` → custom due dates: 5 Jan, 5 Mar, 5 May, 5 Jul, 5 Sep, 5 Nov.
3. `fee_plans.cycle = 'custom'`; `fee_schedule_items` rows generated with the custom `due_date`s, each labelled "Jan–Feb 2025 Tuition", etc.
4. The `GenerateInvoiceSheet` schedule-item picker lists these custom-labelled items; the matrix "next due" column reflects the custom cadence.

#### 10.7.11 Installments

1. A quarterly-fee student (₹9,000/quarter) wants to pay in 3 installments of ₹3,000 each.
2. Tutor edits the fee plan → cycle `quarterly` → "split into installments: 3" → generates 3 `fee_schedule_items` per quarter, each ₹3,000, with due dates spaced 1 month apart.
3. Each installment is invoiced and paid separately; the matrix shows 3 rows for this student per quarter (or 1 row with 3 pending items, depending on the view density toggle).

---

## 11. Edge Cases

| # | Edge case | Behaviour |
|---|-----------|-----------|
| EC-01 | Student archived mid-cycle | All `FEE_CHARGED` rows remain collectable; no new charges can be posted. The matrix shows archived students in a separate "Archived" filter (off by default). Their balance_due is still included in `KpiCard[dueTillDate]` unless filtered. |
| EC-02 | Currency cannot change after first ledger entry (BR-M-02) | Settings screen hides the selector; this screen shows the currency in every amount label and surfaces a one-time toast on first visit post-lock: "Currency locked to ₹ (INR) after first payment." |
| EC-03 | Backdated payment before any ledger entry for that student | Allowed (no locked session to gate on). The `occurred_on` becomes the student's first ledger date. Audit log notes `backdated_ledger` only if past a locked attendance session. |
| EC-04 | Two devices record a payment for the same student offline | Both inserts land on sync; UUID v7 prevents collision. The balances re-derive correctly (sum of both credits). If both linked the same invoice, the invoice status re-computes to `paid` if combined credits ≥ total, else `partial`. |
| EC-05 | Two devices race for the same receipt number | Server-side atomic `next_receipt_seq` increment guarantees one winner. The loser's txn fails at step 7 (§9.6) with a seq-conflict error; the app re-tries with the new seq. The tutor sees a 1s delay, no error. |
| EC-06 | Payment recorded with no linked invoice (unlinked payment) | Allowed. The `PAYMENT_RECEIVED` entry has `invoice_id = NULL`. It reduces the student's overall balance but doesn't update any invoice status. The receipt shows "Towards: General payment" instead of an invoice number. |
| EC-07 | Refund larger than outstanding | Blocked by validation (BR-M-04 mirrored for refunds). The `RefundSheet` shows "Refund cannot exceed outstanding by ₹X" and disables submit. If the tutor needs to return more, they must post an `ADJUSTMENT` with explicit description. |
| EC-08 | Void of a void | Blocked. The VOID entry's row context menu has no "Void" option (you cannot void a void). |
| EC-09 | Void of a `FEE_CHARGED` with credits | Blocked by BR-LED-04. The action is disabled with a list of receipts to void first. |
| EC-10 | Network dies mid-txn | Local txn is atomic; either committed or rolled back. If committed locally but sync flush fails, the entry is queued in `sync_outbox` and retried. No data loss (P5). |
| EC-11 | Tutor records payment on the wrong student then voids | Walk: record → void (PIN) → re-record on correct student. The wrong student's ledger shows the original + the VOID (net zero). Correct student's ledger shows the real payment. Audit trail is complete. |
| EC-12 | Receipt PDF generation fails (Edge Function down on web) | The ledger entry and receipt row are committed (txn succeeded). The PDF is rendered lazily on next `ReceiptPreview` open. A "PDF pending" chip shows on the receipt card; background retry every 60s. |
| EC-13 | Student has 0 fee plans | Appears in the "No dues" tab. The `GenerateInvoiceSheet` for this student shows "No schedule items — generate ad-hoc invoice" with the ad-hoc radio pre-selected. |
| EC-14 | Period filter crosses a currency lock boundary | Not possible — currency is locked at first ledger entry; all entries share the same currency. The period filter only affects display grouping. |
| EC-15 | Tutor attempts to record a payment with a future date | Blocked by validation §14. The `DatePicker` disables future dates. |
| EC-16 | 500+ students in a single batch | Matrix virtualises (TanStack Virtual); only visible rows render. KPI queries are O(students) but cached. Performance target < 400ms render (§17). |
| EC-17 | Receipt tamper hash mismatch on view | The `ReceiptPreview` shows a red `✕ TAMPERED` banner; the audit log gets `receipt_tamper_detected`; a flare toast "This receipt appears tampered — do not honour" fires. The tutor is offered "Restore from last backup" via the Security flow. |
| EC-18 | Advance auto-apply would over-apply | If `advance_balance_minor > new_invoice.total`, only `total` is applied; the remainder stays in the advance wallet. The `ADJUSTMENT` entry amount = min(advance, total). |
| EC-19 | Tutor changes invoice_prefix mid-stream | Allowed (Settings). Existing invoice numbers retain their old prefix; new invoices use the new prefix. The `next_invoice_seq` continues incrementing (no reset). The matrix sorts by `created_at`, not `number`, so ordering is stable. |
| EC-20 | Student has only VOID entries (all charges voided) | `charge_count = 0` after the void filter → status = `no_dues`. The student appears in the "No dues" tab. The ledger still shows the historical VOID entries for audit. |

---

## 12. Offline Behaviour

The screen is **fully functional offline** (P5). Specifically:

- **Reads.** Every query in §9 hits the local embedded replica (libSQL on mobile/desktop, IndexedDB cache on web). No spinner blocks on a remote call. If the cache is empty (first visit on a fresh device), the screen shows skeletons until the initial sync completes, then content.
- **Writes.** All mutations (record payment, generate invoice, void, refund, remind) write to the local DB immediately and queue in `sync_outbox`. The optimistic UI (§8.3) shows the change instantly. The tutor sees a subtle "Offline · 1 pending" chip in the footer; the chip's count increments per mutation.
- **Conflict immunity.** Ledger entries are UUID-keyed and append-only (BR-SYN-02). Two offline devices both recording payments for the same student both land cleanly on sync — no merge needed. Voids reference the original entry ID, so a void posted offline resolves correctly on sync.
- **Sequence race.** The only conflict surface is `next_invoice_seq` / `next_receipt_seq`. Resolved server-side atomically; the loser re-tries with the next seq (see EC-05).
- **PDF generation offline.** Mobile/desktop render locally (no network needed). Web falls back to a client-side render via `@react-pdf/renderer` in a Web Worker if the Edge Function is unreachable; the result is queued for re-render with the canonical server version on reconnect.
- **Signed URL sharing offline.** The signed URL cannot be minted offline (requires the tenant_secret which is server-side only on web). On mobile/desktop, the secret is in the local encrypted DB, so signing works offline. On web offline, the share button shows "Signed URL will be available when online"; the PDF can still be downloaded locally and shared via OS share sheet.
- **Reminder sending offline.** In-app reminders are written to `notifications` immediately (local). WhatsApp/SMS (v1.x) are queued in `sync_outbox` and sent on reconnect.
- **No degraded mode.** The screen does not show a "You are offline" banner; the footer chip is the only signal. Every action is permitted offline that is permitted online, with the sole exception of web-side signed URL minting.

---

## 13. Sync Behaviour

- **Outbox flush.** On reconnect, `sync_outbox` rows flush in FIFO order. Each row is a JSON snapshot of the mutated row. The flush is incremental — a failed row doesn't block subsequent rows; it's marked `conflict` after 5 attempts and surfaced in the Sync drawer.
- **Ledger entry sync.** Because ledger entries are UUID-keyed and append-only, the sync is idempotent: re-sending the same entry is a no-op (PK conflict → ignored). This is the spine's conflict immunity (BR-SYN-02).
- **Receipt/Invoice sync.** These reference ledger entry IDs (FK), so they sync after their ledger entry lands. The sync order is enforced by FK dependencies in the outbox flusher.
- **Settings sequence sync.** `next_invoice_seq` and `next_receipt_seq` are LWW-merged with a twist: the server-side atomic increment is the source of truth; on sync, the client's local seq is reconciled to `max(local, server)`. A client that recorded 3 receipts offline (seq 43, 44, 45) syncs them; the server's seq jumps from 42 to 45; the next online receipt gets 46.
- **Audit log sync.** Audit log rows sync like ledger entries (UUID-keyed, append-only). The audit log is never truncated by the 200-row notification cap.
- **TanStack invalidation.** On `SYNC_COMPLETED` event, the fees store invalidates `['fees','overview',...]` and `['fees','student',...,'ledger']` for any student whose entries were synced. The UI re-renders with the merged data. A subtle "Synced · 3 new entries" toast fires if new ledger entries landed for the currently-viewed student.
- **Schema drift.** If a sync would write a row whose schema version exceeds the device's `app_state.schema_version`, the sync is refused (BR-SYN-04). The UI prompts "Update the app to sync new data."

---

## 14. Validation Rules

All validation runs through Zod schemas in `packages/shared` and is enforced client-side before the txn fires. Server-side validation (Supabase Edge Function for receipt PDF, libSQL CHECK constraints) is defence-in-depth.

| Field | Rule | Error |
|-------|------|-------|
| `amountMinor` | Integer, > 0, ≤ 10,00,00,00,000 (₹1 crore cap) | "Enter a valid amount greater than zero." |
| `method` | Enum: cash, upi, card, bank, cheque, other | "Select a payment method." |
| `reference` | Required when method ∈ {upi, bank, cheque}; UTR pattern `^\w{10,22}$` for upi; `^\d{6}$` for cheque; free-text for bank | "Reference required for UPI/bank/cheque." |
| `occurredOn` | ISO date, ≤ today, ≥ 5 years ago | "Date cannot be in the future." |
| `occurredOn` (backdate) | If > 3 days before today → requires fresh PIN (BR-LED-05) | N/A (PIN gate, not error) |
| `invoiceId` | Must belong to `studentId`; must not be `void` or `paid` | "Invoice does not belong to this student." / "Cannot pay a voided invoice." / "Invoice already paid in full." |
| `isAdvance` | If true, `invoiceId` is omitted (advance payments are unlinked) | N/A (UI disables invoice field) |
| `studentId` | Must be `active` (not archived) | "Cannot record payment for an archived student." |
| `studentId` (frozen ledger) | If student is `graduated` or `archived`, new `FEE_CHARGED` blocked; existing dues collectable | "Cannot post new charges to a graduated/archived student." |
| `voidReason` | Required, 3..200 chars | "Enter a void reason (3–200 characters)." |
| `discount_value` (percent) | Integer basis points, 1..10000 (0.01%..100%) | "Discount must be 0.01%–100%." |
| `discount_value` (fixed) | Integer minor units, 1..subtotal | "Discount cannot exceed subtotal." |
| `extra_charges` | Integer minor units, 0..10,00,00,00,000 | "Enter a valid extra charge." |
| `scholarship` | Free-text, 0..100 chars | N/A |
| `invoice.issue_date` | ≤ today | "Issue date cannot be in the future." |
| `invoice.due_date` | ≥ issue_date | "Due date must be after issue date." |
| `payment_ref` (cheque) | Includes `cheque_date` and `bank_name` | "Cheque date and bank required." |
| `reminder.message` | 1..1000 chars | "Message must be 1–1000 characters." |

Validation runs on every keystroke (debounced 150ms) and on submit. Errors render in flare-red below the field; the submit button is disabled until all errors clear.

---

## 15. Security Rules

This screen enforces the highest concentration of sensitive-mutation PIN gates in the product (per `10_Security.md` §4):

| Action | PIN gate | Audit log action | Why |
|--------|----------|------------------|-----|
| Void a receipt | Fresh PIN (≤ 30s old) | `payment_void` | Reverses money; irreversible without audit |
| Void an invoice | Fresh PIN | `fee_void` | Reverses a charge; same as above |
| Backdated payment (> 3 days before today) | Fresh PIN | `backdated_ledger` | Money in the past |
| Backdated invoice (> 3 days before today) | Fresh PIN | `backdated_ledger` | Same logic for charges |
| Issue a refund | Fresh PIN | `refund_issued` | Money leaving the tutor |
| Apply a writeoff | Fresh PIN | `writeoff_issued` | Reduces a due; tutor's intent must be confirmed |
| Bulk remind (> 10 students at once) | 2-second haptic confirm | `bulk_remind` | Mass communication; P11 tactile |
| Export monthly summary to Excel | No PIN (BR-BAT-03) | `export_excel` | Not full-DB export; logged |
| Export full statement (PDF, all students) | Fresh PIN | `export_full` | Exfiltrates all financial data |
| Change invoice_prefix | Fresh PIN | `settings_change` | Trust-boundary change on numbering |
| Restore from backup (overwrites current state) | Fresh PIN + typed "RESTORE" | `backup_restore` | Destructive overwrite |

**Audit log before mutation.** Every sensitive action writes `audit_log` *before* the data mutation (fail-closed). If the audit write fails (e.g., trigger guard, disk full), the entire txn aborts and the UI shows a flare toast "Audit log unavailable — action blocked. Free up space and retry."

**Tamper hash on every receipt/invoice.** Computed at creation (sha256 of `number || student_id || total || issue_date || tenant_secret` per BR-FEE-05). Recomputed on every view; mismatch → red `✕ TAMPERED` badge + `receipt_tamper_detected` audit log. The `tenant_secret` is in `app_state` (local encrypted DB + Turso cloud DB; never in client-readable config).

**Row-level tenant guard.** Every query includes `WHERE tenant_id = ?` bound from the Supabase JWT claim, never from client input (per `10_Security.md` §7). This protects against a future multi-tenant mishap or a token-theft lateral move.

**Signed URL expiry.** Receipt/statement share URLs are HMAC-SHA256-signed with the `tenant_secret` as key, 7-day TTL. On expiry, the URL returns 410 Gone with a friendly "This link has expired — request a new one from the tutor." page. The tutor can re-share anytime.

**No parent auth in v1 (P14).** The signed URL is the entire parent surface. There is no parent login, no parent account, no parent PII stored beyond what's on the receipt.

---

## 16. Error Handling

| Error class | Surface | Recovery |
|-------------|---------|----------|
| Zod validation error | Inline below field, flare-red | User corrects input; submit re-enables |
| libSQL CHECK constraint violation | Toast "Invalid data — please retry." + form keeps values | User reviews; rare (client-side validation should catch first) |
| libSQL immutability trigger abort | Toast "Ledger is immutable. This action requires a reversing entry." | Should never happen from UI (UI never UPDATEs ledger); indicates a bug → Sentry alert |
| Txn deadlock (rare, two concurrent txns on same student) | Auto-retry once after 200ms backoff; if still fails, toast "Could not record — please retry." | User re-taps submit |
| Network failure on sync | Silent — entry stays in `sync_outbox`; footer chip shows "Offline · 1 pending" | Auto-flush on reconnect |
| Server-side seq race (EC-05) | Auto-retry with new seq; user sees 1s delay, no error | Transparent |
| PDF render failure (web, Edge Function down) | "PDF pending" chip on receipt card; background retry 60s | User can view on-screen preview meanwhile |
| Tamper hash mismatch on view | Red `✕ TAMPERED` banner + flare toast "This receipt appears tampered — do not honour" + audit log | Tutor offered "Restore from last backup" via Security flow |
| Tenant secret missing (rare, migration gap) | Toast "Tenant secret not found — re-provisioning required." + Settings deep-link | Tutor contacts support |
| Backdate PIN failure | Toast "Incorrect PIN — try again." + lockout after 5 attempts (BR-SEC-02) | 30s lockout, then 5min, then wipe local cache |
| Schema drift on sync | Toast "Update the app to sync new data." + Settings deep-link to check for updates | Tutor updates app |
| Receipt not found (deleted receipt_id in URL) | "Receipt not found" empty state + "Go to Fees" CTA | Tutor navigates back |
| Student archived mid-txn | Toast "Student was archived — action blocked." | Tutor restores student or picks another |

Error toasts are persistent (don't auto-dismiss) for error class; success/info toasts auto-dismiss in 4s per `13_UI_Guidelines.md` §15.3 (Toasts & Confirmations) + §8.8 (Toast component).

---

## 17. Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Overview mode first paint (cold) | < 400ms for 500 students | Lighthouse, mid-range Android (Redmi Note 12) |
| Overview mode first paint (warm) | < 150ms | Same device, second visit |
| Status matrix tab switch | < 60ms (no spinner; virtualised row swap) | DevTools Performance |
| Record Payment sheet open → ready | < 100ms | Sheet animation budget 220ms total |
| Atomic payment txn (local) | < 80ms for the full §9.6 sequence | libSQL timing instrumentation |
| Balance recompute on ledger mutation | O(rows for that student), cached in TanStack; < 5ms typical | Profiler |
| Ledger table scroll (1000 entries) | 60fps steady; virtualised, only visible rows render | DevTools FPS |
| Receipt PDF render (web, Edge Function) | < 1.5s | Server-side timing |
| Receipt PDF render (mobile, local) | < 800ms | Device profiling |
| Invoice detail modal open | < 120ms | DevTools |
| KPI count-up animation | 400ms ease-out, first paint per session only | Visual + `useMotionValue` |
| Memory ceiling (500 students, full ledger) | < 80MB JS heap | DevTools Memory |
| Sync outbox flush (100 pending entries) | < 2s on reconnect | Network panel |

**Virtualisation.** The `StudentBalanceRow[]` list uses `@tanstack/react-virtual`. Only visible rows + 5 overscan render. Scrolling 500 students is steady 60fps. The `LedgerEntryRow[]` list uses the same; 1000 entries per student scroll smoothly.

**Caching.** TanStack Query stale time = 60s for overview, `Infinity` for ledger (re-fetched only on mutation invalidation). `gcTime` = 5min. This means after first load, switching between Overview and Ledger modes is instant (cache hit).

**Query optimisation.** The §9.2 status classification query is the heaviest. For 500 students, it scans ~5000 ledger entries (10 per student average) in < 8ms on the local replica. Index `idx_ledger_student(student_id, occurred_on)` is the critical index. The query is run once per period/batch filter change, not per row.

**Count-up animation.** Only on first paint per session (per P7). Re-renders (e.g., tab switch) do not re-animate; the number snaps.

---

## 18. Accessibility

Per `13_UI_Guidelines.md` §10 (Accessibility Commitments) and §8 (Component Vocabulary), this screen exceeds the baseline:

- **Contrast.** All text on glass verified ≥ 4.5:1. Emerald (#00FF9D) and cyan (#00F0FF) on cosmic bg (#0f0c29) = 7:1+. Flare (#FF5E00) on cosmic = 5.2:1. Amber (#FFB300) on cosmic = 6.8:1. Status chips are colour + icon + word, never colour alone (colour-blind safe).
- **Keyboard.** Full keyboard navigation: `Tab` order follows visual order. `Enter` on a student row opens the row actions menu. `Enter` on `[ + Record ]` opens the sheet. `Esc` closes any sheet/modal. `Cmd/Ctrl+P` on a ReceiptPreview triggers print. `Cmd/Ctrl+S` on RecordPaymentSheet submits. `G F` jumps to Fees from anywhere.
- **Screen readers.** `aria-live="polite"` on the toast region. `aria-busy` on skeletons. `sr-only` labels on icon-only buttons ("Record payment for Aarav Sharma"). The ledger table has `role="table"` with `aria-rowcount` and `aria-colcount`; each row has `aria-label` summarising ("August 5, fee charged, ₹3,000, invoice INV-000017"). The KPI cards have `aria-label` with the full value ("Collected this month, 1 lakh 24 thousand 500 rupees, up 18 percent versus July").
- **Motion sensitivity.** `prefers-reduced-motion` replaces springs with 120ms fades. Count-up animations are replaced with instant values. The ledger table scroll is unaffected (it's a native scroll, not an animation).
- **Focus management.** When `RecordPaymentSheet` opens, focus moves to the Amount input. On close, focus returns to the triggering button. When `ReceiptPreview` opens, focus moves to the close button (the receipt content is read-only).
- **Touch targets.** All row action buttons are 44×44px on `base`/`sm` (per `13_UI_Guidelines.md` §10.2 44px Touch Targets). The matrix segmented control segments are 44px tall.
- **Number readability.** All amounts use tabular-nums mono so digits don't jitter. The currency symbol is in muted colour, lighter than the figure, per `13_UI_Guidelines.md` §3.4 (Numeric & Figure Features).
- **Receipt PDF accessibility.** The PDF is generated with tagged accessibility (PDF/UA): reading order, alt text for the institute logo, table headers marked. A screen reader can read a Buddysaradhi receipt PDF aloud correctly.

---

## 19. Testing Requirements

### 19.1 Unit tests (Vitest)

- `feesStore` slice: mode switch, sheet open/close, optimistic entry lifecycle.
- `packages/shared` Zod schemas: every validation rule in §14.
- Calculation functions: `computeBalanceDue`, `classifyStatus`, `formatCurrency`, `amountInWords`.
- Tamper hash function: known-vector tests (`sha256("INV-000017|<uuid>|300000|2025-08-01|<secret>")` → expected hash).
- Invoice number formatting: `formatInvoiceNumber('INV-', 17)` → `'INV-000017'`.
- Advance split logic: `splitAdvance(5000, 3000)` → `{ exact: 3000, advance: 2000 }`.

### 19.2 Integration tests (Vitest + in-memory libSQL)

- §9.6 atomic payment txn: insert ledger entry + receipt + invoice update + audit log + sync outbox in one txn. Verify all-or-nothing on simulated failure at each step.
- §9.10 void receipt txn: verify VOID entry mirrors original, receipt voided_at set, invoice reverts.
- §9.11 advance split: verify two `PAYMENT_RECEIVED` rows, one tagged `[ADVANCE]`.
- Advance auto-apply: insert `FEE_CHARGED`, verify `ADJUSTMENT` auto-inserted with `[ADVANCE_APPLY]`.
- BR-LED-04: attempt to void an invoice with credits → blocked.
- BR-M-04: attempt to overpay without advance toggle → blocked.
- Immutability trigger: a direct `db.ledgerEntry.update({ where: { id }, data: { amount: 0 } })` call → rejected by Prisma middleware (`ledgerGuard.ts`); defence-in-depth: SQLite trigger also aborts any raw UPDATE on the table.
- Sequence atomicity: two concurrent txns calling `next_invoice_seq` increment → one winner, one retry.

### 19.3 Component tests (Vitest + Testing Library)

- `StudentBalanceRow` renders all fields; row actions fire correct callbacks.
- `RecordPaymentSheet` validation: empty amount → submit disabled; invalid UTR → error; excess without advance → helper text.
- `RecordPaymentSheet` live preview: amount > balance with advance → preview shows split.
- `LedgerTable` renders 7 entry types with correct icons/colours.
- `ReceiptPreview` recomputes tamper hash on render; mismatch shows `✕ TAMPERED` banner.
- `KpiStrip` count-up animation respects `prefers-reduced-motion`.
- Empty state renders when `ledger_entries` count = 0.

### 19.4 End-to-end tests (Playwright)

- Full payment scenario (§10.7.1): record payment → receipt preview → share URL → back to overview → row moved to Paid tab.
- Partial payment → invoice status `partial` → row in both Unpaid and Partial tabs.
- Advance payment → advance wallet shown in ledger → next month auto-applies.
- Void receipt → PIN prompt → confirm → ledger shows VOID entry → invoice reverts.
- Offline: disable network → record payment → row visible with "pending" chip → enable network → sync → "Synced" toast.
- Backdated payment → PIN prompt → audit log entry.
- 500 students: load test data → overview renders < 400ms → matrix scroll 60fps.
- Keyboard-only: full record-payment flow via Tab/Enter/Esc.
- Screen reader: ledger table row `aria-label` correct.

### 19.5 Visual regression tests (Chromatic / Playwright snapshots)

- Overview mode default state.
- Overview mode with all 4 status tabs.
- Ledger mode with VOID entry styling.
- Record Payment sheet (empty, prefilled, advance-on, backdate-warning).
- Receipt preview (clean, voided, tampered).
- Empty state.
- Dark + light theme variants.

### 19.6 Performance tests (Lighthouse CI)

- Overview mode: LCP < 1.2s, TBT < 200ms, CLS < 0.05 on mid-range Android.
- 500-student matrix: 60fps scroll, < 80MB heap.

### 19.7 Security tests

- Tamper hash: tamper with a receipt row in DB → view in UI → `✕ TAMPERED` banner + audit log.
- Tenant guard: attempt query with wrong `tenant_id` → empty result.
- PIN lockout: 5 failed PINs → 30s lockout; 10 → 5min; 15 → local cache wipe.
- Signed URL expiry: 8-day-old URL → 410 Gone.

---

## 20. Future Extensions

These are **out of scope for v1** (per `00_Vision.md` §6) but the data model and screen layout do not preclude them:

- **Online payment gateway** (v1.x). A "Pay online" button on the receipt/reminder that generates a Razorpoint/Stripe payment link. On payment, the gateway webhook posts a `PAYMENT_RECEIVED` entry with `source='gateway'`. The ledger is unchanged; only the entry's source and method differ.
- **Parent portal** (v1.x). A read-only web surface where a parent authenticates (magic link) and sees their student's ledger, receipts, and statements. The signed URL remains the v1 fallback.
- **Recurring auto-charges** (v1.x). Scheduled `FEE_CHARGED` entries auto-posted on cycle start (postpaid) or cycle end (prepaid) via a cron job on the Supabase Edge Function. The tutor approves the batch once; subsequent cycles are automatic until paused.
- **GST/tax invoicing** (v2). If the tutor's institute is GST-registered, invoices carry GSTIN, HSN codes, and tax breakdown. The ledger gets `TAX_CHARGED` and `TAX_PAID` entry types. Out of scope for v1 (BR-M-02 — one currency, no tax).
- **Multi-tutor role-based access** (v1.x). "Centre Priya" persona gets role-based access: a tutor can be scoped to specific batches, seeing only their students' fees. The `tenant_id` guard extends to `tutor_id` scoping. The audit log records which tutor posted each entry.
- **Custom receipt templates** (v1.x). Upload a logo, choose a font, edit the footer. The tamper hash scheme is unchanged. Shipped after auto-reminders (P12).
- **Scholarship fund tracking** (v2). Aggregate scholarships granted across the institute, with a donor field on `fee_plans.scholarship`. Reports break down by donor.
- **Dues aging buckets** (v2). The matrix adds a 30/60/90/120+ day aging breakdown. Defaulters are surfaced by aging, not just amount.
- **Payment plan negotiations** (v2). A student can be on a negotiated payment plan (e.g., ₹500/week for 6 weeks). The fee plan wizard supports this; the matrix surfaces a "payment plan" chip.
- **WhatsApp Business API** (v1.x). Two-way WhatsApp: the tutor sends a reminder, the parent replies "Paid ₹3000 via UPI", the tutor taps a button to convert the WhatsApp message into a `PAYMENT_RECEIVED` entry pre-filled.
- **Bank statement import** (v2). Upload a bank statement CSV; the app auto-matches UTRs to pending invoices and bulk-creates `PAYMENT_RECEIVED` entries. Match confidence is shown; unmatched rows are surfaced for review.
- **Forecasting** (v2). Predict next month's collection based on historical payment patterns + outstanding dues. Shown as a 4th KPI card variant.
- **Receipt QR codes** (v1.x). A QR code on the receipt PDF that, when scanned, opens the signed URL — easier for parents than copy-pasting a link.
- **Installment calendar** (v2). A calendar view of upcoming installments across all students, like a Gantt chart of money.
- **Fee waivers** (v2). A formalised `WAIVER_GRANTED` entry type for full or partial waivers (distinct from discounts — waivers are typically needs-based and reported separately).

---

## 21. ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 for the Fees & Payments screen. Fees is the most *ledger-dense* screen in Buddysaradhi — KPI cards, status matrix, per-row actions, three sheets (Record Payment, Generate Invoice, Invoice Detail), receipt preview, reminder popover, and the immutable ledger table. Every mockup below annotates the **glass tier** or **neumorphic recipe** so the design contract is unambiguous. Character set per §20.2; accent colours named; cross-references use canonical IDs only.

### 21.1 Design System Reference — Fees & Payments

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces on this screen | Tier | Cross-ref |
|---|---|---|
| Sidebar / bottom-tab bar (mobile) | `glass-strong` | §5.5, §8.6 |
| Topbar | `glass-strong` sticky | §5.5 |
| KPI strip card (4 cards: Collected / Due Till / Due Month / Counts) | `glass` + 2px accent left-border (emerald / amber / flare / violet) | §5.4, §8.1 |
| Status matrix row (per-student) | `glass-faint` band | §5.2, §8.4 |
| Per-row expandable detail card | flat `bg-white/[0.04]` (no-glass-on-glass) | §5.3 |
| Ledger table row | `glass-faint` band; VOID row = `glass-faint` + flare left-border | §5.2, §5.4 |
| Student header card (Ledger mode) | `glass` workhorse | §5.5 |
| Record Payment sheet | `glass-strong` + backdrop `bg-black/60` | §5.5, §8.7 |
| Generate Invoice sheet | `glass-strong` + backdrop | §5.5, §8.7 |
| Invoice Detail modal | `glass-strong` + backdrop | §5.5, §8.7 |
| Receipt Preview modal | `glass-strong` + backdrop (mobile: full-screen sheet) | §5.5, §8.7 |
| Reminder Trigger popover | `glass-strong` anchored | §5.5 |
| Empty-state card | `glass` centered | §5.5, §8.19 |
| Toast (payment recorded / void / sync conflict) | `glass-strong` + 4px accent left-bar | §5.5, §8.8 |
| Bulk-action bar (matrix multi-select) | `glass-strong` sticky bottom | §5.5 |
| Monthly Summary Preview (collapsible) | `glass-faint` band | §5.2 |
| Footer | `glass-faint` (recede), sticky per §13 | §5.5 |

| Neumorphic controls on this screen | Recipe | Cross-ref |
|---|---|---|
| Mode segmented control (`[Overview] [Ledger]`) | well = `neumo-inset`; active pill = `neumo-raised` + cyan glow | §6.6, §8.5 |
| Period selector dropdown | `neumo-raised`; popover = `glass-strong` sheet | §6.6 |
| Batch filter dropdown | `neumo-raised` | §6.6 |
| Status matrix segmented control (4 segments w/ counts) | well = `neumo-inset`; active pill = `neumo-raised` + accent glow (flare/amber/emerald/violet by segment) | §6.6, §8.5 |
| Per-row action buttons (`[+ Record] [📄 Ledger] [🧾 Invoice] [🔔 Remind]`) | `neumo-raised` compact; primary = emerald glow; destructive = flare glow | §6.6, §8.2 |
| Search bar (in matrix) | `neumo-inset` | §6.6, §8.10 |
| Sort header caret buttons | `neumo-raised` compact | §6.6 |
| Quick-amount buttons in Record Payment (`Full ₹3,000` / `Half ₹1,500` / `Custom`) | `neumo-raised` secondary; active = `neumo-pressed` | §6.6, §8.2 |
| Method segmented control (Cash / UPI / Card / Bank / Chq / Other) | well = `neumo-inset`; active pill = `neumo-raised` + cyan glow | §6.6, §8.5 |
| Amount input, Reference input, Issue/Due date inputs | `neumo-inset`; focus = cyan 2px inset ring + glow | §6.6, §8.9 |
| "Mark as advance payment" toggle | well = `neumo-inset`; knob = `neumo-raised` (emerald→cyan when on) | §6.4, §8.16 |
| Submit / Cancel / Generate / Preview buttons | `neumo-raised`; primary = emerald glow; destructive = flare glow | §6.6, §8.2 |
| PinPad (in Void Receipt / Backdate Payment sheets) | digits = `neumo-raised`; ⌫ backspace = `neumo-raised` + flare glow | §6.6 |
| Sparkline (in Collected KPI card) | transparent SVG (NOT glass, NOT neumorphic) — data glyph | §8.14 |

> **References:** Nielsen Norman Group — *Financial Dashboards: A Design Guide* (KPI strip + status matrix composition); Smashing Magazine — *Designing Transactional Forms That Don't Suck* (Record Payment sheet anatomy); Apple HIG — *Sheets* (slide-in drawer on desktop, bottom sheet on mobile); Material Design 3 — *Bottom Sheets* (Record Payment mobile variant); WCAG 2.1 AA §1.4.11 (Non-text Contrast — VOID row must pair flare left-border with strike-through + `↺ voided by` link, never colour alone); WCAG 2.1 AA §3.3.3 (Error Suggestion — backdated-payment PIN gate surfaces reason before submit); A List Apart — *Sensible Forms: A Form Usability Checklist* (Quick-amount buttons, live preview block).

### 21.2 Mockup M1 — Full-Screen Desktop Layout (Overview Mode, default landing)

```
DESKTOP (≥ 1280px) — Overview Mode, 4 KPI cards + status matrix
┌────────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (.glass-strong) ─┐ ┌─ Topbar (.glass-strong sticky) ────────────────────┐ │
│ │  ◈ Buddysaradhi                │ │  Bright Minds Tuition · 🔍 Search · ⌘K · 🔔3 · 👤  │ │
│ │  ◈ Dashboard              │ ├────────────────────────────────────────────────────┤ │
│ │  👥 Students              │ │ ┌─ Mode + filters row ──────────────────────────┐ │ │
│ │  ✓ Attendance             │ │ │ [●Overview][○Ledger]  Period:[Aug 2025▾] Batch:[All▾] ⋮│ │ │
│ │  ◉ Fees        ← active   │ │ └────────────────────────────────────────────────┘ │ │
│ │  ⚙ Settings               │ │                                                    │ │
│ │                           │ │ ┌─ KPI strip (4× .glass cards w/ accent borders) ─┐│ │
│ │  ──────                   │ │ │▌Collected   ▌Due Till   ▌Due Month  ▌Counts     ││ │
│ │  Priya B.                 │ │ │▌₹ 1,24,500 ▌₹ 38,200  ▌₹ 22,500  ▌✓84 ◐12 ✕44 —0││ │
│ │  Pune · 142 students      │ │ │▌↑18% vs Jul▌19 studs   ▌11 studs   ▌paid partial ││ │
│ │                           │ │ │▌╱╲╱╲╱╲     ▌           ▌           ▌unpaid nodue││ │
│ │  ⚙ Sync                   │ │ └──────────────────────────────────────────────────┘│ │
│ │  ⚡ ⌘K                    │ │                                                    │ │
│ │                           │ │ ┌─ Status matrix (.glass-faint rows) ─────────────┐│ │
│ │                           │ │ │ [✕Unpaid·44] [◐Partial·12] [✓Paid·84] [—NoDues·0]││ │
│ │                           │ │ │ ─────────────────────────────────────────────── ││ │
│ │                           │ │ │ Search🔍 Sort:[Balance▾] Filter▾  · 10/page▾    ││ │
│ │                           │ │ │ ─────────────────────────────────────────────── ││ │
│ │                           │ │ │ Aarav Sharma  STU-07  ₹3,000  —    —    post ✕ ││ │
│ │                           │ │ │ Diya Patel    STU-11  ₹1,500  ₹1.5K 12Aug post ◐││ │
│ │                           │ │ │ Kabir Singh   STU-19  ₹0     ₹3K  14Aug post ✓ ││ │
│ │                           │ │ │ … (44 rows, virtualised)                          ││ │
│ │                           │ │ │ Row actions: [+Record] [📄Ledger] [🧾Invoice] [🔔]││ │
│ │                           │ │ └──────────────────────────────────────────────────┘│ │
│ └───────────────────────────┘ │ ┌─ Monthly summary preview (.glass-faint) ───────┐│ │
│                               │ │ Aug 2025: collected ₹1,24,500 · dues ₹38,200    ││ │
│                               │ │ [View full report]  [Export Excel]  [Export PDF]││ │
│                               │ └──────────────────────────────────────────────────┘│ │
│ └─────────────────────────────┴────────────────────────────────────────────────────┘ │
│ ┌─ Footer (.glass-faint, sticky) ───────────────────────────────────────────────────┐ │
│ │  ● Online · synced 2m ago · 142 students · 12 partial · v1.4.2 · © Buddysaradhi        │ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ cosmic canvas: #0f0c29 → #24243e → #0a0a1a (§2.2)
   ↑ sidebar + topbar = .glass-strong (8% white, 24px blur) — persistent chrome (§5.5)
   ↑ KPI cards = .glass + 2px accent left-border:
     • Collected = emerald (positive delta)
     • Due Till Date = amber (cautionary)
     • Due This Month = flare (immediate-action)
     • Counts = violet (neutral informational)
   ↑ status matrix rows = .glass-faint bands (recede so data reads, §5.2)
   ↑ status chips = flat tinted (✓/◐/✕/—); never colour alone, §10.6
   ↑ mode segmented control = .neumo-inset well; active pill = .neumo-raised + cyan glow (§8.5)
   ↑ status matrix segmented control = .neumo-inset well; active pill = .neumo-raised + segment-accent glow
   ↑ per-row action buttons = .neumo-raised compact (36px desktop, 44px mobile §10.2)
   ↑ [Export Excel] / [Export PDF] = .neumo-raised secondary (cyan glow)
   ↑ footer = .glass-faint (recede), sticky per §13
```

### 21.3 Mockup M2 — Empty State (fresh tenant, no ledger entries, P15)

```
EMPTY STATE — fresh tenant, no fees recorded yet
┌──────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (.glass-strong) ─┐ ┌─ Content (transparent over canvas) ─────────┐ │
│ │  ◈ Buddysaradhi                │ │                                              │ │
│ │  ◈ Dashboard              │ │     ┌─ Empty-state card (.glass) ────────┐  │ │
│ │  👥 Students              │ │     │                                    │  │ │
│ │  ✓ Attendance             │ │     │         ╭──────────╮                │  │ │
│ │  ◉ Fees        ← active   │ │     │         │  ┌────┐  │  ← 120×120     │  │ │
│ │  ⚙ Settings               │ │     │         │  │ ₹  │  │     line-art   │  │ │
│ │                           │ │     │         │  │    │  │     cyan+emerald│ │
│ │  ──────                   │ │     │         │  └────┘  │                │  │ │
│ │  Priya B.                 │ │     │         ╰──────────╯                │  │ │
│ │  Pune · 0 students        │ │     │                                    │  │ │
│ │                           │ │     │         No fees recorded yet.       │  │ │
│ │  ⚙ Sync                   │ │     │   Add a fee plan to your first      │  │ │
│ │                           │ │     │   student.                          │  │ │
│ │                           │ │     │                                    │  │ │
│ │                           │ │     │   ┌────────────────────────────┐    │  │ │
│ │                           │ │     │   │  + Add Fee Plan            │    │  │ │
│ │                           │ │     │   └────────────────────────────┘    │  │ │
│ │                           │ │     │       or import from Excel →       │  │ │
│ │                           │ │     │                                    │  │ │
│ │                           │ │     └────────────────────────────────────┘  │ │
│ └───────────────────────────┘ └────────────────────────────────────────────┘ │
│ ┌─ Footer (.glass-faint) ─────────────────────────────────────────────────────┐ │
│ │  ● Online · synced just now · 0 students · ₹ 0 collected · v1.4.2 · © Buddysaradhi│ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
   ↑ empty-state card = .glass (5% white, 24px blur) — centered, not elevated (§8.19)
   ↑ CTA = .neumo-raised + emerald glow (primary, §8.2)
   ↑ secondary "import from Excel" = ghost link (--text-secondary, no shadow)
   ↑ illustration = custom SVG line-art wallet (NOT lucide), cyan + emerald (§9.3)
   ↑ honest-empty-state rule (P15): never a blank KPI strip; always a designed CTA
   ↑ "Add Fee Plan" CTA opens the fee-plan wizard (a sheet that walks through model,
     cycle, amount, schedule — see BR-FEE-06/07/08)
```

### 21.4 Mockup M3 — Loading / Skeleton (KPI strip + matrix first paint)

```
SKELETON — first paint, KPI + matrix loading, < 800ms budget (§17)
┌────────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (.glass-strong) ─┐ ┌─ Topbar (.glass-strong sticky) ────────────────────┐ │
│ │  ◈ Buddysaradhi                │ │  Bright Minds Tuition · 🔍 Search · ⌘K · 🔔3 · 👤  │ │
│ │  ◉ Fees        ← active   │ ├────────────────────────────────────────────────────┤ │
│ │                           │ │ ┌─ Mode + filters skel ─────────────────────────┐ │ │
│ │                           │ │ │ (░░░░)(░░░░)  Period:[░░░░░░░] Batch:[░░]  ⋮  │ │ │
│ │                           │ │ └────────────────────────────────────────────────┘ │ │
│ │                           │ │                                                    │ │
│ │                           │ │ ┌─ KPI skeleton strip (×4 .glass-faint + shimmer) ┐│ │
│ │                           │ │ │▌░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░││ │
│ │                           │ │ │▌                                              ▌││ │
│ │                           │ │ │▌░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    ▌││ │
│ │                           │ │ │▌                                              ▌││ │
│ │                           │ │ │▌░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░        ▌││ │
│ │                           │ │ └──────────────────────────────────────────────────┘│ │
│ │                           │ │ ┌─ Matrix skel (.glass-faint + shimmer) ───────────┐│ │
│ │                           │ │ │ (░░░░·░)(░░░░░░·░)(░░░░·░)(░░░░░░·░)             ││ │
│ │                           │ │ │ ─────────────────────────────────────────────── ││ │
│ │                           │ │ │ ●░░░░░░░░░░░  ░░░░░  ░░░░░  ░░░  ░░░░░░░░░░░░░░░││ │
│ │                           │ │ │ ●░░░░░░░░░░░  ░░░░░  ░░░░░  ░░░  ░░░░░░░░░░░░░░░││ │
│ │                           │ │ │ ●░░░░░░░░░░░  ░░░░░  ░░░░░  ░░░  ░░░░░░░░░░░░░░░││ │
│ │                           │ │ │ ●░░░░░░░░░░░  ░░░░░  ░░░░░  ░░░  ░░░░░░░░░░░░░░░││ │
│ │                           │ │ │ ●░░░░░░░░░░░  ░░░░░  ░░░░░  ░░░  ░░░░░░░░░░░░░░░││ │
│ │                           │ │ │ …                                                  ││ │
│ │                           │ │ └──────────────────────────────────────────────────┘│ │
│ └───────────────────────────┘ └────────────────────────────────────────────────────┘ │
│ ┌─ Footer (.glass-faint) ───────────────────────────────────────────────────────────┐ │
│ │  ● Online · syncing… · — students · ₹ — collected · v1.4.2 · © Buddysaradhi            │ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────┘
   ↑ KPI skeleton = .glass-faint blocks + shimmer (1.2s loop, §8.20); accent left-border
     pre-applied (emerald/amber/flare/violet) so layout shift = 0 on resolve
   ↑ matrix rows = .glass-faint + shimmer; avatar dot + name bars + amount bar + chip placeholder
   ↑ mode segmented control = .neumo-inset well; shimmer on each pill slot
   ↑ period + batch selectors = .neumo-raised; shimmer on label region
   ↑ aria-busy="true" on KPI strip + matrix parents (§10.5)
   ↑ 100-student matrix first paint < 800ms (§17)
   ↑ 120ms fade-out on resolve; KPI count-up runs only on first paint per session (§7.3)
   ↑ never a full-screen spinner — skeleton is the contract (§15.2)
```

### 21.5 Mockup M4 — Primary Modal: Record Payment Sheet (the heart of the screen)

```
MODAL — Record Payment Sheet (slides in from right on desktop, 480px drawer; bottom sheet on mobile)
┌──────────────────────────────────────────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░ backdrop: bg-black/60 + backdrop-blur-sm ░░░░░░░░░░░░░ │
│  ░░░░░░░  ┌──────────────────────────────────────────────╲░░░░░░░░░░░░░░░░  │
│  ░░░░░░░  │  Record Payment                          ✕       │░░░░░░░░░░░  │
│  ░░░░░░░  ├──────────────────────────────────────────────┤░░░░░░░░░░░  │
│  ░░░░░░░  │  Student                                    │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────┐   │░░░░░░░░░░░  │
│  ░░░░░░░  │  │ Aarav Sharma · STU-0007         ✕    │   │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────┘   │░░░░░░░░░░░  │
│  ░░░░░░░  │  Balance Due: ₹ 3,000  ·  Advance: ₹ 0     │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Amount                          ▤ Quick     │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────┐   [Full ₹3,000]     │░░░░░░░░░░░  │
│  ░░░░░░░  │  │ ₹                │   [Half ₹1,500]     │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────┘   [Custom]            │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Method                                      │░░░░░░░░░░░  │
│  ░░░░░░░  │  (●Cash)(○UPI)(○Card)(○Bank)(○Chq)(○Other)  │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Reference (UTR / Cheque no.)               │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────┐   │░░░░░░░░░░░  │
│  ░░░░░░░  │  │                                      │   │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────┘   │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Date                                        │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────┐   📅 14 Aug 2025     │░░░░░░░░░░░  │
│  ░░░░░░░  │  │ 14 Aug 2025      │   (today)             │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────┘                      │░░░░░░░░░░░  │
│  ░░░░░░░  │  ⚠ Backdate > 3 days requires PIN           │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Linked invoice                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────┐   │░░░░░░░░░░░  │
│  ░░░░░░░  │  │ INV-000017  ·  ₹3,000  ·  Partial ◐  │   │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────┘   │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  ☐ Mark as advance payment                  │░░░░░░░░░░░  │
│  ░░░░░░░  │     (Surplus → advance wallet)              │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  ──────────────────────────────────────     │░░░░░░░░░░░  │
│  ░░░░░░░  │  After this payment:                        │░░░░░░░░░░░  │
│  ░░░░░░░  │   Balance: ₹ 0  ·  Status: ✓ Paid           │░░░░░░░░░░░  │
│  ░░░░░░░  │   Receipt: RCP-000043  ·  Hash: ••••a3f9    │░░░░░░░░░░░  │
│  ░░░░░░░  │  ──────────────────────────────────────     │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │   [Cancel]            [Record & Print]       │░░░░░░░░░░░  │
│  ░░░░░░░  └──────────────────────────────────────────────┘░░░░░░░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────────────────────────────────────────┘
   ↑ backdrop = bg-black/60 + backdrop-blur-sm — click = cancel, ESC = cancel (§8.7)
   ↑ panel = .glass-strong (8% white, 24px blur) — highest-focus tier (§5.5)
   ↑ Student autocomplete = .neumo-inset (FTS5 search); selected = .neumo-inset + ✕ ghost clear
   ↑ Amount input = .neumo-inset; focus = cyan 2px inset ring + glow
   ↑ Quick-amount buttons = .neumo-raised secondary; active = .neumo-pressed (§8.2)
   ↑ Method segmented control = .neumo-inset well; active pill = .neumo-raised + cyan (§8.5)
   ↑ Reference input = .neumo-inset (required for UPI/bank/cheque, optional for cash)
   ↑ Date input = .neumo-inset; ⚠ amber warning for backdate > 3 days (BR-LED-05)
   ↑ Linked invoice = flat tinted bg-white/[0.04] sub-card (no-glass-on-glass, §5.3)
   ↑ "Mark as advance" checkbox-style = .neumo-inset well + .neumo-raised check
   ↑ Live preview block = flat tinted sub-card; emerald accent for "Paid" status
   ↑ [Cancel] = ghost; [Record & Print] = .neumo-raised + emerald glow (primary, §8.2)
   ↑ aria-modal="true" + focus-trap active (§10.5); ESC = cancel
   ↑ on submit: optimistic insert + atomic DB txn (§9) + sync_outbox row (BR-SYN-01)
   ↑ money = integer paise throughout (BR-M-01, BR-FEE-01)
   ↑ 240ms ease-spring-soft enter (§7.3 modal-enter); mirror exit 180ms
```

### 21.6 Mockup M5 — Toast / Confirmation: Void Receipt (primary destructive, PIN-gated)

```
TOAST + PIN-GATE — Void Receipt RCP-000042 (BR-LED-04, BR-SEC-02)
┌──────────────────────────────────────────────────────────────────────────────┐
│                       (Fees screen underneath, dimmed by backdrop)            │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░░░░░░░  ┌──────────────────────────────────────────────╲░░░░░░░░░░░░░░░░  │
│  ░░░░░░░  │  Void receipt RCP-000042?                ✕       │░░░░░░░░░░░  │
│  ░░░░░░░  ├──────────────────────────────────────────────┤░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Aarav Sharma · ₹1,500 · 15 Aug 2025         │░░░░░░░░░░░  │
│  ░░░░░░░  │  Linked invoice: INV-000017 (will revert     │░░░░░░░░░░░  │
│  ░░░░░░░  │  to Partial ◐ if no other payments)          │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Void reason (required, min 8 chars):        │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────┐    │░░░░░░░░░░░  │
│  ░░░░░░░  │  │ Wrong student — re-enter for Diya    │    │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────┘    │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │  Enter PIN to confirm                        │░░░░░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────┐    │░░░░░░░░░░░  │
│  ░░░░░░░  │  │  • • • • • •                         │    │░░░░░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────┘    │░░░░░░░░░░░  │
│  ░░░░░░░  │      1  2  3                                │░░░░░░░░░░░  │
│  ░░░░░░░  │      4  5  6                                │░░░░░░░░░░░  │
│  ░░░░░░░  │      7  8  9                                │░░░░░░░░░░░  │
│  ░░░░░░░  │      •  0  ⌫                                │░░░░░░░░░░░  │
│  ░░░░░░░  │                                              │░░░░░░░░░░░  │
│  ░░░░░░░  │   [Cancel]            [Void Receipt]  (dis.) │░░░░░░░░░░░  │
│  ░░░░░░░  └──────────────────────────────────────────────┘░░░░░░░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────────────────────────────────────────┘

AFTER PIN verify + transaction commit (Toast surfaces bottom-right):

                          ┌▌──────────────────────────────────┐
                          │▌ ✓  Receipt RCP-000042 voided     │
                          │▌    INV-000017 reverted to Partial│
                          │▌              [Undo]  ✕           │
                          └▌──────────────────────────────────┘
                             ↑ 4px emerald left-bar (success)
                             ↑ .glass-strong (8% white, 24px blur) per §8.8
                             ↑ aria-live="polite" (success = polite, §10.5)
                             ↑ 4s auto-dismiss; swipe-down to dismiss (§15.3)
                             ↑ [Undo] = .neumo-raised compact (re-posts the original
                               PAYMENT_RECEIVED entry, enqueues sync_outbox per BR-SYN-01)
                             ↑ ✕ = ghost close
                             ↑ the original RCP-000042 row in the ledger table now
                               shows a strike-through + "↺ voided by entry xxx" link
                               (§6.3 Ledger Mode, BR-LED-04)
```

> **Why PIN-gate for void (BR-SEC-02, BR-LED-04):** voiding a receipt posts a reversing `VOID` ledger entry that reverts the invoice status — a load-bearing mutation that auditors care about. PIN = tactile intent; the typed reason satisfies the audit trail; the `[Undo]` action is the safety net for the 30-second "wrong student" realisation.

### 21.7 Mockup M6 — Mobile Variant (`base` < 640px, Overview Mode stacked)

```
MOBILE (base < 640px) — single column, bottom-tab bar, KPI strip horizontal snap
┌──────────────────────────────────────┐
│ ▔▔▔▔▔▔ ← env(safe-area-inset-top)    │
│ ┌─ Topbar (.glass-strong sticky) ───┐│
│ │ ◈  Fees     🔍 ⌘K   🔔3          ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Mode + filters (.glass-faint) ──┐│
│ │ [●Over][○Ledgr]  Aug 25 ▾  All ▾ ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ KPI strip (horizontal snap) ────┐│
│ │┌────────┐ ┌────────┐ ┌────────┐  ›│
│ ││▌Collect│ │▌Due Tl │ │▌Due Mon│   │
│ ││▌₹1.24L │ │▌₹38.2K │ │▌₹22.5K │   │
│ ││▌↑18%   │ │▌19 std │ │▌11 std │   │
│ │└────────┘ └────────┘ └────────┘   │
│ └────────────────────────────────────┘│
│  ← snap-scroll, 280px cards, one-up  │
│                                      │
│ ┌─ Status matrix segmented (.neumo) ┐│
│ │(✕44)(◐12)(✓84)(—0)                ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Matrix rows (.glass-faint) ─────┐│
│ │ ● Aarav Sharma       ₹3,000  ✕  ││
│ │   STU-07 · post · Due 5d ago      ││
│ │   [+Record] [📄] [🧾] [🔔]        ││
│ │ ─────────────────────────────── ││
│ │ ● Diya Patel         ₹1,500  ◐  ││
│ │   STU-11 · post · Last paid 12Aug ││
│ │   [+Record] [📄] [🧾] [🔔]        ││
│ │ ─────────────────────────────── ││
│ │ ● Kabir Singh        ₹0      ✓  ││
│ │   STU-19 · post · Settled         ││
│ │   [+Record] [📄] [🧾] [🔔]        ││
│ │ ─────────────────────────────── ││
│ │ ⋯ +41 more                        ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Quick FAB (.neumo-raised, emerald)┐│
│ │                          [+]       ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Bottom Tab Bar (.glass-strong) ─┐│
│ │  ◈    👥    ✓    ₹    ⚙           ││
│ │ Home Stud Att  Fees Set           ││
│ └────────────────────────────────────┘│
│ ▁▁▁▁▁ ← env(safe-area-inset-bottom)  │
└──────────────────────────────────────┘
   ↑ topbar = .glass-strong sticky (§5.5)
   ↑ KPI strip = horizontal snap-scroll (§14 base breakpoint); cards = .glass + accent border
   ↑ status matrix segmented control = .neumo-inset well; active = .neumo-raised + segment-accent glow
   ↑ matrix rows = .glass-faint bands; 48px row height, full-width tap target = 44px (§10.2)
   ↑ per-row action buttons = .neumo-raised compact (always visible on mobile, condensed)
   ↑ FAB = .neumo-raised + emerald glow, 56×56px, bottom-right, above tab bar
     (opens Record Payment sheet with student field focused, no prefill)
   ↑ bottom tab bar = .glass-strong + safe-area inset (§4.3, §8.6)
   ↑ every tab + row + button ≥ 44×44px hit area (§10.2)
   ↑ Record Payment sheet slides up as 90vh bottom sheet on mobile (§8.7)
   ↑ Receipt Preview = full-screen sheet on mobile (A5 portrait becomes A4 mobile-portrait)
```

### 21.8 Mockup M7 — State Matrix: Status Matrix Segmented Control (primary interactive control)

```
STATE MATRIX — Status Matrix Segmented Control (4 segments w/ live counts)
Box: 64–80 char width per §20.3 rule 2.

DEFAULT (Unpaid active)             FOCUS (keyboard tab to "Partial")
╭─ .neumo-inset well ──────────────╮ ╭─ .neumo-inset well ──────────────╮
│ (▌✕ Unpaid ·44)( ◐ Partial ·12 ) │ │ ( ✕ Unpaid ·44)( ═Partial·12═ )  │
│ ( ✓ Paid ·84 )( — No dues ·0 )   │ │ ( ✓ Paid ·84 )( — No dues ·0 )   │
╰──────────────────────────────────╯ ╰──────────────────────────────────╯
 ↑ active pill = .neumo-raised        ↑ focused option = cyan 2px ring
   + flare glow (Unpaid = destructive)   + glow (§10.3 focus-visible)
 ↑ '▌' = 2px flare left-bar          ↑ Enter / Space activates the option
   (tab-underline-slide, §7.3)        ↑ Tab moves to next option
 ↑ 44px height per segment            ↑ Esc returns focus to the well

HOVER (on "Paid")                     ACTIVE (Partial pill pressed)
╭─ .neumo-inset well ──────────────╮ ╭─ .neumo-inset well ──────────────╮
│ ( ✕ Unpaid ·44)( ◐ Partial ·12 ) │ │ ( ✕ Unpaid ·44)( ═Partial·12═ ) │
│ (▌✓ Paid ·84 )( — No dues ·0 )   │ │ ( ✓ Paid ·84 )( — No dues ·0 )   │
╰──────────────────────────────────╯ ╰──────────────────────────────────╯
 ↑ hovered option = .neumo-raised      ↑ .neumo-pressed (inset 2px shadow
   extrudes up slightly                   + 1px translateY, §6.3)
 ↑ --text-secondary → --text-primary   ↑ 60ms haptic on mobile
   transition                          ↑ fires only while finger is down;
 ↑ cursor-pointer                        reverts on up if move > 8px
 ↑ segment count updates LIVE as          (drag-cancel)
   payments land (TanStack cache swap)

DISABLED (no students in tenant)
╭─ .neumo-inset well ──────────────╮
│ ( ░ ✕ ·0 )( ░ ◐ ·0 )( ░ ✓ ·0 )( ░ — ·0 )│
╰──────────────────────────────────╯
 ↑ opacity-40
 ↑ cursor-not-allowed
 ↑ --text-muted
 ↑ disabled while student count = 0 (empty-state composition takes over)
 ↑ aria-disabled="true" announced on each segment
```

> **References:** Apple HIG — *Segmented Controls* (canonical anatomy); Material Design 3 — *Tabs* (live-count badges are a Material convention); Nielsen Norman Group — *Filter Patterns for Complex Data* (segmented status filter with live counts is the canonical "filter-by-status" pattern); Smashing Magazine — *Designing Better Status Indicators* (the ✓/◐/✕/— iconography + colour + word triad); WCAG 2.1 AA §4.1.2 (each segment needs `role="radio"` + `aria-checked`); WCAG 2.1 AA §1.4.11 (Non-text Contrast — the neumorphic shadow must pair with the segment-accent glow + ✓/◐/✕/— icon, never shadow alone).

---

This screen is where Buddysaradhi earns its "Operating System" name. The ledger is the spine; the receipts are the artefacts; the matrix is the dashboard; the reminders are the heartbeat. Every other screen in the product reads from what is written here.
