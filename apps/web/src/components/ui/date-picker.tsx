"use client";

// PRECISION VERDICT — `react-day-picker` removed from this call site; native
// `<input type="date">` replaces it. Native does what the module did: accepts a
// single `Date | undefined` and hands back a single `Date | undefined`, with a
// calendar the tutor can open, keyboard support and an accessible name for free
// (Ponytail rung 4 — the platform primitive IS the correct answer for a plain
// single-date field; there is no range selection and no multi-month affordance
// here for a module to justify). It is equivalent because the only consumer,
// `add-student-sheet.tsx`, asks for one date in and one date out; the rendered
// value is produced with `localDateToInputValue`, which formats the SAME local
// calendar day `DayPicker` returned, so no date can shift by a day in either
// direction. It is also strictly better on two axes the module did not handle:
// the OS picker is localised and gets the mobile wheel, and the control is a
// real form element, so the caller's `<label htmlFor>` finally binds without the
// `aria-label` workaround that existed only because the trigger was a `<button>`.

import * as React from "react";

import { cn } from "@/lib/utils";

interface DatePickerProps {
  date: Date | undefined;
  setDate: (date: Date | undefined) => void;
  className?: string;
  placeholder?: string;
  /**
   * The caller's `<label htmlFor>` needs an `id` to bind. It used to be
   * mandatory because the trigger was a `<button>` carrying no implicit
   * accessible name (WCAG 1.3.1 / 4.1.2); on a native input the binding works
   * the same way, so the prop stays and the caller contract is unchanged.
   */
  id?: string;
  "aria-label"?: string;
}

/**
 * Local calendar day -> `yyyy-mm-dd`. Deliberately NOT `toISOString()`: that
 * converts to UTC first, so a date picked at local midnight in IST (UTC+5:30)
 * serialises as the PREVIOUS day. `getFullYear`/`getMonth`/`getDate` read the
 * local calendar day the tutor actually clicked.
 */
function localDateToInputValue(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** `yyyy-mm-dd` -> local midnight `Date`, the same instant shape `DayPicker` returned. */
function inputValueToLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, yyyy, mm, dd] = match;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

export function DatePicker({
  date,
  setDate,
  className,
  placeholder = "Pick a date",
  id,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  return (
    <input
      type="date"
      id={id}
      aria-label={ariaLabel ?? placeholder}
      value={date ? localDateToInputValue(date) : ""}
      onChange={(event) => setDate(inputValueToLocalDate(event.target.value))}
      className={cn(
        "glass-input appearance-none",
        !date && "text-[var(--text-muted)]",
        className
      )}
    />
  );
}