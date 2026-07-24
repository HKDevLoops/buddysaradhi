"use server";

import { Student } from "@buddysaradhi/shared";
import { getAuthenticatedPrisma, gatewayPost } from "@/server/get-db";
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
) {
  return getStudentsQuery(filters, searchQuery, page, pageSize, sort);
}

export async function fetchStudentDetailAction(studentId: string) {
  return getStudentQuery(studentId);
}

export async function createStudent(data: unknown, batchName?: string): Promise<{ success: boolean; data?: Student; error?: string }> {
  try {
    const res = await gatewayPost<Student>("/api/v1/students", data, {
      "X-Batch-Name": batchName || "",
    });

    if (res.success) {
      revalidatePath("/students");
      return { success: true, data: res.data };
    }

    log.warn('student_create_gateway_post_failed_using_direct_db', res.error);
    const { client, tenantId } = await getAuthenticatedDb();
    const proxy = createLibsqlProxy(client);
    const s = data as any;
    const id = crypto.randomUUID();
    const code = s.code || `S-${Math.floor(100 + Math.random() * 900)}`;
    const studentData = {
      id,
      tenantId,
      code,
      firstName: s.first_name || s.firstName || "Student",
      lastName: s.last_name || s.lastName || "",
      status: s.status || "active",
      feeModel: s.fee_model || s.feeModel || "postpaid",
      baseFeePaise: Number(s.baseFeePaise || s.base_fee_paise || 200000),
      balancePaise: Number(s.balancePaise || 0),
      dupKey: code,
      admissionDate: s.admission_date || new Date().toISOString(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await proxy.student.create({ data: studentData });
    revalidatePath("/students");
    return { success: true, data: studentData as any };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create student";
    return { success: false, error: message };
  }
}

export async function checkDuplicateStudentAction(
  dupKey: string
): Promise<{ isDuplicate: boolean; existingStudentId?: string }> {
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
    return { isDuplicate: false };
  }
}
