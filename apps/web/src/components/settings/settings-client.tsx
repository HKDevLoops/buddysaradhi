"use client";

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

  // A `success: true, data: null` read means the row genuinely does not exist
  // yet (a brand-new tutor), which is NOT a failure — the sections own their
  // defaults for that case.
  const settingsData = data?.success === true ? data.data : null;
  // Fresh object literal so it satisfies `Settings` structurally: `Settings`
  // declares an index signature, and a spread (unlike an `interface` source)
  // carries the implicit index signature that makes this assignment legal
  // without a cast.
  const settings: Settings = { ...(settingsData ?? {}) };

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
          this branch exists to prevent. */}
      {isLoading ? (
        <ScreenSkeleton shape="form" label="your settings" rows={6} />
      ) : failure ? (
        <ErrorState
          state={toAppErrorState(failure)}
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

          {/* Main Content Area - glass-strong */}
          <div className="glass-strong flex-1 rounded-xl p-6 md:p-8 text-[var(--text-primary)]">
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
