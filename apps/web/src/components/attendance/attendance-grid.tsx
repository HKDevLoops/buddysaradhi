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
import { useUnlockWindow } from "./use-unlock-window";
import { updateAttendanceAction } from "@/server/actions/attendance";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, AlertTriangle, UserX, XCircle, Clock, Plane } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { Avatar } from "@/components/ui/avatar";
import { ScreenSkeleton } from "@/components/ui/screen-state";
import { useToast } from "@/components/ui/toast";
import { toAppErrorState } from "@/lib/app-errors";
import { cn } from "@/lib/utils";
import { fuzzySearch } from "@buddysaradhi/shared";

/** How long a disarmed confirm waits before forgetting it was ever armed. */
const CONFIRM_ARM_MS = 10_000;

const SUMMARY_META: { key: AttendanceStatus; label: string; accent: string; Icon: typeof Check }[] = [
  { key: "present", label: "Present", accent: "var(--success)", Icon: Check },
  { key: "absent", label: "Absent", accent: "var(--danger)", Icon: X },
  { key: "late", label: "Late", accent: "var(--warning)", Icon: Clock },
  { key: "excused", label: "Leave", accent: "var(--info)", Icon: Plane },
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
  const [confirmingAbsent, setConfirmingAbsent] = useState(false);

  // 06 §10.6: the lock freezes edits EXCEPT inside an open unlock window.
  // `locked_at` stays set for the session's life; the window overlays it, so
  // every guard below keys off `isLocked` and the window flips them all at
  // once (marking, bulk bar, per-row toggles).
  const { windowOpen } = useUnlockWindow(session);
  const isLocked = session?.locked_at != null && !windowOpen;

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
          newPayload.updates.forEach((u) => {
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
    onSuccess: () => {
      // The save landed, so the previous failure is no longer the truth.
      setErrorToast(null);
      setConfirmingAbsent(false);
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

  /**
   * The bulk actions act on `filteredRecords`, so that array IS the blast radius. A
   * confirm that outlives a change to it would fire on rows the tutor never saw; the
   * cancel path is the same button, so arming twice is not possible either.
   */
  const bulkTargetKey = `${selectedDateIso}|${selectedBatch}|${searchQuery.trim()}|${filteredRecords.length}`;
  useEffect(() => {
    setConfirmingAbsent(false);
  }, [bulkTargetKey]);

  useEffect(() => {
    if (!confirmingAbsent) return;
    const timer = setTimeout(() => setConfirmingAbsent(false), CONFIRM_ARM_MS);
    return () => clearTimeout(timer);
  }, [confirmingAbsent]);

  const handleToggle = (studentId: string, status: AttendanceStatus) => {
    if (isLocked) return;
    setConfirmingAbsent(false);
    mutation.mutate({
      session_date: selectedDateIso,
      batch_id: selectedBatch === "all" ? null : selectedBatch,
      updates: [{ student_id: studentId, status }],
    });
  };

  const commitBulk = (status: AttendanceStatus) => {
    mutation.mutate({
      session_date: selectedDateIso,
      batch_id: selectedBatch === "all" ? null : selectedBatch,
      updates: filteredRecords.map((r) => ({ student_id: r.student_id, status })),
    });
  };

  /**
   * Present is one tap because it is the safe default: nobody came is the common case and
   * correcting it upward costs one tap per student. Absent is the direction that feeds
   * fees, so it takes a second, explicit press. The alternative — confirming both —
   * would train a tutor to click through the dialog that exists to protect them.
   */
  const requestBulk = (status: AttendanceStatus) => {
    if (isLocked || filteredRecords.length === 0) return;
    if (status === "absent" && !confirmingAbsent) {
      setConfirmingAbsent(true);
      return;
    }
    setConfirmingAbsent(false);
    commitBulk(status);
  };

  const isAllPresent = filteredRecords.length > 0 && filteredRecords.every((r) => r.status === "present");
  const isAllAbsent = filteredRecords.length > 0 && filteredRecords.every((r) => r.status === "absent");
  const targetCount = filteredRecords.length;

  const counts = SUMMARY_META.reduce(
    (acc, m) => {
      acc[m.key] = records.filter((r) => r.status === m.key).length;
      return acc;
    },
    {} as Record<AttendanceStatus, number>
  );

  if (isLoading) {
    return <ScreenSkeleton shape="roster" label="this day's attendance" rows={6} />;
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Summary pills — neumorphic, color-coded, count + word (color is never the only signal) */}
      <div className="flex flex-wrap items-center gap-3" aria-label="Attendance summary">
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
        className="p-4 rounded-xl flex items-center justify-between sticky top-0 z-20 shadow-sm"
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
            disabled={isLocked || targetCount === 0}
            aria-label={`Mark all ${targetCount} students in view present`}
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
            <Check className="w-4 h-4" style={{ color: "var(--success)" }} /> Mark all Present
          </button>

          <button
            type="button"
            onClick={() => requestBulk("absent")}
            disabled={isLocked || targetCount === 0}
            aria-label={
              confirmingAbsent
                ? `Confirm: mark all ${targetCount} students in view absent. This changes their attendance for the whole day.`
                : `Mark all ${targetCount} students in view absent. Needs a second press to confirm.`
            }
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all disabled:opacity-50 min-h-[44px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]",
              !isAllAbsent && "neumo-raised"
            )}
            style={{
              background: isAllAbsent || confirmingAbsent
                ? "color-mix(in srgb, var(--danger) 15%, transparent)"
                : "var(--surface-raised)",
              color: "var(--text-primary)",
              border: isAllAbsent || confirmingAbsent
                ? "1px solid var(--danger)"
                : "1px solid var(--border-default)",
            }}
          >
            <X className="w-4 h-4" style={{ color: "var(--danger)" }} />
            {confirmingAbsent ? `Confirm — mark ${targetCount} absent` : "Mark all Absent"}
          </button>

          {/* The cancel half of the confirm. It exists because a single self-toggling
              button cannot be escaped: pressing it again is how you commit. */}
          {confirmingAbsent && (
            <>
              <p
                className="text-xs max-w-[16rem]"
                style={{ color: "var(--text-secondary)" }}
              >
                This marks every student in view absent for the whole day.
              </p>
              <button
                type="button"
                onClick={() => setConfirmingAbsent(false)}
                className="neumo-raised inline-flex min-h-[44px] items-center gap-1.5 px-3 rounded-lg text-sm font-semibold transition-all active:translate-y-px cursor-pointer"
                style={{
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-primary)",
                }}
              >
                <XCircle className="w-4 h-4" aria-hidden="true" />
                Cancel
              </button>
            </>
          )}
        </div>
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
                  className="flex items-center justify-between px-6 py-3 transition-colors group h-16"
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
                      isLocked={isLocked}
                      studentName={record.name}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
