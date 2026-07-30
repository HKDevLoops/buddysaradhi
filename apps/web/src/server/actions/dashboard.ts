"use server";

import { gatewayGet } from "@/server/get-db";
import { log } from "@/lib/logger";

export type DashboardKpis = {
  totalStudents: number;
  studentsWithDues: number;
  collectedThisMonthMinor: number;
  dueTillDateMinor: number;
  dueForMonthMinor: number;
  overdueMinor: number;
  paymentBreakdown: { paid: number; partial: number; unpaid: number; noDues: number };
};

export type DashboardActivityItem = {
  id: string;
  event_type: "PAYMENT" | "INVOICE" | "ATTENDANCE_LOCKED" | "STUDENT_ENROLLED" | "OTHER";
  student_name: string;
  invoice_number?: string | null;
  minor_amount: number;
  additional_data?: string | null;
  timestamp: string;
};

export type DashboardDueTodayItem = {
  student_id: string;
  student_name: string;
  due_minor: number;
  invoice_number?: string | null;
  due_date?: string | null;
};

export type DashboardSummary = {
  kpis: DashboardKpis;
  activity: DashboardActivityItem[];
  dueToday: DashboardDueTodayItem[];
  dataOrigin: "live" | "stub";
};

export async function fetchDashboardSummaryAction(): Promise<
  { ok: true; value: DashboardSummary } | { ok: false; error: string; code: string }
> {
  try {
    const res = await gatewayGet<DashboardSummary>("/api/v1/analytics/dashboard");
    if (!res.success) {
      log.error("dashboard_summary_gateway_failed", res.error, { path: "/api/v1/analytics/dashboard" });
      return { ok: false, error: res.error, code: "GATEWAY_ERROR" };
    }
    return { ok: true, value: res.data };
  } catch (error) {
    log.error("dashboard_summary_failed", error instanceof Error ? error.message : String(error));
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown dashboard error",
      code: "DASHBOARD_FETCH_FAILED",
    };
  }
}
