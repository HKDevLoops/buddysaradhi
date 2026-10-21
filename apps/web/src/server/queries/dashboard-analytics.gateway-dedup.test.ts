// Implements: 04_Dashboard.md §6.2 (C1..C6 read from ONE gateway summary) and
// §9 (the client never recomputes a financial measure); 12_Business_Rules.md
// BR-RPT-08 (collected in the period); AGENTS.md §2 Rule 9 (one honest read, no
// silent failure), §3.4 (no direct DB path — the gateway is the seam) and
// §3.5 (one implementation of a rule).
//
// PERF-3.3 — THE DASHBOARD MUST READ THE MOST EXPENSIVE ROUTE ONCE.
//
// `/api/v1/analytics/dashboard` is the most expensive route in the product:
// measured at p50 467 ms, p95 995 ms, p99 1184 ms for the default window,
// with 3,690 rows and 2.4 MB of JSON materialised into JavaScript per call
// (audit M15, docs/audit/DYNAMIC-PERFORMANCE.md §P0-2).
//
// TWO CALL SITES REACHED IT. `fetchDashboardSummaryAction`
// (`server/actions/dashboard.ts`) called `gatewayGet` directly and was NOT
// memoised; `server/queries/dashboard-analytics.ts` reached the same endpoint
// from inside React's `cache()`. Two call sites, one route, one render →
// 2 × 214–1184 ms of gateway work on every dashboard view (M46).
//
// THE FIX HAS TWO HALVES, AND THIS FILE PROVES BOTH:
//   1. one shared, per-request-memoised read (`getDashboardSummary`), and
//   2. the two callers asking it for the SAME WINDOW — because the memo is
//      keyed by its arguments, a shared function with two different windows is
//      still two reads.
//
// WHY `react` IS MOCKED HERE, AND WHY THE MOCK IS FAITHFUL.
// React's `cache()` is a NO-OP in the client build —
//   node_modules/react/cjs/react.development.js
//     exports.cache = function (fn) { return function () { return fn.apply(null, arguments); }; };
// — and a per-request memo in the react-server build —
//   node_modules/react/cjs/react.react-server.development.js:575
//     var dispatcher = ReactSharedInternals.A; ... dispatcher.getCacheForType(createCacheRoot)
// — which Next's RSC renderer installs for the life of a request:
//   next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-server.node.development.js:1106
//     ReactSharedInternalsServer.A = DefaultAsyncDispatcher;
//
// A jsdom test loads the CLIENT build, so the production memo is invisible to
// it. The mock below restores the production semantics — memoise by
// (function, arguments) for the life of the module registry — so the collapse
// this file asserts is the collapse that happens in production, not a
// property of the mock. `vi.resetModules()` gives each test a fresh registry,
// which is the test's "new request".

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/server/get-db", () => ({
  gatewayGet: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    /**
     * The react-server `cache()` semantics: one call per (function, arguments)
     * for the life of the request. See the file header for the three source
     * lines that prove the production behaviour this stands in for.
     */
    cache: <T extends (...args: never[]) => unknown>(fn: T) => {
      const store = new Map<string, unknown>();
      const memo = (...args: unknown[]) => {
        const key = JSON.stringify(args);
        if (!store.has(key)) store.set(key, fn(...args as never[]));
        return store.get(key);
      };
      return memo as unknown as T;
    },
  };
});

const NOW = Date.parse("2026-09-15T12:00:00Z");

/** The gateway's dashboard payload — the shape both boundaries accept. */
function dashboardPayload() {
  return {
    kpis: {
      totalStudents: 4,
      studentsWithDues: 2,
      collectedThisMonthMinor: 100000,
      dueTillDateMinor: 50000,
      dueForMonthMinor: 40000,
      overdueMinor: 30000,
      paymentBreakdown: { paid: 2, partial: 1, unpaid: 1 },
    },
    activity: [],
    dueToday: [],
    dueTodayTotal: 0,
    dueTodayTruncated: false,
    dataOrigin: "live" as const,
  };
}

/**
 * A fresh module registry per test — the test's "new request". The memo above
 * is scoped to the registry, so two tests never share a read.
 */
async function loadDashboard() {
  vi.resetModules();
  const { gatewayGet } = await import("@/server/get-db");
  const { fetchDashboardSummaryAction } = await import("@/server/actions/dashboard");
  const { getDashboardAnalytics } = await import("@/server/queries/dashboard-analytics");
  return {
    gatewayGet: vi.mocked(gatewayGet),
    fetchDashboardSummaryAction,
    getDashboardAnalytics,
  };
}

/** The calls this render made to the dashboard route, with their windows. */
function dashboardCalls(calls: unknown[][]) {
  return calls
    .filter((call) => call[0] === "/api/v1/analytics/dashboard")
    .map((call) => call[1] as Record<string, unknown>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

describe("PERF-3.3 — the dashboard reads /api/v1/analytics/dashboard ONCE", () => {
  it("the KPI strip's summary and the analytics anchor share one gateway read", async () => {
    const { gatewayGet, fetchDashboardSummaryAction, getDashboardAnalytics } = await loadDashboard();
    gatewayGet.mockImplementation((async (path: string) => {
      if (path === "/api/v1/analytics/dashboard") return { success: true, data: dashboardPayload() };
      if (path === "/api/v1/students") return { success: true, data: { students: [], total: 0 } };
      return { success: true, data: [] };
    }) as unknown as typeof gatewayGet);

    // The server render: the route prefetches BOTH legs (see
    // `app/(app)/dashboard/page.tsx` → `ScreenData`, which fires them in
    // parallel), so they share one request — and therefore one memo.
    const summary = await fetchDashboardSummaryAction({ mode: "month", start: null, end: null });
    const analytics = await getDashboardAnalytics({ periodMonths: 6, batch: "all", status: "all" });

    expect(summary.ok).toBe(true);
    expect(analytics.success).toBe(true);

    // THE ASSERTION. One route, one call — not two calls that happen to share
    // a function.
    const calls = dashboardCalls(gatewayGet.mock.calls as unknown[][]);
    expect(calls).toHaveLength(1);

    // And the call carries the window BOTH legs asked for: the default
    // dashboard period (the calendar month), because the anchor's only
    // consumed field — `paymentBreakdown` — is period-independent on the
    // gateway side.
    expect(calls[0]).toEqual({ periodStartIso: "2026-09-01", periodEndIso: "2026-09-15" });
  });

  it("both legs ask for the same window, whichever analytics period is selected", async () => {
    const { gatewayGet, fetchDashboardSummaryAction, getDashboardAnalytics } = await loadDashboard();
    gatewayGet.mockImplementation((async (path: string) => {
      if (path === "/api/v1/analytics/dashboard") return { success: true, data: dashboardPayload() };
      if (path === "/api/v1/students") return { success: true, data: { students: [], total: 0 } };
      return { success: true, data: [] };
    }) as unknown as typeof gatewayGet);

    await fetchDashboardSummaryAction({ mode: "month", start: null, end: null });
    // 12 months back is the widest analytics window. The anchor must NOT widen
    // with it: the window is unobservable in the payload, and a wider window
    // would make the gateway's period read more expensive for nothing.
    await getDashboardAnalytics({ periodMonths: 12, batch: "all", status: "all" });

    const calls = dashboardCalls(gatewayGet.mock.calls as unknown[][]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ periodStartIso: "2026-09-01", periodEndIso: "2026-09-15" });
  });

  it("a tutor-chosen period still gets its own window — the memo is keyed by it", async () => {
    const { gatewayGet, fetchDashboardSummaryAction } = await loadDashboard();
    gatewayGet.mockImplementation((async (path: string) => {
      if (path === "/api/v1/analytics/dashboard") return { success: true, data: dashboardPayload() };
      return { success: true, data: [] };
    }) as unknown as typeof gatewayGet);

    await fetchDashboardSummaryAction({ mode: "all", start: null, end: null });

    // "All time" is the tutor's own window (`ALL_TIME_START_ISO`), and it is a
    // DIFFERENT read from the default month — the memo must not answer it with
    // the month figure.
    const calls = dashboardCalls(gatewayGet.mock.calls as unknown[][]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ periodStartIso: "1970-01-01", periodEndIso: "2026-09-15" });
  });

  it("a failed read fails BOTH legs — one failure, one honest surface", async () => {
    const { gatewayGet, fetchDashboardSummaryAction, getDashboardAnalytics } = await loadDashboard();
    gatewayGet.mockImplementation((async (path: string) => {
      if (path === "/api/v1/analytics/dashboard") {
        return { success: false, error: "Gateway 500: raw-driver-boom" };
      }
      return { success: true, data: [] };
    }) as unknown as typeof gatewayGet);

    const summary = await fetchDashboardSummaryAction({ mode: "month", start: null, end: null });
    const analytics = await getDashboardAnalytics({ periodMonths: 6, batch: "all", status: "all" });

    // The KPI strip refuses to show zeroes (Rule 9) and the analytics read
    // refuses to invent a panel — one gateway failure, two honest surfaces.
    expect(summary.ok).toBe(false);
    if (!summary.ok) expect(summary.code).toBe("DASHBOARD_GATEWAY_FAILED");
    expect(analytics.success).toBe(false);
    if (!analytics.success) {
      expect(analytics.error.startsWith("UPSTREAM:")).toBe(true);
      expect(analytics.error).not.toContain("raw-driver-boom");
    }
  });
});
