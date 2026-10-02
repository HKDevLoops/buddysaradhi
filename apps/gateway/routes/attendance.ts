import type { RouteHandler } from "./students.ts";
import { ok, fail, failZod } from "../lib/errors.ts";
import { recordOutbox, recordAudit } from "./students.ts";
import { getCached, setCache, invalidateTenant, REFERENCE_TTL_MS } from "../lib/cache.ts";
import { createPrismaOrm } from "../lib/orm.ts";
import { withWriteTransaction } from "../lib/tx.ts";
import {
  idempotencyRoute,
  okEnvelope,
  replayIfDuplicate,
  requireIdempotencyKey,
  storeIdempotentResponse,
} from "../lib/idempotency.ts";
import { z } from "zod";

// 06_Attendance.md §status enum (present | absent | late | excused | holiday) —
// AGENTS.md §6.1 Zod-before-DB-touch parity for every mutating route.
const AttendanceStatusSchema = z.enum(["present", "absent", "late", "excused", "holiday"]);
const AttendanceMarkSchema = z.object({
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "session_date must be YYYY-MM-DD"),
  batch_id: z.string().uuid().nullable().optional(),
  updates: z.array(
    z.object({
      student_id: z.string().uuid(),
      status: AttendanceStatusSchema,
    }),
    { invalid_type_error: "updates must be an array" },
  ).min(1, "updates must not be empty").max(500, "updates exceeds the 500-record batch limit"),
});

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

    setCache(batchesCacheKey, mapped, REFERENCE_TTL_MS);
    return ok(mapped);
  }

  // GET /api/v1/attendance
  if (path === "/api/v1/attendance" && method === "GET") {
    const date = sp.get("date") ?? new Date().toISOString().slice(0, 10);
    const batchId = sp.get("batchId");

    // Free-tier batching (RFC-003 §0 — every round trip costs rows-read):
    // session + roster are independent, so they fan out in one Promise.all
    // instead of two sequential round trips.
    const [session, roster] = await Promise.all([
      orm.attendanceSession.findFirst({
        where: {
          sessionDate: date,
          ...(batchId ? { batchId } : {}),
        },
      }),
      orm.student.findMany({
        where: { status: "active", archivedAt: null },
        orderBy: { firstName: "asc" },
      }),
    ]);

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
    // RFC-004 C1 — fail-closed (see routes/ledger.ts payment path). No CAS:
    // attendance conflicts are owned by the session lock (409 above), not by
    // compare-and-swap on shared rows (RFC-004 C4 names settings / student
    // profile / fee schedules only).
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const body = await req.json().catch(() => ({}));
    const parsed = AttendanceMarkSchema.safeParse(body);
    if (!parsed.success) return failZod(parsed.error);

    // Rule 7 / BR-SYN-01 — lock check, session create, record upserts, outbox
    // and audit share ONE write transaction (fail-closed on any write
    // failure). The lock read sits inside the same transaction so a
    // lock racing this mark cannot be missed.
    try {
      const sessionId = await withWriteTransaction(db, async (tx) => {
        const txOrm = createPrismaOrm(tx, tenantId);
        const existing = await txOrm.attendanceSession.findFirst({
          where: {
            sessionDate: parsed.data.session_date,
            ...(parsed.data.batch_id ? { batchId: parsed.data.batch_id } : {}),
          },
        });

        const lockSetting = await txOrm.setting.findFirst({ where: {} });
        const lockHours = Number(lockSetting?.attendanceLockHours ?? 48);

        if (existing) {
          const ageHours =
            (Date.now() - new Date(existing.sessionDate as string).getTime()) / 3_600_000;
          if (existing.lockedAt || ageHours > lockHours) {
            throw new AttendanceRouteError("CONFLICT: session is locked; unlock it to edit", 409);
          }
        }

        let sid = existing?.id;
        if (!sid) {
          const createdSession = await txOrm.attendanceSession.create({
            data: {
              batchId: parsed.data.batch_id ?? null,
              sessionDate: parsed.data.session_date,
            },
          });
          sid = createdSession.id;
        }

        const updates = parsed.data.updates;
        if (updates.length > 0) {
          await txOrm.attendanceRecord.createMany({
            data: updates.map((u) => ({
              sessionId: sid!,
              studentId: u.student_id,
              status: u.status,
            })),
          });
        }

        await recordOutbox(tx, tenantId, "attendance_sessions", String(sid), "update", body);
        await recordAudit(tx, tenantId, tenantId, "attendance.mark", "session", String(sid), { count: updates.length });
        // RFC-004 C1 — response bytes commit atomically with the mark (see
        // routes/ledger.ts payment path). The lock-conflict above aborts
        // WITHOUT storing, so a retry with the same key re-executes.
        const env = okEnvelope(200, { sessionId: sid });
        await storeIdempotentResponse(tx, tenantId, idemRoute, idemKey, env.code, env.body);
        return sid;
      });
      // Cache invalidation follows COMMIT (a rolled-back transaction left the
      // rows untouched, so cached reference GETs are still correct).
      invalidateTenant(tenantId);
      return ok({ sessionId });
    } catch (err) {
      if (err instanceof AttendanceRouteError) return fail(err.message, err.status);
      // RFC-004 K2/K3 — concurrent-duplicate race (see routes/ledger.ts).
      const replay = await replayIfDuplicate(db, tenantId, idemRoute, idemKey, err);
      if (replay) return replay;
      throw err;
    }
  }

  // POST /api/v1/attendance/lock
  if (path === "/api/v1/attendance/lock" && method === "POST") {
    // RFC-004 C1 — fail-closed (see the mark path above).
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const body = await req.json().catch(() => ({}));
    const parsed = z.object({ sessionId: z.string().uuid() }).safeParse(body);
    if (!parsed.success) return failZod(parsed.error);
    const sessionId = parsed.data.sessionId;
    const now = new Date().toISOString();

    // Rule 7 (12_Business_Rules.md BR-SYN-01) — lock flag, outbox and audit
    // share one write transaction (audit 2026-09-26: "Attendance lock — no
    // sync_outbox"). A locked session that does not replicate can still be
    // edited by a second device.
    try {
      await withWriteTransaction(db, async (tx) => {
        const txOrm = createPrismaOrm(tx, tenantId);
        await txOrm.attendanceSession.update({
          where: { id: sessionId },
          data: {
            lockedAt: now,
            lockedBy: tenantId,
          },
        });

        await recordOutbox(tx, tenantId, "attendance_sessions", sessionId, "update", {
          sessionId,
          lockedAt: now,
          lockedBy: tenantId,
        });
        await recordAudit(tx, tenantId, tenantId, "attendance.lock", "session", sessionId, {});
        // RFC-004 C1 — response bytes commit atomically with the lock (see
        // routes/ledger.ts payment path).
        const env = okEnvelope(200, { locked: true });
        await storeIdempotentResponse(tx, tenantId, idemRoute, idemKey, env.code, env.body);
      });
    } catch (err) {
      // RFC-004 K2/K3 — concurrent-duplicate race (see routes/ledger.ts).
      const replay = await replayIfDuplicate(db, tenantId, idemRoute, idemKey, err);
      if (replay) return replay;
      throw err;
    }

    invalidateTenant(tenantId);
    return ok({ locked: true });
  }

  return null;
};

/**
 * Rule 9 (no silent failures): a rejection with a defined HTTP status is
 * carried out of the write transaction as a typed error; anything else keeps
 * propagating to index.ts as a typed 500. Mirrors `LedgerRouteError`.
 */
class AttendanceRouteError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AttendanceRouteError";
    this.status = status;
  }
}
