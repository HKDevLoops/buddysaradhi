// Implements: AGENTS.md §2 Rule 4 as amended 2026-10-07 (each `page.tsx` is a
// Server Component that prefetches its own data); `app/(app)/screen-data.tsx`
// decision 1 (the prefetch key must BE the screen's own key) and the
// `ScreenQuery.retry` note.
//
// WHY THIS TEST EXISTS. The Dashboard shipped in two waves: the server rendered
// the KPI strip, the due-today page and the activity feed, and the browser then
// mounted `DashboardAnalyticsSection` and issued its own ~20-leg analytics fan-out.
// Nothing failed — the screen just did its heaviest work after the tutor was
// already looking at it. `page.tsx` now prefetches that leg too.
//
// The regression this pins is not "an analytics query exists" but the specific
// pair of things that make a prefetch useless or wrong, both of which are silent:
//
//   1. A KEY THAT NOTHING READS. `dashboard-analytics.tsx` asks for
//      `["dashboard", "analytics", periodMonths, batch, status]`. If the key here
//      drifts from that shape — a different literal, a different position, a
//      nested filter object — the prefetch succeeds, the HTML gets bigger, and
//      the browser still refetches. The screen is no faster and nothing reports
//      an error. So the key is asserted, not merely counted.
//   2. A RETRY POLICY THAT MULTIPLIES THE FAILURE. The app-wide default is two
//      retries. On a fan-out that size, retrying server-side before admitting
//      defeat stretches the screen's time-to-error by the whole backoff for a
//      result that is discarded anyway (a failed prefetch is dropped from the
//      dehydrated state, so the browser repeats it on mount regardless). The
//      analytics leg therefore carries `retry: false`, and this asserts it — so
//      "just use the default" cannot creep back in silently.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import type { ScreenQuery } from "../screen-data";
import { ScreenData } from "../screen-data";

/** Every `queries` array the route hands to `ScreenData`, captured per render. */
const capturedQueries: ScreenQuery[][] = [];

/**
 * `ScreenData` is stubbed so the test can assert the ROUTE'S contract — which
 * reads it declares — without running a `QueryClient`, firing the gateway, or
 * hydrating anything. The real component's own behaviour is covered by
 * `screen-data.test.tsx`; this file is about what the Dashboard asks for.
 */
vi.mock("../screen-data", () => ({
  ScreenData: (props: { queries: readonly ScreenQuery[]; children?: ReactNode }) => {
    capturedQueries.push([...props.queries]);
    return createElement("div", { "data-testid": "screen-data" }, props.children);
  },
}));

vi.mock("@/components/buddysaradhi/dashboard-client", () => ({
  DashboardClient: () => createElement("div", { "data-testid": "dashboard-client" }),
}));

const summaryAction = vi.fn();
const analyticsAction = vi.fn();

vi.mock("@/server/actions/dashboard", () => ({
  fetchDashboardSummaryAction: (...args: unknown[]) => summaryAction(...args),
  fetchDashboardAnalyticsAction: (...args: unknown[]) => analyticsAction(...args),
}));

const { defaultDashboardPeriod } = await import("@/lib/dashboard-period");
const { default: DashboardPage, metadata } = await import("./page");

/** The route renders exactly one `ScreenData`; this is its queries array. */
async function renderRoute(): Promise<readonly ScreenQuery[]> {
  const element = await DashboardPage();
  renderToStaticMarkup(element as Parameters<typeof renderToStaticMarkup>[0]);
  expect(capturedQueries).toHaveLength(1);
  const queries = capturedQueries[0];
  expect(queries).toBeDefined();
  return queries ?? [];
}

function findAnalytics(queries: readonly ScreenQuery[]): ScreenQuery {
  const analytics = queries.find(
    (query) => Array.isArray(query.queryKey) && query.queryKey[1] === "analytics",
  );
  expect(analytics, "the dashboard must prefetch its analytics leg").toBeDefined();
  if (analytics === undefined) throw new Error("unreachable — guarded by the assertion above");
  return analytics;
}

beforeEach(() => {
  capturedQueries.length = 0;
  summaryAction.mockReset();
  analyticsAction.mockReset();
  summaryAction.mockResolvedValue({ ok: true, value: { summary: {}, window: {} } });
  analyticsAction.mockResolvedValue({ ok: true, value: {} });
});

describe("the Dashboard route's prefetch set", () => {
  it("prefetches the summary leg AND the analytics leg", async () => {
    const queries = await renderRoute();

    // Two legs. The analytics one is the regression: without it the browser
    // mounts `DashboardAnalyticsSection` and issues the whole fan-out itself.
    expect(queries).toHaveLength(2);
    expect(
      queries.some(
        (query) => Array.isArray(query.queryKey) && query.queryKey[1] === "summary",
      ),
    ).toBe(true);
    expect(
      queries.some(
        (query) => Array.isArray(query.queryKey) && query.queryKey[1] === "analytics",
      ),
    ).toBe(true);
  });

  it("keys the analytics leg exactly as DashboardAnalyticsSection asks for it", async () => {
    const queries = await renderRoute();
    const analytics = findAnalytics(queries);

    // `["dashboard", "analytics", periodMonths, batch, status]` with the
    // section's own `useState` defaults: 6 months, every batch, every status.
    // All three are literals, not functions of today, so this key is stable
    // across the server/client boundary — which is what makes the hydrated
    // query one the browser actually reads rather than a wasted round trip.
    expect(analytics.queryKey).toEqual(["dashboard", "analytics", 6, "all", "all"]);
  });

  it("passes the section's own defaults to the action, not a stale copy", async () => {
    const queries = await renderRoute();
    const analytics = findAnalytics(queries);

    await expect(analytics.queryFn()).resolves.toEqual({});
    expect(analyticsAction).toHaveBeenCalledTimes(1);
    expect(analyticsAction).toHaveBeenCalledWith({
      periodMonths: 6,
      batch: "all",
      status: "all",
    });
  });

  it("keeps the summary leg on the app-wide retry policy", async () => {
    const queries = await renderRoute();
    const summary = queries.find(
      (query) => Array.isArray(query.queryKey) && query.queryKey[1] === "summary",
    );
    expect(summary).toBeDefined();

    // Undefined means "the app default", and changing that is a separate
    // decision about the summary read — recorded here so an accidental
    // `retry: false` on THIS leg is a visible diff, not a silent one.
    expect(summary?.retry).toBeUndefined();
    expect(summary?.queryKey).toEqual(["dashboard", "summary", defaultDashboardPeriod()]);
  });

  it("does not retry the analytics leg — a ~20-leg fan-out must not triple the wait", async () => {
    const queries = await renderRoute();

    // Decision 2 of `screen-data.tsx`: a failed server prefetch is dropped from
    // the dehydrated state, so the browser issues the identical query on mount
    // whatever the server does. Retrying server-side can only delay the error.
    expect(findAnalytics(queries).retry).toBe(false);
  });
});

describe("the analytics leg's queryFn matches the section's own contract", () => {
  it("REJECTS on the refusal envelope rather than resolving it", async () => {
    const queries = await renderRoute();
    const analytics = findAnalytics(queries);

    // `DashboardAnalyticsSection`'s own `queryFn` throws on `{ ok: false }`.
    // A prefetch that resolved the envelope would dehydrate a value shape the
    // screen cannot read — a successful prefetch that the screen ignores.
    analyticsAction.mockResolvedValue({ ok: false, error: "DASHBOARD_ANALYTICS_FAILED: no" });
    await expect(analytics.queryFn()).rejects.toThrow("DASHBOARD_ANALYTICS_FAILED: no");
  });

  it("resolves the unwrapped value on success, as the section expects", async () => {
    const queries = await renderRoute();
    const analytics = findAnalytics(queries);

    analyticsAction.mockResolvedValue({ ok: true, value: { trend: [] } });
    await expect(analytics.queryFn()).resolves.toEqual({ trend: [] });
  });
});

describe("the route still owns its own <title>", () => {
  it("sends a Dashboard-specific title in the server HTML", () => {
    // Every screen route declares its own; `GlassShell` only sets `document.title`
    // from a client-side effect, so without this all five screens send the same
    // title to a bookmark and a search result.
    expect(metadata.title).toBe("Dashboard · BuddySaradhi");
  });
});