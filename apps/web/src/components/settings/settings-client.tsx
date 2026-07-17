"use client";

// Implements: UI/web/08_Settings.md — SettingsClient
// Settings wrapper layout with full integration of palette variables.

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
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/server/queries/settings";

export function SettingsClient() {
  const { activeSection, pendingNav, confirmDiscard, cancelDiscard } = useSettingsStore();

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettings(),
  });

  const settingsData = data?.data;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings = (settingsData || {}) as any;

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
            background: "color-mix(in srgb, var(--bg-canvas) 90%, transparent)",
            backdropFilter: "blur(12px)",
            borderColor: "color-mix(in srgb, var(--accent-danger) 30%, transparent)",
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
                background: "color-mix(in srgb, var(--accent-danger) 15%, transparent)",
                color: "var(--accent-danger)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "color-mix(in srgb, var(--accent-danger) 25%, transparent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "color-mix(in srgb, var(--accent-danger) 15%, transparent)";
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-6 flex-grow">
        {/* Navigation - rail on desktop, pill scroller on mobile */}
        <SettingsNav />

        {/* Main Content Area - glass-strong */}
        <div className="glass-strong flex-1 rounded-xl p-6 md:p-8 text-[var(--text-primary)]">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-primary)" }} />
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
