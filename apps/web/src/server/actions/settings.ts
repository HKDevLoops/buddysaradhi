"use server";

import { getAuthenticatedDb, getAuthenticatedPrisma, gatewayPatch, createLibsqlProxy } from "@/server/get-db";
import { createSupabaseServer, createSupabaseAdmin } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { z } from "zod";
import { verifyPin, encryptBackup } from "@/lib/crypto";
import { invalidateTenant } from "@/server/cache"; // workstream C wiring
import type { Client } from "@libsql/client";
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

async function readPinFailState(client: Client, tenantId: string): Promise<PinFailState> {
  const res = await client.execute({
    sql: `SELECT action, metadata, created_at FROM audit_log
          WHERE tenant_id = ? AND action IN ('pin_failed','pin_unlocked','pin_changed','pin_lockout')
          ORDER BY created_at DESC LIMIT 16`,
    args: [tenantId],
  });
  let consecutiveFails = 0;
  let lockedUntilIso: string | null = null;
  for (const row of res.rows) {
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
  client: Client,
  tenantId: string,
  action: string,
  metadata: Record<string, unknown>,
  actor?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
          VALUES (?, ?, ?, ?, 'settings', ?, ?, ?)`,
    args: [crypto.randomUUID(), tenantId, actor ?? tenantId, action, tenantId, JSON.stringify(metadata), now],
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
  client: Client,
  tenantId: string,
  pin: string,
  pinHash: string,
): Promise<PinGateResult> {
  const nowIso = new Date().toISOString();
  const state = await readPinFailState(client, tenantId);
  const ladder = evaluatePinLockout(state.consecutiveFails);
  if (ladder.wipeRequired) {
    await writePinAudit(client, tenantId, "pin_lockout_wipe", { fail_count: state.consecutiveFails }, "system");
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
    await writePinAudit(client, tenantId, "pin_unlocked", {});
    return { ok: true, failCount: 0 };
  }
  const failCount = state.consecutiveFails + 1;
  const next: PinLockoutState = evaluatePinLockout(failCount);
  if (next.wipeRequired) {
    await writePinAudit(client, tenantId, "pin_failed", { fail_count: failCount });
    await writePinAudit(client, tenantId, "pin_lockout_wipe", { fail_count: failCount }, "system");
    return { ok: false, code: "PIN_WIPE_REQUIRED", failCount };
  }
  let retryInSeconds: number | undefined;
  if (next.locked) {
    const lockedUntilIso = new Date(Date.now() + next.lockoutMs).toISOString();
    await writePinAudit(
      client,
      tenantId,
      "pin_lockout",
      { fail_count: failCount, locked_until: lockedUntilIso },
      "system",
    );
    retryInSeconds = Math.ceil(next.lockoutMs / 1000);
  }
  await writePinAudit(client, tenantId, "pin_failed", { fail_count: failCount });
  return {
    ok: false,
    code: pinLockoutCode(next) ?? "PIN_INVALID",
    retryInSeconds,
    attemptsLeft: next.attemptsLeft,
    failCount,
  };
}

export function pinGateMessage(gate: PinGateResult): string {
  if (gate.code === "PIN_WIPE_REQUIRED") {
    return "Too many wrong PIN attempts. Sign out and sign back in to continue.";
  }
  if (gate.code === "PIN_LOCKED") {
    return `Too many wrong PIN attempts — try again in ${gate.retryInSeconds ?? 30}s.`;
  }
  if (typeof gate.attemptsLeft === "number" && gate.attemptsLeft > 0) {
    return `Incorrect PIN — ${gate.attemptsLeft} attempt${gate.attemptsLeft === 1 ? "" : "s"} left before lockout.`;
  }
  return "Invalid PIN";
}

export async function createBackupAction(passphrase: string) {
  try {
    if (passphrase.length < 8) {
      return { success: false, error: "Passphrase must be at least 8 characters" };
    }

    const { client, tenantId } = await getAuthenticatedDb();
    // Rule 9 + AGENTS §3.4: a failed/missing-table read throws and is caught
    // below (typed failure). Never emit an empty-but-"successful" backup.
    const [settingsRes, studentsRes, ledgerRes] = await Promise.all([
      client.execute({ sql: "SELECT * FROM settings WHERE tenant_id = ?", args: [tenantId] }),
      client.execute({ sql: "SELECT * FROM students WHERE tenant_id = ?", args: [tenantId] }),
      client.execute({ sql: "SELECT * FROM ledger_entries WHERE tenant_id = ?", args: [tenantId] }),
    ]);

    const backupPayload = JSON.stringify({
      version: 1,
      tenantId,
      exportedAt: new Date().toISOString(),
      settings: settingsRes.rows,
      students: studentsRes.rows,
      ledger: ledgerRes.rows,
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
    const { client, tenantId } = await getAuthenticatedDb();
    const settingsRow = await client.execute({
      sql: "SELECT pin_hash FROM settings WHERE tenant_id = ?",
      args: [tenantId],
    });
    const pinHash = settingsRow.rows[0]?.pin_hash as string | null;
    if (!pinHash) {
      return { success: false, error: "No PIN configured. Set one in Settings → Security." };
    }
    const gate = await verifyPinWithLadder(client, tenantId, pin, pinHash);
    if (!gate.ok) {
      return { success: false, error: pinGateMessage(gate), code: gate.code, retryInSeconds: gate.retryInSeconds };
    }
    const now = new Date().toISOString();

    // Rule 7: archive + audit + sync_outbox in one batch
    await client.batch(
      [
        {
          sql: `UPDATE students SET status = 'archived', archived_at = ?, updated_at = ? WHERE tenant_id = ?`,
          args: [now, now, tenantId],
        },
        {
          sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at) VALUES (?, ?, 'students', ?, 'batch_archive', ?, ?)`,
          args: [crypto.randomUUID(), tenantId, tenantId, JSON.stringify({ archived_at: now }), now],
        },
        {
          sql: `INSERT INTO audit_log (id, tenant_id, actor, ref_type, ref_id, action, metadata, created_at)
                VALUES (?, ?, ?, 'tenant', ?, 'tenant_data_deleted', ?, ?)`,
          args: [crypto.randomUUID(), tenantId, tenantId, tenantId, JSON.stringify({ deleted_at: now }), now],
        },
      ],
      "write",
    );

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
      const { client, tenantId } = await getAuthenticatedDb();
      const proxy = createLibsqlProxy(client);
      const current = await proxy.setting.findFirst({ where: { tenantId } });
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
        const { client, tenantId } = await getAuthenticatedDb();
        const proxy = createLibsqlProxy(client);
        return settingsConflict(await proxy.setting.findFirst({ where: { tenantId } }));
      }
      log.warn('settings_gateway_update_failed_using_direct_db', res.error);
      const { client, tenantId } = await getAuthenticatedDb();
      const proxy = createLibsqlProxy(client);
      const now = new Date().toISOString();
      // The libsql proxy is raw SQL (no Prisma `@updatedAt` bump), so the
      // fallback write stamps `updated_at` itself — otherwise the CAS base
      // would never advance and every later write would falsely conflict.
      await proxy.setting.upsert({
        where: { tenantId },
        create: { tenantId, updatedAt: now, ...updateData },
        update: { ...updateData, updatedAt: now },
      });
      // Rule 7: every mutation writes sync_outbox + audit_log in same logical transaction
      const payload = JSON.stringify(updateData);
      await client.batch(
        [
          {
            sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at) VALUES (?, ?, 'settings', ?, 'update', ?, ?)`,
            args: [crypto.randomUUID(), tenantId, tenantId, payload, now],
          },
          {
            sql: `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at) VALUES (?, ?, ?, 'settings.update', 'settings', ?, ?, ?)`,
            args: [crypto.randomUUID(), tenantId, tenantId, tenantId, JSON.stringify({ field, value }), now],
          },
        ],
        "write",
      );
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
      const { client, tenantId } = await getAuthenticatedDb();
      const proxy = createLibsqlProxy(client);
      const current = await proxy.setting.findFirst({ where: { tenantId } });
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
        const { client, tenantId } = await getAuthenticatedDb();
        const proxy = createLibsqlProxy(client);
        return settingsConflict(await proxy.setting.findFirst({ where: { tenantId } }));
      }
      log.warn('settings_batch_gateway_patch_failed_using_direct_db', res.error);
      const { client, tenantId } = await getAuthenticatedDb();
      const proxy = createLibsqlProxy(client);
      const now = new Date().toISOString();
      // See updateSettingAction: stamp `updated_at` so the CAS base advances.
      await proxy.setting.upsert({
        where: { tenantId },
        create: { tenantId, updatedAt: now, ...updateData },
        update: { ...updateData, updatedAt: now },
      });
      // Rule 7: batch sync_outbox + audit_log alongside settings mutation
      const payload = JSON.stringify(updateData);
      await client.batch(
        [
          {
            sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at) VALUES (?, ?, 'settings', ?, 'update', ?, ?)`,
            args: [crypto.randomUUID(), tenantId, tenantId, payload, now],
          },
          {
            sql: `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at) VALUES (?, ?, ?, 'settings.batch_update', 'settings', ?, ?, ?)`,
            args: [crypto.randomUUID(), tenantId, tenantId, tenantId, JSON.stringify({ fields: Object.keys(updateData) }), now],
          },
        ],
        "write",
      );
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

    const { client, tenantId } = await getAuthenticatedDb();

    // BR-SEC-04: re-confirm with PIN before the destructive erase — same gate
    // as deleteTenantDataAction. 10_Security.md §18.1 step 1.
    const settingsRow = await client.execute({
      sql: "SELECT pin_hash FROM settings WHERE tenant_id = ?",
      args: [tenantId],
    });
    const pinHash = settingsRow.rows[0]?.pin_hash as string | null;
    if (!pinHash) {
      return { success: false, error: "No PIN configured. Set one in Settings → Security." };
    }
    const gate = await verifyPinWithLadder(client, tenantId, pin, pinHash);
    if (!gate.ok) {
      return { success: false, error: pinGateMessage(gate), code: gate.code, retryInSeconds: gate.retryInSeconds };
    }

    const now = new Date().toISOString();

    // 10_Security.md §18.1 step 2: erase_initiated MUST be recorded before any
    // row is deleted (BR-SEC-03). Fail-closed: a thrown error here aborts the
    // erase before anything is destroyed.
    await client.execute({
      sql: `INSERT INTO audit_log (id, tenant_id, actor, ref_type, ref_id, action, metadata, created_at)
            VALUES (?, ?, ?, 'tenant', ?, 'erase_initiated', ?, ?)`,
      args: [crypto.randomUUID(), tenantId, tenantId, tenantId, JSON.stringify({ scope: "account" }), now],
    });

    // 10_Security.md §18.1 step 4 — ONE atomic cascade (libsql batch = single
    // transaction). The previous five sequential executes could half-erase an
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
    await client.batch(
      [
        { sql: "DELETE FROM ledger_entries WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM receipts WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM invoices WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM fee_schedule_items WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM fee_plans WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM attendance_records WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM attendance_sessions WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM student_documents WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM student_notes WHERE tenant_id = ?", args: [tenantId] },
        // student_tags is a join table with no tenant_id column (single-tenant
        // DB): unfiltered delete is the only valid form.
        { sql: "DELETE FROM student_tags", args: [] },
        { sql: "DELETE FROM tags WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM student_enrollments WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM guardians WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM students WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM batches WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM reminders WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM notifications WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM sync_outbox WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM backup_manifest WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM app_state WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM settings WHERE tenant_id = ?", args: [tenantId] },
        { sql: "DELETE FROM tutors WHERE tenant_id = ?", args: [tenantId] },
      ],
      "write",
    );

    const supabaseAdmin = await createSupabaseAdmin();
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      return { success: false, error: "Auth delete failed: " + deleteError.message };
    }

    // §18.1 step 7: erase_complete recorded AFTER the cascade — this row and
    // erase_initiated are all that remain, the audit chain severed with them.
    await client.execute({
      sql: `INSERT INTO audit_log (id, tenant_id, actor, ref_type, ref_id, action, metadata, created_at)
            VALUES (?, ?, ?, 'tenant', ?, 'erase_complete', ?, ?)`,
      args: [crypto.randomUUID(), tenantId, tenantId, tenantId, JSON.stringify({ scope: "account" }), now],
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

    const { client, tenantId } = await getAuthenticatedDb();

    if (currentPin) {
      const settingsRow = await client.execute({
        sql: "SELECT pin_hash FROM settings WHERE tenant_id = ?",
        args: [tenantId],
      });
      const existingHash = settingsRow.rows[0]?.pin_hash as string | null;
      if (existingHash) {
        const gate = await verifyPinWithLadder(client, tenantId, currentPin, existingHash);
        if (!gate.ok) {
          return { success: false, error: pinGateMessage(gate), code: gate.code, retryInSeconds: gate.retryInSeconds };
        }
      }
    }

    const { hashPin } = await import("@/lib/crypto");
    const newHash = await hashPin(newPin);
    const now = new Date().toISOString();

    // Rule 7: pin update must also write sync_outbox + audit_log atomically
    await client.batch(
      [
        {
          sql: `INSERT INTO settings (tenant_id, institute_name, tenant_secret, pin_hash, created_at, updated_at)
                VALUES (?, 'My Tuition', ?, ?, ?, ?)
                ON CONFLICT (tenant_id) DO UPDATE SET pin_hash = excluded.pin_hash, updated_at = excluded.updated_at`,
          args: [tenantId, crypto.randomUUID(), newHash, now, now],
        },
        {
          sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at) VALUES (?, ?, 'settings', ?, 'update', ?, ?)`,
          args: [crypto.randomUUID(), tenantId, tenantId, JSON.stringify({ pin_updated_at: now }), now],
        },
        {
          sql: `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
                VALUES (?, ?, ?, 'pin.update', 'settings', ?, ?, ?)`,
          args: [crypto.randomUUID(), tenantId, tenantId, tenantId, JSON.stringify({ updated_at: now }), now],
        },
      ],
      "write",
    );

    invalidateTenant(tenantId, "settings:"); // workstream C wiring: pin change may insert settings row
    return { success: true };
  } catch (error) {
    log.error('set_pin_action_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: "Failed to set PIN" };
  }
}

export async function verifyPinAction(pin: string) {
  try {
    const { client, tenantId } = await getAuthenticatedDb();
    const settingsRow = await client.execute({
      sql: "SELECT pin_hash FROM settings WHERE tenant_id = ?",
      args: [tenantId],
    });
    const pinHash = settingsRow.rows[0]?.pin_hash as string | null;
    if (!pinHash) {
      return { success: false, error: "No PIN configured", configured: false };
    }
    const gate = await verifyPinWithLadder(client, tenantId, pin, pinHash);
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
