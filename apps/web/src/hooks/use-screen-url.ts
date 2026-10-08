"use client";

// Implements: AGENTS.md §2 Rule 4 as amended 2026-10-07 — the five screens are
// five routes, and this hook is the ONLY place the app learns that the route
// moved. 16_Platform_Delivery_Sequence.md §W1; 03_User_Flows.md (a tutor who
// reloads or presses Back must land where they were).
//
// WHAT THIS FILE DOES NOW, AND WHAT IT USED TO DO. Until 2026-10-07 it wrote the
// screen into a `?screen=` query parameter with `history.pushState`, because the
// screens were query state on one route. They are routes now — `/dashboard`,
// `/students`, `/attendance`, `/fees`, `/settings` — so Next.js owns the URL and
// the whole `pushState`/`replaceState`/arrival-normalisation machinery is gone.
// Two directions remain, and each has exactly one owner:
//
//   ROUTE → STORE. `usePathname()` changes; `syncActiveScreenFromPath` records it.
//   STORE → ROUTE. `setActiveScreen` (the nav, the shortcuts, a KPI drill-down)
//   calls the navigator this hook registers.
//
// Two owners of one direction is how the two drift, so there is one of each.
//
// WHY THE NAVIGATOR IS INJECTED HERE AND NOT IMPORTED IN THE STORE.
// `useRouter` is a hook; `shell-store.ts` is also read from `getState()` by
// non-React code, so the store cannot call it. The chrome registers a navigator
// on mount and clears it on unmount. Before it registers, `setActiveScreen` is a
// plain setter — which is exactly why `dashboard-client.test.tsx` can assert
// `setActiveScreen("/students")` with no router in the tree.
//
// THE ONE THING THIS HOOK CANNOT DO ANY MORE. The old version listened for
// `popstate`, ran the destination through `requestScreen` (the dirty-overlay
// door) and could therefore REFUSE a Back press while a tutor had a typed ₹5,000
// payment open. With real routes the App Router owns `popstate` and performs the
// navigation itself; there is no supported way for application code to veto it.
// So browser Back is no longer guarded, and that is a real regression, stated
// here rather than left to be discovered.
//
// It is partly answered on the route this file DOES control: `glass-shell.tsx`
// closes the fee sheets when the content subtree unmounts, so a Back press can no
// longer leave a payment sheet "open" in a module singleton and re-present it
// over a different student on the tutor's next visit to Fees. What is still
// unguarded is the typed values inside a sheet that was open when Back was
// pressed. Closing that gap needs a router that can veto a popstate, and
// `next/navigation` offers no such API.
import { useCallback, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  registerScreenNavigator,
  screenFromPathname,
  syncActiveScreenFromPath,
  useShellStore,
  type ScreenId,
} from "@/stores/shell-store";

/**
 * Binds the App Router to the shell store, and answers "which screen am I on?".
 *
 * CONTRACT
 * ────────
 * OWNS: exactly two edges — ROUTE → STORE (`syncActiveScreenFromPath`, on every
 *   pathname change including Back, Forward and pasted URLs) and STORE → ROUTE
 *   (the `router.push` registered for as long as this hook is mounted). Both
 *   directions have one owner; that is the entire design.
 * RETURNS: the screen the CURRENT ROUTE renders, read during render from
 *   `usePathname()` — never from an effect.
 * ON UNMOUNT: the registered navigator is cleared to `null`. That matters: a
 *   navigator left behind would `router.push` on a tree that no longer exists.
 *   Nothing else is registered — no `popstate` listener, no observer, no timer.
 * DELIBERATELY DOES NOT: veto a browser Back press (see the header — the App
 *   Router owns `popstate` and exposes no way to refuse it); push history when
 *   the requested screen is already the current pathname (that would stack
 *   duplicate entries); or normalise a pathname that is not one of the five
 *   (`screenFromPathname` answers `null` and the store keeps its last value —
 *   see `stores/shell-store.ts`).
 *
 * Must be called from a Client Component that is mounted for the whole life of
 * the app — `GlassShell` — so exactly one navigator is registered at a time. Two
 * mounted navigators would mean two writers for the same route.
 *
 * The route, not the store, is the answer, and that is the load-bearing detail:
 * the store is written in an effect, so a server render — and the first client
 * render that has to match it — would see the store's constructor value
 * (`/dashboard`) on EVERY route. The nav would paint the Dashboard row as
 * current while `/fees` was on screen, in the HTML a crawler and a screen
 * reader see. `usePathname()` is the same value on the server and on the client,
 * so the highlight is right in the first paint.
 */
export function useScreenRoute(): ScreenId {
  const pathname = usePathname();
  const router = useRouter();
  const storeScreen = useShellStore((state) => state.activeScreen);

  // ROUTE → STORE. Runs on arrival, on Back, on Forward, and on a pasted URL —
  // every pathname change the router can produce, which is every screen change
  // there is now. It writes only; it never navigates, so it cannot loop.
  useEffect(() => {
    syncActiveScreenFromPath(pathname);
  }, [pathname]);

  // STORE → ROUTE. `push`, not `replace`: switching screens must leave a history
  // entry, or Back would leave the app instead of returning to the previous
  // screen. The guard keeps a no-op request from stacking an identical entry.
  const navigate = useCallback(
    (screen: ScreenId) => {
      if (screen === pathname) return;
      router.push(screen);
    },
    [router, pathname],
  );

  useEffect(() => {
    registerScreenNavigator(navigate);
    return () => registerScreenNavigator(null);
  }, [navigate]);

  // The store is the fallback, not the source. It is one transition AHEAD of the
  // committed route — `setActiveScreen` writes it before `router.push` — so
  // between the click and the commit the route still reads as the previous
  // screen; the store already answers with the destination. For a pathname that
  // is genuinely not one of the five, the store's last answer is more honest
  // than falling back to the Dashboard constructor value.
  return screenFromPathname(pathname) ?? storeScreen;
}