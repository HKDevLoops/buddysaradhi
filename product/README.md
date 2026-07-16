# product/ — Buddysaradhi Commercial Landing Page Specification Package

> Orientation index for the **public front door** of Buddysaradhi: Omni-Core. This directory specifies the WHAT and the WHY of the commercial landing page at `buddysaradhi.app/` — the marketing surface a prospective tutor sees before they ever sign up, download a desktop build, install the Android app, or launch the web app. It is *not* the in-app spec-reader showcase currently living in the sandbox `src/app/page.tsx`; that showcase is a developer-facing curiosity. This is the customer-facing funnel.

---

## 0. Who Reads This

The **target reader** is one of:

1. **A marketing copywriter** drafting hero copy, feature bullets, FAQ answers, pricing language, or testimonial quotes for the live `buddysaradhi.app/` page.
2. **A web implementation agent** about to build `/` (the marketing landing route group) under `apps/web/src/app/(marketing)/`. The implementation contract is `web/07_Landing_Page.md`; this directory is the upstream WHAT spec that file consumes as the HOW.
3. **A growth / conversion reviewer** auditing the page for funnel leaks, dark patterns, copy clarity, or platform-coverage gaps.
4. **A brand voice reviewer** checking that every sentence reads like a senior product marketer who actually tutors on weekends — confident, warm, jargon-free, India-first.

If you are implementing in-app screens (Dashboard, Students, Attendance, Fees, Settings), you are in the wrong directory. Go to `../04_Dashboard.md`, `../05_Students.md`, `../06_Attendance.md`, `../07_Fees_and_Payments.md`, `../08_Settings.md`. If you are wiring build artifacts to Vercel Blob, go to `../deployment/02_Vercel_Blob_Build_Storage.md`.

---

## 1. What This Directory Owns (and What It Does Not)

**Owns (the WHAT and the WHY of the marketing page):**

- The value proposition and positioning statement.
- The hero section copy, layout, and 5-second-test criterion.
- The features showcase: which screens get feature cards, what the three bullets say, where the "see it live" deep-link goes.
- The download hub: 5 platform cards (Web, macOS, Windows, Android, iOS), file sizes, OS minimums, SHA-256 checksums, install guides.
- Pricing tiers, India-first payment methods (UPI primary), trial-to-paid conversion copy.
- FAQ content and accordion UI spec.
- CTA strategy: 7 CTAs, copy, color, placement, conversion goal.
- Testimonials and social proof: which tutors, which cities, which quotes, authenticity rules.
- SEO strategy: keyword map, meta tags, JSON-LD schema, the no-telemetry-SDK rule (Rule 3, AP-10, TELE-1 — `10_Security.md §17`).
- Analytics posture: Vercel Web Analytics only, aggregate-only, GDPR/DPDP note.

**Does NOT own (the HOW):**

- Route group structure (`(marketing)` vs `(app)` vs `(auth)`) — see `web/01_Architecture.md §3`.
- React Server Component vs Client Island split — see `web/01_Architecture.md §4`.
- The actual Tailwind classes, Framer Motion variants, shadcn/ui composition — see `web/07_Landing_Page.md` (the HOW) and `13_UI_Guidelines.md` (the design system).
- Vercel Blob upload workflow, manifest schema, signed URLs — see `deployment/02_Vercel_Blob_Build_Storage.md`.
- Tauri updater manifest JSON shape — see `desktop/05_Updater.md`.
- EAS Build production of Android APK mirror — see `mobile/05_EAS_Build.md` and `deployment/03_EAS_Build_and_Update_Channels.md`.
- App Store / Play Store metadata — see `mobile/07_App_Store_Release.md`.

The boundary is sharp: **this directory says what the page says and what the page does. The `web/` and `deployment/` directories say how it is built and shipped.**

---

## 2. File Index

Every file in this directory with a one-paragraph summary. Read in order on first encounter.

| # | File | Words | Summary |
|---|---|---|---|
| 1 | `README.md` | ~900 | This file. Orientation, file index, decision tree, commercial funnel diagram, cross-reference conventions, reading order, relationship to `web/07_Landing_Page.md`. |
| 2 | `01_Product_Positioning.md` | ~3,000 | Value proposition, three target personas (private tutor, small coaching institute, freelance educator), USP vs Zoho/Classplus/Teachmint/Google Sheets, positioning statement, brand voice & tone, competitive landscape matrix, the "five screens" elevator pitch, India-first market analysis, expansion markets. |
| 3 | `02_Hero_and_Above_the_Fold.md` | ~2,800 | Hero section spec: headline options with A/B rationale, subheadline, primary CTA "Start free — no card", secondary CTA "Watch the 90s tour", hero visual (animated glass dashboard mockup), trust badges, social proof line, platform auto-detection, above-the-fold grid, mobile vs desktop hero, the 5-second test criterion. |
| 4 | `03_Features_Showcase.md` | ~3,000 | The 5-screen story (Dashboard, Students, Attendance, Fees, Settings) with feature cards, screenshots, 3 bullet benefits each, "see it live" deep-links; the 7 hidden engines (Search, Reminder, Ledger, Report, Notification, Sync, Security) as a secondary grid; interactive demo embeds; competitor comparison table; the "Apple keynote" pacing rule. |
| 5 | `04_Download_Hub.md` | ~3,200 | Cross-platform download center: platform auto-detection, 5 download cards (Web / macOS / Windows / Android / iOS), icon + version + size + min OS + Download button (Vercel Blob URL) + changelog link + SHA-256 + install guide; "Open web version" prominent CTA; QR code for mobile; download-flow state machine; Vercel Blob bandwidth budget; mirror strategy. |
| 6 | `05_Pricing_and_Plans.md` | ~2,800 | **"Free for everyone, for now" model**: a single public pricing tier (Free — ₹0/mo, every feature, every screen, no card required, free while our backend infra stays free — Vercel Hobby, Turso free, Vercel Blob free); the 250-student soft guidance is **internal infra-cost guidance only** (not a public cap, not a paywall — crossing 250 surfaces a friendly "tell us your story" prompt, all 251+ students keep working); Pro (₹299/mo) and Institute (₹999/mo) are **internal-only future tiers** documented in Appendix A (not shown on the public pricing page until the §1.6 trigger fires); §1.6 cost-anchored pricing model + 5 pricing-evolution triggers (T1–T5) + 60-day notice + grandfather clause; India PPP pricing rationale; payment methods (UPI, cards, netbanking via Razorpay — activate post-trigger); "no card required" signup; trial-to-paid flow (future-state); scholarship program; "minutes-per-day" ROI calculator (Net ROI = full value of time saved, no Buddysaradhi cost to subtract); FAQ cross-link. |
| 7 | `06_FAQ.md` | ~3,000 | 6 categories (Getting Started, Pricing & Billing, Data & Privacy, Sync & Backup, Platforms & Downloads, Account & Security), each 6–10 Q&A pairs in brand voice; accordion UI spec; "still stuck? email hello@buddysaradhi.app" fallback; searchable FAQ; top-5-questions above-the-fold shortlist; cross-links to `10_Security.md`, `09_Backup_and_Import_Export.md`, etc. |
| 8 | `07_CTA_and_Conversion.md` | ~2,800 | 7 CTAs across the page (hero primary, hero secondary, features "see it live", download hub, pricing, FAQ-bottom, footer), each with copy, placement, color, conversion goal; conversion funnel (visit → scroll 50% → click CTA → signup → activate → first student); the two-tap signup target; micro-conversions; A/B testing framework; the "no dark patterns" principle. |
| 9 | `08_Testimonials_and_Social_Proof.md` | ~2,500 | Testimonial card grid (5 tutors — name, city, subject, quote, avatar, student count), video testimonial embeds, 2 long-form case studies, trust logos, "as seen on" row, star ratings (Play Store + App Store aggregate), "join 1,000+ tutors" social proof line, the authenticity rule (real names, real cities, verifiable). |
| 10 | `09_SEO_and_Analytics.md` | ~2,500 | Keyword strategy (private tutor software India, tuition management app, coaching class software), on-page SEO, OpenGraph + Twitter cards, JSON-LD (SoftwareApplication, FAQPage, BreadcrumbList), sitemap.xml, robots.txt, canonical URLs, the no-telemetry-SDK rule (Rule 3, AP-10, TELE-1), Vercel Web Analytics only, GDPR/DPDP compliance note. |
| 11 | `AGENTS.md` | ~1,800 | Handoff: prime directive, file map, copywriting style guide (brand voice), "no dark patterns" rule, stop-and-ask triggers (6), glossary (CAC, LTV, MRR, funnel, CTA, A/B test, PPR, OG, JSON-LD, DPDP), testing protocol (Lighthouse ≥ 95, real-device scroll test, copy review by 2 humans), "done" checklist, cross-reference conventions. |

**Target total:** ≥ 28,000 words across all 11 files. Verified with `wc -w` at the end of every writing session.

---

## 3. The Commercial Funnel

The landing page is a **funnel**, not a brochure. Every section pulls a visitor one step closer to signup or download. The funnel is the AIDA model adapted for a tuition-software buyer who is time-poor, sceptical of school-ERPs, and reachable on a "Free for everyone, for now" price point (paid tiers ₹299/mo / ₹999/mo launch on the §1.6 trigger, internal-only until then).

```
            ┌─────────────────────────────────────────────────────────────┐
            │  AWARENESS                                                  │
            │  - Google search "tuition management app India"             │
            │  - YouTube ad / Instagram reel / WhatsApp forward            │
            │  - Play Store listing while searching "attendance app"       │
            │  - Word of mouth from another tutor                         │
            └─────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
            ┌─────────────────────────────────────────────────────────────┐
            │  INTEREST                                                   │
            │  - Lands on buddysaradhi.app/                                    │
            │  - 5-second test: hero headline + visual + 1 CTA            │
            │  - Scrolls past hero to features section                    │
            │  - Reads "Five screens. Seven engines. One ledger."         │
            └─────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
            ┌─────────────────────────────────────────────────────────────┐
            │  DESIRE                                                     │
            │  - Features showcase confirms it does what they need        │
            │  - Testimonials confirm other tutors use it                 │
            │  - Pricing confirms it is Free for everyone, for now — not ₹29,000/yr      │
            │  - FAQ resolves "is my data safe?" and "does it work        │
            │    offline?" objections                                     │
            └─────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
            ┌─────────────────────────────────────────────────────────────┐
            │  ACTION                                                     │
            │  - Clicks hero CTA "Start free — no card"                   │
            │    OR                                                       │
            │  - Clicks download card (macOS / Windows / Android / iOS)   │
            │    OR                                                       │
            │  - Clicks "Open web version" (redirects to app.buddysaradhi.app) │
            └─────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
            ┌─────────────────────────────────────────────────────────────┐
            │  ONBOARDING                                                 │
            │  - Two-tap signup: email → OTP → empty dashboard            │
            │  - First student added in < 90 seconds (BR-ONBOARD-1)       │
            │  - Day 1: attendance marked, first fee recorded             │
            │  - Day 7: still using it → convert to Pro at 25th student   │
            └─────────────────────────────────────────────────────────────┘
```

The funnel's job is to lose as few visitors as possible at each step. The hero kills bounce (step 1 → 2). The features + testimonials kill scepticism (step 2 → 3). The pricing + FAQ kill price and trust objections (step 3 → 4). The CTAs and download hub make the click frictionless (step 4 → 5). Onboarding is the web app's job, not this page's, but this page sets the expectations that onboarding must satisfy.

---

## 4. Where to Start — Decision Tree

```
                ┌───────────────────────────────────────────┐
                │  What is the task?                        │
                └───────────────────────────────────────────┘
                                  │
   ┌──────────────┬───────────────┼──────────────┬──────────────┐
   ▼              ▼               ▼              ▼              ▼
"I'm writing   "I'm building    "I need to     "I'm wiring   "I'm doing
 hero copy /   the page in      price the      the download  QA / a
 headline /    apps/web/src/    product"       buttons to    conversion
 CTA"          app/(marketing)"                Vercel Blob"  review"

   │            │               │              │              │
   ▼            ▼               ▼              ▼              ▼
 01_Position-  web/07_Landing  05_Pricing     04_Download    07_CTA
 ing.md →      _Page.md (HOW)  _and_Plans    _Hub.md →      _and_Conv
 02_Hero.md →  + this          .md →          deployment/    ersion.md →
 07_CTA.md     directory       12_Business    02_Vercel_     08_Testim
               (WHAT)          _Rules.md      Blob_Build     onials.md
                                §BR-FEE-*      _Storage.md
                                              (HOW)
   │            │               │              │              │
   └────────────┴───────────────┴──────────────┴──────────────┘
                                  │
                                  ▼
                  Always: AGENTS.md (top-level) §2 — 10 non-negotiables
                  Always: 13_UI_Guidelines.md — no indigo/blue accents
                  Always: 12_Business_Rules.md — BR-* IDs for fees, sync, etc.
                  Always: 10_Security.md §17 — TELE-1, no telemetry SDK
```

If after this tree you are still unsure, **stop and ask** — do not improvise. The decision framework at top-level `AGENTS.md` (§13) governs scope; the stop-and-ask triggers in this directory's `AGENTS.md §5` govern safety.

### 4.1 The WHAT ↔ HOW Contract Diagram

The single most important boundary in this directory is the **WHAT ↔ HOW contract** with `web/07_Landing_Page.md`. This diagram is the arbiter when the two disagree.

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  WHAT  (this directory: product/)                                         │
  │  ─────────────────────────────────────────────────────────────────────    │
  │  • The words the hero says.                                              │
  │  • Which 5 screens get feature cards.                                    │
  │  • The ₹0/mo "Free for everyone" price (public surface).                 │
  │  • The ₹299 / ₹999 future-tier prices and the 18% GST treatment           │
  │    (internal Appendix A — activates post-§1.6-trigger).                  │
  │  • The 49 FAQ Q&A pairs (verbatim).                                      │
  │  • The 7 CTAs and their copy / colour / placement / goal.                │
  │  • The 5 named testimonials and the authenticity rule.                   │
  │  • The SEO title tag, meta description, OG copy, JSON-LD payload.        │
  │  • The no-telemetry-SDK rule (Rule 3, AP-10, TELE-1).                    │
  │  • Glass tier per marketing surface (§5.5 coverage map).                 │
  │  • Neumorphic recipe per marketing control (§6.6 coverage map).          │
  │                                                                          │
  │  Surface: buddysaradhi.app/ — what the visitor reads, clicks, scrolls.        │
  └──────────────────────────────────────────────────────────────────────────┘
                                       │
                              contract governs
                                       │
                                       ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  HOW  (sibling directory: web/07_Landing_Page.md)                        │
  │  ─────────────────────────────────────────────────────────────────────    │
  │  • The <h1> JSX tree the headline renders into.                          │
  │  • The <FeatureCard> RSC composition + Intersection Observer fade-in.    │
  │  • The Razorpay redirect + the monthly/yearly toggle Client Island.      │
  │  • The <FAQAccordion> RSC + FUSE.js client-side search island.           │
  │  • The data-cta-id attribute contract + the track() event wiring.        │
  │  • The static-import content contract from src/content/marketing/*.ts.   │
  │  • The generateMetadata impl + opengraph-image.tsx dynamic OG generator. │
  │  • The <Analytics audience="india" /> + DNT-gated mounting.              │
  │  • The .glass / .glass-strong / .glass-faint Tailwind utilities.         │
  │  • The .neumo-raised / .neumo-inset / .neumo-pressed classes.            │
  │                                                                          │
  │  Surface: apps/web/src/app/(marketing)/ — what the engineer ships.       │
  └──────────────────────────────────────────────────────────────────────────┘

   ↑ When the two disagree: product/ wins on CONTENT + INTENT,
     web/07 wins on IMPLEMENTATION MECHANICS.
   ↑ Copy change order: amend product/ FIRST → web/07 consumes via
     scripts/sync-product-content.ts codegen step.
   ↑ Canonical surface IDs: §5.5 (glass coverage map), §6.6 (neumo coverage
     map), §8.* (component vocabulary), §20 (ASCII conventions) — all in
     13_UI_Guidelines.md.
```

This is the contract `web/07_Landing_Page.md §1` ("Why this file exists") restates back to this directory. If you are about to amend a CSS class, a Tailwind utility, or a Framer Motion variant, you are in `web/07`. If you are about to amend copy, prices, FAQs, CTAs, testimonials, or SEO content, you are here. The boundary is sharp because the consequences of blurring it are not: a copy change that lands in `web/07` first bypasses the spec-review gate (`AGENTS.md §7.3` two-human review) and ships unreviewed.

---

## 5. Relationship to `web/07_Landing_Page.md`

This is the most important cross-reference relationship in the directory. **This directory is the WHAT. `web/07_Landing_Page.md` is the HOW.**

| Concern | `product/` (this dir) — the WHAT | `web/07_Landing_Page.md` — the HOW |
|---|---|---|
| Hero headline copy | ✅ Owns the words | ✅ Owns the `<h1>` JSX, the Framer Motion entrance, the gradient text treatment |
| Feature card content | ✅ Owns the 3 bullets, the screenshot choice | ✅ Owns the card layout, the hover state, the deep-link route |
| Download hub CTA copy | ✅ Owns "Download for macOS — 14 MB" | ✅ Owns the `<a href>` to Vercel Blob, the SHA-256 fetch |
| Pricing tier definitions | ✅ Owns Free (₹0/mo, for everyone, single public tier; 250-student soft guidance is internal-only — no paywall); Pro (₹299/mo, internal-only future tier — Appendix A) and Institute (₹999/mo, internal-only future tier — Appendix A); §1.6 trigger + 5 pricing-evolution triggers (T1–T5); grandfather clause | ✅ Owns the single Free card layout (pre-trigger), the 3-tier toggle UI (hidden pre-trigger, renders post-trigger per Appendix A), the Razorpay redirect (503 pre-trigger), the toggle ARIA, the `NEXT_PUBLIC_PAID_TIERS_LIVE` feature flag |
| FAQ content | ✅ Owns every Q&A pair verbatim | ✅ Owns the accordion component, the search filter |
| CTA color choice | ✅ Owns "hero primary = emerald" | ✅ Owns `className="bg-emerald-500/90"` |
| SEO meta tags | ✅ Owns the title tag, meta description, OG copy | ✅ Owns the `<Head>` / `generateMetadata` impl |
| Analytics events | ✅ Owns the event names + when to fire | ✅ Owns the `analytics.track()` calls |
| Platform auto-detect logic | ✅ Owns the UX (highlight Mac card on Mac visitor) | ✅ Owns the `navigator.userAgent` parser |

When the two disagree, this directory wins on **content and intent**; `web/07_Landing_Page.md` wins on **implementation mechanics**. If a copy change is needed, amend this directory first, then update `web/07_Landing_Page.md`. The order matters.

If `web/07_Landing_Page.md` does not yet exist when you read this (e.g., during a fresh repo bootstrap), the contract above is the contract it must satisfy when it is written. As of this revision, `web/07_Landing_Page.md` exists and the contract is enforced in both directions: copy changes land in `product/` first, then `web/07_Landing_Page.md` consumes them via the `scripts/sync-product-content.ts` codegen step described in that file's §3.2.

---

## 6. The Non-Negotiables (Quick Reference)

These come from top-level `AGENTS.md §2` and are binding on every line of landing-page copy and code:

1. **Ledger is append-only.** The landing page must never imply "edit a fee entry." It says "record" and "void." (`12_Business_Rules.md §BR-LED-06`.)
2. **No network calls that process user data** except Turso sync. The landing page itself does not touch user data — it has no user yet. But the download hub's manifest fetch and the changelog fetch must not leak visitor IPs to third parties. (Rule 2, P5.)
3. **No telemetry SDK.** No GA, no Mixpanel, no PostHog, no Sentry, no Hotjar, no Clarity, no FullStory. Only Vercel Web Analytics (aggregate-only). (Rule 3, AP-10, `10_Security.md §17` TELE-1.) This is the most-violated rule on marketing pages industry-wide; it is the most-enforced rule on this page.
4. **Five screens only.** The features section showcases exactly five screens. A 6th card is a stop-and-ask trigger. (Rule 4, P2.)
5. **No indigo/blue primary accents.** Emerald, Cyan, Amber, Flare, Violet on cosmic canvas only. (Rule 5, AP-6, `13_UI_Guidelines.md §1.3`.)
6. **Integer paise, never float.** Pricing is displayed in whole rupees for the marketing page (₹299/mo not ₹299.00 — when paid tiers launch), but the underlying Razorpay amount is `29900` paise integer. Pre-trigger, the price is ₹0/mo (Free for everyone, for now). (`12_Business_Rules.md §BR-M-01`, `§BR-PRC-01`.)
7. **Every mutation writes `sync_outbox`.** Not applicable to the marketing page (no mutations happen here), but the signup → provisioning flow triggered by the hero CTA does. (Rule 7, BR-SYN-01.)
8. **Backups are AES-256-GCM + Argon2id.** The FAQ's "is my data safe?" answer cites this. (`09_Backup_and_Import_Export.md`, BACKUP-1.)
9. **No silent failures.** A download button whose Blob URL 404s must show a typed error toast, not silently fail. (Rule 9, AP-9.)
10. **Accessibility is mandatory.** 44×44px touch targets on every CTA. `prefers-reduced-motion` honoured on the hero animation. (Rule 10, P15.)

---

## 7. Reading Order for a New Marketing Agent

1. This `README.md` (you are here).
2. `AGENTS.md` (this directory) — handoff instructions, copywriting style guide, stop-and-ask triggers.
3. `01_Product_Positioning.md` — value prop, personas, brand voice. Every other file inherits its tone.
4. Top-level `AGENTS.md §2` — the 10 non-negotiables.
5. `13_UI_Guidelines.md` — glass tiers, accent map, no indigo/blue.
6. `02_Hero_and_Above_the_Fold.md` — the first 5 seconds.
7. `03_Features_Showcase.md` — the 5-screen story.
8. `04_Download_Hub.md` — the conversion point for non-web users.
9. `05_Pricing_and_Plans.md` — the India-first pricing.
10. `06_FAQ.md` — objection handling.
11. `07_CTA_and_Conversion.md` — the 7 CTAs and the funnel.
12. `08_Testimonials_and_Social_Proof.md` — social proof.
13. `09_SEO_and_Analytics.md` — discoverability + the no-telemetry rule.

If you only have 30 minutes, read 1, 3, 2, 7, 5. That gives you the value prop, the hero copy, the features story, the download hub, and the pricing — enough to write or review any single section.

---

## 8. Cross-Reference Conventions

Throughout this directory, cross-references take the form:

- `12_Business_Rules.md §BR-FEE-01` — top-level spec, BR ID.
- `00_Vision.md §3` — top-level spec, section number.
- `01_Product_Principles.md P2` — top-level spec, principle ID.
- `web/01_Architecture.md §3` — sibling platform dir, file + section.
- `deployment/02_Vercel_Blob_Build_Storage.md §5` — sibling deployment dir, file + section.
- `AGENTS.md §2` (no path prefix) — the top-level `AGENTS.md`.
- `product/04_Download_Hub.md §3` — this directory, file + section.

All ASCII diagrams render in fixed-width fonts; copy them verbatim into PRs. All code blocks carry a language tag (```tsx, ```bash, ```json, ```yaml). All hex colors come from the bioluminescent palette (Emerald `#00FF9D`, Cyan `#00F0FF`, Amber `#FFB300`, Flare `#FF5E00`, Violet `#B388FF`) or the cosmic canvas (`#0f0c29`, `#24243e`, `#0a0a1a`). **No indigo. No blue.** Any indigo or blue in a code sample is a bug — file it.

---

*This directory is the marketing contract for the public front door. When the live page diverges from this spec, this spec wins — unless this spec is wrong, in which case you amend it first, then the page, then the worklog. The order matters.*

---

## 9. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated, neumorphic controls recipe-annotated, cross-references canonical (`§5.5`, `§6.6`, `§8.*`, `BR-*`, `P*`, `AP-*`). Box widths honour §20.3 rule 2 (80–120 for landing-page sections, 60–80 for components). The file-index decision tree and WHAT↔HOW contract diagram already live in Appendix A and §4.1 respectively; this section adds two new mockups that consolidate the surface-and-control compliance map across all 11 files in the directory.

### 9.1 Design System Reference (§5.5 + §6.6 single rule)

The marketing landing page lives or dies by **one rule**: *glass surfaces for content, neumorphic controls for actions, never invert, never mix* (`13_UI_Guidelines.md §6.6`). The cosmic canvas is the aurora source; glass blurs the aurora behind the cards; neumorphic controls extrude from the same canvas as tactile affordances. The two tables below are the directory-level slice of `§5.5` and `§6.6` — every marketing surface and every marketing control has exactly one tier/recipe, and that tier/recipe is named in the file that owns it.

| Marketing surface (per §5.5) | Glass tier | Owner file |
|---|---|---|
| Hero headline card | `.glass` (5% white, 24px blur) + aurora behind | `product/02 §2.1.1` |
| Feature card | `.glass` + 2px accent left-border (§5.4) | `product/03 §2.0` |
| Pricing card (Free — single public card, v1) | `.glass-strong` + 2px emerald border + inner emerald glow @ 15% | `product/05 §3.4` |
| Pricing card (Pro/Institute — post-trigger only, Appendix A) | `.glass` (renders when `NEXT_PUBLIC_PAID_TIERS_LIVE=true`) | `product/05 Appendix A` |
| Download card (Web/macOS/Windows/Android/iOS) | `.glass` per platform | `product/04 §2.3` |
| Testimonial card | `.glass-faint` (the quote is the content) | `product/08 §2.3` |
| FAQ accordion row | `.glass-faint` band | `product/06 §3.3` |
| Footer | `.glass-faint` sticky | `product/07 §8` |

| Marketing control (per §6.6) | Recipe | Owner file |
|---|---|---|
| Hero primary CTA | `.neumo-raised` + emerald glow | `product/02 §5.1`, `product/07 §2` |
| Hero secondary CTA | `.neumo-raised` (no glow, cyan border) | `product/02 §5.2`, `product/07 §3` |
| Features "See it live" deep-link | `.neumo-raised` ghost (transparent) | `product/03 §7`, `product/07 §4` |
| Download card button | `.neumo-raised` per platform | `product/04 §2.3`, `product/07 §5` |
| Pricing CTA ("Start free →" — single CTA, v1) | `.neumo-raised` + emerald glow | `product/05 §3.2`, `product/07 §6` |
| FAQ "still stuck?" contact | `.neumo-raised` secondary | `product/06 §5`, `product/07 §7` |
| Footer newsletter submit | `.neumo-raised` secondary | `product/07 §8` |
| Monthly/Yearly pricing toggle (hidden pre-trigger) | `.neumo-inset` segmented control — renders only when `NEXT_PUBLIC_PAID_TIERS_LIVE=true` | `product/05 §3.4`, Appendix A |

### 9.2 Marketing Surface Compliance Matrix (NEW)

A single-screen audit grid showing every marketing surface × glass tier × neumo recipe × owner file. This is the artefact the conversion reviewer prints and ticks before sign-off; it is the directory-level projection of `13_UI_Guidelines.md §20.6` (coverage requirement).

```
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  MARKETING SURFACE × GLASS × NEUMO COMPLIANCE MATRIX  (§5.5 + §6.6, §20.3 rule 5)   │
  ├────────────────────────────┬──────────────┬──────────────────────┬──────────────────┤
  │  Section (file)            │  Glass tier  │  Neumo control       │  Owner file §    │
  ├────────────────────────────┼──────────────┼──────────────────────┼──────────────────┤
  │  Hero card                 │  .glass      │  neumo-raised ×2     │  product/02 §2.1 │
  │  Hero aurora-blob canvas   │  (none —     │  —                   │  product/02 §2.2 │
  │                            │   raw canvas)│                     │                  │
  │  Feature card (5 screens)  │  .glass +    │  neumo-raised ghost  │  product/03 §2.0 │
  │                            │  2px accent  │  "See it live"       │                  │
  │  Pricing — Free (single   │  .glass-strong│  neumo-raised        │  product/05 §3.4 │
  │  public card, v1; + emer- │  + emerald   │  emerald glow        │  (Appendix A =   │
  │  ald glow + 2px border)   │  border+glow │  "Start free →"      │  post-trigger)   │
  │  Pricing — Pro/Institute  │  .glass      │  neumo-raised sec.   │  product/05 App.A│
  │  (post-trigger only; hid- │  (hidden     │  ("Upgrade →" CTAs   │  (renders when   │
  │  den pre-trigger)         │  pre-trigger)│  — post-trigger only)│  flag = true)    │
  │  Pricing monthly/yr toggle│  — (control) │  neumo-inset segment │  product/05 §3.4 │
  │  (hidden pre-trigger)     │              │  (post-trigger only)│                  │
  │  Download — Web card       │  .glass      │  neumo-raised (cyan) │  product/04 §2.3 │
  │  Download — macOS card     │  .glass      │  neumo-raised (em.)  │  product/04 §2.3 │
  │  Download — Windows card   │  .glass      │  neumo-raised (cyan) │  product/04 §2.3 │
  │  Download — Android card   │  .glass      │  neumo-raised (em.)  │  product/04 §2.3 │
  │  Download — iOS card       │  .glass      │  neumo-raised (cyan) │  product/04 §2.3 │
  │  Testimonial card (5-up)   │  .glass-faint│  —                   │  product/08 §2.3 │
  │  FAQ accordion row         │  .glass-faint│  neumo-raised ✕      │  product/06 §3.3 │
  │  FAQ "still stuck?" CTA    │  — (control) │  neumo-raised sec.   │  product/06 §5   │
  │  Footer (sticky)           │  .glass-faint│  neumo-raised submit │  product/07 §8   │
  └────────────────────────────┴──────────────┴──────────────────────┴──────────────────┘
   ↑ .glass = 5% white + backdrop-blur(24px) saturate(140%) per §5.1
   ↑ .glass-strong = 8% white + 24px blur + emerald glow (§5.1, §5.4)
   ↑ .glass-faint = 2% white + 8px blur (§5.2) — testimonial/FAQ/footer recede
   ↑ neumo-raised = dual-shadow ±4px on #1a1a3a (§6.1); primary CTA + emerald glow
   ↑ neumo-inset = inset dual-shadow (§6.2); segmented control well
   ↑ Aurora-blob canvas = the raw cosmic gradient #0f0c29 → #24243e → #0a0a1a (§2.2);
     glass blurs the aurora behind the cards (no glass-on-glass per §5.3)
   ↑ Every accent colour is NAMED (emerald/cyan/amber/flare/violet) per §20.3 rule 6
   ↑ Every CTA ≥ 44×44px hit area per §10.2 (BR-UI-04, Rule 10, P15)
```

### 9.3 WHAT↔HOW Compliance Funnel (NEW)

The WHAT↔HOW contract diagram in §4.1 shows the boundary; this mockup shows the *funnel that crosses the boundary*. Every conversion event flows from `product/` (the WHAT — copy, placement, goal) to `web/07` (the HOW — JSX, fetch, analytics). The mockup annotates the seven CTAs at their handoff points so a reviewer can trace any conversion from copy to code in one read.

```
  WHAT  (product/)                                HOW  (web/07_Landing_Page.md)
  ───────────────────────                         ─────────────────────────────────
  ┌───────────────────────────┐                   ┌────────────────────────────────┐
  │  Hero copy + CTA #1       │ ───── contract ─▶ │  <HeroHeadline> RSC +          │
  │  "Start free — no card"   │                   │  <HeroCTA> Client Island       │
  │  emerald glow CTA         │                   │  → /signup route               │
  │  product/02 §3.1, 07 §2   │                   │  web/07 §4                     │
  └───────────────────────────┘                   └────────────────────────────────┘
  ┌───────────────────────────┐                   ┌────────────────────────────────┐
  │  Hero CTA #2              │ ───── contract ─▶ │  <HeroSecondaryCTA>            │
  │  "Watch the 90s tour ▶"   │                   │  → video modal (Vercel Blob)   │
  │  cyan border, no glow     │                   │  web/07 §4.3                   │
  │  product/02 §5.2, 07 §3   │                   └────────────────────────────────┘
  └───────────────────────────┘
  ┌───────────────────────────┐                   ┌────────────────────────────────┐
  │  Features "See it live"   │ ───── contract ─▶ │  <FeatureCard> RSC w/          │
  │  deep-link to /app/04..08 │                   │  IntersectionObserver fade-in  │
  │  product/03 §7, 07 §4     │                   │  web/07 §5                     │
  └───────────────────────────┘                   └────────────────────────────────┘
  ┌───────────────────────────┐                   ┌────────────────────────────────┐
  │  Download hub CTAs (×5)   │ ───── contract ─▶ │  <DownloadCard> RSC +          │
  │  platform cards + SHA-256 │                   │  PlatformDetector Island       │
  │  product/04 §2, 07 §5     │                   │  web/07 §6                     │
  └───────────────────────────┘                   └────────────────────────────────┘
  ┌───────────────────────────┐                   ┌────────────────────────────────┐
  │  Pricing tier CTAs +      │ ───── contract ─▶ │  <PricingCard> RSC +           │
  │  monthly/yearly toggle    │                   │  Razorpay redirect Island      │
  │  product/05 §3, 07 §6     │                   │  web/07 §3.2 (data flow)       │
  └───────────────────────────┘                   └────────────────────────────────┘
  ┌───────────────────────────┐                   ┌────────────────────────────────┐
  │  FAQ "still stuck?" CTA   │ ───── contract ─▶ │  <FAQAccordion> RSC +          │
  │  → mailto:hello@buddysaradhi   │                   │  FUSE.js search Island         │
  │  product/06 §5, 07 §7     │                   │  web/07 §7                     │
  └───────────────────────────┘                   └────────────────────────────────┘
  ┌───────────────────────────┐                   ┌────────────────────────────────┐
  │  Footer newsletter CTA    │ ───── contract ─▶ │  <Footer> + Server Action      │
  │  product/07 §8            │                   │  → Turso DB (no 3rd-party ESP) │
  │                           │                   │  web/07 §11                    │
  └───────────────────────────┘                   └────────────────────────────────┘

   ↑ Every CTA is a .neumo-raised control (§6.6); primary = emerald glow.
   ↑ Conversion events tracked via Vercel Web Analytics only (Rule 3, AP-10,
     TELE-1, BR-REM-09 — no Mixpanel/GA/PostHog/Sentry/Hotjar/Clarity).
   ↑ Analytics events fire on the HOW side; the WHAT side owns the event name
     and trigger conditions (see product/07 §8, product/09 §6.5).
   ↑ When the two disagree: product/ wins on CONTENT + INTENT; web/07 wins on
     IMPLEMENTATION MECHANICS (see §4.1 contract diagram above).
   ↑ All money is integer paise (BR-M-01, Rule 6); every ₹ display formats via
     Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }) per BR-M-02.
```

### 9.4 References (External Design Authorities)

The mockups and the WHAT↔HOW contract in this file synthesise practices from the following public bodies of work. Cite them in PR review when a contributor asks "why this rule?".

- **Nielsen Norman Group** — *Conversion Funnel Analysis* and *User Segmentation for SaaS*. The 7-CTA skeleton (§9.3) and the persona-targeted copy chain follow NN/g's research on funnel clarity and segment-first copy.
- **Baymard Institute** — *Pricing Page UX* and *Checkout Usability*. The no-card-at-signup rule (§4.1, §9.3) and the single-tier-zero-asterisks rule (referenced from `product/05 §1`) are Baymard-anchored.
- **Smashing Magazine** — *Hero Design Patterns* and *FAQ UX*. The hero card glass tier (§9.2) and the FAQ `.glass-faint` row tier follow Smashing's research on content-first surfaces.
- **Apple Human Interface Guidelines** — *Marketing Surfaces* and *Tactile Foundations*. The glass-on-cosmic + neumorphic-control split (`§5.5` + `§6.6` of `13_UI_Guidelines.md`) is Apple-HIG-derived.
- **A List Apart** — *Content Strategy for the Web*. The WHAT↔HOW contract (§4.1, §9.3) — copy lives upstream of code, codegen syncs the two — follows ALA's content-strategy-first doctrine.
- **Google Search Central** — *JSON-LD Structured Data* and *OpenGraph*. The seven-CTA event chain in §9.3 must align with the JSON-LD `SoftwareApplication` schema in `product/09 §4.1`.
- **Vercel Web Analytics docs** — *Privacy-Respecting Analytics*. The "no telemetry SDK" rule applied to every CTA in §9.3 is Vercel-docs-anchored (Rule 3, AP-10, TELE-1).

---

## Appendix A — File-Index Decision Tree (ASCII)

A single-screen index of every file in this directory and the canonical question it answers. Print this and tape it to your monitor.

```
                            ┌─────────────────────────────┐
                            │  product/ — the WHAT side    │
                            │  of the Buddysaradhi front door   │
                            └─────────────────────────────┘
                                          │
       ┌──────────────┬────────────┬──────┴──────┬─────────────┬─────────────┐
       ▼              ▼            ▼             ▼             ▼             ▼
  README.md     01_Positioning  02_Hero      03_Features   04_Download   05_Pricing
  orientation   value prop +    5-second     5 screens +   5 platform    1 Free card +
  + funnel +    3 personas +    test + CTA   7 engines +   cards +       (₹0/mo for
  WHAT↔HOW      USPs + voice    stack +      deep-link     SHA-256 +     everyone) +
  contract      + India-first   platform-    pattern       QR +          ROI calc +
                market analysis detect swap                install guide scholarship +
                                                                       Appendix A (Pro/Inst.)
       │              │            │             │             │             │
       ▼              ▼            ▼             ▼             ▼             ▼
  06_FAQ        07_CTA          08_Testimonials  09_SEO        AGENTS.md
  6 categories  7 CTAs +        5-tutor grid +   keyword map   handoff +
  49 Q&As +     funnel +        2 case studies   + OG/JSON-LD  style guide +
  searchable    2-tap signup +  + authenticity   + sitemap +   stop-and-ask
  accordion +   no dark         rule +           robots +      triggers +
  "still        patterns         1,000+ tutors    Vercel Web    glossary +
  stuck?" CTA                     line            Analytics     done list
                                          only + DPDP
       │              │            │             │             │
       └──────────────┴────────────┴─────────────┴─────────────┘
                                          │
                                          ▼
                  ┌────────────────────────────────────────────┐
                  │  web/07_Landing_Page.md — the HOW side     │
                  │  RSC + Client Island + PPR + Vercel Blob   │
                  └────────────────────────────────────────────┘

   ↑ Each product/ file owns the WHAT; web/07 §4–§9 owns the HOW.
   ↑ §5.5 (glass coverage map) and §6.6 (neumo coverage map) in
     13_UI_Guidelines.md are the binding surface contracts.
   ↑ All ASCII mockups follow §20 conventions (box width 60–80 for
     components, 80–120 for landing-page sections).
```

## Appendix B — References

The commercial-surface conventions in this directory draw on the following public bodies of practice. Cite them in PR review when a contributor asks "why this rule?".

- **Nielsen Norman Group** — *Conversion Funnel Analysis* and *Social Proof in the User Experience*. The funnel stages in §3 (Awareness → Interest → Desire → Action → Onboarding) and the authenticity rule in `08_Testimonials_and_Social_Proof.md §1` are NN/g-anchored.
- **Baymard Institute** — *Pricing Page Patterns* and *Checkout UX*. The "single tier, zero asterisks" rule in `05_Pricing_and_Plans.md §1` and the no-card-at-signup rule in `07_CTA_and_Conversion.md §10.2` are Baymard-anchored.
- **Smashing Magazine** — *Hero Design* and *FAQ UX Patterns*. The 5-second hero test in `02_Hero_and_Above_the_Fold.md §1` and the single-open accordion in `06_FAQ.md §3.2` follow Smashing's research.
- **Apple Human Interface Guidelines** — *Marketing Surfaces* and *Tactile Foundations*. The glass-on-cosmic + neumorphic-control split (§5.5 + §6.6 of `13_UI_Guidelines.md`) is Apple-HIG-derived.
- **A List Apart** — *Content Strategy* and *SEO Copywriting*. The keyword-tier strategy in `09_SEO_and_Analytics.md §1` and the "every claim cites a spec" rule in `AGENTS.md §0.2` are ALA-anchored.
- **Google Search Central** — *JSON-LD Structured Data*, *OpenGraph*, and *Sitemaps*. The four JSON-LD schemas in `09_SEO_and_Analytics.md §4` and the sitemap/robots/canonical contract in §5 follow Google's canonical documentation.
- **Vercel Web Analytics docs** — *Privacy-Respecting Analytics*. The no-telemetry-SDK rule in `09_SEO_and_Analytics.md §6` and the DNT-honouring pattern in §7.4 are Vercel-docs-anchored.
