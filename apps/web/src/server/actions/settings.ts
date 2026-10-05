"use server";

import { getAuthenticatedDb, getAuthenticatedPrisma, gatewayPatch } from "@/server/get-db";
import { createSupabaseServer, createSupabaseAdmin } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { z } from "zod";
import { verifyPin, encryptBackup } from "@/lib/crypto";
import {
  IMPORT_CHUNK_SIZE,
  MAX_IMPORT_ROWS,
  partitionDuplicates,
  studentDupKey,
  validateImportRows,
  type ImportRowError,
  type ValidImportRow,
} from "@/lib/csv-parse";
import { invalidateTenant } from "@/server/cache"; // workstream C wiring
import type { LibsqlProxy } from "@/lib/libsql-proxy";
import {
  evaluatePinLockout,
  isPinLockoutActive,
  pinLockoutCode,
  type PinLockoutState,
} from "@/server/pin-lockout";

// ---------------------------------------------------------------------------
// PIN ladder wiring (RFC-003 workstream A, deliverable 4).
// Implements: 02_Core_Logic.md §12.4; BR-SEC-03; EC-SEC-01; 08_Settings.md
// EC-03. The ladder thresholds live ONLY in `server/pin-lockout.ts` — this
// file counts consecutive failures from `audit_log` and enforces the state.
//
// Per-device note (EC-SEC-01): `pin_failed` / `pin_unlocked` / `pin_lockout`
// rows are device-local paper trail for the ladder and are deliberately NOT
// mirrored to `sync_outbox` — syncing brute-force counters across devices
// would merge independent devices' counts and break ladder semantics.
// Sensitive MUTATIONS below (pin change, delete) keep their outbox rows.
// ---------------------------------------------------------------------------

interface PinFailState {
  consecutiveFails: number;
  lockedUntilIso: string | null;
}

// Implements: 11_Data_Model.md §4.17 (audit_log) via the Prisma model surface
// (AGENTS.md §3.4 — no runtime raw SQL in apps/web). The proxy has no
// ORDER BY + LIMIT + IN raw path for callers to use; `findMany` with
// `action: { in: [...] }` + `orderBy` + `take` is the ORM spelling of the
// previous SELECT.
async function readPinFailState(db: LibsqlProxy, tenantId: string): Promise<PinFailState> {
  const rows = await db.auditLog.findMany({
    where: {
      tenantId,
      action: { in: ["pin_failed", "pin_unlocked", "pin_changed", "pin_lockout"] },
    },
    orderBy: { createdAt: "desc" },
    take: 16,
  });
  let consecutiveFails = 0;
  let lockedUntilIso: string | null = null;
  for (const row of rows) {
    const action = row.action as string | undefined;
    if (action === "pin_lockout" && lockedUntilIso === null) {
      try {
        const meta = JSON.parse((row.metadata as string | null) ?? "{}") as { locked_until?: unknown };
        if (typeof meta.locked_until === "string") lockedUntilIso = meta.locked_until;
      } catch {
        // malformed metadata — ignore, ladder still counts the failure
      }
    }
    if (action === "pin_failed") {
      consecutiveFails += 1;
      continue;
    }
    break;
  }
  return { consecutiveFails, lockedUntilIso };
}

async function writePinAudit(
  db: LibsqlProxy,
  tenantId: string,
  action: string,
  metadata: Record<string, unknown>,
  actor?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.auditLog.create({
    data: {
      id: crypto.randomUUID(),
      tenantId,
      actor: actor ?? tenantId,
      action,
      refType: "settings",
      refId: tenantId,
      metadata: JSON.stringify(metadata),
      createdAt: now,
    },
  });
}

export interface PinGateResult {
  ok: boolean;
  code?: "PIN_INVALID" | "PIN_LOCKED" | "PIN_WIPE_REQUIRED";
  retryInSeconds?: number;
  attemptsLeft?: number;
  failCount?: number;
}

/**
 * Single PIN verification gate for every server-side PIN check. Counts
 * consecutive `pin_failed` audit rows, enforces the 02 §12.4 ladder, writes
 * `pin_failed` / `pin_unlocked` / `pin_lockout` / `pin_lockout_wipe` audit
 * rows, and returns STABLE codes (UI mapping is workstream D's job).
 */
export async function verifyPinWithLadder(
  db: LibsqlProxy,
  tenantId: string,
  pin: string,
  pinHash: string,
): Promise<PinGateResult> {
  const nowIso = new Date().toISOString();
  const state = await readPinFailState(db, tenantId);
  const ladder = evaluatePinLockout(state.consecutiveFails);
  if (ladder.wipeRequired) {
    await writePinAudit(db, tenantId, "pin_lockout_wipe", { fail_count: state.consecutiveFails }, "system");
    return { ok: false, code: "PIN_WIPE_REQUIRED", failCount: state.consecutiveFails };
  }
  if (ladder.locked) {
    if (isPinLockoutActive(state.lockedUntilIso, nowIso)) {
      const retryInSeconds = state.lockedUntilIso
        ? Math.max(1, Math.ceil((Date.parse(state.lockedUntilIso) - Date.now()) / 1000))
        : Math.ceil(ladder.lockoutMs / 1000);
      return { ok: false, code: "PIN_LOCKED", retryInSeconds, failCount: state.consecutiveFails };
    }
    // Lockout window elapsed — allow the attempt; the count keeps
    // accumulating toward the next rung (02 §12.4: 6–9 extends, 11–14 extends).
  }
  const valid = await verifyPin(pin, pinHash);
  if (valid) {
    await writePinAudit(db, tenantId, "pin_unlocked", {});
    return { ok: true, failCount: 0 };
  }
  const failCount = state.consecutiveFails + 1;
  const next: PinLockoutState = evaluatePinLockout(failCount);
  if (next.wipeRequired) {
    await writePinAudit(db, tenantId, "pin_failed", { fail_count: failCount });
    await writePinAudit(db, tenantId, "pin_lockout_wipe", { fail_count: failCount }, "system");
    return { ok: false, code: "PIN_WIPE_REQUIRED", failCount };
  }
  let retryInSeconds: number | undefined;
  if (next.locked) {
    const lockedUntilIso = new Date(Date.now() + next.lockoutMs).toISOString();
    await writePinAudit(
      db,
      tenantId,
      "pin_lockout",
      { fail_count: failCount, locked_until: lockedUntilIso },
      "system",
    );
    retryInSeconds = Math.ceil(next.lockoutMs / 1000);
  }
  await writePinAudit(db, tenantId, "pin_failed", { fail_count: failCount });
  return {
    ok: false,
    code: pinLockoutCode(next) ?? "PIN_INVALID",
    retryInSeconds,
    attemptsLeft: next.attemptsLeft,
    failCount,
  };
}

// Module-private (NOT exported): "use server" files may only export async
// functions. PIN user copy for the 4 verify gates below; UI-facing copy also
// lives in lib/app-errors.ts (CONFLICT/PIN states).
function pinGateMessage(gate: PinGateResult): string {
  if (gate.code === "PIN_WIPE_REQUIRED") {
    return "Too many wrong PIN attempts. Sign out and sign back in to continue.";
  }
  if (gate.code === "PIN_LOCKED") {
    return `Too many wrong PIN attempts — try again in ${gate.retryInSeconds ?? 30}s.`;
  }
  if (typeof gate.attemptsLeft === "number" && gate.attemptsLeft > 0) {
    return `Incorrect PIN — ${gate.attemptsLeft} attempt${gate.attemptsLeft === 1 ? "" : "s"} left before lockout.`;
  }
  // The bare "Invalid PIN" carried no taxonomy code, so every client had to
  // pattern-match a literal to tell a wrong PIN from any other refusal.
  return "VALIDATION: The security PIN is incorrect.";
}

export async function createBackupAction(passphrase: string) {
  try {
    if (passphrase.length < 8) {
      return { success: false, error: "Passphrase must be at least 8 characters" };
    }

    const { db, tenantId } = await getAuthenticatedPrisma();
    // Rule 9 + AGENTS §3.4: a failed/missing-table read throws and is caught
    // below (typed failure). Never emit an empty-but-"successful" backup.
    const [settingsRows, studentsRows, ledgerRows] = await Promise.all([
      db.setting.findMany({ where: { tenantId } }),
      db.student.findMany({ where: { tenantId } }),
      db.ledgerEntry.findMany({ where: { tenantId } }),
    ]);

    const backupPayload = JSON.stringify({
      version: 1,
      tenantId,
      exportedAt: new Date().toISOString(),
      settings: settingsRows,
      students: studentsRows,
      ledger: ledgerRows,
    });

    // Rule 8: the passphrase is the KDF input (Argon2id), not just a check —
    // the backup must be restorable on any device with only the passphrase.
    const encryptedB64 = await encryptBackup(backupPayload, passphrase);
    const sizeBytes = Buffer.byteLength(encryptedB64, 'base64');
    const sizeKB = (sizeBytes / 1024).toFixed(1);

    return {
      success: true,
      data: {
        filename: `buddysaradhi_backup_${new Date().toISOString().split('T')[0]}.bsb`,
        size: `${sizeKB} KB`,
        mockBlobUrl: `data:application/octet-stream;base64,${encryptedB64}`,
      },
    };
  } catch (error) {
    log.error('create_backup_action_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: "Failed to generate backup" };
  }
}

export async function deleteTenantDataAction(pin: string) {
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const settingsRow = await db.setting.findFirst({ where: { tenantId } });
    const pinHash = (settingsRow?.pinHash ?? null) as string | null;
    if (!pinHash) {
      return { success: false, error: "No PIN configured. Set one in Settings → Security." };
    }
    const gate = await verifyPinWithLadder(db, tenantId, pin, pinHash);
    if (!gate.ok) {
      return { success: false, error: pinGateMessage(gate), code: gate.code, retryInSeconds: gate.retryInSeconds };
    }
    const now = new Date().toISOString();

    // Rule 7: archive + audit + sync_outbox in one transaction.
    // 11_Data_Model.md §4.18 CHECKs `op IN ('insert','update','soft_delete')` —
    // the previous 'batch_archive' literal is normalised to 'update' (same
    // tenant-wide archive payload, CHECK-valid op).
    await db.$transaction(async (tx) => {
      await tx.student.updateMany({
        where: { tenantId },
        data: { status: "archived", archivedAt: now, updatedAt: now },
      });
      await tx.syncOutbox.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          tableName: "students",
          rowId: tenantId,
          op: "update",
          payload: JSON.stringify({ archived_at: now }),
          createdAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          actor: tenantId,
          refType: "tenant",
          refId: tenantId,
          action: "tenant_data_deleted",
          metadata: JSON.stringify({ deleted_at: now }),
          createdAt: now,
        },
      });
    });

    invalidateTenant(tenantId); // workstream C wiring: full tenant wipe (data delete)
    return { success: true };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    log.error('delete_tenant_data_action_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: "Failed to delete data" };
  }
}

/**
 * Settings mass-assignment allowlist (08_Settings.md §3). Server-managed
 * fields are deliberately absent: `pinHash` is written only by `setPinAction`
 * (SR-04 — old-PIN re-verification, argon2id), and `plan` is billing state
 * written only by the checkout flow — never by a client-supplied PATCH.
 * Shared by `updateSettingAction` and `updateSettingsBatchAction`.
 */
const SETTING_WRITE_FIELDS: Record<string, boolean> = {
  instituteName: true, instituteAddress: true, institutePhone: true,
  instituteEmail: true, currencyCode: true, locale: true, timezone: true,
  defaultFeeModel: true, invoicePrefix: true, receiptPrefix: true,
  graceDays: true, autoInvoice: true, nextInvoiceSeq: true,
  nextReceiptSeq: true, nextStudentSeq: true,
  attendanceLockHours: true, defaultAttendanceStatus: true,
  holidayListJson: true, notifyDueFee: true, notifyUpcomingDue: true,
  notifyMissingAttendance: true, notifyInactiveStudent: true,
  sessionTimeoutMin: true, biometricEnabled: true,
  autoArchiveInactiveDays: true, theme: true, density: true,
  reducedMotion: true, palette: true,
};

// ---------------------------------------------------------------------------
// RFC-004 C4 compare-and-swap (defensive web side).
// Implements: docs/rfc/004-multi-device-network-contract.md C4 + K4;
// 12_Business_Rules.md BR-SYN-03 (LWW on `updated_at` for non-ledger rows —
// CAS is the enforcement: a stale base never silently wins, the loser gets a
// typed 409 + the fresh row instead of an LWW overwrite).
//
// The gateway workstream (parallel) owns server-side CAS (`base_updated_at`
// → 409 + server row). Until it lands, this action enforces CAS
// client-side-of-server: it re-reads the row inside the action, compares
// `updated_at`, and returns a typed CONFLICT instead of overwriting — and it
// forwards `base_updated_at` to the gateway so the server enforces the same
// contract once deployed. Either way a stale base never blind-overwrites.
// ---------------------------------------------------------------------------

/** Optional CAS base for the settings PATCH paths (RFC-004 C4). */
const SettingsCasOptionsSchema = z.object({
  base_updated_at: z.string().min(1).optional(),
});

export type SettingsCasOptions = z.infer<typeof SettingsCasOptionsSchema>;

export interface SettingsConflictResult {
  success: false;
  error: string;
  code: "CONFLICT";
  serverRow: Record<string, unknown> | null;
}

/**
 * Secret-bearing settings columns that must never echo in a 409 server row
 * (10_Security.md §1 trust model + §3.4 — pepper + hashes live in the DB,
 * never on the wire). Mirrors the gateway `toSafeSettings` projection
 * (apps/gateway/routes/settings.ts) in both snake_case and camelCase.
 */
const SETTINGS_SECRET_KEYS: ReadonlySet<string> = new Set([
  "pin_hash", "pinHash",
  "panic_pin_hash", "panicPinHash",
  "tenant_secret", "tenantSecret",
  "backup_passphrase_hash", "backupPassphraseHash",
]);

function toSafeSettingsRow(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!SETTINGS_SECRET_KEYS.has(key)) safe[key] = value;
  }
  return safe;
}

/** ISO-8601 base → epoch ms. `null` ms = legacy caller with no base (no CAS). */
function parseBaseMs(base: string | undefined): { ok: true; ms: number | null } | { ok: false; error: string } {
  if (base === undefined) return { ok: true, ms: null };
  const ms = Date.parse(base);
  if (Number.isNaN(ms)) {
    return { ok: false, error: "Invalid base_updated_at — must be an ISO-8601 timestamp" };
  }
  return { ok: true, ms };
}

/** Epoch ms of a settings row's `updated_at` (camelCase or snake_case, string or Date). */
function settingsRowMs(row: Record<string, unknown> | null): number | null {
  if (!row) return null;
  const raw: unknown = row.updatedAt ?? row.updated_at;
  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? null : ms;
  }
  if (raw instanceof Date) return raw.getTime();
  return null;
}

/** The gateway surfaces server-side CAS as HTTP 409 (RFC-004 C4, parallel workstream). */
function isGatewayConflict(error: string): boolean {
  return /Gateway 409\b/.test(error);
}

/**
 * Typed 409 envelope. The rejected attempt writes NOTHING — no settings
 * write, no `sync_outbox` row, no `audit_log` row (nothing happened) — but
 * the boundary is logged for forensics (Rule 9: no silent failures).
 */
function settingsConflict(serverRow: Record<string, unknown> | null): SettingsConflictResult {
  log.warn("cas_conflict_settings", "Settings CAS mismatch — rejected stale write");
  return {
    success: false,
    error: "CONFLICT: settings changed elsewhere",
    code: "CONFLICT",
    serverRow: toSafeSettingsRow(serverRow),
  };
}

export async function updateSettingAction(field: string, value: unknown, opts?: SettingsCasOptions) {
  try {
    await getAuthenticatedPrisma();

    // Workstream C wiring: resolve the tenant once for cache invalidation.
    // Best-effort by design — a successful write must never fail because
    // invalidation could not resolve the tenant (getDb handles are cached).
    let cacheTenantId: string | null = null;
    try {
      ({ tenantId: cacheTenantId } = await getAuthenticatedDb());
    } catch {
      cacheTenantId = null;
    }

    // Map UI camelCase field names to DB model fields
    // Prisma uses camelCase so we don't need to manually map to snake_case.
    const allowedFields = SETTING_WRITE_FIELDS;

    if (!allowedFields[field]) {
      return { success: false, error: "Invalid setting field: " + field };
    }

    // RFC-004 C4: Zod-parse the CAS base before any DB touch (AGENTS §6.1).
    const casParsed = SettingsCasOptionsSchema.safeParse(opts ?? {});
    if (!casParsed.success) {
      return { success: false, error: "Invalid CAS options", code: "VALIDATION" as const };
    }
    const base = parseBaseMs(casParsed.data.base_updated_at);
    if (!base.ok) {
      return { success: false, error: base.error, code: "VALIDATION" as const };
    }

    // Defensive pre-check (gateway CAS pending): re-read inside the action and
    // compare `updated_at`. Mismatch → typed CONFLICT, no write below runs.
    if (base.ms !== null) {
      const { db, tenantId } = await getAuthenticatedPrisma();
      const current = await db.setting.findFirst({ where: { tenantId } });
      const currentMs = settingsRowMs(current);
      if (current && currentMs !== null && currentMs !== base.ms) {
        return settingsConflict(current);
      }
    }

    // Check if new email is provided and update Supabase auth if so
    if (field === "instituteEmail" && value) {
      const supabase = await createSupabaseServer();
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.email !== value) {
        const { error: authError } = await supabase.auth.updateUser({ email: value as string });
        if (authError) {
          log.error('settings_update_auth_email_failed', authError.message, { instituteEmail: value });
          return { success: false, error: "Failed to update auth email: " + authError.message };
        }
      }
    }

    const updateData = { [field]: value };
    // Forward-compat: the gateway CAS (parallel workstream) reads this key.
    // The gateway Zod schema strips unknown keys today, so this is a no-op
    // until server-side CAS lands — the pre-check above is the live guard.
    const gatewayBody =
      base.ms !== null ? { ...updateData, base_updated_at: casParsed.data.base_updated_at } : updateData;
    const res = await gatewayPatch("/api/v1/settings", gatewayBody);

    if (!res.success) {
      // Server-side CAS won a race after our pre-check: surface its 409 with
      // a fresh safe-projected row; nothing is written locally.
      if (isGatewayConflict(res.error)) {
        const { db, tenantId } = await getAuthenticatedPrisma();
        return settingsConflict(await db.setting.findFirst({ where: { tenantId } }));
      }
      log.warn('settings_gateway_update_failed_using_direct_db', res.error);
      const { db, tenantId } = await getAuthenticatedPrisma();
      const now = new Date().toISOString();
      // Rule 7: the settings write, its sync_outbox row and its audit_log row
      // land in ONE write transaction (AGENTS.md §2; 11_Data_Model.md §4.18
      // CHECK-valid op 'update'; audit action 'settings.update' preserved).
      // The ORM surface does not auto-bump `updated_at` on this path, so the
      // fallback write stamps it itself — otherwise the CAS base would never
      // advance and every later write would falsely conflict.
      const payload = JSON.stringify(updateData);
      await db.$transaction(async (tx) => {
        await tx.setting.upsert({
          where: { tenantId },
          create: { tenantId, updatedAt: now, ...updateData },
          update: { ...updateData, updatedAt: now },
        });
        await tx.syncOutbox.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            tableName: "settings",
            rowId: tenantId,
            op: "update",
            payload,
            createdAt: now,
          },
        });
        await tx.auditLog.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            actor: tenantId,
            action: "settings.update",
            refType: "settings",
            refId: tenantId,
            metadata: JSON.stringify({ field, value }),
            createdAt: now,
          },
        });
      });
    }

    revalidatePath("/settings");
    revalidatePath("/dashboard");
    if (cacheTenantId) invalidateTenant(cacheTenantId, "settings:"); // workstream C: single setting write
    return { success: true };
  } catch (error) {
    log.error('settings_update_failed', error instanceof Error ? error.message : String(error), { field });
    return { success: false, error: "Failed to update setting" };
  }
}

export async function updateSettingsBatchAction(settingsObj: Record<string, unknown>, opts?: SettingsCasOptions) {
  try {
    // Workstream C wiring: best-effort tenant for cache invalidation (see
    // updateSettingAction — a successful write never fails on this lookup).
    let cacheTenantId: string | null = null;
    try {
      ({ tenantId: cacheTenantId } = await getAuthenticatedDb());
    } catch {
      cacheTenantId = null;
    }
    // Same allowlist as updateSettingAction — a batch payload must not be an
    // end-run around the single-field guard (pinHash/plan stay server-managed).
    const updateData: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(settingsObj)) {
      if (val !== undefined && SETTING_WRITE_FIELDS[key]) {
        updateData[key] = val;
      }
    }
    if (Object.keys(updateData).length === 0) {
      return { success: false, error: "No valid settings fields" };
    }

    // RFC-004 C4: same CAS contract as the single-field path (parsed before
    // any DB touch; stale base → typed CONFLICT with no write).
    const casParsed = SettingsCasOptionsSchema.safeParse(opts ?? {});
    if (!casParsed.success) {
      return { success: false, error: "Invalid CAS options", code: "VALIDATION" as const };
    }
    const base = parseBaseMs(casParsed.data.base_updated_at);
    if (!base.ok) {
      return { success: false, error: base.error, code: "VALIDATION" as const };
    }
    if (base.ms !== null) {
      const { db, tenantId } = await getAuthenticatedPrisma();
      const current = await db.setting.findFirst({ where: { tenantId } });
      const currentMs = settingsRowMs(current);
      if (current && currentMs !== null && currentMs !== base.ms) {
        return settingsConflict(current);
      }
    }

    const gatewayBody =
      base.ms !== null ? { ...updateData, base_updated_at: casParsed.data.base_updated_at } : updateData;
    const res = await gatewayPatch("/api/v1/settings", gatewayBody);
    if (!res.success) {
      if (isGatewayConflict(res.error)) {
        const { db, tenantId } = await getAuthenticatedPrisma();
        return settingsConflict(await db.setting.findFirst({ where: { tenantId } }));
      }
      log.warn('settings_batch_gateway_patch_failed_using_direct_db', res.error);
      const { db, tenantId } = await getAuthenticatedPrisma();
      const now = new Date().toISOString();
      // Rule 7: batch settings write, its sync_outbox row and its audit_log row
      // share ONE write transaction — CHECK-valid op 'update', audit action
      // 'settings.batch_update' preserved.
      const payload = JSON.stringify(updateData);
      await db.$transaction(async (tx) => {
        // See updateSettingAction: stamp `updated_at` so the CAS base advances.
        await tx.setting.upsert({
          where: { tenantId },
          create: { tenantId, updatedAt: now, ...updateData },
          update: { ...updateData, updatedAt: now },
        });
        await tx.syncOutbox.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            tableName: "settings",
            rowId: tenantId,
            op: "update",
            payload,
            createdAt: now,
          },
        });
        await tx.auditLog.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            actor: tenantId,
            action: "settings.batch_update",
            refType: "settings",
            refId: tenantId,
            metadata: JSON.stringify({ fields: Object.keys(updateData) }),
            createdAt: now,
          },
        });
      });
    }

    revalidatePath("/settings");
    revalidatePath("/dashboard");
    if (cacheTenantId) invalidateTenant(cacheTenantId, "settings:"); // workstream C wiring: batch settings write
    return { success: true };
  } catch (error) {
    log.error('settings_batch_update_error', error instanceof Error ? error.message : String(error));
    return { success: false, error: "Failed to update settings" };
  }
}

export async function updateThemeAction(theme: string, opts?: SettingsCasOptions) {
  return updateSettingAction("theme", theme, opts);
}

export async function deleteAccountAction(pin: string) {
  try {
    const supabase = await createSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }
    const userId = user.id;

    const { db, tenantId } = await getAuthenticatedPrisma();

    // BR-SEC-04: re-confirm with PIN before the destructive erase — same gate
    // as deleteTenantDataAction. 10_Security.md §18.1 step 1.
    const settingsRow = await db.setting.findFirst({ where: { tenantId } });
    const pinHash = (settingsRow?.pinHash ?? null) as string | null;
    if (!pinHash) {
      return { success: false, error: "No PIN configured. Set one in Settings → Security." };
    }
    const gate = await verifyPinWithLadder(db, tenantId, pin, pinHash);
    if (!gate.ok) {
      return { success: false, error: pinGateMessage(gate), code: gate.code, retryInSeconds: gate.retryInSeconds };
    }

    const now = new Date().toISOString();

    // 10_Security.md §18.1 step 2: erase_initiated MUST be recorded before any
    // row is deleted (BR-SEC-03). Fail-closed: a thrown error here aborts the
    // erase before anything is destroyed.
    await db.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        actor: tenantId,
        refType: "tenant",
        refId: tenantId,
        action: "erase_initiated",
        metadata: JSON.stringify({ scope: "account" }),
        createdAt: now,
      },
    });

    // 10_Security.md §18.1 step 4 — ONE atomic cascade (a single $transaction).
    // The previous five sequential executes could half-erase an
    // account (settings+students deleted, then a failure on the non-existent
    // `attendance` table aborted the rest).
    //
    // LEDGER-4 EXCEPTION (10_Security.md §9.2 / §18.1 step 4): the secure-erase
    // flow is the single audited place where ledger_entries is physically
    // deleted; every other code path posts a void instead. Erasing student PII
    // while leaving its fee history readable would fail the erase guarantee.
    // app_state carries tenant_secret + audit_chain_head — removing them
    // crypto-shreds every tamper hash (§9.3) and orphans the audit chain
    // (§18.1 step 3). audit_log rows SURVIVE as the erase record (§18.1 step 7).
    // Child-before-parent order is load-bearing (SQLite FK constraints): a
    // failure anywhere rolls the whole cascade back, so an account is never
    // half-erased.
    await db.$transaction(async (tx) => {
      await tx.ledgerEntry.deleteMany({ where: { tenantId } });
      await tx.receipt.deleteMany({ where: { tenantId } });
      await tx.invoice.deleteMany({ where: { tenantId } });
      await tx.feeScheduleItem.deleteMany({ where: { tenantId } });
      await tx.feePlan.deleteMany({ where: { tenantId } });
      await tx.attendanceRecord.deleteMany({ where: { tenantId } });
      await tx.attendanceSession.deleteMany({ where: { tenantId } });
      await tx.studentDocument.deleteMany({ where: { tenantId } });
      await tx.studentNote.deleteMany({ where: { tenantId } });
      // student_tags is a join table with no tenant_id column (single-tenant
      // DB): unfiltered delete is the only valid form.
      await tx.studentTag.deleteMany({});
      await tx.tag.deleteMany({ where: { tenantId } });
      await tx.studentEnrollment.deleteMany({ where: { tenantId } });
      await tx.guardian.deleteMany({ where: { tenantId } });
      await tx.student.deleteMany({ where: { tenantId } });
      await tx.batch.deleteMany({ where: { tenantId } });
      await tx.reminder.deleteMany({ where: { tenantId } });
      await tx.notification.deleteMany({ where: { tenantId } });
      await tx.syncOutbox.deleteMany({ where: { tenantId } });
      await tx.backupManifest.deleteMany({ where: { tenantId } });
      await tx.appState.deleteMany({ where: { tenantId } });
      await tx.setting.deleteMany({ where: { tenantId } });
      await tx.tutor.deleteMany({ where: { tenantId } });
    });

    const supabaseAdmin = await createSupabaseAdmin();
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      return { success: false, error: "Auth delete failed: " + deleteError.message };
    }

    // §18.1 step 7: erase_complete recorded AFTER the cascade — this row and
    // erase_initiated are all that remain, the audit chain severed with them.
    await db.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        actor: tenantId,
        refType: "tenant",
        refId: tenantId,
        action: "erase_complete",
        metadata: JSON.stringify({ scope: "account" }),
        createdAt: now,
      },
    });

    invalidateTenant(tenantId); // workstream C wiring: full tenant wipe (account erase)
    return { success: true };
  } catch (error) {
    log.error('delete_account_action_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: "Failed to delete account" };
  }
}

export async function setPinAction(newPin: string, currentPin?: string) {
  try {
    if (newPin.length < 4 || newPin.length > 8) {
      return { success: false, error: "PIN must be 4-8 digits" };
    }
    if (!/^\d+$/.test(newPin)) {
      return { success: false, error: "PIN must contain only digits" };
    }

    const { db, tenantId } = await getAuthenticatedPrisma();

    if (currentPin) {
      const settingsRow = await db.setting.findFirst({ where: { tenantId } });
      const existingHash = (settingsRow?.pinHash ?? null) as string | null;
      if (existingHash) {
        const gate = await verifyPinWithLadder(db, tenantId, currentPin, existingHash);
        if (!gate.ok) {
          return { success: false, error: pinGateMessage(gate), code: gate.code, retryInSeconds: gate.retryInSeconds };
        }
      }
    }

    const { hashPin } = await import("@/lib/crypto");
    const newHash = await hashPin(newPin);
    const now = new Date().toISOString();

    // Rule 7: pin update must also write sync_outbox + audit_log atomically —
    // the settings upsert plus both replication rows in ONE write transaction.
    await db.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { tenantId },
        create: {
          tenantId,
          instituteName: "My Tuition",
          tenantSecret: crypto.randomUUID(),
          pinHash: newHash,
          createdAt: now,
          updatedAt: now,
        },
        update: { pinHash: newHash, updatedAt: now },
      });
      await tx.syncOutbox.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          tableName: "settings",
          rowId: tenantId,
          op: "update",
          payload: JSON.stringify({ pin_updated_at: now }),
          createdAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          actor: tenantId,
          action: "pin.update",
          refType: "settings",
          refId: tenantId,
          metadata: JSON.stringify({ updated_at: now }),
          createdAt: now,
        },
      });
    });

    invalidateTenant(tenantId, "settings:"); // workstream C wiring: pin change may insert settings row
    return { success: true };
  } catch (error) {
    log.error('set_pin_action_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: "Failed to set PIN" };
  }
}

export async function verifyPinAction(pin: string) {
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const settingsRow = await db.setting.findFirst({ where: { tenantId } });
    const pinHash = (settingsRow?.pinHash ?? null) as string | null;
    if (!pinHash) {
      return { success: false, error: "No PIN configured", configured: false };
    }
    const gate = await verifyPinWithLadder(db, tenantId, pin, pinHash);
    if (!gate.ok) {
      return {
        success: false,
        error: pinGateMessage(gate),
        code: gate.code,
        configured: true,
        retryInSeconds: gate.retryInSeconds,
        attemptsLeft: gate.attemptsLeft,
      };
    }
    invalidateTenant(tenantId, "settings:"); // workstream C wiring: pin change may insert settings row
    return { success: true, configured: true };
  } catch (error) {
    log.error('verify_pin_action_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: "Failed to verify PIN" };
  }
}

export async function getPinStatusAction() {
  // Implements: 08_Settings.md BR-SEC-02 (mandatory app PIN) — the first-run
  // gate needs to know whether a PIN exists WITHOUT guessing one. Returns a
  // boolean only: the hash never crosses the boundary (10_Security.md §3).
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const settingsRow = await db.setting.findFirst({ where: { tenantId } });
    const configured = ((settingsRow?.pinHash ?? null) as string | null) !== null;
    return { success: true, configured };
  } catch (error) {
    log.error('pin_status_action_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: "Failed to read PIN status" };
  }
}

// ---------------------------------------------------------------------------
// Bulk students import (Settings → Bulk import card).
// Implements: 09_Backup_and_Import_Export.md §6.4 Pipeline D (students-only
// import: parse, validate, dedup, preview, transactional write) + §14.1 (row
// schema) + §15.4 (audit action import_students);
// 12_Business_Rules.md BR-IMP-03 (CSV contract), BR-STU-02 (skip duplicates,
// never merge), BR-STU-04 (code auto-generation), BR-SYN-01 (outbox row in the
// same transaction as its mutation), BR-M-01 (no money path exists here);
// AGENTS.md §2 Rules 6/7/9 + §3.4 (Prisma ORM only, no raw SQL) + §6.1
// (Zod-parse every input before any DB call).
//
// The client parses and previews with the shared validator in
// `@/lib/csv-parse`; this action re-validates the posted headers and rows
// with the same validator before touching the DB, so a crafted request can
// never bypass the preview. Writes land in chunks of IMPORT_CHUNK_SIZE rows,
// each chunk one write transaction holding the student rows, their outbox
// rows, and their audit rows together (Rule 7, same shape as
// createStudent/deleteTenantDataAction above).
//
// Typed refusals (nothing is written for any of these): financial headers
// (Rule 6 — an import never touches money or the ledger, so a money-shaped
// file is refused, not coerced), header mismatch, row cap. Exact duplicates
// (same name and phone, in-file or already in the roster) are skipped and
// counted, never merged (BR-STU-02).
// ---------------------------------------------------------------------------

/** Transport guard only; the product row cap is the typed TOO_MANY_ROWS below. */
const ImportStudentsPayloadSchema = z.object({
  headers: z.array(z.string().max(120)).min(1).max(20),
  rows: z.array(z.array(z.string().max(4096)).max(20)).max(10000),
});

export interface ImportStudentsSummary {
  created: number;
  skipped: number;
  invalid: ImportRowError[];
  batchesCreated: number;
}

export type ImportStudentsResult =
  | { success: true; data: ImportStudentsSummary }
  | { success: false; error: string; code: string };

/**
 * BR-STU-04: blank codes auto-generate. Same collision-free recipe as the
 * single-create path in students.ts (4 random bytes as hex, S- prefix, no
 * DB roundtrip, so two devices never hand out the same code).
 */
function generateImportStudentCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `S-${Array.from(bytes, (byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join("")}`;
}

function proxyText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * BR-M-01: exact rupee decimal string → integer paise with integer math only
 * (BigInt), so no float ever touches a money value. Mirrors `rupeesToPaise`
 * in server/actions/students.ts line-for-line (that helper is module-private
 * in a `"use server"` file, which may only export async functions, so the
 * import flow carries its own copy rather than a second dialect). The import
 * schema caps the whole part at 12 digits, so the result stays inside
 * Number.MAX_SAFE_INTEGER.
 */
function importRupeesToPaise(rupees: string): number {
  const [whole, frac = ""] = rupees.split(".");
  // BigInt() calls (not 100n literals): tsconfig target is ES2017.
  const paise = BigInt(whole) * BigInt(100) + BigInt((frac + "00").slice(0, 2));
  return Number(paise);
}

export async function importStudentsAction(input: unknown): Promise<ImportStudentsResult> {
  try {
    const parsed = ImportStudentsPayloadSchema.safeParse(input);
    if (!parsed.success) {
      log.warn("import_students_invalid_payload", "Bulk import payload failed Zod parse");
      return {
        success: false,
        error: "Invalid import payload. Re-upload the CSV file.",
        code: "VALIDATION",
      };
    }
    const checked = validateImportRows(parsed.data.headers, parsed.data.rows);
    if (!checked.ok) {
      log.warn("import_students_refused", checked.issue.message, { code: checked.issue.code });
      return { success: false, error: checked.issue.message, code: checked.issue.code };
    }

    const { unique, duplicates } = partitionDuplicates(checked.valid);
    const { db, tenantId } = await getAuthenticatedPrisma();
    const today = new Date().toISOString().slice(0, 10);

    // Exact-duplicate screen (BR-STU-02): one roster read, in-memory keys, so
    // the check stays one query no matter how many rows arrive.
    const existing = await db.student.findMany({ where: { tenantId } });
    const seen = new Set(
      existing.map((entry: { firstName?: unknown; lastName?: unknown; phone?: unknown }) =>
        studentDupKey(
          proxyText(entry.firstName) ?? "",
          proxyText(entry.lastName),
          proxyText(entry.phone),
        ),
      ),
    );
    const fresh: ValidImportRow[] = [];
    let skipped = duplicates.length;
    for (const item of unique) {
      const key = studentDupKey(item.data.first_name, item.data.last_name, item.data.phone);
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
      fresh.push(item);
    }

    // Batch names resolve before any student write: known batches link by id,
    // missing batches are created once (subject General, same fallback as the
    // single-create path) with their own outbox and audit rows.
    const batchNames = [
      ...new Set(
        fresh
          .map((item) => item.data.batch)
          .filter((name): name is string => typeof name === "string"),
      ),
    ];
    const batchIdByName = new Map<string, string>();
    let batchesCreated = 0;
    if (batchNames.length > 0) {
      const batchRows: Array<{ id?: unknown; name?: unknown }> = await db.batch.findMany({
        where: { tenantId },
      });
      for (const entry of batchRows) {
        const id = proxyText(entry.id);
        const name = proxyText(entry.name);
        if (id !== null && name !== null) batchIdByName.set(name, id);
      }
      const missing = batchNames.filter((name) => !batchIdByName.has(name));
      if (missing.length > 0) {
        await db.$transaction(async (tx) => {
          for (const name of missing) {
            const id = crypto.randomUUID();
            const stamped = new Date().toISOString();
            await tx.batch.create({
              data: {
                id,
                tenantId,
                tutorId: null,
                name,
                subject: "General",
                createdAt: stamped,
                updatedAt: stamped,
              },
            });
            await tx.syncOutbox.create({
              data: {
                id: crypto.randomUUID(),
                tenantId,
                tableName: "batches",
                rowId: id,
                op: "insert",
                payload: JSON.stringify({ name, source: "import" }),
                createdAt: stamped,
              },
            });
            await tx.auditLog.create({
              data: {
                id: crypto.randomUUID(),
                tenantId,
                actor: tenantId,
                action: "batch.create",
                refType: "batch",
                refId: id,
                metadata: JSON.stringify({ source: "import", name }),
                createdAt: stamped,
              },
            });
            batchIdByName.set(name, id);
          }
        });
        batchesCreated = missing.length;
      }
    }

    // Chunked writes: each chunk commits its students plus their outbox and
    // audit rows together. A chunk failure rolls back that chunk only; prior
    // chunks stay committed and the counts report exactly what landed.
    // Imported money is the fee-model base only (Rule 6: the rupee decimal
    // converts to integer paise above with integer math; balances start at 0
    // paise). No ledger row is written anywhere on this path (09 §6.4).
    let created = 0;
    for (let start = 0; start < fresh.length; start += IMPORT_CHUNK_SIZE) {
      const slice = fresh.slice(start, start + IMPORT_CHUNK_SIZE);
      await db.$transaction(async (tx) => {
        for (const item of slice) {
          const rowData = item.data;
          const id = crypto.randomUUID();
          const code = generateImportStudentCode();
          const stamped = new Date().toISOString();
          const admissionDate = rowData.admission_date ?? today;
          const batchId =
            rowData.batch === undefined ? undefined : batchIdByName.get(rowData.batch);
          await tx.student.create({
            data: {
              id,
              tenantId,
              code,
              firstName: rowData.first_name,
              lastName: rowData.last_name ?? null,
              dob: rowData.dob ?? null,
              gender: rowData.gender ?? null,
              phone: rowData.phone ?? null,
              address: rowData.address ?? null,
              school: rowData.school ?? null,
              grade: rowData.grade ?? null,
              board: rowData.board ?? null,
              admissionDate,
              status: rowData.status,
              feeModel: rowData.fee_model,
              baseFeePaise: importRupeesToPaise(rowData.base_fee_rupees),
              balancePaise: 0,
              dupKey: studentDupKey(rowData.first_name, rowData.last_name, rowData.phone),
              createdAt: stamped,
              updatedAt: stamped,
            },
          });
          await tx.syncOutbox.create({
            data: {
              id: crypto.randomUUID(),
              tenantId,
              tableName: "students",
              rowId: id,
              op: "insert",
              payload: JSON.stringify({ id, code, first_name: rowData.first_name, source: "import" }),
              createdAt: stamped,
            },
          });
          await tx.auditLog.create({
            data: {
              id: crypto.randomUUID(),
              tenantId,
              actor: tenantId,
              action: "student.create",
              refType: "student",
              refId: id,
              metadata: JSON.stringify({ source: "import", code }),
              createdAt: stamped,
            },
          });
          if (batchId !== undefined) {
            const enrollmentId = crypto.randomUUID();
            await tx.studentEnrollment.create({
              data: {
                id: enrollmentId,
                tenantId,
                studentId: id,
                batchId,
                joinedOn: admissionDate,
                createdAt: stamped,
                updatedAt: stamped,
              },
            });
            await tx.syncOutbox.create({
              data: {
                id: crypto.randomUUID(),
                tenantId,
                tableName: "student_enrollments",
                rowId: enrollmentId,
                op: "insert",
                payload: JSON.stringify({ student_id: id, batch_id: batchId, source: "import" }),
                createdAt: stamped,
              },
            });
          }
        }
      });
      created += slice.length;
    }

    // Summary audit row (09 §15.4 action import_students). The import already
    // committed, so this row is diagnostics: a failure is logged loudly
    // (Rule 9) without rewriting the counts already returned below.
    try {
      await db.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          actor: tenantId,
          action: "import_students",
          refType: "tenant",
          refId: tenantId,
          metadata: JSON.stringify({
            created,
            skipped,
            invalid: checked.invalid.length,
            batches_created: batchesCreated,
            source: "settings_bulk_import",
          }),
          createdAt: new Date().toISOString(),
        },
      });
    } catch (auditError) {
      log.error(
        "import_students_summary_audit_failed",
        auditError instanceof Error ? auditError.message : String(auditError),
      );
    }

    if (batchesCreated > 0) invalidateTenant(tenantId, "attendance:");
    revalidatePath("/students");
    revalidatePath("/dashboard");
    return {
      success: true,
      data: { created, skipped, invalid: checked.invalid, batchesCreated },
    };
  } catch (error) {
    log.error(
      "import_students_action_failed",
      error instanceof Error ? error.message : String(error),
    );
    return { success: false, error: "Failed to import students", code: "IMPORT_FAILED" };
  }
}
