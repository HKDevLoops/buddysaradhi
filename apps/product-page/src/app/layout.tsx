// Implements: docs/design/overhaul-plan.md §4.1 (front door: marketing,
// pricing, access request) + docs/design/material-modes.md §2 (token contract).
// Nav note for the W4 `/admin` agent: this file is owned by W3. The primary
// nav lists only W3 routes (Screens, Pricing, Platforms); the bar's remaining
// slot is the quiet sign-up shortcut, deliberately not a second primary button.
// Add your own entry to `NAV_LINKS`; both the desktop row and the phone
// disclosure render from that one array, so a single entry reaches both widths.
// Nothing here depends on an entry's position. Fonts are unchanged from the
// previous shell.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Sora, Onest } from "next/font/google";
import { SiteNav } from "@/components/site-nav";
import { APP_LOGIN_URL, APP_SIGNUP_URL, FREE_SIGNUP_CTA } from "@/lib/access-request";
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

/**
 * The committed production origin of THIS site. `metadataBase` is the base every
 * relative URL resolves against, so a wrong value does not fail a build — it
 * quietly mints canonicals, Open Graph tags and share images that point at an
 * origin no visitor is on. It was `https://product-page-one-nu.vercel.app`, a
 * preview deployment slug, which meant production shipped the wrong canonical.
 *
 * The fallback is the same apex `apps/web` uses for its own `metadataBase`
 * (apps/web/src/app/layout.tsx:43) and for its `openGraph.url` (`:50`); the
 * gateway's own CSP allowlists `https://api.buddysaradhi.app`
 * (apps/product-page/next.config.ts:33), which confirms the apex.
 */
const SITE_ORIGIN_FALLBACK = "https://buddysaradhi.app";

/**
 * Resolves the site origin from the environment, never from a literal in the
 * metadata block (AGENTS.md §15 FM-06).
 *
 * A malformed value throws here, at module evaluation, naming the variable
 * rather than degrading to a guess: a red build is recoverable and a silently
 * wrong canonical is not (AGENTS.md §2 Rule 9).
 */
function resolveSiteOrigin(): URL {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return new URL(SITE_ORIGIN_FALLBACK);
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch (cause) {
    throw new Error(
      `NEXT_PUBLIC_SITE_URL is not an absolute URL (received ${JSON.stringify(configured)}). ` +
        `Fix the variable, or unset it to use ${SITE_ORIGIN_FALLBACK}.`,
      { cause },
    );
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new Error(
      `NEXT_PUBLIC_SITE_URL must be an https origin (received ${JSON.stringify(configured)}).`,
    );
  }
  return parsed;
}

export const metadata: Metadata = {
  title: "BuddySaradhi. Tuition management for Indian tutors.",
  description:
    "Five screens. Seven engines. One ledger. Zero servers. The operating system for private tutors and coaching institutes in India. Free for everyone while our infra stays free.",
  metadataBase: resolveSiteOrigin(),
  alternates: { canonical: "/" },
  openGraph: {
    title: "BuddySaradhi. Tuition management for Indian tutors.",
    description:
      "Five screens. Seven engines. One ledger. Zero servers. Free for everyone while our infra stays free.",
    images: [{ url: "/nim/og-image.jpg", width: 1200, height: 630 }],
  },
};

/** The signed-in app lives on its own deployment target (AGENTS.md Rule 11) and
 *  on its own origin, which is owned in exactly one place: `APP_ORIGIN` in
 *  `src/lib/access-request.ts`, with its provenance cited there. This file used
 *  to hold a second, byte-identical literal for the footer's sign-in link; two
 *  spellings of one host is how the footer ends up pointing at a deployment that
 *  does not exist, and neither the build nor `tsc` fails on a wrong host. */

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
        {/* WCAG 2.4.1 bypass block, and the first tab stop in the body. The
            landing page opens with a 500vh story section whose beat copy sits in
            a sticky overlay, so the distance from the top of the document to the
            real content is a full screen of scrolling plus whatever a visitor
            chooses to read in the chrome above it.

            Off-screen rather than `display:none`: a hidden element is not
            focusable, so a `display:none` skip link silently does not exist for
            the only user who needs it. Visible only on focus, never on hover and
            never permanently. 44px target (AGENTS.md §2 Rule 10). */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:inline-flex focus:min-h-[44px] focus:items-center focus:rounded-lg focus:px-4 focus:text-sm focus:font-semibold"
          style={{
            // It may appear over the hero stage, which is a moving canvas, so it
            // takes the opaque overlay surface and carries its own contour.
            background: "var(--surface-overlay-solid)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-strong)",
          }}
        >
          Skip to main content
        </a>

        <header className="mat-nav">
          {/* `flex-wrap` + `min-h-16`: at 390px this is one row; on a narrower
              phone the disclosure control wraps to a second row instead of
              pushing the primary CTA off the edge. */}
          <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-6 py-2 md:flex-nowrap md:gap-6 md:py-0">
            <Link
              href="/"
              className="mr-auto font-display text-base font-bold md:text-lg"
              style={{ color: "var(--text-primary)" }}
            >
              BuddySaradhi
            </Link>
            <SiteNav links={NAV_LINKS} />
            {/* Quiet, not primary. The header is chrome that appears on every
                page, and this surface now has exactly one `btn-primary` per
                viewport: the decision panel on `/`, `/pricing` and `/platforms`,
                and the form on `/request-access`. A second primary button in the
                sticky bar is the duplicate the earlier pass removed from the
                hero, and a sticky one is worse because it never leaves.

                The word here is the same word the page's primary uses, so the
                header is a shortcut to the same destination rather than a
                second offer. "Ask for a contracted plan" stays in the footer and
                on the decision panels, where it is honestly labelled. */}
            <a
              href={APP_SIGNUP_URL}
              className="action inline-flex min-h-[44px] shrink-0 items-center text-sm"
              rel="noopener"
            >
              {FREE_SIGNUP_CTA}
            </a>
          </div>
        </header>

        <main id="main" className="flex-1">
          {children}
        </main>

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
                Ask for a contracted plan
              </Link>
              <Link href="/platforms" style={{ color: "var(--text-secondary)" }}>
                Platforms
              </Link>
              <a href={APP_LOGIN_URL} style={{ color: "var(--text-secondary)" }}>
                Sign in to the app
              </a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
