import type { RouteHandler } from "./students.ts";
import { ok, fail, failZod, failValidation } from "../lib/errors.ts";
import { recordAudit, recordOutbox } from "./students.ts";
import { getCached, setCache, invalidateTenant, REFERENCE_TTL_MS } from "../lib/cache.ts";
import { createPrismaOrm } from "../lib/orm.ts";
import { withWriteTransaction } from "../lib/tx.ts";
import {
  idempotencyRoute,
  okEnvelope,
  replayIfDuplicate,
  requireIdempotencyKey,
  storeIdempotentResponse,
} from "../lib/idempotency.ts";
import { CasConflictError, casConflictResponse, readCasBase } from "../lib/cas.ts";
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
    // 10_Security.md §1/§3.4 (tenant_secret + pin_hash never leave the DB in
    // plaintext) — the row is projected BEFORE it is cached or returned, so
    // neither the edge cache nor any caller can echo secrets (anti-tamper
    // parity). Mirrors the graphql `settings` resolver projection.
    const safe = toSafeSettings(setting);
    setCache(settingsCacheKey, safe, REFERENCE_TTL_MS);
    return ok(safe);
  }

  // PATCH /api/v1/settings
  if (path === "/api/v1/settings" && method === "PATCH") {
    // RFC-004 C1 — fail-closed (see routes/ledger.ts payment path).
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const body = await req.json().catch(() => ({}));
    // RFC-004 C4 — the CAS base is read from the RAW body: it must never enter
    // the Zod allowlist below (which becomes the DB update), or clients could
    // write `base_updated_at` as a settings column.
    const casBase = readCasBase(body);
    if (casBase === "INVALID") {
      return failValidation("base_updated_at must be an ISO timestamp string (RFC-004 C4)");
    }
    if (Object.keys(body).length === 0) return fail("no_valid_fields", 400);

    const parsed = SETTINGS_PATCH_SCHEMA.safeParse(body);
    if (!parsed.success) return failZod(parsed.error);

    // A field the allowlist does not name is REJECTED, not stripped-and-ignored.
    //
    // `z.object().partial()` silently drops unknown keys, so a client that
    // PATCHed `{ next_receipt_seq: 1 }` — the monotonic sequence counter that
    // BR-RC-01 says is consumed forever and never rewound — got HTTP 200 and a
    // settings row unchanged. That is the "accept and drop" defect: the caller
    // is told the write happened. It matters most for the fields a client would
    // most plausibly try to reach: `pin_hash`, `tenant_secret`, `plan`,
    // `next_invoice_seq`, `next_receipt_seq`, `next_student_seq`, `tenant_id`,
    // `created_at` (AGENTS.md §2 Rule 1/6, BR-RC-01).
    //
    // This runs BEFORE the empty-payload guard so a PATCH whose every field is
    // unknown names the offending field rather than the generic `no_valid_fields`.
    //
    // `base_updated_at` is excluded: RFC-004 C4 reads it from the RAW body and it
    // must never enter the Zod allowlist, so a legitimate CAS-only PATCH
    // (compare-and-swap probe with nothing to change) is not an injection.
    const CAS_KEYS = new Set(["base_updated_at", "baseUpdatedAt"]);
    const rejected = Object.keys(body).filter((k) => !CAS_KEYS.has(k) && !(k in parsed.data));
    if (rejected.length > 0) {
      return failValidation(
        `not a writable settings field: ${rejected.join(", ")}. ` +
          "A settings PATCH may only carry the fields a tutor sets in " +
          "08_Settings.md — institute identity, currency/locale, fee model, " +
          "invoice/receipt prefixes, grace days, auto-invoice, attendance lock, " +
          "notification toggles, session/biometric/auto-archive, theme/palette/" +
          "density/reduced-motion. Secret columns (pin_hash, tenant_secret, " +
          "backup_passphrase_hash) and the monotonic sequence counters " +
          "(next_invoice_seq, next_receipt_seq, next_student_seq) are " +
          "server-owned (BR-RC-01) and are never client-writable.",
      );
    }

    const filteredBody = parsed.data;
    if (Object.keys(filteredBody).length === 0) {
      return fail("no_valid_fields", 400);
    }

    // Flags are INTEGER columns in the DDL (`auto_invoice INTEGER DEFAULT 0`,
    // lib/schema.ts:31). The allowlist deliberately accepts a JSON boolean
    // because clients send both shapes — but a JS boolean is not a bindable
    // SQLite value and reaches the driver as-is, so it fails at execute time
    // (or, worse on a lenient driver, coerces unpredictably). Normalise here,
    // once, so the column type and the wire type can differ safely.
    const normalisedBody: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(filteredBody)) {
      normalisedBody[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
    }

    let updated: Record<string, unknown> | null;
    try {
      updated = await withWriteTransaction(db, async (tx) => {
        const txOrm = createPrismaOrm(tx, tenantId);
        // RFC-004 C4 — compare-and-swap on the settings singleton, read in the
        // SAME transaction that writes (no TOCTOU). Absent base = documented
        // legacy last-write-wins; no existing row = creation, nothing to
        // conflict with.
        const current = await txOrm.setting.findFirst({ where: {} });
        if (current && casBase && casBase !== String(current.updatedAt ?? "")) {
          throw new CasConflictError(toSafeSettings(current));
        }
        const row = await txOrm.setting.upsert({
          where: { tenantId },
          create: {
            instituteName: normalisedBody.instituteName ?? normalisedBody.institute_name ?? "My Tuition",
            ...normalisedBody,
          },
          update: normalisedBody,
        });

        // Rule 7 (12_Business_Rules.md BR-SYN-01 / BR-SEC-03) — the settings
        // upsert writes sync_outbox alongside audit_log in the SAME write
        // transaction (fail-closed on any write failure).
        // Op is "update" (not "upsert"): the migration CHECK on sync_outbox.op
        // allows only (insert, update, soft_delete), and the audit row below
        // already records this mutation as "settings.update".
        await recordOutbox(tx, tenantId, "settings", tenantId, "update", normalisedBody);
        await recordAudit(tx, tenantId, tenantId, "settings.update", "settings", tenantId, normalisedBody);
        // RFC-004 C1 — response bytes commit atomically with the upsert (see
        // routes/ledger.ts payment path). Never echo the stored row (it carries
        // pin_hash/tenant_secret): project first, same as the GET path.
        const payload = toSafeSettings(row);
        const env = okEnvelope(200, payload);
        await storeIdempotentResponse(tx, tenantId, idemRoute, idemKey, env.code, env.body);
        return payload;
      });
    } catch (err) {
      if (err instanceof CasConflictError) return casConflictResponse(err.serverRow);
      // RFC-004 K2/K3 — concurrent-duplicate race (see routes/ledger.ts).
      const replay = await replayIfDuplicate(db, tenantId, idemRoute, idemKey, err);
      if (replay) return replay;
      throw err;
    }

    // Cache invalidation follows COMMIT (a rolled-back transaction left the
    // rows untouched, so the cached GET is still correct).
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

/**
 * 10_Security.md §1 trust model + §3.4 (the pepper + PIN hash live in the DB,
 * never on the wire): strip every secret-bearing column before a settings row
 * is cached or returned. The PATCH allowlist already blocks WRITES to these
 * columns; this blocks READS. Mirrors graphql/resolvers.ts `settings`.
 */
function toSafeSettings(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  const {
    pinHash: _pinHash,
    pin_hash: _pinHashSnake,
    panicPinHash: _panicPinHash,
    panic_pin_hash: _panicPinHashSnake,
    tenantSecret: _tenantSecret,
    tenant_secret: _tenantSecretSnake,
    backupPassphraseHash: _backupPassphraseHash,
    backup_passphrase_hash: _backupPassphraseHashSnake,
    ...safe
  } = row;
  return safe;
}
