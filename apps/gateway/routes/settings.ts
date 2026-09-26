import type { RouteHandler } from "./students.ts";
import { ok, fail, failZod } from "../lib/errors.ts";
import { recordAudit, recordOutbox } from "./students.ts";
import { getCached, setCache, invalidateTenant } from "../lib/cache.ts";
import { createPrismaOrm } from "../lib/orm.ts";
import { z } from "zod";

// P0 SECURITY FIX, kept Zod-first (AGENTS.md §6.1): the original spread
// `...body` pattern allowed arbitrary field injection (pinHash, tenantSecret,
// plan, tenantId…). This object IS the allowlist — it replaces the
// ALLOWED_SETTINGS_FIELDS Set with the same keys, so unknown fields are still
// stripped, and every listed key is now type-checked as well (audit 2026-09-26
// "settings PATCH (audit only)" / S3-S4 allowlist findings).
const settingsText = z.string().max(500);
const settingsInt = z.number().int().min(0);
// Web writes flags as 0/1 (notifications-section.tsx:94), so both shapes pass.
const settingsFlag = z.union([z.boolean(), z.number().int().min(0).max(1)]);

const SETTINGS_PATCH_SCHEMA = z.object({
  instituteName: settingsText, institute_name: settingsText,
  instituteAddress: settingsText, institute_address: settingsText,
  institutePhone: settingsText, institute_phone: settingsText,
  instituteEmail: settingsText, institute_email: settingsText,
  currencyCode: settingsText, currency_code: settingsText,
  locale: settingsText, timezone: settingsText,
  defaultFeeModel: settingsText, default_fee_model: settingsText,
  invoicePrefix: settingsText, invoice_prefix: settingsText,
  receiptPrefix: settingsText, receipt_prefix: settingsText,
  graceDays: settingsInt, grace_days: settingsInt,
  autoInvoice: settingsFlag, auto_invoice: settingsFlag,
  attendanceLockHours: settingsInt, attendance_lock_hours: settingsInt,
  defaultAttendanceStatus: settingsText, default_attendance_status: settingsText,
  notifyDueFee: settingsFlag, notify_due_fee: settingsFlag,
  notifyUpcomingDue: settingsFlag, notify_upcoming_due: settingsFlag,
  notifyMissingAttendance: settingsFlag, notify_missing_attendance: settingsFlag,
  notifyInactiveStudent: settingsFlag, notify_inactive_student: settingsFlag,
  sessionTimeoutMin: settingsInt, session_timeout_min: settingsInt,
  biometricEnabled: settingsFlag, biometric_enabled: settingsFlag,
  autoArchiveInactiveDays: settingsInt, auto_archive_inactive_days: settingsInt,
  theme: settingsText, palette: settingsText, density: settingsText,
  reducedMotion: settingsFlag, reduced_motion: settingsFlag,
}).partial();

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

    const parsed = SETTINGS_PATCH_SCHEMA.safeParse(body);
    if (!parsed.success) return failZod(parsed.error);
    const filteredBody = parsed.data;

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

    // Fail-closed Rule 7 ordering: invalidate first so a thrown
    // recordOutbox/recordAudit never leaves pre-mutation GETs cached.
    invalidateTenant(tenantId);
    // Rule 7 (12_Business_Rules.md BR-SYN-01 / BR-SEC-03) — audit 2026-09-26
    // "gateway settings PATCH (audit only)": the settings upsert now writes
    // sync_outbox alongside audit_log in the same logical transaction.
    await recordOutbox(db, tenantId, "settings", tenantId, "upsert", filteredBody);
    await recordAudit(db, tenantId, tenantId, "settings.update", "settings", tenantId, filteredBody);
    return ok(updated);
  }

  // POST /api/v1/settings/pin removed: uncontracted (absent from
  // contracts/openapi.yaml), zero callers in web/mobile/desktop, and it accepted
  // a client-supplied raw hash — the one path that could replace settings.pin_hash
  // without old-PIN re-verification. PIN writes go through the web
  // setPinAction (08_Settings.md SR-04: old PIN first, argon2id hash).

  return null;
};
