"use client";

// Implements: UI/web/05_Attendance.md — AttendanceGrid
// Renders the student list for marking attendance using Cyan Lagoon palette vars.
//
// AGENTS.md §2 Rule 9 (no silent failures) + Rule 10 (announce, don't flash) — three
// hardening changes, each fixing a way this grid could tell a tutor something false:
//   1. The mutation-failure banner had no `role="alert"`, so a screen-reader user was
//      never told a save failed — and the banner used to auto-dismiss after 3s, which
//      meant a tutor looking away from their keyboard never learned the day's marks were
//      rejected. It now persists until the next successful save, is announced, and also
//      raises a toast (the shared module owns the timer, so nothing leaks on unmount).
//   2. "Mark all Absent" was one tap over a whole day of attendance with no confirm and
//      no undo. Absence feeds fees, so a mis-tap is a financial edit, not a cosmetic one.
//      It is now a two-step confirm with an explicit cancel, disarmed whenever its target
//      set changes so it can never fire on a different day.
//   3. "No students found for this batch" covered three different worlds — an empty batch,
//      a search that matched nobody, and (before `AttendanceClient` grew a failure
//      branch) a read that failed. Each now says which, and only the empty case is silent
//      about recovery.

import { useAttendanceStore } from "@/stores/attendance-store";
import { type StudentAttendanceRow, type AttendanceSession, type AttendanceStatus, type UpdateAttendancePayload } from "@buddysaradhi/shared";
import { AttendanceStatusToggle } from "./attendance-status-toggle";
import { BulkAbsentSheet, type BulkAbsentBreakdown } from "./bulk-absent-sheet";
import { useUnlockWindow } from "./use-unlock-window";
import { bulkMarkAttendanceAction, updateAttendanceAction } from "@/server/actions/attendance";
import { isFutureDate } from "@/server/attendance-window";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, AlertTriangle, UserX, Clock, Plane, Lock } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { Avatar } from "@/components/ui/avatar";
import { ScreenSkeleton } from "@/components/ui/screen-state";
import { useToast } from "@/components/ui/toast";
import { toAppErrorState } from "@/lib/app-errors";
import { cn } from "@/lib/utils";
import { fuzzySearch } from "@buddysaradhi/shared";

const SUMMARY_META: { key: AttendanceStatus; label: string; accent: string; Icon: typeof Check }[] = [
  { key: "present", label: "Present", accent: "var(--success)", Icon: Check },
  { key: "absent", label: "Absent", accent: "var(--danger)", Icon: X },
  { key: "late", label: "Late", accent: "var(--warning)", Icon: Clock },
  { key: "excused", label: "Excused", accent: "var(--info)", Icon: Plane },
];

interface AttendanceGridProps {
  records: StudentAttendanceRow[];
  session: AttendanceSession | null;
  /** True while the first read is in flight — the day's rows are not known yet. */
  isLoading?: boolean;
}

export function AttendanceGrid({ records, session, isLoading = false }: AttendanceGridProps) {
  const { searchQuery, setSearchQuery, selectedDateIso, selectedBatch } = useAttendanceStore();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [absentSheetOpen, setAbsentSheetOpen] = useState(false);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // 06 §10.6: the lock freezes edits EXCEPT inside an open unlock window.
  // `locked_at` stays set for the session's life; the window overlays it, so
  // every guard below keys off `isLocked` and the window flips them all at
  // once (marking, bulk bar, per-row toggles).
  const { windowOpen } = useUnlockWindow(session);
  const isLocked = session?.locked_at != null && !windowOpen;

  // EC-A-01 / 06 §11 E5 / §14: a future date cannot be marked. The picker caps
  // the calendar at today, but a session can also reach here from a deep link
  // or a stale stored date, and the mark is refused with the reason named
  // rather than silently writing a session that will lock itself in 48 hours.
  const isFuture = isFutureDate(selectedDateIso, new Date().toISOString());

  const mutation = useMutation({
    mutationFn: (payload: UpdateAttendancePayload) => updateAttendanceAction(payload),
    onMutate: async (newPayload) => {
      await queryClient.cancelQueries({ queryKey: ["attendance"] });
      const previousData = queryClient.getQueryData(["attendance", selectedDateIso, selectedBatch]);

      queryClient.setQueryData(
        ["attendance", selectedDateIso, selectedBatch],
        (old: { data?: { records: StudentAttendanceRow[] } } | undefined) => {
          if (!old || !old.data || !old.data.records) return old;
          const newRecords = [...old.data.records];
          newPayload.updates.forEach((u: UpdateAttendancePayload["updates"][number]) => {
            const idx = newRecords.findIndex((r: StudentAttendanceRow) => r.student_id === u.student_id);
            if (idx !== -1) newRecords[idx] = { ...newRecords[idx], status: u.status };
          });
          return { ...old, data: { ...old.data, records: newRecords } };
        }
      );

      return { previousData };
    },
    onError: (err, _newPayload, context) => {
      // Roll the optimistic marks back to exactly what the server still holds — the
      // optimistic rows were a guess, and a failed save must not leave them on screen.
      queryClient.setQueryData(["attendance", selectedDateIso, selectedBatch], context?.previousData);
      // A toast carries the same sentence and is announced too; the inline banner stays
      // until the next save so a tutor who looked away cannot miss it.
      const copy = toAppErrorState(err).message;
      setErrorToast(copy);
      toast.error("Attendance not saved", copy);
    },
    onSuccess: (res) => {
      // A FAILED write resolves too: the action catches and returns
      // `{ success: false, error }` rather than throwing, so React Query calls
      // `onSuccess` for a rejected mark as well. Unconditionally clearing the
      // banner here therefore wiped the evidence of the very failure it was
      // reporting — a locked session or a stale date left the grid looking like
      // a clean save (Rule 9: a swallowed failure).
      if (res.success !== true) {
        const copy = res.error ?? "Failed to update attendance";
        setErrorToast(copy);
        toast.error("Attendance not saved", copy);
        return;
      }
      // The save landed, so the previous failure is no longer the truth.
      setErrorToast(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: (vars: {
      status: AttendanceStatus;
      studentIds: string[];
      overwrite: boolean;
    }) =>
      bulkMarkAttendanceAction({
        session_date: selectedDateIso,
        batch_id: selectedBatch === "all" ? null : selectedBatch,
        status: vars.status,
        student_ids: vars.studentIds,
        overwrite: vars.overwrite,
      }),
    onError: (err) => {
      const copy = toAppErrorState(err).message;
      setErrorToast(copy);
      toast.error("Attendance not saved", copy);
    },
    onSuccess: (res, vars) => {
      if (res.success !== true) {
        const copy = res.error ?? "Failed to update attendance";
        setErrorToast(copy);
        toast.error("Attendance not saved", copy);
        return;
      }
      setErrorToast(null);
      setAbsentSheetOpen(false);
      toast.success(
        vars.status === "present"
          ? `${res.count_affected} ${res.count_affected === 1 ? "student" : "students"} marked present`
          : `${res.count_affected} ${res.count_affected === 1 ? "student" : "students"} marked absent`,
        res.count_skipped > 0
          ? `${res.count_skipped} already-marked ${res.count_skipped === 1 ? "student was" : "students were"} left as they were. Audit row written.`
          : "Audit row written.",
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
  });

  // docs/design/overhaul-plan.md §3: the toolbar's search box ranks with the shared fzf
  // engine, so the grid must consume the same order — not a second `includes` filter that
  // would disagree with the dropdown the tutor just picked from.
  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) return records;
    return fuzzySearch(
      records.map((r) => ({ item: r, text: r.name })),
      searchQuery,
    ).map((hit) => hit.item);
  }, [records, searchQuery]);

  const handleToggle = (studentId: string, status: AttendanceStatus) => {
    if (isLocked || isFuture) return;
    mutation.mutate({
      session_date: selectedDateIso,
      batch_id: selectedBatch === "all" ? null : selectedBatch,
      updates: [{ student_id: studentId, status }],
    });
  };

  /**
   * 06 §10.7: "Mark all Present … Sets every enrolled-but-unmarked student …
   * Already-marked students are not overwritten (the tutor's individual
   * overrides win)." The optimistic cache is patched for the rows we expect to
   * change, and the SERVER re-checks the same rule, so a stale client cannot
   * overwrite a mark made on another device.
   */
  const commitBulkPresent = () => {
    const unmarked = filteredRecords.filter((r) => r.status === null);
    if (unmarked.length === 0) return;
    queryClient.setQueryData(
      ["attendance", selectedDateIso, selectedBatch],
      (old: { data?: { records: StudentAttendanceRow[] } } | undefined) => {
        if (!old?.data?.records) return old;
        const targets = new Set(unmarked.map((r) => r.student_id));
        return {
          ...old,
          data: {
            ...old.data,
            records: old.data.records.map((r) =>
              targets.has(r.student_id) ? { ...r, status: "present" as AttendanceStatus } : r,
            ),
          },
        };
      },
    );
    bulkMutation.mutate({
      status: "present",
      studentIds: unmarked.map((r) => r.student_id),
      overwrite: false,
    });
  };

  const commitBulkAbsent = () => {
    bulkMutation.mutate({
      status: "absent",
      studentIds: filteredRecords.map((r) => r.student_id),
      overwrite: true,
    });
  };

  /**
   * Present is one tap because it is the safe default: nobody came is the
   * common case and correcting it upward costs one tap per student. Absent is
   * the direction that feeds fees, so it takes the typed confirmation sheet
   * (06 §10.7 BR-ATT-06, EC-A-05).
   */
  const requestBulk = (status: AttendanceStatus) => {
    if (isLocked || isFuture || filteredRecords.length === 0) return;
    if (status === "absent") {
      setAbsentSheetOpen(true);
      return;
    }
    commitBulkPresent();
  };

  const absentBreakdown: BulkAbsentBreakdown = useMemo(
    () => ({
      total: filteredRecords.length,
      present: filteredRecords.filter((r) => r.status === "present").length,
      late: filteredRecords.filter((r) => r.status === "late").length,
      excused: filteredRecords.filter((r) => r.status === "excused").length,
      absent: filteredRecords.filter((r) => r.status === "absent").length,
    }),
    [filteredRecords],
  );

  const isAllPresent = filteredRecords.length > 0 && filteredRecords.every((r) => r.status === "present");
  const unmarkedCount = filteredRecords.filter((r) => r.status === null).length;
  const targetCount = filteredRecords.length;

  const counts = SUMMARY_META.reduce(
    (acc, m) => {
      acc[m.key] = records.filter((r) => r.status === m.key).length;
      return acc;
    },
    {} as Record<AttendanceStatus, number>
  );

  /**
   * 06 §18 keyboard contract: "↑ / ↓ moves between rows in the Daily Grid.
   * P / A / L sets present / absent / late on the focused row. Enter toggles
   * present ↔ absent." The per-row toggle buttons were already reachable by Tab
   * (each carries its own label and `aria-pressed`), but a tutor marking 36
   * students had to Tab through four buttons per student and could not jump
   * rows — 144 stops for one class.
   */
  const onRowKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    studentId: string,
    name: string,
  ) => {
    if (isLocked || isFuture) return;
    const current = filteredRecords.find((r) => r.student_id === studentId)?.status ?? null;
    const key = e.key.toLowerCase();
    if (key === "p" || key === "a" || key === "l") {
      e.preventDefault();
      handleToggle(studentId, key === "p" ? "present" : key === "a" ? "absent" : "late");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      handleToggle(studentId, current === "present" ? "absent" : "present");
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const order = filteredRecords.map((r) => r.student_id);
      const at = order.indexOf(studentId);
      const next = order[at + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) rowRefs.current.get(next)?.focus();
      return;
    }
    // `Escape` is listed for the dialogs only; on a row it does nothing, so the
    // name is dropped to keep the control quiet for screen readers.
    void name;
  };

  if (isLoading) {
    return <ScreenSkeleton shape="roster" label="this day's attendance" rows={6} />;
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Summary pills — neumorphic, color-coded, count + word (color is never the
          only signal). `aria-live="polite"` per 06 §18: "The summary strip uses
          aria-live="polite" to announce count changes ('28 present, 4 absent')".
          Without it a screen-reader tutor got no word at all when a mark landed,
          because the pills are text with no state change to announce. */}
      <div
        className="flex flex-wrap items-center gap-3"
        role="status"
        aria-live="polite"
        aria-label={SUMMARY_META.map((m) => `${counts[m.key]} ${m.label.toLowerCase()}`).join(", ")}
      >
        {SUMMARY_META.map((m) => (
          <div
            key={m.key}
            className="neumo-inset px-4 py-2 rounded-full flex items-center gap-2 min-h-[44px]"
            style={{ border: `1px solid color-mix(in srgb, ${m.accent} 30%, transparent)` }}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: m.accent }} aria-hidden="true" />
            <m.Icon className="w-3 h-3" style={{ color: m.accent }} aria-hidden="true" />
            <span className="text-sm font-semibold num" style={{ color: m.accent }}>
              {counts[m.key]}
            </span>
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              {m.label}
            </span>
          </div>
        ))}
      </div>

      {/* Bulk Action Bar — the one floating surface on this screen, so it is the
          one that earns the material. `var(--mat-filter)` (docs/design/material-modes.md
          §2) is the ONLY blur source in the app: in Minimal it resolves to `none`,
          so switching material actually changes this bar instead of leaving a
          hand-written 24px blur stranded outside the token scale. */}
      <div
        className="p-4 rounded-xl flex items-center justify-between gap-3 flex-wrap sticky top-0 z-20 shadow-sm"
        style={{
          background: "var(--surface-overlay)",
          backdropFilter: "var(--mat-filter)",
          WebkitBackdropFilter: "var(--mat-filter)",
          border: "1px solid var(--border-strong)",
        }}
      >
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-heading)" }}>
          {targetCount} Students {searchQuery.trim().length > 0 && "found"}
        </h2>
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={() => requestBulk("present")}
            disabled={isLocked || isFuture || unmarkedCount === 0}
            title={
              isFuture
                ? "Cannot mark future dates"
                : isLocked
                  ? "Session is locked"
                  : unmarkedCount === 0
                    ? "Everyone in view is already marked"
                    : undefined
            }
            aria-label={
              isFuture
                ? "Cannot mark a future date"
                : unmarkedCount === 0
                  ? "Everyone in view is already marked"
                  : `Mark ${unmarkedCount} unmarked ${unmarkedCount === 1 ? "student" : "students"} in view present`
            }
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all disabled:opacity-50 min-h-[44px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]",
              !isAllPresent && "neumo-raised"
            )}
            style={{
              background: isAllPresent
                ? "color-mix(in srgb, var(--success) 15%, transparent)"
                : "var(--surface-raised)",
              color: "var(--text-primary)",
              border: isAllPresent
                ? "1px solid var(--success)"
                : "1px solid var(--border-default)",
            }}
          >
            <Check className="w-4 h-4" style={{ color: "var(--success)" }} aria-hidden="true" />
            Mark all Present
          </button>

          <button
            type="button"
            onClick={() => requestBulk("absent")}
            disabled={isLocked || isFuture || targetCount === 0}
            title={isFuture ? "Cannot mark future dates" : isLocked ? "Session is locked" : undefined}
            aria-label={`Mark all ${targetCount} students in view absent. Opens a confirmation you must type to accept.`}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all disabled:opacity-50 min-h-[44px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]",
              "neumo-raised"
            )}
            style={{
              background: "var(--surface-raised)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
            }}
          >
            <X className="w-4 h-4" style={{ color: "var(--danger)" }} aria-hidden="true" />
            Mark all Absent
          </button>
        </div>

        {/* 06 §10.7: "Locked sessions: bulk actions are disabled … the bulk bar
            shows '12 students locked — skipped'." A pair of silently-disabled
            buttons told the tutor nothing: the controls looked broken rather
            than locked. The bar now names the reason and the way out (EC-A-03). */}
        {isLocked && (
          <p
            className="w-full text-xs flex items-center gap-1.5"
            style={{ color: "var(--text-secondary)" }}
          >
            <Lock className="w-3.5 h-3.5" style={{ color: "var(--warning)" }} aria-hidden="true" />
            {counts.present + counts.absent + counts.late + counts.excused} of {records.length}{" "}
            {records.length === 1 ? "student is" : "students are"} locked — bulk marking is skipped
            until you unlock this session with your PIN.
          </p>
        )}
        {isFuture && (
          <p className="w-full text-xs" style={{ color: "var(--text-secondary)" }}>
            Cannot mark future dates. Pick today or an earlier date.
          </p>
        )}
      </div>

      {errorToast && (
        <div
          // Announced: a save that failed while the tutor's attention was on the grid is
          // the one event here they must not have to poll for (AGENTS.md §2 Rule 10).
          role="alert"
          className="px-4 py-2 rounded-lg text-sm flex items-center gap-2"
          style={{
            background: "color-mix(in srgb, var(--danger) 15%, transparent)",
            border: "1px solid var(--danger)",
            color: "var(--text-primary)",
          }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--danger)" }} aria-hidden="true" />
          <span>{errorToast}</span>
        </div>
      )}

      {/* Grid wrapper */}
      <GlassCard className="p-0 overflow-hidden flex-grow pb-20">
        <div className="overflow-y-auto h-full no-scrollbar">
          {records.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center gap-2 h-48 px-6 text-center"
              style={{ color: "var(--text-secondary)" }}
            >
              <UserX className="size-6" style={{ color: "var(--text-muted)" }} aria-hidden="true" />
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Nobody is enrolled in this batch
              </p>
              <p className="text-xs max-w-xs">
                Add students to the batch on the Students screen, or pick
                &ldquo;All batches&rdquo; to mark the whole institute.
              </p>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center gap-3 h-48 px-6 text-center"
              style={{ color: "var(--text-secondary)" }}
            >
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                No student matches that search
              </p>
              <p className="text-xs max-w-xs">
                {records.length} student{records.length === 1 ? " is" : "s are"} in view.
                Nothing has been marked — clear the search to see everyone.
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="neumo-raised inline-flex min-h-[44px] items-center px-3 rounded-lg text-sm font-semibold transition-all active:translate-y-px cursor-pointer"
                style={{
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-primary)",
                }}
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--border-default)" }}>
              {filteredRecords.map((record) => (
                <div
                  key={record.student_id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(record.student_id, el);
                    else rowRefs.current.delete(record.student_id);
                  }}
                  // 06 §18: the row is a focus stop of its own so ↑/↓, P/A/L and
                  // Enter work without tabbing through four buttons per student.
                  // `role="group"` + a name that states the CURRENT mark keeps the
                  // announced text honest after a keyboard mark changes it.
                  role="group"
                  tabIndex={0}
                  aria-label={`${record.name}, ${
                    record.status ?? "not marked"
                  }. Keys: P present, A absent, L late, Enter to flip present and absent.`}
                  onKeyDown={(e) => onRowKeyDown(e, record.student_id, record.name)}
                  className="flex items-center justify-between px-6 py-3 transition-colors group h-16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-inset"
                  style={{ borderBottom: "1px solid var(--border-default)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--surface-inset)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div className="flex items-center min-w-0">
                    {/* Avatar — the shared implementation, not a third inline
                        monogram. Same person, same colour, same weight as the
                        roster row and the drawer header. */}
                    <Avatar name={record.name} id={record.student_id} size="md" />
                    <div className="ml-4 min-w-0">
                      <p
                        className="text-sm font-semibold sm:truncate transition-colors group-hover:text-[var(--accent-primary)]"
                        style={{ color: "var(--text-primary)" }}
                        title={record.name}
                      >
                        {record.name}
                      </p>
                      <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                        {record.batch || "No batch"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-center w-full md:w-[260px]">
                    <AttendanceStatusToggle
                      status={record.status}
                      onChange={(s) => handleToggle(record.student_id, s)}
                      isLocked={isLocked || isFuture}
                      studentName={record.name}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </GlassCard>

      {/* 06 §10.7 BR-ATT-06 + §21.6 M5 — the typed-confirm gate for the one bulk
          action that overwrites a whole day. */}
      <BulkAbsentSheet
        open={absentSheetOpen}
        breakdown={absentBreakdown}
        sessionDateIso={selectedDateIso}
        onConfirm={commitBulkAbsent}
        onClose={() => setAbsentSheetOpen(false)}
        isPending={bulkMutation.isPending}
      />
    </div>
  );
}
