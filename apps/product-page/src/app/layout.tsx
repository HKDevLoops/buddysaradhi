// Product surface root layout: fonts + marketing shell + sticky footer.
// Implements: 13_UI_Guidelines.md §2 (Sora/Onest) + AGENTS.md §6.3 (mt-auto footer).
// Copy rule R-02: no em dashes anywhere on this surface.

import type { Metadata } from "next";
import type { ReactNode } from "react";
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" className={`${sora.variable} ${onest.variable}`}>
      <body className="flex min-h-[100dvh] flex-col antialiased">
        <header className="glass-strong sticky top-0 z-30 flex h-16 items-center justify-between px-6">
          <a
            href="/"
            className="text-lg font-bold"
            style={{ color: "rgba(255,255,255,0.95)", fontFamily: "var(--font-heading)" }}
          >
            Buddysaradhi <span style={{ color: "#00FF9D" }}>◉</span>
          </a>
          <nav aria-label="Primary" className="flex items-center gap-6">
            <a
              href="#screens"
              className="hidden text-sm md:inline"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              Screens
            </a>
            <a
              href="#pricing"
              className="hidden text-sm md:inline"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              Pricing
            </a>
            <a
              href="https://buddysaradhi.vercel.app/signup"
              className="inline-flex min-h-[44px] items-center rounded-xl px-5 text-sm font-semibold"
              style={{ background: "#00FF9D", color: "#0a0a1a" }}
            >
              Start free
            </a>
          </nav>
        </header>

        <main className="flex-1">{children}</main>

        <footer
          className="glass-faint mt-auto flex flex-col items-center gap-2 px-6 py-8 text-sm md:flex-row md:justify-between"
          style={{ color: "rgba(255,255,255,0.7)" }}
        >
          <p>Buddysaradhi. Five screens, seven engines, one ledger. Built in India.</p>
          <p>No telemetry, ever. Your data is yours.</p>
        </footer>
      </body>
    </html>
  );
}
