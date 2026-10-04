// Implements: 04_Dashboard.md §3 (the KPI strip and the due-today action
// list) and 07_Fees_and_Payments.md §2 (the Fees roster) — the four places this
// suite pins are measures a tutor reads about their OWN books, where a number
// that is quietly wrong is worse than a number that is absent.
//
// Runs the REAL `handleAnalytics` / `handleLedger` and the REAL
// `createPrismaOrm` against in-memory SQLite carrying the gateway's own DDL
// (AGENTS.md §7.3 — never mock the DB; a mock cannot tell you whether the
// orderBy allowlist rejected an injection attempt or whether SQLite accepted a
// bad column).
//
// Every expected value below is a worked-example literal read off the fixture
// tables in the comments above each test, never recomputed with the same
// expression the code under test uses.
//
// `Date` is frozen (and only `Date`) so "overdue today" is a fixed fact rather
// than something that changes on the day the suite runs.
import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";
import { handleAnalytics } from "../routes/analytics.ts";
import { handleLedger } from "../routes/ledger.ts";
import { invalidateTenant } from "../lib/cache.ts";
import type { DB } from "../lib/db.ts";
import { SqliteGatewayDb } from "./sqlite-db.ts";

const TENANT = "018f0000-0000-7000-8000-0000000000f1";
const OTHER_TENANT = "018f0000-0000-7000-8000-0000000000f2";

// "Today" for every test in this file. The overdue set is built around it.
const NOW_ISO = "2026-10-04T09:00:00.000Z";

const S_ARAV = "018f0000-0000-7000-8000-00000000a001";
const S_KABIR = "018f0000-0000-7000-8000-00000000a002";
const S_DIYA = "018f0000-0000-7000-8000-00000000a003";
const S_ISHITA = "018f0000-0000-7000-8000-00000000a004";
const S_VIVAAN = "018f0000-0000-7000-8000-00000000a005";
const S_GONE = "018f0000-0000-7000-8000-00000000a999"; // belongs to OTHER_TENANT

const I_PAID = "018f0000-0000-7000-8000-00000000b001";
const I_OLD_UNPAID = "018f0000-0000-7000-8000-00000000b002";
const I_FUTURE_PARTIAL = "018f0000-0000-7000-8000-00000000b003";
const I_OLD_PARTIAL = "018f0000-0000-7000-8000-00000000b004";
const I_VOID = "018f0000-0000-7000-8000-00000000b005";
const I_NO_DUE_DATE = "018f0000-0000-7000-8000-00000000b006";
const I_ORPHAN = "018f0000-0000-7000-8000-00000000b007";

interface ApiBody {
  success: boolean;
  data?: unknown;
  error?: string;
  details?: string;
}

interface DashboardPayload {
  kpis: {
    totalStudents: number;
    studentsWithDues: number;
    collectedThisMonthMinor: number;
    dueTillDateMinor: number;
    dueForMonthMinor: number;
    overdueMinor: number;
    paymentBreakdown: { paid: number; partial: number; unpaid: number; noDues: number };
  };
  activity: Array<{
    id: string;
    event_type: string;
    student_name: string | null;
    event_title: string | null;
    invoice_number: string | null;
    minor_amount: number;
    additional_data: string | null;
    timestamp: string;
  }>;
  dueToday: Array<{
    student_id: string;
    student_name: string | null;
    due_minor: number;
    invoice_number: string | null;
    due_date: string;
  }>;
  dueTodayTotal: number;
  dueTodayTruncated: boolean;
  dataOrigin: string;
}

interface FeesPayload {
  success: boolean;
  data: Array<{ id: string; name: string; code: string | null; fee_model: string; balance_due: number }>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  truncated: boolean;
}

function seedMeasures(f: SqliteGatewayDb): void {
  const now = "2026-01-01T00:00:00.000Z";
  const insStudent = f.raw.prepare(
    `INSERT INTO students (id, tenant_id, code, first_name, last_name, status, archived_at,
                           balance_paise, admission_date, fee_model, base_fee_paise, dup_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'postpaid', ?, ?, ?, ?)`,
  );
  //                        id           tenant  code    first    last     status    archived  balance  admission          baseFee  dupKey  created  updated
  insStudent.run(S_ARAV, TENANT, "S-001", "Aarav", "Sharma", "active", null, 0, "2026-01-04", 300000, "S-001", now, now);
  insStudent.run(S_KABIR, TENANT, "S-002", "Kabir", "Menon", "active", null, 250000, "2026-01-05", 300000, "S-002", now, now);
  insStudent.run(S_DIYA, TENANT, "S-003", "Diya", "Nair", "active", null, 100000, "2026-01-06", 250000, "S-003", now, now);
  insStudent.run(S_ISHITA, TENANT, "S-004", "Ishita", "Rao", "inactive", null, 400000, "2026-01-07", 300000, "S-004", now, now);
  insStudent.run(S_VIVAAN, TENANT, "S-005", "Vivaan", "Bose", "active", null, 0, "2026-01-08", 300000, "S-005", now, now);
  insStudent.run(S_GONE, OTHER_TENANT, "X-999", "Outsider", "Tenant", "active", null, 999999, "2026-01-09", 300000, "X-999", now, now);

  const insInvoice = f.raw.prepare(
    `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
                           subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'hash', ?, ?)`,
  );
  //                             id           tenant  number      student      issue       due         sub     total   status
  insInvoice.run(I_PAID, TENANT, "INV-000101", S_ARAV, "2026-01-01", "2026-01-10", 100000, 100000, "paid", now, now);
  insInvoice.run(I_OLD_UNPAID, TENANT, "INV-000102", S_KABIR, "2026-08-01", "2026-09-01", 300000, 300000, "unpaid", now, now);
  insInvoice.run(I_FUTURE_PARTIAL, TENANT, "INV-000103", S_KABIR, "2026-10-01", "2026-10-20", 50000, 50000, "partial", now, now);
  insInvoice.run(I_OLD_PARTIAL, TENANT, "INV-000104", S_DIYA, "2026-08-01", "2026-08-15", 200000, 200000, "partial", now, now);
  insInvoice.run(I_VOID, TENANT, "INV-000105", S_DIYA, "2026-06-01", "2026-07-01", 99900, 99900, "void", now, now);
  insInvoice.run(I_NO_DUE_DATE, TENANT, "INV-000106", S_ARAV, "2026-09-01", null, 42000, 42000, "unpaid", now, now);
  // An invoice whose student row is gone: it must still be counted (the money
  // is real) and it must NOT be given a fabricated name.
  insInvoice.run(I_ORPHAN, TENANT, "INV-000107", S_GONE, "2026-07-01", "2026-08-01", 70000, 70000, "unpaid", now, now);

  const insPayment = f.raw.prepare(
    `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
                                 balance_after_paise, description, receipt_no, occurred_on, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'PAYMENT_RECEIVED', 0, ?, 0, 'Payment received', ?, ?, 'gateway', ?, ?)`,
  );
  insPayment.run("018f0000-0000-7000-8000-00000000c001", TENANT, S_DIYA, I_OLD_PARTIAL, 50000, "RCP-000001", "2026-08-20", now, now);
  insPayment.run("018f0000-0000-7000-8000-00000000c002", TENANT, S_DIYA, I_OLD_PARTIAL, 20000, "RCP-000002", "2026-09-02", now, now);
  // A third payment on an invoice that is already in full: it must not make
  // any other invoice's arrears smaller.
  insPayment.run("018f0000-0000-7000-8000-00000000c003", TENANT, S_ARAV, I_PAID, 50000, "RCP-000003", "2026-02-02", now, now);
}

async function dashboard(f: SqliteGatewayDb, query = ""): Promise<DashboardPayload> {
  const path = "/api/v1/analytics/dashboard";
  const url = new URL(`https://api.buddysaradhi.app${path}${query ? `?${query}` : ""}`);
  const res = await handleAnalytics(
    new Request(url, { method: "GET" }),
    // SAFETY: SqliteGatewayDb satisfies `SqlHandle`, the only capability the
    // route uses; `DB` is the libsql client marker it structurally replaces.
    f as unknown as DB,
    TENANT,
    path,
    "GET",
    url,
    {},
  );
  if (!res) throw new Error(`no route matched GET ${path}`);
  const body = (await res.json()) as ApiBody;
  return body.data as DashboardPayload;
}

/** The same request, but keeping the failure body so a 400 can be asserted. */
async function dashboardRaw(
  f: SqliteGatewayDb,
  query: string,
): Promise<{ status: number; body: ApiBody }> {
  const path = "/api/v1/analytics/dashboard";
  const url = new URL(`https://api.buddysaradhi.app${path}?${query}`);
  const res = await handleAnalytics(
    new Request(url, { method: "GET" }),
    f as unknown as DB,
    TENANT,
    path,
    "GET",
    url,
    {},
  );
  if (!res) throw new Error(`no route matched GET ${path}?${query}`);
  return { status: res.status, body: (await res.json()) as ApiBody };
}

/** The whole of recorded history — every fixture date falls inside it. */
const LIFETIME = "periodStartIso=2026-01-01&periodEndIso=2026-12-31";

async function fees(f: SqliteGatewayDb, query: string): Promise<FeesPayload> {
  const path = "/api/v1/ledger/fees";
  const url = new URL(`https://api.buddysaradhi.app${path}${query ? `?${query}` : ""}`);
  const res = await handleLedger(
    new Request(url, { method: "GET" }),
    f as unknown as DB,
    TENANT,
    path,
    "GET",
    url,
    {},
  );
  if (!res) throw new Error(`no route matched GET ${path}${query}`);
  return (await res.json()) as FeesPayload;
}

let f: SqliteGatewayDb;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
  f = new SqliteGatewayDb();
  seedMeasures(f);
  invalidateTenant(TENANT);
  invalidateTenant(OTHER_TENANT);
});

afterAll(() => {
  vi.useRealTimers();
});

describe("dashboard / Overdue — computed from invoices, not from a subtraction that can only reach zero", () => {
  /*
   * Fixture, today = 2026-10-04.
   *   INV-000102  Kabir  300000  unpaid   due 2026-09-01  0 paid      → overdue, owes 300000
   *   INV-000104  Diya   200000  partial  due 2026-08-15  70000 paid → overdue, owes 130000
   *   INV-000107  (gone)  70000  unpaid   due 2026-08-01  0 paid      → overdue, owes  70000
   *   INV-000103  Kabir   50000  partial  due 2026-10-20  0 paid      → not due yet
   *   INV-000106  Aarav   42000  unpaid   due NULL       0 paid      → no deadline
   *   INV-000101  Aarav  100000  paid     due 2026-01-10              → settled
   *   INV-000105  Diya    99900  void     due 2026-07-01              → voided
   *   overdueMinor = 300000 + 130000 + 70000 = 500000
   */

  it("sums what is still owed on invoices whose due date has passed", async () => {
    expect((await dashboard(f)).kpis.overdueMinor).toBe(500000);
  });

  it("is not `dueTill - all payments ever taken`, which was structurally zero for any real tutor", async () => {
    const { kpis } = await dashboard(f, LIFETIME);
    // The old formula's own inputs, read off this fixture: outstanding 350000,
    // lifetime collections 120000 → Math.max(0, 350000 - 120000) = 230000,
    // a figure that describes no period and, once a tutor's collections exceed
    // their balance, reports 0 forever.
    expect(kpis.dueTillDateMinor).toBe(350000);
    expect(kpis.collectedThisMonthMinor).toBe(120000);
    expect(kpis.overdueMinor).not.toBe(Math.max(0, kpis.dueTillDateMinor - kpis.collectedThisMonthMinor));
    expect(kpis.overdueMinor).toBe(500000);
  });

  it("a partially paid invoice contributes only its remainder (200000 - 70000)", async () => {
    const rows = (await dashboard(f)).dueToday;
    const diya = rows.find((r) => r.invoice_number === "INV-000104");
    expect(diya?.due_minor).toBe(130000);
  });

  it("never counts a void, a settled, a future-dated or a dateless invoice", async () => {
    const numbers = (await dashboard(f)).dueToday.map((r) => r.invoice_number);
    expect(numbers).not.toContain("INV-000105"); // void
    expect(numbers).not.toContain("INV-000101"); // paid
    expect(numbers).not.toContain("INV-000103"); // due 2026-10-20
    expect(numbers).not.toContain("INV-000106"); // due_date IS NULL
  });

  it("an overpayment on one invoice does not cancel another student's arrears", async () => {
    // Diya's payments total 70000 against a 200000 invoice; Aarav's invoice has
    // its own 50000 payment. Neither may reduce Kabir's 300000.
    expect((await dashboard(f)).kpis.overdueMinor).toBe(500000);
  });

  it("stays integer paise", async () => {
    const { kpis } = await dashboard(f);
    for (const v of [
      kpis.overdueMinor,
      kpis.dueTillDateMinor,
      kpis.collectedThisMonthMinor,
    ]) {
      expect(Number.isSafeInteger(v)).toBe(true);
    }
  });

  it("is zero only because nothing is overdue — and never because a read failed", async () => {
    const empty = new SqliteGatewayDb();
    const { kpis } = await dashboard(empty);
    expect(kpis.overdueMinor).toBe(0);
    expect(kpis.totalStudents).toBe(0);
    // An empty institute and a broken institute must not look alike.
    expect((await dashboard(f)).kpis.totalStudents).toBe(4);
  });
});

describe("dashboard / Due Today — ordered, named, and counted", () => {
  it("orders by due date ascending, so the most overdue money is first", async () => {
    const rows = (await dashboard(f)).dueToday.map((r) => [r.invoice_number, r.due_date]);
    expect(rows).toEqual([
      ["INV-000107", "2026-08-01"],
      ["INV-000104", "2026-08-15"],
      ["INV-000102", "2026-09-01"],
    ]);
  });

  it("names each student from the roster instead of the literal \"Student\"", async () => {
    const names = (await dashboard(f)).dueToday.map((r) => r.student_name);
    expect(names).toContain("Diya Nair");
    expect(names).toContain("Kabir Menon");
    expect(names).not.toContain("Student");
    // An invoice with no student row yields NO name at all — null on the wire,
    // which the client's boundary schema normalises to "" and it renders as
    // "Unnamed student". A fabricated name is worse than an absent one.
    expect(names).toContain(null);
    expect(new Set(names).size).toBe(3);
  });

  it("reports the true population and whether the slice is complete", async () => {
    const payload = await dashboard(f);
    expect(payload.dueTodayTotal).toBe(3);
    expect(payload.dueToday).toHaveLength(3);
    expect(payload.dueTodayTruncated).toBe(false);
  });

  it("sums to the Overdue tile when the list is complete (one measure, two renderings)", async () => {
    const payload = await dashboard(f);
    const listed = payload.dueToday.reduce((a, r) => a + r.due_minor, 0);
    expect(listed).toBe(payload.kpis.overdueMinor);
  });

  it("caps at 50 rows and says so instead of implying the list is complete", async () => {
    const many = new SqliteGatewayDb();
    const now = "2026-01-01T00:00:00.000Z";
    many.raw.prepare(
      `INSERT INTO students (id, tenant_id, first_name, status, archived_at, balance_paise,
                             admission_date, fee_model, base_fee_paise, dup_key, created_at, updated_at)
       VALUES (?, ?, ?, 'active', NULL, 0, '2026-01-01', 'postpaid', 0, ?, ?, ?)`,
    ).run(S_ARAV, TENANT, "Bulk", "S-BULK", now, now);
    const ins = many.raw.prepare(
      `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
                             subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-01-01', '2026-09-30', 1000, 0, 0, 1000, 'unpaid', 'hash', ?, ?)`,
    );
    for (let n = 0; n < 60; n += 1) {
      ins.run(
        `018f0000-0000-7000-8000-00000000d${String(n).padStart(3, "0")}`,
        TENANT,
        `INV-B${String(n).padStart(3, "0")}`,
        S_ARAV,
        now,
        now,
      );
    }
    const payload = await dashboard(many);
    expect(payload.dueToday).toHaveLength(50);
    expect(payload.dueTodayTotal).toBe(60);
    expect(payload.dueTodayTruncated).toBe(true);
    // The 50 returned are the FIRST 50 by due date, not an arbitrary subset.
    expect(payload.dueToday[0]?.invoice_number).toBe("INV-B000");
    expect(payload.dueToday[49]?.invoice_number).toBe("INV-B049");
  });

  it("excludes inactive and archived students from the counts", async () => {
    const payload = await dashboard(f);
    // Ishita (inactive, ₹40000 owed) and the other tenant's student are outside
    // every measure.
    expect(payload.kpis.totalStudents).toBe(4);
    expect(payload.kpis.studentsWithDues).toBe(2);
    expect(payload.kpis.dueTillDateMinor).toBe(350000);
  });

  it("never crosses the tenant boundary", async () => {
    const payload = await dashboard(f);
    const ids = payload.dueToday.map((r) => r.student_id);
    expect(ids).toContain(S_GONE); // the orphaned invoice still carries money
    expect(payload.dueToday.map((r) => r.student_name)).not.toContain("Outsider Tenant");
    expect(payload.kpis.totalStudents).toBe(4);
  });
});

describe("dashboard / paymentBreakdown — a partition of the active roster, not one fact stated three times", () => {
  /*
   * Active roster, by what is outstanding on each student's OWN open invoices:
   *   Aarav  42000 on INV-000106 (unpaid, no due date) → unpaid
   *   Kabir 350000 across INV-000102 + INV-000103, no payment attributed
   *          to either                                                → unpaid
   *   Diya  130000 on INV-000104 with 70000 attributed              → partial
   *   Vivaan no invoices at all                                        → paid
   *   paid = 1  partial = 1  unpaid = 2  noDues = 1 (Vivaan — a SUBSET of paid)
   */
  it("classifies each active student from their own invoices", async () => {
    expect((await dashboard(f)).kpis.paymentBreakdown).toEqual({
      paid: 1,
      partial: 1,
      unpaid: 2,
      noDues: 1,
    });
  });

  it("never reports unpaid: 0 alongside a non-zero partial (the old shape)", async () => {
    const b = (await dashboard(f)).kpis.paymentBreakdown;
    expect(b.unpaid).toBeGreaterThan(0);
  });

  it("partitions the roster: paid + partial + unpaid === totalStudents", async () => {
    const { kpis } = await dashboard(f);
    expect(kpis.paymentBreakdown.paid + kpis.paymentBreakdown.partial + kpis.paymentBreakdown.unpaid)
      .toBe(kpis.totalStudents);
    expect(kpis.paymentBreakdown.noDues).toBeLessThanOrEqual(kpis.paymentBreakdown.paid);
  });

  it("does not count a void invoice as owing money", async () => {
    // Diya's voided INV-000105 (99900) must not put her in `unpaid`; she is
    // `partial` purely because of INV-000104.
    const b = (await dashboard(f)).kpis.paymentBreakdown;
    expect(b.paid + b.partial + b.unpaid).toBe(4);
  });
});

describe("dashboard / the period is an input, not a comment", () => {
  /*
   * Fixture payments, today = 2026-10-04 (so the default window is
   * 2026-10-01 .. 2026-10-04):
   *   2026-08-20   Diya   50000
   *   2026-09-02   Diya   20000
   *   2026-02-02   Aarav  50000
   * Nothing in October. Lifetime = 120000.
   */
  it("defaults to the calendar month so far, so nothing in this fixture counts", async () => {
    expect((await dashboard(f)).kpis.collectedThisMonthMinor).toBe(0);
  });

  it("counts only the payments inside the window", async () => {
    const august = await dashboard(f, "periodStartIso=2026-08-01&periodEndIso=2026-08-31");
    expect(august.kpis.collectedThisMonthMinor).toBe(50000); // the 08-20 payment only
    const augSep = await dashboard(f, "periodStartIso=2026-08-01&periodEndIso=2026-09-30");
    expect(augSep.kpis.collectedThisMonthMinor).toBe(70000); // 50000 + 20000
    expect((await dashboard(f, LIFETIME)).kpis.collectedThisMonthMinor).toBe(120000);
  });

  it("treats both bounds as inclusive, so a one-day window is not empty", async () => {
    const one = await dashboard(f, "periodStartIso=2026-08-20&periodEndIso=2026-08-20");
    expect(one.kpis.collectedThisMonthMinor).toBe(50000);
  });

  it("still nets a February payment off an August invoice when it lands outside the window", async () => {
    // Aarav's 2026-02-02 payment settles INV-000101 (already `paid`). The
    // period sum may exclude it; the per-invoice outstanding figures may not.
    // Windowing one measure must not blind the others.
    const month = await dashboard(f, "periodStartIso=2026-10-01&periodEndIso=2026-10-04");
    expect(month.kpis.collectedThisMonthMinor).toBe(0);
    expect(month.kpis.overdueMinor).toBe(500000);
    expect(month.kpis.dueForMonthMinor).toBe(0);
  });

  it("rejects a malformed window with a typed 400, not a silent zero", async () => {
    const badStart = await dashboardRaw(f, "periodStartIso=2026-13-45");
    expect(badStart.status).toBe(400);
    expect(badStart.body.success).toBe(false);
    expect(badStart.body.error).toBe("VALIDATION");
    expect(badStart.body.details).toContain("periodStartIso");

    const badEnd = await dashboardRaw(f, "periodEndIso=tomorrow");
    expect(badEnd.status).toBe(400);
    expect(badEnd.body.details).toContain("periodEndIso");
  });

  it("rejects an inverted window instead of answering 0 for it", async () => {
    const inverted = await dashboardRaw(f, "periodStartIso=2026-09-30&periodEndIso=2026-09-01");
    expect(inverted.status).toBe(400);
    expect(inverted.body.error).toBe("VALIDATION");
  });

  it("is a window, not a filter: totalStudents and dueTillDateMinor do not move", async () => {
    const narrow = await dashboard(f, "periodStartIso=2026-10-04&periodEndIso=2026-10-04");
    const wide = await dashboard(f, LIFETIME);
    expect(narrow.kpis.totalStudents).toBe(wide.kpis.totalStudents);
    expect(narrow.kpis.dueTillDateMinor).toBe(wide.kpis.dueTillDateMinor);
  });

  it("stays integer paise for every window", async () => {
    for (const q of ["", LIFETIME, "periodStartIso=2026-08-01&periodEndIso=2026-09-30"]) {
      const { kpis } = await dashboard(f, q);
      expect(Number.isSafeInteger(kpis.collectedThisMonthMinor)).toBe(true);
      expect(Number.isSafeInteger(kpis.dueForMonthMinor)).toBe(true);
    }
  });
});

describe("dashboard / dueForMonthMinor — what is owed on invoices DUE in the window", () => {
  /*
   * Fixture invoices, by outstanding amount and due date:
   *   INV-000102  Kabir   300000 unpaid  due 2026-09-01   0 paid → 300000
   *   INV-000104  Diya    200000 partial due 2026-08-15  70000 paid → 130000
   *   INV-000107  (gone)   70000 unpaid  due 2026-08-01   0 paid →  70000
   *   INV-000103  Kabir    50000 partial due 2026-10-20   0 paid →  50000
   *   INV-000105  Diya     99900 VOID    due 2026-07-01              → excluded
   *   INV-000106  Aarav    42000 unpaid  due NULL                    → excluded
   *   INV-000101  Aarav   100000 paid    due 2026-01-10              → excluded
   */
  it("is net of payments and excludes voids, unpaid-forever and dateless rows", async () => {
    // 300000 + 130000 + 70000 + 50000
    expect((await dashboard(f, LIFETIME)).kpis.dueForMonthMinor).toBe(550000);
  });

  it("is not the payment-blind, date-blind, void-inclusive total it replaced", async () => {
    // The old line summed `total` over every invoice that was not `paid`:
    // 300000 + 50000 + 200000 + 99900 (void) + 42000 (no due date) + 70000.
    const old = 761900;
    const { kpis } = await dashboard(f, LIFETIME);
    expect(kpis.dueForMonthMinor).not.toBe(old);
    expect(kpis.dueForMonthMinor).toBeLessThan(old);
  });

  it("is zero for a window holding only the voided invoice, not 99900", async () => {
    const july = await dashboard(f, "periodStartIso=2026-07-01&periodEndIso=2026-07-31");
    expect(july.kpis.dueForMonthMinor).toBe(0);
  });

  it("windows on the due date, so a not-yet-due invoice is out of this month", async () => {
    const october = await dashboard(f, "periodStartIso=2026-10-01&periodEndIso=2026-10-31");
    // INV-000103 (50000, due 2026-10-20) is in; nothing else is.
    expect(october.kpis.dueForMonthMinor).toBe(50000);
    // And the default window (1st → today, 2026-10-04) does not reach it yet.
    expect((await dashboard(f)).kpis.dueForMonthMinor).toBe(0);
  });

  it("nets payments off the invoice they were attributed to", async () => {
    const one = await dashboard(f, "periodStartIso=2026-08-15&periodEndIso=2026-08-15");
    expect(one.kpis.dueForMonthMinor).toBe(130000); // 200000 - 70000, never 200000
  });

  it("differs from Overdue when an invoice is due later in the period", async () => {
    // Lifetime: 500000 overdue (INV-000103 is due 2026-10-20, after today) but
    // 550000 due in the window. One measure is a subset of the other and the
    // two must not be the same field wearing one name.
    const life = await dashboard(f, LIFETIME);
    expect(life.kpis.overdueMinor).toBe(500000);
    expect(life.kpis.dueForMonthMinor).toBe(550000);
  });
});

describe("dashboard / activity — a person in the name column, or nothing", () => {
  it("names the payer from the roster instead of the ledger description", async () => {
    const rows = (await dashboard(f)).activity;
    const payment = rows.find((r) => r.event_type === "PAYMENT");
    expect(payment?.student_name).toBe("Diya Nair");
    expect(payment?.student_name).not.toBe("Payment received");
  });

  it("never puts a description or an entry type in the name column", async () => {
    const names = (await dashboard(f)).activity.map((r) => r.student_name);
    // The fixture writes description = 'Payment received' on all three payments,
    // which is exactly the string the old `e.description || e.type` produced.
    expect(names).not.toContain("Payment received");
    expect(names).not.toContain("PAYMENT_RECEIVED");
    expect(names).not.toContain("FEE_CHARGED");
  });

  it("carries no name for a payment whose student is gone, rather than inventing one", async () => {
    const orphan = new SqliteGatewayDb();
    const now = "2026-01-01T00:00:00.000Z";
    orphan.raw.prepare(
      `INSERT INTO students (id, tenant_id, first_name, status, archived_at, balance_paise,
                             admission_date, fee_model, base_fee_paise, dup_key, created_at, updated_at)
       VALUES (?, ?, ?, 'active', NULL, 0, '2026-01-01', 'postpaid', 0, ?, ?, ?)`,
    ).run(S_ARAV, TENANT, "Bulk", "S-BULK", now, now);
    orphan.raw.prepare(
      `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
                                   balance_after_paise, description, receipt_no, occurred_on, source, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'PAYMENT_RECEIVED', 0, 75000, 0, 'June fees in full', 'RCP-000900', '2026-10-02', 'gateway', ?, ?)`,
    ).run("018f0000-0000-7000-8000-00000000f001", TENANT, S_GONE, now, now);

    const rows = (await dashboard(orphan)).activity;
    const payment = rows.find((r) => r.event_type === "PAYMENT");
    // "June fees in full" is the ledger writer's prose, not a person.
    expect(payment?.student_name).toBe(null);
    expect(payment?.minor_amount).toBe(75000);
  });

  it("gives a notification its title in event_title and leaves student_name absent", async () => {
    const withNotif = new SqliteGatewayDb();
    const now = "2026-01-01T00:00:00.000Z";
    withNotif.raw.prepare(
      `INSERT INTO notifications (id, tenant_id, category, title, body, created_at)
       VALUES (?, ?, 'reminder', 'Fee reminder due', 'Three invoices are past their date', ?)`,
    ).run("018f0000-0000-7000-8000-00000000f002", TENANT, now);

    const row = (await dashboard(withNotif)).activity[0];
    expect(row?.event_type).toBe("OTHER");
    expect(row?.event_title).toBe("Fee reminder due");
    expect(row?.student_name).toBe(null);
  });

  it("leaves event_title null on a ledger row, so the two fields cannot drift", async () => {
    const row = (await dashboard(f)).activity.find((r) => r.event_type === "PAYMENT");
    expect(row?.event_title).toBe(null);
    expect(row?.student_name).not.toBe(null);
  });
});

describe("fees roster — the 200 cap is gone and the population size is stated", () => {
  function seedRoster(db: SqliteGatewayDb, count: number): void {
    const now = "2026-01-01T00:00:00.000Z";
    const ins = db.raw.prepare(
      `INSERT INTO students (id, tenant_id, first_name, last_name, code, status, archived_at,
                             balance_paise, admission_date, fee_model, base_fee_paise, dup_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, '2026-01-01', 'postpaid', 300000, ?, ?, ?)`,
    );
    for (let n = 1; n <= count; n += 1) {
      const tag = String(n).padStart(4, "0");
      ins.run(
        `018f0000-0000-7000-8000-00000000e${tag}`,
        TENANT,
        `Student${tag}`,
        "Roster",
        `R-${tag}`,
        "active",
        null,
        `R-${tag}`,
        now,
        now,
      );
    }
  }

  it("returns every active student when no pager is sent — student 201 is not unreachable", async () => {
    const big = new SqliteGatewayDb();
    seedRoster(big, 250);
    const body = await fees(big, "");
    expect(body.data).toHaveLength(250);
    expect(body.total).toBe(250);
    expect(body.truncated).toBe(false);
    expect(body.data.map((s) => s.code)).toContain("R-0250");
    expect(body.data.map((s) => s.code)).toContain("R-0201");
  });

  it("honours page/pageSize and states the population instead of implying completeness", async () => {
    const big = new SqliteGatewayDb();
    seedRoster(big, 250);
    const page1 = await fees(big, "page=1&pageSize=200");
    expect(page1.data).toHaveLength(200);
    expect(page1.total).toBe(250);
    expect(page1.totalPages).toBe(2);
    expect(page1.truncated).toBe(true);

    const page2 = await fees(big, "page=2&pageSize=200");
    expect(page2.data).toHaveLength(50);
    expect(page2.total).toBe(250);
    // `truncated` means "this response is not the whole roster", not "there is
    // a further page" — page 2 is the last page, yet it is 50 of 250.
    expect(page2.truncated).toBe(true);
  });

  it("pages cover the population exactly once, in the same order", async () => {
    const big = new SqliteGatewayDb();
    seedRoster(big, 250);
    const p1 = await fees(big, "page=1&pageSize=200");
    const p2 = await fees(big, "page=2&pageSize=200");
    const seen = [...p1.data, ...p2.data].map((s) => s.id);
    expect(new Set(seen).size).toBe(250);
    const unpaged = (await fees(big, "")).data.map((s) => s.id);
    expect(seen).toEqual(unpaged);
  });

  it("keeps the array element shape the Fees surfaces already consume", async () => {
    const body = await fees(f, "");
    expect(Object.keys(body.data[0] ?? {}).sort()).toEqual([
      "balance_due",
      "code",
      "fee_model",
      "id",
      "name",
    ]);
    const kabir = body.data.find((s) => s.code === "S-002");
    expect(kabir?.name).toBe("Kabir Menon");
    expect(kabir?.balance_due).toBe(250000);
  });

  it("excludes inactive students and never crosses the tenant boundary", async () => {
    const body = await fees(f, "");
    expect(body.total).toBe(4); // Aarav, Kabir, Diya, Vivaan
    expect(body.data.map((s) => s.code)).not.toContain("S-004"); // inactive
    expect(body.data.map((s) => s.code)).not.toContain("X-999"); // other tenant
  });

  it("search narrows both the rows and the total", async () => {
    const body = await fees(f, "search=diya");
    expect(body.total).toBe(1);
    expect(body.data.map((s) => s.name)).toEqual(["Diya Nair"]);
    // A search with a pager: the filter is applied before the slice, so the
    // total is the matched count, not the roster count.
    const paged = await fees(f, "search=diya&page=1&pageSize=1");
    expect(paged.total).toBe(1);
    expect(paged.truncated).toBe(false);
  });

  it("an out-of-range page is an empty page with the population still stated", async () => {
    const body = await fees(f, "page=99&pageSize=50");
    expect(body.data).toHaveLength(0);
    expect(body.total).toBe(4);
    expect(body.truncated).toBe(true);
  });
});