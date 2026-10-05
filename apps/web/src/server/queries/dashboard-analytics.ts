// Implements: 04_Dashboard.md §6.2 (analytics read from ledger_entries, invoices,
//   students, attendance_records) + §9 (Prisma ORM only via gateway seam, no raw
//   SQL) + §10 (BR-CALC-09/10/11 scope, BR-RPT-01/03/08); 12_Business_Rules.md
//   BR-RPT-03 (aging buckets), BR-RPT-08 (collected), BR-CALC-10/11; AGENTS.md §2
//   Rule 6 (integer paise via paiseAdd/paiseSub, formatINR at the edge), Rule 9
//   (Zod-parsed gateway payloads, typed errors, partial-data honesty).
//
// READ-ONLY. This module performs zero mutations: no ledger writes, no
// sync_outbox rows (Rule 7 applies to mutations; reads write nothing), no
// direct DB access. Every number arrives through the existing gateway GETs
// (the seam `server/actions/dashboard.ts` documents); this file only aggregates
// and buckets what the gateway already returns. No fee formula is duplicated
// here: collected nets payments minus refunds per BR-CALC-10, outstanding nets
// invoice totals minus attributed payments per the gateway's own paid_amount,
// and status labels reuse the gateway's paymentBreakdown vocabulary.
//
// Tenant isolation rides on `gatewayGet` (tenant headers from the session per
// `server/get-db.ts`); no tenant id is accepted, forwarded, or read here.

"use server";

import { cache } from "react";
import { z } from "zod";
import { paiseAdd, paiseSub } from "@buddysaradhi/shared";
import { gatewayGet } from "@/server/get-db";
import {
  QUERY_TIMEOUT_MS,
  toTypedQueryError,
  withQueryTimeout,
} from "@/server/cache";
import { log } from "@/lib/logger";
import type { StudentInvoiceRow, StudentLedgerRow } from "./ledger";
// Value + type imports only (no re-exports): a "use server" module may export
// async functions and types, nothing else.
import { AnalyticsFilterSchema } from "@/lib/dashboard-analytics-calc";
import type { AnalyticsFilter } from "@/lib/dashboard-analytics-calc";

/* ------------------------------------------------------------------ *
 * Gateway payload schemas (minimal projections, money as integer paise)
 * ------------------------------------------------------------------ */

const paiseInt = z
  .number()
  .finite()
  .transform((v) => Math.round(v))
  .refine(Number.isSafeInteger, { message: "amount outside the safe-integer range" });

const DashboardKpisSchema = z.object({
  totalStudents: z.number().int().nonnegative(),
  studentsWithDues: z.number().int().nonnegative(),
  collectedThisMonthMinor: paiseInt,
  dueTillDateMinor: paiseInt,
  dueForMonthMinor: paiseInt,
  overdueMinor: paiseInt,
  paymentBreakdown: z.object({
    paid: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    unpaid: z.number().int().nonnegative(),
    noDues: z.number().int().nonnegative(),
  }),
});

const DashboardSummarySchema = z.object({
  kpis: DashboardKpisSchema,
  activity: z.array(z.unknown()).default([]),
  dueToday: z.array(z.unknown()).default([]),
  dueTodayTotal: z.number().int().nonnegative().default(0),
  dueTodayTruncated: z.boolean().default(false),
  dataOrigin: z.literal("live"),
});

const FeesRosterRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  code: z.string().nullable().default(null),
  fee_model: z.string().default("postpaid"),
  balance_due: paiseInt.default(0),
});

const InvoiceRowSchema = z.object({
  id: z.string().min(1),
  number: z.string().default(""),
  student_id: z.string().min(1),
  issue_date: z.string().default(""),
  due_date: z.string().nullable().default(null),
  subtotal: paiseInt.default(0),
  total: paiseInt.default(0),
  status: z.string().default(""),
  paid_amount_minor: paiseInt.default(0),
});

const LedgerRowSchema = z.object({
  id: z.string().min(1),
  student_id: z.string().default(""),
  type: z.string().default(""),
  debit: paiseInt.default(0),
  credit: paiseInt.default(0),
  occurred_on: z.string().default(""),
  invoice_id: z.string().nullable().default(null),
  receipt_no: z.string().nullable().default(null),
  reverses_entry_id: z.string().nullable().default(null),
});

const StudentRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  code: z.string().nullable().default(null),
  grade: z.string().nullable().default(null),
  batch: z.string().nullable().default(null),
  fee_model: z.string().default("postpaid"),
  status: z.string().default("active"),
  balance_due: paiseInt.default(0),
});

const StudentsEnvelopeSchema = z.object({
  students: z.array(StudentRowSchema).default([]),
  total: z.number().int().nonnegative().default(0),
});

const BatchSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  subject: z.string().nullable().default(null),
});

const AttendanceRecordSchema = z.object({
  student_id: z.string().min(1),
  name: z.string().default(""),
  batch: z.string().nullable().default(null),
  status: z.enum(["present", "absent", "late"]).nullable().default(null),
});

const AttendanceDaySchema = z.object({
  session: z.unknown().nullable().default(null),
  records: z.array(AttendanceRecordSchema).default([]),
});

/* ------------------------------------------------------------------ *
 * Derived view types (all money in integer paise)
 * ------------------------------------------------------------------ */

export interface BatchPerfRow {
  batchId: string | null;
  batchName: string;
  students: number;
  collectedPaise: number;
  duesPaise: number;
}

export interface EnrollmentSlice {
  status: string;
  students: number;
}

export interface HeatmapCell {
  date: string;
  studentId: string;
  studentName: string;
  status: "present" | "absent" | "late" | null;
}

export interface DashboardAnalytics {
  generatedAt: string;
  periodLabel: string;
  trend: TrendPoint[];
  collectedTotalPaise: number;
  momDeltaPct: number | null;
  momCurrentPaise: number;
  momPrevPaise: number;
  efficiencyPct: number | null;
  efficiencyCollectedPaise: number;
  efficiencyOutstandingPaise: number;
  aging: AgingBucket[];
  defaulters: DefaulterRow[];
  defaultersTruncated: boolean;
  batches: BatchPerfRow[];
  batchNames: Array<{ id: string; name: string }>;
  heatmapBatchId: string | null;
  heatmapBatchName: string | null;
  heatmapDates: string[];
  heatmap: HeatmapCell[];
  heatmapPartial: boolean;
  enrollment: EnrollmentSlice[];
  enrollmentTotal: number;
  paymentBreakdown: { paid: number; partial: number; unpaid: number; noDues: number };
  /** True when at least one leg failed but the anchor held: captions must say so. */
  dataPartial: boolean;
  /** Gateway caps that bound the derivation (honesty footnotes for the UI). */
  sourceNotes: string[];
}

export type AnalyticsResult =
  | { success: true; data: DashboardAnalytics }
  | { success: false; error: string };

/* ------------------------------------------------------------------ *
 * Pure derivation lives in `@/lib/dashboard-analytics-calc` (no "use
 * server" boundary there). It used to live here, which broke `next build`:
 * a "use server" module may only export async functions. The query code
 * below imports the derivations; the view types they return are re-exported
 * so existing `import type` sites keep working.
 * ------------------------------------------------------------------ */
import {
  agingFromInvoices,
  dayIso,
  defaultersFromInvoices,
  momDeltaPct,
  monthKeysForWindow,
  trendFromEntries,
} from "@/lib/dashboard-analytics-calc";
import type {
  TrendPoint,
  AgingBucket,
  DefaulterRow,
} from "@/lib/dashboard-analytics-calc";
export type {
  TrendPoint,
  AgingBucket,
  DefaulterRow,
} from "@/lib/dashboard-analytics-calc";


/* ------------------------------------------------------------------ *
 * Read (one bounded wave per leg, typed failures, honest partials)
 * ------------------------------------------------------------------ */

const LEDGER_TAKE = "200";
const INVOICES_TAKE = "100";
const HEATMAP_DAYS = 14;
const HEATMAP_MAX_STUDENTS = 30;
const DEFAULTER_LIMIT = 10;

/** Leg name → the panels that leg feeds, so a partial read is attributed to a
 *  thing a tutor can act on rather than to an internal route. */
const LEG_LABELS: Record<string, string> = {
  fees: "the dues roster behind batch dues",
  invoices: "dues aging, who owes the most, and collection efficiency",
  ledger: "the collection trend and batch collections",
  students: "the enrollment funnel and batch membership",
  batches: "the batch list and the attendance heatmap",
};

async function readDashboard(periodStartIso: string, periodEndIso: string) {
  const res = await withQueryTimeout(
    gatewayGet<unknown>("/api/v1/analytics/dashboard", { periodStartIso, periodEndIso }),
    QUERY_TIMEOUT_MS,
  );
  if (!res.success) throw new Error(res.error);
  return DashboardSummarySchema.parse(res.data);
}

async function readFeesRoster() {
  const res = await withQueryTimeout(
    gatewayGet<unknown>("/api/v1/ledger/fees"),
    QUERY_TIMEOUT_MS,
  );
  if (!res.success) throw new Error(res.error);
  return z.array(FeesRosterRowSchema).parse(res.data);
}

async function readInvoices() {
  const res = await withQueryTimeout(
    gatewayGet<unknown>("/api/v1/ledger/invoices", { limit: INVOICES_TAKE }),
    QUERY_TIMEOUT_MS,
  );
  if (!res.success) throw new Error(res.error);
  return z.array(InvoiceRowSchema).parse(res.data);
}

async function readLedger() {
  const res = await withQueryTimeout(
    gatewayGet<unknown>("/api/v1/ledger", { limit: LEDGER_TAKE }),
    QUERY_TIMEOUT_MS,
  );
  if (!res.success) throw new Error(res.error);
  return z.array(LedgerRowSchema).parse(res.data);
}

async function readStudents() {
  const res = await withQueryTimeout(
    gatewayGet<unknown>("/api/v1/students", {
      page: "1",
      pageSize: "200",
      status: "active,inactive,graduated,archived",
    }),
    QUERY_TIMEOUT_MS,
  );
  if (!res.success) throw new Error(res.error);
  return StudentsEnvelopeSchema.parse(res.data);
}

async function readBatches() {
  const res = await withQueryTimeout(
    gatewayGet<unknown>("/api/v1/attendance/batches"),
    QUERY_TIMEOUT_MS,
  );
  if (!res.success) throw new Error(res.error);
  return z.array(BatchSchema).parse(res.data);
}

async function readAttendanceDay(dateIso: string, batchId?: string) {
  const params: Record<string, string> = { date: dateIso };
  if (batchId) params.batchId = batchId;
  const res = await withQueryTimeout(
    gatewayGet<unknown>("/api/v1/attendance", params),
    QUERY_TIMEOUT_MS,
  );
  if (!res.success) throw new Error(res.error);
  return AttendanceDaySchema.parse(res.data);
}

/**
 * The whole analytics read. The dashboard summary is the anchor: without it
 * there is no payment breakdown and no period-scoped KPI, so its failure is
 * the only fatal one. Every other leg degrades to an empty section plus a
 * `dataPartial` caption rather than a wrong dashboard (AGENTS.md §2 Rule 9).
 */
export const getDashboardAnalytics = cache(
  async (filter: AnalyticsFilter): Promise<AnalyticsResult> => {
    const parsed = AnalyticsFilterSchema.safeParse(filter);
    if (!parsed.success) {
      return {
        success: false,
        error: "VALIDATION: analytics filter is unreadable — period must be 3, 6 or 12 months",
      };
    }
    const { periodMonths, batch, status } = parsed.data;
    const nowMs = Date.now();
    const today = dayIso(0, nowMs);
    const months = monthKeysForWindow(periodMonths, nowMs);
    const periodStartIso = `${months[0] ?? today.slice(0, 7)}-01`;
    const periodEndIso = today;
    const periodLabel =
      periodMonths === 3 ? "Last 3 months" : periodMonths === 6 ? "Last 6 months" : "Last 12 months";

    const settled = await Promise.allSettled([
      readDashboard(periodStartIso, periodEndIso),
      readFeesRoster(),
      readInvoices(),
      readLedger(),
      readStudents(),
      readBatches(),
    ]);
    const [dashboardLeg, feesLeg, invoicesLeg, ledgerLeg, studentsLeg, batchesLeg] = settled;

    if (dashboardLeg.status === "rejected") {
      const typed = toTypedQueryError(dashboardLeg.reason);
      log.error("dashboard_analytics_anchor_failed", typed);
      return { success: false, error: typed };
    }

    let dataPartial = false;
    const sourceNotes: string[] = [];
    /**
     * A failed leg is named, not just flagged. The section-level caption used
     * to say "some sections read from a cached or incomplete response" — which
     * is a lie twice over: nothing here is cached (a rejected leg is simply
     * empty), and a caption that cannot say WHICH panel is thin lets an empty
     * panel state its own conclusion. "Nobody owes right now" is true and
     * false at once when the invoices leg is the one that failed, and the tutor
     * is the only person who can tell the difference. So the leg name is carried
     * all the way to the caption.
     */
    const noteFailure = (leg: string, reason: unknown) => {
      dataPartial = true;
      log.warn("dashboard_analytics_leg_failed", toTypedQueryError(reason), { leg });
      sourceNotes.push(
        `Could not be read: ${LEG_LABELS[leg] ?? leg}. That panel is incomplete, not empty.`,
      );
    };

    const fees = feesLeg.status === "fulfilled" ? feesLeg.value : [];
    if (feesLeg.status === "rejected") noteFailure("fees", feesLeg.reason);
    const invoices = invoicesLeg.status === "fulfilled" ? invoicesLeg.value : [];
    if (invoicesLeg.status === "rejected") noteFailure("invoices", invoicesLeg.reason);
    const ledger = ledgerLeg.status === "fulfilled" ? ledgerLeg.value : [];
    if (ledgerLeg.status === "rejected") noteFailure("ledger", ledgerLeg.reason);
    const studentsEnvelope = studentsLeg.status === "fulfilled" ? studentsLeg.value : { students: [], total: 0 };
    if (studentsLeg.status === "rejected") noteFailure("students", studentsLeg.reason);
    const batches = batchesLeg.status === "fulfilled" ? batchesLeg.value : [];
    if (batchesLeg.status === "rejected") noteFailure("batches", batchesLeg.reason);

    if (ledgerLeg.status === "fulfilled") {
      sourceNotes.push(`Collection trend reads the latest ${LEDGER_TAKE} ledger entries.`);
    }
    if (invoicesLeg.status === "fulfilled") {
      sourceNotes.push(`Aging and defaulters read up to ${INVOICES_TAKE} invoices.`);
    }

    // Trend + month-over-month (BR-RPT-08 + 04 §9.2).
    const trend = trendFromEntries(ledger, months);
    const collectedTotalPaise = trend.reduce((sum, point) => paiseAdd(sum, point.collectedPaise), 0);
    const currentKey = months[months.length - 1] ?? "";
    const prevKey = months[months.length - 2] ?? "";
    const momCurrentPaise = trend.find((p) => p.month === currentKey)?.collectedPaise ?? 0;
    const momPrevPaise = trend.find((p) => p.month === prevKey)?.collectedPaise ?? 0;
    const momDelta = months.length >= 2 ? momDeltaPct(momCurrentPaise, momPrevPaise) : null;

    // Collection efficiency: collected against collected plus still-outstanding
    // in the same window (BR-CALC-10/11 scope, display ratio, not money).
    const aging = agingFromInvoices(invoices, today);
    const efficiencyOutstandingPaise = aging.reduce(
      (sum, bucket) => paiseAdd(sum, bucket.outstandingPaise),
      0,
    );
    const efficiencyDenom = paiseAdd(collectedTotalPaise, efficiencyOutstandingPaise);
    const efficiencyPct =
      efficiencyDenom <= 0
        ? null
        : Math.round((collectedTotalPaise / efficiencyDenom) * 100);

    // Defaulters, honoring the status filter.
    const namesById = new Map<string, string>();
    for (const row of studentsEnvelope.students) {
      if (row.name !== "") namesById.set(row.id, row.name);
    }
    for (const row of fees) {
      if (!namesById.has(row.id) && row.name !== "") namesById.set(row.id, row.name);
    }
    let defaulters = defaultersFromInvoices(invoices, namesById, status, DEFAULTER_LIMIT);
    if (batch !== "all") {
      const batchStudentIds = new Set(
        studentsEnvelope.students.filter((s) => s.batch === batch).map((s) => s.id),
      );
      const filtered = defaulters.rows.filter((row) => batchStudentIds.has(row.studentId));
      defaulters = {
        rows: filtered,
        truncated: defaulters.truncated && filtered.length >= DEFAULTER_LIMIT,
      };
    }

    // Batch performance: roster gives membership, fees roster gives dues,
    // ledger credits give collection. Unmatched students keep their count but
    // contribute no money rather than invented money.
    const batchOfStudent = new Map<string, string | null>();
    for (const row of studentsEnvelope.students) batchOfStudent.set(row.id, row.batch);
    const byBatch = new Map<string, { students: number; collectedPaise: number; duesPaise: number }>();
    const ensureBatch = (name: string) => {
      const existing = byBatch.get(name);
      if (existing) return existing;
      const fresh = { students: 0, collectedPaise: 0, duesPaise: 0 };
      byBatch.set(name, fresh);
      return fresh;
    };
    for (const row of studentsEnvelope.students) {
      ensureBatch(row.batch ?? "Unassigned").students += 1;
    }
    const duesById = new Map<string, number>();
    for (const row of fees) duesById.set(row.id, row.balance_due);
    for (const row of fees) {
      const bucket = ensureBatch(batchOfStudent.get(row.id) ?? "Unassigned");
      if (row.balance_due > 0) bucket.duesPaise = paiseAdd(bucket.duesPaise, row.balance_due);
    }
    for (const entry of ledger) {
      if (entry.type !== "PAYMENT_RECEIVED" || entry.reverses_entry_id !== null) continue;
      if (entry.student_id === "") continue;
      const bucket = ensureBatch(batchOfStudent.get(entry.student_id) ?? "Unassigned");
      bucket.collectedPaise = paiseAdd(bucket.collectedPaise, entry.credit);
    }
    const batchIdByName = new Map<string, string | null>();
    for (const b of batches) batchIdByName.set(b.name, b.id);
    let batchRows: BatchPerfRow[] = Array.from(byBatch.entries()).map(([batchName, v]) => ({
      batchId: batchIdByName.get(batchName) ?? null,
      batchName,
      students: v.students,
      collectedPaise: v.collectedPaise,
      duesPaise: v.duesPaise,
    }));
    batchRows.sort((a, b) => b.duesPaise - a.duesPaise);
    if (batch !== "all") batchRows = batchRows.filter((row) => row.batchName === batch);

    // Enrollment funnel: plain status counts, no money involved.
    const enrollmentByStatus = new Map<string, number>();
    for (const row of studentsEnvelope.students) {
      enrollmentByStatus.set(row.status, (enrollmentByStatus.get(row.status) ?? 0) + 1);
    }
    const enrollment: EnrollmentSlice[] = Array.from(enrollmentByStatus.entries())
      .map(([statusName, students]) => ({ status: statusName, students }))
      .sort((a, b) => b.students - a.students);

    // Attendance heatmap (BR-CALC-07): exactly one batch, last 14 days, one
    // bounded wave. A failed day renders empty with a partial caption.
    const heatmapBatch =
      batch !== "all"
        ? (batches.find((b) => b.id === batch || b.name === batch) ?? null)
        : (batches[0] ?? null);
    const heatmapDates: string[] = [];
    for (let back = HEATMAP_DAYS - 1; back >= 0; back -= 1) {
      heatmapDates.push(dayIso(back, nowMs));
    }
    let heatmap: HeatmapCell[] = [];
    let heatmapPartial = false;
    if (heatmapBatch) {
      const dayLegs = await Promise.allSettled(
        heatmapDates.map((date) => readAttendanceDay(date, heatmapBatch.id)),
      );
      const seenStudents = new Map<string, string>();
      const cells: HeatmapCell[] = [];
      dayLegs.forEach((leg, index) => {
        const date = heatmapDates[index] ?? today;
        if (leg.status === "rejected") {
          heatmapPartial = true;
          dataPartial = true;
          log.warn("dashboard_analytics_heatmap_day_failed", toTypedQueryError(leg.reason), { date });
          return;
        }
        for (const record of leg.value.records) {
          if (!seenStudents.has(record.student_id) && record.name !== "") {
            seenStudents.set(record.student_id, record.name);
          }
          cells.push({
            date,
            studentId: record.student_id,
            studentName: record.name !== "" ? record.name : "Unnamed student",
            status: record.status,
          });
        }
      });
      const orderedIds = Array.from(seenStudents.keys()).slice(0, HEATMAP_MAX_STUDENTS);
      const kept = new Set(orderedIds);
      heatmap = cells.filter((cell) => kept.has(cell.studentId));
      if (seenStudents.size > HEATMAP_MAX_STUDENTS) {
        heatmapPartial = true;
        sourceNotes.push(
          `Attendance heatmap shows the first ${HEATMAP_MAX_STUDENTS} students of ${seenStudents.size}.`,
        );
      }
    }

    return {
      success: true,
      data: {
        generatedAt: new Date(nowMs).toISOString(),
        periodLabel,
        trend,
        collectedTotalPaise,
        momDeltaPct: momDelta,
        momCurrentPaise,
        momPrevPaise,
        efficiencyPct,
        efficiencyCollectedPaise: collectedTotalPaise,
        efficiencyOutstandingPaise,
        aging,
        defaulters: defaulters.rows,
        defaultersTruncated: defaulters.truncated,
        batches: batchRows,
        batchNames: batches.map((b) => ({ id: b.id, name: b.name })),
        heatmapBatchId: heatmapBatch?.id ?? null,
        heatmapBatchName: heatmapBatch?.name ?? null,
        heatmapDates,
        heatmap,
        heatmapPartial,
        enrollment,
        enrollmentTotal: studentsEnvelope.total,
        paymentBreakdown: dashboardLeg.value.kpis.paymentBreakdown,
        dataPartial,
        sourceNotes,
      },
    };
  },
);
