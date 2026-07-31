import type { RouteHandler } from "./students.ts";
import { run, oneRow, allRows } from "../lib/db.ts";
import { ok, fail } from "../lib/errors.ts";
import { recordOutbox, recordAudit } from "./students.ts";
import { getCached, setCache, invalidateTenant } from "../lib/cache.ts";

function studentName(r: Record<string, unknown>): string {
  return [r.first_name, r.last_name].filter(Boolean).join(" ");
}

export const handleAttendance: RouteHandler = async (req, db, tenantId, path, method, url) => {
  const sp = url.searchParams;

  // GET /api/v1/attendance/batches
  if (path === "/api/v1/attendance/batches" && method === "GET") {
    const batchesCacheKey = `batches:${tenantId}`;
    const cachedBatches = getCached(batchesCacheKey);
    if (cachedBatches) return ok(cachedBatches);
    const rows = await allRows(
      db,
      "SELECT id, name, subject FROM batches WHERE tenant_id = ? AND archived_at IS NULL ORDER BY name",
      [tenantId],
    );
    setCache(batchesCacheKey, rows, 60_000);
    return ok(rows);
  }

  // GET /api/v1/attendance
  if (path === "/api/v1/attendance" && method === "GET") {
    const date = sp.get("date") ?? new Date().toISOString().slice(0, 10);
    const batchId = sp.get("batchId");
    const session = await oneRow(
      db,
      "SELECT * FROM attendance_sessions WHERE tenant_id = ? AND session_date = ? AND (batch_id IS ? OR batch_id = ?)",
      [tenantId, date, batchId ?? null, batchId ?? null],
    );
    const roster = await allRows(
      db,
      `SELECT s.id, s.first_name, s.last_name, b.name AS batch_name
       FROM students s
       LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.exited_on IS NULL
       LEFT JOIN batches b ON b.id = se.batch_id
       WHERE s.tenant_id = ? AND s.status = 'active' AND s.archived_at IS NULL
       ORDER BY s.first_name`,
      [tenantId],
    );
    let records: unknown[];
    if (session) {
      const recs = await allRows(
        db,
        "SELECT student_id, status, notes FROM attendance_records WHERE tenant_id = ? AND session_id = ?",
        [tenantId, session.id],
      );
      const byStu = new Map(recs.map((r) => [r.student_id, r]));
      records = roster.map((s) => ({
        student_id: s.id,
        name: studentName(s),
        batch: s.batch_name ?? null,
        status: byStu.get(s.id)?.status ?? null,
      }));
    } else {
      records = roster.map((s) => ({
        student_id: s.id,
        name: studentName(s),
        batch: s.batch_name ?? null,
        status: null,
      }));
    }
    return ok({ session: session ?? null, records });
  }

  // POST /api/v1/attendance
  if (path === "/api/v1/attendance" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!body.session_date || !Array.isArray(body.updates)) {
      return fail("Missing session_date or updates", 400);
    }
    const now = new Date().toISOString();
    const existing = await oneRow(
      db,
      "SELECT * FROM attendance_sessions WHERE tenant_id = ? AND session_date = ? AND (batch_id IS ? OR batch_id = ?)",
      [tenantId, body.session_date, body.batch_id ?? null, body.batch_id ?? null],
    );
    const lockSetting = await oneRow(
      db,
      "SELECT attendance_lock_hours FROM settings WHERE tenant_id = ?",
      [tenantId],
    );
    const lockHours = Number(lockSetting?.attendance_lock_hours ?? 48);
    if (existing) {
      const ageHours =
        (Date.now() - new Date(existing.session_date as string).getTime()) / 3_600_000;
      if (existing.locked_at || ageHours > lockHours) {
        return fail("Session is locked. Unlock it to edit.", 409);
      }
    }
    let sessionId = existing?.id;
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      await run(
        db,
        "INSERT INTO attendance_sessions (id, tenant_id, batch_id, session_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [sessionId, tenantId, body.batch_id ?? null, body.session_date, now, now],
      );
    }
    const updates = body.updates as { student_id: string; status: string }[];
    if (updates.length > 0) {
      const values = updates.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
      const args: unknown[] = [];
      for (const u of updates) {
        args.push(crypto.randomUUID(), tenantId, sessionId, u.student_id, u.status, now, now, now);
      }
      await run(
        db,
        `INSERT INTO attendance_records (id, tenant_id, session_id, student_id, status, marked_at, created_at, updated_at)
         VALUES ${values}
         ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
        args,
      );
    }
    await recordOutbox(db, tenantId, "attendance_sessions", sessionId, "update", body);
    await recordAudit(db, tenantId, tenantId, "attendance.mark", "session", sessionId, { count: body.updates.length });
    invalidateTenant(tenantId);
    return ok({ sessionId });
  }

  // POST /api/v1/attendance/lock
  if (path === "/api/v1/attendance/lock" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const now = new Date().toISOString();
    await run(
      db,
      "UPDATE attendance_sessions SET locked_at = ?, locked_by = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
      [now, tenantId, now, tenantId, body.sessionId],
    );
    await recordAudit(db, tenantId, tenantId, "attendance.lock", "session", body.sessionId, {});
    return ok({ locked: true });
  }

  return null;
};
