// Implements: 08_Settings.md §2 (institute settings — the one surface that
// writes `settings`); AGENTS.md §2 Rule 4 as amended 2026-10-07 — `/settings`
// is one of the five screen routes. 16_Platform_Delivery_Sequence.md §W1.
//
// THE ROUTE IS THE SCREEN. See `app/(app)/dashboard/page.tsx` for why each
// screen is its own `page.tsx`. This one is Settings.
//
// THE SCREEN IS SERVER-RENDERED AGAIN. It was briefly `ssr: false` behind a
// wrapper, because the store restored its persisted section synchronously before
// first paint while the server has no `sessionStorage` — a hydration mismatch on
// every load, which AGENTS.md §16 makes a release blocker. The store now sets
// `skipHydration: true` and `SettingsClient` re-hydrates in an effect, so the
// first client render agrees with the server markup. The wrapper that documented
// the blocker is deleted (§0.2 — code that maps to nothing is deleted).
//
// THE DATA IS PREFETCHED because `["settings"]` is the cheapest read in the app:
// `SettingsClient` and the sidebar's institute name both read it, so one
// prefetch warms a cache entry with two consumers. `getSettings()` is
// `cache()`-memoised per request, so the shell's own read and this prefetch share
// one upstream call within a request — the prefetch does not double metered
// gateway traffic (02_Core_Logic.md §9).

import type { Metadata } from "next";
import { ScreenData } from "../screen-data";
import { SettingsClient } from "@/components/settings/settings-client";
import { getSettings } from "@/server/queries/settings";

// See `app/(app)/dashboard/page.tsx` for why every screen route declares its own
// title in the server HTML.
export const metadata: Metadata = {
  title: "Settings · BuddySaradhi",
};

export default async function SettingsPage() {
  return (
    <ScreenData queries={[{ queryKey: ["settings"], queryFn: () => getSettings() }]}>
      <SettingsClient />
    </ScreenData>
  );
}