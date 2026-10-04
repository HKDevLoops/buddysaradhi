import type { Metadata, Viewport } from 'next';
import { Sora, Onest, JetBrains_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';
import { Providers } from './providers';

// Implements: 13_UI_Guidelines.md §2 Typography + UI/02_Typography_System.md
// Font pairings: Sora (headings) + Onest (body) + JetBrains Mono (numerics)
const sora = Sora({
  subsets: ['latin'],
  variable: '--font-heading',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const onest = Onest({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const runtime = "nodejs";

export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: "#F4F6F8" },
    { media: '(prefers-color-scheme: dark)', color: "#111315" },
  ],
};

export const metadata: Metadata = {
  title: 'BuddySaradhi — Tuition Management App for Indian Tutors',
  description: 'BuddySaradhi is the operating system for private tutors and coaching institutes in India. Five screens. Offline-first. ₹299/mo. No card required. Free up to 25 students.',
  metadataBase: new URL('https://buddysaradhi.app'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'BuddySaradhi — Tuition Management App for Indian Tutors',
    description: 'Five screens. Seven engines. One ledger. Zero servers. The operating system for private tutors and coaching institutes in India. ₹299/mo. No card required.',
    url: 'https://buddysaradhi.app/',
    siteName: 'BuddySaradhi',
    images: [
      {
        url: '/og/default.avif',
        width: 1200,
        height: 630,
        alt: 'BuddySaradhi — Five screens. Seven engines. One ledger. Zero servers.',
      },
    ],
    locale: 'en_IN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@buddysaradhiapp',
    creator: '@buddysaradhiapp',
    title: 'BuddySaradhi — Tuition Management App for Indian Tutors',
    description: 'Five screens. Seven engines. One ledger. Zero servers. ₹299/mo. No card required.',
    images: ['/og/default.avif'],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const h = await headers();
  const nonce = h.get('x-nonce') || '';

  // Default attributes on <html> — the FOUC script below applies the user's
  // global choice (localStorage) BEFORE hydration so the first paint matches.
  // A single PaletteProvider at the root (see providers.tsx) keeps it in sync
  // across every route; there is NO per-route palette override.
  return (
    <html
      lang="en-IN"
      className={`${sora.variable} ${onest.variable} ${jetbrainsMono.variable} scroll-smooth`}
      data-palette="inked"
      data-theme="dark"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var html = document.documentElement;
                  var palette = localStorage.getItem("buddysaradhi.palette");
                  var theme = localStorage.getItem("buddysaradhi.theme");
                  var density = localStorage.getItem("buddysaradhi.density");
                  // Resolve "system" theme to a concrete light/dark so the first
                  // paint is correct; PaletteProvider refines after hydration.
                  if (theme === "system" || !theme) {
                    theme = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)
                      ? "dark" : "light";
                  }
                  if (palette) html.setAttribute("data-palette", palette);
                  if (theme) html.setAttribute("data-theme", theme);
                  if (density) html.setAttribute("data-density", density);
                } catch (e) {
                  /* no-op: PaletteProvider will still apply after hydration */
                }
              })();
            `
          }}
        />
      </head>
      <body className="min-h-[100dvh] flex flex-col antialiased" style={{ fontFamily: 'var(--font-body)' }}>
        <Providers>
          {/* AGENTS.md §2 Rule 10 / WCAG 2.4.1 Bypass Blocks. There was no skip
              link, and the app's own chrome made the cost of that visible: five
              nav rows, a 44px search field and a `?` help button sit ahead of
              the main landmark in the tab order on EVERY screen, so a keyboard
              user spent ~8 keystrokes per screen change re-walking the nav to
              reach the content they had just navigated to.

              Visible on focus, not on hover and not ever: `sr-only` until
              `:focus`, then a 44px target at the top-left. Off-screen rather
              than `display:none`, because a hidden element is not focusable and
              the link would silently not exist for the only user who needs it.
              It is the FIRST thing in the body so it is the first tab stop. */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:inline-flex focus:min-h-[44px] focus:items-center focus:rounded-lg focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:outline-none focus:ring-2"
            style={{
              // Sits on the overlay material, because it may appear over the
              // shell's canvas gradient rather than on a panel.
              background: 'var(--surface-overlay)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              boxShadow: '0 0 0 2px var(--accent-primary)',
            }}
          >
            Skip to main content
          </a>
          {children}
        </Providers>
      </body>
    </html>
  );
}
