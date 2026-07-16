import type { Hono } from "hono";
import { ok, getContext } from "../lib/respond";
import { buildHeatmap } from "../lib/heatmap";

export function registerReports(app: Hono) {
  app.get("/api/v1/reports/dashboard/kpis", async (c) => {
    const { db, tenantId } = getContext(c);
    const periodStart =
      c.req.query("periodStartIso") ||
      new Date(new Date().setDate(1)).toISOString();

    const totalStudents = await db.student.count({
      where: { tenantId, status: "active", archivedAt: null },
    });
    const studentsWithDues = await db.student.count({
      where: { tenantId, status: "active", archivedAt: null, balancePaise: { gt: 0 } },
    });

    const collected = await db.ledgerEntry.aggregate({
      where: { tenantId, type: "PAYMENT_RECEIVED", occurredOn: { gte: periodStart } },
      _sum: { creditPaise: true },
    });
    const collectedThisMonthMinor = collected._sum.creditPaise ?? 0;

    const dueAgg = await db.student.aggregate({
      where: { tenantId, status: "active", archivedAt: null, balancePaise: { gt: 0 } },
      _sum: { balancePaise: true },
    });
    const dueTillDateMinor = dueAgg._sum.balancePaise ?? 0;

    const dueForMonth = await db.invoice.aggregate({
      where: {
        tenantId,
        status: { in: ["unpaid", "partial", "overdue"] },
        dueDate: { gte: periodStart.slice(0, 10) },
      },
      _sum: { total: true },
    });
    const dueForMonthMinor = dueForMonth._sum.total ?? 0;

    const invStatus = await db.invoice.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { _all: true },
    });
    const statusCount = (st: string) =>
      invStatus.find((x: any) => x.status === st)?._count._all ?? 0;

    return ok(c, {
      totalStudents,
      studentsWithDues,
      collectedThisMonthMinor,
      dueTillDateMinor,
      dueForMonthMinor,
      paymentBreakdown: {
        paid: statusCount("paid"),
        partial: statusCount("partial"),
        unpaid: statusCount("unpaid"),
        noDues: totalStudents - studentsWithDues,
      },
    });
  });

  app.get("/api/v1/reports/dashboard/feed", async (c) => {
    const { db, tenantId } = getContext(c);
    const limit = Math.min(50, parseInt(c.req.query("limit") || "20", 10) || 20);

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

    const items: any[] = [
      ...notifs.map((n: any) => ({
        id: n.id,
        type: "notification",
        title: n.title,
        description: n.body,
        timestamp: n.createdAt,
      })),
      ...ledger.map((e: any) => ({
        id: e.id,
        type: e.type,
        title: e.description || e.type,
        description: `₹${e.creditPaise + e.debitPaise}`,
        timestamp: e.createdAt,
      })),
    ];
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return ok(c, items.slice(0, limit));
  });

  app.get("/api/v1/reports/dashboard/due-today", async (c) => {
    const { db, tenantId } = getContext(c);
    const today = new Date().toISOString().slice(0, 10);
    const invoices = await db.invoice.findMany({
      where: {
        tenantId,
        status: { in: ["unpaid", "partial", "overdue"] },
        dueDate: { lte: today },
      },
      include: { student: true },
      orderBy: { dueDate: "asc" },
    });
    const data = await Promise.all(
      invoices.map(async (inv: any) => {
        const paid = await db.ledgerEntry.aggregate({
          where: { tenantId, invoiceId: inv.id, creditPaise: { gt: 0 } },
          _sum: { creditPaise: true },
        });
        return {
          student_id: inv.studentId,
          student_name: [inv.student.firstName, inv.student.lastName]
            .filter(Boolean)
            .join(" "),
          due_minor: inv.total - (paid._sum.creditPaise ?? 0),
          invoice_number: inv.number,
          due_date: inv.dueDate,
        };
      })
    );
    return ok(c, data);
  });

  app.get("/api/v1/reports/dashboard/heatmaps", async (c) => {
    const { db, tenantId } = getContext(c);
    const start =
      c.req.query("periodStartIso") || new Date(new Date().setDate(1)).toISOString();
    const end = c.req.query("periodEndIso") || new Date().toISOString();
    const attendance = await buildHeatmap(db, tenantId, start, end, "dues");
    const financial = await buildHeatmap(db, tenantId, start, end, "financial");
    const setting = await db.setting.findUnique({
      where: { tenantId },
      select: { holidayListJson: true },
    });
    let holidays: any[] = [];
    try {
      holidays = JSON.parse(setting?.holidayListJson || "[]");
    } catch {
      holidays = [];
    }
    return ok(c, { attendance: { records: attendance, holidays }, financial });
  });
}
