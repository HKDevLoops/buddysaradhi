import type { Hono } from "hono";
import { createHmac, randomUUID } from "crypto";
import { ok, fail, getContext } from "../lib/respond";

// HMAC-SHA256 ledger chain (Rule 1 / LEDGER-4).
function chainHash(prevHash: string | null, payload: string, ts: string, secret: string): string {
  const raw = `${prevHash ?? ""}|${payload}|${ts}|${secret}`;
  return createHmac("sha256", secret).update(raw).digest("hex");
}

async function getSecret(db: any, tenantId: string): Promise<string> {
  const s = await db.setting.findUnique({
    where: { tenantId },
    select: { tenantSecret: true },
  });
  if (!s?.tenantSecret) throw new Error("SECURITY_VIOLATION: tenant secret is not initialised");
  return s.tenantSecret;
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
    // Fail-closed if the tenant secret was never minted (R-CRYPTO-1).
    let secret: string;
    try {
      secret = await getSecret(db, tenantId);
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "secret_missing", 412);
    }
    const now = new Date().toISOString();
    const last = await lastEntry(db, tenantId, studentId);
    const newBalance = (last?.balanceAfterPaise ?? 0) - amount;
    const entryId = randomUUID();
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
    const thisHash = chainHash(last?.thisHash ?? null, payload, now, secret);
    await db.$transaction([
      db.ledgerEntry.create({
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
      }),
      db.student.update({
        where: { id: studentId },
        data: { balancePaise: newBalance, updatedAt: now },
      }),
      db.syncOutbox.create({
        data: {
          id: randomUUID(),
          tenantId,
          tableName: "ledger_entries",
          rowId: entryId,
          op: "INSERT",
          payload: JSON.stringify({ type: "PAYMENT_RECEIVED", amount }),
          createdAt: now,
        },
      }),
      db.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId,
          actor: tenantId,
          action: "ledger.payment",
          refType: "student",
          refId: studentId,
          metadata: JSON.stringify({ entryId, creditPaise: amount }),
          createdAt: now,
        },
      }),
    ]);
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
    let secret: string;
    try {
      secret = await getSecret(db, tenantId);
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "secret_missing", 412);
    }
    const now = new Date().toISOString();
    const last = await lastEntry(db, tenantId, studentId);
    const newBalance = (last?.balanceAfterPaise ?? 0) + amount;
    const entryId = randomUUID();
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
    const thisHash = chainHash(last?.thisHash ?? null, payload, now, secret);
    await db.$transaction([
      db.ledgerEntry.create({
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
      }),
      db.student.update({
        where: { id: studentId },
        data: { balancePaise: newBalance, updatedAt: now },
      }),
      db.syncOutbox.create({
        data: {
          id: randomUUID(),
          tenantId,
          tableName: "ledger_entries",
          rowId: entryId,
          op: "INSERT",
          payload: JSON.stringify({ type: "FEE_CHARGED", amount }),
          createdAt: now,
        },
      }),
      db.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId,
          actor: tenantId,
          action: "ledger.invoice",
          refType: "student",
          refId: studentId,
          metadata: JSON.stringify({ entryId, debitPaise: amount }),
          createdAt: now,
        },
      }),
    ]);
    return ok(c, { id: entryId, balance_after: newBalance });
  });

  app.post("/api/v1/ledger/void", async (c) => {
    const { db, tenantId } = getContext(c);
    const body = (await c.req.json().catch(() => ({}))) as any;
    const entryIdToVoid = body.entryId || body.entryIdToVoid;
    if (!entryIdToVoid) return fail(c, "entryId required", 400);
    const entry = await db.ledgerEntry.findFirst({ where: { id: entryIdToVoid, tenantId } });
    if (!entry) return fail(c, "Entry not found", 404);
    let secret: string;
    try {
      secret = await getSecret(db, tenantId);
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "secret_missing", 412);
    }
    const now = new Date().toISOString();
    const last = await lastEntry(db, tenantId, entry.studentId);
    const voidedAmount = entry.creditPaise ?? 0;
    const newBalance = (last?.balanceAfterPaise ?? 0) + voidedAmount;
    const voidId = randomUUID();
    const payload = JSON.stringify({ id: voidId, type: "VOID", entryIdToVoid, newBalance });
    const thisHash = chainHash(last?.thisHash ?? null, payload, now, secret);
    await db.$transaction([
      db.ledgerEntry.create({
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
      }),
      db.student.update({
        where: { id: entry.studentId },
        data: { balancePaise: newBalance, updatedAt: now },
      }),
      db.syncOutbox.create({
        data: {
          id: randomUUID(),
          tenantId,
          tableName: "ledger_entries",
          rowId: voidId,
          op: "INSERT",
          payload: JSON.stringify({ void_of: entryIdToVoid }),
          createdAt: now,
        },
      }),
      db.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId,
          actor: tenantId,
          action: "ledger.void",
          refType: "ledger",
          refId: entryIdToVoid,
          metadata: JSON.stringify({ voidId }),
          createdAt: now,
        },
      }),
    ]);
    return ok(c, { id: voidId, balance_after: newBalance });
  });
}
