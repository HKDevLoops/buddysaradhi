// Implements: 13_UI_Guidelines.md §8.20 (skeleton), §15.1 (loading
// orchestration) — the loading boundary for the `/dashboard` route.
//
// WHY THIS FILE EXISTS. One `loading.tsx` sat at the `(app)` group level and
// rendered the DASHBOARD skeleton for every one of the five screens, so a tutor
// opening `/students` saw a KPI strip and an activity feed, then the roster
// skeleton, then the roster: two layout shifts where §8.20 intends zero. Each
// route now owns a boundary whose shape is the one its own client component
// renders while it waits (`DashboardClient` → `shape="dashboard"`), so the
// skeleton and the screen agree.
//
// The boundary is still nested INSIDE `(app)/layout.tsx`, so the shell, the nav
// and the sync pill stay interactive while the screen streams in — the
// behaviour a tutor needs mid-session (Next.js 16 `loading.js` semantics).
//
// Motion is delegated to the design system's `.skeleton`, which already
// collapses under both reduced-motion switches (globals.css).

import { ScreenSkeleton } from "@/components/ui/screen-state";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <ScreenSkeleton shape="dashboard" label="your dashboard" rows={4} />
    </div>
  );
}
