"use client";

import { ExternalLink } from "lucide-react";

export function AboutSection() {
  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[var(--accent-violet)] to-[var(--accent-cyan)] flex items-center justify-center text-2xl font-bold shadow-lg">
          T
        </div>
        <div>
          <h3 className="text-xl font-bold text-[var(--text-primary)] tracking-tight">BuddySaradhi</h3>
          <p className="text-sm text-[var(--text-muted)]">Version 1.0.0-rc (Build 8421)</p>
        </div>
      </div>
      
      <div className="glass-card rounded-xl p-5 border border-[var(--border-glass)]">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2">The Operating System for Tutors</h4>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          BuddySaradhi is built on a sovereign, offline-first architecture. Your data never leaves your device unless it is end-to-end encrypted for backup. There is no telemetry, no analytics tracking, and no central server that holds your student records.
        </p>
      </div>
      
      <div className="space-y-3">
        <a href="/terms" target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-between p-4 glass-card rounded-xl btn-glass bg-[var(--surface-glass-faint)] border border-[var(--border-glass)] hover:bg-[var(--surface-glass)] hover:text-[var(--text-primary)] hover:border-[color-mix(in srgb,var(--accent-primary)_35%,transparent)] transition-all cursor-pointer group">
          <span className="text-sm font-semibold text-[var(--text-primary)]">Terms of Service</span>
          <ExternalLink className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
        </a>
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-between p-4 glass-card rounded-xl btn-glass bg-[var(--surface-glass-faint)] border border-[var(--border-glass)] hover:bg-[var(--surface-glass)] hover:text-[var(--text-primary)] hover:border-[color-mix(in srgb,var(--accent-primary)_35%,transparent)] transition-all cursor-pointer group">
          <span className="text-sm font-semibold text-[var(--text-primary)]">Privacy Manifest</span>
          <ExternalLink className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
        </a>
        <a href="/faq" target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-between p-4 glass-card rounded-xl btn-glass bg-[var(--surface-glass-faint)] border border-[var(--border-glass)] hover:bg-[var(--surface-glass)] hover:text-[var(--text-primary)] hover:border-[color-mix(in srgb,var(--accent-primary)_35%,transparent)] transition-all cursor-pointer group">
          <span className="text-sm font-semibold text-[var(--text-primary)]">Open Source Licenses & FAQ</span>
          <ExternalLink className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
        </a>
      </div>
      
      <div className="text-center pt-8 text-xs text-[var(--text-muted)] opacity-70">
        &copy; 2026 BuddySaradhi Contributors.<br />
        Built with precision.
      </div>
    </section>
  );
}
