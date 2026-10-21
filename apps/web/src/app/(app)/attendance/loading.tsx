// Implements: 13_UI_Guidelines.md §8.20 (skeleton), §15.1 (loading
// orchestration) — the loading boundary for the `/attendance` route.
//
// The shape is the roster, because that is what `AttendanceGrid` renders while
// it waits (`shape="roster"`, `rows={6}`). The group-level boundary that used
// to answer for every screen rendered the DASHBOARD skeleton here instead.

import { ScreenSkeleton } from "@/components/ui/screen-state";

export default function AttendanceLoading() {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <ScreenSkeleton shape="roster" label="this day's attendance" rows={6} />
    </div>
  );
}
