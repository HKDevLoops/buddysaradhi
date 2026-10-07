// Implements: 04_Dashboard.md §6 (the Dashboard screen and its KPI strip);
// AGENTS.md §2 Rule 4 as amended 2026-10-07 — `/dashboard` is one of the five
// screen routes, and it is a real route with a real URL, not a value of
// `?screen=`. 16_Platform_Delivery_Sequence.md §W1.
//
// THE ROUTE IS THE SCREEN. Before 2026-10-07 this file held all five screens and
// rendered whichever one `useShellStore().activeScreen` named, with every screen
// loaded through `dynamic(..., { ssr: false })` — so the server emitted an empty
// container and the browser chose the screen. That cost a deep link, a Back
// button, a per-route `document.title`, server rendering, and an
// `aria-current="page"` that was a lie. Each screen is now its own `page.tsx`;
// this one is the Dashboard.
//
// WHAT IS PREFETCHED, AND WHY THIS KEY. `["dashboard", "summary", period]` is
// `DashboardClient`'s own key (components/buddysaradhi/dashboard-client.tsx:292).
// `period` is the same `defaultDashboardPeriod()` the client uses as its
// `useState` initialiser, so both sides agree. It is time-derived, so it agrees
// up to a month boundary: a request rendered at 23:59 on the last day of a month
// hydrates a key the browser will not use, and the browser fetches once. That is
// a wasted read at one instant a month, never a wrong figure — the screen reads
// its data from the key it asked for.
//
// The `queryFn` is the client's own, including its `throw` on `{ ok: false }`. A
// prefetch that resolved the refusal envelope instead would hydrate a value shape
// the screen cannot read, and the screen would ignore perfectly good server work.

import type { Metadata } from "next";
import { ScreenData } from "../screen-data";
import { DashboardClient } from "@/components/buddysaradhi/dashboard-client";
import { fetchDashboardSummaryAction } from "@/server/actions/dashboard";
import { defaultDashboardPeriod } from "@/lib/dashboard-period";

// The route's own title, in the HTML. `GlassShell` also sets `document.title`
// from the active screen once the institute name is known, which is richer — but
// it is a client-side effect, so without this the server would send every one of
// the five screens the same `<title>` and a bookmark, a search result and a
// browser tab could not tell them apart.
export const metadata: Metadata = {
  title: "Dashboard · BuddySaradhi",
};

export default async function DashboardPage() {
  const period = defaultDashboardPeriod();

  return (
    <ScreenData
      queries={[
        {
          queryKey: ["dashboard", "summary", period],
          queryFn: async () => {
            const res = await fetchDashboardSummaryAction(period);
            if (!res.ok) throw new Error(res.error);
            return res.value;
          },
        },
      ]}
    >
      <DashboardClient />
    </ScreenData>
  );
}