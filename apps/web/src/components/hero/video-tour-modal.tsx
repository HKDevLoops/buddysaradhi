"use client";

// Implements: 13_UI_Guidelines.md §8.7 (modal: Escape, focus trap, focus
// return, scrim) and AGENTS.md §2 Rule 10 (WCAG 2.1 AA dialog pattern —
// labelled, modal, focus trapped and returned, keyboard parity) + §7.2
// (`prefers-reduced-motion` is honoured by every entrance animation).
//
// Hardening (docs/design/overhaul-plan.md §2): this modal had its own
// hand-rolled `keydown` listener and nothing else — no focus trap, so Tab
// walked out of the dialog and into the page behind it; no focus return, so
// Escape left focus on `<body>`; and no scroll lock, so the page behind scrolled
// while the video panel was open. One bespoke listener is exactly the
// pass-through smell the shared `useOverlayDismiss` module exists to remove:
// deleting it deleted complexity instead of moving it, so this migrates onto the
// module rather than adding a second dismissal path.
//
// The entrance fade is now `motion-safe:`-gated — `animate-in` did not consult
// `prefers-reduced-motion`, so a tutor with vestibular sensitivity got a full
// fade-in on every open (AP-20).

import React from "react";
import { Play, ShieldCheck, Zap, Layers } from "lucide-react";
import { useOverlayDismiss, OverlayCloseButton } from "@/components/ui/overlay";

interface VideoTourModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function VideoTourModal({ isOpen, onClose }: VideoTourModalProps) {
  const { panelRef, onScrimClick } = useOverlayDismiss({
    open: isOpen,
    onClose,
    label: "product tour",
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Scrim — dismissal goes through the shared overlay module. */}
      <div
        className="absolute inset-0 bg-black/70 [backdrop-filter:var(--mat-filter)] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
        onClick={onScrimClick}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-tour-title"
        tabIndex={-1}
        className="glass-strong relative w-full max-w-4xl rounded-2xl overflow-hidden border border-[var(--border-default)] shadow-[0_0_50px_color-mix(in_srgb,var(--info)_0.15,transparent)] p-6 md:p-8"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-3 h-3 rounded-full shrink-0 bg-[var(--info)] shadow-[0_0_10px_color-mix(in_srgb,var(--info)_0.6,transparent)]"
              aria-hidden="true"
            />
            <h3
              id="video-tour-title"
              className="text-lg md:text-xl font-bold text-[var(--text-primary)]"
            >
              BuddySaradhi — 90-Second Product Tour
            </h3>
          </div>
          <OverlayCloseButton onClick={onClose} label="Close product tour" />
        </div>

        {/* Video / Interactive Presentation Screen */}
        <div className="relative aspect-video w-full rounded-xl bg-[var(--surface-sunken)] border border-[var(--border-default)] overflow-hidden flex flex-col items-center justify-center p-8 text-center">
          <div className="absolute inset-0 bg-gradient-to-tr from-[var(--info)]/10 via-transparent to-[var(--info)]/10 pointer-events-none" aria-hidden="true" />

          <div className="w-16 h-16 rounded-full bg-[var(--info)]/20 border border-[var(--info)] flex items-center justify-center mb-6 shadow-[0_0_30px_color-mix(in_srgb,var(--info)_0.4,transparent)]">
            <Play className="w-8 h-8 text-[var(--info)] fill-[var(--info)] translate-x-0.5" aria-hidden="true" />
          </div>

          <h4 className="text-xl md:text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
            5 Persistent Screens. 7 Powerful Engines.
          </h4>
          <p className="text-sm md:text-base max-w-lg mb-6" style={{ color: "var(--text-secondary)" }}>
            Every fee, payment and attendance record lives in one append-only ledger you can audit
            line by line — and it all keeps working when the network does not.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-md text-left">
            <div className="p-3 rounded-lg" style={{ background: "var(--surface-inset)", border: "1px solid var(--border-default)" }}>
              <Layers className="w-4 h-4 mb-1" style={{ color: "var(--success)" }} aria-hidden="true" />
              <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Five screens, no sprawl</p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Dashboard, students, attendance, fees, settings</p>
            </div>
            <div className="p-3 rounded-lg" style={{ background: "var(--surface-inset)", border: "1px solid var(--border-default)" }}>
              <Zap className="w-4 h-4 mb-1" style={{ color: "var(--warning)" }} aria-hidden="true" />
              <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Offline-first</p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Your own database, writes replay on reconnect</p>
            </div>
            <div className="p-3 rounded-lg" style={{ background: "var(--surface-inset)", border: "1px solid var(--border-default)" }}>
              <ShieldCheck className="w-4 h-4 mb-1" style={{ color: "var(--info)" }} aria-hidden="true" />
              <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Append-only ledger</p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Corrections are new rows, never edits</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-between gap-3 flex-wrap text-xs" style={{ color: "var(--text-muted)" }}>
          <span>Press Esc or click outside to close</span>
          <span className="font-medium" style={{ color: "var(--info)" }}>v1.0.0 Pro Preview</span>
        </div>
      </div>
    </div>
  );
}