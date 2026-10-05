"use server";

// Implements: 04_Dashboard.md §3 (KPI strip, due-today list, activity feed) and
// §9 (every Dashboard figure is READ through the gateway; the client never
// recomputes a financial measure); AGENTS.md §2 Rule 9 (no silent failures),
// §3.4/§3.5 (one money flow, one implementation — never two) and §6.1 (Zod is
// the single source of truth for input).
//
// THE SEAM IS THE GATEWAY. `apps/gateway/routes/analytics.ts` is the only
// implementation of every number on this screen, and this file is the only thing
// that talks to it.
//
// There is deliberately no direct-DB path. `computeDashboardFromDb` was removed
// because it was a SECOND implementation of the same contract that computed a
// DIFFERENT set of measures — all-time payments under the name
// `collectedThisMonthMinor`, `partial = dues.length`, `unpaid = 0`,
// `paid === noDues`, and every due row labelled `student_name: "Student"` — and
// then returned them with `dataOrigin: "live"`, the exact value that field
// exists to prevent. `gatewayGet` maps every non-2xx to `success: false`, so a
// fallback does not "keep the screen working": it converts a gateway failure
// into a plausible wrong answer, which reads as "the app is working". The same
// anti-pattern was removed from the roster read in
// `server/queries/students.ts`; the dashboard now fails honestly instead.
//
// Boundary invariant: the Zod schemas below are the ONLY place the gateway's
// wire shape is trusted. The render path receives integer paise, ISO-8601
// dates and pre-resolved activity copy, and never parses JSON, formats a date,
// or invents a number of its own.

import { gatewayGet } from "@/server/get-db";
import { log } from "@/lib/logger";
import { z } from "zod";
import {
  AnalyticsFilterSchema,
} from "@/lib/dashboard-analytics-calc";
import {
  getDashboardAnalytics,
  type DashboardAnalytics,
} from "@/server/queries/dashboard-analytics";

/* ------------------------------------------------------------------ *
 * Boundary schemas
 * ------------------------------------------------------------------ */

/**
 * BR-M-01 / AGENTS.md §2 Rule 6. Money crosses this boundary as integer paise.
 * A driver that hands back a float is an artefact of the same integer, so it is
 * rounded back rather than propagated into `formatINR` (which would then print
 * `₹1,255.5499` — the FM-02 failure mode). A value outside the safe-integer
 * range is REJECTED rather than clamped: a clamped amount is a fabricated
 * figure, and this screen shows a tutor their own books.
 */
const paiseSchema = z
  .number()
  .finite()
  .transform((value) => Math.round(value))
  .refine(Number.isSafeInteger, { message: "amount outside the safe-integer range" });

/**
 * The gateway's date columns arrive as an ISO string, an epoch number, or
 * `null`, depending on the driver's column type. `new Date(null)` is the EPOCH
 * rather than a failure, so `null` is screened out before coercion. Anything
 * unparseable degrades to `null` — the caller then hides the dependent line
 * instead of rendering `NaNd` into a dues list.
 */
const isoDateSchema = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  });

/**
 * The five event kinds `DashboardActivityItem` declares. Only PAYMENT, INVOICE
 * and OTHER are emitted by the gateway today; the other two are kept so a future
 * writer does not get rejected wholesale by this schema.
 */
const ACTIVITY_EVENT_TYPES = [
  "PAYMENT",
  "INVOICE",
  "ATTENDANCE_LOCKED",
  "STUDENT_ENROLLED",
  "OTHER",
] as const;

const presentCountSchema = z.object({ present_count: z.number().finite() });

/**
 * `additional_data` is whatever the event's writer put there: a JSON blob for an
 * attendance lock, a receipt number for a payment, prose for a notification.
 * It is parsed ONCE here behind `safeParse` and the renderer receives a number
 * or `null`. The previous render-path `JSON.parse` threw on a receipt number
 * and took the entire dashboard with it; worse, a failed parse would have
 * printed "0 present" — a false claim about a tutor's attendance.
 */
function readPresentCount(additionalData: string | null | undefined): number | null {
  if (typeof additionalData !== "string" || additionalData === "") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(additionalData);
  } catch {
    // Not exceptional: prose and receipt numbers are the common case. The
    // caller treats non-JSON as "no detail", and this branch reports itself
    // through the `null` it returns, so nothing is swallowed (Rule 9).
    return null;
  }
  const parsed = presentCountSchema.safeParse(payload);
  if (!parsed.success) return null;
  const count = Math.round(parsed.data.present_count);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

/** A name the driver returned as null/blank stays empty; the renderer decides. */
const labelSchema = z
  .string()
  .nullish()
  .transform((value) => (value ?? "").trim());

const kpisSchema = z.object({
  totalStudents: z.number().int().nonnegative(),
  studentsWithDues: z.number().int().nonnegative(),
  /**
   * Payments received inside the requested period, in integer paise. The gateway
   * honours `periodStartIso`/`periodEndIso` and defaults to the calendar month
   * so far, so the name is finally the measure. It was the sum of every
   * `PAYMENT_RECEIVED` row ever written while being called
   * `collectedThisMonthMinor`, and the route discarded the period it had just
   * parsed — see `apps/gateway/routes/analytics.ts`.
   */
  collectedThisMonthMinor: paiseSchema,
  dueTillDateMinor: paiseSchema,
  /**
   * Outstanding on invoices DUE inside the same period, net of payments
   * attributed to each one, voided invoices excluded. Also period-honouring
   * now; it previously summed `total` over every non-`paid` invoice, which
   * ignored payments, ignored dates and counted voids.
   */
  dueForMonthMinor: paiseSchema,
  overdueMinor: paiseSchema,
  paymentBreakdown: z.object({
    paid: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    unpaid: z.number().int().nonnegative(),
    noDues: z.number().int().nonnegative(),
  }),
});

const activityItemSchema = z
  .object({
    id: z.string().min(1),
    event_type: z.enum(ACTIVITY_EVENT_TYPES),
    /**
     * A person, or "" when the event has no student to name. The gateway joins
     * ledger rows to the roster and sends `null` rather than a category label:
     * it previously sent `e.description || e.type`, so this column rendered the
     * sentence "Payment received" where a name belonged. Absent is now absent.
     */
    student_name: labelSchema,
    /**
     * The event's own label — what a notification actually has. Carried
     * separately so `student_name` can mean a person, and so the OTHER branch of
     * `describeActivity` still has something to title the row with instead of
     * borrowing the name column for prose.
     */
    event_title: labelSchema,
    invoice_number: z.string().nullish().transform((value) => value ?? null),
    minor_amount: paiseSchema,
    additional_data: z.string().nullish(),
    timestamp: isoDateSchema,
  })
  .transform((item) => ({
    id: item.id,
    event_type: item.event_type,
    student_name: item.student_name,
    event_title: item.event_title,
    invoice_number: item.invoice_number,
    minor_amount: item.minor_amount,
    /** Null means "the gateway sent no readable count" — not zero. */
    present_count: readPresentCount(item.additional_data),
    timestamp: item.timestamp,
  }));

const dueTodayItemSchema = z.object({
  student_id: z.string().min(1),
  student_name: labelSchema,
  due_minor: paiseSchema,
  invoice_number: z.string().nullish().transform((value) => value ?? null),
  due_date: isoDateSchema,
});

const summarySchema = z.object({
  kpis: kpisSchema,
  activity: z.array(activityItemSchema),
  dueToday: z.array(dueTodayItemSchema),
  /**
   * THE COMPLETENESS SIGNAL. The gateway caps `dueToday` at 50 rows, so the
   * slice is a page whenever the population is larger — and a page that renders
   * as if it were the whole list tells a tutor their most-overdue invoice does
   * not exist.
   *
   * These two fields were computed by the route and then STRIPPED here, because
   * a Zod object drops any key it does not declare: the numbers crossed the
   * boundary and were discarded, so no client could ever say "50 of 87". They are
   * declared here, therefore they survive.
   *
   * `dueToday.length === dueTodayTotal` is the client's own test for "this list
   * is everything", which means `dueTodayTruncated` is a restatement rather than
   * a second source of truth — but it is the one the renderer reads, and a
   * derived comparison is one more place for the two to disagree.
   */
  dueTodayTotal: z.number().int().nonnegative(),
  dueTodayTruncated: z.boolean(),
  /**
   * Enforced, not decorative. Before this boundary `dataOrigin` was a constant
   * the fallback wrote, so it could never disagree with the numbers. A `stub`
   * payload now fails validation instead of rendering as a tutor's real books.
   */
  dataOrigin: z.literal("live"),
});

export type DashboardKpis = z.infer<typeof kpisSchema>;
export type DashboardActivityItem = z.infer<typeof activityItemSchema>;
export type DashboardDueTodayItem = z.infer<typeof dueTodayItemSchema>;
export type DashboardSummary = z.infer<typeof summarySchema>;

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

/**
 * The whole Dashboard read. One gateway call, one Zod pass, one honest failure
 * mode. `ok: false` is a real, renderable outcome: the screen shows an
 * `ErrorState` that says what is safe to do, not a set of zeroes.
 */
export async function fetchDashboardSummaryAction(): Promise<
  { ok: true; value: DashboardSummary } | { ok: false; error: string; code: string }
> {
  try {
    const res = await gatewayGet<unknown>("/api/v1/analytics/dashboard");

    if (!res.success) {
      // No fallback. `getStudents` in `server/queries/students.ts` removed its
      // roster fallback for the same reason: the direct-DB path cannot honour
      // the gateway's contract, and a plausible wrong answer is the worst thing
      // this screen can show. This string is CLASSIFIED by `toAppErrorState` on
      // the client and never rendered, so the cause must stay intact for it.
      log.error("dashboard_summary_gateway_failed_no_fallback", res.error);
      return {
        ok: false,
        code: "DASHBOARD_GATEWAY_FAILED",
        error:
          "The dashboard read failed and there is no local fallback, because the direct-DB " +
          "path computes a different set of measures and would return a wrong dashboard. " +
          `Cause: ${res.error}`,
      };
    }

    const parsed = summarySchema.safeParse(res.data);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      log.error("dashboard_summary_malformed_response", detail);
      return {
        ok: false,
        code: "DASHBOARD_RESPONSE_UNREADABLE",
        error:
          "DASHBOARD_RESPONSE_UNREADABLE: the gateway returned a dashboard that does not " +
          `match the analytics contract, so no figure is being shown. ${detail}`,
      };
    }

    return { ok: true, value: parsed.data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("dashboard_summary_failed", message);
    return {
      ok: false,
      code: "DASHBOARD_FETCH_FAILED",
      error: `DASHBOARD_FETCH_FAILED: ${message}`,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Analytics read (visualizations + filtered export source)
 * ------------------------------------------------------------------ */

/**
 * Implements: 04_Dashboard.md §6.2 + §10 (BR-RPT-01/03/08, BR-CALC-10/11) and
 * the dashboard visualizations pass. Read-only like the summary above: the
 * filter is Zod-parsed first, the fan-out lives in
 * `server/queries/dashboard-analytics.ts`, and the client receives derived
 * view data it may render and export but never recomputes money from.
 */
export async function fetchDashboardAnalyticsAction(
  filter: unknown,
): Promise<
  { ok: true; value: DashboardAnalytics } | { ok: false; error: string; code: string }
> {
  const parsedFilter = AnalyticsFilterSchema.safeParse(filter ?? {});
  if (!parsedFilter.success) {
    const detail = parsedFilter.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    log.error("dashboard_analytics_filter_invalid", detail);
    return {
      ok: false,
      code: "DASHBOARD_FILTER_INVALID",
      error: `DASHBOARD_FILTER_INVALID: analytics filter is unreadable. ${detail}`,
    };
  }
  try {
    const result = await getDashboardAnalytics(parsedFilter.data);
    if (!result.success) {
      log.error("dashboard_analytics_query_failed", result.error);
      return { ok: false, code: "DASHBOARD_ANALYTICS_FAILED", error: result.error };
    }
    return { ok: true, value: result.data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("dashboard_analytics_failed", message);
    return {
      ok: false,
      code: "DASHBOARD_ANALYTICS_FAILED",
      error: `DASHBOARD_ANALYTICS_FAILED: ${message}`,
    };
  }
}
