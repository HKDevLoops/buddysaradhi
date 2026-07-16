import type { Hono } from "hono";
import { ok, fail, getContext } from "../lib/respond";

// Mirrors the simple hash chain used by apps/web/src/server/actions/fees.ts
function simpleHash(prevHash: string | null, payload: string, ts: string, secret: string): string {
  const raw = `${prevHash ?? ""}:${payload}:${ts}:${secret}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(8, "0");
}

async function getSecret(db: any, tenantId: string): Promise<string> {
  const s = await db.setting.findUnique({
    where: { tenantId },
    select: { tenantSecret: true },
  });
  return s?.tenantSecret ?? "default-secret";
}

async function lastEntry(db: any, tenantId: string, studentId: string) {
  return db.ledgerEntry.findFirst({
    where: { tenantId, studentId },
    orderBy: { createdAt: "desc" },
  });
}

export function registerLedger(app: Hono) {
  app.get("/api/v1/ledger", async (c) => {
    const { db, tenantId } = getContext(c);
    const studentId = c.req.query("studentId");
    const limit = Math.min(500, parseInt(c.req.query("limit") || "100", 10) || 100);
    if (!studentId) return fail(c, "studentId required", 400);
    const entries = await db.ledgerEntry.findMany({
      where: { tenantId, studentId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const data = entries.map((e: any) => ({
      id: e.id,
      tenant_id: e.tenantId,
      student_id: e.studentId,
      type: e.type,
      debit: e.debitPaise,
      credit: e.creditPaise,
      balance_after: e.balanceAfterPaise,
      method: e.paymentMethod,
      description: e.description,
      occurred_on: e.occurredOn,
      invoice_id: e.invoiceId,
      receipt_no: e.receiptNo,
      reverses_entry_id: e.voidOfId,
      this_hash: e.thisHash,
    }));
    return ok(c, data);
  });

  app.get("/api/v1/ledger/invoices", async (c) => {
    const { db, tenantId } = getContext(c);
    const studentId = c.req.query("studentId");
    if (!studentId) return fail(c, "studentId required", 400);
    const invoices = await db.invoice.findMany({
      where: { tenantId, studentId },
      orderBy: { createdAt: "desc" },
    });
    const data = await Promise.all(
      invoices.map(async (inv: any) => {
        const paidAgg = await db.ledgerEntry.aggregate({
          where: { tenantId, invoiceId: inv.id, creditPaise: { gt: 0 } },
          _sum: { creditPaise: true },
        });
        return {
          id: inv.id,
          tenant_id: inv.tenantId,
          number: inv.number,
          student_id: inv.studentId,
          issue_date: inv.issueDate,
          due_date: inv.dueDate,
          subtotal: inv.subtotal,
          total: inv.total,
          status: inv.status,
          paid_amount_minor: paidAgg._sum.creditPaise ?? 0,
        };
      })
    );
    return ok(c, data);
  });

  app.get("/api/v1/ledger/fees", async (c) => {
    const { db, tenantId } = getContext(c);
    const search = c.req.query("search") || "";
    const where: any = { tenantId, archivedAt: null };
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { code: { contains: search } },
      ];
    }
    const students = await db.student.findMany({
      where,
      orderBy: { firstName: "asc" },
      take: 200,
    });
    const data = students.map((s: any) => ({
      id: s.id,
      name: [s.firstName, s.lastName].filter(Boolean).join(" "),
      code: s.code,
      fee_model: s.feeModel,
      balance_due: s.balancePaise,
    }));
    return ok(c, data);
  });

  // --- Write endpoints (append-only ledger) ---

  app.post("/api/v1/ledger/payment", async (c) => {
    const { db, tenantId } = getContext(c);
    const body = (await c.req.json().catch(() => ({}))) as any;
    const studentId = body.student_id || body.studentId;
    const amount = Number(body.amount_minor ?? body.amountMinor ?? 0);
    if (!studentId || !(amount > 0)) {
      return fail(c, "student_id and positive amount_minor required", 400);
    }
    const now = new Date().toISOString();
    const last = await lastEntry(db, tenantId, studentId);
    const newBalance = (last?.balanceAfterPaise ?? 0) - amount;
    const secret = await getSecret(db, tenantId);
    const entryId = crypto.randomUUID();
    const occurred = body.date || now;
    const payload = JSON.stringify({
      id: entryId,
      studentId,
      type: "PAYMENT_RECEIVED",
      debit: 0,
      credit: amount,
      balanceAfterPaise: newBalance,
      occurredOn: occurred,
    });
    const thisHash = simpleHash(last?.thisHash ?? null, payload, now, secret);
    await db.ledgerEntry.create({
      data: {
        id: entryId,
        tenantId,
        studentId,
        type: "PAYMENT_RECEIVED",
        debitPaise: 0,
        creditPaise: amount,
        balanceAfterPaise: newBalance,
        description: body.description || "Payment received",
        occurredOn: occurred,
        thisHash,
        prevHash: last?.thisHash ?? null,
        source: "gateway",
        createdAt: now,
        updatedAt: now,
      },
    });
    await db.student.update({
      where: { id: studentId },
      data: { balancePaise: newBalance },
    });
    return ok(c, { id: entryId, balance_after: newBalance });
  });

  app.post("/api/v1/ledger/invoice", async (c) => {
    const { db, tenantId } = getContext(c);
    const body = (await c.req.json().catch(() => ({}))) as any;
    const studentId = body.student_id || body.studentId;
    const amount = Number(body.amountMinor ?? body.amount_minor ?? 0);
    if (!studentId || !(amount > 0)) {
      return fail(c, "student_id and positive amount required", 400);
    }
    const now = new Date().toISOString();
    const last = await lastEntry(db, tenantId, studentId);
    const newBalance = (last?.balanceAfterPaise ?? 0) + amount;
    const secret = await getSecret(db, tenantId);
    const entryId = crypto.randomUUID();
    const occurred = body.dateIso || now;
    const payload = JSON.stringify({
      id: entryId,
      studentId,
      type: "FEE_CHARGED",
      debit: amount,
      credit: 0,
      balanceAfterPaise: newBalance,
      occurredOn: occurred,
    });
    const thisHash = simpleHash(last?.thisHash ?? null, payload, now, secret);
    await db.ledgerEntry.create({
      data: {
        id: entryId,
        tenantId,
        studentId,
        type: "FEE_CHARGED",
        debitPaise: amount,
        creditPaise: 0,
        balanceAfterPaise: newBalance,
        description: body.description || "Fee charged",
        occurredOn: occurred,
        thisHash,
        prevHash: last?.thisHash ?? null,
        source: "gateway",
        createdAt: now,
        updatedAt: now,
      },
    });
    await db.student.update({
      where: { id: studentId },
      data: { balancePaise: newBalance },
    });
    return ok(c, { id: entryId, balance_after: newBalance });
  });

  app.post("/api/v1/ledger/void", async (c) => {
    const { db, tenantId } = getContext(c);
    const body = (await c.req.json().catch(() => ({}))) as any;
    const entryIdToVoid = body.entryId || body.entryIdToVoid;
    if (!entryIdToVoid) return fail(c, "entryId required", 400);
    const entry = await db.ledgerEntry.findFirst({ where: { id: entryIdToVoid, tenantId } });
    if (!entry) return fail(c, "Entry not found", 404);
    const now = new Date().toISOString();
    const last = await lastEntry(db, tenantId, entry.studentId);
    const voidedAmount = entry.creditPaise ?? 0;
    const newBalance = (last?.balanceAfterPaise ?? 0) + voidedAmount;
    const secret = await getSecret(db, tenantId);
    const voidId = crypto.randomUUID();
    const payload = JSON.stringify({ id: voidId, type: "VOID", entryIdToVoid, newBalance });
    const thisHash = simpleHash(last?.thisHash ?? null, payload, now, secret);
    await db.ledgerEntry.create({
      data: {
        id: voidId,
        tenantId,
        studentId: entry.studentId,
        type: "VOID",
        debitPaise: voidedAmount,
        creditPaise: 0,
        balanceAfterPaise: newBalance,
        description: "Voided via Gateway",
        occurredOn: entry.occurredOn,
        thisHash,
        prevHash: last?.thisHash ?? null,
        voidOfId: entryIdToVoid,
        source: "gateway",
        createdAt: now,
        updatedAt: now,
      },
    });
    await db.student.update({
      where: { id: entry.studentId },
      data: { balancePaise: newBalance },
    });
    return ok(c, { id: voidId, balance_after: newBalance });
  });
}
