import type { RouteHandler } from "./students.ts";
import { allRows } from "../lib/db.ts";
import { ok } from "../lib/errors.ts";
import { getCached, setCache } from "../lib/cache.ts";

function studentName(r: Record<string, unknown>): string {
  return [r.first_name, r.last_name].filter(Boolean).join(" ");
}

export const handleAnalytics: RouteHandler = async (_req, db, tenantId, path, method, url) => {
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

    const [active, payments, invs] = await Promise.all([
      allRows(
        db,
        "SELECT balance_paise FROM students WHERE tenant_id = ? AND status = 'active' AND archived_at IS NULL",
        [tenantId],
      ),
      allRows(
        db,
        "SELECT credit_paise FROM ledger_entries WHERE tenant_id = ? AND type = 'PAYMENT_RECEIVED' AND occurred_on >= ?",
        [tenantId, periodStart],
      ),
      allRows(
        db,
        "SELECT total, status, due_date FROM invoices WHERE tenant_id = ? AND due_date >= ?",
        [tenantId, periodStart],
      ),
    ]);
    const totalStudents = active.length;
    const dues = active.filter((s) => Number(s.balance_paise) > 0);
    const dueTill = dues.reduce((a, s) => a + Number(s.balance_paise), 0);
    const collected = payments.reduce((a, p) => a + Number(p.credit_paise ?? 0), 0);
    const dueForMonth = invs
      .filter((i) => i.status !== "paid")
      .reduce((a, i) => a + Number(i.total), 0);
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
      allRows(
        db,
        `SELECT id, type, credit_paise, occurred_on, student_id, receipt_no, description
         FROM ledger_entries WHERE tenant_id = ? ORDER BY occurred_on DESC LIMIT ?`,
        [tenantId, limit],
      ),
      allRows(
        db,
        "SELECT id, title, body, created_at FROM notifications WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?",
        [tenantId, limit],
      ),
    ]);
    const activity = [
      ...notifs.map((n) => ({
        id: n.id,
        event_type: "OTHER",
        student_name: n.title,
        invoice_number: null,
        minor_amount: 0,
        additional_data: n.body,
        timestamp: n.created_at,
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
        invoice_number: e.invoice_id ?? null,
        minor_amount: e.credit_paise ?? e.debit_paise ?? 0,
        additional_data: e.receipt_no ?? null,
        timestamp: e.occurred_on,
      })),
    ]
      .sort((a, b) => new Date(String(b.timestamp)).getTime() - new Date(String(a.timestamp)).getTime())
      .slice(0, limit);

    const today = new Date().toISOString().slice(0, 10);
    const dueTodayInvoices = await allRows(
      db,
      `SELECT i.*, s.first_name, s.last_name FROM invoices i
       JOIN students s ON s.id = i.student_id
       WHERE i.tenant_id = ? AND i.status IN ('unpaid','partial','overdue') AND i.due_date <= ?
       ORDER BY i.due_date ASC`,
      [tenantId, today],
    );
    const invoiceIds = dueTodayInvoices.map((i) => i.id);
    const paidAmounts = invoiceIds.length
      ? await allRows(
          db,
          `SELECT invoice_id, COALESCE(SUM(credit_paise), 0) AS paid
           FROM ledger_entries
           WHERE tenant_id = ? AND invoice_id IN (${invoiceIds.map(() => "?").join(",")}) AND credit_paise > 0
           GROUP BY invoice_id`,
          [tenantId, ...invoiceIds],
        )
      : [];
    const paidMap = new Map(paidAmounts.map((p) => [p.invoice_id as string, Number(p.paid)]));

    const dueToday = dueTodayInvoices.map((inv) => ({
      student_id: inv.student_id,
      student_name: studentName(inv),
      due_minor: Number(inv.total) - (paidMap.get(inv.id as string) ?? 0),
      invoice_number: inv.number,
      due_date: inv.due_date,
    }));

    const result = { kpis, activity, dueToday, dataOrigin: "live" };
    setCache(cacheKey, result, 15_000);
    return ok(result);
  }

  return null;
};
