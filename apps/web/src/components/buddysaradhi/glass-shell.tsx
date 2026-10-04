"use client";

// Implements: UI/web/03_Dashboard.md — Aurora Cosmic glass shell
// GlassShell — the persistent 5-screen layout wrapping all app pages.
// Sidebar + topbar + main + sticky-footer.
//
// AGENTS.md §2 Rule 4 (five screens, ONE route — the screen is a query
// parameter, never a sixth path), Rule 5 (colour from the generated palette),
// Rule 9 (no silent failures), Rule 10 (a11y: 44px targets, keyboard parity,
// colour never the only signal); apps/web/DESIGN.md §2 Anti-Slop #2 (no
// decorative pulse or scale motion); docs/design/material-modes.md §2 (one
// material token, one blur source, and `filter` on a page-background layer is a
// backdrop-root trap — §5.3).
//
// This shell is the ONE place the app's material is applied. Every blur here is
// `var(--mat-filter)`; no literal, no `opacity` under a material, no animation on
// a background layer.
//
// INTERACTION VELOCITY. This file used to own the app's only global accelerator
// (⌘K) and its only way to change screens (five pointer-only buttons wired to a
// Zustand store, with `href`s pointing at routes that do not exist). Now:
//   - every chord lives in ONE registry (`components/ui/shortcuts.ts`), so the
//     "never fire while typing, never over an overlay" guards cannot be
//     re-implemented wrongly on the next accelerator;
//   - the screen is mirrored into `?screen=` so a tutor can deep link, reload,
//     and press Back — `hooks/use-screen-url.ts`;
//   - the screen label drives `document.title` and every nav button reports a
//     real current state (`aria-current="true"`, not `"page"` on a non-page).
//
// ITEM 4 — A SCREEN CHANGE IS A DISMISSAL. The screen is no longer a route, so
// switching it does not navigate; it re-renders the same page. Any sheet mounted
// on the old screen therefore UNMOUNTS under the tutor's hands, and no layer's own
// Escape/scrim guard can run, because those guards only fire when a tutor acts on
// the layer. The money-sheet case is the one that matters: a payment form left open
// on Fees re-appears already-open on Students, over a different student, with a
// stale subject. So `requestScreen` is the single door — every screen change (both
// navs, the account menu, the search result) goes through it, it asks the overlay
// stack first, and it closes the fee sheets when the answer is yes.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  Wallet,
  Settings,
  Search,
  RefreshCw,
  Wifi,
  WifiOff,
  LogOut,
  User,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useShellStore, SCREENS, screenLabel, screenFromParam, type ScreenId } from "@/stores/shell-store";
import { useStudentsStore } from "@/stores/students-store";
import { closeFeeSheets } from "@/stores/fees-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSettings } from "@/server/queries/settings";
import { getPendingSyncCount } from "@/server/queries/sync";
import { signOutAction } from "@/server/actions/signout";
import { StudentSearchBox } from "@/components/search/student-search-box";
import { useSearchCandidates } from "@/components/search/use-search-candidates";
import { ErrorState } from "@/components/ui/screen-state";
import { ShortcutHelpButton } from "@/components/ui/shortcut-help";
import { DiscardChangesPrompt, findDirtyOverlay } from "@/components/ui/overlay";
import {
  SHORTCUT_REGISTRY,
  registerPaletteFocus,
  useGlobalShortcuts,
} from "@/components/ui/shortcuts";
import { useScreenUrlSync, REQUEST_SCREEN_EVENT } from "@/hooks/use-screen-url";
import { toAppErrorState } from "@/lib/app-errors";
import { clearAllQueues } from "@/lib/offline-queue";
// Craft floor: "claims come from supplied truth". The footer used to render a
// literal `v1.0.0` under a comment asserting it "reads the one number checked
// into the repository" — it did not, so a release bump would have shipped a lie
// under a claim of honesty. This is the actual `apps/web/package.json` version.
import packageJson from "../../../package.json";

/**
 * Icons only. The screen vocabulary — id, query value, nav label — lives in
 * `SCREENS` (stores/shell-store.ts), which is the single owner of the screen ⇄
 * URL mapping. This used to be a `NAV_ITEMS` table whose `href` values pointed
 * at routes that do not exist (`/students`, `/attendance`, `/fees`, `/settings`),
 * which is how the app ended up with five nav buttons that were not pages, no
 * deep link, no Back button and a `document.title` that never changed.
 */
const SCREEN_ICONS: Record<ScreenId, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/students": Users,
  "/attendance": CalendarCheck,
  "/fees": Wallet,
  "/settings": Settings,
};

/** `g then 4` — the chord the shortcut registry binds to the fourth screen.
 *  Lower case because that is the key: letters are matched unshifted, so an
 *  upper-case hint would advertise a chord that does nothing. */
function screenChord(index: number): string {
  return `g then ${index + 1}`;
}

export function GlassShell({ children }: { children: React.ReactNode }) {
  const { activeScreen, setActiveScreen } = useShellStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  /**
   * A screen change the tutor has NOT confirmed yet, plus the sentence that
   * explains the refusal. Held as one fact so the prompt cannot render with a
   * question that names a different destination than the one it switches to.
   */
  const [blockedScreen, setBlockedScreen] = useState<{ screen: ScreenId; question: string } | null>(
    null,
  );
  const queryClient = useQueryClient();

  /**
   * The ONE door into a screen change. Four call sites used to set the screen
   * directly, and each one silently unmounted whatever the tutor was typing into:
   *
   *   1. ask the overlay stack whether any layer is dirty. It is a pure query —
   *      it never opens the prompt itself, so this file owns the wording and the
   *      outcome, and the layer keeps owning its own Escape/scrim behaviour.
   *   2. if dirty, REFUSE and say what would be lost. The prompt is the same
   *      `DiscardChangesPrompt` the sheets use, so "discard" means one thing
   *      app-wide (AGENTS.md §2 Rule 10; 14_Edge_Cases.md EC-AU-01).
   *   3. if clean, close the fee sheets. Their flags are session state; a sheet
   *      that survives its screen re-opens over a different student.
   *   4. switch.
   */
  const requestScreen = useCallback(
    (next: ScreenId) => {
      if (next === useShellStore.getState().activeScreen) return;
      const dirty = findDirtyOverlay();
      if (dirty) {
        setBlockedScreen({
          screen: next,
          question: `Switching screens closes the open ${dirty.label} and loses what you typed there.`,
        });
        return;
      }
      closeFeeSheets();
      setActiveScreen(next);
    },
    [setActiveScreen],
  );

  // The screen becomes URL state on this same route — `?screen=fees` — so
  // reload, deep link, Back and Forward all land where the tutor left off.
  useScreenUrlSync();

  // Back / Forward arrives here rather than in the history writer, so it gets
  // the SAME dirty-overlay answer the nav gets. Before this, pressing Back with
  // a typed payment open unmounted the sheet and lost the values with no prompt
  // — a keyboard path that skipped a safety prompt, which is worse than having
  // no keyboard path at all.
  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ screen: unknown }>).detail;
      const next = screenFromParam(
        typeof detail?.screen === "string" ? detail.screen : null,
      );
      requestScreen(next);
    };
    window.addEventListener(REQUEST_SCREEN_EVENT, onRequest);
    return () => window.removeEventListener(REQUEST_SCREEN_EVENT, onRequest);
  }, [requestScreen]);

  const onSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setMenuOpen(false);
    queryClient.clear();
    // RFC-004 C3: queued intents are per-tenant; a shared-device sign-out
    // must not leave another tenant's intents to replay after logout.
    clearAllQueues();
    try {
      await signOutAction();
    } catch (err) {
      setIsSigningOut(false);
      window.location.assign("/login");
    }
  };

  const { data: syncData, refetch: refetchSync } = useQuery({
    queryKey: ["pendingSyncCount"],
    queryFn: () => getPendingSyncCount(),
    // RFC-003 §0 + RFC-004 C6: no polling on metered tiers. Refresh on
    // network transitions, visibility, and focus instead of a 10s interval.
    refetchInterval: false,
    refetchOnWindowFocus: true,
  });

  // Re-check the outbox count when connectivity or visibility changes —
  // the event-driven replacement for the old 10s poll.
  useEffect(() => {
    const refresh = () => { void refetchSync(); };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refetchSync]);

  const pendingSyncCount = syncData?.count ?? 0;
  // Real connectivity state (was hardcoded `false`): drives the offline badge
  // and gates queue-vs-direct mutation paths (RFC-004 C3).
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine !== false,
  );
  useEffect(() => {
    const up = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  const isOffline = !isOnline;

  // AGENTS.md §2 Rule 9 (no silent failures). `getSettings` returns a typed
  // `{ success: false, error }` ENVELOPE rather than throwing, so the old
  // `settingsData?.data?.instituteName || "Tuition Centre"` read turned a failed
  // read into a *different institute name* in the sidebar, in `document.title`,
  // and nowhere else — the tutor was never told. Two distinct failures, one
  // branch (the same shape settings-client.tsx uses): `isError` covers a thrown
  // transport error, the envelope covers the gateway's own refusal.
  const {
    data: settingsData,
    error: settingsError,
    isFetching: settingsFetching,
    refetch: refetchSettings,
  } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettings(),
  });
  const settingsEnvelopeError =
    settingsData && settingsData.success === false ? settingsData.error : undefined;
  const settingsFailure: unknown = settingsError ?? settingsEnvelopeError;
  // The failure never blocks the app — the five screens do not depend on the
  // institute name — but it is stated, not swallowed.
  const settingsErrorState =
    settingsFailure === undefined || settingsFailure === null
      ? null
      : toAppErrorState(settingsFailure);
  // With no settings loaded, the honest label is the product's own name — not an
  // invented "Tuition Centre", which reads as a real configured value.
  const instituteName = settingsData?.data?.instituteName || "BuddySaradhi";

  const activeLabel = screenLabel(activeScreen);

  // docs/design/overhaul-plan.md §3 — one engine, one candidate source, one keyboard path.
  // The topbar field IS the ⌘K palette: the shortcut and the sidebar row both focus this
  // same instance, so there is no second command surface to keep in sync.
  const { candidates, error: searchError } = useSearchCandidates();
  const openStudent = useStudentsStore((s) => s.openDrawer);
  const searchInputRef = useRef<HTMLDivElement>(null);
  const [paletteQuery, setPaletteQuery] = useState("");

  const focusPalette = () => {
    const field = searchInputRef.current?.querySelector("input");
    field?.focus();
    field?.select();
  };

  // The palette field belongs to `StudentSearchBox`, which is not this file's
  // seam, so the registry cannot reach it — the shell lends it the focus action
  // and ⌘K / `S` both call it. Unregisters on unmount, so a remounted shell
  // never fires into a detached node.
  useEffect(() => registerPaletteFocus(focusPalette), []);

  // AGENTS.md §2 Rule 10 — keyboard parity for the account menu. The click-
  // outside backdrop is not reachable by keyboard, so without Escape a keyboard
  // user who opened the menu had no conventional way out and focus could be
  // stranded. Escape closes it AND returns focus to the trigger, which is the
  // behaviour a native `role="menu"` popup is expected to have.
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      accountButtonRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  // ONE listener for the whole app. This replaced the shell's private ⌘K
  // handler, which had grown its own copies of the two guards that matter —
  // the caret guard (a shortcut must never steal a half-typed ₹5,000 amount) and
  // the dialog guard (a second surface must never open over a sheet that already
  // asked for focus). In the registry both are stated once, and every chord
  // inherits them.
  //
  // `suspend` covers the account menu, which is a `role="menu"` popup rather
  // than a dialog: the overlay guard cannot see it, and a chord fired behind it
  // would change the screen under a menu the tutor is reading.
  useGlobalShortcuts(SHORTCUT_REGISTRY, { suspend: menuOpen || isSigningOut });

  const onPickStudent = (studentId: string) => {
    openStudent(studentId);
    requestScreen("/students");
  };

  // The document title follows the screen. It used to be a constant, so five
  // screens, five browser tabs and a shared link all claimed to be the same
  // page — the tab a tutor was looking at could not be told from the tab they
  // were not.
  useEffect(() => {
    if (typeof window !== "undefined") {
      document.title = `${activeLabel} · ${instituteName} — BuddySaradhi`;
    }
  }, [activeLabel, instituteName]);

  return (
    <>
      {/* Canvas. ONE layer, no animation.
          This used to hold three `w-[45vw] rounded-full blur-[65px] opacity-[0.12]
          animate-blob-*` divs running `blob-shift-*` on a 25/30/28s infinite
          alternate loop, on all five screens, forever. That was decorative motion
          as page furniture: a compositor reserved on every device to move
          something that is not a state change, on top of a `filter: blur()` (which
          per material-modes.md §5.3 creates a backdrop root and would have silently
          broken every `backdrop-filter` in the tree). The committed world already
          lives in `--canvas`, which is a gradient — so removing the blobs LOSES
          nothing and restores the nav/topbar material. Craft floor: one authored
          moment, not scattered effects. */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none overflow-hidden z-0"
        style={{ background: "var(--canvas)" }}
      />

      <div
        className="min-h-[100dvh] flex flex-col md:flex-row overflow-hidden selection:bg-success/30 relative z-10 w-full"
        style={{ background: "transparent", color: "var(--text-primary)" }}
      >
        {/* Sidebar — glass panel */}
        <aside
          className="hidden md:flex md:w-64 md:flex-col z-20 shrink-0"
          style={{
            background: "var(--surface-raised)",
            backdropFilter: "var(--mat-filter)",
            borderRight: "1px solid var(--border-default)",
          }}
        >
          {/* Logo */}
          <div
            className="h-16 flex items-center px-6 shrink-0"
            style={{ borderBottom: "1px solid var(--border-default)" }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shadow-lg"
              style={{
                background: "linear-gradient(135deg, var(--accent-primary), var(--accent-text))",
                color: "var(--accent-on-primary)",
                fontFamily: "var(--font-heading)",
              }}
            >
              T
            </div>
            <span
              className="ml-3 font-semibold tracking-wide text-sm truncate max-w-[150px]"
              style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
            >
              {instituteName}
            </span>
          </div>

          {/* Nav. `role="navigation"` was removed: the element is already a
              <nav>, and a redundant role is a lie an assistive tech has to
              reconcile. `aria-current="page"` was removed too — it claims the
              button IS a page, and none of the five is a route (AGENTS.md §2
              Rule 4: one route, five screens). These buttons switch a screen
              within the page, so `aria-current="true"` is the honest state:
              it is what a screen reader announces as "current". */}
          <nav className="flex-1 px-4 py-6 space-y-1" aria-label="Screens">
            {SCREENS.map((screen, index) => {
              const Icon = SCREEN_ICONS[screen.id];
              const isActive = activeScreen === screen.id;
              const chord = screenChord(index);
              return (
                <button
                  key={screen.id}
                  onClick={() => requestScreen(screen.id)}
                  aria-current={isActive ? "true" : undefined}
                  aria-label={`${screen.label} — press ${chord}`}
                  title={`${screen.label} (${chord})`}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 group text-left",
                    "min-h-[44px]"
                  )}
                  style={
                    isActive
                      ? {
                          background: `color-mix(in srgb, var(--accent-primary) 12%, transparent)`,
                          color: "var(--accent-primary)",
                          border: `1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent)`,
                        }
                      : {
                          color: "var(--text-secondary)",
                          border: "1px solid transparent",
                        }
                  }
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = "var(--surface-raised)";
                      e.currentTarget.style.color = "var(--text-primary)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--text-secondary)";
                    }
                  }}
                >
                  <Icon
                    className="w-5 h-5 shrink-0"
                    style={{ color: isActive ? "var(--accent-primary)" : "var(--text-muted)" }}
                    aria-hidden="true"
                  />
                  <span className="font-medium text-sm">{screen.label}</span>
                  {/* The chord is visible, not just in the tooltip: a tutor who
                      has never pressed `g` still learns it by looking down the
                      nav, where "g then 4" sits beside the fourth row. */}
                  <kbd
                    aria-hidden="true"
                    className="ml-auto text-[10px] px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      fontFamily: "var(--font-mono)",
                      background: "var(--surface-raised)",
                      border: "1px solid var(--border-default)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {chord}
                  </kbd>
                </button>
              );
            })}
          </nav>

          {/* Sync + search bottom area */}
          <div className="p-4 shrink-0" style={{ borderTop: "1px solid var(--border-default)" }}>
            {/* Connection state. This used to be a 2px green dot with a `title`
                and no role, no tabIndex and no handler — colour was the only
                signal, the tooltip was invisible to a keyboard or a screen reader,
                the wrapper carried `cursor-pointer` so it read as a control that
                did nothing, and the dot was ALWAYS green regardless of the real
                state. Now the state is text first, the dot is decoration, and the
                row exposes it to assistive tech (Rule 10 / AP-14: colour is never
                the only signal). */}
            <div
              className="flex min-h-[44px] items-center justify-between px-3 py-2 text-sm rounded-lg"
              style={{ color: "var(--text-secondary)" }}
              role="status"
              aria-live="polite"
              aria-label={
                isOffline ? "Sync: offline, changes are queued" : "Sync: online, all changes saved"
              }
            >
              <span className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                {isOffline ? "Sync · offline" : "Sync"}
              </span>
              <span
                aria-hidden="true"
                className="w-2 h-2 rounded-full"
                style={{
                  background: isOffline ? "var(--warning)" : "var(--success)",
                  boxShadow: `0 0 6px ${isOffline ? "var(--warning)" : "var(--success)"}`,
                }}
              />
            </div>
            <button
              type="button"
              onClick={focusPalette}
              aria-label="Find a student — press s, or Command K"
              className="mt-2 w-full min-h-[44px] flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
              style={{ background: "var(--surface-inset)", color: "var(--text-muted)" }}
            >
              <span className="flex items-center gap-2">
                <Search className="w-4 h-4" aria-hidden="true" />
                Find a student…
              </span>
              {/* Both chords, because both exist: `S` for a bare hand on the
                  home row, ⌘K for the muscle memory every other app trained. */}
              <span className="flex items-center gap-1">
                <kbd
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    fontFamily: "var(--font-mono)",
                    background: "var(--surface-raised)",
                    border: "1px solid var(--border-default)",
                    color: "var(--text-muted)",
                  }}
                >
                  s
                </kbd>
                <kbd
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    fontFamily: "var(--font-mono)",
                    background: "var(--surface-raised)",
                    border: "1px solid var(--border-default)",
                    color: "var(--text-muted)",
                  }}
                >
                  ⌘K
                </kbd>
              </span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col h-auto md:h-screen relative z-10 min-w-0 min-h-0">

          {/* Topbar */}
          <header
            className="h-16 flex items-center justify-between px-4 sm:px-6 md:px-8 shrink-0"
            style={{
              background: "var(--surface-raised)",
              backdropFilter: "var(--mat-filter)",
              borderBottom: "1px solid var(--border-default)",
            }}
          >
            <div className="flex items-center gap-2 sm:gap-4">
              {/* The screen label is redundant with the mobile bottom nav, which already
                  names the active screen — so the search field owns the small widths. */}
              <h2
                className="hidden sm:block text-base font-semibold truncate max-w-[200px]"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                {activeLabel}
              </h2>
              <div ref={searchInputRef} className="flex-1 min-w-0 max-w-xs">
                <StudentSearchBox
                  label="Find a student"
                  value={paletteQuery}
                  onValueChange={setPaletteQuery}
                  onSelect={onPickStudent}
                  candidates={candidates}
                  placeholder="Find a student…"
                  emptyLabel="No student matches that search"
                  error={searchError}
                />
              </div>
              {/* Discoverability for the accelerators themselves. The `?`
                  button is the one thing that makes the other nine chords
                  findable by a tutor who does not know they exist; it is in the
                  topbar so it is on every screen at every width, including the
                  phone widths where the sidebar is `hidden`. */}
              <ShortcutHelpButton />
              <div className="relative">
                {/* Account menu. This used to be a hardcoded "RS" in a
                  `role="button"` div — a person who does not exist, standing in
                  for the signed-in tutor, on every screen. A fabricated identity
                  is worse than none: craft floor, "claims come from supplied
                  truth". The app has no tutor-name field on `settings`, so the
                  control now shows WHAT it is — the account menu — and the real
                  button carries the interaction (the 44px target and the
                  `aria-haspopup` semantics move onto a real <button>, removing a
                  div that pretended to be a control and a nested-interactive
                  hazard for assistive tech). */}
              <button
                ref={accountButtonRef}
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Account menu"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-all
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
                style={{
                  background:
                    "color-mix(in srgb, var(--accent-primary) 15%, var(--surface-raised))",
                  border: "2px solid var(--border-strong)",
                  color: "var(--accent-primary)",
                }}
              >
                <User className="w-4 h-4" aria-hidden="true" />
              </button>

                {menuOpen && (
                  <>
                    {/* Backdrop to close dropdown on click outside */}
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                    
                    {/* Dropdown Menu */}
                    <div
                      className="absolute right-0 mt-2 w-48 rounded-xl z-50 animate-in fade-in slide-in-from-top-2 duration-150 border border-[var(--border-default)] overflow-hidden shadow-2xl"
                      style={{
                        background: "var(--surface-overlay)",
                        backdropFilter: "var(--mat-filter)",
                      }}
                      role="menu"
                      aria-label="User menu"
                    >
                      <button
                        role="menuitem"
                        onClick={() => {
                          requestScreen("/settings");
                          setMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-raised)] text-left min-h-[44px] cursor-pointer"
                      >
                        <User className="w-4 h-4 text-[var(--text-muted)]" />
                        Settings Profile
                      </button>
                      <div className="h-px bg-[var(--border-default)] w-full" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={onSignOut}
                        disabled={isSigningOut}
                        aria-busy={isSigningOut}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10 text-left min-h-[44px] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <LogOut className="w-4 h-4" />
                        {isSigningOut ? "Signing out…" : "Log Out"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>

          {/* Scrollable Content Area. `role="main"` was removed: the <main> element
              immediately below already IS the main landmark, so the wrapper was
              declaring a second one — a screen reader's landmark list showed two
              identical "main" entries, and rotor/quick-navigation gave the tutor
              nothing to jump between. `id="main-content"` + `tabIndex={-1}` are
              the skip link's target (WCAG 2.4.1): without the tabindex the
              fragment link scrolls but leaves focus in the nav, which is the one
              outcome a skip link exists to prevent. */}
          <div className="flex-1 overflow-auto flex flex-col no-scrollbar">
            <main
              id="main-content"
              tabIndex={-1}
              className="flex-1 p-4 sm:p-6 md:p-8 pb-16 md:pb-8 relative max-w-7xl mx-auto w-full focus:outline-none"
            >
              {/* AGENTS.md §2 Rule 9. The failure is stated above the screen, not
                  swallowed into a default institute name, and it does NOT block the
                  five screens — none of them need the settings row to work. It sits
                  in the scroll area rather than the sidebar so it is visible on
                  mobile too (`<aside>` is `hidden md:flex`), and it reuses the
                  shared `ErrorState` so the wording and the recovery match every
                  other dead end in the app. */}
              {settingsErrorState && (
                <ErrorState
                  state={settingsErrorState}
                  dataStatus="Your students, attendance and fees are unaffected — only the institute name and preferences could not load."
                  onRetry={() => {
                    void refetchSettings();
                  }}
                  isRetrying={settingsFetching}
                  retryLabel="Reload settings"
                  className="mb-6 p-4 md:p-5"
                />
              )}
              {children}
            </main>

            {/* Sticky Footer — always visible (desktop) */}
            <footer
              className="h-12 flex items-center justify-between px-4 sm:px-6 md:px-8 text-xs shrink-0 mt-auto max-w-7xl mx-auto w-full"
              style={{
                background: "var(--surface-inset)",
                backdropFilter: "var(--mat-filter)",
                borderTop: "1px solid var(--border-default)",
                color: "var(--text-muted)",
                paddingBottom: "env(safe-area-inset-bottom)",
              }}
            >
              {/* Connection state and the outbox count. The invented
                  `Local DB: 2.1 MB` is GONE: it was a hardcoded string, so every
                  tutor was told their database was 2.1 MB forever regardless of
                  the truth, and craft floor is explicit — "claims come from
                  supplied truth; label illustrative values honestly". Nothing in
                  the app measures the local DB, so the honest footer states the
                  one fact it can actually know. The version next to it read
                  `v1.0.0-rc` while `apps/web/package.json` says `1.0.0`; it now
                  reads the one number that is checked into the repository. */}
              <div className="flex gap-4 items-center">
                {isOffline
                  ? <><WifiOff className="w-3 h-3" aria-hidden="true" /> <span>Offline · {pendingSyncCount} pending</span></>
                  : <><Wifi className="w-3 h-3" style={{ color: "var(--success)" }} aria-hidden="true" /> <span>Online · {pendingSyncCount} pending</span></>
                }
              </div>
              <div className="flex gap-4">
                <span style={{ fontFamily: "var(--font-mono)" }}>v{packageJson.version}</span>
                <span>© 2026 BuddySaradhi</span>
              </div>
            </footer>
          </div>
        </div>

        {/* Mobile bottom-tab navigation — visible only below md. Same
            correction as the sidebar: these are not pages (one route, five
            screens — AGENTS.md §2 Rule 4), so they report `aria-current="true"`.
            The icon and the label are BOTH there, so the active tab is never
            signalled by colour alone (Rule 10 / AP-14). */}
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 z-30 flex items-stretch justify-around"
          style={{
            background: "var(--surface-raised)",
            backdropFilter: "var(--mat-filter)",
            borderTop: "1px solid var(--border-default)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
          aria-label="Screens"
        >
          {SCREENS.map((screen) => {
            const Icon = SCREEN_ICONS[screen.id];
            const isActive = activeScreen === screen.id;
            return (
              <button
                key={screen.id}
                onClick={() => requestScreen(screen.id)}
                aria-current={isActive ? "true" : undefined}
                aria-label={screen.label}
                className="flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px]"
                style={
                  isActive
                    ? { color: "var(--accent-primary)" }
                    : { color: "var(--text-muted)" }
                }
              >
                <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                {/* `short` exists for this line only: "Fees & Payments" split to
                    "Fees" by hand here used to be a second, invisible copy of the
                    nav label that could drift from the table. */}
                <span className="text-[10px] font-medium leading-none">{screen.short}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* The screen-change refusal. It is the SAME prompt the sheets use, so
          "Discard" means one thing app-wide, and it composes the same overlay
          hook — which matters here for a mechanical reason: once this prompt is
          the topmost layer, the sheet underneath stops owning Escape and Tab, so
          a tutor cannot dismiss the sheet and land back on the old screen with
          the work gone and the question never answered. */}
      <DiscardChangesPrompt
        open={blockedScreen !== null}
        question={blockedScreen?.question ?? ""}
        onKeep={() => setBlockedScreen(null)}
        onDiscard={() => {
          const target = blockedScreen?.screen ?? null;
          setBlockedScreen(null);
          if (target === null) return;
          // The tutor chose the loss, so the sheets go without asking twice.
          closeFeeSheets();
          setActiveScreen(target);
        }}
      />
    </>
  );
}
