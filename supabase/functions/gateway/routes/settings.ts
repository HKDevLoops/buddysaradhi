import type { RouteHandler } from "./students.ts";
import { run, oneRow } from "../lib/db.ts";
import { ok, fail } from "../lib/errors.ts";
import { recordAudit } from "./students.ts";
import { getCached, setCache, invalidateTenant } from "../lib/cache.ts";

const SETTINGS_KEYS: Record<string, string> = {
  instituteName: "institute_name",
  instituteAddress: "institute_address",
  institutePhone: "institute_phone",
  instituteEmail: "institute_email",
  currencyCode: "currency_code",
  locale: "locale",
  timezone: "timezone",
  defaultFeeModel: "default_fee_model",
  invoicePrefix: "invoice_prefix",
  receiptPrefix: "receipt_prefix",
  graceDays: "grace_days",
  autoInvoice: "auto_invoice",
  nextInvoiceSeq: "next_invoice_seq",
  nextReceiptSeq: "next_receipt_seq",
  nextStudentSeq: "next_student_seq",
  attendanceLockHours: "attendance_lock_hours",
  defaultAttendanceStatus: "default_attendance_status",
  holidayListJson: "holiday_list_json",
  notifyDueFee: "notify_due_fee",
  notifyUpcomingDue: "notify_upcoming_due",
  notifyMissingAttendance: "notify_missing_attendance",
  notifyInactiveStudent: "notify_inactive_student",
  sessionTimeoutMin: "session_timeout_min",
  biometricEnabled: "biometric_enabled",
  autoArchiveInactiveDays: "auto_archive_inactive_days",
  theme: "theme",
  palette: "palette",
  density: "density",
  reducedMotion: "reduced_motion",
  backupPassphraseHash: "backup_passphrase_hash",
};

function mapSettings(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    id: row.tenant_id,
    tenantId: row.tenant_id,
    instituteName: row.institute_name,
    instituteAddress: row.institute_address,
    institutePhone: row.institute_phone,
    instituteEmail: row.institute_email,
    currencyCode: row.currency_code,
    locale: row.locale,
    timezone: row.timezone,
    defaultFeeModel: row.default_fee_model,
    invoicePrefix: row.invoice_prefix,
    receiptPrefix: row.receipt_prefix,
    graceDays: row.grace_days,
    autoInvoice: row.auto_invoice,
    nextInvoiceSeq: row.next_invoice_seq,
    nextReceiptSeq: row.next_receipt_seq,
    nextStudentSeq: row.next_student_seq,
    attendanceLockHours: row.attendance_lock_hours,
    defaultAttendanceStatus: row.default_attendance_status,
    holidayListJson: row.holiday_list_json,
    notifyDueFee: row.notify_due_fee,
    notifyUpcomingDue: row.notify_upcoming_due,
    notifyMissingAttendance: row.notify_missing_attendance,
    notifyInactiveStudent: row.notify_inactive_student,
    sessionTimeoutMin: row.session_timeout_min,
    biometricEnabled: row.biometric_enabled,
    autoArchiveInactiveDays: row.auto_archive_inactive_days,
    theme: row.theme,
    palette: row.palette,
    density: row.density,
    reducedMotion: row.reduced_motion,
  };
}

export const handleSettings: RouteHandler = async (req, db, tenantId, path, method) => {
  // GET /api/v1/settings
  if (path === "/api/v1/settings" && method === "GET") {
    const settingsCacheKey = `settings:${tenantId}`;
    const cached = getCached(settingsCacheKey);
    if (cached) return ok(cached);
    const row = await oneRow(db, "SELECT * FROM settings WHERE tenant_id = ?", [tenantId]);
    const result = mapSettings(row);
    setCache(settingsCacheKey, result, 120_000);
    return ok(result);
  }

  // PATCH /api/v1/settings
  if (path === "/api/v1/settings" && method === "PATCH") {
    const body = await req.json().catch(() => ({}));
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      const col = SETTINGS_KEYS[k] ?? (k in SETTINGS_KEYS ? k : null);
      if (!col) continue;
      sets.push(`${col} = ?`);
      args.push(v);
    }
    if (!sets.length) return fail("no_valid_fields", 400);
    sets.push("updated_at = ?");
    args.push(new Date().toISOString());
    args.push(tenantId);
    await run(
      db,
      `INSERT OR IGNORE INTO settings (tenant_id, institute_name, tenant_secret, created_at, updated_at)
       VALUES (?, 'My Tuition', ?, ?, ?)`,
      [tenantId, crypto.randomUUID(), new Date().toISOString(), new Date().toISOString()],
    ).catch(() => {});
    await run(
      db,
      `UPDATE settings SET ${sets.join(", ")} WHERE tenant_id = ?`,
      args,
    );
    await recordAudit(db, tenantId, tenantId, "settings.update", "settings", tenantId, body);
    invalidateTenant(tenantId);
    const row = await oneRow(db, "SELECT * FROM settings WHERE tenant_id = ?", [tenantId]);
    return ok(mapSettings(row));
  }

  if (path === "/api/v1/settings/pin" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { pin_hash } = body;
    if (!pin_hash || typeof pin_hash !== "string") {
      return fail("pin_hash required", 400);
    }
    const now = new Date().toISOString();
    await run(db, `INSERT OR IGNORE INTO settings (tenant_id, institute_name, tenant_secret, created_at, updated_at) VALUES (?, 'My Tuition', ?, ?, ?)`,
      [tenantId, crypto.randomUUID(), now, now]).catch(() => {});
    await run(db, `UPDATE settings SET pin_hash = ?, updated_at = ? WHERE tenant_id = ?`,
      [pin_hash, now, tenantId]);
    await recordAudit(db, tenantId, tenantId, "pin.update", "settings", tenantId, {});
    invalidateTenant(tenantId);
    return ok({ ok: true });
  }

  return null;
};
