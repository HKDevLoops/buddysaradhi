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
import {
  UNLOCK_WINDOW_MINUTES,
  HARD_UNLOCK_REASON_MIN_LENGTH,
  DEFAULT_LOCK_HOURS,
  ageHours,
  hardLocked,
  readUnlockWindow,
} from "../lib/attendance-window.ts";

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
    // 06 §10.6: the day view needs the unlock window to render countdowns
    // and route tier-3 sessions to the request sheet. Computed per read (no
    // column to go stale); null when no window is open.
    let enrichedSession: unknown = session ?? null;
    if (session) {
      const nowIso = new Date().toISOString();
      const window = await readUnlockWindow(orm, String((session as { id: unknown }).id), nowIso);
      enrichedSession = {
        ...(session as Record<string, unknown>),
        unlock_window_expires_at: window.open ? window.expiresAt : null,
        hard_locked: hardLocked(String((session as { sessionDate?: unknown }).sessionDate ?? ""), nowIso),
      };
    }
    return ok({ session: enrichedSession, records });
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
    //
    // Lazy-relock ordering (06 §10.8): an EXPIRED grant's relock row is
    // written in its OWN transaction BEFORE the main one. A throw inside the
    // main transaction rolls back everything it wrote — including a relock
    // row — so the close must commit separately. The main transaction then
    // re-reads the window fresh (race-safe: a concurrent unlock between the
    // two reads opens the window instead of double-relocking).
    const preTx = await (async () => {
      const preExisting = await orm.attendanceSession.findFirst({
        where: {
          sessionDate: parsed.data.session_date,
          ...(parsed.data.batch_id ? { batchId: parsed.data.batch_id } : {}),
        },
      });
      if (!preExisting) return null;
      const preDate = String(preExisting.sessionDate ?? "");
      // Same predicate as the in-transaction gate below (flag OR age): the
      // pre-check exists only to commit the lazy relock outside the doomed
      // transaction; the gate itself re-decides inside.
      const preSetting = await orm.setting.findFirst({ where: {} });
      const preLockHours = Number(preSetting?.attendanceLockHours ?? DEFAULT_LOCK_HOURS);
      const preNow = new Date().toISOString();
      const preLocked = Boolean(preExisting.lockedAt) ||
        ageHours(preDate, preNow) > preLockHours;
      if (!preLocked) return null;
      const preWindow = await readUnlockWindow(orm, String(preExisting.id), preNow);
      return { id: String(preExisting.id), expired: !preWindow.open && preWindow.expiredGrant };
    })();
    if (preTx?.expired) {
      await withWriteTransaction(db, async (tx) => {
        await recordAudit(tx, tenantId, tenantId, "attendance.relock", "session", preTx.id, {
          reason: "unlock_window_expired",
        });
        await recordOutbox(tx, tenantId, "attendance_sessions", preTx.id, "update", {
          sessionId: preTx.id,
          relocked_at: new Date().toISOString(),
          reason: "unlock_window_expired",
        });
      });
    }
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
        const lockHours = Number(lockSetting?.attendanceLockHours ?? DEFAULT_LOCK_HOURS);
        const nowIso = new Date().toISOString();

        // 06 §10.6 BR-ATT-07: a locked session (flag OR age) edits only inside
        // an open unlock window (re-read fresh: the pre-tx check above may
        // have written a relock, and a concurrent unlock may have opened).
        let inWindow = false;
        if (existing) {
          const sessionDate = String(existing.sessionDate ?? "");
          const locked = Boolean(existing.lockedAt) ||
            ageHours(sessionDate, nowIso) > lockHours;
          if (locked) {
            const window = await readUnlockWindow(txOrm, String(existing.id), nowIso);
            if (!window.open) {
              if (hardLocked(sessionDate, nowIso)) {
                throw new AttendanceRouteError(
                  "HARD_LOCKED: session is more than 30 days old; unlock it to edit",
                  409,
                );
              }
              throw new AttendanceRouteError("CONFLICT: session is locked; unlock it to edit", 409);
            }
            inWindow = true;
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
          // 06 §10.8 Tier 2+3 double-audit: in-window edits each carry an
          // `attendance.edit_locked` row (student + old/new status) in the
          // same transaction as the record write. Old statuses come from one
          // pre-read so the batch stays a single write wave.
          const priors = inWindow
            ? await txOrm.attendanceRecord.findMany({ where: { sessionId: sid! } })
            : [];
          const priorByStudent = new Map(
            (priors as Array<{ studentId: unknown; status: unknown }>).map((r) => [
              String(r.studentId),
              String(r.status),
            ]),
          );
          await txOrm.attendanceRecord.createMany({
            data: updates.map((u) => ({
              sessionId: sid!,
              studentId: u.student_id,
              status: u.status,
            })),
          });
          if (inWindow) {
            for (const u of updates) {
              await recordAudit(tx, tenantId, tenantId, "attendance.edit_locked", "record", String(sid), {
                student_id: u.student_id,
                old_status: priorByStudent.get(u.student_id) ?? null,
                new_status: u.status,
                window: "unlock",
              });
            }
          }
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

  // POST /api/v1/attendance/unlock — 06 §10.6 BR-ATT-07 Tier 2: PIN-verified
  // client opens a 60-minute window (audit `attendance.unlock`); lockedAt
  // stays set. Mirrors /lock (same tx shape, same idempotency envelope).
  // Tier 3 (>30d) is refused with 409 HARD_LOCKED — see /request-unlock.
  if (path === "/api/v1/attendance/unlock" && method === "POST") {
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const body = await req.json().catch(() => ({}));
    const parsed = z.object({ sessionId: z.string().uuid() }).safeParse(body);
    if (!parsed.success) return failZod(parsed.error);
    const sessionId = parsed.data.sessionId;
    const now = new Date().toISOString();
    try {
      const windowExpiresAt = await withWriteTransaction(db, async (tx) => {
        const txOrm = createPrismaOrm(tx, tenantId);
        const session = await txOrm.attendanceSession.findFirst({ where: { id: sessionId } });
        if (!session) {
          throw new AttendanceRouteError("session_not_found", 404);
        }
        const sessionDate = String(session.sessionDate ?? "");
        if (hardLocked(sessionDate, now)) {
          throw new AttendanceRouteError(
            "HARD_LOCKED: session is more than 30 days old; direct unlock is disabled",
            409,
          );
        }
        const lockSetting = await txOrm.setting.findFirst({ where: {} });
        const lockHours = Number(lockSetting?.attendanceLockHours ?? DEFAULT_LOCK_HOURS);
        const autoLocked = !session.lockedAt && ageHours(sessionDate, now) > lockHours;
        if (!session.lockedAt && !autoLocked) {
          throw new AttendanceRouteError("session_not_locked", 409);
        }
        const expiresAt = new Date(new Date(now).getTime() + UNLOCK_WINDOW_MINUTES * 60_000).toISOString();
        await recordAudit(tx, tenantId, tenantId, "attendance.unlock", "session", sessionId, {
          method: "pin",
          window_minutes: UNLOCK_WINDOW_MINUTES,
          window_expires_at: expiresAt,
        });
        await recordOutbox(tx, tenantId, "attendance_sessions", sessionId, "update", {
          sessionId,
          unlock_window_until: expiresAt,
        });
        const env = okEnvelope(200, { unlocked: true, window_expires_at: expiresAt });
        await storeIdempotentResponse(tx, tenantId, idemRoute, idemKey, env.code, env.body);
        return expiresAt;
      });
      invalidateTenant(tenantId);
      return ok({ unlocked: true, window_expires_at: windowExpiresAt });
    } catch (err) {
      if (err instanceof AttendanceRouteError) return fail(err.message, err.status);
      const replay = await replayIfDuplicate(db, tenantId, idemRoute, idemKey, err);
      if (replay) return replay;
      throw err;
    }
  }

  // POST /api/v1/attendance/request-unlock — 06 §10.6 Tier 3: hard-locked
  // sessions unlock only via audited request (reason ≥ 20 chars). Single-user
  // app: the tutor is the authority, so the request opens the 60-minute
  // window immediately; the request row doubles as the grant.
  if (path === "/api/v1/attendance/request-unlock" && method === "POST") {
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const body = await req.json().catch(() => ({}));
    const parsed = z
      .object({ sessionId: z.string().uuid(), reason: z.string().trim().min(HARD_UNLOCK_REASON_MIN_LENGTH) })
      .safeParse(body);
    if (!parsed.success) return failZod(parsed.error);
    const { sessionId, reason } = parsed.data;
    const now = new Date().toISOString();
    try {
      const windowExpiresAt = await withWriteTransaction(db, async (tx) => {
        const txOrm = createPrismaOrm(tx, tenantId);
        const session = await txOrm.attendanceSession.findFirst({ where: { id: sessionId } });
        if (!session) {
          throw new AttendanceRouteError("session_not_found", 404);
        }
        if (!hardLocked(String(session.sessionDate ?? ""), now)) {
          throw new AttendanceRouteError(
            "NOT_HARD_LOCKED: session is under 30 days old; unlock it directly",
            409,
          );
        }
        const expiresAt = new Date(new Date(now).getTime() + UNLOCK_WINDOW_MINUTES * 60_000).toISOString();
        await recordAudit(tx, tenantId, tenantId, "attendance.hard_unlock_request", "session", sessionId, {
          reason,
          method: "pin",
          window_minutes: UNLOCK_WINDOW_MINUTES,
          window_expires_at: expiresAt,
        });
        await recordOutbox(tx, tenantId, "attendance_sessions", sessionId, "update", {
          sessionId,
          unlock_window_until: expiresAt,
        });
        const env = okEnvelope(200, { unlocked: true, window_expires_at: expiresAt });
        await storeIdempotentResponse(tx, tenantId, idemRoute, idemKey, env.code, env.body);
        return expiresAt;
      });
      invalidateTenant(tenantId);
      return ok({ unlocked: true, window_expires_at: windowExpiresAt });
    } catch (err) {
      if (err instanceof AttendanceRouteError) return fail(err.message, err.status);
      const replay = await replayIfDuplicate(db, tenantId, idemRoute, idemKey, err);
      if (replay) return replay;
      throw err;
    }
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
