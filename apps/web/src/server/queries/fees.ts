// Implements: 07_Fees_and_Payments.md §2 — student fee list with live balance
// All reads go through the API Gateway → ledger-svc. No direct Prisma.
"use server";
import { cache } from "react";
import { gatewayGet } from "@/server/get-db";

export const getStudentsForFees = cache(async (searchQuery?: string) => {
  const res = await gatewayGet<Array<{
    id: string;
    name: string;
    code: string | null;
    fee_model: string;
    balance_due: number;
    grade?: string;
    batch?: string | null;
  }>>(
    "/api/v1/ledger/fees",
    searchQuery ? { search: searchQuery } : undefined
  );

  if (!res.success) return { success: false, data: [], error: res.error };
  return { success: true, data: res.data };
});

export const getLedgerForStudent = cache(async (studentId: string) => {
  const res = await gatewayGet<Array<{
    id: string;
    type: string;
    debit: number;
    credit: number;
    occurred_on: string;
    receipt_no: string | null;
    description: string | null;
    isVoid: boolean;
    this_hash: string | null;
  }>>(
    "/api/v1/ledger",
    { studentId, limit: "200" }
  );

  if (!res.success) return { success: false, data: [], error: res.error };
  return { success: true, data: res.data };
});
