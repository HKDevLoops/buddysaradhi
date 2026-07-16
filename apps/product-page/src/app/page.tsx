import React from "react";
import { DownloadHub } from "@/components/marketing/download-hub";
import { FAQSection } from "@/components/marketing/faq-section";
import { TestimonialsSection } from "@/components/marketing/testimonials-section";
import { Sparkles, Terminal, Shield, Cpu, ArrowRight } from "lucide-react";
import { seedAdminUser } from "../lib/seedAdmin";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    await seedAdminUser();
  }

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-[var(--bg-cosmic)] text-[var(--text-primary)]">
      
      {/* Liquid Glass Background (Highly responsive CSS animated gradient mesh) */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 bg-[#060414]">
        {/* Animated Bioluminescent Blobs */}
        <div className="absolute top-[5%] left-[5%] w-[45vw] h-[45vw] rounded-full filter blur-[100px] opacity-[0.15] animate-blob-1 bg-[#00FF9D]" />
        <div className="absolute bottom-[10%] right-[5%] w-[50vw] h-[50vw] rounded-full filter blur-[120px] opacity-[0.15] animate-blob-2 bg-[#00F0FF]" />
        <div className="absolute top-[35%] right-[25%] w-[35vw] h-[35vw] rounded-full filter blur-[90px] opacity-[0.12] animate-blob-3 bg-[#B388FF]" />
        
        {/* Futuristic SVG Grid Pattern Overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:40px_40px] opacity-[0.25] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
      </div>

      {/* Header / Navbar */}
      <header className="topbar sticky top-0 z-30">
        <a
          href="/"
          className="flex items-center gap-2 font-[family-name:var(--font-heading)] text-lg font-semibold text-[var(--text-primary)] no-underline"
          aria-label="buddysaradhi home"
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-[var(--accent-emerald)] shadow-[0_0_12px_color-mix(in_srgb,var(--accent-emerald)_70%,transparent)] animate-pulse"
          />
          buddysaradhi
        </a>
        <nav aria-label="Primary" className="flex items-center gap-4">
          <a
            href={`${APP_URL}/login`}
            className="inline-flex min-h-[44px] items-center px-5 rounded-full glass-strong text-[var(--text-primary)] text-sm font-medium no-underline transition-all hover:text-[var(--accent-emerald)] hover:border-[var(--accent-emerald)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] focus-visible:ring-offset-2"
          >
            Sign in
          </a>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-64px)] max-w-5xl flex-col items-center justify-center px-6 py-20 text-center">
        <span className="chip chip-info mb-6">
          <span className="chip-dot" aria-hidden="true" />
          The tuition-business OS
        </span>

        <h1 className="font-[family-name:var(--font-heading)] text-5xl md:text-7xl lg:text-8xl font-semibold tracking-tight leading-[1.05] [text-wrap:balance] gradient-text pb-2">
          Run a tuition business from five screens.
        </h1>

        <p className="mt-8 max-w-2xl glass-faint rounded-full py-3 px-8 text-[var(--text-secondary)] font-medium text-sm md:text-base border border-[var(--border-glass)]/20 shadow-[0_4px_12px_rgba(0,0,0,0.15)]">
          Five screens. Seven engines. One ledger. Zero servers to manage.
        </p>

        {/* Interactive Neumorphic Buttons */}
        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:gap-4 items-center">
          <a
            href={`${APP_URL}/signup`}
            className="inline-flex min-h-[52px] w-56 items-center justify-center rounded-xl bg-[var(--accent-emerald)] text-[var(--text-on-accent)] font-bold text-base no-underline shadow-[0_8px_32px_rgba(0,255,157,0.25),inset_0_1px_0_rgba(255,255,255,0.3)] hover:brightness-110 active:translate-y-[1px] transition-all"
          >
            Get started — free
          </a>
          <a
            href="#features"
            className="inline-flex min-h-[52px] w-56 items-center justify-center rounded-xl glass-strong border border-[var(--border-glass)] text-[var(--text-primary)] font-bold text-base no-underline hover:bg-[var(--surface-glass-strong)] active:translate-y-[1px] transition-all"
          >
            Explore features
          </a>
        </div>

        {/* Live App Statistics (Sovereign KPIs) */}
        <dl className="mt-16 glass-faint rounded-2xl border border-[var(--border-glass)]/20 px-8 py-4 flex flex-wrap justify-center gap-x-8 gap-y-2 text-xs md:text-sm text-[var(--text-secondary)] shadow-lg">
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-[var(--accent-emerald)] text-lg">5</span>
            <span>screens</span>
          </div>
          <span aria-hidden="true" className="text-[var(--text-muted)] self-center hidden sm:inline">&middot;</span>
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-[var(--accent-cyan)] text-lg">7</span>
            <span>engines</span>
          </div>
          <span aria-hidden="true" className="text-[var(--text-muted)] self-center hidden sm:inline">&middot;</span>
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-[var(--accent-violet)] text-lg">1</span>
            <span>ledger</span>
          </div>
        </dl>
      </section>

      {/* Product Feature Cards Section */}
      <section id="features" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="eyebrow text-xs tracking-widest font-semibold uppercase text-[var(--accent-cyan)]">Built for the way you actually tutor</span>
          <h2 className="mt-3 font-[family-name:var(--font-heading)] text-4xl md:text-5xl font-semibold tracking-tight [text-wrap:balance] text-[var(--text-primary)]">
            Everything you need. Nothing you don&apos;t.
          </h2>
          <p className="mt-4 text-[var(--text-secondary)]">
            A complete tuition-business operating system. Offline-first, secure local SQLite databases, zero tracking, zero configuration.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {/* Card 1 */}
          <article className="glass-strong rounded-3xl p-8 border border-[var(--border-glass)] flex flex-col justify-between hover:border-[var(--accent-cyan)]/30 transition-all duration-300">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] flex items-center justify-center mb-6">
                <Cpu className="w-6 h-6" />
              </div>
              <h3 className="font-[family-name:var(--font-heading)] text-2xl font-bold text-[var(--text-primary)]">
                Always one tap away
              </h3>
              <p className="mt-4 text-sm text-[var(--text-secondary)] leading-relaxed">
                Dashboard, Students, Attendance, Fees & Payments, Settings. Clean, high-density dashboard layouts optimized for mobile and desktop screens.
              </p>
            </div>
            <ul className="mt-8 flex flex-wrap gap-2 text-[10px]">
              <li className="chip chip-info">Dashboard</li>
              <li className="chip chip-info">Students</li>
              <li className="chip chip-info">Attendance</li>
              <li className="chip chip-info">Fees</li>
              <li className="chip chip-info">Settings</li>
            </ul>
          </article>

          {/* Card 2 */}
          <article className="glass-strong rounded-3xl p-8 border border-[var(--border-glass)] flex flex-col justify-between hover:border-[var(--accent-emerald)]/30 transition-all duration-300">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-[var(--accent-emerald)]/10 text-[var(--accent-emerald)] flex items-center justify-center mb-6">
                <Terminal className="w-6 h-6" />
              </div>
              <h3 className="font-[family-name:var(--font-heading)] text-2xl font-bold text-[var(--text-primary)]">
                Quiet background engines
              </h3>
              <p className="mt-4 text-sm text-[var(--text-secondary)] leading-relaxed">
                Seven core services run quietly behind the scenes handling incremental search indexes, transaction audits, attendance locks, notifications, and instant LibSQL database sync.
              </p>
            </div>
            <ul className="mt-8 flex flex-wrap gap-2 text-[10px]">
              <li className="chip chip-success">Search</li>
              <li className="chip chip-success">Sync</li>
              <li className="chip chip-success">Ledger</li>
              <li className="chip chip-success">Reminders</li>
            </ul>
          </article>

          {/* Card 3 */}
          <article className="glass-strong rounded-3xl p-8 border border-[var(--border-glass)] flex flex-col justify-between hover:border-[var(--accent-violet)]/30 transition-all duration-300">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-[var(--accent-violet)]/10 text-[var(--accent-violet)] flex items-center justify-center mb-6">
                <Shield className="w-6 h-6" />
              </div>
              <h3 className="font-[family-name:var(--font-heading)] text-2xl font-bold text-[var(--text-primary)]">
                100% Sovereign Data
              </h3>
              <p className="mt-4 text-sm text-[var(--text-secondary)] leading-relaxed">
                No telemetry tracking. No analytics SDKs. Every tutor gets a private LibSQL database instance. Backups are envelope-encrypted with AES-256-GCM using your private passphrase.
              </p>
            </div>
            <ul className="mt-8 flex flex-wrap gap-2 text-[10px]">
              <li className="chip chip-warning">No tracking</li>
              <li className="chip chip-warning">AES-256-GCM</li>
              <li className="chip chip-warning">Offline-first</li>
            </ul>
          </article>
        </div>
      </section>

      {/* Download Hub */}
      <DownloadHub />

      {/* Pricing Section */}
      <section id="pricing" className="relative z-10 mx-auto max-w-6xl px-6 py-24 border-t border-[var(--border-glass)]">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="eyebrow text-xs tracking-widest font-semibold uppercase text-[var(--accent-cyan)]">Pricing</span>
          <h2 className="mt-3 font-[family-name:var(--font-heading)] text-4xl md:text-5xl font-semibold tracking-tight [text-wrap:balance] text-[var(--text-primary)]">
            Start free. Upgrade as you grow.
          </h2>
          <p className="mt-4 text-[var(--text-secondary)]">
            Full-featured, free forever for up to 60 students. Simple monthly pricing for growing institutes.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3 max-w-6xl mx-auto">
          {/* Free Tier */}
          <article className="glass rounded-3xl p-8 border border-[var(--border-glass)] flex flex-col justify-between">
            <div>
              <span className="chip chip-neutral mb-4">Free Plan</span>
              <h3 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--text-primary)] flex items-baseline gap-2">
                ₹0
                <span className="text-sm font-normal text-[var(--text-muted)] font-[family-name:var(--font-body)]">/mo</span>
              </h3>
              <p className="mt-4 text-sm text-[var(--text-secondary)] leading-relaxed">
                Perfect for independent tutors and small batches. Includes 5-screen interface and fallback SQL search.
              </p>
              <ul className="mt-8 space-y-3 text-sm text-[var(--text-secondary)]">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-emerald)]" />
                  Up to 60 active students
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-emerald)]" />
                  Up to 3 active batches
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-emerald)]" />
                  All 5 core management screens
                </li>
              </ul>
            </div>
            <a
              href={`${APP_URL}/signup`}
              className="mt-10 inline-flex min-h-[48px] items-center justify-center rounded-xl border border-[var(--border-glass)] text-[var(--text-primary)] font-bold text-sm no-underline hover:bg-[var(--surface-glass)] transition-all"
            >
              Start Free Plan
            </a>
          </article>

          {/* Growth Tier */}
          <article className="glass-strong rounded-3xl p-8 border border-[var(--accent-emerald)]/30 flex flex-col justify-between relative overflow-hidden shadow-[0_12px_48px_rgba(0,255,157,0.1)]">
            <div className="absolute top-0 right-0 bg-[var(--accent-emerald)] text-[var(--text-on-accent)] font-bold text-[10px] tracking-wider uppercase px-4 py-1.5 rounded-bl-2xl">
              Recommended
            </div>
            <div>
              <span className="chip chip-success mb-4">Growth Plan</span>
              <h3 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--text-primary)] flex items-baseline gap-2">
                ₹499
                <span className="text-sm font-normal text-[var(--text-muted)] font-[family-name:var(--font-body)]">/mo</span>
              </h3>
              <p className="mt-4 text-sm text-[var(--text-secondary)] leading-relaxed">
                For active tutors who run multiple batches. Adds vector search and multi-device database sync.
              </p>
              <ul className="mt-8 space-y-3 text-sm text-[var(--text-secondary)]">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-emerald)]" />
                  Up to 300 active students
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-emerald)]" />
                  Up to 10 active batches
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-emerald)]" />
                  HNSW Vector Search engine
                </li>
              </ul>
            </div>
            <a
              href={`${APP_URL}/signup`}
              className="mt-10 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-[var(--accent-emerald)] text-[var(--text-on-accent)] font-bold text-sm no-underline hover:brightness-110 transition-all"
            >
              Start Growth Plan
            </a>
          </article>

          {/* Institute Tier */}
          <article className="glass rounded-3xl p-8 border border-[var(--border-glass)] flex flex-col justify-between">
            <div>
              <span className="chip chip-neutral mb-4">Institute Plan</span>
              <h3 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--text-primary)] flex items-baseline gap-2">
                ₹1,499
                <span className="text-sm font-normal text-[var(--text-muted)] font-[family-name:var(--font-body)]">/mo</span>
              </h3>
              <p className="mt-4 text-sm text-[var(--text-secondary)] leading-relaxed">
                For established academies. Adds unlimited limits, multi-tutor roles, and priority database syncing.
              </p>
              <ul className="mt-8 space-y-3 text-sm text-[var(--text-secondary)]">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-emerald)]" />
                  Unlimited active students
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-emerald)]" />
                  Unlimited batches & tutors
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-emerald)]" />
                  Priority Sync + Premium Support
                </li>
              </ul>
            </div>
            <a
              href={`${APP_URL}/signup`}
              className="mt-10 inline-flex min-h-[48px] items-center justify-center rounded-xl border border-[var(--border-glass)] text-[var(--text-primary)] font-bold text-sm no-underline hover:bg-[var(--surface-glass)] transition-all"
            >
              Start Institute Plan
            </a>
          </article>
        </div>
      </section>

      {/* Testimonials */}
      <TestimonialsSection />

      {/* FAQ */}
      <FAQSection />

      {/* Final Call to Action */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 py-24 border-t border-[var(--border-glass)]">
        <div className="glass-strong rounded-3xl p-10 text-center shadow-[0_24px_64px_rgba(0,0,0,0.3)] border border-[var(--border-glass)]">
          <h2 className="font-[family-name:var(--font-heading)] text-3xl md:text-5xl font-bold tracking-tight [text-wrap:balance]">
            Stop losing receipts.
            <br />
            <span className="gradient-text">Start with Buddysaradhi.</span>
          </h2>
          <p className="mt-6 text-[var(--text-secondary)] max-w-xl mx-auto text-sm md:text-base leading-relaxed">
            Free up to 25 students. No credit card required. Works offline, runs on your local hardware, syncs when you need it.
          </p>
          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:justify-center">
            <a
              href={`${APP_URL}/signup`}
              className="inline-flex min-h-[48px] px-8 items-center justify-center rounded-xl bg-[var(--accent-emerald)] text-[var(--text-on-accent)] font-bold text-sm no-underline hover:brightness-110 transition-all"
            >
              Get started for free
            </a>
            <a
              href={`${APP_URL}/login`}
              className="inline-flex min-h-[48px] px-8 items-center justify-center rounded-xl border border-[var(--border-glass)] text-[var(--text-primary)] font-bold text-sm no-underline hover:bg-[var(--surface-glass)] transition-all"
            >
              Sign in to your portal
            </a>
          </div>
        </div>
      </section>

      {/* Sitemap Footer */}
      <footer className="relative z-10 border-t border-[var(--border-glass)] bg-[var(--surface-glass)] backdrop-blur-md w-full">
        <div className="mx-auto max-w-6xl px-6 py-12 grid gap-8 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2 font-[family-name:var(--font-heading)] text-lg font-semibold">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-[var(--accent-emerald)]"
              />
              buddysaradhi
            </div>
            <p className="mt-3 text-sm text-[var(--text-secondary)]">
              Five screens. Seven engines. One ledger. Zero servers.
            </p>
          </div>
          <div>
            <span className="text-xs uppercase font-semibold text-[var(--text-muted)] tracking-wider">Product</span>
            <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)] list-none pl-0">
              <li>
                <a className="text-[var(--text-secondary)] no-underline hover:text-[var(--accent-emerald)]" href="#features">
                  Features
                </a>
              </li>
              <li>
                <a className="text-[var(--text-secondary)] no-underline hover:text-[var(--accent-emerald)]" href="#pricing">
                  Pricing
                </a>
              </li>
              <li>
                <a className="text-[var(--text-secondary)] no-underline hover:text-[var(--accent-emerald)]" href={`${APP_URL}/signup`}>
                  Sign up
                </a>
              </li>
            </ul>
          </div>
          <div>
            <span className="text-xs uppercase font-semibold text-[var(--text-muted)] tracking-wider">Company</span>
            <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)] list-none pl-0">
              <li>
                <a className="text-[var(--text-secondary)] no-underline hover:text-[var(--accent-emerald)]" href="mailto:hello@buddysaradhi.app">
                  Contact
                </a>
              </li>
              <li>
                <a className="text-[var(--text-secondary)] no-underline hover:text-[var(--accent-emerald)]" href={APP_URL}>
                  Web app
                </a>
              </li>
            </ul>
          </div>
          <div>
            <span className="text-xs uppercase font-semibold text-[var(--text-muted)] tracking-wider">Legal</span>
            <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)] list-none pl-0">
              <li>
                <a className="text-[var(--text-secondary)] no-underline hover:text-[var(--accent-emerald)]" href="/privacy">
                  Privacy
                </a>
              </li>
              <li>
                <a className="text-[var(--text-secondary)] no-underline hover:text-[var(--accent-emerald)]" href="/terms">
                  Terms
                </a>
              </li>
              <li>
                <a className="text-[var(--text-secondary)] no-underline hover:text-[var(--accent-emerald)]" href="/dpa">
                  DPA
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-[var(--border-glass)]">
          <div className="mx-auto max-w-6xl px-6 py-4 text-xs text-[var(--text-muted)]">
            © 2026 Buddysaradhi. Built with Vibrant Glass.
          </div>
        </div>
      </footer>
    </main>
  );
}
