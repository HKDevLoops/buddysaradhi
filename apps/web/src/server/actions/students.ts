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

export async function createStudent(data: unknown, batchName?: string): Promise<{ success: boolean; data?: Student; error?: string }> {
  try {
    const s = data as any;
    const id = s.id || crypto.randomUUID();
    const code = s.code || `S-${Math.floor(100 + Math.random() * 900)}`;
    let validAdmissionDate = new Date().toISOString().slice(0, 10);
    const rawDate = s.admission_date || s.joined_at || s.admissionDate;
    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        validAdmissionDate = d.toISOString().slice(0, 10);
      }
    }

    const baseFeePaise = s.baseFeePaise !== undefined 
      ? Number(s.baseFeePaise) 
      : (s.base_fee_paise !== undefined 
          ? Number(s.base_fee_paise) 
          : Number(s.baseFee || 0) * 100);

    const payload = {
      id,
      code,
      first_name: s.first_name || s.firstName || s.name?.split(" ")[0] || "Student",
      last_name: s.last_name || s.lastName || (s.name ? s.name.split(" ").slice(1).join(" ") : "") || null,
      dob: s.dob || null,
      gender: s.gender || null,
      phone: s.phone || null,
      email: s.email || null,
      address: s.address || null,
      school: s.school || null,
      grade: s.grade || null,
      board: s.board || null,
      admission_date: validAdmissionDate,
      status: s.status || "active",
      fee_model: s.fee_model || s.feeModel || "postpaid",
      base_fee_paise: baseFeePaise,
      dup_key: s.dup_key || s.dupKey || code,
      batchName: batchName || s.batchName || s.batch || null,
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

    // Append to sync_outbox in local DB per Rule 7
    await proxy.syncOutbox.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        tableName: "students",
        rowId: id,
        op: "insert",
        payload: JSON.stringify(payload),
        status: "pending",
        createdAt: new Date(),
      },
    });

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
