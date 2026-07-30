import type { RouteHandler } from "./students.ts";
import { run, oneRow, allRows } from "../lib/db.ts";
import { ok, fail } from "../lib/errors.ts";
import { recordOutbox, recordAudit } from "./students.ts";
import { invalidateTenant } from "../lib/cache.ts";

function studentName(r: Record<string, unknown>): string {
  return [r.first_name, r.last_name].filter(Boolean).join(" ");
}

export const handleLedger: RouteHandler = async (req, db, tenantId, path, method, url) => {
  const sp = url.searchParams;

  // GET /api/v1/ledger
  if (path === "/api/v1/ledger" && method === "GET") {
    const studentId = sp.get("studentId");
    const rows = await allRows(
      db,
      `SELECT * FROM ledger_entries WHERE tenant_id = ? AND student_id = ?
       ORDER BY occurred_on DESC LIMIT 200`,
      [tenantId, studentId],
    );
    return ok(
      rows.map((e) => ({
        id: e.id,
        tenant_id: e.tenant_id,
        student_id: e.student_id,
        type: e.type,
        debit: e.debit_paise,
        credit: e.credit_paise,
        balance_after: e.balance_after_paise,
        method: e.payment_method,
        description: e.description,
        occurred_on: e.occurred_on,
        invoice_id: e.invoice_id,
        receipt_no: e.receipt_no,
        reverses_entry_id: e.void_of_id,
        this_hash: e.this_hash,
      })),
    );
  }

  // GET /api/v1/ledger/invoices
  if (path === "/api/v1/ledger/invoices" && method === "GET") {
    const studentId = sp.get("studentId");
    const invs = await allRows(
      db,
      "SELECT * FROM invoices WHERE tenant_id = ? AND student_id = ? ORDER BY issue_date DESC",
      [tenantId, studentId],
    );
    const invoiceIds = invs.map((i) => i.id);
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

    const data = invs.map((inv) => ({
      id: inv.id,
      tenant_id: inv.tenant_id,
      number: inv.number,
      student_id: inv.student_id,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      subtotal: inv.subtotal,
      total: inv.total,
      status: inv.status,
      paid_amount_minor: paidMap.get(inv.id as string) ?? 0,
    }));
    return ok(data);
  }

  // GET /api/v1/ledger/fees
  if (path === "/api/v1/ledger/fees" && method === "GET") {
    const search = (sp.get("search") ?? "").toLowerCase();
    const where = ["tenant_id = ?", "archived_at IS NULL"];
    const args: unknown[] = [tenantId];
    if (search) {
      where.push(
        "(LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? OR code LIKE ?)",
      );
      args.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const rows = await allRows(
      db,
      `SELECT id, first_name, last_name, code, fee_model, balance_paise FROM students
       WHERE ${where.join(" AND ")} ORDER BY first_name LIMIT 200`,
      args,
    );
    return ok(
      rows.map((s) => ({
        id: s.id,
        name: studentName(s),
        code: s.code,
        fee_model: s.fee_model,
        balance_due: s.balance_paise,
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
    const method = body.method ?? body.payment_method ?? "upi";
    const occurredOn =
      body.occurredOn ?? body.occurred_on ?? new Date().toISOString().slice(0, 10);
    const stu = await oneRow(
      db,
      "SELECT balance_paise FROM students WHERE tenant_id = ? AND id = ?",
      [tenantId, studentId],
    );
    if (!stu) return fail("student_not_found", 404);
    const newBalance = Math.max(0, Number(stu.balance_paise) - credit);
    const now = new Date().toISOString();
    const receiptNo = `R-${Date.now().toString().slice(-6)}`;
    const leId = crypto.randomUUID();
    await run(
      db,
      `INSERT INTO ledger_entries (id, tenant_id, student_id, type, debit_paise, credit_paise,
         balance_after_paise, description, receipt_no, payment_method, occurred_on, source, created_at, updated_at)
       VALUES (?, ?, ?, 'PAYMENT_RECEIVED', 0, ?, ?, ?, ?, ?, ?, 'gateway', ?, ?)`,
      [leId, tenantId, studentId, credit, newBalance, body.description ?? "Payment received", receiptNo, method, occurredOn, now, now],
    );
    await run(
      db,
      "INSERT INTO receipts (id, tenant_id, number, ledger_entry_id, student_id, amount, payment_method, received_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), tenantId, receiptNo, leId, studentId, credit, method, occurredOn, now, now],
    );
    await run(
      db,
      "UPDATE students SET balance_paise = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
      [newBalance, now, tenantId, studentId],
    );
    await recordOutbox(db, tenantId, "ledger_entries", leId, "create", { type: "payment" });
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
    const now = new Date().toISOString();
    const stu = await oneRow(
      db,
      "SELECT balance_paise FROM students WHERE tenant_id = ? AND id = ?",
      [tenantId, studentId],
    );
    if (!stu) return fail("student_not_found", 404);
    const newBalance = Number(stu.balance_paise) + amount;
    const leId = crypto.randomUUID();
    const invId = crypto.randomUUID();
    const invNo = `${body.number ?? "INV-" + Date.now().toString().slice(-6)}`;
    await run(
      db,
      `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date, subtotal, total, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)`,
      [invId, tenantId, invNo, studentId, body.issueDate ?? body.issue_date ?? now.slice(0, 10), body.dueDate ?? body.due_date ?? null, amount, amount, now, now],
    );
    await run(
      db,
      `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
         balance_after_paise, description, occurred_on, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'FEE_CHARGED', ?, 0, ?, ?, ?, 'gateway', ?, ?)`,
      [leId, tenantId, studentId, invId, amount, newBalance, body.description ?? "Fee charged", body.occurredOn ?? body.occurred_on ?? now.slice(0, 10), now, now],
    );
    await run(
      db,
      "UPDATE students SET balance_paise = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
      [newBalance, now, tenantId, studentId],
    );
    await recordOutbox(db, tenantId, "ledger_entries", leId, "create", { type: "invoice" });
    await recordAudit(db, tenantId, tenantId, "ledger.invoice", "student", studentId, { amount });
    invalidateTenant(tenantId);
    return ok({ ok: true, invoiceId: invId, newBalance });
  }

  // POST /api/v1/ledger/void
  if (path === "/api/v1/ledger/void" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const entryId = body.entryId ?? body.entryIdToVoid;
    if (!entryId) return fail("entryId is required", 400);
    const entry = await oneRow(
      db,
      "SELECT * FROM ledger_entries WHERE tenant_id = ? AND id = ?",
      [tenantId, entryId],
    );
    if (!entry) return fail("entry_not_found", 404);
    const now = new Date().toISOString();
    const newBalance =
      Number(entry.balance_after_paise) + Number(entry.credit_paise ?? 0);
    const voidId = crypto.randomUUID();
    await run(
      db,
      `INSERT INTO ledger_entries (id, tenant_id, student_id, type, debit_paise, credit_paise,
         balance_after_paise, description, occurred_on, void_of_id, source, created_at, updated_at)
       VALUES (?, ?, ?, 'VOID', ?, 0, ?, 'Voided via Gateway', ?, ?, 'gateway', ?, ?)`,
      [voidId, tenantId, entry.student_id, Number(entry.credit_paise ?? 0), newBalance, entry.occurred_on, entryId, now, now],
    );
    await run(
      db,
      "UPDATE students SET balance_paise = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
      [newBalance, now, tenantId, entry.student_id],
    );
    await recordOutbox(db, tenantId, "ledger_entries", voidId, "create", { void_of: entryId });
    await recordAudit(db, tenantId, tenantId, "ledger.void", "ledger", entryId, {});
    invalidateTenant(tenantId);
    return ok({ ok: true, voidId, newBalance });
  }

  return null;
};
