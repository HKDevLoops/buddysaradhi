import type { RouteHandler } from "./students.ts";
import { ok } from "../lib/errors.ts";
import { getCached, setCache } from "../lib/cache.ts";
import { createPrismaOrm } from "../lib/orm.ts";

export const handleAnalytics: RouteHandler = async (_req, db, tenantId, path, method, url) => {
  const orm = createPrismaOrm(db, tenantId);

  // GET /api/v1/analytics/dashboard
  if (path === "/api/v1/analytics/dashboard" && method === "GET") {
    const sp = url.searchParams;
    const periodStart =
      sp.get("periodStartIso") ?? new Date(new Date().setDate(1)).toISOString().slice(0, 10);
    const now = new Date();
    const periodEnd = sp.get("periodEndIso") ?? now.toISOString().slice(0, 10);

    const cacheKey = `analytics:dashboard:${tenantId}:${periodStart}:${periodEnd}`;
    const cached = getCached(cacheKey);
    if (cached) return ok(cached);

    const [activeStudents, payments, invs] = await Promise.all([
      orm.student.findMany({
        where: { status: "active", archivedAt: null },
      }),
      orm.ledgerEntry.findMany({
        where: { type: "PAYMENT_RECEIVED" },
      }),
      orm.invoice.findMany({
        where: {},
      }),
    ]);

    const totalStudents = activeStudents.length;
    const dues = activeStudents.filter((s) => Number(s.balancePaise ?? 0) > 0);
    const dueTill = dues.reduce((a, s) => a + Number(s.balancePaise ?? 0), 0);
    const collected = payments.reduce((a, p) => a + Number(p.creditPaise ?? 0), 0);
    const dueForMonth = invs
      .filter((i) => i.status !== "paid")
      .reduce((a, i) => a + Number(i.total ?? 0), 0);
    const overdueMinor = Math.max(0, dueTill - collected);

    const kpis = {
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

    const limit = 20;
    const [ledger, notifs] = await Promise.all([
      orm.ledgerEntry.findMany({
        orderBy: { occurredOn: "desc" },
        take: limit,
      }),
      orm.notification.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
    ]);

    const activity = [
      ...notifs.map((n) => ({
        id: n.id,
        event_type: "OTHER",
        student_name: n.title,
        invoice_number: null,
        minor_amount: 0,
        additional_data: n.body,
        timestamp: n.createdAt,
      })),
      ...ledger.map((e) => ({
        id: e.id,
        event_type:
          e.type === "PAYMENT_RECEIVED"
            ? "PAYMENT"
            : e.type === "FEE_CHARGED"
              ? "INVOICE"
              : "OTHER",
        student_name: e.description || e.type,
        invoice_number: e.invoiceId ?? null,
        minor_amount: e.creditPaise ?? e.debitPaise ?? 0,
        additional_data: e.receiptNo ?? null,
        timestamp: e.occurredOn,
      })),
    ]
      .sort((a, b) => new Date(String(b.timestamp)).getTime() - new Date(String(a.timestamp)).getTime())
      .slice(0, limit);

    const today = new Date().toISOString().slice(0, 10);
    const dueInvoices = await orm.invoice.findMany({
      where: {},
      take: 50,
    });

    const dueTodayInvoices = dueInvoices.filter(
      (inv) => inv.status !== "paid" && inv.dueDate && inv.dueDate <= today,
    );

    const dueToday = dueTodayInvoices.map((inv) => ({
      student_id: inv.studentId,
      student_name: "Student",
      due_minor: Number(inv.total ?? 0),
      invoice_number: inv.number,
      due_date: inv.dueDate,
    }));

    const result = { kpis, activity, dueToday, dataOrigin: "live" };
    setCache(cacheKey, result, 15_000);
    return ok(result);
  }

  return null;
};
