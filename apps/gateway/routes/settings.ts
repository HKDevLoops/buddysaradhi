import type { RouteHandler } from "./students.ts";
import { ok, fail } from "../lib/errors.ts";
import { recordAudit } from "./students.ts";
import { getCached, setCache, invalidateTenant } from "../lib/cache.ts";
import { createPrismaOrm } from "../lib/orm.ts";

export const handleSettings: RouteHandler = async (req, db, tenantId, path, method) => {
  const orm = createPrismaOrm(db, tenantId);

  // GET /api/v1/settings
  if (path === "/api/v1/settings" && method === "GET") {
    const settingsCacheKey = `settings:${tenantId}`;
    const cached = getCached(settingsCacheKey);
    if (cached) return ok(cached);

    const setting = await orm.setting.findFirst({ where: {} });
    setCache(settingsCacheKey, setting, 120_000);
    return ok(setting);
  }

  // PATCH /api/v1/settings
  if (path === "/api/v1/settings" && method === "PATCH") {
    const body = await req.json().catch(() => ({}));
    if (Object.keys(body).length === 0) return fail("no_valid_fields", 400);

    // P0 SECURITY FIX: Whitelist allowed fields to prevent mass assignment.
    // The spread `...body` pattern allows arbitrary field injection (pinHash,
    // tenantId, id, etc.). Only known settings fields are forwarded.
    const ALLOWED_SETTINGS_FIELDS = new Set([
      "instituteName", "institute_name",
      "instituteAddress", "institute_address",
      "institutePhone", "institute_phone",
      "instituteEmail", "institute_email",
      "currencyCode", "currency_code",
      "locale", "timezone",
      "defaultFeeModel", "default_fee_model",
      "invoicePrefix", "invoice_prefix",
      "receiptPrefix", "receipt_prefix",
      "graceDays", "grace_days",
      "autoInvoice", "auto_invoice",
      "attendanceLockHours", "attendance_lock_hours",
      "defaultAttendanceStatus", "default_attendance_status",
      "notifyDueFee", "notify_due_fee",
      "notifyUpcomingDue", "notify_upcoming_due",
      "notifyMissingAttendance", "notify_missing_attendance",
      "notifyInactiveStudent", "notify_inactive_student",
      "sessionTimeoutMin", "session_timeout_min",
      "biometricEnabled", "biometric_enabled",
      "autoArchiveInactiveDays", "auto_archive_inactive_days",
      "theme", "palette", "density",
      "reducedMotion", "reduced_motion",
    ]);
    const filteredBody: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (ALLOWED_SETTINGS_FIELDS.has(key)) {
        filteredBody[key] = value;
      }
    }

    if (Object.keys(filteredBody).length === 0) {
      return fail("no_valid_fields", 400);
    }

    const updated = await orm.setting.upsert({
      where: { tenantId },
      create: {
        instituteName: filteredBody.instituteName ?? filteredBody.institute_name ?? "My Tuition",
        ...filteredBody,
      },
      update: filteredBody,
    });

    await recordAudit(db, tenantId, tenantId, "settings.update", "settings", tenantId, filteredBody);
    invalidateTenant(tenantId);
    return ok(updated);
  }

  // POST /api/v1/settings/pin removed: uncontracted (absent from
  // contracts/openapi.yaml), zero callers in web/mobile/desktop, and it accepted
  // a client-supplied raw hash — the one path that could replace settings.pin_hash
  // without old-PIN re-verification. PIN writes go through the web
  // setPinAction (08_Settings.md SR-04: old PIN first, argon2id hash).

  return null;
};
