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
    const res = await gatewayGet<Record<string, unknown>>(`/api/v1/students/${studentId}`);
    if (res.success) {
      // Gateway returns raw ORM output (camelCase). Map to Student schema (mixed snake/camel).
      const g = res.data;
      const mapped: Student = {
        id: String(g.id),
        tenant_id: String(g.tenantId ?? ""),
        first_name: String(g.firstName ?? ""),
        last_name: (g.lastName as string) || null,
        code: (g.code as string) || null,
        phone: (g.phone as string) || null,
        email: (g.email as string) || null,
        address: (g.address as string) || null,
        school: (g.school as string) || null,
        grade: (g.grade as string) || null,
        board: (g.board as string) || null,
        dob: (g.dob as string) || null,
        gender: (["M", "F", "O"].includes(g.gender as string) ? g.gender : null) as Student["gender"],
        admission_date: String(g.admissionDate ?? new Date().toISOString().slice(0, 10)),
        status: ((g.status as string) || "active") as Student["status"],
        fee_model: ((g.feeModel as string) || "postpaid") as Student["fee_model"],
        baseFeePaise: Number(g.baseFeePaise ?? 0),
        dup_key: (g.dupKey as string) || (g.code as string) || "",
        merged_into_id: null,
        custom_fields: null,
        notes: (g.notes as string) || null,
        archived_at: (g.archivedAt as string) || null,
        created_at: String(g.createdAt ?? new Date().toISOString()),
        updated_at: String(g.updatedAt ?? new Date().toISOString()),
      };
      return { success: true, data: mapped };
    }

    log.warn('get_student_gateway_failed_using_direct_db', res.error, { studentId });
    const { client, tenantId } = await getAuthenticatedDb();
    const proxy = createLibsqlProxy(client);
    const raw = await proxy.student.findFirst({ where: { tenantId, id: studentId } });
    if (!raw) {
      return { success: false, error: "Student not found" };
    }
    const mapped: Student = {
      id: raw.id,
      tenant_id: tenantId,
      first_name: raw.firstName,
      last_name: raw.lastName || null,
      code: raw.code,
      phone: raw.phone || null,
      email: (raw as any).email || null,
      address: (raw as any).address || null,
      school: (raw as any).school || null,
      grade: (raw as any).grade || null,
      board: (raw as any).board || null,
      dob: (raw as any).dob || null,
      gender: (raw as any).gender || null,
      admission_date: raw.admissionDate ? String(raw.admissionDate) : new Date().toISOString().slice(0, 10),
      status: (raw.status || "active") as Student["status"],
      fee_model: (raw.feeModel || "postpaid") as Student["fee_model"],
      baseFeePaise: raw.baseFeePaise || 0,
      dup_key: raw.dupKey || raw.code,
      merged_into_id: null,
      custom_fields: null,
      notes: null,
      archived_at: null,
      created_at: raw.createdAt?.toISOString() || new Date().toISOString(),
      updated_at: raw.updatedAt?.toISOString() || new Date().toISOString(),
    };
    return { success: true, data: mapped };
  } catch (error) {
    log.error('student_get_failed', error instanceof Error ? error.message : String(error), { studentId });
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch student" };
  }
});
