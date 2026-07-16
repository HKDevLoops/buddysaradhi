# 07 — Landing Page (Commercial Web Surface)

> The implementation contract for the Buddysaradhi commercial landing page on the Next.js 16 web surface. This file is the **HOW** — route, React/Server Components, data fetching, SEO, performance, the download hub wired to Vercel Blob, and the seven commercial sections (Hero, Features, Download, Pricing, FAQ, CTA, Testimonials). The **WHAT** — messaging, copy, positioning, funnel narrative, persona-targeting — lives in the `product/` directory (`product/02_Hero_and_Above_the_Fold.md`, `product/03_Features_Showcase.md`, `product/04_Download_Hub.md`, `product/06_FAQ.md`, `product/09_SEO_and_Analytics.md`, plus the rest of the 11-file `product/` package). When the two diverge, this file is the engineering authority; when the marketing spec changes, the implementation changes second.

---

## 1. Why this file exists

Buddysaradhi has two web surfaces that share a domain but not a layout, a bundle, or a user. The **app surface** (`(app)` route group) is the five-screen product — Dashboard, Students, Attendance, Fees, Settings — behind Supabase auth and the `GlassShell` (see `01_Architecture.md` §3.3). The **marketing surface** (`(marketing)` route group) is the commercial landing page that sells the product to a tutor who has never signed up. This file owns the marketing surface only.

In production, `/` is the marketing landing. In this sandbox, `/` currently renders the spec-reader showcase (the worklog's R3-FIX-AND-PLATFORM phase wired it up to demo the planning package). Production Buddysaradhi replaces that showcase with the commercial landing page specified here. The showcase is preserved at `/showcase` (a sub-route of `(marketing)`) for QA and agent-browser smoke; it is not the public face of the product.

This file exists because the parallel `product/` directory specifies the *content* of the landing page (headlines, copy, funnel, FAQ items, pricing tiers, persona narratives) but does not specify the *implementation*. A copywriter authoring `product/02_Hero_and_Above_the_Fold.md` does not need to know that the hero CTA is a Server Component wrapped around a Framer Motion island, or that the download cards hydrate from a Vercel Blob manifest fetched with `next: { revalidate: 3600 }`. The copywriter specifies the words and the visual intent; this file specifies how those words become a route, a React tree, a fetch, an HTML stream, a JSON-LD payload, and a Lighthouse score ≥ 95. The contract between the two files is the **content surface**: the structure of props the implementation expects from the marketing spec. Where this file references `product/02_Hero_and_Above_the_Fold.md`, it is naming the source of the H1 string; where `product/*` references `web/07_Landing_Page.md`, it is naming the consumer of that string.

The non-negotiables apply in full: no indigo or blue accents (top-level `AGENTS.md` Rule 5; `13_UI_Guidelines.md` §1.3), no telemetry SDK beyond Vercel Web Analytics (Rule 3, AP-10, TELE-1), integer paise in every pricing display (Rule 6, BR-M-01), and WCAG 2.1 AA accessibility (Rule 10, P15).

---

## 2. Route & File Structure

The landing page is a single route — `/` — served by the `(marketing)` route group, colocated with `(app)` and `(auth)` per `01_Architecture.md` §3. The three route groups share the root layout (`src/app/layout.tsx`) but diverge in their group layouts: `(app)/layout.tsx` renders `GlassShell`, `(auth)/layout.tsx` renders a centered glass card, and `(marketing)/layout.tsx` renders the marketing shell — minimal top nav, no sidebar, a footer pinned to the bottom.

```text
src/app/
  (marketing)/
    layout.tsx            # Marketing shell — top nav, no sidebar, sticky footer
    page.tsx              # The landing page (RSC) — / route
    opengraph-image.tsx   # Dynamic OG image (ImageResponse)
    twitter-image.tsx     # Alias of opengraph (Twitter card)
    sitemap.ts            # /, /pricing, /faq, /download, /changelog/[version]
    robots.ts             # allow-all + sitemap reference
    icon.tsx             # Dynamic favicon (Buddysaradhi mark on cosmic canvas)
    (sections)/          # Colocated route helpers (NOT new routes)
      loading.tsx        # Streaming skeleton if a section is still pending
    pricing/
      page.tsx           # /pricing — standalone deep-linkable pricing page
    faq/
      page.tsx           # /faq — standalone FAQ with anchor links
    download/
      page.tsx           # /download — full download hub (cross-ref §6)
    changelog/
      page.tsx           # /changelog — version index
      [version]/
        page.tsx         # /changelog/1.4.0 — single version changelog
  (app)/                  # The 5-screen app (post-login) — see 01_Architecture.md
  (auth)/                 # login/signup/verify/callback — see 03_Auth_and_Provisioning.md
```

The landing page itself (`(marketing)/page.tsx`) is the **single composition root** that renders all seven commercial sections in order: Hero → Features → Download → Pricing → FAQ → Final CTA → Testimonials. The footer is rendered by `layout.tsx`, not the page, so it appears on `/`, `/pricing`, `/faq`, and `/download` uniformly.

### 2.1 Rendering Mode — Partial Prerendering (PPR)

The landing page is **statically prerendered at build time** with two dynamic holes:

1. **The platform-detected download card** (`PlatformDetector` client island) — reads `navigator.userAgent` on mount and highlights the user's native platform. The HTML for the non-detected cards is prerendered; the highlight is a client-side paint.
2. **The live version number** in the Download Hub — fetched from Vercel Blob manifest at request time, but cached for an hour. The card structure (5 cards, layout, copy) is prerendered; the `v1.4.0` string is a `<Suspense>` hole that streams in.

```ts
// src/app/(marketing)/page.tsx — top of file
export const dynamic = "force-static";
export const revalidate = 3600; // 1-hour ISR for the manifest fetch
export const experimental_ppr = true; // inherited from next.config.ts; explicit for clarity
```

The `force-static` directive is correct because the page's only dynamic input is the manifest fetch, which is itself ISR-cached. The `revalidate = 3600` knob means a new Vercel build re-fetches the manifest on the first request after the cache expires; this is the same pattern used by `06_Build_and_Release.md` §8 for the standalone `/download` page.

### 2.2 The `(sections)` Directory is NOT a Route Group

The `(sections)` directory in the tree above is a Next.js *private folder* (parenthesised) used to colocate `loading.tsx`, `error.tsx`, and `not-found.tsx` for the landing route. It does not create a URL segment. This is a documented Next 16 convention — parenthesised folder names are stripped from the URL. A future agent reading this file should not add `page.tsx` to `(sections)/`; route-level pages live in named sibling directories (`pricing/`, `faq/`, `download/`, `changelog/`).

---

## 3. Component Architecture

The landing page is a single React Server Component that composes seven section components. Each section is RSC by default; only the interactive bits (platform detection, accordion, FAQ search, mobile nav, newsletter signup, video modal) opt into `"use client"`. The bundle target is **≤ 80 KB JS gzipped** for the first load of `/` — well under the 90 KB marketing budget in `01_Architecture.md` §9, because the marketing page ships no TanStack Query, no Zustand, no Recharts. Framer Motion is the only motion library, and it is tree-shaken to the variants the islands actually use.

```text
                          RootLayout (src/app/layout.tsx)
                                     │
                                     ▼
                          MarketingLayout  (RSC)
                          ┌───────────────┴────────────────┐
                          │                                 │
                  MarketingNav                       MarketingFooter
                  ("use client" —                    (RSC — §11)
                   scroll-spy, mobile
                   hamburger, auth pill)
                          │
                          ▼
                  LandingPage (RSC)
                  ┌───────┴────────────────────────────────────────────────┐
                  │                                                        │
            HeroSection (RSC)                                  FeaturesShowcase (RSC)
            ┌────────┴──────────┐                              ┌────────────┴───────────┐
       HeroCopy (RSC)      HeroPlatformBadge             FeatureCard × 5 (RSC)
                            ("use client" —                  │
                             navigator.userAgent)        EngineChip × 7 (RSC)
            │
       HeroVisual (RSC — DashboardPrototype auto-cycle OR static screenshot)
                  │
                  ▼
            DownloadHub (RSC)
            ├── fetch /api/releases/latest at build/revalidate
            ├── DownloadCard × 5  (Web, macOS, Windows, Android, iOS)
            │       └── PlatformDetector ("use client" — emerald glow on match)
            ├── QRCodeCard × 2 ("use client" — qrcode.react, lazy)
            └── InstallStepsAccordion ("use client" — Radix)
                  │
                  ▼
            PricingSection (RSC) → PricingCard × 1  (v1: single Free card; × 3 post-trigger per Appendix A)
                  │
                  ▼
            FAQSection (RSC)
            ├── FAQSearch ("use client" — fuse.js)
            ├── FAQAccordion ("use client" — Radix, single-open)
            └── JSON-LD FAQPage (next/script)
                  │
                  ▼
            FinalCTA (RSC) → CTAButton (RSC + data-cta-id)
                  │
                  ▼
            TestimonialGrid (RSC) → TestimonialCard × 6 (RSC)
```

### 3.1 RSC vs Client Island — Per-Component Rationale

Every component that opts into `"use client"` does so for a specific reason, documented in the table below. A component is a Client island **iff** it uses `useState`, `useEffect`, browser APIs, Framer Motion, `cmdk`, or `next/navigation`'s `usePathname`. Everything else is a Server Component. This rule is inherited verbatim from `01_Architecture.md` §4.

| Component | Rendering | Why |
|---|---|---|
| `MarketingLayout` | RSC | Static shell; no state. |
| `MarketingNav` | Client | Scroll-spy (`IntersectionObserver`), mobile hamburger toggle, the `<Suspense>`-wrapped auth pill that reads the Supabase session. |
| `LandingPage` | RSC | Composition root; orchestrates the seven sections. |
| `HeroSection` | RSC | Renders copy from `product/02_Hero_and_Above_the_Fold.md` as server-fetched strings. |
| `HeroPlatformBadge` | Client | `navigator.userAgent` + `navigator.platform` for platform detection. |
| `HeroVisual` | RSC | Renders the dashboard mockup; the auto-cycle is a CSS animation (no JS). |
| `FeaturesShowcase`, `FeatureCard`, `EngineChip` | RSC | Static content; Framer Motion `whileInView` is added via a single `MotionSection` client wrapper. |
| `DownloadHub` | RSC | Fetches the manifest server-side; passes version + URLs as props. |
| `DownloadCard` | RSC | Renders the static parts (size, SHA-256, copy). |
| `PlatformDetector` | Client | Reads `navigator.userAgent`, highlights matching card with an emerald glow. |
| `QRCodeCard` | Client | `qrcode.react` is browser-only; lazy-loaded with `next/dynamic`. |
| `InstallStepsAccordion` | Client | Radix Accordion needs DOM focus management. |
| `PricingSection`, `PricingCard` | RSC | Static pricing display. In v1: single Free card (no billing toggle, no payment-method icon row — those are client islands that render only when `NEXT_PUBLIC_PAID_TIERS_LIVE=true` per Appendix A). |
| `FAQSection` | RSC | Renders FAQ items grouped by category. |
| `FAQSearch` | Client | `fuse.js` filtering. |
| `FAQAccordion` | Client | Radix Accordion, single-open mode, keyboard-navigable. |
| `FinalCTA`, `TestimonialGrid`, `TestimonialCard` | RSC | Pure server-rendered content. |
| `NewsletterSignup` | Client | Form state; posts to `/api/newsletter/subscribe` via Server Action. |

### 3.2 Data Flow

The `LandingPage` RSC is the only component that fetches data. It makes exactly one network call at build/revalidate time:

```ts
const manifest = await fetch(
  `${process.env.NEXT_PUBLIC_APP_URL}/api/releases/latest`,
  { next: { revalidate: 3600 } }
).then((r) => r.json());
```

The `manifest` object (shape specified in §6) is then passed as a prop to `DownloadHub`, which distributes per-platform data to the five `DownloadCard` children. No other section fetches data — Hero copy, Features copy, FAQ items, Pricing tiers, and Testimonials are all static imports from `src/content/marketing/*.ts` (TypeScript modules exporting typed objects), which themselves are sourced from the `product/` directory by a codegen step (`scripts/sync-product-content.ts`). The codegen is run pre-build in CI; the runtime has zero knowledge of `product/`.

This pattern — server fetches the manifest, server imports static content modules — is the structural enforcement of the no-telemetry rule (top-level `AGENTS.md` Rule 3): no Client island on the landing page calls `fetch()`, ever. The CSP `connect-src` allowlist in `01_Architecture.md` §7 does not even include the landing's own origin for client-side fetches; only Supabase, Turso, and Vercel Blob are allowed, and only from authenticated routes.

---

## 4. Hero Section Implementation

The Hero section is the LCP-critical above-the-fold block. It renders the H1 headline, a subhead, two CTAs, a trust line, a platform badge, and a visual. The copy is sourced verbatim from `product/02_Hero_and_Above_the_Fold.md`; the implementation owns only the layout, the visual, and the CTA wiring.

### 4.1 Structure

```tsx
// src/components/marketing/hero-section.tsx (RSC)
import { HeroPlatformBadge } from "./hero-platform-badge";
import { HeroVisual } from "./hero-visual";
import { CTAButton } from "./cta-button";

export function HeroSection({ copy }: { copy: HeroCopy }) {
  return (
    <section
      id="hero"
      className="relative mx-auto flex min-h-[88vh] max-w-7xl flex-col items-center justify-center gap-12 px-6 py-20 text-center md:flex-row md:text-left"
    >
      <div className="flex-1 space-y-6">
        <p className="caption text-accent-cyan">{copy.eyebrow}</p>
        <h1 className="display text-text-primary">{copy.headline}</h1>
        <p className="h3 text-text-secondary max-w-xl">{copy.subhead}</p>
        <div className="flex flex-wrap gap-4">
          <CTAButton
            id="cta-hero-primary"
            href="/signup"
            variant="primary"
            className="cta-shimmer"
          >
            {copy.primaryCtaLabel}
          </CTAButton>
          <CTAButton
            id="cta-hero-secondary"
            href="#tour"
            variant="secondary"
          >
            {copy.secondaryCtaLabel}
          </CTAButton>
        </div>
        <HeroPlatformBadge />
        <p className="small text-text-muted">{copy.trustLine}</p>
      </div>
      <div className="flex-1">
        <HeroVisual variant="auto-cycle" />
      </div>
    </section>
  );
}
```

The two CTAs are: **"Start free — no card"** → `/signup`, and **"Watch the 90s tour"** → opens a video modal (`<dialog>` element, lazy-loads the YouTube iframe only on click). The trust line — "Join 1,000+ tutors across India" — is static copy sourced from `product/02_Hero_and_Above_the_Fold.md`. The "1,000+" figure is a v1 marketing claim; once real signup data exceeds it, the codegen swaps in the real number from a Turso aggregate query (executed server-side, daily, by `/api/cron/refresh-marketing-stats`).

### 4.2 The Platform Badge Island

`HeroPlatformBadge` is a small client island that detects the visitor's platform on mount and renders a contextual hint:

```tsx
// src/components/marketing/hero-platform-badge.tsx
"use client";
import { useEffect, useState } from "react";

type Platform = "macos" | "windows" | "android" | "ios" | "web";

function detect(): Platform {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua) || (platform === "macintel" && navigator.maxTouchPoints > 1)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/mac/.test(platform)) return "macos";
  if (/win/.test(platform)) return "windows";
  return "web";
}

export function HeroPlatformBadge() {
  const [platform, setPlatform] = useState<Platform>("web");
  useEffect(() => setPlatform(detect()), []);
  const label = {
    macos: "Available for Mac · Download 14 MB",
    windows: "Available for Windows · Download 12 MB",
    android: "Available for Android · Download 18 MB",
    ios: "Available on TestFlight",
    web: "Open the web version — no install",
  }[platform];
  return (
    <p className="caption inline-flex items-center gap-2 rounded-full border border-accent-emerald/30 bg-accent-emerald/8 px-3 py-1 text-accent-emerald">
      <span className="h-1.5 w-1.5 rounded-full bg-accent-emerald" />
      {label}
    </p>
  );
}
```

The island starts in the `"web"` state on the server and on first paint, then updates on mount. This is the **deferred-state pattern** documented in `02_State_and_Data_Flow.md` §2 for hydration-safe islands — the server HTML and first client paint match; the platform-specific string updates in a `useEffect` after hydration, avoiding any hydration mismatch.

### 4.3 The Hero Visual

The hero visual is either (a) an animated glass dashboard mockup built from the same `DashboardPrototype` component family used in the spec showcase, trimmed to a 30-second auto-cycling demo, or (b) a static optimized screenshot. The choice is build-time, controlled by a feature flag (`NEXT_PUBLIC_HERO_VISUAL=animated|static`).

Priority: **LCP < 1.2 s on 4G Mumbai.** If the animated variant pushes LCP over budget (measured via Vercel Speed Insights over a 7-day window), the build flips to the static screenshot. The static screenshot is a single `next/image` with `priority` and a blur placeholder generated from a 16×16 px LQIP. The animated variant uses CSS keyframes only — no JS animation loop — so it costs zero JS and the LCP is still the H1 + the first paint of the mockup.

The `.cta-shimmer` class (defined in `globals.css`, see worklog R3-FIX-AND-PLATFORM §4) applies a diagonal shimmer sweep to the primary CTA on hover — a 0.7 s ease transition from `left: -100%` to `left: 150%` on a `::before` pseudo-element. The shimmer is emerald on emerald (a brighter emerald gradient sweeping across the solid emerald button), and respects `prefers-reduced-motion` (the sweep is instant or omitted).

---

## 5. Features Showcase Implementation

The Features section maps the five product screens into five `FeatureCard` components, each showing a screenshot, three benefit bullets, and a "See it live" link. Beneath the five cards, a secondary grid of seven `EngineChip` components surfaces the hidden engines (Search, Reminder, Ledger, Report, Notification, Sync, Security) — the marketing claim "Five screens. Seven engines." made literal.

### 5.1 Structure

```tsx
// src/components/marketing/features-showcase.tsx (RSC)
import { FeatureCard } from "./feature-card";
import { EngineChip } from "./engine-chip";
import { MotionSection } from "./motion-section";
import { SCREENS, ENGINES } from "@/content/marketing/features";

export function FeaturesShowcase() {
  return (
    <MotionSection
      id="features"
      className="mx-auto max-w-7xl px-6 py-20"
      stagger={0.08}
    >
      <h2 className="h1 text-text-primary text-center">Five screens. Seven engines.</h2>
      <p className="h3 text-text-secondary mt-4 text-center max-w-2xl mx-auto">
        Every screen is a window into the same single source of truth — the append-only ledger.
      </p>
      <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {SCREENS.map((s) => (
          <FeatureCard key={s.id} screen={s} />
        ))}
      </div>
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        {ENGINES.map((e) => (
          <EngineChip key={e.id} engine={e} />
        ))}
      </div>
    </MotionSection>
  );
}
```

### 5.2 The FeatureCard

Each `FeatureCard` is a glass panel (`glass-strong` on hover) with: a section eyebrow (e.g., "Screen 1 · Dashboard"), a screenshot (`next/image` with `blurDataURL` and `sizes`), a title, three benefit bullets, and a "See it live" link. The link deep-links to a public read-only demo at `/demo/dashboard`, `/demo/students`, etc. — these are RSC routes under `(marketing)` that render the prototype components in a sandboxed, read-only mode (no Server Actions wired, no Supabase session). The demo mode is the agent-browser QA surface for the marketing page; it is also where the "See it live" CTA lands.

```tsx
// src/components/marketing/feature-card.tsx (RSC)
import Image from "next/image";
import Link from "next/link";

export function FeatureCard({ screen }: { screen: FeatureScreen }) {
  return (
    <article className="glass-strong group relative overflow-hidden rounded-2xl p-6 transition-transform duration-300 hover:-translate-y-1">
      <p className="caption text-accent-cyan">{screen.eyebrow}</p>
      <h3 className="h3 text-text-primary mt-2">{screen.title}</h3>
      <div className="mt-4 overflow-hidden rounded-xl border border-white/8">
        <Image
          src={screen.screenshot}
          alt={screen.alt}
          width={640}
          height={400}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          placeholder="blur"
          className="h-auto w-full"
        />
      </div>
      <ul className="mt-4 space-y-2">
        {screen.benefits.map((b) => (
          <li key={b} className="body-md text-text-secondary flex gap-2">
            <span className="text-accent-emerald">✓</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <Link
        href={`/demo/${screen.id}`}
        className="body-md text-accent-cyan mt-4 inline-flex items-center gap-1 hover:underline"
      >
        See it live →
      </Link>
    </article>
  );
}
```

### 5.3 Image Optimization

All images use `next/image`. The hero image (if static variant is selected) carries `priority`; every other image lazy-loads by default. The `sizes` attribute is mandatory on every `<Image>` — without it, Next serves a 1080 px image to a 320 px viewport, blowing the LCP budget. AVIF and WebP are auto-generated by Next's image optimizer (configured in `next.config.ts` `images.formats: ["image/avif", "image/webp"]`); the optimizer runs on the Edge, so the first request pays a one-time cost and subsequent requests hit the cache.

### 5.4 Animation

`MotionSection` is the single client wrapper that applies Framer Motion's `whileInView` stagger to its children. It is a Client island; the children (the `FeatureCard`s) remain RSC. The stagger respects `prefers-reduced-motion` — if the user has it set, the cards appear instantly with no fade-in. This is the `13_UI_Guidelines.md` §1.3 accessibility rule made structural: reduced motion is not a fallback, it is a first-class rendering mode.

---

## 6. Download Hub Implementation

The Download Hub is the centerpiece of the landing page. It is the section a tutor scrolls to when they have decided to try the product. It offers five paths — Web, macOS, Windows, Android, iOS — and wires each to the right delivery mechanism: the Web card links into the app; the three native cards link to Vercel Blob URLs from the release manifest; the iOS card links to TestFlight.

### 6.1 The Manifest Endpoint

The Download Hub reads from a single server-side endpoint — `/api/releases/latest` — which returns a unified manifest covering both desktop and mobile platforms:

```json
{
  "version": "1.4.0",
  "releasedAt": "2025-06-27T10:00:00Z",
  "changelogUrl": "/changelog/1.4.0",
  "platforms": {
    "macos": {
      "url": "https://public.blob.vercel-storage.com/buddysaradhi/desktop/macos/Buddysaradhi-1.4.0-universal.dmg",
      "size": 14212456,
      "sha256": "a3f5e8b9c1d2e4f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
      "minOs": "11.0"
    },
    "windows": {
      "url": "https://public.blob.vercel-storage.com/buddysaradhi/desktop/windows/Buddysaradhi-Setup-1.4.0-x64.msi",
      "size": 11800000,
      "sha256": "b4f6e9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9",
      "minOs": "10.0.19041"
    },
    "android": {
      "url": "https://public.blob.vercel-storage.com/buddysaradhi/mobile/android/Buddysaradhi-1.4.0-universal.apk",
      "size": 28000000,
      "sha256": "c5f7e0d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      "minSdk": "26"
    },
    "ios": {
      "url": null,
      "testFlightUrl": "https://testflight.apple.com/join/abc123XY",
      "minIos": "16.0"
    }
  }
}
```

This endpoint is a server route (`src/app/api/releases/latest/route.ts`) that reads `manifests/desktop-stable.json` and `manifests/mobile-stable.json` from Vercel Blob (per `deployment/02_Vercel_Blob_Build_Storage.md` §4 schema), merges them into the unified shape above, and serves with `Cache-Control: public, max-age=3600`. The merge is necessary because the desktop and mobile manifests are published by independent CI workflows (see `web/06_Build_and_Release.md` §9); the landing page sees them as one.

The endpoint is **server-only**. Client islands on the landing page never call it directly; the `DownloadHub` RSC fetches it at build/revalidate time and passes the resolved data as props. This is the same pattern as `06_Build_and_Release.md` §8.1, generalized to the landing page.

### 6.2 The Five Download Cards

The `DownloadHub` renders five `DownloadCard` components. Each card is a glass panel with the platform name, an icon, a short description, the version number, the file size (formatted `Intl.NumberFormat('en-IN')` — `14,21,246` bytes → "14.2 MB"), the minimum OS, an expandable SHA-256 row, a "View changelog" link, and the primary CTA button.

| Card | CTA | CTA Target | Cross-Ref |
|---|---|---|---|
| **Web** | "Open web version" | `/login` (or `/dashboard` if logged in) | `01_Architecture.md` §3.1 |
| **macOS** | "Download .dmg" | `manifest.platforms.macos.url` (Vercel Blob) | `deployment/02_Vercel_Blob_Build_Storage.md` §2 |
| **Windows** | "Download .msi" | `manifest.platforms.windows.url` | `deployment/02_Vercel_Blob_Build_Storage.md` §2 |
| **Android** | "Download .apk" | `manifest.platforms.android.url` | `mobile/05_EAS_Build.md` |
| **iOS** | "Join TestFlight" | `manifest.platforms.ios.testFlightUrl` | `mobile/07_App_Store_Release.md` |

The Web card is the primary path for the web-platform audience. Its CTA is rendered with the emerald primary variant (`bg-accent-emerald`) and is the visually dominant card in the grid (it spans 2 columns on `md+`). The other four cards are secondary — Cyan-tinted borders, equal-width in a 2×2 grid below the Web card on `md+`, stacked on `sm`.

### 6.3 PlatformDetector Island

A single client island, `PlatformDetector`, runs on mount and highlights the user's native platform card with an emerald glow border (the `glass-accent-emerald` class from `13_UI_Guidelines.md` §5.4 — 2px emerald left border + inner glow). It also renders a "Recommended for your device" caption above the highlighted card. The detection logic is the same `navigator.userAgent` + `navigator.platform` heuristic used in the Hero badge (§4.2), centralized in `src/lib/detect-platform.ts`.

If detection fails or returns `"web"`, no card is highlighted; the Web card remains the visually dominant one (it is always rendered with the primary styling).

### 6.4 QR Code Cards

The Android and iOS cards include a `QRCodeCard` — a small client island that renders a QR code linking to the respective URL (APK for Android, TestFlight for iOS). A tutor viewing the landing page on a laptop scans the QR with their phone to download on mobile. The QR is generated client-side via `qrcode.react` (a 14 KB library, lazy-loaded with `next/dynamic` so it does not count against the initial bundle). The QR encodes the absolute URL, not a relative path — so the scan works regardless of which `buddysaradhi.app` page the user is on.

### 6.5 Install Steps Accordion

Each native card includes an expandable "How to install" panel (Radix Accordion, single-open per card). The steps are platform-specific:

- **macOS**: 1) Open the `.dmg`. 2) Drag Buddysaradhi to Applications. 3) First launch: right-click → Open (Gatekeeper dialog). 4) Enter admin password.
- **Windows**: 1) Run `Buddysaradhi-Setup-1.4.0-x64.msi`. 2) SmartScreen → "More info" → "Run anyway" (the installer is code-signed but not yet EV-certified at v1; see `desktop/04_Code_Signing.md`). 3) Choose per-user install (default). 4) Finish.
- **Android**: 1) Open the `.apk`. 2) Allow "install from unknown sources" if prompted. 3) Open Buddysaradhi. 4) Sign up.
- **iOS**: 1) Tap "Join TestFlight". 2) Install TestFlight from App Store. 3) Install Buddysaradhi beta. 4) Open Buddysaradhi.

The accordion is a Client island; the static steps are server-rendered and the accordion state is the only client-side bit.

### 6.6 Verification Flow

After download, the SHA-256 of the binary is shown in an expandable row on each card. Power users can verify the download by computing `sha256sum` (Linux/macOS) or `Get-FileHash` (Windows PowerShell) and comparing. The installer binaries themselves are code-signed per `desktop/04_Code_Signing.md` — Windows with an EV certificate (post-v1.1), macOS with Developer ID + notarization + stapling. The SHA-256 is the user-facing verification layer; the code signature is the OS-facing one.

### 6.7 Bandwidth + Caching Notes

Vercel Blob egress is metered (10 GB/month on Hobby, per `05_Deployment_Vercel.md` §8). The Download Hub is the primary consumer of that bandwidth. Two mitigations:

1. **The manifest endpoint** (`/api/releases/latest`) is served with `Cache-Control: public, max-age=3600` and is itself ISR-cached at `revalidate: 3600`. A manifest fetch costs ~2 KB per cache miss; the cache hit rate is >99%.
2. **The binary URLs** are immutable — each version's installer lives at a content-addressed pathname (`Buddysaradhi-1.4.0-universal.dmg`, never overwritten per `deployment/02_Vercel_Blob_Build_Storage.md` §3.5). They are served with `Cache-Control: public, max-age=31536000, immutable` (set by the `@vercel/blob` `put()` call's `cacheControlMaxAge` option). A repeat download from the same browser hits the browser cache; a repeat download from a different browser hits the Vercel Edge cache.

The 10 GB/month budget supports roughly 700 average downloads (14 MB average installer size). Above that, the alert at 80% (`05_Deployment_Vercel.md` §8) fires and we evaluate the Pro tier upgrade.

### 6.8 Cross-References

- `deployment/02_Vercel_Blob_Build_Storage.md` §2 — bucket layout.
- `deployment/02_Vercel_Blob_Build_Storage.md` §4 — manifest schema.
- `web/06_Build_and_Release.md` §3 — Vercel Blob storage layout (web side).
- `web/06_Build_and_Release.md` §8 — the standalone `/download` page (sister to the in-landing Download Hub; same data, different layout).
- `desktop/04_Code_Signing.md` — Windows + macOS code signing.
- `mobile/05_EAS_Build.md` — Android APK production.
- `mobile/07_App_Store_Release.md` — iOS TestFlight + App Store.
- `product/04_Download_Hub.md` — the marketing-level download hub spec (copy, card layout intent, persona narratives).

---

## 7. FAQ Implementation

The FAQ section renders FAQ items grouped by category (Getting Started, Pricing, Data & Sync, Privacy & Security, Offline, Backup, Mobile/Desktop). The content is sourced from `product/06_FAQ.md`, which owns the canonical list of questions, answers, and category assignments. This file owns the rendering: the accordion, the search, the JSON-LD, the "Top 5 questions" surface.

### 7.1 Structure

```tsx
// src/components/marketing/faq-section.tsx (RSC)
import { FAQSearch } from "./faq-search";
import { FAQAccordion } from "./faq-accordion";
import { FAQJsonLd } from "./faq-json-ld";
import { FAQ_ITEMS, TOP_FIVE } from "@/content/marketing/faq";

export function FAQSection() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-20">
      <h2 className="h1 text-text-primary text-center">Questions, answered</h2>
      <FAQSearch items={FAQ_ITEMS} className="mt-8" />
      <div className="mt-8 space-y-3">
        <p className="caption text-accent-cyan">Top 5 questions</p>
        <FAQAccordion items={TOP_FIVE} defaultOpen={0} />
      </div>
      <div className="mt-12 space-y-3">
        <p className="caption text-accent-cyan">All questions, by category</p>
        <FAQAccordion items={FAQ_ITEMS} grouped />
      </div>
      <FAQJsonLd items={FAQ_ITEMS} />
    </section>
  );
}
```

### 7.2 The Accordion Island

`FAQAccordion` is a Client island built on Radix Accordion (`@radix-ui/react-accordion`, already vendored under `src/components/ui/`). It is single-open mode (opening one item closes the others), keyboard-navigable (Tab to focus, Enter/Space to toggle, Arrow keys to navigate), and respects `prefers-reduced-motion` (no slide animation if set). The grouped variant renders category headers between accordion items; the flat variant (used for Top 5) does not.

### 7.3 The Search Island

`FAQSearch` is a Client island that filters the FAQ items by query. The filter uses `fuse.js` (a ~6 KB fuzzy-search library) with a threshold tuned for partial matches on the question text. When no items match, the search renders "No matches — email [hello@buddysaradhi.app](mailto:hello@buddysaradhi.app)." This is the honest-empty-state rule from `13_UI_Guidelines.md` §1.3 — never show a blank result, always offer a path forward.

### 7.4 JSON-LD `FAQPage`

`FAQJsonLd` injects a `<script type="application/ld+json">` payload via `next/script` with the `FAQPage` schema. Every question in `FAQ_ITEMS` becomes a `Question` with `acceptedAnswer`. This is what makes Google render rich FAQ snippets in search results — a high-leverage SEO investment for a tutor searching "private tutor app fees" on their phone. The script is rendered with `strategy="afterInteractive"` so it does not block LCP.

### 7.5 The Top 5 Surface

Above the full accordion, the "Top 5 questions" surface renders the five most-asked questions (sourced from a Vercel Web Analytics custom event `faq_expand`, aggregated weekly, ranked by frequency). This is the only place on the landing page where analytics data feeds back into the rendered HTML — and it does so via a daily codegen step (`/api/cron/refresh-top-faqs`), not via client-side personalization. The Top 5 is the same for every visitor; the underlying data is aggregate-only and contains no PII (compatible with the no-telemetry rule, top-level `AGENTS.md` Rule 3).

---

## 8. CTA & Conversion Implementation

The landing page has exactly seven primary CTAs, each instrumented with a `data-cta-id` attribute for Vercel Web Analytics custom event tracking. The CTA inventory:

| # | CTA | Location | Target | `data-cta-id` | Color |
|---|---|---|---|---|---|
| 1 | "Start free — no card" | Hero | `/signup` | `cta_hero_click` | Emerald (primary) |
| 2 | "See it live" | Each FeatureCard | `/demo/{screen}` | `cta_features_click` | Cyan (link) |
| 3 | "Open web version" / "Download" | Download Hub cards | Vercel Blob or `/login` | `cta_download_click` | Emerald (Web) / Cyan (native) |
| 4 | "Start free →" | Pricing (single Free card, v1) | `/signup?plan=free` | `cta_pricing_click` | Emerald (primary) |
| 5 | "Read more" | FAQ bottom | `/faq` | `cta_faq_bottom_click` | Cyan (link) |
| 6 | "Get started" | Final CTA | `/signup` | `cta_final_cta_click` | Emerald (primary, full-width) |
| 7 | "Sign up" | Footer | `/signup` | `cta_footer_click` | Emerald (link) |

The CTA color logic is enforced by `13_UI_Guidelines.md` §2.4: Emerald is the primary "do the thing" accent (Start free, Open web, Download); Cyan is the info/exploration accent (See it live, Read more); Amber is reserved for partial-state CTAs (none on the landing); Flare is reserved for destructive CTAs (none on the landing); Violet is for the newsletter signup (a tertiary CTA in the footer).

### 8.1 The "No Dark Patterns" Rule

The landing page does **not** use: fake urgency ("Only 3 left!"), forced modals (no exit-intent popups), pre-checked upsells (no "also subscribe me to the newsletter" checkbox on signup), manipulative social proof ("12 people in your city signed up today!"), or countdown timers. This is the honesty principle (`01_Product_Principles.md` P15) made operational. The trust line "Join 1,000+ tutors across India" is a verified aggregate, not a fake number; the "Top 5 questions" surface is ranked by real expand events, not editorially chosen to maximize conversion.

### 8.2 Conversion Events

Vercel Web Analytics (the only analytics on the landing — see §10) tracks custom events via the `track()` function from `@vercel/analytics/react`. Each CTA click fires one event with its `data-cta-id`. The events are:

- `cta_hero_click`, `cta_features_click`, `cta_download_click`, `cta_pricing_click`, `cta_faq_bottom_click`, `cta_final_cta_click`, `cta_footer_click` — one per CTA click.
- `signup_complete` — fired on the `/dashboard` first load (the post-signup landing), with a `time_to_dashboard_ms` property.

The funnel is: landing → CTA click → signup → OTP verify → Turso DB provision → `/dashboard`. The target end-to-end time from landing to first dashboard view is **< 90 seconds** (the 7-step provisioning flow in `03_Auth_and_Provisioning.md` §4 takes 5–20 seconds; OTP delivery adds 10–30 seconds; the rest is human typing). This is measured by the `time_to_dashboard_ms` property, aggregated by Speed Insights.

### 8.3 The Signup Flow

The signup flow is `/signup` (Supabase OTP send) → `/verify` (OTP confirm) → `/signup/provision` (Turso DB creation via Edge Function, 7-step flow per `03_Auth_and_Provisioning.md` §4) → `/dashboard` (empty-state, per `04_Dashboard.md` §3). The `/signup?plan={tier}` query parameter is read by the signup page and stored in `user_metadata.plan_intent`; after provisioning, the dashboard's empty-state shows a contextual hint for the chosen plan. The plan is not locked in at signup — the tutor can change it from Settings → Billing — but the intent informs the onboarding copy.

---

## 9. SEO Implementation

SEO on the landing page is a four-layer investment: the `metadata` export (title, description, OG, Twitter, canonical, robots), the dynamic OG image, JSON-LD structured data, and the `sitemap.ts` + `robots.ts` files. The keyword strategy, the persona-to-keyword map, and the content briefs live in `product/09_SEO_and_Analytics.md`; this file owns the technical implementation.

### 9.1 The `metadata` Export

```ts
// src/app/(marketing)/page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Buddysaradhi — The operating system for private tutors",
  description:
    "Run your tuition business from five screens. Attendance, fees, receipts, reminders — offline-first, on web, Mac, Windows, Android, and iOS. ₹0 to start.",
  alternates: { canonical: "https://buddysaradhi.app/" },
  openGraph: {
    title: "Buddysaradhi — Five screens. Seven engines. One ledger.",
    description:
      "The operating system for private tutors and coaching institutes. Offline-first. India-first. Free to start.",
    url: "https://buddysaradhi.app/",
    siteName: "Buddysaradhi",
    type: "website",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Buddysaradhi — five screens, one ledger" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Buddysaradhi — the OS for private tutors",
    description: "Five screens. Seven engines. One ledger. Offline-first, India-first.",
    images: ["/twitter-image"],
  },
  robots: { index: true, follow: true, "max-image-preview": "large" },
};
```

### 9.2 Dynamic OG Image — `opengraph-image.tsx`

The OG image is generated dynamically via Next's `ImageResponse` API. It renders the Buddysaradhi mark, the headline, and a cosmic-canvas background at 1200×630. The image is generated at build time and cached; it does not change per-request. The same image is used for Twitter (`twitter-image.tsx` is a re-export).

```tsx
// src/app/(marketing)/opengraph-image.tsx
import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Buddysaradhi — Five screens. Seven engines. One ledger.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #0f0c29, #24243e, #0a0a1a)",
          color: "rgba(255,255,255,0.95)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 80,
        }}
      >
        <div style={{ fontSize: 28, color: "#00F0FF", marginBottom: 16 }}>Buddysaradhi</div>
        <div style={{ fontSize: 72, fontWeight: 700, textAlign: "center" }}>
          Five screens. Seven engines.
        </div>
        <div style={{ fontSize: 72, fontWeight: 700, color: "#00FF9D", marginTop: 8 }}>
          One ledger.
        </div>
        <div style={{ fontSize: 24, color: "rgba(255,255,255,0.65)", marginTop: 32 }}>
          Offline-first. India-first. Free to start.
        </div>
      </div>
    ),
    { ...size }
  );
}
```

The OG image uses the cosmic canvas gradient and the bioluminescent accents — Emerald for "One ledger" (the brand claim) and Cyan for the eyebrow. No indigo, no blue (top-level `AGENTS.md` Rule 5).

### 9.3 JSON-LD Structured Data

Three JSON-LD payloads are injected via `next/script` with `strategy="afterInteractive"`:

1. **`SoftwareApplication`** — name, applicationCategory, operatingSystem (multi), offers (the free tier with `price: "0"` and `priceCurrency: "INR"`), aggregateRating (populated once we have real reviews).
2. **`FAQPage`** — every FAQ item from §7 as a `Question` with `acceptedAnswer`.
3. **`BreadcrumbList`** — `Home` → current page, for the standalone `/pricing`, `/faq`, `/download`, `/changelog/[version]` pages.

### 9.4 `sitemap.ts`

```ts
// src/app/(marketing)/sitemap.ts
import type { MetadataRoute } from "next";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://buddysaradhi.app";
  const staticRoutes = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1.0 },
    { url: `${base}/pricing`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/faq`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/download`, changeFrequency: "weekly", priority: 0.9 },
  ];
  const changelogVersions = await fetch(`${base}/api/releases/versions`)
    .then((r) => r.json()) as string[];
  const changelogRoutes = changelogVersions.map((v) => ({
    url: `${base}/changelog/${v}`,
    changeFrequency: "yearly" as const,
    priority: 0.4,
  }));
  return [...staticRoutes, ...changelogRoutes];
}
```

### 9.5 `robots.ts`

```ts
// src/app/(marketing)/robots.ts
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/demo/"] },
    sitemap: "https://buddysaradhi.app/sitemap.xml",
    host: "https://buddysaradhi.app",
  };
}
```

The `/demo/` routes are disallowed because they are interactive prototypes, not canonical content; indexing them would cannibalize the landing page's rankings.

### 9.6 Performance Budget

The SEO targets are also performance targets — Google's Core Web Vitals are a ranking signal. The landing page commits to: **LCP < 1.2 s, CLS < 0.05, INP < 100 ms, total JS < 80 KB gzipped.** The 80 KB budget is well under the 90 KB marketing-page ceiling in `01_Architecture.md` §9 because the landing has no TanStack, no Zustand, no Recharts — only Framer Motion (tree-shaken), Radix primitives (the accordion + dialog), `fuse.js` (the FAQ search), `qrcode.react` (lazy), and the Vercel Analytics + Speed Insights SDKs (~3 KB combined).

---

## 10. Performance & Analytics

### 10.1 Partial Prerendering

The landing page is statically prerendered at build time with two dynamic holes (the platform-detected card highlight and the live version number). The static shell — Hero copy, Features, FAQ items, Pricing, Footer — ships from the Vercel Edge cache with sub-50 ms TTFB from India (`bom1` region, per `05_Deployment_Vercel.md` §2.1). The dynamic holes stream in via `<Suspense>` boundaries; if the manifest fetch is slow, the page renders with placeholder content (a dimmed "Loading version…" string) and hydrates when the manifest resolves.

### 10.2 Fonts and Images

Fonts are loaded via `next/font/google` with `display: swap` and the Latin subset. The landing uses **Inter** (body, 400 + 600) and **JetBrains Mono** (the version number, the SHA-256 hash, the receipt-format numerics in the demo screenshots). Total font payload: ~38 KB gzipped, well under the budget in `13_UI_Guidelines.md` §3.1. SF Pro Display is the heading font on Apple platforms (loaded via `system-ui` fallback); Inter is the cross-platform fallback. No `display`-blocked webfont loads.

All images use `next/image` with the `sizes` attribute (mandatory), AVIF/WebP auto-generation, and `placeholder="blur"` for above-the-fold images. The hero visual is the only `priority` image; everything else lazy-loads.

### 10.3 No Client-Side Data Fetching

The landing page has **zero** client-side `fetch()` calls. Every byte of data is either (a) server-fetched in the `LandingPage` RSC (the manifest), (b) statically imported from `src/content/marketing/*.ts` (all copy), or (c) read from browser APIs in client islands (`navigator.userAgent`, `localStorage` for the demo-mode auth pill). This is the structural enforcement of the no-telemetry rule: there is no client-side fetch hook to abuse.

### 10.4 Vercel Web Analytics + Speed Insights

Vercel Web Analytics is the **only** analytics on the landing page (per `05_Deployment_Vercel.md` §6). It is privacy-respecting: no cookies, no cross-site tracking, aggregate-only, no PII. Speed Insights collects Core Web Vitals (LCP, INP, CLS, TTFB) per route, aggregated by country. Both are gated to `process.env.NEXT_PUBLIC_VERCEL_ENV === "production"` so preview deploys do not pollute the production dashboard.

The custom CTA events (§8.2) are tracked via `@vercel/analytics/react`'s `track()` function. The events carry the `data-cta-id` string and an optional `plan_intent` property (for the pricing CTA); no user identifiers, no PII, no cross-session correlation. This is compatible with TELE-1 (`10_Security.md` §17) because Vercel's Web Analytics policy explicitly does not share or sell data and does not set cross-site tracking cookies.

### 10.5 Lighthouse Target

The landing page targets **≥ 95 on all four Lighthouse metrics**: Performance, Accessibility, Best Practices, SEO. The target is verified by a Lighthouse CI run on every PR (configured in `.github/workflows/lighthouse.yml`); a regression below 95 blocks the merge. The four sub-targets:

- **Performance ≥ 95**: LCP < 1.2 s, TBT < 200 ms, CLS < 0.05.
- **Accessibility ≥ 95**: WCAG 2.1 AA, 44×44 px touch targets, color contrast verified against the composite rgba stack (`13_UI_Guidelines.md` §2.1).
- **Best Practices ≥ 95**: HTTPS-only, no `console.log`, no deprecated APIs, `meta viewport` set.
- **SEO ≥ 95**: `metadata` complete, `robots.txt` valid, `sitemap.xml` valid, all images have `alt`, headings hierarchical.

---

## 11. The Footer

`MarketingFooter` is an RSC rendered by `(marketing)/layout.tsx`, so it appears on every marketing route uniformly (`/`, `/pricing`, `/faq`, `/download`, `/changelog/*`). It has four columns, social links, the "Made in India" line, a dynamic-year copyright, a status-page link, and a newsletter signup island.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  Buddysaradhi                                                                     │
│  Five screens. Seven engines.           Product   Resources   Company  Legal │
│  One ledger.                            Features   Docs        About    Terms │
│                                         Download   Changelog   Blog     Privacy│
│  Made in India 🇮🇳                      Pricing    Status      Contact  Refund │
│                                         FAQ                            Policy │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────── │
│  © 2025 Buddysaradhi · Status: operational · @buddysaradhi · YouTube · LinkedIn        │
│  [Newsletter: email input] [Subscribe]                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

The marketing layout uses `min-h-screen flex flex-col` with `mt-auto` on the footer — the sticky-footer rule from `13_UI_Guidelines.md` §13 and top-level `AGENTS.md` §6.3. The footer's top border is a 1 px linear-gradient emerald → cyan glow (the `.footer-top-glow` class, per worklog R3-FIX-AND-PLATFORM §4).

The newsletter signup is a small Client island (`NewsletterSignup`) with an email input and a Subscribe button. The form posts to a Server Action (`subscribeToNewsletter`) that validates the email with Zod, stores it in the `newsletter_subscribers` table in the platform Turso DB (the single shared DB, not a per-user DB), and returns a typed `Result`. The form is Razorpay-agnostic — it just stores the email; the actual newsletter send is a separate workflow (a future v1.x feature, out of scope here). The subscribe action is rate-limited per IP (token-bucket, 5 per hour) to defeat list-bombing.

---

## 12. Cross-References & Non-Negotiables

### 12.1 Cross-Reference Table

| This file § | Cross-references |
|---|---|
| §2 Route & File Structure | `web/01_Architecture.md` §3 (route groups), §3.1 (`(marketing)`), §7 (`next.config.ts` PPR); `web/AGENTS.md` §3 (file map). |
| §3 Component Architecture | `web/01_Architecture.md` §4 (RSC vs Client Island table); `web/02_State_and_Data_Flow.md` §2 (deferred-state pattern). |
| §4 Hero Section | `product/02_Hero_and_Above_the_Fold.md` (copy source); `13_UI_Guidelines.md` §3 (type ramp), §5.4 (glass-accent-emerald). |
| §5 Features Showcase | `product/03_Features_Showcase.md` (content source); `04_Dashboard.md`–`08_Settings.md` (per-screen specs); `13_UI_Guidelines.md` §5 (glass tiers). |
| §6 Download Hub | `product/04_Download_Hub.md` (marketing spec); `web/06_Build_and_Release.md` §3, §4, §8 (manifest schema, `/download` page); `deployment/02_Vercel_Blob_Build_Storage.md` §2, §4 (bucket layout, manifest schema); `desktop/04_Code_Signing.md`; `desktop/06_Installers.md`; `mobile/05_EAS_Build.md`; `mobile/07_App_Store_Release.md`. |
| §7 FAQ | `product/06_FAQ.md` (content source); `13_UI_Guidelines.md` §1.3 (honest empty state). |
| §8 CTA & Conversion | `product/05_Pricing_and_Plans.md` (pricing tiers — ₹0/₹299/₹999 monthly, ₹2,999/₹9,999 yearly); `product/09_SEO_and_Analytics.md` (conversion tracking); `01_Product_Principles.md` P15 (honesty); `web/03_Auth_and_Provisioning.md` §4 (signup flow). |
| §9 SEO | `product/09_SEO_and_Analytics.md` (keyword strategy, content briefs); Next.js Metadata API docs. |
| §10 Performance & Analytics | `web/01_Architecture.md` §9 (bundle budget); `web/05_Deployment_Vercel.md` §6 (Speed Insights + Web Analytics); `deployment/01_Vercel_Hosting.md` §9 (analytics privacy posture); `10_Security.md` §17 (TELE-1). |
| §11 Footer | `13_UI_Guidelines.md` §13 (sticky footer); top-level `AGENTS.md` §6.3. |
| §12 Cross-References | Top-level `AGENTS.md` §2 (the 10 non-negotiables). |

### 12.2 The Five Binding Non-Negotiables for This Page

1. **No indigo or blue accent colors.** Palette: Emerald `#00FF9D`, Cyan `#00F0FF`, Amber `#FFB300`, Flare `#FF5E00`, Violet `#B388FF`, on the cosmic canvas `#0f0c29` → `#24243e` → `#0a0a1a`. (Rule 5, AP-6, `13_UI_Guidelines.md` §1.3.)
2. **No telemetry SDK.** Vercel Web Analytics + Speed Insights only — aggregate, privacy-respecting, no cookies, no PII. No Sentry, Mixpanel, PostHog, GA, Amplitude. (Rule 3, AP-10, TELE-1, `10_Security.md` §17.)
3. **No third-party APIs that see PII on the landing.** The landing page makes exactly one server-side fetch (`/api/releases/latest`) and zero client-side fetches. The newsletter signup posts to a Server Action that stores the email in the platform Turso DB; no third-party email service sees the address at v1. (Rule 2, P5.)
4. **Integer paise in any pricing display.** The Pricing section displays plan amounts in ₹ with `Intl.NumberFormat('en-IN')` formatting (`₹ 0`, `₹ 299`, `₹ 999`). The underlying storage is integer paise; the display is the formatted rupee equivalent. Annual prices surface as `₹ 2,999/yr` (Pro) and `₹ 9,999/yr` (Institute), matching `product/05_Pricing_and_Plans.md` §1.1 verbatim. No float arithmetic, no `Number` for money, no `toFixed(2)` on a float. (Rule 6, BR-M-01, `13_UI_Guidelines.md` §3.4.)
5. **WCAG 2.1 AA accessibility.** Every interactive element meets the 44×44 px touch target, every image has an `alt`, every form field has a `<label>`, color contrast is verified against the composite rgba stack, and `prefers-reduced-motion` is honoured on every animation. (Rule 10, P15, `13_UI_Guidelines.md` §1.3, §10.)

---

## 13. ASCII Art Mockup Suite (§20 Compliance)

Per `13_UI_Guidelines.md` §20.6, every web/ landing-page file must carry ≥ 2 ASCII art mockups. The mockups below complement the existing §3 component tree and §11 footer sketch — they add six new views covering every commercial section: (1) the hero composition above the fold, (2) the features grid (6 cards), (3) the download hub (5 cards), (4) the FAQ accordion, (5) the CTA stack, and (6) the footer with newsletter signup. Every mockup sits inside a fenced code block per §20.3 rule 1; box widths stay within the 80–120 character desktop range per §20.3 rule 2; the §20.2 character set is in use; accent colours are named, never hexed; every glass surface is tier-annotated per §5.5; every neumorphic control is recipe-annotated per §6.6; cross-references use canonical IDs only.

### 13.1 Design System Reference — Commercial Surface

> **The single rule (§6.6).** The commercial landing page is the **canonical demonstration** of the design system (`13_UI_Guidelines.md` §19). Every surface is glass (per §5.5); every control is neumorphic (per §6.6). The hero card is `.glass` over the cosmic gradient; feature cards are `.glass` + accent left-border per principle family; pricing cards are `.glass` with the featured tier elevated to `.glass-strong` + emerald glow; download cards are `.glass`; CTA buttons are `.neumo-raised`; the FAQ search bar is `.neumo-inset`; the FAQ accordion rows are `.glass-faint` bands. The tables below list every surface and control on the commercial surface; they mirror `13_UI_Guidelines.md` §5.5 (Marketing surface rows) and §6.6 (CTA buttons).

| Surface (commercial) | Glass tier | Where on `/` | Cross-ref |
|---|---|---|---|
| Marketing hero card (over cosmic gradient) | `glass` | Hero section | §5.5, §4 of this file |
| Marketing feature card (per principle) | `glass` + accent L-border (emerald/cyan/violet per principle family) | Features grid | §5.4, §5.5, §5 of this file |
| Marketing pricing card (standard tier) | `glass` | Pricing section | §5.5 |
| Marketing pricing card (featured tier) | `glass-strong` + emerald glow | Pricing section (₹299 "Tutor" tier) | §5.4, §5.5 |
| Marketing download card | `glass` per platform | Download Hub | §5.5, §6 of this file |
| Marketing download card (recommended by PlatformDetector) | `glass-strong` + emerald glow + 2px L-border | Download Hub (user's native platform) | §5.4, §5.5 |
| Marketing testimonial card | `glass-faint` (recedes; the quote is the content) | Testimonials grid | §5.5, §8.4 |
| Marketing FAQ accordion row | `glass-faint` band | FAQ section | §5.5, §8.4 |
| Marketing nav (top) | `glass-faint` band (sticky) | All marketing routes | §5.5 |
| Marketing footer | `glass-faint` (sticky per §13) | All marketing routes | §5.5, §13 |
| Final CTA card (full-width emerald glow) | `glass-strong` + emerald inner glow | Final CTA section | §5.4, §5.5 |

| Control (commercial) | Neumo recipe | Where on `/` | Cross-ref |
|---|---|---|---|
| Hero primary CTA ("Start free — no card") | `neumo-raised` + emerald glow + `.cta-shimmer` | Hero | §6.6, §8.2 |
| Hero secondary CTA ("Watch the 90s tour") | `neumo-raised` (no glow) | Hero | §6.6, §8.2 |
| Features "See it live" link | ghost (transparent, cyan) | Each FeatureCard | §8.2 |
| Download primary CTA ("Download .dmg / .msi / .apk") | `neumo-raised` + emerald glow (recommended card) or cyan glow (others) | Each DownloadCard | §6.6, §8.2 |
| Download "Join TestFlight" button (iOS) | `neumo-raised` + amber glow | iOS DownloadCard | §6.6, §8.2 |
| Download "Show SHA-256" accordion | flat tinted + Radix Accordion (NOT neumo) | Each DownloadCard | §8.5 |
| Download "How to install" accordion | `neumo-inset` well + `neumo-raised` ± buttons | Each DownloadCard | §6.6, §8.5 |
| Pricing CTA ("Start free →" — single CTA, v1) | `neumo-raised` + emerald glow + `.cta-shimmer` | Single PricingCard (v1) | §6.6, §8.2 |
| Pricing billing toggle (monthly/annual) — hidden pre-trigger | `neumo-inset` well + `neumo-raised` pill (renders only when `NEXT_PUBLIC_PAID_TIERS_LIVE=true`) | Pricing section header (post-trigger only) | §6.6, §8.5 |
| FAQ search bar | `neumo-inset` + cyan focus ring | FAQ section | §6.6, §8.10 |
| FAQ accordion toggle | flat tinted + Radix (NOT neumo — the row is a surface, not a control) | FAQ section | §8.4 |
| Final CTA button ("Get started") | `neumo-raised` + emerald glow + `.cta-shimmer` | Final CTA | §6.6, §8.2 |
| Footer newsletter signup input | `neumo-inset` | Footer | §6.6, §8.9 |
| Footer newsletter "Subscribe" button | `neumo-raised` + violet glow | Footer | §6.6, §8.2 |
| Mobile hamburger toggle | `neumo-raised`; `:active` → `neumo-pressed` | Mobile nav | §6.6, §8.2 |

> **References.** Next.js 16 App Router docs (PPR, `force-static` + `revalidate`, `next/font`, `next/image`, `next/script`, metadata routes, `ImageResponse` for OG); Vercel docs (`@vercel/analytics` `track()`, `@vercel/speed-insights`, Vercel Blob, Edge runtime for OG image); Smashing Magazine — "Designing Commercial Landing Pages With Glassmorphism"; Josh W. Comeau — "Building A Modern Landing Page With React Server Components"; CSS-Tricks — "Glassmorphism On The Web: Done Right"; web.dev — "Core Web Vitals For Marketing Pages" (LCP/CLS/INP targets); Nielsen Norman Group — "Above-the-Fold Design For Conversion". These are the same references cited in `README.md` §7.2.

### 13.2 Mockup M1 — Hero Composition (Above the Fold, Desktop ≥ 1024 px)

The §4 narrative described the hero structure; this mockup shows the **above-the-fold composition** at 1280×800 desktop — the LCP-critical block a first-time visitor sees before scrolling. The point: the hero card is `.glass` over the cosmic gradient, the H1 + subhead + CTAs + trust line + platform badge live inside it, and the visual (animated dashboard mockup OR static screenshot) sits to the right. LCP target: < 1.2 s on 4G Mumbai.

```
   Hero Composition — Above the Fold (desktop ≥ 1024 px, 1280×800 viewport)
   LCP target: < 1.2 s on 4G Mumbai (Vercel Speed Insights, 7-day rolling)

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  COSMIC CANVAS (raw gradient #0f0c29 → #24243e → #0a0a1a)                                       │
   │  • aurora blobs at 3% opacity (the ONE permitted ambient motion on the marketing surface — P7)   │
   │  • NOT glass — this is the canvas; the hero card is glass ON it                                   │
   │                                                                                                  │
   │  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
   │  │  MARKETING NAV (.glass-faint band, sticky top)                                              │  │
   │  │  [◈ Buddysaradhi]   Features  Download  Pricing  FAQ           [Sign in]  [Open app ◄]         │  │
   │  │  ↑ glass-faint (§5.5)                                          ↑ neumo-raised (§6.6 §8.2)│  │
   │  │                                                                ↑ ghost (transparent)    │  │
   │  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
   │                                                                                                  │
   │  ┌─────────────────────────────────────────────────┐  ┌────────────────────────────────────────┐ │
   │  │  HERO CARD (.glass)                              │  │  HERO VISUAL                            │ │
   │  │  ──────────────────                              │  │  ────────────                           │ │
   │  │  ▌eyebrow (cyan, caption):                       │  │  ┌──────────────────────────────────┐  │ │
   │  │  ▌  "The operating system for private tutors"   │  │  │  Dashboard mockup (auto-cycle    │  │ │
   │  │                                                  │  │  │  OR static screenshot)           │  │ │
   │  │  H1 (display, --text-primary):                  │  │  │                                  │  │ │
   │  │  "Five screens. Seven engines.                  │  │  │  ┌─ KPI cards (.glass + accent)─┐ │  │ │
   │  │   One ledger."                                  │  │  │  │ ▌₹2,45,500  ▌₹48,000  ▌92% │ │  │ │
   │  │                                                  │  │  │  └──────────────────────────────┘ │  │ │
   │  │  Subhead (h3, --text-secondary):                │  │  │  ┌─ Heatmap (.glass card) ──────┐ │  │ │
   │  │  "Run your tuition business from five          │  │  │  │ ██░██▓░░██  (flat bg-white/  │ │  │ │
   │  │   screens. Offline-first. India-first.         │  │  │  │              [0.04] cells)   │ │  │ │
   │  │   ₹0 to start."                                 │  │  │  └──────────────────────────────┘ │  │ │
   │  │                                                  │  │  │  ┌─ Activity feed (.glass) ────┐ │  │ │
   │  │  ┌────────────────────┐ ┌──────────────────┐   │  │  │  │ ● Payment ₹4,500            │ │  │ │
   │  │  │ [+] Start free —   │ │ ▶ Watch the 90s  │   │  │  │  │ ● Aarav present              │ │  │ │
   │  │  │     no card        │ │   tour           │   │  │  │  └──────────────────────────────┘ │  │ │
   │  │  └────────────────────┘ └──────────────────┘   │  │  │                                  │  │ │
   │  │  ↑ .neumo-raised           ↑ .neumo-raised     │  │  │  CSS keyframes only — zero JS    │  │ │
   │  │    + emerald glow           (no glow, cyan      │  │  │  (P7 — motion is meaning)        │  │ │
   │  │    + .cta-shimmer           hover)              │  │  │                                  │  │ │
   │  │    (emerald sweep on                           │  │  │  ↑ LCP element = the H1 text,    │  │ │
   │  │     hover, 0.7 s ease,                          │  │  │    NOT the visual (the visual    │  │ │
   │  │     prefers-reduced-motion                      │  │  │    hydrates after first paint)   │  │ │
   │  │     → instant or omitted)                       │  │  └──────────────────────────────────┘  │ │
   │  │                                                  │  │                                        │ │
   │  │  ┌─ Platform badge island (Client) ──────────┐  │  │                                        │ │
   │  │  │ ● Available for Mac · Download 14 MB     │  │  │                                        │ │
   │  │  └────────────────────────────────────────────┘  │  │                                        │ │
   │  │  ↑ emerald pill (.glass-accent-emerald §5.4)    │  │                                        │ │
   │  │    + 2px emerald L-border + inner glow           │  │                                        │ │
   │  │    + deferred-state pattern (§4.2) — starts      │  │                                        │ │
   │  │      "web", updates to "macos" on mount          │  │                                        │ │
   │  │                                                  │  │                                        │ │
   │  │  Trust line (small, --text-muted):               │  │                                        │ │
   │  │  "Join 1,000+ tutors across India"               │  │                                        │ │
   │  │  ↑ verified aggregate (P15 honesty); NOT a       │  │                                        │ │
   │  │    fake number — codegen swaps in the real       │  │                                        │ │
   │  │    count from a daily Turso aggregate query      │  │                                        │ │
   │  └─────────────────────────────────────────────────┘  └────────────────────────────────────────┘ │
   │                                                                                                  │
   │  ┌─ 1st scroll-fold teaser (top of Features section, partially visible) ─────────────────────┐  │
   │  │  "Five screens. Seven engines." (h2, --text-primary, centered)                              │  │
   │  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘

   ── LCP path (the bytes that cross the wire before first paint) ──────────────────────────────────────
     1. HTML (RSC stream, ~12 KB) — contains H1 + subhead + CTAs + trust line as server-rendered text
     2. CSS (Tailwind purged, ~22 KB) — .glass, .neumo-raised, .cta-shimmer classes inlined
     3. Fonts (Inter 400/600, ~38 KB) — display: swap, Latin subset
     4. Hero visual (if static): next/image AVIF/WebP, ~45 KB, priority + blur placeholder
     5. Hero visual (if animated): CSS keyframes only — zero JS; the mockup is HTML+CSS
     ↑ total first-paint JS: ~45 KB (React+Next) + ~3 KB (Framer variants) + ~2 KB (Analytics) = ~50 KB
     ↑ well under the 90 KB marketing budget (§9 of 01_Architecture.md)
     ↑ LCP element = the H1 text "Five screens. Seven engines. One ledger." (server-rendered, no client JS)

   ── Hydration sequence (after first paint) ───────────────────────────────────────────────────────────
     t = 0 ms     : HTML streams; cosmic canvas + nav + hero card paint (LCP)
     t = 50 ms    : CSS parses; .glass + .neumo-raised styles apply
     t = 80 ms    : Fonts swap (Inter 400 → display)
     t = 120 ms   : Hero visual hydrates (if animated: CSS keyframes start; if static: image decodes)
     t = 180 ms   : Platform badge island mounts → navigator.userAgent → updates "web" to "macos"
     t = 200 ms   : CTAs interactive (.cta-shimmer sweep available on hover)
     ↑ the user can click "Start free — no card" at t = 200 ms (sub-300 ms TTI)
```

The hero composition shows the two-column layout: the hero card (`.glass`, left) carries the eyebrow + H1 + subhead + two CTAs + platform badge + trust line; the hero visual (right) is the dashboard mockup. The LCP element is the H1 text — server-rendered, no client JS — so first paint is < 200 ms even on 4G. The platform badge island is the only client-side component above the fold; it starts as "web" on the server (deferred-state pattern, §4.2) and updates to "macos"/"windows"/"android"/"ios" on mount, avoiding any hydration mismatch. The `.cta-shimmer` sweep on the primary CTA is the one place ambient motion is permitted on a CTA (P7 carve-out for the marketing surface); it respects `prefers-reduced-motion`.

### 13.3 Mockup M2 — Features Grid (6 Cards, Principle-Coded)

The §5 narrative described the FeaturesShowcase; this mockup shows the **6-card grid** as a tutor scrolls to it, with each card coded by principle family (emerald/cyan/violet accent left-border per §5.4). The point: the grid is 3 columns on `lg+`, 2 on `md`, 1 on `base/sm`; the 6 cards map 1:1 to the 5 product screens + the "Seven engines" summary card.

```
   Features Grid — 6 Cards (desktop ≥ 1024 px, 3-column grid)
   ↑ each card = .glass + 2px accent L-border (§5.4 §5.5); accent = principle family
   ↑ MotionSection (Client island) applies whileInView stagger (0.08 s) — respects prefers-reduced-motion

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  FEATURES SECTION (cosmic canvas, padded py-20)                                                  │
   │                                                                                                  │
   │                          "Five screens. Seven engines." (h1, centered, --text-primary)           │
   │         "Every screen is a window into the same single source of truth — the append-only ledger."│
   │                                       (h3, centered, --text-secondary)                            │
   │                                                                                                  │
   │  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐                       │
   │  │ ▌Screen 1 · Dashboard│  │ ▌Screen 2 · Students │  │ ▌Screen 3 · Attendance│                      │
   │  │ ▌ (emerald L-border) │  │ ▌ (cyan L-border)    │  │ ▌ (amber L-border)   │                      │
   │  │ ▌                    │  │ ▌                    │  │ ▌                    │                      │
   │  │ ▌ [screenshot]       │  │ ▌ [screenshot]       │  │ ▌ [screenshot]       │                      │
   │  │ ▌  (next/image,      │  │ ▌  (next/image,      │  │ ▌  (next/image,      │                      │
   │  │ ▌   blur, sizes)     │  │ ▌   blur, sizes)     │  │ ▌   blur, sizes)     │                      │
   │  │ ▌                    │  │ ▌                    │  │ ▌                    │                      │
   │  │ ▌ ✓ KPI figures      │  │ ▌ ✓ Master list +    │  │ ▌ ✓ Batch grid +     │                      │
   │  │ ▌   server-rendered  │  │ ▌   detail drawer    │  │ ▌   3-state toggle   │                      │
   │  │ ▌ ✓ Heatmap + feed   │  │ ▌ ✓ Merge duplicates │  │ ▌ ✓ Lock + PIN gate  │                      │
   │  │ ▌ ✓ Quick actions    │  │ ▌ ✓ Fee profile      │  │ ▌ ✓ 48h hard-lock    │                      │
   │  │ ▌                    │  │ ▌                    │  │ ▌                    │                      │
   │  │ ▌ See it live →      │  │ ▌ See it live →      │  │ ▌ See it live →      │                      │
   │  │ ▌ (ghost link, cyan) │  │ ▌ (ghost link, cyan) │  │ ▌ (ghost link, cyan) │                      │
   │  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘                       │
   │   ↑ .glass + 2px emerald    ↑ .glass + 2px cyan     ↑ .glass + 2px amber                          │
   │   ↑ p-6, rounded-2xl        ↑ p-6, rounded-2xl      ↑ p-6, rounded-2xl                           │
   │   ↑ hover: -translate-y-1   ↑ hover: -translate-y-1 ↑ hover: -translate-y-1                      │
   │   ↑ 60ms transition         ↑ 60ms transition       ↑ 60ms transition                            │
   │                                                                                                  │
   │  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐                       │
   │  │ ▌Screen 4 · Fees     │  │ ▌Screen 5 · Settings │  │ ▌Seven Hidden Engines│                      │
   │  │ ▌ (flare L-border)   │  │ ▌ (violet L-border)  │  │ ▌ (emerald L-border) │                      │
   │  │ ▌                    │  │ ▌                    │  │ ▌                    │                      │
   │  │ ▌ [screenshot]       │  │ ▌ [screenshot]       │  │ ▌ [engine grid]      │                      │
   │  │ ▌                    │  │ ▌                    │  │ ▌                    │                      │
   │  │ ▌ ✓ Paid/Unpaid/     │  │ ▌ ✓ PIN + biometric  │  │ ▌ ✓ Search (FTS5)    │                      │
   │  │ ▌   Partial matrix   │  │ ▌ ✓ Backup passphrase│  │ ▌ ✓ Reminder engine  │                      │
   │  │ ▌ ✓ Receipt PDF +    │  │ ▌ ✓ Restore flow     │  │ ▌ ✓ Report engine    │                      │
   │  │ ▌   tamper hash      │  │ ▌ ✓ Audit log        │  │ ▌ ✓ Notification     │                      │
   │  │ ▌ ✓ Void w/ PIN      │  │ ▌ ✓ Import/export    │  │ ▌ ✓ Sync (outbox)    │                      │
   │  │ ▌                    │  │ ▌                    │  │ ▌ ✓ Security engine  │                      │
   │  │ ▌ See it live →      │  │ ▌ See it live →      │  │ ▌ See it live →      │                      │
   │  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘                       │
   │   ↑ .glass + 2px flare      ↑ .glass + 2px violet   ↑ .glass + 2px emerald                        │
   │                                                                                                  │
   │  ── Engine chips row (below the 6 cards) ──────────────────────────────────────────────────────  │
   │  ╭──────────╮ ╭──────────╮ ╭──────────╮ ╭──────────╮ ╭──────────╮ ╭──────────╮ ╭──────────╮    │
   │  │ 🔍 Search│ │ ⏰ Remind│ │ ₹ Ledger │ │ 📊 Report│ │ 🔔 Notify │ │ ⟳ Sync   │ │ 🔒 Secure│    │
   │  ╰──────────╯ ╰──────────╯ ╰──────────╯ ╰──────────╯ ╰──────────╯ ╰──────────╯ ╰──────────╯    │
   │   ↑ flat tinted chips (§2.3) — NOT glass, NOT neumo (inline labels, not surfaces or controls)    │
   │                                                                                                  │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘

   ── Principle → accent mapping (§5.4) ─────────────────────────────────────────────────────────────────
     Dashboard  (emerald)  : the "one-glance truth" principle — money in, money out, who's here
     Students   (cyan)     : the "lifecycle + ledger" principle — every student is a ledger entry
     Attendance (amber)    : the "mark, lock, audit" principle — attendance is immutable history
     Fees       (flare)    : the "money truth" principle — the ledger is the spine of trust
     Settings   (violet)   : the "configure + protect" principle — security is a first-class surface
     Engines    (emerald)  : the "five screens, seven engines" claim — the hidden depth

   ── Responsive breakpoints (§14) ──────────────────────────────────────────────────────────────────────
     base / sm (< 640 px)   : 1 column — cards stack, full-width
     md (≥ 768 px)          : 2 columns — 3 rows of 2
     lg / xl / 2xl (≥ 1024) : 3 columns — 2 rows of 3 (the layout above)
     ↑ the MotionSection stagger (0.08 s) applies only to the first 4 entering siblings (§17 rule 12)
```

The grid shows the 6 feature cards, each with a 2px accent left-border colour-coded by principle family (emerald/cyan/amber/flare/violet per §5.4). The 6th card ("Seven Hidden Engines") is the marketing claim "Five screens. Seven engines." made literal — it surfaces the 7 hidden engines as chips below the grid. Each card carries a screenshot (`next/image` with `blur` + `sizes`), 3 benefit bullets with emerald checkmarks, and a "See it live →" ghost link to `/demo/{screen}`. The MotionSection Client island applies a `whileInView` stagger (0.08 s) — but only to the first 4 entering siblings (§17 rule 12); the rest render instantly. The grid collapses to 2 columns on `md` and 1 column on `base/sm`.

### 13.4 Mockup M3 — Download Hub (5 Cards, PlatformDetector-Annotated)

The §6 narrative described the DownloadHub; this mockup shows the **5-card layout** as a tutor scrolls to it, with the PlatformDetector island highlighting the user's native platform with an emerald glow + "Recommended for your device" caption. The point: the Web card is the visually dominant one (spans 2 columns on `md+`, primary emerald styling); the 4 native cards are secondary (cyan-tinted, equal-width in a 2×2 grid below).

```
   Download Hub — 5 Cards (desktop ≥ 1024 px)
   ↑ Web card = primary (spans 2 cols, emerald glow); 4 native cards = secondary (2×2 grid, cyan)
   ↑ PlatformDetector island highlights the user's native card with .glass-strong + emerald glow (§5.4)

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  DOWNLOAD HUB SECTION (cosmic canvas, padded py-20)                                              │
   │                                                                                                  │
   │                    "Download Buddysaradhi" (h1, centered, --text-primary)                              │
   │             "Version 1.4.0 · released 27 June 2025" (caption, --text-muted, en-IN date)          │
   │   ↑ version + date are <Suspense> holes — stream in from /api/releases/latest (ISR 1 h)          │
   │                                                                                                  │
   │  ┌──────────────────────────────────────────────────────────┐  ┌──────────────────────────────┐  │
   │  │  WEB CARD (PRIMARY — spans 2 cols on md+)                 │  │  macOS CARD                  │  │
   │  │  ──────────────────────────────────────────                │  │  ────────────                │  │
   │  │  ▌ [Web icon]                                              │  │  │ ▌ [Apple icon]               │  │
   │  │  ▌                                                         │  │  │ ▌                            │  │
   │  │  ▌ "Open web version"                                      │  │  │ ▌ "Download .dmg"             │  │
   │  │  ▌                                                         │  │  │ ▌                            │  │
   │  │  ▌ "No install. Works in any modern browser."             │  │  │ ▌ "For macOS 11.0+"          │  │
   │  │  ▌                                                         │  │  │ ▌                            │  │
   │  │  ▌ ✓ Auto-sync across devices                             │  │  │ ▌ 14.2 MB · v1.4.0           │  │
   │  │  ▌ ✓ Offline-capable (PWA)                                │  │  │ ▌                            │  │
   │  │  ▌ ✓ ₹0 to start                                          │  │  │ ▌ [Show SHA-256 ▼]           │  │
   │  │  ▌                                                         │  │  │ ▌ [How to install ▼]         │  │
   │  │  ▌ ┌────────────────────────────────────────┐             │  │  │ ▌                            │  │
   │  │  │ [▶] Open web version                     │             │  │  │ ▌ ┌──────────────────────┐   │  │
   │  │  └────────────────────────────────────────┘             │  │  │ ▌ │ [↓] Download .dmg    │   │  │
   │  │  ↑ .neumo-raised + emerald glow (primary CTA)            │  │  │ ▌ └──────────────────────┘   │  │
   │  │  ↑ .cta-shimmer sweep on hover                            │  │  │ ▌ ↑ .neumo-raised + cyan     │  │
   │  │  ↑ links to /login (or /dashboard if logged in)           │  │  │ ▌   glow (secondary CTA)     │  │
   │  │                                                            │  │  │ ▌ ↑ links to manifest.       │  │
   │  │                                                            │  │  │ ▌   platforms.macos.url      │  │
   │  └──────────────────────────────────────────────────────────┘  └──────────────────────────────┘  │
   │   ↑ .glass + emerald glow                                       ↑ .glass (or .glass-strong +    │
   │   ↑ 2 cols on md+, full-width on base/sm                          emerald glow IF detected)      │
   │                                                                                                  │
   │  ┌──────────────────────────────┐  ┌──────────────────────────────┐                                │
   │  │  Windows CARD                 │  │  Android CARD                 │                                │
   │  │  ────────────                 │  │  ────────────                 │                                │
   │  │ ▌ [Windows icon]              │  │ ▌ [Android icon]              │                                │
   │  │ ▌                             │  │ ▌                             │                                │
   │  │ ▌ "Download .msi"             │  │ ▌ "Download .apk"             │                                │
   │  │ ▌                             │  │ ▌                             │                                │
   │  │ ▌ "For Windows 10+ (x64)"    │  │ ▌ "For Android 8.0+ (Oreo)"   │                                │
   │  │ ▌                             │  │ ▌                             │                                │
   │  │ ▌ 11.8 MB · v1.4.0           │  │ ▌ 28.0 MB · v1.4.0            │                                │
   │  │ ▌                             │  │ ▌                             │                                │
   │  │ ▌ [Show SHA-256 ▼]           │  │ ▌ ┌─────────────────┐         │                                │
   │  │ ▌ [How to install ▼]         │  │ ▌ │ [▣] QR code     │         │                                │
   │  │ ▌                             │  │ ▌ └─────────────────┘         │                                │
   │  │ ▌ ┌──────────────────────┐   │  │ ▌ ↑ QRCodeCard Client island │                                │
   │  │ │ [↓] Download .msi     │   │  │ ▌   (qrcode.react, lazy)     │                                │
   │  │ └──────────────────────┘   │  │ ▌                             │                                │
   │  │ ▌ ↑ .neumo-raised + cyan   │  │ ▌ ┌──────────────────────┐    │                                │
   │  │    glow (secondary CTA)    │  │ ▌ │ [↓] Download .apk    │    │                                │
   │  └──────────────────────────────┘  │ └──────────────────────┘    │                                │
   │                                     │ ↑ .neumo-raised + amber    │                                │
   │                                     │   glow (Android = amber)   │                                │
   │                                     └──────────────────────────────┘                                │
   │                                                                                                  │
   │  ┌──────────────────────────────┐  ┌──────────────────────────────────────────────────────────┐  │
   │  │  iOS CARD (TestFlight)        │  │  "What's New" section (.glass-faint band)                 │  │
   │  │  ────────────                 │  │  ───────────────────────────────────────────────────────── │  │
   │  │ ▌ [Apple icon]                │  │  ### Added                                                │  │
   │  │ ▌                             │  │  - WhatsApp deep-link reminder cards on Dashboard.        │  │
   │  │ ▌ "Join TestFlight"           │  │                                                            │  │
   │  │ ▌                             │  │  ### Fixed                                                │  │
   │  │ ▌ "For iOS 16.0+"             │  │  - Receipt PDF font rendering on Windows.                 │  │
   │  │ ▌                             │  │                                                            │  │
   │  │ ▌ (no size — TestFlight)      │  │  ↑ renders manifest.notesExcerpt (first 500 chars)        │  │
   │  │ ▌                             │  │  ↑ .glass-faint band (recedes; the excerpt is the content)│  │
   │  │ ▌ ┌──────────────────────┐   │  │  ↑ "View full changelog →" ghost link to /changelog/1.4.0 │  │
   │  │ │ [▶] Join TestFlight    │   │  └──────────────────────────────────────────────────────────┘  │
   │  │ └──────────────────────┘   │                                                                  │
   │  │ ▌ ↑ .neumo-raised + amber   │                                                                  │
   │  │    glow (iOS = amber)       │                                                                  │
   │  │ ▌ ↑ links to manifest.       │                                                                  │
   │  │    platforms.ios.            │                                                                  │
   │  │    testFlightUrl             │                                                                  │
   │  └──────────────────────────────┘                                                                  │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘

   ── PlatformDetector island (Client, mounts after hydration) ──────────────────────────────────────────
     reads navigator.userAgent + navigator.platform → highlights the matching card:
       macos    → macOS card gets .glass-strong + 2px emerald L-border + inner glow (§5.4)
       windows  → Windows card gets the same treatment
       android  → Android card gets .glass-strong + 2px amber L-border (Android = amber per §2.4)
       ios      → iOS card gets .glass-strong + 2px amber L-border
       web      → no card highlighted; the Web card remains the visually dominant one (always primary)
     ↑ a "Recommended for your device" caption appears above the highlighted card (cyan, caption size)

   ── Responsive layout ─────────────────────────────────────────────────────────────────────────────────
     base / sm (< 640 px)   : 1 column — all 5 cards stack, Web card first
     md (≥ 768 px)          : Web card spans 2 cols (top-left); 4 native cards in 2×2 grid (top-right + bottom)
     lg / xl / 2xl (≥ 1024) : same as md, wider gutters
```

The Download Hub shows the 5-card layout: the Web card is primary (spans 2 columns on `md+`, emerald glow, `.cta-shimmer`); the 4 native cards (macOS, Windows, Android, iOS) are secondary (cyan glow, 2×2 grid). The Android and iOS cards include a QRCodeCard (Client island, `qrcode.react` lazy-loaded). The iOS card links to TestFlight (no direct download). The PlatformDetector island runs on mount and highlights the user's native platform card with `.glass-strong` + an accent left-border + inner glow (§5.4) + a "Recommended for your device" caption. The "What's New" section below renders `manifest.notesExcerpt` in a `.glass-faint` band. The version number ("v1.4.0") and release date ("27 June 2025") are `<Suspense>` holes that stream in from `/api/releases/latest` (ISR 1 h) — the rest of the page is statically prerendered.

### 13.5 Mockup M4 — FAQ Accordion (with Search Island)

The §7 narrative described the FAQ section; this mockup shows the **accordion + search** composition as a tutor scrolls to it. The point: the search bar is `.neumo-inset`; the accordion rows are `.glass-faint` bands (recede); the "Top 5 questions" surface sits above the full accordion; the JSON-LD `FAQPage` payload is injected via `next/script` (no visual).

```
   FAQ Section — Accordion + Search (desktop ≥ 1024 px, max-w-3xl centered)
   ↑ FAQSearch = .neumo-inset (control, §6.6); FAQAccordion rows = .glass-faint band (surface, §5.5)

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  FAQ SECTION (cosmic canvas, padded py-20, max-w-3xl centered)                                   │
   │                                                                                                  │
   │                            "Questions, answered" (h1, centered, --text-primary)                  │
   │                                                                                                  │
   │  ┌─ FAQSearch (.neumo-inset) ───────────────────────────────────────────────────────────────┐    │
   │  │ 🔍  Search the FAQ…                                                                      │    │
   │  └────────────────────────────────────────────────────────────────────────────────────────────┘    │
   │   ↑ .neumo-inset (control, §6.6 §8.10)                                                            │
   │   ↑ focus → cyan inset ring + glow + 60ms widening on md+                                         │
   │   ↑ fuse.js fuzzy filter (threshold tuned for partial matches on the question text)               │
   │   ↑ empty state: "No matches — email hello@buddysaradhi.app" (honest empty state, §1.3 P15)            │
   │                                                                                                  │
   │  ── "Top 5 questions" surface (ranked by real faq_expand events, weekly codegen) ──────────────  │
   │  "Top 5 questions" (caption, cyan, --text-secondary)                                              │
   │                                                                                                  │
   │  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
   │  │ ▌ ▶ Is Buddysaradhi really free?                                            (.glass-faint)    │  │
   │  │ ▌                                                                        band, row 1)    │  │
   │  │ ▌                                                                        ↑ 2px cyan L-    │  │
   │  │ ▌                                                                        border (active)  │  │
   │  │ ├──────────────────────────────────────────────────────────────────────────────────────────┤  │
   │  │ ▌ ▶ Does it work offline?                                              (.glass-faint)    │  │
   │  │ ▌                                                                        band, row 2)    │  │
   │  │ ├──────────────────────────────────────────────────────────────────────────────────────────┤  │
   │  │ ▌ ▼ Can I use it on my phone and laptop?                              (.glass-faint,    │  │
   │  │ ▌                                                                        EXPANDED)        │  │
   │  │ ▌   Yes. Buddysaradhi syncs across web, mobile, and desktop via a per-user                    │  │
   │  │ ▌   Turso DB. Your data lives in your DB; the apps are windows into it.                  │  │
   │  │ ▌   The web app polls every 30 seconds; mobile + desktop use embedded                    │  │
   │  │ ▌   replicas for instant offline access. (BR-SYN-01.)                                    │  │
   │  │ ▌   ↗ "Read more about sync" (ghost link, cyan, to /faq#sync)                           │  │
   │  │ ├──────────────────────────────────────────────────────────────────────────────────────────┤  │
   │  │ ▌ ▶ Is my data safe?                                                   (.glass-faint)    │  │
   │  │ ▌                                                                        band, row 4)    │  │
   │  │ ├──────────────────────────────────────────────────────────────────────────────────────────────────│
   │  │ ▌ ▶ What if I forget my PIN?                                           (.glass-faint)    │  │
   │  │ ▌                                                                        band, row 5)    │  │
   │  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
   │   ↑ FAQAccordion (Client, Radix, single-open mode, keyboard-navigable)                            │
   │   ↑ ▶ = collapsed; ▼ = expanded (only one expanded at a time)                                      │
   │   ↑ Tab to focus, Enter/Space to toggle, Arrow keys to navigate                                    │
   │   ↑ respects prefers-reduced-motion (no slide animation if set)                                    │
   │                                                                                                  │
   │  ── "All questions, by category" surface (full accordion, grouped) ─────────────────────────────  │
   │  "All questions, by category" (caption, cyan, --text-secondary)                                   │
   │                                                                                                  │
   │  Getting Started (h3, --text-primary)                                                             │
   │  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
   │  │ ▌ ▶ How do I add my first student?                                      (.glass-faint)    │  │
   │  │ ▌ ▶ Can I import from Excel?                                            (rows…)            │  │
   │  │ ▌ ▶ What's the difference between a batch and a student?                                  │  │
   │  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
   │                                                                                                  │
   │  Pricing (h3, --text-primary)                                                                    │
   │  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
   │  │ ▌ ▶ Is the free tier really free forever?                              (.glass-faint)    │  │
   │  │ ▌ ▶ What's included in the Free plan (₹0/mo, up to 250 students)?     (rows…)         │  │
   │  │ ▌ ▶ Can I pay annually?                                                                   │  │
   │  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
   │                                                                                                  │
   │  Data & Sync · Privacy & Security · Offline · Backup · Mobile/Desktop (h3 each)                  │
   │  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
   │  │ ▌ ▶ …                                                                   (49 questions      │  │
   │  │ ▌ ▶ …                                                                    total, sourced     │  │
   │  │ ▌ ▶ …                                                                    from product/      │  │
   │  │ ▌ ▶ …                                                                    06_FAQ.md)         │  │
   │  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
   │                                                                                                  │
   │  ── JSON-LD FAQPage payload (invisible — next/script, afterInteractive) ──────────────────────  │
   │  <script type="application/ld+json">                                                             │
   │  { "@context": "https://schema.org", "@type": "FAQPage",                                          │
   │    "mainEntity": [ { "@type": "Question", "name": "...", "acceptedAnswer": { "@type": "Answer",  │
   │      "text": "..." } }, ... 49 questions ... ] }                                                  │
   │  </script>                                                                                       │
   │  ↑ this is what makes Google render rich FAQ snippets in search results                           │
   │                                                                                                  │
   │  ── "Read more" footer link ───────────────────────────────────────────────────────────────────  │
   │  "Read more" (ghost link, cyan, --text-secondary) → /faq                                          │
   │  ↑ cta_faq_bottom_click event fired (Vercel Web Analytics, TELE-1 compatible)                    │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘

   ── Accordion row state matrix (per §8.4 list-row states) ─────────────────────────────────────────────
     DEFAULT     : .glass-faint band, --text-secondary on the question, ▶ icon
     HOVER       : bg-white/5 overlay, --text-primary on the question, ▶ icon brightens
     FOCUS       : cyan 2px ring (keyboard parity, §10.3), --text-primary
     ACTIVE/OPEN : .glass-faint band + 2px cyan L-border (§5.4), --text-primary, ▼ icon
                  + the answer body renders below the question (--text-secondary, body-md)
     PRESSED     : row-press motion (60ms scale 0.99)
   ↑ the row is a SURFACE (.glass-faint), not a control — the toggle is the Radix Accordion trigger
     inside the row, which is a button (visually invisible; the whole row is clickable)
```

The FAQ section shows the search bar (`.neumo-inset`) at the top, the "Top 5 questions" surface (ranked by real `faq_expand` events) below it, then the full accordion grouped by category (Getting Started, Pricing, Data & Sync, Privacy & Security, Offline, Backup, Mobile/Desktop — 49 questions total, sourced from `product/06_FAQ.md`). The accordion rows are `.glass-faint` bands that recede so the question text reads; the active/expanded row gets a 2px cyan left-border (§5.4). The JSON-LD `FAQPage` payload is injected via `next/script` with `strategy="afterInteractive"` — invisible to the user, but it's what makes Google render rich FAQ snippets in search results. The state matrix at the bottom shows the 5 row states (DEFAULT/HOVER/FOCUS/ACTIVE/PRESSED) — the row is a surface (`.glass-faint`), not a control; the toggle is a Radix Accordion trigger button inside the row.

### 13.6 Mockup M5 — CTA Stack (Final CTA + Pricing CTAs + Footer CTA)

The §8 narrative listed the 7 CTAs; this mockup shows the **CTA stack** as a tutor scrolls from the Pricing section through the Final CTA into the Footer. The point: every CTA is `.neumo-raised`; the primary CTAs carry emerald glow + `.cta-shimmer`; the secondary CTAs carry cyan glow; the destructive/tertiary CTAs (none on the landing) would carry flare/violet. The CTAs are instrumented with `data-cta-id` for Vercel Web Analytics.

```
   CTA Stack — Pricing → Final CTA → Footer (desktop ≥ 1024 px)
   ↑ every CTA = .neumo-raised (§6.6 §8.2); primary = emerald glow + .cta-shimmer; secondary = cyan glow
   ↑ every CTA carries data-cta-id for Vercel Web Analytics track() (TELE-1 compatible)

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  PRICING SECTION (v1: 1 card — single Free card, .glass-strong + emerald glow)                   │
   │  ↑ when NEXT_PUBLIC_PAID_TIERS_LIVE=false (default v1): exactly 1 card renders (Free)            │
   │  ↑ when NEXT_PUBLIC_PAID_TIERS_LIVE=true (post-§1.6-trigger): 3 cards render (Appendix A)        │
   │  ↑ no billing toggle, no payment-method icon row, no Pro/Institute cards in v1                   │
   │                                                                                                  │
   │                          ┌────────────────────────────────┐                                    │
   │                          │ ▌FREE              ✅ LIVE     │                                    │
   │                          │ ▌(.glass-strong + emerald glow)│                                    │
   │                          │ ▌                               │                                    │
   │                          │ ▌ ₹0                            │                                    │
   │                          │ ▌ /mo, for everyone —           │                                    │
   │                          │ ▌  while our infra stays free   │                                    │
   │                          │ ▌                               │                                    │
   │                          │ ▌ For every Indian private      │                                    │
   │                          │ ▌  tutor. Every feature.        │                                    │
   │                          │ ▌  No card. No caps. No ads.    │                                    │
   │                          │ ▌                               │                                    │
   │                          │ ▌ ✓ All 5 screens               │                                    │
   │                          │ ▌ ✓ Attendance + fees + receipts│                                    │
   │                          │ ▌ ✓ Encrypted backup export     │                                    │
   │                          │ ▌ ✓ Cross-device sync           │                                    │
   │                          │ ▌ ✓ Biometric login             │                                    │
   │                          │ ▌                               │                                    │
   │                          │ ▌ ┌──────────────────────────┐  │                                    │
   │                          │ ▌ │ [▶] Start free →         │  │                                    │
   │                          │ ▌ └──────────────────────────┘  │                                    │
   │                          │ ▌ ↑ .neumo-raised + emerald     │                                    │
   │                          │ ▌   glow + .cta-shimmer sweep   │                                    │
   │                          │ ▌ ↑ data-cta-id=cta_pricing_click│                                   │
   │                          │ ▌ ↑ href=/signup?plan=free      │                                    │
   │                          │ ▌                               │                                    │
   │                          │ ▌ No card required              │                                    │
   │                          └────────────────────────────────┘                                    │
   │                           ↑ .glass-strong (8% white, 24px blur) + 2px emerald border            │
   │                           ↑ + inner emerald glow @ 15% opacity (§5.4)                            │
   │                           ↑ Card centred on canvas: max-width 480px, margin 0 auto               │
   │                                                                                                  │
   │  ┌─ Public commitment block (.glass-faint band) ─────────────────────────────────────────────┐   │
   │  │  Free for everyone, for now. Free while our backend infra (Vercel,        │   │
   │  │   Turso, Vercel Blob) stays inside its free bands. When that changes, we'll give 60       │   │
   │  │   days' notice before launching paid tiers. No ads, ever. No card required.               │   │
   │  │   See §1.6 for the full contract.   ↑ per product/05_Pricing_and_Plans.md §1.3 / §3.3     │   │
   │  └────────────────────────────────────────────────────────────────────────────────────────────┘   │
   │                                                                                                  │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                                │
                                                                ▼  (scroll)
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  FINAL CTA SECTION (.glass-strong + emerald inner glow, full-width)                              │
   │                                                                                                  │
   │                          "Start free — no card, no lock-in." (h1, centered)                      │
   │         "Join 1,000+ tutors across India. ₹0 to start; upgrade when you're ready."               │
   │                                       (h3, centered, --text-secondary)                            │
   │                                                                                                  │
   │                            ┌────────────────────────────────────────┐                            │
   │                            │ [▶] Get started                        │                            │
   │                            └────────────────────────────────────────┘                            │
   │                             ↑ .neumo-raised + emerald glow + .cta-shimmer                         │
   │                             ↑ full-width on mobile, auto-width on md+                             │
   │                             ↑ data-cta-id=cta_final_cta_click                                     │
   │                             ↑ href=/signup                                                         │
   │                                                                                                  │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                                │
                                                                ▼  (scroll)
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  FOOTER (.glass-faint, sticky per §13)                                                           │
   │                                                                                                  │
   │  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
   │  │  Buddysaradhi                                  │  Product  │  Resources  │  Company  │  Legal    │  │
   │  │  Five screens.                            │  Features │  Docs       │  About    │  Terms    │  │
   │  │  Seven engines.                           │  Download │  Changelog  │  Blog     │  Privacy  │  │
   │  │  One ledger.                              │  Pricing  │  Status     │  Contact  │  Refund   │  │
   │  │                                           │  FAQ      │             │           │  Policy   │  │
   │  │  Made in India 🇮🇳                        │           │             │           │           │  │
   │  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
   │  ─────────────────────────────────────────────────────────────────────────────────────────────   │
   │  ┌─ Newsletter signup ───────────────────────────────────────────────────────────────────────┐  │
   │  │  "Get product updates (1 email/month, no spam)"  (caption, --text-muted)                  │  │
   │  │  ┌─────────────────────────────────┐  ┌──────────────────────┐                              │  │
   │  │  │  your@email.com                 │  │ [✉] Subscribe        │                              │  │
   │  │  └─────────────────────────────────┘  └──────────────────────┘                              │  │
   │  │  ↑ .neumo-inset (input well)         ↑ .neumo-raised + violet glow                         │  │
   │  │    focus → cyan inset ring            ↑ data-cta-id=cta_footer_click (footer CTA)           │  │
   │  │    Zod email parse + list-bombing     ↑ Server Action: subscribeToNewsletter(email)         │  │
   │  │    defence (5/hr per IP)                → INSERT newsletter_subscribers in platform Turso   │  │
   │  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
   │  ─────────────────────────────────────────────────────────────────────────────────────────────   │
   │  © 2025 Buddysaradhi · Status: operational · @buddysaradhi · YouTube · LinkedIn                            │
   │  ↑ .footer-top-glow class — 1px linear-gradient emerald → cyan glow on the top border            │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘

   ── CTA inventory (7 total, all .neumo-raised, all instrumented) ──────────────────────────────────────
     #  CTA                          Location       data-cta-id                Accent
     1  "Start free — no card"       Hero           cta_hero_click             emerald + shimmer
     2  "See it live"                Each Feature   cta_features_click         cyan (ghost link)
     3  "Open web" / "Download"      Download Hub   cta_download_click         emerald (Web) / cyan (native)
     4  "Start free"                 Pricing        cta_pricing_click          emerald (featured) / cyan (others)
     5  "Read more"                  FAQ bottom     cta_faq_bottom_click       cyan (ghost link)
     6  "Get started"                Final CTA      cta_final_cta_click        emerald + shimmer (full-width)
     7  "Sign up" / "Subscribe"      Footer         cta_footer_click           violet (newsletter)

   ── Accent logic (§2.4) ───────────────────────────────────────────────────────────────────────────────
     emerald  : the "do the thing" accent — Start free, Open web, Download, Get started
     cyan     : the info/exploration accent — See it live, Read more, secondary pricing CTAs
     amber    : partial-state CTAs (none on the landing — reserved for Partial receipts in-app)
     flare    : destructive CTAs (none on the landing — reserved for Void / Delete in-app)
     violet   : tertiary CTA — newsletter signup (footer only)
```

The CTA stack shows the three CTA-dense sections: Pricing (v1: single Free card = `.glass-strong` + emerald glow + 2px emerald border + inner emerald glow @ 15% opacity; no billing toggle, no payment-method icon row, no Pro/Institute cards — those render post-§1.6-trigger per Appendix A), Final CTA (`.glass-strong` + emerald inner glow, full-width "Get started" button), and Footer (`.glass-faint` sticky, newsletter signup with `.neumo-inset` input + `.neumo-raised` violet Subscribe button). The CTA inventory at the bottom lists all 7 CTAs with their `data-cta-id` and accent — every CTA is `.neumo-raised`; the accent follows §2.4 (emerald for "do the thing", cyan for "explore", violet for tertiary newsletter). The `.cta-shimmer` sweep is applied only to the two emerald primary CTAs (Hero + Final CTA) — the marketing-surface carve-out from P7.

### 13.7 Mockup M6 — Footer Composition (4 Columns + Newsletter + Status Line)

The §11 narrative described the footer; this mockup shows the **full footer composition** with the 4-column link grid, the "Made in India" line, the newsletter signup island, the status line, and the `.footer-top-glow` border. The point: the footer is `.glass-faint` (recedes), sticky per §13, and carries the only violet CTA on the landing (newsletter Subscribe).

```
   Footer Composition — 4-column link grid + newsletter + status (desktop ≥ 1024 px)
   ↑ .glass-faint (recedes — the footer is navigation, not content); sticky per §13
   ↑ .footer-top-glow class — 1px linear-gradient emerald → cyan glow on the top border

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  FOOTER (.glass-faint, sticky bottom, mt-auto on the marketing layout)                           │
   │  ────────────────  ← .footer-top-glow: 1px linear-gradient emerald → cyan glow                    │
   │                                                                                                  │
   │  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
   │  │  COL 1 (brand)           │  COL 2 (Product)  │  COL 3 (Resources) │  COL 4 (Company) │ COL 5 (Legal) │
   │  │  ──────────────          │  ──────────────   │  ──────────────    │  ──────────────  │ ────────────── │
   │  │  ◈ Buddysaradhi               │  Features         │  Docs              │  About           │ Terms          │
   │  │  Five screens.           │  Download         │  Changelog         │  Blog            │ Privacy        │
   │  │  Seven engines.          │  Pricing          │  Status            │  Contact         │ Refund Policy  │
   │  │  One ledger.             │  FAQ              │                    │                  │                │
   │  │                          │                   │                    │                  │                │
   │  │  Made in India 🇮🇳       │                   │                    │                  │                │
   │  │  ↑ --text-muted, caption │  ↑ --text-        │  ↑ --text-         │  ↑ --text-       │ ↑ --text-      │
   │  │                          │    secondary;     │    secondary;      │    secondary;    │   secondary;   │
   │  │                          │    hover →        │    hover →         │    hover →       │   hover →      │
   │  │                          │    --text-primary │    --text-primary  │    --text-primary│   --text-      │
   │  │                          │    + cyan         │    + cyan          │    + cyan        │   primary      │
   │  │                          │    underline      │    underline       │    underline     │   + cyan       │
   │  │                          │                   │                    │                  │   underline    │
   │  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
   │  ────────────────────────────────────────────────────────────────────────────────────────────    │
   │  ┌─ Newsletter signup island (Client) ───────────────────────────────────────────────────────┐  │
   │  │  "Get product updates (1 email/month, no spam)"  (caption, --text-muted)                  │  │
   │  │                                                                                          │  │
   │  │  ┌─────────────────────────────────┐  ┌──────────────────────┐                              │  │
   │  │  │  ✉  your@email.com              │  │ [✉] Subscribe        │                              │  │
   │  │  └─────────────────────────────────┘  └──────────────────────┘                              │  │
   │  │  ↑ .neumo-inset (input well, §6.6 §8.9)  ↑ .neumo-raised + violet glow (§6.6 §8.2)        │  │
   │  │    focus → cyan inset ring + glow          ↑ data-cta-id=cta_footer_click                   │  │
   │  │    Zod email parse on submit               ↑ Server Action: subscribeToNewsletter(email)   │  │
   │  │    list-bombing defence (5/hr per IP)        → INSERT newsletter_subscribers               │  │
   │  │                                              in platform Turso DB (NOT per-user)            │  │
   │  │    success → emerald toast "Subscribed!"    error (duplicate) → amber toast "Already on    │  │
   │  │    (4s auto-dismiss, .glass-strong +         the list — check your spam" (4s, .glass-      │  │
   │  │    4px emerald bar)                          strong + 4px amber bar)                        │  │
   │  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
   │  ────────────────────────────────────────────────────────────────────────────────────────────    │
   │  © 2025 Buddysaradhi · Status: operational · @buddysaradhi · YouTube · LinkedIn                            │
   │  ↑ --text-muted, caption size, full-width row                                                     │
   │  ↑ "© 2025" = dynamic year (new Date().getFullYear())                                             │
   │  ↑ "Status: operational" = links to https://status.buddysaradhi.app (static site, separate Vercel)    │
   │  ↑ @buddysaradhi / YouTube / LinkedIn = social links (ghost, --text-secondary; hover → --text-primary)│
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘

   ── Sticky behaviour (§13) ───────────────────────────────────────────────────────────────────────────
     The marketing layout uses `min-h-screen flex flex-col` on the root wrapper.
     The footer gets `mt-auto` so it sticks to viewport bottom when content < 100vh.
     When content > 100vh, the footer is pushed down naturally (no overlap, no fixed overlay).
     Mobile: footer respects `env(safe-area-inset-bottom)` via `pb-[env(safe-area-inset-bottom)]`.

   ── Footer-top-glow class ────────────────────────────────────────────────────────────────────────────
     Defined in globals.css (worklog R3-FIX-AND-PLATFORM §4):
       .footer-top-glow {
         position: relative;
       }
       .footer-top-glow::before {
         content: "";
         position: absolute;
         top: 0; left: 0; right: 0;
         height: 1px;
         background: linear-gradient(90deg, transparent, var(--accent-emerald), var(--accent-cyan), transparent);
         opacity: 0.6;
       }
     ↑ the glow is the visual cue that the cosmic canvas continues behind the footer (the .glass-faint
       tier lets the aurora bleed through; the glow on the top border is the seam)
```

The footer composition shows the 5-column link grid (brand + Product + Resources + Company + Legal), the "Made in India 🇮🇳" line under the brand, the newsletter signup island below the grid, and the status/social line at the bottom. The newsletter input is `.neumo-inset` (control); the Subscribe button is `.neumo-raised` + violet glow (the only violet CTA on the landing). The `.footer-top-glow` class is the 1px linear-gradient emerald → cyan glow on the top border — the visual cue that the cosmic canvas continues behind the footer (the `.glass-faint` tier lets the aurora bleed through; the glow is the seam). The sticky behaviour per §13 uses `min-h-screen flex flex-col` + `mt-auto` so the footer sticks to viewport bottom when content < 100vh and is pushed down naturally when content > 100vh.

---

*Landing-page implementation in this file is the contract. When a route, a component, a fetch, or a CTA diverges, the spec wins — unless the spec is wrong, in which case you amend this file first, then the code, then the worklog. The order matters.*
