// Implements: 06_Attendance.md §3 — attendance for date view
// All reads go through the API Gateway → attendance-svc. Falls back to direct DB.
"use server";
import { cache } from "react";
import { gatewayGet, getAuthenticatedDb, createLibsqlProxy } from "@/server/get-db";
import { log } from "@/lib/logger";

interface AttendanceSession {
  id: string;
  tenant_id: string;
  session_date: string;
  batch_id: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

interface StudentAttendanceRow {
  student_id: string;
  name: string;
  batch: string | null;
  status: "present" | "absent" | "late" | null;
}

export const getAttendanceForDate = cache(
  async (
    dateIso: string,
    batchId?: string
  ): Promise<{
    success: boolean;
    data?: { session: AttendanceSession | null; records: StudentAttendanceRow[] };
    error?: string;
  }> => {
    const params: Record<string, string> = { date: dateIso };
    if (batchId && batchId !== "all") params.batchId = batchId;

    const res = await gatewayGet<{ session: AttendanceSession | null; records: StudentAttendanceRow[] }>(
      "/api/v1/attendance",
      params
    );

    if (res.success) {
      return res;
    }

    // Gateway failed — fall back to direct DB
    log.warn("attendance_gateway_failed_fallback", res.error, { dateIso, batchId });
    try {
      const { client, tenantId } = await getAuthenticatedDb();
      const proxy = createLibsqlProxy(client);

      // 1. Find session for this date
      const sessionWhere: Record<string, unknown> = { tenantId, sessionDate: dateIso };
      if (batchId && batchId !== "all") sessionWhere.batchId = batchId;
      const session = await proxy.attendanceSession.findFirst({
        where: sessionWhere,
      });

      // 2. Active student roster
      const roster = await proxy.student.findMany({
        where: { tenantId, status: "active" },
        orderBy: { firstName: "asc" },
      });

      // 3. Attendance records if session exists
      let records: StudentAttendanceRow[];
      if (session) {
        const recs = await proxy.attendanceRecord.findMany({
          where: { tenantId, sessionId: session.id },
        });
        const byStu = new Map<string, any>(recs.map((r: any) => [r.studentId, r]));
        records = roster.map((s: any) => ({
          student_id: s.id,
          name: `${s.firstName || ""} ${s.lastName || ""}`.trim(),
          batch: null,
          status: (byStu.get(s.id)?.status ?? null) as StudentAttendanceRow["status"],
        }));
      } else {
        records = roster.map((s: any) => ({
          student_id: s.id,
          name: `${s.firstName || ""} ${s.lastName || ""}`.trim(),
          batch: null,
          status: null,
        }));
      }

      const mappedSession: AttendanceSession | null = session
        ? {
            id: session.id,
            tenant_id: tenantId,
            session_date: session.sessionDate,
            batch_id: session.batchId ?? null,
            locked_at: session.lockedAt ?? null,
            created_at: String(session.createdAt),
            updated_at: String(session.updatedAt),
          }
        : null;

      return { success: true, data: { session: mappedSession, records } };
    } catch (dbError) {
      log.error("attendance_direct_db_failed", dbError instanceof Error ? dbError.message : String(dbError));
      return {
        success: false,
        error: dbError instanceof Error ? dbError.message : "Failed to fetch attendance",
      };
    }
  }
);

export const getBatches = cache(async () => {
  return gatewayGet<Array<{ id: string; name: string; subject: string | null }>>(
    "/api/v1/attendance/batches"
  );
});
