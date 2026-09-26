"use server";

import { Student } from "@buddysaradhi/shared";
import { getAuthenticatedDb, createLibsqlProxy, getAuthenticatedPrisma, gatewayDelete, gatewayPost } from "@/server/get-db";
import { StudentFilters, SortCol } from "@/types/students";
import { revalidatePath } from "next/cache";
import { getStudents as getStudentsQuery, getStudent as getStudentQuery } from "../queries/students";
import { log } from "@/lib/logger";
import { z } from "zod";

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
    const { client, tenantId } = await getAuthenticatedDb();
    const proxy = createLibsqlProxy(client);

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

    await proxy.student.create({ data: studentData });

    // Rule 7 (AGENTS.md §2) / BR-SYN-01: the mutation is followed in the same
    // logical transaction by its sync_outbox row (replication) and its
    // audit_log row (BR-SEC-03) — the audit row was missing here before.
    // Pattern: actions/settings.ts:152-167.
    const now = new Date().toISOString();
    await client.batch(
      [
        {
          sql: `INSERT INTO sync_outbox (id, tenant_id, table_name, row_id, op, payload, created_at) VALUES (?, ?, 'students', ?, 'insert', ?, ?)`,
          args: [crypto.randomUUID(), tenantId, id, JSON.stringify(payload), now],
        },
        {
          sql: `INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at) VALUES (?, ?, ?, 'student.create', 'student', ?, ?, ?)`,
          args: [crypto.randomUUID(), tenantId, tenantId, id, JSON.stringify({ code, base_fee_paise: baseFeePaise }), now],
        },
      ],
      "write",
    );

    if (batchName) {
      let batch = await proxy.batch.findFirst({ where: { tenantId, name: batchName } });
      if (!batch) {
        batch = await proxy.batch.create({
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
      await proxy.studentEnrollment.create({
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
