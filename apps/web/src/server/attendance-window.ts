// Implements: 06_Attendance.md §10.6 BR-ATT-07 (three-tier re-marking ladder),
// §10.3 lock phases, §10.8 audit trail; 12_Business_Rules.md BR-ATT-06;
// 03_User_Flows.md §4.3 Flow 11 (lock/unlock per session, 1-hour window).
//
// Unlock never clears `lockedAt`. An unlock opens a 60-minute WINDOW during
// which edits to the locked session are permitted; every in-window edit writes
// `attendance_edit_locked`, and the first edit attempt past expiry writes
// `attendance_relock` (reason `unlock_window_expired`) and is rejected. The
// window start is the latest grant audit row, so no schema change and no cron
// are needed — expiry is enforced lazily at the edit gate on both web and
// gateway, which is why both sides share these exact semantics (gateway mirror:
// `apps/gateway/lib/attendance-window.ts`).
//
// Tier routing (by session-date age, UTC days):
//   Tier 1 — fresh and unlocked: nothing to unlock (refuse, typed error).
//   Tier 2 — locked_at set OR older than `attendance_lock_hours` (default 48),
//     younger than 30 days: PIN/biometric → `attendance_unlock`.
//   Tier 3 — older than 30 days ("hard-locked", 06 §10.6): direct unlock
//     disabled; the request flow (`requestHardUnlockAction`, reason ≥ 20 chars
//     + PIN) writes `attendance_hard_unlock_request`, which opens the same
//     60-minute window. All Tier-3 edits are double-audited (outbox + audit
//     per change, like every other mutation).

export const UNLOCK_WINDOW_MINUTES = 60;
export const HARD_LOCK_DAYS = 30;
export const HARD_UNLOCK_REASON_MIN_LENGTH = 20;
export const DEFAULT_LOCK_HOURS = 48;

// Grant spellings, both vocabularies: web writes snake_case (06 §10.8 audit
// table), gateway writes dotted (`attendance.lock` precedent). Cross-device
// windows (unlock on web, mark via gateway) must agree, so readers accept
// both. Writers use their side's convention; readers never assume one.
export const UNLOCK_GRANT_ACTIONS = [
  "attendance_unlock",
  "attendance.unlock",
  "attendance_hard_unlock_request",
  "attendance.hard_unlock_request",
] as const;

export const RELOCK_ACTIONS = ["attendance_relock", "attendance.relock"] as const;

export type UnlockWindowState =
  | { open: true; expiresAt: string; grantAction: string; grantedAt: string }
  | { open: false; expiresAt: null; expiredGrant: boolean };

export function hardLocked(sessionDateIso: string, nowIso: string): boolean {
  const dayMs = 24 * 60 * 60 * 1000;
  const sessionDay = new Date(`${sessionDateIso}T00:00:00Z`).getTime();
  const nowDay = new Date(`${nowIso.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(sessionDay) || !Number.isFinite(nowDay)) return false;
  return (nowDay - sessionDay) / dayMs > HARD_LOCK_DAYS;
}

export function ageHours(sessionDateIso: string, nowIso: string): number {
  const t = new Date(`${sessionDateIso}T00:00:00Z`).getTime();
  const n = new Date(nowIso).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(n)) return 0;
  return (n - t) / 3_600_000;
}

interface AuditRowLike {
  // Optional on purpose: the LibsqlProxy surface types rows as
  // `Record<string, any>` (no declared columns), and the generated Prisma
  // client types them strictly. Optional props accept both; every read below
  // still goes through `String(... ?? "")` / finite-date guards, so an
  // absent column degrades to a closed window, never to a grant.
  action?: unknown;
  createdAt?: unknown;
}

interface AuditReader {
  auditLog: {
    findMany(args: {
      where: { tenantId: string; refId: string; action: { in: readonly string[] } };
      orderBy: { createdAt: "desc" };
      take: number;
    }): Promise<AuditRowLike[]>;
  };
}

/** Latest grant-or-relock row decides the window. Take-1-latest is correct:
 *  unlock → open; unlock, expiry (no row), later unlock → open again;
 *  unlock then relock → closed. Callers write the lazy `attendance_relock`
 *  row when they observe expiry, so the audit trail shows the close. */
export async function readUnlockWindow(
  db: AuditReader,
  tenantId: string,
  sessionId: string,
  nowIso: string,
): Promise<UnlockWindowState> {
  const rows = await db.auditLog.findMany({
    where: {
      tenantId,
      refId: sessionId,
      action: { in: [...UNLOCK_GRANT_ACTIONS, ...RELOCK_ACTIONS] },
    },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  const latest = rows[0];
  if (!latest) return { open: false, expiresAt: null, expiredGrant: false };
  const action = String(latest.action ?? "");
  if ((RELOCK_ACTIONS as readonly string[]).includes(action)) {
    return { open: false, expiresAt: null, expiredGrant: false };
  }
  const grantedAt = String(latest.createdAt ?? "");
  const grantedMs = new Date(grantedAt).getTime();
  const nowMs = new Date(nowIso).getTime();
  if (!Number.isFinite(grantedMs) || !Number.isFinite(nowMs)) {
    return { open: false, expiresAt: null, expiredGrant: false };
  }
  if (nowMs - grantedMs >= UNLOCK_WINDOW_MINUTES * 60_000) {
    // A grant aged out with no relock row: the caller records the lazy
    // `attendance_relock` (reason `unlock_window_expired`) when it observes
    // this, so the audit trail shows the close.
    return { open: false, expiresAt: null, expiredGrant: true };
  }
  return {
    open: true,
    expiresAt: new Date(grantedMs + UNLOCK_WINDOW_MINUTES * 60_000).toISOString(),
    grantAction: action,
    grantedAt,
  };
}
