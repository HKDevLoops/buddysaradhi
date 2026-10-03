// Implements: docs/design/overhaul-plan.md §4.1 (front door: marketing,
// pricing, access request) + docs/design/material-modes.md §2 (token contract).
// Nav note for the W4 `/admin` agent: this file is owned by W3. The primary
// nav lists only W3 routes (Screens, Pricing, Platforms) plus the access
// request. Add your own entry after the Platforms link; nothing here depends on
// its position. Fonts are unchanged from the previous shell.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Sora, Onest } from "next/font/google";
import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-heading",
  weight: ["400", "600", "700"],
  display: "swap",
});

const onest = Onest({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "BuddySaradhi. Tuition management for Indian tutors.",
  description:
    "Five screens. Seven engines. One ledger. Zero servers. The operating system for private tutors and coaching institutes in India. Free for everyone while our infra stays free.",
  metadataBase: new URL("https://product-page-one-nu.vercel.app"),
  alternates: { canonical: "/" },
  openGraph: {
    title: "BuddySaradhi. Tuition management for Indian tutors.",
    description:
      "Five screens. Seven engines. One ledger. Zero servers. Free for everyone while our infra stays free.",
    images: [{ url: "/nim/og-image.jpg", width: 1200, height: 630 }],
  },
};

/** The signed-in app lives on its own deployment target (AGENTS.md Rule 11). */
const APP_ORIGIN = "https://buddysaradhi.vercel.app";

const NAV_LINKS = [
  { href: "/#screens", label: "Screens" },
  { href: "/pricing", label: "Pricing" },
  { href: "/platforms", label: "Platforms" },
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en-IN"
      data-palette="inked"
      data-material="liquid-glass"
      className={`${sora.variable} ${onest.variable}`}
    >
      <body className="flex min-h-[100dvh] flex-col antialiased">
        <header className="mat-nav">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-6">
            <Link
              href="/"
              className="font-display text-lg font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              BuddySaradhi
            </Link>
            <nav aria-label="Primary" className="flex items-center gap-6">
              {NAV_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="hidden text-sm md:inline"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {l.label}
                </Link>
              ))}
              <Link href="/request-access" className="btn btn-primary text-sm">
                Request access
              </Link>
            </nav>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer
          className="mt-auto border-t"
          style={{
            borderColor: "var(--border-default)",
            background: "var(--surface-raised)",
            color: "var(--text-secondary)",
          }}
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 md:flex-row md:justify-between">
            <div className="max-w-sm">
              <p className="font-display text-base font-bold" style={{ color: "var(--text-primary)" }}>
                BuddySaradhi
              </p>
              <p className="mt-2 text-sm">
                Five screens, seven engines, one ledger. Built in India. No telemetry, ever. Your
                data is yours.
              </p>
            </div>
            <nav aria-label="Footer" className="flex flex-col gap-2 text-sm">
              <Link href="/pricing" style={{ color: "var(--text-secondary)" }}>
                Pricing
              </Link>
              <Link href="/request-access" style={{ color: "var(--text-secondary)" }}>
                Request access
              </Link>
              <Link href="/platforms" style={{ color: "var(--text-secondary)" }}>
                Platforms
              </Link>
              <a href={`${APP_ORIGIN}/login`} style={{ color: "var(--text-secondary)" }}>
                Sign in to the app
              </a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
