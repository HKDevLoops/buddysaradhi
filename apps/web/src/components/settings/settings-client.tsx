"use client";

import { useEffect, useMemo } from "react";

// Implements: UI/web/08_Settings.md — SettingsClient
// Settings wrapper layout with full integration of palette variables.
// AGENTS.md §2 Rule 9: `getSettings` returns a `{ success: false, error }`
// ENVELOPE rather than throwing, so a failed read used to fall through as
// `settings = {}` and render all thirteen sections over an empty object — a
// fully populated Settings screen that was silently not the tutor's settings,
// and a save would have overwritten the truth with defaults. The failure is now
// classified through `toAppErrorState` and short-circuits the whole section
// tree behind a Retry. AGENTS.md §6.1: the object is a real spread, not `any`.

import { useSettingsStore } from "@/stores/settings-store";
import { SettingsNav } from "./settings-nav";
import { ProfileSection } from "./profile-section";
import { AppearanceSection } from "./appearance-section";
import { AttendanceRulesSection } from "./attendance-rules-section";
import { FeeRulesSection } from "./fee-rules-section";
import { NotificationsSection } from "./notifications-section";
import { SecuritySection } from "./security-section";
import { DatabaseSection } from "./database-section";
import { BackupSection } from "./backup-section";
import { ImportExportSection } from "./import-export-section";
import { DataPrivacySection } from "./data-privacy-section";
import { AboutSection } from "./about-section";
import { HelpSection } from "./help-section";
import { DiagnosticsSection } from "./diagnostics-section";
import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/server/queries/settings";
import { toAppErrorState } from "@/lib/app-errors";
import type { Settings } from "@/types/settings";
import { ErrorState, ScreenSkeleton } from "@/components/ui/screen-state";

export function SettingsClient() {
  const { activeSection, pendingNav, confirmDiscard, cancelDiscard } = useSettingsStore();

  // The store is persisted with `skipHydration` (see settings-store.ts), so the
  // last-visited section arrives AFTER first paint. Re-hydrating in an effect is
  // what makes the server markup and the client's first render agree; without it
  // every returning tutor gets a hydration mismatch and a section that silently
  // jumps back to Profile under their finger.
  useEffect(() => {
    void useSettingsStore.persist.rehydrate();
  }, []);

  const {
    data,
    error,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettings(),
  });

  // Two distinct failures, one branch. `isError` covers a thrown transport
  // error; `success: false` covers the query function's own typed-error
  // envelope, which is the path that actually fires when the gateway refuses.
  const envelopeError =
    data && data.success === false ? data.error : undefined;
  const failure: unknown = isError ? error : envelopeError;

  // WHY A STORE FLAG AND NOT A `useRef` HERE. `getSettings` resolves the refusal
  // envelope as a SUCCESSFUL query whose payload says `success: false`, so
  // `data` is always defined once the first attempt settles and cannot answer
  // "have we ever loaded the tutor's real settings". A `useRef` could — but a ref
  // dies with the component instance, and this screen IS torn down and rebuilt:
  // every one of the thirteen sections calls `revalidatePath("/settings")` from
  // its own mutation, and each `onSettled` invalidates `["settings"]`. The moment
  // that route refresh lands, a ref-based latch is back to `false`, and the next
  // failed background read (gateway `AUTH_REQUIRED`, a cold-isolate connect
  // timeout) tears the rail and the section down again. That is not a theory: it
  // is the call log the 2026-10-08 settings audit produced —
  //
  //   waiting for element to be visible, enabled and stable
  //     - element was detached from the DOM, retrying
  //
  // which is what a 200-second `locator.click` timeout on a Save button actually
  // was: the element under the pointer kept being replaced. The latch lives in
  // the settings store (`hasRealSettings`, monotonic for the whole page load and
  // NOT persisted) so it outlives every remount of this screen.
  //
  // The stale values stay on screen, which is the whole point of a cache with a
  // `staleTime` (02_Core_Logic.md §9): better the previous truth than no truth.
  // Nothing is swallowed — `getSettings` already logged `settings_read_failed` at
  // source (`server/queries/settings.ts`), `isError`/`error` remain in scope for
  // Diagnostics, and `refetch` is still the Retry. Rule 9 is about not pretending
  // a failure did not happen, and this does not.
  const hasRealSettings = useSettingsStore((s) => s.hasRealSettings);
  const markRealSettingsLoaded = useSettingsStore((s) => s.markRealSettingsLoaded);
  // Latched in an EFFECT, not during render. A store write during render makes
  // zustand notify subscribers from inside React's render phase, which React
  // reports as "cannot update a component while rendering a different one" — and
  // `captureErrors` fails a test on any console error, so a "harmless" warning
  // would take the whole suite red. The effect also costs nothing in behaviour:
  // on the successful read itself `failure` is `undefined`, so the content
  // branch renders either way; the latch only has to be true by the time a LATER
  // refetch fails.
  useEffect(() => {
    if (data?.success === true) markRealSettingsLoaded();
  }, [data, markRealSettingsLoaded]);
  const blockingFailure = hasRealSettings ? undefined : failure;

  // A `success: true, data: null` read means the row genuinely does not exist
  // yet (a brand-new tutor), which is NOT a failure — the sections own their
  // defaults for that case.
  const settingsData = data?.success === true ? data.data : null;
  // MEMOISED, and it is load-bearing rather than tidy. `Settings` has an index
  // signature, so the value must be an object literal built by a spread — but a
  // spread produces a NEW identity on every render, and every section takes
  // `settings` as a prop. `profile-section.tsx` keys a `reset()` effect on
  // `[settings, isDirty, reset]`, so a fresh identity each render re-ran that
  // effect on every parent render: the form was reset to whatever the last read
  // said, repeatedly, while the tutor was typing into it. Keying the memo on the
  // payload identity makes the prop change only when the DATA changes.
  const settings: Settings = useMemo(
    () => ({ ...(settingsData ?? {}) }),
    [settingsData],
  );

  return (
    <div className="space-y-6 flex flex-col min-h-[100dvh] relative">
      <div>
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
        >
          Settings
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          Manage your application preferences and security
        </p>
      </div>

      {pendingNav && (
        <div
          className="fixed top-24 left-1/2 -translate-x-1/2 z-50 border rounded-xl p-4 shadow-2xl animate-in slide-in-from-top-4 flex items-center gap-6"
          style={{
            background: "color-mix(in srgb, var(--canvas) 90%, transparent)",
            // docs/design/material-modes.md §2 — the unsaved-changes banner is a
            // floating role; the blur comes from the token, not from a literal that
            // the material switch could not reach.
            backdropFilter: "var(--mat-filter)",
            WebkitBackdropFilter: "var(--mat-filter)",
            borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)",
          }}
        >
          <div>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Unsaved Changes
            </p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              You have unsaved changes in this section.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={cancelDiscard}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              Cancel
            </button>
            <button
              onClick={confirmDiscard}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={{
                background: "color-mix(in srgb, var(--danger) 15%, transparent)",
                color: "var(--danger)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "color-mix(in srgb, var(--danger) 25%, transparent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "color-mix(in srgb, var(--danger) 15%, transparent)";
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Loading and failure replace the nav AND the sections together: a rail
          of thirteen sections over data that never arrived is the exact screen
          this branch exists to prevent. `blockingFailure`, not `failure` — see
          the background-refresh note above; once a read has succeeded, a later
          failed refresh leaves this screen standing.

          THE SKELETON IS GATED ON THE SAME QUESTION, and that is the other half
          of the fix. `isLoading` is true whenever the query has no data for the
          key, which after a `revalidatePath("/settings")` route refresh is a
          window in which the cache has been rebuilt and the read has not landed.
          Un-gated, that window replaced the tutor's whole screen — rail,
          section, unsaved form and all — with a skeleton, then rebuilt it,
          replaying `animate-in slide-in-from-bottom-2` on every section. A test
          clicking a control in that window sees "element is not stable" followed
          by "element was detached from the DOM, retrying", which is exactly how
          a 200s `locator.click` timeout presents. Same predicate, both branches:
          show the skeleton only while we have NEVER had the tutor's real
          settings. */}
      {isLoading && !hasRealSettings ? (
        <ScreenSkeleton shape="form" label="your settings" rows={6} />
      ) : blockingFailure ? (
        <ErrorState
          state={toAppErrorState(blockingFailure)}
          onRetry={() => {
            void refetch();
          }}
          isRetrying={isFetching}
          retryLabel="Reload settings"
          dataStatus="Nothing was changed. No setting was saved, and your saved settings are untouched — this screen is not showing your values."
        />
      ) : (
        <div className="flex flex-col sm:flex-row gap-6 flex-grow">
          {/* Navigation - rail on desktop, pill scroller on mobile */}
          <SettingsNav />

          {/* Content pane: transparent over the canvas. 08_Settings.md §21.1
              specifies the pane as "transparent over canvas (its sub-cards are
              glass)" and each section's own card as the `.glass` workhorse. The
              pane used to be `glass-strong`, which put a glass card inside a
              glass card — 13_UI_Guidelines.md §5.3 no-glass-on-glass, and the
              shape the anti-slop rules call out by name. */}
          <div className="flex-1 rounded-xl p-6 md:p-8 text-[var(--text-primary)]">
            {activeSection === "profile" && <ProfileSection settings={settings} />}
            {activeSection === "appearance" && <AppearanceSection settings={settings} />}
            {activeSection === "attendance-rules" && <AttendanceRulesSection settings={settings} />}
            {activeSection === "fee-rules" && <FeeRulesSection settings={settings} />}
            {activeSection === "notifications" && <NotificationsSection settings={settings} />}
            {activeSection === "security" && <SecuritySection settings={settings} />}
            {activeSection === "database" && <DatabaseSection />}
            {activeSection === "backup-restore" && <BackupSection />}
            {activeSection === "import-export" && <ImportExportSection />}
            {activeSection === "data-privacy" && <DataPrivacySection settings={settings} />}
            {activeSection === "about" && <AboutSection />}
            {activeSection === "help" && <HelpSection />}
            {activeSection === "diagnostics" && <DiagnosticsSection />}
          </div>
        </div>
      )}
    </div>
  );
}
