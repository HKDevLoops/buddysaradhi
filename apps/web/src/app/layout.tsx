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

export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0F172A' },
    { media: '(prefers-color-scheme: dark)', color: '#0B1020' },
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
      data-palette="aurora-cosmic"
      data-theme="dark"
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
                  // Resolve "system" theme to a concrete light/dark so the first
                  // paint is correct; PaletteProvider refines after hydration.
                  if (theme === "system" || !theme) {
                    theme = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)
                      ? "dark" : "light";
                  }
                  // Aurora-cosmic is dark-only; midnight-slate is light-only.
                  // Pair them so a single-theme palette displays correctly.
                  if (palette === "aurora-cosmic" && theme === "light") palette = "midnight-slate";
                  if (palette === "midnight-slate" && theme === "dark") palette = "aurora-cosmic";
                  if (palette) html.setAttribute("data-palette", palette);
                  if (theme) html.setAttribute("data-theme", theme);
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
          {children}
        </Providers>
      </body>
    </html>
  );
}
