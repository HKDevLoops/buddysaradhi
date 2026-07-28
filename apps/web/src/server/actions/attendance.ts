"use server";

import { getAttendanceForDate } from "../queries/attendance";
import { getAuthenticatedDb } from "@/server/get-db";
import { UpdateAttendancePayload } from "@buddysaradhi/shared";
import { log } from "@/lib/logger";

export async function fetchAttendanceAction(dateIso: string, batchId?: string) {
  return await getAttendanceForDate(dateIso, batchId);
}

export async function updateAttendanceAction(payload: UpdateAttendancePayload) {
  try {
    const { client, tenantId } = await getAuthenticatedDb();
    const now = new Date().toISOString();

    // 1. Get or create session
    const sessionRes = await client.execute({
      sql: `SELECT id, locked_at FROM attendance_sessions
            WHERE tenant_id = ? AND session_date = ? AND batch_id = ? LIMIT 1`,
      args: [tenantId, payload.session_date, payload.batch_id || "all"],
    });

    let sessionId: string;
    if (sessionRes.rows.length > 0) {
      const existing = sessionRes.rows[0];
      if (existing.locked_at) throw new Error("Session is locked. Unlock it to edit.");
      sessionId = existing.id as string;
    } else {
      sessionId = crypto.randomUUID();
      await client.execute({
        sql: `INSERT INTO attendance_sessions (id, tenant_id, session_date, batch_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [sessionId, tenantId, payload.session_date, payload.batch_id || "all", now, now],
      });
    }

    // 2. Upsert attendance records + sync_outbox
    for (const update of payload.updates) {
      const recordId = crypto.randomUUID();
      const outboxId = crypto.randomUUID();

      await client.execute({
        sql: `INSERT INTO attendance_records (id, tenant_id, session_id, student_id, status, marked_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (session_id, student_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
        args: [recordId, tenantId, sessionId, update.student_id, update.status, now, now, now],
      });

      // P5/Rule 7: Every mutation writes to sync_outbox
      await client.execute({
        sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at)
              VALUES (?, ?, 'attendance_records', ?, 'UPSERT', ?, ?)`,
        args: [outboxId, tenantId, recordId, JSON.stringify(update), now],
      });
    }

    return { success: true };
  } catch (error) {
    log.error('attendance_update_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: error instanceof Error ? error.message : "Failed to update attendance" };
  }
}

export async function lockSessionAction(sessionId: string, pin: string) {
  try {
    if (pin !== "1234") {
      return { success: false, error: "Invalid PIN" };
    }

    const { client, tenantId } = await getAuthenticatedDb();
    const now = new Date().toISOString();

    await client.execute({
      sql: `UPDATE attendance_sessions SET locked_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      args: [now, now, sessionId, tenantId],
    });

    // Audit log
    await client.execute({
      sql: `INSERT INTO audit_log (id, tenant_id, actor, ref_type, ref_id, action, metadata, created_at)
            VALUES (?, ?, ?, 'attendance_session', ?, 'session_locked', ?, ?)`,
      args: [crypto.randomUUID(), tenantId, tenantId, sessionId, JSON.stringify({ locked_at: now }), now],
    });

    return { success: true };
  } catch (error) {
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
    const { client, tenantId } = await getAuthenticatedDb();
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

    // Get all active students
    const students = await client.execute({
      sql: `SELECT id, first_name, last_name FROM students WHERE tenant_id = ? AND status = 'active' AND archived_at IS NULL ORDER BY first_name`,
      args: [tenantId],
    });

    // Get attendance records in period
    const records = await client.execute({
      sql: `SELECT ar.student_id, ar.status
            FROM attendance_records ar
            JOIN attendance_sessions s ON s.id = ar.session_id
            WHERE ar.tenant_id = ? AND s.session_date >= ? AND s.session_date <= ?`,
      args: [tenantId, periodStart, periodEnd],
    });

    // Aggregate by student
    const summaryMap = new Map<string, { present: number; absent: number; late: number; excused: number }>();
    for (const row of students.rows) {
      summaryMap.set(row.id as string, { present: 0, absent: 0, late: 0, excused: 0 });
    }

    for (const rec of records.rows) {
      const sid = rec.student_id as string;
      const status = rec.status as string;
      const existing = summaryMap.get(sid);
      if (existing) {
        if (status === "present") existing.present++;
        else if (status === "absent") existing.absent++;
        else if (status === "late") existing.late++;
        else if (status === "excused") existing.excused++;
      }
    }

    const summaries: AttendanceSummaryItem[] = [];
    let overallPresent = 0, overallAbsent = 0, overallLate = 0, overallExcused = 0, totalSessions = 0;

    for (const [studentId, counts] of summaryMap.entries()) {
      const student = students.rows.find((s: any) => s.id === studentId);
      if (!student) continue;
      const total = counts.present + counts.absent + counts.late + counts.excused;
      totalSessions += total;
      overallPresent += counts.present;
      overallAbsent += counts.absent;
      overallLate += counts.late;
      overallExcused += counts.excused;
      summaries.push({
        student_id: studentId,
        student_name: `${student.first_name} ${student.last_name || ""}`.trim(),
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
          total_students: students.rows.length,
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
