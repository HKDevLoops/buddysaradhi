import { Elysia } from "elysia";
import { postLedgerEntry, voidEntry, computeBalance, LedgerEntryType } from "@buddysaradhi/core";
import { db } from "./db";

const PORT = process.env.PORT || 3031;

export const app = new Elysia()
  .get("/health", () => ({ status: "ok" }))

  // Ledger Routes
  .group("/api/v1/ledger", (app) =>
    app
      // List ledger entries for a student (with optional filters)
      .get("/", async ({ request }) => {
        const url = new URL(request.url);
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing X-Tutor-Id", { status: 401 });

        const studentId = url.searchParams.get("studentId");
        const since = url.searchParams.get("since");
        const limit = parseInt(url.searchParams.get("limit") || "100");

        const where: any = { tenantId: tutorId };
        if (studentId) where.studentId = studentId;
        if (since) where.occurredOn = { gte: since };

        const entries = await db.ledgerEntry.findMany({
          where,
          orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
          take: Math.min(limit, 500),
        });

        return {
          success: true,
          data: entries.map((row) => ({
            id: row.id,
            tenant_id: row.tenantId,
            student_id: row.studentId,
            type: row.type,
            debit: row.debitPaise,
            credit: row.creditPaise,
            balance_after: row.balanceAfterPaise,
            method: row.paymentMethod,
            description: row.description,
            occurred_on: row.occurredOn,
            invoice_id: row.invoiceId,
            receipt_no: row.receiptNo,
            reverses_entry_id: row.voidOfId,
            this_hash: row.thisHash,
          })),
        };
      })

      // Get student invoices with paid amounts
      .get("/invoices", async ({ request }) => {
        const url = new URL(request.url);
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing X-Tutor-Id", { status: 401 });

        const studentId = url.searchParams.get("studentId");
        if (!studentId) return new Response("Missing studentId", { status: 400 });

        const invoicesRaw = await db.invoice.findMany({
          where: { studentId, tenantId: tutorId },
          include: {
            ledgerEntries: {
              where: { type: "PAYMENT_RECEIVED", voidOfId: null },
            },
          },
          orderBy: { issueDate: "desc" },
          take: 200,
        });

        return {
          success: true,
          data: invoicesRaw.map((row) => {
            const paid = row.ledgerEntries.reduce(
              (acc, curr) => acc + curr.creditPaise,
              0
            );
            return {
              id: row.id,
              tenant_id: row.tenantId,
              number: row.number,
              student_id: row.studentId,
              issue_date: row.issueDate,
              due_date: row.dueDate,
              subtotal: row.subtotal,
              total: row.total,
              status: row.status,
              paid_amount_minor: paid,
            };
          }),
        };
      })

      // Get all active students with their computed live balance (for fees page)
      .get("/fees", async ({ request }) => {
        const url = new URL(request.url);
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing X-Tutor-Id", { status: 401 });

        const search = url.searchParams.get("search") || "";

        const [studentsRaw, ledgerGroups] = await Promise.all([
          db.student.findMany({
            where: {
              tenantId: tutorId,
              status: "active",
              ...(search
                ? {
                    OR: [
                      { firstName: { contains: search } },
                      { lastName: { contains: search } },
                      { code: { contains: search } },
                    ],
                  }
                : {}),
            },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              code: true,
              feeModel: true,
            },
            orderBy: { firstName: "asc" },
          }),
          db.ledgerEntry.groupBy({
            by: ["studentId"],
            _sum: { debitPaise: true, creditPaise: true },
            where: { tenantId: tutorId, type: { not: "VOID" }, voidOfId: null },
          }),
        ]);

        const balanceMap: Record<string, number> = {};
        for (const g of ledgerGroups) {
          const debit = Number(g._sum.debitPaise || 0);
          const credit = Number(g._sum.creditPaise || 0);
          balanceMap[g.studentId] = debit - credit;
        }

        return {
          success: true,
          data: studentsRaw.map((row) => ({
            id: row.id,
            name: [row.firstName, row.lastName].filter(Boolean).join(" "),
            code: row.code,
            fee_model: row.feeModel,
            balance_due: (balanceMap[row.id] || 0) / 100,
          })),
        };
      })

      // POST — create ledger entry
      .post("/", async ({ request, body }) => {
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing X-Tutor-Id", { status: 401 });

        const b = body as any;
        const kindToTypeMap: Record<string, LedgerEntryType> = {
          fee_due: "FEE_CHARGED",
          fee_paid: "PAYMENT_RECEIVED",
          discount: "DISCOUNT_GRANTED",
          refund: "REFUND_ISSUED",
        };

        const type = kindToTypeMap[b.kind];
        if (!type) return new Response("Invalid kind", { status: 400 });

        let debitPaise = 0;
        let creditPaise = 0;
        if (b.kind === "fee_due") debitPaise = b.amountPaise;
        else creditPaise = b.amountPaise;

        const result = await postLedgerEntry(db, {
          tenantId: tutorId,
          studentId: b.studentId,
          type,
          debitPaise,
          creditPaise,
          description: b.notes,
          occurredOn: new Date().toISOString(),
          source: "api",
        });

        if (!result.ok) return new Response(result.error.message, { status: 400 });

        const newEntry = await db.ledgerEntry.findUnique({
          where: { id: result.value },
        });
        return { success: true, data: newEntry };
      })

      // POST void
      .post("/:id/void", async ({ request, params, body }) => {
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing X-Tutor-Id", { status: 401 });

        const { id } = params;
        const b = body as any;

        const result = await voidEntry(
          db,
          tutorId,
          id,
          b.reason || "Void via API",
          new Date().toISOString(),
          tutorId
        );

        if (!result.ok) return new Response(result.error.message, { status: 400 });

        const reversingEntry = await db.ledgerEntry.findUnique({
          where: { id: result.value },
        });
        return { success: true, data: reversingEntry };
      })

      // GET balance for a student
      .get("/balance", async ({ request }) => {
        const url = new URL(request.url);
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing X-Tutor-Id", { status: 401 });

        const studentId = url.searchParams.get("studentId");
        if (!studentId) return new Response("Missing studentId", { status: 400 });

        const balancePaise = await computeBalance(db, tutorId, studentId);
        return { success: true, data: { balancePaise } };
      })
  );

// Start server if main module
if (import.meta.main) {
  app.listen(PORT);
  console.log(`🦊 Ledger Service is running at ${app.server?.hostname}:${app.server?.port}`);
}
