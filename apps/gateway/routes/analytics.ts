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
// 5. Activity rows named a payment as if it were a student
//    (`student_name: e.description || e.type`, so the column read "Payment
//    received"). A ledger row is now joined to the roster and carries the real
//    name or nothing at all; the event's own label travels in its own field,
//    `event_title`, which is what a notification actually has.
import type { RouteHandler } from "./students.ts";
import { ok, failValidation } from "../lib/errors.ts";
import { createPrismaOrm } from "../lib/orm.ts";
import { paiseAdd, paiseSub } from "../lib/vendor/format.ts";

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
 */
function paymentsByInvoice(entries: Row[]): Map<string, number> {
  const paid = new Map<string, number>();
  for (const e of entries) {
    if (!e.invoiceId) continue;
    const key = String(e.invoiceId);
    paid.set(key, paiseAdd(paid.get(key) ?? 0, Number(e.creditPaise ?? 0)));
  }
  return paid;
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

type PaymentState = "paid" | "partial" | "unpaid";

/**
 * A student's payment state, derived from that student's OWN open invoices:
 *
 *   paid    — nothing outstanding on any open invoice. Includes a student who
 *             has never been invoiced; those are counted in `noDues` as well,
 *             so `noDues` is a SUBSET of `paid`, not a fourth bucket.
 *   partial — something outstanding, and at least one open invoice has a
 *             payment attributed to it.
 *   unpaid  — something outstanding, and no payment is attributed to any of
 *             their open invoices.
 *
 * `paid + partial + unpaid === totalStudents` always. The previous
 * implementation reported `partial: dues.length`, `unpaid: 0` and
 * `paid === noDues`, so the four fields described one fact three times and
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

    // No edge cache here by design (workstream E §3 + lib/cache.ts budget
    // rule): KPIs aggregate balances and ledger money views, so every call
    // reads through to the tenant DB. Reads stay cheap via batched
    // Promise.all fan-out (one round trip per table, never N+1).
    //
    // The students read is unfiltered on purpose. It was `status: active,
    // archivedAt: null`, which left no row to name an invoice belonging to a
    // graduated or archived student — the case that produced `student_name:
    // "Student"`. Reading the roster once and deriving the active subset in
    // the route keeps the same cost and gives every due row a real name.
    const [allStudents, payments, invoices, ledger, notifs, openDatedInvoices] = await Promise.all([
      orm.student.findMany({ where: {} }),
      orm.ledgerEntry.findMany({ where: { type: "PAYMENT_RECEIVED" } }),
      orm.invoice.findMany({ where: {} }),
      orm.ledgerEntry.findMany({ orderBy: { occurredOn: "desc" }, take: 20 }),
      orm.notification.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
      // The overdue population: open invoices that carry a due date, oldest
      // first, so the most overdue money is always at the top. Both the filter
      // and the ORDER BY go through the audited builder — `status IN (…)` and
      // `due_date IS NOT NULL` are operators `buildTenantWhere` supports, and
      // `orderBy: { dueDate }` is validated by the `resolveOrderBy` seam in
      // lib/orm.ts rather than concatenated anywhere (AGENTS.md §3.4).
      orm.invoice.findMany({
        where: { status: { in: [...OPEN_INVOICE_STATUSES] }, dueDate: { not: null } },
        orderBy: { dueDate: "asc" },
      }),
    ]);

    const paidByInv = paymentsByInvoice(payments);

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
    // The SAME rows still feed `paymentsByInvoice` above, because an invoice's
    // outstanding figure must net off payments regardless of when they landed —
    // a February payment settles an August invoice. Only this SUM is windowed.
    const collected = payments.reduce((a, p) => {
      if (!isWithinPeriod(readDay(p.occurredOn), periodStart, periodEnd)) return a;
      return paiseAdd(a, Number(p.creditPaise ?? 0));
    }, 0);

    // ── Due in the period ─────────────────────────────────────────────────────
    // `openDatedInvoices` is the audited read filtered to open statuses
    // (unpaid / partial / overdue) with a due date, so `paid` and `void` are
    // already gone. What remains is netted off payments per invoice and then
    // windowed on `due_date` — the three things the previous line skipped: it
    // summed `total` (ignoring every payment), ignored both dates, and counted
    // the voided INV-000105.
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
    const openByStudent = new Map<string, Row[]>();
    const invoiceCountByStudent = new Map<string, number>();
    for (const inv of invoices) {
      const sid = String(inv.studentId);
      invoiceCountByStudent.set(sid, (invoiceCountByStudent.get(sid) ?? 0) + 1);
      if (isOpenInvoice(inv)) {
        const list = openByStudent.get(sid);
        if (list) list.push(inv);
        else openByStudent.set(sid, [inv]);
      }
    }
    const paymentBreakdown = { paid: 0, partial: 0, unpaid: 0, noDues: 0 };
    for (const s of activeStudents) {
      const sid = String(s.id);
      paymentBreakdown[paymentState(openByStudent.get(sid) ?? [], paidByInv)] += 1;
      if ((invoiceCountByStudent.get(sid) ?? 0) === 0) paymentBreakdown.noDues += 1;
    }

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
