import type { Hono } from "hono";
import { ok, fail, getContext } from "../lib/respond";
import { HNSWIndex } from "../../../../reference-implementations/vector-search/hnsw";
import { pseudoEmbed } from "../../../../reference-implementations/vector-search/embedder";
import crypto from "crypto";

const tenantIndexes = new Map<string, HNSWIndex>();

function buildStudentBlob(s: any): string {
  const name = [s.firstName, s.lastName].filter(Boolean).join(" ");
  return `[STUDENT] Name: ${name}. Code: ${s.code || ""}. Grade: ${s.grade || ""}. School: ${s.school || ""}. Notes: ${s.notes || ""}. Phone: ${s.phone || ""}. Email: ${s.email || ""}.`;
}

const SORT_MAP: Record<string, Record<string, "asc" | "desc">> = {
  name: { firstName: "asc" },
  lastName: { lastName: "asc" },
  firstName: { firstName: "asc" },
  grade: { grade: "asc" },
  feeModel: { feeModel: "asc" },
  balance: { balancePaise: "asc" },
  status: { status: "asc" },
  admissionDate: { admissionDate: "asc" },
  code: { code: "asc" },
};

function toStudentListRow(s: any) {
  const batch =
    s.enrollments?.find((e: any) => !e.exitedOn)?.batch?.name ?? null;
  const name = [s.firstName, s.lastName].filter(Boolean).join(" ");
  return {
    id: s.id,
    code: s.code,
    name,
    grade: s.grade,
    batch,
    fee_model: s.feeModel,
    balance_due: s.balancePaise,
    status: s.status,
  };
}

export function registerStudents(app: Hono) {
  app.get("/api/v1/students", async (c) => {
    const { db, tenantId } = getContext(c);
    const q = c.req.query();
    const search = q.search || "";
    const page = Math.max(1, parseInt(q.page || "1", 10) || 1);
    const pageSize = Math.max(1, parseInt(q.pageSize || "20", 10) || 20);
    const status = q.status ? q.status.split(",").filter(Boolean) : [];
    const feeModels = q.feeModels ? q.feeModels.split(",").filter(Boolean) : [];
    const batchIds = q.batchIds ? q.batchIds.split(",").filter(Boolean) : [];
    const tagIds = q.tagIds ? q.tagIds.split(",").filter(Boolean) : [];
    const sortCol = q.sortCol || "lastName";
    const sortDir = q.sortDir === "desc" ? "desc" : "asc";

    let studentIds: string[] = [];
    let isVectorSearch = false;

    if (search) {
      try {
        let index = tenantIndexes.get(tenantId);
        if (!index) {
          index = new HNSWIndex({ M: 16, ef_construction: 200, ef_search: 64 });
          const allStudents = await db.student.findMany({
            where: { tenantId, archivedAt: null },
          });
          for (const s of allStudents) {
            const blob = buildStudentBlob(s);
            const vec = pseudoEmbed(blob);
            index.insert(s.id, vec, { type: "student" });
          }
          tenantIndexes.set(tenantId, index);
        }

        const queryVec = pseudoEmbed(search);
        const hits = index.search(queryVec, pageSize * 3); // overfetch
        studentIds = hits.map((h) => h.id);
        isVectorSearch = true;
      } catch (err) {
        console.error("Vector search error, falling back to SQL:", err);
      }
    }

    const where: any = { tenantId, archivedAt: null };
    if (status.length) where.status = { in: status };
    if (feeModels.length) where.feeModel = { in: feeModels };
    if (search) {
      if (isVectorSearch) {
        where.id = { in: studentIds };
      } else {
        where.OR = [
          { firstName: { contains: search } },
          { lastName: { contains: search } },
          { code: { contains: search } },
        ];
      }
    }
    if (batchIds.length)
      where.enrollments = { some: { batchId: { in: batchIds }, exitedOn: null } };
    if (tagIds.length) where.tags = { some: { tagId: { in: tagIds } } };

    if (q.balanceRange) {
      const [min, max] = q.balanceRange.split("-").map((n) => parseInt(n, 10));
      if (!Number.isNaN(min) && !Number.isNaN(max)) {
        where.balancePaise = { gte: min, lte: max };
      }
    }
    if (q.admittedInLast) {
      const days = parseInt(q.admittedInLast, 10);
      if (!Number.isNaN(days)) {
        const since = new Date(Date.now() - days * 86400000)
          .toISOString()
          .slice(0, 10);
        where.admissionDate = { gte: since };
      }
    }

    const orderBy = { ...(SORT_MAP[sortCol] || { lastName: "asc" }) };
    if (sortDir === "desc") {
      for (const k of Object.keys(orderBy)) orderBy[k] = "desc";
    }

    const total = await db.student.count({ where });
    let students = await db.student.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        enrollments: { where: { exitedOn: null }, include: { batch: true } },
      },
    });

    if (search && isVectorSearch) {
      // Sort retrieved students according to HNSW hit rank order
      const idOrder = new Map(studentIds.map((id, index) => [id, index]));
      students = students.sort((a, b) => {
        const orderA = idOrder.get(a.id) ?? 999999;
        const orderB = idOrder.get(b.id) ?? 999999;
        return orderA - orderB;
      });
    }

    return ok(c, { students: students.map(toStudentListRow), total });
  });

  app.get("/api/v1/students/:id", async (c) => {
    const { db, tenantId } = getContext(c);
    const id = c.req.param("id");
    const student = await db.student.findUnique({ where: { id, tenantId } });
    if (!student) return fail(c, "Student not found", 404);
    return ok(c, student);
  });

  app.post("/api/v1/students", async (c) => {
    const { db, tenantId } = getContext(c);

    // Free tier limit check (60 students)
    const setting = await db.setting.findUnique({ where: { tenantId } });
    const plan = setting?.plan || "free";
    if (plan === "free") {
      const count = await db.student.count({ where: { tenantId, archivedAt: null } });
      if (count >= 60) {
        return fail(c, "Free tier limit of 60 students reached. Upgrade to Premium for unlimited students.", 403);
      }
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = new Date().toISOString();
    const id = (body.id as string) || crypto.randomUUID();
    const dupKey = (body.dup_key as string) || `${tenantId}:${body.first_name}`;

    const student = await db.student.create({
      data: {
        id,
        tenantId,
        code: (body.code as string) ?? null,
        firstName: (body.first_name as string) || "Unknown",
        lastName: (body.last_name as string) ?? null,
        dob: (body.dob as string) ?? null,
        gender: (body.gender as string) ?? null,
        phone: (body.phone as string) ?? null,
        email: (body.email as string) ?? null,
        address: (body.address as string) ?? null,
        school: (body.school as string) ?? null,
        grade: (body.grade as string) ?? null,
        board: (body.board as string) ?? null,
        admissionDate: (body.admission_date as string) || now.slice(0, 10),
        status: (body.status as string) || "active",
        feeModel: (body.fee_model as string) || "postpaid",
        baseFeePaise: ((body.baseFeePaise as number) ?? 0),
        balancePaise: ((body.balancePaise as number) ?? 0),
        dupKey,
        mergedIntoId: null,
        customFields: (body.custom_fields as string) ?? null,
        notes: (body.notes as string) ?? null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });

    // Update in-memory HNSW index if it exists
    const index = tenantIndexes.get(tenantId);
    if (index) {
      try {
        const blob = buildStudentBlob(student);
        const vec = pseudoEmbed(blob);
        index.insert(student.id, vec, { type: "student" });
      } catch (err) {
        console.error("Failed to insert student into HNSW index:", err);
      }
    }

    // Optional enrollment via batch name (web passes X-Batch-Name header)
    const batchName = c.req.header("X-Batch-Name");
    if (batchName) {
      let batch = await db.batch.findFirst({ where: { tenantId, name: batchName } });
      if (!batch) {
        batch = await db.batch.create({
          data: { id: crypto.randomUUID(), tenantId, name: batchName, createdAt: now, updatedAt: now },
        });
      }
      await db.studentEnrollment.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          studentId: id,
          batchId: batch.id,
          joinedOn: now.slice(0, 10),
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    return ok(c, student, 201);
  });
}
