// Implements: AGENTS.md §2 Rule 4 as amended 2026-10-07 — the five screens are
// five server-rendered routes, each `page.tsx` a Server Component that
// prefetches its own data; 02_Core_Logic.md §9 (cache + batch as metered-tier
// budget control).
//
// WHY THIS FILE EXISTS. Two `QueryClient`s read the same cache: the browser's
// long-lived client (`app/providers.tsx`) and the per-request client each
// `page.tsx` builds to prefetch into. A dehydrated query is only trusted by the
// browser if its `dataUpdatedAt` is inside the browser client's `staleTime` — so
// a server client with different defaults would emit data the browser
// immediately discards and refetches, i.e. SSR that costs a round trip and buys
// nothing. One owner, two constructors. A copy of these numbers in the prefetch
// pages would drift within a release.
//
// It is a PLAIN module — no `"use client"`, no `"use server"` — so a Server
// Component and a Client Component can both import the same object. (A value
// imported from a `"use client"` module arrives in a Server Component as a
// client reference, not as the value.)
import type { DefaultOptions } from "@tanstack/react-query";

/**
 * The cache policy both the browser client and the server prefetch clients run
 * with.
 *
 * `staleTime: 30_000` is the load-bearing number for SSR: it is the window in
 * which a hydrated server result is treated as fresh, so the first client render
 * shows real data and does not immediately re-issue the same query.
 *
 * `UNAUTHENTICATED` opts out of retry on the first attempt. It is a decision the
 * server has already made and repeating it cannot change, so retrying is two
 * round trips spent proving a known answer.
 */
export const QUERY_DEFAULT_OPTIONS: DefaultOptions = {
  queries: {
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: (failCount: number, error: Error) =>
      error.message === "UNAUTHENTICATED" ? false : failCount < 2,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  },
};