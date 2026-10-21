// Implements: 04_Dashboard.md §3 (the KPI strip and the due-today action
// list) + §9 (every figure is a gateway read — the client never recomputes a
// financial measure) + 12_Business_Rules.md BR-M-01 / AGENTS.md §2 Rule 6
// (money is integer paise, arithmetic guarded) + Rule 9 (no silent failures:
// a measure that cannot be computed honestly says so instead of returning a
// confident number).
//
// AGENTS.md §3.5 generalised to reads: this file is the ONE implementation of
// every dashboard measure. A second copy is the defect the web action
// `server/actions/dashboard.ts` was written to delete.
//
// ── What was wrong here, and why none of it is a "small" number ──────────
//
// 1. `overdueMinor` was `Math.max(0, dueTill - collected)`. `collected` is
//    EVERY payment ever taken; `dueTill` is the balance outstanding RIGHT NOW.
//    Collections grow without bound and the balance is bounded, so the
//    subtraction is structurally zero for any tutor who has ever collected more
//    than they currently owe — a tile that could only ever read ₹0.00 while
//    being rendered in the same visual language as three live tiles. Overdue is
//    now derived from invoices: what is still owed on invoices whose due date
//    has passed.
// 2. `student_name` in the due-today list was the literal "Student", so the
//    single most important action list on the product rendered twenty rows
//    that all claimed to be the same person. The roster is now joined.
// 3. The due-today query was `findMany({ where: {}, take: 50 })` with NO
//    orderBy, filtered in JS afterwards: the 50 rows were an arbitrary subset,
//    the most overdue invoice was routinely missing, and nothing in the
//    response said how many there were. It is now filtered and ordered in SQL,
//    and the exact total travels with it.
// 4. `periodStartIso` / `periodEndIso` were parsed and then thrown away
//    (`void periodStart; void periodEnd;`), so `collectedThisMonthMinor` was the
//    sum of every `PAYMENT_RECEIVED` row ever written and `dueForMonthMinor`
//    was the sum of `total` over every invoice that was not `paid` — no dates,
//    no payments, voided invoices included. Three separate lies behind two
//    field names. The period is now a first-class input: it is validated, it
//    bounds both measures, and an unreadable value is a typed 400 rather than a
//    quietly empty or unbounded figure.
// 6. …and validating the period's SHAPE is not the same as bounding its SPAN.
//    `1900-01-01` is a perfectly well-shaped day, and asking for it makes one
//    dashboard load read the tenant's whole payment history off an append-only
//    table. A span ceiling was added here — and then REMOVED, because it broke
//    ratified behaviour. `04_Dashboard.md` §6.4 specifies the Dashboard's third
//    period option as "**All** — all-time view", and
//    `apps/web/src/lib/dashboard-period.ts` sends `ALL_TIME_START_ISO =
//    "1970-01-01"` for it. A 366-day ceiling 400'd the shipped "All time" pill
//    on every click. That ceiling had no security value worth trading for: the
//    rows being read are the CALLING TENANT'S OWN history, which they are
//    entitled to read and which the product explicitly offers. It was a
//    performance concern paid for with a broken feature.
//    What survives is the part that is a genuine correctness fix: both bounds
//    must be REAL calendar days, so `2026-02-30` is a typed 400 instead of a
//    silently shifted window.
//    The performance concern is real and stays open, but its correct fix is to
//    aggregate in SQL (SUM with a filter) rather than to clamp a window the
//    spec calls unbounded — a clamp would under-report `collectedInPeriod` with
//    nothing in the response to disclose it. Tracked in
//    `docs/audit/REMEDIATION_PLAN.md` (F-19a), not silently resolved here.
// 5. Activity rows named a payment as if it were a student
//    (`student_name: e.description || e.type`, so the column read "Payment
//    received"). A ledger row is now joined to the roster and carries the real
//    name or nothing at all; the event's own label travels in its own field,
//    `event_title`, which is what a notification actually has.
import type { RouteHandler } from "./students.ts";
import { ok, failValidation } from "../lib/errors.ts";
import { createPrismaOrm } from "../lib/orm.ts";
import { paiseAdd, paiseSub } from "../lib/vendor/format.ts";
// RPT-SHAPE-08: the C6 wire contract, vendored byte-identically from
// `packages/shared/src/paymentBreakdown.ts` (the edge bundler cannot reach
// `packages/`; see `lib/vendor/paymentBreakdown.ts`). The three buckets are
// typed as the shared `PaymentBreakdown`, so a key that exists here but not
// there — or vice versa — is a compile error rather than a runtime surprise.
// `__tests__/payment-breakdown-contract.test.ts` byte-compares the vendored copy
// against the shared source and parses this route's real response through the
// SHARED schema.
import { PaymentBreakdownSchema } from "../lib/vendor/paymentBreakdown.ts";
import type { PaymentBreakdown } from "../lib/vendor/paymentBreakdown.ts";

/** `invoices.status` vocabulary, from the CHECK in lib/schema.ts:205. `paid`
 *  and `void` are the two states in which no money is owed. */
const OPEN_INVOICE_STATUSES = ["unpaid", "partial", "overdue"] as const;

/** How many overdue rows one response carries. `dueTodayTotal` always travels
 *  beside the slice, so the cap can never be read as "that is all of them". */
const DUE_TODAY_LIMIT = 50;

/** The row shape `createPrismaOrm` returns (`Record<string, any>`). Aliased so
 *  the helpers below read as prose instead of index signatures. */
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function isOpenInvoice(inv: Row): boolean {
  return (OPEN_INVOICE_STATUSES as readonly string[]).includes(String(inv.status));
}

/**
 * `PAYMENT_RECEIVED` credits attributed to an invoice, in integer paise.
 * `paiseAdd` means a corrupt (non-integer / overflowing) credit throws instead
 * of quietly producing a fractional balance (BR-M-01, Rule 9).
 *
 * AUD-001/AUD-013: a credit that has been REVERSED does not count. "Reversed"
 * is NOT "this row is a reversal" — a voided ORIGINAL is not a reversal either
 * (the reversal is the later row that carries `void_of_id` pointing back at
 * it). `reversedIds` carries the ids of the credits some later row reversed.
 */
function paymentsByInvoice(entries: Row[], reversedIds: Set<string>): Map<string, number> {
  const paid = new Map<string, number>();
  for (const e of entries) {
    if (!e.invoiceId) continue;
    if (e.id !== undefined && e.id !== null && reversedIds.has(String(e.id))) continue;
    const key = String(e.invoiceId);
    paid.set(key, paiseAdd(paid.get(key) ?? 0, Number(e.creditPaise ?? 0)));
  }
  return paid;
}

/**
 * The ids of the credits that some later ledger row REVERSED.
 *
 * There is no `reverses_entry_id` column on the original row
 * (11_Data_Model.md §4.13), so "has this credit been reversed?" is answered by
 * looking the other way: a VOID row carries `void_of_id` = the id of the row it
 * reverses. 12_Business_Rules.md BR-RPT-04 [CRITICAL] counts a credit only
 * when it has NOT been reversed; 14_Edge_Cases.md EC-F-05 requires the invoice
 * to revert on a void.
 *
 * The read is bounded by the candidates' own ids AND chunked: SQLite's
 * `SQLITE_MAX_VARIABLE_NUMBER` is 32,766 on the shipped libsql build
 * (measured) and exceeding it is a hard error, not a truncation - the dashboard
 * would 500 on a long-lived institute. 500 also sits inside the oldest
 * SQLite ceiling (999).
 */
const MAX_SQL_VARIABLES_PER_STATEMENT = 500;

async function reversedCreditIds(
  orm: { ledgerEntry: { findMany(args: unknown): Promise<Row[]> } },
  creditIds: string[],
): Promise<Set<string>> {
  const reversed = new Set<string>();
  if (creditIds.length === 0) return reversed;
  for (let i = 0; i < creditIds.length; i += MAX_SQL_VARIABLES_PER_STATEMENT) {
    const chunk = creditIds.slice(i, i + MAX_SQL_VARIABLES_PER_STATEMENT);
    const reversals = await orm.ledgerEntry.findMany({
      where: { type: "VOID", voidOfId: { in: chunk } },
    });
    for (const r of reversals) {
      const target = r.voidOfId;
      if (target !== null && target !== undefined && String(target).length > 0) {
        reversed.add(String(target));
      }
    }
  }
  return reversed;
}

/**
 * What the tutor still owes on ONE invoice, in integer paise, never negative:
 * an overpayment against one invoice must not cancel another student's
 * arrears. Clamping per invoice (rather than at the end) is what keeps this
 * sum equal to the sum of the `due_minor` figures the client renders.
 */
function outstandingOn(inv: Row, paid: Map<string, number>): number {
  return Math.max(0, paiseSub(Number(inv.total ?? 0), paid.get(String(inv.id)) ?? 0));
}

/**
 * A due date is comparable as a string only if it is a real 'YYYY-MM-DD'.
 * `due_date` is nullable and nothing stops a row carrying '' — so the shape is
 * checked before the comparison rather than `'' <= today` quietly counting an
 * unreadable date as overdue.
 */
function isDueOnOrBefore(dueDate: unknown, today: string): boolean {
  return typeof dueDate === "string" && dueDate.length === 10 && dueDate <= today;
}

/**
 * The calendar day a TEXT date column carries, or `null` when it carries none.
 *
 * `occurred_on` and `due_date` are both `TEXT`, and neither is constrained to a
 * shape, so the leading `YYYY-MM-DD` is screened before it is compared — the
 * same rule `isDueOnOrBefore` applies, generalised so the period window can be
 * tested with one predicate instead of three ad-hoc length checks.
 *
 * A column legitimately holding an instant (`2026-10-04T09:00:00.000Z`) yields
 * its UTC day, which is the convention the due-date comparison already assumes.
 * A row with no readable day cannot be attributed to ANY window, so it is
 * excluded from a period measure rather than guessed into one — the identical
 * trade the overdue measure has always made, and the reason `NOT NULL` on the
 * column is not enough on its own.
 */
const PERIOD_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function readDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const day = value.slice(0, 10);
  return PERIOD_DAY_PATTERN.test(day) ? day : null;
}

/** Is a readable day inside the requested window? Both bounds are inclusive. */
function isWithinPeriod(day: string | null, start: string, end: string): boolean {
  return day !== null && day >= start && day <= end;
}

/**
 * Midnight UTC of a REAL calendar day, in ms — or `null` when `day` is not one.
 *
 * `Date.parse` alone is not a validity test: V8 rolls an out-of-range day over
 * rather than failing, so `2026-02-31` parses as 2026-03-03 and a window built
 * from it compares against a day the caller never named. The round trip is what
 * catches it — parse, re-format, and insist the string comes back unchanged.
 * Same test as `routes/attendance.ts:78-81`, for the same reason.
 */
function realDayStartMs(day: string): number | null {
  const t = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10) === day ? t : null;
}

type PaymentState = "paid" | "partial" | "unpaid";

/**
 * A student's payment state, derived from that student's OWN open invoices:
 *
 *   paid    — nothing outstanding on any open invoice, INCLUDING a student who
 *             has never been invoiced (they have nothing outstanding too).
 *   partial — something outstanding, and at least one open invoice has a
 *             payment attributed to it.
 *   unpaid  — something outstanding, and no payment is attributed to any of
 *             their open invoices.
 *
 * `paid + partial + unpaid === totalStudents` always, and the three are
 * DISJOINT — each student is counted exactly once. A fourth `noDues` bucket once
 * overlapped `paid` entirely; see the breakdown block below for why it went.
 * The previous implementation reported `partial: dues.length`, `unpaid: 0` and
 * `paid === noDues`, so the fields described one fact three times and
 * contradicted themselves.
 */
function paymentState(openInvoices: Row[], paid: Map<string, number>): PaymentState {
  let outstanding = 0;
  let anyAttributed = false;
  for (const inv of openInvoices) {
    const owed = outstandingOn(inv, paid);
    outstanding = paiseAdd(outstanding, owed);
    if (owed < Number(inv.total ?? 0)) anyAttributed = true;
  }
  if (outstanding <= 0) return "paid";
  return anyAttributed ? "partial" : "unpaid";
}

export const handleAnalytics: RouteHandler = async (_req, db, tenantId, path, method, url) => {
  const orm = createPrismaOrm(db, tenantId);

  // GET /api/v1/analytics/dashboard
  if (path === "/api/v1/analytics/dashboard" && method === "GET") {
    const sp = url.searchParams;
    const now = new Date();
    // `toISOString` is YYYY-MM-DDTHH:MM:SS.sssZ by construction, so the leading
    // ten characters are a well-formed day with no runtime check needed.
    const today = now.toISOString().slice(0, 10);

    // ── The period ────────────────────────────────────────────────────────────
    // Default: the calendar month so far (1st → today), which is what the field
    // names say. Supplied: validated, and a malformed or reversed window is a
    // typed 400 — not a silently empty sum and not an unbounded one. The previous
    // implementation read both parameters and discarded them, so the two
    // period-scoped measures below were period-free by construction.
    const periodStart = sp.get("periodStartIso") ?? `${today.slice(0, 8)}01`;
    const periodEnd = sp.get("periodEndIso") ?? today;
    if (!PERIOD_DAY_PATTERN.test(periodStart)) {
      return failValidation(
        `periodStartIso must be a calendar day as YYYY-MM-DD. Received a value that is not one.`,
      );
    }
    if (!PERIOD_DAY_PATTERN.test(periodEnd)) {
      return failValidation(
        `periodEndIso must be a calendar day as YYYY-MM-DD. Received a value that is not one.`,
      );
    }
    if (periodStart > periodEnd) {
      return failValidation(
        `periodStartIso ${periodStart} is after periodEndIso ${periodEnd}: the window is empty.`,
      );
    }

    // ── Bound the SPAN, not just the shape ─────────────────────────────────────
    // `PERIOD_DAY_PATTERN` proves a value is shaped like a day; it says nothing
    // about the distance between two shaped days. `1900-01-01` is a well-shaped
    // day and an unbounded read. Refused here, before any statement is built.
    //
    // Both bounds are also checked to be REAL calendar days, with the same
    // round-trip test `routes/attendance.ts:78-81` applies. `Date.parse` ROLLS an
    // out-of-range day over instead of failing — `2026-02-31` parses as
    // 2026-03-03 — so an imaginary day would otherwise be silently compared as a
    // different real day and quietly produce a figure. Pre-fix, that is exactly
    // what happened; now it is a typed 400.
    //
    // `periodStart === periodEnd` is a legitimate one-day window (span 0), and it
    // is what the dashboard reduces to on the first of a month.
    const startMs = realDayStartMs(periodStart);
    const endMs = realDayStartMs(periodEnd);
    if (startMs === null || endMs === null) {
      return failValidation(
        `periodStartIso/periodEndIso must be real calendar days as YYYY-MM-DD ` +
          `(received ${periodStart} .. ${periodEnd}).`,
      );
    }
    // SHAPE is validated above and both bounds must now be REAL calendar days,
    // so `2026-02-30` is a typed 400 rather than a silently shifted window.
    //
    // There is deliberately NO span ceiling here. One was added (366 days,
    // mirroring `MAX_RANGE_DAYS` in `routes/attendance.ts`) and removed again
    // because it 400'd the shipped Dashboard "All time" pill on every click:
    // 04_Dashboard.md §6.4 spec's the third period option as an all-time view,
    // and `apps/web/src/lib/dashboard-period.ts` sends `ALL_TIME_START_ISO =
    // "1970-01-01"` for it. The rows behind a wide window are the CALLING
    // TENANT'S OWN history, which the product deliberately offers them, so the
    // ceiling bought no security and cost a working feature.
    // The performance concern is real and still open: `collectedInPeriod` on an
    // all-time window is O(all-time rows) on an append-only table. Its correct
    // fix is to aggregate in SQL (SUM with a filter), not to clamp a window the
    // spec calls unbounded — clamping would under-report a money figure with
    // nothing in the response to disclose it (AGENTS.md §2 Rule 9).
    // Tracked as F-19a in docs/audit/REMEDIATION_PLAN.md.

    // No edge cache here by design (workstream E §3 + lib/cache.ts budget
    // rule): KPIs aggregate balances and ledger money views, so every call
    // reads through to the tenant DB. Reads stay cheap via batched
    // Promise.all fan-out (one round trip per table, never N+1).
    //
    // ── Why the reads below are bounded, and what "bounded" is allowed to mean ──
    //
    // Every table this route touches except `students` grows forever or without
    // limit: `ledger_entries` is APPEND-ONLY and grows for the life of the
    // institute (AGENTS.md §2 Rule 1 — a void is a new row, never a delete), and
    // `invoices` gains a row per student per month. Reading either one with
    // `where: {}` and no `take` is O(all-time rows) on a metered edge, forever,
    // and it was done on EVERY dashboard load. The four reads that did it were:
    //
    //   1. ledgerEntry.findMany({ where: { type: "PAYMENT_RECEIVED" } })  — every
    //      payment the institute has EVER taken, only to feed `paidByInv` and the
    //      period sum.
    //   2. invoice.findMany({ where: {} })                                — every
    //      invoice ever issued, only to feed `openByStudent` and `noDues`.
    //   3. the open-dated invoice read                                     — every
    //      unsettled invoice, with no upper bound on how far back.
    //   4. student.findMany({ where: {} })                                 — the
    //      whole roster, unfiltered.
    //
    // (1) splits into two reads that are each bounded by the population the
    // measure is actually defined over: the PERIOD for the period sum, and the
    // OPEN-INVOICE SET for the per-invoice netting. (2)+(3) collapse into ONE
    // read of the open set — the union read was `openDatedInvoices ⊆ invoices`,
    // so two unbounded reads were fetching an overlap of one.
    //
    // The bound is a FILTER, never a cap. There is deliberately no `take` on any
    // of these reads: a capped read of a money population silently under-reports
    // `overdueMinor` and `dueForMonthMinor` and breaks the
    // `paid + partial + unpaid === totalStudents` partition the dashboard
    // asserts. This is the opposite of the `dueToday` honesty pattern below —
    // that list MAY be capped because it ships `dueTodayTotal` beside it; these
    // figures ship a single number and no such claim, so they are read in full
    // over a bounded population or not at all.
    //
    // The students read (4) is NOT bounded, and this is deliberate: it is the
    // substrate for `totalStudents`, `studentsWithDues`, `dueTillDateMinor` and
    // the whole `paymentBreakdown` partition. A cap would make four exact
    // aggregates into four approximations with no flag to say so, which Rule 9
    // forbids. See the report for the flagged residual.
    //
    // The students read is unfiltered on purpose. It was `status: active,
    // archivedAt: null`, which left no row to name an invoice belonging to a
    // graduated or archived student — the case that produced `student_name:
    // "Student"`. Reading the roster once and deriving the active subset in
    // the route keeps the same cost and gives every due row a real name.
    const [allStudents, openInvoices, ledger, notifs, periodPayments, periodRefunds] = await Promise.all([
      orm.student.findMany({ where: {} }),
      // The open-invoice set — `paid` and `void` are gone before the row leaves
      // SQLite. This ONE read replaces both unbounded invoice reads: it is a
      // superset of the old `openDatedInvoices` (which additionally demanded a
      // non-null due date, applied below in JS so the undated open invoices are
      // still available to `paymentState`), and `due_date ASC` puts the most
      // overdue money at the top of `dueToday`. Both the filter and the ORDER BY
      // go through the audited builder — `status IN (…)` is an operator
      // `buildTenantWhere` supports, and `orderBy: { dueDate }` is validated by
      // the `resolveOrderBy` seam in lib/orm.ts rather than concatenated anywhere
      // (AGENTS.md §3.4).
      orm.invoice.findMany({
        where: { status: { in: [...OPEN_INVOICE_STATUSES] } },
        orderBy: { dueDate: "asc" },
      }),
      orm.ledgerEntry.findMany({ orderBy: { occurredOn: "desc" }, take: 20 }),
      orm.notification.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
      // The PERIOD leg of what used to be one all-time read. `occurred_on >= ?`
      // is a lexicographic range over TEXT 'YYYY-MM-DD…' (lib/schema.ts:121-145),
      // and it is a strict SUPERSET of the rows the measure keeps: any row whose
      // leading day is `>= periodStart` is lexically `>= periodStart` as a whole
      // string, so nothing the JS `isWithinPeriod` accepts can be filtered out
      // here. The upper bound and the shape check stay in JS because they are
      // day-granular and `occurred_on` may carry a time component that a plain
      // `<= periodEnd` would wrongly exclude. No `take`: this SUM must be exact.
      orm.ledgerEntry.findMany({
        where: { type: "PAYMENT_RECEIVED", occurredOn: { gte: periodStart } },
      }),
      // BR-CALC-10: "Collected for a period = Σ(credit_paise where
      // type='PAYMENT_RECEIVED') − Σ(debit_paise where type='REFUND_ISSUED')
      // over the period's date range. Voided entries excluded." The refund leg
      // was missing, so a refund never came out of the collected figure — the
      // dashboard overstated revenue by every refund the tutor issued. The
      // shared implementation (`packages/shared/src/feeCalc.ts:272-273`) DOES
      // subtract them; AGENTS.md §3.5 forbids two copies of one rule
      // disagreeing.
      orm.ledgerEntry.findMany({
        where: { type: "REFUND_ISSUED", occurredOn: { gte: periodStart } },
      }),
    ]);

    // ── Per-invoice netting: payments attributed to an OPEN invoice ──────────
    //
    // This is why `paidByInv` cannot simply reuse the period read: an invoice
    // falling due inside the window is very often settled by a payment that
    // landed BEFORE it — the February-payment-settles-the-August-invoice case,
    // which `analytics-measures.test.ts` pins as a regression ("still nets a
    // February payment off an August invoice when it lands outside the window").
    // Windowing one measure must not blind the others.
    //
    // So it gets its own read, bounded by the open-invoice set instead of by
    // time: every payment whose `invoice_id` is one of the invoices the measures
    // above actually reference. Payments attributed to a `paid` or `void`
    // invoice cannot reduce anyone's arrears, so dropping them is not an
    // approximation — it is the same set the old all-time read reduced to.
    //
    // `invoice_id IN (…)` grows with the open set (SQLite's variable limit is
    // ~32k on any build this gateway runs on, against a few thousand open
    // invoices for a 200-student institute), and an empty open set short-circuits
    // rather than issuing a guaranteed-false `1=0` read.
    const openInvoiceIds = openInvoices.map((inv) => String(inv.id));
    const attributedPayments = openInvoiceIds.length === 0
      ? []
      : await orm.ledgerEntry.findMany({
        where: { type: "PAYMENT_RECEIVED", invoiceId: { in: openInvoiceIds } },
      });

    // AUD-001/AUD-013: a credit that a later row REVERSED does not count —
    // neither against the invoice's outstanding nor toward the period's
    // collected figure. The reversal is found by looking the other way (a VOID
    // row carries `void_of_id` = the id of the row it reverses), because the
    // original row has no marker of its own.
    const attributedReversed = await reversedCreditIds(
      orm,
      attributedPayments.map((p) => (p.id === undefined || p.id === null ? "" : String(p.id))).filter((id) => id.length > 0),
    );
    const paidByInv = paymentsByInvoice(attributedPayments, attributedReversed);

    const activeStudents = allStudents.filter(
      (s) =>
        s.status === "active" &&
        (s.archivedAt === null || s.archivedAt === undefined),
    );
    const nameById = new Map<string, string>();
    for (const s of allStudents) {
      nameById.set(
        String(s.id),
        `${s.firstName ?? ""} ${s.lastName ?? ""}`.trim(),
      );
    }

    const totalStudents = activeStudents.length;
    const dues = activeStudents.filter((s) => Number(s.balancePaise ?? 0) > 0);
    const dueTill = dues.reduce((a, s) => paiseAdd(a, Number(s.balancePaise ?? 0)), 0);

    // ── Collected in the period ───────────────────────────────────────────────
    // `periodPayments` is the PERIOD-bounded read above; the JS window still
    // runs because it owns the upper bound and the day-shape check that the
    // SQL `occurred_on >= ?` cannot express. The rows that survive BOTH are
    // exactly the rows the old all-time read was windowed down to.
    //
    // AUD-001/AUD-013: BR-CALC-10 says "Collected for a period = Σ(credit_paise
    // where type='PAYMENT_RECEIVED') − Σ(debit_paise where type='REFUND_ISSUED')
    // over the period's date range. **Voided entries excluded.**" Two legs were
    // missing: a VOIDED payment still counted as cash in (it is still a
    // PAYMENT_RECEIVED row with no marker of its own), and refunds never came
    // out. So the dashboard's headline revenue included money the tutor gave
    // back and money the tutor never kept.
    const periodReversed = await reversedCreditIds(
      orm,
      periodPayments.map((p) => (p.id === undefined || p.id === null ? "" : String(p.id))).filter((id) => id.length > 0),
    );
    const collectedPayments = periodPayments.reduce((a, p) => {
      if (!isWithinPeriod(readDay(p.occurredOn), periodStart, periodEnd)) return a;
      if (p.id !== undefined && p.id !== null && periodReversed.has(String(p.id))) return a;
      return paiseAdd(a, Number(p.creditPaise ?? 0));
    }, 0);
    const collectedRefunds = periodRefunds.reduce((a, p) => {
      if (!isWithinPeriod(readDay(p.occurredOn), periodStart, periodEnd)) return a;
      return paiseAdd(a, Number(p.debitPaise ?? 0));
    }, 0);
    const collected = paiseSub(collectedPayments, collectedRefunds);

    // The subset of the open set that carries a deadline. Applied in JS (not
    // `due_date IS NOT NULL` in the where clause) so the SINGLE open read stays
    // a superset: `paymentState` below needs the undated open invoices too
    // (INV-000106 — no deadline, money still owed), and a second query to fetch
    // them would reintroduce the unbounded read this replaced.
    const openDatedInvoices = openInvoices.filter(
      (inv) => inv.dueDate !== null && inv.dueDate !== undefined,
    );

    // ── Due in the period ─────────────────────────────────────────────────────
    // The open set was filtered to open statuses (unpaid / partial / overdue) in
    // SQL, so `paid` and `void` are already gone; `openDatedInvoices` then drops
    // the undated ones in JS so this measure and the overdue measure below share
    // one definition of "has a deadline". What remains is netted off payments per
    // invoice and then windowed on `due_date` — the three things the previous
    // line skipped: it summed `total` (ignoring every payment), ignored both
    // dates, and counted the voided INV-000105.
    const dueForPeriod = openDatedInvoices.reduce((sum, inv) => {
      if (!isWithinPeriod(readDay(inv.dueDate), periodStart, periodEnd)) return sum;
      return paiseAdd(sum, outstandingOn(inv, paidByInv));
    }, 0);

    // ── Overdue, from invoices ───────────────────────────────────────────────
    // `openDatedInvoices` is already in memory, so the `<= today` comparison
    // happens here (range operators exist in `lib/sql.ts` RANGE_CLAUSE for
    // DB-side filters). It is a lexicographic comparison of two 'YYYY-MM-DD'
    // strings, which is exact; and because it happens AFTER the count, the
    // total below is the true population — never "at least DUE_TODAY_LIMIT".
    const overdueInvoices = openDatedInvoices.filter((inv) =>
      isDueOnOrBefore(inv.dueDate, today)
    );
    const overdueMinor = overdueInvoices.reduce(
      (sum, inv) => paiseAdd(sum, outstandingOn(inv, paidByInv)),
      0,
    );

    // ── paymentBreakdown, per student ───────────────────────────────────────
    //
    // Built from the OPEN set only. The old loop walked every invoice ever
    // issued and discarded the closed ones a row at a time, which is the O(All
    // invoices) read this route no longer makes.
    //
    // THE THREE BUCKETS ARE A PARTITION. `paid + partial + unpaid ===
    // totalStudents`, always, and each student lands in exactly one.
    //
    // There was a fourth bucket, `noDues`, counted as "holds no OPEN invoice".
    // That is a SUBSET of `paid` — a student with nothing outstanding is `paid` by
    // definition — so the card rendered a four-way split whose four numbers summed
    // to MORE than the roster (3 students showed as 3 Paid + 2 Never invoiced = 5),
    // and it was labelled "Never invoiced" while counting students who had in fact
    // been invoiced and paid. A tutor reading that card is told five people exist.
    //
    // It was dropped rather than relabelled because no exact "never invoiced" is
    // reachable cheaply here: `stmtSelectWhere` is `SELECT *` with no projection
    // seam (lib/sql.ts:477), so answering it exactly means re-introducing the
    // all-time full-row invoice read this pass removed. The honest three-way
    // split is also what 04_Dashboard.md §1 asks for — "who paid, who didn't, who
    // is partial". See the report for the owner's decision.
    const openByStudent = new Map<string, Row[]>();
    for (const inv of openInvoices) {
      const sid = String(inv.studentId);
      // The read already filtered to the open statuses. Kept as a belt-and-
      // braces guard so a future drift between this loop and the read's
      // `OPEN_INVOICE_STATUSES` list cannot start counting a voided invoice.
      if (isOpenInvoice(inv)) {
        const list = openByStudent.get(sid);
        if (list) list.push(inv);
        else openByStudent.set(sid, [inv]);
      }
    }
    const paymentBreakdown: PaymentBreakdown = { paid: 0, partial: 0, unpaid: 0 };
    for (const s of activeStudents) {
      paymentBreakdown[paymentState(openByStudent.get(String(s.id)) ?? [], paidByInv)] += 1;
    }
    // Parse the accumulated counts through the SAME contract the two web
    // consumers parse with. This is what turns the import above from decoration
    // into enforcement: a fourth bucket, a negative count, or a float typed in
    // here fails HERE, at the producer, instead of being silently accepted by a
    // consumer that trims unknown keys — which is the exact divergence this
    // contract exists to prevent (RPT-SHAPE-08).
    PaymentBreakdownSchema.parse(paymentBreakdown);

    const kpis = {
      totalStudents,
      studentsWithDues: dues.length,
      /** Payments received inside `periodStart`..`periodEnd`. */
      collectedThisMonthMinor: collected,
      dueTillDateMinor: dueTill,
      /** Outstanding on invoices DUE inside `periodStart`..`periodEnd`. */
      dueForMonthMinor: dueForPeriod,
      overdueMinor,
      paymentBreakdown,
    };

    const activity = [
      // A notification has no student. Its own title is the label for the event,
      // so it travels in `event_title` and `student_name` is genuinely absent —
      // never the literal "Student" and never a title masquerading as a person.
      ...notifs.map((n) => ({
        id: n.id,
        event_type: "OTHER" as const,
        student_name: null,
        event_title: n.title ?? null,
        invoice_number: null,
        minor_amount: 0,
        additional_data: n.body,
        timestamp: n.createdAt,
      })),
      // Joined to the roster, like the due-today rows above. `description` is
      // prose the payment writer chose ("Payment received", "June fees"), so
      // putting it in the name column made the feed read as one person paying
      // the same sentence over and over. A ledger row with no roster match
      // carries `null` — an empty name column is better than a column holding a
      // verb.
      ...ledger.map((e) => ({
        id: e.id,
        event_type:
          e.type === "PAYMENT_RECEIVED"
            ? "PAYMENT"
            : e.type === "FEE_CHARGED"
              ? "INVOICE"
              : "OTHER",
        student_name: nameById.get(String(e.studentId)) ?? null,
        event_title: null,
        invoice_number: e.invoiceId ?? null,
        minor_amount: e.creditPaise ?? e.debitPaise ?? 0,
        additional_data: e.receiptNo ?? null,
        timestamp: e.occurredOn,
      })),
    ]
      .sort((a, b) => new Date(String(b.timestamp)).getTime() - new Date(String(a.timestamp)).getTime())
      .slice(0, 20);

    const dueToday = overdueInvoices.slice(0, DUE_TODAY_LIMIT).map((inv) => ({
      student_id: String(inv.studentId),
      // The real name from the roster read above. A row with no student to name
      // (an orphaned invoice) carries `null` — the same "absent" the activity
      // rows use, normalised to "" by the client's boundary schema — and never
      // the fabricated "Student" the list used to carry.
      student_name: nameById.get(String(inv.studentId)) ?? null,
      due_minor: outstandingOn(inv, paidByInv),
      invoice_number: inv.number ?? null,
      due_date: String(inv.dueDate),
    }));

    const result = {
      kpis,
      activity,
      dueToday,
      /**
       * How many invoices are actually overdue. Exact, not an estimate, and not
       * derived from the slice — so `dueToday.length === dueTodayTotal` is the
       * client's test for "this list is complete".
       */
      dueTodayTotal: overdueInvoices.length,
      /** True when `dueToday` is a page rather than the whole population. */
      dueTodayTruncated: overdueInvoices.length > dueToday.length,
      dataOrigin: "live" as const,
    };
    return ok(result);
  }

  return null;
};
