"use client";

// Implements: UI/web/05_Attendance.md — AttendanceToolbar
// Toolbar for the Attendance page using Cyan Lagoon palette variables.

import { useAttendanceStore } from "@/stores/attendance-store";
import { type AttendanceSession } from "@buddysaradhi/shared";
import { Calendar, Lock, Unlock, Search } from "lucide-react";
import { format, parseISO } from "date-fns";

export function AttendanceToolbar({ session }: { session: AttendanceSession | null }) {
  const { selectedDateIso, setDate, searchQuery, setSearchQuery, setLockSheetOpen } = useAttendanceStore();

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      setDate(e.target.value);
    }
  };

  const isLocked = session?.locked_at != null;

  return (
    <div
      className="rounded-xl p-4 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center"
      style={{
        background: "var(--surface-glass-strong)",
        backdropFilter: "blur(24px) saturate(160%)",
        border: "1px solid var(--border-glass-strong)",
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
          style={{ background: "var(--border-glass)" }}
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
                background: "var(--bg-surface-inset)",
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
        <div className="relative flex-grow md:flex-grow-0">
          <input
            type="text"
            placeholder="Search students..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="neumo-inset w-full md:w-64 px-3 py-2 pl-9 text-sm focus:outline-none"
            style={{
              background: "var(--bg-surface-inset)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          />
          <Search
            className="w-4 h-4 absolute left-3 top-2.5 pointer-events-none"
            style={{ color: "var(--text-muted)" }}
            aria-hidden="true"
          />
        </div>

        <button
          onClick={() => setLockSheetOpen(true)}
          className="neumo-raised px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
          style={{
            background: "var(--bg-surface-raised)",
            border: "1px solid var(--border-default)",
            color: isLocked ? "var(--accent-warning)" : "var(--text-primary)",
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
