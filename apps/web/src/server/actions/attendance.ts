"use server";

import { getAttendanceForDate } from "../queries/attendance";
import { getAuthenticatedPrisma } from "@/server/get-db";
import { UpdateAttendancePayload, pinFormatError } from "@buddysaradhi/shared";
import { log } from "@/lib/logger";
import { verifyPin } from "@/lib/crypto";
import { invalidateTenant } from "@/server/cache"; // workstream C wiring

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
    if (existingSession) {
      if (existingSession.lockedAt) throw new Error("Session is locked. Unlock it to edit.");
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
