// Server Component — SSR, no JS, lightweight. Implements 20_3D_Product_Page §1 + product/02..07.
// All marketing copy is server-rendered for SEO + performance; 3D canvas is client island behind it.
export function HeroSections() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return (
    <div className="relative z-10 w-full flex flex-col items-center">
      {/* Section 1: Hero Main Header */}
      <section className="min-h-screen w-full flex flex-col items-center justify-center px-6 pt-24 pb-12 text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[var(--surface-glass-strong)] mb-6 text-xs font-semibold tracking-wider uppercase text-[var(--accent-cyan)] border border-[var(--accent-cyan)]/25">
          5-Screen Sovereign Operating System
        </div>
        <h1 className="font-[family-name:var(--font-heading)] text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight text-white leading-[1.1] mb-6">
          The sovereign OS for private tutors and institutes.
        </h1>
        <p className="max-w-2xl text-lg sm:text-xl text-[var(--text-secondary)] font-normal mb-8 leading-relaxed">
          Buddysaradhi combines 5 core screens, an append-only ledger, and offline-first sovereign speed to let single tutors and coaching institutes manage operations cleanly.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <a
            href={`${appUrl}/login`}
            className="inline-flex min-h-[48px] px-8 items-center justify-center rounded-xl bg-[var(--accent-emerald)] text-[var(--text-on-accent)] font-bold text-base no-underline hover:brightness-110 active:scale-[0.98] transition-all"
          >
            Launch Web Version
          </a>
          <a
            href="#download"
            className="inline-flex min-h-[48px] px-8 items-center justify-center rounded-xl border border-[var(--border-glass-strong)] bg-[var(--surface-glass-faint)] text-[var(--text-primary)] font-semibold text-base no-underline hover:border-white/40 active:scale-[0.98] transition-all"
          >
            Get Apps & Downloads
          </a>
        </div>
      </section>

      {/* Section 2: Core Operating Features */}
      <section id="features" className="w-full px-6 py-20 max-w-6xl mx-auto border-t border-[var(--border-glass)]">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div>
            <span className="text-xs font-mono text-[var(--accent-cyan)] uppercase tracking-wider block mb-2">01 / Daily Workflow</span>
            <h2 className="font-[family-name:var(--font-heading)] text-3xl sm:text-4xl font-bold text-[var(--text-primary)] mb-4">
              Structured Batch Operations
            </h2>
            <p className="text-[var(--text-secondary)] text-base leading-relaxed mb-4">
              Mark attendance across multi-student batches in under 20 seconds. Lock entries automatically after 24 hours to enforce an audited record.
            </p>
            <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-emerald)]" />
                24-hour attendance locking engine
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-cyan)]" />
                Per-session or monthly batch tracking
              </li>
            </ul>
          </div>
          <div className="bg-[var(--surface-glass-strong)] border border-[var(--border-glass)] rounded-2xl p-6 font-mono text-xs text-[var(--text-secondary)] space-y-3">
            <div className="flex justify-between items-center border-b border-[var(--border-glass)] pb-2 text-[var(--accent-cyan)] font-semibold">
              <span>BATCH: Class 10 CBSE Math</span>
              <span>24 PRESENT</span>
            </div>
            <div className="flex justify-between text-xs">
              <span>Riya Sharma</span>
              <span className="text-[var(--accent-emerald)]">Present</span>
            </div>
            <div className="flex justify-between text-xs">
              <span>Kabir Khan</span>
              <span className="text-[var(--accent-emerald)]">Present</span>
            </div>
            <div className="flex justify-between text-xs">
              <span>Ananya Iyer</span>
              <span className="text-[var(--accent-amber)]">Absent (Notified)</span>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Financial Precision */}
      <section className="w-full px-6 py-20 max-w-6xl mx-auto border-t border-[var(--border-glass)]">
        <div className="grid md:grid-cols-2 gap-8 items-center md:flex-row-reverse">
          <div className="bg-[var(--surface-glass-strong)] border border-[var(--border-glass)] rounded-2xl p-6 font-mono text-xs text-[var(--text-secondary)] space-y-3 order-2 md:order-1">
            <div className="flex justify-between items-center border-b border-[var(--border-glass)] pb-2 text-[var(--accent-emerald)] font-semibold">
              <span>LEDGER ENTRY #4810</span>
              <span>₹2,500.00</span>
            </div>
            <div className="text-xs text-[var(--text-muted)]">HASH: 8f9a2b1c4e6d3f0a7b9c1d3e5f7a9b2c</div>
            <div className="text-xs text-[var(--text-primary)]">STATUS: Immutable Append-Only</div>
          </div>
          <div className="order-1 md:order-2">
            <span className="text-xs font-mono text-[var(--accent-emerald)] uppercase tracking-wider block mb-2">02 / Money & Ledger</span>
            <h2 className="font-[family-name:var(--font-heading)] text-3xl sm:text-4xl font-bold text-[var(--text-primary)] mb-4">
              Zero Reconcile Drift
            </h2>
            <p className="text-[var(--text-secondary)] text-base leading-relaxed">
              Paired credit/debit ledger entries ensure every fee payment maps to exact receipts with integer paise precision. Voids are recorded as new balancing transactions.
            </p>
          </div>
        </div>
      </section>

      {/* Section 4: Web Application Launch */}
      <section className="w-full px-6 py-20 text-center max-w-3xl mx-auto border-t border-[var(--border-glass)]">
        <h2 className="font-[family-name:var(--font-heading)] text-3xl sm:text-4xl font-bold text-white mb-4">Access Your Tuition Portal</h2>
        <p className="text-base text-[var(--text-secondary)] mb-8 max-w-xl mx-auto">
          Open the 5-screen operating system directly in your browser or install the native desktop / mobile app.
        </p>
        <a
          href={`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/login`}
          className="inline-flex min-h-[52px] px-10 items-center justify-center rounded-xl bg-[var(--accent-emerald)] text-black font-bold text-lg no-underline hover:brightness-110 active:scale-[0.98] transition-all"
        >
          Open Web Portal
        </a>
      </section>
    </div>
  );
}
