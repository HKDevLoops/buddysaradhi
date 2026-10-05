"use client";

// Implements: UI/web/05_Attendance.md — AttendanceToolbar.
// docs/design/overhaul-plan.md §3: the roster filter is the shared `StudentSearchBox` over the
// shared fzf engine, so Attendance has the same keyboard path as Students and the ⌘K
// palette. AGENTS.md §2 Rule 10 (44px targets, keyboard parity), Rule 2 (ranking is local —
// the toolbar issues no request while typing).
//
// The batch selector closes a real gap: `selectedBatch` is read by
// `attendance-client.tsx`, `attendance-grid.tsx` and `lock-session-sheet.tsx`, it is
// part of the persisted store, and it is part of the query key — yet `setBatch` was
// called from nowhere in the codebase, so the whole batch dimension was dead and every
// tutor marked the whole roster regardless. The options come from `getBatches`
// (reference data, 63s cache), NOT from the current roster: deriving them from the
// roster would collapse the control to a single option the moment a batch was picked,
// because picking one filters the roster that feeds it.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAttendanceStore } from "@/stores/attendance-store";
import { StudentSearchBox } from "@/components/search/student-search-box";
import type { SearchCandidate } from "@/components/search/student-search-box";
import { getBatches } from "@/server/queries/attendance";
import { type AttendanceSession } from "@buddysaradhi/shared";
import { todayIso } from "@/server/attendance-window";
import { BarChart3, Calendar, Lock, Unlock, Users } from "lucide-react";
import { useUnlockWindow } from "./use-unlock-window";
import { format, parseISO } from "date-fns";

export interface AttendanceToolbarProps {
  session: AttendanceSession | null;
  /** The roster already loaded for the selected date; the filter ranks it locally. */
  roster?: SearchCandidate<string>[];
}

export function AttendanceToolbar({ session, roster = [] }: AttendanceToolbarProps) {
  const {
    selectedDateIso,
    setDate,
    selectedBatch,
    setBatch,
    searchQuery,
    setSearchQuery,
    setLockSheetOpen,
    setReportOpen,
  } = useAttendanceStore();

  // One cached reference read per session, not one per keystroke.
  const { data: batchesData } = useQuery({
    queryKey: ["attendance-batches"],
    queryFn: getBatches,
    staleTime: 5 * 60_000,
  });
  const batches = useMemo(
    () => (batchesData?.success ? batchesData.data : []),
    [batchesData],
  );

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      setDate(e.target.value);
    }
  };

  const isLocked = session?.locked_at != null;
  // 06 §10.6: the badge names the live state — locked, window-open with
  // countdown, or unlocked — and always opens the sheet (the unlock entry
  // point). min-h + focus ring per Rule 10 (audit: the gate button).
  const { windowOpen, minutesLeft } = useUnlockWindow(session);
  // A stable identity keeps the debounced query from re-ranking on every roster churn.
  const candidates = useMemo(() => roster, [roster]);

  return (
    <div
      className="rounded-xl p-4 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center"
      style={{
        background: "var(--surface-overlay)",
        // docs/design/material-modes.md §2 — one blur source. The hand-written
        // `blur(24px) saturate(160%)` made this toolbar ignore the material mode.
        backdropFilter: "var(--mat-filter)",
        WebkitBackdropFilter: "var(--mat-filter)",
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
          {/* Batch selector — the dimension `selectedBatch` was always modelling. */}
          <div className="relative">
            <label htmlFor="attendance-batch" className="sr-only">
              Batch
            </label>
            <select
              id="attendance-batch"
              value={selectedBatch}
              onChange={(e) => setBatch(e.target.value)}
              className="neumo-inset min-h-[44px] pl-9 pr-3 text-sm appearance-none cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
              style={{
                background: "var(--surface-inset)",
                border: "1px solid var(--border-default)",
                color: "var(--text-primary)",
              }}
            >
              <option value="all">All batches</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.subject ? ` · ${b.subject}` : ""}
                </option>
              ))}
            </select>
            <Users
              className="w-4 h-4 absolute left-3 top-3 pointer-events-none"
              style={{ color: "var(--text-muted)" }}
              aria-hidden="true"
            />
          </div>
          {batches.length === 0 ? (
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              No batches yet — everyone is marked together.
            </p>
          ) : null}

          {/* Date Picker. `max` is today (EC-A-01 / 06 §11 E5 / §14: a session
              cannot be dated in the future), so the calendar cannot even offer a
              future day. `min` is left open: an old date is exactly the case
              the unlock ladder exists for. */}
          <div className="relative flex-1 md:w-auto">
            <input
              type="date"
              aria-label="Select Date"
              value={selectedDateIso}
              max={todayIso()}
              onChange={handleDateChange}
              className="neumo-inset px-3 py-2 pl-10 text-sm w-full appearance-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
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

        {/* The preset summary's only entry point. `isReportOpen` was read by
            `AttendanceSummary` and set by NOTHING in the codebase, so the whole
            panel — current month, last month, 3/6 months, full year, the one
            place BR-CALC-06's percentage is shown — was unreachable: a tutor
            could not see a single attendance percentage at all (06 §7 lists
            `AttendanceSummary` as part of the screen; the owner-mandated preset
            summaries live in it). */}
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          aria-label="Open attendance summary for a month, a quarter or the year"
          className="neumo-raised px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap min-h-[44px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
          style={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border-default)",
            color: "var(--text-primary)",
          }}
        >
          <BarChart3 className="w-4 h-4" style={{ color: "var(--text-secondary)" }} aria-hidden="true" />
          Summary
        </button>

        <button
          onClick={() => setLockSheetOpen(true)}
          aria-label={
            isLocked
              ? windowOpen
                ? `Session unlocked, ${minutesLeft ?? 0} minutes left. Open unlock options.`
                : "Session locked. Open unlock options."
              : "Lock this session."
          }
          className="neumo-raised px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
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
            windowOpen ? (
              <>
                <Unlock className="w-4 h-4" aria-hidden="true" /> Unlocked · {minutesLeft ?? 0} min
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" aria-hidden="true" /> Locked
              </>
            )
          ) : (
            <>
              <Unlock className="w-4 h-4" aria-hidden="true" /> Lock Session
            </>
          )}
        </button>
      </div>
    </div>
  );
}
