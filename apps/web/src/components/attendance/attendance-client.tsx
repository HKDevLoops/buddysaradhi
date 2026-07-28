"use client";

import { useAttendanceStore } from "@/stores/attendance-store";
import { useQuery } from "@tanstack/react-query";
import { fetchAttendanceAction } from "@/server/actions/attendance";
import { AttendanceToolbar } from "./attendance-toolbar";
import { AttendanceGrid } from "./attendance-grid";
import { LockSessionSheet } from "./lock-session-sheet";
import { AttendanceSummary } from "./attendance-summary";
import { Loader2 } from "lucide-react";


export function AttendanceClient() {
  const { selectedDateIso, selectedBatch } = useAttendanceStore();

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
      <AttendanceSummary selectedDateIso={selectedDateIso} />
    </div>
  );
}