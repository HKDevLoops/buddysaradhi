"use client";

// Implements: 08_Settings.md §About (identity, and the honest boundaries of the
// build) and AGENTS.md §2 Rule 2 (no outbound network call, so nothing here
// points at a document this app cannot fetch) and Rule 9 (no silent failure —
// a link that does not resolve is stated as absent, not rendered as a promise).
//
// This block linked to `/terms`, `/privacy` and `/faq`. The only routes that
// exist are `/dashboard`, the `(auth)` group and `/api/*`, so all three 404'd.
// Two of the three are not even documents this product has: there is no terms
// document and no privacy manifest, and inventing a link to one teaches a tutor
// that the app's links can be trusted. What IS real, and what these promises
// were reaching for, is in the app: how it handles data (Settings → Data &
// Privacy) and how it works (Settings → Help). Both are one click away, with the
// unsaved-changes guard the nav rail uses, so leaving a dirty section for Help
// still asks first.
//
// The `ExternalLink` icon went with them: these destinations are inside the
// app, and an outward-pointing arrow is a lie about where you are going.

import { ChevronRight, ShieldCheck } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";

export function AboutSection() {
  // The same guard the settings nav uses: ask before discarding a section with
  // unsaved edits, otherwise just move.
  const { hasUnsavedChanges, setActiveSection, setPendingNav } = useSettingsStore();
  const openSection = (id: "help" | "data-privacy") => {
    if (hasUnsavedChanges()) setPendingNav(id);
    else setActiveSection(id);
  };

  return (
    <section className="space-y-6 max-w-[52rem]">
      <div className="flex items-center gap-4">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold"
          style={{ background: "var(--info)", color: "var(--accent-on-primary)" }}
          aria-hidden="true"
        >
          T
        </div>
        <div>
          <h3 className="text-xl font-bold text-[var(--text-primary)] tracking-tight">BuddySaradhi</h3>
          <p className="text-sm text-[var(--text-muted)]">Version 1.0.0-rc (Build 8421)</p>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border-default)] p-5">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2">The Operating System for Tutors</h4>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-[68ch]">
          BuddySaradhi is built on a sovereign, offline-first architecture. Your data never leaves
          your device unless it is end-to-end encrypted for backup. There is no telemetry, no
          analytics tracking, and no central server that holds your student records.
        </p>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => openSection("data-privacy")}
          className="w-full flex items-center justify-between gap-3 p-4 rounded-xl btn-glass min-h-[44px] text-left transition-colors"
          style={{ background: "var(--surface-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
        >
          <span className="text-sm font-semibold">What this app does with your data</span>
          <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "var(--text-muted)" }} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => openSection("help")}
          className="w-full flex items-center justify-between gap-3 p-4 rounded-xl btn-glass min-h-[44px] text-left transition-colors"
          style={{ background: "var(--surface-inset)", border: "1px solid var(--border-default)", color: "var(--text-primary)" }}
        >
          <span className="text-sm font-semibold">How Buddysaradhi works</span>
          <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "var(--text-muted)" }} aria-hidden="true" />
        </button>
      </div>

      <p className="flex items-start gap-2 text-sm leading-relaxed max-w-[68ch]" style={{ color: "var(--text-secondary)" }}>
        <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--text-muted)" }} aria-hidden="true" />
        <span>
          There is no terms of service or privacy manifest in this build, so there is no link to
          either. The two things those documents would have told you — what happens to your data,
          and how the app behaves — are in the two screens above.
        </span>
      </p>

      <div className="text-center pt-8 text-xs text-[var(--text-muted)] opacity-70">
        &copy; 2026 BuddySaradhi Contributors.
        <br />
        Built with precision.
      </div>
    </section>
  );
}
