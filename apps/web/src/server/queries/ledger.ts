// Implements: 05_Students.md §6 — ledger and invoices for student profile
// All reads go through the API Gateway → ledger-svc. No direct Prisma.
// web/02_State_and_Data_Flow.md §3.2 (ledger: request-scoped only via React cache() —
// NEVER tenant-cached); 02_Core_Logic.md §9; docs/rfc/003-saas-overhaul.md
// workstream C + §0 (concurrent reads, 12s bounds, typed errors).
"use server";
import { cache } from "react";
import { gatewayGet } from "@/server/get-db";
import { QUERY_TIMEOUT_MS, toTypedQueryError, withQueryTimeout } from "@/server/cache";
import { log } from "@/lib/logger";

export interface StudentLedgerRow {
  id: string;
  tenant_id: string;
  student_id: string;
  type: string;
  debit: number;
  credit: number;
  balance_after: number;
  method: string | null;
  description: string | null;
  occurred_on: string;
  invoice_id: string | null;
  receipt_no: string | null;
  reverses_entry_id: string | null;
  this_hash: string | null;
}

export interface StudentInvoiceRow {
  id: string;
  tenant_id: string;
  number: string;
  student_id: string;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  total: number;
  status: string;
  paid_amount_minor: number;
}

export const getStudentLedger = cache(async (studentId: string) => {
  try {
    const res = await withQueryTimeout(
      gatewayGet<StudentLedgerRow[]>("/api/v1/ledger", { studentId, limit: "100" }),
      QUERY_TIMEOUT_MS,
    );

    if (!res.success) throw new Error(res.error);
    return {
      success: true as const,
      data: res.data.map((entry) => ({
        ...entry,
        amount: entry.credit || entry.debit,
        created_at: entry.occurred_on,
      })),
    };
  } catch (err) {
    const typed = toTypedQueryError(err);
    log.error("student_ledger_failed", typed, { studentId });
    return { success: false as const, data: [], error: typed };
  }
});

export const getStudentInvoices = cache(async (studentId: string) => {
  try {
    const res = await withQueryTimeout(
      gatewayGet<StudentInvoiceRow[]>("/api/v1/ledger/invoices", { studentId }),
      QUERY_TIMEOUT_MS,
    );

    if (!res.success) throw new Error(res.error);
    return { success: true as const, data: res.data };
  } catch (err) {
    const typed = toTypedQueryError(err);
    log.error("student_invoices_failed", typed, { studentId });
    return { success: false as const, data: [], error: typed };
  }
});

/**
 * Student-profile fan-out: ledger + invoices concurrently.
 * BEFORE (callers): `await getStudentLedger(id)` then `await getStudentInvoices(id)` —
 * 2 sequential gateway round trips. AFTER: one Promise.all wave, same payloads.
 * Each leg keeps its own 12s bound, so the wave is bounded by the slowest leg.
 */
export const getStudentFeesOverview = cache(async (studentId: string) => {
  const [ledger, invoices] = await Promise.all([
    getStudentLedger(studentId),
    getStudentInvoices(studentId),
  ]);
  if (!ledger.success) return { success: false as const, error: ledger.error };
  if (!invoices.success) return { success: false as const, error: invoices.error };
  return { success: true as const, data: { ledger: ledger.data, invoices: invoices.data } };
});
