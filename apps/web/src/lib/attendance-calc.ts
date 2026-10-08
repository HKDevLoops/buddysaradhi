// Implements: 12_Business_Rules.md BR-CALC-06, 06_Attendance.md §9.7 + §10.5.
//
// WHY THIS FILE EXISTS: `attendancePct` used to be exported from
// `server/actions/attendance.ts`, which carries `"use server"`. A `"use server"`
// module may only export ASYNC functions — Next rejects a synchronous export at
// BUILD time with "Server Actions must be async functions", and `tsc` does not
// catch it, so the build breaks while the typecheck and all unit tests stay
// green. The pure arithmetic belongs in an isomorphic module anyway: a
// percentage is arithmetic, not an action, and the component that DISPLAYS it
// needs the identical function the summary that COMPUTES it uses.

/**
 * BR-CALC-06 / 06 §9.7 attendance percentage.
 *
 * `excused` and `holiday` are EXCLUDED from the denominator (BR-CALC-06,
 * BR-ATT-02 "excused and holiday are excluded from the denominator",
 * BR-ATT-04/09, 06 §9.7 and §10.2 all say so) — a medical leave or a declared
 * holiday must not read as an absence. `late` counts as ATTENDED: BR-ATT-02
 * ("Late counts as present for %, flagged separately"), 06 §9.7
 * (`presentOrLate_count / totals_count`) and 06 §10.5 ("late counts toward % as
 * present does") all put late in the numerator; the `BR-CALC-06` formula line
 * omits it, which is a genuine contradiction between two specs — raised as a
 * cross-lane report, and resolved here in favour of the three concurring
 * statements (the more specific attendance rule wins over the one-line
 * formula).
 *
 * Returns `null` for a zero denominator (BR-CALC-06: "pct = null (display
 * '—')"). This matters: the previous implementation returned `0`, which told a
 * tutor that nobody came to a session that had no attendees recorded — a fact
 * stated as certainty when there was none.
 */
export function attendancePct(counts: {
  present: number;
  late: number;
  absent: number;
}): number | null {
  const attended = counts.present + counts.late;
  const denominator = attended + counts.absent;
  if (denominator <= 0) return null;
  return Math.round((attended / denominator) * 100);
}

/**
 * BR-CALC-06's DISPLAY half, beside its arithmetic half.
 *
 * The dash rule used to be a private `pctText` inside
 * `attendance-summary.tsx` — a component, which is the one thing a refactor
 * rewrites and the one thing no unit test can reach without a DOM. So the claim
 * "an unmeasurable period reads `—`, never `0%`" had no test behind it, while
 * the arithmetic next door had three. It lives here now so a Vitest assertion
 * pins it without rendering anything.
 *
 * `null` is the only input that means "nothing to measure". `0` is a DIFFERENT
 * claim — this student attended nothing — and printing it for an empty period
 * accuses a tutor's roster of an absence nobody recorded. A non-finite value
 * (only reachable if the arithmetic is broken) collapses to the dash too rather
 * than throwing: this function runs inside a render, and a cosmetic defect must
 * not be able to take the whole Attendance screen down — that is exactly what the
 * unparseable period bound did before (`localDayIso` → `"2026-10-00"` →
 * `date-fns` `RangeError` → `error.tsx`).
 */
export function attendancePctText(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  return `${Math.round(pct)}%`;
}