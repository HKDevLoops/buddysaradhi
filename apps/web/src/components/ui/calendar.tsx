"use client";

// Implements: 13_UI_Guidelines.md §10 + AGENTS.md §2 Rule 10 (44x44px touch
// targets), `apps/web/DESIGN.md` §2.4 (touch targets >= 44px), and P15
// (accessibility is not optional). A date the tutor cannot reliably hit is a
// date they will guess — and a wrong attendance date is a wrong ledger.
//
// THE 44px FLOOR, WITHOUT BREAKING THE MONTH GRID. Every cell here was
// `h-7 w-7` (nav) and `h-9 w-9` (day) — 28px and 36px, both under the floor. The
// obvious worry is that a month grid of 7 x 44px "breaks the calendar", and it
// does not: 7 x 44 = 308px plus the 12px padding already on the wrapper, which
// fits the narrowest phone width this app supports. The grid grows; the month
// grid stays a month grid. What is not acceptable is a documented exception,
// because a date picker is one of the highest-frequency touch targets in the
// app and the exception would be read as "we knew and left it".
//
// The day CELL and the day BUTTON are both sized: the cell is the hit area the
// tutor aims at, the button is the focus ring. Sizing only the button would
// leave a 36px target with a 44px ring around it, which is worse than either.

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/** 44px — the AGENTS.md §2 Rule 10 floor, stated once. */
const TOUCH = "h-11 w-11";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          // Month navigation is a control, not decoration: it was 28px.
          `${TOUCH} bg-transparent p-0 opacity-70 hover:opacity-100 text-[var(--text-primary)] border-[var(--border-default)]`
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell: `text-[var(--text-muted)] rounded-md font-normal text-[0.8rem] w-11`,
        row: "flex w-full mt-2",
        cell: `${TOUCH} text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-[var(--surface-inset)] [&:has([aria-selected])]:bg-[var(--surface-inset)] first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20`,
        day: cn(
          buttonVariants({ variant: "ghost" }),
          `${TOUCH} p-0 font-normal aria-selected:opacity-100 hover:bg-[var(--surface-overlay)] hover:text-[var(--text-primary)]`
        ),
        day_range_end: "day-range-end",
        day_selected:
          "bg-[var(--info)] text-black hover:bg-[var(--info)] hover:text-black focus:bg-[var(--info)] focus:text-black",
        day_today: "bg-[var(--surface-overlay)] text-[var(--text-primary)]",
        day_outside:
          "day-outside text-[var(--text-muted)] opacity-70 opacity-50 aria-selected:bg-[var(--accent-primary)] aria-selected:text-[var(--accent-on-primary)] opacity-50 aria-selected:text-[var(--accent-on-primary)] aria-selected:opacity-30",
        day_disabled: "text-[var(--text-muted)] opacity-70 opacity-50",
        day_range_middle:
          "aria-selected:bg-[var(--accent-primary)] aria-selected:text-[var(--accent-on-primary)]",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: () => <ChevronLeft className="h-4 w-4" />,
        IconRight: () => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
