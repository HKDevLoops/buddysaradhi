import type { RouteHandler } from "./students.ts";
import { ok, fail, failZod } from "../lib/errors.ts";
import { recordOutbox, recordAudit } from "./students.ts";
import { invalidateTenant } from "../lib/cache.ts";
import { createPrismaOrm } from "../lib/orm.ts";
import { z } from "zod";

// AGENTS.md §6.1 (Zod for all input validation) + Rule 6
// (12_Business_Rules.md BR-M-01 — integer paise, never float). Audit
// 2026-09-26 "Gateway ledger route — unvalidated money": "routes/ledger.ts:104-161:
// no Zod/integer/UUID validation — Number("12.99") float paise enters the ledger".
// Mirrors packages/shared/src/schemas/ledger.ts + student.ts — Zod is the
// repo-wide validation standard, so adding npm:zod to deno.json is consistency,
// not a new tech choice. Scope here is INPUT VALIDATION ONLY: void semantics,
// the stale-balance race and Date.now receipt/invoice numbers are S3 (ledger
// unification), deliberately untouched.
const uuidSchema = z.string().uuid("must be a UUID");
const paiseSchema = z
  .number({
    invalid_type_error:
      "amount must be a JSON number of integer paise (12_Business_Rules.md BR-M-01)",
  })
  .int(
    "amount must be whole paise — send 1299 for ₹12.99, not 12.99 (12_Business_Rules.md BR-M-01)",
  )
  .positive("amount must be greater than zero paise")
  .max(Number.MAX_SAFE_INTEGER, "amount exceeds the maximum safe paise value");
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date YYYY-MM-DD");
const descriptionSchema = z.string().trim().max(500, "must be 500 characters or fewer");

// Client sends one of several historical key spellings; each route normalises
// to one canonical key before parsing.
const LedgerPaymentSchema = z.object({
  studentId: uuidSchema,
  amount: paiseSchema,
  method: z.string().trim().max(32).optional(),
  occurredOn: isoDateSchema.optional(),
  description: descriptionSchema.optional(),
});

const LedgerInvoiceSchema = z.object({
  studentId: uuidSchema,
  amount: paiseSchema,
  number: z.string().trim().min(1).max(64).optional(),
  issueDate: isoDateSchema.optional(),
  dueDate: isoDateSchema.nullable().optional(),
  occurredOn: isoDateSchema.optional(),
  description: descriptionSchema.optional(),
});

// Audit 2026-09-26: void semantics (credit-only reversal, no VOID-of-VOID
// guard) are S3 scope — only the entry id is validated here.
const LedgerVoidSchema = z.object({
  entryId: uuidSchema,
});

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
    // amountPaise is the contracts/openapi.yaml name; amount / amount_minor are
    // the historical spellings this route already accepted.
    const parsed = LedgerPaymentSchema.safeParse({
      studentId: body.studentId ?? body.student_id,
      amount: body.amountPaise ?? body.amount ?? body.amount_minor,
      method: body.method ?? body.payment_method,
      occurredOn: body.occurredOn ?? body.occurred_on,
      description: body.description,
    });
    if (!parsed.success) return failZod(parsed.error);
    const studentId = parsed.data.studentId;
    const credit = parsed.data.amount;
    const paymentMethod = parsed.data.method ?? "upi";
    const occurredOn =
      parsed.data.occurredOn ?? new Date().toISOString().slice(0, 10);
    const description = parsed.data.description ?? "Payment received";

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
        description,
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

    // Fail-closed Rule 7 ordering: invalidate first so a thrown
    // recordOutbox/recordAudit never leaves pre-mutation GETs cached.
    invalidateTenant(tenantId);
    await recordOutbox(db, tenantId, "ledger_entries", le.id, "create", { type: "payment" });
    await recordAudit(db, tenantId, tenantId, "ledger.payment", "student", studentId, { credit });
    return ok({ ok: true, receiptNo, newBalance });
  }

  // POST /api/v1/ledger/invoice
  if (path === "/api/v1/ledger/invoice" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    // amountPaise is the contracts/openapi.yaml name; amount / amount_minor are
    // the historical spellings this route already accepted.
    const parsed = LedgerInvoiceSchema.safeParse({
      studentId: body.studentId ?? body.student_id,
      amount: body.amountPaise ?? body.amount ?? body.amount_minor,
      number: body.number,
      issueDate: body.issueDate ?? body.issue_date,
      dueDate: body.dueDate ?? body.due_date,
      occurredOn: body.occurredOn ?? body.occurred_on,
      description: body.description,
    });
    if (!parsed.success) return failZod(parsed.error);
    const studentId = parsed.data.studentId;
    const amount = parsed.data.amount;
    const description = parsed.data.description ?? "Fee charged";

    const stu = await orm.student.findFirst({ where: { id: studentId } });
    if (!stu) return fail("student_not_found", 404);

    const newBalance = Number(stu.balancePaise ?? 0) + amount;
    // Receipt/invoice NUMBER GENERATION (Date.now seq) is S3 scope — untouched.
    const invNo = `${parsed.data.number ?? "INV-" + Date.now().toString().slice(-6)}`;

    const inv = await orm.invoice.create({
      data: {
        number: invNo,
        studentId,
        issueDate: parsed.data.issueDate ?? new Date().toISOString().slice(0, 10),
        dueDate: parsed.data.dueDate ?? null,
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
        description,
        occurredOn: parsed.data.occurredOn ?? new Date().toISOString().slice(0, 10),
        source: "gateway",
      },
    });

    await orm.student.update({
      where: { id: studentId },
      data: { balancePaise: newBalance },
    });

    // Fail-closed Rule 7 ordering: invalidate first so a thrown
    // recordOutbox/recordAudit never leaves pre-mutation GETs cached.
    invalidateTenant(tenantId);
    await recordOutbox(db, tenantId, "ledger_entries", le.id, "create", { type: "invoice" });
    await recordAudit(db, tenantId, tenantId, "ledger.invoice", "student", studentId, { amount });
    return ok({ ok: true, invoiceId: inv.id, newBalance });
  }

  // POST /api/v1/ledger/void
  if (path === "/api/v1/ledger/void" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const parsed = LedgerVoidSchema.safeParse({
      entryId: body.entryId ?? body.entryIdToVoid,
    });
    if (!parsed.success) return failZod(parsed.error);
    const entryId = parsed.data.entryId;

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

    // Fail-closed Rule 7 ordering: invalidate first so a thrown
    // recordOutbox/recordAudit never leaves pre-mutation GETs cached.
    invalidateTenant(tenantId);
    await recordOutbox(db, tenantId, "ledger_entries", voidEntry.id, "create", { void_of: entryId });
    await recordAudit(db, tenantId, tenantId, "ledger.void", "ledger", entryId, {});
    return ok({ ok: true, voidId: voidEntry.id, newBalance });
  }

  return null;
};
