// Implements: 04_Dashboard.md §6.2 (analytics panels derived from the dashboard
// read) + §10 (BR-RPT-01/03/08, BR-CALC-07/08/10/11) + §18 (contrast, focus,
// keyboard, reduced motion, 44px targets, color never the only signal);
// 13_UI_Guidelines.md §8.12 (heatmap cell), §8.13 (bar chart), §8.19/8.20
// (empty state, skeleton), §10 (accessibility); AGENTS.md §2 Rule 6 (paise via
// formatINR, integer CSV math), Rule 10 (text equivalents for every chart).
//
// READ-ONLY. Every figure renders `DashboardAnalytics` rows fetched once by
// `fetchDashboardAnalyticsAction` and never recomputes money: CSV export
// serializes the already-fetched view data with no new server roundtrip.
// Charts are hand-built divs/SVG (no chart dependency). All motion is static
// rendering, so `prefers-reduced-motion` is honored by construction; the
// loading shimmer is `motion-reduce:animate-none`.
//
// ENERGY 2, RHYTHM 2, MOTION 1: one focal point (the collection trend), one
// deliberate accent (emerald for money in), structural whitespace between
// panels. Copy addresses the tutor (P1), states exact paise-derived amounts
// (Rule 6), and never approximates.

"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock3, Download, XCircle } from "lucide-react";
import { formatINR } from "@buddysaradhi/shared";
import { cn } from "@/lib/utils";
import { ErrorState } from "@/components/ui/screen-state";
import { toAppErrorState } from "@/lib/app-errors";
import { useToast } from "@/components/ui/toast";
import { log } from "@/lib/logger";
import {
  fetchDashboardAnalyticsAction,
} from "@/server/actions/dashboard";
import type {
  AgingBucket,
  BatchPerfRow,
  DashboardAnalytics,
  DefaulterRow,
  EnrollmentSlice,
  HeatmapCell,
  TrendPoint,
} from "@/server/queries/dashboard-analytics";

/* ------------------------------------------------------------------ *
 * Pure CSV helpers (exported for unit tests — no browser, no I/O)
 * ------------------------------------------------------------------ */

/** Quote every cell and double inner quotes — the one escaping rule Excel accepts. */
export function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Integer paise to a plain decimal rupee string for the spreadsheet cell.
 * Same contract as the roster export: `formatINR` is for the screen
 * ("₹1,250.00" is neither spreadsheet- nor accounting-software-friendly), so
 * the CSV gets a bare number from integer arithmetic only, never `paise / 100`.
 */
export function rupeesFromPaise(paise: number): string {
  const rounded = Math.round(paise);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 100);
  const frac = abs - whole * 100;
  return `${negative ? "-" : ""}${whole}.${String(frac).padStart(2, "0")}`;
}

function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned === "" ? "view" : cleaned;
}

/**
 * `dashboard-<view>-<period>[-<batch>].csv`: the period and batch the tutor
 * was looking at are in the filename, so a downloaded file can never be
 * mistaken for an unfiltered one.
 */
export function analyticsFilename(
  view: string,
  periodMonths: number,
  batchName: string | null,
): string {
  const period = `last-${periodMonths}-months`;
  const batch = batchName === null ? "" : `-${slug(batchName)}`;
  return `dashboard-${slug(view)}-${period}${batch}.csv`;
}

export function buildTrendCsv(trend: TrendPoint[]): string {
  const lines = [["Month", "Collected (paise)", "Collected (INR)"].map(csvCell).join(",")];
  for (const point of trend) {
    lines.push(
      [point.label, String(Math.round(point.collectedPaise)), rupeesFromPaise(point.collectedPaise)]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export function buildAgingCsv(buckets: AgingBucket[]): string {
  const lines = [
    ["Age bucket", "Invoices", "Outstanding (paise)", "Outstanding (INR)"].map(csvCell).join(","),
  ];
  for (const bucket of buckets) {
    lines.push(
      [
        bucket.label,
        String(bucket.invoices),
        String(Math.round(bucket.outstandingPaise)),
        rupeesFromPaise(bucket.outstandingPaise),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export function buildDefaultersCsv(rows: DefaulterRow[]): string {
  const lines = [
    ["Student", "Status", "Outstanding (paise)", "Outstanding (INR)"].map(csvCell).join(","),
  ];
  for (const row of rows) {
    lines.push(
      [
        row.name,
        row.status,
        String(Math.round(row.outstandingPaise)),
        rupeesFromPaise(row.outstandingPaise),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export function buildBatchCsv(rows: BatchPerfRow[]): string {
  const lines = [
    ["Batch", "Students", "Collected (paise)", "Collected (INR)", "Dues (paise)", "Dues (INR)"]
      .map(csvCell)
      .join(","),
  ];
  for (const row of rows) {
    lines.push(
      [
        row.batchName,
        String(row.students),
        String(Math.round(row.collectedPaise)),
        rupeesFromPaise(row.collectedPaise),
        String(Math.round(row.duesPaise)),
        rupeesFromPaise(row.duesPaise),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export function buildEnrollmentCsv(rows: EnrollmentSlice[]): string {
  const lines = [["Status", "Students"].map(csvCell).join(",")];
  for (const row of rows) {
    lines.push([row.status, String(row.students)].map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

export function buildHeatmapCsv(cells: HeatmapCell[]): string {
  const lines = [["Date", "Student", "Status"].map(csvCell).join(",")];
  for (const cell of cells) {
    lines.push(
      [cell.date, cell.studentName, cell.status ?? "no session"].map(csvCell).join(","),
    );
  }
  return lines.join("\r\n");
}

/** Client-side download of already-fetched view data: Blob, anchor click, revoke. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ *
 * Small presentational pieces
 * ------------------------------------------------------------------ */

function ExportButton({
  label,
  onExport,
}: {
  label: string;
  onExport: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExport}
      aria-label={label}
      title={label}
      className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center gap-2 rounded-xl text-xs font-semibold text-[var(--text-muted)] border border-[var(--border-default)] bg-[var(--surface-inset)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--info)]/30 focus-visible:outline-2 focus-visible:outline-[var(--accent-cyan)]"
    >
      <Download className="w-4 h-4" aria-hidden="true" />
      <span className="hidden sm:inline">CSV</span>
    </button>
  );
}

function Panel({
  title,
  caption,
  exportLabel,
  onExport,
  summary,
  children,
}: {
  title: string;
  caption: string;
  exportLabel: string;
  onExport: () => void;
  /** Plain-language text equivalent of the chart (Rule 10). */
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="glass-panel rounded-xl p-5 sm:p-6 flex flex-col gap-3" aria-label={title}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{caption}</p>
        </div>
        <ExportButton label={exportLabel} onExport={onExport} />
      </div>
      {children}
      <figcaption className="text-xs text-[var(--text-muted)] leading-relaxed">{summary}</figcaption>
    </figure>
  );
}

function SkeletonPanel({ label }: { label: string }) {
  return (
    <div
      className="glass-panel rounded-xl p-5 sm:p-6 flex flex-col gap-3"
      aria-busy="true"
      aria-label={`Loading ${label}`}
    >
      <div className="h-4 w-1/2 rounded bg-[var(--surface-inset)] animate-pulse motion-reduce:animate-none" />
      <div className="h-28 rounded bg-[var(--surface-inset)] animate-pulse motion-reduce:animate-none" />
      <div className="h-3 w-3/4 rounded bg-[var(--surface-inset)] animate-pulse motion-reduce:animate-none" />
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-8 gap-1">
      <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
      <p className="text-xs text-[var(--text-muted)] max-w-[28ch]">{body}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Section
 * ------------------------------------------------------------------ */

const PERIOD_OPTIONS = [3, 6, 12] as const;
type PeriodMonths = (typeof PERIOD_OPTIONS)[number];

const STATUS_OPTIONS = [
  { value: "all", label: "All dues" },
  { value: "partial", label: "Partial" },
  { value: "unpaid", label: "Unpaid" },
] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number]["value"];

const STATUS_META: Record<DefaulterRow["status"], { label: string; accent: string; Icon: typeof Clock3 }> = {
  partial: { label: "Partial", accent: "var(--warning)", Icon: Clock3 },
  unpaid: { label: "Unpaid", accent: "var(--danger)", Icon: XCircle },
  paid: { label: "Paid", accent: "var(--success)", Icon: CheckCircle2 },
};

export function DashboardAnalyticsSection() {
  const [periodMonths, setPeriodMonths] = React.useState<PeriodMonths>(6);
  const [batch, setBatch] = React.useState<string>("all");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const toast = useToast();

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["dashboard", "analytics", periodMonths, batch, status],
    queryFn: async () => {
      const res = await fetchDashboardAnalyticsAction({ periodMonths, batch, status });
      if (!res.ok) throw new Error(res.error);
      return res.value;
    },
    staleTime: 30_000,
  });

  const notifyExport = React.useCallback(
    (filename: string, rows: number) => {
      toast.success(
        `Saved ${filename}`,
        `${rows.toLocaleString("en-IN")} ${rows === 1 ? "row" : "rows"} from the view on screen, with the current filters applied.`,
      );
    },
    [toast],
  );

  const handleExport = React.useCallback(
    (view: string, csv: string, rows: number, batchName: string | null) => {
      try {
        const filename = analyticsFilename(view, periodMonths, batch === "all" ? null : batchName);
        downloadCsv(filename, csv);
        notifyExport(filename, rows);
      } catch (err) {
        log.error("dashboard_export_failed", err instanceof Error ? err.message : String(err), { view });
        toast.error("Export failed", "The view could not be turned into a file. Nothing was downloaded.");
      }
    },
    [periodMonths, batch, notifyExport, toast],
  );

  if (error !== null) {
    return (
      <section aria-labelledby="dashboard-analytics-heading" className="space-y-4">
        <h2 id="dashboard-analytics-heading" className="text-lg font-semibold text-[var(--text-primary)]">
          Business analytics
        </h2>
        <ErrorState
          state={toAppErrorState(error)}
          onRetry={() => {
            void refetch();
          }}
          isRetrying={isFetching}
          retryLabel="Reload analytics"
          dataStatus="The charts below are not being shown. Your saved books are untouched; retry when ready."
        />
      </section>
    );
  }

  if (data === undefined) {
    return (
      <section aria-labelledby="dashboard-analytics-heading" className="space-y-4" aria-busy="true">
        <h2 id="dashboard-analytics-heading" className="text-lg font-semibold text-[var(--text-primary)]">
          Business analytics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SkeletonPanel label="collection trend" />
          <SkeletonPanel label="dues aging" />
          <SkeletonPanel label="defaulter list" />
          <SkeletonPanel label="batch performance" />
        </div>
      </section>
    );
  }

  const batchNameForFile =
    batch === "all" ? null : (data.batchNames.find((b) => b.id === batch)?.name ?? batch);
  const exportView = (view: string, csv: string, rows: number) =>
    handleExport(view, csv, rows, batchNameForFile);

  return (
    <section aria-labelledby="dashboard-analytics-heading" className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h2 id="dashboard-analytics-heading" className="text-lg font-semibold text-[var(--text-primary)]">
            Business analytics
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {data.periodLabel}, read from your own books. Figures as of{" "}
            {new Date(data.generatedAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            .
          </p>
        </div>
        <AnalyticsFilters
          periodMonths={periodMonths}
          onPeriod={setPeriodMonths}
          batch={batch}
          onBatch={setBatch}
          batchNames={data.batchNames}
          status={status}
          onStatus={setStatus}
        />
      </div>

      {data.dataPartial && (
        <p role="status" className="text-xs text-[var(--text-muted)]">
          Some sections read from a cached or incomplete response. Totals shown are from the data
          that arrived; nothing was guessed.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TrendPanel data={data} onExport={exportView} />
        <AgingPanel data={data} onExport={exportView} />
        <MonthOverMonthPanel data={data} onExport={exportView} />
        <EfficiencyPanel data={data} onExport={exportView} />
        <DefaultersPanel data={data} status={status} onExport={exportView} />
        <BatchPanel data={data} onExport={exportView} />
        <EnrollmentPanel data={data} onExport={exportView} />
        <HeatmapPanel data={data} onExport={exportView} />
      </div>

      {data.sourceNotes.length > 0 && (
        <p className="text-xs text-[var(--text-muted)]">{data.sourceNotes.join(" ")}</p>
      )}
    </section>
  );
}

function AnalyticsFilters({
  periodMonths,
  onPeriod,
  batch,
  onBatch,
  batchNames,
  status,
  onStatus,
}: {
  periodMonths: PeriodMonths;
  onPeriod: (p: PeriodMonths) => void;
  batch: string;
  onBatch: (b: string) => void;
  batchNames: Array<{ id: string; name: string }>;
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Analytics filters">
      <div className="inline-flex rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-1" role="group" aria-label="Period">
        {PERIOD_OPTIONS.map((months) => (
          <button
            key={months}
            type="button"
            aria-pressed={periodMonths === months}
            onClick={() => onPeriod(months)}
            className={cn(
              "min-h-[44px] px-3 rounded-lg text-xs font-semibold transition-colors",
              periodMonths === months
                ? "bg-[var(--surface-raised)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            {months}M
          </button>
        ))}
      </div>
      <label className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
        Batch
        <select
          value={batch}
          onChange={(event) => onBatch(event.target.value)}
          aria-label="Filter analytics by batch"
          className="min-h-[44px] rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-xs font-semibold text-[var(--text-primary)]"
        >
          <option value="all">All batches</option>
          {batchNames.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <div className="inline-flex rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-1" role="group" aria-label="Due status">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={status === option.value}
            onClick={() => onStatus(option.value)}
            className={cn(
              "min-h-[44px] px-3 rounded-lg text-xs font-semibold transition-colors",
              status === option.value
                ? "bg-[var(--surface-raised)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Trend (focal point, BR-RPT-08) ---------------- */

function TrendPanel({
  data,
  onExport,
}: {
  data: DashboardAnalytics;
  onExport: (view: string, csv: string, rows: number) => void;
}) {
  const max = Math.max(1, ...data.trend.map((p) => p.collectedPaise));
  const summary =
    data.trend.length === 0 || data.collectedTotalPaise <= 0
      ? `No payments recorded in ${data.periodLabel.toLowerCase()}.`
      : `Collected ${formatINR(data.collectedTotalPaise)} across ${data.periodLabel.toLowerCase()}, ` +
        `highest in ${(data.trend.reduce((a, b) => (b.collectedPaise > a.collectedPaise ? b : a))).label}.`;
  return (
    <Panel
      title="Fee collection trend"
      caption={`${data.periodLabel} · payments minus refunds`}
      exportLabel="Download collection trend as CSV"
      onExport={() => onExport("collection-trend", buildTrendCsv(data.trend), data.trend.length)}
      summary={summary}
    >
      {data.trend.length === 0 ? (
        <EmptyPanel title="No months to show" body="Payments you record will appear here, month by month." />
      ) : (
        <div
          role="img"
          aria-label={`Bar chart of fees collected per month. ${summary}`}
          className="flex items-end gap-2 h-36 pt-2"
        >
          {data.trend.map((point) => (
            <div key={point.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <span className="text-[11px] font-semibold text-[var(--text-primary)] num truncate">
                {point.collectedPaise > 0 ? formatINR(point.collectedPaise) : "—"}
              </span>
              <div className="w-full flex-1 flex items-end rounded-t-sm bg-[var(--surface-inset)] min-h-[8px]">
                <div
                  title={`${point.label}: ${formatINR(point.collectedPaise)} collected`}
                  className="w-full rounded-t-sm"
                  style={{
                    height: `${Math.max(point.collectedPaise <= 0 ? 0 : 6, (point.collectedPaise / max) * 100)}%`,
                    backgroundColor: "var(--success)",
                  }}
                />
              </div>
              <span className="text-[11px] text-[var(--text-muted)]">{point.label}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ---------------- Dues aging (BR-RPT-03) ---------------- */

const AGING_META = [
  { Icon: Clock3, accent: "var(--warning)" },
  { Icon: Clock3, accent: "var(--warning)" },
  { Icon: Clock3, accent: "var(--danger)" },
  { Icon: XCircle, accent: "var(--danger)" },
] as const;

function AgingPanel({
  data,
  onExport,
}: {
  data: DashboardAnalytics;
  onExport: (view: string, csv: string, rows: number) => void;
}) {
  const max = Math.max(1, ...data.aging.map((b) => b.outstandingPaise));
  const totalInvoices = data.aging.reduce((n, b) => n + b.invoices, 0);
  const totalOutstanding = data.aging.reduce((n, b) => n + b.outstandingPaise, 0);
  const summary =
    totalInvoices === 0
      ? "No overdue invoices. Nothing is aging."
      : `${totalInvoices} overdue ${totalInvoices === 1 ? "invoice" : "invoices"} owe ${formatINR(totalOutstanding)}, ` +
        `oldest bucket holds ${formatINR(data.aging[data.aging.length - 1]?.outstandingPaise ?? 0)}.`;
  return (
    <Panel
      title="Dues aging"
      caption="Overdue invoices by how late they are"
      exportLabel="Download dues aging as CSV"
      onExport={() => onExport("dues-aging", buildAgingCsv(data.aging), data.aging.length)}
      summary={summary}
    >
      <ul className="space-y-2">
        {data.aging.map((bucket, index) => {
          const meta = AGING_META[index] ?? AGING_META[0];
          if (!meta) return null;
          const { Icon, accent } = meta;
          return (
            <li key={bucket.id} className="flex items-center gap-3">
              <Icon className="w-4 h-4 shrink-0" style={{ color: accent }} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                    {bucket.label}
                  </span>
                  <span className="text-xs font-semibold text-[var(--text-primary)] num shrink-0">
                    {bucket.invoices} · {formatINR(bucket.outstandingPaise)}
                  </span>
                </div>
                <div
                  role="img"
                  aria-label={`${bucket.label}: ${bucket.invoices} invoices, ${formatINR(bucket.outstandingPaise)} outstanding`}
                  className="mt-1 h-2 rounded-full bg-[var(--surface-inset)]"
                >
                  <div
                    className="h-2 rounded-full"
                    style={{
                      width: `${(bucket.outstandingPaise / max) * 100}%`,
                      backgroundColor: accent,
                    }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ---------------- Month over month (04 §9.2) ---------------- */

function MonthOverMonthPanel({
  data,
  onExport,
}: {
  data: DashboardAnalytics;
  onExport: (view: string, csv: string, rows: number) => void;
}) {
  const delta = data.momDeltaPct;
  const csv = [
    ["Month", "Collected (paise)", "Collected (INR)"].map(csvCell).join(","),
    [
      "Current month",
      String(Math.round(data.momCurrentPaise)),
      rupeesFromPaise(data.momCurrentPaise),
    ]
      .map(csvCell)
      .join(","),
    [
      "Previous month",
      String(Math.round(data.momPrevPaise)),
      rupeesFromPaise(data.momPrevPaise),
    ]
      .map(csvCell)
      .join(","),
  ].join("\r\n");
  const summary =
    delta === null
      ? "Not enough history to compare months yet."
      : delta === 0
        ? `This month matches last month at ${formatINR(data.momCurrentPaise)}.`
        : delta > 0
          ? `Collections are up ${delta}% on last month (${formatINR(data.momPrevPaise)} to ${formatINR(data.momCurrentPaise)}).`
          : `Collections are down ${Math.abs(delta)}% on last month (${formatINR(data.momPrevPaise)} to ${formatINR(data.momCurrentPaise)}).`;
  return (
    <Panel
      title="Month over month"
      caption="This month against last month"
      exportLabel="Download month comparison as CSV"
      onExport={() => onExport("month-over-month", csv, 2)}
      summary={summary}
    >
      <div
        role="img"
        aria-label={`Month over month comparison. ${summary}`}
        className="flex items-center gap-4 py-2"
      >
        <p className="text-3xl font-bold text-[var(--text-primary)] num">
          {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}%`}
        </p>
        <div className="text-xs text-[var(--text-muted)] leading-relaxed">
          <p>
            This month <span className="font-semibold text-[var(--text-primary)] num">{formatINR(data.momCurrentPaise)}</span>
          </p>
          <p>
            Last month <span className="font-semibold text-[var(--text-primary)] num">{formatINR(data.momPrevPaise)}</span>
          </p>
        </div>
      </div>
    </Panel>
  );
}

/* ---------------- Collection efficiency ---------------- */

function EfficiencyPanel({
  data,
  onExport,
}: {
  data: DashboardAnalytics;
  onExport: (view: string, csv: string, rows: number) => void;
}) {
  const pct = data.efficiencyPct;
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const filled = pct === null ? 0 : (pct / 100) * circumference;
  const csv = [
    ["Measure", "Amount (paise)", "Amount (INR)"].map(csvCell).join(","),
    ["Collected", String(Math.round(data.efficiencyCollectedPaise)), rupeesFromPaise(data.efficiencyCollectedPaise)]
      .map(csvCell)
      .join(","),
    ["Still outstanding", String(Math.round(data.efficiencyOutstandingPaise)), rupeesFromPaise(data.efficiencyOutstandingPaise)]
      .map(csvCell)
      .join(","),
  ].join("\r\n");
  const summary =
    pct === null
      ? "No collections and no dues in this window, so there is no rate to show."
      : `You have collected ${pct}% of what this window asked for (${formatINR(data.efficiencyCollectedPaise)} of ${formatINR(data.efficiencyCollectedPaise + data.efficiencyOutstandingPaise)}).`;
  return (
    <Panel
      title="Collection efficiency"
      caption={`${data.periodLabel} · collected of asked`}
      exportLabel="Download collection efficiency as CSV"
      onExport={() => onExport("collection-efficiency", csv, 2)}
      summary={summary}
    >
      <div className="flex items-center gap-4 py-2">
        <svg
          width="88"
          height="88"
          viewBox="0 0 88 88"
          role="img"
          aria-label={`Collection efficiency donut. ${summary}`}
        >
          <circle cx="44" cy="44" r={radius} fill="none" stroke="var(--surface-inset)" strokeWidth="10" />
          <circle
            cx="44"
            cy="44"
            r={radius}
            fill="none"
            stroke="var(--success)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            transform="rotate(-90 44 44)"
          />
          <text
            x="44"
            y="44"
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--text-primary)"
            fontSize="16"
            fontWeight="700"
          >
            {pct === null ? "—" : `${pct}%`}
          </text>
        </svg>
        <div className="text-xs text-[var(--text-muted)] leading-relaxed">
          <p>
            Collected <span className="font-semibold text-[var(--text-primary)] num">{formatINR(data.efficiencyCollectedPaise)}</span>
          </p>
          <p>
            Still owed <span className="font-semibold text-[var(--text-primary)] num">{formatINR(data.efficiencyOutstandingPaise)}</span>
          </p>
        </div>
      </div>
    </Panel>
  );
}

/* ---------------- Defaulter list (BR-RPT-01) ---------------- */

function DefaultersPanel({
  data,
  status,
  onExport,
}: {
  data: DashboardAnalytics;
  status: string;
  onExport: (view: string, csv: string, rows: number) => void;
}) {
  const total = data.defaulters.reduce((n, r) => n + r.outstandingPaise, 0);
  const summary =
    data.defaulters.length === 0
      ? "Nobody owes anything under the current filter. Clean slate."
      : `Top ${data.defaulters.length} owing ${status === "all" ? "students" : status + " accounts"} total ${formatINR(total)}.` +
        (data.defaultersTruncated ? " More owe beyond this list." : "");
  return (
    <Panel
      title="Who owes the most"
      caption={status === "all" ? "Top 10 overdue accounts" : `Top 10 ${status} accounts`}
      exportLabel="Download defaulter list as CSV"
      onExport={() => onExport("defaulters", buildDefaultersCsv(data.defaulters), data.defaulters.length)}
      summary={summary}
    >
      {data.defaulters.length === 0 ? (
        <EmptyPanel title="Nobody owes right now" body="Overdue accounts will appear here, largest first." />
      ) : (
        <ol className="space-y-2">
          {data.defaulters.map((row, index) => {
            const meta = STATUS_META[row.status];
            const { Icon, accent, label } = meta;
            return (
              <li
                key={row.studentId}
                className="flex items-center gap-3 p-2.5 rounded-xl bg-[var(--surface-inset)] border border-[var(--border-default)]"
              >
                <span className="text-xs font-bold text-[var(--text-muted)] num w-5 shrink-0" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{row.name}</p>
                  <p className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1">
                    <Icon className="w-3.5 h-3.5" style={{ color: accent }} aria-hidden="true" />
                    {label}
                  </p>
                </div>
                <span className="text-sm font-semibold num shrink-0" style={{ color: accent }}>
                  {formatINR(row.outstandingPaise)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {data.defaultersTruncated && (
        <p className="text-xs text-[var(--text-muted)]">
          Showing the 10 largest. The full list is in the downloaded CSV.
        </p>
      )}
    </Panel>
  );
}

/* ---------------- Batch performance ---------------- */

function BatchPanel({
  data,
  onExport,
}: {
  data: DashboardAnalytics;
  onExport: (view: string, csv: string, rows: number) => void;
}) {
  const max = Math.max(1, ...data.batches.map((b) => Math.max(b.collectedPaise, b.duesPaise)));
  const summary =
    data.batches.length === 0
      ? "No batches found. Batches you create will be compared here."
      : data.batches
          .map((b) => `${b.batchName}: ${b.students} students, ${formatINR(b.collectedPaise)} collected, ${formatINR(b.duesPaise)} owed`)
          .join("; ");
  return (
    <Panel
      title="Batch performance"
      caption="Collected and owed per batch"
      exportLabel="Download batch performance as CSV"
      onExport={() => onExport("batch-performance", buildBatchCsv(data.batches), data.batches.length)}
      summary={summary}
    >
      {data.batches.length === 0 ? (
        <EmptyPanel title="No batches yet" body="Create a batch and enroll students to compare performance." />
      ) : (
        <ul className="space-y-3">
          {data.batches.map((row) => (
            <li key={row.batchName}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                  {row.batchName} <span className="text-[var(--text-muted)]">· {row.students}</span>
                </span>
                <span className="text-xs text-[var(--text-muted)] num shrink-0">
                  In {formatINR(row.collectedPaise)} · Owed {formatINR(row.duesPaise)}
                </span>
              </div>
              <div
                role="img"
                aria-label={`${row.batchName}: ${row.students} students, ${formatINR(row.collectedPaise)} collected, ${formatINR(row.duesPaise)} owed`}
                className="mt-1 space-y-1"
              >
                <div className="h-2 rounded-full bg-[var(--surface-inset)]">
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${(row.collectedPaise / max) * 100}%`, backgroundColor: "var(--success)" }}
                  />
                </div>
                <div className="h-2 rounded-full bg-[var(--surface-inset)]">
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${(row.duesPaise / max) * 100}%`, backgroundColor: "var(--warning)" }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------------- Enrollment funnel ---------------- */

function EnrollmentPanel({
  data,
  onExport,
}: {
  data: DashboardAnalytics;
  onExport: (view: string, csv: string, rows: number) => void;
}) {
  const max = Math.max(1, ...data.enrollment.map((s) => s.students));
  const summary =
    data.enrollment.length === 0
      ? "No students on the roster yet."
      : `${data.enrollmentTotal} students on record: ` +
        data.enrollment.map((s) => `${s.students} ${s.status}`).join(", ") +
        ".";
  return (
    <Panel
      title="Enrollment funnel"
      caption="Roster by status"
      exportLabel="Download enrollment funnel as CSV"
      onExport={() => onExport("enrollment", buildEnrollmentCsv(data.enrollment), data.enrollment.length)}
      summary={summary}
    >
      {data.enrollment.length === 0 ? (
        <EmptyPanel title="Roster is empty" body="Add your first student and the funnel fills in." />
      ) : (
        <ul className="space-y-2">
          {data.enrollment.map((slice) => (
            <li key={slice.status} className="flex items-center gap-3">
              <span className="text-xs font-medium text-[var(--text-primary)] w-24 shrink-0 capitalize">
                {slice.status}
              </span>
              <div
                role="img"
                aria-label={`${slice.students} ${slice.status} students`}
                className="flex-1 h-3 rounded-full bg-[var(--surface-inset)]"
              >
                <div
                  className="h-3 rounded-full"
                  style={{
                    width: `${(slice.students / max) * 100}%`,
                    backgroundColor: slice.status === "active" ? "var(--success)" : "var(--info)",
                  }}
                />
              </div>
              <span className="text-xs font-semibold text-[var(--text-primary)] num w-10 text-right shrink-0">
                {slice.students}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------------- Attendance heatmap (BR-CALC-07) ---------------- */

const HEATMAP_META = {
  present: { glyph: "P", accent: "var(--success)", label: "Present" },
  absent: { glyph: "A", accent: "var(--danger)", label: "Absent" },
  late: { glyph: "L", accent: "var(--warning)", label: "Late" },
} as const;

function HeatmapPanel({
  data,
  onExport,
}: {
  data: DashboardAnalytics;
  onExport: (view: string, csv: string, rows: number) => void;
}) {
  const byKey = new Map<string, HeatmapCell["status"]>();
  const names = new Map<string, string>();
  for (const cell of data.heatmap) {
    byKey.set(`${cell.studentId}|${cell.date}`, cell.status);
    if (!names.has(cell.studentId)) names.set(cell.studentId, cell.studentName);
  }
  const studentIds = Array.from(names.keys());
  const presentCount = data.heatmap.filter((c) => c.status === "present").length;
  const summary =
    data.heatmapBatchName === null
      ? "No batches exist yet, so there is no attendance to map."
      : studentIds.length === 0
        ? `No attendance marked for ${data.heatmapBatchName} in the last 14 days.`
        : `${data.heatmapBatchName}: ${presentCount} presents marked across ${studentIds.length} students and 14 days. ` +
          "P means present, A absent, L late, blank means no session.";
  return (
    <Panel
      title="Attendance heatmap"
      caption={
        data.heatmapBatchName === null
          ? "No batch to show"
          : `${data.heatmapBatchName} · last 14 days`
      }
      exportLabel="Download attendance heatmap as CSV"
      onExport={() => onExport("attendance-heatmap", buildHeatmapCsv(data.heatmap), data.heatmap.length)}
      summary={summary}
    >
      {studentIds.length === 0 ? (
        <EmptyPanel
          title="No attendance to map"
          body={
            data.heatmapBatchName === null
              ? "Create a batch and mark attendance to fill this grid."
              : "Mark attendance for this batch and the last 14 days appear here."
          }
        />
      ) : (
        <div
          role="img"
          aria-label={`Attendance heatmap. ${summary}`}
          className="overflow-x-auto"
        >
          <div
            className="grid gap-1 min-w-max"
            style={{ gridTemplateColumns: `minmax(96px, 1fr) repeat(${data.heatmapDates.length}, 22px)` }}
          >
            <span className="text-[11px] text-[var(--text-muted)]" aria-hidden="true" />
            {data.heatmapDates.map((date) => (
              <span
                key={date}
                className="text-[11px] text-[var(--text-muted)] text-center num"
                aria-hidden="true"
                title={date}
              >
                {date.slice(8, 10)}
              </span>
            ))}
            {studentIds.map((studentId) => (
              <React.Fragment key={studentId}>
                <span className="text-[11px] text-[var(--text-primary)] truncate pr-2" aria-hidden="true" title={names.get(studentId) ?? ""}>
                  {names.get(studentId) ?? ""}
                </span>
                {data.heatmapDates.map((date) => {
                  const status = byKey.get(`${studentId}|${date}`) ?? null;
                  const meta = status === null ? null : HEATMAP_META[status];
                  return (
                    <span
                      key={`${studentId}|${date}`}
                      title={`${names.get(studentId) ?? ""} · ${date} · ${meta === null ? "No session" : meta.label}`}
                      aria-hidden="true"
                      className="w-[22px] h-[22px] rounded-[4px] inline-flex items-center justify-center text-[10px] font-bold"
                      style={{
                        backgroundColor:
                          meta === null ? "var(--surface-inset)" : `color-mix(in srgb, ${meta.accent} 30%, transparent)`,
                        color: meta === null ? "transparent" : meta.accent,
                      }}
                    >
                      {meta?.glyph ?? ""}
                    </span>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-muted)]" aria-hidden="true">
            P present · A absent · L late · blank no session
          </p>
        </div>
      )}
      {data.heatmapPartial && (
        <p className="text-xs text-[var(--text-muted)]">
          Some days or students are missing from this grid. The downloaded CSV holds exactly what is shown.
        </p>
      )}
    </Panel>
  );
}
