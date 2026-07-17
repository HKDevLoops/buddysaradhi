"use client";

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
      await updateSettingAction(field, value);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  const notifyDueFee = settings?.notifyDueFee !== 0;
  const notifyUpcomingDue = settings?.notifyUpcomingDue !== 0;
  const notifyMissingAttendance = settings?.notifyMissingAttendance !== 0;
  const notifyInactiveStudent = settings?.notifyInactiveStudent !== 0;

  const rows = [
    { field: "notifyDueFee", icon: FileWarning, accent: "var(--accent-flare)", title: "Overdue Fees", desc: "Notify when a student's grace period expires." },
    { field: "notifyUpcomingDue", icon: Receipt, accent: "var(--accent-amber)", title: "Upcoming Due Dates", desc: "Notify 3 days before a fee is due." },
    { field: "notifyMissingAttendance", icon: Clock, accent: "var(--accent-cyan)", title: "Missing Attendance", desc: "Notify when a session ends but attendance isn't marked." },
    { field: "notifyInactiveStudent", icon: UserMinus, accent: "var(--accent-primary)", title: "Inactive Students", desc: "Notify when a student hasn't attended in 14 days." },
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
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Bell className="w-5 h-5 text-[var(--accent-primary)]" />
          Notification Preferences
        </h3>
        <p className="text-sm text-[var(--text-muted)] mb-6">Configure which events trigger an app notification.</p>

        <div className="space-y-3">
          {rows.map((row) => {
            const Icon = row.icon;
            const on = values[row.field];
            return (
              <div key={row.field} className="flex items-center justify-between glass-card p-5 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `color-mix(in srgb, ${row.accent} 12%, transparent)` }}>
                    <Icon className="w-5 h-5" style={{ color: row.accent }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{row.title}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">{row.desc}</p>
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
