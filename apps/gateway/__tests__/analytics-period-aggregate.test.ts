// Implements: 12_Business_Rules.md BR-CALC-10 ("Collected for a period =
// Σ(credit_paise where type='PAYMENT_RECEIVED') − Σ(debit_paise where
// type='REFUND_ISSUED') over the period's date range. **Voided entries
// excluded.**") + 14_Edge_Cases.md EC-F-05 (a reversed credit does not count)
// + 04_Dashboard.md §3 (the KPI strip must stay affordable as the institute
// grows) + AGENTS.md §2 Rule 1 (the ledger is append-only, so the period leg
// grows forever) and Rule 9 (no silent failures).
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// The Dashboard's "Collected" figure is a SCALAR, and the route used to
// compute it by READING every qualifying ledger row and reducing it in
// JavaScript: 3,600 rows and 1,895 KB per request on the spec's own scale
// (measured, DYNAMIC-PERFORMANCE M27), and the "All time" window read the
// tenant's ENTIRE payment history off an append-only table on every click.
//
// The fix moves the sum into the database — `stmtSumPeriodLedgerAmounts` in
// lib/sql.ts. A money figure is not worth a 78× win without proof that the
// SQL means the SAME THING the JavaScript meant, so this file computes the
// figure BOTH ways over ONE fixture and asserts they agree PAISE FOR PAISE.
//
// THE FIXTURE IS THE HARD CASES. The JavaScript window had three parts, and a
// SQL range alone is not the same rule:
//
//   · a payment AFTER `periodEnd`              → outside
//   · a payment with a TIME component on the last day → INSIDE (the raw
//     column's `occurred_on <= periodEnd` would have wrongly excluded it)
//   · a payment EXACTLY on `periodStart`       → inside (the bound is inclusive)
//   · a payment EXACTLY on `periodEnd`         → inside (the bound is inclusive)
//   · a payment with a BARE-DATE `occurred_on` → inside (no time component)
//   · a REVERSED payment                       → outside (EC-F-05)
//   · a payment with a MALFORMED `occurred_on` → outside (it is not a day, so
//     it cannot be attributed to any window)
//   · a REFUND                                → subtracted (BR-CALC-10)
//   · another tenant's payment, inside the window → outside (tenant scoping)
//
// The JavaScript reference below is the PRE-FIX algorithm, written out in the
// test: fetch the rows, find the reversed credits by looking the other way
// (a VOID row carries `void_of_id` pointing back at the credit it reverses),
// trim each `occurred_on` to its day, test the day's SHAPE, and compare the
// day against the two inclusive bounds. The SQL aggregate must agree with it
// on every one of those rows.
//
// Runs the REAL `handleAnalytics` and the REAL `createPrismaOrm` against
// in-memory SQLite carrying the gateway's own DDL (AGENTS.md §7.3 — never
// mock the DB: a mock cannot tell you whether SQLite's GLOB matches a
// malformed date the way the JavaScript pattern does).
import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";
import { handleAnalytics } from "../routes/analytics.ts";
import { createPrismaOrm } from "../lib/orm.ts";
import { invalidateTenant } from "../lib/cache.ts";
import type { DB } from "../lib/db.ts";
import { RecordingDb } from "./recording-db.ts";

const TENANT = "018f0000-0000-7000-8000-0000000000a1";
const OTHER_TENANT = "018f0000-0000-7000-8000-0000000000a2";

const PATH = "/api/v1/analytics/dashboard";
const NOW_ISO = "2026-10-04T09:00:00.000Z";

const STUDENT = "018f0000-0000-7000-8000-0000000000c1";
const INVOICE = "018f0000-0000-7000-8000-0000000000d1";

/** The window every case below is judged against. */
const START = "2026-10-01";
const END = "2026-10-31";

/**
 * The credits that count, worked out by hand from the fixture table:
 *
 *   p_start  100000  bare date, exactly on periodStart        → counts
 *   p_end    200000  bare date, exactly on periodEnd          → counts
 *   p_ts     300000  10:00Z on periodEnd (a TIME component)   → counts
 *   p_after  400000  the day after periodEnd                  → does not
 *   p_rev    500000  reversed by a VOID row                   → does not
 *   p_bad    600000  `occurred_on` = "2026-1" (not a day)     → does not
 *   p_before 700000  the day before periodStart               → does not
 *   other    900000  another tenant's payment                 → does not
 *
 * 100000 + 200000 + 300000 = 600000, minus the 50000 refund = 550000.
 */
const EXPECTED_CREDITS = 600000;
const EXPECTED_REFUNDS = 50000;
const EXPECTED_COLLECTED = EXPECTED_CREDITS - EXPECTED_REFUNDS;

interface Kpis {
  collectedThisMonthMinor: number;
}

let db: RecordingDb;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
  db = new RecordingDb();
  seed(db);
  invalidateTenant(TENANT);
  invalidateTenant(OTHER_TENANT);
  db.reset();
});

afterAll(() => {
  vi.useRealTimers();
});

function seed(f: RecordingDb): void {
  const now = "2026-01-01T00:00:00.000Z";
  f.raw.prepare(
    `INSERT INTO students (id, tenant_id, code, first_name, last_name, status, archived_at,
                           balance_paise, admission_date, fee_model, base_fee_paise, dup_key, created_at, updated_at)
     VALUES (?, ?, 'S-001', 'Aarav', 'Sharma', 'active', NULL, 0, '2026-01-04', 'postpaid', 0, 'S-001', ?, ?)`,
  ).run(STUDENT, TENANT, now, now);

  f.raw.prepare(
    `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
                           subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
     VALUES (?, ?, 'INV-000001', ?, '2026-10-01', '2026-10-20', 600000, 0, 0, 600000, 'unpaid', 'hash', ?, ?)`,
  ).run(INVOICE, TENANT, STUDENT, now, now);

  const payment = f.raw.prepare(
    `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
                                 balance_after_paise, description, receipt_no, occurred_on, source, void_of_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'PAYMENT_RECEIVED', 0, ?, 0, 'Payment received', ?, ?, 'gateway', NULL, ?, ?)`,
  );
  const id = (n: string) => `018f0000-0000-7000-8000-0000000000e${n}`;

  payment.run(id("1"), TENANT, STUDENT, INVOICE, 100000, "RCP-000001", "2026-10-01", now, now);
  payment.run(id("2"), TENANT, STUDENT, INVOICE, 200000, "RCP-000002", "2026-10-31", now, now);
  payment.run(id("3"), TENANT, STUDENT, INVOICE, 300000, "RCP-000003", "2026-10-31T10:00:00.000Z", now, now);
  payment.run(id("4"), TENANT, STUDENT, INVOICE, 400000, "RCP-000004", "2026-11-01", now, now);
  payment.run(id("5"), TENANT, STUDENT, INVOICE, 500000, "RCP-000005", "2026-10-15", now, now);
  payment.run(id("6"), TENANT, STUDENT, INVOICE, 600000, "RCP-000006", "2026-1", now, now);
  payment.run(id("7"), TENANT, STUDENT, INVOICE, 700000, "RCP-000007", "2026-09-30", now, now);
  // Another tenant's payment, inside the window. It must never be counted.
  payment.run(id("8"), OTHER_TENANT, STUDENT, INVOICE, 900000, "RCP-000008", "2026-10-10", now, now);

  // The VOID row that reverses `p_rev` (id 5). It carries `void_of_id` and no
  // invoice of its own — the production shape (routes/ledger.ts).
  f.raw.prepare(
    `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
                                 balance_after_paise, description, receipt_no, occurred_on, source, void_of_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'VOID', 500000, 0, 0, 'VOID: wrong amount', 'RCP-000005', '2026-10-16', 'gateway', ?, ?, ?)`,
  ).run(id("9"), TENANT, STUDENT, id("5"), now, now);

  // A refund inside the window: money that left the tutor's hands, so it
  // comes OUT of the collected figure (BR-CALC-10).
  f.raw.prepare(
    `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
                                 balance_after_paise, description, receipt_no, occurred_on, source, void_of_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'REFUND_ISSUED', 50000, 0, 0, 'Refund issued', NULL, '2026-10-20', 'gateway', NULL, ?, ?)`,
  ).run(id("a"), TENANT, STUDENT, now, now);

  // A refund whose `occurred_on` is not a day: it cannot be attributed to any
  // window, so it does not come out of the figure either.
  f.raw.prepare(
    `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
                                 balance_after_paise, description, receipt_no, occurred_on, source, void_of_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'REFUND_ISSUED', 60000, 0, 0, 'Refund issued', NULL, 'not-a-date', 'gateway', NULL, ?, ?)`,
  ).run(id("b"), TENANT, STUDENT, now, now);
}

/** The PRE-FIX algorithm, in the test, as the reference the SQL must match. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function readDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const day = value.slice(0, 10);
  return DAY_PATTERN.test(day) ? day : null;
}

function isWithinPeriod(day: string | null, start: string, end: string): boolean {
  return day !== null && day >= start && day <= end;
}

/**
 * The figure the way the route computed it BEFORE the aggregate: every row in
 * the window, fetched, then reduced in JavaScript.
 */
function collectedByJavaScript(f: RecordingDb, start: string, end: string): {
  creditsPaise: number;
  refundsPaise: number;
} {
  const rows = f.query(
    `SELECT id, type, debit_paise, credit_paise, occurred_on, void_of_id
       FROM ledger_entries WHERE tenant_id = ? AND type IN ('PAYMENT_RECEIVED', 'REFUND_ISSUED')`,
    [TENANT],
  );
  // "Has this credit been reversed?" is answered by looking the OTHER way: a
  // VOID row carries `void_of_id` = the id of the row it reverses.
  const reversed = new Set(
    f
      .query(
        `SELECT void_of_id FROM ledger_entries
          WHERE tenant_id = ? AND type = 'VOID' AND void_of_id IS NOT NULL`,
        [TENANT],
      )
      .map((r) => String(r.void_of_id)),
  );
  let creditsPaise = 0;
  let refundsPaise = 0;
  for (const row of rows) {
    if (!isWithinPeriod(readDay(row.occurred_on), start, end)) continue;
    if (row.type === "PAYMENT_RECEIVED") {
      if (reversed.has(String(row.id))) continue;
      creditsPaise += Number(row.credit_paise);
    } else {
      refundsPaise += Number(row.debit_paise);
    }
  }
  return { creditsPaise, refundsPaise };
}

async function kpis(f: RecordingDb, query: string): Promise<Kpis> {
  const url = new URL(`https://api.buddysaradhi.app${PATH}?${query}`);
  const res = await handleAnalytics(
    new Request(url, { method: "GET" }),
    // SAFETY: RecordingDb satisfies `SqlHandle` structurally — it implements
    // `execute` and delegates to a real SqliteGatewayDb, so the audited
    // builders run against real SQLite. `DB` is the libsql marker it replaces.
    f as unknown as DB,
    TENANT,
    PATH,
    "GET",
    url,
    {},
  );
  if (!res) throw new Error(`no route matched GET ${PATH}`);
  const body = (await res.json()) as { data?: { kpis: Kpis } };
  if (!body.data) throw new Error("dashboard returned no data envelope");
  return body.data.kpis;
}

const WINDOW = `periodStartIso=${START}&periodEndIso=${END}`;

describe("BR-CALC-10 / the SQL aggregate and the JavaScript window agree", () => {
  it("the two ways of computing the figure agree PAISE FOR PAISE", async () => {
    const orm = createPrismaOrm(db, TENANT);
    const sql = await orm.ledgerEntry.sumPeriodAmounts({
      creditType: "PAYMENT_RECEIVED",
      debitType: "REFUND_ISSUED",
      startDay: START,
      endDay: END,
    });
    const reference = collectedByJavaScript(db, START, END);

    // The reference first, so a failure names the rule and not the arithmetic.
    expect(reference.creditsPaise).toBe(EXPECTED_CREDITS);
    expect(reference.refundsPaise).toBe(EXPECTED_REFUNDS);
    expect(sql.creditsPaise).toBe(reference.creditsPaise);
    expect(sql.refundsPaise).toBe(reference.refundsPaise);
    expect(sql.creditsPaise - sql.refundsPaise).toBe(reference.creditsPaise - reference.refundsPaise);
  });

  it("the route reports the same figure the two ways agree on", async () => {
    const { collectedThisMonthMinor } = await kpis(db, WINDOW);
    expect(collectedThisMonthMinor).toBe(EXPECTED_COLLECTED);
  });

  it("a narrower window moves the figure by exactly the rows that leave it", async () => {
    // The window is the ONLY thing that changes which rows count, so the
    // aggregate must follow it exactly — in both directions.
    const orm = createPrismaOrm(db, TENANT);
    const narrower = await orm.ledgerEntry.sumPeriodAmounts({
      creditType: "PAYMENT_RECEIVED",
      debitType: "REFUND_ISSUED",
      startDay: "2026-10-02",
      endDay: "2026-10-30",
    });
    const reference = collectedByJavaScript(db, "2026-10-02", "2026-10-30");
    expect(narrower.creditsPaise).toBe(reference.creditsPaise);
    expect(narrower.refundsPaise).toBe(reference.refundsPaise);
    // `p_start` (2026-10-01), `p_end` and `p_ts` (2026-10-31) left the
    // window; the reversed `p_rev` (2026-10-15) is still inside it and still
    // does not count; the refund (2026-10-20) is still inside it and still
    // comes out.
    expect(narrower.creditsPaise).toBe(0);
    expect(narrower.refundsPaise).toBe(EXPECTED_REFUNDS);
  });

  it("a one-day window counts only that day", async () => {
    const orm = createPrismaOrm(db, TENANT);
    const day = await orm.ledgerEntry.sumPeriodAmounts({
      creditType: "PAYMENT_RECEIVED",
      debitType: "REFUND_ISSUED",
      startDay: "2026-10-01",
      endDay: "2026-10-01",
    });
    expect(day.creditsPaise).toBe(100000);
    expect(day.refundsPaise).toBe(0);
  });

  it("the aggregate refuses a window that is not shaped like a day, and an empty one", async () => {
    const orm = createPrismaOrm(db, TENANT);
    const args = {
      creditType: "PAYMENT_RECEIVED",
      debitType: "REFUND_ISSUED",
      startDay: START,
      endDay: END,
    };
    // The builder is the last gate before a value reaches SQL, so a malformed
    // bound throws there (the route rejects it earlier, with a typed 400).
    await expect(
      orm.ledgerEntry.sumPeriodAmounts({ ...args, startDay: "2026-1-1" }),
    ).rejects.toThrow();
    await expect(
      orm.ledgerEntry.sumPeriodAmounts({ ...args, startDay: "2026-10-20", endDay: "2026-10-01" }),
    ).rejects.toThrow();
  });
});

describe("BR-CALC-10 / the figure is computed in SQL, not in JavaScript", () => {
  // THE NEGATIVE CONTROL. These assertions are RED against the pre-fix route:
  // it issued the two period reads and reduced them here. The value assertions
  // above pass against BOTH implementations — the pre-fix one was not wrong,
  // it was slow — so the shape assertions are what pins the fix.
  it("issues the period aggregate, and no period row-read", async () => {
    await kpis(db, WINDOW);
    const ledgerReads = db.selectsFrom("ledger_entries");

    const aggregate = ledgerReads.find((sql) => sql.includes("SUM(CASE WHEN type = ?"));
    expect(aggregate).toBeDefined();
    // ONE statement for BOTH legs, so the credit sum and the refund sum share
    // one snapshot: a payment and its refund cannot land on opposite sides of
    // a concurrent write.
    expect(aggregate).toContain("credit_paise");
    expect(aggregate).toContain("debit_paise");
    expect(ledgerReads.filter((sql) => sql.includes("SUM(CASE WHEN type = ?"))).toHaveLength(1);

    // The pre-fix period read — every qualifying row, reduced in JavaScript.
    expect(ledgerReads).not.toContain(
      "SELECT * FROM ledger_entries WHERE tenant_id = ? AND type = ? AND occurred_on >= ?",
    );
    for (const sql of ledgerReads) {
      if (sql.includes("SUM(CASE WHEN type = ?")) continue;
      expect(sql).not.toContain("occurred_on >= ?");
    }
  });

  it("the aggregate carries the three parts of the JavaScript window", async () => {
    await kpis(db, WINDOW);
    const aggregate = db.selectsFrom("ledger_entries").find((sql) =>
      sql.includes("SUM(CASE WHEN type = ?")
    )!;
    // 1. The day-shape check (a malformed `occurred_on` is excluded).
    expect(aggregate).toContain("substr(occurred_on, 1, 10) GLOB ?");
    // 2. The TRIMMED day, with inclusive bounds.
    expect(aggregate).toContain("substr(occurred_on, 1, 10) BETWEEN ? AND ?");
    // 3. The reversal graph — "this row's id is not some OTHER row's
    //    `void_of_id`" — as a subquery, never an id list.
    expect(aggregate).toContain("id NOT IN (SELECT void_of_id FROM ledger_entries");
    expect(aggregate).not.toContain("void_of_id IN (");
  });

  it("the per-invoice netting read survives — a window must not blind it", async () => {
    // The netting read is bounded by the OPEN-INVOICE SET, not by the window: a
    // payment that landed before the window can settle an invoice due inside
    // it. Folding it into the period aggregate would silently over-report the
    // invoice as unpaid.
    await kpis(db, WINDOW);
    const netting = db.selectsFrom("ledger_entries").find((sql) =>
      sql.includes("invoice_id IN (")
    );
    expect(netting).toBeDefined();
  });
});
