"use client";

import { useAttendanceStore } from "@/stores/attendance-store";
import { useQuery } from "@tanstack/react-query";
import { fetchAttendanceAction } from "@/server/actions/attendance";
import { AttendanceToolbar } from "./attendance-toolbar";
import { AttendanceGrid } from "./attendance-grid";
import { LockSessionSheet } from "./lock-session-sheet";
import { AttendanceReportClient } from "./attendance-report-client";
import { Loader2, BarChart3 } from "lucide-react";


export function AttendanceClient() {
  const { selectedDateIso, selectedBatch, setReportOpen } = useAttendanceStore();

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', selectedDateIso, selectedBatch],
    queryFn: () => fetchAttendanceAction(selectedDateIso, selectedBatch),
  });

  const session = data?.data?.session || null;
  const records = data?.data?.records || [];
  const isLocked = session?.locked_at != null;

  return (
    <div className="space-y-6 flex flex-col h-full min-h-[calc(100vh-140px)]">
      <AttendanceToolbar session={session} />

      {isLocked && (
        <button
          onClick={() => setReportOpen(true)}
          className="neumo-raised px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors min-h-[44px] self-start"
          style={{
            background: "var(--bg-surface-raised)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-default)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-cyan)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
        >
          <BarChart3 className="w-4 h-4" style={{ color: "var(--accent-cyan)" }} /> View Report
        </button>
      )}

      <div className="flex-grow min-h-0">
        {isLoading ? (
          <div className="glass rounded-xl overflow-hidden min-h-[400px] flex items-center justify-center">
            <div className="flex flex-col items-center gap-4 opacity-50">
              <Loader2 className="w-8 h-8 text-[var(--accent-cyan)] animate-spin" />
              <p className="text-sm text-[var(--text-muted)]">Loading attendance...</p>
            </div>
          </div>
        ) : (
          <AttendanceGrid records={records} session={session} />
        )}
      </div>

      <LockSessionSheet session={session} />
      <AttendanceReportClient records={records} selectedDateIso={selectedDateIso} />
    </div>
  );
}
