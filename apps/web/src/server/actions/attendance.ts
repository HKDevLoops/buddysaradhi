"use server";

import { getAttendanceForDate } from "../queries/attendance";
import { getAuthenticatedPrisma } from "@/server/get-db";
import { UpdateAttendancePayload, pinFormatError } from "@buddysaradhi/shared";
import { z } from "zod";
import { log } from "@/lib/logger";
import { verifyPin } from "@/lib/crypto";
import { invalidateTenant } from "@/server/cache"; // workstream C wiring
import {
  BULK_ABSENT_CONFIRM_WORD,
  DEFAULT_LOCK_HOURS,
  HARD_UNLOCK_REASON_MIN_LENGTH,
  UNLOCK_WINDOW_MINUTES,
  ageHours,
  hardLocked,
  isFutureDate,
  localDayIso,
  readUnlockWindow,
} from "@/server/attendance-window";

type Db = Awaited<ReturnType<typeof getAuthenticatedPrisma>>["db"];

/**
 * Runtime gate for the mark payload (AGENTS.md §6.1 "Zod for all input
 * validation. Every server action…", §6.4 "parses its input with Zod before
 * doing anything else").
 *
 * A server action is an HTTP endpoint: `UpdateAttendancePayload` is erased at
 * runtime, so the annotation alone validated nothing. A request with an update
 * carrying no `student_id` reached the writer, and the ORM's upsert then matched
 * on `session_id` ALONE — which meant it silently rewrote an unrelated student's
 * record. This schema is declared here rather than reused from
 * `packages/shared` for one concrete reason: `UpdateAttendancePayloadSchema`
 * types `batch_id` as a uuid, but this action manufactures the batch id
 * `batch-default` for the auto-created default batch (and `Batch.id` is a plain
 * string in `11_Data_Model.md`), so the shared `.uuid()` would reject the app's
 * own default batch.
 */
const AttendanceStatusValue = z.enum(["present", "absent", "late", "excused"]);
const MarkUpdatesSchema = z
  .array(
    z.object({
      student_id: z.string().min(1, "each mark needs a student"),
      status: AttendanceStatusValue,
    }),
  )
  .min(1, "a mark must change at least one student")
  .max(500, "a batch cannot exceed 500 students in one call");
const MarkPayloadSchema = z.object({
  session_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "session_date must be YYYY-MM-DD"),
  batch_id: z.string().nullable().optional(),
  updates: MarkUpdatesSchema,
});
const BulkMarkPayloadSchema = z.object({
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "session_date must be YYYY-MM-DD"),
  batch_id: z.string().nullable().optional(),
  status: z.enum(["present", "absent"]),
  // An EMPTY list is allowed through validation on purpose: 06 §11 E10 makes it
  // a disabled button with a "No students to mark" tooltip, and a server that
  // reports an error for the same state would contradict the control that
  // already refused to fire.
  student_ids: z.array(z.string().min(1)).max(500),
  overwrite: z.boolean(),
});

export async function fetchAttendanceAction(dateIso: string, batchId?: string) {
  try {
    return await getAttendanceForDate(dateIso, batchId);
  } catch (error) {
    log.error('fetch_attendance_action_failed', error instanceof Error ? error.message : String(error), { dateIso, batchId });
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch attendance" };
  }
}

/** One mark, as the grid sends it from a single row. */
interface MarkRequest {
  student_id: string;
  status: string;
}

async function ensureBatch(db: Db, tenantId: string, batchId: string, now: string): Promise<void> {
  const batchCheck = await db.batch.findFirst({ where: { id: batchId } });
  if (batchCheck) return;
  await db.batch.create({
    data: { id: batchId, tenantId, name: "General Batch", createdAt: now, updatedAt: now },
  });
}

/**
 * The whole write path for one (date, batch): session fetch-or-create, every
 * record upsert, every `sync_outbox` row, the in-window `attendance_edit_locked`
 * rows, and the `attendance_bulk_mark` row — inside ONE write transaction.
 *
 * 06 §10.7: a bulk mark is "a single transaction"; §17 budgets "Bulk present
 * (100 students) < 250 ms — batched SQL in one transaction". The loop this
 * replaced opened a transaction PER ROW, so a 36-student bulk was 36 commits:
 * a mid-loop failure left the first 20 marks saved and the audit trail claiming
 * nothing, and Rule 7 (AGENTS §2) only held if each individual row happened to
 * succeed.
 */
async function writeAttendance(
  db: Db,
  tenantId: string,
  sessionDate: string,
  batchId: string,
  updates: MarkRequest[],
  options: { bulk: boolean; skipAlreadyMarked: boolean },
): Promise<{ countAffected: number; countSkippedMarked: number; inWindow: boolean }> {
  const now = new Date().toISOString();

  // The lock/window decision is re-read INSIDE the transaction, not before it
  // (mirrors the gateway gate, `apps/gateway/routes/attendance.ts`): a lock
  // that lands between an outside read and the write would otherwise be missed,
  // which is the whole point of freezing the record.
  const preExisting = await db.attendanceSession.findFirst({ where: { tenantId, sessionDate, batchId } });
  if (preExisting?.lockedAt) {
    // Lazy relock on an aged-out grant — in its OWN transaction, BEFORE the one
    // that is about to throw. A throw inside the write transaction rolls back
    // everything it wrote, so committing the close there would erase the record
    // that the window expired (06 §10.8 `attendance_relock`).
    const outside = await readUnlockWindow(db, tenantId, String(preExisting.id), now);
    if (!outside.open && outside.expiredGrant) {
      await db.$transaction(async (tx) => {
        await tx.auditLog.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            actor: tenantId,
            refType: "attendance_session",
            refId: String(preExisting.id),
            action: "attendance_relock",
            metadata: JSON.stringify({ reason: "unlock_window_expired" }),
            createdAt: now,
          },
        });
        await tx.syncOutbox.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            tableName: "attendance_sessions",
            rowId: String(preExisting.id),
            op: "update",
            payload: JSON.stringify({ relocked_at: now, reason: "unlock_window_expired" }),
            createdAt: now,
          },
        });
      });
    }
  }

  return await db.$transaction(async (tx) => {
    const session = await tx.attendanceSession.findFirst({ where: { tenantId, sessionDate, batchId } });
    let inWindow = false;
    let sessionId: string;
    if (session) {
      if (session.lockedAt) {
        const window = await readUnlockWindow(tx, tenantId, String(session.id), now);
        if (!window.open) {
          if (hardLocked(sessionDate, now)) {
            throw new Error(
              "HARD_LOCKED: This session is more than 30 days old. Direct unlock is disabled — file an unlock request with a reason."
            );
          }
          throw new Error("Session is locked. Unlock it to edit.");
        }
        inWindow = true;
      }
      sessionId = String(session.id);
    } else {
      sessionId = crypto.randomUUID();
      await tx.attendanceSession.create({
        data: { id: sessionId, tenantId, sessionDate, batchId, createdAt: now, updatedAt: now },
      });
      // Rule 7 (BR-SYN-01): a session created by the first mark replicates too.
      // Before this row existed the create was a bare write with no outbox row,
      // so a session born on one device could be invisible on the next.
      await tx.syncOutbox.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          tableName: "attendance_sessions",
          rowId: sessionId,
          op: "insert",
          payload: JSON.stringify({ session_id: sessionId, session_date: sessionDate, batch_id: batchId }),
          createdAt: now,
        },
      });
    }

    // 06 §10.7: "Mark all Present … Sets every enrolled-but-unmarked student …
    // Already-marked students are not overwritten (the tutor's individual
    // overrides win)." One pre-read settles the whole set, so the rule is
    // enforced by the writer and not merely by which rows the client chose.
    let priorByStudent: Map<string, string> | null = null;
    if (options.skipAlreadyMarked) {
      const priors = await tx.attendanceRecord.findMany({ where: { sessionId } });
      priorByStudent = new Map(
        (priors as Array<{ studentId?: unknown; status?: unknown }>).map((row) => [
          String(row.studentId),
          String(row.status ?? ""),
        ]),
      );
    }

    const effective = options.skipAlreadyMarked
      ? updates.filter((u) => !priorByStudent?.has(u.student_id))
      : updates;

    // In-window edits need the pre-image for the audit delta, so the priors are
    // read once for the batch rather than once per row.
    if (inWindow && !priorByStudent) {
      const priors = await tx.attendanceRecord.findMany({ where: { sessionId } });
      priorByStudent = new Map(
        (priors as Array<{ studentId?: unknown; status?: unknown }>).map((row) => [
          String(row.studentId),
          String(row.status ?? ""),
        ]),
      );
    }

    for (const update of effective) {
      const recordId = crypto.randomUUID();
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
        update: { status: update.status, updatedAt: now },
      });
      await tx.syncOutbox.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          tableName: "attendance_records",
          rowId: recordId,
          op: "update",
          payload: JSON.stringify({ sessionId, studentId: update.student_id, status: update.status }),
          createdAt: now,
        },
      });
      if (inWindow) {
        // 06 §10.8 / §15.2: one `attendance_edit_locked` row per changed row,
        // in the SAME transaction as the write it describes.
        await tx.auditLog.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            actor: tenantId,
            refType: "attendance_record",
            refId: recordId,
            action: "attendance_edit_locked",
            metadata: JSON.stringify({
              student_id: update.student_id,
              old_status: priorByStudent?.get(update.student_id) ?? null,
              new_status: update.status,
              window: "unlock",
            }),
            createdAt: now,
          },
        });
      }
    }

    if (options.bulk && effective.length > 0) {
      // 06 §15.2 audit table: `attendance_bulk_mark` with
      // { batch_id, session_date, status, count_affected,
      // count_skipped_locked }. Nothing in the product wrote this row before, so
      // a whole-day bulk mark — the one mutation a tutor cannot undo row-by-row
      // in one motion — left no trace in the audit log at all.
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          actor: tenantId,
          refType: "attendance_session",
          refId: sessionId,
          action: "attendance_bulk_mark",
          metadata: JSON.stringify({
            batch_id: batchId,
            session_date: sessionDate,
            status: effective[0]?.status ?? null,
            count_affected: effective.length,
            count_skipped_locked: 0,
            count_skipped_already_marked: updates.length - effective.length,
          }),
          createdAt: now,
        },
      });
    }

    return {
      countAffected: effective.length,
      countSkippedMarked: updates.length - effective.length,
      inWindow,
    };
  });
}

export async function updateAttendanceAction(payload: UpdateAttendancePayload) {
  try {
    // Implements: AGENTS.md §3.4 (Prisma ORM only — no runtime raw SQL) +
    // §2 Rule 7 (outbox in the same transaction as the mutation);
    // 06_Attendance.md §9.2 (session upsert + record upsert in one tx),
    // §10.6 (unlock window gate), §10.8 (audit), §14 (validate first).
    const parsed = MarkPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        success: false,
        error: `VALIDATION: ${first ? `${first.path.join(".") || "payload"}: ${first.message}` : "invalid mark payload"}`,
      };
    }
    const { db, tenantId } = await getAuthenticatedPrisma();
    const now = new Date().toISOString();

    if (isFutureDate(parsed.data.session_date, now)) {
      // EC-A-01 / 06 §11 E5 / §14 (`session_date` ≤ today): a session dated in
      // the future is not a record, it is a placeholder that would later lock
      // itself and force the tutor through a PIN to clean up.
      return { success: false, error: "VALIDATION: You cannot mark attendance for a future date." };
    }

    const targetBatchId =
      parsed.data.batch_id && parsed.data.batch_id.trim() !== "" && parsed.data.batch_id !== "all"
        ? parsed.data.batch_id
        : "batch-default";

    await ensureBatch(db, tenantId, targetBatchId, now);

    const result = await writeAttendance(
      db,
      tenantId,
      parsed.data.session_date,
      targetBatchId,
      parsed.data.updates as MarkRequest[],
      { bulk: false, skipAlreadyMarked: false },
    );

    invalidateTenant(tenantId, "attendance:");
    return { success: true, count_affected: result.countAffected };
  } catch (error) {
    log.error('attendance_update_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: error instanceof Error ? error.message : "Failed to update attendance" };
  }
}

/**
 * Bulk mark (06 §10.7 BR-ATT-06). A separate entry point from the per-row
 * `updateAttendanceAction` so the BULK rules live in one auditable place:
 *
 *   - Present  → `overwrite: false` — already-marked students keep their mark
 *     (the tutor's individual overrides win).
 *   - Absent   → `overwrite: true`, and only after the tutor has TYPED
 *     `ABSENT` (BULK_ABSENT_CONFIRM_WORD). The typed word is a UI gate per
 *     06 §14, so it is not re-checked here; the count and the audit row are,
 *     because a bulk is the one attendance mutation with no per-row undo.
 */
/** Discriminated so callers can narrow on `success` (a `boolean` here would
 *  leave `count_affected`/`count_skipped` possibly-undefined at the call site). */
export type BulkMarkResult =
  | { success: true; count_affected: number; count_skipped: number }
  | { success: false; error: string };

export async function bulkMarkAttendanceAction(input: {
  session_date: string;
  batch_id: string | null;
  status: string;
  student_ids: string[];
  overwrite: boolean;
}): Promise<BulkMarkResult> {
  try {
    const parsed = BulkMarkPayloadSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        success: false,
        error: `VALIDATION: ${first ? `${first.path.join(".") || "payload"}: ${first.message}` : "invalid bulk mark"}`,
      };
    }
    const { db, tenantId } = await getAuthenticatedPrisma();
    const now = new Date().toISOString();

    if (isFutureDate(parsed.data.session_date, now)) {
      return { success: false, error: "VALIDATION: You cannot mark attendance for a future date." };
    }
    if (parsed.data.student_ids.length === 0) {
      // 06 §11 E10: nothing to mark is not an error worth a toast.
      return { success: true as const, count_affected: 0, count_skipped: 0 };
    }

    const targetBatchId =
      parsed.data.batch_id && parsed.data.batch_id.trim() !== "" && parsed.data.batch_id !== "all"
        ? parsed.data.batch_id
        : "batch-default";
    await ensureBatch(db, tenantId, targetBatchId, now);

    const result = await writeAttendance(
      db,
      tenantId,
      parsed.data.session_date,
      targetBatchId,
      parsed.data.student_ids.map((studentId) => ({
        student_id: studentId,
        status: parsed.data.status,
      })),
      { bulk: true, skipAlreadyMarked: !parsed.data.overwrite },
    );

    invalidateTenant(tenantId, "attendance:");
    return {
      success: true as const,
      count_affected: result.countAffected,
      count_skipped: result.countSkippedMarked,
    };
  } catch (error) {
    log.error('attendance_bulk_update_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: error instanceof Error ? error.message : "Failed to update attendance" };
  }
}

export { BULK_ABSENT_CONFIRM_WORD };

/**
 * Lock a session (06 §9.3, §10.3, §15.2).
 *
 * `target` carries the date + batch so 06 §11 E9 can be honoured: "Lock
 * attempted with no records | Allowed — locks an empty session (rare but valid;
 * e.g., tutor pre-locks a cancelled class)." Sessions are created lazily by the
 * first mark (§9.2), so before this the only reachable lock was a session that
 * already had at least one mark, and the sheet's own empty state said so.
 */
export async function lockSessionAction(
  sessionId: string,
  pin: string,
  target?: { date: string; batchId: string | null },
) {
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

    if (target && isFutureDate(target.date, now)) {
      return { success: false, error: "VALIDATION: You cannot lock a future date." };
    }

    const batchId = target?.batchId && target.batchId !== "all" ? target.batchId : "batch-default";

    // W2 (reviews/overhaul-audit-report-2026-09-26.md): the lock UPDATE, its
    // sync_outbox row and the audit_log row go in ONE write transaction —
    // Rule 7 (AGENTS §2) / BR-SYN-01 require the outbox row in the same
    // transaction as the mutation, so a locked session can never exist
    // locally without a queued replication row.
    const lockedId = await db.$transaction(async (tx) => {
      let id = sessionId;
      let existing = await tx.attendanceSession.findFirst({ where: { id, tenantId } });
      if (!existing && target) {
        existing = await tx.attendanceSession.findFirst({
          where: { tenantId, sessionDate: target.date, batchId },
        });
        if (!existing) {
          // E9: lock an empty session. Created INSIDE this transaction so the
          // insert, its outbox row, the lock and the audit row all commit or
          // none do — a lock that created a session it then failed to lock
          // would be a session row the tutor cannot explain later.
          id = crypto.randomUUID();
          await tx.attendanceSession.create({
            data: { id, tenantId, sessionDate: target.date, batchId, createdAt: now, updatedAt: now },
          });
          await tx.syncOutbox.create({
            data: {
              id: crypto.randomUUID(),
              tenantId,
              tableName: "attendance_sessions",
              rowId: id,
              op: "insert",
              payload: JSON.stringify({ session_id: id, session_date: target.date, batch_id: batchId }),
              createdAt: now,
            },
          });
        }
      }
      if (!existing && !target) {
        throw new Error("Session not found.");
      }
      const sessionDate = String(existing?.sessionDate ?? target?.date ?? "");
      await tx.attendanceSession.update({
        where: { id, tenantId },
        data: { lockedAt: now, updatedAt: now },
      });
      await tx.syncOutbox.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          tableName: "attendance_sessions",
          rowId: id,
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
          refId: id,
          // 06 §15.2 audit table: manual lock is `attendance_lock` with
          // `{ batch_id, session_date, method }`. The row was written as
          // `session_locked` with `{ locked_at }`, a vocabulary the spec never
          // defines — so a Settings → Security → Audit filter for
          // `attendance_lock` (or for the session's own trail) found nothing,
          // and §10.8's promise that the trail answers "who froze this and how"
          // had no row to answer from.
          action: "attendance_lock",
          metadata: JSON.stringify({
            batch_id: batchId,
            session_date: sessionDate,
            method: "pin",
            locked_at: now,
          }),
          createdAt: now,
        },
      });
      return id;
    });

    invalidateTenant(tenantId, "attendance:");
    return { success: true, session_id: lockedId };
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
  /**
   * BR-CALC-06: `null` when the denominator is 0, and the UI renders "—".
   * A `0` here reads as "this student attended nothing", which is a different
   * and much worse claim than "nothing to measure".
   */
  percentage: number | null;
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
    overall_percentage: number | null;
  };
}

/**
 * BR-CALC-06 / 06 §9.7 attendance percentage.
 *
 * `excused` and `holiday` are EXCLUDED from the denominator (BR-CALC-06,
 * BR-ATT-02 "excused and holiday are excluded from the denominator",
 * BR-ATT-04/09, 06 §9.7 and §10.2 all say so) — a medical leave or a declared
 * holiday must not read as an absence. `late` counts as ATTENDED: BR-ATT-02
 * ("Late counts as present for %, flagged separately"), 06 §9.7
 * (`presentOrLate_count / totals_count`) and 06 §10.5 ("late counts toward % as
 * present does") all put late in the numerator; the `BR-CALC-06` formula line
 * omits it, which is a genuine contradiction between two specs — raised as a
 * cross-lane report, and resolved here in favour of the three concurring
 * statements (the more specific attendance rule wins over the one-line
 * formula).
 *
 * Returns `null` for a zero denominator (BR-CALC-06: "pct = null (display
 * '—')").
 */
export function attendancePct(counts: {
  present: number;
  late: number;
  absent: number;
}): number | null {
  const attended = counts.present + counts.late;
  const denominator = attended + counts.absent;
  if (denominator <= 0) return null;
  return Math.round((attended / denominator) * 100);
}

export async function fetchAttendanceSummaryAction(preset: AttendancePreset): Promise<{
  ok: boolean;
  value?: AttendanceSummary;
  error?: string;
}> {
  try {
    // Implements: AGENTS.md §3.4 (Prisma ORM only — no runtime raw SQL);
    // 12_Business_Rules.md BR-CALC-06 / BR-CALC-07.
    const { db, tenantId } = await getAuthenticatedPrisma();
    const now = new Date();
    let periodStart: string;
    let periodEnd = localDayIso(now.getFullYear(), now.getMonth(), now.getDate());

    // Bounds are LOCAL calendar days built from date parts (see
    // `localDayIso`): round-tripping them through `toISOString()` shifted every
    // preset a day backwards east of UTC, so "Last Month" silently included a
    // day of the month before it.
    switch (preset) {
      case "current_month":
        periodStart = localDayIso(now.getFullYear(), now.getMonth(), 1);
        break;
      case "last_month":
        periodStart = localDayIso(now.getFullYear(), now.getMonth() - 1, 1);
        periodEnd = localDayIso(now.getFullYear(), now.getMonth(), 0);
        break;
      case "last_3_months":
        periodStart = localDayIso(now.getFullYear(), now.getMonth() - 2, 1);
        break;
      case "last_6_months":
        periodStart = localDayIso(now.getFullYear(), now.getMonth() - 5, 1);
        break;
      case "full_year":
        periodStart = localDayIso(now.getFullYear(), 0, 1);
        break;
      default:
        periodStart = localDayIso(now.getFullYear(), now.getMonth(), 1);
    }

    const emptyOverall = {
      total_students: 0,
      total_sessions: 0,
      overall_present: 0,
      overall_absent: 0,
      overall_late: 0,
      overall_excused: 0,
      overall_percentage: null as number | null,
    };

    // Active roster via the ORM surface (same filter + ordering as before:
    // tenant, status active, not archived, ordered by first name).
    //
    // Rule 9 / EC-A-04: these reads previously caught their own failure and
    // returned `ok: true` with an EMPTY summary. The panel has one string for
    // "this period has no data" and one for "this failed" — so a timeout in the
    // middle of a month-end review told the tutor their students had no
    // attendance at all. A failed read is now a failed read.
    const rows = await db.student.findMany({
      where: { tenantId, status: "active", archivedAt: null },
      orderBy: { firstName: "asc" },
    });
    const studentRows = rows.map((row) => ({
      id: String(row.id),
      firstName: String(row.firstName ?? ""),
      lastName: (row.lastName as string | null) ?? null,
    }));

    // Attendance records in period. The ORM surface has no JOIN or date-range
    // operator, so sessions + records are read per-tenant and filtered in JS —
    // same rows as the previous JOIN, no raw SQL.
    const sessions = await db.attendanceSession.findMany({ where: { tenantId } });
    const sessionIds = new Set(
      sessions
        .filter((session) => {
          const day = String(session.sessionDate ?? "");
          return day >= periodStart && day <= periodEnd;
        })
        .map((session) => String(session.id)),
    );
    const allRecords = sessionIds.size
      ? await db.attendanceRecord.findMany({ where: { tenantId } })
      : [];
    const recordRows = allRecords
      .filter((rec) => sessionIds.has(String(rec.sessionId)))
      .map((rec) => ({ studentId: String(rec.studentId), status: String(rec.status) }));

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
      // `total_sessions` stays the count of marks in the period (including
      // excused) because the column is labelled "Total" beside the four status
      // columns and must sum to them; the PERCENTAGE denominator is the
      // BR-CALC-06 one, which excludes excused.
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
        percentage: attendancePct(counts),
      });
    }

    const overallPct = attendancePct({
      present: overallPresent,
      late: overallLate,
      absent: overallAbsent,
    });

    return {
      ok: true,
      value: {
        preset,
        period_start: periodStart,
        period_end: periodEnd,
        summaries,
        overall: {
          total_students: studentRows.length,
          total_sessions: totalSessions,
          overall_present: overallPresent,
          overall_absent: overallAbsent,
          overall_late: overallLate,
          overall_excused: overallExcused,
          overall_percentage: overallPct,
        },
      },
    };
  } catch (error) {
    log.error('attendance_summary_failed', error instanceof Error ? error.message : String(error));
    return { ok: false, error: error instanceof Error ? error.message : "Failed to fetch attendance summary" };
  }
}

async function requireUnlockPin(
  db: { setting: { findFirst(args: unknown): Promise<{ pinHash?: unknown } | null> } },
  tenantId: string,
  pin: string,
): Promise<{ success: true } | { success: false; error: string }> {
  // PIN gate mirrors lockSessionAction exactly (10_Security.md §4 sensitive
  // mutation; 08_Settings.md BR-SEC-02 fresh PIN): no-PIN, format, verify —
  // same taxonomy codes so `lockErrorCopy`-style clients classify identically.
  const settingsRow = await db.setting.findFirst({ where: { tenantId } });
  const pinHash = (settingsRow?.pinHash ?? null) as string | null;
  if (!pinHash) {
    return { success: false, error: "No PIN configured. Set one in Settings → Security." };
  }
  const pinFormatProblem = pinFormatError(pin);
  if (pinFormatProblem) {
    return { success: false, error: `VALIDATION: ${pinFormatProblem}` };
  }
  const pinValid = await verifyPin(pin, pinHash);
  if (!pinValid) {
    return { success: false, error: "VALIDATION: The security PIN is incorrect." };
  }
  return { success: true };
}

async function readLockHours(
  db: { setting: { findFirst(args: unknown): Promise<{ attendanceLockHours?: unknown } | null> } },
  tenantId: string,
): Promise<number> {
  // Mirrors the gateway mark path (`attendanceLockHours ?? 48`): the Tier 2
  // auto-lock boundary is tutor-configurable, so unlock must use the same
  // number or web and gateway disagree on what "locked" means.
  const settingsRow = await db.setting.findFirst({ where: { tenantId } });
  const raw = settingsRow?.attendanceLockHours;
  const parsed = typeof raw === "number" ? raw : Number(raw ?? NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LOCK_HOURS;
}

export async function unlockSessionAction(sessionId: string, pin: string) {
  // Implements: 06_Attendance.md §10.6 BR-ATT-07 Tier 2 (PIN/biometric →
  // `attendance_unlock`, 60-minute window), §10.3 phases, §10.8 audit;
  // 03_User_Flows.md §4.3 Flow 11; 10_Security.md §4 (PIN-gated sensitive
  // mutation); 08_Settings.md BR-SEC-02.
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const now = new Date().toISOString();

    const pinGate = await requireUnlockPin(db, tenantId, pin);
    if (!pinGate.success) return pinGate;

    const session = await db.attendanceSession.findFirst({
      where: { id: sessionId, tenantId },
    });
    if (!session) {
      return { success: false, error: "Session not found." };
    }
    const sessionDate = String(session.sessionDate ?? "");
    if (hardLocked(sessionDate, now)) {
      // 06 §10.6 Tier 3: no direct unlock past 30 days — the request flow
      // (`requestHardUnlockAction`) is the only door. The HARD_LOCKED code
      // lets the client route to the request sheet instead of an error toast.
      return {
        success: false,
        error:
          "HARD_LOCKED: This session is more than 30 days old. Direct unlock is disabled — file an unlock request with a reason.",
      };
    }
    const lockHours = await readLockHours(db, tenantId);
    const autoLocked = !session.lockedAt && ageHours(sessionDate, now) > lockHours;
    if (!session.lockedAt && !autoLocked) {
      // Tier 1: nothing to unlock. Say so (Rule 9) instead of writing a
      // meaningless window row.
      return { success: false, error: "Session is not locked." };
    }

    // Unlock changes no data column (`lockedAt` stays set — the window
    // overlays the lock so expiry needs no cron), but Rule 7 still gets its
    // outbox row: the window must replicate cross-device, and the audit row
    // alone cannot carry that contract where readers only drain outbox. The
    // payload is informational (window bounds), never a column write.
    const windowExpiresAt = new Date(new Date(now).getTime() + UNLOCK_WINDOW_MINUTES * 60_000).toISOString();
    await db.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          actor: tenantId,
          refType: "attendance_session",
          refId: sessionId,
          action: "attendance_unlock",
          metadata: JSON.stringify({
            method: "pin",
            window_minutes: UNLOCK_WINDOW_MINUTES,
            window_expires_at: windowExpiresAt,
            was_locked: Boolean(session.lockedAt),
            auto_locked: autoLocked,
          }),
          createdAt: now,
        },
      });
      await tx.syncOutbox.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          tableName: "attendance_sessions",
          rowId: sessionId,
          op: "update",
          payload: JSON.stringify({ unlock_window_until: windowExpiresAt }),
          createdAt: now,
        },
      });
    });

    invalidateTenant(tenantId, "attendance:");
    return { success: true, data: { window_expires_at: windowExpiresAt } };
  } catch (error) {
    log.error('unlock_session_action_failed', error instanceof Error ? error.message : String(error), { sessionId });
    return { success: false, error: error instanceof Error ? error.message : "Failed to unlock session" };
  }
}

export async function requestHardUnlockAction(sessionId: string, reason: string, pin: string) {
  // Implements: 06_Attendance.md §10.6 Tier 3 (§10.6 sheet), §10.8
  // (`attendance_hard_unlock_request`); 03 §5.4 request-unlock flow.
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const now = new Date().toISOString();

    const pinGate = await requireUnlockPin(db, tenantId, pin);
    if (!pinGate.success) return pinGate;

    const cleanReason = reason.trim();
    if (cleanReason.length < HARD_UNLOCK_REASON_MIN_LENGTH) {
      return {
        success: false,
        error: `VALIDATION: Tell us why in at least ${HARD_UNLOCK_REASON_MIN_LENGTH} characters.`,
      };
    }
    const session = await db.attendanceSession.findFirst({
      where: { id: sessionId, tenantId },
    });
    if (!session) {
      return { success: false, error: "Session not found." };
    }
    if (!hardLocked(String(session.sessionDate ?? ""), now)) {
      // Tier 2 sessions unlock directly — a request here would be theatre.
      return {
        success: false,
        error: "NOT_HARD_LOCKED: This session is under 30 days old — unlock it directly with your PIN.",
      };
    }

    // Single-user app: the tutor IS the authority, so the audited request
    // opens the 60-minute window immediately (06 §10.6: "System unlocks for 60
    // minutes"). The request row doubles as the window grant — same window
    // mechanics as Tier 2, plus the reason for the double-audit trail.
    const windowExpiresAt = new Date(new Date(now).getTime() + UNLOCK_WINDOW_MINUTES * 60_000).toISOString();
    await db.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          actor: tenantId,
          refType: "attendance_session",
          refId: sessionId,
          action: "attendance_hard_unlock_request",
          metadata: JSON.stringify({
            reason: cleanReason,
            method: "pin",
            window_minutes: UNLOCK_WINDOW_MINUTES,
            window_expires_at: windowExpiresAt,
          }),
          createdAt: now,
        },
      });
      await tx.syncOutbox.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          tableName: "attendance_sessions",
          rowId: sessionId,
          op: "update",
          payload: JSON.stringify({ unlock_window_until: windowExpiresAt }),
          createdAt: now,
        },
      });
    });

    invalidateTenant(tenantId, "attendance:");
    return { success: true, data: { window_expires_at: windowExpiresAt } };
  } catch (error) {
    log.error('request_hard_unlock_action_failed', error instanceof Error ? error.message : String(error), { sessionId });
    return { success: false, error: error instanceof Error ? error.message : "Failed to request unlock" };
  }
}

export async function relockSessionAction(sessionId: string, reason = "app_backgrounded") {
  // Implements: 06 §10.6 Tier 2 ("re-lock on backgrounding") + §10.8
  // (`attendance_relock`). Safe direction (removes rights), so no PIN —
  // BR-SEC-02 gates privilege GRANTS, not revocations. Idempotent and
  // honest: reports whether a window was actually open.
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const now = new Date().toISOString();
    const window = await readUnlockWindow(db, tenantId, sessionId, now);
    if (!window.open) {
      return { success: true, relocked: false as const };
    }
    await db.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          actor: tenantId,
          refType: "attendance_session",
          refId: sessionId,
          action: "attendance_relock",
          metadata: JSON.stringify({ reason }),
          createdAt: now,
        },
      });
      await tx.syncOutbox.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          tableName: "attendance_sessions",
          rowId: sessionId,
          op: "update",
          payload: JSON.stringify({ relocked_at: now, reason }),
          createdAt: now,
        },
      });
    });
    invalidateTenant(tenantId, "attendance:");
    return { success: true, relocked: true as const };
  } catch (error) {
    log.error('relock_session_action_failed', error instanceof Error ? error.message : String(error), { sessionId });
    return { success: false, error: error instanceof Error ? error.message : "Failed to re-lock session" };
  }
}
