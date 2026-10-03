"use client";

// Implements: UI/web/05_Attendance.md — AttendanceToolbar.
// docs/design/overhaul-plan.md §3: the roster filter is the shared `StudentSearchBox` over the
// shared fzf engine, so Attendance has the same keyboard path as Students and the ⌘K
// palette. AGENTS.md §2 Rule 10 (44px targets, keyboard parity), Rule 2 (ranking is local —
// the toolbar issues no request while typing).

import { useMemo } from "react";
import { useAttendanceStore } from "@/stores/attendance-store";
import { StudentSearchBox } from "@/components/search/student-search-box";
import type { SearchCandidate } from "@/components/search/student-search-box";
import { type AttendanceSession } from "@buddysaradhi/shared";
import { Calendar, Lock, Unlock } from "lucide-react";
import { format, parseISO } from "date-fns";

export interface AttendanceToolbarProps {
  session: AttendanceSession | null;
  /** The roster already loaded for the selected date; the filter ranks it locally. */
  roster?: SearchCandidate<string>[];
}

export function AttendanceToolbar({ session, roster = [] }: AttendanceToolbarProps) {
  const { selectedDateIso, setDate, searchQuery, setSearchQuery, setLockSheetOpen } =
    useAttendanceStore();

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      setDate(e.target.value);
    }
  };

  const isLocked = session?.locked_at != null;
  // A stable identity keeps the debounced query from re-ranking on every roster churn.
  const candidates = useMemo(() => roster, [roster]);

  return (
    <div
      className="rounded-xl p-4 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center"
      style={{
        background: "var(--surface-overlay)",
        backdropFilter: "blur(24px) saturate(160%)",
        border: "1px solid var(--border-strong)",
      }}
    >
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center w-full md:w-auto">
        <div className="flex flex-col">
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
          >
            Attendance
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            {format(parseISO(selectedDateIso), "EEEE, do MMM yyyy")}
          </p>
        </div>

        <div
          className="w-[1px] h-10 hidden md:block mx-2"
          style={{ background: "var(--border-default)" }}
        />

        <div className="flex items-center gap-3 w-full md:w-auto">
          {/* Date Picker */}
          <div className="relative flex-1 md:w-auto">
            <input
              type="date"
              aria-label="Select Date"
              value={selectedDateIso}
              onChange={handleDateChange}
              className="neumo-inset px-3 py-2 pl-10 text-sm w-full appearance-none focus:outline-none"
              style={{
                background: "var(--surface-inset)",
                border: "1px solid var(--border-default)",
                color: "var(--text-primary)",
              }}
            />
            <Calendar
              className="w-4 h-4 absolute left-3 top-2.5 pointer-events-none"
              style={{ color: "var(--text-muted)" }}
              aria-hidden="true"
            />
          </div>

        </div>
      </div>

      <div className="flex items-center gap-3 w-full md:w-auto">
        <div className="relative flex-grow md:flex-grow-0 md:w-72">
          <StudentSearchBox
            label="Search students"
            value={searchQuery}
            onValueChange={setSearchQuery}
            candidates={candidates}
            placeholder="Search students…"
            emptyLabel="No student matches that filter"
          />
        </div>

        <button
          onClick={() => setLockSheetOpen(true)}
          className="neumo-raised px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
          style={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border-default)",
            color: isLocked ? "var(--warning)" : "var(--text-primary)",
          }}
          onMouseEnter={(e) => {
            if (!isLocked) e.currentTarget.style.color = "var(--accent-primary)";
          }}
          onMouseLeave={(e) => {
            if (!isLocked) e.currentTarget.style.color = "var(--text-primary)";
          }}
        >
          {isLocked ? (
            <>
              <Lock className="w-4 h-4" /> Locked
            </>
          ) : (
            <>
              <Unlock className="w-4 h-4" /> Lock Session
            </>
          )}
        </button>
      </div>
    </div>
  );
}
