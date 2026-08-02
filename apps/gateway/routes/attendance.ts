import type { RouteHandler } from "./students.ts";
import { ok, fail } from "../lib/errors.ts";
import { recordOutbox, recordAudit } from "./students.ts";
import { getCached, setCache, invalidateTenant } from "../lib/cache.ts";
import { createPrismaOrm } from "../lib/orm.ts";

export const handleAttendance: RouteHandler = async (req, db, tenantId, path, method, url) => {
  const sp = url.searchParams;
  const orm = createPrismaOrm(db, tenantId);

  // GET /api/v1/attendance/batches
  if (path === "/api/v1/attendance/batches" && method === "GET") {
    const batchesCacheKey = `batches:${tenantId}`;
    const cachedBatches = getCached(batchesCacheKey);
    if (cachedBatches) return ok(cachedBatches);

    const rows = await orm.batch.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
    });

    const mapped = rows.map((b) => ({
      id: b.id,
      name: b.name,
      subject: b.subject ?? null,
    }));

    setCache(batchesCacheKey, mapped, 60_000);
    return ok(mapped);
  }

  // GET /api/v1/attendance
  if (path === "/api/v1/attendance" && method === "GET") {
    const date = sp.get("date") ?? new Date().toISOString().slice(0, 10);
    const batchId = sp.get("batchId");

    const session = await orm.attendanceSession.findFirst({
      where: {
        sessionDate: date,
        ...(batchId ? { batchId } : {}),
      },
    });

    const roster = await orm.student.findMany({
      where: { status: "active", archivedAt: null },
      orderBy: { firstName: "asc" },
    });

    let records: unknown[];
    if (session) {
      const recs = await orm.attendanceRecord.findMany({
        where: { sessionId: session.id },
      });
      const byStu = new Map(recs.map((r) => [r.studentId, r]));
      records = roster.map((s) => ({
        student_id: s.id,
        name: `${s.firstName || ""} ${s.lastName || ""}`.trim(),
        batch: null,
        status: byStu.get(s.id)?.status ?? null,
      }));
    } else {
      records = roster.map((s) => ({
        student_id: s.id,
        name: `${s.firstName || ""} ${s.lastName || ""}`.trim(),
        batch: null,
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
    
    const existing = await orm.attendanceSession.findFirst({
      where: {
        sessionDate: body.session_date,
        ...(body.batch_id ? { batchId: body.batch_id } : {}),
      },
    });

    const lockSetting = await orm.setting.findFirst({ where: {} });
    const lockHours = Number(lockSetting?.attendanceLockHours ?? 48);

    if (existing) {
      const ageHours =
        (Date.now() - new Date(existing.sessionDate as string).getTime()) / 3_600_000;
      if (existing.lockedAt || ageHours > lockHours) {
        return fail("Session is locked. Unlock it to edit.", 409);
      }
    }

    let sessionId = existing?.id;
    if (!sessionId) {
      const createdSession = await orm.attendanceSession.create({
        data: {
          batchId: body.batch_id ?? null,
          sessionDate: body.session_date,
        },
      });
      sessionId = createdSession.id;
    }

    const updates = body.updates as { student_id: string; status: string }[];
    if (updates.length > 0) {
      await orm.attendanceRecord.createMany({
        data: updates.map((u) => ({
          sessionId: sessionId!,
          studentId: u.student_id,
          status: u.status,
        })),
      });
    }

    await recordOutbox(db, tenantId, "attendance_sessions", String(sessionId), "update", body);
    await recordAudit(db, tenantId, tenantId, "attendance.mark", "session", String(sessionId), { count: updates.length });
    invalidateTenant(tenantId);
    return ok({ sessionId });
  }

  // POST /api/v1/attendance/lock
  if (path === "/api/v1/attendance/lock" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const now = new Date().toISOString();
    
    await orm.attendanceSession.update({
      where: { id: body.sessionId },
      data: {
        lockedAt: now,
        lockedBy: tenantId,
      },
    });

    await recordAudit(db, tenantId, tenantId, "attendance.lock", "session", body.sessionId, {});
    return ok({ locked: true });
  }

  return null;
};
