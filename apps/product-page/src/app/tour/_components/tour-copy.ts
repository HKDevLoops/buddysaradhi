// Implements: 20_3D_Product_Page.md §12 (5-beat narrative) for the `/tour`
// route. The stops walk the five screens in order - the mechanism language is
// the same audited copy as the `/` facts (no headcounts, no durations, no
// invented benchmarks). Pure data: the server page renders it as a static list
// (SEO, no-JS) and the client stage renders it as the pinned overlay.

export interface TourStop {
  readonly id: string;
  readonly pin: string;
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
}

export const TOUR_STOPS = [
  {
    id: "dashboard",
    pin: "Dashboard",
    kicker: "Stop 1 of 5.",
    title: "The month at a glance.",
    body: "Collected, due, and what is due today. One screen answers the only question month end asks.",
  },
  {
    id: "students",
    pin: "Students",
    kicker: "Stop 2 of 5.",
    title: "Every student in one roster.",
    body: "Every batch, one list you can search without leaving the screen.",
  },
  {
    id: "attendance",
    pin: "Attendance",
    kicker: "Stop 3 of 5.",
    title: "One tap marks the batch.",
    body: "The next tap locks the day, and the record is authoritative from then on.",
  },
  {
    id: "fees",
    pin: "Fees",
    kicker: "Stop 4 of 5.",
    title: "Every fee recorded.",
    body: "Every receipt numbered in order, nothing editable after the fact.",
  },
  {
    id: "settings",
    pin: "Settings",
    kicker: "Stop 5 of 5.",
    title: "Yours outright.",
    body: "Backup, PIN, and your data under your control. The screen that keeps the other four honest.",
  },
] as const satisfies readonly TourStop[];

export const TOUR_IDS: readonly string[] = TOUR_STOPS.map((s) => s.id);
