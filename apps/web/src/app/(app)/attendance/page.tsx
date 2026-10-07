// Implements: 06_Attendance.md §Mark (daily session marking is the primary
// action, and it is the first paint); AGENTS.md §2 Rule 4 as amended 2026-10-07
// — `/attendance` is one of the five screen routes. 16_Platform_Delivery_Sequence.md §W1.
//
// THE ROUTE IS THE SCREEN. See `app/(app)/dashboard/page.tsx` for why each
// screen is its own `page.tsx`. This one is Attendance.
//
// NO DATA PREFETCH ON THIS ROUTE, AND THAT IS A DELIBERATE OMISSION RATHER THAN
// AN OVERSIGHT. The screen's query key is `['attendance', selectedDateIso,
// selectedBatch]`, and `selectedDateIso` is PERSISTED tutor state, not route
// state (`stores/attendance-store.ts:32`). The server cannot know it and the
// browser cannot be told: prefetching under the server's own date would mean one
// gateway read whose result is thrown away whenever the tutor's stored date is
// not today, and rendering under it would mean the server shipped one day's marks
// while the browser asked for another's. Guessing here would render the WRONG
// DAY with full confidence — the one thing a daily-marking screen must never do.
//
// THE BODY IS SERVER-RENDERED AGAIN. It was briefly `ssr: false` behind a
// wrapper, because the store restores its persisted slice synchronously before
// first paint while the server has no `sessionStorage` — a structural hydration
// mismatch on every load, which AGENTS.md §16 makes a release blocker. The store
// now sets `skipHydration: true` and `AttendanceClient` re-hydrates in an effect,
// so the first client render agrees with the server markup and this screen is
// genuinely server-rendered. The wrapper that documented the blocker is deleted;
// §0.2 — code that maps to nothing is deleted.
//
// Rule 10 still holds: the PIN gate, the 44px targets and the keyboard parity all
// live in `GlassShell`, which is chrome and is unaffected.

import type { Metadata } from "next";
import { AttendanceClient } from "@/components/attendance/attendance-client";

// See `app/(app)/dashboard/page.tsx` for why every screen route declares its own
// title in the server HTML.
export const metadata: Metadata = {
  title: "Attendance · BuddySaradhi",
};

export default function AttendancePage() {
  return <AttendanceClient />;
}