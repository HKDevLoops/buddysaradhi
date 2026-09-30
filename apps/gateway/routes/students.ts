import type { DB } from "../lib/db.ts";
import type { SqlHandle } from "../lib/sql.ts";
import { ok, fail, failZod } from "../lib/errors.ts";
import { logInfo, logError } from "../lib/log.ts";
import { getCached, setCache, invalidateTenant } from "../lib/cache.ts";
import { encodeOutboxPayload } from "../../../packages/shared/src/outboxPayload.ts";
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
    const cacheKey = `students:${tenantId}:${sp.get("page") ?? "1"}:${sp.get("search") ?? ""}:${sp.get("status") ?? ""}`;
    const cached = getCached<{ students: unknown[]; total: number }>(cacheKey);
    if (cached) return ok(cached);
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
    const pageSize = Math.min(200, parseInt(sp.get("pageSize") ?? "50", 10));
    const search = (sp.get("search") ?? "").toLowerCase();
    const statusFilter = (sp.get("status") ?? "").split(",").filter(Boolean);
    const from = (page - 1) * pageSize;

    const rawStudents = await orm.student.findMany({
      where: {
        ...(statusFilter.length ? { status: { in: statusFilter } } : {}),
      },
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

    const total = search ? filtered.length : await orm.student.count({
      where: {
        ...(statusFilter.length ? { status: { in: statusFilter } } : {}),
      },
    });

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
    setCache(cacheKey, result);
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
    const body = await req.json().catch(() => ({}));
    if (!body.first_name && !body.firstName) {
      return fail("first_name is required", 400);
    }
    const id = body.id ?? crypto.randomUUID();

    const created = await orm.student.create({
      data: {
        id,
        code: body.code ?? null,
        firstName: body.first_name ?? body.firstName ?? "Unknown",
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
      let batch = await orm.batch.findFirst({ where: { name: batchName } });
      if (!batch) {
        batch = await orm.batch.create({ data: { name: batchName, subject: "General" } });
      }
      await orm.studentEnrollment.create({
        data: {
          studentId: id,
          batchId: batch.id,
          joinedOn: new Date().toISOString().slice(0, 10),
        },
      });
    }

    // Cache is invalidated before the outbox/audit writes so that a fail-closed
    // Rule 7 throw (recordOutbox/recordAudit) never leaves pre-mutation GETs
    // cached after the row has already changed. Outbox payload via the
    // canonical shared codec (`packages/shared/src/outboxPayload.ts` — P3-11):
    // the raw client body may use either key spelling; the stored payload is
    // always snake_case with sorted keys.
    invalidateTenant(tenantId);
    await recordOutbox(db, tenantId, "students", id, "create", encodeOutboxPayload("students", "create", body).payload);
    await recordAudit(db, tenantId, tenantId, "student.create", "student", id, body);
    return ok(created, 201);
  }

  // PATCH /api/v1/students/:id
  if (path.startsWith("/api/v1/students/") && path !== "/api/v1/students/" && method === "PATCH") {
    const id = path.split("/").pop()!;
    const body = await req.json().catch(() => ({}));

    const parsed = STUDENT_PATCH_SCHEMA.safeParse(body);
    if (!parsed.success) return failZod(parsed.error);
    const patch = parsed.data;
    if (Object.keys(patch).length === 0) return fail("no_valid_fields", 400);

    const updated = await orm.student.update({
      where: { id },
      data: patch,
    });

    invalidateTenant(tenantId);
    await recordOutbox(db, tenantId, "students", id, "update", encodeOutboxPayload("students", "update", patch).payload);
    await recordAudit(db, tenantId, tenantId, "student.edit", "student", id, patch);
    return ok(updated);
  }

  // DELETE /api/v1/students/:id
  if (path.startsWith("/api/v1/students/") && path !== "/api/v1/students/" && method === "DELETE") {
    const id = path.split("/").pop()!;

    const student = await orm.student.findFirst({ where: { id } });
    if (!student) return fail("not_found", 404);

    // Cascade delete via ORM methods
    await orm.studentEnrollment.deleteMany({ where: { studentId: id } });
    await orm.student.delete({ where: { id } });

    invalidateTenant(tenantId);
    await recordAudit(db, tenantId, tenantId, "student.delete", "student", id, {});
    await recordOutbox(db, tenantId, "students", id, "delete", encodeOutboxPayload("students", "delete", { id }).payload);

    logInfo("mutation.success", { ...logCtx, tenantId, path, method: "DELETE", studentId: id });
    return ok({ ok: true });
  }

  return null;
};
