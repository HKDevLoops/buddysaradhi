"use client";

import { useState, useEffect } from "react";
import React from "react";
import { useAttendanceStore } from "@/stores/attendance-store";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { X, BarChart3, CalendarDays, Users, TrendingUp, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
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

  // Fetch summary when preset changes
  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    fetchAttendanceSummaryAction(activePreset).then(res => {
      if (!controller.signal.aborted) {
        if (res.ok && res.value) setSummaryData(res.value);
        setIsLoading(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setIsLoading(false);
    });
    return () => controller.abort();
  }, [activePreset]);

  if (!isReportOpen) return null;

  const overall = summaryData?.overall;
  const summaries = summaryData?.summaries || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-[#0C081A]/80 backdrop-blur-sm transition-opacity"
        onClick={() => setReportOpen(false)}
      />

      <div className="relative glass-strong border border-[var(--border-default)] rounded-2xl w-full max-w-4xl shadow-2xl p-6 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-[radial-gradient(ellipse_at_center,rgba(0,240,255,0.1)_0%,transparent_70%)] blur-2xl pointer-events-none" />

        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[var(--accent-cyan)]" />
              Attendance Summary
            </h2>
            {summaryData && (
              <p className="text-sm mt-1 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                <CalendarDays className="w-4 h-4" />
                {format(parseISO(summaryData.period_start), "do MMM yyyy")} — {format(parseISO(summaryData.period_end), "do MMM yyyy")}
              </p>
            )}
          </div>
          <button
            onClick={() => setReportOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--surface-glass-strong)] transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label="Close report"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Preset Selector */}
        <div className="flex flex-wrap gap-2 mb-5 pb-4" style={{ borderBottom: "1px solid var(--border-glass)" }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setActivePreset(p.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-all",
                activePreset === p.id
                  ? "bg-[var(--surface-glass-strong)] text-[var(--text-primary)] shadow-sm ring-1 ring-white/10"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              )}
            >
              {p.icon}
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
              accent="var(--accent-cyan)"
            />
            <StatCard
              title="Present"
              value={overall.overall_present}
              icon={<CheckCircle className="w-4 h-4" />}
              accent="var(--accent-emerald)"
            />
            <StatCard
              title="Absent"
              value={overall.overall_absent}
              icon={<XCircle className="w-4 h-4" />}
              accent="var(--accent-flare)"
            />
            <StatCard
              title="Attendance %"
              value={`${overall.overall_percentage}%`}
              icon={<TrendingUp className="w-4 h-4" />}
              accent={overall.overall_percentage >= 75 ? "var(--accent-emerald)" : overall.overall_percentage >= 50 ? "var(--accent-amber)" : "var(--accent-flare)"}
            />
          </div>
        )}

        {/* Student Breakdown */}
        <div className="overflow-auto no-scrollbar flex-grow">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="flex flex-col items-center gap-4 opacity-50">
                <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: "var(--border-glass)", borderTopColor: "var(--accent-cyan)" }} />
                <p className="text-sm text-[var(--text-muted)]">Loading summary...</p>
              </div>
            </div>
          ) : summaries.length === 0 ? (
            <div className="text-center py-10" style={{ color: "var(--text-muted)" }}>
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No attendance data for selected period</p>
            </div>
          ) : (
            <table className="w-full border-separate" style={{ borderSpacing: "4px" }}>
              <thead>
                <tr>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] p-2 sticky left-0 bg-[#0C081A]/60 backdrop-blur" style={{ fontFamily: "var(--font-mono)" }}>
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
                    <td className="text-sm font-medium p-2 sticky left-0 bg-[#0C081A]/60 backdrop-blur whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                      {s.student_name}
                    </td>
                    <td className="p-0">
                      <div className="w-full min-h-[36px] rounded-lg flex items-center justify-center text-[11px] font-bold transition-colors num" style={{ color: "var(--accent-emerald)" }}>
                        {s.present}
                      </div>
                    </td>
                    <td className="p-0">
                      <div className="w-full min-h-[36px] rounded-lg flex items-center justify-center text-[11px] font-bold transition-colors num" style={{ color: "var(--accent-flare)" }}>
                        {s.absent}
                      </div>
                    </td>
                    <td className="p-0">
                      <div className="w-full min-h-[36px] rounded-lg flex items-center justify-center text-[11px] font-bold transition-colors num" style={{ color: "var(--accent-amber)" }}>
                        {s.late}
                      </div>
                    </td>
                    <td className="p-0">
                      <div className="w-full min-h-[36px] rounded-lg flex items-center justify-center text-[11px] font-bold transition-colors num" style={{ color: "var(--accent-cyan)" }}>
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
                        color: s.percentage >= 75 ? "var(--accent-emerald)" : s.percentage >= 50 ? "var(--accent-amber)" : "var(--accent-flare)" 
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
        <div className="flex flex-wrap items-center gap-4 mt-5 pt-4" style={{ borderTop: "1px solid var(--border-glass)" }}>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent-emerald)" }} aria-hidden="true" />
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Present</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent-flare)" }} aria-hidden="true" />
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Absent</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent-amber)" }} aria-hidden="true" />
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Late</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent-cyan)" }} aria-hidden="true" />
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