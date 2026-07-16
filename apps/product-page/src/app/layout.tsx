import type { Metadata, Viewport } from 'next';
import { Sora, Onest, JetBrains_Mono } from 'next/font/google';
import './globals.css';

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
  themeColor: '#0f0c29',
};

export const metadata: Metadata = {
  title: 'BuddySaradhi — Tuition Management App for Indian Tutors',
  description: 'BuddySaradhi is the operating system for private tutors and coaching institutes in India. Five screens. Offline-first. No card required. Free up to 25 students.',
  metadataBase: new URL('https://buddysaradhi.app'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'BuddySaradhi — Tuition Management App for Indian Tutors',
    description: 'Five screens. Seven engines. One ledger. Zero servers. The operating system for private tutors and coaching institutes in India. No card required.',
    url: 'https://buddysaradhi.app/',
    siteName: 'BuddySaradhi',
    locale: 'en_IN',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-IN"
      className={`${sora.variable} ${onest.variable} ${jetbrainsMono.variable} scroll-smooth`}
      data-palette="aurora-cosmic"
      data-theme="dark"
      suppressHydrationWarning
    >
      <body className="min-h-[100dvh] flex flex-col antialiased" style={{ fontFamily: 'var(--font-body)' }}>
        {children}
      </body>
    </html>
  );
}
