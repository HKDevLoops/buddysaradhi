"use client";

// Implements: 06_Attendance.md §7 (preset-driven attendance summaries) and
// 14_Edge_Cases.md EC-A-04 (an empty period is an empty state, not an error).
// 13_UI_Guidelines.md §8.7 (modal: Escape, focus return, scrim) + AGENTS.md §2
// Rule 10 (WCAG 2.1 AA dialog pattern — labelled, modal, focus trapped and
// returned, keyboard parity).
//
// Hardening (docs/design/overhaul-plan.md §2): this summary had no Escape key,
// no focus trap and no focus return, and its `fetchAttendanceSummaryAction`
// promise had NO rejection handler — a failed load was an unhandled rejection
// and the panel then claimed "No attendance data for selected period", which is
// a lie. It now composes `useOverlayDismiss` and separates load failure (named
// error + retry) from a genuinely empty period.

import React, { useState, useEffect, useCallback } from "react";
import { useAttendanceStore } from "@/stores/attendance-store";
import { fetchAttendanceSummaryAction, type AttendancePreset } from "@/server/actions/attendance";
import { format, parseISO } from "date-fns";
import { attendancePctText } from "@/lib/attendance-calc";
import { cn } from "@/lib/utils";
import { BarChart3, CalendarDays, Users, TrendingUp, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { useOverlayDismiss, OverlayCloseButton } from "@/components/ui/overlay";
import { toAppErrorState, type AppErrorState } from "@/lib/app-errors";

type Preset = AttendancePreset;

const PRESETS: { id: Preset; label: string; icon: React.ReactNode }[] = [
  { id: "current_month", label: "Current Month", icon: <CalendarDays className="w-4 h-4" /> },
  { id: "last_month", label: "Last Month", icon: <CalendarDays className="w-4 h-4" /> },
  { id: "last_3_months", label: "Last 3 Months", icon: <CalendarDays className="w-4 h-4" /> },
  { id: "last_6_months", label: "Last 6 Months", icon: <CalendarDays className="w-4 h-4" /> },
  { id: "full_year", label: "Full Year", icon: <CalendarDays className="w-4 h-4" /> },
];

interface SummaryItem {
  student_id: string;
  student_name: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  total_sessions: number;
  /** BR-CALC-06: null = nothing to measure → render "—", never "0%". */
  percentage: number | null;
}

interface OverallSummary {
  total_students: number;
  total_sessions: number;
  overall_present: number;
  overall_absent: number;
  overall_late: number;
  overall_excused: number;
  overall_percentage: number | null;
}

/**
 * A period bound that will not parse is shown verbatim rather than thrown at.
 *
 * `format()` throws `RangeError: Invalid time value` on an invalid `Date`, and
 * this panel used to call it unguarded on the server's `period_start` /
 * `period_end`. One preset whose bound was a day that does not exist
 * (`localDayIso(y, m, 0)` used to yield `"2026-10-00"`) therefore took the whole
 * Attendance screen down to `app/(app)/error.tsx` — toolbar, roster and every
 * mark replaced by "Check the details". A read-only summary panel must never be
 * able to do that, whatever the payload turns out to be, so the parse is
 * checked and an unparseable bound is printed as it arrived. Printing the raw
 * value is the honest choice: it is a value the tutor can report, and it beats
 * a dash that implies "nothing to measure".
 */
function dayText(iso: string): string {
  const parsed = parseISO(iso);
  if (Number.isNaN(parsed.getTime())) return iso || "—";
  return format(parsed, "do MMM yyyy");
}

function pctAccent(pct: number | null): string {
  if (pct === null) return "var(--text-muted)";
  return pct >= 75 ? "var(--success)" : pct >= 50 ? "var(--warning)" : "var(--danger)";
}

interface AttendanceSummaryResponse {
  preset: Preset;
  period_start: string;
  period_end: string;
  summaries: SummaryItem[];
  overall: OverallSummary;
}

export function AttendanceSummary({ selectedDateIso }: { selectedDateIso: string }) {
  const { isReportOpen, setReportOpen } = useAttendanceStore();
  const [activePreset, setActivePreset] = useState<Preset>("current_month");
  const [summaryData, setSummaryData] = useState<AttendanceSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<AppErrorState | null>(null);
  const [attempt, setAttempt] = useState(0);

  const closeReport = useCallback(() => setReportOpen(false), [setReportOpen]);

  const { panelRef, onScrimClick } = useOverlayDismiss({
    open: isReportOpen,
    onClose: closeReport,
    label: "attendance summary",
  });

  // Fetch summary when preset changes. The `cancelled` flag (not an
  // AbortController — a server action cannot be aborted once dispatched) stops
  // a preset switch from writing the previous preset's rows into the panel.
  useEffect(() => {
    if (!isReportOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    fetchAttendanceSummaryAction(activePreset)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.value) {
          setSummaryData(res.value);
        } else {
          setLoadError(toAppErrorState(res.error ?? ""));
        }
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(toAppErrorState(err));
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activePreset, isReportOpen, attempt]);

  if (!isReportOpen) return null;

  const overall = summaryData?.overall;
  const summaries = summaryData?.summaries || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Scrim — dismissal goes through the shared overlay module. */}
      <div
        className="absolute inset-0 bg-[var(--surface-scrim)] [backdrop-filter:var(--mat-filter)]"
        onClick={onScrimClick}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="attendance-summary-title"
        tabIndex={-1}
        className="relative glass-strong border border-[var(--border-default)] rounded-2xl w-full max-w-4xl shadow-2xl p-6 overflow-hidden max-h-[85vh] flex flex-col"
      >
        {/* No decorative glow blob behind the panel — the scrim and the border
            already establish the layer, and the blob sat on top of the table's
            sticky first column. */}

        <div className="flex items-center justify-between mb-5 gap-3">
          <div>
            <h2
              id="attendance-summary-title"
              className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2"
            >
              <BarChart3 className="w-5 h-5 text-[var(--info)]" aria-hidden="true" />
              Attendance Summary
            </h2>
            {summaryData && (
              <p className="text-sm mt-1 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                <CalendarDays className="w-4 h-4" aria-hidden="true" />
                {dayText(summaryData.period_start)} — {dayText(summaryData.period_end)}
              </p>
            )}
          </div>
          <OverlayCloseButton onClick={closeReport} label="Close attendance summary" />
        </div>

        {/* Preset Selector */}
        <div className="flex flex-wrap gap-2 mb-5 pb-4" style={{ borderBottom: "1px solid var(--border-default)" }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={activePreset === p.id}
              onClick={() => setActivePreset(p.id)}
              className={cn(
                "min-h-[44px] flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]",
                activePreset === p.id
                  ? "bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-sm ring-1 ring-white/10"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
            >
              <span aria-hidden="true">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>

        {/* Overall Stats */}
        {overall && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <StatCard
              title="Total Students"
              value={overall.total_students}
              icon={<Users className="w-4 h-4" />}
              accent="var(--info)"
            />
            <StatCard
              title="Present"
              value={overall.overall_present}
              icon={<CheckCircle className="w-4 h-4" />}
              accent="var(--success)"
            />
            <StatCard
              title="Absent"
              value={overall.overall_absent}
              icon={<XCircle className="w-4 h-4" />}
              accent="var(--danger)"
            />
            <StatCard
              title="Attendance %"
              value={attendancePctText(overall.overall_percentage)}
              icon={<TrendingUp className="w-4 h-4" />}
              accent={pctAccent(overall.overall_percentage)}
            />
          </div>
        )}

        {/* Student Breakdown */}
        <div className="overflow-auto no-scrollbar flex-grow">
          {loadError ? (
            <div role="alert" className="text-center py-10 px-4" style={{ color: "var(--text-secondary)" }}>
              <AlertTriangle className="w-8 h-8 mx-auto mb-3" style={{ color: "var(--warning)" }} aria-hidden="true" />
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {loadError.title}
              </p>
              <p className="text-sm mt-1">{loadError.message}</p>
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="mt-4 min-h-[44px] px-5 rounded-lg text-sm font-semibold transition-colors"
                style={{
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-default)",
                  background: "var(--surface-raised)",
                }}
              >
                Try again
              </button>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-10" role="status" aria-live="polite">
              <div className="flex flex-col items-center gap-4 opacity-50">
                <div className="w-8 h-8 border-2 rounded-full animate-spin motion-reduce:animate-none" style={{ borderColor: "var(--border-default)", borderTopColor: "var(--info)" }} aria-hidden="true" />
                <p className="text-sm text-[var(--text-muted)]">Loading summary...</p>
              </div>
            </div>
          ) : summaries.length === 0 ? (
            <div className="text-center py-10" style={{ color: "var(--text-muted)" }}>
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
              <p className="text-sm">No attendance data for selected period</p>
            </div>
          ) : (
            <table className="w-full border-separate" style={{ borderSpacing: "4px" }}>
              <thead>
                <tr>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] p-2 sticky left-0 bg-[var(--surface-raised)]" style={{ fontFamily: "var(--font-mono)" }}>
                    Student
                  </th>
                  <th className="text-center text-xs font-medium p-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    Present
                  </th>
                  <th className="text-center text-xs font-medium p-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    Absent
                  </th>
                  <th className="text-center text-xs font-medium p-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    Late
                  </th>
                  <th className="text-center text-xs font-medium p-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    Excused
                  </th>
                  <th className="text-center text-xs font-medium p-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    Total
                  </th>
                  <th className="text-center text-xs font-medium p-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => (
                  <tr key={s.student_id}>
                    <td className="text-sm font-medium p-2 sticky left-0 bg-[var(--surface-raised)] whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                      {s.student_name}
                    </td>
                    <td className="p-0">
                      <div className="w-full min-h-[36px] rounded-lg flex items-center justify-center text-[11px] font-bold transition-colors num" style={{ color: "var(--success)" }}>
                        {s.present}
                      </div>
                    </td>
                    <td className="p-0">
                      <div className="w-full min-h-[36px] rounded-lg flex items-center justify-center text-[11px] font-bold transition-colors num" style={{ color: "var(--danger)" }}>
                        {s.absent}
                      </div>
                    </td>
                    <td className="p-0">
                      <div className="w-full min-h-[36px] rounded-lg flex items-center justify-center text-[11px] font-bold transition-colors num" style={{ color: "var(--warning)" }}>
                        {s.late}
                      </div>
                    </td>
                    <td className="p-0">
                      <div className="w-full min-h-[36px] rounded-lg flex items-center justify-center text-[11px] font-bold transition-colors num" style={{ color: "var(--info)" }}>
                        {s.excused}
                      </div>
                    </td>
                    <td className="p-0">
                      <div className="w-full min-h-[36px] rounded-lg flex items-center justify-center text-[11px] font-bold transition-colors num" style={{ color: "var(--text-secondary)" }}>
                        {s.total_sessions}
                      </div>
                    </td>
                    <td className="p-0">
                      <div className="w-full min-h-[36px] rounded-lg flex items-center justify-center text-[11px] font-bold transition-colors num" style={{ color: pctAccent(s.percentage) }}>
                        {attendancePctText(s.percentage)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* The four-status legend that used to sit here repeated the column
            headers word for word (Present / Absent / Late / Excused) directly
            above them. BR-CALC-07's requirement — colour is never the only
            signal — is already met by the labelled columns and by the grid's
            per-row icon+word toggles, so the legend was decoration. This line
            replaces it with the one thing a reader cannot derive from the
            columns: how the percentage is computed (BR-CALC-06). */}
        <p className="mt-5 pt-4 text-xs" style={{ borderTop: "1px solid var(--border-default)", color: "var(--text-muted)" }}>
          Attendance % counts present and late as attended and leaves excused days
          out of the total, so a medical leave never lowers a percentage. A
          student with nothing to measure in this period shows a dash.
        </p>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  accent,
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="glass-panel p-4 rounded-xl flex flex-col justify-between" style={{ border: `1px solid color-mix(in srgb, ${accent} 25%, transparent)` }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">{title}</p>
        <div className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 15%, transparent)`, color: accent }}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold text-[var(--text-primary)] tracking-tight num">{value}</p>
    </div>
  );
}