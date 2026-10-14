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
import { run } from "../lib/sql.ts";
import { stmtInsertAttendanceRecordUpsert } from "../lib/sql.ts";
import {
  DEFAULT_LOCK_HOURS,
  ageHours,
  hardLocked,
  readUnlockWindow,
} from "../lib/attendance-window.ts";

// 06_Attendance.md §status enum (present | absent | late | excused | holiday) —
// AGENTS.md §6.1 Zod-before-DB-touch parity for every mutating route.
const AttendanceStatusSchema = z.enum(["present", "absent", "late", "excused", "holiday"]);

/**
 * The batch a mark with no `batch_id` belongs to. Same sentinel the web action
 * writes (`batch-default`), because a single-tenant DB has no "no batch" — the
 * column is NOT NULL, so the choice has to be made explicitly and both writers
 * must make the SAME one or the same day would land in two sessions.
 */
const DEFAULT_BATCH_ID = "batch-default";
/**
 * The name the `batch-default` row is created under. Byte-identical to the web
 * writer's `ensureBatch` (apps/web/src/server/actions/attendance.ts:91) — the
 * two writers create the SAME row, so a tutor sees one label and not two
 * depending on which client made the mark.
 */
const DEFAULT_BATCH_NAME = "General Batch";
// EC-A-01 / 06 §11 E5 / §14 (`session_date` ≤ today). The Zod table row for
// this rule was never implemented — the schema only checked the SHAPE of the
// date, so the edge happily created a session dated next month, which 48 hours
// later is auto-locked and can then only be opened through the Tier-3 request
// flow. A future-dated session is not a record, it is a trap.
const SessionDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "session_date must be YYYY-MM-DD")
  .refine((d) => d <= new Date().toISOString().slice(0, 10), {
    message: "session_date cannot be in the future",
  });

/**
 * PERF-ATT-10 — the range read (`GET /api/v1/attendance?from=&to=`).
 *
 * `YYYY-MM-DD` TEXT. The shape mirrors `session_date`, which sorts
 * lexicographically (lib/schema.ts:95) — that is what makes `>=`/`<=` on a
 * date column an exact, index-usable range rather than a string comparison the
 * caller has to trust.
 */
/**
 * `YYYY-MM-DD`, and a REAL date.
 *
 * The regex alone accepted `2026-02-31` and `2026-13-01` — shapes that look like
 * days but are not. They were previously caught only incidentally, via
 * `Date.parse` producing `NaN` downstream, which surfaced as a confusing
 * "range must be between..." message instead of "that is not a date". Rejecting
 * them here means the caller is told the truth about which of the two it got
 * wrong.
 *
 * Round-tripping through `toISOString` is the check: it rejects any day that does
 * not exist in the proleptic Gregorian calendar, rather than trusting arithmetic.
 */
const IsoDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "from/to must be YYYY-MM-DD")
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00.000Z`);
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
  }, "from/to must be a real calendar date (YYYY-MM-DD)");

/**
 * The widest window the range read will serve. A bound on the WINDOW, not on the
 * result size: a 400 here refuses an unbounded query before it reaches SQLite,
 * where `from=1970-01-01` would otherwise turn one dashboard render into a scan
 * of the tenant's whole attendance history. 366 days is one calendar year —
 * wider than any dashboard window (04_Dashboard.md §6.2 tops out at 30 days), so
 * no real caller is constrained by it.
 */
const MAX_RANGE_DAYS = 366;

/**
 * Hard ceiling on the SESSIONS one range read will return.
 *
 * A separate bound from `MAX_RANGE_DAYS` because the two limit different
 * resources. `MAX_RANGE_DAYS` bounds the span of TIME; this bounds the number of
 * rows, which a tutor with multiple sessions a day can exceed inside a legal
 * span. Without it two things break:
 *
 *   1. The record read below binds ONE parameter per session id. Past
 *      SQLite's SQLITE_MAX_VARIABLE_NUMBER (and the edge isolate's own limit)
 *      that query fails outright — an unbounded read is not merely slow, it stops
 *      working.
 *   2. The response materialises `roster x sessions` objects. Capping the roster
 *      at 200 while sessions are unbounded means a 366-day window can still
 *      return tens of thousands of records, so the roster cap buys nothing on
 *      payload size.
 *
 * 400 sessions is well above any real teaching pattern (a tutor running 4 classes
 * a day for a year is ~1000, and the dashboard heatmap asks for 14), so no
 * dashboard is constrained by it.
 */
const MAX_RANGE_SESSIONS = 400;

/**
 * The roster axis bound (PERF-ATT-10 requirement 2).
 *
 * Before this, the roster read had NO bound of any kind and the heatmap ran it 14
 * times per dashboard render — so a 200-student tutor shipped 14 × 200 rows over
 * the wire to display at most 30 (dashboard-analytics `HEATMAP_MAX_STUDENTS`).
 * Two bounds apply, and they are deliberately different in kind:
 *
 *   1. BATCH SCOPE — a FILTER, and the primary bound. When `batchId` is supplied
 *      the roster is narrowed to that batch's enrolled students, which is the
 *      population the measure is actually defined over. This never under-reports
 *      the batch, because the batch's members ARE the population.
 *
 *   2. `ATTENDANCE_ROSTER_MAX` — a hard ceiling on the batch scope, so a batch
 *      with 5,000 members still cannot make one dashboard render unbounded. This
 *      one IS a cap, so it CAN under-report, which is why the response ships
 *      `rosterTotal` and `rosterTruncated` beside the rows: a truncated roster can
 *      never masquerade as a complete one (Rule 9 — the same honesty pattern
 *      `dueTodayTotal` beside a capped `dueToday` uses in analytics.ts).
 *
 * The cap sits ABOVE the 30 students the dashboard renders, so for every tenant
 * this is designed for the cap is invisible and the result is identical to the
 * uncapped read.
 */
const ATTENDANCE_ROSTER_MAX = 200;

interface RosterRead {
  // AGENTS.md §6.1 / AP-7: no `any`. The ORM returns untyped rows, so the honest
  // type is `unknown` and the two consumers narrow the two fields they read
  // (`firstName`, `lastName`, `id`) explicitly rather than laundering them
  // through `any` at the boundary.
  rows: Array<Record<string, unknown>>;
  /** The TRUE population size — before the cap. Never inferred from `rows`. */
  total: number;
  truncated: boolean;
  /** The filter that produced this population, for the audit trail. */
  scope: "batch" | "active";
}

/**
 * The one roster read every attendance GET shares (PERF-ATT-10).
 *
 * The single-day and the range path both call this, so the day view and the
 * heatmap can never disagree about who is markable.
 *
 * `archivedAt: null` is load-bearing: BR-ATT-12 / 06 §11 E3-E4 / EC-A-02 all
 * exclude archived students from the active enrollment roster.
 */
async function readAttendanceRoster(
  orm: ReturnType<typeof createPrismaOrm>,
  batchId: string | null,
): Promise<RosterRead> {
  // Batch scope needs the enrolled ids first — `buildTenantWhere` does not join,
  // so this is the same two-reads pattern students.ts uses for `batchIds`. An
  // empty id list renders `1=0`, which is a legitimate empty result, not
  // "no filter".
  let batchStudentIds: string[] | null = null;
  if (batchId) {
    const enrollments = await orm.studentEnrollment.findMany({ where: { batchId } });
    batchStudentIds = [...new Set(enrollments.map((e) => String(e.studentId)))];
  }

  const where: Record<string, unknown> = { status: "active", archivedAt: null };
  if (batchStudentIds !== null) where.id = { in: batchStudentIds };

  const [rows, total] = await Promise.all([
    orm.student.findMany({
      where,
      orderBy: { firstName: "asc" },
      take: ATTENDANCE_ROSTER_MAX,
    }),
    // The count is over the SAME filter and with no `take`, so `rosterTotal` is
    // the population and `rows.length` is what we managed to ship. That
    // difference is the whole honesty contract.
    orm.student.count({ where }),
  ]);

  return { rows, total, truncated: total > rows.length, scope: batchId ? "batch" : "active" };
}

const AttendanceMarkSchema = z.object({
  session_date: SessionDateSchema,
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
    const from = sp.get("from");
    const to = sp.get("to");

    // ── PERF-ATT-10: the range read ──────────────────────────────────────────
    // The dashboard heatmap used to issue 14 of these (one per day), and each
    // re-read the roster — so ONE dashboard render cost 14 roster reads and 14
    // round trips. A caller that supplies BOTH `from` and `to` now gets every
    // session in the window in ONE read, with the roster read exactly once.
    //
    // `from`/`to` are opt-in and independent of `date`: supplying neither is the
    // unchanged single-day behaviour, so no existing caller can change shape.
    if (from !== null || to !== null) {
      if (from === null || to === null) {
        return fail("BAD_REQUEST: range read requires BOTH from and to");
      }
      const fromDay = IsoDaySchema.safeParse(from);
      const toDay = IsoDaySchema.safeParse(to);
      if (!fromDay.success || !toDay.success) {
        return fail("BAD_REQUEST: from and to must both be YYYY-MM-DD");
      }
      // Lexicographic order IS chronological order for YYYY-MM-DD, so this is an
      // exact comparison and not a string guess.
      if (fromDay.data > toDay.data) {
        return fail("BAD_REQUEST: from must be on or before to");
      }
      // Bound the WINDOW before it reaches SQLite. Without this, `from=1970-01-01`
      // turns one dashboard render into a scan of the tenant's entire attendance
      // history — an unbounded read behind an authenticated request.
      //
      // Both endpoints are real calendar dates by the time we get here
      // (IsoDaySchema's refine rejects `2026-02-31`), so `Date.parse` cannot
      // produce NaN. `from === to` is a legitimate one-day window (spanDays 0),
      // and it is what the dashboard heatmap reduces to on its first day.
      const spanDays =
        (Date.parse(`${toDay.data}T00:00:00Z`) - Date.parse(`${fromDay.data}T00:00:00Z`)) /
        86_400_000;
      if (spanDays < 0 || spanDays > MAX_RANGE_DAYS) {
        return fail(
          `BAD_REQUEST: range must be at most ${MAX_RANGE_DAYS} days ` +
            `(got ${fromDay.data} to ${toDay.data})`,
        );
      }

      const roster = await readAttendanceRoster(orm, batchId);
      // Sessions are bounded too. The window is capped at MAX_RANGE_DAYS, but a
      // tenant with several sessions a day still produces roster x sessions
      // response objects, and the record read below interpolates one bound
      // parameter PER SESSION — past SQLite's SQLITE_MAX_VARIABLE_NUMBER (and the
      // edge's own limit) that query fails outright. `take` is therefore not
      // optional: it is what keeps the `IN (...)` list a fixed size.
      //
      // Rule 9 (limit+1 honesty, mirroring `rosterTruncated` below): the cap uses
      // the existing `take` mechanism (no new SQL text per AGENTS §3.4) — fetch
      // one past MAX_RANGE_SESSIONS so the response can SAY it truncated instead
      // of silently clipping the window's tail.
      const sessionsPlusOne = await orm.attendanceSession.findMany({
        where: {
          sessionDate: { between: [fromDay.data, toDay.data] },
          ...(batchId ? { batchId } : {}),
        },
        orderBy: { sessionDate: "asc" },
        take: MAX_RANGE_SESSIONS + 1,
      });
      const sessionsTruncated = sessionsPlusOne.length > MAX_RANGE_SESSIONS;
      const sessions = sessionsPlusOne.slice(0, MAX_RANGE_SESSIONS);
      const sessionIds = sessions.map((s) => String(s.id));
      // An empty window legitimately has no sessions. Skip the read rather than
      // issue an empty `IN ()`, which is invalid SQL (the builder renders a
      // client-side empty `IN` as `1=0`, but no round trip is needed at all).
      const recs =
        sessionIds.length > 0
          ? await orm.attendanceRecord.findMany({ where: { sessionId: { in: sessionIds } } })
          : [];
      const bySession = new Map<string, Map<string, { status: unknown }>>();
      for (const r of recs) {
        const sid = String(r.sessionId);
        let bucket = bySession.get(sid);
        if (bucket === undefined) {
          bucket = new Map();
          bySession.set(sid, bucket);
        }
        bucket.set(String(r.studentId), r as { status: unknown });
      }

      const days = sessions.map((session) => {
        const sid = String(session.id);
        const bucket = bySession.get(sid);
        return {
          session_date: String(session.sessionDate),
          session_id: sid,
          // One record per ROSTER row, exactly like the single-day path below, so
          // the two paths cannot disagree about what "missing" looks like (a null
          // status) — a divergence a heatmap would silently render as a gap.
          records: roster.rows.map((s) => {
            const rec = bucket?.get(String(s.id));
            return {
              student_id: String(s.id),
              name: `${s.firstName || ""} ${s.lastName || ""}`.trim(),
              batch: null,
              status: rec?.status ?? null,
            };
          }),
        };
      });

      return ok({
        from: fromDay.data,
        to: toDay.data,
        days,
        rosterTotal: roster.total,
        rosterTruncated: roster.truncated,
        rosterScope: roster.scope,
        sessionsTruncated,
      });
    }

    // Free-tier batching (RFC-003 §0 — every round trip costs rows-read):
    // session + roster are independent, so they fan out in one Promise.all
    // instead of two sequential round trips.
    //
    // The roster comes from the SHARED `readAttendanceRoster`, so the day view
    // and the range view cannot disagree about who is markable. This replaced an
    // inline read that (a) ignored `batchId` and (b) had no bound — meaning the
    // same `?date=&batchId=X` request returned every active student, not X's
    // batch, and returned them uncapped. Both were real divergences; routing one
    // helper is what removed them rather than documenting them.
    const [session, rosterRead] = await Promise.all([
      orm.attendanceSession.findFirst({
        where: {
          sessionDate: date,
          ...(batchId ? { batchId } : {}),
        },
      }),
      readAttendanceRoster(orm, batchId),
    ]);
    const roster = rosterRead.rows;

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
    // The single-day response now carries the same truncation honesty as the
    // range response, so a capped roster is never silently complete here either.
    const rosterMeta = {
      rosterTotal: rosterRead.total,
      rosterTruncated: rosterRead.truncated,
      rosterScope: rosterRead.scope,
    };
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
    return ok({ session: enrichedSession, records, ...rosterMeta });
  }

  // POST /api/v1/attendance
  if (path === "/api/v1/attendance" && method === "POST") {
    // RFC-004 C1 — fail-closed (see the ledger payment path). No CAS:
    // attendance conflicts are owned by the session lock (409 above), not by
    // compare-and-swap on shared rows (RFC-004 C4 names settings / student
    // profile / fee schedules only).
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const body = await req.json().catch(() => ({}));
    const parsed = AttendanceMarkSchema.safeParse(body);
    if (!parsed.success) return failZod(parsed.error);

    // `attendance_sessions.batch_id` is NOT NULL (11_Data_Model §3.7), so a mark
    // that omits `batch_id` used to create the session with NULL and the whole
    // transaction aborted on a constraint — i.e. marking the FIRST day through
    // the edge always failed. The web action resolves the same case to the
    // `batch-default` sentinel (updateAttendanceAction), so the edge now does too
    // and the two agree on which session a batch-less mark belongs to.
    const targetBatchId = parsed.data.batch_id ?? DEFAULT_BATCH_ID;

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
          batchId: targetBatchId,
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
            batchId: targetBatchId,
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

        // 06 §6 / 11_Data_Model §4.3 — materialise the batch this mark belongs
        // to. `attendance_sessions.batch_id` is NOT NULL, so a batch-less mark
        // has to land SOMEWHERE; the sentinel above says where. But writing a
        // session that points at a row nobody created left the batch dimension
        // DEAD: `GET /api/v1/attendance/batches` reads `batches` (the only table
        // the selector can render), so a tenant whose first mark arrived through
        // the edge answered `[]` forever — the toolbar said "No batches yet"
        // while every mark went into `batch-default`. The web writer already
        // created the row (`ensureBatch`); this makes the edge agree.
        //
        // The insert, its `sync_outbox` row and its `audit_log` row share this
        // transaction with the mark (Rule 7 / BR-SYN-01), so a batch can never
        // exist locally without a queued replication row.
        //
        // A client that NAMED a batch gets no such courtesy: an explicit
        // `batch_id` with no row is a dangling reference, and inventing a batch
        // called "General Batch" for it would fabricate a class the tutor never
        // created. Fail closed (Rule 9 / BR-SEC-03) instead.
        const targetBatch = await txOrm.batch.findFirst({ where: { id: targetBatchId } });
        if (!targetBatch) {
          if (parsed.data.batch_id) {
            throw new AttendanceRouteError(
              `BATCH_NOT_FOUND: no batch "${targetBatchId}" for this tenant`,
              422,
            );
          }
          const created = await txOrm.batch.create({
            data: { id: targetBatchId, name: DEFAULT_BATCH_NAME },
          });
          await recordOutbox(tx, tenantId, "batches", targetBatchId, "insert", {
            id: String(created.id ?? targetBatchId),
            tenant_id: tenantId,
            name: String(created.name ?? DEFAULT_BATCH_NAME),
            subject: created.subject ?? null,
            archived_at: null,
            created_at: String(created.createdAt ?? nowIso),
            updated_at: String(created.updatedAt ?? nowIso),
          });
          await recordAudit(tx, tenantId, tenantId, "attendance.batch_ensure", "batch", targetBatchId, {
            batch_id: targetBatchId,
            name: DEFAULT_BATCH_NAME,
            reason: "default_batch_materialised",
          });
        }

        if (!sid) {
          const createdSession = await txOrm.attendanceSession.create({
            data: {
              batchId: targetBatchId,
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
          // BR-ATT-01 / 06 §10.1: re-marking the same (session, student) must
          // UPDATE the existing record in place, never insert a second row and
          // never abort. `attendanceRecord.createMany` did neither: the second
          // mark of the same student hit `UNIQUE(session_id, student_id)` and
          // the whole transaction failed, so a tutor who changed one mark on the
          // web and then re-marked through the edge got an error instead of an
          // edit, and "Mark all Present" on an already-partly-marked day failed
          // outright. The audited builder is the spec's own statement —
          // `ON CONFLICT(session_id, student_id) DO UPDATE` (lib/sql.ts:712).
          for (const u of updates) {
            const stmt = stmtInsertAttendanceRecordUpsert(tenantId, {
              sessionId: sid,
              studentId: u.student_id,
              status: u.status,
            });
            await run(tx, stmt.sql, stmt.args);
          }
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
          if (updates.length > 1) {
            // 06 §15.2: a bulk mark is its own audit row —
            // `{ batch_id, session_date, status, count_affected,
            // count_skipped_locked }`. Nothing wrote one, so the one attendance
            // mutation a tutor cannot undo in a single motion left no trace.
            await recordAudit(tx, tenantId, tenantId, "attendance.bulk_mark", "session", String(sid), {
              batch_id: targetBatchId,
              session_date: parsed.data.session_date,
              status: updates[0]?.status ?? null,
              count_affected: updates.length,
              count_skipped_locked: 0,
            });
          }
        }

        // F-20: the outbox payload is the VALIDATED fragment, never the raw
        // body. `body` is pre-Zod JSON; `parsed.data` is what was actually
        // written (session + records), so it is also what a replay must see
        // (BR-SYN-02). Unknown client keys are dropped at the schema, not
        // stored.
        await recordOutbox(tx, tenantId, "attendance_sessions", String(sid), "update", {
          session_id: String(sid),
          session_date: parsed.data.session_date,
          updates: parsed.data.updates,
        });
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
        const session = await txOrm.attendanceSession.findFirst({ where: { id: sessionId } });
        if (!session) {
          throw new AttendanceRouteError("session_not_found", 404);
        }
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
        // 06 §15.2 audit table: manual lock is `attendance_lock` with
        // `{ batch_id, session_date, method }`. The metadata was `{}`, so the
        // row could not answer which date or which batch was frozen — the one
        // question the audit trail exists to answer.
        await recordAudit(tx, tenantId, tenantId, "attendance.lock", "session", sessionId, {
          batch_id: session.batchId ?? null,
          session_date: String(session.sessionDate ?? ""),
          method: "pin",
        });
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

  // POST /api/v1/attendance/unlock — 06 §10.6 BR-ATT-07 Tier 2.
  //
  // FAIL-CLOSED, deliberately (Rule 9 + BR-SEC-03). This route used to accept
  // `{ sessionId }` and nothing else: it granted a 60-minute OVERWRITE-GRADE
  // window — the state in which a locked attendance record may be changed, with
  // every change double-audited instead of refused — on the strength of a bearer
  // token alone. 06 §10.6 Tier 2 and 06 §15 require a PIN/biometric proof for
  // exactly this grant, and 12_Business_Rules BR-SEC-04 lists "unlock/edit
  // locked attendance" as a PIN-gated mutation. A client-side check is not a
  // gate: the web BFF forwards POST /api/v1/* to this route, so ANY holder of
  // the session token could open the window and rewrite a frozen day.
  //
  // The edge CANNOT verify the PIN to make it honest. `settings.pin_hash` is
  // argon2id(m=64MiB, t=3, p=2) + a secret pepper (apps/web/src/lib/crypto.ts)
  // and the Deno edge runtime has no argon2 — WebCrypto offers PBKDF2/SHKDF
  // only, and the npm `argon2` package is a native Node addon that will not
  // bundle into an edge isolate. This is the same constraint that already forces
  // `routes/security.ts` to gate the secure-erase flow on PIN *presence* rather
  // than a PIN value, and the same reasoning applies here with more force: erase
  // is refused when it cannot check, so a 60-minute overwrite grant is refused
  // too. Accepting a `pin` field and comparing it against nothing would be
  // decoration that reads as re-authentication.
  //
  // The PIN-verifying path is the Next.js server action (`unlockSessionAction` /
  // `requestHardUnlockAction` in apps/web/src/server/actions/attendance.ts),
  // which runs where the argon2id hash and the pepper live. Escalated to the
  // owner alongside routes/security.ts:41-51.
  if (path === "/api/v1/attendance/unlock" && method === "POST") {
    return fail(EDGE_PIN_UNAVAILABLE, 403);
  }

  // POST /api/v1/attendance/request-unlock — 06 §10.6 Tier 3. Same gate, same
  // reason: it also opens a 60-minute window, and its Zod validated the reason
  // but never a PIN, so the "hard-locked" boundary (the one place the spec says
  // NO direct unlock is allowed) had an unauthenticated door around it.
  if (path === "/api/v1/attendance/request-unlock" && method === "POST") {
    return fail(EDGE_PIN_UNAVAILABLE, 403);
  }

  return null;
};

/**
 * Typed, honest refusal — and deliberately SHORT: `fail()` collapses any 4xx
 * body over 200 characters to the bare status word (`lib/errors.ts`
 * `sanitizeError`), so the dispatch code has to survive in the first 200
 * characters. The full reasoning is the comment above each route.
 */
const EDGE_PIN_UNAVAILABLE =
  "PIN_PROOF_UNAVAILABLE: The edge cannot verify your security PIN, so it will not " +
  "open an attendance unlock window. Unlock in the app, where the PIN is checked.";

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
