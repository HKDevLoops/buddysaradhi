"use server";

import { getAttendanceForDate } from "../queries/attendance";
import { getAuthenticatedPrisma } from "@/server/get-db";
import { UpdateAttendancePayload, pinFormatError } from "@buddysaradhi/shared";
import { log } from "@/lib/logger";
import { verifyPin } from "@/lib/crypto";
import { invalidateTenant } from "@/server/cache"; // workstream C wiring
import {
  DEFAULT_LOCK_HOURS,
  HARD_LOCK_DAYS,
  HARD_UNLOCK_REASON_MIN_LENGTH,
  UNLOCK_WINDOW_MINUTES,
  ageHours,
  hardLocked,
  readUnlockWindow,
} from "@/server/attendance-window";

export async function fetchAttendanceAction(dateIso: string, batchId?: string) {
  try {
    return await getAttendanceForDate(dateIso, batchId);
  } catch (error) {
    log.error('fetch_attendance_action_failed', error instanceof Error ? error.message : String(error), { dateIso, batchId });
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch attendance" };
  }
}

export async function updateAttendanceAction(payload: UpdateAttendancePayload) {
  try {
    // Implements: AGENTS.md §3.4 (Prisma ORM only — no runtime raw SQL) +
    // §2 Rule 7 (outbox in the same transaction as the mutation).
    const { db, tenantId } = await getAuthenticatedPrisma();
    const now = new Date().toISOString();

    // 1. Get or create batch if needed (ensure FK constraint holds)
    const targetBatchId = payload.batch_id && payload.batch_id.trim() !== "" && payload.batch_id !== "all" 
      ? payload.batch_id 
      : "batch-default";

    const batchCheck = await db.batch.findFirst({
      where: { id: targetBatchId },
    });
    if (!batchCheck) {
      await db.batch.create({
        data: {
          id: targetBatchId,
          tenantId,
          name: "General Batch",
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    // 2. Get or create session
    const existingSession = await db.attendanceSession.findFirst({
      where: {
        tenantId,
        sessionDate: payload.session_date,
        batchId: targetBatchId,
      },
    });

    let sessionId: string;
    let inUnlockWindow = false;
    if (existingSession) {
      if (existingSession.lockedAt) {
        // 06 §10.6 BR-ATT-07 Tier 2/3: a locked session edits only inside an
        // open unlock window (latest grant audit row < 60 min, no newer
        // relock). The window is read here, outside the per-update
        // transactions: a lock racing the first update is handled by the
        // row-level update guard below re-checking inside each tx.
        const window = await readUnlockWindow(db, tenantId, existingSession.id as string, now);
        if (!window.open) {
          if (window.expiredGrant) {
            // Lazy relock: the grant aged out with no relock row, so this
            // attempt records the close (reason `unlock_window_expired`,
            // 06 §10.8) in its own transaction, then rejects like any
            // out-of-window edit. Separate transaction ON PURPOSE: the edit
            // below throws, and a throw inside the edit's own transaction
            // would roll the relock row back with it. The relock carries an
            // outbox row like every other window mutation (Rule 7) so the
            // close replicates cross-device.
            await db.$transaction(async (tx) => {
              await tx.auditLog.create({
                data: {
                  id: crypto.randomUUID(),
                  tenantId,
                  actor: tenantId,
                  refType: "attendance_session",
                  refId: existingSession.id as string,
                  action: "attendance_relock",
                  metadata: JSON.stringify({ reason: "unlock_window_expired" }),
                  createdAt: now,
                },
              });
              await tx.syncOutbox.create({
                data: {
                  id: crypto.randomUUID(),
                  tenantId,
                  tableName: "attendance_sessions",
                  rowId: existingSession.id as string,
                  op: "update",
                  payload: JSON.stringify({ relocked_at: now, reason: "unlock_window_expired" }),
                  createdAt: now,
                },
              });
            });
          }
          if (hardLocked(payload.session_date, now)) {
            throw new Error(
              "HARD_LOCKED: This session is more than 30 days old. Direct unlock is disabled — file an unlock request with a reason."
            );
          }
          throw new Error("Session is locked. Unlock it to edit.");
        }
        inUnlockWindow = true;
      }
      sessionId = existingSession.id as string;
    } else {
      sessionId = crypto.randomUUID();
      await db.attendanceSession.create({
        data: {
          id: sessionId,
          tenantId,
          sessionDate: payload.session_date,
          batchId: targetBatchId,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    // 2. Upsert attendance records + sync_outbox
    for (const update of payload.updates) {
      const recordId = crypto.randomUUID();
      const outboxId = crypto.randomUUID();

      // Rule 7: record write + outbox row land in one write transaction.
      await db.$transaction(async (tx) => {
        // 06 §10.6/§10.8 Tier 2+3: in-window edits are double-audited — one
        // `attendance_edit_locked` row per changed row, carrying old/new
        // status, inside the same transaction as the record write.
        let oldStatus: string | null = null;
        if (inUnlockWindow) {
          const current = await tx.attendanceRecord.findFirst({
            where: { sessionId, studentId: update.student_id },
          });
          oldStatus = (current?.status as string | null) ?? null;
        }
        await tx.attendanceRecord.upsert({
          where: { sessionId, studentId: update.student_id },
          create: {
            id: recordId,
            tenantId,
            sessionId,
            studentId: update.student_id,
            status: update.status,
            markedAt: now,
            createdAt: now,
            updatedAt: now,
          },
          update: {
            status: update.status,
            updatedAt: now,
          },
        });
        await tx.syncOutbox.create({
          data: {
            id: outboxId,
            tenantId,
            tableName: "attendance_records",
            rowId: recordId,
            op: "update",
            payload: JSON.stringify(update),
            createdAt: now,
          },
        });
        if (inUnlockWindow) {
          await tx.auditLog.create({
            data: {
              id: crypto.randomUUID(),
              tenantId,
              actor: tenantId,
              refType: "attendance_record",
              refId: recordId,
              action: "attendance_edit_locked",
              metadata: JSON.stringify({
                student_id: update.student_id,
                old_status: oldStatus,
                new_status: update.status,
                window: "unlock",
              }),
              createdAt: now,
            },
          });
        }
      });
    }

    invalidateTenant(tenantId, "attendance:"); // workstream C wiring: batch may auto-create above
    return { success: true };
  } catch (error) {
    log.error('attendance_update_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: error instanceof Error ? error.message : "Failed to update attendance" };
  }
}

export async function lockSessionAction(sessionId: string, pin: string) {
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const settingsRow = await db.setting.findFirst({
      where: { tenantId },
    });
    const pinHash = (settingsRow?.pinHash ?? null) as string | null;
    if (!pinHash) {
      return { success: false, error: "No PIN configured. Set one in Settings → Security." };
    }
    const pinFormatProblem = pinFormatError(pin);
    if (pinFormatProblem) {
      // A 3-digit entry is not a wrong PIN, it is an unusable one. Saying
      // "incorrect" sends the tutor round a loop retyping the same digits.
      return { success: false, error: `VALIDATION: ${pinFormatProblem}` };
    }
    const pinValid = await verifyPin(pin, pinHash);
    if (!pinValid) {
      // The bare string "Invalid PIN" carried no taxonomy code, so every client
      // had to pattern-match a literal to tell a wrong PIN from any other
      // refusal. Prefixing the shared code lets `extractServerCode` classify it
      // (and `lockErrorCopy` still match the sentence inside it), while the
      // verification itself is unchanged — the tutor still has to be right.
      return { success: false, error: "VALIDATION: The security PIN is incorrect." };
    }
    const now = new Date().toISOString();

    // W2 (reviews/overhaul-audit-report-2026-09-26.md): the lock UPDATE, its
    // sync_outbox row and the audit_log row go in ONE write transaction —
    // Rule 7 (AGENTS §2) / BR-SYN-01 require the outbox row in the same
    // transaction as the mutation, so a locked session can never exist
    // locally without a queued replication row.
    await db.$transaction(async (tx) => {
      await tx.attendanceSession.update({
        where: { id: sessionId, tenantId },
        data: { lockedAt: now, updatedAt: now },
      });
      await tx.syncOutbox.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          tableName: "attendance_sessions",
          rowId: sessionId,
          op: "update",
          payload: JSON.stringify({ locked_at: now }),
          createdAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          actor: tenantId,
          refType: "attendance_session",
          refId: sessionId,
          action: "session_locked",
          metadata: JSON.stringify({ locked_at: now }),
          createdAt: now,
        },
      });
    });

    return { success: true };
  } catch (error) {
    log.error('lock_session_action_failed', error instanceof Error ? error.message : String(error), { sessionId });
    return { success: false, error: error instanceof Error ? error.message : "Failed to lock session" };
  }
}

export type AttendancePreset = "current_month" | "last_month" | "last_3_months" | "last_6_months" | "full_year";

export interface AttendanceSummaryItem {
  student_id: string;
  student_name: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  total_sessions: number;
  percentage: number;
}

export interface AttendanceSummary {
  preset: AttendancePreset;
  period_start: string;
  period_end: string;
  summaries: AttendanceSummaryItem[];
  overall: {
    total_students: number;
    total_sessions: number;
    overall_present: number;
    overall_absent: number;
    overall_late: number;
    overall_excused: number;
    overall_percentage: number;
  };
}

export async function fetchAttendanceSummaryAction(preset: AttendancePreset): Promise<{
  ok: boolean;
  value?: AttendanceSummary;
  error?: string;
}> {
  try {
    // Implements: AGENTS.md §3.4 (Prisma ORM only — no runtime raw SQL).
    const { db, tenantId } = await getAuthenticatedPrisma();
    const now = new Date();
    let periodStart: string;
    let periodEnd = now.toISOString().slice(0, 10);

    switch (preset) {
      case "current_month":
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        break;
      case "last_month":
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        periodStart = lastMonth.toISOString().slice(0, 10);
        periodEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
        break;
      case "last_3_months":
        periodStart = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10);
        break;
      case "last_6_months":
        periodStart = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().slice(0, 10);
        break;
      case "full_year":
        periodStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
        break;
      default:
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    }

    const emptyOverall = {
      total_students: 0,
      total_sessions: 0,
      overall_present: 0,
      overall_absent: 0,
      overall_late: 0,
      overall_excused: 0,
      overall_percentage: 0,
    };

    // Active roster via the ORM surface (same filter + ordering as before:
    // tenant, status active, not archived, ordered by first name).
    let studentRows: Array<{ id: string; firstName: string; lastName: string | null }>;
    try {
      const rows = await db.student.findMany({
        where: { tenantId, status: "active", archivedAt: null },
        orderBy: { firstName: "asc" },
      });
      studentRows = rows.map((row) => ({
        id: String(row.id),
        firstName: String(row.firstName ?? ""),
        lastName: (row.lastName as string | null) ?? null,
      }));
    } catch (sqlErr) {
      log.error('attendance_summary_failed', sqlErr instanceof Error ? sqlErr.message : String(sqlErr));
      return {
        ok: true,
        value: {
          preset,
          period_start: periodStart,
          period_end: periodEnd,
          summaries: [],
          overall: emptyOverall,
        },
      };
    }

    // Attendance records in period. The ORM surface has no JOIN or date-range
    // operator, so sessions + records are read per-tenant and filtered in JS —
    // same rows as the previous JOIN, no raw SQL.
    let recordRows: Array<{ studentId: string; status: string }>;
    try {
      const sessions = await db.attendanceSession.findMany({ where: { tenantId } });
      const sessionIds = new Set(
        sessions
          .filter((session) => {
            const day = String(session.sessionDate ?? "");
            return day >= periodStart && day <= periodEnd;
          })
          .map((session) => String(session.id)),
      );
      const allRecords = await db.attendanceRecord.findMany({ where: { tenantId } });
      recordRows = allRecords
        .filter((rec) => sessionIds.has(String(rec.sessionId)))
        .map((rec) => ({ studentId: String(rec.studentId), status: String(rec.status) }));
    } catch (sqlErr) {
      log.error('attendance_summary_failed', sqlErr instanceof Error ? sqlErr.message : String(sqlErr));
      return {
        ok: true,
        value: {
          preset,
          period_start: periodStart,
          period_end: periodEnd,
          summaries: [],
          overall: { ...emptyOverall, total_students: studentRows.length },
        },
      };
    }

    // Aggregate by student
    const summaryMap = new Map<string, { present: number; absent: number; late: number; excused: number }>();
    for (const row of studentRows) {
      summaryMap.set(row.id, { present: 0, absent: 0, late: 0, excused: 0 });
    }

    for (const rec of recordRows) {
      const existing = summaryMap.get(rec.studentId);
      if (existing) {
        if (rec.status === "present") existing.present++;
        else if (rec.status === "absent") existing.absent++;
        else if (rec.status === "late") existing.late++;
        else if (rec.status === "excused") existing.excused++;
      }
    }

    const summaries: AttendanceSummaryItem[] = [];
    let overallPresent = 0, overallAbsent = 0, overallLate = 0, overallExcused = 0, totalSessions = 0;

    for (const [studentId, counts] of summaryMap.entries()) {
      const student = studentRows.find((s) => s.id === studentId);
      if (!student) continue;
      const total = counts.present + counts.absent + counts.late + counts.excused;
      totalSessions += total;
      overallPresent += counts.present;
      overallAbsent += counts.absent;
      overallLate += counts.late;
      overallExcused += counts.excused;
      summaries.push({
        student_id: studentId,
        student_name: `${student.firstName} ${student.lastName || ""}`.trim(),
        present: counts.present,
        absent: counts.absent,
        late: counts.late,
        excused: counts.excused,
        total_sessions: total,
        percentage: total > 0 ? Math.round((counts.present / total) * 100) : 0,
      });
    }

    const totalOverall = overallPresent + overallAbsent + overallLate + overallExcused;

    return {
      ok: true,
      value: {
        preset,
        period_start: periodStart,
        period_end: periodEnd,
        summaries,
        overall: {
          total_students: studentRows.length,
          total_sessions: totalOverall,
          overall_present: overallPresent,
          overall_absent: overallAbsent,
          overall_late: overallLate,
          overall_excused: overallExcused,
          overall_percentage: totalOverall > 0 ? Math.round((overallPresent / totalOverall) * 100) : 0,
        },
      },
    };
  } catch (error) {
    log.error('attendance_summary_failed', error instanceof Error ? error.message : String(error));
    return { ok: false, error: error instanceof Error ? error.message : "Failed to fetch attendance summary" };
  }
}

async function requireUnlockPin(
  db: { setting: { findFirst(args: unknown): Promise<{ pinHash?: unknown } | null> } },
  tenantId: string,
  pin: string,
): Promise<{ success: true } | { success: false; error: string }> {
  // PIN gate mirrors lockSessionAction exactly (10_Security.md §4 sensitive
  // mutation; 08_Settings.md BR-SEC-02 fresh PIN): no-PIN, format, verify —
  // same taxonomy codes so `lockErrorCopy`-style clients classify identically.
  const settingsRow = await db.setting.findFirst({ where: { tenantId } });
  const pinHash = (settingsRow?.pinHash ?? null) as string | null;
  if (!pinHash) {
    return { success: false, error: "No PIN configured. Set one in Settings → Security." };
  }
  const pinFormatProblem = pinFormatError(pin);
  if (pinFormatProblem) {
    return { success: false, error: `VALIDATION: ${pinFormatProblem}` };
  }
  const pinValid = await verifyPin(pin, pinHash);
  if (!pinValid) {
    return { success: false, error: "VALIDATION: The security PIN is incorrect." };
  }
  return { success: true };
}

async function readLockHours(
  db: { setting: { findFirst(args: unknown): Promise<{ attendanceLockHours?: unknown } | null> } },
  tenantId: string,
): Promise<number> {
  // Mirrors the gateway mark path (`attendanceLockHours ?? 48`): the Tier 2
  // auto-lock boundary is tutor-configurable, so unlock must use the same
  // number or web and gateway disagree on what "locked" means.
  const settingsRow = await db.setting.findFirst({ where: { tenantId } });
  const raw = settingsRow?.attendanceLockHours;
  const parsed = typeof raw === "number" ? raw : Number(raw ?? NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LOCK_HOURS;
}

export async function unlockSessionAction(sessionId: string, pin: string) {
  // Implements: 06_Attendance.md §10.6 BR-ATT-07 Tier 2 (PIN/biometric →
  // `attendance_unlock`, 60-minute window), §10.3 phases, §10.8 audit;
  // 03_User_Flows.md §4.3 Flow 11; 10_Security.md §4 (PIN-gated sensitive
  // mutation); 08_Settings.md BR-SEC-02.
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const now = new Date().toISOString();

    const pinGate = await requireUnlockPin(db, tenantId, pin);
    if (!pinGate.success) return pinGate;

    const session = await db.attendanceSession.findFirst({
      where: { id: sessionId, tenantId },
    });
    if (!session) {
      return { success: false, error: "Session not found." };
    }
    const sessionDate = String(session.sessionDate ?? "");
    if (hardLocked(sessionDate, now)) {
      // 06 §10.6 Tier 3: no direct unlock past 30 days — the request flow
      // (`requestHardUnlockAction`) is the only door. The HARD_LOCKED code
      // lets the client route to the request sheet instead of an error toast.
      return {
        success: false,
        error:
          "HARD_LOCKED: This session is more than 30 days old. Direct unlock is disabled — file an unlock request with a reason.",
      };
    }
    const lockHours = await readLockHours(db, tenantId);
    const autoLocked = !session.lockedAt && ageHours(sessionDate, now) > lockHours;
    if (!session.lockedAt && !autoLocked) {
      // Tier 1: nothing to unlock. Say so (Rule 9) instead of writing a
      // meaningless window row.
      return { success: false, error: "Session is not locked." };
    }

    // Unlock changes no data column (`lockedAt` stays set — the window
    // overlays the lock so expiry needs no cron), but Rule 7 still gets its
    // outbox row: the window must replicate cross-device, and the audit row
    // alone cannot carry that contract where readers only drain outbox. The
    // payload is informational (window bounds), never a column write.
    const windowExpiresAt = new Date(new Date(now).getTime() + UNLOCK_WINDOW_MINUTES * 60_000).toISOString();
    await db.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          actor: tenantId,
          refType: "attendance_session",
          refId: sessionId,
          action: "attendance_unlock",
          metadata: JSON.stringify({
            method: "pin",
            window_minutes: UNLOCK_WINDOW_MINUTES,
            window_expires_at: windowExpiresAt,
            was_locked: Boolean(session.lockedAt),
            auto_locked: autoLocked,
          }),
          createdAt: now,
        },
      });
      await tx.syncOutbox.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          tableName: "attendance_sessions",
          rowId: sessionId,
          op: "update",
          payload: JSON.stringify({ unlock_window_until: windowExpiresAt }),
          createdAt: now,
        },
      });
    });

    invalidateTenant(tenantId, "attendance:");
    return { success: true, data: { window_expires_at: windowExpiresAt } };
  } catch (error) {
    log.error('unlock_session_action_failed', error instanceof Error ? error.message : String(error), { sessionId });
    return { success: false, error: error instanceof Error ? error.message : "Failed to unlock session" };
  }
}

export async function requestHardUnlockAction(sessionId: string, reason: string, pin: string) {
  // Implements: 06_Attendance.md §10.6 Tier 3 (§10.6 sheet), §10.8
  // (`attendance_hard_unlock_request`); 03 §5.4 request-unlock flow.
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const now = new Date().toISOString();

    const pinGate = await requireUnlockPin(db, tenantId, pin);
    if (!pinGate.success) return pinGate;

    const cleanReason = reason.trim();
    if (cleanReason.length < HARD_UNLOCK_REASON_MIN_LENGTH) {
      return {
        success: false,
        error: `VALIDATION: Tell us why in at least ${HARD_UNLOCK_REASON_MIN_LENGTH} characters.`,
      };
    }
    const session = await db.attendanceSession.findFirst({
      where: { id: sessionId, tenantId },
    });
    if (!session) {
      return { success: false, error: "Session not found." };
    }
    if (!hardLocked(String(session.sessionDate ?? ""), now)) {
      // Tier 2 sessions unlock directly — a request here would be theatre.
      return {
        success: false,
        error: "NOT_HARD_LOCKED: This session is under 30 days old — unlock it directly with your PIN.",
      };
    }

    // Single-user app: the tutor IS the authority, so the audited request
    // opens the 60-minute window immediately (06 §10.6: "System unlocks for 60
    // minutes"). The request row doubles as the window grant — same window
    // mechanics as Tier 2, plus the reason for the double-audit trail.
    const windowExpiresAt = new Date(new Date(now).getTime() + UNLOCK_WINDOW_MINUTES * 60_000).toISOString();
    await db.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          actor: tenantId,
          refType: "attendance_session",
          refId: sessionId,
          action: "attendance_hard_unlock_request",
          metadata: JSON.stringify({
            reason: cleanReason,
            method: "pin",
            window_minutes: UNLOCK_WINDOW_MINUTES,
            window_expires_at: windowExpiresAt,
          }),
          createdAt: now,
        },
      });
      await tx.syncOutbox.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          tableName: "attendance_sessions",
          rowId: sessionId,
          op: "update",
          payload: JSON.stringify({ unlock_window_until: windowExpiresAt }),
          createdAt: now,
        },
      });
    });

    invalidateTenant(tenantId, "attendance:");
    return { success: true, data: { window_expires_at: windowExpiresAt } };
  } catch (error) {
    log.error('request_hard_unlock_action_failed', error instanceof Error ? error.message : String(error), { sessionId });
    return { success: false, error: error instanceof Error ? error.message : "Failed to request unlock" };
  }
}

export async function relockSessionAction(sessionId: string, reason = "app_backgrounded") {
  // Implements: 06 §10.6 Tier 2 ("re-lock on backgrounding") + §10.8
  // (`attendance_relock`). Safe direction (removes rights), so no PIN —
  // BR-SEC-02 gates privilege GRANTS, not revocations. Idempotent and
  // honest: reports whether a window was actually open.
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const now = new Date().toISOString();
    const window = await readUnlockWindow(db, tenantId, sessionId, now);
    if (!window.open) {
      return { success: true, relocked: false as const };
    }
    await db.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          actor: tenantId,
          refType: "attendance_session",
          refId: sessionId,
          action: "attendance_relock",
          metadata: JSON.stringify({ reason }),
          createdAt: now,
        },
      });
      await tx.syncOutbox.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          tableName: "attendance_sessions",
          rowId: sessionId,
          op: "update",
          payload: JSON.stringify({ relocked_at: now, reason }),
          createdAt: now,
        },
      });
    });
    invalidateTenant(tenantId, "attendance:");
    return { success: true, relocked: true as const };
  } catch (error) {
    log.error('relock_session_action_failed', error instanceof Error ? error.message : String(error), { sessionId });
    return { success: false, error: error instanceof Error ? error.message : "Failed to re-lock session" };
  }
}
