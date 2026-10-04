"use client";

// Implements: 06_Attendance.md §7 (preset-driven attendance summaries — Current
// Month … Full Year) and 14_Edge_Cases.md EC-A-04 (an empty period is an empty
// state, not an error). 13_UI_Guidelines.md §8.7 (modal: Escape, focus return,
// scrim) and AGENTS.md §2 Rule 10 (WCAG 2.1 AA dialog pattern — labelled,
// modal, focus trapped and returned, keyboard parity).
//
// Hardening (docs/design/overhaul-plan.md §2): the report had no Escape key, no
// focus trap and no focus return, so a keyboard tutor could not open, read and
// leave it. It also swallowed the fetch rejection and then rendered "No
// attendance data for selected period" — so a failed load was indistinguishable
// from a genuinely empty month. It now composes `useOverlayDismiss`, keeps a
// named load error with a retry, and only claims "no data" when the load
// actually succeeded with zero rows.

import { useState, useEffect, useCallback } from "react";
import React from "react";
import { useAttendanceStore } from "@/stores/attendance-store";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { BarChart3, CalendarDays, Users, TrendingUp, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { useOverlayDismiss, OverlayCloseButton } from "@/components/ui/overlay";
import { toAppErrorState, type AppErrorState } from "@/lib/app-errors";
import { fetchAttendanceSummaryAction } from "@/server/actions/attendance";

type Preset = "current_month" | "last_month" | "last_3_months" | "last_6_months" | "full_year";

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
  percentage: number;
}

interface OverallSummary {
  total_students: number;
  total_sessions: number;
  overall_present: number;
  overall_absent: number;
  overall_late: number;
  overall_excused: number;
  overall_percentage: number;
}

interface AttendanceSummaryResponse {
  preset: Preset;
  period_start: string;
  period_end: string;
  summaries: SummaryItem[];
  overall: OverallSummary;
}

export function AttendanceReportClient({ 
  records, 
  selectedDateIso 
}: { 
  records: { student_id: string; name: string; status: string }[];
  selectedDateIso: string;
}) {
  const { isReportOpen, setReportOpen } = useAttendanceStore();
  const [activePreset, setActivePreset] = useState<Preset>("current_month");
  const [summaryData, setSummaryData] = useState<AttendanceSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<AppErrorState | null>(null);
  const [attempt, setAttempt] = useState(0);

  const closeReport = useCallback(() => setReportOpen(false), [setReportOpen]);

  // Escape, scrim, focus trap, focus return and the scroll lock are owned by the
  // shared module — nothing about dismissal is re-implemented here.
  const { panelRef, onScrimClick } = useOverlayDismiss({
    open: isReportOpen,
    onClose: closeReport,
    label: "attendance summary",
  });

  // Fetch summary when preset changes. A rejection is a LOAD FAILURE, never an
  // empty period: the two states render differently so the tutor is never told
  // "no data" when the truth is "we could not ask".
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
        className="absolute inset-0 bg-[var(--surface-scrim)] backdrop-blur-sm"
        onClick={onScrimClick}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="attendance-report-title"
        tabIndex={-1}
        className="relative glass-strong border border-[var(--border-default)] rounded-2xl w-full max-w-4xl shadow-2xl p-6 overflow-hidden max-h-[85vh] flex flex-col"
      >
        <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-[radial-gradient(ellipse_at_center,color-mix(in srgb, var(--info) 0.1, transparent)_0%,transparent_70%)] blur-2xl pointer-events-none" />

        <div className="flex items-center justify-between mb-5 gap-3">
          <div>
            <h2
              id="attendance-report-title"
              className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2"
            >
              <BarChart3 className="w-5 h-5 text-[var(--info)]" aria-hidden="true" />
              Attendance Summary
            </h2>
            {summaryData && (
              <p className="text-sm mt-1 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                <CalendarDays className="w-4 h-4" aria-hidden="true" />
                {format(parseISO(summaryData.period_start), "do MMM yyyy")} — {format(parseISO(summaryData.period_end), "do MMM yyyy")}
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
                "min-h-[44px] flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors",
                activePreset === p.id
                  ? "bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-sm ring-1 ring-white/10"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
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
              value={`${overall.overall_percentage}%`}
              icon={<TrendingUp className="w-4 h-4" />}
              accent={overall.overall_percentage >= 75 ? "var(--success)" : overall.overall_percentage >= 50 ? "var(--warning)" : "var(--danger)"}
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
                    Leave
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
                      <div className="w-full min-h-[36px] rounded-lg flex items-center justify-center text-[11px] font-bold transition-colors num" style={{ 
                        color: s.percentage >= 75 ? "var(--success)" : s.percentage >= 50 ? "var(--warning)" : "var(--danger)" 
                      }}>
                        {s.percentage}%
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Legend — color is never the only signal */}
        <div className="flex flex-wrap items-center gap-4 mt-5 pt-4" style={{ borderTop: "1px solid var(--border-default)" }}>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--success)" }} aria-hidden="true" />
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Present</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--danger)" }} aria-hidden="true" />
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Absent</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--warning)" }} aria-hidden="true" />
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Late</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--info)" }} aria-hidden="true" />
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Leave</span>
          </div>
        </div>
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