"use client";

// Implements: 02_Core_Logic.md §5 (five screens, ONE route, switched by state)
// and 03_User_Flows.md (a tutor who reloads or hits Back must land where they
// were) — inside AGENTS.md §2 Rule 4: a sixth top-level route would need a
// ratified principle amendment, so the screen is carried as a query parameter on
// the EXISTING route instead of a path.
//
// THE DEFECT THIS FILE EXISTS TO FIX. `NAV_ITEMS` pointed at `/students`,
// `/attendance`, `/fees`, `/settings` while the only real route was
// `/dashboard`; the screen lived purely in a Zustand store. So: no deep link (a
// tutor could not bookmark or send "the Fees screen"), the URL never changed,
// `document.title` never changed, and the browser Back button did not move
// between screens — clicking Back after an hour in Fees left the app.
//
// SHAPE: `?screen=fees`.
//
// OWNERSHIP. This module is the ONLY writer of the query string. The store owns
// the vocabulary (id ⇄ param ⇄ label, in `shell-store.ts`); this owns the
// history. One mapping, one writer — two places translating between a screen id
// and a URL is how the two drift apart.
//
// `window.history.pushState` / `replaceState` are the documented Next.js App
// Router integration points (next/dist/docs → 01-app/01-getting-started/
// 04-linking-and-navigating.md §"Native History API"): they update the router
// without a reload and the router stays in sync. A `router.push` per screen
// change would re-run the route's server work on every switch, and
// `useSearchParams` would demand a Suspense boundary around the whole shell for
// a value only the shell itself needs.
//
// WRITES ARE COMPARED, NOT BLIND. A push only happens when the URL and the store
// disagree. That one rule is what makes Back/Forward work without a feedback
// loop: a popstate has already put the two in agreement, so this effect writes
// nothing and the history entry the tutor pressed is not pushed back onto.

import { useEffect } from "react";
import {
  useShellStore,
  DEFAULT_SCREEN,
  SCREEN_QUERY_PARAM,
  screenParam,
  screenFromParam,
} from "@/stores/shell-store";

/**
 * The event `popstate` raises so the shell can route a Back/Forward move through
 * its single `requestScreen` door, which owns the dirty-overlay guard. Declared
 * here (the writer of history) and consumed in `glass-shell.tsx`, so the two
 * halves of the same decision cannot drift.
 */
export const REQUEST_SCREEN_EVENT = "buddysaradhi:request-screen";

/** Builds `?<param>=<screen>` while preserving every OTHER parameter, so an
 *  unrelated query survives a screen change. */
function urlForScreen(screen: string): string {
  const params = new URLSearchParams(window.location.search);
  if (screen === DEFAULT_SCREEN) {
    // The default screen carries NO parameter. `/dashboard` is the honest URL for
    // the dashboard; rewriting it to `/dashboard?screen=dashboard` says "you are
    // on a non-default screen" when you are not, and it broke
    // `waitForURL('**/dashboard')` in both a11y specs (a Playwright glob does not
    // match across a query string), so every screen timed out at 15s in CI.
    params.delete(SCREEN_QUERY_PARAM);
  } else {
    params.set(SCREEN_QUERY_PARAM, screen);
  }
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
}

/** The screen the CURRENT url asks for, or null when it asks for none. */
function screenFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get(SCREEN_QUERY_PARAM);
}

/**
 * Whether this session has already written the arrival URL. Module-scoped on
 * purpose: it describes the app's lifetime, not a component's, and a `useRef`
 * would reset under Strict Mode's double-mount and re-push the arrival entry.
 */
let arrivalUrlNormalized = false;

export function useScreenUrlSync(): void {
  const activeScreen = useShellStore((state) => state.activeScreen);

  // Back / Forward. `pushState` never fires `popstate`, so without this the
  // store would overwrite the URL the tutor just navigated to and that history
  // entry would be swallowed on the next switch.
  //
  // A dirty overlay BLOCKS the move. The nav goes through `requestScreen` in
  // `glass-shell.tsx`, which asks the same question and raises
  // `DiscardChangesPrompt`; Back bypassed that, so pressing it with a typed
  // ₹5,000 payment open unmounted the sheet and lost the values with no prompt.
  // A keyboard path that skips a safety prompt is worse than no keyboard path.
  useEffect(() => {
    const onPopState = () => {
      // Hand the decision BACK to the single door. `requestScreen` in
      // `glass-shell.tsx` already asks `findDirtyOverlay` and raises
      // `DiscardChangesPrompt`; duplicating that logic here would create a
      // second, subtly different answer to "may I switch screens" — and the
      // version that gets it wrong is the one on the Back button, where a
      // typed ₹5,000 payment would be unmounted with no prompt.
      window.dispatchEvent(
        new CustomEvent(REQUEST_SCREEN_EVENT, {
          detail: { screen: screenFromParam(screenFromLocation()) },
        }),
      );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const wanted = screenParam(activeScreen);
    const asked = screenFromLocation();
    // "No param" and "the default screen" are the same request, so treat them as
    // agreement. Without this the default screen fires a pointless replaceState
    // on every arrival and consumes the one normalising write.
    const urlAgrees = asked === wanted || (asked === null && wanted === screenParam(DEFAULT_SCREEN));
    if (urlAgrees) return;

    if (!arrivalUrlNormalized) {
      // The first write is a REPLACE. The URL the tutor arrived on IS that
      // entry; pushing here would leave a same-screen entry in front of it, so
      // Back would appear to do nothing once before doing anything at all.
      arrivalUrlNormalized = true;
      window.history.replaceState(window.history.state, "", urlForScreen(wanted));
      return;
    }
    window.history.pushState(null, "", urlForScreen(wanted));
  }, [activeScreen]);
}