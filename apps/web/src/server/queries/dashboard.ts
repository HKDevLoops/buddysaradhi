"use server";
import { gatewayGet } from "@/server/get-db";
import { log } from "@/lib/logger";

export type DashboardKpis = {
  totalStudents: number;
  studentsWithDues: number;
  collectedThisMonthMinor: number;
  dueTillDateMinor: number;
  dueForMonthMinor: number;
  paymentBreakdown: { paid: number; partial: number; unpaid: number; noDues: number };
};

export async function getDashboardKPIs(periodStartIso: string) {
  try {
    const res = await gatewayGet<DashboardKpis>("/api/v1/reports/dashboard/kpis", { periodStartIso });
    if (!res.success) return { success: false, data: null, error: res.error };
    return { success: true, data: res.data };
  } catch (error) {
    log.error('dashboard_query_failed', error instanceof Error ? error.message : String(error));
    return {
      success: false,
      data: null,
      error: error instanceof Error ? error.message : "Unknown gateway error"
    };
  }
}
