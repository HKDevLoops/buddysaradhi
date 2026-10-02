"use server";
import { Student, StudentListRow } from "@buddysaradhi/shared";
import { StudentFilters, SortCol } from "@/types/students";
import { cache } from "react";
import { getAuthenticatedDb, createLibsqlProxy, gatewayGet } from "@/server/get-db";
import { QUERY_TIMEOUT_MS, toTypedQueryError, withQueryTimeout } from "@/server/cache";
import { log } from "@/lib/logger";

export const getStudents = cache(async (
  filters: StudentFilters,
  searchQuery: string,
  page: number,
  pageSize: number,
  sort: { col: SortCol; dir: 'asc' | 'desc' }
): Promise<{ success: boolean; data?: { students: StudentListRow[]; total: number }; error?: string }> => {
  try {
    const res = await withQueryTimeout(
      gatewayGet<{ students: StudentListRow[]; total: number }>(
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
      ),
      QUERY_TIMEOUT_MS,
    );

    if (res.success) {
      return { success: true, data: res.data };
    }

    log.warn('get_students_gateway_failed_using_direct_db', res.error);
    const { client, tenantId } = await getAuthenticatedDb();
    const proxy = createLibsqlProxy(client);
    // Single-query fallback (no fan-out here): still bounded + typed.
    // Student rows are NOT tenant-cached — roster churn is high (web/02 §3.2);
    // per-request dedup comes from React cache() above.
    // RFC-004 C4 note: list rows intentionally omit `updated_at` (the shared
    // StudentListRowSchema contract has no timestamp field). Edit forms must
    // capture the CAS base from the detail read below (`getStudent` maps
    // `updated_at` in both the gateway and fallback branches), never from a
    // list row.
    const rawStudents = await withQueryTimeout(
      proxy.student.findMany({ where: { tenantId } }),
      QUERY_TIMEOUT_MS,
    );
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
    const typed = toTypedQueryError(error);
    log.error('students_list_failed', typed);
    return { success: false, error: typed };
  }
});

export const getStudent = cache(async (
  studentId: string
): Promise<{ success: boolean; data?: Student; error?: string }> => {
  try {
    const res = await withQueryTimeout(
      gatewayGet<Record<string, unknown>>(`/api/v1/students/${studentId}`),
      QUERY_TIMEOUT_MS,
    );
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
    const raw = await withQueryTimeout(
      proxy.student.findFirst({ where: { tenantId, id: studentId } }),
      QUERY_TIMEOUT_MS,
    );
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
    const typed = toTypedQueryError(error);
    log.error('student_get_failed', typed, { studentId });
    return { success: false, error: typed };
  }
});
