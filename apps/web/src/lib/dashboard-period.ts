// Implements: 04_Dashboard.md §6.4 (the Month / Range / All period filter and
// exactly which cards it may move), §6.1 C1..C6, §11 E4 (a range longer than
// 90 days is refused, not silently truncated), §11 E9 (bounds are explicit ISO
// days, never "today" arithmetic against a possibly-wrong device clock), §14
// (the filter is validated before it is dispatched); 12_Business_Rules.md
// BR-M-01 (nothing in here touches money — a window is two calendar days, and
// every amount stays integer paise on the gateway side); AGENTS.md §6.1 (Zod is
// the single source of truth for input) and §2 Rule 4 (a period is a filter on
// the one route, never a screen and never a new origin).
//
// WHY A NEW MODULE, AND WHY ISOMORPHIC.
//
// The period used to be four pills on `dashboard-client.tsx` writing a store
// field while the query key was the constant `["dashboard","summary"]` and the
// action took no argument. Four controls, one payload, no visible effect — the
// exact class of defect the file's own header describes. The fix is not more UI,
// it is ONE definition of "what does this filter mean", imported by the three
// places that must agree: the control that renders it, the server action that
// sends it, and the tests that prove it moves the numbers it claims to move.
//
// A second copy is how the pills came back wrong the first time, so the window
// derivation is deliberately pure and has no `Date.now()` of its own: the caller
// passes the instant. `lib/dashboard-analytics-calc.ts` sets the precedent for
// pure date derivations living outside the `"use server"` boundary — a Zod
// schema is an object, and a "use server" module may only export async
// functions, so a filter schema placed there breaks the build outright.

import { z } from "zod";

/**
 * §11 E4: "Range > 90 days → Filter popover rejects with toast". The limit
 * exists so the heatmap and activity window stay one bounded read. It is
 * exported because the control, the schema and the tests all quote the same
 * number, and a limit that exists in two places is a limit that will disagree.
 */
export const DASHBOARD_PERIOD_MAX_RANGE_DAYS = 90;

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The earliest day the gateway will be asked for. All-time is bounded, never
 *  an empty string: `periodStartIso` is a required, `YYYY-MM-DD` parameter and
 *  the route answers a malformed one with a typed 400. */
export const ALL_TIME_START_ISO = "1970-01-01";

/**
 * A calendar day or nothing. A blank input string normalises to `null` rather
 * than surviving as `""`, because `""` is a truthy-looking bound that would
 * sail through a string comparison and widen the window to all time.
 */
const optionalDay = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value): string | null => {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    return DAY_PATTERN.test(trimmed) ? trimmed : null;
  });

/**
 * The three modes of §6.4. `month` is the default and means "the calendar month
 * so far" — the same window the gateway used when the parameter was absent, so
 * the default is a no-op on the numbers rather than a silent change of meaning.
 */
export const DashboardPeriodSchema = z
  .object({
    mode: z.enum(["month", "range", "all"]),
    start: optionalDay,
    end: optionalDay,
  })
  .superRefine((period, ctx) => {
    if (period.mode !== "range") return;
    if (period.start === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["start"],
        message: "a range needs a start day",
      });
      return;
    }
    if (period.end === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: "a range needs an end day",
      });
      return;
    }
    // Lexicographic on `YYYY-MM-DD` is exact and is the same comparison the
    // gateway makes, so the two can never disagree about which day is first.
    if (period.start > period.end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["start"],
        message: `start ${period.start} is after end ${period.end}: the window is empty`,
      });
      return;
    }
    const days = inclusiveDayCount(period.start, period.end);
    if (days !== null && days > DASHBOARD_PERIOD_MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: `a range cannot exceed ${DASHBOARD_PERIOD_MAX_RANGE_DAYS} days (this one spans ${days})`,
      });
    }
  });

export type DashboardPeriod = z.infer<typeof DashboardPeriodSchema>;

export type DashboardPeriodMode = DashboardPeriod["mode"];

export interface PeriodWindow {
  /** Sent verbatim to the gateway as `periodStartIso` / `periodEndIso`. */
  readonly periodStartIso: string;
  readonly periodEndIso: string;
  /** What the tutor reads on the control and in every card caption, e.g.
   *  "September 2026", "12 Aug to 9 Sep 2026", "All time". */
  readonly label: string;
  /** Lower-case form for mid-sentence captions. */
  readonly labelLower: string;
  /** Which cards the window moves (C1 collected, C3 due-in-period), and which
   *  it must not touch (C2 due-till-date, C4 students, C5 with-dues, C6
   *  breakdown). §6.4 fixes that split; the client renders the exclusion as
   *  muted helper text INSIDE the card, because §6.4 says the tutor must never
   *  wonder why a number did not move. */
  readonly movesMoneyCards: boolean;
}

/** `YYYY-MM-DD` for the UTC day containing `ms`. */
export function isoDayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Signed whole-day difference `to - from`, in UTC calendar days. `0` means the
 * same day. `null` when either bound is not a real day — a caller must never
 * receive 0 for an unreadable date, because 0 is a figure a tutor would read.
 *
 * This is the primitive BOTH derived measures need, and getting its off-by-one
 * wrong in either direction is the bug this doc comment exists to prevent:
 *
 *  - "how many days late is this invoice" wants the raw difference, so an
 *    invoice due today is 0 days late and one due yesterday is 1.
 *  - "how many days does this range span" wants the difference PLUS ONE, since
 *    a range from the 1st to the 1st is one day long, not zero.
 *
 * The unit test asserts both, so the two cannot quietly disagree again.
 */
export function dayDifference(fromIso: string, toIso: string): number | null {
  if (!DAY_PATTERN.test(fromIso) || !DAY_PATTERN.test(toIso)) return null;
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / DAY_MS);
}

/**
 * Whole calendar days from `startIso` to `endIso`, BOTH ENDS COUNTED, which is
 * how a tutor counts a range and how §11 E4's 90-day cap reads. `null` when
 * either bound is unreadable.
 */
export function inclusiveDayCount(startIso: string, endIso: string): number | null {
  const difference = dayDifference(startIso, endIso);
  return difference === null ? null : difference + 1;
}

/**
 * Calendar days a due date is behind today. `0` means "due today", which is
 * NOT the same as "one day overdue".
 *
 * The previous client helper compared `now` against the due date parsed as UTC
 * midnight, so any invoice whose due date was today came out at
 * `floor(elapsed / 1 day) + 1` = "1 day overdue" from the first minute of the
 * day. A tutor reading that line would chase money that is not yet late.
 * Counting the calendar-day DIFFERENCE, the way `dashboard-analytics-calc.ts`
 * counts them for the aging buckets, makes the two panels on the same screen
 * agree on every invoice.
 *
 * `null` means "no readable due date" or "not yet due", and the caller hides the
 * line rather than printing a number it cannot stand behind.
 */
export function calendarDaysOverdue(dueDateIso: string | null, nowMs: number): number | null {
  if (dueDateIso === null) return null;
  const day = dueDateIso.slice(0, 10);
  if (!DAY_PATTERN.test(day)) return null;
  const days = dayDifference(day, isoDayOf(nowMs));
  // A future due date is not "negative overdue" — it is not overdue at all.
  if (days === null || days < 0) return null;
  return days;
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function monthLabelOf(iso: string): string {
  const at = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(at)) return iso;
  return MONTH_YEAR.format(new Date(at));
}

function dayLabelOf(iso: string): string {
  const at = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(at)) return iso;
  return DAY_MONTH_YEAR.format(new Date(at));
}

/**
 * The one place a `DashboardPeriod` becomes a window. Pure: the caller owns the
 * clock, so the control, the action and the test all derive the same bounds from
 * the same instant.
 *
 * Fail-closed, in the sense Rule 9 means for a money screen: a `range` whose
 * bounds are unreadable falls back to the calendar month rather than to
 * all-time, because the two differ by every payment ever taken. A window that
 * cannot be trusted must not silently become the widest one available.
 */
export function resolvePeriodWindow(
  period: DashboardPeriod,
  nowMs: number,
): PeriodWindow {
  const today = isoDayOf(nowMs);
  const monthStart = `${today.slice(0, 8)}01`;

  if (period.mode === "all") {
    return {
      periodStartIso: ALL_TIME_START_ISO,
      periodEndIso: today,
      label: "All time",
      labelLower: "all time",
      movesMoneyCards: true,
    };
  }

  if (
    period.mode === "range" &&
    period.start !== null &&
    period.end !== null &&
    period.start <= period.end
  ) {
    return {
      periodStartIso: period.start,
      periodEndIso: period.end,
      label: `${dayLabelOf(period.start)} to ${dayLabelOf(period.end)}`,
      labelLower: `${dayLabelOf(period.start)} to ${dayLabelOf(period.end)}`.toLowerCase(),
      movesMoneyCards: true,
    };
  }

  return {
    periodStartIso: monthStart,
    periodEndIso: today,
    label: monthLabelOf(monthStart),
    labelLower: monthLabelOf(monthStart).toLowerCase(),
    movesMoneyCards: true,
  };
}

/** The default control state: the calendar month, matching the gateway's own
 *  default so opening the Dashboard changes no figure. */
export function defaultDashboardPeriod(): DashboardPeriod {
  return { mode: "month", start: null, end: null };
}
