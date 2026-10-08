"use client";

// Implements: UI/web/08_Settings.md — SettingsNav
// Left navigation rail for settings sections. Active link highlighted with accent.

import { useSettingsStore, SettingsSectionId } from "@/stores/settings-store";
import {
  UserCircle, Palette, Clock, Receipt, Bell, Shield,
  HardDrive, FileDown, ShieldAlert, Info, HelpCircle, Activity, Database,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// `satisfies SettingsSectionId` is the whole point of this annotation. The
// thirteen section ids are declared TWICE — as the union in `settings-store.ts`
// and as the `id:` values here — and before it was checked, the two could drift
// silently: a typo'd id compiled fine and was then laundered into a store call
// by two `as SettingsSectionId` casts. With the constraint in place a typo is a
// compile error, the inferred `section.id` stays assignable to the union, and
// both casts are gone (AGENTS.md §6.1 — no `as` without a SAFETY comment, and
// this removes two rather than justifying them).
const SECTIONS = [
  { id: "profile", label: "Profile", icon: UserCircle },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "attendance-rules", label: "Attendance Rules", icon: Clock },
  { id: "fee-rules", label: "Fee Rules", icon: Receipt },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
  { id: "database", label: "Database", icon: Database },
  { id: "backup-restore", label: "Backup & Restore", icon: HardDrive },
  { id: "import-export", label: "Import & Export", icon: FileDown },
  { id: "data-privacy", label: "Data & Privacy", icon: ShieldAlert },
  { id: "about", label: "About", icon: Info },
  { id: "help", label: "Help", icon: HelpCircle },
  { id: "diagnostics", label: "Diagnostics", icon: Activity },
] as const satisfies readonly { id: SettingsSectionId; label: string; icon: LucideIcon }[];

export function SettingsNav() {
  const { activeSection, setPendingNav, hasUnsavedChanges, setActiveSection, dirtySections } = useSettingsStore();

  const handleNav = (id: SettingsSectionId) => {
    if (activeSection === id) return;
    if (hasUnsavedChanges()) {
      setPendingNav(id);
    } else {
      setActiveSection(id);
    }
  };

  return (
    <nav className="sm:w-64 shrink-0 overflow-x-auto sm:overflow-visible no-scrollbar" aria-label="Settings sections">
      <div className="flex sm:flex-col gap-1 min-w-max sm:min-w-0 pb-2 sm:pb-0">
        {SECTIONS.map((section) => {
          const isActive = activeSection === section.id;
          const isDirty = dirtySections.has(section.id);

          return (
            <button
              key={section.id}
              onClick={() => handleNav(section.id)}
              aria-label={section.label}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-150 whitespace-nowrap text-left cursor-pointer border min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]",
                isActive
                  ? "bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] text-[var(--accent-primary)] border-[var(--accent-primary)] shadow-[0_0_16px_color-mix(in_srgb,var(--accent-primary)_20%,transparent)]"
                  : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)]"
              )}
            >
              <div className="flex items-center gap-3">
                <section.icon
                  className="w-4 h-4 shrink-0"
                  style={{ color: isActive ? "var(--accent-primary)" : "var(--text-muted)" }}
                />
                {section.label}
              </div>
              {isDirty && (
                // 08_Settings.md §18 "Color + icon pairing": a status dot must
                // never be colour alone. An amber dot also carried an
                // `aria-label` that sighted users never saw, so a tutor who
                // cannot distinguish amber from the surrounding border had no
                // way to know a section had unsaved edits. It is now a dot AND
                // a word.
                <span className="flex items-center gap-1.5 shrink-0">
                  <span
                    aria-hidden="true"
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: "var(--warning)" }}
                  />
                  <span className="text-[11px] font-medium text-[var(--warning)]">Unsaved</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
