# 09 — SEO and Analytics

> Search is the **primary acquisition channel** for Buddysaradhi in v1. A tutor in Nagpur googling "tuition management app India" must find Buddysaradhi on page 1; a tutor in Indore googling "best app for coaching class attendance" must find us in the top 3. This file owns the SEO strategy that gets us there — keyword map, on-page optimisation, schema, sitemap, robots, canonicals — and the analytics posture that measures whether it's working. The analytics posture is the strictest in the industry: **only Vercel Web Analytics, aggregate-only, no third-party SDK, no PII**. This is not a marketing choice; it is the law (`10_Security.md §17` TELE-1, `01_Product_Principles.md AP-10`).

---

## 1. The Keyword Strategy

### 1.1 The Three Keyword Tiers

| Tier | Search intent | Example queries | Volume (India, monthly) | Difficulty |
|---|---|---|---|---|
| **Tier-1: High-intent** | "I am looking for this exact product" | "tuition management app India", "coaching class software", "private tutor app", "tuition fees app" | 1,000–10,000 | Medium-High |
| **Tier-2: Problem-aware** | "I have this problem, looking for solutions" | "tuition attendance app", "fees collection app for tutors", "student attendance management India", "coaching institute ERP" | 5,000–20,000 | Medium |
| **Tier-3: Awareness** | "How do I do X?" | "how to track tuition fees", "best app for tuition teachers", "private tutor software free", "tuition register format" | 10,000–50,000 | Low-Medium |

### 1.2 The Tier-1 Keyword Map

Each Tier-1 keyword is mapped to a specific page on the site. The page is optimised for that keyword — title tag, H1, body copy, internal links, schema.

| Keyword | Target page | Title tag |
|---|---|---|
| "tuition management app India" | `/` (homepage) | "Buddysaradhi — Tuition Management App for Indian Tutors & Coaching Institutes" |
| "coaching class software" | `/` (homepage, secondary) | "Buddysaradhi — Coaching Class Software for Small Institutes in India" |
| "private tutor app" | `/` (homepage, tertiary) | "Buddysaradhi — The Private Tutor App: Attendance, Fees, Receipts" |
| "tuition fees app" | `/` (homepage, tertiary) | "Buddysaradhi — Tuition Fees App with Receipts & Ledger" |
| "tuition attendance app" | `/` (homepage, tertiary) | "Buddysaradhi — Tuition Attendance App: 38 Students in 20 Seconds" |

In v1, all five keywords route to the homepage. The homepage is the **primary SEO asset** — it has the most backlinks, the most authority, and the most content. Splitting keywords across subpages (e.g., a `/tuition-fees-app` landing page) is a v1.x optimisation, not a v1 launch priority.

### 1.3 The Tier-2 and Tier-3 Strategy

Tier-2 and Tier-3 keywords are targeted via **content marketing** — blog posts at `/blog/{slug}` (planned v1.x). Each blog post is 1,500–2,500 words, targets one Tier-2 or Tier-3 keyword, and links back to the homepage with the Tier-1 anchor text.

Example blog posts (v1.x roadmap):
- `/blog/how-to-track-tuition-fees-in-excel` (Tier-3, then converts to Buddysaradhi)
- `/blog/best-app-for-tuition-teachers-in-india-2025` (Tier-3, comparison post)
- `/blog/tuition-register-format-cbse` (Tier-3, format template + Buddysaradhi pitch)
- `/blog/fees-collection-app-for-coaching-classes` (Tier-2, product-led)

The blog is **not** part of v1 launch. It launches in v1.1 (3 months post-launch). The homepage carries the SEO load alone for the first 90 days.

### 1.4 The Long-Tail Strategy

Long-tail queries (5+ words, very specific) are captured by the FAQ. Each FAQ Q&A is a long-tail SEO page — the question is the H2, the answer is the body copy, the schema is `FAQPage` (§5.3). Example long-tails captured by the FAQ:
- "is the free tier really free forever" → `06_FAQ.md §6.2` Q1
- "does buddysaradhi work without internet" → `06_FAQ.md §6.4` Q1
- "can i export my data from buddysaradhi" → `06_FAQ.md §6.3` Q5
- "what platforms does buddysaradhi work on" → `06_FAQ.md §6.5` Q1

The FAQ's search-engine visibility is measured monthly: how many long-tail queries land on `/faq#faq-{category}-{n}`. Target: ≥ 200 long-tail queries/month landing on the FAQ by month 6.

---

## 2. On-Page SEO

### 2.1 The Title Tag

The homepage title tag is **60 characters max** (Google truncates at ~60 on mobile, ~70 on desktop):

```html
<title>Buddysaradhi — Tuition Management App for Indian Tutors</title>
```

That's 53 characters. The keyword "tuition management app" is in the first 30 characters (Google weights early-title keywords higher). "Indian Tutors" targets the India-first intent.

The title tag is **not** A/B tested. It is the canonical SEO title. Changing it would reset Google's ranking signals. A/B testing the title tag is a v1.x experiment, after the canonical title has stabilised in the index (typically 90 days post-launch).

### 2.2 The Meta Description

The meta description is **155 characters max** (Google truncates at ~155 on mobile, ~160 on desktop):

```html
<meta name="description" content="Buddysaradhi is the operating system for private tutors and coaching institutes in India. Five screens. Offline-first. Free for everyone, for now — free while our infra stays free. No card required." />
```

That's 158 characters. The description includes: the value prop ("operating system for private tutors and coaching institutes"), the geography ("India"), the architecture ("Five screens. Offline-first."), the price ("Free for everyone, for now — free while our infra stays free"), and the conversion hook ("No card required"). Every word is load-bearing for either SEO or CTR.

### 2.3 The H1–H3 Hierarchy

The homepage has **exactly one `<h1>`** — the hero headline (`02_Hero_and_Above_the_Fold.md §3`). The H1 is the canonical on-page SEO signal.

H2s are the section titles: "What tutors are saying", "In their own words", "Case studies", "Five screens, here they are", "Under the hood: seven engines", "How we compare", "See it live", "Three tiers, no asterisks", "Minutes-per-day ROI calculator", "Scholarship", "Frequently asked questions", "Still stuck?", "Download Buddysaradhi", "Built in India. No telemetry. Your data is yours."

H3s are sub-section titles: the 5 screen names (Dashboard, Students, Attendance, Fees, Settings), the 7 engine names (Search, Reminder, Ledger, Report, Notification, Sync, Security), the 3 pricing tier names (Free, Pro, Institute), the 6 FAQ category names, the 5 testimonial tutor names.

H4s are reserved for the FAQ question text within each accordion item.

The hierarchy is enforced by a CI lint (`heading-hierarchy.test.ts`) that scans the rendered HTML and fails if any heading level is skipped (e.g., H2 directly followed by H4 with no intervening H3).

### 2.4 The Image Alt Text

Every image on the homepage has descriptive `alt` text. The alt text is **not** keyword-stuffed — it describes what the image shows, for accessibility and for Google's image search.

| Image | Alt text |
|---|---|
| Hero mockup | "Screenshot of Buddysaradhi Dashboard showing ₹1,24,500 collected this month, 38 active students, and 3 batches scheduled for today." |
| Feature card: Dashboard | "Screenshot of Buddysaradhi Dashboard with monthly KPIs, sparkline trend, and today's batches." |
| Feature card: Students | "Screenshot of Buddysaradhi Students screen with a searchable list of 38 students and one student's timeline expanded." |
| Feature card: Attendance | "Screenshot of Buddysaradhi Attendance screen with one batch open, 11 of 12 students marked present, and the 24-hour lock countdown." |
| Feature card: Fees | "Screenshot of Buddysaradhi Fees screen with the ledger, one VOID entry, and the record-payment sheet open." |
| Feature card: Settings | "Screenshot of Buddysaradhi Settings screen scrolled to the Backup section, showing the encrypted .buddysaradhi export button and the biometric toggle." |
| Testimonial avatars | "Photo of Riya Sharma" / "Initials KK in a cyan circle" |
| QR code | "QR code. Scan with your phone camera to download Buddysaradhi. Encodes the URL https://buddysaradhi.app/d." |

The alt text is updated whenever the screenshot is updated (enforced by the same perceptual-hash lint that updates the screenshots, `03_Features_Showcase.md §6`).

### 2.5 The URL Structure

```
/                              Homepage (canonical)
/download                      Download hub (dedicated page)
/faq                           FAQ index
/faq#faq-{category}-{n}        FAQ deep-link
/changelog                     Changelog index
/changelog/{version}           Changelog for a specific version
/case-studies/{slug}           Case study
/case-studies/{slug}/transcript  Video transcript
/blog/{slug}                   Blog post (v1.x)
/d                             Short URL → /download (for QR codes)
/d/{short-id}                  Short URL → specific download (for SMS links)
/privacy                       Privacy policy
/terms                         Terms of service
/dpa                           Data processing agreement
```

URLs are **lowercase, hyphenated, no trailing slash** (configurable in `next.config.ts`). The canonical URL is always the no-trailing-slash version. Vercel auto-redirects `/download/` → `/download` (308 permanent).

### 2.6 The Internal Linking Strategy

Every page on the site links to:
- The homepage (via the nav-bar wordmark).
- The download hub (via the nav-bar "Download" link).
- The pricing section (via the nav-bar "Pricing" link).
- The FAQ (via the nav-bar "FAQ" link and the footer).

The homepage links to:
- `/signup` (via 4 CTAs — `07_CTA_and_Conversion.md`).
- `/case-studies/priya-nagpur-maths` and `/case-studies/kabir-indore-jee` (via the case-study cards).
- `/changelog/{current-version}` (via the download hub's "View changelog" links).
- `/privacy`, `/terms`, `/dpa` (via the footer).

Internal links use **descriptive anchor text** — never "click here" or "read more". The anchor text signals the destination's topic to Google. Example: "Read Priya's full case study →" (not "Read more →").

---

## 3. OpenGraph and Twitter Cards

### 3.1 The OpenGraph Tags

```html
<meta property="og:type" content="website" />
<meta property="og:url" content="https://buddysaradhi.app/" />
<meta property="og:title" content="Buddysaradhi — Tuition Management App for Indian Tutors" />
<meta property="og:description" content="Five screens. Seven engines. One ledger. Zero servers. The operating system for private tutors and coaching institutes in India. Free for everyone, for now — free while our infra stays free. No card required." />
<meta property="og:image" content="https://buddysaradhi.app/og/default.avif" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="Buddysaradhi — Five screens. Seven engines. One ledger. Zero servers." />
<meta property="og:site_name" content="Buddysaradhi" />
<meta property="og:locale" content="en_IN" />
<meta property="og:locale:alternate" content="en_US" />
```

The OG image is a **custom-designed 1200×630 AVIF** (~80 KB), not a screenshot. It features:
- The cosmic gradient background (`#0f0c29` → `#24243e` → `#0a0a1a`).
- The Buddysaradhi wordmark in the top-left (white, with the emerald dot).
- The tagline "Five screens. Seven engines. One ledger. Zero servers." in the centre (white, 56px).
- The price "Free for everyone · No card required" below the tagline (emerald, 28px).
- A subtle glass dashboard mockup in the bottom-right (cropped from the hero mockup, 50% opacity).

The OG image is **the same for every page on the site** in v1. Per-page OG images (case-study-specific, blog-post-specific) are a v1.x optimisation.

### 3.2 The Twitter Card Tags

```html
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="@buddysaradhiapp" />
<meta name="twitter:creator" content="@buddysaradhiapp" />
<meta name="twitter:title" content="Buddysaradhi — Tuition Management App for Indian Tutors" />
<meta name="twitter:description" content="Five screens. Seven engines. One ledger. Zero servers. Free for everyone, for now — free while our infra stays free. No card required." />
<meta name="twitter:image" content="https://buddysaradhi.app/og/default.avif" />
<meta name="twitter:image:alt" content="Buddysaradhi — Five screens. Seven engines. One ledger. Zero servers." />
```

Twitter uses the same image as OpenGraph (`summary_large_image` card = full-width image). The `@buddysaradhiapp` handle is the brand's Twitter/X account (must be reserved before launch — `deployment/01_Vercel_Hosting.md §3` mentions the domain; the social handles are reserved in parallel).

### 3.3 The OG Image Refresh Rule

The OG image is **regenerated at every release** (every minor version bump) to reflect the latest hero mockup. The image is generated by a CI job that:
1. Renders the OG image template (a React component via `@vercel/og`) with the current tagline and price.
2. Composites the latest dashboard screenshot into the bottom-right.
3. Encodes as AVIF at 80% quality (~80 KB).
4. Uploads to Vercel Blob at `buddysaradhi-releases/og/default.avif`.
5. Updates the og:image meta tag to a cache-busted URL (`/og/default.avif?v=1.4.0`).

The cache-bust is important: social platforms (Twitter, LinkedIn, WhatsApp) cache OG images aggressively. Without a versioned URL, an updated OG image may not propagate for weeks.

---

## 4. JSON-LD Schema

### 4.1 The SoftwareApplication Schema

On the homepage, a `<script type="application/ld+json">` block with the `SoftwareApplication` schema:

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Buddysaradhi",
  "applicationCategory": "EducationApplication",
  "applicationSubCategory": "Tuition Management",
  "operatingSystem": "Web, macOS, Windows, Android, iOS",
  "offers": [
    {
      "@type": "Offer",
      "name": "Free",
      "price": "0",
      "priceCurrency": "INR",
      "description": "Free for everyone, for now. Every feature, every screen, no card required. Free while our backend infra (Vercel, Turso, Vercel Blob) stays inside its free bands. Paid tiers (Pro ₹299/mo, Institute ₹999/mo) launch on the §1.6 trigger — internal-only until then."
    },
    {
      "@type": "Offer",
      "name": "Pro",
      "price": "299",
      "priceCurrency": "INR",
      "description": "₹299/mo or ₹2,999/yr. Unlimited students."
    },
    {
      "@type": "Offer",
      "name": "Institute",
      "price": "999",
      "priceCurrency": "INR",
      "description": "₹999/mo. Multi-tutor, GST invoice, ROI report."
    }
  ],
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.7",
    "ratingCount": "127",
    "reviewCount": "127",
    "bestRating": "5",
    "worstRating": "1"
  },
  "publisher": {
    "@type": "Organization",
    "name": "Buddysaradhi",
    "url": "https://buddysaradhi.app",
    "logo": "https://buddysaradhi.app/og/logo.png"
  },
  "url": "https://buddysaradhi.app",
  "description": "Buddysaradhi is the operating system for private tutors and small coaching institutes — five screens, seven engines, one ledger, zero servers to manage.",
  "screenshot": "https://buddysaradhi.app/og/dashboard.avif",
  "featureList": [
    "Dashboard with KPIs and trends",
    "Student management with smart search",
    "Attendance marking with 24-hour lock",
    "Fees ledger with tamper-evident receipts",
    "Encrypted .buddysaradhi backup export",
    "Cross-device sync via Turso",
    "Biometric login (Touch ID, Face ID, Windows Hello)"
  ]
}
```

The `aggregateRating` is fetched from the Play Store API (same source as the hero social-proof strip, `08_Testimonials_and_Social_Proof.md §5.3`). The `ratingCount` is the actual Play Store review count, updated weekly via the same Cron job.

### 4.2 The FAQPage Schema

On the FAQ page (and on the homepage's FAQ section), a `<script type="application/ld+json">` block with the `FAQPage` schema:

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Is the Free tier really free forever?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Free for everyone, for now. Every feature, every screen, no card required. You will not be asked to pay a single rupee until our backend infrastructure bill stops being ₹0/mo — and we'll give 60 days' notice before that happens. Even after paid tiers launch, your Free access never lowers — that is the grandfather clause."
      }
    },
    {
      "@type": "Question",
      "name": "Does it work without internet?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes. Buddysaradhi is offline-first. You can mark attendance, record fees, generate receipts, and export backups with no internet. Sync happens when you reconnect."
      }
    }
    // ... 47 more Q&A pairs, one per FAQ entry
  ]
}
```

The FAQPage schema is generated **automatically** from the FAQ markdown source (`06_FAQ.md`) by a build-time script. A CI lint verifies that every Q&A in the markdown has a corresponding entry in the JSON-LD — no drift.

### 4.3 The BreadcrumbList Schema

On non-homepage pages (download hub, FAQ, case studies, blog posts), a `<script type="application/ld+json">` block with the `BreadcrumbList` schema:

```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "Home",
      "item": "https://buddysaradhi.app/"
    },
    {
      "@type": "ListItem",
      "position": 2,
      "name": "Download",
      "item": "https://buddysaradhi.app/download"
    }
  ]
}
```

The breadcrumbs are also rendered visually at the top of each non-homepage page (`Home → Download`), in caption style, with the current page in `--text-secondary` and the parent pages in `--accent-cyan` ghost links.

### 4.4 The Organisation Schema

On the homepage and the footer (site-wide), a `<script type="application/ld+json">` block with the `Organization` schema:

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Buddysaradhi",
  "url": "https://buddysaradhi.app",
  "logo": "https://buddysaradhi.app/og/logo.png",
  "description": "Buddysaradhi is the operating system for private tutors and small coaching institutes.",
  "foundingDate": "2024",
  "founder": {
    "@type": "Person",
    "name": "Buddysaradhi Team"
  },
  "contactPoint": {
    "@type": "ContactPoint",
    "email": "hello@buddysaradhi.app",
    "contactType": "customer support",
    "areaServed": "IN",
    "availableLanguage": ["en", "hi"]
  },
  "sameAs": [
    "https://twitter.com/buddysaradhiapp",
    "https://www.linkedin.com/company/buddysaradhi"
  ]
}
```

The `sameAs` array lists the brand's social profiles. These must be real profiles — a CI lint verifies they return 200 and contain "Buddysaradhi" in the page title.

---

## 5. Sitemap, Robots, Canonicals

### 5.1 The sitemap.xml

Generated at build time by Next.js's `app/sitemap.ts` (App Router convention). It includes:
- The homepage (`/`), priority 1.0, changefreq weekly.
- `/download`, priority 0.9, changefreq monthly.
- `/faq`, priority 0.8, changefreq weekly.
- `/case-studies/{slug}` for each case study, priority 0.7, changefreq monthly.
- `/changelog/{version}` for each released version, priority 0.6, changefreq never (versions don't change).
- `/privacy`, `/terms`, `/dpa`, priority 0.3, changefreq yearly.

The sitemap is at `https://buddysaradhi.app/sitemap.xml` and is submitted to Google Search Console and Bing Webmaster Tools on launch.

### 5.2 The robots.txt

```txt
# Buddysaradhi robots.txt
# Spec: product/09_SEO_and_Analytics.md §5.2

User-agent: *
Allow: /
Disallow: /api/
Disallow: /_next/
Disallow: /dashboard
Disallow: /students
Disallow: /attendance
Disallow: /fees
Disallow: /settings
Disallow: /signup
Disallow: /login
Disallow: /verify

Sitemap: https://buddysaradhi.app/sitemap.xml
Host: https://buddysaradhi.app
```

The `Disallow` rules block the app routes (`/dashboard`, `/students`, etc.) and the auth routes (`/signup`, `/login`, `/verify`) from indexing — these are private, behind auth, and have no SEO value. The marketing routes (`/`, `/download`, `/faq`, `/case-studies/*`, `/changelog/*`) are allowed.

### 5.3 The Canonical URLs

Every page has a `<link rel="canonical">` tag pointing to its own URL (the no-trailing-slash version):

```html
<link rel="canonical" href="https://buddysaradhi.app/" />           <!-- homepage -->
<link rel="canonical" href="https://buddysaradhi.app/download" />  <!-- download hub -->
<link rel="canonical" href="https://buddysaradhi.app/faq" />       <!-- FAQ -->
```

The canonical prevents duplicate-content issues from trailing-slash variants, query-string variants, and the `buddysaradhi.vercel.app` mirror (`deployment/01_Vercel_Hosting.md §3.1`). The `buddysaradhi.vercel.app` URLs have `<link rel="canonical" href="https://buddysaradhi.app/...">` — they canonical to the apex domain, so Google indexes only `buddysaradhi.app`.

### 5.4 The hreflang Tags

In v1 (India-only launch), hreflang is not needed — there is only one locale (`en-IN`). In v1.x (Gulf launch), hreflang is added:

```html
<link rel="alternate" hreflang="en-IN" href="https://buddysaradhi.app/" />
<link rel="alternate" hreflang="en-AE" href="https://buddysaradhi.app/ae/" />
<link rel="alternate" hreflang="en-SG" href="https://buddysaradhi.app/sg/" />
<link rel="alternate" hreflang="x-default" href="https://buddysaradhi.app/" />
```

The `x-default` is the India version (the canonical for unknown locales). This is configured when the per-region page variants land (`01_Product_Positioning.md §8`).

---

## 6. The No-Telemetry-SDK Rule (Revisited)

### 6.1 The Rule

> **No third-party analytics, session-replay, or crash-reporting SDK is loaded on any Buddysaradhi marketing page.** The only analytics SDK is Vercel Web Analytics, which is aggregate-only, first-party, and cannot see individual user data.

This is Rule 3 of the 10 non-negotiables (`AGENTS.md §2`), `01_Product_Principles.md AP-10`, and `10_Security.md §17` (TELE-1). It is the **strictest analytics posture in Indian SaaS** — every competitor (Classplus, Teachmint, Zoho) loads Google Analytics, Mixpanel, or Hotjar.

### 6.2 What "No Telemetry SDK" Forbids

| SDK | Forbidden | Why |
|---|---|---|
| Google Analytics (gtag.js, GA4) | ✅ | Tracks individual users via Client ID; shares data with Google ad network |
| Google Tag Manager | ✅ | Container that loads GA, Hotjar, etc. — same problem |
| Mixpanel | ✅ | Tracks individual user events; shares data with Mixpanel |
| PostHog | ✅ | Self-hosted is still telemetry; session replay captures PII |
| Amplitude | ✅ | Same as Mixpanel |
| Heap | ✅ | Auto-captures every click; PII risk |
| Hotjar | ✅ | Session replay + heatmaps capture PII (student names, fees) |
| Microsoft Clarity | ✅ | Free session replay; same PII risk as Hotjar |
| FullStory | ✅ | Session replay; same PII risk |
| Sentry | ✅ | Crash reporting; can leak PII in error payloads |
| Crashlytics | ✅ | Same as Sentry |
| LogRocket | ✅ | Session replay; same PII risk |
| Intercom / Drift / Tawk.to | ✅ | Chat widgets track visitor identity + behaviour |
| Facebook Pixel | ✅ | Tracks for ad targeting |
| LinkedIn Insight Tag | ✅ | Same |
| Twitter Pixel | ✅ | Same |

### 6.3 What "No Telemetry SDK" Allows

| SDK | Allowed | Why |
|---|---|---|
| **Vercel Web Analytics** | ✅ | Aggregate-only (page-view counts, no individual user IDs), first-party (served from buddysaradhi.app, not a third-party domain), privacy-respecting (no cookies, no fingerprinting) |
| **Vercel Speed Insights** | ✅ | Aggregate-only (Core Web Vitals metrics, no individual user data) |
| **Server-side logs (Vercel)** | ✅ | Operator-only, not aggregated into a user profile, used for debugging not tracking |

### 6.4 The Vercel Web Analytics Configuration

Vercel Web Analytics is enabled in `vercel.json`:

```json
{
  "analytics": {
    "webAnalytics": {
      "audience": "india"
    },
    "speedInsights": {
      "audience": "india"
    }
  }
}
```

The `audience: "india"` field is a Vercel-specific config that biases the analytics dashboard's audience breakdown toward India. It does not affect data collection — only the dashboard's default view.

The analytics SDK is loaded via `@vercel/analytics/react`'s `<Analytics />` component in the root layout (`apps/web/src/app/layout.tsx`). The component is **server-rendered** (no client JS bundle cost) and fires the `page_view` event on every route change. Custom events (CTA clicks, video plays, etc.) are fired via the `track()` function from `@vercel/analytics`.

### 6.5 The Custom Events Catalogue

Every custom event fired to Vercel Web Analytics, with its properties and trigger:

| Event | Trigger | Properties |
|---|---|---|
| `page_view` | Automatic on every route change | `path`, `referrer` |
| `cta_click` | Any CTA click | `cta_id` (1–7), `cta_location` (hero/features/etc.), `variant` (A/B/C) |
| `scroll_50` | Intersection Observer fires at 50% scroll | `path` |
| `scroll_100` | Intersection Observer fires at 100% scroll | `path` |
| `video_play` | Hero secondary CTA → video modal opens | `variant` |
| `video_complete` | Video reaches 75% playback | `variant` |
| `features_deep_link_click` | "See it live →" on a feature card | `screen` (dashboard/students/etc.) |
| `download_click` | Download hub primary button | `platform` (web/macos/etc.), `variant` |
| `download_complete` | App pings `/download?installed=1` on first run | `platform` |
| `changelog_view` | "View changelog →" click | `version`, `platform` |
| `demo_iframe_load` | Demo iframe "Tap to load" click | (none) |
| `signup_complete` | `/api/auth/verify` success | `variant`, `referrer` |
| `activate` | First student added (24h after signup) | (none — server-side only) |

Every event is **aggregate-only**. Vercel Web Analytics does not store individual user identifiers (no cookie, no fingerprint). The events are aggregated into daily/hourly counts per `path` / `cta_id` / `variant`. We can answer "how many visitors clicked CTA #1 yesterday?" but not "did visitor X click CTA #1?"

### 6.6 The No-PII in Events Rule

Custom events **never** include PII. The properties listed above (`cta_id`, `variant`, `screen`, `platform`, `path`, `referrer`) are all aggregate-safe. A CI lint (`no-pii-in-analytics.test.ts`) scans the codebase for `track(` calls and fails if any property value is derived from user input (e.g., `track('signup', { email })` would fail).

The `signup_complete` event does not include the email — only `variant` and `referrer`. The email is in the Supabase Auth `users` table, not in Vercel Web Analytics. The join (for funnel analysis) is done server-side, in the nightly Cron job, on the `user_id` (a UUID, not the email).

---

## 7. GDPR / DPDP Compliance

### 7.1 The DPDP Act (India)

The Digital Personal Data Protection Act 2023 requires:
1. **Consent** for data collection — obtained at signup ("By signing up, you agree to our Privacy Policy and Terms of Service." with the links).
2. **Purpose limitation** — data is used only for running the app and providing support; not for advertising or third-party sharing.
3. **Data minimisation** — we collect only email (for auth) and the data the tutor enters (students, fees, attendance). No demographic data, no browsing history, no device fingerprinting.
4. **Right to access** — the tutor can export all their data via the `.buddysaradhi` backup (`09_Backup_and_Import_Export.md`).
5. **Right to correction** — the tutor can edit any field in the app.
6. **Right to erasure** — the tutor can delete their account permanently (`12_Business_Rules.md §BR-SEC-10`).
7. **Data breach notification** — if a breach occurs, we notify the Data Protection Board of India and the affected tutors within 72 hours (per the DPDP Act).

The privacy policy at `/privacy` documents all seven rights in plain English (not legalese). The policy is ≤ 1,500 words — short enough to read in 5 minutes.

### 7.2 The GDPR (EU/UK)

For visitors from the EU/UK (v2.x launch), GDPR requires the same six rights as DPDP, plus:
1. **Right to data portability** — the `.buddysaradhi` backup satisfies this (it's a machine-readable, encrypted export).
2. **Right to object to processing** — the tutor can object to aggregate analytics (Vercel Web Analytics) by setting `?dnt=1` in the URL or enabling Do Not Track in their browser. We honour DNT.
3. **Lawful basis for processing** — our lawful basis is "contract" (running the app the tutor signed up for) and "legitimate interest" (aggregate analytics for product improvement). We do not rely on "consent" for analytics — Vercel Web Analytics is aggregate-only and does not require consent under GDPR.

The DPA at `/dpa` documents the data-processing agreement between Buddysaradhi and the tutor (for Institute tier, between Buddysaradhi and the institute). It is signed electronically at signup.

### 7.3 The Cookie Banner

Buddysaradhi does **not** have a cookie banner. This is because:
- Vercel Web Analytics does not use cookies (it uses an anonymous, aggregate-only measurement).
- The auth session uses a cookie (`sb-auth-token`), but it is strictly necessary (no consent needed under GDPR/DPDP for strictly-necessary cookies).
- There are no third-party cookies (no GA, no Facebook Pixel, no ad networks).

The absence of a cookie banner is **a competitive advantage** — it signals to the visitor that we do not track them. It is also a UX advantage — no banner to dismiss, no consent to manage. The visitor lands on the page and reads the content.

### 7.4 The "Do Not Track" Honour

If the visitor's browser sends `DNT: 1` (Do Not Track), Buddysaradhi does not load Vercel Web Analytics. This is enforced in the `<Analytics />` component's render logic:

```tsx
// apps/web/src/app/layout.tsx — partial excerpt
// Spec: product/09_SEO_and_Analytics.md §7.4
import { Analytics } from '@vercel/analytics/react';
import { headers } from 'next/headers';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const dnt = h.get('dnt') === '1';
  return (
    <html lang="en-IN">
      <body>
        {children}
        {!dnt && <Analytics audience="india" />}
      </body>
    </html>
  );
}
```

This is the **only** place in the codebase where DNT is checked. The check is server-side (the DNT header is read in the RSC), so there is no client-side flicker. A DNT visitor sees the exact same page as a non-DNT visitor, just without the analytics script.

---

## 8. The SEO Performance Budget

SEO and page performance are correlated — Google ranks fast pages higher. The homepage must hit **Core Web Vitals** "Good" on all three metrics:

| Metric | Target | Hard floor |
|---|---|---|
| LCP (Largest Contentful Paint) | ≤ 1.2s | ≤ 2.5s |
| INP (Interaction to Next Paint) | ≤ 200ms | ≤ 500ms |
| CLS (Cumulative Layout Shift) | ≤ 0.05 | ≤ 0.1 |

These are the same targets as the hero performance budget (`02_Hero_and_Above_the_Fold.md §11`), extended to the whole page. The targets are measured by Vercel Speed Insights (aggregate, real-user monitoring) and by Lighthouse (lab, synthetic).

### 8.1 The Lighthouse Gate

Every preview deployment runs Lighthouse via CI (`web/05_Deployment_Vercel.md §4`). A deployment is **blocked** if any of the 4 Lighthouse metrics falls below the hard floor:

| Lighthouse metric | Hard floor |
|---|---|
| Performance | 90 |
| Accessibility | 90 |
| Best Practices | 90 |
| SEO | 90 |

The target is 95+ on all four; the floor is 90. Below 90 on any metric blocks the deploy. This is the **Lighthouse gate**, and it is non-negotiable.

---

## 9. The Search Console and Bing Webmaster Tools

### 9.1 The Google Search Console

The site is registered in Google Search Console at `https://search.google.com/search-console?resource_id=https://buddysaradhi.app/`. The verification is via DNS TXT record (the most reliable method). The Search Console is configured with:
- **Sitemap submission** — `https://buddysaradhi.app/sitemap.xml`.
- **URL inspection** — manual inspection of the homepage, download hub, and FAQ after every release.
- **Performance monitoring** — daily check of impressions, clicks, CTR, and average position for the top 10 queries.
- **Coverage monitoring** — weekly check of indexed vs excluded pages; any excluded page is reviewed.
- **Manual actions** — daily check (none expected; if any, the operator is paged).

The Search Console is owned by the orchestrator (the founder in v1). Access is shared with the SEO agent (a human, not an AI) on a need-to-know basis.

### 9.2 The Bing Webmaster Tools

Same configuration as Search Console, but for Bing. Bing's share of Indian search is ~5% (vs Google's ~95%), but it is free to register and the sitemap submission is one click. The ROI is low but non-zero.

---

## 11. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated, neumorphic controls recipe-annotated, cross-references canonical (`§5.5`, `§6.6`, `§8.*`, `BR-*`, `P*`, `AP-*`). Box widths honour §20.3 rule 2 (80–120 for landing-page sections, 60–80 for components). This file owns the SEO + analytics layer (no rendered marketing surface); the mockups below visualise the SEO stack (OG tags, JSON-LD, sitemap, robots), the analytics event funnel, and the Vercel Web Analytics dashboard view. These are CONCEPT DIAGRAMS, not live UI surfaces — they do not carry glass-tier or neumo-recipe annotations (per §6.6 single rule, glass/neumo applies only to live-page components).

### 11.1 Design System Reference (§5.5 + §6.6 single rule)

This file owns the **SEO + analytics layer**, not a rendered marketing surface. The mockups below are *conceptual data-flow diagrams* (SEO stack, event funnel, dashboard). They do **not** carry glass-tier or neumo-recipe annotations because they describe server-side artefacts (meta tags, JSON-LD, sitemap.xml, robots.txt, Vercel Web Analytics config) and analytics events, not on-page UI components. The single rule from `§6.6` — *glass for surfaces, neumo for controls, never invert* — applies to the live-page components that downstream files (`02_Hero`, `03_Features`, etc.) specify; this file's job is to feed those files the SEO copy and the analytics event names they consume.

| SEO / analytics artefact (this file) | Live-page consumer | Glass / neumo tier (in consumer) |
|---|---|---|
| §2.1 Title tag (≤ 60 chars) | `product/02 §3` hero headline | `.glass` (hero card carries the rendered H1) |
| §2.2 Meta description (≤ 155 chars) | `product/02 §4` hero subheadline | `.glass` (hero card) |
| §3.1 OG image (1200×630 PNG) | `product/02 §2.2` right-column visual | flat video / AVIF (no glass) |
| §4.1 SoftwareApplication JSON-LD | `product/04 §2.3` download cards | `.glass` (download card) |
| §4.2 FAQPage JSON-LD | `product/06 §3` accordion rows | `.glass-faint` (FAQ row) |
| §5.1 sitemap.xml | (no UI consumer — server-side only) | n/a |
| §5.2 robots.txt | (no UI consumer — server-side only) | n/a |
| §6.4 Vercel Web Analytics config | `product/07 §9` conversion funnel | n/a (analytics config, not UI) |

### 11.2 SEO Stack Diagram (NEW)

The full SEO stack rendered as a single composition: the HTML `<head>` (title, meta description, OG tags, Twitter card, JSON-LD scripts, canonical, hreflang) → the server-side files (sitemap.ts, robots.ts, opengraph-image.tsx) → the search-engine crawlers (Googlebot, Bingbot) → the social-card renderers (WhatsApp, LinkedIn, Twitter). Every artefact cites its spec section; every crawler is honoured per `§5.2 robots.txt`.

```
  SEO STACK — HTML <head> + server-side files + crawlers  (per §2–§5 of this file)
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  HTML <head>  (rendered by Next.js Metadata API, web/07 §9.1)                       │
  │  ┌──────────────────────────────────────────────────────────────────────────────╲  │
  │  │ <title>Buddysaradhi — Five screens. Seven engines. One ledger. | Free for everyone</title>  │  │
  │  │  ↑ §2.1 title tag (≤ 60 chars; Free for everyone India-first)                      │  │
  │  │ <meta name="description" content="The OS for private tutors in India.…" />   │  │
  │  │  ↑ §2.2 meta description (≤ 155 chars; cites 5 screens + Free for everyone + UPI)   │  │
  │  │ <meta property="og:title" content="Buddysaradhi — Five screens, seven engines" /> │  │
  │  │ <meta property="og:description" content="The OS for private tutors…" />      │  │
  │  │ <meta property="og:image" content="/og?variant=hero" />                       │  │
  │  │  ↑ §3.1 OG tags; og:image = dynamic OG via opengraph-image.tsx (§3.3)        │  │
  │  │ <meta name="twitter:card" content="summary_large_image" />                   │  │
  │  │ <meta name="twitter:image" content="/og?variant=hero" />                      │  │
  │  │  ↑ §3.2 Twitter card (alias of OG)                                            │  │
  │  │ <link rel="canonical" href="https://buddysaradhi.app/" />                         │  │
  │  │  ↑ §5.3 canonical URLs (one per route; prevents duplicate-content penalty)   │  │
  │  │ <link rel="alternate" hreflang="en-IN" href="https://buddysaradhi.app/" />        │  │
  │  │ <link rel="alternate" hreflang="x-default" href="https://buddysaradhi.app/" />   │  │
  │  │  ↑ §5.4 hreflang (en-IN primary; x-default fallback; v2.x adds en-MENA)      │  │
  │  │ <script type="application/ld+json">                                          │  │
  │  │   { "@context":"https://schema.org", "@type":"SoftwareApplication",          │  │
  │  │     "name":"Buddysaradhi", "operatingSystem":"Web/macOS/Windows/Android/iOS",     │  │
  │  │     "offers":[ { "@type":"Offer", "price":"0", "priceCurrency":"INR" },      │  │
  │  │                { "@type":"Offer", "price":"299", "priceCurrency":"INR" },    │  │
  │  │                { "@type":"Offer", "price":"999", "priceCurrency":"INR" } ] } │  │
  │  │ </script>                                                                    │  │
  │  │  ↑ §4.1 SoftwareApplication JSON-LD; prices in ₹ (BR-M-02 en-IN format)      │  │
  │  │ <script type="application/ld+json">                                          │  │
  │  │   { "@context":"https://schema.org", "@type":"FAQPage",                      │  │
  │  │     "mainEntity":[ …49 Q&A pairs from product/06 §6… ] }                     │  │
  │  │ </script>                                                                    │  │
  │  │  ↑ §4.2 FAQPage JSON-LD; verbatim from product/06 §6 Q&A pairs              │  │
  │  │ <script type="application/ld+json">                                          │  │
  │  │   { "@context":"https://schema.org", "@type":"BreadcrumbList", … }           │  │
  │  │ </script>                                                                    │  │
  │  │  ↑ §4.3 BreadcrumbList JSON-LD (Home > Pricing > Pro tier)                   │  │
  │  │ <script type="application/ld+json">                                          │  │
  │  │   { "@context":"https://schema.org", "@type":"Organization",                 │  │
  │  │     "name":"Buddysaradhi", "url":"https://buddysaradhi.app", … }                       │  │
  │  │ </script>                                                                    │  │
  │  │  ↑ §4.4 Organization JSON-LD (founder, contact, sameAs → social profiles)    │  │
  │  └──────────────────────────────────────────────────────────────────────────────╱  │
  │                                       │                                            │
  │                                       ▼                                            │
  │  Server-side files (Next.js Metadata API + route handlers, web/07 §9)              │
  │  ┌────────────────────────┐  ┌────────────────────────┐  ┌──────────────────────┐  │
  │  │ sitemap.ts             │  │ robots.ts              │  │ opengraph-image.tsx  │  │
  │  │  ↑ §5.1; /, /pricing,  │  │  ↑ §5.2; allow-all +   │  │  ↑ §3.3; dynamic OG  │  │
  │  │    /faq, /download,    │  │    sitemap reference;  │  │    image via Image-  │  │
  │  │    /changelog/[ver]    │  │    no /api/* crawl     │  │    Response (1200×    │  │
  │  │  ↑ ISR revalidate=3600 │  │                        │  │    630 PNG, ≤ 80 KB) │  │
  │  └────────────────────────┘  └────────────────────────┘  └──────────────────────┘  │
  │                                       │                                            │
  │                                       ▼                                            │
  │  Crawlers + social-card renderers ( honour robots.txt + sitemap.xml )              │
  │  ┌────────────────┐  ┌────────────────┐  ┌────────────┐  ┌────────────────────┐   │
  │  │ Googlebot      │  │ Bingbot        │  │ WhatsApp   │  │ LinkedIn / Twitter │   │
  │  │  ↑ mobile-first │  │  ↑ secondary   │  │  ↑ OG tags │  │  ↑ OG + Twitter    │   │
  │  │    indexing     │  │    index       │  │    render  │  │    card render     │   │
  │  │  ↑ Search Cons. │  │  ↑ Webmaster   │  │            │  │                    │   │
  │  │    §9.1         │  │    Tools §9.2  │  │            │  │                    │   │
  │  └────────────────┘  └────────────────┘  └────────────┘  └────────────────────┘   │
  │                                                                                     │
  │   ↑ Every artefact lives in this file or web/07; no third-party SEO plugins.       │
  │   ↑ All money in JSON-LD `Offer.price` is integer rupees (BR-M-01 stores paise;   │
  │     JSON-LD shows rupees with `priceCurrency: INR` per schema.org convention).     │
  │   ↑ No telemetry SDK (Rule 3, AP-10, TELE-1) — no GA, no GTM, no Search Console    │
  │     verification meta-tag leak (verification via DNS TXT per §9.1).                 │
  │   ↑ Lighthouse SEO ≥ 95 (§8.1 gate); hreflang + canonical prevent duplicate-       │
  │     content penalty; sitemap.xml + robots.txt ensure full crawl coverage.           │
  │   ↑ The OG image is DYNAMIC — it reads the latest testimonial + version from       │
  │     product/08 §2.1 and product/04 §2.3; refreshes per §3.3 OG image refresh rule. │
  └────────────────────────────────────────────────────────────────────────────────────┘
   ↑ This is a CONCEPT DIAGRAM, not a live UI surface — no glass tier annotation.
   ↑ The live consumer surfaces (hero card, download cards, FAQ rows) carry their
     own glass/neumo tiers per the §5.5 + §6.6 maps in their owner files.
```

### 11.3 Analytics Event Funnel — Vercel Web Analytics Only (NEW)

The §6 no-telemetry-SDK rule reimagined as an event-flow diagram. Every event flows from the visitor's browser → Vercel Web Analytics (aggregate, no cookies, no PII) → the nightly Vercel Cron job → the variant-comparison report. No event flows to any third-party SDK. No event carries an email, user_id, or IP. This is the artefact the privacy policy (`§7 DPDP / GDPR`) cites.

```
  ANALYTICS EVENT FUNNEL — Vercel Web Analytics only  (per §6 no-telemetry rule)
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  Visitor browser  (no SDK loaded; just the Vercel Web Analytics <script>)           │
  │                                                                                     │
  │  page_view ──────┐                                                                  │
  │  cta_hero_click ─┤                                                                  │
  │  signup_complete ┼────┐                                                            │
  │  upgrade_pro_*  ─┘    │                                                            │
  │                       │  (HTTP POST, no cookies, no PII,                           │
  │                       │   aggregate-only per Vercel Web Analytics spec)            │
  │                       ▼                                                            │
  │  ┌──────────────────────────────────────────────────────────────────────────────┐  │
  │  │  Vercel Web Analytics  (aggregate, privacy-respecting, no cookies, no PII)   │  │
  │  │  ↑ §6.4 configuration; @vercel/analytics package; audience="india"          │  │
  │  │  ↑ Stores: event name + timestamp + variant + platform + cta_id              │  │
  │  │  ↑ Does NOT store: email, user_id, IP, user-agent, referrer (full URL)      │  │
  │  │  ↑ Honours DNT (Do Not Track) per §7.4; DNT=1 → event is dropped           │  │
  │  │  ↑ Cookie banner (§7.3) NOT required — Vercel Web Analytics is cookieless   │  │
  │  └──────────────────────────────────────────────────────────────────────────────┘  │
  │                       │                                                            │
  │                       │  (nightly Vercel Cron job, web/05 §2.3)                   │
  │                       ▼                                                            │
  │  ┌──────────────────────────────────────────────────────────────────────────────┐  │
  │  │  Variant-comparison report  (aggregate API query → CSV → emailed to founder) │  │
  │  │  ↑ Reads: event counts per variant per day                                   │  │
  │  │  ↑ Computes: two-proportion z-test, p < 0.05, 80% power (07_CTA §12.3)      │  │
  │  │  ↑ Outputs: variant_a vs variant_b vs variant_c conversion-rate table        │  │
  │  │  ↑ NO raw events exported — only aggregate counts                            │  │
  │  └──────────────────────────────────────────────────────────────────────────────┘  │
  │                                                                                     │
  │  ── WHAT IS FORBIDDEN  (per §6.2 no-telemetry-SDK rule) ──                         │
  │  ✕ Google Analytics (GA4 / Universal Analytics)                                    │
  │  ✕ Google Tag Manager                                                               │
  │  ✕ Mixpanel                                                                         │
  │  ✕ PostHog                                                                          │
  │  ✕ Hotjar (heatmaps + session recordings — PII leak)                               │
  │  ✕ Microsoft Clarity (heatmaps + session recordings — PII leak)                    │
  │  ✕ Sentry (error tracking — may leak PII in stack traces)                          │
  │  ✕ FullStory (session replay — PII leak)                                           │
  │  ✕ Any third-party script that sets a cookie, reads the DOM, or sends PII         │
  │                                                                                     │
  │  ── WHAT IS ALLOWED  (per §6.3 no-telemetry-SDK exceptions) ──                     │
  │  ✓ Vercel Web Analytics (aggregate, cookieless, no PII) — the ONLY analytics      │
  │  ✓ Vercel Speed Insights (aggregate Core Web Vitals; no PII)                      │
  │  ✓ Server-side error logging to Turso (no third party; no PII in payload)         │
  │  ✓ Server Action for newsletter signup (email → Turso; no 3rd-party ESP at v1)    │
  │                                                                                     │
  │   ↑ This is a CONCEPT DIAGRAM, not a live UI surface — no glass tier annotation.   │
  │   ↑ The DPDP Act (India, §7.1) and GDPR (EU/UK, §7.2) both permit aggregate       │
  │     cookieless analytics without consent banner — Vercel Web Analytics qualifies. │
  │   ↑ The cookie banner (§7.3) is therefore NOT required for Vercel Web Analytics;  │
  │     it would only be required if a third-party SDK were added (forbidden).         │
  │   ↑ DNT (Do Not Track, §7.4) is honoured — DNT=1 drops the event entirely.        │
  │   ↑ No PII in any event payload (§6.6 no-PII rule); no email, no user_id, no IP.  │
  └────────────────────────────────────────────────────────────────────────────────────┘
   ↑ All money is integer paise (BR-M-01, Rule 6); the upgrade_pro_complete event
     carries billing:'monthly'|'yearly' but NOT the amount (amount is in the
     Razorpay webhook → Turso ledger, not in the analytics event).
   ↑ The 7-CTA skeleton is NOT A/B tested; only the copy / order / default within
     a CTA is tested (07_CTA §12.2 no-test list).
```

### 11.4 Vercel Web Analytics Dashboard View (NEW)

What the founder sees when they open the Vercel dashboard → Analytics tab. The view shows aggregate page views, top referrers (no full URLs — referrer stripped to domain), conversion events per variant, and the A/B test comparison table. This is the artefact the nightly Cron job (`web/05 §2.3`) reads and the artefact the founder reads to decide whether to ship variant B as the new default.

```
  VERCEL WEB ANALYTICS DASHBOARD — founder view  (per §6.4 config, §6.5 event catalogue)
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  buddysaradhi.app — Analytics  (last 30 days, India audience)                            │
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  Page views:           47,328   ↑ +12.4% vs prior 30 days                          │
  │  Unique visitors:      38,114   ↑ +9.8%  (aggregate; no cookies; no PII)            │
  │  Top routes:                                                                      │
  │    /                  28,412   (60.0%)                                              │
  │    /pricing            7,881   (16.7%)                                              │
  │    /faq                5,201   (11.0%)                                              │
  │    /download           3,842   ( 8.1%)                                              │
  │    /changelog          1,202   ( 2.5%)                                              │
  │  Top referrers (domain only — full URL stripped per §6.6 no-PII rule):             │
  │    google.com         18,420                                                        │
  │    (direct)           12,884                                                        │
  │    whatsapp.net        4,210   ← India-first; WhatsApp shares dominate              │
  │    linkedin.com        2,180                                                        │
  │    twitter.com         1,402                                                        │
  │                                                                                    │
  │  ── A/B TEST COMPARISON  (nightly Cron job output, web/05 §2.3) ──                 │
  │  Test 1 — Hero headline (3 variants A/B/C):                                        │
  │    Variant A: 28,412 views → 1,841 cta_hero_click  → 6.48% CTR                     │
  │    Variant B: 28,510 views → 2,102 cta_hero_click  → 7.37% CTR  ★ winner          │
  │    Variant C: 28,406 views → 1,712 cta_hero_click  → 6.03% CTR                     │
  │    ↑ p = 0.0042 (z-test, two-proportion); sample = 85,228 visitors; power = 84%   │
  │    ↑ Decision: ship Variant B as the new hero headline default                     │
  │                                                                                    │
  │  Test 2 — Pricing tier display order (2 variants A/B):                              │
  │    Variant A: 7,881 views →   412 cta_pricing_click → 5.23% CTR                    │
  │    Variant B: 7,842 views →   398 cta_pricing_click → 5.07% CTR                    │
  │    ↑ p = 0.71 — no significant difference; keep canonical order (A)               │
  │                                                                                    │
  │  ── CONVERSION FUNNEL  (per 07_CTA §9 + §14.3) ──                                  │
  │    1. Visit            47,328  (100%)                                                │
  │    2. Scroll 50%       31,840  ( 67%)                                                │
  │    3. Click CTA         5,628  ( 12%)                                                │
  │    4. Signup complete     812  (  1.7%)  ← BR-ONBOARD-1 90s budget                  │
  │    5. Activate            634  (  1.3%)  ← first student added                      │
  │    6. Convert (Pro)       142  (  0.30%) ← 26th-student paywall (BR-FEE-19)        │
  │    6. Convert (Inst.)      38  (  0.08%) ← "add co-tutor" action                    │
  │                                                                                    │
  │  ── PRIVACY POSTURE  (per §7 DPDP / GDPR) ──                                       │
  │  ✓ No cookies set (Vercel Web Analytics is cookieless)                             │
  │  ✓ No PII collected (no email, no user_id, no IP, no user-agent)                   │
  │  ✓ DNT honoured (Do Not Track = 1 → event dropped, §7.4)                           │
  │  ✓ Cookie banner NOT required (no third-party SDK triggers GDPR consent)           │
  │  ✓ DPDP Act (India) compliant — aggregate analytics is exempt from consent         │
  │  ✓ GDPR (EU/UK) compliant — aggregate cookieless analytics is exempt               │
  │                                                                                    │
  │   ↑ This is a CONCEPT DIAGRAM of the Vercel dashboard view, not a live UI          │
  │     surface on buddysaradhi.app — the founder sees this in their Vercel account.        │
  │   ↑ The numbers above are ILLUSTRATIVE targets (07_CTA §9.1 funnel targets);       │
  │     actual numbers will be measured in production.                                  │
  │   ↑ No raw event export — only aggregate counts per variant per day.               │
  │   ↑ No PII in the dashboard — the founder cannot drill down to an individual.      │
  └────────────────────────────────────────────────────────────────────────────────────┘
   ↑ All money is integer paise (BR-M-01, Rule 6); the dashboard shows ₹ revenue
     only in the separate Turso ledger report, NOT in the analytics dashboard.
   ↑ The conversion-rate targets (1.7% signup, 0.30% Pro, 0.08% Institute) are
     calibrated from public PLG benchmarks at the ₹299–₹999/mo price point (post-trigger).
```

### 11.5 References (External Design Authorities)

The SEO stack diagram, the analytics event funnel, and the dashboard view synthesise practices from the following public bodies of work. Cite them when a contributor challenges the no-telemetry rule, the JSON-LD payload, or the hreflang strategy.

- **Google Search Central** — *JSON-LD Structured Data*, *OpenGraph*, *Sitemaps*, and *Mobile-First Indexing*. The §11.2 SEO stack (4 JSON-LD schemas, OG/Twitter cards, sitemap.xml, robots.txt, canonical, hreflang) and the §11.3 Lighthouse SEO ≥ 95 gate follow Google's canonical documentation.
- **Vercel Web Analytics docs** — *Privacy-Respecting Analytics*, *Custom Event Catalogues*, and *A/B Segmentation*. The §11.3 event funnel (no SDK, no PII, no cookies) and the §11.4 dashboard view follow Vercel's privacy-first analytics posture (Rule 3, AP-10, TELE-1).
- **Nielsen Norman Group** — *SEO Copywriting* and *Funnel Measurement*. The §11.2 title-tag + meta-description budget and the §11.4 funnel targets follow NN/g's research on SEO copy and conversion measurement.
- **Smashing Magazine** — *JSON-LD for SaaS* and *OpenGraph Image Strategy*. The §11.2 dynamic OG image (opengraph-image.tsx via ImageResponse) and the §11.2 4-schema JSON-LD payload follow Smashing's research on structured data.
- **Baymard Institute** — *A/B Testing for Pricing* and *Funnel Benchmarks*. The §11.4 A/B test comparison table and the funnel conversion-rate targets follow Baymard's research on pricing-page A/B testing.
- **Apple Human Interface Guidelines** — *Marketing Surfaces* and *Privacy Nutrition Labels*. The §11.3 privacy posture (no PII, no cookies, DNT honoured) follows Apple HIG's privacy-first guidance.
- **A List Apart** — *Content Strategy for SEO* and *The hreflang Pattern*. The §11.2 hreflang tags (en-IN primary, x-default fallback) and the §11.2 title/meta budget follow ALA's content-strategy doctrine.

---

## 12. Cross-References

- `01_Product_Positioning.md §1.1` (tagline — used in the OG description), §6 (brand voice — applied to title tag and meta description), §7 (India-first market — the keyword strategy targets India).
- `02_Hero_and_Above_the_Fold.md §3` (hero A/B test — the variant is included in analytics events), §11 (LCP target — same as the SEO LCP target).
- `03_Features_Showcase.md §6` (screenshot alt text — updated with every screenshot refresh).
- `04_Download_Hub.md §9` (download analytics events — `download_click`, `download_complete`, `changelog_view`).
- `05_Pricing_and_Plans.md §3.1` (the "Most popular" badge — accuracy tied to the analytics event count).
- `06_FAQ.md` (the FAQ source — used to generate the FAQPage JSON-LD schema).
- `07_CTA_and_Conversion.md §9` (the conversion funnel — measured via Vercel Web Analytics events), §12 (A/B testing framework — uses Vercel Edge Config + Web Analytics).
- `08_Testimonials_and_Social_Proof.md §5.3` (the "4.7 ★ on Play Store" rating — fetched daily and used in the SoftwareApplication schema's aggregateRating).
- `10_Security.md §17` (TELE-1 — the no-telemetry rule, the foundational constraint for this entire file).
- `01_Product_Principles.md AP-10` (no telemetry — the principle behind TELE-1).
- `13_UI_Guidelines.md §10` (accessibility — heading hierarchy, alt text, focus rings).
- `web/01_Architecture.md §3` (route groups — `(marketing)` routes are SEO-indexable, `(app)` and `(auth)` routes are not), §6 (middleware — DNT check happens here).
- `web/05_Deployment_Vercel.md §4` (preview-deploy QA loop — CI runs Lighthouse on every preview deploy).
- `web/07_Landing_Page.md §9` (SEO Implementation — the HOW: the `metadata` export with title/description/canonical, the `opengraph-image.tsx` dynamic OG generator, the JSON-LD `SoftwareApplication`/`FAQPage`/`BreadcrumbList`/`Organization` schema blocks, the `sitemap.ts` and `robots.ts` files, the `<Analytics audience="india" />` + DNT-gated mounting, the Lighthouse ≥95 budget. This file owns the keyword strategy, the on-page copy, and the no-telemetry posture; that file owns the React tree, the `generateMetadata` impl, and the structured-data payloads that ship them).
- `deployment/01_Vercel_Hosting.md §3` (canonical domain — buddysaradhi.app is canonical, buddysaradhi.vercel.app is the mirror with canonical link).
- `product/AGENTS.md §7` (testing protocol — Lighthouse ≥ 95 is one of the testing gates).

---

*SEO is how a tutor in Nagpur finds Buddysaradhi. Analytics is how we know whether they did. Both are governed by the same rule: no third-party SDK, no PII, no tracking. The strictest posture in Indian SaaS is also the simplest — Vercel Web Analytics, aggregate-only, full stop.*
