"use client";

// Implements: 08_Settings.md §6.2.5 (four per-category toggles, default on) and
// §10 BR-RPT-01..R05; 13_UI_Guidelines.md §6.4 (toggle anatomy) + §10 (state is
// never colour alone — each row names its category in words); AGENTS.md §2
// Rule 10 + §6.1 (no `any`).
//
// REPORTED, NOT IMPLEMENTED: nothing in the app reads `notify_*` yet — there is
// no reminder engine consuming these four flags, so a toggle here changes a
// stored value and no notification changes with it (BR-RPT-01..R05 unimplemented
// at the engine, which is not this lane's file). Each row therefore says what it
// is for, and the section does not claim reminders are being sent.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateSettingAction } from "@/server/actions/settings";
import { Bell, FileWarning, Clock, UserMinus, Receipt } from "lucide-react";
import { NeumoToggle } from "./neumo-toggle";

import type { Settings } from "@/types/settings";

interface NotificationsSectionProps {
  settings: Settings;
}

export function NotificationsSection({ settings }: NotificationsSectionProps) {
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: unknown }) => {
      const res = await updateSettingAction(field, value);
      if (!res.success) throw new Error(res.error || "Could not save that change.");
    },
    onMutate: async ({ field, value }) => {
      await queryClient.cancelQueries({ queryKey: ["settings"] });
      const previous = queryClient.getQueryData<{ data?: Record<string, unknown> }>(["settings"]);
      queryClient.setQueryData(["settings"], (old: { data?: Record<string, unknown> } | undefined) => {
        if (!old) return old;
        return { ...old, data: { ...(old.data ?? {}), [field]: value } };
      });
      return { previous };
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(["settings"], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const notifyDueFee = settings?.notifyDueFee !== 0;
  const notifyUpcomingDue = settings?.notifyUpcomingDue !== 0;
  const notifyMissingAttendance = settings?.notifyMissingAttendance !== 0;
  const notifyInactiveStudent = settings?.notifyInactiveStudent !== 0;

  const rows = [
    { field: "notifyDueFee", icon: FileWarning, title: "Overdue Fees", desc: "When a fee passes its due date and its grace period." },
    { field: "notifyUpcomingDue", icon: Receipt, title: "Upcoming Due Dates", desc: "Three days before a fee is due." },
    { field: "notifyMissingAttendance", icon: Clock, title: "Missing Attendance", desc: "A scheduled session finished with nobody marked." },
    { field: "notifyInactiveStudent", icon: UserMinus, title: "Inactive Students", desc: "A student who has not attended in 14 days." },
  ] as const;

  const values: Record<string, boolean> = {
    notifyDueFee,
    notifyUpcomingDue,
    notifyMissingAttendance,
    notifyInactiveStudent,
  };

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-1 flex items-center gap-2">
          <Bell className="w-5 h-5 text-[var(--accent-primary)]" aria-hidden="true" />
          Notification Preferences
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-5 max-w-[68ch]">
          Which events are worth telling you about. In-app only: this build sends nothing to your
          phone, your email or anyone else&apos;s server.
        </p>

        {toggleMutation.isError && (
          <p role="alert" className="text-[var(--danger)] text-sm font-semibold mb-4">
            {toggleMutation.error instanceof Error
              ? toggleMutation.error.message
              : "Nothing was saved."}
          </p>
        )}

        <div className="space-y-3 max-w-2xl">
          {rows.map((row) => {
            const Icon = row.icon;
            const on = values[row.field];
            return (
              <div
                key={row.field}
                className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border-default)] p-4"
                style={{ background: "var(--surface-inset)" }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon className="w-5 h-5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{row.title}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{row.desc}</p>
                  </div>
                </div>
                <NeumoToggle
                  label={row.title}
                  checked={on}
                  onChange={() => toggleMutation.mutate({ field: row.field, value: on ? 0 : 1 })}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
