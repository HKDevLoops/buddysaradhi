// Implements: 04_Dashboard.md §18 (screen-reader labels, text equivalents,
// touch targets) + §19.2 (component tests); 13_UI_Guidelines.md §10;
// AGENTS.md §2 Rule 10 (44px targets, charts need text equivalents).

import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/server/actions/dashboard", () => ({
  fetchDashboardAnalyticsAction: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { fetchDashboardAnalyticsAction } from "@/server/actions/dashboard";
import {
  DashboardAnalyticsSection,
  analyticsFilename,
  buildAgingCsv,
  buildDefaultersCsv,
  buildTrendCsv,
  csvCell,
  rupeesFromPaise,
} from "./dashboard-analytics";
import type { DashboardAnalytics } from "@/server/queries/dashboard-analytics";

const fetchAnalytics = vi.mocked(fetchDashboardAnalyticsAction);

function fixture(): DashboardAnalytics {
  return {
    generatedAt: "2026-09-15T12:00:00.000Z",
    periodLabel: "Last 6 months",
    trend: [
      { month: "2026-08", label: "Aug 26", collectedPaise: 50000 },
      { month: "2026-09", label: "Sep 26", collectedPaise: 150000 },
    ],
    collectedTotalPaise: 200000,
    momDeltaPct: 200,
    momCurrentPaise: 150000,
    momPrevPaise: 50000,
    efficiencyPct: 80,
    efficiencyCollectedPaise: 200000,
    efficiencyOutstandingPaise: 50000,
    aging: [
      { id: "d0_7", label: "Due within 7 days", invoices: 1, outstandingPaise: 10000 },
      { id: "d8_30", label: "8 to 30 days overdue", invoices: 0, outstandingPaise: 0 },
      { id: "d31_90", label: "31 to 90 days overdue", invoices: 1, outstandingPaise: 40000 },
      { id: "d90_plus", label: "Over 90 days overdue", invoices: 0, outstandingPaise: 0 },
    ],
    defaulters: [
      { studentId: "s-1", name: "Asha Menon", status: "unpaid", outstandingPaise: 40000 },
    ],
    defaultersTruncated: false,
    batches: [{ batchId: "b-1", batchName: "Batch A", students: 2, collectedPaise: 150000, duesPaise: 40000 }],
    batchNames: [{ id: "b-1", name: "Batch A" }],
    heatmapBatchId: "b-1",
    heatmapBatchName: "Batch A",
    heatmapDates: ["2026-09-14", "2026-09-15"],
    heatmap: [
      { date: "2026-09-14", studentId: "s-1", studentName: "Asha Menon", status: "present" },
      { date: "2026-09-15", studentId: "s-1", studentName: "Asha Menon", status: "absent" },
    ],
    heatmapPartial: false,
    enrollment: [
      { status: "active", students: 3 },
      { status: "inactive", students: 1 },
    ],
    enrollmentTotal: 4,
    paymentBreakdown: { paid: 2, partial: 1, unpaid: 1, noDues: 1 },
    dataPartial: false,
    sourceNotes: [],
  };
}

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DashboardAnalyticsSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DashboardAnalyticsSection", () => {
  it("renders all eight panels with text equivalents for every chart", async () => {
    fetchAnalytics.mockResolvedValue({ ok: true, value: fixture() });
    renderSection();

    // Wait for the data branch (panel headings exist only after the read
    // resolves; the section heading renders in the loading branch too).
    // Generous timeout: the full-suite run shares workers and can be slow.
    await waitFor(
      () => {
        expect(screen.getByRole("heading", { name: "Fee collection trend" })).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    for (const heading of [
      "Fee collection trend",
      "Dues aging",
      "Month over month",
      "Collection efficiency",
      "Who owes the most",
      "Batch performance",
      "Enrollment funnel",
      "Attendance heatmap",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    // Text equivalents: amounts and statuses readable without the chart.
    // (200000 paise renders as ₹2,000.00 via formatINR.)
    expect(screen.getByText(/Collected ₹2,000\.00/)).toBeInTheDocument();
    expect(screen.getAllByText("Asha Menon").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/P present/)).toBeInTheDocument();
  });

  it("labels every export button and keeps 44px targets", async () => {
    fetchAnalytics.mockResolvedValue({ ok: true, value: fixture() });
    renderSection();

    await waitFor(
      () => {
        expect(screen.getByRole("heading", { name: "Dues aging" })).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    const exports = screen.getAllByRole("button", { name: /Download .* as CSV/ });
    expect(exports.length).toBeGreaterThanOrEqual(8);
    for (const button of exports) {
      expect(button.className).toContain("min-h-[44px]");
      expect(button.className).toContain("min-w-[44px]");
    }
  });

  it("renders an honest error state instead of zeroed charts on failure", async () => {
    fetchAnalytics.mockResolvedValue({
      ok: false,
      code: "DASHBOARD_ANALYTICS_FAILED",
      error: "UPSTREAM: database request failed",
    });
    renderSection();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Business analytics" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "Fee collection trend" })).not.toBeInTheDocument();
  });

  it("downloads the filtered trend CSV with the period in the filename", async () => {
    fetchAnalytics.mockResolvedValue({ ok: true, value: fixture() });
    const createUrl = vi.fn(() => "blob:mock");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    const click = vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderSection();

    await waitFor(
      () => {
        expect(screen.getByRole("heading", { name: "Fee collection trend" })).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Download collection trend as CSV" }));

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    click.mockRestore();
  });
});

describe("analytics CSV helpers", () => {
  it("quotes cells and doubles inner quotes", () => {
    expect(csvCell('Batch "A", morning')).toBe('"Batch ""A"", morning"');
  });

  it("converts paise to plain rupee decimals with integer math only", () => {
    expect(rupeesFromPaise(125555)).toBe("1255.55");
    expect(rupeesFromPaise(100)).toBe("1.00");
    expect(rupeesFromPaise(0)).toBe("0.00");
    expect(rupeesFromPaise(-250)).toBe("-2.50");
  });

  it("names files dashboard-<view>-<period>[-<batch>].csv", () => {
    expect(analyticsFilename("collection-trend", 6, null)).toBe(
      "dashboard-collection-trend-last-6-months.csv",
    );
    expect(analyticsFilename("defaulters", 3, "Batch A")).toBe(
      "dashboard-defaulters-last-3-months-batch-a.csv",
    );
  });

  it("builds trend and aging CSVs from view rows", () => {
    const trend = buildTrendCsv(fixture().trend);
    expect(trend.split("\r\n")[0]).toBe('"Month","Collected (paise)","Collected (INR)"');
    expect(trend).toContain('"Sep 26","150000","1500.00"');

    const aging = buildAgingCsv(fixture().aging);
    expect(aging).toContain('"31 to 90 days overdue","1","40000","400.00"');

    const defaulters = buildDefaultersCsv(fixture().defaulters);
    expect(defaulters).toContain('"Asha Menon","unpaid","40000","400.00"');
  });
});
