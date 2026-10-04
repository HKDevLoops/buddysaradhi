import { create } from "zustand";

// Implements: 02_Core_Logic.md §5 (the five screens are ONE route switched by
// state, never five routes) and AGENTS.md §2 Rule 4 + §15 FM-19 — a sixth
// top-level route needs a ratified principle amendment, so the screen cannot
// become a path. It becomes URL *state* on the existing route instead.
//
// THIS FILE IS THE SINGLE OWNER of the screen vocabulary: the id the runtime
// store holds, the query value it is written to, the nav label, and the
// one-word label the bottom tab has room for. Before this, `glass-shell.tsx`
// held `NAV_ITEMS` (labels) and matched it against `activeScreen`, and the URL
// held nothing at all — so deep links, Back/Forward and `document.title` had no
// one place to live and none of them worked. Translation lives here; the nav,
// the mobile tab bar, the document title and the shortcut registry all READ it.
// Nothing else translates.

export type ScreenId = "/dashboard" | "/students" | "/attendance" | "/fees" | "/settings";

export interface ScreenDescriptor {
  /** Runtime source of truth — what the five screens switch on. */
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

/** The one query parameter that carries the screen. */
export const SCREEN_QUERY_PARAM = "screen";

export function isScreenId(value: string): value is ScreenId {
  return SCREENS.some((screen) => screen.id === value);
}

/**
 * Screen id → query value. Derived, never stored twice: the id already ends in
 * its own segment (`/fees` → `fees`), so a table copy could only ever drift.
 */
export function screenParam(screen: ScreenId): string {
  return screen.replace(/^\//, "");
}

/**
 * Query value → screen id. Anything unknown, empty or hostile (a hand-edited
 * URL, an old bookmark, a typo) falls back to the Dashboard rather than
 * rendering nothing — the URL is untrusted input, and Rule 9 says a failure is
 * answered, not thrown at the tutor.
 */
export function screenFromParam(param: string | null | undefined): ScreenId {
  if (typeof param !== "string") return DEFAULT_SCREEN;
  const candidate = `/${param.trim().toLowerCase()}`;
  return isScreenId(candidate) ? candidate : DEFAULT_SCREEN;
}

/** Screen id → nav label. Unknown ids never reach here, but a lookup that cannot
 *  fail is a lookup that cannot lie in the document title. */
export function screenLabel(screen: ScreenId): string {
  return SCREENS.find((entry) => entry.id === screen)?.label ?? "Dashboard";
}

/**
 * The current screen, read from the URL on the very first render.
 *
 * This is the only window read in the module and it is guarded, because the
 * store is also constructed during SSR where there is no `window`. There is no
 * hydration hazard: all five screens are `dynamic(..., { ssr: false })`, so the
 * server emits an empty container and the first client render chooses the
 * screen — no server/client markup to disagree about.
 */
function initialScreen(): ScreenId {
  if (typeof window === "undefined") return DEFAULT_SCREEN;
  const search = new URLSearchParams(window.location.search);
  return screenFromParam(search.get(SCREEN_QUERY_PARAM));
}

interface ShellState {
  activeScreen: ScreenId;
  /**
   * Runtime source of truth. It does NOT touch the URL: the store returns a
   * result, `useScreenUrlSync` performs the history write. Keeping the history
   * side effect out of the store is what lets the URL sync be reasoned about —
   * and unit tested — without a browser.
   */
  setActiveScreen: (screen: ScreenId) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  activeScreen: initialScreen(),
  setActiveScreen: (screen) => set({ activeScreen: screen }),
}));