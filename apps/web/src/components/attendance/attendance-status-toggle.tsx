"use client";

// Implements: UI/web/05_Attendance.md — the per-student attendance control.
// AGENTS.md §2 Rule 10 — this is the densest interactive target on the screen (four
// 44×44 segments per student), so contrast is verified here rather than assumed: the
// unselected segments read `--text-secondary` at full opacity, with an accent fill plus
// the raised (`neumo-raised`) pressed state carrying "this is the mark" — an icon and a
// word carry the meaning, never the accent alone.
import React from "react";
import { AttendanceStatus } from "@buddysaradhi/shared";
import { Check, X, Clock, Plane } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_ORDER: AttendanceStatus[] = ["present", "absent", "late", "excused"];

// Labels are the BR-ATT-02 vocabulary verbatim (`present | absent | late |
// excused`), so the word on the control, the column in the summary table and the
// `status` written to `attendance_records` are all the same string. The grid
// called this "Leave" while the audit log and the schema said `excused`, so a
// tutor reading "Leave" in one place and "excused" in another had to guess
// whether they were the same status. "Excused" is what 06 §6.1/§10.2 and
// BR-ATT-02 print; the prose that needs the Indian-English sense says
// "on leave" instead.
const STATUS_META: Record<
  AttendanceStatus,
  { label: string; short: string; accent: string; glow: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  present: { label: "Present", short: "P", accent: "var(--success)", glow: "color-mix(in srgb, var(--success) 0.55, transparent)", Icon: Check },
  absent: { label: "Absent", short: "A", accent: "var(--danger)", glow: "color-mix(in srgb, var(--danger) 0.55, transparent)", Icon: X },
  late: { label: "Late", short: "L", accent: "var(--warning)", glow: "color-mix(in srgb, var(--warning) 0.55, transparent)", Icon: Clock },
  excused: { label: "Excused", short: "E", accent: "var(--info)", glow: "color-mix(in srgb, var(--info) 0.55, transparent)", Icon: Plane },
};

interface AttendanceStatusToggleProps {
  status: AttendanceStatus | null;
  onChange: (newStatus: AttendanceStatus) => void;
  isLocked: boolean;
  studentName: string;
}

export function AttendanceStatusToggle({ status, onChange, isLocked, studentName }: AttendanceStatusToggleProps) {
  if (isLocked) {
    const meta = status ? STATUS_META[status] : null;
    return (
      <div
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
        style={{
          background: meta ? `color-mix(in srgb, ${meta.accent} 14%, transparent)` : "var(--surface-inset)",
          border: `1px solid ${meta ? `color-mix(in srgb, ${meta.accent} 40%, transparent)` : "var(--border-default)"}`,
          color: meta ? meta.accent : "var(--text-muted)",
        }}
        title={meta ? `${studentName}: ${meta.label}` : `${studentName}: Unmarked`}
      >
        {meta && <meta.Icon className="w-3.5 h-3.5" aria-hidden="true" />}
        {meta && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ background: meta.accent }} />}
        {meta ? meta.label : "Unmarked"}
      </div>
    );
  }

  return (
    // Neumorphic well (inset) holds the raised active segment — never invert glass/neumorphic roles.
    <div
      role="group"
      aria-label={`Mark ${studentName} attendance`}
      className="neumo-inset rounded-full p-1 inline-flex gap-1"
    >
      {STATUS_ORDER.map((s) => {
        const meta = STATUS_META[s];
        const active = status === s;
        const Icon = meta.Icon;
        return (
          <button
            key={s}
            type="button"
            disabled={isLocked}
            aria-pressed={active}
            aria-label={`Mark ${studentName} ${meta.label}`}
            onClick={() => onChange(s)}
            className={cn(
              "min-w-[44px] min-h-[44px] px-2.5 rounded-full flex flex-col items-center justify-center gap-0.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]",
              // The unselected segments used to sit at `opacity-55` on `--text-muted`,
              // which put the 10px label below the 4.5:1 body-text floor (AGENTS.md §2
              // Rule 10). The dimming was doing no work the raised active segment does
              // not already do: the accent fill plus the pressed state are the signal.
              // Contrast now comes from a full-opacity foreground token instead of an
              // alpha, so a palette change is measured by the contrast gate rather than
              // guessed at.
              active ? "neumo-raised" : "hover:bg-[var(--surface-overlay)]"
            )}
            style={
              active
                ? {
                    color: meta.accent,
                    boxShadow: `0 0 14px ${meta.glow}, inset 0 1px 1px rgba(255,255,255,0.12)`,
                  }
                : { color: "var(--text-secondary)" }
            }
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
            <span className="text-[11px] font-semibold leading-none">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
