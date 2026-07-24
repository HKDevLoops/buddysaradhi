/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, prefer-const */
// apps/web/src/app/api/v1/[...slug]/route.ts
// Embedded API Gateway (BFF) for BuddySaradhi.
//
// History: this route originally imported @prisma/client directly. After the
// root-level Prisma upgrade to v7 broke the generated-client artefact for
// `apps/web` (v7 wasm payload missing in bun cache → "Prisma client did not
// initialize yet" at runtime), we shifted this BFF to be a thin pass-through
// to `apps/gateway` (Hono service on port 3001, fully ORM/GraphQL).
//
// Per `17_API_Gateway_System.md` §6 and `18_Microservice_Architecture.md`, the
// gateway is the single source of truth for DB calls; web, mobile, and desktop
// all hit the same edge endpoint via this shared SDK. The local fallback below
// mirrors the original demo/seed behaviour for local dev so the five screens
// still render populated without a running gateway.

import { NextRequest, NextResponse } from "next/server";
import {
  gatewayGet,
  gatewayPost,
  gatewayPatch,
  gatewayDelete,
  getAuthenticatedPrisma,
} from "@/server/get-db";
import { log } from "@/lib/logger";
import {
  ALL_STUDENTS,
  BATCHES,
  DEMO_TENANT,
  getActivityFeed,
  getAttendanceForDate,
  getBatches,
  getDashboardKpis,
  getDueToday,
  getHeatmaps,
  getStudentById,
  getStudentList,
  type Student,
  type StudentListRow,
} from "./fixtures";

const LOCAL_TENANT = DEMO_TENANT;

function ok(data: unknown) {
  return NextResponse.json({ success: true, data });
}

type GatewayResult<T> = { success: true; data: T } | { success: false; error: string };

function unwrap<T>(r: GatewayResult<T>): { ok: boolean; status: number; body: unknown } {
  if (r.success) return { ok: true, status: 200, body: r.data };
  // Map a few common gateway failure shapes to HTTP statuses.
  const msg = (r as { error: string }).error;
  if (msg.startsWith("DB_NOT_PROVISIONED")) return { ok: false, status: 503, body: { success: false, error: msg, needs_provision: true } };
  if (msg.startsWith("SECURITY_VIOLATION")) return { ok: false, status: 401, body: { success: false, error: msg } };
  if (msg.startsWith("Free tier limit")) return { ok: false, status: 403, body: { success: false, error: msg } };
  if (msg.startsWith("Not found")) return { ok: false, status: 404, body: { success: false, error: msg } };
  if (msg.startsWith("Student not found")) return { ok: false, status: 404, body: { success: false, error: msg } };
  // If the gateway returned an error string like "Gateway 502 ..." keep it as 502.
  const m = /^Gateway (\d{3}):/.exec(msg);
  if (m) return { ok: false, status: Number(m[1]) || 500, body: { success: false, error: msg } };
  return { ok: false, status: 500, body: { success: false, error: msg } };
}

async function dispatchGateway(
  req: NextRequest,
  path: string,
  method: string
): Promise<NextResponse> {
  try {
    let r: GatewayResult<unknown>;
    if (method === "GET") {
      const qp = Object.fromEntries(req.nextUrl.searchParams.entries());
      r = await gatewayGet<unknown>(`/api/v1${path}`, qp as Record<string, string>);
    } else if (method === "POST" || method === "PUT" || method === "PATCH") {
      let body: unknown = {};
      try {
        body = await req.clone().json().catch(() => ({}));
      } catch {
        body = {};
      }
      // Forward X-Batch-Name header if present (gateway uses it for enrollment)
      const extra: Record<string, string> = {};
      const xbn = req.headers.get("x-batch-name");
      if (xbn) extra["X-Batch-Name"] = xbn;
      if (method === "POST") r = await gatewayPost<unknown>(`/api/v1${path}`, body, extra);
      else if (method === "PUT") r = await gatewayPost<unknown>(`/api/v1${path}`, body, extra); // gateway has no PUT — bow-tie to POST
      else r = await gatewayPatch<unknown>(`/api/v1${path}`, body);
    } else if (method === "DELETE") {
      r = await gatewayDelete<unknown>(`/api/v1${path}`);
    } else {
      return NextResponse.json(
        { success: false, error: "Method not allowed in BFF" },
        { status: 405 }
      );
    }

    const u = unwrap(r);
    return NextResponse.json(u.body, { status: u.status });
  } catch (err) {
    log.error("gateway_proxy_failed", err instanceof Error ? err.message : String(err), {
      path,
      method,
    });
    return NextResponse.json(
      {
        success: false,
        error: "GATEWAY_UNREACHABLE: apps/gateway on :3001 is offline. Start it with `cd apps/gateway && bun run dev`.",
      },
      { status: 502 }
    );
  }
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

async function handleSettings(db: any, tenantId: string, req: NextRequest, method: string) {
  if (method === "GET") {
    let settings = await db.setting.findUnique({ where: { tenantId } });
    if (!settings) {
      settings = await db.setting.create({
        data: {
          tenantId,
          instituteName: "Jyothi Tutions",
          tenantSecret: crypto.randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      });
    }
    return ok(settings);
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (method === "POST" || method === "PATCH") {
    const settings = await db.setting.upsert({
      where: { tenantId },
      update: { ...body, updatedAt: new Date() },
      create: {
        tenantId,
        instituteName: "Jyothi Tutions",
        tenantSecret: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...body,
      }
    });
    return ok(settings);
  }
  return ok(await db.setting.findUnique({ where: { tenantId } }));
}

async function handleSecurityErase(db: any, tenantId: string) {
    // Rule 7: attack audit_log + delete in one tx; the pre-erase audit row
    // stays because we filter it out of the cascade by id.
    const eraseAuditId = crypto.randomUUID();
    const eraseTs = new Date();
    await db.$transaction([
      db.auditLog.create({
        data: {
          id: eraseAuditId,
          tenantId,
          actor: "tutor",
          action: "secure_erase",
          refType: "tenant",
          refId: tenantId,
          metadata: JSON.stringify({ erasedAt: eraseTs.toISOString() }),
          createdAt: eraseTs,
        },
      }),
      db.attendanceRecord.deleteMany({ where: { tenantId } }),
      db.attendanceSession.deleteMany({ where: { tenantId } }),
      db.ledgerEntry.deleteMany({ where: { tenantId } }),
      db.invoice.deleteMany({ where: { tenantId } }),
      db.receipt.deleteMany({ where: { tenantId } }),
      db.studentEnrollment.deleteMany({ where: { tenantId } }),
      db.student.deleteMany({ where: { tenantId } }),
      db.batch.deleteMany({ where: { tenantId } }),
      db.setting.deleteMany({ where: { tenantId } }),
      db.auditLog.deleteMany({ where: { tenantId, id: { not: eraseAuditId } } }),
      db.syncOutbox.deleteMany({ where: { tenantId } }),
    ]);
    return NextResponse.json({ success: true, erased: tenantId, auditLogId: eraseAuditId });
  }

async function ensureSeeded(db: any, tenantId: string) {
  const count = await db.student.count({ where: { tenantId } });
  if (count > 0) return;

  // 1. Seed setting
  let settings = await db.setting.findUnique({ where: { tenantId } });
  if (!settings) {
    await db.setting.create({
      data: {
        tenantId,
        instituteName: "Jyothi Tutions",
        tenantSecret: "secret-" + crypto.randomUUID().slice(0, 8),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    });
  }

  // 2. Seed tutor
  let tutor = await db.tutor.findFirst({ where: { tenantId } });
  if (!tutor) {
    tutor = await db.tutor.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        name: "Demo Tutor",
        email: "tutor@example.com",
        isActive: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    });
  }

  // 3. Seed batches
  const batches = [
    { id: "b-morning", name: "Morning Batch", subject: "Mathematics" },
    { id: "b-evening", name: "Evening Batch", subject: "Science" },
    { id: "all", name: "All Batches", subject: "General" }
  ];
  for (const b of batches) {
    let existing = await db.batch.findUnique({ where: { id: b.id } });
    if (!existing) {
      await db.batch.create({
        data: {
          id: b.id,
          tenantId,
          tutorId: tutor.id,
          name: b.name,
          subject: b.subject,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      });
    }
  }

  // 4. Seed students
  const rawStudents = [
    { id: "11111111-1111-1111-1111-111111111101", code: "S-001", first: "Aarav", last: "Sharma", grade: "10", batch: "Morning Batch", fee_model: "prepaid", balance: 0, status: "active", gender: "M", phone: "+91 98765 11001", admitted: "2024-04-02" },
    { id: "11111111-1111-1111-1111-111111111102", code: "S-002", first: "Diya", last: "Patel", grade: "10", batch: "Morning Batch", fee_model: "postpaid", balance: 45000, status: "active", gender: "F", phone: "+91 98765 11002", admitted: "2024-04-05" },
    { id: "11111111-1111-1111-1111-111111111103", code: "S-003", first: "Vivaan", last: "Reddy", grade: "9", batch: "Evening Batch", fee_model: "mixed", balance: 120000, status: "active", gender: "M", phone: "+91 98765 11003", admitted: "2024-04-08" },
    { id: "11111111-1111-1111-1111-111111111104", code: "S-004", first: "Ananya", last: "Iyer", grade: "11", batch: "Morning Batch", fee_model: "prepaid", balance: 0, status: "active", gender: "F", phone: "+91 98765 11004", admitted: "2024-04-10" },
    { id: "11111111-1111-1111-1111-111111111105", code: "S-005", first: "Kabir", last: "Singh", grade: "9", batch: "Evening Batch", fee_model: "postpaid", balance: 75000, status: "active", gender: "M", phone: "+91 98765 11005", admitted: "2024-04-12" },
    { id: "11111111-1111-1111-1111-111111111106", code: "S-006", first: "Isha", last: "Khan", grade: "10", batch: "Morning Batch", fee_model: "prepaid", balance: 0, status: "active", gender: "F", phone: "+91 98765 11006", admitted: "2024-04-15" },
    { id: "11111111-1111-1111-1111-111111111107", code: "S-007", first: "Arjun", last: "Nair", grade: "12", batch: "Evening Batch", fee_model: "mixed", balance: 200000, status: "active", gender: "M", phone: "+91 98765 11007", admitted: "2024-04-18" },
    { id: "11111111-1111-1111-1111-111111111108", code: "S-008", first: "Myra", last: "Gupta", grade: "8", batch: "Morning Batch", fee_model: "prepaid", balance: 0, status: "active", gender: "F", phone: "+91 98765 11008", admitted: "2024-04-20" },
    { id: "11111111-1111-1111-1111-111111111109", code: "S-009", first: "Rohan", last: "Mehta", grade: "9", batch: "Evening Batch", fee_model: "postpaid", balance: 30000, status: "inactive", gender: "M", phone: "+91 98765 11009", admitted: "2024-04-22" },
    { id: "11111111-1111-1111-1111-111111111110", code: "S-010", first: "Sara", last: "Jose", grade: "10", batch: "Morning Batch", fee_model: "mixed", balance: 90000, status: "active", gender: "F", phone: "+91 98765 11010", admitted: "2024-04-25" },
    { id: "11111111-1111-1111-1111-111111111111", code: "S-011", first: "Aditya", last: "Das", grade: "11", batch: "Evening Batch", fee_model: "prepaid", balance: 0, status: "active", gender: "M", phone: "+91 98765 11011", admitted: "2024-04-28" },
    { id: "11111111-1111-1111-1111-111111111112", code: "S-012", first: "Kiara", last: "Rao", grade: "8", batch: "Morning Batch", fee_model: "postpaid", balance: 60000, status: "active", gender: "F", phone: "+91 98765 11012", admitted: "2024-05-01" },
    { id: "11111111-1111-1111-1111-111111111113", code: "S-013", first: "Reyansh", last: "Roy", grade: "12", batch: "Evening Batch", fee_model: "prepaid", balance: 0, status: "graduated", gender: "M", phone: "+91 98765 11013", admitted: "2023-05-10" },
    { id: "11111111-1111-1111-1111-111111111114", code: "S-014", first: "Pari", last: "Bhat", grade: "9", batch: "Morning Batch", fee_model: "postpaid", balance: 150000, status: "active", gender: "F", phone: "+91 98765 11014", admitted: "2024-05-05" },
  ];

  for (const s of rawStudents) {
    const batchObj = batches.find((b) => b.name === s.batch) || batches[0];
    await db.student.create({
      data: {
        id: s.id,
        tenantId,
        code: s.code,
        firstName: s.first,
        lastName: s.last,
        dob: "2009-01-01",
        gender: s.gender,
        phone: s.phone,
        email: `${s.first.toLowerCase()}.${s.last.toLowerCase()}@example.com`,
        address: "12 Rose Lane, Bengaluru",
        school: "Delhi Public School",
        grade: s.grade,
        board: "CBSE",
        admissionDate: s.admitted,
        status: s.status,
        feeModel: s.fee_model,
        baseFeePaise: 150000,
        balancePaise: s.balance,
        dupKey: `${s.code}`,
        createdAt: new Date(s.admitted),
        updatedAt: new Date(s.admitted),
      }
    });

    await db.studentEnrollment.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        studentId: s.id,
        batchId: batchObj.id,
        joinedOn: s.admitted,
        createdAt: new Date(s.admitted),
        updatedAt: new Date(s.admitted),
      }
    });
  }
}

async function dispatch(req: NextRequest, slug: string[]) {
  const path = "/" + slug.join("/");
  const method = req.method;
  const qp = Object.fromEntries(req.nextUrl.searchParams.entries());

  const auth = await getAuthenticatedPrisma();
  const db = auth.db;
  const tenantId = auth.tenantId;

  await ensureSeeded(db, tenantId);

  // --- Settings (DB store) ---
  if (path === "/settings") {
    if (method === "GET" || method === "POST" || method === "PATCH") {
      return handleSettings(db, tenantId, req, method);
    }
  }

  // --- Erase ---
  if (path === "/security/erase" && method === "POST") {
    return handleSecurityErase(db, tenantId);
  }

  // --- Students ---
  if (path === "/students" && method === "GET") {
    const whereClause: any = { tenantId, archivedAt: null };
    if (qp.search) {
      const s = qp.search;
      whereClause.OR = [
        { firstName: { contains: s } },
        { lastName: { contains: s } },
        { code: { contains: s } },
      ];
    }
    if (qp.status) {
      whereClause.status = { in: qp.status.split(",") };
    }
    if (qp.feeModels) {
      whereClause.feeModel = { in: qp.feeModels.split(",") };
    }
    const page = Number(qp.page || "1");
    const pageSize = Number(qp.pageSize || "50");
    let sortCol = qp.sortCol || "firstName";
    if (sortCol === "name") sortCol = "firstName";
    if (sortCol === "balance") sortCol = "balancePaise";
    const sortDir = qp.sortDir || "asc";

    const [students, total] = await Promise.all([
      db.student.findMany({
        where: whereClause,
        orderBy: { [sortCol]: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.student.count({ where: whereClause }),
    ]);

    const mapped = students.map((s: any) => ({
      id: s.id,
      code: s.code,
      name: `${s.firstName} ${s.lastName ?? ""}`.trim(),
      grade: s.grade,
      batch: null,
      fee_model: s.feeModel,
      balance_due: s.balancePaise,
      status: s.status,
    }));
    return ok({ students: mapped, total });
  }

  if (path.startsWith("/students/") && method === "GET") {
    const id = slug[slug.length - 1];
    const student = await db.student.findUnique({ where: { id } });
    if (!student) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    return ok({
      ...student,
      first_name: student.firstName,
      last_name: student.lastName,
      admission_date: student.admissionDate,
      baseFeePaise: student.baseFeePaise,
      dup_key: student.dupKey,
    });
  }

  if (path === "/students" && method === "POST") {
    const body = await req.json();
    const id = crypto.randomUUID();

    // Sequence-based student code generation
    let code = body.code || null;
    if (!code) {
      const setting = await db.setting.findUnique({ where: { tenantId } });
      if (setting) {
        const seq = setting.nextStudentSeq || 1;
        code = `ST-${String(seq).padStart(4, "0")}`;
        await db.setting.update({
          where: { tenantId },
          data: { nextStudentSeq: seq + 1 }
        });
      } else {
        code = `ST-${String(Math.floor(1000 + Math.random() * 9000))}`;
      }
    }

    const student = await db.student.create({
      data: {
        id,
        tenantId,
        code,
        firstName: body.first_name || body.firstName || "",
        lastName: body.last_name || body.lastName || "",
        dob: body.dob || null,
        gender: body.gender || null,
        phone: body.phone || null,
        email: body.email || null,
        school: body.school || null,
        grade: body.grade || null,
        board: body.board || null,
        admissionDate: body.admission_date || body.admissionDate || new Date().toISOString().slice(0, 10),
        feeModel: body.fee_model || body.feeModel || "postpaid",
        baseFeePaise: Number(body.baseFeePaise || body.base_fee_paise || 0),
        dupKey: body.dup_key || body.dupKey || `${body.first_name || ""}-${body.phone || ""}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    });

    // Batch enrollment if provided
    const batchName = req.headers.get("x-batch-name");
    if (batchName) {
      let batch = await db.batch.findFirst({
        where: { tenantId, name: batchName }
      });
      if (!batch) {
        batch = await db.batch.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            name: batchName,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        });
      }
      await db.studentEnrollment.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          studentId: id,
          batchId: batch.id,
          joinedOn: student.admissionDate,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      });
    }

    await db.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        actor: "tutor",
        action: "student_create",
        refType: "student",
        refId: id,
        createdAt: new Date(),
      }
    });

    return ok(student);
  }

  // --- Attendance ---
  if (path === "/attendance" && method === "GET") {
    const date = qp.date || new Date().toISOString().slice(0, 10);
    const batchId = qp.batchId || "all";
    
    let session = await db.attendanceSession.findFirst({
      where: { tenantId, sessionDate: date, batchId }
    });
    if (!session) {
      session = await db.attendanceSession.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          batchId,
          sessionDate: date,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      });
    }
    
    const records = await db.attendanceRecord.findMany({
      where: { tenantId, sessionId: session.id }
    });
    
    return ok({ session, records });
  }

  if (path === "/attendance" && method === "POST") {
    const body = await req.json();
    const { sessionId, records } = body;

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ success: false, error: "records must be a non-empty array" }, { status: 400 });
    }

    // Rule 7: many upserts + one audit_log in one tx.
    const auditTs = new Date();
    const auditId = crypto.randomUUID();
    const recordOps = records.map((r: any) =>
      db.attendanceRecord.upsert({
        where: { sessionId_studentId: { sessionId, studentId: r.student_id } },
        update: { status: r.status, updatedAt: auditTs },
        create: {
          id: crypto.randomUUID(),
          tenantId,
          sessionId,
          studentId: r.student_id,
          status: r.status,
          markedAt: auditTs,
          createdAt: auditTs,
          updatedAt: auditTs,
        }
      }),
    );
    const auditOp = db.auditLog.create({
      data: {
        id: auditId,
        tenantId,
        actor: "tutor",
        action: "attendance_mark_session",
        refType: "session",
        refId: sessionId,
        metadata: JSON.stringify({ count: records.length }),
        createdAt: auditTs,
      },
    });
    await db.$transaction([...recordOps, auditOp] as any);
    return ok({ success: true, count: records.length, auditLogId: auditId });
  }

  if (path === "/attendance/batches" && method === "GET") {
    const batches = await db.batch.findMany({ where: { tenantId } });
    return ok(batches);
  }

  // --- Reports & Dashboard ---
  if (path === "/reports/dashboard/kpis" && method === "GET") {
    const active = await db.student.findMany({
      where: { tenantId, status: "active", archivedAt: null }
    });
    const totalStudents = active.length;
    const withDues = active.filter((r: any) => r.balancePaise > 0);
    const studentsWithDues = withDues.length;
    const dueTillDateMinor = active.reduce((sum: number, r: any) => sum + r.balancePaise, 0);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const payments = await db.ledgerEntry.findMany({
      where: {
        tenantId,
        type: "PAYMENT_RECEIVED",
        createdAt: { gte: startOfMonth }
      }
    });
    const collectedThisMonthMinor = payments.reduce((sum: number, p: any) => sum + p.creditPaise, 0);

    return ok({
      totalStudents,
      studentsWithDues,
      collectedThisMonthMinor,
      dueTillDateMinor,
      dueForMonthMinor: 0,
      paymentBreakdown: {
        paid: totalStudents - studentsWithDues,
        partial: studentsWithDues,
        unpaid: 0,
        noDues: totalStudents - studentsWithDues,
      }
    });
  }

  if (path === "/reports/dashboard/feed" && method === "GET") {
    const logs = await db.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: Number(qp.limit || "20")
    });
    return ok(logs.map((l: any) => ({
      id: l.id,
      type: l.action.startsWith("payment") ? "payment" : "audit",
      title: `${l.actor} executed ${l.action}`,
      description: l.metadata || "",
      timestamp: l.createdAt.toISOString(),
    })));
  }

  if (path === "/reports/dashboard/due-today" && method === "GET") {
    const activeWithDues = await db.student.findMany({
      where: { tenantId, status: "active", balancePaise: { gt: 0 } }
    });
    return ok(activeWithDues.map((s: any) => ({
      student_id: s.id,
      student_name: `${s.firstName} ${s.lastName ?? ""}`.trim(),
      due_minor: s.balancePaise,
      invoice_number: `INV-${s.code || ""}`,
      due_date: new Date().toISOString().slice(0, 10),
    })));
  }

  if (path === "/reports/dashboard/heatmaps" && method === "GET") {
    // STUB: deterministic hash, not real attendance/financial rows.
    const periodStartIso = qp.periodStartIso || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const activeStudents = await db.student.findMany({
      where: { tenantId, status: "active", archivedAt: null }
    });

    const start = new Date(periodStartIso);
    const dayMs = 86400000;
    const attendanceRecords: Array<{ student_name: string; date: string; status: "present" | "absent" | "late" }> = [];
    const financialRecords: Array<{ student_name: string; week_start: string; cell_status: "paid" | "partial" | "unpaid"; due_minor: number }> = [];

    // Day-by-day attendance
    for (let w = 0; w < 30; w++) {
      const curDate = new Date(start.getTime() + w * dayMs);
      const dateStr = curDate.toISOString().slice(0, 10);
      const dow = curDate.getUTCDay();
      if (dow === 0) continue;

      for (const stud of activeStudents) {
        const h = hashStr(`${dateStr}:${stud.id}`);
        const mod = h % 12;
        const status = mod === 0 ? "absent" : mod === 1 ? "late" : "present";
        attendanceRecords.push({
          student_name: `${stud.firstName} ${stud.lastName ?? ""}`.trim(),
          date: dateStr,
          status,
        });
      }
    }

    // Week-by-week financial
    const startOfPeriod = new Date(start.getFullYear(), start.getMonth(), 1);
    for (let w = 0; w < 4; w++) {
      const weekDate = new Date(startOfPeriod.getTime() + w * 7 * dayMs);
      const weekStartStr = weekDate.toISOString().slice(0, 10);

      for (const stud of activeStudents) {
        const h = hashStr(`${weekStartStr}:${stud.id}`);
        const cell_status = h % 3 === 0 ? "paid" : h % 3 === 1 ? "partial" : "unpaid";
        financialRecords.push({
          student_name: `${stud.firstName} ${stud.lastName ?? ""}`.trim(),
          week_start: weekStartStr,
          cell_status,
          due_minor: cell_status === "paid" ? 0 : cell_status === "partial" ? 75000 : 150000,
        });
      }
    }

    return ok({
      _data_origin: "STUB",
      attendance: { records: attendanceRecords, holidays: ["2026-07-15", "2026-07-20"] },
      financial: financialRecords,
    });
  }

  // --- Ledger & Fees ---
  if (path === "/ledger/fees" && method === "GET") {
    const search = qp.search || "";
    const students = await db.student.findMany({
      where: {
        tenantId,
        archivedAt: null,
        OR: [
          { firstName: { contains: search } },
          { lastName: { contains: search } },
        ]
      }
    });
    return ok(students.map((s: any) => ({
      id: s.id,
      name: `${s.firstName} ${s.lastName ?? ""}`.trim(),
      code: s.code,
      fee_model: s.feeModel,
      balance_due: s.balancePaise,
    })));
  }

  if (path === "/ledger/invoices" && method === "GET") {
    const studentId = qp.studentId;
    const invoices = await db.invoice.findMany({
      where: { tenantId, studentId }
    });
    return ok(invoices);
  }

  if (path === "/ledger" && method === "GET") {
    const studentId = qp.studentId;
    const entries = await db.ledgerEntry.findMany({
      where: { tenantId, studentId },
      orderBy: { occurredOn: "desc" }
    });
    return ok(entries);
  }

  return NextResponse.json(
    { success: false, error: "Not implemented", path, method },
    { status: 501 }
  );
}

type RouteCtx = { params: Promise<{ slug: string[] }> };

/**
 * Wraps a dispatch call with DB_NOT_PROVISIONED detection.
 * Returns 503 { needs_provision: true } so the client can auto-heal
 * by calling /api/provision and retrying — no user-visible error.
 */
async function safeDispatch(req: NextRequest, slug: string[]): Promise<NextResponse> {
  try {
    return await dispatch(req, slug ?? []);
  } catch (err) {
    const msg = errMsg(err);
    if (msg.startsWith("DB_NOT_PROVISIONED")) {
      log.warn("db_not_provisioned", "Returning 503 needs_provision to client for auto-heal", { path: "/" + slug.join("/") });
      return NextResponse.json(
        { success: false, error: msg, needs_provision: true },
        { status: 503 }
      );
    }
    log.error("gateway_dispatch_error", msg, { path: "/" + slug.join("/") });
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { slug } = await ctx.params;
  return safeDispatch(req, slug ?? []);
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { slug } = await ctx.params;
  return safeDispatch(req, slug ?? []);
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const { slug } = await ctx.params;
  return safeDispatch(req, slug ?? []);
}

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  const { slug } = await ctx.params;
  return safeDispatch(req, slug ?? []);
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const { slug } = await ctx.params;
  return safeDispatch(req, slug ?? []);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown gateway error";
}
