// Implements: 13_UI_Guidelines.md §8.20 (skeleton), §15.1 (loading
// orchestration) — the loading boundary for the `/settings` route.
//
// The shape is the form, because that is what `SettingsClient` renders while it
// waits (`shape="form"`, `rows={6}`): labelled inset wells, one per field. The
// group-level boundary that used to answer for every screen rendered the
// DASHBOARD skeleton here instead.

import { ScreenSkeleton } from "@/components/ui/screen-state";

export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <ScreenSkeleton shape="form" label="your settings" rows={6} />
    </div>
  );
}
