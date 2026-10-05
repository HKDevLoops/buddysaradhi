import type { DB } from "../lib/db.ts";
import type { SqlHandle } from "../lib/sql.ts";
import { ok, fail, failZod, failValidation } from "../lib/errors.ts";
import { logInfo, logError } from "../lib/log.ts";
import { getCached, setCache, invalidateTenant, REFERENCE_TTL_MS } from "../lib/cache.ts";
import { withWriteTransaction } from "../lib/tx.ts";
import {
  idempotencyRoute,
  okEnvelope,
  replayIfDuplicate,
  requireIdempotencyKey,
  storeIdempotentResponse,
} from "../lib/idempotency.ts";
import { CasConflictError, casConflictResponse, readCasBase } from "../lib/cas.ts";
import { encodeOutboxPayload } from "../lib/vendor/outboxPayload.ts";
import { z } from "zod";

export type RouteHandler = (
  req: Request,
  db: DB,
  tenantId: string,
  path: string,
  method: string,
  url: URL,
  logCtx: Record<string, unknown>,
) => Promise<Response | null> | Response | null;

import { createPrismaOrm } from "../lib/orm.ts";

// Implements: 12_Business_Rules.md BR-SYN-01 (outbox row in the same logical
// transaction as the mutation) + BR-SEC-03 (audit row) — Rule 7 in AGENTS.md.
// Audit 2026-09-26: these helpers "swallow failures with console.error — the
// Rule 7 guarantee is best-effort". They now rethrow (fail-closed): a failed
// outbox/audit write aborts the request with 500 (index.ts typed log) instead
// of reporting success for a mutation that will never replicate.
// The handle is `SqlHandle`, not `DB`: ledger routes pass the open write
// transaction so outbox + audit land in the SAME transaction as the mutation
// (Rule 7 / BR-SYN-01 — "no exceptions for small mutations").
export async function recordOutbox(
  db: SqlHandle,
  tenantId: string,
  table: string,
  rowId: string,
  op: string,
  payload: unknown,
): Promise<void> {
  const rawOp = op.toLowerCase();
  const normalizedOp = rawOp === "create" ? "insert" : (rawOp === "delete" ? "soft_delete" : rawOp);
  try {
    const orm = createPrismaOrm(db, tenantId);
    const jsonPayload = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
    await orm.syncOutbox.create({
      data: {
        tableName: table,
        rowId,
        op: normalizedOp,
        payload: jsonPayload,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logError("sync_outbox.write_failed", { tenantId, table, rowId, op: normalizedOp, message });
    throw new Error(`sync_outbox write failed (12_Business_Rules.md BR-SYN-01) for ${table}/${rowId}: ${message}`);
  }
}

export async function recordAudit(
  db: SqlHandle,
  tenantId: string,
  actor: string,
  action: string,
  refType: string | null,
  refId: string | null,
  metadata: unknown,
): Promise<void> {
  try {
    const orm = createPrismaOrm(db, tenantId);
    await orm.auditLog.create({
      data: {
        actor,
        action,
        refType,
        refId,
        metadata,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logError("audit_log.write_failed", { tenantId, action, refType, refId, message });
    throw new Error(`audit_log write failed (10_Security.md BR-SEC-03) for ${action}: ${message}`);
  }
}



// ======================== STUDENTS ========================

// PATCH allowlist (OWASP API5 / audit 2026-09-26 "Gateway students PATCH —
// mass assignment: `data: body` — raw JSON to orm.student.update").
// Mirrors the ALLOWED_SETTINGS_FIELDS block in routes/settings.ts: a client may
// only write the profile fields the product edits (05_Students.md "Edit
// Profile"); z.object() strips everything else, so id, tenantId, createdAt,
// updatedAt (server time), balancePaise (money moves only via ledger flows —
// 12_Business_Rules.md BR-M-01, AGENTS.md Rule 6), dupKey (dedup identity),
// mergedIntoId (merge is a dedicated flow, 05_Students.md E10) and archivedAt
// (server-owned timestamp, 08_Settings.md auto-archive) are never client-writable.
// Enums mirror packages/shared/src/schemas/student.ts:18-20.
const STUDENT_PATCH_SCHEMA = z.object({
  code: z.string().max(64).nullable(),
  first_name: z.string().min(1).max(200),
  firstName: z.string().min(1).max(200),
  last_name: z.string().max(200).nullable(),
  lastName: z.string().max(200).nullable(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dob must be YYYY-MM-DD").nullable(),
  gender: z.enum(["M", "F", "O"]).nullable(),
  phone: z.string().max(32).nullable(),
  email: z.string().max(254).nullable(),
  address: z.string().max(1000).nullable(),
  school: z.string().max(300).nullable(),
  grade: z.string().max(64).nullable(),
  board: z.string().max(64).nullable(),
  admission_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "admission_date must be YYYY-MM-DD"),
  admissionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "admissionDate must be YYYY-MM-DD"),
  status: z.enum(["active", "inactive", "graduated", "archived"]),
  fee_model: z.enum(["postpaid", "prepaid", "mixed"]),
  feeModel: z.enum(["postpaid", "prepaid", "mixed"]),
  base_fee_paise: z.number().int().min(0),
  baseFeePaise: z.number().int().min(0),
  notes: z.string().max(5000).nullable(),
  custom_fields: z.string().max(10000).nullable(),
  customFields: z.string().max(10000).nullable(),
}).partial();


/**
 * Rule 9 (no silent failures): a rejection with a defined HTTP status is
 * carried out of the write transaction as a typed error; anything else keeps
 * propagating to index.ts as a typed 500. Mirrors `LedgerRouteError` in
 * routes/ledger.ts.
 */
class StudentRouteError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "StudentRouteError";
    this.status = status;
  }
}

// ── Roster read contract (GET /api/v1/students) ─────────────────────────
// Implements: 05_Students.md §"Roster" — the roster control a tutor can see must
// be a control the server honours. The web store sends sort (SortCol =
// 'name'|'code'|'balance') plus five filters (apps/web/src/types/students.ts);
// this route either applies each one or rejects it with a typed error naming the
// field. "Accept and drop" is the defect: a filter that silently does nothing is
// worse than no filter, because the tutor believes the list is narrowed.
//
// Sort vocabulary is the CLIENT's, not the column's: `sortCol` is a roster-facing
// name, mapped here to one real `students` column. An unknown value is a 400
// VALIDATION that lists what IS supported — an actionable error, not a silent
// fallback to an unordered result set.
const ROSTER_SORT_COLUMN = {
  name: "firstName",
  code: "code",
  balance: "balancePaise",
  grade: "grade",
  status: "status",
  joined: "admissionDate",
  created: "createdAt",
} as const;

const ROSTER_SORT_COLUMNS = Object.keys(ROSTER_SORT_COLUMN) as [
  keyof typeof ROSTER_SORT_COLUMN,
  ...(keyof typeof ROSTER_SORT_COLUMN)[],
];
const ROSTER_SORT_SCHEMA = z.enum(ROSTER_SORT_COLUMNS);
const ROSTER_DIR_SCHEMA = z.enum(["asc", "desc"]);

const STUDENT_STATUS = ["active", "inactive", "graduated", "archived"] as const;
const STUDENT_STATUS_SCHEMA = z.enum(STUDENT_STATUS);
const STUDENT_FEE_MODEL = ["postpaid", "prepaid", "mixed"] as const;
const STUDENT_FEE_MODEL_SCHEMA = z.enum(STUDENT_FEE_MODEL);

function splitCsv(raw: string | null): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export const handleStudents: RouteHandler = async (
  req,
  db,
  tenantId,
  path,
  method,
  url,
  logCtx,
) => {
  const sp = url.searchParams;
  const orm = createPrismaOrm(db, tenantId);

  // GET /api/v1/students
  if (path === "/api/v1/students" && method === "GET") {
    // ── Parse + validate BEFORE the cache read. An invalid request must never
    // reach (and poison) the cache, and a 400 must not be answered from a cache
    // entry minted before the same validation existed.
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(200, parseInt(sp.get("pageSize") ?? "50", 10) || 50);
    const search = (sp.get("search") ?? "").trim().toLowerCase();
    const from = (page - 1) * pageSize;

    const statusFilter = splitCsv(sp.get("status"));
    for (const s of statusFilter) {
      if (!STUDENT_STATUS_SCHEMA.safeParse(s).success) {
        return failValidation(
          `status=${s} is not a student status. Supported: ${STUDENT_STATUS.join(", ")}.`,
        );
      }
    }

    // feeModels — HONOURED. `students.fee_model` is a real column
    // (lib/schema.ts:98), so this is a plain `IN` on the audited builder.
    const feeModelFilter = splitCsv(sp.get("feeModels"));
    for (const m of feeModelFilter) {
      if (!STUDENT_FEE_MODEL_SCHEMA.safeParse(m).success) {
        return failValidation(
          `feeModels=${m} is not a fee model. Supported: ${STUDENT_FEE_MODEL.join(", ")}.`,
        );
      }
    }

    // balanceRange — HONOURED. All four values are now expressible: `all` (no
    // clause), `zero` (`balance_paise = 0`), and the two that need a range
    // comparison, via the audited builder's fixed operator vocabulary
    // (lib/sql.ts `RANGE_CLAUSE` — `gt`/`gte`/`lt`/`lte`, module literals, never
    // a string from the request).
    const balanceRange = sp.get("balanceRange") ?? "all";
    const BALANCE_RANGE = ["all", "zero", "has_dues", "overdue_only"] as const;
    if (!(BALANCE_RANGE as readonly string[]).includes(balanceRange)) {
      return failValidation(
        `balanceRange=${balanceRange} is not supported. ` +
          `Supported: ${BALANCE_RANGE.join(", ")}.`,
      );
    }

    // admittedInLast — HONOURED. `students.admission_date` is TEXT 'YYYY-MM-DD'
    // (lib/schema.ts:95), which sorts lexicographically, so "admitted since N
    // days ago" is an `admission_date >= ?` range against an ISO date literal.
    const ADMITTED_WINDOWS = ["all", "7d", "30d", "90d", "180d", "365d"] as const;
    const admittedInLast = sp.get("admittedInLast") ?? "all";
    if (!(ADMITTED_WINDOWS as readonly string[]).includes(admittedInLast)) {
      return failValidation(
        `admittedInLast=${admittedInLast} is not supported. ` +
          `Supported: ${ADMITTED_WINDOWS.join(", ")}.`,
      );
    }

    // tagIds — NOT SUPPORTED. The gateway schema has no `student_tags` table at
    // all (lib/schema.ts), and `TableNameSchema` (lib/sql.ts:284-298) does not
    // admit it, so there is nothing to filter on. A rejected request, not an
    // empty result: an empty result would claim the tutor has no tagged students.
    const tagIds = splitCsv(sp.get("tagIds"));
    if (tagIds.length > 0) {
      return failValidation(
        `tagIds is not supported: the gateway schema has no student_tags table. ` +
          `Send tagIds empty until the table ships.`,
      );
    }

    // sortCol / sortDir — HONOURED via the orm allowlist seam (lib/orm.ts).
    const rawSortCol = sp.get("sortCol") ?? "name";
    const rawSortDir = sp.get("sortDir") ?? "asc";
    const sortCol = ROSTER_SORT_SCHEMA.safeParse(rawSortCol);
    if (!sortCol.success) {
      return failValidation(
        `sortCol=${rawSortCol} is not a sortable roster column. ` +
          `Supported: ${ROSTER_SORT_COLUMNS.join(", ")}.`,
      );
    }
    const sortDir = ROSTER_DIR_SCHEMA.safeParse(rawSortDir);
    if (!sortDir.success) {
      return failValidation(
        `sortDir=${rawSortDir} is not a sort direction. Supported: asc, desc.`,
      );
    }
    const orderBy = { [ROSTER_SORT_COLUMN[sortCol.data]]: sortDir.data };

    // batchIds — HONOURED in two audited reads: resolve the batch's enrolled
    // student ids via student_enrollments, then intersect on students.id
    // (`IN` is supported by the builder; an empty list renders `1=0`).
    const batchIds = splitCsv(sp.get("batchIds"));
    let batchStudentIds: string[] | null = null;
    if (batchIds.length > 0) {
      const enrollments = await orm.studentEnrollment.findMany({
        where: { batchId: { in: batchIds } },
      });
      batchStudentIds = [...new Set(enrollments.map((e) => String(e.studentId)))];
    }

    // balanceRange=overdue_only — HONOURED in two audited reads, for the same
    // reason `batchIds` is: "overdue" is a property of an INVOICE
    // (`invoices.due_date < today AND status IN (unpaid, partial, overdue)`,
    // lib/schema.ts:193-212), not of `students`, and the audited builder does not
    // join. So resolve the overdue student ids first, then intersect on
    // `students.id`. Defining `overdue_only` as "has_dues" instead would be the
    // accept-and-drop defect: the tutor narrows to "owes money" and believes
    // they narrowed to "owes money AND the due date has passed".
    const today = new Date().toISOString().slice(0, 10);
    let overdueStudentIds: string[] | null = null;
    if (balanceRange === "overdue_only") {
      const overdue = await orm.invoice.findMany({
        where: { dueDate: { lt: today }, status: { in: ["unpaid", "partial", "overdue"] } },
      });
      overdueStudentIds = [...new Set(overdue.map((i) => String(i.studentId)))];
    }

    // admittedInLast=Nd — the ISO date the window opens on. TEXT 'YYYY-MM-DD'
    // compares lexicographically, so `>=` is a correct date comparison and no
    // date math happens in SQL.
    const ADMITTED_DAYS: Record<string, number> = {
      "7d": 7, "30d": 30, "90d": 90, "180d": 180, "365d": 365,
    };
    const admittedDays = ADMITTED_DAYS[admittedInLast];
    const admissionCutoff = admittedDays === undefined
      ? null
      : new Date(Date.now() - admittedDays * 86_400_000).toISOString().slice(0, 10);

    // ── Cache key: every input that changes the result set. The previous key
    // (page + search + status only) served a cached 50-row page to a client that
    // asked for 100, and served one sort's rows to a client that asked for
    // another — a data-correctness bug, not a performance one. Labelled,
    // pipe-delimited components so a `search` containing the separator cannot
    // collide with a different request.
    const cacheKey = [
      "students",
      tenantId,
      `page=${page}`,
      `pageSize=${pageSize}`,
      `search=${search}`,
      `status=${statusFilter.join("|")}`,
      `feeModels=${feeModelFilter.join("|")}`,
      `batchIds=${batchIds.join("|")}`,
      `balanceRange=${balanceRange}`,
      `admittedInLast=${admittedInLast}`,
      `overdueIds=${overdueStudentIds === null ? "" : [...overdueStudentIds].sort().join("|")}`,
      `sort=${sortCol.data}:${sortDir.data}`,
    ].join("::");

    const cached = getCached<{ students: unknown[]; total: number }>(cacheKey);
    if (cached) return ok(cached);

    const where: Record<string, unknown> = {};
    if (statusFilter.length > 0) where.status = { in: statusFilter };
    if (feeModelFilter.length > 0) where.feeModel = { in: feeModelFilter };
    if (balanceRange === "zero") where.balancePaise = 0;
    if (balanceRange === "has_dues") where.balancePaise = { gt: 0 };
    if (admissionCutoff !== null) where.admissionDate = { gte: admissionCutoff };

    // `batchIds` and `overdue_only` BOTH narrow on `students.id`. They must
    // intersect, not overwrite: assigning the second one would silently discard
    // the first, and a tutor filtering by batch AND overdue would get the whole
    // batch. An empty intersection is a legitimate empty result, so the empty
    // list is preserved (the builder renders it as `1=0`, not "no filter").
    const idFilters: string[][] = [];
    if (batchStudentIds !== null) idFilters.push(batchStudentIds);
    if (overdueStudentIds !== null) idFilters.push(overdueStudentIds);
    if (idFilters.length > 0) {
      where.id = { in: idFilters.reduce((acc, list) => acc.filter((id) => list.includes(id))) };
    }

    // Search is a substring match across three columns and is applied in the
    // route (the builder has no LIKE). When searching we must read the whole
    // filtered set to slice the page; otherwise SQLite does the paging.
    const rawStudents = await orm.student.findMany({
      where,
      orderBy,
      ...(search ? {} : { take: pageSize, skip: from }),
    });

    const filtered = search
      ? rawStudents.filter(
          (s) =>
            (s.firstName && s.firstName.toLowerCase().includes(search)) ||
            (s.lastName && s.lastName.toLowerCase().includes(search)) ||
            (s.code && s.code.toLowerCase().includes(search)),
        )
      : rawStudents;

    const paginated = search ? filtered.slice(from, from + pageSize) : filtered;

    const total = search ? filtered.length : await orm.student.count({ where });

    const students = paginated.map((s) => ({
      id: s.id,
      code: s.code,
      name: `${s.firstName || ""} ${s.lastName || ""}`.trim(),
      grade: s.grade,
      batch: null,
      fee_model: s.feeModel || "postpaid",
      balance_due: s.balancePaise || 0,
      status: s.status || "active",
    }));

    const result = { students, total };
    setCache(cacheKey, result, REFERENCE_TTL_MS);
    return ok(result);
  }

  // GET /api/v1/students/:id
  if (path.startsWith("/api/v1/students/") && path !== "/api/v1/students/" && method === "GET") {
    const id = path.split("/").pop()!;
    const row = await orm.student.findFirst({ where: { id } });
    if (!row) return fail("not_found", 404);
    return ok(row);
  }

  // POST /api/v1/students
  if (path === "/api/v1/students" && method === "POST") {
    // RFC-004 C1 — fail-closed (see routes/ledger.ts payment path).
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const body = await req.json().catch(() => ({}));
    // AGENTS.md §6.1 — Zod before any DB touch (RFC-003 G-FEES strictness
    // parity for all mutating routes): a missing/blank name is typed 400
    // VALIDATION, never an implicit "Unknown".
    const nameParsed = z.object({
      firstName: z.string().trim().min(1, "first name is required").max(200),
    }).safeParse({ firstName: body.first_name ?? body.firstName });
    if (!nameParsed.success) return failZod(nameParsed.error);
    const id = body.id ?? crypto.randomUUID();

    // Rule 7 / BR-SYN-01 — student + enrollment + outbox + audit commit as
    // ONE write transaction (fail-closed: a thrown outbox/audit write aborts
    // the student insert instead of reporting success for a row that will
    // never replicate).
    const created = await withWriteTransaction(db, async (tx) => {
      const txOrm = createPrismaOrm(tx, tenantId);
      const row = await txOrm.student.create({
        data: {
          id,
          code: body.code ?? null,
          firstName: nameParsed.data.firstName,
          lastName: body.last_name ?? body.lastName ?? null,
          dob: body.dob ?? null,
          gender: body.gender ?? null,
          phone: body.phone ?? null,
          email: body.email ?? null,
          address: body.address ?? null,
          school: body.school ?? null,
          grade: body.grade ?? null,
          board: body.board ?? null,
          admissionDate: body.admission_date ?? body.admissionDate ?? new Date().toISOString().slice(0, 10),
          status: body.status ?? "active",
          feeModel: body.fee_model ?? body.feeModel ?? "postpaid",
          baseFeePaise: body.base_fee_paise ?? body.baseFeePaise ?? 0,
          balancePaise: 0,
          dupKey: body.dup_key ?? body.dupKey ?? body.code ?? id,
          notes: body.notes ?? null,
        },
      });

      const batchName = req.headers.get("X-Batch-Name") || body.batchName || body.batch_name || null;
      if (batchName) {
        let batch = await txOrm.batch.findFirst({ where: { name: batchName } });
        if (!batch) {
          batch = await txOrm.batch.create({ data: { name: batchName, subject: "General" } });
        }
        await txOrm.studentEnrollment.create({
          data: {
            studentId: id,
            batchId: batch.id,
            joinedOn: new Date().toISOString().slice(0, 10),
          },
        });
      }

      // Outbox payload via the canonical shared codec
      // (`packages/shared/src/outboxPayload.ts` — P3-11): the raw client body
      // may use either key spelling; the stored payload is always snake_case
      // with sorted keys.
      await recordOutbox(tx, tenantId, "students", id, "create", encodeOutboxPayload("students", "create", body).payload);
      await recordAudit(tx, tenantId, tenantId, "student.create", "student", id, body);
      // RFC-004 C1 — response bytes commit atomically with the create (see
      // routes/ledger.ts payment path). A concurrent duplicate rolls back
      // here and replays the winner (K2/K3) via the catch below.
      const env = okEnvelope(201, row);
      await storeIdempotentResponse(tx, tenantId, idemRoute, idemKey, env.code, env.body);
      return row;
    });

    // Cache invalidation follows COMMIT: a rolled-back transaction left the
    // rows untouched, so the cached GET is still correct.
    invalidateTenant(tenantId);
    return ok(created, 201);
  }

  // PATCH /api/v1/students/:id
  if (path.startsWith("/api/v1/students/") && path !== "/api/v1/students/" && method === "PATCH") {
    // RFC-004 C1 — fail-closed (see routes/ledger.ts payment path).
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const id = path.split("/").pop()!;
    const body = await req.json().catch(() => ({}));
    // RFC-004 C4 — the CAS base is read from the RAW body, never from the Zod
    // allowlist below (which becomes the DB update).
    const casBase = readCasBase(body);
    if (casBase === "INVALID") {
      return failValidation("base_updated_at must be an ISO timestamp string (RFC-004 C4)");
    }

    const parsed = STUDENT_PATCH_SCHEMA.safeParse(body);
    if (!parsed.success) return failZod(parsed.error);
    const patch = parsed.data;
    if (Object.keys(patch).length === 0) return fail("no_valid_fields", 400);

    // Rule 7 / BR-SYN-01 — the profile update and its outbox+audit rows share
    // one write transaction (fail-closed on any write failure).
    let updated: Record<string, unknown> | null;
    try {
      updated = await withWriteTransaction(db, async (tx) => {
        const txOrm = createPrismaOrm(tx, tenantId);
        // RFC-004 C4 — compare-and-swap on the student profile, read in the
        // SAME transaction that writes (no TOCTOU). Absent base = documented
        // legacy last-write-wins. The row carries no secrets
        // (10_Security.md §1), so it is safe to echo as `server_row` on 409.
        const current = await txOrm.student.findFirst({ where: { id } });
        if (current && casBase && casBase !== String(current.updatedAt ?? "")) {
          throw new CasConflictError(current);
        }
        const row = await txOrm.student.update({
          where: { id },
          data: patch,
        });
        await recordOutbox(tx, tenantId, "students", id, "update", encodeOutboxPayload("students", "update", patch).payload);
        await recordAudit(tx, tenantId, tenantId, "student.edit", "student", id, patch);
        // RFC-004 C1 — response bytes commit atomically with the update.
        const env = okEnvelope(200, row);
        await storeIdempotentResponse(tx, tenantId, idemRoute, idemKey, env.code, env.body);
        return row;
      });
    } catch (err) {
      if (err instanceof CasConflictError) return casConflictResponse(err.serverRow);
      // RFC-004 K2/K3 — concurrent-duplicate race (see routes/ledger.ts).
      const replay = await replayIfDuplicate(db, tenantId, idemRoute, idemKey, err);
      if (replay) return replay;
      throw err;
    }

    invalidateTenant(tenantId);
    return ok(updated);
  }

  // DELETE /api/v1/students/:id
  if (path.startsWith("/api/v1/students/") && path !== "/api/v1/students/" && method === "DELETE") {
    // RFC-004 C1 — fail-closed (see routes/ledger.ts payment path). No CAS:
    // deletes carry no base per RFC-004 C4 (shared MUTABLE rows only).
    const idemKey = requireIdempotencyKey(req);
    if (idemKey instanceof Response) return idemKey;
    const idemRoute = idempotencyRoute(method, path);
    const id = path.split("/").pop()!;

    // Rule 7 / BR-SYN-01 — existence check, cascade deletes, outbox and audit
    // share one write transaction: a failed audit write aborts the delete.
    try {
      await withWriteTransaction(db, async (tx) => {
        const txOrm = createPrismaOrm(tx, tenantId);
        const student = await txOrm.student.findFirst({ where: { id } });
        if (!student) throw new StudentRouteError("not_found", 404);

        // Cascade delete via ORM methods
        await txOrm.studentEnrollment.deleteMany({ where: { studentId: id } });
        await txOrm.student.delete({ where: { id } });

        await recordAudit(tx, tenantId, tenantId, "student.delete", "student", id, {});
        await recordOutbox(tx, tenantId, "students", id, "delete", encodeOutboxPayload("students", "delete", { id }).payload);
        // RFC-004 C1 — response bytes commit atomically with the delete (see
        // routes/ledger.ts payment path). The 404 above aborts WITHOUT
        // storing, so a retry with the same key re-executes.
        const env = okEnvelope(200, { ok: true });
        await storeIdempotentResponse(tx, tenantId, idemRoute, idemKey, env.code, env.body);
      });
    } catch (err) {
      if (err instanceof StudentRouteError) return fail(err.message, err.status);
      // RFC-004 K2/K3 — concurrent-duplicate race (see routes/ledger.ts).
      const replay = await replayIfDuplicate(db, tenantId, idemRoute, idemKey, err);
      if (replay) return replay;
      throw err;
    }

    invalidateTenant(tenantId);
    logInfo("mutation.success", { ...logCtx, tenantId, path, method: "DELETE", studentId: id });
    return ok({ ok: true });
  }

  return null;
};
