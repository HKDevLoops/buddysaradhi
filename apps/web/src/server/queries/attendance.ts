// Implements: 06_Attendance.md §3 — attendance for date view
// All reads go through the API Gateway → attendance-svc. No direct Prisma.
"use server";
import { cache } from "react";
import { gatewayGet } from "@/server/get-db";

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

    return gatewayGet<{ session: AttendanceSession | null; records: StudentAttendanceRow[] }>(
      "/api/v1/attendance",
      params
    );
  }
);

export const getBatches = cache(async () => {
  return gatewayGet<Array<{ id: string; name: string; subject: string | null }>>(
    "/api/v1/attendance/batches"
  );
});
