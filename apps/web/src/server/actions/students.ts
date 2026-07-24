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
    const s = data as any;
    const { client, tenantId } = await getAuthenticatedDb();
    const proxy = createLibsqlProxy(client);
    const id = crypto.randomUUID();
    const code = s.code || `S-${Math.floor(100 + Math.random() * 900)}`;
    let validAdmissionDate = new Date().toISOString().slice(0, 10);
    const rawDate = s.admission_date || s.joined_at || s.admissionDate;
    if (rawDate) {
      try {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          validAdmissionDate = d.toISOString().slice(0, 10);
        }
      } catch {}
    }

    const studentData = {
      id,
      tenantId,
      code,
      firstName: s.first_name || s.firstName || s.name?.split(" ")[0] || "Student",
      lastName: s.last_name || s.lastName || s.name?.split(" ").slice(1).join(" ") || "",
      status: s.status || "active",
      feeModel: s.fee_model || s.feeModel || "postpaid",
      baseFeePaise: Number(s.baseFeePaise || s.base_fee_paise || s.baseFee || 2000) * 100,
      balancePaise: Number(s.balancePaise || 0),
      dupKey: code,
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
