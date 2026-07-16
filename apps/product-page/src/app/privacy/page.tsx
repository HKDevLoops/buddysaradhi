import React from "react";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { ShieldAlert, Key, EyeOff, FileOutput } from "lucide-react";

export const metadata = {
  title: "Privacy Policy — BuddySaradhi",
  description: "Our privacy-first commitment: no telemetry, single-tenant database isolation, and sovereign data backups.",
};

export default function PrivacyPage() {
  return (
    <MarketingLayout>
      <div className="container mx-auto px-6 max-w-4xl py-12">
        <div className="text-center mb-16">
          <span className="chip chip-info mb-4">Privacy Policy</span>
          <h1 className="font-[family-name:var(--font-heading)] text-4xl md:text-5xl font-bold tracking-tight text-[var(--text-primary)]">
            Our Privacy Commitment
          </h1>
          <p className="mt-4 text-[var(--text-secondary)] text-sm md:text-base max-w-2xl mx-auto">
            BuddySaradhi is built for tutors whose business relies on trust. We believe your student roster, attendance history, and financial ledger should belong solely to you.
          </p>
        </div>

        {/* Pillars of Privacy Grid */}
        <div className="grid gap-6 md:grid-cols-2 mb-16">
          <div className="glass p-6 rounded-2xl border border-[var(--border-glass)]">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] mb-4">
              <EyeOff className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-lg text-[var(--text-primary)] mb-2">Zero Telemetry & Ad-Tracking</h3>
            <p className="text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed">
              We do not embed Google Analytics, Mixpanel, Sentry, or any third-party marketing SDKs. We have exactly zero marketing partners. We do not track you.
            </p>
          </div>

          <div className="glass p-6 rounded-2xl border border-[var(--border-glass)]">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] mb-4">
              <Key className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-lg text-[var(--text-primary)] mb-2">Single-Tenant DB Isolation</h3>
            <p className="text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed">
              Every tutor receives a dedicated, separate SQLite database file powered by Turso (Mumbai region). Your student records are never co-mingled with another tutor's data.
            </p>
          </div>

          <div className="glass p-6 rounded-2xl border border-[var(--border-glass)]">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] mb-4">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-lg text-[var(--text-primary)] mb-2">AES-256-GCM Encrypted Backups</h3>
            <p className="text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed">
              Your automated backup files (.buddysaradhi) are encrypted directly on your local device before being packaged, using key-stretching parameters derived from a password only you know.
            </p>
          </div>

          <div className="glass p-6 rounded-2xl border border-[var(--border-glass)]">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] mb-4">
              <FileOutput className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-lg text-[var(--text-primary)] mb-2">Total Data Portability</h3>
            <p className="text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed">
              You can download your raw SQLite database or run a full schema export in a single click from the Settings panel. We never lock you into our platform.
            </p>
          </div>
        </div>

        {/* DPDP 2025 Plain English Rights */}
        <div className="glass p-8 rounded-3xl border border-[var(--border-glass)] space-y-6">
          <h2 className="font-[family-name:var(--font-heading)] text-2xl font-bold text-[var(--text-primary)]">
            Your Rights under DPDP 2025 & GDPR
          </h2>
          
          <div className="space-y-4 text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed">
            <div>
              <h4 className="font-semibold text-[var(--text-primary)]">1. Right to Access and Correction</h4>
              <p>You can view and modify all student data, batches, and ledger records directly within the app interface. Any edits or corrections are instantly updated in your local database node.</p>
            </div>
            <div>
              <h4 className="font-semibold text-[var(--text-primary)]">2. Right to Erasure</h4>
              <p>Under Settings → Account → Erase, you can trigger a secure, multi-pass erase operation that wipes all tables and database fields. This operation cannot be undone.</p>
            </div>
            <div>
              <h4 className="font-semibold text-[var(--text-primary)]">3. Data Residency</h4>
              <p>All database instances are provisioned within AWS and Turso cloud nodes located physically in the Mumbai (India) region, ensuring full compliance with local sovereign data guidelines.</p>
            </div>
          </div>
          
          <div className="border-t border-[var(--border-glass)]/20 pt-6 text-center text-xs text-[var(--text-muted)]">
            Questions? Contact our Privacy team at <a href="mailto:hello@buddysaradhi.app" className="text-[var(--accent-cyan)] underline">hello@buddysaradhi.app</a>. Last updated: July 2026.
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
}
