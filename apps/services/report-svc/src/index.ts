import { Elysia } from "elysia";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

export const app = new Elysia()
  .group("/api/v1/reports/dashboard", (app) =>
    app
      .get("/kpis", async ({ request, query }) => {
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing AuthZ", { status: 401 });

        const { periodStartIso } = query as Record<string, string>;
        if (!periodStartIso) return new Response("Missing periodStartIso", { status: 400 });

        try {
          const periodStart = new Date(periodStartIso);
          const monthStart = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1).toISOString();
          const monthEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

          const [
            totalStudents,
            collectedThisMonthAgg,
            dueForMonthAgg,
            balanceAgg,
            studentsWithDues,
            studentsWithBalance,
            invoiceGroups,
            paidInvoicesGroups
          ] = await Promise.all([
            db.student.count({
              where: { tenantId: tutorId, status: 'active', archivedAt: null }
            }),
            db.ledgerEntry.aggregate({
              _sum: { creditPaise: true },
              where: {
                tenantId: tutorId,
                type: 'PAYMENT_RECEIVED',
                voidOfId: null,
                occurredOn: { gte: monthStart, lte: monthEnd },
              }
            }),
            db.invoice.aggregate({
              _sum: { total: true },
              where: {
                tenantId: tutorId,
                issueDate: { gte: monthStart, lte: monthEnd },
                status: { in: ['unpaid', 'partial', 'overdue'] }
              }
            }),
            db.student.aggregate({
              _sum: { balancePaise: true },
              where: { tenantId: tutorId, status: 'active', archivedAt: null, balancePaise: { gt: 0 } }
            }),
            db.student.count({
              where: { tenantId: tutorId, status: 'active', archivedAt: null, balancePaise: { gt: 0 } }
            }),
            db.student.findMany({
              where: { tenantId: tutorId, status: 'active', archivedAt: null, balancePaise: { gt: 0 } },
              select: { id: true, balancePaise: true }
            }),
            db.invoice.groupBy({
              by: ['studentId'],
              _max: { total: true },
              where: { tenantId: tutorId, student: { status: 'active', archivedAt: null, balancePaise: { gt: 0 } } }
            }),
            db.invoice.groupBy({
               by: ['studentId'],
               where: { tenantId: tutorId, student: { status: 'active', archivedAt: null, balancePaise: { lte: 0 } } }
            })
          ]);

          const collectedThisMonthMinor = Number(collectedThisMonthAgg._sum.creditPaise || 0);
          const dueForMonthMinor = Number(dueForMonthAgg._sum.total || 0);
          const dueTillDateMinor = Number(balanceAgg._sum.balancePaise || 0);

          const maxInvoices: Record<string, number> = {};
          for (const g of invoiceGroups) {
            maxInvoices[g.studentId] = Number(g._max.total || 0);
          }

          let partial = 0;
          let unpaid = 0;

          for (const s of studentsWithBalance) {
            const balance = Number(s.balancePaise);
            const maxTotal = maxInvoices[s.id] || 0;
            if (balance < maxTotal && maxTotal > 0) {
              partial++;
            } else {
              unpaid++;
            }
          }

          const paid = paidInvoicesGroups.length;
          const noDues = Math.max(0, totalStudents - paid - partial - unpaid);

          return {
            success: true,
            data: {
              collectedThisMonthMinor,
              dueTillDateMinor,
              dueForMonthMinor,
              totalStudents,
              studentsWithDues,
              paymentBreakdown: { paid, partial, unpaid, noDues },
            }
          };
        } catch (error) {
          console.error("Dashboard KPI failed:", error);
          return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500, headers: { 'Content-Type': 'application/json' }});
        }
      })
      .get("/feed", async ({ request }) => {
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing AuthZ", { status: 401 });

        // Extracted getDashboardFeed implementation
        try {
          const events = await db.auditLog.findMany({
            where: { tenantId: tutorId },
            orderBy: { createdAt: 'desc' },
            take: 20
          });
          
          return {
            success: true,
            data: events.map((e) => ({
              id: e.id,
              type: e.action,
              title: `${e.entityType} ${e.action}`,
              description: e.details,
              timestamp: e.createdAt.toISOString()
            }))
          };
        } catch (error) {
          console.error("Dashboard Feed failed:", error);
          return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500, headers: { 'Content-Type': 'application/json' }});
        }
      })
      .get("/due-today", async ({ request }) => {
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing AuthZ", { status: 401 });

        const today = new Date().toISOString().slice(0, 10);

        try {
          const rows = await db.invoice.findMany({
            where: {
              tenantId: tutorId,
              dueDate: today,
              status: { in: ["unpaid", "partial", "overdue"] },
            },
            include: {
              student: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
            orderBy: { createdAt: "desc" },
            take: 20,
          });

          return {
            success: true,
            data: rows.map((row) => ({
              student_id: row.studentId,
              student_name: [row.student.firstName, row.student.lastName]
                .filter(Boolean)
                .join(" "),
              due_minor: row.total,
              invoice_number: row.number,
              due_date: row.dueDate,
            })),
          };
        } catch (error) {
          console.error("Dashboard due-today failed:", error);
          return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      })
      .get("/heatmaps", async ({ request, query }) => {
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing AuthZ", { status: 401 });

        const { periodStartIso, periodEndIso } = query as Record<string, string>;
        if (!periodStartIso || !periodEndIso) return new Response("Missing dates", { status: 400 });
        
        try {
          const attendanceRes = await db.$queryRaw`
            SELECT
              ar.student_id,
              s.first_name || ' ' || COALESCE(s.last_name,'') AS student_name,
              sess.session_date,
              ar.status
            FROM attendance_records ar
            JOIN attendance_sessions sess ON sess.id = ar.session_id
            JOIN students s ON s.id = ar.student_id
            WHERE sess.tenant_id = ${tutorId}
              AND sess.session_date BETWEEN ${periodStartIso} AND ${periodEndIso}
              AND ar.status <> 'holiday'
            ORDER BY s.first_name, sess.session_date;
          `;

          const holidaysRes = await db.$queryRaw`
            SELECT session_date, batch_id FROM attendance_sessions
            WHERE tenant_id = ${tutorId}
              AND locked_at IS NOT NULL
              AND session_date BETWEEN ${periodStartIso} AND ${periodEndIso}
              AND NOT EXISTS (
                SELECT 1 FROM attendance_records ar WHERE ar.session_id = attendance_sessions.id
              )
              AND EXISTS (SELECT 1 FROM batches b WHERE b.id = attendance_sessions.batch_id
                          AND b.archived_at IS NULL);
          `;

          const financialRes = await db.$queryRaw`
            WITH weekly AS (
              SELECT
                i.student_id,
                s.first_name || ' ' || COALESCE(s.last_name,'') AS student_name,
                date(i.issue_date, 'weekday 0', '-6 days') AS week_start,
                i.id AS invoice_id,
                i.total,
                (SELECT COALESCE(SUM(amount),0) FROM ledger_entries le
                   WHERE le.invoice_id = i.id
                     AND le.type = 'PAYMENT_RECEIVED'
                     AND le.direction = 'credit'
                     AND le.type <> 'VOID'
                     AND le.reverses_entry_id IS NULL) AS paid_minor
              FROM invoices i
              JOIN students s ON s.id = i.student_id
              WHERE i.tenant_id = ${tutorId}
                AND i.issue_date BETWEEN ${periodStartIso} AND ${periodEndIso}
                AND i.status <> 'void'
            )
            SELECT
              student_id, student_name, week_start,
              COUNT(*) AS invoice_count,
              SUM(total) AS due_minor,
              SUM(paid_minor) AS paid_minor,
              CASE
                WHEN SUM(paid_minor) >= SUM(total) - 1              THEN 'paid'
                WHEN SUM(paid_minor) > 0                            THEN 'partial'
                WHEN SUM(paid_minor) = 0 AND SUM(total) > 0         THEN 'unpaid'
                ELSE 'no_due'
              END AS cell_status
            FROM weekly
            GROUP BY student_id, week_start
            ORDER BY student_name, week_start;
          `;

          return {
            success: true,
            data: {
              attendance: { records: attendanceRes, holidays: holidaysRes },
              financial: financialRes
            }
          };
        } catch (error) {
          console.error("Dashboard Heatmaps failed:", error);
          return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500, headers: { 'Content-Type': 'application/json' }});
        }
      })
  );

// Start server if main module
if (import.meta.main) {
  app.listen(3035);
  console.log(`🦊 report-svc is running at ${app.server?.hostname}:${app.server?.port}`);
}
