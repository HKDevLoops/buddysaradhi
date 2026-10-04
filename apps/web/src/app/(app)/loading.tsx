// Implements: AGENTS.md §2 Rule 10 (accessibility: status is announced, not implied)
// — 04_Dashboard.md §3, 13_UI_Guidelines.md §7.
//
// The highest useful loading boundary for the app group. Per Next.js 16
// (docs/01-app/03-api-reference/03-file-conventions/loading.md), `loading.js`
// is nested INSIDE `layout.js` and wraps `page.js` in a Suspense boundary — so
// `GlassShell`, the sync pill and the five-screen nav stay interactive while the
// dashboard streams in. That is the behaviour a tutor needs mid-session: they
// can still switch screens while a slow gateway call is in flight.
//
// The shape is dashboard-shaped (KPI strip, due-today rows, activity feed) so
// nothing jumps when data lands. A centred spinner is the generic default and is
// deliberately not used. All motion is delegated to the design system's
// `.skeleton`, which already collapses under both reduced-motion switches.

import { ScreenSkeleton } from "@/components/ui/screen-state";

export default function AppLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <ScreenSkeleton shape="dashboard" label="your dashboard" rows={6} />
    </div>
  );
}
