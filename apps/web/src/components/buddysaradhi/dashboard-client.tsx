"use client";

// Implements: 04_Dashboard.md §3 (KPI strip, due-today list, activity feed, quick
// actions), §4 (period filter — REMOVED, see below), §9.2 (prev-period delta —
// REMOVED, see below), §12 (state matrix); AGENTS.md §2 Rule 9 (no silent
// failures — a failed read renders an `ErrorState`, never zeroes) and Rule 10
// (44px targets, colour never the only signal, reduced motion via `.skeleton`).
//
// THREE LIAR-CONTROLS WERE REMOVED FROM THIS SCREEN, all by the same rule: a
// tutor's own books are the one thing this screen may not approximate.
//
//   1. The period filter (spec §4, §8.1, §8.2) is still GONE as a CONTROL, but
//      the reason has changed. It wrote `stores/dashboard.ts` `periodFilter`
//      while the query key was the constant `["dashboard","summary"]` and
//      `fetchDashboardSummaryAction()` took no argument, so four pills
//      repainted one payload. It could not simply be wired up while the gateway
//      read `periodStartIso`/`periodEndIso` and discarded both, leaving the KPI
//      maths period-free (collected was every `PAYMENT_RECEIVED` row ever
//      written). That is fixed at the source now —
//      `apps/gateway/routes/analytics.ts` validates the window, bounds
//      `collectedThisMonthMinor` and `dueForMonthMinor` by it, and answers a
//      malformed one with a typed 400. Restoring the pills is therefore a
//      separate, honest piece of work: pass the filter through the action, put
//      it in the query key, and four caches stop serving one payload. The Collected
//      tile below says "Received this month" because that is what the default
//      window (1st of the month → today) measures.
//   2. The "18% vs last month" delta on Collected is GONE. Spec §9.2 defines the
//      prev-period delta as a SECOND aggregate over the previous month, which
//      the gateway does not expose; computing it here would be the second
//      implementation this screen just lost. In its place each money KPI states
//      the real scope of its measure, which is what spec line 166 already asks
//      for ("All-time, ignores filter") and what a tutor needs to know before
//      reconciling anything.
//   3. `JSON.parse` in the render path is GONE. Activity rows are normalised at
//      the action boundary; this file receives `present_count: number | null`
//      and never parses, so no receipt number or prose blob can throw the
//      dashboard away.
//
// The Due Today list is a PAGE of at most 50 overdue invoices, and this file now
// says so. `dueTodayTotal` / `dueTodayTruncated` used to be stripped by the Zod
// boundary, so the header counted what it happened to be holding and implied
// completeness; the three rows below a 200-student institute showed as the whole
// of their arrears.

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
import { useStudentsStore } from "@/stores/students-store";
import { useShellStore } from "@/stores/shell-store";
import {
  fetchDashboardSummaryAction,
  type DashboardActivityItem,
} from "@/server/actions/dashboard";

const DAY_MS = 86_400_000;

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
 * Days past an invoice's due date, counted inclusively (an invoice due
 * yesterday is 1 day overdue, not 0). The due-today query already selects
 * `dueDate <= today`, so the previous label computed a negative number and then
 * clamped it to "0d" for every row — a figure that means nothing. What a tutor
 * scanning this list needs is how late each row is. `null` = no readable due
 * date, and the caller hides the line rather than guessing.
 */
function daysOverdue(dueDate: string | null, nowMs: number): number | null {
  if (dueDate === null) return null;
  const due = new Date(dueDate).getTime();
  if (Number.isNaN(due)) return null;
  const elapsed = nowMs - due;
  if (elapsed <= 0) return 0;
  return Math.floor(elapsed / DAY_MS) + 1;
}

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

  const openAddStudent = () => {
    setActiveScreen("/students");
    setTimeout(() => {
      useStudentsStore.getState().openAddSheet();
    }, 0);
  };

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: async () => {
      const res = await fetchDashboardSummaryAction();
      if (!res.ok) throw new Error(res.error);
      return res.value;
    },
  });

  /**
   * Header and quick actions render in EVERY branch. A tutor whose figures did
   * not load still needs a route to the other four screens — that is the whole
   * point of saying what is safe to do.
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

  const { kpis, activity, dueToday, dueTodayTotal, dueTodayTruncated } = data;

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

      {/* KPI strip — matches TutorOS prototype */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Collected"
          value={kpis.collectedThisMonthMinor}
          formatFn={formatINR}
          icon={<TrendingUp className="w-5 h-5" />}
          accent="var(--success)"
          caption="Payments received this month"
        />
        <KPICard
          title="Due Till Date"
          value={kpis.dueTillDateMinor}
          formatFn={formatINR}
          icon={<AlertCircle className="w-5 h-5" />}
          accent="var(--warning)"
          delta={{
            dir: "flat",
            label: `${kpis.studentsWithDues} ${kpis.studentsWithDues === 1 ? "student" : "students"} owe`,
          }}
          caption="Owed up to today, all time"
        />
        <KPICard
          title="Active Students"
          value={kpis.totalStudents}
          icon={<Users className="w-5 h-5" />}
          accent="var(--info)"
        />
        <KPICard
          title="Overdue"
          value={kpis.overdueMinor}
          formatFn={formatINR}
          icon={<CalendarDays className="w-5 h-5" />}
          accent="var(--danger)"
          caption="Unpaid invoices past their due date"
        />
      </div>

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
              {dueToday.map((d) => {
                const overdueDays = daysOverdue(d.due_date, now);
                return (
                  <div
                    key={d.student_id}
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

function KPICard({
  title,
  value,
  formatFn,
  icon,
  accent,
  delta,
  caption,
}: {
  title: string;
  value: number;
  formatFn?: (v: number) => string;
  icon: React.ReactNode;
  accent: string;
  delta?: { dir: "up" | "down" | "flat"; label: string };
  /**
   * The real scope of the measure, as spec line 166 asks for. It replaces a
   * delta percentage the data cannot support: a tutor reading "Collected ₹2.4
   * lakh / All payments received to date" knows what the number is; "18% vs
   * last month" would have been a guess presented as arithmetic.
   */
  caption?: string;
}) {
  return (
    <div
      className="glass-panel p-5 rounded-xl flex flex-col justify-between transition-all hover:border-[var(--info)]/30"
      style={{
        border: "1px solid color-mix(in srgb, " + accent + " 25%, transparent)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
          {title}
        </p>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "color-mix(in srgb, " + accent + " 15%, transparent)", color: accent }}
          aria-hidden="true"
        >
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold text-[var(--text-primary)] tracking-tight num">
        <CountUp value={value} formatFn={formatFn} />
      </p>
      {delta && (
        <p
          className={cn(
            "text-xs mt-1 flex items-center gap-1 num",
            delta.dir === "up" && "text-[var(--success)]",
            delta.dir === "down" && "text-[var(--danger)]",
            delta.dir === "flat" && "text-[var(--text-muted)]",
          )}
        >
          {delta.dir === "up" && <TrendingUp className="w-3 h-3" />}
          {delta.label}
        </p>
      )}
      {caption && <p className="text-xs mt-1 text-[var(--text-muted)]">{caption}</p>}
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
      className="btn-glass bg-[var(--surface-inset)] border border-[var(--border-default)] min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 transition-all cursor-pointer hover:bg-[var(--surface-raised)] hover:border-[var(--info)]/30 active:scale-[0.98]"
    >
      <span style={{ color: accent }} aria-hidden="true">
        {icon}
      </span>{" "}
      {label}
    </button>
  );
}
