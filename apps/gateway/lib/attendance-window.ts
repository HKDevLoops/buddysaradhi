// Implements: 06_Attendance.md §10.6 BR-ATT-07 (three-tier ladder), §10.8;
// the web mirror is apps/web/src/server/attendance-window.ts — same numbers,
// same tier rules, same audit vocabulary. Read the web file's header for the
// full rationale (window overlays the lock; expiry enforced lazily at the
// edit gate; no schema change, no cron).
//
// Gateway specifics:
// - Audit reads go through the audited `auditLog.findMany` (lib/orm.ts), whose
//   statement hardcodes `ORDER BY created_at DESC`. Same-millisecond ties are
//   broken in JS by id DESC: ids are UUIDv7 (time-ordered), so the tiebreak
//   approximates recency instead of trusting row order (the §3.6 F5 trap).
// - Writers use this side's dotted convention (`attendance.unlock`,
//   `attendance.hard_unlock_request`, `attendance.relock`,
//   `attendance.edit_locked`); readers accept both vocabularies so a window
//   opened on web holds for gateway marks and vice versa.

export const UNLOCK_WINDOW_MINUTES = 60;
export const HARD_LOCK_DAYS = 30;
export const HARD_UNLOCK_REASON_MIN_LENGTH = 20;
export const DEFAULT_LOCK_HOURS = 48;

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

interface AuditReader {
  auditLog: {
    findMany(args: {
      where: { refId: string; action: { in: readonly string[] } };
      take: number;
    }): Promise<Array<Record<string, any>>>;
  };
}

export async function readUnlockWindow(
  orm: AuditReader,
  sessionId: string,
  nowIso: string,
): Promise<UnlockWindowState> {
  const rows = await orm.auditLog.findMany({
    where: {
      refId: sessionId,
      action: { in: [...UNLOCK_GRANT_ACTIONS, ...RELOCK_ACTIONS] },
    },
    take: 2,
  });
  const byRecency = [...rows].sort((a, b) => {
    const time = String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
    if (time !== 0) return time;
    return String(b.id ?? "").localeCompare(String(a.id ?? ""));
  });
  const latest = byRecency[0];
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
    return { open: false, expiresAt: null, expiredGrant: true };
  }
  return {
    open: true,
    expiresAt: new Date(grantedMs + UNLOCK_WINDOW_MINUTES * 60_000).toISOString(),
    grantAction: action,
    grantedAt,
  };
}
