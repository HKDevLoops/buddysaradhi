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

export async function recordOutbox(
  db: DB,
  tenantId: string,
  table: string,
  rowId: string,
  op: string,
  payload: unknown,
): Promise<void> {
  try {
    await run(
      db,
      `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
      [
        crypto.randomUUID(),
        tenantId,
        table,
        rowId,
        op,
        JSON.stringify(payload ?? {}),
        new Date().toISOString(),
      ],
    );
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
    await run(
      db,
      `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        tenantId,
        actor,
        action,
        refType,
        refId,
        JSON.stringify(metadata ?? {}),
        new Date().toISOString(),
      ],
    );
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
    const where: string[] = ["s.tenant_id = ?"];
    const args: unknown[] = [tenantId];
    if (search) {
      where.push("(LOWER(s.first_name) LIKE ? OR LOWER(s.last_name) LIKE ? OR s.code LIKE ?)");
      args.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (statusFilter.length) {
      where.push(`s.status IN (${statusFilter.map(() => "?").join(",")})`);
      args.push(...statusFilter);
    }
    const w = where.join(" AND ");
    const data = await allRows(
      db,
      `SELECT s.*, se.batch_id, b.name AS batch_name
       FROM students s
       LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.exited_on IS NULL
       LEFT JOIN batches b ON b.id = se.batch_id
       WHERE ${w}
       ORDER BY s.first_name
       LIMIT ? OFFSET ?`,
      [...args, pageSize, from],
    );
    const cnt = await oneRow(db, `SELECT COUNT(*) AS c FROM students s WHERE ${w}`, args);
    const students = data.map((s) => ({
      id: s.id,
      code: s.code,
      name: studentName(s),
      grade: s.grade,
      batch: s.batch_name ?? null,
      fee_model: s.fee_model,
      balance_due: s.balance_paise,
      status: s.status,
    }));
    const result = { students, total: Number(cnt?.c ?? 0) };
    setCache(cacheKey, result);
    return ok(result);
  }

  // GET /api/v1/students/:id
  if (path.startsWith("/api/v1/students/") && path !== "/api/v1/students/" && method === "GET") {
    const id = path.split("/").pop()!;
    const row = await oneRow(db, "SELECT * FROM students WHERE tenant_id = ? AND id = ?", [
      tenantId,
      id,
    ]);
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
    const now = new Date().toISOString();
    await run(
      db,
      `INSERT INTO students (id, tenant_id, code, first_name, last_name, dob, gender, phone, email,
         address, school, grade, board, admission_date, status, fee_model, base_fee_paise,
         balance_paise, dup_key, notes, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        id,
        tenantId,
        body.code ?? null,
        body.first_name ?? body.firstName ?? "Unknown",
        body.last_name ?? body.lastName ?? null,
        body.dob ?? null,
        body.gender ?? null,
        body.phone ?? null,
        body.email ?? null,
        body.address ?? null,
        body.school ?? null,
        body.grade ?? null,
        body.board ?? null,
        body.admission_date ?? now.slice(0, 10),
        body.status ?? "active",
        body.fee_model ?? "postpaid",
        body.base_fee_paise ?? body.baseFeePaise ?? 0,
        0,
        body.dup_key ?? body.code ?? id,
        body.notes ?? null,
        now,
        now,
      ],
    );
    const batchName = req.headers.get("X-Batch-Name") || body.batchName || body.batch_name || null;
    if (batchName) {
      let batch = await oneRow(db, "SELECT id FROM batches WHERE tenant_id = ? AND name = ?", [
        tenantId,
        batchName,
      ]);
      if (!batch) {
        const bid = crypto.randomUUID();
        await run(
          db,
          "INSERT INTO batches (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          [bid, tenantId, batchName, now, now],
        );
        batch = { id: bid };
      }
      await run(
        db,
        `INSERT INTO student_enrollments (id, tenant_id, student_id, batch_id, joined_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), tenantId, id, batch.id, now.slice(0, 10), now, now],
      );
    }
    await recordOutbox(db, tenantId, "students", id, "create", body);
    await recordAudit(db, tenantId, tenantId, "student.create", "student", id, body);
    invalidateTenant(tenantId);
    const row = await oneRow(db, "SELECT * FROM students WHERE tenant_id = ? AND id = ?", [
      tenantId,
      id,
    ]);
    return ok(row, 201);
  }

  // PATCH /api/v1/students/:id
  if (path.startsWith("/api/v1/students/") && path !== "/api/v1/students/" && method === "PATCH") {
    const id = path.split("/").pop()!;
    const body = await req.json().catch(() => ({}));
    const allowed: Record<string, string> = {
      firstName: "first_name",
      lastName: "last_name",
      code: "code",
      grade: "grade",
      status: "status",
      feeModel: "fee_model",
      phone: "phone",
      email: "email",
      school: "school",
      board: "board",
      notes: "notes",
      address: "address",
      dob: "dob",
      gender: "gender",
    };
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      const col = allowed[k];
      if (!col) continue;
      sets.push(`${col} = ?`);
      args.push(v);
    }
    if (!sets.length) return fail("no_valid_fields", 400);
    sets.push("updated_at = ?");
    args.push(new Date().toISOString(), tenantId, id);
    await run(db, `UPDATE students SET ${sets.join(", ")} WHERE tenant_id = ? AND id = ?`, args);
    await recordOutbox(db, tenantId, "students", id, "update", body);
    invalidateTenant(tenantId);
    const row = await oneRow(db, "SELECT * FROM students WHERE tenant_id = ? AND id = ?", [
      tenantId,
      id,
    ]);
    return ok(row);
  }

  // DELETE /api/v1/students/:id
  if (path.startsWith("/api/v1/students/") && path !== "/api/v1/students/" && method === "DELETE") {
    const id = path.split("/").pop()!;

    const student = await oneRow(db, "SELECT id FROM students WHERE tenant_id = ? AND id = ?", [
      tenantId,
      id,
    ]);
    if (!student) return fail("not_found", 404);

    // Cascade: delete non-financial rows by student_id + tenant_id
    await run(db, "DELETE FROM student_enrollments WHERE tenant_id = ? AND student_id = ?", [
      tenantId,
      id,
    ]);
    await run(db, "DELETE FROM attendance_records WHERE tenant_id = ? AND student_id = ?", [
      tenantId,
      id,
    ]);
    await run(db, "DELETE FROM student_notes WHERE tenant_id = ? AND student_id = ?", [
      tenantId,
      id,
    ]);
    await run(db, "DELETE FROM student_documents WHERE tenant_id = ? AND student_id = ?", [
      tenantId,
      id,
    ]);
    await run(db, "DELETE FROM student_tags WHERE student_id = ?", [id]);

    // Delete attendance sessions that have NO remaining records for this tenant
    // (sessions are tenant-scoped; only remove orphaned ones)
    const orphanSessions = await allRows(
      db,
      `SELECT s.id FROM attendance_sessions s
       WHERE s.tenant_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM attendance_records ar
           WHERE ar.session_id = s.id AND ar.tenant_id = ?
         )`,
      [tenantId, tenantId],
    );
    for (const s of orphanSessions) {
      await run(db, "DELETE FROM attendance_sessions WHERE tenant_id = ? AND id = ?", [
        tenantId,
        s.id,
      ]);
    }

    // Delete the student row
    await run(db, "DELETE FROM students WHERE tenant_id = ? AND id = ?", [tenantId, id]);

    // Financial rows (ledger_entries, receipts) are intentionally preserved

    // Audit
    await recordAudit(db, tenantId, tenantId, "student.delete", "student", id, {});
    // Sync outbox
    await recordOutbox(db, tenantId, "students", id, "delete", { id });

    logInfo("mutation.success", { ...logCtx, tenantId, path, method: "DELETE", studentId: id });
    invalidateTenant(tenantId);
    return ok({ ok: true });
  }

  return null;
};
