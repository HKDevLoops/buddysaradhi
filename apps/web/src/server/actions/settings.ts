"use server";

import { getAuthenticatedDb, getAuthenticatedPrisma, gatewayPatch } from "@/server/get-db";
import { createSupabaseServer, createSupabaseAdmin } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import {
  BACKUP_PASSPHRASE_MIN,
  IMPORT_PIN_REQUIRED_ABOVE_ROWS,
  backupFilename,
  obviousPinError,
} from "@/lib/settings-gates";
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

// `BACKUP_PASSPHRASE_MIN`, `backupFilename` and `IMPORT_PIN_REQUIRED_ABOVE_ROWS`
// live in `@/lib/settings-gates`, not here. A `"use server"` module may only
// export ASYNC functions — Next rejects a synchronous export at BUILD time
// ("Only async functions are allowed to be exported in a 'use server' file")
// while `tsc` and every unit test stay green. Putting the gate constants in one
// isomorphic module is what makes the threshold the client renders and the
// threshold the server enforces provably the same value.

/**
 * Backup create. PIN-gated and typed-confirmed per 08 SR-01 + 09 §15.4
 * (typed `EXPORT`, then a fresh PIN — two independent gates), audited per
 * 08 §9.6 step 6, and Rule 7 puts the audit + outbox rows in the same
 * transaction as the mutation they describe.
 *
 * SR-13: no optimistic UI and no optimistic audit. The file only appears
 * after the transaction commits.
 */
export async function createBackupAction(passphrase: string, pin: string, typedConfirm?: string) {
  const refuse = (error: string) => ({ success: false as const, error });
  try {
    if (typedConfirm !== "EXPORT") {
      // BR-SEC-04: the typed word is the first gate. Nothing is read, nothing
      // is encrypted, nothing is written when it does not match.
      log.warn("backup_export_refused", "Typed EXPORT confirm did not match");
      return refuse("Type EXPORT to confirm.");
    }
    if (passphrase.length < BACKUP_PASSPHRASE_MIN) {
      return refuse(`Passphrase must be at least ${BACKUP_PASSPHRASE_MIN} characters`);
    }

    const { db, tenantId } = await getAuthenticatedPrisma();
    const settingsRow = await db.setting.findFirst({ where: { tenantId } });
    const pinHash = (settingsRow?.pinHash ?? null) as string | null;
    if (!pinHash) {
      return refuse("No PIN configured. Set one in Settings, Security first.");
    }
    const gate = await verifyPinWithLadder(db, tenantId, pin, pinHash);
    if (!gate.ok) {
      return refuse(pinGateMessage(gate));
    }

    // Rule 9 + AGENTS §3.4: a failed/missing-table read throws and is caught
    // below (typed failure). Never emit an empty-but-"successful" backup.
    //
    // 09 §3/§5: the backup carries the tutor's books. It previously carried
    // only settings + students + ledger, so a restore would have silently lost
    // every invoice and the audit trail; invoice + audit rows went in next, and
    // RECEIPTS / ATTENDANCE / BATCHES were still missing — which is the same
    // class of silent data loss one layer down. A restore would have dropped
    // every receipt (this tenant holds 12), which is every number the tutor
    // ever handed a parent, plus the attendance record and the batch names their
    // fees and reports are grouped by.
    //
    // WHY EVERY TABLE IS READ THROUGH THE ORM SHIM AND NOT A GENERIC LOOP: the
    // model surface is the audited authority for what exists (AGENTS §3.4), and
    // `receipt` / `attendanceSession` / `attendanceRecord` / `batch` are all
    // registered on it. Each read is named, so dropping one is a diff nobody has
    // to notice.
    //
    // A table the tenant's schema does not have is reported as `null`, never as
    // an empty array, and never by failing the whole backup.
    //
    // The distinction is the whole point. `[]` means "this tutor has no receipts";
    // `null` means "this build could not read receipts". A restore that treats
    // them the same silently destroys data it never even looked at — which is the
    // defect this function is being fixed for. Failing the entire backup instead
    // is worse and violates Rule 9 in the other direction: the tutor would get no
    // file at all and no statement of which table broke. So a missing table is
    // recorded, named on screen, and the file still goes out with everything it
    // could read.
    //
    // A missing SETTINGS, STUDENT, LEDGER or INVOICE table is never tolerated: the
    // try/catch below already refuses those, and refusing is correct there.
    type BackupRows<T> = T[] | null;
    async function readForBackup<T>(table: string, read: () => Promise<T[]>): Promise<BackupRows<T>> {
      try {
        return await read();
      } catch (error) {
        // Rule 9: the reason is logged, not swallowed. A missing table is a
        // provisioning gap, and `settings_create_failed` is where it surfaces.
        log.warn(
          "backup_table_unavailable",
          `${table}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }
    }

    const [settingsRows, studentsRows, ledgerRows, invoiceRows, receiptRows, attendanceSessionRows, attendanceRecordRows, batchRows, auditRows] =
      await Promise.all([
        db.setting.findMany({ where: { tenantId } }),
        db.student.findMany({ where: { tenantId } }),
        db.ledgerEntry.findMany({ where: { tenantId } }),
        db.invoice.findMany({ where: { tenantId } }),
        readForBackup("receipts", () => db.receipt.findMany({ where: { tenantId } })),
        readForBackup("attendance_sessions", () =>
          db.attendanceSession.findMany({ where: { tenantId } }),
        ),
        readForBackup("attendance_records", () =>
          db.attendanceRecord.findMany({ where: { tenantId } }),
        ),
        readForBackup("batches", () => db.batch.findMany({ where: { tenantId } })),
        db.auditLog.findMany({ where: { tenantId } }),
      ]);

    const countOf = (rows: BackupRows<unknown>): number | null =>
      rows === null ? null : rows.length;

    // Stated once, so the file, the audit row and the success line cannot drift
    // into three different claims about what was backed up. 08_Settings.md
    // §6.2.7 makes this line the tutor's only evidence of what the file actually
    // holds, so it is derived from the very arrays that went into it and never
    // restated by hand. `null` above means "this build could not read that table"
    // — see `readForBackup`.
    const counts = {
      students: countOf(studentsRows),
      ledger: countOf(ledgerRows),
      invoices: countOf(invoiceRows),
      receipts: countOf(receiptRows),
      attendanceSessions: countOf(attendanceSessionRows),
      attendanceRecords: countOf(attendanceRecordRows),
      batches: countOf(batchRows),
      audit: countOf(auditRows),
    };

    const backupPayload = JSON.stringify({
      version: 1,
      tenantId,
      exportedAt: new Date().toISOString(),
      settings: settingsRows,
      students: studentsRows,
      ledger: ledgerRows,
      invoices: invoiceRows,
      // `null` = unavailable in this build. A restore MUST treat null and []
      // differently; see `readForBackup`.
      receipts: receiptRows,
      attendanceSessions: attendanceSessionRows,
      attendanceRecords: attendanceRecordRows,
      batches: batchRows,
      audit: auditRows,
    });

    // Rule 8: the passphrase is the KDF input (Argon2id), not just a check —
    // the backup must be restorable on any device with only the passphrase.
    const encryptedB64 = await encryptBackup(backupPayload, passphrase);
    const sizeBytes = Buffer.byteLength(encryptedB64, "base64");
    const sizeKB = (sizeBytes / 1024).toFixed(1);
    const filename = backupFilename();
    const now = new Date().toISOString();

    // Rule 7 + 08 §9.6 step 6: `backup_create` audit and the outbox row land in
    // ONE transaction with each other. If either fails the tutor is told the
    // backup failed rather than holding an un-audited file (BR-SEC-03
    // fail-closed). `app_state.last_backup_at` is NOT written — the web ORM
    // shim exposes no `appState` model (reported gap).
    try {
      await db.$transaction(async (tx) => {
        await tx.syncOutbox.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            tableName: "settings",
            rowId: tenantId,
            op: "update",
            payload: JSON.stringify({ last_backup_at: now, filename }),
            createdAt: now,
          },
        });
        await tx.auditLog.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            actor: tenantId,
            refType: "backup",
            refId: tenantId,
            action: "backup_create",
            metadata: JSON.stringify({
              bytes: sizeBytes,
              filename,
              counts,
            }),
            createdAt: now,
          },
        });
      });
    } catch (auditError) {
      // BR-SEC-03 fail-closed: the file is NOT handed to the tutor when the
      // audit could not be written. No silent unaudited export.
      log.error(
        "backup_create_audit_failed",
        auditError instanceof Error ? auditError.message : String(auditError),
      );
      return refuse("Action blocked: audit unavailable. Nothing was written.");
    }

    return {
      success: true as const,
      data: {
        filename,
        size: `${sizeKB} KB`,
        counts,
        encrypted: true,
        blobUrl: `data:application/octet-stream;base64,${encryptedB64}`,
      },
    };
  } catch (error) {
    log.error("create_backup_action_failed", error instanceof Error ? error.message : String(error));
    return refuse("Failed to generate backup. Nothing was written.");
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

/**
 * The VALUE gate, added because the FIELD gate above was the only one.
 *
 * `SETTING_WRITE_FIELDS` stops `pinHash`/`tenantId`/`id` being smuggled through
 * an allowlist — but it says nothing about what `graceDays: 99999` or
 * `invoicePrefix: '"'` means. 08 §13 schema block specifies the exact bounds, and
 * 08 §14 EC-17 requires the PREFIX case to be a Zod rejection, not a UI hint. A
 * number like `attendanceLockHours: -5` silently disables a security control; a
 * prefix containing a quote ends up printed on every receipt forever. This map
 * is the server-side enforcement of the spec block, in the spec's own terms, so
 * the client and the server cannot drift (AGENTS.md §6.1 — Zod at every
 * boundary).
 *
 * Deliberately NOT covered: `nextInvoiceSeq`/`nextReceiptSeq`/`nextStudentSeq`.
 * Those are sequence state advanced by the money engine, not tutor input; the
 * fee-rules UI exposes them READ-ONLY (08 §6.2.4) and a hand-written value must
 * never reach them.
 */
const SETTING_VALUE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  // 08 §6.2.1 Institute Profile
  instituteName: z.string().min(1).max(120),
  // DEFECT FIXED (settings audit, 2026-10-06). These three are OPTIONAL in
  // 08 §6.2.1 and the Profile card sends `value || null` for each of them, so
  // "no address" is a null. The schemas were `z.string()`, which made null a
  // validation failure — and because `updateSettingsBatchAction` refuses the
  // WHOLE batch on the first bad field, a tutor with any empty optional field
  // could not save the Profile card at all. Not an edge case: the default state
  // of a brand-new account is all three empty, so the first thing a new tutor
  // does on Settings silently failed. `toAppErrorState` then classified the
  // refusal as UNKNOWN and showed "Please try again. If this keeps happening,
  // contact support" — Rule 9 broken twice over (a refused save, and no reason).
  // Nullable is the correct bound: absent is a legal value, and clearing a
  // field the tutor filled in earlier must stay possible.
  instituteAddress: z.string().max(200).nullable(),
  institutePhone: z
    .string()
    .regex(/^\+?[0-9]{6,15}$/, "Use a phone number of 6 to 15 digits, optionally starting with +")
    .nullable(),
  instituteEmail: z.string().email().max(120).nullable(),
  // 08 §6.2.1 — currency is validated here AND frozen once a fee exists
  // (see `assertCurrencyNotLocked`); `formatINR` requires a real code.
  currencyCode: z.string().regex(/^[A-Z]{3}$/, "Use a three-letter currency code such as INR"),
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/, "Use a locale such as en-IN"),
  timezone: z.string().min(1).max(64),
  // 08 §6.2.4 feeRulesSchema
  defaultFeeModel: z.enum(["postpaid", "prepaid", "mixed"]),
  invoicePrefix: z
    .string()
    .regex(/^[A-Za-z0-9-]+$/, "Prefix must be alphanumeric (letters, digits, hyphen)")
    .min(1)
    .max(10),
  receiptPrefix: z
    .string()
    .regex(/^[A-Za-z0-9-]+$/, "Prefix must be alphanumeric (letters, digits, hyphen)")
    .min(1)
    .max(10),
  graceDays: z.number().int().min(0).max(30),
  autoInvoice: z.boolean(),
  // 08 §6.2.3 attendanceRulesSchema
  attendanceLockHours: z.number().int().min(1).max(168),
  defaultAttendanceStatus: z.enum(["present", "absent"]),
  holidayListJson: z
    .string()
    .max(40_000)
    .refine(
      (raw) => {
        try {
          const parsed: unknown = JSON.parse(raw);
          return (
            Array.isArray(parsed) &&
            parsed.every(
              (h) =>
                typeof h === "object" &&
                h !== null &&
                typeof (h as { date?: unknown }).date === "string" &&
                /^\d{4}-\d{2}-\d{2}$/.test((h as { date: string }).date) &&
                typeof (h as { label?: unknown }).label === "string" &&
                (h as { label: string }).label.length <= 40,
            )
          );
        } catch {
          return false;
        }
      },
      "Holiday list must be a JSON array of { date: YYYY-MM-DD, label }",
    ),
  // 08 §6.2.6 securitySchema
  sessionTimeoutMin: z.number().int().min(1).max(60),
  biometricEnabled: z.boolean(),
  // 08 §6.2.9 autoArchiveInactiveDays — 30–365 with NO "Never" option (§14).
  autoArchiveInactiveDays: z.number().int().min(30).max(365),
  // 08 §6.2.5 notifications + 13 §5 appearance vocabulary
  notifyDueFee: z.boolean(),
  notifyUpcomingDue: z.boolean(),
  notifyMissingAttendance: z.boolean(),
  notifyInactiveStudent: z.boolean(),
  theme: z.string().min(1).max(32),
  density: z.enum(["comfortable", "compact"]),
  reducedMotion: z.enum(["system", "on", "off"]),
  palette: z.string().min(1).max(32),
};

/**
 * 08 §9.3 + 12_Business_Rules.md — the currency a tutor's books are denominated
 * in is decided once and then FROZEN: re-denominating a ledger that already
 * holds a charged fee silently rewrites what every historical amount meant.
 * The client already shows a locked chip (and `getCurrencyLockAction` counts the
 * rows), but a client-side lock is a suggestion — this is the enforcement.
 */
async function assertCurrencyNotLocked(): Promise<{ locked: false } | { locked: true; error: string }> {
  const { db, tenantId } = await getAuthenticatedPrisma();
  const charged = await db.ledgerEntry.count({ where: { tenantId, type: "FEE_CHARGED" } });
  if (charged > 0) {
    return {
      locked: true,
      error:
        "Currency cannot be changed once a fee has been charged — your existing amounts would " +
        "mean something different afterwards.",
    };
  }
  return { locked: false };
}

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
  // Present as `undefined` so the union with `SettingsWriteResult` is
  // discriminated purely by `success` — a caller that has narrowed to
  // `success === true` can then read `updatedAt` without a second cast.
  updatedAt?: undefined;
}

/**
 * The successful shape of a settings write. `updatedAt` is the CAS base the
 * NEXT write must present, read back from the row (see `readFreshUpdatedAt`) —
 * without it the client sits one write behind and its own second save comes back
 * as a false CONFLICT. `undefined` rather than a required field because a
 * post-write read can fail on a committed write; the caller then keeps its
 * previous base and the next CAS surfaces the conflict WITH the server row,
 * which is the fail-closed direction.
 */
export interface SettingsWriteResult {
  success: true;
  updatedAt: string | undefined;
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
/**
 * The authoritative post-write `updated_at` — the compare-and-swap base the
 * NEXT write must present (docs/rfc/004 C4, 12 BR-SYN-03).
 *
 * Why this exists. Both write paths stamp `updated_at = now`, so after a
 * successful save the client's base is one write BEHIND the server's. Returning
 * `{ success: true }` and nothing else left the client no way to advance, and
 * the consequence was not theoretical: a tutor who edited the Profile card
 * twice in a row got `CONFLICT: settings changed elsewhere` on their OWN second
 * edit — the stale-write guard firing against the tutor it exists to protect.
 * The conflict branch already returned the fresh row (`settingsConflict`), so
 * the fix is to complete the CAS on SUCCESS too, which is what a
 * compare-and-swap actually means.
 *
 * Read back from the row rather than returned from the write, because either
 * path may have performed it (the gateway's PATCH, or the direct-db fallback)
 * and only the row is guaranteed to be the truth. One indexed single-row read.
 */
async function readFreshUpdatedAt(): Promise<string | undefined> {
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const row = await db.setting.findFirst({ where: { tenantId } });
    const ms = settingsRowMs(row);
    if (ms !== null) return new Date(ms).toISOString();
    return undefined;
  } catch {
    // A missing base is not a write failure: the caller falls back to its
    // previous base and the next CAS reports the conflict with the server row.
    // Swallowed deliberately and ONLY here — the write already committed.
    return undefined;
  }
}

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

    // 08 §13 schema block + §14 EC-17: the field allowlist says nothing about
    // the VALUE. Reject before any DB touch, with the spec's own message, so the
    // client and the server cannot disagree about what a legal setting is.
    const valueSchema = SETTING_VALUE_SCHEMAS[field];
    if (valueSchema) {
      const parsedValue = valueSchema.safeParse(value);
      if (!parsedValue.success) {
        const detail = parsedValue.error.issues[0]?.message ?? "invalid value";
        log.warn("settings_value_rejected", detail, { field });
        return { success: false, error: detail, code: "VALIDATION" as const };
      }
      value = parsedValue.data;
    } else if (field.startsWith("next") && field.endsWith("Seq")) {
      // Sequence state is money-engine owned (08 §6.2.4 exposes it read-only).
      // Refuse a hand-written value outright rather than silently ignoring it.
      log.warn("settings_value_rejected", "sequence state is not tutor-writable", { field });
      return {
        success: false,
        error: "This sequence is maintained by the app and cannot be set directly.",
        code: "VALIDATION" as const,
      };
    }

    // 08 §9.3 — currency freezes at the first charged fee.
    if (field === "currencyCode") {
      const guard = await assertCurrencyNotLocked();
      if (guard.locked) {
        return { success: false, error: guard.error, code: "VALIDATION" as const };
      }
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
    if (cacheTenantId) invalidateTenant(cacheTenantId, "settings:"); // workstream C wiring: single setting write
    return { success: true, updatedAt: await readFreshUpdatedAt() };
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
      if (val === undefined || !SETTING_WRITE_FIELDS[key]) continue;
      // The batch path is held to the SAME value gate as the single-field path.
      // A batch is not an end-run around validation just because it is one call:
      // the fee-rules card sends three fields in one transaction, and each of
      // them is individually specified.
      const valueSchema = SETTING_VALUE_SCHEMAS[key];
      if (valueSchema) {
        const parsedValue = valueSchema.safeParse(val);
        if (!parsedValue.success) {
          const detail = parsedValue.error.issues[0]?.message ?? "invalid value";
          log.warn("settings_value_rejected", detail, { field: key });
          return { success: false, error: `${key}: ${detail}`, code: "VALIDATION" as const };
        }
        updateData[key] = parsedValue.data;
        continue;
      }
      if (key.startsWith("next") && key.endsWith("Seq")) {
        log.warn("settings_value_rejected", "sequence state is not tutor-writable", { field: key });
        return {
          success: false,
          error: `${key} is maintained by the app and cannot be set directly.`,
          code: "VALIDATION" as const,
        };
      }
      updateData[key] = val;
    }
    if (Object.keys(updateData).length === 0) {
      return { success: false, error: "No valid settings fields" };
    }

    // 08 §9.3 — the same currency freeze, checked once for the whole batch.
    if ("currencyCode" in updateData) {
      const guard = await assertCurrencyNotLocked();
      if (guard.locked) {
        return { success: false, error: guard.error, code: "VALIDATION" as const };
      }
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
    return { success: true, updatedAt: await readFreshUpdatedAt() };
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
    // 08_Settings.md §11 EC-02, server half — the enforcement. This PIN gates
    // the backup export, the bulk archive and the ledger void (10 §3), so a PIN
    // of `123456` / `000000` / `111111` was accepted by both the format check and
    // this action, and EC-02's stated refusal had no implementation anywhere.
    // Same function the client runs (`@/lib/settings-gates`), so the reason on
    // screen and the reason on the wire cannot drift. NEVER applied to
    // verification: refusing to VERIFY would lock a tutor out of their own books.
    const obvious = obviousPinError(newPin);
    if (obvious) {
      return { success: false, error: obvious, code: "VALIDATION" as const };
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
  // 09_Backup_and_Import_Export.md §15.4 + 12_Business_Rules.md BR-SEC-02: an
  // import of more than this many rows is a sensitive mutation and must carry a
  // PIN. It is REQUIRED here, not only in the UI, so a scripted request buys
  // nothing. Up to the threshold no PIN is needed (09 §15.4 says so).
  pin: z.string().max(16).optional(),
});

/**
 * 09_Backup_and_Import_Export.md §15.4: "Import students (> 100 rows) | Yes".
 * The UI and this action share the number through `@/lib/settings-gates`, so the
 * gate can never be one row-count behind the label in the dialog — and neither
 * side can export it from here, because a `"use server"` module may only export
 * async functions.
 */

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

    // 09 §15.4 / BR-SEC-02: over the threshold, the PIN is verified BEFORE any
    // batch is created and before any student row is written. Fail-closed: a
    // wrong or missing PIN returns typed and nothing lands.
    if (unique.length > IMPORT_PIN_REQUIRED_ABOVE_ROWS) {
      const settingsRow = await db.setting.findFirst({ where: { tenantId } });
      const pinHash = (settingsRow?.pinHash ?? null) as string | null;
      if (!pinHash) {
        return {
          success: false,
          error: "No PIN configured. Set one in Settings, Security first.",
          code: "PIN_REQUIRED",
        };
      }
      const gate = await verifyPinWithLadder(db, tenantId, parsed.data.pin ?? "", pinHash);
      if (!gate.ok) {
        return {
          success: false,
          error: pinGateMessage(gate),
          code: gate.code ?? "PIN_INVALID",
        };
      }
    }

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
                // The owning tutor, never null — same defect as
                // `students.ts` `tutorId: null`: on a tenant DB whose
                // `batches.tutor_id` column is NOT NULL this threw, and because
                // every missing batch is created inside ONE transaction, the
                // failure aborted the ENTIRE import rather than one row. The
                // column is nullable in all three schema authorities
                // (11_Data_Model.md §1: the tenant IS the tutor), so writing
                // the real owner is both correct and the only shape that works
                // everywhere.
                tutorId: tenantId,
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

// ---------------------------------------------------------------------------
// Settings → Database (the honest version of a section that used to fake a
// "Test Connection" success) and the BR-M-02 currency lock.
// Implements: 08_Settings.md §9.3 + EC-01 (currency immutable after the first
// FEE_CHARGED ledger row); §6.2.10 / BR-SYN-04 (the tenant's own identity and
// how much it holds); AGENTS.md §2 Rule 9 (no fabricated health) + §3.4 (ORM
// methods only, no raw SQL) + §6.1 (Zod-parsed options, typed results).
// ---------------------------------------------------------------------------

/**
 * 08_Settings.md §9.3 / EC-01: `currency_code` is immutable once the first
 * `FEE_CHARGED` row exists. The check is a COUNT (never a read of the money
 * amounts themselves), and the UI disables the select with a lock chip on
 * `locked: true` — so the rule is visible before the tutor tries, not a toast
 * after they did.
 */
export async function getCurrencyLockAction() {
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const feeChargeCount = await db.ledgerEntry.count({
      where: { tenantId, type: "FEE_CHARGED" },
    });
    return { success: true as const, locked: feeChargeCount > 0, feeChargeCount };
  } catch (error) {
    log.error("currency_lock_read_failed", error instanceof Error ? error.message : String(error));
    return { success: false as const, locked: true, feeChargeCount: 0 };
  }
}

/**
 * The tenant's own identity and the size of its books, for Settings →
 * Database. Replaces a section whose only control set a 900ms timer and then
 * printed "Connection successful" without connecting to anything (Rule 9: a
 * fabricated result is a lie the tutor acts on).
 *
 * Only the three models the web ORM shim exposes are counted, so the numbers
 * are exact for what they claim to be and the UI says so plainly. `db_url` and
 * `schema_version` are NOT returned: the shim exposes no `appState` model and
 * the db URL lives in Supabase user metadata (reported to the lead).
 */
/**
 * A discriminated union, not two loose object shapes: the failure branch has
 * `success: false` and null counts, and without the literal discriminant a
 * caller cannot narrow `data.success === true` to a non-null tenant id.
 */
export type DbIdentityResult =
  | {
      success: true;
      tenantId: string;
      students: number;
      ledgerEntries: number;
      invoices: number;
      settingsRows: number;
    }
  | {
      success: false;
      tenantId: null;
      students: null;
      ledgerEntries: null;
      invoices: null;
      settingsRows: null;
    };

export async function getDbIdentityAction(): Promise<DbIdentityResult> {
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const [students, ledgerEntries, invoices, settingsRows] = await Promise.all([
      db.student.count({ where: { tenantId } }),
      db.ledgerEntry.count({ where: { tenantId } }),
      db.invoice.count({ where: { tenantId } }),
      db.setting.count({ where: { tenantId } }),
    ]);
    return { success: true, tenantId, students, ledgerEntries, invoices, settingsRows };
  } catch (error) {
    log.error("db_identity_read_failed", error instanceof Error ? error.message : String(error));
    return { success: false, tenantId: null, students: null, ledgerEntries: null, invoices: null, settingsRows: null };
  }
}

/**
 * Biometric enable/disable, PIN-gated on the server.
 *
 * Implements: 08_Settings.md §15 SR-05 ("Biometric disable requires PIN. A tutor
 * who loses a finger or sells a device must be able to disable biometric with
 * their PIN") + §9.5 (settings write + `biometric_toggle` audit in one
 * transaction) + BR-SEC-02.
 *
 * Two deliberate choices, both fail-closed:
 *
 * 1. The PIN is required for BOTH directions, not only for disabling. §6.2.6
 *    says enabling should trigger a biometric challenge; the web build has no
 *    enrolment flow to challenge against, so requiring the PIN on enable is the
 *    stricter gate. Allowing a PIN-less enable would be an auth downgrade.
 * 2. The gate lives HERE, in the action, not in the toggle's onChange. The
 *    previous path was a bare `updateSettingAction("biometricEnabled", 0)` with
 *    no gate at all, so a scripted request could disable it freely.
 */
export async function setBiometricEnabledAction(enabled: boolean, pin: string) {
  const refuse = (error: string, code?: string, retryInSeconds?: number) =>
    ({ success: false as const, error, code, retryInSeconds });
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const settingsRow = await db.setting.findFirst({ where: { tenantId } });
    const pinHash = (settingsRow?.pinHash ?? null) as string | null;
    if (!pinHash) {
      return refuse("No PIN configured. Set one in Settings, Security first.");
    }
    const gate = await verifyPinWithLadder(db, tenantId, pin, pinHash);
    if (!gate.ok) {
      return refuse(pinGateMessage(gate), gate.code, gate.retryInSeconds);
    }

    const now = new Date().toISOString();
    await db.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { tenantId },
        create: { tenantId, instituteName: "My Tuition", biometricEnabled: enabled ? 1 : 0, createdAt: now, updatedAt: now },
        update: { biometricEnabled: enabled ? 1 : 0, updatedAt: now },
      });
      await tx.syncOutbox.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          tableName: "settings",
          rowId: tenantId,
          op: "update",
          payload: JSON.stringify({ biometric_enabled: enabled ? 1 : 0 }),
          createdAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          actor: tenantId,
          action: "biometric_toggle",
          refType: "settings",
          refId: tenantId,
          metadata: JSON.stringify({ enabled }),
          createdAt: now,
        },
      });
    });

    invalidateTenant(tenantId, "settings:");
    return { success: true as const, enabled };
  } catch (error) {
    log.error("set_biometric_action_failed", error instanceof Error ? error.message : String(error));
    return refuse("Nothing was changed. Try again in a moment.");
  }
}
