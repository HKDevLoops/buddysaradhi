"use client";

// Implements: UI/web/05_Attendance.md — AttendanceClient.
// docs/design/overhaul-plan.md §3: the roster the day view already holds is handed to the
// toolbar's shared search box, so the filter ranks locally and nothing is refetched while
// typing.
//
// AGENTS.md §2 Rule 9 (no silent failures) — `fetchAttendanceAction` resolves rather than
// throws, so a failed read arrives as `{ success: false, error }` and the old code read it
// as `records = []`, rendering "No students found for this batch." through the grid. A
// timeout on the read therefore told the tutor that nobody was enrolled in the batch they
// were about to mark, and it looked identical to a legitimately empty batch — so a day's
// marking could be skipped entirely and never noticed. The failure now gets its own branch:
// `ErrorState`, with a data status that says the day's marks are untouched.

import { useMemo } from "react";
import { useAttendanceStore } from "@/stores/attendance-store";
import { useQuery } from "@tanstack/react-query";
import { fetchAttendanceAction } from "@/server/actions/attendance";
import { AttendanceToolbar } from "./attendance-toolbar";
import { AttendanceGrid } from "./attendance-grid";
import { LockSessionSheet } from "./lock-session-sheet";
import { AttendanceSummary } from "./attendance-summary";
import { ErrorState } from "@/components/ui/screen-state";
import { toAppErrorState } from "@/lib/app-errors";
import type { SearchCandidate } from "@/components/search/student-search-box";

export function AttendanceClient() {
  const { selectedDateIso, selectedBatch } = useAttendanceStore();

  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ['attendance', selectedDateIso, selectedBatch],
    queryFn: () => fetchAttendanceAction(selectedDateIso, selectedBatch),
  });

  /**
   * The same split as the roster: a thrown failure and a `{ success: false }` envelope
   * are one failure to the tutor, so they are collapsed before anything branches on them.
   */
  const envelopeError = data && data.success === false ? (data.error ?? "unknown error") : null;
  const failureReason = error ?? envelopeError;
  const hasFailed = failureReason !== null;

  const session = hasFailed ? null : (data?.data?.session ?? null);
  const records = hasFailed ? [] : (data?.data?.records ?? []);
  const isLocked = session?.locked_at != null;

  const roster = useMemo<SearchCandidate<string>[]>(
    () => records.map((r) => ({ item: r.student_id, text: r.name, meta: r.batch ?? undefined })),
    [records],
  );

  return (
    <div className="space-y-6 flex flex-col h-full min-h-[calc(100vh-140px)]">
      {/* The toolbar stays live through a failed read: the date and batch controls are
          the tutor's recovery. Hiding them would strand them on an empty screen. */}
      <AttendanceToolbar session={session} roster={roster} />

      <div className="flex-grow min-h-0">
        {hasFailed ? (
          <ErrorState
            state={toAppErrorState(failureReason)}
            dataStatus="Nobody has been marked for this day. Every existing mark is exactly as you left it — pick another date, or read the day again."
            onRetry={() => {
              void refetch();
            }}
            isRetrying={isFetching}
            retryLabel="Read this day again"
          />
        ) : (
          <AttendanceGrid records={records} session={session} isLoading={isPending} />
        )}
      </div>

      <LockSessionSheet session={session} />
      <AttendanceSummary selectedDateIso={selectedDateIso} />
    </div>
  );
}
