"use server";
import { gatewayGet } from "@/server/get-db";

export async function getAttendanceHeatmap(periodStartIso: string, periodEndIso: string) {
  try {
    const res = await gatewayGet<{
      attendance: { records: unknown[]; holidays: unknown[] };
      financial: unknown[];
    }>("/api/v1/reports/dashboard/heatmaps", { periodStartIso, periodEndIso });

    if (!res.success) return { success: false, error: res.error };
    return { success: true, data: res.data.attendance };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "DB error" };
  }
}

export async function getPaymentHeatmap(periodStartIso: string, periodEndIso: string) {
  try {
    const res = await gatewayGet<{
      attendance: { records: unknown[]; holidays: unknown[] };
      financial: unknown[];
    }>("/api/v1/reports/dashboard/heatmaps", { periodStartIso, periodEndIso });

    if (!res.success) return { success: false, error: res.error };
    return { success: true, data: res.data.financial };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "DB error" };
  }
}
