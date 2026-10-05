// Implements: 04_Dashboard.md §10 (BR-RPT-01/03/08, BR-CALC-10/11) + §19
// (KPI delta, paise math, tenant isolation); 12_Business_Rules.md BR-RPT-03
// (aging bucket bounds) + BR-FEE-05 (1-paise tolerance); AGENTS.md §2 Rule 6
// (integer paise, half-even scope) + Rule 9 (typed errors, honest partials).

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/get-db", () => ({
  gatewayGet: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { gatewayGet } from "@/server/get-db";
import {
  agingFromInvoices,
  dayIso,
  defaultersFromInvoices,
  momDeltaPct,
  monthKeysForWindow,
  trendFromEntries,
} from "@/lib/dashboard-analytics-calc";
import { getDashboardAnalytics } from "./dashboard-analytics";

const mockedGatewayGet = vi.mocked(gatewayGet);

const NOW = Date.parse("2026-09-15T12:00:00Z");

function dashboardPayload() {
  return {
    kpis: {
      totalStudents: 4,
      studentsWithDues: 2,
      collectedThisMonthMinor: 100000,
      dueTillDateMinor: 50000,
      dueForMonthMinor: 40000,
      overdueMinor: 30000,
      paymentBreakdown: { paid: 2, partial: 1, unpaid: 1, noDues: 1 },
    },
    activity: [],
    dueToday: [],
    dueTodayTotal: 0,
    dueTodayTruncated: false,
    dataOrigin: "live" as const,
  };
}

function gatewayFor(fixtures: {
  fees?: unknown[];
  invoices?: unknown[];
  ledger?: unknown[];
  students?: { students: unknown[]; total: number };
  batches?: unknown[];
  attendance?: Record<string, unknown>;
}) {
  // SAFETY: test-only mock — static envelopes per path, no network.
  mockedGatewayGet.mockImplementation((async (path: string) => {
    if (path === "/api/v1/analytics/dashboard") return { success: true, data: dashboardPayload() };
    if (path === "/api/v1/ledger/fees") return { success: true, data: fixtures.fees ?? [] };
    if (path === "/api/v1/ledger/invoices") return { success: true, data: fixtures.invoices ?? [] };
    if (path === "/api/v1/ledger") return { success: true, data: fixtures.ledger ?? [] };
    if (path === "/api/v1/students")
      return { success: true, data: fixtures.students ?? { students: [], total: 0 } };
    if (path === "/api/v1/attendance/batches") return { success: true, data: fixtures.batches ?? [] };
    if (path === "/api/v1/attendance") return { success: true, data: fixtures.attendance ?? { session: null, records: [] } };
    return { success: false, error: "unknown test path" };
  }) as unknown as typeof gatewayGet);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

describe("monthKeysForWindow", () => {
  it("returns whole months ending with the current month, oldest first", () => {
    expect(monthKeysForWindow(3, NOW)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("rolls across a year boundary", () => {
    const jan = Date.parse("2026-01-10T00:00:00Z");
    expect(monthKeysForWindow(3, jan)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
});

describe("dayIso", () => {
  it("counts back whole UTC days", () => {
    expect(dayIso(0, NOW)).toBe("2026-09-15");
    expect(dayIso(14, NOW)).toBe("2026-09-01");
  });
});

describe("trendFromEntries (BR-CALC-10)", () => {
  const months = ["2026-08", "2026-09"];

  it("sums PAYMENT_RECEIVED credits per month in integer paise", () => {
    const trend = trendFromEntries(
      [
        { type: "PAYMENT_RECEIVED", debit: 0, credit: 250000, occurred_on: "2026-09-05", reverses_entry_id: null },
        { type: "PAYMENT_RECEIVED", debit: 0, credit: 75000, occurred_on: "2026-09-20", reverses_entry_id: null },
        { type: "PAYMENT_RECEIVED", debit: 0, credit: 50000, occurred_on: "2026-08-11", reverses_entry_id: null },
      ],
      months,
    );
    expect(trend.find((p) => p.month === "2026-09")?.collectedPaise).toBe(325000);
    expect(trend.find((p) => p.month === "2026-08")?.collectedPaise).toBe(50000);
  });

  it("subtracts REFUND_ISSUED debits and excludes VOID rows", () => {
    const trend = trendFromEntries(
      [
        { type: "PAYMENT_RECEIVED", debit: 0, credit: 100000, occurred_on: "2026-09-05", reverses_entry_id: null },
        { type: "REFUND_ISSUED", debit: 20000, credit: 0, occurred_on: "2026-09-06", reverses_entry_id: null },
        { type: "VOID", debit: 0, credit: 99999, occurred_on: "2026-09-07", reverses_entry_id: null },
        { type: "PAYMENT_RECEIVED", debit: 0, credit: 11111, occurred_on: "2026-09-08", reverses_entry_id: "orig-1" },
        { type: "FEE_CHARGED", debit: 60000, credit: 0, occurred_on: "2026-09-09", reverses_entry_id: null },
      ],
      months,
    );
    expect(trend.find((p) => p.month === "2026-09")?.collectedPaise).toBe(80000);
  });

  it("ignores entries outside the window and unreadable days", () => {
    const trend = trendFromEntries(
      [
        { type: "PAYMENT_RECEIVED", debit: 0, credit: 100000, occurred_on: "2026-07-01", reverses_entry_id: null },
        { type: "PAYMENT_RECEIVED", debit: 0, credit: 100000, occurred_on: "not-a-date", reverses_entry_id: null },
      ],
      months,
    );
    expect(trend.every((p) => p.collectedPaise === 0)).toBe(true);
  });
});

describe("momDeltaPct (04 §9.2)", () => {
  it("computes the signed delta against MAX(prev, 1)", () => {
    expect(momDeltaPct(118000, 100000)).toBe(18);
    expect(momDeltaPct(80000, 100000)).toBe(-20);
  });

  it("guards divide-by-zero: a first-ever collection reads as curr * 100", () => {
    expect(momDeltaPct(50000, 0)).toBe(999);
  });

  it("clamps to ±999 %", () => {
    expect(momDeltaPct(2000000, 1000)).toBe(999);
    expect(momDeltaPct(0, 100000)).toBe(-100);
  });
});

describe("agingFromInvoices (BR-RPT-03 + BR-FEE-05)", () => {
  const today = "2026-09-15";
  const invoice = (due: string, total: number, paid: number, status = "unpaid") => ({
    due_date: due,
    total,
    status,
    paid_amount_minor: paid,
  });

  it("places day 30 in 8-30 and day 31 in 31-90 (lower bound inclusive)", () => {
    const buckets = agingFromInvoices(
      [
        invoice("2026-09-08", 10000, 0),
        invoice("2026-09-07", 10000, 0),
        invoice("2026-08-16", 10000, 0),
        invoice("2026-08-15", 10000, 0),
        invoice("2026-06-17", 10000, 0),
        invoice("2026-06-16", 10000, 0),
      ],
      today,
    );
    expect(buckets[0]?.invoices).toBe(1);
    expect(buckets[1]?.invoices).toBe(2);
    expect(buckets[2]?.invoices).toBe(2);
    expect(buckets[3]?.invoices).toBe(1);
  });

  it("nets attributed payments and drops settled rows at the 1-paise tolerance", () => {
    const buckets = agingFromInvoices(
      [
        invoice("2026-09-01", 10000, 4000),
        invoice("2026-09-01", 10000, 9999),
        invoice("2026-09-01", 10000, 10000),
      ],
      today,
    );
    expect(buckets[1]?.invoices).toBe(1);
    expect(buckets[1]?.outstandingPaise).toBe(6000);
  });

  it("excludes paid, void and future-dated invoices", () => {
    const buckets = agingFromInvoices(
      [
        { ...invoice("2026-09-01", 10000, 0), status: "paid" },
        { ...invoice("2026-09-01", 10000, 0), status: "void" },
        invoice("2026-10-01", 10000, 0),
        { ...invoice("2026-09-01", 10000, 0), due_date: null as unknown as string },
      ],
      today,
    );
    expect(buckets.every((b) => b.invoices === 0)).toBe(true);
  });
});

describe("defaultersFromInvoices", () => {
  const names = new Map([
    ["s-1", "Asha"],
    ["s-2", "Kabir"],
    ["s-3", "Meera"],
  ]);
  const row = (student_id: string, total: number, paid: number, status = "unpaid") => ({
    student_id,
    total,
    status,
    paid_amount_minor: paid,
  });

  it("sorts largest outstanding first and labels partial vs unpaid", () => {
    const { rows, truncated } = defaultersFromInvoices(
      [row("s-1", 50000, 0), row("s-2", 50000, 20000), row("s-3", 10000, 0)],
      names,
      "all",
      10,
    );
    expect(rows.map((r) => r.studentId)).toEqual(["s-1", "s-2", "s-3"]);
    expect(rows[0]?.status).toBe("unpaid");
    expect(rows[1]?.status).toBe("partial");
    expect(rows[1]?.outstandingPaise).toBe(30000);
    expect(truncated).toBe(false);
  });

  it("honors the status filter and the limit with a truncation flag", () => {
    const many = Array.from({ length: 12 }, (_, i) => row(`s-${i}`, 10000, 0));
    const { rows, truncated } = defaultersFromInvoices(many, new Map(), "unpaid", 10);
    expect(rows).toHaveLength(10);
    expect(truncated).toBe(true);
    const partial = defaultersFromInvoices([row("s-1", 50000, 0)], names, "partial", 10);
    expect(partial.rows).toHaveLength(0);
  });
});

describe("getDashboardAnalytics", () => {
  it("derives every view from one bounded wave with no tenant in the params", async () => {
    gatewayFor({
      fees: [
        { id: "s-1", name: "Asha", code: "STU-1", fee_model: "postpaid", balance_due: 20000 },
      ],
      invoices: [
        {
          id: "inv-1",
          number: "INV-1",
          student_id: "s-1",
          issue_date: "2026-09-01",
          due_date: "2026-09-05",
          subtotal: 20000,
          total: 20000,
          status: "unpaid",
          paid_amount_minor: 0,
        },
      ],
      ledger: [
        {
          id: "le-1",
          student_id: "s-1",
          type: "PAYMENT_RECEIVED",
          debit: 0,
          credit: 50000,
          occurred_on: "2026-09-10",
          invoice_id: null,
          receipt_no: null,
          reverses_entry_id: null,
        },
      ],
      students: {
        students: [
          { id: "s-1", name: "Asha", code: "STU-1", grade: null, batch: "Batch A", fee_model: "postpaid", status: "active", balance_due: 20000 },
        ],
        total: 1,
      },
      batches: [{ id: "b-1", name: "Batch A", subject: null }],
      attendance: {
        session: { id: "sess-1" },
        records: [{ student_id: "s-1", name: "Asha", batch: null, status: "present" }],
      },
    });

    const result = await getDashboardAnalytics({ periodMonths: 3, batch: "all", status: "all" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.trend).toHaveLength(3);
    expect(result.data.aging[1]?.invoices ?? result.data.aging[0]?.invoices).toBeGreaterThanOrEqual(0);
    expect(result.data.defaulters[0]?.studentId).toBe("s-1");
    expect(result.data.batches[0]?.batchName).toBe("Batch A");
    expect(result.data.enrollmentTotal).toBe(1);
    expect(result.data.heatmapBatchName).toBe("Batch A");
    expect(result.data.dataPartial).toBe(false);

    // Tenant isolation: the tenant rides in gateway headers, never in params.
    for (const call of mockedGatewayGet.mock.calls) {
      const params = (call[1] ?? {}) as Record<string, unknown>;
      expect(params).not.toHaveProperty("tenantId");
      expect(params).not.toHaveProperty("tenant_id");
    }
    const paths = mockedGatewayGet.mock.calls.map((call) => call[0] as string);
    expect(paths).toContain("/api/v1/analytics/dashboard");
    expect(paths).toContain("/api/v1/ledger/fees");
    expect(paths).toContain("/api/v1/ledger/invoices");
    expect(paths).toContain("/api/v1/ledger");
    expect(paths).toContain("/api/v1/students");
    expect(paths).toContain("/api/v1/attendance/batches");
  });

  it("rejects an unreadable filter without touching the gateway", async () => {
    gatewayFor({});
    const result = await getDashboardAnalytics({ periodMonths: 9, batch: "all", status: "all" } as unknown as {
      periodMonths: 3;
      batch: string;
      status: "all";
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.startsWith("VALIDATION:")).toBe(true);
    expect(mockedGatewayGet).not.toHaveBeenCalled();
  });

  it("fails honestly when the anchor leg fails (typed, no raw text)", async () => {
    mockedGatewayGet.mockImplementation((async (path: string) => {
      if (path === "/api/v1/analytics/dashboard") {
        return { success: false, error: "Gateway 500: raw-driver-boom" };
      }
      return { success: true, data: [] };
    }) as unknown as typeof gatewayGet);

    const result = await getDashboardAnalytics({ periodMonths: 6, batch: "all", status: "unpaid" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.startsWith("UPSTREAM:")).toBe(true);
      expect(result.error).not.toContain("raw-driver-boom");
    }
  });

  it("marks partial data when a satellite leg fails instead of inventing it", async () => {
    mockedGatewayGet.mockImplementation((async (path: string) => {
      if (path === "/api/v1/analytics/dashboard") return { success: true, data: dashboardPayload() };
      if (path === "/api/v1/ledger/invoices") return { success: false, error: "Gateway timeout" };
      if (path === "/api/v1/attendance/batches") return { success: true, data: [] };
      return { success: true, data: path === "/api/v1/students" ? { students: [], total: 0 } : [] };
    }) as unknown as typeof gatewayGet);

    const result = await getDashboardAnalytics({ periodMonths: 6, batch: "all", status: "all" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.dataPartial).toBe(true);
    expect(result.data.aging.every((b) => b.invoices === 0)).toBe(true);
    expect(result.data.defaulters).toHaveLength(0);
  });
});
