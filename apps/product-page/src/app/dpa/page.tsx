import React from "react";
import { MarketingLayout } from "@/components/marketing/marketing-layout";
import { Shield, FileText, CheckCircle2, ShieldAlert } from "lucide-react";

export const metadata = {
  title: "Data Processing Addendum (DPA) — BuddySaradhi",
  description: "DPA outlining the processing terms for student data in isolated database environments.",
};

export default function DPAPage() {
  return (
    <MarketingLayout>
      <div className="container mx-auto px-6 max-w-4xl py-12">
        <div className="text-center mb-16">
          <span className="chip chip-info mb-4">DPA</span>
          <h1 className="font-[family-name:var(--font-heading)] text-4xl md:text-5xl font-bold tracking-tight text-[var(--text-primary)]">
            Data Processing Addendum
          </h1>
          <p className="mt-4 text-[var(--text-secondary)] text-sm md:text-base max-w-2xl mx-auto">
            This Data Processing Addendum (&ldquo;DPA&rdquo;) governs the processing of personal data in connection with the BuddySaradhi tuition management services.
          </p>
        </div>

        <div className="space-y-8 max-w-3xl mx-auto">
          {/* Section 1 */}
          <div className="glass p-6 rounded-2xl border border-[var(--border-glass)] flex gap-4 items-start">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-[var(--text-primary)] mb-2">1. Scope & Definitions</h3>
              <p className="text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed">
                Tutor acts as the &ldquo;Data Controller&rdquo; of all student rosters, phone numbers, and attendance records. BuddySaradhi acts as the &ldquo;Data Processor&rdquo; hosting the storage server. Processing is limited to syncing records from the client application to your private database node.
              </p>
            </div>
          </div>

          {/* Section 2 */}
          <div className="glass p-6 rounded-2xl border border-[var(--border-glass)] flex gap-4 items-start">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-[var(--text-primary)] mb-2">2. Processing Constraints</h3>
              <p className="text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed">
                We only process data in accordance with your explicit instructions (when the client app triggers a DB sync or backup download). We do not inspect, aggregate, index, profile, or sell your data.
              </p>
            </div>
          </div>

          {/* Section 3 */}
          <div className="glass p-6 rounded-2xl border border-[var(--border-glass)] flex gap-4 items-start">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-[var(--text-primary)] mb-2">3. Security Measures</h3>
              <p className="text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed">
                All sync transmissions use TLS 1.3 over HTTPS. Databases are hosted within secure, containerized SQLite files on Turso Cloud infrastructures. Turso utilizes SOC 2 Type II compliant storage environments with physical surveillance and data security controls.
              </p>
            </div>
          </div>

          {/* Section 4 */}
          <div className="glass p-6 rounded-2xl border border-[var(--border-glass)] flex gap-4 items-start">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-[var(--text-primary)] mb-2">4. Sub-processors</h3>
              <p className="text-xs md:text-sm text-[var(--text-secondary)] leading-relaxed">
                BuddySaradhi only engages essential infrastructure sub-processors: Vercel (hosting & CDN) and Turso/libSQL (encrypted database storage). No marketing or analytical sub-processors are engaged.
              </p>
            </div>
          </div>
        </div>

        <div className="text-center mt-12 text-xs text-[var(--text-muted)] max-w-md mx-auto">
          Request signed DPA copy or submit queries at <a href="mailto:hello@buddysaradhi.app" className="text-[var(--accent-cyan)] underline">hello@buddysaradhi.app</a>. Last updated: July 2026.
        </div>
      </div>
    </MarketingLayout>
  );
}
