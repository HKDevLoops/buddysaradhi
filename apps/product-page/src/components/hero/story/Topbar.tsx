// @ts-nocheck
import React from 'react';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export function Topbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-30 px-6 py-4 flex items-center justify-between pointer-events-none">
      <a
        href="/"
        style={{ pointerEvents: 'auto' }}
        className="flex items-center gap-2 font-[family-name:var(--font-heading)] text-lg font-semibold text-[var(--text-primary)] no-underline"
        aria-label="buddysaradhi home"
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-[var(--accent-emerald)] shadow-[0_0_12px_color-mix(in_srgb,var(--accent-emerald)_70%,transparent)] animate-pulse"
        />
        buddysaradhi
      </a>
      <nav aria-label="Primary" className="flex items-center gap-4 pointer-events-auto">
        <a
          href={`${APP_URL}/login`}
          className="inline-flex min-h-[44px] items-center px-5 rounded-full glass-strong text-[var(--text-primary)] text-sm font-medium no-underline transition-all hover:text-[var(--accent-emerald)] hover:border-[var(--accent-emerald)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] focus-visible:ring-offset-2"
        >
          Sign in
        </a>
      </nav>
    </header>
  );
}

