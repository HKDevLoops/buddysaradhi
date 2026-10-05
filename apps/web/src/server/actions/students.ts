"use server";

import { Student } from "@buddysaradhi/shared";
import { getAuthenticatedPrisma, gatewayDelete, gatewayPatch, gatewayPost } from "@/server/get-db";
import { StudentFilters, SortCol } from "@/types/students";
import { revalidatePath } from "next/cache";
import { getStudents as getStudentsQuery, getStudent as getStudentQuery } from "../queries/students";
import { log } from "@/lib/logger";
import { z } from "zod";
import { invalidateTenant } from "@/server/cache"; // workstream C wiring
import { mintIntentKey } from "@/lib/intent-key";
import {
  STUDENT_ADDRESS_MAX,
  STUDENT_ADMISSION_FLOOR_ISO,
  STUDENT_BATCH_MAX,
  STUDENT_BOARD_MAX,
  STUDENT_DOB_FLOOR_ISO,
  STUDENT_FIRST_NAME_MAX,
  STUDENT_GRADE_MAX,
  STUDENT_LAST_NAME_MAX,
  STUDENT_SCHOOL_MAX,
  checkDateBounds,
  normalizeStudentPhone,
  studentDupKey,
  todayIso,
} from "@/lib/csv-parse";

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
  first_name: z
    .string()
    .trim()
    .min(1, "first_name is required")
    .max(STUDENT_FIRST_NAME_MAX, `first_name must be ${STUDENT_FIRST_NAME_MAX} characters or fewer`),
  last_name: z
    .string()
    .trim()
    .max(STUDENT_LAST_NAME_MAX, `last_name must be ${STUDENT_LAST_NAME_MAX} characters or fewer`)
    .nullish(),
  dob: boundedIsoDate("dob", STUDENT_DOB_FLOOR_ISO, false),
  gender: z.enum(["M", "F", "O"]).nullish(),
  phone: z.preprocess(
    (value: unknown) => (value === null || value === undefined ? null : value),
    z
      .string()
      .transform((value, ctx) => {
        const parsed = normalizeStudentPhone(value, "phone");
        if (!parsed.ok) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.reason });
          return z.NEVER;
        }
        return parsed.phone;
      })
      .nullish(),
  ),
  email: z.string().max(254).nullish(),
  address: z
    .string()
    .trim()
    .max(STUDENT_ADDRESS_MAX, `address must be ${STUDENT_ADDRESS_MAX} characters or fewer`)
    .nullish(),
  school: z
    .string()
    .trim()
    .max(STUDENT_SCHOOL_MAX, `school must be ${STUDENT_SCHOOL_MAX} characters or fewer`)
    .nullish(),
  grade: z
    .string()
    .trim()
    .max(STUDENT_GRADE_MAX, `grade must be ${STUDENT_GRADE_MAX} characters or fewer`)
    .nullish(),
  board: z
    .string()
    .trim()
    .max(STUDENT_BOARD_MAX, `board must be ${STUDENT_BOARD_MAX} characters or fewer`)
    .nullish(),
  admission_date: boundedIsoDate("admission_date", STUDENT_ADMISSION_FLOOR_ISO, false),
  status: z.enum(["active", "inactive", "graduated", "archived"]).default("active"),
  fee_model: z.enum(["postpaid", "prepaid", "mixed"]).default("postpaid"),
  baseFeePaise: z.number().int().nonnegative("baseFeePaise must be integer paise").optional(),
  base_fee_paise: z.number().int().nonnegative("base_fee_paise must be integer paise").optional(),
  baseFee: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, "baseFee must be a non-negative rupee amount").optional(),
  dup_key: z.string().max(200).optional(),
});

/**
 * 05_Students.md §14: an ISO date inside a window, and nothing later than today
 * (E16 — a dob in the future is a data-entry slip, not a student). `required`
 * marks the one field §14 makes required. The upper bound defaults to today.
 */
function boundedIsoDate(
  field: string,
  min: string,
  required = true,
) {
  return z.preprocess(
    (value: unknown) =>
      typeof value === "string" && value.trim() === "" ? (required ? value : undefined) : value,
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, `${field} must be YYYY-MM-DD`)
      .superRefine((value, ctx) => {
        const window = checkDateBounds(value, { min, label: field });
        if (!window.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: window.reason });
      })
      .nullish(),
  );
}

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
 * BR-STU-04 display code (05_Students.md §14: `^[A-Za-z0-9-]{1,20}$`). 8
 * uppercase hex chars from crypto.getRandomValues — a 4.29e9 space that needs
 * no DB round-trip, so two devices never hand out the same code.
 *
 * KNOWN DIVERGENCE (reported, not silently changed): BR-STU-01 and BR-RC-02 in
 * `12_Business_Rules.md` specify `STU-<YYYY>-<NNNN>` from the per-tenant
 * `settings.next_student_seq` counter, and the earlier comment here claimed that
 * counter was "per-device". It is not — it is one row per tenant, so the
 * counter CAN be used. Doing so needs an atomic take (read + compare-and-set on
 * `next_student_seq`, with a Setting row guaranteed to exist) which is the same
 * numbering machinery as `packages/core/src/engines/invoice.ts`; duplicating it
 * here would be a second dialect of a numbering contract (AGENTS.md §3.5) and
 * could hand out a duplicate code if the take were not atomic. The format is
 * therefore still `S-<8 hex>`: unique per tenant, never reused, but not yet
 * `STU-<YYYY>-<NNNN>`.
 */
function generateStudentCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `S-${Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join("")}`;
}

/** Optional third argument on `createStudent` — the sheet's "add anyway". */
export interface CreateStudentOptions {
  /**
   * True when the tutor was shown the duplicate interstitial (BR-STU-03) and
   * chose to add anyway. It does not change what is written; it adds the
   * `student_duplicate_proceed` audit row that 05_Students.md §15 lists as an
   * audited action originating on this screen.
   */
  duplicateProceed?: boolean;
}

export async function createStudent(
  data: unknown,
  batchName?: string,
  options?: CreateStudentOptions,
): Promise<{ success: boolean; data?: Student; error?: string }> {
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
    // 09 §14.1 default + 05_Students.md §6.1: a blank admission date is TODAY.
    // The import already defaults it (`rowData.admission_date ?? today`) and the
    // sheet pre-fills today, so this is the third read of the same rule — and it
    // must not write `undefined` into a NOT NULL column on the fallback path.
    const validAdmissionDate = s.admission_date ?? todayIso();
    const baseFeePaise =
      s.baseFeePaise ?? s.base_fee_paise ?? (s.baseFee !== undefined ? rupeesToPaise(s.baseFee) : 0);
    const batch = batchName?.trim() ? batchName.trim() : undefined;
    if (batch !== undefined && batch.length > STUDENT_BATCH_MAX) {
      return { success: false, error: `Batch must be ${STUDENT_BATCH_MAX} characters or fewer.` };
    }
    // 09 §14.6 / BR-STU-03 — the duplicate key is computed HERE, server-side,
    // from the same `studentDupKey` the sheet and the import both call. The
    // client-sent value is not trusted: a client that computed it differently
    // (as the sheet used to, slicing the last four characters off the raw phone
    // string) would write a key that can never match, and the same person would
    // be created twice with no warning.
    const dupKey = studentDupKey(s.first_name, s.last_name ?? null, s.phone ?? null);

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
      dup_key: dupKey,
      batchName: batch ?? null,
    };

    // 1. Try canonical Gateway first.
    //
    // RFC-004 C1: every gateway mutation is fail-closed on an `Idempotency-Key`
    // header carrying a UUID. Without it the route answers 400 before touching
    // the database, so this call ALWAYS failed and EVERY create silently fell
    // through to the local fallback below — a fallback that was missing eight
    // of the thirteen profile fields. One key per user intent, minted here so a
    // double-click or a retry cannot create two students (K1/K2).
    const idemKey = mintIntentKey();
    const gatewayRes = await gatewayPost<Student>(
      "/api/v1/students",
      payload,
      {
        "Idempotency-Key": idemKey,
        ...(batch ? { "X-Batch-Name": batch } : {}),
      },
    );

    if (gatewayRes.success) {
      revalidatePath("/students");
      revalidatePath("/dashboard");
      return { success: true, data: gatewayRes.data };
    }

    // 2. Local fallback if Gateway is unreachable (Offline-first per Rule 7).
    //    The fallback is a REAL write of the same thirteen fields, in the same
    //    transaction, with the same outbox and audit rows — otherwise a student
    //    added offline would come back with no phone, no school and no address,
    //    which is the silent data loss Rule 9 exists to prevent.
    const { db, tenantId } = await getAuthenticatedPrisma();

    const studentData = {
      id,
      tenantId,
      code,
      firstName: payload.first_name,
      lastName: payload.last_name || "",
      dob: payload.dob,
      gender: payload.gender,
      phone: payload.phone,
      email: payload.email,
      address: payload.address,
      school: payload.school,
      grade: payload.grade,
      board: payload.board,
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
    //
    // The batch auto-create and the enrollment join the SAME transaction now.
    // They used to run after the commit, with no outbox row and no audit row:
    // a student whose enrollment failed to write was replicated to the other
    // device with no batch, and the enrollment itself never reached the outbox
    // (Rule 7 — "no exceptions for small mutations").
    const now = new Date().toISOString();
    let createdBatchName: string | null = null;
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
          metadata: JSON.stringify({
            code,
            base_fee_paise: baseFeePaise,
            duplicate_proceed: options?.duplicateProceed === true,
          }),
          createdAt: now,
        },
      });
      // 05_Students.md §10.1 / §15: "Proceed anyway" is its own audited action,
      // so the pair can always be found afterwards.
      if (options?.duplicateProceed === true) {
        await tx.auditLog.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            actor: tenantId,
            action: "student_duplicate_proceed",
            refType: "student",
            refId: id,
            metadata: JSON.stringify({ dup_key: dupKey }),
            createdAt: now,
          },
        });
      }
      if (batch !== undefined) {
        let batchRow = await tx.batch.findFirst({ where: { tenantId, name: batch } });
        if (!batchRow) {
          batchRow = await tx.batch.create({
            data: {
              id: crypto.randomUUID(),
              tenantId,
              tutorId: null,
              name: batch,
              subject: "General",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
          createdBatchName = batch;
          await tx.syncOutbox.create({
            data: {
              id: crypto.randomUUID(),
              tenantId,
              tableName: "batches",
              rowId: batchRow.id,
              op: "insert",
              payload: JSON.stringify({ name: batch, subject: "General", source: "student_add" }),
              createdAt: now,
            },
          });
          await tx.auditLog.create({
            data: {
              id: crypto.randomUUID(),
              tenantId,
              actor: tenantId,
              action: "batch.create",
              refType: "batch",
              refId: batchRow.id,
              metadata: JSON.stringify({ source: "student_add", name: batch }),
              createdAt: now,
            },
          });
        }
        const enrollmentId = crypto.randomUUID();
        await tx.studentEnrollment.create({
          data: {
            id: enrollmentId,
            tenantId,
            studentId: id,
            batchId: batchRow.id,
            joinedOn: validAdmissionDate,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        await tx.syncOutbox.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            tableName: "student_enrollments",
            rowId: enrollmentId,
            op: "insert",
            payload: JSON.stringify({ student_id: id, batch_id: batchRow.id }),
            createdAt: now,
          },
        });
      }
    });

    if (batch !== undefined) {
      invalidateTenant(tenantId, "attendance:"); // workstream C wiring: batch auto-create
    }
    log.info("student_created_locally", `student ${id} written on the direct-db path`, {
      batch_created: createdBatchName !== null,
      duplicate_proceed: options?.duplicateProceed === true,
    });

    revalidatePath("/students");
    revalidatePath("/dashboard");
    return { success: true, data: toStudentRow(studentData, tenantId) };
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
    if (!z.string().uuid().safeParse(studentId).success) {
      return { success: false, error: "Invalid student id" };
    }
    // RFC-004 C1: the gateway's DELETE is fail-closed on `Idempotency-Key`.
    // Without the header the route answered 400 before touching the database,
    // so the drawer's Delete button could never succeed — a control wired to a
    // mutation that always failed.
    const res = await gatewayDelete<{ ok: boolean }>(
      `/api/v1/students/${encodeURIComponent(studentId)}`,
      { "Idempotency-Key": mintIntentKey() },
    );
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
  code: z.string().max(20).nullable(),
  first_name: z.string().trim().min(1).max(STUDENT_FIRST_NAME_MAX),
  last_name: z.string().trim().max(STUDENT_LAST_NAME_MAX).nullable(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dob must be YYYY-MM-DD").nullable(),
  gender: z.enum(["M", "F", "O"]).nullable(),
  phone: z.preprocess(
    (value: unknown) => (value === null ? null : value),
    z
      .string()
      .transform((value, ctx) => {
        const parsed = normalizeStudentPhone(value, "phone");
        if (!parsed.ok) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.reason });
          return z.NEVER;
        }
        return parsed.phone;
      })
      .nullish(),
  ),
  email: z.string().max(254).nullable(),
  address: z.string().trim().max(STUDENT_ADDRESS_MAX).nullable(),
  school: z.string().trim().max(STUDENT_SCHOOL_MAX).nullable(),
  grade: z.string().trim().max(STUDENT_GRADE_MAX).nullable(),
  board: z.string().trim().max(STUDENT_BOARD_MAX).nullable(),
  admission_date: boundedIsoDate("admission_date", STUDENT_ADMISSION_FLOOR_ISO, false),
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
    // RFC-004 C1: fail-closed `Idempotency-Key`. Without it the PATCH was a
    // guaranteed 400, so every profile edit fell through to the direct-db path.
    const gatewayRes = await gatewayPatch<Student>(
      `/api/v1/students/${encodeURIComponent(studentId)}`,
      gatewayBody,
      { "Idempotency-Key": mintIntentKey() },
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
