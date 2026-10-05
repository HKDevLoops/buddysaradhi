// Implements: 04_Dashboard.md §6.4 (Month / Range / All), §11 E4 (90-day
// rejection), §11 E9 (explicit ISO bounds, never "today" arithmetic on a
// possibly-wrong device clock); §14 "the Dashboard validates its own data
// shape". 12_Business_Rules.md BR-M-01 (a window is two calendar days; no
// money is touched here). AGENTS.md §2 Rule 6 (integer arithmetic only).

import { describe, expect, it } from "vitest";
import {
  ALL_TIME_START_ISO,
  DASHBOARD_PERIOD_MAX_RANGE_DAYS,
  DashboardPeriodSchema,
  calendarDaysOverdue,
  dayDifference,
  defaultDashboardPeriod,
  inclusiveDayCount,
  isoDayOf,
  resolvePeriodWindow,
} from "./dashboard-period";

/** 2026-10-05T09:30:00Z — a Monday, mid-morning, so a UTC-day slip would show. */
const NOW = Date.parse("2026-10-05T09:30:00.000Z");

describe("DashboardPeriodSchema", () => {
  it("accepts the three §6.4 modes", () => {
    expect(DashboardPeriodSchema.safeParse({ mode: "month", start: null, end: null }).success).toBe(true);
    expect(DashboardPeriodSchema.safeParse({ mode: "all", start: null, end: null }).success).toBe(true);
    expect(
      DashboardPeriodSchema.safeParse({ mode: "range", start: "2026-09-01", end: "2026-09-30" })
        .success,
    ).toBe(true);
  });

  it("refuses an unknown mode rather than defaulting it to all time", () => {
    const parsed = DashboardPeriodSchema.safeParse({ mode: "quarter", start: null, end: null });
    expect(parsed.success).toBe(false);
  });

  it("normalises a blank bound to null so it cannot widen the window", () => {
    const parsed = DashboardPeriodSchema.safeParse({ mode: "range", start: "  ", end: "2026-09-30" });
    expect(parsed.success).toBe(false);
    const parsedMonth = DashboardPeriodSchema.parse({
      mode: "month",
      start: "   ",
      end: "",
    });
    expect(parsedMonth.start).toBeNull();
    expect(parsedMonth.end).toBeNull();
  });

  it("refuses a reversed range (§14: start ≤ end, enforced before dispatch)", () => {
    const parsed = DashboardPeriodSchema.safeParse({
      mode: "range",
      start: "2026-09-30",
      end: "2026-09-01",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toMatch(/after end/);
  });

  it("refuses a range with a missing bound", () => {
    expect(
      DashboardPeriodSchema.safeParse({ mode: "range", start: "2026-09-01", end: null }).success,
    ).toBe(false);
    expect(
      DashboardPeriodSchema.safeParse({ mode: "range", start: null, end: "2026-09-01" }).success,
    ).toBe(false);
  });

  it(`accepts exactly ${DASHBOARD_PERIOD_MAX_RANGE_DAYS} days and refuses ${DASHBOARD_PERIOD_MAX_RANGE_DAYS + 1} (§11 E4)`, () => {
    const atLimit = DashboardPeriodSchema.safeParse({
      mode: "range",
      start: "2026-07-08",
      end: "2026-10-05",
    });
    expect(inclusiveDayCount("2026-07-08", "2026-10-05")).toBe(
      DASHBOARD_PERIOD_MAX_RANGE_DAYS,
    );
    expect(atLimit.success).toBe(true);

    const overLimit = DashboardPeriodSchema.safeParse({
      mode: "range",
      start: "2026-07-07",
      end: "2026-10-05",
    });
    expect(inclusiveDayCount("2026-07-07", "2026-10-05")).toBe(
      DASHBOARD_PERIOD_MAX_RANGE_DAYS + 1,
    );
    expect(overLimit.success).toBe(false);
    if (!overLimit.success) {
      expect(overLimit.error.issues[0]?.message).toMatch(
        new RegExp(`cannot exceed ${DASHBOARD_PERIOD_MAX_RANGE_DAYS} days`),
      );
    }
  });
});

describe("resolvePeriodWindow", () => {
  it("month mode is the calendar month so far, matching the gateway default", () => {
    const window = resolvePeriodWindow({ mode: "month", start: null, end: null }, NOW);
    expect(window.periodStartIso).toBe("2026-10-01");
    expect(window.periodEndIso).toBe("2026-10-05");
    expect(window.label).toBe("October 2026");
    expect(window.labelLower).toBe("october 2026");
  });

  it("all mode is bounded, never an empty string the route would 400 on", () => {
    const window = resolvePeriodWindow({ mode: "all", start: null, end: null }, NOW);
    expect(window.periodStartIso).toBe(ALL_TIME_START_ISO);
    expect(window.periodEndIso).toBe("2026-10-05");
    expect(window.label).toBe("All time");
    expect(window.periodStartIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("range mode sends exactly the two days chosen", () => {
    const window = resolvePeriodWindow(
      { mode: "range", start: "2026-08-12", end: "2026-09-09" },
      NOW,
    );
    expect(window.periodStartIso).toBe("2026-08-12");
    expect(window.periodEndIso).toBe("2026-09-09");
    // Intl's short month for September is "Sept" in some ICU builds, so the
    // assertion is on the day and the year, which are what must survive.
    expect(window.label).toMatch(/^12 .+ 2026 to 9 .+ 2026$/);
    expect(window.labelLower).toBe(window.label.toLowerCase());
  });

  it("falls back to the calendar month when a range's bounds are unreadable", () => {
    // Fail-closed on the NARROW window: an untrustworthy range must not become
    // all-time, which differs by every payment the tutor ever took.
    const window = resolvePeriodWindow({ mode: "range", start: null, end: null }, NOW);
    expect(window.periodStartIso).toBe("2026-10-01");
    expect(window.periodEndIso).toBe("2026-10-05");
  });

  it("produces different bounds per mode, so the filter is not decorative", () => {
    const month = resolvePeriodWindow({ mode: "month", start: null, end: null }, NOW);
    const range = resolvePeriodWindow(
      { mode: "range", start: "2026-01-01", end: "2026-01-31" },
      NOW,
    );
    const all = resolvePeriodWindow({ mode: "all", start: null, end: null }, NOW);
    const bounds = new Set([month, range, all].map((w) => `${w.periodStartIso}..${w.periodEndIso}`));
    expect(bounds.size).toBe(3);
    expect(range.periodStartIso).not.toBe(month.periodStartIso);
    expect(all.periodStartIso).not.toBe(month.periodStartIso);
  });

  it("uses the caller's clock, not Date.now(), so the control and the read agree", () => {
    const beforeMidnight = resolvePeriodWindow({ mode: "month", start: null, end: null }, NOW);
    const nextDay = resolvePeriodWindow(
      { mode: "month", start: null, end: null },
      Date.parse("2026-10-06T00:05:00.000Z"),
    );
    expect(beforeMidnight.periodEndIso).toBe("2026-10-05");
    expect(nextDay.periodEndIso).toBe("2026-10-06");
  });
});

describe("calendarDaysOverdue", () => {
  it("counts an invoice due TODAY as zero days, not one", () => {
    // The regression: the old local helper did floor(elapsed/1d) + 1 against UTC
    // midnight, so this read "1 day overdue" from 00:00:01 today.
    expect(calendarDaysOverdue("2026-10-05", NOW)).toBe(0);
  });

  it("counts one day for an invoice due yesterday", () => {
    expect(calendarDaysOverdue("2026-10-04", NOW)).toBe(1);
  });

  it("counts whole calendar days for an older invoice", () => {
    expect(calendarDaysOverdue("2026-09-05", NOW)).toBe(30);
    expect(calendarDaysOverdue("2026-01-06", NOW)).toBe(272);
  });

  it("returns null for a future due date rather than a negative count", () => {
    expect(calendarDaysOverdue("2026-10-06", NOW)).toBeNull();
  });

  it("returns null when there is no readable due date", () => {
    expect(calendarDaysOverdue(null, NOW)).toBeNull();
    expect(calendarDaysOverdue("", NOW)).toBeNull();
    expect(calendarDaysOverdue("not-a-date", NOW)).toBeNull();
  });

  it("agrees with the aging panel's own 0-7 day bucket boundary", () => {
    // `dashboard-analytics-calc.ts` puts days <= 7 in the first bucket; a day-7
    // invoice and a day-8 invoice must not read the same on both panels.
    expect(calendarDaysOverdue("2026-09-28", NOW)).toBe(7);
    expect(calendarDaysOverdue("2026-09-27", NOW)).toBe(8);
  });
});

describe("helpers", () => {
  it("isoDayOf returns a well-formed UTC day", () => {
    expect(isoDayOf(NOW)).toBe("2026-10-05");
    expect(isoDayOf(NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("dayDifference is the signed difference and inclusiveDayCount is that plus one", () => {
    // The two derived measures need different off-by-ones from ONE primitive:
    // "how late" wants the raw difference (today = 0), "how long is this range"
    // wants the inclusive span (one day = 1). Asserting both here is what stops
    // them drifting apart again.
    expect(dayDifference("2026-10-05", "2026-10-05")).toBe(0);
    expect(dayDifference("2026-10-04", "2026-10-05")).toBe(1);
    expect(dayDifference("2026-10-06", "2026-10-05")).toBe(-1);
    expect(inclusiveDayCount("2026-10-05", "2026-10-05")).toBe(1);
    expect(inclusiveDayCount("2026-10-04", "2026-10-05")).toBe(2);
  });

  it("both day measures refuse an unreadable bound instead of returning 0", () => {
    expect(dayDifference("nope", "2026-10-05")).toBeNull();
    expect(dayDifference("2026-10-05", "nope")).toBeNull();
    expect(inclusiveDayCount("nope", "2026-10-05")).toBeNull();
    expect(inclusiveDayCount("2026-10-05", "nope")).toBeNull();
  });

  it("dayDifference survives a DST-style month boundary as an exact day count", () => {
    // March in the northern hemisphere contains a 23-hour local day; counting in
    // UTC keeps every interval a whole number of days.
    expect(dayDifference("2026-03-01", "2026-04-01")).toBe(31);
  });

  it("defaultDashboardPeriod is the month mode, so opening the screen changes no figure", () => {
    expect(defaultDashboardPeriod()).toEqual({ mode: "month", start: null, end: null });
    const window = resolvePeriodWindow(defaultDashboardPeriod(), NOW);
    expect(window.periodStartIso).toBe("2026-10-01");
  });
});
