import type { RouteHandler } from "./students.ts";
import { ok, fail } from "../lib/errors.ts";
import { recordOutbox, recordAudit } from "./students.ts";
import { invalidateTenant } from "../lib/cache.ts";
import { createPrismaOrm } from "../lib/orm.ts";

export const handleLedger: RouteHandler = async (req, db, tenantId, path, method, url) => {
  const sp = url.searchParams;
  const orm = createPrismaOrm(db, tenantId);

  // GET /api/v1/ledger
  if (path === "/api/v1/ledger" && method === "GET") {
    const studentId = sp.get("studentId");
    const rows = await orm.ledgerEntry.findMany({
      where: studentId ? { studentId } : {},
      orderBy: { occurredOn: "desc" },
      take: 200,
    });

    return ok(
      rows.map((e) => ({
        id: e.id,
        tenant_id: tenantId,
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
      })),
    );
  }

  // GET /api/v1/ledger/invoices
  if (path === "/api/v1/ledger/invoices" && method === "GET") {
    const studentId = sp.get("studentId");
    const invs = await orm.invoice.findMany({
      where: studentId ? { studentId } : {},
      take: 100,
    });

    const entries = await orm.ledgerEntry.findMany({
      where: { type: "PAYMENT_RECEIVED" },
      take: 200,
    });

    const paidMap = new Map<string, number>();
    for (const e of entries) {
      if (e.invoiceId) {
        paidMap.set(e.invoiceId, (paidMap.get(e.invoiceId) ?? 0) + (e.creditPaise ?? 0));
      }
    }

    const data = invs.map((inv) => ({
      id: inv.id,
      tenant_id: tenantId,
      number: inv.number,
      student_id: inv.studentId,
      issue_date: inv.issueDate,
      due_date: inv.dueDate,
      subtotal: inv.subtotal,
      total: inv.total,
      status: inv.status,
      paid_amount_minor: paidMap.get(inv.id) ?? 0,
    }));
    return ok(data);
  }

  // GET /api/v1/ledger/fees
  if (path === "/api/v1/ledger/fees" && method === "GET") {
    const search = (sp.get("search") ?? "").toLowerCase();
    const rawStudents = await orm.student.findMany({
      where: { status: "active", archivedAt: null },
      orderBy: { firstName: "asc" },
      take: 200,
    });

    const filtered = search
      ? rawStudents.filter(
          (s) =>
            (s.firstName && s.firstName.toLowerCase().includes(search)) ||
            (s.lastName && s.lastName.toLowerCase().includes(search)) ||
            (s.code && s.code.toLowerCase().includes(search)),
        )
      : rawStudents;

    return ok(
      filtered.map((s) => ({
        id: s.id,
        name: `${s.firstName || ""} ${s.lastName || ""}`.trim(),
        code: s.code,
        fee_model: s.feeModel || "postpaid",
        balance_due: s.balancePaise || 0,
      })),
    );
  }

  // POST /api/v1/ledger/payment
  if (path === "/api/v1/ledger/payment" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!body.studentId && !body.student_id) {
      return fail("studentId is required", 400);
    }
    const credit = Number(body.amount ?? body.amount_minor ?? 0);
    if (!(credit > 0)) {
      return fail("positive amount required", 400);
    }
    const studentId = body.studentId ?? body.student_id;
    const paymentMethod = body.method ?? body.payment_method ?? "upi";
    const occurredOn =
      body.occurredOn ?? body.occurred_on ?? new Date().toISOString().slice(0, 10);

    const stu = await orm.student.findFirst({ where: { id: studentId } });
    if (!stu) return fail("student_not_found", 404);

    const newBalance = Math.max(0, Number(stu.balancePaise ?? 0) - credit);
    const receiptNo = `R-${Date.now().toString().slice(-6)}`;

    // Enforces Rule 1 (Append-only immutable ledger entry)
    const le = await orm.ledgerEntry.create({
      data: {
        studentId,
        type: "PAYMENT_RECEIVED",
        debitPaise: 0,
        creditPaise: credit,
        balanceAfterPaise: newBalance,
        description: body.description ?? "Payment received",
        receiptNo,
        paymentMethod,
        occurredOn,
        source: "gateway",
      },
    });

    await orm.receipt.create({
      data: {
        number: receiptNo,
        ledgerEntryId: le.id,
        studentId,
        amount: credit,
        paymentMethod,
        receivedOn: occurredOn,
      },
    });

    await orm.student.update({
      where: { id: studentId },
      data: { balancePaise: newBalance },
    });

    await recordOutbox(db, tenantId, "ledger_entries", le.id, "create", { type: "payment" });
    await recordAudit(db, tenantId, tenantId, "ledger.payment", "student", studentId, { credit });
    invalidateTenant(tenantId);
    return ok({ ok: true, receiptNo, newBalance });
  }

  // POST /api/v1/ledger/invoice
  if (path === "/api/v1/ledger/invoice" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!body.studentId && !body.student_id) {
      return fail("studentId is required", 400);
    }
    const amount = Number(body.amount ?? body.amount_minor ?? 0);
    if (!(amount > 0)) {
      return fail("positive amount required", 400);
    }
    const studentId = body.studentId ?? body.student_id;
    
    const stu = await orm.student.findFirst({ where: { id: studentId } });
    if (!stu) return fail("student_not_found", 404);

    const newBalance = Number(stu.balancePaise ?? 0) + amount;
    const invNo = `${body.number ?? "INV-" + Date.now().toString().slice(-6)}`;

    const inv = await orm.invoice.create({
      data: {
        number: invNo,
        studentId,
        issueDate: body.issueDate ?? body.issue_date ?? new Date().toISOString().slice(0, 10),
        dueDate: body.dueDate ?? body.due_date ?? null,
        subtotal: amount,
        total: amount,
        status: "unpaid",
      },
    });

    // Enforces Rule 1 (Append-only immutable ledger entry)
    const le = await orm.ledgerEntry.create({
      data: {
        studentId,
        invoiceId: inv.id,
        type: "FEE_CHARGED",
        debitPaise: amount,
        creditPaise: 0,
        balanceAfterPaise: newBalance,
        description: body.description ?? "Fee charged",
        occurredOn: body.occurredOn ?? body.occurred_on ?? new Date().toISOString().slice(0, 10),
        source: "gateway",
      },
    });

    await orm.student.update({
      where: { id: studentId },
      data: { balancePaise: newBalance },
    });

    await recordOutbox(db, tenantId, "ledger_entries", le.id, "create", { type: "invoice" });
    await recordAudit(db, tenantId, tenantId, "ledger.invoice", "student", studentId, { amount });
    invalidateTenant(tenantId);
    return ok({ ok: true, invoiceId: inv.id, newBalance });
  }

  // POST /api/v1/ledger/void
  if (path === "/api/v1/ledger/void" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const entryId = body.entryId ?? body.entryIdToVoid;
    if (!entryId) return fail("entryId is required", 400);

    const entries = await orm.ledgerEntry.findMany({ where: { id: entryId } });
    const entry = entries[0];
    if (!entry) return fail("entry_not_found", 404);

    const newBalance = Number(entry.balanceAfterPaise ?? 0) + Number(entry.creditPaise ?? 0);

    // Enforces Rule 1 (Void is a new reversing ledger entry)
    const voidEntry = await orm.ledgerEntry.create({
      data: {
        studentId: entry.studentId,
        type: "VOID",
        debitPaise: Number(entry.creditPaise ?? 0),
        creditPaise: 0,
        balanceAfterPaise: newBalance,
        description: "Voided via Gateway",
        occurredOn: entry.occurredOn,
        voidOfId: entryId,
        source: "gateway",
      },
    });

    await orm.student.update({
      where: { id: entry.studentId },
      data: { balancePaise: newBalance },
    });

    await recordOutbox(db, tenantId, "ledger_entries", voidEntry.id, "create", { void_of: entryId });
    await recordAudit(db, tenantId, tenantId, "ledger.void", "ledger", entryId, {});
    invalidateTenant(tenantId);
    return ok({ ok: true, voidId: voidEntry.id, newBalance });
  }

  return null;
};
