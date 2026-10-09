// Implements: 02_Core_Logic.md §12.4 (graduated brute-force ladder: 5 fails →
// 30s lock, 10 fails → 5min lock, 15 fails → local-cache wipe + audit),
// 12_Business_Rules.md BR-SEC-03, 14_Edge_Cases.md EC-SEC-01,
// 10_Security.md §3.3–§3.4 (argon2id m=64MiB t=3 p=2 — params untouched),
// AGENTS.md §7.2 (auth lockout row).
//
// Audit-name note: 02 §12.4 drifts to `pin_brute_force_wipe`, but the
// canonical audited-action list (10_Security.md §8), EC-SEC-01, and the
// mobile/desktop specs all use `pin_lockout_wipe` — the wipe below writes
// `pin_lockout_wipe`.
import type { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import * as argon2 from "argon2";

// In-memory brute-force tracker for PIN lockouts (per-device per EC-SEC-01;
// app_state mirrors the lock for cross-process visibility).
//
// This was a bare `Record<string, …>` with no ceiling and no eviction, so a
// long-lived process accumulated one entry per tenant it had ever seen, forever.
// `packages/core` deliberately depends on nothing but @libsql/client and zod, so
// it cannot import apps/web's BoundedCache; this is the same bound, locally.
//
// A Map is used rather than an object literal for two reasons: it has no
// prototype chain (`cache["__proto__"]` must not resolve to something truthy), and
// its iteration order is insertion order, which makes eviction-to-oldest a
// one-liner.
const LOCKOUT_MAX_ENTRIES = 1024;

const lockoutCache = new Map<string, { attempts: number; lockedUntil: number | null }>();

/** Insert, then evict the coldest entries until the ceiling holds. */
function rememberTenant(tenantId: string, state: { attempts: number; lockedUntil: number | null }): void {
  lockoutCache.delete(tenantId);
  lockoutCache.set(tenantId, state);
  while (lockoutCache.size > LOCKOUT_MAX_ENTRIES) {
    const coldest = lockoutCache.keys().next();
    if (coldest.done) break;
    lockoutCache.delete(coldest.value);
  }
}

/** Observable size, so the ceiling is testable rather than assumed. */
export function lockoutCacheStats(): { size: number; max: number } {
  return { size: lockoutCache.size, max: LOCKOUT_MAX_ENTRIES };
}

/**
 * Test seam. Seeding the tracker through `verifyPin` would cost one argon2id
 * verify (m=64MiB, t=3) per tenant, so proving the 1024-entry eviction would mean
 * thousands of deliberate hash verifications. This inserts a neutral entry
 * directly so the bound can be exercised cheaply.
 */
export function __rememberLockoutForTests(tenantId: string): void {
  rememberTenant(tenantId, { attempts: 0, lockedUntil: null });
}

const LOCK_30S_MS = 30 * 1000;
const LOCK_5MIN_MS = 5 * 60 * 1000;
const FIRST_LOCK_THRESHOLD = 5;
const SECOND_LOCK_THRESHOLD = 10;
const WIPE_THRESHOLD = 15;

export async function verifyPin(
  db: PrismaClient,
  tenantId: string,
  pin: string,
): Promise<boolean> {
  const isLocked = await isLockedOut(db, tenantId);
  if (isLocked) {
    throw new Error(
      "Account is temporarily locked due to too many failed attempts.",
    );
  }

  const setting = await db.setting.findUnique({
    where: { tenantId },
  });

  if (!setting || !setting.pinHash) {
    return false;
  }

  const isValid = await argon2.verify(setting.pinHash, pin);

  if (!isValid) {
    // Graduated ladder (02 §12.4 / BR-SEC-03 / EC-SEC-01): 1–4 are
    // toast-only, 5–9 hold a 30s lock (refreshed on each failure),
    // 10–14 hold a 5min lock (refreshed), 15 wipes the local cache.
    // A fresh object each time rather than mutating the cached one, so the
    // ladder state is only ever published through rememberTenant().
    const prior = lockoutCache.get(tenantId);
    const state = {
      attempts: (prior?.attempts ?? 0) + 1,
      lockedUntil: prior?.lockedUntil ?? null,
    };

    if (state.attempts >= WIPE_THRESHOLD) {
      await wipeLocalCache(db, tenantId);
      // Post-wipe the device stays PIN-locked (5min) so the cross-process
      // lock assertion holds; the tutor re-logs in via Supabase and
      // re-syncs (EC-SEC-01 recovery). Attempts stay at the wipe threshold
      // so a further failure re-wipes instead of silently re-locking.
      state.lockedUntil = Date.now() + LOCK_5MIN_MS;
      // Also update DB app_state for cross-process lockout
      await db.appState.update({
        where: { tenantId },
        data: {
          appLockState: "locked",
          appLockUntil: new Date(state.lockedUntil),
        },
      });
    } else if (state.attempts >= SECOND_LOCK_THRESHOLD) {
      state.lockedUntil = Date.now() + LOCK_5MIN_MS;
      // Also update DB app_state for cross-process lockout
      await db.appState.update({
        where: { tenantId },
        data: {
          appLockState: "locked",
          appLockUntil: new Date(state.lockedUntil),
        },
      });
    } else if (state.attempts >= FIRST_LOCK_THRESHOLD) {
      state.lockedUntil = Date.now() + LOCK_30S_MS;
      // Also update DB app_state for cross-process lockout
      await db.appState.update({
        where: { tenantId },
        data: {
          appLockState: "locked",
          appLockUntil: new Date(state.lockedUntil),
        },
      });
    }
    rememberTenant(tenantId, state);
    return false;
  }

  // Success, reset attempts (EC-SEC-01 cumulative reset)
  if (lockoutCache.has(tenantId)) {
    rememberTenant(tenantId, { attempts: 0, lockedUntil: null });
  }
  return true;
}

/**
 * EC-SEC-01 wipe: delete the tenant's local-cache rows and record
 * `pin_lockout_wipe` in the SAME transaction (Rule 7). No `sync_outbox`
 * rows are written on purpose — the cloud DB must stay intact, so the wipe
 * is never replicated. `settings` (PIN hash + tenant_secret), `app_state`,
 * `audit_log`, and backup manifests are preserved: the audit row must
 * survive its own wipe.
 */
async function wipeLocalCache(
  db: PrismaClient,
  tenantId: string,
): Promise<void> {
  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    // Children before parents (FK-safe order).
    await tx.receipt.deleteMany({ where: { tenantId } });
    await tx.ledgerEntry.deleteMany({ where: { tenantId } });
    await tx.invoice.deleteMany({ where: { tenantId } });
    await tx.feeScheduleItem.deleteMany({ where: { tenantId } });
    await tx.feePlan.deleteMany({ where: { tenantId } });
    await tx.attendanceRecord.deleteMany({ where: { tenantId } });
    await tx.attendanceSession.deleteMany({ where: { tenantId } });
    await tx.studentEnrollment.deleteMany({ where: { tenantId } });
    await tx.guardian.deleteMany({ where: { tenantId } });
    await tx.studentNote.deleteMany({ where: { tenantId } });
    await tx.studentDocument.deleteMany({ where: { tenantId } });
    await tx.studentTag.deleteMany({ where: { student: { tenantId } } });
    await tx.tag.deleteMany({ where: { tenantId } });
    await tx.student.deleteMany({ where: { tenantId } });
    await tx.notification.deleteMany({ where: { tenantId } });
    await tx.reminder.deleteMany({ where: { tenantId } });
    await tx.syncOutbox.deleteMany({ where: { tenantId } });
    await tx.batch.deleteMany({ where: { tenantId } });
    await tx.tutor.deleteMany({ where: { tenantId } });

    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId,
        actor: "system",
        action: "pin_lockout_wipe",
        refType: "tenant",
        refId: tenantId,
        metadata: JSON.stringify({ attempts: WIPE_THRESHOLD }),
        createdAt: new Date(),
      },
    });
  });
}

/**
 * Test-only: expire the in-memory lock timer while preserving the cumulative
 * attempt count, so specs can drive the full 5→10→15 ladder without waiting
 * out real 30s/5min lockouts. Production code never calls this.
 */
export function expirePinLockoutForTests(tenantId: string): void {
  const state = lockoutCache.get(tenantId);
  if (state) {
    state.lockedUntil = null;
  }
}

export async function isLockedOut(
  db: PrismaClient,
  tenantId: string,
): Promise<boolean> {
  // Check memory cache first
  const state = lockoutCache.get(tenantId);
  if (state && state.lockedUntil && state.lockedUntil > Date.now()) {
    return true;
  }

  // Check DB state
  const appState = await db.appState.findUnique({
    where: { tenantId },
  });

  if (appState && appState.appLockState === "locked" && appState.appLockUntil) {
    if (appState.appLockUntil.getTime() > Date.now()) {
      return true;
    } else {
      // Lock expired, unlock it
      await db.appState.update({
        where: { tenantId },
        data: {
          appLockState: "unlocked",
          appLockUntil: null,
        },
      });
    }
  }

  return false;
}

export async function setPin(
  db: PrismaClient,
  tenantId: string,
  pin: string,
): Promise<void> {
  const pinHash = await argon2.hash(pin, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MiB
    timeCost: 3,
    parallelism: 2,
  });

  await db.setting.update({
    where: { tenantId },
    data: { pinHash },
  });
}
