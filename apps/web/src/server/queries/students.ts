"use server";
import { Student, StudentListRow } from "@buddysaradhi/shared";
import { StudentFilters, SortCol } from "@/types/students";
import { cache } from "react";
import { gatewayGet } from "@/server/get-db";
import { log } from "@/lib/logger";

export const getStudents = cache(async (
  filters: StudentFilters,
  searchQuery: string,
  page: number,
  pageSize: number,
  sort: { col: SortCol; dir: 'asc' | 'desc' }
): Promise<{ success: boolean; data?: { students: StudentListRow[]; total: number }; error?: string }> => {
  try {
    const res = await gatewayGet<{ students: StudentListRow[]; total: number }>(
      "/api/v1/students",
      {
        search: searchQuery,
        page: String(page),
        pageSize: String(pageSize),
        status: filters.status.join(","),
        feeModels: filters.feeModels.join(","),
        batchIds: filters.batchIds.join(","),
        tagIds: filters.tagIds.join(","),
        balanceRange: filters.balanceRange,
        admittedInLast: filters.admittedInLast,
        sortCol: sort.col,
        sortDir: sort.dir,
      }
    );

    if (!res.success) {
      return { success: false, error: res.error };
    }

    return { success: true, data: res.data };
  } catch (error) {
    log.error('students_list_failed', error instanceof Error ? error.message : String(error));
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch students" };
  }
});

export const getStudent = cache(async (
  studentId: string
): Promise<{ success: boolean; data?: Student; error?: string }> => {
  try {
    const res = await gatewayGet<Student>(`/api/v1/students/${studentId}`);
    if (!res.success) {
      return { success: false, error: res.error };
    }
    return { success: true, data: res.data };
  } catch (error) {
    log.error('student_get_failed', error instanceof Error ? error.message : String(error), { studentId });
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch student" };
  }
});
