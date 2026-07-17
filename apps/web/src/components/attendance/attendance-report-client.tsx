"use client";

import { useAttendanceStore } from "@/stores/attendance-store";
import { type StudentAttendanceRow, type AttendanceStatus } from "@buddysaradhi/shared";
import { X, BarChart3, CalendarDays } from "lucide-react";
import { format, parseISO, startOfWeek } from "date-fns";
import { cn } from "@/lib/utils";

const CELL_META: Record<AttendanceStatus, { label: string; short: string; accent: string }> = {
  present: { label: "Present", short: "P", accent: "var(--accent-emerald)" },
  absent: { label: "Absent", short: "A", accent: "var(--accent-flare)" },
  late: { label: "Late", short: "L", accent: "var(--accent-amber)" },
  excused: { label: "Leave", short: "Lv", accent: "var(--accent-cyan)" },
};

interface AttendanceReportClientProps {
  records: StudentAttendanceRow[];
  selectedDateIso: string;
}

export function AttendanceReportClient({ records, selectedDateIso }: AttendanceReportClientProps) {
  const { isReportOpen, setReportOpen } = useAttendanceStore();

  if (!isReportOpen) return null;

  // Heatmap: students (rows) × the 7 days of the selected week (columns).
  // Only the selected date carries real data; the rest are shown neutral (no data).
  const weekStart = startOfWeek(parseISO(selectedDateIso), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });
  const weekIso = weekDays.map((d) => format(d, "yyyy-MM-dd"));
  const statusByStudent = new Map(records.map((r) => [r.student_id, r.status]));
  const selectedIso = selectedDateIso;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-[#0C081A]/80 backdrop-blur-sm transition-opacity"
        onClick={() => setReportOpen(false)}
      />

      <div className="relative glass-strong border border-[var(--border-default)] rounded-2xl w-full max-w-3xl shadow-2xl p-6 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-[radial-gradient(ellipse_at_center,rgba(0,240,255,0.1)_0%,transparent_70%)] blur-2xl pointer-events-none" />

        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[var(--accent-cyan)]" />
              Attendance Report
            </h2>
            <p className="text-sm mt-1 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
              <CalendarDays className="w-4 h-4" />
              Week of {format(weekStart, "do MMM yyyy")}
            </p>
          </div>
          <button
            onClick={() => setReportOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--surface-glass-strong)] transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label="Close report"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-auto no-scrollbar flex-grow">
          <table className="w-full border-separate" style={{ borderSpacing: "4px" }}>
            <thead>
              <tr>
                <th className="text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] p-2 sticky left-0 bg-[#0C081A]/60 backdrop-blur">
                  Student
                </th>
                {weekDays.map((d, i) => {
                  const iso = weekIso[i];
                  const isSel = iso === selectedIso;
                  return (
                    <th
                      key={iso}
                      className="text-center text-xs font-medium p-1"
                      style={{
                        color: isSel ? "var(--accent-cyan)" : "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      <div>{format(d, "EEE")}</div>
                      <div className="num">{format(d, "d")}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.student_id}>
                  <td className="text-sm font-medium p-2 sticky left-0 bg-[#0C081A]/60 backdrop-blur whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                    {record.name}
                  </td>
                  {weekIso.map((iso) => {
                    const status = iso === selectedIso ? statusByStudent.get(record.student_id) ?? null : null;
                    const meta = status ? CELL_META[status] : null;
                    return (
                      <td key={iso} className="p-0">
                        <div
                          className={cn(
                            "w-full min-h-[40px] rounded-lg flex items-center justify-center text-[11px] font-bold transition-colors",
                            meta ? "neumo-raised" : "border border-dashed"
                          )}
                          style={
                            meta
                              ? {
                                  color: meta.accent,
                                  boxShadow: `0 0 10px color-mix(in srgb, ${meta.accent} 30%, transparent)`,
                                }
                              : { borderColor: "var(--border-glass)", color: "var(--text-muted)" }
                          }
                          title={meta ? `${record.name}: ${meta.label}` : `${record.name}: no data`}
                          aria-label={meta ? `${record.name} ${meta.label}` : `${record.name} no data`}
                        >
                          {meta ? meta.short : "—"}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend — color is never the only signal */}
        <div className="flex flex-wrap items-center gap-4 mt-5 pt-4" style={{ borderTop: "1px solid var(--border-glass)" }}>
          {Object.values(CELL_META).map((m) => (
            <div key={m.label} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: m.accent }} aria-hidden="true" />
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                {m.label}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full border border-dashed" style={{ borderColor: "var(--border-glass)" }} aria-hidden="true" />
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              No data
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
