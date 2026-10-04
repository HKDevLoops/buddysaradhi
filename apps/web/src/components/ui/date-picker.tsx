"use client";

import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface DatePickerProps {
  date: Date | undefined;
  setDate: (date: Date | undefined) => void;
  className?: string;
  placeholder?: string;
  /**
   * The trigger is a `<button>`, not an `<input>`, so it carries no implicit
   * accessible name. A caller's `<label htmlFor>` can only bind if the trigger
   * accepts an `id` — without this, the Admission Date field on the Add Student
   * sheet had a visible label and no accessible name at all (WCAG 1.3.1 / 4.1.2).
   */
  id?: string;
  "aria-label"?: string;
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
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={"outline"}
          id={id}
          aria-label={ariaLabel ?? (date ? `Date: ${format(date, "PPP")}` : placeholder)}
          className={cn(
            "w-full justify-start text-left font-normal bg-[var(--surface-inset)] border-[var(--border-default)] hover:bg-[var(--surface-overlay)] hover:text-[var(--text-primary)] text-[var(--text-primary)]",
            !date && "text-[var(--text-muted)]",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 border-[var(--border-default)] bg-[var(--surface-scrim)] backdrop-blur-xl">
        <Calendar
          mode="single"
          selected={date}
          onSelect={setDate}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
