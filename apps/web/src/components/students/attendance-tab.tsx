import React from "react";
import { format } from "date-fns";
import { CalendarCheck } from "lucide-react";

interface AttendanceTabProps {
  studentId: string;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function makeRng(seedStr: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mockStatus(date: Date, rng: () => number): number {
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  if (isWeekend) return 3; // no class
  const rand = rng();
  if (rand > 0.18) return 1; // present
  if (rand > 0.09) return 2; // late
  return 0; // absent
}

export function AttendanceTab({ studentId }: AttendanceTabProps) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();

  const cells: { day: number | null; date: Date | null; status: number }[] = [];
  const rng = makeRng(studentId);
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ day: null, date: null, status: -1 });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    cells.push({ day: d, date, status: mockStatus(date, rng) });
  }

  const monthDays = cells.filter((c) => c.date);
  const presentDays = monthDays.filter(
    (c) => c.status === 1 || c.status === 2
  ).length;
  const classDays = monthDays.filter((c) => c.status !== 3).length;
  const rate = classDays > 0 ? Math.round((presentDays / classDays) * 100) : 0;

  const statusColor = (status: number) => {
    switch (status) {
      case 1:
        return "bg-[var(--accent-emerald)]/80 shadow-[0_0_6px_rgba(0,255,157,0.35)]";
      case 2:
        return "bg-[var(--accent-amber)]/80";
      case 0:
        return "bg-[var(--accent-flare)]/80";
      default:
        return "bg-[var(--bg-surface-inset)]";
    }
  };
  const statusLabel = (status: number) =>
    status === 1
      ? "Present"
      : status === 2
      ? "Late"
      : status === 0
      ? "Absent"
      : "No Class";

  return (
    <div className="space-y-5">
      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4">
        <div
          className="p-4 rounded-xl border flex flex-col justify-between"
          style={{
            background: "var(--bg-surface-inset)",
            borderColor: "var(--border-default)",
          }}
        >
          <div className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
            {format(now, "MMMM yyyy")} Rate
          </div>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
              {rate}%
            </span>
            <span className="text-sm mb-1" style={{ color: "var(--text-muted)" }}>
              {presentDays}/{classDays} days
            </span>
          </div>
        </div>
        <div
          className="p-4 rounded-xl border flex flex-col justify-between"
          style={{
            background: "var(--bg-surface-inset)",
            borderColor: "var(--border-default)",
          }}
        >
          <div className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
            Last Attended
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              Today
            </span>
            <span className="text-sm font-medium" style={{ color: "var(--accent-success)" }}>
              On time
            </span>
          </div>
        </div>
      </div>

      {/* Mini calendar */}
      <div
        className="p-5 rounded-xl border space-y-4"
        style={{
          background: "var(--surface-glass-faint)",
          borderColor: "var(--border-default)",
        }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Attendance Calendar
          </h3>
          <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--accent-emerald)]/80" /> Present
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--accent-amber)]/80" /> Late
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--accent-flare)]/80" /> Absent
            </span>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1.5 text-center">
          {WEEKDAYS.map((w, i) => (
            <div
              key={i}
              className="text-xs font-semibold py-1"
              style={{ color: "var(--text-muted)" }}
            >
              {w}
            </div>
          ))}
          {cells.map((c, i) => (
            <div
              key={i}
              className={`aspect-square rounded-md flex items-center justify-center text-xs ${
                c.day ? statusColor(c.status) : ""
              } ${c.day ? "text-[var(--text-on-accent)]" : ""}`}
              style={!c.day ? { background: "transparent" } : undefined}
              title={
                c.date
                  ? `${format(c.date, "MMM d, yyyy")}: ${statusLabel(c.status)}`
                  : undefined
              }
            >
              {c.day ?? ""}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-center">
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors" style={{ background: "var(--bg-surface-inset)", borderColor: "var(--border-default)", color: "var(--text-secondary)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}>
          <CalendarCheck className="w-4 h-4" />
          Open in Attendance &rarr;
        </button>
      </div>
    </div>
  );
}
