# 04 — Dashboard

> The Dashboard is the truth of a tutor's business at one glance. No screen in Buddysaradhi has a stricter contract: every number is right, every pixel earns its place, every tap drills deeper. This is screen #1 of the five-screen doctrine.

---

## 1. Purpose

The Dashboard exists so that a tutor who opens Buddysaradhi at 6:47 PM, two minutes before their evening batch, can answer **six questions without scrolling**:

1. *How much money came in this month?*
2. *How much is still owed to me — ever, and this month?*
3. *How many students am I responsible for, and how many have outstanding dues?*
4. *Who paid, who didn't, who's partial?*
5. *Where is attendance thin — by student, by day?*
6. *What must I do **today** — which reminders, which missing attendance, which overdue fees?*

Beyond answering these questions, the Dashboard's second job is **navigation by drill-down**. Every number, every heatmap cell, every activity-feed row is a doorway into the screen that owns the underlying detail. The Dashboard is the index page of the tutor's business; it is never a terminal destination.

The Dashboard is also the **first thing a new tutor sees** after provisioning. Its empty state is a teaching moment (Principle 15), not a void.

---

## 2. Business Objective

The Dashboard's measurable objectives, in priority order:

| # | Objective | Success Metric |
|---|-----------|----------------|
| O1 | Reduce time-to-truth at app open | Median < 1.5 s from launch to "I know the state of my business." |
| O2 | Drive action on overdue fees & missing attendance | ≥ 40 % of reminders surfaced on Dashboard are acted-on (dismissed-after-action, snoozed, or drilled into) within the same session. |
| O3 | Lower minutes-per-day (Principle 12) | A typical tutor completes their "daily check" on the Dashboard in < 90 s. |
| O4 | Zero discrepancy vs. the ledger | Every KPI figure reconciles to `ledger_entries` and `attendance_records` to the minor unit / single record. Reconciliation is enforced by unit tests, not by good intentions. |
| O5 | Survive offline without losing usefulness | All KPI cards and both heatmaps render from the local SQLite replica with zero network calls. The only thing offline blocks is *freshness from other devices* — never the local truth. |

The Dashboard does **not** attempt to be a BI tool. There are no custom widgets, no configurable layouts, no drag-to-resize. The composition is fixed and intentional. Configuration is a v1.x concern (`15_Future_Roadmap.md`).

---

## 3. Navigation Entry

- **Sidebar item:** Dashboard (`LayoutDashboard` icon), `/` route, the default landing screen.
- **Keyboard:** `G D` (vim-style jump), or `Cmd/Ctrl+K` → "Go to Dashboard".
- **Deep-link:** `/?s=dashboard` (query-param form, since only `/` is exposed per project rule — see `02_Core_Logic.md` §5).
- **Auto-return:** After 5 min idle (per `settings.session_timeout_min`), if the app re-unlocks, it returns to the Dashboard rather than the last screen, so the tutor re-orients quickly.
- **Post-action landing:** Recording a payment, marking attendance, or generating a receipt from anywhere returns the user to the Dashboard, not the prior screen. This is the "Apple return-to-home after a meaningful action" inheritance.

---

## 4. User Story

> **As** a tutor managing 15–300 students,
> **when** I open Buddysaradhi,
> **I want** to see — in one screen, in short words and numbers — how much I've collected this month, how much is owed to me ever and this month, how many students I have and how many have dues, who's paid / partial / unpaid, where attendance is thin, and what I must do today,
> **so that** in under 90 seconds I know whether my business is healthy and what to act on first.
>
> **And** when I tap any number, cell, or feed row,
> **I want** to land in the screen that owns that detail — already filtered, already focused —
> **so that** I never have to re-navigate to the thing I was just looking at.

---

## 5. UX Principles

The Dashboard honours, in order:

- **P1 — Tutor is the user.** No student-facing widgets. The "activity feed" shows tutor-relevant events, not student progress.
- **P5 — Offline-first.** First paint is from local SQLite cache. Turso refresh is a background invalidation, never a render-blocking call.
- **P7 — Motion is meaning.** KPI count-up animation runs once per session per value-change; it communicates "this number just updated," not "look at the pretty number."
- **P8 — Density without clutter.** The KPI strip holds 6 cards in 1440 px without crowding; heatmaps show 30 days × N students in a single viewport via 12-px cells.
- **P12 — Tutor's time is the metric.** The Dashboard's purpose is to **lower** session time, not extend it. A tutor who closes the Dashboard in 60 s with confidence is a win.
- **P15 — Honest empty states.** A fresh tenant sees a designed welcome composition, never a grid of "0 / 0 / 0 / 0" cards.

---

## 6. Screen Layout

### 6.1 Composition (1440 × 900 desktop viewport)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Topbar: My Tuition  │  🔍 Search…  │  [Sept 2025 ▾]  │  🔔 3  │  👤 R        │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─── KPI Strip (6 cards, 3 × 2 grid) ────────────────────────────────────┐  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐                          │  │
│  │  │ COLLECTED  │ │ DUE TILL   │ │ DUE MONTH  │                          │  │
│  │  │ THIS MONTH │ │ DATE       │ │            │                          │  │
│  │  │ ₹ 1,24,500 │ │ ₹ 38,200   │ │ ₹ 14,500   │                          │  │
│  │  │ ↑ 18% vs Aug│ │ 12 students│ │ 5 students │                          │  │
│  │  │ [sparkline]│ │            │ │            │                          │  │
│  │  └────────────┘ └────────────┘ └────────────┘                          │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐                          │  │
│  │  │ TOTAL      │ │ STUDENTS   │ │ PAYMENT    │                          │  │
│  │  │ STUDENTS   │ │ WITH DUES  │ │ BREAKDOWN  │                          │  │
│  │  │ 87         │ │ 12         │ │ ●42 ●8 ●12 │                          │  │
│  │  │ 5 batches  │ │ ↑ 2 vs Aug │ │ paid part  │                          │  │
│  │  │            │ │            │ │ unpaid     │                          │  │
│  │  └────────────┘ └────────────┘ └────────────┘                          │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌─── Heatmaps Row (2 cards, 1 × 2 grid) ─────────────────────────────────┐  │
│  │  ┌── Attendance Heatmap ─────┐  ┌── Payment Heatmap ─────┐              │  │
│  │  │ Students × last 30 days   │  │ Students × 4 weeks     │              │  │
│  │  │ ▓▓░▓▓▓░▓▓▓▓░▓▓▓░▓▓▓▓▓░▓▓  │  │ ▓░░▓  ▓▓▓░  ░▓▓▓  ▓░▓░  │              │  │
│  │  │ ▓▓▓▓▓▓▓▓░▓▓▓▓▓▓▓░▓▓▓▓▓▓  │  │ ▓▓▓▓  ░░▓▓  ▓▓▓░  ▓▓▓▓  │              │  │
│  │  │ ▓▓▓░▓▓▓▓▓▓▓▓▓░▓▓▓▓▓▓▓▓▓  │  │ ░▓▓░  ▓▓░░  ▓░░▓  ▓▓░░  │              │  │
│  │  │ …                         │  │ …                      │              │  │
│  │  │ (click cell → Attendance) │  │ (click cell → Fees)    │              │  │
│  │  └───────────────────────────┘  └────────────────────────┘              │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌─── Activity Feed ──────────────┐  ┌─── Due Today (Reminders) ──────┐    │
│  │ 09/28 18:32  ₹3,500 received   │  │ ⚠ 4 students — fee due today   │    │
│  │              from A. Sharma    │  │   A. Sharma · ₹2,500 · INV-0017│    │
│  │              [→ Fees]          │  │   P. Iyer   · ₹1,200 · INV-0023│    │
│  │ 09/28 18:10  Batch 10-Maths    │  │   …                            │    │
│  │              attendance locked │  │ ⚠ Batch 9-Sci — attendance     │    │
│  │              [→ Attendance]    │  │   missing for today            │    │
│  │ 09/28 17:45  New student added │  │ ⚠ 2 students inactive 14d      │    │
│  │              R. Pillai (10-C)  │  │   [Remind all]  [Snooze all]   │    │
│  │              [→ Students]      │  └────────────────────────────────┘    │
│  │ …                              │                                        │
│  └────────────────────────────────┘                                        │
│                                                                              │
│  ┌─── Quick Actions (sticky bottom of content pane) ──────────────────────┐  │
│  │  [+ Record Payment]   [+ Mark Attendance]   [+ Add Student]            │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
│  Footer: ● Online · synced 2m ago    v1.0.0+abc1234    © Buddysaradhi Omni-Core  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Card Catalogue

| # | Card | Size (desktop) | Position | Source |
|---|------|----------------|----------|--------|
| C1 | Collected This Month | 1 of 6 in KPI strip | row-1, col-1 | `ledger_entries` BR-CALC-10 (`collectedForMonth` tenant rollup) |
| C2 | Arrears This Month | 1 of 6 | row-1, col-2 | BR-CALC-11 (`arrearsForMonth` = expected − collected − waivers) |
| C3 | Expected This Month | 1 of 6 | row-1, col-3 | `students.monthly_fee_paise` sum BR-CALC-09 (`expectedThisMonthAcrossTenant`) |
| C4 | Total Students | 1 of 6 | row-2, col-1 | `students` count |
| C5 | Students With Dues | 1 of 6 | row-2, col-2 | derived from BR-CALC-01 |
| C6 | Payment Breakdown | 1 of 6 | row-2, col-3 | derived from BR-CALC-02 |
| H1 | Attendance Heatmap | half-width | row-3 | `attendance_records` BR-CALC-07 |
| H2 | Payment Heatmap | half-width | row-3 | `invoices` + `ledger_entries` BR-CALC-08 |
| AF | Activity Feed | 60 % width | row-4 | `notifications` + recent ledger/attendance/student rows |
| DT | Due Today | 40 % width | row-4 | `reminders` (BR-RPT-01..R05) |
| QA | Quick Actions | full-width sticky | row-5 | static CTAs |

### 6.3 Responsive Behaviour

- **< 640 px (base):** KPI strip becomes a horizontal scroll of 6 cards, 280 px each, snap-scroll. Heatmaps stack vertically with horizontal pan. Activity feed and Due Today stack. Quick Actions become a floating bottom bar above the safe-area footer.
- **640–1023 px (sm–md):** KPI strip 2 × 3. Heatmaps stack. AF + DT side-by-side at 60/40.
- **1024–1279 px (lg):** KPI 3 × 2. Heatmaps side-by-side.
- **≥ 1280 px (xl):** Full composition above, max-width 1440 px, gutter 32 px.
- **≥ 1536 px (2xl):** KPI strip becomes 6 × 1 single row (saves vertical space); heatmaps and lower row stretch to 1440 px with the gutter.

### 6.4 Date Filter (Topbar Chip)

The chip `[Sept 2025 ▾]` opens a popover with three modes:

- **Month** — single calendar month (default: current local month).
- **Range** — arbitrary start–end (max 90 days for performance).
- **All** — all-time view.

The filter affects: C1 (Collected This Month → "Collected In Period"), C3 (Due For Month → "Due For Period"), H1 (heatmap date axis), H2 (heatmap week axis), and AF (activity feed window). It does **not** affect C2 (Due Till Date — that is definitionally all-time), C4 (Total Students — current count), C5 (Students With Dues — current snapshot), or C6 (Payment Breakdown — current snapshot). These exclusions are surfaced as muted helper text inside the card itself ("All-time, ignores filter") so the tutor never wonders why the number didn't move.

---

## 7. Component Tree

```ts
// src/app/(shell)/dashboard/DashboardPage.tsx
import type { PeriodFilter, StudentBalanceStatus } from '@buddysaradhi/shared';

export interface DashboardKpiSnapshot {
  collectedThisMonthMinor: number;        // BR-CALC-03
  collectedPrevPeriodMinor: number;       // for delta %
  dueTillDateMinor: number;               // BR-CALC-04
  dueForMonthMinor: number;               // BR-CALC-05
  totalStudents: number;
  studentsWithDues: number;
  studentsWithDuesPrevPeriod: number;     // for delta
  paymentBreakdown: { paid: number; partial: number; unpaid: number; noDues: number };
  periodLabel: string;                    // "September 2025"
  generatedAt: string;                    // ISO, for "as of" caption
  source: 'cache' | 'remote';             // drives skeleton vs final
}

export interface AttendanceHeatmapCell {
  studentId: string;
  studentName: string;
  date: string;                           // ISO date
  status: 'present' | 'absent' | 'late' | 'excused' | 'holiday' | null;
  sessionId?: string;
}

export interface PaymentHeatmapCell {
  studentId: string;
  studentName: string;
  weekStart: string;                      // ISO Monday date
  status: 'paid' | 'partial' | 'unpaid' | 'no_due';
  invoiceIds: string[];
  amountMinor: number;
}

export interface ActivityFeedItem {
  id: string;
  category: 'ledger' | 'attendance' | 'student' | 'system';
  title: string;
  subtitle?: string;
  amountMinor?: number;
  occurredAt: string;
  drillTarget: { screen: 'fees' | 'attendance' | 'students'; params: Record<string, string> };
}

export interface DueTodayReminder {
  id: string;
  category: 'due_fee' | 'upcoming_due' | 'missing_attendance' | 'inactive_student';
  title: string;
  subtitle?: string;
  amountMinor?: number;
  dueAt: string;
  status: 'pending' | 'snoozed' | 'dismissed' | 'acted';
  drillTarget: { screen: 'fees' | 'attendance' | 'students'; params: Record<string, string> };
}

// ─── Tree ────────────────────────────────────────────────────────────────
<DashboardPage>
  <DashboardHeader>                       // period chip, "as of" caption, refresh button
    <PeriodFilterChip />
    <AsOfCaption />
    <RefreshButton />
  </DashboardHeader>

  <KpiStrip>                              // grid 3×2 or 6×1
    <KpiCard name="collected-this-month" …/>
    <KpiCard name="due-till-date"        …/>
    <KpiCard name="due-for-month"        …/>
    <KpiCard name="total-students"       …/>
    <KpiCard name="students-with-dues"   …/>
    <PaymentBreakdownCard …/>
  </KpiStrip>

  <HeatmapRow>
    <AttendanceHeatmapPanel>
      <HeatmapAxisX dates={Date[]} />
      <HeatmapAxisY students={Student[]} />
      <HeatmapGrid cells={AttendanceHeatmapCell[]} />
      <HeatmapLegend />
    </AttendanceHeatmapPanel>
    <PaymentHeatmapPanel>
      <HeatmapAxisX weeks={WeekStart[]} />
      <HeatmapAxisY students={Student[]} />
      <HeatmapGrid cells={PaymentHeatmapCell[]} />
      <HeatmapLegend />
    </PaymentHeatmapPanel>
  </HeatmapRow>

  <LowerRow>
    <ActivityFeedPanel items={ActivityFeedItem[]} />
    <DueTodayPanel reminders={DueTodayReminder[]} />
  </LowerRow>

  <QuickActionsBar>
    <QuickAction label="Record Payment" icon="Wallet"    onClick={openPaymentSheet} />
    <QuickAction label="Mark Attendance" icon="CalendarCheck" onClick={openAttendanceScreen} />
    <QuickAction label="Add Student"     icon="UserPlus" onClick={openStudentSheet} />
  </QuickActionsBar>

  <DashboardEmptyState />                 // shown when totalStudents === 0
  <DashboardSkeleton />                   // shown on first paint before cache resolves
</DashboardPage>
```

### 7.1 Component Prop Contracts

```ts
interface KpiCardProps {
  name: string;
  label: string;                          // "COLLECTED THIS MONTH"
  valueMinor?: number;                    // money cards
  valueCount?: number;                    // count cards
  deltaPct?: number;                      // signed, drives ↑/↓ + color
  deltaLabel?: string;                    // "vs last month"
  caption?: string;                       // "All-time, ignores filter"
  accent: 'emerald' | 'cyan' | 'flare' | 'amber' | 'violet';
  spark?: number[];                       // optional sparkline data
  drillTarget?: { screen: string; params: Record<string, string> };
  loading?: boolean;
  empty?: boolean;
}

interface HeatmapCellProps {
  color: string;                          // resolved from BR-CALC-07/08
  label: string;                          // sr-only text fallback
  tooltip: ReactNode;
  onClick?: () => void;
  size: 'sm' | 'md';                      // 12px or 16px
}

interface DashboardSkeletonProps {
  variant: 'first-paint' | 'period-change';
}
```

---

## 8. State Management

### 8.1 Zustand Slice — `useDashboardStore`

The Dashboard owns one Zustand slice for UI-only state. All server-state is TanStack Query.

```ts
// src/stores/dashboard-store.ts
interface DashboardState {
  periodFilter: PeriodFilter;             // mirror of shell.periodFilter; Dashboard reads only
  heatmapMode: 'attendance' | 'payment';  // mobile: tab between two heatmaps
  activityFeedScrollY: number;            // persisted for return-to-position
  dueTodayExpanded: boolean;
  lastRefreshedAt: string | null;
  setPeriodFilter: (p: PeriodFilter) => void;
  setHeatmapMode: (m: 'attendance' | 'payment') => void;
  markRefreshed: () => void;
}
```

`periodFilter` changes propagate to the shell store (`shell.periodFilter`), so the Fees and Attendance screens also react when the tutor returns to them. The Dashboard never mutates shell state directly except via `setPeriodFilter`.

### 8.2 TanStack Query Keys

```ts
// All Dashboard queries share the ['dashboard'] namespace for invalidation.
const kpiQueryKey       = ['dashboard', 'kpi',         periodFilter] as const;
const attendanceHeatKey = ['dashboard', 'heatmap', 'attendance', periodFilter] as const;
const paymentHeatKey    = ['dashboard', 'heatmap', 'payment',    periodFilter] as const;
const activityFeedKey   = ['dashboard', 'activity',                periodFilter] as const;
const dueTodayKey       = ['dashboard', 'due-today']                            as const; // always all-time
```

- `staleTime: 30_000` — Dashboard tolerates 30 s staleness; refetch on focus.
- `gcTime: 5 * 60_000` — keep cached data for 5 min after unmount, so returning is instant.
- `refetchOnWindowFocus: 'always'` — but only invalidates; first paint is from cache.
- `retry: 1` on failure; the local cache is the truth, so a network retry is rarely useful.

### 8.3 Invalidation Subscribers

The Dashboard listens to the cross-engine event bus (`02_Core_Logic.md` §8):

```ts
// On 'LEDGER_MUTATED'  → invalidate kpiQueryKey, paymentHeatKey, activityFeedKey, dueTodayKey
// On 'ATTENDANCE_LOCKED' → invalidate attendanceHeatKey, activityFeedKey, dueTodayKey
// On 'SYNC_COMPLETED'   → invalidate all five keys
// On 'REMINDER_DUE'     → invalidate dueTodayKey only
```

Invalidation does not force a refetch if the tab is hidden — TanStack's default `refetchOnMount` handles this when the user returns.

### 8.4 Count-up Animation State

KPI numbers animate from previous cached value → new value over 400 ms (per `13_UI_Guidelines.md` §7.3 `kpi-count-up`). The previous value is stored in a `useRef` populated from the previous query snapshot. Animation is **disabled** when:

- `prefers-reduced-motion` is set.
- The previous value is `undefined` (first paint shows the final number with a 120 ms fade-in instead).
- The delta is zero (no animation; just a steady render).
- The component is hidden (document.hidden) — the number jumps to the final value when the user returns.

---

## 9. Database Operations

All queries run against the **local** Prisma client (`import { db } from '@/lib/db'`). `tenant_id` is bound from the Turso JWT claim, never from user input. Money is integer minor units. **No raw SQL** — every query uses Prisma ORM methods (`findMany`, `aggregate`, `groupBy`, `count`).

### 9.1 KPI Snapshot — single Prisma round-trip, six of the seven numbers

```ts
// src/lib/queries/dashboard-kpi.ts
// Computes C1, C2, C3, C4, C5, C6 via parallel Prisma calls.

const [activeStudents, balances, collected, dueForMonth] = await Promise.all([
  // C4: total active students
  db.student.count({
    where: { tenantId, status: 'active', archivedAt: null },
  }),

  // BR-CALC-01 per student — current balances (uses trigger-maintained cache)
  db.ledgerEntry.findMany({
    where: { tenantId, type: { not: 'VOID' }, reversesEntryId: null,
             student: { status: 'active', archivedAt: null } },
    orderBy: { createdAt: 'desc' },
    distinct: ['studentId'],
    select: { studentId: true, balanceAfterPaise: true, direction: true, amount: true },
  }),

  // C1: collected this month (BR-CALC-03)
  db.ledgerEntry.aggregate({
    where: { tenantId, type: 'PAYMENT_RECEIVED', direction: 'credit',
             occurredOn: { gte: monthStart, lte: monthEnd } },
    _sum: { amount: true },
  }),

  // C3: due for month (BR-CALC-05)
  db.invoice.aggregate({
    where: { tenantId, issueDate: { gte: monthStart, lte: monthEnd },
             status: { in: ['unpaid', 'partial', 'overdue'] } },
    _sum: { total: true },
  }),
]);

const totalStudents = activeStudents;
const collectedThisMonthMinor = collected._sum.amount ?? 0;
const dueForMonthMinor = dueForMonth._sum.total ?? 0;
const balanceMap = new Map(balances.map(b => [b.studentId, b.balanceAfterPaise]));
const dueTillDateMinor = Array.from(balanceMap.values()).reduce((a, b) => a + Math.max(b, 0), 0);
const studentsWithDues = Array.from(balanceMap.values()).filter(b => b > 1).length;

// C6: payment breakdown — paid / partial / unpaid by joining balances to invoices
const invoiceAgg = await db.invoice.groupBy({
  by: ['studentId'],
  where: { tenantId, status: { in: ['unpaid', 'partial', 'overdue'] } },
  _max: { total: true },
});
const paidCount = invoiceAgg.filter(i => (balanceMap.get(i.studentId) ?? 0) <= 1).length;
const partialCount = invoiceAgg.filter(i => {
  const bal = balanceMap.get(i.studentId) ?? 0;
  return bal > 1 && bal < (i._max.total ?? 0);
}).length;
const unpaidCount = invoiceAgg.filter(i => {
  const bal = balanceMap.get(i.studentId) ?? 0;
  return bal >= (i._max.total ?? 0);
}).length;
```

The result is post-processed in TypeScript: `noDues = totalStudents - paid - partial - unpaid`. The `noDues` count is never read from a query to avoid drift if a student has no invoices yet.

### 9.2 Prev-Period Delta (for the C1 ↑18 % caption)

```ts
// Same shape as C1 but with periodStart = previous month.
const prev = await db.ledgerEntry.aggregate({
  where: { tenantId, type: 'PAYMENT_RECEIVED', direction: 'credit',
           occurredOn: { gte: prevStart, lte: prevEnd } },
  _sum: { amount: true },
});
const collected_prev_minor = prev._sum.amount ?? 0;
```

Delta % = `((curr - prev) / MAX(prev, 1)) * 100`, clamped to ±999 %, signed, displayed with ↑/↓.

### 9.3 Attendance Heatmap (H1) — BR-CALC-07

```ts
const [attendance, holidays] = await Promise.all([
  db.attendanceRecord.findMany({
    where: {
      session: { tenantId, sessionDate: { gte: periodStart, lte: periodEnd } },
      status: { not: 'holiday' },
    },
    include: {
      student: { select: { id: true, firstName: true, lastName: true } },
      session: { select: { sessionDate: true } },
    },
    orderBy: [{ student: { firstName: 'asc' } }, { session: { sessionDate: 'asc' } }],
  }),

  // Holiday lookup: locked sessions with no attendance records for an active batch
  db.attendanceSession.findMany({
    where: {
      tenantId,
      lockedAt: { not: null },
      sessionDate: { gte: periodStart, lte: periodEnd },
      attendanceRecords: { none: {} },
      batch: { archivedAt: null },
    },
    select: { sessionDate: true, batchId: true },
  }),
]);
```

Result is pivoted in TypeScript into `AttendanceHeatmapCell[]` keyed by `(studentId, date)`. Missing cells render as empty (no session). Holiday cells render as the violet-stripe variant per `BR-CALC-07`.

### 9.4 Payment Heatmap (H2) — BR-CALC-08

```ts
// Pull invoices in the period + the per-invoice paid amount in one round-trip.
const invoices = await db.invoice.findMany({
  where: {
    tenantId,
    issueDate: { gte: periodStart, lte: periodEnd },
    status: { not: 'void' },
  },
  include: {
    student: { select: { id: true, firstName: true, lastName: true } },
    ledgerEntries: {
      where: { type: 'PAYMENT_RECEIVED', direction: 'credit',
               type: { not: 'VOID' }, reversesEntryId: null },
      select: { amount: true },
    },
  },
});
// TS buckets each invoice by ISO week (Monday start) and computes per-cell:
//   due_minor   = SUM(invoice.total)
//   paid_minor  = SUM(ledgerEntries.amount)
//   cell_status = 'paid' | 'partial' | 'unpaid' | 'no_due'  (per BR-M-05 tolerance)
```

The TypeScript layer joins this with the active-student roster so students with no invoices in a week still appear as `no_due` cells — preserving grid alignment.

### 9.5 Activity Feed (AF)

```ts
// Three parallel findMany calls; merged + sorted in TS.
const [ledgerRows, lockedSessions, newStudents] = await Promise.all([
  // Recent ledger entries (payments + voids + charges + discounts)
  db.ledgerEntry.findMany({
    where: {
      tenantId,
      type: { in: ['PAYMENT_RECEIVED', 'VOID', 'FEE_CHARGED', 'DISCOUNT_GRANTED'] },
      occurredOn: { gte: periodStart, lte: periodEnd },
    },
    include: {
      student: { select: { id: true, firstName: true, lastName: true } },
      receipt: { select: { number: true } },
      invoice: { select: { number: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  }),

  // Recent attendance locks
  db.attendanceSession.findMany({
    where: { tenantId, lockedAt: { gte: periodStart } },
    include: { batch: { select: { id: true, name: true } } },
    orderBy: { lockedAt: 'desc' },
    take: 10,
  }),

  // Recent student additions
  db.student.findMany({
    where: { tenantId, createdAt: { gte: periodStart } },
    select: { id: true, createdAt: true, firstName: true, lastName: true, grade: true, code: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  }),
]);
```

The three result sets are merged in TypeScript, sorted by `occurredAt DESC`, truncated to 25 items, and mapped to `ActivityFeedItem[]`. Each item's `drillTarget` is built deterministically (e.g., a payment row → `{ screen: 'fees', params: { studentId, ledgerEntryId } }`).

### 9.6 Due Today (DT) — Reminder Engine read

```ts
const reminders = await db.reminder.findMany({
  where: {
    tenantId,
    status: 'pending',
    dueAt: { lte: nowIso },
    OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: nowIso } }],
  },
  orderBy: [
    // category ranking: due_fee=1, missing_attendance=2, upcoming_due=3, inactive_student=4
    { category: 'asc' },  // engine post-sorts by category enum order
    { dueAt: 'asc' },
  ],
  take: 50,
});
```

For each reminder row, the TypeScript layer hydrates a human-readable title and subtitle:

- `due_fee` → fetch `fee_schedule_items.label` + `invoices.total` for `ref_id` (invoice id).
- `upcoming_due` → same as `due_fee` but with "Due in N days" caption.
- `missing_attendance` → fetch `batches.name` for `ref_id` (batch id).
- `inactive_student` → fetch `students.first_name + last_name` for `ref_id` (student id).

Hydration is batched into a single SQL `IN (?)` query per ref_type to avoid N+1.

### 9.7 Refresh Trigger Map

| Trigger | KPI | H1 | H2 | AF | DT |
|---------|:---:|:--:|:--:|:--:|:--:|
| Period filter change | ● | ● | ● | ● | — |
| `LEDGER_MUTATED` event | ● | — | ● | ● | ● |
| `ATTENDANCE_LOCKED` event | — | ● | — | ● | ● |
| `SYNC_COMPLETED` event | ● | ● | ● | ● | ● |
| `REMINDER_DUE` event | — | — | — | — | ● |
| Manual refresh button | ● | ● | ● | ● | ● |
| Window focus (after 30 s stale) | ● | ● | ● | ● | ● |

---

## 10. Business Rules

The Dashboard cites and enforces the following BR-IDs from `12_Business_Rules.md`:

| BR-ID | Title | Dashboard Enforcement |
|-------|-------|------------------------|
| **BR-M-01** | Integer Minor Units | All money values rendered via `formatCurrency(minor, locale)` → `₹ 1,24,500`. No float math anywhere in the Dashboard code path. |
| **BR-M-05** | Rounding Tolerance | "Paid" status uses the 1-minor-unit tolerance. The KPI SQL uses `balance_due_minor > 1` for "has dues" to avoid a 1-paise rounding showing as a due. |
| **BR-CALC-01** | Student Balance Due | C5 (Students With Dues) is `COUNT(*) WHERE balance_due_minor > 1`. |
| **BR-CALC-02** | Student Payment Status | C6 (Payment Breakdown) reads `paid / partial / unpaid / noDues` per student, summed across the roster. |
| **BR-CALC-03** | Monthly Collected | C1 (Collected This Month) — direct SQL aggregate over `PAYMENT_RECEIVED`. |
| **BR-CALC-04** | Total Due Till Date | C2 — sum of all active-student balances, all-time, ignores period filter. |
| **BR-CALC-05** | Total Due For Month | C3 — sum of `invoices.total` where issue_date in period and status is unpaid/partial/overdue. |
| **BR-CALC-07** | Attendance Heatmap Cell | H1 cell color = `present→emerald`, `absent→flare`, `late→amber`, `excused→muted violet`, `holiday→cyan stripe`, `null→empty`. |
| **BR-CALC-08** | Payment Heatmap Cell | H2 cell color = `paid→emerald`, `partial→amber`, `unpaid→flare`, `no_due→muted`. |
| **BR-RPT-01** | Due Fee Reminder | DT panel surfaces these first, in red. |
| **BR-RPT-02** | Upcoming Due Reminder | DT panel surfaces these as amber, below the overdue ones. |
| **BR-RPT-03** | Missing Attendance Reminder | DT panel surfaces these as amber, batched by batch name. |
| **BR-RPT-04** | Inactive Student Reminder | DT panel surfaces these as muted, weekly. |
| **BR-RPT-05** | Snooze Semantics | DT panel "Snooze all" applies the user's default snooze (today-EOD) to all selected; "Dismiss all" marks all as `dismissed` with a typed-confirm for bulk action. |

### 10.1 KPI Card Reference (Canonical Definitions)

Each card below is specified with: **name · formula · source · refresh trigger · empty state · drill-down target**.

#### C1 — Collected This Month
- **Formula:** `Σ(amount) WHERE type='PAYMENT_RECEIVED' AND direction='credit' AND occurred_on ∈ [monthStart, monthEnd]` (BR-CALC-03).
- **Source:** `ledger_entries`.
- **Refresh:** period change, `LEDGER_MUTATED`, `SYNC_COMPLETED`, manual.
- **Empty state:** "₹ 0" in emerald; caption "No payments recorded in September 2025 yet." Sparkline shows the previous 6 months for context.
- **Drill-down:** → Fees screen, filtered to `payments-only`, `period = current month`.

#### C2 — Due Till Date
- **Formula:** `Σ balance_due_minor` across all active students (BR-CALC-04 + BR-CALC-01).
- **Source:** derived from `ledger_entries`.
- **Refresh:** `LEDGER_MUTATED`, `SYNC_COMPLETED`, manual. **Not** affected by period filter.
- **Empty state:** "₹ 0" in emerald; caption "Every active student is settled."
- **Drill-down:** → Fees screen, unfiltered (shows the full ledger matrix).

#### C3 — Due For Month
- **Formula:** `Σ(invoices.total) WHERE issue_date ∈ period AND status IN ('unpaid','partial','overdue')` (BR-CALC-05).
- **Source:** `invoices`.
- **Refresh:** period change, `LEDGER_MUTATED`, `SYNC_COMPLETED`, manual.
- **Empty state:** "₹ 0" in emerald; caption "No outstanding invoices issued this period."
- **Drill-down:** → Fees screen, filtered to `status=unpaid,partial,overdue`, `issue_date = current month`.

#### C4 — Total Students
- **Formula:** `db.student.count({ where: { status: 'active', archivedAt: null } })`.
- **Source:** `students`.
- **Refresh:** `LEDGER_MUTATED` (no-op), student create/archive, `SYNC_COMPLETED`.
- **Empty state:** "0" → entire Dashboard switches to empty-state composition (§6.4 / §15 honest empty state).
- **Drill-down:** → Students screen, unfiltered.

#### C5 — Students With Dues
- **Formula:** count of students whose trigger-maintained `balance_after_paise > 1` (BR-CALC-01 + BR-M-05).
- **Source:** derived from `ledger_entries`.
- **Refresh:** `LEDGER_MUTATED`, `SYNC_COMPLETED`, manual.
- **Empty state:** "0" in emerald; caption "All settled." + delta caption "↓ 2 vs August" in emerald.
- **Drill-down:** → Students screen, filtered to `has-dues = true`.

#### C6 — Payment Breakdown
- **Formula:** per-student classification per BR-CALC-02, summed: `paid / partial / unpaid / noDues`.
- **Source:** derived from `ledger_entries` + `invoices`.
- **Refresh:** `LEDGER_MUTATED`, `SYNC_COMPLETED`.
- **Empty state:** all four dots in muted; caption "Add students to see breakdown."
- **Drill-down:** tapping a colored dot → Fees screen filtered to that status (e.g., `status=partial`).

### 10.2 Heatmap Cell Color Mapping

Per `13_UI_Guidelines.md` §2.4 (Status → Accent Mapping) and §8.12 (Heatmap Cell), and BR-CALC-07/08:

**Attendance (H1):**
| Status | Cell Color | Icon (for color-blind) | Tooltip |
|--------|-----------|------------------------|---------|
| present | `#00FF9D` emerald, filled | ✓ | "A. Sharma · 28 Sep · Present" |
| absent | `#FF5E00` flare, filled | ✕ | "A. Sharma · 28 Sep · Absent" |
| late | `#FFB300` amber, filled | ◐ | "A. Sharma · 28 Sep · Late" |
| excused | muted violet `rgba(179,136,255,0.4)` | – | "A. Sharma · 28 Sep · Excused" |
| holiday | cyan diagonal stripe `#00F0FF` | H | "Batch 10-Maths · 28 Sep · Holiday" |
| (none) | `rgba(255,255,255,0.04)` empty | (empty) | "No session" |

**Payment (H2):**
| Status | Cell Color | Tooltip |
|--------|-----------|---------|
| paid | `#00FF9D` emerald | "A. Sharma · Week of Sep 22 · ₹ 3,500 paid in full" |
| partial | `#FFB300` amber | "A. Sharma · Week of Sep 22 · ₹ 1,200 of ₹ 2,500" |
| unpaid | `#FF5E00` flare | "A. Sharma · Week of Sep 22 · ₹ 2,500 unpaid" |
| no_due | muted `rgba(255,255,255,0.04)` | "A. Sharma · Week of Sep 22 · No invoice" |

### 10.3 Heatmap Click Behaviour

- **H1 cell click (non-empty):** → Attendance screen, params `{ date: <iso>, batchId: <resolved from session> }`. The Attendance screen opens with that date selected and that batch's grid in focus.
- **H1 holiday cell click:** → Attendance screen, params `{ date: <iso> }`, with a toast "This date is marked as a holiday for batch X."
- **H1 empty cell click:** no-op (no session existed; nothing to drill to).
- **H2 cell click (non-`no_due`):** → Fees screen, params `{ studentId, weekStart }`. The Fees screen opens with that student selected and the ledger filtered to that week.
- **H2 `no_due` cell click:** → Fees screen, params `{ studentId }` (no week filter), with a toast "No invoices issued for this student in the week of <date>."

### 10.4 Activity Feed Tap Targets

Each feed row's tap target resolves to its `drillTarget`. Long-press opens a context menu with "Copy details" and (for payment rows) "View receipt".

### 10.5 Due Today Panel Actions

- **Single reminder tap:** → drill target (Fees/Attendance/Students with appropriate filter).
- **"Snooze" button (per row):** cycles snooze options: Today EOD → 3 days → Dismiss (BR-RPT-05).
- **"Remind all" button:** opens a sheet to broadcast reminders via WhatsApp share-sheet (in v1, the tutor taps "Share" and the system share sheet opens with a pre-filled message; no in-app SMS in v1).
- **"Snooze all" button:** applies Today-EOD snooze to all pending reminders; requires typed "SNOOZE" confirm if > 5 reminders affected (bulk-action defence per `13_UI_Guidelines.md` §15.3 Typed Confirmations + §17 Rule 14).
- **"Dismiss all" button:** marks all as dismissed; requires typed "DISMISS" confirm.

---

## 11. Edge Cases

| # | Scenario | Behaviour |
|---|----------|-----------|
| E1 | Brand-new tenant, 0 students | Dashboard renders the empty-state composition (§15). All KPI cards show 0 with explanatory captions; heatmaps show only the axis (no rows); AF shows the seeded "Welcome to Buddysaradhi" notification; DT panel is hidden; Quick Actions bar emphasises "+ Add Student" with emerald glow. |
| E2 | 1 student, no fee plan, no attendance | KPIs render (C4=1, others 0). Heatmaps show one row with empty cells. AF shows the "Student added" event. |
| E3 | Period filter = "All" | C1 becomes "Collected (all-time)"; C3 becomes "Due (all-time, open invoices)". Sparkline on C1 hides (no comparable previous period). |
| E4 | Period filter = range > 90 days | Filter popover rejects with toast "Range cannot exceed 90 days. Use Reports for longer ranges." |
| E5 | Period filter = future month | C1 = 0 (no payments yet); C3 shows invoices issued in that future month (rare but possible if tutor pre-issues). Sparkline renders up to that month. |
| E6 | Student archived mid-period | C2/C4 exclude them. C3 still counts invoices they owe (BR-STU-01: archived students' dues remain collectable). AF shows the archive event. Heatmaps retain their historical cells. |
| E7 | Payment voided mid-session | C1 decreases by the voided amount on next refresh; C5 may increase if the student now has dues; AF shows the void event; DT may surface a new due_fee reminder. |
| E8 | Currency mismatch (shouldn't happen, but defence) | If `settings.currency_code` changes (impossible per BR-M-02 after first ledger entry, but guarded), all Dashboard amounts re-render with the new symbol. The internal minor units are unchanged. |
| E9 | Clock skew on device | All date filtering uses server-time from Turso sync metadata on `SYNC_COMPLETED`. If the device clock is wrong, the period filter still works because the bounds are explicit ISO strings, not "today" computations. |
| E10 | 300+ students | Heatmaps become scrollable (vertical) with sticky first column. KPI queries are O(N) but indexed; render under 200 ms from cache (§17). |
| E11 | Tutor deletes the seeded "Default Batch" | No Dashboard impact; heatmaps simply show no sessions for that batch. |
| E12 | Reminder references an archived student (race) | Hydration fetch returns NULL; the reminder is auto-marked `dismissed` with audit log "stale reminder". |

---

## 12. Offline Behaviour

- **First paint:** always from local SQLite cache. No spinner. If cache is empty (cold install, no sync yet), the empty-state composition renders.
- **Refresh button:** triggers a local re-query (instant) + a background sync if online. If offline, the refresh button shows a 1.5 s "Offline — showing cached" toast and does not error.
- **Heatmap cells:** all rendered from local replica. A small "cached N min ago" caption appears under each heatmap header when the data is > 5 min stale.
- **Activity feed:** local-only events (recent local ledger entries, local attendance locks) appear immediately. Sync-sourced events appear after `SYNC_COMPLETED`.
- **Due Today panel:** purely local derivation from the Reminder Engine, which runs on app foreground + every 15 min while open (`02_Core_Logic.md` §3.2). Works fully offline.
- **Network indicator:** the footer shows "Offline · N pending" where N is `sync_outbox` pending count. The Dashboard itself does not duplicate this indicator (DRY with footer).
- **Optimistic updates:** recording a payment from Quick Actions optimistically updates C1, C5, C6, H2, AF, and DT before the ledger write commits. Rollback with toast on failure.

---

## 13. Sync Behaviour

- **Sync trigger:** app foreground (after 30 s), manual sync button in Sync drawer, and on any `LEDGER_MUTATED` event with `source='sync'`.
- **Conflict resolution:** per `12_Business_Rules.md` §8 — LWW for non-ledger, conflict-immune for ledger. The Dashboard never sees conflicts directly; they surface in the Sync drawer.
- **Post-sync invalidation:** `SYNC_COMPLETED` invalidates all five Dashboard query keys. Refetch runs in background; UI shows the cached values until new data arrives, then the count-up animation triggers if values changed.
- **Schema drift:** if `app_state.schema_version` < server, the Dashboard renders normally from local cache but the footer shows "Update required to sync." The Dashboard does not block.
- **Partial sync (some tables synced, some not):** the Dashboard queries are atomic per query; a half-synced state is impossible because each query reads from a consistent local snapshot. The only artifact is that the AF may show events slightly out of order if sync arrived in chunks — accepted.

---

## 14. Validation Rules

The Dashboard performs **no user-input validation** directly — it has no forms. However, it validates its own data shape:

| Rule | Enforcement |
|------|-------------|
| KPI snapshot must be non-null | Zod schema `DashboardKpiSnapshotSchema`; failure → fall back to last good cache + toast "Couldn't refresh KPIs." |
| Money fields ≥ 0 | Zod `.nonnegative()`. A negative `collectedThisMonthMinor` is a P1 bug (would indicate a `PAYMENT_RECEIVED` with negative amount, which violates BR-M-03). |
| Counts ≥ 0 and ≤ 10⁶ | Sanity bound. |
| Heatmap cell `status` ∈ enum | Zod enum; unknown values render as empty cell with audit log `dashboard_unknown_cell_status`. |
| Period filter start ≤ end | Enforced in the filter popover before dispatch. |
| `tenant_id` matches JWT claim | Enforced at the query layer (`02_Core_Logic.md`); Dashboard code never reads `tenant_id` from user input. |

---

## 15. Security Rules

The Dashboard is **read-only** — it has no mutations of its own. Therefore:

- **No sensitive-mutation PIN** is ever required on the Dashboard (per `10_Security.md` §4 — the list of PIN-required actions does not include "view").
- **Tenant isolation:** every query binds `tenant_id = :tenantId` from the JWT claim. The Dashboard code never receives `tenant_id` as a prop.
- **Activity feed redaction:** the AF shows payment amounts and student names — these are the tutor's own data, not PII of a third party (the tutor is the data controller). No redaction needed for the tutor. If a future multi-user role is added (v1.x), the AF will be role-filtered.
- **Quick Actions:** tapping "+ Record Payment" navigates to the Fees screen and opens the payment sheet — the sheet itself requires no PIN to *enter*, but posting a backdated payment triggers the PIN flow at submit time (BR-LED-05). The Dashboard is not the gatekeeper.
- **Audit:** the Dashboard reads no audit log; it does not write any. Manual refresh is not audited (it is a read).
- **Export:** the Dashboard has no export button of its own; exports live in Settings and in the per-screen toolbars.

---

## 16. Error Handling

| Error | Cause | Recovery |
|-------|-------|----------|
| KPI query returns null/empty | Local DB not yet bootstrapped | Render skeleton for 500 ms; if still null, render empty-state composition with "Setting up your workspace…" caption. |
| KPI query throws (SQL error) | Schema drift, corrupted index | Catch in TanStack Query `select`; render last good cache; toast "Couldn't refresh dashboard — showing last known values." Write `audit_log` `dashboard_query_failed` with the error. |
| Heatmap cell with unknown status | Schema drift / future enum value | Render as empty cell; console.warn; `audit_log`. |
| Reminder hydration fails (referenced student archived) | Race condition | Auto-dismiss the reminder (§11 E12). |
| Period filter invalid | User tampers with URL query param | Zod rejects; reset to current month with toast. |
| Network timeout on refresh | Slow connection | Local cache renders; spinner on the refresh button for ≤ 3 s, then toast "Still refreshing in background." Background refetch retries once. |
| Count-up animation jank | Low-end device | Detect `prefers-reduced-motion` or FPS < 30; skip animation, jump to final value. |

---

## 17. Performance Targets

| Metric | Target | Enforcement |
|--------|--------|-------------|
| First paint from local cache | < 200 ms from route entry | Measured via `performance.mark('dashboard-enter')` → `performance.mark('dashboard-first-paint')`. Tracked in dev telemetry. |
| Full refresh (online, Turso) | < 800 ms total query time | The KPI query is one round-trip; heatmaps + AF + DT are 4 more. Parallelised via `Promise.all`. |
| Count-up animation frame rate | 60 fps | `useMotionValue` + `animate()` from Framer Motion; layout thrash avoided by `will-change: transform` on the value span. |
| Heatmap render (100 students × 30 days = 3000 cells) | < 50 ms | Cells are pure `<div>` with className lookup; no inline styles; React.memo per cell. |
| Activity feed render (25 items) | < 16 ms | Virtualised only if > 100 items (not in v1 default). |
| Memory footprint | < 30 MB Dashboard-only heap | Query results are not duplicated; `gcTime` evicts after 5 min. |
| Background refetch on focus | Does not block interaction | TanStack `refetchOnWindowFocus` runs in background; UI remains interactive. |

If any target is missed by > 2× in CI benchmarks, the spec owner files a P1 bug.

---

## 18. Accessibility

| Concern | Implementation |
|---------|----------------|
| Contrast | All text on glass verified ≥ 4.5:1 (emerald/cyan on cosmic bg = 7:1+). KPI numbers use `--text-primary` (rgba 0.95). |
| Focus ring | Cyan outline `2px solid #00F0FF; outline-offset: 2px` on every interactive element (cards, cells, feed rows, buttons). |
| Keyboard nav | `Tab` walks: Period filter → KPI cards (left-right, top-down) → Heatmap tabs (mobile) → Heatmap cells (grid order) → Activity feed rows → Due Today reminders → Quick Actions. `Enter` activates drill-down. |
| Screen readers | KPI card: `aria-label="Collected this month: 1 lakh 24 thousand 500 rupees, up 18 percent versus last month."` Heatmap cell: `aria-label="A. Sharma, 28 September, present."` |
| `aria-live` | Toast region: `polite`. Refresh-failed toast: `assertive`. |
| `aria-busy` | Set on KPI strip during background refetch; cleared on settle. |
| Color-blind safety | Every heatmap cell pairs color with an icon (✓ ✕ ◐ – H) per `13_UI_Guidelines.md` §10.6 (Color Is Never the Only Signal) and §8.12 (Heatmap Cell). KPI delta arrows use ↑/↓ glyphs, not just color. |
| Reduced motion | `prefers-reduced-motion: reduce` → count-up skips to final value; card enter fades only (120 ms); heatmap cell hover transitions cut to 0 ms. |
| Touch targets | All ≥ 44×44 px on `base`/`sm` breakpoints. Heatmap cells are 12 px on mobile but the entire row is tappable as a unit, with the cell-specific drill available via long-press → context menu. |
| Period filter popover | Traps focus while open; `Esc` closes and returns focus to the chip. |

---

## 19. Testing Requirements

### 19.1 Unit Tests (Vitest)

- `formatCurrency(minor, locale)` — INR grouping, USD decimals, edge cases (0, negative-should-never-happen).
- KPI delta computation — clamping, sign, divide-by-zero guard.
- Heatmap cell color resolver — all 6 attendance + 4 payment statuses.
- Reminder hydration — `due_fee`, `missing_attendance`, `inactive_student`, archived-student race (E12).
- Period filter boundary — start ≤ end, max 90 days, "all" mode.

### 19.2 Component Tests (Vitest + Testing Library)

- `<KpiCard>` renders correct value, delta arrow, caption, empty state, loading skeleton.
- `<HeatmapGrid>` renders N×M cells with correct colors; click handler fires with correct params.
- `<ActivityFeedPanel>` renders 25 items; long-press opens context menu.
- `<DueTodayPanel>` renders prioritised reminders; "Snooze all" with > 5 items shows typed-confirm.
- `<DashboardEmptyState>` renders welcome composition with primary CTA.
- `<DashboardSkeleton>` matches snapshot for `first-paint` and `period-change` variants.

### 19.3 Integration Tests (Vitest + MSW)

- KPI query returns expected values for a seeded fixture (3 students, 5 payments, 2 invoices).
- KPI query tolerates a `VOID` entry correctly (excluded from sums).
- `LEDGER_MUTATED` event invalidates the correct query keys.
- Offline mode (no network) renders from cache; refresh button shows offline toast.

### 19.4 End-to-End Tests (Playwright)

- New tenant → Dashboard shows empty state → "+ Add Student" navigates correctly.
- Existing tenant → Dashboard renders all KPIs in < 1.5 s (assert via `performance.mark`).
- Click each KPI card → lands on the correct screen with the correct filter.
- Click each heatmap cell type → lands on Attendance/Fees with correct params.
- Period filter change → C1, C3, H1, H2, AF update; C2, C4, C5, C6 do not.
- "Record Payment" Quick Action → opens payment sheet → submit → Dashboard updates optimistically.

### 19.5 Performance Tests (Lighthouse CI)

- Dashboard route Lighthouse score ≥ 95 on Performance, Accessibility, Best Practices, SEO.
- LCP < 1.5 s on a simulated mid-range Android (Moto G Power, Lighthouse throttling).
- CLS = 0 (no layout shift; skeletons match final sizes).

### 19.6 Visual Regression (Chromatic / Percy)

- Dashboard default state (3 fixtures: small/medium/large tenant).
- Dashboard empty state.
- Dashboard loading state (skeletons).
- Dashboard offline state (footer + captions).
- Dashboard in light theme (inverted gradient).
- Dashboard at all 6 breakpoints (base, sm, md, lg, xl, 2xl).

---

## 20. Future Extensions

Deferred to v1.x and beyond (per `15_Future_Roadmap.md`):

- **v1.1 — Configurable KPI strip.** Tutors can pin/unpin cards (max 6 visible). Hidden cards accessible via a "More" popover.
- **v1.2 — Cohort heatmap.** A third heatmap tab showing retention (week-1 to week-N attendance per cohort).
- **v1.3 — Multi-batch comparison.** A sparkline strip comparing collection across batches.
- **v1.5 — Parent-view Dashboard.** A read-only, signed-URL Dashboard for parents showing their child's attendance + payment status. (Violates P14 if shipped as an app; ships as a signed URL only.)
- **v2.0 — Multi-branch aggregation.** For "Academy Vikram" persona: a branch-selector in the topbar; KPIs aggregate across branches or filter to one.
- **v2.0 — Anomaly detection.** ML-flagged anomalies surfaced as a special card: "A. Sharma's attendance dropped 40% this month — nudge?"
- **v2.x — Custom widgets.** Power-user escape hatch; off by default; behind a Settings flag.

None of these are committed for v1. The v1 Dashboard is intentionally **fixed and opinionated** — that is its virtue.

---

## 21. ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 (ASCII Art Conventions) for the Dashboard. Every mockup below annotates **glass tier** (`.glass` / `.glass-strong` / `.glass-faint` per §5.5) or **neumorphic recipe** (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6) so the contract between design and engineering is unambiguous. Character set per §20.2. Accent colours named, never hexed. Cross-references use canonical IDs only.

### 21.1 Design System Reference — Dashboard

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces on this screen | Tier | Cross-ref |
|---|---|---|
| Sidebar / bottom-tab bar (mobile) | `glass-strong` | §5.5, §8.6 |
| Top header bar | `glass-strong` sticky | §5.5 |
| KPI card | `glass` + 2px accent left-border | §5.4, §8.1 |
| Heatmap panel | `glass` (parent); cells = flat `bg-white/[0.04]` (no-glass-on-glass) | §5.3, §8.12 |
| Activity feed panel | `glass` | §5.5, §8.4 |
| Due-Today reminders panel | `glass` | §5.5 |
| Empty-state card | `glass` centered | §5.5, §8.19 |
| Toast (period-filter reject / sync conflict) | `glass-strong` + 4px accent left-bar | §5.5, §8.8 |
| Modal: KPI / widget config (v1.x) | `glass-strong` + backdrop | §5.5, §8.7 |
| Footer | `glass-faint` (recede), sticky per §13 | §5.5 |

| Neumorphic controls on this screen | Recipe | Cross-ref |
|---|---|---|
| Period filter chip button | `neumo-raised`; active = `neumo-pressed` | §6.6, §8.2 |
| Quick Action buttons (Record Payment, Mark Attendance, Add Student) | `neumo-raised` (primary, emerald glow); pressed = `neumo-pressed` | §6.6, §8.2 |
| Refresh button (icon-only) | `neumo-raised` | §6.6 |
| Snooze / Dismiss buttons (per reminder) | `neumo-raised` secondary | §6.6 |
| Heatmap cell hit-target wrapper (mobile) | (flat — wraps 44px hit area) | §10.2 |
| Search bar (topbar) | `neumo-inset` | §6.6, §8.10 |
| Modal: typed-confirm input (Snooze-all / Dismiss-all) | `neumo-inset` well | §6.6, §8.9 |

> **References:** Nielsen Norman Group — *Dashboards: A Quick Start Guide* (2021); Smashing Magazine — *Designing Better Dashboards With The Card Pattern*; Apple HIG — *Windows And Views* (sticky chrome); Material Design 3 — *Color Roles* (surface-container tiers map to our glass tiers).

### 21.2 Mockup M1 — Full-Screen Desktop Layout (xl+ ≥ 1280px)

```
DESKTOP (≥ 1280px)
┌────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (.glass-strong) ─┐ ┌─ Header (.glass-strong sticky) ──────────────┐ │
│ │  ◈ Buddysaradhi                │ │  Dashboard   🔍 Search… ⌘K   [Sept 2025 ▾] 🔔3 │ │
│ │  ──────                   │ ├──────────────────────────────────────────────┤ │
│ │  ◈ Dashboard   ← active   │ │                                              │ │
│ │  👥 Students              │ │  ┌─ KPI Strip (4×.glass cards, 3×2 grid) ───┐ │ │
│ │  ✓ Attendance             │ │  │▌Collected   ▌Due Till  ▌Due Mon          │ │ │
│ │  ₹ Fees                   │ │  │▌₹ 2,45,500 ▌₹ 38,200  ▌₹ 14,500          │ │ │
│ │  ⚙ Settings               │ │  │▌↑ 18%      ▌12 studs  ▌5 studs            │ │ │
│ │                           │ │  │▌╱╲╱╲╱╲     ▌           ▌                   │ │ │
│ │  ──────                   │ │  │▌Students   ▌With Dues ▌Breakdown          │ │ │
│ │  Aarav S.                 │ │  │▌87 · 5bat  ▌12 ↑2      ▌●42 ●8 ●12        │ │ │
│ │  Nagpur · 87 students     │ │  └────────────────────────────────────────────┘ │ │
│ │                           │ │                                                │ │
│ │  ──────                   │ │  ┌─ Heatmap (.glass) ──┐ ┌─ Feed (.glass) ────┐ │ │
│ │  ⚙ Sync                   │ │  │ Attendance · 30d    │ │ ● ₹3,500 received  │ │ │
│ │  ⚡ ⌘K                    │ │  │ ▓▓░▓▓▓▓▓▓▓▓▓▓▓▓▓▓░ │ │ ● Aarav present    │ │ │
│ │                           │ │  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ │ ● Batch 10 locked  │ │ │
│ │                           │ │  └─────────────────────┘ └────────────────────┘ │ │
│ └───────────────────────────┘ └────────────────────────────────────────────────┘ │
│ ┌─ Quick Actions Bar (sticky bottom of content) ──────────────────────────────┐ │
│ │  [+ Record Payment]  [+ Mark Attendance]  [+ Add Student]                   │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
│ ┌─ Footer (.glass-faint, sticky bottom) ───────────────────────────────────────┐ │
│ │  ● Online · synced 2m ago · 87 students · ₹ 2,45,500 MTD · v1.4.2 · © Buddysaradhi│ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────┘
   ↑ cosmic canvas: #0f0c29 → #24243e → #0a0a1a (§2.2)
   ↑ sidebar + header = .glass-strong (8% white, 24px blur) — persistent chrome (§5.5)
   ↑ KPI cards = .glass + 2px accent left-border (§5.4, §8.1)
   ↑ heatmap + feed = .glass workhorse tier
   ↑ quick action buttons = .neumo-raised (emerald glow on primary) — controls, §6.6
   ↑ period chip = .neumo-raised; popover (not shown) = .glass-strong sheet
   ↑ footer = .glass-faint (recede), sticky per §13
   ↑ search bar = .neumo-inset tray (§8.10)
```

### 21.3 Mockup M2 — Empty State (first-visit, 0 students, P15)

```
EMPTY STATE — fresh tenant, provisioned but no students
┌──────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (.glass-strong) ─┐ ┌─ Content (transparent over canvas) ─────────┐ │
│ │  ◈ Buddysaradhi                │ │                                              │ │
│ │  ◈ Dashboard  ← active    │ │     ┌─ Empty-state card (.glass) ────────┐  │ │
│ │  👥 Students              │ │     │                                    │  │ │
│ │  ✓ Attendance             │ │     │         ╭──────────╮                │  │ │
│ │  ₹ Fees                   │ │     │         │  ┌────┐  │  ← 120×120     │  │ │
│ │  ⚙ Settings               │ │     │         │  │ ◈  │  │     line-art   │  │ │
│ │                           │ │     │         │  └────┘  │     cyan+emerald│ │
│ │  Aarav S.                 │ │     │         ╰──────────╯                │  │ │
│ │  Nagpur · 0 students      │ │     │                                    │  │ │
│ │                           │ │     │            Welcome to Buddysaradhi       │  │ │
│ │  ⚙ Sync                   │ │     │   Add your first student in 30s.    │  │ │
│ │                           │ │     │                                    │  │ │
│ │                           │ │     │   ┌────────────────────────────┐    │  │ │
│ │                           │ │     │   │  [+] Add Student           │    │  │ │
│ │                           │ │     │   └────────────────────────────┘    │  │ │
│ │                           │ │     │       or import a CSV →            │  │ │
│ │                           │ │     │                                    │  │ │
│ │                           │ │     └────────────────────────────────────┘  │ │
│ └───────────────────────────┘ └────────────────────────────────────────────┘ │
│ ┌─ Footer (.glass-faint) ─────────────────────────────────────────────────────┐ │
│ │  ● Online · synced just now · 0 students · ₹ 0 MTD · v1.4.2 · © Buddysaradhi     │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
   ↑ empty-state card = .glass (5% white, 24px blur) — centered, not elevated (§8.19)
   ↑ CTA = .neumo-raised + emerald glow (primary action, §6.6 / §8.2)
   ↑ secondary "import a CSV" = ghost link (--text-secondary, no shadow)
   ↑ illustration = custom SVG line-art (NOT lucide), cyan + emerald strokes (§9.3)
   ↑ seeded "Welcome to Buddysaradhi" notification lands in Activity Feed area once
      CTA is tapped; until then AF area is intentionally absent (not a blank card)
   ↑ honest-empty-state rule (P15): never show "0 / 0 / 0 / 0" KPI cards on a fresh tenant
```

### 21.4 Mockup M3 — Loading / Skeleton (first-paint before cache resolves)

```
SKELETON — first paint, cache miss, < 200ms budget (§17 O1)
┌──────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (.glass-strong) ─┐ ┌─ Header (.glass-strong sticky) ──────────────┐ │
│ │  ◈ Buddysaradhi                │ │  Dashboard   🔍 Search… ⌘K   [Sept 2025 ▾] 🔔3 │ │
│ │  ◈ Dashboard  ← active    │ ├──────────────────────────────────────────────┤ │
│ │  👥 Students              │ │  ┌─ KPI Skeleton Strip (×6) ─────────────┐   │ │
│ │  ✓ Attendance             │ │  │▌░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│   │ │
│ │  ₹ Fees                   │ │  │▌                                    │   │ │
│ │  ⚙ Settings               │ │  │▌░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    │   │ │
│ │                           │ │  │▌                                    │   │ │
│ │  Aarav S.                 │ │  │▌░░░░░░░░░░░░░░░░                    │   │ │
│ │  Nagpur · 87 students     │ │  │▌────────────────────────────────────│   │ │
│ │                           │ │  │▌░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│   │ │
│ │  ⚙ Sync                   │ │  │▌                                    │   │ │
│ │                           │ │  │▌░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    │   │ │
│ │                           │ │  │▌                                    │   │ │
│ │                           │ │  │▌░░░░░░░░░░░░░░░░                    │   │ │
│ │                           │ │  └────────────────────────────────────────┘ │ │
│ │                           │ │  ┌─ Heatmap skel (.glass) ─┐ ┌─ Feed skel ┐ │ │
│ │                           │ │  │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │ │ ▒▒▒▒▒▒▒▒▒▒ │ │ │
│ │                           │ │  │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │ │ ▒▒▒▒▒▒▒▒▒▒ │ │ │
│ │                           │ │  └────────────────────────┘ └─────────────┘ │ │
│ └───────────────────────────┘ └────────────────────────────────────────────┘ │
│ ┌─ Footer (.glass-faint) ─────────────────────────────────────────────────────┐ │
│ │  ● Online · syncing… · 87 students · ₹ — · v1.4.2 · © Buddysaradhi               │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
   ↑ KPI skeleton = .glass-faint blocks + shimmer-loading (1.2s loop) per §8.20
   ↑ shimmer = diagonal gradient sweep, white @ 5% opacity (accent-neutral)
   ↑ aria-busy="true" on the KPI strip parent (§10.5)
   ↑ skeletons match final card sizes — CLS = 0 (no layout shift on resolve, §17)
   ↑ 120ms fade-out on resolve; KPI count-up does NOT run on first paint (§8.4)
   ↑ never a full-screen spinner (§15.2)
```

### 21.5 Mockup M4 — Primary Modal: KPI / Widget Config Sheet (v1.x)

> v1 has a **fixed, opinionated** KPI strip (no configurability — §2 closing note). This sheet is the v1.1 extension surface (`§20` Future Extensions). Mocked here so the design system is honoured when the feature ships. **No mutates a KPI formula** — only pin/unpin + reorder; the formula stays in `12_Business_Rules.md` BR-CALC-03..08.

```
MODAL — KPI / Widget Config Sheet (v1.1)
┌──────────────────────────────────────────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░ backdrop: bg-black/60 + backdrop-blur-sm ░░░░░░░░░░░░░ │
│  ░░░░░░░░  ┌──────────────────────────────────────────────────────╲░░░░░░░░  │
│  ░░░░░░░░  │  Configure KPI Strip                            ✕      │░░░░░  │
│  ░░░░░░░░  ├──────────────────────────────────────────────────────┤░░░░░  │
│  ░░░░░░░░  │                                                       │░░░░░  │
│  ░░░░░░░░  │  Pin up to 6 cards. Drag to reorder.                  │░░░░░  │
│  ░░░░░░░░  │                                                       │░░░░░  │
│  ░░░░░░░░  │  ┌── Pinned (4) ───────────────────────────────────┐ │░░░░░  │
│  ░░░░░░░░  │  │  ⋮⋮  ● Collected This Month        [unpin]      │ │░░░░░  │
│  ░░░░░░░░  │  │  ⋮⋮  ● Due Till Date                [unpin]      │ │░░░░░  │
│  ░░░░░░░░  │  │  ⋮⋮  ● Students With Dues           [unpin]      │ │░░░░░  │
│  ░░░░░░░░  │  │  ⋮⋮  ● Total Students                [unpin]      │ │░░░░░  │
│  ░░░░░░░░  │  └─────────────────────────────────────────────────┘ │░░░░░  │
│  ░░░░░░░░  │                                                       │░░░░░  │
│  ░░░░░░░░  │  ┌── Available (2) ─────────────────────────────────┐ │░░░░░  │
│  ░░░░░░░░  │  │  ● Due For Month                   [pin]         │ │░░░░░  │
│  ░░░░░░░░  │  │  ● Payment Breakdown               [pin]         │ │░░░░░  │
│  ░░░░░░░░  │  └─────────────────────────────────────────────────┘ │░░░░░  │
│  ░░░░░░░░  │                                                       │░░░░░  │
│  ░░░░░░░░  │       [Cancel]            [Save Layout]               │░░░░░  │
│  ░░░░░░░░  └──────────────────────────────────────────────────────┘░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────────────────────────────────────────┘
   ↑ backdrop = bg-black/60 + backdrop-blur-sm — click = cancel, ESC = cancel (§8.7)
   ↑ panel = .glass-strong (8% white, 24px blur) — highest-focus tier (§5.5)
   ↑ ✕ = ghost button (transparent, --text-secondary)
   ↑ Cancel = .neumo-raised secondary; Save Layout = .neumo-raised + emerald glow (§8.2)
   ↑ ⋮⋮ drag handle = neumo-pressed affordance (active during drag, §6.3)
   ↑ pin/unpin buttons = .neumo-raised compact (36px desktop hit, §8.2)
   ↑ aria-modal="true" (§10.5) + focus-trap active on panel mount
   ↑ 240ms ease-spring-soft enter (§7.3 modal-enter); mirror exit 180ms
   ↑ no KPI formula is editable here — only pin/reorder. Formulas stay in BR-CALC-03..08.
```

### 21.6 Mockup M5 — Toast / Confirmation: "Dismiss All" Typed-Confirm (primary destructive)

```
TOAST + TYPED-CONFIRM — "Dismiss all" with > 5 reminders (BR-RPT-05)
┌──────────────────────────────────────────────────────────────────────────────┐
│                       (Dashboard underneath, dimmed by backdrop)              │
│                                                                                │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░░░░░░░  ┌──────────────────────────────────────────────────────╲░░░░░░░░░  │
│  ░░░░░░░  │  Dismiss all 14 pending reminders?                ✕    │░░░░░░░  │
│  ░░░░░░░  ├──────────────────────────────────────────────────────┤░░░░░░░  │
│  ░░░░░░░  │                                                       │░░░░░░░  │
│  ░░░░░░░  │  This marks 14 reminders (4 due-fee, 6 missing-att,  │░░░░░░░  │
│  ░░░░░░░  │  4 inactive-student) as dismissed. They will not     │░░░░░░░  │
│  ░░░░░░░  │  re-fire this week. Audit row will be written.       │░░░░░░░  │
│  ░░░░░░░  │                                                       │░░░░░░░  │
│  ░░░░░░░  │  Type DISMISS to confirm                              │░░░░░░░  │
│  ░░░░░░░  │  ┌──────────────────────────────────────────────┐    │░░░░░░░  │
│  ░░░░░░░  │  │ DISMIS_                                      │    │░░░░░░░  │
│  ░░░░░░░  │  └──────────────────────────────────────────────┘    │░░░░░░░  │
│  ░░░░░░░  │  ↑ type the word DISMISS; button disabled until match│░░░░░░░  │
│  ░░░░░░░  │                                                       │░░░░░░░  │
│  ░░░░░░░  │       [Cancel]            [Dismiss 14]  (disabled)    │░░░░░░░  │
│  ░░░░░░░  └──────────────────────────────────────────────────────┘░░░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
└──────────────────────────────────────────────────────────────────────────────┘

AFTER confirm + commit (Toast surfaces in the bottom-right):

                          ┌▌──────────────────────────────────┐
                          │▌ ✓  14 reminders dismissed        │
                          │▌    audit row written · [Undo] ✕  │
                          └▌──────────────────────────────────┘
                             ↑ 4px emerald left-bar (success)
                             ↑ .glass-strong (8% white, 24px blur) per §8.8
                             ↑ aria-live="polite" (success = polite, §10.5)
                             ↑ 4s auto-dismiss; swipe-down to dismiss (§15.3)
                             ↑ [Undo] = .neumo-raised compact (re-arms reminders,
                               enqueues sync_outbox row per BR-SYN-01)
```

> **Why typed-confirm for bulk dismiss (§15.3 / §17 Rule 14):** a misclick on "Dismiss all" would silently bury 14 actionable reminders for a week. The typed word forces *intent*. BR-RPT-05 governs the snooze/dismiss semantics.

### 21.7 Mockup M6 — Mobile Variant (`base` < 640px)

```
MOBILE (base < 640px) — single column, bottom-tab bar, safe-area respected
┌──────────────────────────────────────┐
│ ▔▔▔▔▔▔ ← env(safe-area-inset-top)    │
│ ┌─ Header (.glass-strong sticky) ───┐│
│ │ ◈  Dashboard    🔔3   [Sept ▾]   ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ KPI Strip (horizontal snap) ────┐│
│ │┌────────┐ ┌────────┐ ┌────────┐  ›│
│ ││▌Collect│ │▌Due Tl │ │▌Due Mon│   │
│ ││▌₹2.45L │ │▌₹38.2K │ │▌₹14.5K │   │
│ ││▌↑18%   │ │▌12 std │ │▌5 std  │   │
│ │└────────┘ └────────┘ └────────┘   │
│ └────────────────────────────────────┘│
│  ← snap-scroll, 280px cards, one-up  │
│                                      │
│ ┌─ Heatmap tabs (.neumo-inset well) ┐│
│ │ ( ● Attend  )( ○ Payment )        ││
│ └────────────────────────────────────┘│
│ ┌─ Heatmap (.glass) ────────────────┐│
│ │  Mon  Tue  Wed  Thu  Fri  Sat  Sun │
│ │ ┌──┬──┬──┬──┬──┬──┬──┐             │
│ │ │▓▓│██│░░│▓▓│▓▓│··│··│             │
│ │ ├──┼──┼──┼──┼──┼──┼──┤  W1          │
│ │ │██│▓▓│██│██│██│··│··│             │
│ │ └──┴──┴──┴──┴──┴──┴──┘             │
│ │  █ present (emerald)               │
│ │  ▓ late (amber)   ░ absent (flare) │
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Due Today (.glass) ──────────────┐│
│ │ ⚠ 4 fees due today                ││
│ │   A. Sharma · ₹2,500 · INV-0017   ││
│ │   P. Iyer   · ₹1,200 · INV-0023   ││
│ │   … +2 more                        ││
│ │   [Remind all]   [Snooze all]     ││
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Quick Action FAB (floating) ────┐│
│ │              [+] ← .neumo-raised   │
│ └────────────────────────────────────┘│
│                                      │
│ ┌─ Bottom Tab Bar (.glass-strong) ─┐│
│ │  ◈    👥    ✓    ₹    ⚙           │
│ │ Home Stud Att  Fees Set           │
│ └────────────────────────────────────┘│
│ ▁▁▁▁▁ ← env(safe-area-inset-bottom)  │
└──────────────────────────────────────┘
   ↑ cosmic canvas same as desktop (dark-only, §12)
   ↑ header = .glass-strong sticky (§5.5)
   ↑ KPI strip = horizontal snap-scroll (§14 base breakpoint)
   ↑ KPI cards = .glass + accent left-border (§8.1)
   ↑ heatmap tab well = .neumo-inset; active pill = .neumo-raised + cyan glow (§8.5)
   ↑ heatmap cells = flat bg-white/[0.04] (no-glass-on-glass, §5.3); 12×12px mobile
     wrapped in 44×44px hit-target (§10.2)
   ↑ FAB = .neumo-raised (emerald glow, 56×56px), bottom-right, above tab bar
   ↑ bottom tab bar = .glass-strong + safe-area inset (§4.3, §8.6)
   ↑ tab icons = lucide 24px stroke 1.5px (§9.1); active = cyan glow + text-cyan
   ↑ every tab hit area = 44×44px minimum (§10.2)
   ↑ no parallax, no auto-rotate (§7.4 motion rules)
```

### 21.8 Mockup M7 — State Matrix: Period Filter Chip (primary interactive control)

```
STATE MATRIX — Period Filter Chip (the control that drives C1, C3, H1, H2, AF)
Box: 64–80 char width per §20.3 rule 2.

DEFAULT                       HOVER                        FOCUS
┌──────────────────────┐      ┌──────────────────────┐     ╔══════════════════════╗
│  Sept 2025    ▾     │      │  Sept 2025    ▾     │     ║  Sept 2025    ▾     ║
└──────────────────────┘      └──────────────────────┘     ╚══════════════════════╝
 ↑ .neumo-raised                 ↑ .neumo-raised            ↑ cyan 2px ring + glow
   4px 4px 8px #0a0a1a             (shadow stays equal;       (§10.3 focus-visible)
  -4px -4px 8px #2a2a5a             bg shifts to #1e1e3e)    ↑ keyboard parity:
 ↑ --text-primary                ↑ cursor-pointer              Tab reaches chip;
 ↑ ▾ = lucide ChevronDown          hover 60ms transition        Enter opens popover
 ↑ 44×44px hit area (§10.2)

ACTIVE (popover open)          PRESSED                       DISABLED (syncing)
┌══════════════════════┐      ┌──────────────────────┐      ┌──────────────────────┐
│  Sept 2025    ▾     │      │  Sept 2025    ▾     │      │  Sept 2025    ▾     │
└══════════════════════┘      └──────────────────────┘      └──────────────────────┘
 ↑ .neumo-pressed                ↑ .neumo-pressed              ↑ opacity-40
   inset 2px 2px 4px #0a0a1a       translateY(1px)            ↑ cursor-not-allowed
  -2px -2px 4px #2a2a5a          ↑ 60ms haptic on mobile      ↑ --text-muted
 ↑ cyan glow ring (selection     ↑ fires only while finger      ↑ disabled during
   marker, §5.4)                   is down; reverts on up          background sync
 ↑ popover renders below as        (60ms max)                    (sync_outbox drain)
   .glass-strong sheet

POPOVER (popover open state — anchored below the chip):
                  ┌─ .glass-strong sheet ─────────────────────┐
                  │  ◉ Month   ○ Range   ○ All                 │
                  │  ─────────────────────────────             │
                  │  ◀  September 2025  ▶                     │
                  │   M  T  W  T  F  S  S                     │
                  │   1  2  3  4  5  6  7                     │
                  │   8  9 10 11 12 13 14                     │
                  │  ...                                        │
                  │  ─────────────────────────────             │
                  │  [Cancel]              [Apply]             │
                  └─────────────────────────────────────────────┘
                   ↑ .glass-strong (8% white, 24px blur) per §5.5
                   ↑ aria-modal="true" + focus-trap active (§10.5)
                   ↑ ◉ ○ radio dots = .neumo-raised when active, flat when inactive
                   ↑ [Apply] = .neumo-raised + emerald glow; [Cancel] = ghost
                   ↑ "Range" mode adds start/end pickers; rejects > 90 days
                     with toast "Range cannot exceed 90 days. Use Reports."
```

> **References:** Apple HIG — *Push Notifications and Badges* (toast parity); Material Design 3 — *Segmented Buttons* (period filter is a 3-option segmented control); WCAG 2.1 AA §1.4.11 (Non-text Contrast — neumorphic shadow must pair with accent + label); WCAG 2.1 AA §2.1.1 (Keyboard — every chip state reachable without pointer); Smashing Magazine — *Designing Stateful UI Components* (state-matrix convention).

---

This is the contract for the Dashboard screen. Every line of code that renders the Dashboard must conform to this spec. A PR that changes a KPI formula, a heatmap color, a drill-down target, or an empty state must update this document in the same PR.
