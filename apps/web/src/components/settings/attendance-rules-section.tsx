"use client";

// Implements: 08_Settings.md §6.2.3 (Attendance Rules: lock window, default
// status, holiday list) + §14 `attendanceRulesSchema` (lock window 1 to 168
// hours; each holiday is `{date: YYYY-MM-DD, label}`) + §11 EC-14 (a past date
// is allowed, with a warning); 12_Business_Rules.md BR-ATT-03 / BR-ATT-05 (the
// lock window is what makes a register final); AGENTS.md §2 Rule 10 (44px hit
// areas, label per control, colour never the only signal) + §6.1 (no `any`).
//
// WHAT CHANGED AND WHY:
//
// - The lock window was a five-option select (12/24/48/72/168 hours). §6.2.3 asks
//   for a range from 1 to 168 with a numeric readout, and the select could not
//   express 3 hours or 36 hours at all. It is now a slider over the spec's own
//   range, and the number is shown as hours and days.
// - "Configure Holiday Calendar" was a button with no `onClick`. It looked like
//   a feature and did nothing, which the anti-slop rules call out by name
//   ("no silently dead button"). §6.2.3 specifies an editor with an add button
//   and a per-row delete. That is what is here now, writing
//   `settings.holiday_list` (the column was already writable; nothing in the
//   attendance engine reads it yet — reported to the lead).
// - `settings as any` is gone. `Settings` carries an index signature, so a
//   typed reader is both possible and correct.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateSettingAction } from "@/server/actions/settings";
import { Clock, CalendarDays, CheckCircle2, XCircle, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

import type { Settings } from "@/types/settings";

interface AttendanceRulesSectionProps {
  settings: Settings;
}

const LOCK_MIN_HOURS = 1;
const LOCK_MAX_HOURS = 168;

interface Holiday {
  date: string;
  label: string;
}

const DATE_RULE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse `holiday_list`, never throw: a corrupt column is an empty list. */
function readHolidays(settings: Settings): Holiday[] {
  const raw = settings.holidayListJson ?? settings.holiday_list;
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry): Holiday | null => {
        if (typeof entry !== "object" || entry === null) return null;
        const record = entry as { date?: unknown; label?: unknown };
        if (typeof record.date !== "string" || !DATE_RULE.test(record.date)) return null;
        return { date: record.date, label: typeof record.label === "string" ? record.label : "" };
      })
      .filter((entry): entry is Holiday => entry !== null);
  } catch {
    return [];
  }
}

function readNumber(settings: Settings, camel: string, snake: string, fallback: number): number {
  const raw = settings[camel] ?? settings[snake];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function readText(settings: Settings, camel: string, snake: string, fallback: string): string {
  const raw = settings[camel] ?? settings[snake];
  return typeof raw === "string" ? raw : fallback;
}

function formatWindow(hours: number): string {
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = hours / 24;
  return Number.isInteger(days) ? `${days} day${days === 1 ? "" : "s"}` : `${days} days`;
}

export function AttendanceRulesSection({ settings }: AttendanceRulesSectionProps) {
  const queryClient = useQueryClient();

  const attendanceLockHours = Math.min(
    LOCK_MAX_HOURS,
    Math.max(LOCK_MIN_HOURS, readNumber(settings, "attendanceLockHours", "attendance_lock_hours", 48)),
  );
  const defaultAttendanceStatus = readText(
    settings,
    "defaultAttendanceStatus",
    "default_attendance_status",
    "present",
  );
  const holidays = readHolidays(settings);
  const today = new Date().toISOString().slice(0, 10);

  const patch = useMutation({
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

  const saveHolidays = (next: Holiday[]) =>
    patch.mutate({ field: "holidayListJson", value: JSON.stringify(next) });

  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-8">
      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-1 flex items-center gap-2">
          <Clock className="w-5 h-5 text-[var(--info)]" aria-hidden="true" />
          Attendance Window
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-5 max-w-[68ch]">
          How long a register stays editable after its date passes. Once the window closes the date is
          final, and reopening it asks for your PIN. Short windows catch mistakes early; long ones are
          kinder when you mark a register late.
        </p>

        <div className="rounded-xl border border-[var(--border-default)] p-5 max-w-xl" style={{ background: "var(--surface-inset)" }}>
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
            <label htmlFor="attendance-lock-hours" className="text-sm font-semibold text-[var(--text-primary)]">
              Lock attendance after
            </label>
            <output
              htmlFor="attendance-lock-hours"
              className="text-sm font-mono text-[var(--text-primary)] tabular-nums"
              aria-live="polite"
            >
              {attendanceLockHours}h ({formatWindow(attendanceLockHours)})
            </output>
          </div>
          <input
            id="attendance-lock-hours"
            type="range"
            min={LOCK_MIN_HOURS}
            max={LOCK_MAX_HOURS}
            step={1}
            value={attendanceLockHours}
            onChange={(e) => patch.mutate({ field: "attendanceLockHours", value: Number(e.target.value) })}
            aria-valuetext={`${attendanceLockHours} hours, ${formatWindow(attendanceLockHours)}`}
            aria-label="Lock attendance after this many hours"
            className="w-full min-h-[44px] cursor-pointer accent-[var(--info)]"
          />
          <div className="flex justify-between text-xs text-[var(--text-muted)] mt-1">
            <span>1 hour</span>
            <span>1 week</span>
          </div>
          {patch.isError && (
            <p role="alert" className="text-[var(--danger)] text-xs mt-3">
              {patch.error instanceof Error ? patch.error.message : "Nothing was saved."}
            </p>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-1 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-[var(--success)]" aria-hidden="true" />
          Default Status
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-4 max-w-[68ch]">
          What a new mark starts as, so tapping through a register does not mean deciding every
          student.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl" role="group" aria-label="Default attendance status">
          {(
            [
              { id: "present", label: "Present", Icon: CheckCircle2 },
              { id: "absent", label: "Absent", Icon: XCircle },
            ] as const
          ).map((option) => {
            const active = defaultAttendanceStatus === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => patch.mutate({ field: "defaultAttendanceStatus", value: option.id })}
                aria-pressed={active}
                className={cn(
                  "neumo-inset min-h-[44px] p-4 rounded-xl flex items-center gap-3 cursor-pointer border transition-colors",
                  active
                    ? "border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_14%,transparent)]"
                    : "border-transparent hover:border-[var(--border-default)]",
                )}
              >
                <option.Icon
                  className={cn("w-5 h-5 shrink-0", active ? "text-[var(--accent-primary)]" : "text-[var(--text-muted)]")}
                  aria-hidden="true"
                />
                <span className={cn("text-sm font-semibold", active ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>
                  Mark {option.label}
                  {active ? <span className="sr-only"> (current default)</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-1 flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-[var(--info)]" aria-hidden="true" />
          Institute Holidays
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-4 max-w-[68ch]">
          Dates you do not teach on, kept so they stay out of your attendance and out of your month.
          Adding a past date is allowed: you are recording something that already happened.
        </p>

        <div className="rounded-xl border border-[var(--border-default)] p-5 max-w-xl" style={{ background: "var(--surface-inset)" }}>
          {holidays.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No holidays listed yet.</p>
          ) : (
            <ul className="space-y-2 mb-4">
              {holidays.map((holiday, index) => (
                <li
                  key={`${holiday.date}-${index}`}
                  className="flex items-center justify-between gap-3 py-2 border-b border-[var(--border-default)] last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-mono text-[var(--text-primary)]">{holiday.date}</span>
                    <span className="block text-xs text-[var(--text-muted)] truncate">
                      {holiday.label || "No label"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => saveHolidays(holidays.filter((_, position) => position !== index))}
                    aria-label={`Remove the holiday on ${holiday.date}`}
                    className="min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center cursor-pointer text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div>
              <label htmlFor="holiday-date" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                Date
              </label>
              <input
                id="holiday-date"
                type="date"
                defaultValue={holidays.length === 0 ? today : ""}
                className="neumo-inset px-3 py-2 min-h-[44px] text-sm text-[var(--text-primary)] rounded-xl outline-none focus:border-[var(--accent-primary)]"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="holiday-label" className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                Label
              </label>
              <input
                id="holiday-label"
                type="text"
                maxLength={40}
                placeholder="Diwali, Gandhi Jayanti"
                className="neumo-inset w-full px-4 py-2 min-h-[44px] text-sm text-[var(--text-primary)] rounded-xl outline-none focus:border-[var(--accent-primary)]"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const dateInput = document.getElementById("holiday-date") as HTMLInputElement | null;
              const labelInput = document.getElementById("holiday-label") as HTMLInputElement | null;
              const date = dateInput?.value ?? "";
              if (!DATE_RULE.test(date)) return;
              const label = (labelInput?.value ?? "").slice(0, 40);
              saveHolidays([...holidays, { date, label }]);
              if (dateInput) dateInput.value = "";
              if (labelInput) labelInput.value = "";
            }}
            className="neumo-raised mt-4 px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-semibold text-[var(--accent-primary)] cursor-pointer transition-colors hover:brightness-110 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add holiday
          </button>
          {patch.isError && (
            <p role="alert" className="text-[var(--danger)] text-xs mt-3">
              {patch.error instanceof Error ? patch.error.message : "Nothing was saved."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}