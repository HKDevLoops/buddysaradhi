"use server";

import { getAttendanceForDate } from "../queries/attendance";
import { getAuthenticatedDb } from "@/server/get-db";
import { UpdateAttendancePayload } from "@buddysaradhi/shared";
import { randomUUID } from "crypto";
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
      sessionId = randomUUID();
      await client.execute({
        sql: `INSERT INTO attendance_sessions (id, tenant_id, session_date, batch_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [sessionId, tenantId, payload.session_date, payload.batch_id || "all", now, now],
      });
    }

    // 2. Upsert attendance records + sync_outbox
    for (const update of payload.updates) {
      const recordId = randomUUID();
      const outboxId = randomUUID();

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
      args: [randomUUID(), tenantId, tenantId, sessionId, JSON.stringify({ locked_at: now }), now],
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to lock session" };
  }
}
