"use client";

// Implements: 04_Dashboard.md §3 (KPI strip, due-today list, activity feed, quick
// actions), §4 (period filter — REMOVED, see below), §9.2 (prev-period delta —
// REMOVED, see below), §12 (state matrix); AGENTS.md §2 Rule 9 (no silent
// failures — a failed read renders an `ErrorState`, never zeroes) and Rule 10
// (44px targets, colour never the only signal, reduced motion via `.skeleton`).
//
// TWO LIAR-CONTROLS WERE REMOVED FROM THIS SCREEN, all by the same rule: a
// tutor's own books are the one thing this screen may not approximate.
//
//   1. The "18% vs last month" delta on Collected is GONE. Spec §9.2 defines the
//      prev-period delta as a SECOND aggregate over the previous month, which
//      the gateway does not expose; computing it here would be the second
//      implementation this screen just lost. In its place each money KPI states
//      the real scope of its measure, which is what spec line 166 already asks
//      for ("All-time, ignores filter") and what a tutor needs to know before
//      reconciling anything.
//   2. `JSON.parse` in the render path is GONE. Activity rows are normalised at
//      the action boundary; this file receives `present_count: number | null`
//      and never parses, so no receipt number or prose blob can throw the
//      dashboard away.
//
// THE PERIOD FILTER IS BACK, AND IT IS REAL THIS TIME. It was previously four
// pills writing `stores/dashboard.ts` `periodFilter` while the query key was the
// constant `["dashboard","summary"]` and `fetchDashboardSummaryAction()` took no
// argument: four controls, one payload, no effect. It could not be wired up
// while `apps/gateway/routes/analytics.ts` read `periodStartIso`/`periodEndIso`
// and discarded both, which left the KPI maths period-free — collected was every
// `PAYMENT_RECEIVED` row ever written. The route now validates the window,
// bounds `collectedThisMonthMinor` and `dueForMonthMinor` by it, and answers a
// malformed one with a typed 400, so the control is wired end to end: the period
// travels in the action argument AND in the query key, which is what stops four
// caches from serving one payload. The window itself is defined once, in
// `@/lib/dashboard-period`, and the control, the action and the tests all call
// the same derivation.
//
// The Due Today list is a PAGE of at most 50 overdue invoices, and this file now
// says so. `dueTodayTotal` / `dueTodayTruncated` used to be stripped by the Zod
// boundary, so the header counted what it happened to be holding and implied
// completeness; the three rows below a 200-student institute showed as the whole
// of their arrears.
//
// THE KPI DRILLS CARRY THEIR FILTER, AND THE CONTRACT LIVES IN ONE FILE.
// `@/lib/dashboard-drill` holds every card's destination screen AND the filter
// that screen must apply, and `applyCardDrill` writes the filter before it
// switches screens. §10.1 and §19.4 ask for "the correct screen with the correct
// filter"; this screen used to deliver the first half only, which is why tapping
// "Collected" opened an unfiltered ledger. What remains open — the Fees half,
// because the Fees screen reads none of its store — is declared in that file's
// header rather than papered over here, and no card announces a filter it did not
// actually write.

import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  TrendingUp,
  AlertCircle,
  CalendarDays,
  CreditCard,
  UserPlus,
  CalendarCheck,
} from "lucide-react";
import { formatINR } from "@buddysaradhi/shared";
import { cn } from "@/lib/utils";
import { CountUp } from "@/components/ui/count-up";
import { ErrorState, ScreenSkeleton } from "@/components/ui/screen-state";
import { toAppErrorState } from "@/lib/app-errors";
import { useToast } from "@/components/ui/toast";
import { useStudentsStore } from "@/stores/students-store";
import { useShellStore } from "@/stores/shell-store";
import {
  DashboardPeriodSchema,
  calendarDaysOverdue,
  defaultDashboardPeriod,
  isoDayOf,
  type DashboardPeriod,
  type DashboardPeriodMode,
} from "@/lib/dashboard-period";
import {
  CARD_DRILL,
  applyCardDrill,
  drillAnnouncement,
  isFilterApplied,
  type CardId,
} from "@/lib/dashboard-drill";
import {
  fetchDashboardSummaryAction,
  type DashboardActivityItem,
  type DashboardKpis,
} from "@/server/actions/dashboard";
import { DashboardAnalyticsSection } from "@/components/buddysaradhi/dashboard-analytics";

const DAY_MS = 86_400_000;

/**
 * THE DRILL IS NOT A NAVIGATION — IT IS A FILTER WRITE PLUS A SCREEN WRITE.
 *
 * This file used to hold `CARD_DRILL: Record<string, ScreenId>` — seven names,
 * seven screens, no filter — so C1/C3/C6 all collapsed to a bare `/fees` and
 * C4/C5 to a bare `/students`, which is the defect 04_Dashboard.md §19.4 names
 * ("lands on the correct screen with the correct filter"). The contract now lives
 * in `@/lib/dashboard-drill`: every entry names its screen AND the filter the
 * destination must apply, and `applyCardDrill` writes that filter into the
 * destination store BEFORE the screen switches, so the destination mounts
 * already filtered.
 *
 * The filtered half is now real for the two Students cards and still open for
 * the Fees half, and the difference is stated rather than papered over:
 * `useStudentsStore.filters` is threaded into the roster query and the gateway
 * HONOURS `status`/`balanceRange`, so C4 and C5 arrive pre-filtered. The Fees
 * screen keeps its tab and its roster query in component-local `useState`
 * (`components/fees/fees-client.tsx:99-101`) and `useFeesStore.mode` /
 * `useFeesStore.searchQuery` have no reader at all, so a write to them would be a
 * filter the destination ignores — the code would look like it worked while the
 * tutor still saw an unfiltered ledger. That gap is reported to the lead with
 * the exact patch rather than faked, and `drillAnnouncement` will not speak a
 * filter for a card whose filter was not written (Rule 9).
 */

function initials(name: string) {
  if (name === "") return "?";
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * WHY THE OVERDUE LINE USES `calendarDaysOverdue` AND NOT A LOCAL HELPER.
 *
 * This screen was computing "how late" twice, differently. The list here
 * compared `Date.now()` against the due date parsed as UTC midnight and then
 * added one, so an invoice due TODAY read "1 day overdue" from the first minute
 * of the day; the aging panel in `dashboard-analytics-calc.ts` counted the same
 * invoice as zero days. Two overdue figures for one invoice on one screen is a
 * P0 in a product whose entire claim is that the books reconcile. The shared
 * helper counts whole calendar days — today is 0 — and the caller hides the line
 * below 1. `null` means "no readable due date", and the caller hides the line
 * rather than guessing.
 */

/** "2 hrs ago" / "just now" — no "0 mins ago", no "1 hrs ago". */
function relativeTime(timestamp: string | null, nowMs: number): string {
  if (timestamp === null) return "";
  const at = new Date(timestamp).getTime();
  if (Number.isNaN(at)) return "";
  const minutes = Math.max(0, Math.floor((nowMs - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} mins ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hr ago" : `${hours} hrs ago`;
  const days = Math.floor(minutes / (60 * 24));
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/**
 * One place that turns an activity row into a sentence a tutor can read. This
 * used to live inline in the render path, behind an `as` from `unknown` and a
 * bare `JSON.parse`. It is now a pure function over a validated type, so it
 * cannot throw and cannot invent a number — `present_count === null` means the
 * gateway sent no readable count, and the row says nothing about attendance
 * rather than claiming "0 present".
 *
 * `student_name` holds a PERSON or nothing; `event_title` holds the event's own
 * label. The gateway used to put a ledger entry's `description` in the name
 * column, so this function received the sentence "Payment received" where it
 * expected a name and rendered the feed as one anonymous payer repeating it.
 * A row with no name and no event title says "Activity" and stops there, which
 * is the truthful minimum.
 */
function describeActivity(item: DashboardActivityItem): {
  title: string;
  subtitle: string;
  accent: string;
} {
  const who = item.student_name;

  if (item.event_type === "PAYMENT") {
    return {
      title: `${formatINR(item.minor_amount)} collected`,
      subtitle: who === "" ? "Payment received" : `from ${who}`,
      accent: "var(--success)",
    };
  }

  if (item.event_type === "INVOICE") {
    return {
      title:
        item.invoice_number === null ? "Invoice raised" : `Invoice ${item.invoice_number}`,
      subtitle:
        who === "" ? `${formatINR(item.minor_amount)} due` : `${who} owes ${formatINR(item.minor_amount)}`,
      accent: "var(--warning)",
    };
  }

  if (item.event_type === "ATTENDANCE_LOCKED") {
    const count = item.present_count;
    const parts: string[] = [];
    if (count !== null) parts.push(`${count} present`);
    if (who !== "") parts.push(who);
    return {
      title: "Attendance marked",
      subtitle: parts.length > 0 ? parts.join(" · ") : "Session recorded",
      accent: "var(--info)",
    };
  }

  if (item.event_type === "STUDENT_ENROLLED") {
    return {
      title: who === "" ? "Student enrolled" : `${who} enrolled`,
      subtitle: "Roster updated",
      accent: "var(--info)",
    };
  }

  // OTHER — a notification, or a ledger row with no roster match. The event's
  // own title is the label; the person, if there is one, is the subtitle. Both
  // absent means there is genuinely nothing to say, and "Activity" says that.
  const title = item.event_title !== "" ? item.event_title : "Activity";
  return {
    title: who === "" ? title : `${title} · ${who}`,
    subtitle: "",
    accent: "var(--info)",
  };
}

export function DashboardClient() {
  const [now, setNow] = React.useState(() => Date.now());
  const setActiveScreen = useShellStore((s) => s.setActiveScreen);
  const toast = useToast();

  /**
   * §6.4's period. It is the query key as well as the action argument — the
   * reason the four original pills repainted one payload is that they were in
   * neither. `DashboardPeriodSchema` is the only gate: a candidate that fails it
   * is refused with a toast and the applied period is left alone, so a range
   * that is 91 days long can never be quietly widened to all time.
   */
  const [period, setPeriod] = React.useState<DashboardPeriod>(defaultDashboardPeriod);

  const openAddStudent = () => {
    setActiveScreen("/students");
    setTimeout(() => {
      useStudentsStore.getState().openAddSheet();
    }, 0);
  };

  /**
   * §10.1 / §19.4: a card tap applies its filter and THEN switches screen.
   * `getState()` rather than a subscription — the Dashboard has no business
   * re-rendering because the Students roster changed — and the store is read at
   * click time so it carries whatever the tutor last chose, which is exactly what
   * a drill overrides.
   */
  const drill = React.useCallback(
    (card: CardId) => {
      applyCardDrill(card, { students: useStudentsStore.getState(), goTo: setActiveScreen });
    },
    [setActiveScreen],
  );

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const applyPeriod = React.useCallback(
    (candidate: DashboardPeriod) => {
      const parsed = DashboardPeriodSchema.safeParse(candidate);
      if (!parsed.success) {
        // §11 E4 says reject, not truncate. The applied period is untouched, so
        // the figures on screen keep describing the window the tutor is looking
        // at, and the toast says why the pick did not take.
        const first = parsed.error.issues[0];
        toast.error(
          "That period was not applied",
          first?.message ?? "The period filter is unreadable.",
        );
        return;
      }
      setPeriod(parsed.data);
    },
    [toast],
  );

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["dashboard", "summary", period],
    queryFn: async () => {
      const res = await fetchDashboardSummaryAction(period);
      if (!res.ok) throw new Error(res.error);
      return res.value;
    },
  });

  /**
   * Header and quick actions render in EVERY branch. A tutor whose figures did
   * not load still needs a route to the other four screens — that is the whole
   * point of saying what is safe to do.
   *
   * The period control is part of the header, and it renders in the failure and
   * loading branches too: a filter the tutor can reach while the numbers are
   * down is a control, and a control that only exists when the data happens to
   * be up is not one.
   */
  const header = (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
          Dashboard
        </h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          The truth of your tuition business, right now.
        </p>
      </div>
      <PeriodFilter
        period={period}
        onApply={applyPeriod}
        label={data?.window.label}
      />
    </div>
  );

  const quickActions = (
    <div className="glass-card p-4 rounded-2xl flex items-center justify-center gap-3 mt-8 mb-6 max-w-2xl mx-auto flex-wrap border border-[var(--border-default)]">
      <QuickAction
        icon={<CalendarCheck className="w-4 h-4" />}
        label="Mark Attendance"
        accent="var(--info)"
        onClick={() => setActiveScreen("/attendance")}
      />
      <QuickAction
        icon={<CreditCard className="w-4 h-4" />}
        label="Record Payment"
        accent="var(--success)"
        onClick={() => setActiveScreen("/fees")}
      />
      <QuickAction
        icon={<UserPlus className="w-4 h-4" />}
        label="Add Student"
        accent="var(--warning)"
        onClick={openAddStudent}
      />
    </div>
  );

  // Failure replaces the figures, and says plainly that nothing is shown. The
  // previous branch fell through to all-zero KPIs plus "No dues due today. Clean
  // slate." — so a gateway timeout told a tutor their institute had collected
  // nothing and owed nothing. That string must never reach a tutor again.
  if (error !== null) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          state={toAppErrorState(error)}
          onRetry={() => {
            void refetch();
          }}
          isRetrying={isFetching}
          retryLabel="Reload dashboard"
          dataStatus="Nothing was changed, and no figure below is being shown — these are not your collections, your dues, or your student count. Your saved books are untouched; retry when you're ready."
        />
        {quickActions}
      </div>
    );
  }

  // No data yet is NOT zero. Render the shape-matched skeleton (its motion
  // comes from `.skeleton`, which honours `prefers-reduced-motion` in both
  // switches in globals.css) instead of a row of ₹0.00 cards.
  if (data === undefined) {
    return (
      <div className="space-y-6">
        {header}
        <ScreenSkeleton shape="dashboard" label="your dashboard" rows={4} />
      </div>
    );
  }

  const { summary, window: periodWindow } = data;
  const { kpis, activity, dueToday, dueTodayTotal, dueTodayTruncated } = summary;

  /**
   * §11 E1 / §21.3 M2 / P15: a tenant with no books gets the welcome
   * composition, not a grid of zeroes. The test is deliberately WIDER than
   * `totalStudents === 0`, because that count is the ACTIVE roster only: a
   * tutor whose students have all graduated still has money in the books, and
   * hiding an arrears figure behind a "welcome" panel would be the same class
   * of lie as the all-zero grid it replaces. So the welcome shows only when
   * every money measure and the whole due list are empty too.
   */
  const noBooksYet =
    kpis.totalStudents === 0 &&
    kpis.dueTillDateMinor === 0 &&
    kpis.overdueMinor === 0 &&
    kpis.collectedThisMonthMinor === 0 &&
    dueTodayTotal === 0;

  if (noBooksYet) {
    return (
      <div className="space-y-6">
        {header}
        <FirstRunState onAddStudent={openAddStudent} />
        {quickActions}
      </div>
    );
  }

  // The list is a PAGE of at most 50 overdue INVOICES (one student can own more
  // than one, so the old "N students" label was also wrong even when complete).
  // The gateway sends the exact population beside the slice; the honest reading
  // is "showing 50 of 87" rather than a bare 50 that looks like the whole of it.
  const invoiceWord = dueTodayTotal === 1 ? "invoice" : "invoices";
  const dueTodayCount = dueTodayTruncated
    ? `Showing ${dueToday.length} of ${dueTodayTotal} overdue ${invoiceWord}`
    : `${dueTodayTotal} overdue ${invoiceWord}`;

  return (
    <div className="space-y-6">
      {header}

      {/* KPI strip — §6.2 C1..C6, three across on lg and six on 2xl (§6.3). C1,
          C3 and the two heatmap windows follow the period; C2, C4, C5 and C6
          are definitionally not period-scoped and say so INSIDE the card, per
          §6.4, so a tutor never wonders why a number refused to move. */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-4"
        aria-busy={isFetching}
      >

        {/* C1 — BR-CALC-03 / BR-RPT-08. Follows the period, so its caption
            names the window rather than asserting "this month" whatever the
            tutor has selected. */}
        <KPICard
          card="collected"
          onDrill={drill}
          title="Collected"
          value={kpis.collectedThisMonthMinor}
          formatFn={formatINR}
          icon={<TrendingUp className="w-5 h-5" />}
          accent="var(--success)"
          caption={`Payments received in ${periodWindow.labelLower}`}
        />
        {/* C2 — BR-CALC-04. All-time by definition (§10.1), and it says so. */}
        <KPICard
          card="due-till-date"
          onDrill={drill}
          title="Due Till Date"
          value={kpis.dueTillDateMinor}
          formatFn={formatINR}
          icon={<AlertCircle className="w-5 h-5" />}
          accent="var(--warning)"
          caption="Owed up to today, all time. Does not follow the period."
        />
        {/* C3 — BR-CALC-05. This figure crossed the Zod boundary on the action
            and was rendered nowhere, so the spec's "due for the month" card did
            not exist on the screen. */}
        <KPICard
          card="due-in-period"
          onDrill={drill}
          title="Due In Period"
          value={kpis.dueForMonthMinor}
          formatFn={formatINR}
          icon={<CalendarDays className="w-5 h-5" />}
          accent="var(--warning)"
          caption={`Still unpaid on invoices due in ${periodWindow.labelLower}`}
        />
        {/* C4 — students count. A current snapshot, so period-independent. */}
        <KPICard
          card="total-students"
          onDrill={drill}
          title="Active Students"
          value={kpis.totalStudents}
          icon={<Users className="w-5 h-5" />}
          accent="var(--info)"
          caption="On the roster right now. Does not follow the period."
        />
        {/* C5 — BR-CALC-01 + BR-M-05. */}
        <KPICard
          card="students-with-dues"
          onDrill={drill}
          title="Students With Dues"
          value={kpis.studentsWithDues}
          icon={<AlertCircle className="w-5 h-5" />}
          accent="var(--danger)"
          caption="Owe more than a rounding paise. Does not follow the period."
        />
        {/* C6 — BR-CALC-02. The four counts crossed the boundary and were
            rendered nowhere; §1 question 4 ("who paid, who didn't, who is
            partial") had no answer on this screen. */}
        <BreakdownCard
          card="breakdown"
          breakdown={kpis.paymentBreakdown}
          onDrill={drill}
        />
        {/* Overdue is a fifth money measure and has no C-number of its own: it
            is the subset of C3 whose due date has already passed, so it is
            deliberately NOT period-scoped. */}
        <KPICard
          card="overdue"
          onDrill={drill}
          title="Overdue"
          value={kpis.overdueMinor}
          formatFn={formatINR}
          icon={<CalendarDays className="w-5 h-5" />}
          accent="var(--danger)"
          caption="Unpaid invoices already past their due date, all time"
        />
      </div>


      {/* Analytics: read-only visualizations + filtered CSV export of the same
          books above. Mounted inside the Dashboard (Rule 4: no new screen). */}
      <DashboardAnalyticsSection />

      {/* Overview tab content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Due Today */}
        <div className="lg:col-span-2 glass-panel rounded-xl p-6 min-h-[300px] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-[var(--text-primary)]">Due Today</h2>
            {/* The count states its own completeness. A truncated page that
                renders as a plain number is the app telling a tutor their
                most-overdue invoice does not exist. */}
            <span
              className="text-xs text-[var(--text-muted)]"
              role="status"
            >
              {dueTodayCount}
            </span>
          </div>
          {dueToday.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
              <CreditCard className="w-8 h-8 text-[var(--text-muted)] opacity-60 mb-3" />
              <p className="text-sm text-[var(--text-muted)]">
                No unpaid invoice has passed its due date. That is your list, not a
                placeholder.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {dueToday.map((d, rowIndex) => {
                const overdueDays = calendarDaysOverdue(d.due_date, now);
                return (
                  <div
                    /* One row per INVOICE, not per student. `key={student_id}`
                       collided the moment a student owned two overdue
                       invoices — which the file's own count label admits is
                       normal — and React silently reused the first row's DOM
                       for the second, so the amount on screen could belong to
                       the wrong invoice. The invoice number is the row's own
                       identity; the index is only the fallback for an orphaned
                       invoice that carries neither a number nor a due date. */
                    key={`${d.student_id}|${d.invoice_number ?? d.due_date ?? "row"}|${rowIndex}`}
                    className="flex items-center gap-3 p-3 rounded-xl bg-[var(--surface-inset)] border border-[var(--border-default)]"
                  >
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0"
                      style={{
                        background: "color-mix(in srgb, var(--warning) 15%, transparent)",
                        color: "var(--warning)",
                      }}
                    >
                      {initials(d.student_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {d.student_name === "" ? "Unnamed student" : d.student_name}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] truncate">
                        {d.invoice_number !== null ? "Inv " + d.invoice_number : "Fee due"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-[var(--danger)] num">
                        {formatINR(d.due_minor)}
                      </p>
                      {/* The text carries the meaning, so the red amount is never
                          the only signal (AGENTS.md §2 Rule 10). */}
                      {overdueDays !== null && overdueDays > 0 && (
                        <p className="text-xs text-[var(--text-muted)]">
                          {overdueDays}
                          {overdueDays === 1 ? " day" : " days"} overdue
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              {/* The gap, stated where the rows end. The 50 shown are the oldest,
                  so what is missing is not the newer and smaller stuff — it is
                  the deepest of the arrears, and a tutor who reads this list as
                  the whole of what they are owed will not chase it. The money
                  in the unlisted rows is deliberately NOT computed here: the
                  Overdue tile above already carries that total, and 04_Dashboard
                  §9 forbids the client recomputing a financial measure. */}
              {dueTodayTruncated && (
                <p className="pt-1 text-xs text-[var(--text-muted)]">
                  The {dueToday.length} oldest of {dueTodayTotal} overdue{" "}
                  {invoiceWord}. {dueTodayTotal - dueToday.length} more{" "}
                  {dueTodayTotal - dueToday.length === 1 ? "is" : "are"} overdue
                  and not listed here — the Overdue figure covers{" "}
                  {dueTodayTotal - dueToday.length === 1 ? "it" : "all of them"}.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Activity */}
        <div className="glass-panel rounded-xl p-6">
          <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Activity</h2>
          <div className="space-y-4">
            {activity.length === 0 ? (
              <div className="text-sm text-[var(--text-muted)] py-4 text-center">
                No recent activity
              </div>
            ) : (
              activity.map((item) => {
                const copy = describeActivity(item);
                return (
                  <ActivityItem
                    key={item.id}
                    title={copy.title}
                    subtitle={copy.subtitle}
                    time={relativeTime(item.timestamp, now)}
                    accent={copy.accent}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>

      {quickActions}
    </div>
  );
}

/**
 * §10.1 gives every KPI card a drill-down target and §18 requires `Tab` to
 * reach the cards and `Enter` to fire them. These were `<div>`s carrying a
 * `hover:border` treatment, which is the visual grammar of a control with none
 * of the behaviour: a tutor could hover a card all day and stay on the screen.
 *
 * Making them real buttons is the smallest correct change — the drill is a
 * filter write plus a store write (Rule 4: there are no routes) — and the
 * destination is announced in the button's accessible name so the control never
 * reads as a dead number.
 *
 * The `caption` is the real scope of the measure, as spec line 166 asks. It
 * replaces a delta percentage the data cannot support: a tutor reading
 * "Collected ₹2.4 lakh / payments received in September 2026" knows exactly
 * what the number is; "18% vs last month" would have been a guess presented as
 * arithmetic.
 */
function KPICard({
  card,
  title,
  value,
  formatFn,
  icon,
  accent,
  caption,
  onDrill,
}: {
  card: CardId;
  title: string;
  value: number;
  formatFn?: (v: number) => string;
  icon: React.ReactNode;
  accent: string;
  caption?: string;
  onDrill: (card: CardId) => void;
}) {
  const valueText = formatFn ? formatFn(value) : value.toLocaleString("en-IN");
  return (
    <button
      type="button"
      onClick={() => onDrill(card)}
      className="glass-panel p-5 rounded-xl flex flex-col justify-between text-left transition-all hover:border-[var(--info)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)] min-h-[44px] cursor-pointer"
      style={{
        border: "1px solid color-mix(in srgb, " + accent + " 25%, transparent)",
      }}
    >
      <div className="flex items-center justify-between mb-3 gap-2">
        <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide truncate">
          {title}
        </span>
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: "color-mix(in srgb, " + accent + " 15%, transparent)", color: accent }}
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>
      <span className="text-2xl font-bold text-[var(--text-primary)] tracking-tight num">
        <CountUp value={value} formatFn={formatFn} />
      </span>
      {caption !== undefined && (
        <span className="text-xs mt-1 text-[var(--text-muted)] block">{caption}</span>
      )}
      {/* The visible text is the figure and its scope; this adds only the one
          thing a figure cannot say, which is where tapping it goes and what the
          destination will already be showing. The filter clause is emitted only
          for a filter the drill really writes, so this string cannot promise a
          filtered screen the tutor does not get. */}
      <span className="sr-only">
        {drillAnnouncement(CARD_DRILL[card], {
          title,
          value: valueText,
          filterApplied: isFilterApplied(card),
        })}
      </span>
    </button>
  );
}

const BREAKDOWN_META: Array<{
  key: keyof DashboardKpis["paymentBreakdown"];
  label: string;
  accent: string;
}> = [
  { key: "paid", label: "Paid", accent: "var(--success)" },
  { key: "partial", label: "Partial", accent: "var(--warning)" },
  { key: "unpaid", label: "Unpaid", accent: "var(--danger)" },
  { key: "noDues", label: "Never invoiced", accent: "var(--info)" },
];

/**
 * C6 — §10.1 "Payment Breakdown", per BR-CALC-02: `paid` / `partial` /
 * `unpaid` / `no dues` summed across the roster. The counts crossed the Zod
 * boundary on the action and had no home on the screen, so §1's fourth question
 * ("who paid, who didn't, who is partial") was unanswerable from here.
 *
 * The fourth bucket is labelled "Never invoiced", not "No dues", because that is
 * what it counts: BR-CALC-02 defines "no dues" as "no FEE_CHARGED", and the
 * gateway implements exactly that — a student with zero invoices. The label that
 * would be honest is the one that names the condition. §6.2's own arithmetic
 * note (`noDues = totalStudents − paid − partial − unpaid`) disagrees with both,
 * and is reported to the lead as a spec contradiction rather than silently
 * chosen here.
 *
 * §10.1 ALSO says "tapping a colored dot → Fees screen filtered to that status",
 * and the four buckets are deliberately NOT four buttons today. They are one
 * card with one drill, because the destination cannot be filtered by status at
 * all: the Fees screen keeps its tab and its roster query in component-local
 * `useState` (`components/fees/fees-client.tsx:99-101`), so neither
 * `useFeesStore.mode` nor `useFeesStore.searchQuery` is read by anything. Four
 * dots would therefore be four controls that all land on the identical
 * unfiltered screen — the "invented menu items" and "a filter the server drops
 * is a filter that lies to the tutor" failures this repo has already refused
 * twice (`students-toolbar.tsx:14-21, 38-47`). `C6_DRILL` in
 * `@/lib/dashboard-drill` already declares each bucket's destination and its
 * spoken filter, so the wiring becomes four `onClick`s the moment the Fees store
 * gains a reader.
 *
 * Colour is never the only signal (Rule 10): every figure carries its status
 * word, and the counts themselves are text, so the card reads identically in
 * greyscale, in high contrast and to a screen reader.
 */
function BreakdownCard({
  card,
  breakdown,
  onDrill,
}: {
  card: CardId;
  breakdown: DashboardKpis["paymentBreakdown"];
  onDrill: (card: CardId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onDrill(card)}
      className="glass-panel p-5 rounded-xl flex flex-col justify-between text-left transition-all hover:border-[var(--info)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)] min-h-[44px] cursor-pointer"
      style={{ border: "1px solid color-mix(in srgb, var(--info) 25%, transparent)" }}
    >
      <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
        Payment Breakdown
      </span>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {BREAKDOWN_META.map(({ key, label, accent }) => (
          <li key={key} className="flex items-baseline gap-1.5">
            <span
              aria-hidden="true"
              className="w-2 h-2 rounded-full shrink-0 self-center"
              style={{ backgroundColor: accent }}
            />
            <span className="text-sm font-bold text-[var(--text-primary)] num">
              {breakdown[key].toLocaleString("en-IN")}
            </span>
            <span className="text-xs text-[var(--text-muted)]">{label}</span>
          </li>
        ))}
      </ul>
      <span className="text-xs mt-2 text-[var(--text-muted)] block">
        Students by payment status. Does not follow the period.
      </span>
      <span className="sr-only">
        {drillAnnouncement(CARD_DRILL[card], {
          title: "Payment Breakdown",
          value: BREAKDOWN_META.map(
            ({ key, label }) => `${breakdown[key]} ${label}`,
          ).join(", "),
          filterApplied: isFilterApplied(card),
        })}
      </span>
    </button>
  );
}

/**
 * §6.4's control: Month, Range, All. Three plain buttons and two date wells —
 * no popover, because a popover that traps focus and closes on `Esc` is a
 * disclosure widget, and three mutually exclusive options that are always
 * visible do not need one. The state it holds is the same `DashboardPeriod` the
 * action sends and the query key is built from, so there is exactly one
 * definition of "what this filter means".
 *
 * `mode` and the two bounds are three small state transitions rather than a
 * popover object, and every one of them goes through `DashboardPeriodSchema` in
 * the parent. The 90-day cap (§11 E4) therefore fails exactly once, in one
 * place, with the spec's own words.
 */
function PeriodFilter({
  period,
  onApply,
  label,
}: {
  period: DashboardPeriod;
  onApply: (next: DashboardPeriod) => void;
  /** The window the last successful read covered, so the control can state the
   *  period the numbers on screen belong to before they arrive. */
  label: string | undefined;
}) {
  const setMode = (mode: DashboardPeriodMode) => {
    if (mode === "month") return onApply({ mode, start: null, end: null });
    if (mode === "all") return onApply({ mode, start: null, end: null });
    // Entering range with no bounds would be refused by the schema, so seed a
    // usable default: the last 30 days ending today.
    const today = isoDayOf(Date.now());
    const start = new Date(Date.now() - 29 * DAY_MS).toISOString().slice(0, 10);
    return onApply({ mode, start, end: today });
  };

  const setBound = (which: "start" | "end", value: string) => {
    const other = which === "start" ? period.end : period.start;
    // Dragging one bound past the other would otherwise leave the control in a
    // state the schema refuses, so the pair moves together: the edited bound
    // wins and the other one follows. The only rejection a tutor can reach is
    // the 90-day cap, which is the one §11 E4 wants rejected.
    const next: DashboardPeriod =
      which === "start"
        ? { mode: "range", start: value, end: other === null || other < value ? value : other }
        : { mode: "range", start: other === null || other > value ? value : other, end: value };
    onApply(next);
  };

  const options: Array<{ mode: DashboardPeriodMode; label: string }> = [
    { mode: "month", label: "Month" },
    { mode: "range", label: "Range" },
    { mode: "all", label: "All" },
  ];

  return (
    <div className="flex flex-col items-start gap-2">
      <div
        className="inline-flex rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-1"
        role="group"
        aria-label="Period filter"
      >
        {options.map((option) => (
          <button
            key={option.mode}
            type="button"
            aria-pressed={period.mode === option.mode}
            onClick={() => setMode(option.mode)}
            className={cn(
              "min-h-[44px] min-w-[64px] px-3 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)]",
              period.mode === option.mode
                ? "bg-[var(--surface-raised)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {period.mode === "range" && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            From
            <input
              type="date"
              value={period.start ?? ""}
              max={period.end ?? undefined}
              onChange={(event) => setBound("start", event.target.value)}
              aria-label="Period start day"
              className="min-h-[44px] rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 text-xs text-[var(--text-primary)]"
            />
          </label>
          <label className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            To
            <input
              type="date"
              value={period.end ?? ""}
              min={period.start ?? undefined}
              onChange={(event) => setBound("end", event.target.value)}
              aria-label="Period end day"
              className="min-h-[44px] rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] px-2 text-xs text-[var(--text-primary)]"
            />
          </label>
        </div>
      )}
      {/* One line, and it says two things a tutor needs: which window these
          figures cover, and which cards that window does not move (§6.4 asks
          for exactly this, inside the screen). The 90-day rule is NOT stated
          here permanently — §11 E4 puts it in a toast at the moment a range is
          refused, which is where a message about a control most tutors never
          touch belongs. Leaving it here would be permanent helper copy about a
          policy the tutor did not invoke. */}
      <p className="text-xs text-[var(--text-muted)]">
        {label === undefined
          ? "Collected and due in period follow the filter; due till date, students and payment breakdown do not."
          : `Showing ${label}. Collected and due in period follow it; due till date, students and payment breakdown do not.`}
      </p>
    </div>
  );
}

/**
 * §11 E1 / §21.3 M2 / P15 — the first-run composition.
 *
 * P15 says a fresh tenant sees a designed welcome, never a grid of "0 / 0 / 0 /
 * 0" cards, and §21.3 M2 mocks exactly this card: a line-art mark, the
 * "Welcome" heading, one sentence, one primary action. Two deliberate omissions
 * from the mockup, both because a dead control is a Hard Gate failure and this
 * screen cannot honestly own them:
 *
 *  - The mockup's `or import a CSV →` ghost link. The importer lives in
 *    Settings and this lane does not own that screen, so the link would be a
 *    pointer to nothing. Reported to the lead.
 *  - A fabricated illustration. §21.3 asks for custom SVG line-art in cyan and
 *    emerald; what ships below is a hand-authored mark built from the same two
 *    accents, not a lucide icon wearing a costume, and not an emoji.
 */
function FirstRunState({ onAddStudent }: { onAddStudent: () => void }) {
  return (
    <div className="glass-panel rounded-xl p-8 flex flex-col items-center text-center gap-4">
      {/* 120×120 line-art per §21.3 M2: an open ledger with one settled line.
          Decorative, so it is hidden from assistive tech — the heading and the
          sentence below it carry the meaning. */}
      <svg
        width="120"
        height="120"
        viewBox="0 0 120 120"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <rect
          x="18"
          y="26"
          width="84"
          height="68"
          rx="8"
          stroke="var(--info)"
          strokeWidth="2.5"
        />
        <path d="M18 46h84" stroke="var(--info)" strokeWidth="2.5" />
        <path d="M34 62h34M34 74h24" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" />
        <path
          d="M78 74l7 7 13-14"
          stroke="var(--success)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <h2 className="text-xl font-semibold text-[var(--text-primary)]">
        Welcome to Buddysaradhi
      </h2>
      <p className="text-sm text-[var(--text-muted)] max-w-[46ch]">
        Add your first student in 30 seconds. This screen then answers one
        question every morning: how much came in, what is still owed, and what
        needs doing today.
      </p>
      <button
        type="button"
        onClick={onAddStudent}
        className="btn-glass bg-[var(--surface-inset)] border border-[var(--border-default)] min-h-[44px] px-5 py-2.5 rounded-xl text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 transition-colors cursor-pointer hover:bg-[var(--surface-raised)] hover:border-[var(--info)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
      >
        <UserPlus className="w-4 h-4" aria-hidden="true" />
        Add Student
      </button>
    </div>
  );
}

function ActivityItem({
  title,
  subtitle,
  time,
  accent,
}: {
  title: string;
  subtitle: string;
  time: string;
  accent: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-[var(--border-default)] pb-4 last:border-0 last:pb-0">
      <div
        className="w-2 h-2 mt-1.5 rounded-full shrink-0"
        style={{ backgroundColor: accent }}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
        {subtitle !== "" && (
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>
        )}
      </div>
      {time !== "" && (
        <span className="text-xs text-[var(--text-muted)] opacity-70 shrink-0">{time}</span>
      )}
    </div>
  );
}

function QuickAction({
  icon,
  label,
  accent,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-glass bg-[var(--surface-inset)] border border-[var(--border-default)] min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 transition-all cursor-pointer hover:bg-[var(--surface-raised)] hover:border-[var(--info)]/30 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
    >
      <span style={{ color: accent }} aria-hidden="true">
        {icon}
      </span>{" "}
      {label}
    </button>
  );
}
