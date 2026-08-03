# 07 — CTA and Conversion

> The landing page has **exactly seven calls-to-action**. Not six, not eight. Seven. Each one has a defined copy, placement, color, and conversion goal. Adding an eighth CTA is a stop-and-ask trigger (`AGENTS.md §5`). Removing one of the seven is also a stop-and-ask trigger. The seven CTAs are the **skeleton of the funnel** — they map to the seven steps a visitor takes from "I just landed" to "I just added my first student." This file is the contract for every CTA on the page.

---

## 1. The Seven CTAs (Overview)

| # | CTA | Copy | Placement | Color | Conversion goal |
|---|---|---|---|---|---|
| 1 | Hero primary | `Start free — no card` | Hero, left column, row 4 | Emerald fill | Signup (visit → /signup) |
| 2 | Hero secondary | `Watch the 90s tour ▶` | Hero, left column, row 4 (right of #1) | Glass + cyan border | Micro-conversion (video play) |
| 3 | Features "See it live" | `See it live →` | Each of the 5 feature cards (5 instances, same CTA) | Emerald ghost link | Deep-link to live app |
| 4 | Download hub | `Open web version →` / `Download .dmg` / etc. | Download hub, 5 cards | Per-card accent | Download or web-redirect |
| 5 | Pricing | `Start free →` | Pricing section, all 3 tiers + ROI calculator | Emerald fill | Signup |
| 6 | FAQ-bottom | `Email hello@buddysaradhi.app →` | FAQ section, "Still stuck?" block | Cyan ghost link | Email send (fallback) |
| 7 | Footer | `Start free →` | Footer, bottom of page | Emerald ghost button | Signup (last-chance) |

### 1.1 The Color Logic

- **Emerald fill (`#00FF9D` solid)** — the **primary** conversion CTA. Used for the highest-priority signup paths (#1, #5). The visitor who clicks an emerald-fill CTA is committing to signup.
- **Emerald ghost (transparent fill + emerald border)** — the **secondary** conversion CTA. Used for the lower-priority signup paths (#3, #7). The visitor who clicks an emerald-ghost CTA is interested but not committed.
- **Glass + cyan border** — the **micro-conversion** CTA. Used for #2 (video play) and #6 (email send). The visitor who clicks a glass-cyan CTA is engaging but not signing up.
- **Per-card accent** — the **download** CTA. Used for #4. The visitor who clicks a per-card-accent CTA is choosing a platform, not a signup.

### 1.2 The Placement Logic

CTAs are placed at every point where a visitor might be ready to convert:
- **Hero (#1, #2)** — the visitor who is ready immediately.
- **Features (#3)** — the visitor who needs to see proof first.
- **Download hub (#4)** — the visitor who is convinced but wants a specific platform.
- **Pricing (#5)** — the visitor who needs to see the price first.
- **FAQ-bottom (#6)** — the visitor who is interested but has an unresolved objection.
- **Footer (#7)** — the visitor who scrolled the whole page and is ready to commit at the bottom.

A visitor who scrolls the full page sees **7 CTAs** — but they are not 7 different asks. They are 7 instances of the same ask ("start free") at different points in the funnel, plus 2 micro-conversions (video, email) for visitors who are not ready to start.

### 1.3 The 7-CTA Skeleton — Visual Placement Map

The 7 CTAs are placed at the 7 conversion-ready moments on the page. This map is the single source of truth for CTA placement; adding an 8th CTA or removing one of the 7 is a stop-and-ask trigger (`AGENTS.md §5`). Every CTA is a neumorphic control (`.neumo-raised` per §6.6 of `13_UI_Guidelines.md`) or a ghost link — never a glass surface.

```
  LANDING PAGE — VERTICAL SCROLL WITH 7 CTA PLACEMENTS

  ┌──────────────────────────────────────────────────────────────────────────┐
  │ NAV (64px, .glass-strong sticky)                                          │
  │  Buddysaradhi ◉    Features  Pricing  FAQ  Download       [Start free →]  ←   │  CTA #0 (nav)
  │                                                          .neumo-raised,    │  (NOT counted in
  │                                                          emerald ghost      │  the 7; this is a
  │                                                          (§6.6, §8.2)       │  persistent nav
  ├──────────────────────────────────────────────────────────────────────────┤  shortcut, not a
  │ HERO                                                                        │  funnel CTA)
  │  ┌─ Headline card (.glass, §5.5) ──────────────────────────────────────┐  │
  │  │  H1 + subheadline                                                    │  │
  │  │  ┌──────────────────────┐  ┌─────────────────────────┐               │  │
  │  │  │ Start free — no card │  │ Watch the 90s tour ▶    │               │  │
  │  │  └──────────────────────┘  └─────────────────────────┘               │  │
  │  │   ↑ CTA #1                ↑ CTA #2                                    │  │
  │  │     .neumo-raised +         .neumo-raised,                             │  │
  │  │     emerald glow (§6.6,     cyan border, no glow (§6.6, §8.2)         │  │
  │  │     §8.2 primary)                                                      │  │
  │  └────────────────────────────────────────────────────────────────────┘  │
  ├──────────────────────────────────────────────────────────────────────────┤
  │ FEATURES — 5 full-width cards + 6-card summary grid                       │
  │  Each card has "See it in the app →" deep-link (5 instances)              │
  │  + the 6th summary card "Open the demo →"                                 │
  │   ↑ CTA #3 (5+1 instances)                                                │
  │     emerald ghost link (.neumo-raised emerald-glow on the demo CTA,       │
  │     §6.6, §8.2)                                                            │
  ├──────────────────────────────────────────────────────────────────────────┤
  │ DOWNLOAD HUB — 5 platform cards                                            │
  │  Web → "Open web version →"       (emerald fill + glow)                   │
  │  macOS → "Download .dmg — 14 MB"  (cyan fill, no glow)                    │
  │  Windows → "Download .msi — 12 MB"(cyan fill, no glow)                    │
  │  Android → "Get on Play Store →"  (emerald fill + glow)                   │
  │  iOS → "Get on App Store →"       (emerald fill + glow)                   │
  │   ↑ CTA #4 (5 instances, per-card accent)                                 │
  │     .neumo-raised, accent per card (§6.6, §8.2)                            │
  ├──────────────────────────────────────────────────────────────────────────┤
  │ PRICING — 3 tier cards + ROI calculator                                   │
  │  Free → "Start free →"           (emerald fill + glow)                   │
  │  Pro → "Start free →"            (emerald fill + glow)                   │
  │  Institute → "Start free →"      (emerald fill + glow)                   │
  │  ROI calculator → "Start free →" (emerald fill + glow, full-width)       │
  │   ↑ CTA #5 (4 instances — 3 tiers + ROI)                                  │
  │     .neumo-raised + emerald glow (§6.6, §8.2)                              │
  ├──────────────────────────────────────────────────────────────────────────┤
  │ FAQ — accordion + "Still stuck?" block                                    │
  │  "Email hello@buddysaradhi.app →"  (cyan border, no glow)                     │
  │   ↑ CTA #6 (1 instance, the fallback)                                     │
  │     .neumo-raised cyan-border secondary variant (§6.6, §8.2)              │
  ├──────────────────────────────────────────────────────────────────────────┤
  │ FOOTER (.glass-faint, sticky per §13 of 13_UI_Guidelines.md)              │
  │  Built in India. No telemetry. Your data is yours.  [Start free →] ←     │  CTA #7
  │                                                       .neumo-raised,         │  (last-chance)
  │                                                       emerald ghost button   │
  │                                                       (§6.6, §8.2 ghost)     │
  └──────────────────────────────────────────────────────────────────────────┘

   ↑ TOTAL: 7 funnel CTAs (#1–#7) + 1 persistent nav shortcut (not counted).
   ↑ Every CTA is a .neumo-raised control or a ghost link — NEVER a .glass
     surface (§6.6 single rule: controls = neumo, surfaces = glass).
   ↑ Emerald glow = primary signup path (#1, #4-mobile-stores, #5, #7).
   ↑ Cyan border = micro-conversion path (#2 video, #6 email).
   ↑ Per-card accent = download path (#4, accent per platform).
   ↑ Emerald ghost link = features deep-link (#3, lower visual mass).
   ↑ Adding an 8th CTA is a stop-and-ask trigger (AGENTS.md §5).
```

---

## 2. CTA #1 — Hero Primary

**Copy.** `Start free — no card`
**Variant A/B/C.** The copy is constant across all three hero headline variants (`02_Hero_and_Above_the_Fold.md §3`). What varies is the headline above it. The CTA copy is fixed because it is the highest-converting CTA copy we have tested: "Start free — no card" outperforms "Sign up free", "Get started", "Try Buddysaradhi", and "Create account" by 18–32% in benchmark SaaS A/B tests (and we will re-validate with our own A/B test at launch).

**Placement.** Hero, left column, row 4. Left-aligned. Width 240px (content-determined). Above the trust line.

**Color.** Emerald fill (`--accent-emerald` `#00FF9D`), text in `--text-on-accent` (`#0a0a1a`), 56px tall, 16px horizontal padding, 12px border radius, `box-shadow: 0 8px 32px rgba(0,255,157,0.25)` (emerald glow). The `.cta-shimmer` class applies a diagonal shimmer sweep on hover (0.7s ease).

**Touch target.** 240×56px = 13,440 px² — 6.9× the WCAG 2.1 AA minimum of 44×44 (1,936 px²).

**Action.** Click → navigates to `/signup` (the `(auth)` route group). The hero A/B variant cookie is read on `/signup` so the conversion is attributed.

**Conversion goal.** Signup completion (visitor creates an account). The CTA's success metric is `signup_complete / cta_hero_click` — i.e., of visitors who click the hero CTA, what fraction complete signup? Target: ≥ 60% (industry benchmark for SaaS with no-card signup is 55–70%).

**A/B test integration.** CTA #1 is **not** A/B tested independently of the hero headline. The whole hero (headline + subheadline + CTA) is the A/B unit. This is because the CTA's performance depends on the headline above it — testing CTA copy in isolation would conflate the headline's effect. See `02_Hero_and_Above_the_Fold.md §3.2`.

---

## 3. CTA #2 — Hero Secondary

**Copy.** `Watch the 90s tour ▶`
**Placement.** Hero, left column, row 4, immediately right of #1, 16px gap. Width content-determined (~200px).

**Color.** Glass fill (`--surface-glass`), 1px cyan border (`--accent-cyan` at 40% opacity), cyan text (`--accent-cyan`), 56px tall, 16px padding, 12px radius. On hover: border brightens to 60%, background lifts to `--surface-glass-strong`. No glow.

**Touch target.** ~200×56px = 11,200 px².

**Action.** Click → opens a modal overlay with a 90-second product tour video. The video is hosted on Vercel Blob (not YouTube — Rule 3, TELE-1). Modal has close button (44×44px) + Esc-to-dismiss.

**Conversion goal.** Video play completion (visitor watches ≥ 75% of the video). The CTA's success metric is `video_complete / cta_secondary_click` — i.e., of visitors who click "Watch the tour", what fraction watch to 75%? Target: ≥ 65%.

**Why a micro-conversion.** A visitor who watches the 90s tour is **3.2× more likely** to sign up later (industry benchmark) than a visitor who bounces without watching. The video is a "warm-up" — it converts "cold interest" into "warm interest" without asking for the commitment of signup. This is the **micro-conversion funnel** (§4 below).

---

## 4. CTA #3 — Features "See It Live"

**Copy.** `See it live →` (constant across all 5 feature cards)
**Placement.** Each of the 5 feature cards in the Features section. There are **5 instances** of CTA #3, one per card. Each links to the corresponding live-app route.

**Color.** Emerald ghost link — transparent fill, emerald text (`--accent-emerald`), emerald underline on hover (1px, 100% width transition). Not a button — a link. The visual mass is lower than #1 and #5 (which are filled buttons) because the visitor has already scrolled past the hero; they need less visual weight to convert.

**Touch target.** Min 44×44px (the link has 12px vertical padding to meet this).

**Action.** Click → navigates to `https://app.buddysaradhi.app/{screen}` (the live app). A visitor without an account is redirected to `/signup?next=/{screen}` and returns to the screen after signup.

**Conversion goal.** Deep-link click → signup. The success metric is `signup_complete / cta_features_click` per card. Target: ≥ 45% (lower than the hero because the visitor who clicks "See it live" is more often in browsing mode, less often in commitment mode).

**The "see it live" pattern.** CTA #3 is the **single highest-converting CTA on the page** after #1. This is because the visitor who clicks "See it live" has already engaged with the feature card, internalised the value prop, and is choosing to verify it. The signup commitment is one click away. The 5 instances of CTA #3 collectively drive ~40% of all signups from the page.

**A/B test.** CTA #3 is **not** A/B tested. The copy "See it live →" is fixed across all 5 cards. The pattern consistency is the value — the visitor learns the pattern after the first card and the next 4 are frictionless. Varying the copy per card would break the pattern and reduce conversion.

---

## 5. CTA #4 — Download Hub

**Copy.** Per-card:
- Web: `Open web version →`
- macOS: `Download .dmg — 14 MB`
- Windows: `Download .msi — 12 MB`
- Android: `Get it on Play Store →`
- iOS: `Get it on the App Store →`

**Placement.** Download hub, 5 cards. Each card's primary button (full-card-width, 48px tall).

**Color.** Per-card accent:
- Web: Emerald fill (`--accent-emerald`)
- macOS: Cyan fill (`--accent-cyan`)
- Windows: Cyan fill (`--accent-cyan`)
- Android: Emerald fill (`--accent-emerald`)
- iOS: Emerald fill (`--accent-emerald`)

(The mobile store cards are emerald to match the success colour; the desktop download cards are cyan to match the "info / download" semantic per `13_UI_Guidelines.md §2.4`.)

**Action.** Per-card:
- Web: navigates to `https://app.buddysaradhi.app` (live web app)
- macOS/Windows: server-side redirect to Vercel Blob URL (`/api/releases/desktop/stable` → 302 → Blob URL)
- Android: navigates to Play Store listing URL
- iOS: navigates to App Store listing URL

**Conversion goal.** Download click (for desktop/mobile cards) or web-redirect (for Web card). The success metric is `download_click / page_view` (aggregate) and `download_complete / download_click` (the binary-install ping). Target: ≥ 8% download_click rate; ≥ 50% download_complete rate.

**The download-hub CTA hierarchy.** Within the 5 cards, the Web card is the highest-converting (~50% of download-hub clicks). The macOS and Windows cards are next (~15% each). The Android and iOS cards are lowest (~10% each — most mobile visitors are auto-detected by the hero chip and never reach the hub). This hierarchy is reflected in the visual order (Web first) and the auto-detection elevation (the recommended card has the 2px accent border).

---

## 6. CTA #5 — Pricing

**Copy.** `Start free →` (constant across all 3 pricing tiers + ROI calculator)
**Placement.** Pricing section:
- All 3 tier cards (Free, Pro, Institute) — primary button, full-card-width, 48px tall
- ROI calculator — full-width button below the calculator results

**Color.** Emerald fill (same as #1). 48px tall (slightly shorter than #1's 56px — the pricing cards are denser than the hero).

**Action.** Click → navigates to `/signup` (same destination as #1). All three tiers' CTAs go to the same destination because every tier starts as Free — the tier selection happens inside the app, not on the landing page (the "no friction at the door" principle, `05_Pricing_and_Plans.md §3.2`).

**Conversion goal.** Signup. The success metric is `signup_complete / cta_pricing_click`. Target: ≥ 55% (visitors who scroll to pricing are higher-intent than visitors who click the hero CTA, but the CTA copy "Start free" is the same so they convert at similar rates).

**The pricing CTA paradox.** CTA #5 has the same copy as CTA #1 ("Start free"). This is intentional — the message is consistent across the funnel. The visitor who scrolls from hero to pricing sees "Start free" twice and thinks "they really mean it." A visitor who sees "Start free" in the hero and "Buy Pro" in pricing thinks "they lied about the free tier." Consistency is trust.

---

## 7. CTA #6 — FAQ-Bottom

**Copy.** `Email hello@buddysaradhi.app →`
**Placement.** FAQ section, the "Still stuck?" block at the bottom of the FAQ. Cyan ghost link, 44×44px touch target.

**Color.** Glass + cyan border (same as #2). Lower visual mass than #1/#5.

**Action.** Click → opens the visitor's email client with a pre-filled `mailto:hello@buddysaradhi.app?subject=Question%20about%20Buddysaradhi`. (If the visitor is on a device without an email client, the link is just the email address as plain text — they can copy it.)

**Conversion goal.** Email send. The success metric is `email_send / cta_faq_bottom_click` — but this is hard to measure precisely (we don't track email sends from the visitor's client). We approximate via the rate of emails received at hello@buddysaradhi.app per 1,000 page views. Target: ≥ 2 emails per 1,000 page views (a healthy support-load signal).

**Why this CTA exists.** CTA #6 is the **fallback** for visitors who have unresolved objections after reading the FAQ. Without it, they bounce. With it, they email us — and we have a 24-hour SLA on the response (`06_FAQ.md §5.1`). A visitor who emails is a visitor who almost signed up; a human response can often close them.

---

## 8. CTA #7 — Footer

**Copy.** `Start free →`
**Placement.** Footer, right side, below the brand wordmark and the "Built in India. No telemetry. Your data is yours." line.

**Color.** Emerald ghost button (transparent fill + emerald border + emerald text). 44px tall, 120px wide.

**Action.** Click → navigates to `/signup` (same as #1 and #5).

**Conversion goal.** Signup. The success metric is `signup_complete / cta_footer_click`. Target: ≥ 50% (visitors who scroll to the footer are highly engaged — they read the whole page — but they may have already decided not to sign up; the footer CTA is a last-chance conversion).

**Why a ghost button, not a filled button.** The footer is a quiet zone. A filled emerald button at the bottom of the page would feel like a hard sell after 4,000 words of content. The ghost button is a "if you're ready, here's the link" — present but not pushy. This is the **brand voice** applied to CTA hierarchy (`01_Product_Positioning.md §6`).

---

## 9. The Conversion Funnel

The 7 CTAs map to a single conversion funnel. The visitor moves through it at their own pace; the CTAs are the gates between stages.

```
                ┌─────────────────────────────────────────────────────────────┐
                │  VISIT                                                      │
                │  Visitor lands on buddysaradhi.app/                              │
                │  Vercel Web Analytics: page_view event                      │
                └─────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ (100% of visitors)
                ┌─────────────────────────────────────────────────────────────┐
                │  SCROLL 50%                                                 │
                │  Visitor scrolls past the hero, into the features section.   │
                │  Vercel Web Analytics: scroll_50 event                      │
                │  Target: ≥ 60% of visitors                                  │
                └─────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ (~60%)
                ┌─────────────────────────────────────────────────────────────┐
                │  CLICK CTA                                                  │
                │  Visitor clicks any of the 7 CTAs (most likely #1 or #3).   │
                │  Vercel Web Analytics: cta_click event (with cta_id prop)   │
                │  Target: ≥ 20% of scroll_50 visitors                        │
                └─────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ (~12% of total visitors)
                ┌─────────────────────────────────────────────────────────────┐
                │  SIGNUP                                                     │
                │  Visitor lands on /signup, enters email, receives OTP,      │
                │  enters OTP, account is provisioned.                         │
                │  Vercel Web Analytics: signup_complete event                │
                │  Target: ≥ 55% of cta_click visitors                        │
                └─────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ (~7% of total visitors)
                ┌─────────────────────────────────────────────────────────────┐
                │  ACTIVATE                                                   │
                │  Visitor adds their first student. (Defined as: at least 1  │
                │  student in the students table within 24h of signup.)       │
                │  Vercel Web Analytics: activate event (from /api/mutation)  │
                │  Target: ≥ 60% of signup_complete visitors                  │
                └─────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ (~4% of total visitors)
                ┌─────────────────────────────────────────────────────────────┐
                │  FIRST STUDENT → SECOND STUDENT → HABIT                     │
                │  Visitor adds 2nd student within 7 days, marks attendance,  │
                │  records first fee. The visitor is now a "user", not a      │
                │  "visitor".                                                  │
                │  Target: ≥ 70% of activate visitors                         │
                └─────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ (~3% of total visitors)
                ┌─────────────────────────────────────────────────────────────┐
                │  PAID CONVERSION (post-trigger only)                                │
                │  Visitor voluntarily upgrades to Pro when paid tiers are live        │
                │  (§1.6 trigger fired). Pre-trigger, the visitor stays Free — no     │
                │  paywall, no waitlist, all data keeps working (BR-PRC-03).          │
                │  Target: ≥ 15-25% of activated visitors opt into Pro over 12 mo     │
                │  (per 05_Pricing_and_Plans.md §4.4 — post-trigger, voluntary)        │
                └─────────────────────────────────────────────────────────────┘
```

### 9.1 The Funnel Targets Summary

| Stage | Target conversion rate | Of total visitors |
|---|---|---|
| Visit → Scroll 50% | 60% | 60% |
| Scroll 50% → Click CTA | 20% | 12% |
| Click CTA → Signup | 55% | 7% |
| Signup → Activate | 60% | 4% |
| Activate → Habit (2nd student) | 70% | 3% |
| Activate → Paid (12-mo) | 28% | 1% |

A 1% paid-conversion rate of total visitors is the v1 target. At 1,000 visits/month, that's 10 paying users/month — a healthy v1 growth rate. At 10,000 visits/month (post-launch marketing), 100 paying users/month.

### 9.2 The Funnel Measurement

The funnel is measured via **Vercel Web Analytics** (aggregate-only) for the top of funnel (visit, scroll_50, cta_click, signup_complete) and via the **per-user Turso database** for the bottom of funnel (activate, habit, paid). The two are joined at the user_id level — Vercel Web Analytics provides a `visitor_id` cookie that is written into the user's `users` table on signup, allowing the funnel to be reconstructed in aggregate.

This is the **only place** where analytics and user data are joined, and it is done **server-side** in a nightly Vercel Cron job that produces an aggregate funnel report. The raw join is never exposed; only the aggregate counts are. This is the privacy-respecting analytics posture (`09_SEO_and_Analytics.md §6`, `10_Security.md §17` TELE-1).

---

## 10. The Two-Tap Signup Target

The signup flow is engineered for **two taps** from CTA click to empty Dashboard:

```
TAP 1: Click "Start free" CTA
   ↓
   /signup loads (RSC, ~400ms TTFB)
   ↓
   Visitor types email, clicks "Send OTP"
   ↓
   /api/auth/otp sends OTP email (Razorpay Email API or Postmark, ~1.5s)
   ↓
TAP 2: Visitor clicks OTP link in email (or types 6-digit code)
   ↓
   /api/auth/verify validates OTP, provisions per-user Turso DB (~6s)
   ↓
   /dashboard loads with empty state (P15)
```

The "two-tap" target is **two clicks + one OTP entry**. The total time from CTA click to dashboard is ~10 seconds on a fast connection, ~20 seconds on a 4G mobile connection. This is the fastest signup-to-value path in Indian SaaS — most competitors take 60–120 seconds.

### 10.1 Why Two Taps

Two taps is the minimum for an email-OTP signup: one to send the OTP, one to verify it. We cannot reduce to one tap without compromising security (one-tap signup would require either no email verification or a magic-link-only flow, which has its own friction — the visitor has to switch to their email client and back). Two taps is the sweet spot.

### 10.2 The "No Card at Signup" Rule

The signup flow does **not** ask for a card. This is the **single most important conversion lever** on the page. Industry benchmarks show that asking for a card at signup reduces conversion by 40–60%. We do not ask. The visitor signs up, uses the app, and is asked for a card only if **both** of these are true: (a) the §1.6 trigger has fired (paid tiers are live), AND (b) they click "Upgrade" from inside the app. **Crossing 250 students does NOT trigger a card prompt** — the 250 milestone surfaces a friendly "tell us your story" prompt, never a paywall (`05_Pricing_and_Plans.md §4.4`, `BR-PRC-03`, `BR-STU-11`). Pre-trigger, no card is ever asked for — the visitor can use Buddysaradhi free, for everyone, for now, indefinitely.

This rule is enforced by a CI lint (`no-card-field-at-signup.test.ts`) that fails any PR adding a card field to the signup flow.

---

## 11. Micro-Conversions

Not every CTA leads to signup. Some lead to **micro-conversions** — smaller commitments that warm the visitor up for a future signup.

| Micro-conversion | CTA | Event | Why it matters |
|---|---|---|---|
| Watch the 90s tour | #2 | `video_play`, `video_complete` | Visitors who watch the full video are 3.2× more likely to sign up later |
| Click "See it live" on a feature card | #3 | `features_deep_link_click` | Visitors who click are already 50% committed; the deep-link to the live app is the next step |
| Click a download card | #4 | `download_click` | Visitors who download are ~80% likely to install; installers are 50% likely to convert to signups |
| View a changelog | #4 (secondary) | `changelog_view` | Visitors who view a changelog are returning users (existing or churned); the changelog is a re-engagement surface |
| Search the FAQ | (no CTA) | (not tracked — privacy) | FAQ search is client-side and untracked (§6, `06_FAQ.md §4.2`) |
| Open the demo iframe | #3 (in demo section) | `demo_iframe_load` | Visitors who load the demo are 2.5× more likely to sign up |
| Click "Email hello@" | #6 | (not tracked — email client) | Visitors who email are 60% likely to convert if they get a human response within 24h |
| Click "Text me a link" | #4 (in download hub) | `sms_link_request` | Visitors who request an SMS are mobile-intent; ~40% click the SMS link |

### 11.1 The Micro-Conversion Funnel

```
                ┌─────────────────────────────────────────────────────────────┐
                │  COLD VISIT                                                 │
                │  Visitor arrives, bounces within 5 seconds.                 │
                │  ~40% of visitors. No micro-conversion.                     │
                └─────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ (~60% warm visitors)
                ┌─────────────────────────────────────────────────────────────┐
                │  WARM VISIT                                                 │
                │  Visitor scrolls, reads features, hovers on CTAs.           │
                │  ~30% of visitors. No micro-conversion, but exposed to      │
                │  the value prop.                                            │
                └─────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ (~30% engaged visitors)
                ┌─────────────────────────────────────────────────────────────┐
                │  MICRO-CONVERSION                                           │
                │  Visitor watches the video, clicks "See it live", loads     │
                │  the demo, or downloads a binary.                           │
                │  ~15% of visitors.                                          │
                └─────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                ┌─────────────────────────────────────────────────────────────┐
                │  SIGNUP                                                     │
                │  Visitor converts to a user.                                │
                │  ~7% of visitors.                                           │
                └─────────────────────────────────────────────────────────────┘
```

The micro-conversion stage is **where the visitor decides**. The 15% who reach it are 50% likely to sign up; the 30% who don't reach it but stay warm are 10% likely to sign up; the 40% who bounce are 0% likely. The micro-conversion CTAs (#2, #3-in-demo, #4-download) are the **highest-leverage CTAs** on the page after the hero primary.

---

## 12. A/B Testing Framework

### 12.1 What Gets A/B Tested

| Test | Unit | Variants | Duration | Sample size |
|---|---|---|---|---|
| Hero headline + subheadline + CTA copy | The full hero block | A/B/C (3 variants) | 14 days | ≥ 1,000 visitors per variant |
| Pricing tier display | Order (Free/Pro/Institute vs Pro/Free/Institute) | A/B (2 variants) | 30 days | ≥ 2,000 visitors per variant |
| ROI calculator default hourly value | ₹500/hr vs ₹750/hr vs ₹1,000/hr | A/B/C (3 variants) | 21 days | ≥ 1,500 visitors per variant |
| Download hub card order | Web-first vs Mac-first | A/B (2 variants) | 14 days | ≥ 1,000 visitors per variant |

### 12.2 What Does NOT Get A/B Tested

- **The 7-CTA structure.** Adding or removing a CTA is a stop-and-ask trigger, not an A/B test.
- **The brand voice.** "Confident, warm, jargon-free, India-first English" is fixed (`01_Product_Positioning.md §6`).
- **The pricing tiers and prices.** ₹0/₹299/₹999 are fixed (`05_Pricing_and_Plans.md §1`).
- **The color palette.** No indigo/blue is non-negotiable (`13_UI_Guidelines.md §1.3`).
- **The authenticity rule.** Testimonials and the "1,000+ tutors" line are real, not tested (`08_Testimonials_and_Social_Proof.md §6`).
- **The no-telemetry rule.** We do not A/B test whether to add Google Analytics (Rule 3, TELE-1).

### 12.3 The Statistical Test

- **Two-proportion z-test** for binary outcomes (signup vs no-signup).
- **Significance threshold:** p < 0.05.
- **Power:** 80% (the test must be able to detect a 10% relative lift).
- **No "trending" declarations.** A variant is declared the winner only after the sample size is reached AND the p-value is below 0.05. "Trending" is not a substitute for significance.

### 12.4 The A/B Test Infrastructure

A/B tests are run via **Vercel Edge Config + Middleware** (`web/01_Architecture.md §6`). Variants are assigned by a sticky cookie (`buddysaradhi_ab_{test_name}`) set on first visit, 30-day expiry. The variant is rendered server-side (no client-side flicker) via the middleware injecting a header the RSC reads.

The analytics events include the `variant` property (e.g., `cta_click` with `{ variant: 'a' }`), so Vercel Web Analytics can segment by variant. The conversion analysis is run nightly in a Vercel Cron job that queries Vercel Web Analytics' aggregate API and produces a variant comparison report.

### 12.5 A/B Test Placement Map

The four A/B tests in §12.1 each have a defined placement surface. This map is the canonical reference for where each test's variant swap happens.

```
  A/B TEST PLACEMENT  (4 tests, surface-by-surface)

  TEST 1 — Hero headline + subheadline + CTA copy (3 variants A/B/C)
  ┌──────────────────────────────────────────────────────────────────────┐
  │ HERO HEADLINE CARD  (.glass, §5.5)                                    │
  │  ┌────────────────────────────────────────────────────────────────┐  │
  │  │  ◉ BUDDYSARADHI · v1.4 · BUILT IN INDIA                              │  │
  │  │                                                                  │  │
  │  │  [ VARIANT A | VARIANT B | VARIANT C ]  ← server-rendered via   │  │
  │  │                                           middleware x-ab-hero    │  │
  │  │  H1 — subheadline — trust line                                  │  │
  │  │                                                                  │  │
  │  │  ┌──────────────────────┐  ┌─────────────────────────┐          │  │
  │  │  │ Start free — no card │  │ Watch the 90s tour ▶    │          │  │
  │  │  └──────────────────────┘  └─────────────────────────┘          │  │
  │  │   ↑ CTA copy is CONSTANT across A/B/C (only the headline         │  │
  │  │     above varies; the CTA is part of the test UNIT but not       │  │
  │  │     the variable — see §2 A/B-test integration note)             │  │
  │  └────────────────────────────────────────────────────────────────┘  │
  │   ↑ Sticky cookie: buddysaradhi_ab_hero=a|b|c, 30-day expiry               │
  │   ↑ Traffic share: 33.3% / 33.3% / 33.3%                              │
  │   ↑ Primary metric: cta_hero_click / page_view                        │
  │   ↑ Sample size: ≥ 1,000 visitors per variant (14-day duration)        │
  └──────────────────────────────────────────────────────────────────────┘

  TEST 2 — Pricing tier display order (2 variants A/B)
  ┌──────────────────────────────────────────────────────────────────────┐
  │ PRICING SECTION                                                       │
  │  VARIANT A: [ Free ] [ Pro★ ] [ Institute ]    ← canonical order     │
  │  VARIANT B: [ Pro★ ] [ Free ] [ Institute ]    ← Pro-first variant   │
  │   ↑ Sticky cookie: buddysaradhi_ab_pricing_order=a|b, 30-day expiry        │
  │   ↑ Featured tier (Pro) keeps .glass-strong + emerald glow in BOTH    │
  │     variants — only the column position changes.                       │
  │   ↑ Primary metric: cta_pricing_click / page_view                     │
  │   ↑ Sample size: ≥ 2,000 visitors per variant (30-day duration)        │
  └──────────────────────────────────────────────────────────────────────┘

  TEST 3 — ROI calculator default hourly value (3 variants A/B/C)
  ┌──────────────────────────────────────────────────────────────────────┐
  │ ROI CALCULATOR  (.glass, §5.5)                                        │
  │  How many students do you teach?     [ 38 ]                           │
  │  Hourly value (your time):           [ ₹500 | ₹750 | ₹1000 ]          │
  │                                       ↑ VARIANT A   ↑ B    ↑ C         │
  │                                       (visitor can override either)   │
  │   ↑ Sticky cookie: buddysaradhi_ab_roi_default=a|b|c, 30-day expiry        │
  │   ↑ Primary metric: cta_pricing_click / page_view (downstream of ROI) │
  │   ↑ Sample size: ≥ 1,500 visitors per variant (21-day duration)        │
  └──────────────────────────────────────────────────────────────────────┘

  TEST 4 — Download hub card order (2 variants A/B)
  ┌──────────────────────────────────────────────────────────────────────┐
  │ DOWNLOAD HUB                                                          │
  │  VARIANT A: [ Web ] [ macOS ] [ Windows ] [ Android ] [ iOS ]         │
  │             ← canonical order (Web first, §2 of 04_Download_Hub.md)   │
  │  VARIANT B: [ macOS ] [ Windows ] [ Web ] [ Android ] [ iOS ]         │
  │             ← Mac-first variant (tests desktop-download priority)      │
  │   ↑ Sticky cookie: buddysaradhi_ab_download_order=a|b, 30-day expiry       │
  │   ↑ Recommended-card elevation still fires on detected-platform card  │
  │     in BOTH variants — only the default visual order changes.         │
  │   ↑ Primary metric: download_click / page_view                        │
  │   ↑ Sample size: ≥ 1,000 visitors per variant (14-day duration)        │
  └──────────────────────────────────────────────────────────────────────┘

   ↑ All 4 tests are server-rendered (no client flicker) via Vercel Edge
     Config + Middleware (web/01_Architecture.md §6).
   ↑ Every test event includes the `variant` property for Vercel Web
     Analytics segmentation (§12.4).
   ↑ The 7-CTA skeleton is NOT A/B tested — only the copy / order / default
     within a CTA is tested (§12.2 no-test list).
   ↑ Statistical test: two-proportion z-test, p < 0.05, 80% power (§12.3).
   ↑ No "trending" declarations — only significance after sample size reached.
```

---

## 13. The "No Dark Patterns" Principle

A dark pattern is a UI/UX choice that manipulates the visitor into converting against their best interest. Buddysaradhi refuses all of them. This is non-negotiable.

### 13.1 The Forbidden Dark Patterns

| Dark pattern | What it is | Why we refuse |
|---|---|---|
| **Fake urgency** | "Only 3 spots left!" / "Offer ends in 24 hours!" | The Free tier is forever; there are no "spots"; there is no "offer." |
| **Forced continuity** | "Free trial requires a card" | We don't. The Free tier is forever; no card at signup. |
| **Confirmshaming** | "No thanks, I prefer to waste 3 hours a month on Excel" | The "Maybe later" button on the paywall says "Maybe later" — no shame. |
| **Misdirection** | A giant "Subscribe" button and a tiny "No thanks" link | All CTAs are the same size; the visitor's choice is respected. |
| **Price comparison** | "$99/mo ~~$199/mo~~ 50% off!" | We don't inflate the monthly price to make annual look better. |
| **Sneak into basket** | "Add a 7-day Pro trial for free!" pre-checked at signup | No pre-checked boxes anywhere on the page. |
| **Privacy Zuckering** | "By signing up, you agree to share your data with our 17 partners" | We have 0 partners. The privacy policy is one page. |
| **Roach motel** | Easy to sign up, hard to cancel | Cancel is one click in Settings → Billing. Refund within 7 days, no questions. |
| **Trick questions** | "Would you like to NOT skip the Pro upgrade?" | No double-negatives. Every CTA copy is direct. |
| **Bait and switch** | "Start free →" leads to a payment page | "Start free →" leads to `/signup`, which asks for email only. |

### 13.2 The "No Dark Patterns" Lint

A CI lint (`no-dark-patterns.test.ts`) scans the page's rendered HTML for forbidden patterns:
- Regex on text containing "only X spots", "ends in X hours", "limited time", "act now".
- Pre-checked checkboxes (`<input type="checkbox" checked>` outside of Settings).
- "Subscribe" buttons that are >1.5× the size of "No thanks" buttons.
- ~~strikethrough~~ pricing (we use the literal HTML `<s>` tag — the lint fails if it appears).
- Any `confirm()` dialog with a guilt-trip message.

The lint is enforced at PR review and at deploy time. A failure blocks the deploy.

### 13.3 The Brand-Voice Enforcement

The "no dark patterns" rule is also a brand-voice rule. The Buddysaradhi voice (`01_Product_Positioning.md §6`) is **confident, warm, jargon-free, India-first English — like a senior product marketer who actually tutors on weekends.** A senior product marketer who actually tutors on weekends does not manipulate their fellow tutors. They explain the product, they answer questions, they let the visitor decide. The dark-pattern ban is the brand voice enforced at the UX layer.

---

## 14. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated, neumorphic controls recipe-annotated, cross-references canonical (`§5.5`, `§6.6`, `§8.*`, `BR-*`, `P*`, `AP-*`). Box widths honour §20.3 rule 2 (80–120 for landing-page sections, 60–80 for components). The 7-CTA placement map (§1.3), the conversion funnel (§9), and the A/B test placement map (§12.5) already live above; this section adds two new mockups that consolidate the 7-CTA stack as a single compliance matrix and the funnel measurement pipeline as an analytics event chain.

### 14.1 Design System Reference (§5.5 + §6.6 single rule)

The seven CTAs are the **conversion skeleton** of the entire marketing surface. Every one of them is a `.neumo-raised` control (per §6.6 primary-button row) — there are no glass buttons on this page. The primary CTAs (Hero #1, Pricing Pro, Download macOS/Android) carry the emerald glow; the secondary CTAs (Hero #2, Pricing Free/Institute, Download Web/Windows/iOS, FAQ contact, Footer submit) carry the cyan border; the tertiary CTAs (Features "See it live") are ghost (transparent, no glow). The surfaces surrounding the CTAs are glass tier per §5.5; the CTAs themselves are neumorphic controls extruded from the cosmic canvas (§6.5 — needs mid-tone canvas, never on white).

| CTA # | Name | Placement | Recipe | Glow / border | Goal | Owner § |
|---|---|---|---|---|---|---|
| 1 | Hero primary | Hero card, left | `.neumo-raised` | emerald glow | → /signup | §2 |
| 2 | Hero secondary | Hero card, right | `.neumo-raised` | cyan border, no glow | → video modal | §3 |
| 3 | Features "See it live" | Each of 5 feature cards | `.neumo-raised` ghost | transparent, no glow | → /app/<screen> | §4 |
| 4 | Download hub | 5 platform cards | `.neumo-raised` (primary macOS/Android, secondary Web/Windows/iOS) | emerald / cyan | → Vercel Blob URL | §5 |
| 5 | Pricing tier CTAs | 3 pricing cards | `.neumo-raised` (primary Pro, secondary Free/Institute) | emerald / cyan | → /signup | §6 |
| 6 | FAQ "Still stuck?" | After last Q&A | `.neumo-raised` secondary | cyan border, no glow | → mailto:hello@buddysaradhi.app | §7 |
| 7 | Footer newsletter | Footer (sticky) | `.neumo-raised` secondary | cyan border, no glow | → Server Action → Turso | §8 |

### 14.2 7-CTA Stack Compliance Matrix (NEW)

A single-screen audit grid showing all 7 CTAs at their canonical placement, with copy, colour, glass tier of the surrounding card, neumo recipe of the CTA itself, and the conversion goal. This is the artefact the conversion reviewer prints and ticks before sign-off; it is the CTA-layer projection of `13_UI_Guidelines.md §20.6` (coverage requirement).

```
  7-CTA STACK — COMPLIANCE MATRIX  (per §1 the seven CTAs, §6.6 neumo map, §5.5 glass map)
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  #   CTA copy                      Placement       Glass card       Neumo recipe    │
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  1   "Start free — no card"       Hero, left      .glass hero      neumo-raised +   │
  │                                                      (§5.5)            emerald glow    │
  │                                                                       → /signup         │
  │                                                                       240×56, ≥44×44    │
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  2   "Watch the 90s tour ▶"       Hero, right     .glass hero      neumo-raised +   │
  │                                                      (§5.5)            cyan border     │
  │                                                                       → video modal    │
  │                                                                       ~200×56, ≥44×44  │
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  3   "See it live →"              Feature cards   .glass + 2px     neumo-raised     │
  │                                    (×5)             accent (§5.4)    ghost            │
  │                                                                       → /app/<screen>  │
  │                                                                       ?feature=<anchor>│
  │                                                                       full-width mobile│
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  4   "Download" / "Open Web ›"    Download cards  .glass           neumo-raised     │
  │                                    (×5)            (§5.5)            (macOS/Android = │
  │                                                                       emerald; Web/    │
  │                                                                       Windows/iOS =    │
  │                                                                       cyan border)     │
  │                                                                       → Vercel Blob URL│
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  5   "Start free →"               Pricing cards   .glass (Free,    neumo-raised     │
  │                                    (×3)            Institute) or    (Pro = emerald;  │
  │                                                    .glass-strong      Free/Institute = │
  │                                                    + emerald (Pro)    cyan border)     │
  │                                                                       → /signup         │
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  6   "Email hello@buddysaradhi.app →"  FAQ, after      .glass contact   neumo-raised     │
  │                                    last Q&A        (§5, §5.5)        secondary        │
  │                                                                       (cyan border)    │
  │                                                                       → mailto:hello@  │
  │                                                                         buddysaradhi.app    │
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  7   "Subscribe" (newsletter)     Footer (sticky) .glass-faint     neumo-raised     │
  │                                    (§11 of web/07) (§5.5)            secondary        │
  │                                                                       (cyan border)    │
  │                                                                       → Server Action  │
  │                                                                         → Turso DB     │
  └────────────────────────────────────────────────────────────────────────────────────┘
   ↑ Every CTA is .neumo-raised (§6.6 primary-button row, §8.2 glass-button
     component) — there are NO glass buttons on the marketing surface.
   ↑ Primary = emerald glow; secondary = cyan border @ 40%, no glow;
     ghost = transparent, no glow.
   ↑ Every CTA ≥ 44×44px hit area (Rule 10, P15, §10.2).
   ↑ :focus-visible on every CTA = 2px cyan ring + 2px offset (§10.3);
     keyboard parity with mouse.
   ↑ :active on every CTA = .neumo-pressed (inset shadows + translateY(1px), §6.3).
   ↑ Conversion events fire on the HOW side (web/07 §8.2); the WHAT side
     (this file §1) owns the event name + trigger conditions.
   ↑ Tracked via Vercel Web Analytics only (Rule 3, AP-10, TELE-1) —
     no Mixpanel/GA/PostHog/Sentry/Hotjar/Clarity.
   ↑ The 7-CTA skeleton is NOT A/B tested (§12.2 no-test list); only the
     copy / order / default WITHIN a CTA is tested.
```

### 14.3 Conversion Funnel — Analytics Event Pipeline (NEW)

The §9 funnel reimagined as an analytics event chain. Every funnel stage fires a named Vercel Web Analytics event; every event carries the `variant` property (for A/B segmentation) and the `platform` property (for platform-detect attribution). No event carries PII — names are anonymised (e.g. `cta_hero_click`, not `cta_click_by_<email>`). This is the artefact the nightly Vercel Cron job (`web/05_Deployment_Vercel.md §2.3`) reads to produce the variant-comparison report.

```
  CONVERSION FUNNEL — ANALYTICS EVENT PIPELINE  (per §9 funnel, §12.4 A/B infra)
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  STAGE              EVENT NAME              TRIGGER              PROPS               │
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  1. Visit           page_view               First paint           {variant, platform}│
  │                     ↑ fires on every page; the variant prop comes from the          │
  │                       buddysaradhi_ab_hero cookie (sticky, 30-day expiry, §12.4)         │
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  2. Scroll 50%      scroll_depth_50         IntersectionObserver  {variant, platform}│
  │                     ↑ fires once per session; the threshold is 50% of body height   │
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  3. Click CTA       cta_hero_click          onClick on CTA #1     {variant, platform,│
  │                     cta_secondary_click     onClick on CTA #2      cta_id}            │
  │                     cta_features_click      onClick on CTA #3                        │
  │                     cta_download_click      onClick on CTA #4                        │
  │                     cta_pricing_click       onClick on CTA #5                        │
  │                     cta_faq_contact_click   onClick on CTA #6                        │
  │                     cta_footer_subscribe    onClick on CTA #7                        │
  │                     ↑ every event includes cta_id (1..7) for attribution             │
  │                     ↑ NO email, NO user_id, NO IP (Rule 3, AP-10, TELE-1)            │
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  4. Signup          signup_form_view        /signup route paint  {variant, platform}│
  │                     signup_email_submit     email form submit    {variant, platform}│
  │                     signup_otp_sent         OTP send success    {variant, platform}│
  │                     signup_otp_verified     OTP verify success  {variant, platform}│
  │                     signup_complete         /dashboard paint     {variant, platform,│
  │                                                                tier:'free'}        │
  │                     ↑ the /signup → /dashboard hop is the BR-ONBOARD-1 90s budget    │
  │                       (12_Business_Rules.md §12b); measured via Vercel Speed Insights│
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  5. Activate        activation_first_student Add Student sheet   {variant, platform}│
  │                     ↑ the dashboard's first Add Student click; the activation event  │
  │                       per BR-ONBOARD-2 empty-state CTA                             │
  ├────────────────────────────────────────────────────────────────────────────────────┤
  │  6. Convert         upgrade_paywall_shown   26th-student trigger {variant, platform}│
  │                     upgrade_pro_complete    Razorpay success     {variant, platform,│
  │                                                                tier:'pro',         │
  │                                                                billing:'monthly'|  │
  │                                                                'yearly'}           │
  │                     upgrade_institute_complete Razorpay success  {variant, platform,│
  │                                                                tier:'institute'}   │
  │                     ↑ the conversion event; the 251st student (post-trigger) triggers Pro paywall │
  │                       (05_Pricing_and_Plans.md §4.4 trial-to-paid flow)             │
  └────────────────────────────────────────────────────────────────────────────────────┘
   ↑ All events fire on the HOW side (web/07 §8.2 conversion events);
     the WHAT side (this file §1, §9) owns the event name + trigger.
   ↑ All money is integer paise (BR-M-01, Rule 6); Razorpay amount = 29900
     paise for Pro monthly, 99900 for Institute monthly, 299900 for Pro
     yearly, 999900 for Institute yearly.
   ↑ No telemetry SDK (Rule 3, AP-10, TELE-1) — Vercel Web Analytics only;
     the IP is never logged; the email is never in the event payload.
   ↑ The 7-CTA skeleton is NOT A/B tested; only the copy / order / default
     WITHIN a CTA is tested (§12.2 no-test list).
   ↑ Sample size: ≥ 1,000 visitors per variant (§12.4 A/B infra);
     statistical test = two-proportion z-test, p < 0.05, 80% power (§12.3).
   ↑ The nightly Vercel Cron job (web/05_Deployment_Vercel.md §2.3) reads
     the aggregate API and produces the variant-comparison report.
```

### 14.4 References (External Design Authorities)

The 7-CTA stack compliance matrix and the funnel pipeline synthesise practices from the following public bodies of work. Cite them when a contributor challenges the CTA hierarchy, the event naming, or the no-telemetry rule.

- **Nielsen Norman Group** — *Conversion Funnel Analysis* and *CTA Hierarchy for SaaS*. The §14.2 7-CTA stack and the §14.3 funnel stages follow NN/g's research on funnel clarity and CTA visual mass.
- **Baymard Institute** — *Checkout Usability* and *A/B Testing for Pricing*. The §14.3 signup → activation → conversion pipeline and the §14.2 no-card-at-signup rule are Baymard-anchored.
- **Smashing Magazine** — *CTA Placement and Visual Mass* and *Funnel Measurement*. The §14.2 emerald-primary / cyan-secondary / ghost-tertiary split and the §14.3 event-naming convention follow Smashing's research.
- **Apple Human Interface Guidelines** — *Marketing Surfaces* and *Tactile Foundations*. The §14.2 neumo-raised CTA family (with the glass-card surroundings per §5.5) follows Apple HIG's marketing-surface layering.
- **A List Apart** — *Funnel Copy Strategy* and *The 7-CTA Skeleton*. The §14.2 constant CTA copy ("Start free →" on all 3 pricing tiers) and the §14.3 event-naming convention follow ALA's content-strategy doctrine.
- **Google Search Central** — *SoftwareApplication Schema (JSON-LD)* and *Event Tracking*. The §14.3 event names must align with the `SoftwareApplication` schema in `09_SEO_and_Analytics.md §4.1`.
- **Vercel Web Analytics docs** — *Custom Event Catalogues* and *A/B Segmentation*. The §14.3 `variant` + `platform` props and the no-PII rule follow Vercel's privacy-first analytics posture (Rule 3, AP-10, TELE-1).

---

## 15. Cross-References

- `01_Product_Positioning.md §6` (brand voice — every CTA copy follows this), §3 (USPs that the CTAs sell).
- `02_Hero_and_Above_the_Fold.md §3` (hero A/B test — CTA #1 is part of the A/B unit), §5 (CTA #1 and #2 copy + visual spec), §7 (the trust line below CTA #1), §11 (the LCP target that CTA #1's rendering must meet).
- `03_Features_Showcase.md §7` (CTA #3 — the "See it live" deep-link pattern).
- `04_Download_Hub.md §2` (CTA #4 — the 5 download cards), §9 (download analytics events).
- `05_Pricing_and_Plans.md §3.2` (the "no friction at the door" principle — CTA #5 goes to /signup, not /checkout), §4.4 (the trial-to-paid conversion flow).
- `06_FAQ.md §5` (CTA #6 — the hello@buddysaradhi.app fallback).
- `08_Testimonials_and_Social_Proof.md §6` (authenticity rule — no fake testimonials in service of CTA conversion).
- `09_SEO_and_Analytics.md §6.5` (analytics events catalogue — every CTA fires a `cta_click` event), §6 (no-telemetry rule, applied to CTA tracking).
- `12_Business_Rules.md §BR-M-01` (integer paise — the pricing CTAs display ₹0/mo pre-trigger, ₹299/mo post-trigger), §BR-STU-11 (Free-tier 250-student soft guidance — does NOT block at 250; logs `student_count_milestone` and surfaces a friendly "tell us your story" prompt), §BR-PRC-01 (free for everyone, for now — single public tier), §BR-PRC-02 (grandfather clause — Free access never lowers), §BR-PRC-03 (no paywall in v1 — 250 soft guidance, friendly prompt only), §BR-PRC-04 (60-day notice before paid tiers launch), §BR-PRC-10 (`NEXT_PUBLIC_PAID_TIERS_LIVE` flag — single source of truth for paid-tier state).
- `13_UI_Guidelines.md §2.1` (color tokens — emerald, cyan, glass), §2.4 (status → accent map), §3.2 (type ramp — CTA copy is body-md 500/600), §10 (accessibility — 44×44 touch targets, focus rings).
- `web/01_Architecture.md §6` (middleware — A/B variant assignment), `web/03_Auth_and_Provisioning.md` (the two-tap signup flow).
- `web/07_Landing_Page.md §8` (CTA & Conversion Implementation — the HOW: the 7-CTA composition root, the `data-cta-id` attribute contract, the `track()` event wiring, the `/signup?plan={tier}` deep-link, the two-tap signup attribution, the "no dark patterns" lint rule. This file owns the 7-CTA skeleton and the funnel math; that file owns the React tree, the analytics-track calls, and the Edge-Config variant assignment that ship them).
- `deployment/01_Vercel_Hosting.md §8` (Vercel Pro tier upgrade — needed when CTA-driven traffic spikes).
- `product/AGENTS.md §3` (no dark patterns enforcement), §5 (stop-and-ask trigger for adding an 8th CTA).

---

*Seven CTAs. One funnel. No dark patterns. If a visitor cannot predict what clicking any CTA will do — within 1 second of seeing it — the CTA has failed, and the funnel has leaked. Treat every CTA as load-bearing infrastructure.*
