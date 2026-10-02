// Implements: 07_Fees_and_Payments.md §2 — student fee list with live balance
// All reads go through the API Gateway → ledger-svc. No direct Prisma.
// web/02_State_and_Data_Flow.md §3.2 (fees matrix: 30s stale — request-scoped only,
// NEVER tenant-cached: derived-live from the ledger); 02_Core_Logic.md §9;
// docs/rfc/003-saas-overhaul.md workstream C + §0 (12s bounds, typed errors).
"use server";
import { cache } from "react";
import { gatewayGet } from "@/server/get-db";
import { QUERY_TIMEOUT_MS, toTypedQueryError, withQueryTimeout } from "@/server/cache";
import { log } from "@/lib/logger";

export const getStudentsForFees = cache(async (searchQuery?: string) => {
  try {
    const res = await withQueryTimeout(
      gatewayGet<Array<{
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
      ),
      QUERY_TIMEOUT_MS,
    );

    if (!res.success) throw new Error(res.error);
    return { success: true as const, data: res.data };
  } catch (err) {
    const typed = toTypedQueryError(err);
    log.error("fees_list_failed", typed);
    return { success: false as const, data: [], error: typed };
  }
});

export const getLedgerForStudent = cache(async (studentId: string) => {
  try {
    const res = await withQueryTimeout(
      gatewayGet<Array<{
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
      ),
      QUERY_TIMEOUT_MS,
    );

    if (!res.success) throw new Error(res.error);
    return { success: true as const, data: res.data };
  } catch (err) {
    const typed = toTypedQueryError(err);
    log.error("fees_ledger_failed", typed, { studentId });
    return { success: false as const, data: [], error: typed };
  }
});
