"use server";

import { Student } from "@buddysaradhi/shared";
import { getAuthenticatedPrisma, gatewayDelete, gatewayPatch, gatewayPost } from "@/server/get-db";
import { StudentFilters, SortCol } from "@/types/students";
import { revalidatePath } from "next/cache";
import { getStudents as getStudentsQuery, getStudent as getStudentQuery } from "../queries/students";
import { log } from "@/lib/logger";
import { z } from "zod";
import { invalidateTenant } from "@/server/cache"; // workstream C wiring

export async function fetchStudentsAction(
  filters: StudentFilters,
  searchQuery: string,
  page: number,
  pageSize: number,
  sort: { col: SortCol; dir: 'asc' | 'desc' }
): Promise<{ success: boolean; data?: { students: import("@buddysaradhi/shared").StudentListRow[]; total: number }; error?: string }> {
  try {
    return await getStudentsQuery(filters, searchQuery, page, pageSize, sort);
  } catch (error) {
    log.error('fetch_students_action_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch students" };
  }
}

export async function fetchStudentDetailAction(studentId: string): Promise<{ success: boolean; data?: Student; error?: string }> {
  try {
    const result = await getStudentQuery(studentId);
    if (!result.success) {
      throw new Error(result.error || "Student not found");
    }
    return result;
  } catch (error) {
    log.error('fetch_student_detail_action_failed', error instanceof Error ? error.message : String(error), { studentId });
    throw error;
  }
}

/**
 * W1 (reviews/overhaul-audit-report-2026-09-26.md): the create-student payload
 * used to be read as `data as any`. It is now parsed with Zod before any DB
 * touch (AGENTS.md §6.1 — Zod for all input validation). The schema is
 * module-private because this is a `"use server"` file: Next.js only allows
 * async function exports.
 *
 * Zod's default strip mode drops the UI-only keys the sheet sends
 * (`tenant_id`, `merged_into_id`, `custom_fields`, `notes`, `archived_at`,
 * `created_at`, `updated_at`) instead of failing on them; `.strict()` would
 * reject today's payload (add-student-sheet.tsx:82-106).
 *
 * Money (AGENTS.md §2 Rule 6, 12_Business_Rules.md BR-M-01): every amount is
 * integer paise. `baseFeePaise` / `base_fee_paise` must be integer paise — a
 * float such as 123355.49999999999 from `(1233.555) * 100` is rejected rather
 * than stored. `baseFee` is the exact rupee decimal string instead, converted
 * with integer arithmetic only (see rupeesToPaise below).
 */
const CreateStudentInputSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().regex(/^[A-Za-z0-9-]{1,20}$/, "code may only contain letters, digits and dashes").optional(),
  first_name: z.string().trim().min(1, "first_name is required").max(200),
  last_name: z.string().max(200).nullish(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dob must be YYYY-MM-DD").nullish(),
  gender: z.enum(["M", "F", "O"]).nullish(),
  phone: z.string().max(32).nullish(),
  email: z.string().max(254).nullish(),
  address: z.string().max(1000).nullish(),
  school: z.string().max(300).nullish(),
  grade: z.string().max(64).nullish(),
  board: z.string().max(64).nullish(),
  admission_date: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "admission_date must be a valid date"),
  status: z.enum(["active", "inactive", "graduated", "archived"]).default("active"),
  fee_model: z.enum(["postpaid", "prepaid", "mixed"]).default("postpaid"),
  baseFeePaise: z.number().int().nonnegative("baseFeePaise must be integer paise").optional(),
  base_fee_paise: z.number().int().nonnegative("base_fee_paise must be integer paise").optional(),
  baseFee: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, "baseFee must be a non-negative rupee amount").optional(),
  dup_key: z.string().max(64).optional(),
});

/**
 * BR-M-01: exact rupee decimal string → integer paise using integer math only
 * (BigInt), so no float ever touches a money value. Digits beyond paise are
 * truncated — BR-M-05's half-to-even rounding covers *computed* amounts;
 * sub-paisa input digits carry no value. The schema caps the whole part at 12
 * digits, so the result stays inside Number.MAX_SAFE_INTEGER.
 */
function rupeesToPaise(rupees: string): number {
  const [whole, frac = ""] = rupees.split(".");
  // BigInt() calls (not 100n literals): tsconfig target is ES2017.
  const paise = BigInt(whole) * BigInt(100) + BigInt((frac + "00").slice(0, 2));
  return Number(paise);
}

/**
 * BR-STU-04 display code (05_Students.md §code format: `^[A-Za-z0-9-]{1,20}$`).
 * 8 uppercase hex chars from crypto.getRandomValues — a 4.29e9 space that
 * cannot collide with the old `S-<random 100..999>` (900 values) and needs no
 * DB round-trip, so it is stable across devices. The `STU-<next_seq>` counter
 * (BR-STU-04) is deferred: `settings.next_student_seq` is per-device and would
 * hand out identical codes on two devices.
 */
function generateStudentCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `S-${Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join("")}`;
}

export async function createStudent(data: unknown, batchName?: string): Promise<{ success: boolean; data?: Student; error?: string }> {
  // RFC-004 C4: POST inserts mint fresh UUID PKs — two devices creating
  // "the same" student produce two rows (deduped later via `dup_key`,
  // BR-STU-03), never a lost update. Inserts cannot conflict, so no CAS base
  // is needed here. CAS applies to PATCH (updateStudentAction below), where a
  // stale base could silently overwrite another device's edit.
  try {
    const parsed = CreateStudentInputSchema.safeParse(data);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      log.error("create_student_invalid_input", detail);
      return { success: false, error: `Invalid student data — ${detail}` };
    }
    const s = parsed.data;

    // IDs: `id` stays a client-supplied UUID when present (prisma/schema.prisma
    // model Student — `id String @id`, written as crypto.randomUUID()), and the
    // human-facing `code` is generated server-side below. The UUIDv4-vs-UUIDv7
    // drift noted by the audit lives in packages/core (out of this slice).
    const id = s.id ?? crypto.randomUUID();
    const code = s.code ?? generateStudentCode();
    const validAdmissionDate = new Date(s.admission_date).toISOString().slice(0, 10);
    const baseFeePaise =
      s.baseFeePaise ?? s.base_fee_paise ?? (s.baseFee !== undefined ? rupeesToPaise(s.baseFee) : 0);

    const payload = {
      id,
      code,
      first_name: s.first_name,
      last_name: s.last_name || null,
      dob: s.dob || null,
      gender: s.gender || null,
      phone: s.phone || null,
      email: s.email || null,
      address: s.address || null,
      school: s.school || null,
      grade: s.grade || null,
      board: s.board || null,
      admission_date: validAdmissionDate,
      status: s.status,
      fee_model: s.fee_model,
      base_fee_paise: baseFeePaise,
      dup_key: s.dup_key ?? code,
      batchName: batchName || null,
    };

    // 1. Try canonical Gateway first
    const gatewayRes = await gatewayPost<Student>(
      "/api/v1/students",
      payload,
      batchName ? { "X-Batch-Name": batchName } : undefined
    );

    if (gatewayRes.success) {
      revalidatePath("/students");
      revalidatePath("/dashboard");
      return { success: true, data: gatewayRes.data };
    }

    // 2. Local fallback if Gateway is unreachable (Offline-first per Rule 7)
    const { db, tenantId } = await getAuthenticatedPrisma();

    const studentData = {
      id,
      tenantId,
      code,
      firstName: payload.first_name,
      lastName: payload.last_name || "",
      status: payload.status,
      feeModel: payload.fee_model,
      baseFeePaise: payload.base_fee_paise,
      balancePaise: 0,
      dupKey: payload.dup_key,
      admissionDate: validAdmissionDate,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Rule 7 (AGENTS.md §2) / BR-SYN-01: the mutation, its sync_outbox row
    // (replication) and its audit_log row (BR-SEC-03) land in ONE write
    // transaction — CHECK-valid op 'insert', action 'student.create', same
    // payload as before. Pattern: actions/settings.ts.
    const now = new Date().toISOString();
    await db.$transaction(async (tx) => {
      await tx.student.create({ data: studentData });
      await tx.syncOutbox.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          tableName: "students",
          rowId: id,
          op: "insert",
          payload: JSON.stringify(payload),
          createdAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          actor: tenantId,
          action: "student.create",
          refType: "student",
          refId: id,
          metadata: JSON.stringify({ code, base_fee_paise: baseFeePaise }),
          createdAt: now,
        },
      });
    });

    if (batchName) {
      let batch = await db.batch.findFirst({ where: { tenantId, name: batchName } });
      if (!batch) {
        batch = await db.batch.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            tutorId: null,
            name: batchName,
            subject: "General",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
      await db.studentEnrollment.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          studentId: id,
          batchId: batch.id,
          joinedOn: validAdmissionDate,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      invalidateTenant(tenantId, "attendance:"); // workstream C wiring: batch auto-create
    }

    revalidatePath("/students");
    revalidatePath("/dashboard");
    return { success: true, data: studentData as unknown as Student };
  } catch (err) {
    log.error("create_student_action_failed", err instanceof Error ? err.message : String(err));
    return { success: false, error: err instanceof Error ? err.message : "Failed to create student" };
  }
}

export async function checkDuplicateStudentAction(
  dupKey: string
): Promise<{ isDuplicate: boolean; existingStudentId?: string; error?: string }> {
  try {
    const { db, tenantId } = await getAuthenticatedPrisma();
    const existing = await db.student.findFirst({
      where: { 
        tenantId, 
        dupKey,
        status: { not: 'archived' }
      }
    });

    if (existing) {
      return { isDuplicate: true, existingStudentId: existing.id };
    }
    return { isDuplicate: false };
  } catch (error) {
    log.error('student_duplicate_check_failed', error instanceof Error ? error.message : String(error));
    return { isDuplicate: false, error: error instanceof Error ? error.message : "Failed to check duplicate" };
  }
}

export async function deleteStudentAction(studentId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await gatewayDelete<{ ok: boolean }>(`/api/v1/students/${encodeURIComponent(studentId)}`);
    if (!res.success) {
      log.error('student_delete_failed', 'Gateway delete returned failure', { studentId });
      return { success: false, error: res.error };
    }
    revalidatePath("/students");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    log.error('student_delete_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: error instanceof Error ? error.message : "Failed to delete student" };
  }
}

// ---------------------------------------------------------------------------
// RFC-004 C4 compare-and-swap for the student profile PATCH path.
// Implements: docs/rfc/004-multi-device-network-contract.md C4 + K4;
// 12_Business_Rules.md BR-SYN-03 (LWW on `updated_at` for non-ledger rows);
// 05_Students.md E20 (concurrent edits — the loser must not silently win).
// Same defensive contract as the settings PATCH paths: an optional
// `base_updated_at`; a stale base returns a typed CONFLICT + the fresh server
// row with NO write and NO outbox/audit row (nothing happened — boundary
// logged via `log.warn` for forensics); a fresh base writes + outbox + audit
// as today. `base_updated_at` is forwarded to the gateway for the parallel
// server-side CAS workstream (its Zod schema strips unknown keys until CAS
// lands — the pre-check below is the live guard).
// ---------------------------------------------------------------------------

const StudentCasOptionsSchema = z.object({
  base_updated_at: z.string().min(1).optional(),
});

export type StudentCasOptions = z.infer<typeof StudentCasOptionsSchema>;

export interface StudentConflictResult {
  success: false;
  error: string;
  code: "CONFLICT";
  serverRow: Student | null;
}

/**
 * Profile fields a client may PATCH. Unknown keys (id, tenant_id,
 * `updated_at`, balancePaise — money moves only via ledger flows, Rule 6)
 * are stripped by Zod's default strip mode; the CAS base travels via `opts`,
 * never the body. Money spellings mirror CreateStudentInputSchema (integer
 * paise only, Rule 6 / BR-M-01).
 */
const UpdateStudentInputSchema = z.object({
  code: z.string().max(64).nullable(),
  first_name: z.string().trim().min(1).max(200),
  last_name: z.string().max(200).nullable(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dob must be YYYY-MM-DD").nullable(),
  gender: z.enum(["M", "F", "O"]).nullable(),
  phone: z.string().max(32).nullable(),
  email: z.string().max(254).nullable(),
  address: z.string().max(1000).nullable(),
  school: z.string().max(300).nullable(),
  grade: z.string().max(64).nullable(),
  board: z.string().max(64).nullable(),
  admission_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "admission_date must be YYYY-MM-DD"),
  status: z.enum(["active", "inactive", "graduated", "archived"]),
  fee_model: z.enum(["postpaid", "prepaid", "mixed"]),
  baseFeePaise: z.number().int().nonnegative(),
  base_fee_paise: z.number().int().nonnegative(),
  baseFee: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, "baseFee must be a non-negative rupee amount"),
  notes: z.string().max(5000).nullable(),
  custom_fields: z.string().max(10000).nullable(),
}).partial();

/** snake_case body keys → proxy camelCase (proxy converts camel → snake SQL). */
const STUDENT_PATCH_FIELD_MAP: Record<string, string> = {
  first_name: "firstName",
  last_name: "lastName",
  admission_date: "admissionDate",
  fee_model: "feeModel",
  base_fee_paise: "baseFeePaise",
  custom_fields: "customFields",
};

function studentRowMs(value: unknown): number | null {
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  if (value instanceof Date) return value.getTime();
  return null;
}

function isoOrNow(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return new Date().toISOString();
}

function isoOrNull(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}

/** Proxy (camelCase) row → shared `Student` shape (student rows carry no secrets). */
function toStudentRow(row: Record<string, unknown>, tenantId: string): Student {
  const status = row.status;
  const feeModel = row.feeModel;
  const gender = row.gender;
  const code = typeof row.code === "string" ? row.code : null;
  return {
    id: typeof row.id === "string" ? row.id : "",
    tenant_id: tenantId,
    first_name: typeof row.firstName === "string" ? row.firstName : "",
    last_name: typeof row.lastName === "string" ? row.lastName : null,
    code,
    phone: typeof row.phone === "string" ? row.phone : null,
    email: typeof row.email === "string" ? row.email : null,
    address: typeof row.address === "string" ? row.address : null,
    school: typeof row.school === "string" ? row.school : null,
    grade: typeof row.grade === "string" ? row.grade : null,
    board: typeof row.board === "string" ? row.board : null,
    dob: typeof row.dob === "string" ? row.dob : null,
    gender: gender === "M" || gender === "F" || gender === "O" ? gender : null,
    admission_date:
      typeof row.admissionDate === "string" ? row.admissionDate : new Date().toISOString().slice(0, 10),
    status:
      status === "active" || status === "inactive" || status === "graduated" || status === "archived"
        ? status
        : "active",
    fee_model: feeModel === "postpaid" || feeModel === "prepaid" || feeModel === "mixed" ? feeModel : "postpaid",
    baseFeePaise: typeof row.baseFeePaise === "number" ? row.baseFeePaise : 0,
    dup_key: typeof row.dupKey === "string" ? row.dupKey : (code ?? ""),
    merged_into_id: null,
    custom_fields: typeof row.customFields === "string" ? row.customFields : null,
    notes: typeof row.notes === "string" ? row.notes : null,
    archived_at: isoOrNull(row.archivedAt),
    created_at: isoOrNow(row.createdAt),
    updated_at: isoOrNow(row.updatedAt),
  };
}

export async function updateStudentAction(
  studentId: string,
  patch: unknown,
  opts?: StudentCasOptions,
): Promise<{ success: boolean; data?: Student; error?: string; code?: "CONFLICT" | "VALIDATION"; serverRow?: Student | null }> {
  try {
    if (!z.string().uuid().safeParse(studentId).success) {
      return { success: false, error: "Invalid student id", code: "VALIDATION" };
    }
    const parsed = UpdateStudentInputSchema.safeParse(patch);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      log.error("update_student_invalid_input", detail);
      return { success: false, error: `Invalid student data — ${detail}`, code: "VALIDATION" };
    }
    const casParsed = StudentCasOptionsSchema.safeParse(opts ?? {});
    if (!casParsed.success) {
      return { success: false, error: "Invalid CAS options", code: "VALIDATION" };
    }
    const baseRaw = casParsed.data.base_updated_at;
    const baseMs = baseRaw === undefined ? null : Date.parse(baseRaw);
    if (baseMs !== null && Number.isNaN(baseMs)) {
      return { success: false, error: "Invalid base_updated_at — must be an ISO-8601 timestamp", code: "VALIDATION" };
    }

    const p = parsed.data;
    // Canonical camelCase write-map (proxy converts to snake_case SQL).
    // Money precedence mirrors createStudent: explicit paise wins over the
    // rupee string (integer arithmetic only, Rule 6 / BR-M-01).
    const camel: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(p)) {
      if (val === undefined || key === "baseFeePaise" || key === "base_fee_paise" || key === "baseFee") continue;
      camel[STUDENT_PATCH_FIELD_MAP[key] ?? key] = val;
    }
    if (p.baseFeePaise !== undefined) camel.baseFeePaise = p.baseFeePaise;
    else if (p.base_fee_paise !== undefined) camel.baseFeePaise = p.base_fee_paise;
    else if (p.baseFee !== undefined) camel.baseFeePaise = rupeesToPaise(p.baseFee);
    if (Object.keys(camel).length === 0) {
      return { success: false, error: "No valid student fields", code: "VALIDATION" };
    }
    // snake_case body for the gateway (it accepts both spellings).
    const snake: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(p)) {
      if (val !== undefined) snake[key] = val;
    }

    // Defensive pre-check (gateway CAS pending): re-read inside the action.
    // Stale base → typed CONFLICT; the writes below never run.
    const { db, tenantId } = await getAuthenticatedPrisma();
    const current = await db.student.findFirst({ where: { tenantId, id: studentId } });
    if (!current) {
      return { success: false, error: "Student not found" };
    }
    if (baseMs !== null) {
      const currentMs = studentRowMs(current.updatedAt ?? current.updated_at);
      if (currentMs !== null && currentMs !== baseMs) {
        log.warn("cas_conflict_student", "Student CAS mismatch — rejected stale write");
        return {
          success: false,
          error: "CONFLICT: student changed elsewhere",
          code: "CONFLICT",
          serverRow: toStudentRow(current, tenantId),
        };
      }
    }

    const gatewayBody =
      baseRaw !== undefined ? { ...snake, base_updated_at: baseRaw } : snake;
    const gatewayRes = await gatewayPatch<Student>(
      `/api/v1/students/${encodeURIComponent(studentId)}`,
      gatewayBody,
    );
    if (gatewayRes.success) {
      revalidatePath("/students");
      revalidatePath("/dashboard");
      return { success: true, data: gatewayRes.data };
    }

    // Server-side CAS won a race after our pre-check: surface its 409 with a
    // fresh row; nothing is written locally.
    if (/Gateway 409\b/.test(gatewayRes.error)) {
      const fresh = await db.student.findFirst({ where: { tenantId, id: studentId } });
      log.warn("cas_conflict_student", "Student CAS mismatch — gateway 409");
      return {
        success: false,
        error: "CONFLICT: student changed elsewhere",
        code: "CONFLICT",
        serverRow: fresh ? toStudentRow(fresh, tenantId) : null,
      };
    }

    // Local fallback (offline-first, Rule 7): update + outbox + audit in one
    // transaction — CHECK-valid op 'update', action 'student.edit', same
    // payload as before.
    log.warn("update_student_gateway_failed_using_direct_db", gatewayRes.error);
    const now = new Date().toISOString();
    // Rule 7: the UPDATE, its sync_outbox row and its audit_log row share ONE
    // write transaction. `updateMany` (not `update`) so a 0-row write is
    // visible — the student row is proved to exist inside the transaction
    // (F5: no phantom writes).
    // Stamp `updated_at`: the ORM surface does not auto-bump it on this path,
    // so without this the CAS base would never advance.
    await db.$transaction(async (tx) => {
      const updated = await tx.student.updateMany({
        where: { tenantId, id: studentId },
        data: { ...camel, updatedAt: now },
      });
      if (updated.count === 0) {
        throw new Error(`STUDENT_NOT_FOUND: no student ${studentId} in tenant ${tenantId}`);
      }
      await tx.syncOutbox.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          tableName: "students",
          rowId: studentId,
          op: "update",
          payload: JSON.stringify(snake),
          createdAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          actor: tenantId,
          action: "student.edit",
          refType: "student",
          refId: studentId,
          metadata: JSON.stringify({ fields: Object.keys(camel) }),
          createdAt: now,
        },
      });
    });

    revalidatePath("/students");
    revalidatePath("/dashboard");
    const updated = await db.student.findFirst({ where: { tenantId, id: studentId } });
    return { success: true, data: updated ? toStudentRow(updated, tenantId) : undefined };
  } catch (error) {
    log.error("update_student_action_failed", error instanceof Error ? error.message : String(error));
    return { success: false, error: error instanceof Error ? error.message : "Failed to update student" };
  }
}
