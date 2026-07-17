"use client";

import React from "react";
import { AttendanceStatus } from "@buddysaradhi/shared";
import { Check, X, Clock, Plane } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_ORDER: AttendanceStatus[] = ["present", "absent", "late", "excused"];

const STATUS_META: Record<
  AttendanceStatus,
  { label: string; short: string; accent: string; glow: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  present: { label: "Present", short: "P", accent: "var(--accent-emerald)", glow: "rgba(0,255,157,0.55)", Icon: Check },
  absent: { label: "Absent", short: "A", accent: "var(--accent-flare)", glow: "rgba(255,94,0,0.55)", Icon: X },
  late: { label: "Late", short: "L", accent: "var(--accent-amber)", glow: "rgba(255,179,0,0.55)", Icon: Clock },
  excused: { label: "Leave", short: "Lv", accent: "var(--accent-cyan)", glow: "rgba(0,240,255,0.55)", Icon: Plane },
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
          background: meta ? `color-mix(in srgb, ${meta.accent} 14%, transparent)` : "var(--surface-glass-faint)",
          border: `1px solid ${meta ? `color-mix(in srgb, ${meta.accent} 40%, transparent)` : "var(--border-glass)"}`,
          color: meta ? meta.accent : "var(--text-muted)",
        }}
        title={meta ? `${studentName}: ${meta.label}` : `${studentName}: Unmarked`}
      >
        {meta && <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.accent }} />}
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
              "min-w-[44px] min-h-[44px] px-2.5 rounded-full flex flex-col items-center justify-center gap-0.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0C081A]",
              active ? "neumo-raised" : "opacity-55 hover:opacity-100"
            )}
            style={
              active
                ? {
                    color: meta.accent,
                    boxShadow: `0 0 14px ${meta.glow}, inset 0 1px 1px rgba(255,255,255,0.12)`,
                  }
                : { color: "var(--text-muted)" }
            }
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
            <span className="text-[10px] font-semibold leading-none">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
