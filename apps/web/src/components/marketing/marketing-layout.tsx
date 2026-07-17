import React from "react";
import { ArrowLeft } from "lucide-react";

export function MarketingLayout({
  children,
  showHomeLink = true,
}: {
  children: React.ReactNode;
  showHomeLink?: boolean;
}) {
  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[var(--bg-cosmic)] text-[var(--text-primary)] flex flex-col justify-between">
      {/* Background 3D placeholder style */}
      <div className="fixed inset-0 z-0 bg-[var(--bg-canvas)] pointer-events-none" />

      <header className="topbar sticky top-0 z-30 w-full px-6 py-4 flex items-center justify-between border-b border-[var(--border-glass)]/25 bg-[var(--surface-glass)] backdrop-blur-md">
        <a
          href="/"
          className="flex items-center gap-2 font-[family-name:var(--font-heading)] text-lg font-semibold text-[var(--text-primary)] no-underline"
          aria-label="buddysaradhi home"
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-[var(--accent-emerald)] shadow-[0_0_12px_color-mix(in_srgb,var(--accent-emerald)_70%,transparent)]"
          />
          buddysaradhi
        </a>
        <nav aria-label="Primary" className="flex items-center gap-4">
          {showHomeLink && (
            <a
              href="/"
              className="inline-flex min-h-[44px] items-center gap-1 text-[var(--text-secondary)] text-sm font-medium no-underline hover:text-[var(--accent-cyan)]"
            >
              <ArrowLeft className="w-4 h-4" />
              Back Home
            </a>
          )}
          <a
            href="/login"
            className="inline-flex min-h-[44px] items-center px-5 rounded-full glass-strong text-[var(--text-primary)] text-sm font-medium no-underline transition-colors hover:text-[var(--accent-emerald)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-cosmic)]"
          >
            Sign in
          </a>
        </nav>
      </header>

      <main className="relative z-10 flex-grow py-12">
        {children}
      </main>

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
            <span className="kpi-label text-xs uppercase font-semibold text-[var(--text-muted)] tracking-wider">Product</span>
            <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)] list-none pl-0">
              <li>
                <a className="text-[var(--text-secondary)] no-underline hover:text-[var(--accent-emerald)]" href="/#features">
                  Features
                </a>
              </li>
              <li>
                <a className="text-[var(--text-secondary)] no-underline hover:text-[var(--accent-emerald)]" href="/#pricing">
                  Pricing
                </a>
              </li>
              <li>
                <a className="text-[var(--text-secondary)] no-underline hover:text-[var(--accent-emerald)]" href="/signup">
                  Sign up
                </a>
              </li>
            </ul>
          </div>
          <div>
            <span className="kpi-label text-xs uppercase font-semibold text-[var(--text-muted)] tracking-wider">Company</span>
            <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)] list-none pl-0">
              <li>
                <a className="text-[var(--text-secondary)] no-underline hover:text-[var(--accent-emerald)]" href="mailto:hello@buddysaradhi.app">
                  Contact
                </a>
              </li>
              <li>
                <a className="text-[var(--text-secondary)] no-underline hover:text-[var(--accent-emerald)]" href="https://buddysaradhi.app">
                  Web app
                </a>
              </li>
            </ul>
          </div>
          <div>
            <span className="kpi-label text-xs uppercase font-semibold text-[var(--text-muted)] tracking-wider">Legal</span>
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
    </div>
  );
}
