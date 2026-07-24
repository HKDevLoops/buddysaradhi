"use server";
import { Student, StudentListRow } from "@buddysaradhi/shared";
import { StudentFilters, SortCol } from "@/types/students";
import { cache } from "react";
import { getAuthenticatedDb, createLibsqlProxy, gatewayGet } from "@/server/get-db";
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

    if (res.success) {
      return { success: true, data: res.data };
    }

    log.warn('get_students_gateway_failed_using_direct_db', res.error);
    const { client, tenantId } = await getAuthenticatedDb();
    const proxy = createLibsqlProxy(client);
    const rawStudents = await proxy.student.findMany({ where: { tenantId } });
    const mapped = rawStudents.map((s: any) => ({
      id: s.id,
      code: s.code,
      name: `${s.firstName} ${s.lastName ?? ""}`.trim(),
      grade: s.grade,
      batch: null,
      fee_model: s.feeModel || "postpaid",
      balance_due: s.balancePaise || 0,
      status: s.status || "active",
    }));
    return { success: true, data: { students: mapped, total: mapped.length } };
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
