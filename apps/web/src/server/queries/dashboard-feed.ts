// Implements: 04_Dashboard.md §9 — activity feed and due-today reads
// All reads go through API Gateway → report-svc. No direct Prisma.
"use server";

import { gatewayGet } from "@/server/get-db";

type ReportFeedItem = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  timestamp: string;
};

type DueTodayItem = {
  student_id: string;
  student_name: string;
  due_minor: number;
  invoice_number: string | null;
  due_date: string | null;
};

export async function getActivityFeed(limit = 20) {
  try {
    const res = await gatewayGet<ReportFeedItem[]>(
      "/api/v1/reports/dashboard/feed",
      { limit: String(limit) }
    );

    if (!res.success) return { success: false, data: [], error: res.error };

    return {
      success: true,
      data: res.data.map((item) => ({
        event_type: item.type,
        minor_amount: 0,
        student_name: item.title,
        invoice_number: null,
        additional_data: item.description,
        timestamp: item.timestamp,
      })),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown gateway error",
    };
  }
}

export async function getDueToday() {
  try {
    const res = await gatewayGet<DueTodayItem[]>("/api/v1/reports/dashboard/due-today");
    if (!res.success) return { success: false, data: [], error: res.error };
    return { success: true, data: res.data };
  } catch (error) {
    return {
      success: false,
      data: [],
      error: error instanceof Error ? error.message : "Unknown gateway error",
    };
  }
}

export const getDashboardFeed = getActivityFeed;
