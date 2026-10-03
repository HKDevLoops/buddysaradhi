"use client";

// Implements: UI/web/05_Attendance.md — AttendanceClient.
// docs/design/overhaul-plan.md §3: the roster the day view already holds is handed to the
// toolbar's shared search box, so the filter ranks locally and nothing is refetched while
// typing.

import { useMemo } from "react";
import { useAttendanceStore } from "@/stores/attendance-store";
import { useQuery } from "@tanstack/react-query";
import { fetchAttendanceAction } from "@/server/actions/attendance";
import { AttendanceToolbar } from "./attendance-toolbar";
import { AttendanceGrid } from "./attendance-grid";
import { LockSessionSheet } from "./lock-session-sheet";
import { AttendanceSummary } from "./attendance-summary";
import type { SearchCandidate } from "@/components/search/student-search-box";
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

  const roster = useMemo<SearchCandidate<string>[]>(
    () => records.map((r) => ({ item: r.student_id, text: r.name, meta: r.batch ?? undefined })),
    [records],
  );

  return (
    <div className="space-y-6 flex flex-col h-full min-h-[calc(100vh-140px)]">
      <AttendanceToolbar session={session} roster={roster} />

      <div className="flex-grow min-h-0">
        {isLoading ? (
          <div className="glass rounded-xl overflow-hidden min-h-[400px] flex items-center justify-center">
            <div className="flex flex-col items-center gap-4 opacity-50">
              <Loader2 className="w-8 h-8 text-[var(--info)] animate-spin" />
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