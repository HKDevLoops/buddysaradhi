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

    if (!res.success) {
      throw new Error(res.error);
    }

    revalidatePath("/students");
    return { success: true, data: res.data };
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
