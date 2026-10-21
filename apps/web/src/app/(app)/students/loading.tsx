// Implements: 13_UI_Guidelines.md §8.20 (skeleton), §15.1 (loading
// orchestration) — the loading boundary for the `/students` route.
//
// The shape is the roster, because that is what `StudentMasterList` renders
// while it waits (`shape="roster"`, `rows={6}`). The group-level boundary that
// used to answer for every screen rendered the DASHBOARD skeleton here instead,
// which is two layout shifts where §8.20 intends zero. See
// `app/(app)/students/loading.tsx`'s siblings for the other four routes.

import { ScreenSkeleton } from "@/components/ui/screen-state";

export default function StudentsLoading() {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <ScreenSkeleton shape="roster" label="your student roster" rows={6} />
    </div>
  );
}
