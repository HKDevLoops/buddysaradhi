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
// WHY THE ANALYTICS LEG IS HERE AND NOT LEFT TO THE BROWSER. The Dashboard
// renders `DashboardAnalyticsSection` (dashboard-client.tsx), whose `useQuery`
// key is `["dashboard","analytics", periodMonths, batch, status]`
// (components/buddysaradhi/dashboard-analytics.tsx:301). Until this route
// prefetched it, the screen shipped in TWO WAVES: the server sent the KPI strip,
// the Due Today page and the Activity feed, and then the browser mounted the
// analytics section and issued the whole analytics read itself — a fan-out of
// roughly twenty gateway legs (six aggregate legs plus one heatmap leg per day in
// the window). So the tutor saw a complete-looking dashboard with the heaviest
// read still in flight, and the section's own skeleton sat under a finished
// screen. Prefetching it here moves that fan-out into the request that was
// already happening and lets the browser read the dehydrated value.
//
// THE ANALYTICS KEY IS NOT TIME-DERIVED, which is what makes this safe. The
// analytics section keeps its own `useState` defaults — `6` months, batch `"all"`,
// status `"all"` — and none of them is a function of today, so unlike `period`
// this key is stable across the server/client boundary and a hydrated query is
// one the browser actually reads. Those three values MUST stay equal to the
// section's three `useState` initialisers; a mismatch would hydrate a cache
// nothing reads and reintroduce exactly the double-fetch this removes.
// `page.test.tsx` pins the key's shape, and the initialisers are cited at the
// constant below.
//
// `retry: false` is the `ScreenQuery.retry` case documented in `screen-data.tsx`:
// the server has already made this read, and its failure is dropped from the
// dehydrated state, so the browser issues the very same query on mount anyway.
// The app-wide policy is two retries, and on a ~20-leg fan-out that multiplies a
// screen's time-to-error by the whole backoff for a result that is going to be
// discarded. (The summary leg above keeps the default policy — changing that is a
// separate decision about that read, not part of adding this one.)
//
// `getDashboardAnalytics` is `React cache`-memoised per request
// (server/queries/dashboard-analytics.ts:318), so this adds ONE server-side read
// and cannot fan out twice inside one request.
//
// The `queryFn` is the client's own, including its `throw` on `{ ok: false }`. A
// prefetch that resolved the refusal envelope instead would hydrate a value shape
// the screen cannot read, and the screen would ignore perfectly good server work.

import type { Metadata } from "next";
import { ScreenData } from "../screen-data";
import { DashboardClient } from "@/components/buddysaradhi/dashboard-client";
import {
  fetchDashboardSummaryAction,
  fetchDashboardAnalyticsAction,
} from "@/server/actions/dashboard";
import { defaultDashboardPeriod } from "@/lib/dashboard-period";

/**
 * The analytics section's OWN initial filter state, quoted from
 * `DashboardAnalyticsSection`'s three `useState` initialisers
 * (components/buddysaradhi/dashboard-analytics.tsx:295-297). Duplicated as
 * literals rather than imported because that module is a Client Component and
 * importing it into a Server Component route would pull the whole 41KB section
 * into the server bundle to read three numbers.
 */
const ANALYTICS_DEFAULTS = { periodMonths: 6, batch: "all", status: "all" } as const;

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
        {
          queryKey: [
            "dashboard",
            "analytics",
            ANALYTICS_DEFAULTS.periodMonths,
            ANALYTICS_DEFAULTS.batch,
            ANALYTICS_DEFAULTS.status,
          ],
          queryFn: async () => {
            const res = await fetchDashboardAnalyticsAction({ ...ANALYTICS_DEFAULTS });
            if (!res.ok) throw new Error(res.error);
            return res.value;
          },
          retry: false,
        },
      ]}
    >
      <DashboardClient />
    </ScreenData>
  );
}