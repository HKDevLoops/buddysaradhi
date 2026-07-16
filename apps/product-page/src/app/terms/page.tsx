import React from "react";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { BookOpen, Scale, ShieldCheck, Database } from "lucide-react";

export const metadata = {
  title: "Terms of Service — BuddySaradhi",
  description: "Terms of Service for BuddySaradhi: single-tenant storage, append-only ledger compliance, and offline availability.",
};

export default function TermsPage() {
  return (
    <MarketingLayout>
      <div className="container mx-auto px-6 max-w-4xl py-12">
        <div className="text-center mb-16">
          <span className="chip chip-neutral mb-4">Terms of Service</span>
          <h1 className="font-[family-name:var(--font-heading)] text-4xl md:text-5xl font-bold tracking-tight text-[var(--text-primary)]">
            Terms of Service
          </h1>
          <p className="mt-4 text-[var(--text-secondary)] text-sm md:text-base max-w-2xl mx-auto">
            Please read these terms carefully before using BuddySaradhi. By accessing or using the platform, you agree to be bound by these conditions.
          </p>
        </div>

        <div className="space-y-8 max-w-3xl mx-auto">
          {/* Section 1 */}
          <div className="glass p-6 rounded-2xl border border-[var(--border-glass)] flex gap-4 items-start">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-[var(--text-primary)] mb-2">1. Sovereign Database Nodes</h3>
              <p className="text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed">
                BuddySaradhi provisions a dedicated, isolated database container for your account. You represent that you have all necessary rights to input student details, batch information, and contact numbers, and that you will not violate local privacy regulations.
              </p>
            </div>
          </div>

          {/* Section 2 */}
          <div className="glass p-6 rounded-2xl border border-[var(--border-glass)] flex gap-4 items-start">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-[var(--text-primary)] mb-2">2. Ledger Append-Only Integrity</h3>
              <p className="text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed">
                To guarantee audited reliability, the financial ledger is append-only. Transactions are irreversible once written, except via compensating VOID rows. You acknowledge that BuddySaradhi provides this mathematical integrity mechanism to protect fee records from unauthorized tamper events.
              </p>
            </div>
          </div>

          {/* Section 3 */}
          <div className="glass p-6 rounded-2xl border border-[var(--border-glass)] flex gap-4 items-start">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-[var(--text-primary)] mb-2">3. Backup Stewardship</h3>
              <p className="text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed">
                BuddySaradhi is a sovereign tool: backups are encrypted using keys stretching from your secret passphrase. We have no knowledge of, and no ability to recover or reset your passphrase if forgotten. You are solely responsible for retaining this password securely.
              </p>
            </div>
          </div>

          {/* Section 4 */}
          <div className="glass p-6 rounded-2xl border border-[var(--border-glass)] flex gap-4 items-start">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] shrink-0">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-[var(--text-primary)] mb-2">4. Disclaimers & Fair Use</h3>
              <p className="text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed">
                BuddySaradhi is provided &ldquo;as is&rdquo;. While we strive for 100% data fidelity and secure ledger consistency, you maintain offline backups of records for critical business compliance. Pricing changes, if any, will be announced with a minimum 60-day notice period.
              </p>
            </div>
          </div>
        </div>

        <div className="text-center mt-12 text-xs text-[var(--text-muted)] max-w-md mx-auto">
          Contact support regarding any terms clarification at <a href="mailto:hello@buddysaradhi.app" className="text-[var(--accent-cyan)] underline">hello@buddysaradhi.app</a>. Last updated: July 2026.
        </div>
      </div>
    </MarketingLayout>
  );
}
