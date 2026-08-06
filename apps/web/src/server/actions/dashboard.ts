"use server";

import { gatewayGet, getAuthenticatedDb, createLibsqlProxy } from "@/server/get-db";
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
    if (res.success) {
      return { ok: true, value: res.data };
    }

    // Gateway failed — fall back to direct DB
    log.warn("dashboard_summary_gateway_failed_fallback", res.error);
    const summary = await computeDashboardFromDb();
    return { ok: true, value: summary };
  } catch (error) {
    log.error("dashboard_summary_failed", error instanceof Error ? error.message : String(error));
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown dashboard error",
      code: "DASHBOARD_FETCH_FAILED",
    };
  }
}

/**
 * Direct-DB fallback that mirrors the gateway analytics logic.
 * Used when gateway is unreachable or user has no Turso credentials.
 */
async function computeDashboardFromDb(): Promise<DashboardSummary> {
  const { client, tenantId } = await getAuthenticatedDb();
  const proxy = createLibsqlProxy(client);

  // 1. Active students
  const activeStudents = await proxy.student.findMany({
    where: { tenantId, status: "active" },
  });

  // 2. Payment entries (ledger)
  const payments = await proxy.ledgerEntry.findMany({
    where: { tenantId, type: "PAYMENT_RECEIVED" },
  });

  // 3. Invoices
  const invs = await proxy.invoice.findMany({
    where: { tenantId },
  });

  // 4. Compute KPIs
  const totalStudents = activeStudents.length;
  const dues = activeStudents.filter((s: any) => Number(s.balancePaise ?? 0) > 0);
  const dueTill = dues.reduce((a: number, s: any) => a + Number(s.balancePaise ?? 0), 0);
  const collected = payments.reduce((a: number, p: any) => a + Number(p.creditPaise ?? 0), 0);
  const dueForMonth = invs
    .filter((i: any) => i.status !== "paid")
    .reduce((a: number, i: any) => a + Number(i.total ?? 0), 0);
  const overdueMinor = Math.max(0, dueTill - collected);

  const kpis: DashboardKpis = {
    totalStudents,
    studentsWithDues: dues.length,
    collectedThisMonthMinor: collected,
    dueTillDateMinor: dueTill,
    dueForMonthMinor: dueForMonth,
    overdueMinor,
    paymentBreakdown: {
      paid: totalStudents - dues.length,
      partial: dues.length,
      unpaid: 0,
      noDues: totalStudents - dues.length,
    },
  };

  // 5. Activity feed (recent ledger + notifications)
  const limit = 20;
  const [ledger, notifs] = await Promise.all([
    proxy.ledgerEntry.findMany({
      where: { tenantId },
      orderBy: { occurredOn: "desc" },
      take: limit,
    }),
    proxy.notification.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  const activity: DashboardActivityItem[] = [
    ...notifs.map((n: any) => ({
      id: n.id,
      event_type: "OTHER" as const,
      student_name: n.title,
      invoice_number: null,
      minor_amount: 0,
      additional_data: n.body,
      timestamp: String(n.createdAt),
    })),
    ...ledger.map((e: any) => ({
      id: e.id,
      event_type:
        e.type === "PAYMENT_RECEIVED"
          ? ("PAYMENT" as const)
          : e.type === "FEE_CHARGED"
            ? ("INVOICE" as const)
            : ("OTHER" as const),
      student_name: e.description || e.type,
      invoice_number: e.invoiceId ?? null,
      minor_amount: Number(e.creditPaise ?? e.debitPaise ?? 0),
      additional_data: e.receiptNo ?? null,
      timestamp: String(e.occurredOn),
    })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);

  // 6. Due today
  const today = new Date().toISOString().slice(0, 10);
  const dueInvoices = invs.filter(
    (i: any) => i.status !== "paid" && i.dueDate && String(i.dueDate) <= today,
  );
  const dueToday: DashboardDueTodayItem[] = dueInvoices.map((inv: any) => ({
    student_id: inv.studentId,
    student_name: "Student",
    due_minor: Number(inv.total ?? 0),
    invoice_number: inv.number,
    due_date: inv.dueDate ? String(inv.dueDate) : null,
  }));

  return { kpis, activity, dueToday, dataOrigin: "live" };
}
