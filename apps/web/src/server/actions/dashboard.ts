"use server";

import { getDashboardKPIs } from "../queries/dashboard";
import { getAttendanceHeatmap, getPaymentHeatmap } from "../queries/dashboard-heatmaps";
import { getActivityFeed, getDueToday } from "../queries/dashboard-feed";


// Helper for other periods if needed, but KPIs query calculates it via SQL
function resolvePeriodBounds(period: string) {
  const end = new Date();
  const start = new Date();
  if (period === "this_month") start.setDate(1);
  else if (period === "last_month") {
    start.setMonth(start.getMonth() - 1);
    start.setDate(1);
    end.setDate(0); // last day of prev month
  }
  else if (period === "this_quarter") {
    start.setMonth(Math.floor(start.getMonth() / 3) * 3);
    start.setDate(1);
  } else {
    // all time or default fallback to last 90 days
    start.setDate(start.getDate() - 90);
  }
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export async function fetchDashboardKPIsAction(periodStartIso: string) {
    const res = await getDashboardKPIs(periodStartIso);
  if (!res.success) {
    return { ok: false as const, error: { code: "DB_ERROR", message: res.error } };
  }
  return { ok: true as const, value: res.data };
}

export async function fetchAttendanceHeatmapAction(period: string = "this_month") {
    const { startIso, endIso } = resolvePeriodBounds(period);
  return getAttendanceHeatmap(startIso, endIso);
}

export async function fetchPaymentHeatmapAction(period: string = "this_month") {
    const { startIso, endIso } = resolvePeriodBounds(period);
  return getPaymentHeatmap(startIso, endIso);
}

export async function fetchActivityFeedAction(limit: number = 20) {
    return getActivityFeed(limit);
}

export async function fetchDueTodayAction() {
    return getDueToday();
}
