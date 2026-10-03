/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateSettingAction } from "@/server/actions/settings";
import { Clock, CalendarDays, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

import type { Settings } from "@/types/settings";

interface AttendanceRulesSectionProps {
  settings: Settings;
}

export function AttendanceRulesSection({ settings }: AttendanceRulesSectionProps) {
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: unknown }) => {
      const res = await updateSettingAction(field, value);
      if (!res.success) throw new Error(res.error || "Update failed");
    },
    onMutate: async ({ field, value }) => {
      await queryClient.cancelQueries({ queryKey: ["settings"] });
      const previousSettings = queryClient.getQueryData(["settings"]);
      queryClient.setQueryData(["settings"], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          data: {
            ...old.data,
            [field]: value,
          },
        };
      });
      return { previousSettings };
    },
    onError: (err, variables, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(["settings"], context.previousSettings);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = settings as any;
  const attendanceLockHours = s?.attendance_lock_hours ?? s?.attendanceLockHours ?? 48;
  const defaultAttendanceStatus = s?.default_attendance_status ?? s?.defaultAttendanceStatus ?? "present";

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-[var(--info)]" />
          Attendance Window
        </h3>

        <div className="glass-card p-6 rounded-xl space-y-4">
          <div>
            <label className="block text-sm font-semibold text-[var(--text-primary)] mb-1">Lock Attendance After</label>
            <p className="text-xs text-[var(--text-muted)] mb-3">Time window after a session ends where tutors can modify attendance before it becomes immutable.</p>

            <div className="relative w-full sm:w-64">
              <select
                value={attendanceLockHours}
                onChange={(e) => updateMutation.mutate({ field: "attendanceLockHours", value: parseInt(e.target.value) })}
                aria-label="Lock attendance after"
                className="neumo-inset w-full pl-4 pr-10 py-3 text-sm text-[var(--text-primary)] rounded-xl appearance-none cursor-pointer focus:outline-none focus:border-[var(--info)]"
              >
                <option value={12} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">12 Hours</option>
                <option value={24} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">24 Hours</option>
                <option value={48} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">48 Hours (Default)</option>
                <option value={72} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">72 Hours</option>
                <option value={168} className="bg-[var(--surface-raised)] text-[var(--text-primary)]">7 Days</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[var(--text-secondary)]">
                <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-[var(--success)]" />
          Default Status
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => updateMutation.mutate({ field: "defaultAttendanceStatus", value: "present" })}
            aria-pressed={defaultAttendanceStatus === "present"}
            className={cn(
              "glass-card p-5 rounded-xl flex items-center gap-4 transition-all cursor-pointer border text-left",
              defaultAttendanceStatus === "present"
                ? "border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_15%,transparent)] shadow-[0_0_18px_color-mix(in_srgb,var(--success)_20%,transparent)]"
                : "border-transparent bg-[var(--surface-inset)] hover:bg-[var(--surface-raised)] hover:border-[var(--border-default)]"
            )}
          >
            <CheckCircle2 className={cn("w-6 h-6 shrink-0 transition-transform", defaultAttendanceStatus === "present" ? "text-[var(--success)] scale-110" : "text-[var(--text-muted)]")} />
            <div className="text-left">
              <p className={cn("text-sm font-semibold", defaultAttendanceStatus === "present" ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>Mark Present</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Students are present by default</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => updateMutation.mutate({ field: "defaultAttendanceStatus", value: "absent" })}
            aria-pressed={defaultAttendanceStatus === "absent"}
            className={cn(
              "glass-card p-5 rounded-xl flex items-center gap-4 transition-all cursor-pointer border text-left",
              defaultAttendanceStatus === "absent"
                ? "border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] shadow-[0_0_18px_color-mix(in_srgb,var(--danger)_20%,transparent)]"
                : "border-transparent bg-[var(--surface-inset)] hover:bg-[var(--surface-raised)] hover:border-[var(--border-default)]"
            )}
          >
            <XCircle className={cn("w-6 h-6 shrink-0 transition-transform", defaultAttendanceStatus === "absent" ? "text-[var(--danger)] scale-110" : "text-[var(--text-muted)]")} />
            <div className="text-left">
              <p className={cn("text-sm font-semibold", defaultAttendanceStatus === "absent" ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>Mark Absent</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Students are absent by default</p>
            </div>
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-[var(--info)]" />
          Global Holidays
        </h3>
        <div className="glass-card p-6 rounded-xl text-center">
          <p className="text-sm text-[var(--text-secondary)] mb-4 leading-relaxed">Set institute-wide holidays where no attendance is tracked and fees may be prorated.</p>
          <button className="neumo-raised px-5 py-2.5 rounded-xl text-sm font-semibold text-[var(--info)] cursor-pointer">
            Configure Holiday Calendar
          </button>
        </div>
      </div>
    </section>
  );
}
