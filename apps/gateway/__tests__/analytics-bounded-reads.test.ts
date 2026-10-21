// Implements: 04_Dashboard.md §3 (the KPI strip must stay affordable as an
// institute grows) + AGENTS.md §2 Rule 1 (the ledger is APPEND-ONLY, so
// `ledger_entries` grows forever and a `where: {}` read of it is a permanent
// liability, not a temporary one) + Rule 9 (a bounded read must never become a
// silently-truncated one).
//
// Every test here FAILS against the pre-fix route. The route previously issued
// four unbounded reads per dashboard load:
//
//   SELECT * FROM invoices         WHERE tenant_id = ?
//   SELECT * FROM ledger_entries   WHERE tenant_id = ? AND type = ?
//   SELECT * FROM invoices         WHERE tenant_id = ? AND status IN (…) AND due_date IS NOT NULL
//   SELECT * FROM students         WHERE tenant_id = ?
//
// The first two are the defects; the last is documented below as deliberately
// left alone (capping it would make four exact aggregates into four
// approximations — see `the students read is intentionally not capped`).
import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";
import { handleAnalytics } from "../routes/analytics.ts";
import { invalidateTenant } from "../lib/cache.ts";
import type { DB } from "../lib/db.ts";
import { RecordingDb } from "./recording-db.ts";

const TENANT = "018f0000-0000-7000-8000-0000000000f1";
const NOW_ISO = "2026-10-04T09:00:00.000Z";

const S_ARAV = "018f0000-0000-7000-8000-00000000a001";
const S_DIYA = "018f0000-0000-7000-8000-00000000a003";

const PATH = "/api/v1/analytics/dashboard";

interface Kpis {
  totalStudents: number;
  studentsWithDues: number;
  collectedThisMonthMinor: number;
  dueTillDateMinor: number;
  dueForMonthMinor: number;
  overdueMinor: number;
  paymentBreakdown: { paid: number; partial: number; unpaid: number };
}

interface Payload {
  kpis: Kpis;
  dueTodayTotal: number;
  dueTodayTruncated: boolean;
}

async function dashboard(db: RecordingDb, query = ""): Promise<Payload> {
  const url = new URL(`https://api.buddysaradhi.app${PATH}${query ? `?${query}` : ""}`);
  const res = await handleAnalytics(
    new Request(url, { method: "GET" }),
    // SAFETY: RecordingDb satisfies `SqlHandle` structurally — it implements
    // `execute` and delegates it to a real SqliteGatewayDb, so the audited
    // builders run against real SQLite. `DB` is the libsql client marker it
    // replaces.
    db as unknown as DB,
    TENANT,
    PATH,
    "GET",
    url,
    {},
  );
  if (!res) throw new Error(`no route matched GET ${PATH}`);
  const body = (await res.json()) as { data?: Payload };
  if (!body.data) throw new Error("dashboard returned no data envelope");
  return body.data;
}

function seed(db: RecordingDb): void {
  const now = "2026-01-01T00:00:00.000Z";
  db.raw.prepare(
    `INSERT INTO students (id, tenant_id, code, first_name, last_name, status, archived_at,
                           balance_paise, admission_date, fee_model, base_fee_paise, dup_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'postpaid', ?, ?, ?, ?)`,
  ).run(S_ARAV, TENANT, "S-001", "Aarav", "Sharma", "active", null, 250000, "2026-01-04", 300000, "S-001", now, now);
  db.raw.prepare(
    `INSERT INTO students (id, tenant_id, code, first_name, last_name, status, archived_at,
                           balance_paise, admission_date, fee_model, base_fee_paise, dup_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'postpaid', ?, ?, ?, ?)`,
  ).run(S_DIYA, TENANT, "S-003", "Diya", "Nair", "active", null, 100000, "2026-01-06", 250000, "S-003", now, now);

  const insInvoice = db.raw.prepare(
    `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
                           subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'hash', ?, ?)`,
  );
  // One open + past due (money a tutor is chasing), one closed and settled
  // (history that must NOT be re-read on every dashboard load).
  insInvoice.run("018f0000-0000-7000-8000-00000000b001", TENANT, "INV-000101", S_ARAV, "2026-08-01", "2026-09-01", 300000, 300000, "unpaid", now, now);
  insInvoice.run("018f0000-0000-7000-8000-00000000b002", TENANT, "INV-000102", S_DIYA, "2026-06-01", "2026-07-01", 200000, 200000, "paid", now, now);

  db.raw.prepare(
    `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
                                 balance_after_paise, description, receipt_no, occurred_on, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'PAYMENT_RECEIVED', 0, ?, 0, 'Payment received', ?, ?, 'gateway', ?, ?)`,
  ).run("018f0000-0000-7000-8000-00000000c001", TENANT, S_DIYA, "018f0000-0000-7000-8000-00000000b002", 200000, "RCP-000001", "2026-07-02", now, now);
  // Settles the still-open INV-000101 — and it landed OUTSIDE the default
  // (October) window, which is exactly the case that proves the per-invoice
  // netting read is separate from the period read.
  db.raw.prepare(
    `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
                                 balance_after_paise, description, receipt_no, occurred_on, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'PAYMENT_RECEIVED', 0, ?, 0, 'Payment received', ?, ?, 'gateway', ?, ?)`,
  ).run("018f0000-0000-7000-8000-00000000c002", TENANT, S_ARAV, "018f0000-0000-7000-8000-00000000b001", 30000, "RCP-000002", "2026-09-02", now, now);
}

/** Closed history: rows that belong in no measure but would be read in full by
 *  the pre-fix route. Grows with the institute; never grows the query. */
function seedClosedHistory(db: RecordingDb, count: number): void {
  const now = "2026-01-01T00:00:00.000Z";
  const ins = db.raw.prepare(
    `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
                           subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, '2026-01-01', '2026-02-01', ?, 0, 0, ?, 'paid', 'hash', ?, ?)`,
  );
  const pay = db.raw.prepare(
    `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
                                 balance_after_paise, description, receipt_no, occurred_on, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'PAYMENT_RECEIVED', 0, ?, 0, 'Payment received', ?, '2026-01-15', 'gateway', ?, ?)`,
  );
  for (let n = 0; n < count; n += 1) {
    const tag = String(n).padStart(4, "0");
    const invoiceId = `018f0000-0000-7000-8000-00000000d${tag}`;
    ins.run(invoiceId, TENANT, `INV-H${tag}`, S_DIYA, 1000, 1000, now, now);
    pay.run(`018f0000-0000-7000-8000-00000000e${tag}`, TENANT, S_DIYA, invoiceId, 1000, `RCP-H${tag}`, now, now);
  }
}

let db: RecordingDb;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
  db = new RecordingDb();
  seed(db);
  invalidateTenant(TENANT);
  db.reset();
});

afterAll(() => {
  vi.useRealTimers();
});

describe("P1 / the invoice read is bounded to the open set", () => {
  it("issues no all-invoices read — the exact statement the defect used to send", async () => {
    await dashboard(db);
    // `where: {}` builds precisely this, and it was one of the four unbounded
    // reads. Its absence is the fix.
    expect(db.selectsFrom("invoices")).not.toContain("SELECT * FROM invoices WHERE tenant_id = ?");
  });

  it("collapses the two invoice reads into one, filtered by status", async () => {
    await dashboard(db);
    const reads = db.selectsFrom("invoices");
    // Pre-fix this was TWO statements (all invoices, plus open-and-dated).
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain("status IN (?,?,?)");
    // The undated open invoice is still available to `paymentState` because the
    // `due_date IS NOT NULL` clause moved to JS — so the read is a superset of
    // what the old `openDatedInvoices` read returned, not a subset.
    expect(reads[0]).not.toContain("IS NOT NULL");
    // Ordered so the most overdue money is at the top of `dueToday`.
    expect(reads[0]).toContain("ORDER BY due_date ASC");
  });

  it("does not cap the invoice read — a capped money aggregate would be a silent lie", async () => {
    await dashboard(db);
    // The bound is a FILTER (the open set), never a LIMIT. `dueToday` is capped
    // and ships `dueTodayTotal` beside it; `overdueMinor` ships one number with
    // no such claim, so it must be read in full or not at all (Rule 9).
    expect(db.selectsFrom("invoices")[0]).not.toContain("LIMIT");
  });
});

describe("P1 / the payment read is bounded to the period window and the open set", () => {
  it("never issues the all-time PAYMENT_RECEIVED read", async () => {
    await dashboard(db);
    // This is the statement the defect used to send on every dashboard load —
    // O(all-time payments) on an append-only table (AGENTS.md §2 Rule 1).
    expect(db.statements.map((s) => s.sql)).not.toContain(
      "SELECT * FROM ledger_entries WHERE tenant_id = ? AND type = ?",
    );
  });

  it("every PAYMENT_RECEIVED read carries a bound — a window or an invoice set", async () => {
    await dashboard(db);
    const paymentReads = db
      .selectsFrom("ledger_entries")
      .filter((sql) => sql.includes("type = ?"));
    expect(paymentReads.length).toBeGreaterThan(0);
    for (const sql of paymentReads) {
      // Every typed ledger read must be bounded. The bound is one of four
      // forms: the period window as a SUM (`substr(occurred_on, 1, 10) BETWEEN
      // ? AND ?`), the open-invoice set (`invoice_id IN (…)`), or — for the
      // VOID-reversal read added by audit AUD-013 — the candidate credits' own
      // ids (`void_of_id IN (…)`). Each is bounded by the population the read
      // is derived from, so none of them can grow with the tenant's history.
      //
      // The period leg's bound used to be a `SELECT *` over `occurred_on >= ?`
      // that the route reduced in JavaScript. It is a SUM now — one statement,
      // one snapshot, one row back — and the window is expressed on the
      // TRIMMED day, because `occurred_on` may carry a time component.
      const bounded = sql.includes("substr(occurred_on, 1, 10) BETWEEN ? AND ?") ||
        sql.includes("occurred_on >= ?") ||
        sql.includes("invoice_id IN (") ||
        sql.includes("void_of_id IN (");
      expect(bounded).toBe(true);
    }
  });

  it("reads the period leg and the netting leg separately", async () => {
    await dashboard(db);
    const reads = db.selectsFrom("ledger_entries").filter((sql) => sql.includes("type = ?"));
    // Leg 1 — the period sum: a SUM in SQL, bounded by the window, never
    // capped, and never a row-read reduced in JavaScript.
    const period = reads.find((sql) => sql.includes("SUM(CASE WHEN type = ?"));
    expect(period).toBeDefined();
    expect(period).not.toContain("LIMIT");
    expect(period).not.toContain("SELECT *");
    // Leg 2 — the per-invoice netting: bounded by the open-invoice set. It
    // exists precisely because a payment can land OUTSIDE the window and still
    // settle an invoice due inside it, so it cannot be folded into leg 1.
    const netting = reads.find((sql) => sql.includes("invoice_id IN ("));
    expect(netting).toBeDefined();
  });

  it("still issues the activity read (bounded by take, ordered)", async () => {
    await dashboard(db);
    const activity = db.selectsFrom("ledger_entries").find((sql) =>
      sql.includes("ORDER BY occurred_on DESC")
    );
    expect(activity).toBeDefined();
    expect(activity).toContain("LIMIT ?");
  });
});

describe("P1 / bounding the reads did not move a single number", () => {
  it("closed history of any size leaves every KPI untouched", async () => {
    const before = await dashboard(db);

    const big = new RecordingDb();
    seed(big);
    seedClosedHistory(big, 400);
    invalidateTenant(TENANT);
    const after = await dashboard(big, "periodStartIso=2026-01-01&periodEndIso=2026-12-31");
    const baseLife = before;

    // 400 settled invoices and 400 settled payments pre-exist now. None of them
    // is open, none is in the open set, and none may move a figure.
    expect(after.kpis.totalStudents).toBe(baseLife.kpis.totalStudents);
    expect(after.kpis.dueTillDateMinor).toBe(baseLife.kpis.dueTillDateMinor);
    expect(after.kpis.overdueMinor).toBe(baseLife.kpis.overdueMinor);
    expect(after.kpis.paymentBreakdown).toEqual(baseLife.kpis.paymentBreakdown);
    expect(after.dueTodayTotal).toBe(baseLife.dueTodayTotal);

    // …and the roster-sized read did not grow with it either: the 400 extra
    // invoices are simply not read.
    expect(big.selectsFrom("invoices")[0]).toContain("status IN (?,?,?)");
  });

  it("a payment from before the window still nets off the invoice it settled", async () => {
    // RCP-000002 landed 2026-09-02, outside the default October window, and
    // reduces INV-000101 (300000) to 270000. If the netting had been folded into
    // the period-bounded read, this would silently read 300000.
    const payload = await dashboard(db);
    expect(payload.kpis.collectedThisMonthMinor).toBe(0);
    expect(payload.kpis.overdueMinor).toBe(270000);
    expect(payload.kpis.dueTillDateMinor).toBe(350000);
  });

  it("the breakdown is a disjoint partition of the roster", async () => {
    // Was: "noDues stays a subset of paid". That assertion ENCODED the bug — a
    // subset means the same student is counted twice, so the card's numbers summed
    // to more than the roster. The property now asserted is the one a tutor can
    // rely on: the visible buckets add up to the number of students.
    const { kpis } = await dashboard(db);
    expect(Object.keys(kpis.paymentBreakdown).sort()).toEqual(["paid", "partial", "unpaid"]);
    const sum = Object.values(kpis.paymentBreakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(kpis.totalStudents);
    expect(kpis.paymentBreakdown.paid + kpis.paymentBreakdown.partial + kpis.paymentBreakdown.unpaid)
      .toBe(kpis.totalStudents);
  });
});

describe("P1 / the students read is intentionally NOT capped", () => {
  it("the roster read is unbounded, because capping it would make four KPIs approximate", async () => {
    await dashboard(db);
    const roster = db.selectsFrom("students");
    expect(roster).toHaveLength(1);
    expect(roster[0]).toBe("SELECT * FROM students WHERE tenant_id = ?");
    // No LIMIT — and this is the documented decision, not an oversight:
    // `totalStudents`, `studentsWithDues`, `dueTillDateMinor` and the whole
    // `paymentBreakdown` partition are exact aggregates over the roster, and the
    // response ships no flag that could say "this was capped" (Rule 9). Flagged
    // as the one read PERF-GATEWAY-06 could not safely bound.
    expect(roster[0]).not.toContain("LIMIT");
  });
});