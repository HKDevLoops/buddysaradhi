'use client';

// Implements: 13_UI_Guidelines.md §7.2 — honour `prefers-reduced-motion` — and
// AGENTS.md §2 Rule 10 (an OS-level preference is an accessibility input, not a
// nicety). One SSR-safe reader for a CSS media query, used by the chrome and by
// anything that must change its own rendering (not just its CSS) when the OS
// preference flips while the app is open.
//
// WHY `useSyncExternalStore` AND NOT AN EFFECT + `setState`. The obvious
// implementation is what this file used to be:
//
//   const [matches, setMatches] = useState(false);
//   useEffect(() => { const m = window.matchMedia(query); … }, [matches, query])
//
// and it had three defects. (1) `matches` in the dependency array means every
// state change tears the `MediaQueryList` listener down and rebuilds it, so a
// query that oscillates re-registers forever. (2) Getting the first value right
// needs a `setState` inside the effect, which is what
// `react-hooks/set-state-in-effect` is warning about, and the file carried a
// disable comment for it. (3) The value is not "state" at all — it is an
// EXTERNAL store (the OS), and React ships the primitive for reading one
// (`useSyncExternalStore`), including the server snapshot that makes it correct
// across SSR without a hydration mismatch. The platform answer is shorter than
// the workaround.
//
// THREE THINGS IT DOES NOT DO. It does not debounce — a media query changes at
// most a handful of times and debouncing would delay the very event the tutor
// needs immediately. It does not default to a sensible value when `query` is
// malformed; `matchMedia` throws on an unparsable query and that is the caller's
// bug, not something to paper over. It does not watch several queries at once
// — compose two calls if you need two.

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query.
 *
 * @param query A media query list, e.g. `'(prefers-reduced-motion: reduce)'`.
 * @returns Whether the query currently matches. `false` on the server and during
 *   the hydration render — deliberately the same answer on both, so the markup
 *   agrees; the real value lands in the first render after hydration.
 *
 * On unmount the `change` listener is removed. Nothing else is registered, so
 * there is nothing else to leak.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onStoreChange);
      return () => media.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  // A boolean is compared by value, so returning a fresh one from a fresh
  // MediaQueryList on every call is still a stable snapshot — which is the only
  // reason this is allowed to build the list inline instead of memoising it.
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}