// Pure derivations for the dashboard analytics views (no I/O, paise only).
//
// Moved here from `server/queries/dashboard-analytics.ts`: that module carries
// `"use server"`, under which Next.js requires every exported VALUE to be an
// async function — the six sync derivations below broke `next build`
// ("Server Actions must be async functions") while `tsc` and vitest stayed
// green. Pure calculation does not belong to the server boundary at all, so it
// lives in this isomorphic module instead (importable from server queries,
// tests, and — if ever needed — client components).
//
// Implements: 04_Dashboard.md §6.2/§9.2/§10 (BR-RPT-01/03/08, BR-CALC-10/11);
// 12_Business_Rules.md BR-RPT-03, BR-FEE-05; AGENTS.md §2 Rule 6 (integer
// paise; percentages are display ratios, and EC-F-01 half-even applies to
// money division only). No fee formula is duplicated: collected nets payments
// minus refunds per BR-CALC-10, outstanding nets invoice totals minus
// attributed payments per the gateway's own paid_amount.
import { paiseAdd, paiseSub } from "@buddysaradhi/shared";
import { z } from "zod";
import type { StudentInvoiceRow, StudentLedgerRow } from "@/server/queries/ledger";

/* ------------------------------------------------------------------ *
 * Filter input (Zod is the single source of truth — AGENTS.md §6.1).
 * Lives here (not in the "use server" query module) because a Zod schema
 * is an OBJECT, and "use server" modules may only export async functions —
 * leaving it there 500s every action that transitively loads the module.
 * ------------------------------------------------------------------ */

export const AnalyticsFilterSchema = z.object({
  /** Trend / efficiency window in whole months. Bounded so the ledger wave stays cheap. */
  periodMonths: z.union([z.literal(3), z.literal(6), z.literal(12)]).default(6),
  /** Batch id, or "all". The heatmap always resolves to exactly one batch. */
  batch: z.string().min(1).max(200).default("all"),
  /** Payment-status filter for the defaulter list. */
  status: z.enum(["all", "paid", "partial", "unpaid"]).default("all"),
});

export type AnalyticsFilter = z.infer<typeof AnalyticsFilterSchema>;

export interface TrendPoint {
  month: string;
  label: string;
  collectedPaise: number;
}

export interface AgingBucket {
  id: string;
  label: string;
  invoices: number;
  outstandingPaise: number;
}

export interface DefaulterRow {
  studentId: string;
  name: string;
  status: "paid" | "partial" | "unpaid";
  outstandingPaise: number;
}

const DAY_MS = 86_400_000;
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function monthKeyOfDay(day: string): string {
  return day.slice(0, 7);
}

function monthLabelOfKey(key: string): string {
  const month = Number(key.slice(5, 7));
  const name = MONTH_LABELS[month - 1] ?? "?";
  return `${name} ${key.slice(2, 4)}`;
}

/** Inclusive YYYY-MM-DD day for N days ago (UTC, P-DM7: store UTC, display local). */
export function dayIso(daysAgo: number, nowMs: number): string {
  return new Date(nowMs - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/** Last N whole calendar months ending with the month containing nowMs, oldest first. */
export function monthKeysForWindow(months: number, nowMs: number): string[] {
  const now = new Date(nowMs);
  const keys: string[] = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    const cursor = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1),
    );
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    keys.push(`${year}-${month}`);
  }
  return keys;
}

/**
 * BR-CALC-10: collected = PAYMENT_RECEIVED credits minus REFUND_ISSUED debits.
 * VOID rows and reversal-linked rows never count (BR-LED read consistency,
 * mirroring the gateway invoices leg). Unparseable days are skipped, not guessed.
 */
export function trendFromEntries(
  entries: Array<Pick<StudentLedgerRow, "type" | "debit" | "credit" | "occurred_on" | "reverses_entry_id">>,
  months: string[],
): TrendPoint[] {
  const collectedByMonth = new Map<string, number>();
  for (const key of months) collectedByMonth.set(key, 0);
  for (const entry of entries) {
    if (entry.type === "VOID" || entry.reverses_entry_id !== null) continue;
    const day = entry.occurred_on.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const key = monthKeyOfDay(day);
    if (!collectedByMonth.has(key)) continue;
    if (entry.type === "PAYMENT_RECEIVED") {
      collectedByMonth.set(key, paiseAdd(collectedByMonth.get(key) ?? 0, entry.credit));
    } else if (entry.type === "REFUND_ISSUED") {
      collectedByMonth.set(key, paiseSub(collectedByMonth.get(key) ?? 0, entry.debit));
    }
  }
  return months.map((month) => ({
    month,
    label: monthLabelOfKey(month),
    collectedPaise: collectedByMonth.get(month) ?? 0,
  }));
}

/**
 * 04_Dashboard.md §9.2: delta % = ((curr - prev) / MAX(prev, 1)) * 100,
 * clamped to ±999 %, signed. Null when there is no previous window to compare
 * (the "All" case in §11 E3 hides the sparkline for the same reason).
 */
export function momDeltaPct(currPaise: number, prevPaise: number): number | null {
  if (prevPaise < 0 || currPaise < 0) return null;
  const denom = Math.max(prevPaise, 1);
  const raw = ((currPaise - prevPaise) / denom) * 100;
  if (!Number.isFinite(raw)) return null;
  return Math.max(-999, Math.min(999, Math.round(raw)));
}

function daysOverdue(dueDate: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  if (dueDate > today) return null;
  const diff = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`);
  if (!Number.isFinite(diff) || diff < 0) return null;
  return Math.floor(diff / DAY_MS);
}

/**
 * BR-RPT-03 / 14_Edge_Cases.md: buckets 0-7d, 8-30d, 31-90d, 90+d, lower bound
 * inclusive (day 30 lands in 8-30, day 31 in 31-90). Outstanding per invoice =
 * total minus attributed payments (the gateway's paid_amount_minor); settled
 * rows (≤ 1 paise tolerance per BR-FEE-05) and non-open statuses never age.
 */
export function agingFromInvoices(
  invoices: Array<Pick<StudentInvoiceRow, "due_date" | "total" | "status" | "paid_amount_minor">>,
  today: string,
): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { id: "d0_7", label: "Due within 7 days", invoices: 0, outstandingPaise: 0 },
    { id: "d8_30", label: "8 to 30 days overdue", invoices: 0, outstandingPaise: 0 },
    { id: "d31_90", label: "31 to 90 days overdue", invoices: 0, outstandingPaise: 0 },
    { id: "d90_plus", label: "Over 90 days overdue", invoices: 0, outstandingPaise: 0 },
  ];
  for (const inv of invoices) {
    if (inv.status !== "unpaid" && inv.status !== "partial" && inv.status !== "overdue") continue;
    if (inv.due_date === null) continue;
    const days = daysOverdue(inv.due_date, today);
    if (days === null) continue;
    const outstanding = paiseSub(inv.total, inv.paid_amount_minor);
    if (outstanding <= 1) continue;
    const slot = days <= 7 ? buckets[0] : days <= 30 ? buckets[1] : days <= 90 ? buckets[2] : buckets[3];
    if (slot === undefined) continue;
    slot.invoices += 1;
    slot.outstandingPaise = paiseAdd(slot.outstandingPaise, outstanding);
  }
  return buckets;
}

/**
 * Per-student outstanding from the same invoice figures the aging view uses,
 * so the two panels can never disagree. Status mirrors the gateway analytics
 * vocabulary (paid ⊆ noDues is the gateway's invariant; here paid rows are
 * dropped because a defaulter list has nothing settled to show).
 */
export function defaultersFromInvoices(
  invoices: Array<Pick<StudentInvoiceRow, "student_id" | "total" | "status" | "paid_amount_minor">>,
  namesById: Map<string, string>,
  statusFilter: "all" | "paid" | "partial" | "unpaid",
  limit: number,
): { rows: DefaulterRow[]; truncated: boolean } {
  const outstandingByStudent = new Map<string, number>();
  const attributedByStudent = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status !== "unpaid" && inv.status !== "partial" && inv.status !== "overdue") continue;
    const owed = paiseSub(inv.total, inv.paid_amount_minor);
    if (owed <= 1) continue;
    outstandingByStudent.set(
      inv.student_id,
      paiseAdd(outstandingByStudent.get(inv.student_id) ?? 0, owed),
    );
    if (inv.paid_amount_minor > 0) attributedByStudent.set(inv.student_id, 1);
  }
  const rows: DefaulterRow[] = [];
  for (const [studentId, outstandingPaise] of outstandingByStudent) {
    const status = attributedByStudent.has(studentId) ? "partial" : "unpaid";
    if (statusFilter !== "all" && status !== statusFilter) continue;
    rows.push({
      studentId,
      name: namesById.get(studentId) ?? "Unnamed student",
      status,
      outstandingPaise,
    });
  }
  rows.sort((a, b) => b.outstandingPaise - a.outstandingPaise);
  const truncated = rows.length > limit;
  return { rows: rows.slice(0, limit), truncated };
}
