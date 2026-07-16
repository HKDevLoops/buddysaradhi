// Implements: 06_Attendance.md — Attendance Service
// Routes: GET /api/v1/attendance, POST /api/v1/attendance, GET /api/v1/attendance/batches
// Implements session creation, record upsert, and batch listing.

import { Elysia } from "elysia";
import { randomUUID } from "crypto";
import { db } from "./db";

const PORT = process.env.PORT || 3033;

export const app = new Elysia()
  .get("/health", () => ({ status: "ok" }))

  .group("/api/v1/attendance", (app) =>
    app
      // GET /api/v1/attendance?date=YYYY-MM-DD&batchId=optional
      .get("/", async ({ request }) => {
        const url = new URL(request.url);
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing X-Tutor-Id", { status: 401 });

        const dateIso = url.searchParams.get("date");
        if (!dateIso) return new Response("Missing date parameter", { status: 400 });

        const batchId = url.searchParams.get("batchId") || undefined;

        // 1. Fetch session for this date (+ optional batch)
        const sessionRes = await db.attendanceSession.findFirst({
          where: {
            tenantId: tutorId,
            sessionDate: dateIso,
            ...(batchId && batchId !== "all" ? { batchId } : {}),
          },
        });

        let session: Record<string, unknown> | null = null;
        if (sessionRes) {
          session = {
            id: sessionRes.id,
            tenant_id: sessionRes.tenantId,
            session_date: sessionRes.sessionDate,
            batch_id: sessionRes.batchId,
            locked_at: sessionRes.lockedAt?.toISOString() ?? null,
            created_at: sessionRes.createdAt.toISOString(),
            updated_at: sessionRes.updatedAt.toISOString(),
          };
        }

        // 2. Fetch students + their attendance
        const students = await db.student.findMany({
          where: {
            tenantId: tutorId,
            status: "active",
            ...(batchId && batchId !== "all"
              ? { enrollments: { some: { batchId, exitedOn: null } } }
              : {}),
          },
          include: {
            enrollments: {
              where: { exitedOn: null },
              orderBy: { joinedOn: "desc" },
              take: 1,
              include: { batch: true },
            },
            ...(sessionRes?.id
              ? {
                  attendance: {
                    where: { sessionId: sessionRes.id },
                    take: 1,
                  },
                }
              : {}),
          },
          orderBy: { firstName: "asc" },
        });

        const records = students.map((row) => ({
          student_id: row.id,
          name: [row.firstName, row.lastName].filter(Boolean).join(" "),
          batch: (row as any).enrollments?.[0]?.batch?.name ?? null,
          status:
            sessionRes?.id && (row as any).attendance?.[0]?.status
              ? (row as any).attendance[0].status
              : null,
        }));

        return { success: true, data: { session, records } };
      })

      // GET /api/v1/attendance/batches — list all active batches
      .get("/batches", async ({ request }) => {
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing X-Tutor-Id", { status: 401 });

        const batches = await db.batch.findMany({
        where: {
          tutorId: tutorId,
          archivedAt: null,
        },  select: { id: true, name: true, subject: true },
          orderBy: { name: "asc" },
        });

        return { success: true, data: batches };
      })

      // POST /api/v1/attendance — create session + upsert attendance records
      // Body: { date: string, batchId?: string, records: { studentId: string, status: 'present'|'absent'|'late' }[] }
      .post("/", async ({ request, body }) => {
        const tutorId = request.headers.get("X-Tutor-Id");
        if (!tutorId) return new Response("Missing X-Tutor-Id", { status: 401 });

        const b = body as any;
        if (!b.date) return new Response("Missing date", { status: 400 });
        if (!Array.isArray(b.records) || b.records.length === 0)
          return new Response("Missing records array", { status: 400 });

        const now = new Date();

        const result = await db.$transaction(async (tx) => {
          // 1. Upsert session
          let session = await tx.attendanceSession.findFirst({
            where: {
              tenantId: tutorId,
              sessionDate: b.date,
              ...(b.batchId ? { batchId: b.batchId } : {}),
            },
          });

          if (!session) {
            session = await tx.attendanceSession.create({
              data: {
                id: randomUUID(),
                tenantId: tutorId,
                sessionDate: b.date,
                batchId: b.batchId || null,
                createdAt: now,
                updatedAt: now,
              },
            });
          }

          // 2. Upsert each attendance record
          const updatedRecords = await Promise.all(
            b.records.map(async (rec: { studentId: string; status: string }) => {
              const existing = await tx.attendanceRecord.findFirst({
                where: { sessionId: session!.id, studentId: rec.studentId },
              });

              if (existing) {
                return tx.attendanceRecord.update({
                  where: { id: existing.id },
                  data: { status: rec.status, markedAt: now },
                });
              }

              return tx.attendanceRecord.create({
                data: {
                  id: randomUUID(),
                  tenantId: tutorId,
                  sessionId: session!.id,
                  studentId: rec.studentId,
                  status: rec.status,
                  markedAt: now,
                  createdAt: now,
                },
              });
            })
          );

          return { session, records: updatedRecords };
        });

        return { success: true, data: result };
      })
  );

// Start server if main module
if (import.meta.main) {
  app.listen(PORT);
  console.log(
    `🦊 Attendance Service is running at ${app.server?.hostname}:${app.server?.port}`
  );
}
