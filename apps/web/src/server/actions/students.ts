"use server";

import { Student } from "@buddysaradhi/shared";
import { getAuthenticatedDb, createLibsqlProxy, getAuthenticatedPrisma, gatewayDelete, gatewayPost } from "@/server/get-db";
import { StudentFilters, SortCol } from "@/types/students";
import { revalidatePath } from "next/cache";
import { getStudents as getStudentsQuery, getStudent as getStudentQuery } from "../queries/students";
import { log } from "@/lib/logger";

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
    return await getStudentQuery(studentId);
  } catch (error) {
    log.error('fetch_student_detail_action_failed', error instanceof Error ? error.message : String(error), { studentId });
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch student detail" };
  }
}

export async function createStudent(data: unknown, batchName?: string): Promise<{ success: boolean; data?: Student; error?: string }> {
  try {
    const s = data as any;
    const { client, tenantId } = await getAuthenticatedDb();
    const proxy = createLibsqlProxy(client);
    const id = crypto.randomUUID();
    const code = s.code || `S-${Math.floor(100 + Math.random() * 900)}`;
    let validAdmissionDate = new Date().toISOString().slice(0, 10);
    const rawDate = s.admission_date || s.joined_at || s.admissionDate;
    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        validAdmissionDate = d.toISOString().slice(0, 10);
      }
    }

    const studentData = {
      id,
      tenantId,
      code,
      firstName: s.first_name || s.firstName || s.name?.split(" ")[0] || "Student",
      lastName: s.last_name || s.lastName || s.name?.split(" ").slice(1).join(" ") || "",
      status: s.status || "active",
      feeModel: s.fee_model || s.feeModel || "postpaid",
      baseFeePaise: s.baseFeePaise !== undefined ? Number(s.baseFeePaise) : (s.base_fee_paise !== undefined ? Number(s.base_fee_paise) : Number(s.baseFee || 2000) * 100),
      balancePaise: Number(s.balancePaise || 0),
      dupKey: s.dup_key || s.dupKey || code,
      admissionDate: validAdmissionDate,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await proxy.student.create({ data: studentData });

    if (batchName) {
      let batch = await proxy.batch.findFirst({ where: { tenantId, name: batchName } });
      if (!batch) {
        const batchId = crypto.randomUUID();
        batch = await proxy.batch.create({
          data: {
            id: batchId,
            tenantId,
            tutorId: tenantId,
            name: batchName,
            subject: "General",
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        });
      }
      await proxy.studentEnrollment.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          studentId: id,
          batchId: batch.id,
          joinedOn: new Date().toISOString(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      });
    }

    revalidatePath("/students");
    // SAFETY: The local proxy returns camelCase fields; the shared Student type
    // uses snake_case. The shape is compatible at runtime but TS can't verify it.
    return { success: true, data: studentData as unknown as Student };
  } catch (err) {
    log.error('create_student_action_failed', err instanceof Error ? err.message : String(err));
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
