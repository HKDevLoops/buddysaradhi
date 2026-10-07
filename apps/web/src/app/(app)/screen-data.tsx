// Implements: AGENTS.md §2 Rule 4 as amended 2026-10-07 — "each `page.tsx` is a
// Server Component that prefetches its own data and server-renders the screen's
// first paint"; 02_Core_Logic.md §9 (cache + batch as metered-tier budget
// control); 14_Edge_Cases.md EC-AU-02 (a failed read is answered, never
// swallowed).
//
// WHAT THIS IS. The one mechanism every screen route uses to render its data on
// the server instead of waiting for the browser to ask for it. It is
// `@tanstack/react-query`'s documented App Router SSR path — a per-request
// `QueryClient`, `prefetchQuery`, `dehydrate`, `HydrationBoundary` — with the
// three project-specific decisions written down instead of left to each page.
//
// WHY NOT `initialData` ON THE SCREEN COMPONENT. The five screen components are
// owned by other lanes and read their own data through `useQuery`. Passing data
// down as a prop would mean editing all five, which is a cross-lane diff for no
// gain: `HydrationBoundary` needs the same `queryKey` the component already
// builds, and lands the value in the cache the component already reads.
//
// THE THREE DECISIONS, STATED ONCE SO A PAGE CANNOT GET THEM WRONG:
//
//  1. THE KEY MUST BE THE COMPONENT'S OWN KEY. Not a similar one, not a subset.
//     A page that invents its own key hydrates a cache nothing reads and the
//     browser refetches the very query the server just ran — SSR that costs a
//     round trip and buys nothing. The key is part of the contract, so it is
//     passed here beside the `queryFn` that produced it and cannot drift apart
//     in a file that has to repeat both.
//
//  2. A FAILED PREFETCH IS NOT AN ERROR PAGE. `prefetchQuery` records the
//     rejection on the query and resolves; `dehydrate` then omits it. So a
//     gateway timeout costs the server one logged failure and costs the browser
//     nothing: it fetches on mount and the screen renders its own `ErrorState`,
//     which is the surface that already knows how to explain the failure and
//     offer a retry (AGENTS.md §2 Rule 9). A page that let the prefetch throw
//     would turn a readable data problem into a 500 for the whole screen.
//
//  3. THE SERVER CLIENT IS PER REQUEST, NEVER A MODULE SINGLETON. A shared
//     client would put one tutor's roster in another tutor's HTML. React's
//     `cache` scopes the instance to the request's render, and drops it when
//     the response is done.
//
// The client-side policy (`staleTime` and friends) comes from
// `@/app/query-defaults` rather than being restated here — a dehydrated query is
// only trusted by the browser if both clients agree on when data goes stale.
import { cache, type ReactNode } from "react";
import { QueryClient, HydrationBoundary, dehydrate, type QueryKey } from "@tanstack/react-query";
import { QUERY_DEFAULT_OPTIONS } from "@/app/query-defaults";

/**
 * One screen's server-side read: the cache key the screen's own `useQuery` will
 * ask for, and the read that fills it.
 *
 * The `queryFn` MUST resolve to exactly what the screen's own `queryFn` resolves
 * to. A wrapper that unwraps an envelope the screen expects wrapped (or the
 * reverse) hydrates a value the screen cannot read, and the failure only shows
 * up as a screen that ignores perfectly good data.
 */
export interface ScreenQuery {
  readonly queryKey: QueryKey;
  readonly queryFn: () => Promise<unknown>;
  /**
   * Optional per-read retry override. Default (`undefined`) is the app-wide policy
   * in `@/app/query-defaults` — two retries, which is right for a flaky gateway.
   *
   * `false` exists for a read the SERVER already made and the browser will repeat
   * anyway: the server's failure is dropped from the dehydrated state, so the
   * browser issues the same query immediately. Retrying on the server before
   * admitting defeat only multiplies a screen's time-to-error by the backoff.
   */
  readonly retry?: boolean | number;
}

/**
 * The request's `QueryClient`. `cache()` is React's per-request memoisation: one
 * instance for the whole render of one request, garbage-collected after the
 * response. Never hoist this to module scope.
 */
export const getRequestQueryClient = cache(
  (): QueryClient => new QueryClient({ defaultOptions: QUERY_DEFAULT_OPTIONS }),
);

/**
 * Prefetch the screen's data on the server, then hand it to the browser.
 *
 * @param queries The screen's reads. Each is fired in parallel — a tutor waiting
 *   for the Dashboard should not wait for the roster as well — and each one's
 *   failure is contained (decision 2 above).
 * @param children The screen. Rendered as the boundary's subtree, so the browser
 *   hydrates the cache during the first client render and the first paint shows
 *   the same rows the server sent.
 */
export async function ScreenData({
  queries,
  children,
}: {
  queries: readonly ScreenQuery[];
  children: ReactNode;
}) {
  const queryClient = getRequestQueryClient();
  await Promise.all(
    queries.map((query) =>
      queryClient.prefetchQuery({
        queryKey: query.queryKey,
        queryFn: query.queryFn,
        ...(query.retry === undefined ? {} : { retry: query.retry }),
      }),
    ),
  );
  return <HydrationBoundary state={dehydrate(queryClient)}>{children}</HydrationBoundary>;
}