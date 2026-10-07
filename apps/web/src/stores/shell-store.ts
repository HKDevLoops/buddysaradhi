import { create } from "zustand";

// Implements: AGENTS.md §2 Rule 4 as amended 2026-10-07 — the five screens are
// `/dashboard`, `/students`, `/attendance`, `/fees`, `/settings`, and they are
// ROUTES. 16_Platform_Delivery_Sequence.md §W1 (the spec corpus already named
// these five paths before the code did); 02_Core_Logic.md §1.1 (the sidebar is
// five screens + utilities).
//
// WHY THE SCREEN IS THE ROUTE. Until 2026-10-07 these five screens were ONE path
// (`/dashboard`) carrying the screen as `?screen=fees`. That was a workaround for
// an old implementation limit, not a rule (see the Rule 4 amendment): it cost the
// app a deep link, a Back button between screens, a per-route `document.title`,
// server rendering, and an `aria-current="page"` on a button that was not a page.
//
// WHAT CHANGED, EXACTLY. `ScreenId` was `"/dashboard" | …` when it meant "the
// screen"; now it means the ROUTE that renders it, and the two are the same
// string by construction — that identity is the whole reason this file can stay
// small. What was deleted: `SCREEN_QUERY_PARAM`, `screenParam` and
// `screenFromParam`. A query string carries a screen no longer needs a query
// string for, and leaving the translation would leave two vocabularies to drift
// (AGENTS.md §0.2 — code that maps to nothing gets deleted).
//
// THE ORDER MATTERS AND IS DELIBERATE. `setActiveScreen` sets the store FIRST and
// navigates SECOND. Callers outside this lane's files — `shortcuts.ts`'s `g then
// N`, `dashboard-client.tsx`'s KPI drill-downs — call `setActiveScreen` and then
// read `activeScreen` synchronously (`shortcuts.ts:209` checks `activeScreen ===
// "/fees"` to decide whether to prefill a fee sheet). A navigation-first
// implementation would make those reads observe the PREVIOUS screen for the
// length of a transition, and `shortcuts.ts:209` would prefill from the wrong
// student. Store first, navigate second: every existing reader keeps working,
// including `dashboard-client.test.tsx`, which asserts exactly this.
//
// THE NAVIGATOR IS INJECTED, NOT IMPORTED. `next/navigation`'s `useRouter` is a
// hook and this module is read by non-React code (`getState()`), so the chrome
// registers a navigator on mount and clears it on unmount. Absent a navigator —
// unit tests, a server render — `setActiveScreen` is exactly what it was before:
// a setter. That is why no test needs a router to assert this behaviour.
//
// THIS FILE IS THE SINGLE OWNER of the screen vocabulary: the id the runtime
// store holds, the nav label, the one-word label the bottom tab has room for,
// and the mapping from a pathname to a screen id. The nav, the mobile tab bar,
// the document title and the shortcut registry all READ it. Nothing else
// translates.

export type ScreenId = "/dashboard" | "/students" | "/attendance" | "/fees" | "/settings";

export interface ScreenDescriptor {
  /** The route that renders this screen — and the id the runtime store holds. */
  readonly id: ScreenId;
  /** Full nav label. */
  readonly label: string;
  /** One word, for the mobile bottom bar where there is room for one. */
  readonly short: string;
}

/**
 * In the order the nav renders, and the order the `g`-chord sequence numbers
 * follow — so "G then 4" is the fourth button down, which is how a tutor learns
 * it without reading the help sheet.
 */
export const SCREENS: readonly ScreenDescriptor[] = [
  { id: "/dashboard", label: "Dashboard", short: "Home" },
  { id: "/students", label: "Students", short: "Students" },
  { id: "/attendance", label: "Attendance", short: "Attendance" },
  { id: "/fees", label: "Fees & Payments", short: "Fees" },
  { id: "/settings", label: "Settings", short: "Settings" },
];

export const DEFAULT_SCREEN: ScreenId = "/dashboard";

export function isScreenId(value: string): value is ScreenId {
  return SCREENS.some((screen) => screen.id === value);
}

/**
 * Pathname → screen id, or null when the pathname is not one of the five.
 *
 * Null rather than `DEFAULT_SCREEN` is load-bearing: the caller is told "this is
 * not a screen" instead of being handed a screen the tutor did not ask for. A
 * pathname that is not one of the five (`/login`, `/signup/provision`, a 404) is
 * real traffic, and answering it with "Dashboard" would light up the Dashboard
 * tab on the login page.
 *
 * The trailing slash is tolerated because `/students/` and `/students` are the
 * same route to a human and can reach us from a hand-edited URL. Nothing else is
 * normalised — the input is a URL, and guessing at it is how a path becomes a
 * second vocabulary.
 */
export function screenFromPathname(pathname: string): ScreenId | null {
  const trimmed = pathname.replace(/\/+$/, "");
  return isScreenId(trimmed) ? trimmed : null;
}

/** Screen id → nav label. Unknown ids never reach here, but a lookup that cannot
 *  fail is a lookup that cannot lie in the document title. */
export function screenLabel(screen: ScreenId): string {
  return SCREENS.find((entry) => entry.id === screen)?.label ?? "Dashboard";
}

/** Moves the browser to a screen. Injected by the chrome; null until it mounts. */
type ScreenNavigator = (screen: ScreenId) => void;

let navigator: ScreenNavigator | null = null;

/**
 * Register the router handle for as long as the chrome is mounted. Returns the
 * unregister function so the chrome can hand it straight to `useEffect`'s
 * cleanup — a navigator left behind after the shell unmounts would push routes
 * on a tree that no longer exists.
 */
export function registerScreenNavigator(fn: ScreenNavigator | null): void {
  navigator = fn;
}

interface ShellState {
  /**
   * The screen on show. It MIRRORS the route rather than choosing it: `useScreen`
   * (`hooks/use-screen-url.ts`) writes the route's value here on every pathname
   * change, including the ones the tutor did not make — Back, Forward, a typed
   * URL, a link in an email. Keeping the mirror is what lets files outside this
   * lane read "which screen am I on" without importing `next/navigation`.
   */
  activeScreen: ScreenId;
  /**
   * Go to a screen. Sets `activeScreen` synchronously, then navigates.
   *
   * It does NOT touch the URL itself. The chrome owns the router, and a store
   * that pushed history would be a second writer of the same fact — and would do
   * it from a module that is also read outside React.
   */
  setActiveScreen: (screen: ScreenId) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  // The default, not a read of `window.location`. This module is also evaluated
  // on the server and inside jsdom, and a window read here would be a hydration
  // hazard for no benefit: the chrome overwrites this from the pathname before
  // the nav has painted, and every screen's first render is driven by the route.
  activeScreen: DEFAULT_SCREEN,
  setActiveScreen: (screen) => {
    set({ activeScreen: screen });
    navigator?.(screen);
  },
}));

/**
 * Record the screen the ROUTE says, without navigating. Called by the chrome on
 * every pathname change.
 *
 * This is the half of the round trip that does not go through the navigator: a
 * Back button or a pasted URL must be able to update the store, and it must not
 * be answered by pushing a route that is already on screen.
 */
export function syncActiveScreenFromPath(pathname: string): void {
  const screen = screenFromPathname(pathname);
  if (screen === null) return;
  if (screen === useShellStore.getState().activeScreen) return;
  useShellStore.setState({ activeScreen: screen });
}