// Implements: 04_Dashboard.md §3 (the KPI strip must stay affordable as the
// institute grows) + 12_Business_Rules.md BR-CALC-10 (the figure is a scalar)
// + AGENTS.md §2 Rule 1 (`ledger_entries` is append-only, so the period leg
// grows for the life of the institute) + docs/audit/REMEDIATION-PLAN-2026-10-21.md
// row 3.2 (the measured before/after for the period leg).
//
// ── WHAT THIS FILE MEASURES ─────────────────────────────────────────────────
//
// ONE leg, two arms, over ONE fixture:
//
//   ARM A (the pre-fix leg): read every qualifying ledger row and reduce it
//   in JavaScript. This is what `routes/analytics.ts` did before the
//   aggregate landed, and it is the "All time" pill's cost — the window
//   `1970-01-01`..today, which is the tenant's ENTIRE payment history.
//
//   ARM B (the aggregate): one statement, one row. `stmtSumPeriodLedgerAmounts`
//   in lib/sql.ts.
//
// WHY A DEDICATED FIXTURE AND NOT THE ROUTE. The route does six other reads
// (the roster, the open invoices, the activity feed, the notifications, the
// per-invoice netting). Timing the whole route would drown the leg this row
// is about in work that did not change.
//
// WHY THE BYTES ARE THE HEADLINE AND THE MILLISECONDS ARE NOT. The deployed
// cost of the pre-fix leg was 1,895 KB crossing the wire per request (measured
// against Turso, DYNAMIC-PERFORMANCE M27); the aggregate crosses 21 bytes.
// That ratio is a property of the QUERY, not of the machine, so it is what the
// assertions below pin. The wall-clock numbers are reported, not asserted on
// an absolute budget — this file runs in the shared suite lane, where an
// absolute millisecond budget measures the runner rather than the code (the
// argument in `vitest.perf.config.ts` and `perf-stick.ts`). The ONE timing
// assertion is an inequality between the two arms measured in the SAME run,
// which is what an interleaved A/B can carry.
//
// The estimator is the FASTEST batch, for the reason `perf-stick.ts` gives:
// a batch is only ever slower than the code's true cost, because the machine
// interferes and never helps, so the fastest batch is the closest estimate.
import { describe, expect, it, beforeAll } from "vitest";
import { createPrismaOrm } from "../lib/orm.ts";
import { SqliteGatewayDb } from "./sqlite-db.ts";

const TENANT = "018f0000-0000-7000-8000-0000000000b1";
const STUDENT = "018f0000-0000-7000-8000-0000000000b2";

/** The window the "All" pill sends: `ALL_TIME_START_ISO` in
 *  `apps/web/src/lib/dashboard-period.ts`. */
const ALL_TIME_START = "1970-01-01";
const PERIOD_END = "2026-10-31";

/** The tenant's whole payment history, at the scale the spec's own audit used
 *  (a 200-student institute with 24 months of history). */
const PAYMENT_ROWS = 3600;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function readDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const day = value.slice(0, 10);
  return DAY_PATTERN.test(day) ? day : null;
}

function isWithinPeriod(day: string | null, start: string, end: string): boolean {
  return day !== null && day >= start && day <= end;
}

let db: SqliteGatewayDb;

beforeAll(() => {
  db = new SqliteGatewayDb();
  const now = "2026-01-01T00:00:00.000Z";
  db.raw.prepare(
    `INSERT INTO students (id, tenant_id, code, first_name, last_name, status, archived_at,
                           balance_paise, admission_date, fee_model, base_fee_paise, dup_key, created_at, updated_at)
     VALUES (?, ?, 'S-001', 'Aarav', 'Sharma', 'active', NULL, 0, '2026-01-04', 'postpaid', 0, 'S-001', ?, ?)`,
  ).run(STUDENT, TENANT, now, now);

  const payment = db.raw.prepare(
    `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
                                 balance_after_paise, description, receipt_no, occurred_on, source, void_of_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'PAYMENT_RECEIVED', 0, ?, 0, 'Payment received', ?, ?, 'gateway', NULL, ?, ?)`,
  );
  for (let n = 0; n < PAYMENT_ROWS; n += 1) {
    const tag = String(n).padStart(6, "0");
    // Spread the history over 24 months, ending inside the window.
    const month = String((n % 24) + 1).padStart(2, "0");
    const day = String((n % 28) + 1).padStart(2, "0");
    const year = n % 2 === 0 ? "2025" : "2026";
    payment.run(
      `018f0000-0000-7000-8000-${tag}`,
      TENANT,
      STUDENT,
      1000 + (n % 7),
      `RCP-${tag}`,
      `${year}-${month}-${day}`,
      now,
      now,
    );
  }
});

/** The pre-fix leg: read the rows, then reduce them here. */
async function armRead(): Promise<{ rows: number; bytes: number; collected: number; ms: number }> {
  const orm = createPrismaOrm(db, TENANT);
  const t0 = performance.now();
  const rows = await orm.ledgerEntry.findMany({
    where: { type: "PAYMENT_RECEIVED", occurredOn: { gte: ALL_TIME_START } },
  });
  const reversed = new Set(
    db
      .query(
        `SELECT void_of_id FROM ledger_entries
          WHERE tenant_id = ? AND type = 'VOID' AND void_of_id IS NOT NULL`,
        [TENANT],
      )
      .map((r) => String(r.void_of_id)),
  );
  let collected = 0;
  for (const row of rows) {
    if (!isWithinPeriod(readDay(row.occurredOn), ALL_TIME_START, PERIOD_END)) continue;
    if (reversed.has(String(row.id))) continue;
    collected += Number(row.creditPaise ?? 0);
  }
  const ms = performance.now() - t0;
  return { rows: rows.length, bytes: JSON.stringify(rows).length, collected, ms };
}

/** The aggregate: one statement, one row. */
async function armAggregate(): Promise<{ rows: number; bytes: number; collected: number; ms: number }> {
  const orm = createPrismaOrm(db, TENANT);
  const t0 = performance.now();
  const totals = await orm.ledgerEntry.sumPeriodAmounts({
    creditType: "PAYMENT_RECEIVED",
    debitType: "REFUND_ISSUED",
    startDay: ALL_TIME_START,
    endDay: PERIOD_END,
  });
  const ms = performance.now() - t0;
  const row = { creditsPaise: totals.creditsPaise, refundsPaise: totals.refundsPaise };
  return { rows: 1, bytes: JSON.stringify(row).length, collected: totals.creditsPaise - totals.refundsPaise, ms };
}

/** Interleaved A/B, fastest batch wins (see the file header). */
async function measure(): Promise<{ read: number; aggregate: number }> {
  const readSamples: number[] = [];
  const aggregateSamples: number[] = [];
  for (let round = 0; round < 3; round += 1) {
    for (const arm of [armRead, armAggregate, armAggregate, armRead]) {
      const result = await arm();
      if (arm === armRead) readSamples.push(result.ms);
      else aggregateSamples.push(result.ms);
    }
  }
  return { read: Math.min(...readSamples), aggregate: Math.min(...aggregateSamples) };
}

describe("row 3.2 / the period leg, measured", () => {
  it("the aggregate reads one row where the row-read read the whole history", async () => {
    const read = await armRead();
    const aggregate = await armAggregate();

    // The same figure, paise for paise. The parity proof over the HARD CASES
    // is `analytics-period-aggregate.test.ts`; this is the same rule over a
    // tenant's whole history.
    expect(aggregate.collected).toBe(read.collected);

    // The rows: 3,600 in, 1 out.
    expect(read.rows).toBe(PAYMENT_ROWS);
    expect(aggregate.rows).toBe(1);

    // The bytes: the deployed cost of the pre-fix leg was 1,895 KB per
    // request; the aggregate crosses 21. That ratio is a property of the
    // QUERY, so it is the assertion — an absolute millisecond budget is not.
    expect(read.bytes).toBeGreaterThan(500 * 1024);
    expect(aggregate.bytes).toBeLessThan(64);
    expect(read.bytes / aggregate.bytes).toBeGreaterThan(1000);

    // eslint-disable-next-line no-console -- the measurement IS the report.
    console.log(
      `[row 3.2] period leg, all-time window: row-read ${read.rows} rows / ` +
        `${(read.bytes / 1024).toFixed(0)} KB -> aggregate ${aggregate.rows} row / ` +
        `${aggregate.bytes} B (${(read.bytes / aggregate.bytes).toFixed(0)}x fewer bytes)`,
    );
  });

  it("the aggregate is not slower than the row-read it replaces", async () => {
    const { read, aggregate } = await measure();
    // eslint-disable-next-line no-console -- the measurement IS the report.
    console.log(
      `[row 3.2] period leg: row-read ${read.toFixed(2)} ms -> aggregate ` +
        `${aggregate.toFixed(2)} ms (${(read / aggregate).toFixed(1)}x, local SQLite)`,
    );
    expect(aggregate).toBeLessThan(read);
  });
});
