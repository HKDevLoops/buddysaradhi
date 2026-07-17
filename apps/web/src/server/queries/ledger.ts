// Implements: 05_Students.md §6 — ledger and invoices for student profile
// All reads go through the API Gateway → ledger-svc. No direct Prisma.
"use server";
import { cache } from "react";
import { gatewayGet } from "@/server/get-db";

export const getStudentLedger = cache(async (studentId: string) => {
  const res = await gatewayGet<Array<{
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
  }>>(
    "/api/v1/ledger",
    { studentId, limit: "100" }
  );

  if (!res.success) return { success: false, data: [], error: res.error };
  return {
    success: true,
    data: res.data.map((entry) => ({
      ...entry,
      amount: entry.credit || entry.debit,
      created_at: entry.occurred_on,
    })),
  };
});

export const getStudentInvoices = cache(async (studentId: string) => {
  const res = await gatewayGet<Array<{
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
  }>>(
    "/api/v1/ledger/invoices",
    { studentId }
  );

  if (!res.success) return { success: false, data: [], error: res.error };
  return { success: true, data: res.data };
});
