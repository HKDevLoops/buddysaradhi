// Implements: 04_Dashboard.md §3 (the KPI strip must stay affordable as an
// institute grows) + §6.4 (the period filter bounds the period-scoped cards) +
// 12_Business_Rules.md BR-M-01 / AGENTS.md §2 Rule 6 (money is integer paise and
// a bound must not move a figure) + Rule 9 (an over-wide window is refused
// loudly, never silently clamped) + §15 FM-06 ("it compiles" is not done).
//
// ── WHAT FAILS AGAINST THE PRE-FIX ROUTE (F-19) ────────────────────────────────
//
// `periodStartIso` was checked for SHAPE only:
//
//   if (!PERIOD_DAY_PATTERN.test(periodStart)) { … }      // shape only
//   if (periodStart > periodEnd) { … }                    // ordering only
//   // …and then the read:
//   orm.ledgerEntry.findMany({ where: { type: "PAYMENT_RECEIVED",
//                                      occurredOn: { gte: periodStart } } })
//
// Nothing looked at the DISTANCE between two well-shaped days. `1900-01-01` is a
// perfectly well-shaped day, and with it the period leg of
// `collectedThisMonthMinor` read the tenant's entire payment history — off an
// APPEND-ONLY table (AGENTS.md §2 Rule 1: a void is a new row, never a delete, so
// `ledger_entries` only ever grows) — on every dashboard load, behind a rate
// limiter consulted once before the scan began.
//
// The roster and open-invoice reads are NOT bounded here and that is the
// documented decision carried forward from PERF-GATEWAY-06: a cap on a money
// population silently under-reports it. See "the two reads that stay unbounded"
// below, and `analytics-bounded-reads.test.ts`, which pins that decision.
import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";
import { handleAnalytics } from "../routes/analytics.ts";
import { invalidateTenant } from "../lib/cache.ts";
import type { DB } from "../lib/db.ts";
import { SqliteGatewayDb } from "./sqlite-db.ts";

const TENANT = "018f0000-0000-7000-8000-0000000000f1";
const NOW_ISO = "2026-10-04T09:00:00.000Z";

const S_KABIR = "018f0000-0000-7000-8000-00000000a002";
const S_DIYA = "018f0000-0000-7000-8000-00000000a003";

const PATH = "/api/v1/analytics/dashboard";

// NOTE: this file previously declared `const MAX_PERIOD_DAYS = 366` and asserted
// that an all-time window was refused. There is no such cap in the route any
// more, and the constant is deliberately NOT reintroduced here — see the
// `F-19 / an ALL-TIME window is honoured` block below for why, and for the
// 04_Dashboard.md §6.4 clause that makes "All" a shipped feature.

interface Kpis {
  totalStudents: number;
  studentsWithDues: number;
  collectedThisMonthMinor: number;
  dueTillDateMinor: number;
  dueForMonthMinor: number;
  overdueMinor: number;
  paymentBreakdown: { paid: number; partial: number; unpaid: number };
}

interface ErrorBody {
  success: boolean;
  error: string;
  details?: string;
}

async function call(f: SqliteGatewayDb, query: string): Promise<{ status: number; body: unknown }> {
  const url = new URL(`https://api.buddysaradhi.app${PATH}?${query}`);
  const res = await handleAnalytics(
    new Request(url, { method: "GET" }),
    // SAFETY: SqliteGatewayDb satisfies the route's `SqlHandle` structurally —
    // it implements `execute` and delegates to a real SQLite handle, so the
    // audited builders run against real SQLite. `DB` is the libsql marker it
    // replaces.
    f as unknown as DB,
    TENANT,
    PATH,
    "GET",
    url,
    {},
  );
  if (!res) throw new Error(`no route matched GET ${PATH}?${query}`);
  return { status: res.status, body: (await res.json()) as unknown };
}

async function kpis(f: SqliteGatewayDb, query = ""): Promise<Kpis> {
  const { status, body } = await call(f, query);
  if (status !== 200) throw new Error(`expected 200, got ${status}: ${JSON.stringify(body)}`);
  return (body as { data: { kpis: Kpis } }).data.kpis;
}

/**
 * Seeded so every figure below is a NUMBER, not a zero: two active students,
 * one open invoice due in the window, one open invoice long past due, one
 * settled, one voided, and payments both inside and outside the window.
 */
function seed(f: SqliteGatewayDb): void {
  const now = "2026-01-01T00:00:00.000Z";
  const insStudent = f.raw.prepare(
    `INSERT INTO students (id, tenant_id, code, first_name, last_name, status, archived_at,
                           balance_paise, admission_date, fee_model, base_fee_paise, dup_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, '2026-01-01', 'postpaid', ?, ?, ?, ?)`,
  );
  insStudent.run(S_KABIR, TENANT, "S-002", "Kabir", "Mehta", 300000, 300000, "S-002", now, now);
  insStudent.run(S_DIYA, TENANT, "S-003", "Diya", "Nair", 130000, 250000, "S-003", now, now);

  const insInvoice = f.raw.prepare(
    `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
                           subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'hash', ?, ?)`,
  );
  // Open, overdue: money a tutor is chasing.
  insInvoice.run("018f0000-0000-7000-8000-00000000b002", TENANT, "INV-000102", S_KABIR, "2026-08-01", "2026-09-01", 300000, 300000, "unpaid", now, now);
  // Open, due inside October: the `dueForMonthMinor` case.
  insInvoice.run("018f0000-0000-7000-8000-00000000b004", TENANT, "INV-000104", S_DIYA, "2026-10-01", "2026-10-20", 200000, 200000, "unpaid", now, now);
  // Closed, settled, and voided: neither may be counted.
  insInvoice.run("018f0000-0000-7000-8000-00000000b001", TENANT, "INV-000101", S_KABIR, "2026-01-01", "2026-01-10", 100000, 100000, "paid", now, now);
  insInvoice.run("018f0000-0000-7000-8000-00000000b003", TENANT, "INV-000103", S_DIYA, "2026-06-01", "2026-07-01", 99900, 99900, "void", now, now);

  const insLedger = f.raw.prepare(
    `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
                                 balance_after_paise, description, receipt_no, occurred_on, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'PAYMENT_RECEIVED', 0, ?, 0, 'Payment received', ?, ?, 'gateway', ?, ?)`,
  );
  // INSIDE the default October window — this is what `collectedThisMonthMinor`
  // must report.
  insLedger.run("018f0000-0000-7000-8000-00000000c001", TENANT, S_KABIR, "018f0000-0000-7000-8000-00000000b002", 120000, "RCP-000001", "2026-10-02", now, now);
  // OUTSIDE every window used below — a pre-window payment. It must never be
  // counted as collected in a period, but it DOES net off INV-000102.
  insLedger.run("018f0000-0000-7000-8000-00000000c002", TENANT, S_KABIR, "018f0000-0000-7000-8000-00000000b002", 50000, "RCP-000002", "2026-09-02", now, now);
}

let f: SqliteGatewayDb;

/** The widest window the route serves and the same string the pre-existing
 *  `analytics-measures.test.ts` uses as "all fixture history". */
const BASE = "periodStartIso=2026-01-01&periodEndIso=2026-12-31";
const OCTOBER = "periodStartIso=2026-10-01&periodEndIso=2026-10-31";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
  f = new SqliteGatewayDb();
  seed(f);
  invalidateTenant(TENANT);
});

afterAll(() => {
  vi.useRealTimers();
});

describe("F-19 / an ALL-TIME window is honoured — 04_Dashboard.md §6.4", () => {
  // REVERSAL OF AN EARLIER DECISION IN THIS FILE, recorded deliberately.
  //
  // These cases previously asserted the OPPOSITE: that `periodStartIso=1900-01-01`
  // is refused with a typed 400 by a 366-day span ceiling. That ceiling was
  // removed, because it broke a shipped feature.
  //
  // `04_Dashboard.md` §6.4 specifies the Dashboard's third period option as
  // "**All** — all-time view", and `apps/web/src/lib/dashboard-period.ts:44`
  // sends `ALL_TIME_START_ISO = "1970-01-01"` for it (wired at
  // `server/actions/dashboard.ts:294`). A 366-day ceiling therefore 400'd the
  // "All time" pill on every click.
  //
  // The ceiling also bought nothing on the security axis. The rows behind a wide
  // window are the CALLING TENANT'S OWN payment history — data the product
  // explicitly offers them, over an authenticated route, already rate-limited.
  // So it was a performance concern being paid for with a working feature.
  //
  // These tests are the regression guard in the other direction: if anyone
  // re-adds a span ceiling, they go red. The performance concern is real and
  // stays open (F-19a in docs/audit/REMEDIATION_PLAN.md); its correct fix is to
  // aggregate in SQL, not to clamp a window the spec calls unbounded.

  it("accepts periodStartIso=1900-01-01 — the all-time sentinel the web sends", async () => {
    const { status, body } = await call(f, "periodStartIso=1900-01-01");
    expect(status).toBe(200);
    // A real data envelope, not a refusal: this is the feature working.
    expect(body).toHaveProperty("data");
    expect((body as { data: { kpis: Kpis } }).data.kpis).toBeDefined();
  });

  it("accepts 1900-01-01 with an explicit end too — naming an end is not an exploit", async () => {
    const { status } = await call(f, "periodStartIso=1900-01-01&periodEndIso=2026-10-04");
    expect(status).toBe(200);
  });

  it("does not clamp: the all-time window is answered with real aggregates", async () => {
    // The failure mode a clamp would cause is a silently under-reported money
    // figure (AGENTS.md §2 Rule 9). So assert the overdue figure is the one the
    // whole fixture history produces — identical to the bounded-window value,
    // because every seeded invoice falls inside both windows.
    const wide = await call(f, "periodStartIso=1970-01-01&periodEndIso=2026-12-31");
    const narrow = await call(f, BASE);
    expect((wide.body as { data: { kpis: Kpis } }).data.kpis.overdueMinor).toBe(
      (narrow.body as { data: { kpis: Kpis } }).data.kpis.overdueMinor
    );
  });

  it("still refuses a window that is not a REAL calendar day", async () => {
    // The half of F-19 that was a genuine correctness fix survives the reversal:
    // SHAPE is not enough, `2026-02-30` must be a typed 400 rather than a
    // silently shifted window.
    const { status, body } = await call(f, "periodStartIso=2026-02-30&periodEndIso=2026-03-31");
    expect(status).toBe(400);
    expect((body as ErrorBody).error).toBe("VALIDATION");
    expect((body as ErrorBody).details).toContain("periodStartIso");
  });

  it("accepts a window exactly at a full calendar year", async () => {
    // 2026-01-01 → 2026-12-31 is a 365-day inclusive window. This is the same
    // string the pre-existing `analytics-measures.test.ts` uses as "all fixture
    // history", so it must keep working.
    const { status, body } = await call(f, BASE);
    expect(status).toBe(200);
    expect((body as { data: { kpis: Kpis } }).data.kpis.overdueMinor).toBe(130000);
  });

  it("accepts a one-day window — a cap of zero would break the dashboard", async () => {
    const { status } = await call(f, "periodStartIso=2026-10-04&periodEndIso=2026-10-04");
    expect(status).toBe(200);
  });

  it("still rejects a shape-invalid day, and names the parameter", async () => {
    const badStart = await call(f, "periodStartIso=tomorrow");
    expect(badStart.status).toBe(400);
    expect((badStart.body as ErrorBody).details).toContain("periodStartIso");

    const badEnd = await call(f, "periodEndIso=not-a-day");
    expect(badEnd.status).toBe(400);
    expect((badEnd.body as ErrorBody).details).toContain("periodEndIso");
  });

  it("still rejects a reversed window", async () => {
    const { status, body } = await call(f, "periodStartIso=2026-09-30&periodEndIso=2026-09-01");
    expect(status).toBe(400);
    expect((body as ErrorBody).details).toContain("window is empty");
  });

  it("rejects a shape-valid but imaginary day instead of reading with it", async () => {
    // `2026-02-31` passes the shape regex — February has no 31st — and the
    // ordering check lets it through. Reading with it would compare against a
    // day that does not exist. Pre-fix this silently produced a figure.
    const { status, body } = await call(f, "periodStartIso=2026-02-31&periodEndIso=2026-03-31");
    expect(status).toBe(400);
    expect((body as ErrorBody).error).toBe("VALIDATION");
  });
});

describe("F-19 / bounding the window moved no money figure", () => {
  // The parity requirement: the bound is on the WINDOW, so every window the
  // route still serves must answer with the numbers it answered before. These
  // are exact assertions on integer paise, not ranges.

  it("the widest legal window and the default window agree on every all-time figure", async () => {
    const life = await kpis(f, BASE);
    const month = await kpis(f);

    // `dueTillDateMinor`, `totalStudents`, `studentsWithDues`, `overdueMinor`
    // and the whole breakdown are defined WITHOUT reference to the period
    // (04_Dashboard.md §6.4: "All-time, ignores filter"). A window bound must
    // not have started moving them.
    expect(month.dueTillDateMinor).toBe(life.dueTillDateMinor);
    expect(month.overdueMinor).toBe(life.overdueMinor);
    expect(month.totalStudents).toBe(life.totalStudents);
    expect(month.studentsWithDues).toBe(life.studentsWithDues);
    expect(month.paymentBreakdown).toEqual(life.paymentBreakdown);
  });

  it("only the two period-scoped figures move, and they move by exactly the period", async () => {
    const october = await kpis(f, OCTOBER);
    const lifetime = await kpis(f, BASE);

    // RCP-000001 (120000) landed 2026-10-02; RCP-000002 (50000) landed
    // 2026-09-02, outside October.
    expect(october.collectedThisMonthMinor).toBe(120000);
    expect(lifetime.collectedThisMonthMinor).toBe(170000);
    expect(october.collectedThisMonthMinor).not.toBe(lifetime.collectedThisMonthMinor);

    // INV-000104 (200000, nothing paid) is due 2026-10-20 — inside October.
    // INV-000102 (300000, netted to 130000) is due 2026-09-01 — inside the year
    // but outside October. So the year window sees both: 200000 + 130000.
    expect(october.dueForMonthMinor).toBe(200000);
    expect(lifetime.dueForMonthMinor).toBe(330000);

    // INV-000102 is netted by BOTH payments, including the pre-window one, and
    // is past due — overdue in both windows. The netting must not have been
    // folded into the period read.
    expect(october.overdueMinor).toBe(130000);
    expect(lifetime.overdueMinor).toBe(130000);
  });

  it("every figure stays integer paise (Rule 6 / BR-M-01)", async () => {
    for (const figure of Object.values(await kpis(f))) {
      if (typeof figure === "number") expect(Number.isSafeInteger(figure)).toBe(true);
    }
  });

  it("the breakdown is still a disjoint partition of the roster", async () => {
    const { paymentBreakdown, totalStudents } = await kpis(f, BASE);
    expect(Object.keys(paymentBreakdown).sort()).toEqual(["paid", "partial", "unpaid"]);
    expect(paymentBreakdown.paid + paymentBreakdown.partial + paymentBreakdown.unpaid).toBe(
      totalStudents,
    );
  });

  it("a window narrowed to one day still reports the same all-time money", async () => {
    const one = await kpis(f, "periodStartIso=2026-10-04&periodEndIso=2026-10-04");
    const life = await kpis(f, BASE);
    expect(one.overdueMinor).toBe(life.overdueMinor);
    expect(one.dueTillDateMinor).toBe(life.dueTillDateMinor);
    // …and its period-scoped figure is genuinely that one day: nothing landed
    // on 2026-10-04.
    expect(one.collectedThisMonthMinor).toBe(0);
  });
});

describe("F-19 / the two reads that stay UNBOUNDED, and why", () => {
  // PERF-GATEWAY-06's constraint is binding: bound by FILTER, never by `take`.
  // A cap on a money population silently under-reports it, which is worse than
  // the latency it saves. Both of these are already filter-bounded or
  // deliberately exact; neither gained a LIMIT here, and
  // `analytics-bounded-reads.test.ts` pins that decision against the SQL text.
  it("the roster read is uncapped because four KPIs are exact aggregates over it", async () => {
    const figures = await kpis(f, BASE);
    // `totalStudents`, `studentsWithDues`, `dueTillDateMinor` and the whole
    // three-way breakdown are exact over the roster, and the response carries no
    // flag that could say "this was capped" (Rule 9). A `take` would make four
    // exact aggregates into four approximations with nothing to disclose it.
    expect(figures.totalStudents).toBe(2);
    expect(figures.studentsWithDues).toBe(2);
  });

  it("the open-invoice read is filter-bounded (the open set), not cap-bounded", async () => {
    // `invoices` grows a row per student per month forever. The route reads
    // `status IN ('unpaid','partial','overdue')`, so closed history — every
    // `paid` and `void` invoice the institute has ever issued — is filtered out
    // in SQLite and never leaves it. A `LIMIT` on top of that would under-report
    // `overdueMinor` whenever the open set exceeds it.
    const figures = await kpis(f, BASE);
    // The settled and the voided invoice are both excluded from the open set.
    expect(figures.overdueMinor).toBe(300000 - 120000 - 50000);
    expect(figures.paymentBreakdown.paid).toBe(0);
  });
});
