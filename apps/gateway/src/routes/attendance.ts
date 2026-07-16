import type { Hono } from "hono";
import { ok, fail, getContext } from "../lib/respond";

export function registerAttendance(app: Hono) {
  app.get("/api/v1/attendance", async (c) => {
    const { db, tenantId } = getContext(c);
    const dateIso = c.req.query("date") || new Date().toISOString();
    const batchId = c.req.query("batchId");
    const date = dateIso.slice(0, 10);

    const session = await db.attendanceSession.findFirst({
      where: { tenantId, sessionDate: date, batchId: batchId ?? undefined },
    });

    const students = await db.student.findMany({
      where: { tenantId, status: "active", archivedAt: null },
      include: {
        enrollments: { where: { exitedOn: null }, include: { batch: true } },
      },
      orderBy: { firstName: "asc" },
    });

    let records: any[];
    if (session) {
      const recs = await db.attendanceRecord.findMany({
        where: { sessionId: session.id, tenantId },
      });
      const byStudent = new Map(recs.map((r) => [r.studentId, r]));
      records = students.map((s) => ({
        student_id: s.id,
        name: [s.firstName, s.lastName].filter(Boolean).join(" "),
        batch: s.enrollments[0]?.batch?.name ?? null,
        status: byStudent.get(s.id)?.status ?? null,
      }));
    } else {
      records = students.map((s) => ({
        student_id: s.id,
        name: [s.firstName, s.lastName].filter(Boolean).join(" "),
        batch: s.enrollments[0]?.batch?.name ?? null,
        status: null,
      }));
    }

    return ok(c, {
      session: session
        ? {
            id: session.id,
            tenant_id: session.tenantId,
            session_date: session.sessionDate,
            batch_id: session.batchId,
            locked_at: session.lockedAt,
            created_at: session.createdAt,
            updated_at: session.updatedAt,
          }
        : null,
      records,
    });
  });

  app.get("/api/v1/attendance/batches", async (c) => {
    const { db, tenantId } = getContext(c);
    const batches = await db.batch.findMany({
      where: { tenantId, archivedAt: null },
      select: { id: true, name: true, subject: true },
      orderBy: { name: "asc" },
    });
    return ok(c, batches);
  });

  app.post("/api/v1/attendance", async (c) => {
    const { db, tenantId } = getContext(c);
    const body = (await c.req.json().catch(() => ({}))) as {
      session_date?: string;
      batch_id?: string | null;
      updates?: { student_id: string; status: string }[];
    };
    if (!body.session_date || !Array.isArray(body.updates)) {
      return fail(c, "Missing session_date or updates", 400);
    }
    const now = new Date().toISOString();

    const existing = await db.attendanceSession.findFirst({
      where: { tenantId, sessionDate: body.session_date, batchId: body.batch_id ?? undefined },
    });
    if (existing?.lockedAt) {
      return fail(c, "Session is locked. Unlock it to edit.", 409);
    }

    let sessionId = existing?.id;
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      // SAFETY: providing an explicit `id` forces Prisma's relation-input
      // branch where the scalar FK `batchId` collapses to `undefined` in the
      // type; runtime still accepts a real string (or null) for the column.
      await db.attendanceSession.create({
        data: {
          id: sessionId,
          tenantId,
          batchId: body.batch_id ?? undefined,
          sessionDate: body.session_date,
          createdAt: now,
          updatedAt: now,
        } as unknown as Parameters<typeof db.attendanceSession.create>[0]["data"],
      });
    }

    for (const u of body.updates) {
      await db.attendanceRecord.upsert({
        where: { sessionId_studentId: { sessionId, studentId: u.student_id } },
        create: {
          id: crypto.randomUUID(),
          tenantId,
          sessionId,
          studentId: u.student_id,
          status: u.status,
          markedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        update: { status: u.status, updatedAt: now },
      });
    }

    return ok(c, { sessionId });
  });
}
