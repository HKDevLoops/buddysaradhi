"use client";

import React, { useEffect } from "react";
import { X, Play, ShieldCheck, Zap, Layers } from "lucide-react";

interface VideoTourModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function VideoTourModal({ isOpen, onClose }: VideoTourModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="BuddySaradhi 90-Second Product Tour"
      onClick={onClose}
    >
      <div
        className="glass-strong relative w-full max-w-4xl rounded-2xl overflow-hidden border border-[var(--border-glass)] shadow-[0_0_50px_rgba(0,240,255,0.15)] p-6 md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[var(--accent-cyan)] shadow-[0_0_10px_rgba(0,240,255,0.6)]" />
            <h3 className="text-lg md:text-xl font-bold text-[var(--text-primary)]">
              BuddySaradhi — 90-Second Product Tour
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video / Interactive Presentation Screen */}
        <div className="relative aspect-video w-full rounded-xl bg-[#0a0a1a] border border-[var(--border-default)] overflow-hidden flex flex-col items-center justify-center p-8 text-center">
          <div className="absolute inset-0 bg-gradient-to-tr from-[var(--accent-violet)]/10 via-transparent to-[var(--accent-cyan)]/10 pointer-events-none" />
          
          <div className="w-16 h-16 rounded-full bg-[var(--accent-cyan)]/20 border border-[var(--accent-cyan)] flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(0,240,255,0.4)]">
            <Play className="w-8 h-8 text-[var(--accent-cyan)] fill-[var(--accent-cyan)] translate-x-0.5" />
          </div>

          <h4 className="text-xl md:text-2xl font-bold text-white mb-2">
            5 Persistent Screens. 7 Powerful Engines.
          </h4>
          <p className="text-sm md:text-base text-[var(--text-muted)] max-w-lg mb-6">
            From offline-first ledger auditing to automated WhatsApp fee reminders, see how BuddySaradhi simplifies tuition management.
          </p>

          <div className="grid grid-cols-3 gap-4 w-full max-w-md text-left">
            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <Layers className="w-4 h-4 text-[var(--accent-emerald)] mb-1" />
              <p className="text-xs font-semibold text-white">Zero Slop UI</p>
              <p className="text-[10px] text-[var(--text-muted)]">Vibrant glass styling</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <Zap className="w-4 h-4 text-[var(--accent-amber)] mb-1" />
              <p className="text-xs font-semibold text-white">Offline-First</p>
              <p className="text-[10px] text-[var(--text-muted)]">Single-tenant SQLite</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <ShieldCheck className="w-4 h-4 text-[var(--accent-cyan)] mb-1" />
              <p className="text-xs font-semibold text-white">Append-Only</p>
              <p className="text-[10px] text-[var(--text-muted)]">Immutable ledgers</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>Press ESC or click outside to close</span>
          <span className="text-[var(--accent-cyan)] font-medium">v1.0.0 Pro Preview</span>
        </div>
      </div>
    </div>
  );
}
