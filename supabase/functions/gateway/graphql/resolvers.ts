import type { DB } from "../lib/db.ts";
import { oneRow, allRows } from "../lib/db.ts";

interface ResolverContext {
  db: DB;
  tenantId: string | null;
}

type ResolverFn = (args: Record<string, unknown>, ctx: ResolverContext) => Promise<unknown>;

function clampPage(page: unknown, pageSize: unknown) {
  const p = Math.max(1, Math.trunc(Number(page) || 1));
  const ps = Math.min(200, Math.max(1, Math.trunc(Number(pageSize) || 50)));
  return { p, ps, from: (p - 1) * ps };
}

export const resolvers: Record<string, ResolverFn> = {
  health: async () => "ok",

  settings: async (args, ctx) => {
    if (args.tenantId !== ctx.tenantId) throw new Error("forbidden: tenant mismatch");
    const row = await oneRow(ctx.db, "SELECT * FROM settings WHERE tenant_id = ?", [ctx.tenantId]);
    if (!row) return null;
    return {
      id: row.tenant_id,
      tenantId: row.tenant_id,
      instituteName: row.institute_name ?? "",
      instituteAddress: row.institute_address ?? null,
      institutePhone: row.institute_phone ?? null,
      instituteEmail: row.institute_email ?? null,
      currencyCode: row.currency_code ?? "INR",
      locale: row.locale ?? "en-IN",
      timezone: row.timezone ?? "Asia/Kolkata",
      defaultFeeModel: row.default_fee_model ?? "monthly",
      invoicePrefix: row.invoice_prefix ?? "INV",
      receiptPrefix: row.receipt_prefix ?? "RCPT",
      graceDays: Number(row.grace_days ?? 0),
      autoInvoice: Number(row.auto_invoice ?? 0),
      nextInvoiceSeq: Number(row.next_invoice_seq ?? 1),
      nextReceiptSeq: Number(row.next_receipt_seq ?? 1),
      nextStudentSeq: Number(row.next_student_seq ?? 1),
      attendanceLockHours: Number(row.attendance_lock_hours ?? 48),
      defaultAttendanceStatus: row.default_attendance_status ?? "present",
      holidayListJson: row.holiday_list_json ?? "[]",
      notifyDueFee: Number(row.notify_due_fee ?? 1),
      notifyUpcomingDue: Number(row.notify_upcoming_due ?? 1),
      notifyMissingAttendance: Number(row.notify_missing_attendance ?? 1),
      notifyInactiveStudent: Number(row.notify_inactive_student ?? 1),
      sessionTimeoutMin: Number(row.session_timeout_min ?? 15),
      biometricEnabled: Number(row.biometric_enabled ?? 0),
      autoArchiveInactiveDays: Number(row.auto_archive_inactive_days ?? 365),
      theme: row.theme ?? "aurora-cosmic",
      palette: row.palette ?? "aurora-cosmic",
      density: row.density ?? "comfortable",
      reducedMotion: Number(row.reduced_motion ?? 0),
    };
  },

  students: async (args, ctx) => {
    if (args.tenantId !== ctx.tenantId) throw new Error("forbidden: tenant mismatch");
    const { p, ps, from } = clampPage(args.page, args.pageSize);
    const where = ["tenant_id = ?", "archived_at IS NULL"];
    const a: unknown[] = [ctx.tenantId];
    if (args.search) {
      where.push("(LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? OR code LIKE ?)");
      a.push(`%${args.search.toLowerCase()}%`, `%${args.search.toLowerCase()}%`, `%${args.search.toLowerCase()}%`);
    }
    const rows = await allRows(
      ctx.db,
      `SELECT * FROM students WHERE ${where.join(" AND ")} ORDER BY first_name LIMIT ? OFFSET ?`,
      [...a, ps, from],
    );
    const cnt = await oneRow(ctx.db, `SELECT COUNT(*) AS c FROM students WHERE ${where.join(" AND ")}`, a);
    return {
      items: rows.map((s) => ({
        id: s.id,
        name: `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim(),
        rollNo: s.code ?? null,
        gender: s.gender ?? null,
        phone: s.phone ?? null,
        email: s.email ?? null,
        school: s.school ?? null,
        grade: s.grade ?? null,
        board: s.board ?? null,
        admissionDate: s.admission_date ?? null,
        status: s.status ?? "active",
        feeModel: s.fee_model ?? "monthly",
        baseFeePaise: Number(s.base_fee_paise ?? 0),
        balancePaise: Number(s.balance_paise ?? 0),
        dupKey: s.dup_key ?? null,
        createdAt: s.created_at ?? null,
      })),
      total: Number(cnt?.c ?? 0),
      page: p,
      pageSize: ps,
    };
  },

  ledgerEntries: async (args, ctx) => {
    if (args.tenantId !== ctx.tenantId) throw new Error("forbidden: tenant mismatch");
    const { p, ps, from } = clampPage(args.page, args.pageSize);
    const rows = await allRows(
      ctx.db,
      "SELECT * FROM ledger_entries WHERE tenant_id = ? ORDER BY occurred_on DESC LIMIT ? OFFSET ?",
      [ctx.tenantId, ps, from],
    );
    const cnt = await oneRow(ctx.db, "SELECT COUNT(*) AS c FROM ledger_entries WHERE tenant_id = ?", [ctx.tenantId]);
    return {
      items: rows.map((e) => ({
        id: e.id,
        tenantId: e.tenant_id,
        studentId: e.student_id,
        type: e.type,
        debitPaise: Number(e.debit_paise ?? 0),
        creditPaise: Number(e.credit_paise ?? 0),
        balanceAfterPaise: Number(e.balance_after_paise ?? 0),
        description: e.description ?? null,
        receiptNo: e.receipt_no ?? null,
        paymentMethod: e.payment_method ?? null,
        occurredOn: e.occurred_on ?? null,
        createdAt: e.created_at ?? null,
      })),
      total: Number(cnt?.c ?? 0),
      page: p,
      pageSize: ps,
    };
  },
};
