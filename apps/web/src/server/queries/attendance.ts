// Implements: 06_Attendance.md §3 — attendance for date view
// All reads go through the API Gateway → attendance-svc. Falls back to direct DB.
// web/02_State_and_Data_Flow.md §3.2 (today grid: staleTime 0 — never tenant-cached);
// 12_Business_Rules.md BR-SYN-01 (cheap reads protect the sync contract);
// 02_Core_Logic.md §9 (batch + cache as budget control);
// docs/rfc/003-saas-overhaul.md workstream C + §0 (concurrent reads, 12s bounds).
"use server";
import { cache } from "react";
import { gatewayGet, getAuthenticatedDb, createLibsqlProxy, getGatewayHeaders } from "@/server/get-db";
import { hardLocked, readUnlockWindow } from "@/server/attendance-window";
import {
  QUERY_TIMEOUT_MS,
  getCached,
  toTypedQueryError,
  withQueryTimeout,
} from "@/server/cache";
import { log } from "@/lib/logger";

interface AttendanceSession {
  id: string;
  tenant_id: string;
  session_date: string;
  batch_id: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
  // 06 §10.6: unlock window surfaced for countdowns + tier-3 routing. The
  // gateway computes these on its GET; the direct-DB fallback computes them
  // here so both shapes agree (Rule 9: no divergent contracts).
  unlock_window_expires_at?: string | null;
  hard_locked?: boolean;
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

      // BEFORE: 3 sequential round trips (session → roster → records).
      // AFTER: 2 waves — session + roster concurrently (independent), then records
      // (depends on session.id). Same rows, one fewer sequential wait; every wave
      // bounded by QUERY_TIMEOUT_MS so a stalled DB never hangs the invocation.
      const sessionWhere: Record<string, unknown> = { tenantId, sessionDate: dateIso };
      if (batchId && batchId !== "all") sessionWhere.batchId = batchId;
      const [session, roster] = await Promise.all([
        withQueryTimeout(
          proxy.attendanceSession.findFirst({ where: sessionWhere }),
          QUERY_TIMEOUT_MS,
        ),
        withQueryTimeout(
          proxy.student.findMany({
            where: { tenantId, status: "active" },
            orderBy: { firstName: "asc" },
          }),
          QUERY_TIMEOUT_MS,
        ),
      ]);

      // 3. Attendance records if session exists
      let records: StudentAttendanceRow[];
      if (session) {
        const recs = await withQueryTimeout(
          proxy.attendanceRecord.findMany({
            where: { tenantId, sessionId: session.id },
          }),
          QUERY_TIMEOUT_MS,
        );
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
            unlock_window_expires_at: (
              await readUnlockWindow(proxy, tenantId, String(session.id), new Date().toISOString())
            ).expiresAt,
            hard_locked: hardLocked(
              String(session.sessionDate ?? ""),
              new Date().toISOString(),
            ),
          }
        : null;

      return { success: true, data: { session: mappedSession, records } };
    } catch (dbError) {
      const typed = toTypedQueryError(dbError);
      log.error("attendance_direct_db_failed", typed);
      return { success: false, error: typed };
    }
  }
);

export const getBatches = cache(async () => {
  // Reference data (batch list changes rarely) → 63s tenant-scoped cache
  // (web/02 §5; RFC-003 workstream C + §0 free-tier budgets).
  try {
    const { tenantId } = await getGatewayHeaders();
    const data = await getCached<Array<{ id: string; name: string; subject: string | null }>>(
      tenantId,
      "attendance:batches",
      async () => {
        const res = await withQueryTimeout(
          gatewayGet<Array<{ id: string; name: string; subject: string | null }>>(
            "/api/v1/attendance/batches",
          ),
          QUERY_TIMEOUT_MS,
        );
        if (!res.success) throw new Error(res.error);
        return res.data;
      },
    );
    return { success: true as const, data };
  } catch (err) {
    const typed = toTypedQueryError(err);
    log.error("batches_read_failed", typed);
    return { success: false as const, error: typed };
  }
});
