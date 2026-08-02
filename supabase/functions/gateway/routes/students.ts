import type { DB } from "../lib/db.ts";
import { run, oneRow, allRows } from "../lib/db.ts";
import { ok, fail } from "../lib/errors.ts";
import { logInfo } from "../lib/log.ts";
import { getCached, setCache, invalidateTenant } from "../lib/cache.ts";

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

export async function recordOutbox(
  db: DB,
  tenantId: string,
  table: string,
  rowId: string,
  op: string,
  payload: unknown,
): Promise<void> {
  try {
    const orm = createPrismaOrm(db, tenantId);
    await orm.syncOutbox.create({
      data: {
        tableName: table,
        rowId,
        op,
        payload,
      },
    });
  } catch (_e) {
    // sync failure is non-fatal
  }
}

export async function recordAudit(
  db: DB,
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
  } catch (_e) {
    // audit failure is non-fatal
  }
}

function studentName(r: Record<string, unknown>): string {
  return [r.first_name, r.last_name].filter(Boolean).join(" ");
}

// ======================== STUDENTS ========================

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
      take: pageSize,
      skip: from,
    });

    const total = await orm.student.count({
      where: {
        ...(statusFilter.length ? { status: { in: statusFilter } } : {}),
      },
    });

    const filtered = search
      ? rawStudents.filter(
          (s) =>
            (s.firstName && s.firstName.toLowerCase().includes(search)) ||
            (s.lastName && s.lastName.toLowerCase().includes(search)) ||
            (s.code && s.code.toLowerCase().includes(search)),
        )
      : rawStudents;

    const students = filtered.map((s) => ({
      id: s.id,
      code: s.code,
      name: `${s.firstName || ""} ${s.lastName || ""}`.trim(),
      grade: s.grade,
      batch: null,
      fee_model: s.feeModel || "postpaid",
      balance_due: s.balancePaise || 0,
      status: s.status || "active",
    }));

    const result = { students, total: search ? filtered.length : total };
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

    await recordOutbox(db, tenantId, "students", id, "create", body);
    await recordAudit(db, tenantId, tenantId, "student.create", "student", id, body);
    invalidateTenant(tenantId);
    return ok(created, 201);
  }

  // PATCH /api/v1/students/:id
  if (path.startsWith("/api/v1/students/") && path !== "/api/v1/students/" && method === "PATCH") {
    const id = path.split("/").pop()!;
    const body = await req.json().catch(() => ({}));
    
    const updated = await orm.student.update({
      where: { id },
      data: body,
    });

    await recordOutbox(db, tenantId, "students", id, "update", body);
    invalidateTenant(tenantId);
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

    await recordAudit(db, tenantId, tenantId, "student.delete", "student", id, {});
    await recordOutbox(db, tenantId, "students", id, "delete", { id });

    logInfo("mutation.success", { ...logCtx, tenantId, path, method: "DELETE", studentId: id });
    invalidateTenant(tenantId);
    return ok({ ok: true });
  }

  return null;
};
