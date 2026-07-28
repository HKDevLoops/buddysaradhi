import type { Hono } from "hono";
import { ok, getContext } from "../lib/respond";

export function registerAnalytics(app: Hono) {
  app.get("/api/v1/analytics/dashboard", async (c) => {
    const { db, tenantId } = getContext(c);
    const periodStart =
      c.req.query("periodStartIso") ||
      new Date(new Date().setDate(1)).toISOString();

    // KPIs - total students
    const totalStudents = await db.student.count({
      where: { tenantId, status: "active", archivedAt: null },
    });
    
    const studentsWithDues = await db.student.count({
      where: { tenantId, status: "active", archivedAt: null, balancePaise: { gt: 0 } },
    });

    // Collected this month
    const collected = await db.ledgerEntry.aggregate({
      where: { tenantId, type: "PAYMENT_RECEIVED", occurredOn: { gte: periodStart } },
      _sum: { creditPaise: true },
    });
    const collectedThisMonthMinor = collected._sum.creditPaise ?? 0;

    // Due till date
    const dueAgg = await db.student.aggregate({
      where: { tenantId, status: "active", archivedAt: null, balancePaise: { gt: 0 } },
      _sum: { balancePaise: true },
    });
    const dueTillDateMinor = dueAgg._sum.balancePaise ?? 0;

    // Due for month (from invoices)
    const dueForMonth = await db.invoice.aggregate({
      where: {
        tenantId,
        status: { in: ["unpaid", "partial", "overdue"] },
        dueDate: { gte: periodStart.slice(0, 10) },
      },
      _sum: { total: true },
    });
    const dueForMonthMinor = dueForMonth._sum.total ?? 0;

    // Overdue calculation
    const overdueMinor = Math.max(0, dueTillDateMinor - collectedThisMonthMinor);

    // Payment breakdown
    const invStatus = await db.invoice.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { _all: true },
    });
    const statusCount = (st: string) =>
      invStatus.find((x: any) => x.status === st)?._count._all ?? 0;

    const kpis = {
      totalStudents,
      studentsWithDues,
      collectedThisMonthMinor,
      dueTillDateMinor,
      dueForMonthMinor,
      overdueMinor,
      paymentBreakdown: {
        paid: statusCount("paid"),
        partial: statusCount("partial"),
        unpaid: statusCount("unpaid"),
        noDues: totalStudents - studentsWithDues,
      },
    };

    // Activity feed - combine notifications and ledger entries
    const limit = 20;
    const notifs = await db.notification.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const ledger = await db.ledgerEntry.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const activity = [
      ...notifs.map((n: any) => ({
        id: n.id,
        event_type: "OTHER" as const,
        student_name: n.title,
        invoice_number: null,
        minor_amount: 0,
        additional_data: n.body,
        timestamp: n.createdAt,
      })),
      ...ledger.map((e: any) => ({
        id: e.id,
        event_type: e.type === "PAYMENT_RECEIVED" ? "PAYMENT" : e.type === "FEE_CHARGED" ? "INVOICE" : "OTHER" as const,
        student_name: e.description || e.type,
        invoice_number: e.invoiceId ?? null,
        minor_amount: e.creditPaise ?? e.debitPaise ?? 0,
        additional_data: e.receiptNo ?? null,
        timestamp: e.createdAt,
      })),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);

    // Due today
    const today = new Date().toISOString().slice(0, 10);
    const invoices = await db.invoice.findMany({
      where: {
        tenantId,
        status: { in: ["unpaid", "partial", "overdue"] },
        dueDate: { lte: today },
      },
      orderBy: { dueDate: "asc" },
    });
    const studentIds = invoices.map((inv: any) => inv.studentId).filter(Boolean);
    const students = studentIds.length > 0 ? await db.student.findMany({
      where: { tenantId, id: { in: studentIds } },
    }) : [];
    const studentMap = new Map<string, any>((students as any[]).map((s) => [s.id, s]));

    const dueToday = await Promise.all(
      invoices.map(async (inv: any) => {
        const paid = await db.ledgerEntry.aggregate({
          where: { tenantId, invoiceId: inv.id, creditPaise: { gt: 0 } },
          _sum: { creditPaise: true },
        });
        const student = studentMap.get(inv.studentId);
        const student_name = student
          ? [student.firstName, student.lastName].filter(Boolean).join(" ")
          : "Unknown Student";
        return {
          student_id: inv.studentId,
          student_name,
          due_minor: inv.total - (paid._sum.creditPaise ?? 0),
          invoice_number: inv.number,
          due_date: inv.dueDate,
        };
      })
    );

    return ok(c, {
      kpis,
      activity,
      dueToday,
      dataOrigin: "live" as const,
    });
  });
}
