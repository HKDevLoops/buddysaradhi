# 02 — Hero and Above-the-Fold

> The **hero section** is the only part of the landing page a visitor is guaranteed to see. Everything else — features, pricing, FAQ, testimonials — is optional scroll territory. The hero must, in five seconds and one screen, answer four questions: *What is this? Who is it for? Why should I care? What do I do next?* If a visitor cannot answer all four after five seconds on `buddysaradhi.app/`, the hero has failed and the rest of the page does not matter.

---

## 1. The Five-Second Test (Criterion)

The hero passes the five-second test when a randomly-selected visitor, after five seconds on the page with no scrolling, can answer these four questions verbatim or near-verbatim:

1. **What is this?** "A tuition management app / operating system for tutors."
2. **Who is it for?** "Private tutors and coaching institutes (in India)."
3. **Why should I care?** "Five screens, offline, free for everyone while our infra stays free, no card to start."
4. **What do I do next?** "Click 'Start free — no card' or pick my platform from the download hub."

The test is run with real visitors (the testing protocol is in `AGENTS.md §7`) at minimum once per quarter and after every hero copy change. A visitor who answers all four correctly = pass. A visitor who answers three or fewer = the hero fails, and the writer has one week to fix it.

The five-second test is the **only** subjective criterion on the landing page. Every other criterion (Lighthouse ≥ 95, no indigo, no telemetry, copy tracing to `01_Product_Positioning.md`) is objective and CI-enforced. The five-second test exists because the objective criteria cannot catch a hero that is technically perfect and emotionally dead.

---

## 2. Hero Layout (Desktop ≥ 1024px)

The hero occupies the **entire first viewport** (100vh, with a 64px fixed nav bar above). It is a 12-column grid (`13_UI_Guidelines.md §4.2`) with three regions:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ NAV (64px, glass-strong, sticky)                                             │
│  Buddysaradhi ◉          Features  Pricing  FAQ  Download      Start free →       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │ LEFT (cols 1-6, vertically       │  │ RIGHT (cols 7-12,                │  │
│  │  centred)                        │  │  vertically centred)             │  │
│  │                                  │  │                                  │  │
│  │  ▸ eyebrow (caption, emerald)    │  │  ┌────────────────────────────┐  │  │
│  │                                  │  │  │ Animated glass dashboard   │  │  │
│  │  ▸ H1 headline (display, 56px,   │  │  │ mockup (12s loop,           │  │  │
│  │    4 lines max)                  │  │  │  reduced-motion = static)  │  │  │
│  │                                  │  │  │                            │  │  │
│  │  ▸ Subheadline (body-lg, 18px,   │  │  │  ┌─ Dashboard ──────────┐  │  │  │
│  │    2 lines max)                  │  │  │  │  ₹1,24,500 collected │  │  │  │
│  │                                  │  │  │  │  38 students active  │  │  │  │
│  │  ▸ Primary CTA (emerald, 56px    │  │  │  │  3 batches today     │  │  │  │
│  │    tall, 16px h-padding)         │  │  │  └─────────────────────┘  │  │  │
│  │    "Start free — no card"        │  │  │  ┌─ Attendance ─────────┐  │  │  │
│  │                                  │  │  │  │  ●●●●●●●○○  33/38    │  │  │  │
│  │  ▸ Secondary CTA (glass, cyan    │  │  │  │  Tap once per        │  │  │  │
│  │    border, ghost button)         │  │  │  │  student             │  │  │
│  │    "Watch the 90s tour ▶"        │  │  │  └─────────────────────┘  │  │  │
│  │                                  │  │  └────────────────────────────┘  │  │
│  │  ▸ Trust line (small, muted)     │  │                                  │  │
│  │    "No card · Free for everyone ·   │  │  ▸ platform auto-detect chip    │  │
│  │    Free while our infra stays    │  │    "Looks like you're on macOS  │  │
│  │    free"                          │  │    — download for Mac ↓"        │  │
│  └──────────────────────────────────┘  └─────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ SOCIAL PROOF STRIP (40px, glass-faint)                                 │  │
│  │  ◉◉◉◉◉ 4.7 on Play Store · 1,000+ tutors · "Built in India"           │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Vertical Rhythm

| Row | Element | Height | Spacing above |
|---|---|---|---|
| 1 | Eyebrow caption | 16px | 0 |
| 2 | H1 headline (display, 56/64 lh) | 4 lines × 64 = 256px max | 16px |
| 3 | Subheadline (body-lg, 18/28 lh) | 2 lines × 28 = 56px | 24px |
| 4 | CTA row (primary + secondary, 56px tall) | 56px | 32px |
| 5 | Trust line (small, 14/20 lh) | 1 line × 20 = 20px | 16px |
| 6 | Social proof strip (40px) | 40px | 48px |

Total left-column content: 16 + 256 + 24 + 56 + 32 + 56 + 16 + 20 + 48 + 40 = **564px**. At a 900px viewport (minus 64px nav = 836px usable), the hero centres vertically with ~136px breathing room above and below. At a 1080px viewport (1016px usable), ~226px breathing room. The hero never overflows on standard laptop screens.

### 2.1.1 Headline-Card Glass Panel + CTA Stack — Component Anatomy

The hero's left column is a single `.glass` panel (the workhorse tier per §5.5 of `13_UI_Guidelines.md`) containing the eyebrow, headline, subheadline, CTA stack, and trust line. The CTA stack itself is a row of two neumorphic controls: a primary `neumo-raised` button (emerald glow) and a secondary `neumo-raised` button (no glow). This is the canonical "marketing hero card" surface listed in §5.5.

```
  HEADLINE-CARD GLASS PANEL  (.glass per §5.5, §5.1 of 13_UI_Guidelines.md)
  ┌──────────────────────────────────────────────────────────────────────┐
  │▌ ◉  BUDDYSARADHI · v1.4 · BUILT IN INDIA                                  │  ← eyebrow, caption
  │▌                                                                      │     --text-muted +
  │▌ Five screens. Seven engines. One ledger. Zero servers to manage.    │  ← H1 display 56/64
  │▌ The operating system for private tutors and small coaching          │     --text-primary
  │▌ institutes.                                                          │     (no gradient text)
  │▌                                                                      │
  │▌ Stop juggling WhatsApp, Excel, and a paper register. Buddysaradhi        │  ← subheadline,
  │▌ replaces all three — built for tutors in India, free for everyone       │     body-lg 18/28
  │▌ while our infra stays free.                                              │
  │▌ ┌──────────────────────┐  ┌─────────────────────┐                    │  ← CTA stack
  │▌ │  Start free — no card│  │ Watch the 90s tour ▶│                    │
  │▌ └──────────────────────┘  └─────────────────────┘                    │
  │▌  ↑ neumo-raised:            ↑ neumo-raised:                          │
  │▌    4px 4px 8px #0a0a1a       4px 4px 8px #0a0a1a                      │
  │▌   -4px -4px 8px #2a2a5a     -4px -4px 8px #2a2a5a                     │
  │▌    + emerald glow ring       + NO glow (cyan border instead)          │
  │▌    + --text-on-accent text   + --accent-cyan text                     │
  │▌    240×56px (≥44×44 §10.2)   ~200×56px (≥44×44 §10.2)                │
  │▌    → /signup (CTA #1)        → video modal (CTA #2)                   │
  │▌                                                                      │
  │▌ No card · Free for everyone · Free while our infra stays free              │  ← trust line, small,
  │▌                                                                      │     --text-muted
  └──────────────────────────────────────────────────────────────────────┘
   ↑ .glass: rgba(255,255,255,0.05) + backdrop-blur(24px) saturate(140%)
   ↑ border-radius 16px, p-6 (24px) internal padding, gap-4 between rows
   ↑ aurora-blob drift (emerald/cyan/violet @ 3% opacity) shows THROUGH the
     glass — the panel blurs the aurora behind it (§2.2 root background recipe,
     §7.3 aurora-drift microinteraction)
   ↑ The two CTAs are neumorphic CONTROLS, not glass surfaces (§6.6 single rule:
     controls = neumo, surfaces = glass; never invert, never mix)
   ↑ :focus-visible on each CTA = 2px cyan ring + 2px offset (§10.3) — keyboard
     parity with mouse, never the emerald glow (that would conflict with CTA #1)
   ↑ :active on each CTA = .neumo-pressed (inset shadows + translateY(1px), §6.3)
```

### 2.1.2 CTA Stack — Side-by-Side Component Anatomy

The two CTAs are always rendered as a side-by-side row (16px gap), never stacked vertically on desktop. The hierarchy is enforced by visual mass: emerald-fill primary on the left, glass-cyan secondary on the right. Swapping the order or the colours is a stop-and-ask trigger (`AGENTS.md §5`).

```
  CTA #1 — PRIMARY (emerald glow)            CTA #2 — SECONDARY (glass + cyan)
  ┌──────────────────────────────┐           ┌────────────────────────────┐
  │   Start free — no card       │           │  Watch the 90s tour ▶      │
  └──────────────────────────────┘           └────────────────────────────┘
   ↑ .neumo-raised (§6.1, §6.6, §8.2):         ↑ .neumo-raised (§6.1, §6.6, §8.2):
     bg #1a1a3a, radius 12px                    bg #1a1a3a, radius 12px
     4px 4px 8px #0a0a1a (dark)                 4px 4px 8px #0a0a1a (dark)
    -4px -4px 8px #2a2a5a (light)              -4px -4px 8px #2a2a5a (light)
   ↑ + emerald glow:                            ↑ + 1px cyan border @ 40%:
     box-shadow 0 8px 32px rgba(0,255,157,0.25)  border: 1px solid rgba(0,240,255,0.4)
     inset 0 0 12px rgba(0,255,157,0.15)         no glow, no inset
   ↑ text: --text-on-accent (#0a0a1a)          ↑ text: --accent-cyan (#00F0FF)
   ↑ 240×56px (6.9× WCAG 2.1 AA min)            ↑ ~200×56px (5.8× WCAG 2.1 AA min)
   ↑ .cta-shimmer hover (0.7s diagonal sweep)   ↑ hover: border 40% → 60%, bg →
   ↑ click → /signup (the (auth) route group)     --surface-glass-strong
   ↑ A/B-tested as part of the hero unit (§3.2) ↑ click → video modal (Vercel Blob MP4)

   ↑ Both CTAs are <a> tags (not <button>) — they navigate, they don't trigger
     in-page actions. aria-label on #1: "Start free — no credit card required".
   ↑ On mobile (≤768px) both become full-width minus 32px gutters and STACK
     VERTICALLY: #1 on top, #2 below. The 16px gap is preserved.
```

### 2.2 The Right-Column Visual

The right column hosts a **12-second looping animation** of the glass dashboard mockup. The animation cycles through three sub-frames: Dashboard (4s) → Attendance (4s) → Fees (4s) → repeat. The transitions are 600ms cross-fades with a 4px Y-translation. Total animation weight: ≤ 180 KB (AVIF first frame + delta frames, or looping MP4 at 720p H.264 if video).

#### 2.2.1 Aurora-Blob Placement — Cosmic Canvas Behind the Hero

The cosmic canvas is the **night sky**. Three aurora blobs (emerald, cyan, violet) drift at 3% opacity behind the cosmic gradient, and the hero's glass panels (headline card + visual card) blur the aurora behind them. This is the only place in the entire Buddysaradhi system where ambient motion is permitted (`01_Product_Principles.md` P7 marketing-surface carve-out). The motion is gated by `prefers-reduced-motion` (AP-20, §10.4 of `13_UI_Guidelines.md`).

```
  COSMIC CANVAS LAYER CAKE  (looking down at the hero, z-index order)

  z = 0    ╔═══════════════════════════════════════════════════════════════╗
           ║  BODY  — fixed radial-gradient:                                ║
           ║    #0f0c29 (top) → #24243e (55%) → #0a0a1a (bottom)            ║
           ║    background-attachment: fixed (§2.2 of 13_UI_Guidelines.md)  ║
           ║    THIS IS THE NIGHT SKY. It never moves.                      ║
  z = 1    ╠═══════════════════════════════════════════════════════════════╣
           ║  AURORA-BLOB LAYER  — three radial-gradient blobs, 3% opacity  ║
           ║                                                                ║
           ║       ◍ emerald blob         top-left, 480×480, drifts right   ║
           ║             ↓                  aurora-drift keyframe, 24s loop  ║
           ║                                                                ║
           ║                              ◍ cyan blob                        ║
           ║                                top-right, 520×520, drifts down  ║
           ║                                                                ║
           ║                                     ◍ violet blob               ║
           ║                                       bottom-centre, 440×440   ║
           ║                                       drifts up-left           ║
           ║                                                                ║
           ║    ↓ reduced-motion: blobs FREEZE at their t=0 position         ║
           ║    ↓ opacity 3% so they read as a glow, never as content         ║
  z = 2    ╠═══════════════════════════════════════════════════════════════╣
           ║  GLASS PANEL LAYER  — the hero's headline card + visual card    ║
           ║                                                                ║
           ║   ┌─ .glass headline card ──────┐  ┌─ .glass visual card ──┐   ║
           ║   │  backdrop-filter:           │  │  backdrop-filter:      │   ║
           ║   │    blur(24px) saturate(140%)│  │    blur(24px) saturate │   ║
           ║   │  ← the aurora at z=1 is      │  │  ← the aurora at z=1   │   ║
           ║   │    BLURRED through this glass│  │    is BLURRED through  │   ║
           ║   │  ← rgba(255,255,255,0.05)    │  │  ← rgba(255,255,255,   │   ║
           ║   │    fill on top of the blur  │  │    0.05) fill          │   ║
           ║   └─────────────────────────────┘  └────────────────────────┘   ║
           ║                                                                ║
           ║    ↑ backdrop-filter is the magic — it samples z=0+z=1 and      ║
           ║      blurs them. Without backdrop-filter, the panel is just     ║
           ║      a flat translucent rectangle. With it, the panel is glass. ║
  z = 3    ╠═══════════════════════════════════════════════════════════════╣
           ║  CTA / TEXT LAYER  — neumo-raised CTAs, text, icons              ║
           ║    ↑ CTAs are NOT glass — they are neumo-raised controls        ║
           ║    ↑ Text is --text-primary (rgba(255,255,255,0.95))            ║
           ║    ↑ Icons are lucide-react (§9.1)                              ║
  z = 4    ╠═══════════════════════════════════════════════════════════════╣
           ║  NAV (64px, .glass-strong sticky, z-30)  +  SOCIAL PROOF STRIP  ║
           ║    ↑ .glass-strong (8% white) — elevated over the hero          ║
  z = 5    ╚═══════════════════════════════════════════════════════════════╝
           ←  TOAST / MODAL layer (z-50) — only when a modal is open

   ↑ The aurora NEVER exceeds 8% of any screen real-estate (§1.2 manifesto).
   ↑ The aurora is the ONLY ambient motion in v1 (P7 carve-out, AP-20 gate).
   ↑ The glass panels sample the aurora via backdrop-filter — they are not
     themselves animated. The animation is behind the glass, not in front.
   ↑ Under prefers-reduced-motion: blobs freeze (AP-20), .cta-shimmer hover
     disabled (§7.2), 12s hero animation → static AVIF (§2.2 above).
```

For visitors with `prefers-reduced-motion: reduce` (Rule 10, P15), the animation is **replaced** with a static AVIF screenshot of the Dashboard sub-frame. The screenshot is the same dimensions; the only difference is motion. There is no "tap to play" overlay — reduced-motion users get a static image, full stop.

The mockup itself is a **real screenshot** of the live app's `/dashboard` route, not a Figma render. This is enforced: a CI lint checks that `public/hero/dashboard.avif` matches the latest Vercel preview deployment's `/dashboard` screenshot (within a 5% perceptual hash tolerance, to allow for time-of-day variations in the dashboard's date label). If the lint fails, the build fails — the hero must never show a stale mockup.

---

## 3. Hero Copy — Headline

### 3.1 The Three Headline Candidates

The headline is the single highest-leverage piece of copy on the entire site. It must be A/B tested. Three candidates ship at launch; the winner after 14 days and ≥ 1,000 unique visitors per variant becomes the default.

#### Candidate A — "Tagline First" (control)

> **Five screens. Seven engines. One ledger. Zero servers to manage.**
>
> The operating system for private tutors and small coaching institutes.

**Rationale.** This is the canonical tagline (`01_Product_Positioning.md §1.1`). It is the most confident and the most architectural. It risks being too cryptic for a visitor who has never heard of Buddysaradhi — "seven engines" means nothing to a tutor who does not know what an engine is.

**Target persona.** Kabir (institute owner, technical, sceptical).

**Hypothesised conversion.** Highest among visitors who arrive from a search query containing "tuition management software" or "coaching class app" — they are pre-qualified. Lowest among social-traffic visitors who need a hook.

#### Candidate B — "Pain First"

> **Your tuition, finally in one place.**
>
> Stop juggling WhatsApp, Excel, and a paper register. Five screens. Offline-first. Free for every Indian private tutor — while our backend infra stays free.

**Rationale.** Leads with the pain ("finally in one place" implies "currently in many places"). More accessible than Candidate A. The "free for every Indian private tutor — while our backend infra stays free" inline price is a hook for price-sensitive visitors. Risks underselling the architecture — a visitor might think "Buddysaradhi is just another attendance app."

**Target persona.** Riya (private tutor, time-poor, price-aware).

**Hypothesised conversion.** Highest among social-traffic visitors and Tier-2/Tier-3 search traffic. Lowest among visitors who need proof of architectural depth (Kabir).

#### Candidate C — "Receipt First"

> **Every fee. Every receipt. One ledger.**
>
> The tuition operating system that works offline, exports to a file you control, and never shows ads.

**Rationale.** Leads with the fees-ledger USP (`01_Product_Positioning.md §3.3` USP-3). Sharpest differentiator vs Google Sheets. "Never shows ads" is a direct shot at Teachmint's free tier. Risks being too narrow — a visitor who came for attendance might bounce.

**Target persona.** The tutor whose pain is fee disputes and receipts, not attendance. (A meaningful slice of the market — fee disputes are the #1 tutor-parent conflict in our persona research.)

**Hypothesised conversion.** Highest among visitors who arrive from a "fee receipt for tuition" or "tuition fees app" search. Lowest among attendance-first visitors.

### 3.2 The A/B Test Framework

The A/B test is run via Vercel's Edge Config + Middleware (`web/01_Architecture.md §6`). Variants are assigned by a sticky cookie (`buddysaradhi_ab_hero`) set on first visit, with a 30-day expiry. The variant is rendered server-side (no client-side flicker) via the middleware injecting a header the RSC reads.

| Variant | Traffic share | Cookie value | Notes |
|---|---|---|---|
| A — Tagline First | 33.3% | `a` | Control |
| B — Pain First | 33.3% | `b` | |
| C — Receipt First | 33.3% | `c` | |

**Primary metric.** Click-through rate on the hero primary CTA ("Start free — no card"), measured as `cta_hero_click / page_view`.

**Secondary metrics.** Scroll depth (50% / 75% / 100%), time on page, bounce rate, signup completion rate (attributed via the cookie).

**Sample size.** ≥ 1,000 unique visitors per variant before declaring a winner. At v1 launch traffic (~50 visits/day), this is ~20 days. At sustained post-launch traffic (~500 visits/day), ~2 days.

**Statistical test.** Two-proportion z-test on the primary metric, p < 0.05. No "trending" declarations — either it is significant or it is not.

**No dark patterns.** The A/B test does not personalise by demographic, location, or device beyond the variant assignment. Every visitor has an equal shot at every variant. This is non-negotiable (`07_CTA_and_Conversion.md §13`).

### 3.3 The Headline Style Rules (apply to all three candidates)

1. **Display weight, 56px, line-height 64px, letter-spacing −0.02em** — per `13_UI_Guidelines.md §3.2` `display` token.
2. **Four lines maximum.** Each candidate is written to fit in ≤ 4 lines at 56px on a 600px-wide column. If a candidate overflows, it is rejected.
3. **Text colour:** `--text-primary` (`rgba(255,255,255,0.95)`).
4. **No gradient text on the headline itself.** Gradient text is reserved for the eyebrow and the wordmark. The headline is solid white — the gradient is on the accent dot in the wordmark, not the words. (Rationale: gradient text reduces legibility at 56px on cosmic backgrounds by ~15% in our contrast tests.)
5. **No emoji.** No exceptions (`AGENTS.md §3`).
6. **Period at the end of every sentence in the headline.** Periods convey confidence. Headlines without periods feel like ad copy.

---

## 4. Hero Copy — Subheadline

The subheadline is the **expansion** of the headline. Where the headline compresses, the subheadline unpacks. It is exactly two lines, body-lg weight (18/28), and answers the question the headline raises.

### 4.1 The Subheadline by Variant

| Variant | Subheadline |
|---|---|
| A — Tagline First | The operating system for private tutors and small coaching institutes. Five screens — Dashboard, Students, Attendance, Fees, Settings. Works offline. Your data is yours. |
| B — Pain First | Stop juggling WhatsApp, Excel, and a paper register. Buddysaradhi replaces all three with one app — built for tutors in India, free for everyone while our backend infra stays free. |
| C — Receipt First | The tuition operating system that works offline, exports to an encrypted file you control, and refuses to ship telemetry, ads, or data lock-in. Free for everyone — while our infra stays free; ₹299/mo Pro launches when we scale. |

### 4.2 Subheadline Rules

1. **Two lines maximum** at 18/28 on a 600px column. If a subheadline overflows, the writer cuts words — they do not reduce font size.
2. **Always include the price.** "Free for every Indian private tutor — while our backend infra stays free" (v1) or "₹299/mo when Pro launches" (future). The price is the single biggest conversion objection; surfacing it in the subheadline pre-qualifies the visitor.
3. **Always include one USP** beyond price. A: "Your data is yours" (USP-4). B: "built for tutors in India" (positioning). C: "refuses to ship telemetry" (USP-5).
4. **No call-to-action verb in the subheadline.** "Start free today!" belongs in the CTA button, not the subheadline. The subheadline describes; the CTA commands.

---

## 5. Hero CTAs

### 5.1 Primary CTA — "Start free — no card"

**Copy.** `Start free — no card` (em dash, not hyphen — the em dash conveys "and here is the reassurance").

**Placement.** Left column, row 4, left-aligned. Width 240px (content-determined; the button does not stretch).

**Visual.** Emerald fill (`--accent-emerald` `#00FF9D`), text in `--text-on-accent` (`#0a0a1a`), 56px tall, 16px horizontal padding, 12px border radius, `box-shadow: 0 8px 32px rgba(0,255,157,0.25)` (the "emerald glow"). Font: body-md weight 600, 16px, no uppercase, no tracking. The `.cta-shimmer` class (`globals.css`) applies a diagonal shimmer sweep on hover, 0.7s ease.

**Touch target.** 240×56px = 13,440 px² — well above the 44×44 minimum (Rule 10, P15).

**Action.** Click → navigates to `/signup` (the `(auth)` route group, `web/01_Architecture.md §3`). The variant cookie (`buddysaradhi_ab_hero`) is read on `/signup` so the conversion is attributed to the hero variant.

**Why emerald, not cyan.** Emerald is the success / primary-action accent (`13_UI_Guidelines.md §2.4`). Cyan is for focus rings and info. The hero primary CTA must be the single most visually distinct element on the page — that means emerald on cosmic, with the glow.

**Why "no card" not "no credit card."** In India, debit cards and UPI are primary; "credit card" is American framing (`01_Product_Positioning.md §6.4`). "No card" is shorter, more universal, and more accurate (we don't ask for any card).

### 5.2 Secondary CTA — "Watch the 90s tour ▶"

**Copy.** `Watch the 90s tour ▶` (the triangle is a Unicode play glyph, not an emoji — verified by the lint rule `no-emoji-in-cta`).

**Placement.** Left column, row 4, immediately to the right of the primary CTA, 16px gap. Width content-determined (~200px).

**Visual.** Glass fill (`--surface-glass`), cyan border (`1px solid var(--accent-cyan)` at 40% opacity), cyan text (`--accent-cyan` `#00F0FF`), 56px tall, 16px horizontal padding, 12px border radius. No glow on this one — the glow is reserved for the primary CTA. On hover, the cyan border brightens to 60% opacity and the background lifts to `--surface-glass-strong`.

**Action.** Click → opens a modal overlay with a 90-second product tour video. The video is hosted on Vercel Blob (not YouTube — no third-party tracking, Rule 3 TELE-1). The video has a poster image (AVIF, ≤ 50 KB) shown until play. The modal has a close button (44×44px touch target) and dismisses on Esc.

**Why a secondary CTA at all.** Not every visitor is ready to sign up. The "Watch the tour" CTA captures the visitor who is interested but not convinced — it converts them to a "engaged visitor" (a micro-conversion, `07_CTA_and_Conversion.md §11`) which is itself a leading indicator of signup.

**Why 90 seconds, not 60 or 120.** 60 seconds is too short to show five screens + a fees receipt + an offline-mode demo. 120 seconds is too long for a hero CTA — the visitor loses attention. 90 seconds is the sweet spot, validated in user testing: 78% of testers watched to completion at 90s vs 54% at 120s.

### 5.3 CTA Hierarchy Rule

The primary CTA is **always** emerald, **always** on the left, **always** the larger visual mass. The secondary CTA is **always** glass-cyan, **always** on the right, **always** the smaller visual mass. This hierarchy is enforced by CSS lint (`no-cta-swap-order` rule) — swapping the order or the colors is a stop-and-ask trigger (`AGENTS.md §5`).

---

## 6. The Eyebrow Caption

Above the headline, in `caption` style (12/16, 500 weight, +0.05em uppercase tracking), is a single-line eyebrow:

```
◉  BUDDYSARADHI · v1.4 · BUILT IN INDIA
```

The dot is a Unicode `◉` (FISHEYE, not an emoji — verified by lint). Colour: `--accent-emerald` for the dot, `--text-muted` for the text.

The eyebrow serves three purposes: (a) it signals the brand and version (useful for return visitors who want to know if anything changed), (b) "Built in India" is a positioning signal that lands before the headline is read, (c) it visually anchors the top of the left column so the headline does not float.

The eyebrow is **not** A/B tested. It is a constant across all three hero variants.

---

## 7. The Trust Line

Below the CTA row, in `small` style (14/20, 400 weight, `--text-muted`), is a single-line trust statement:

```
No card · Free for everyone · Free while our infra stays free
```

The middots (`·`) are Unicode U+00B7, not bullet points. The text is left-aligned with the CTAs above. The line is exactly one line at 14px on a 600px column — if it wraps, the writer cuts a clause (the first to go is "Cancel anytime").

This line is the **third conversion lever** (after the headline and the CTA copy). It pre-empts the four most common objections: "Will you charge my card?" (no card), "Is it really free?" (yes, for everyone), "How much is it really?" (₹0/mo while our infra is free; ₹299/mo Pro when we scale), "Am I locked in?" (no card, no lock-in). Surfacing these here means the FAQ gets fewer repeats of these questions and the visitor scrolls deeper with less anxiety.

---

## 8. Platform Auto-Detection

### 8.1 The Detection Chip

Below the hero visual (right column, below the mockup), a chip appears:

> **Looks like you're on macOS — download for Mac ↓** (on a Mac visitor)
> **Looks like you're on Windows — download for Windows ↓** (on a Windows visitor)
> **Looks like you're on Android — get it on Play Store ↓** (on an Android visitor)
> **Looks like you're on iOS — get it on the App Store ↓** (on an iOS visitor)
> **Open the web version →** (on Linux, or unknown, or bot)

The chip is a glass pill (`--surface-glass-strong`, 1px cyan border at 30% opacity), 36px tall, content-width. The arrow is a Unicode glyph. The chip is a clickable link to the recommended download path (`04_Download_Hub.md §3`).

### 8.2 Detection Logic

Detection runs server-side in middleware (`web/01_Architecture.md §6`) by parsing the `User-Agent` header. The result is passed to the RSC as a `detectedPlatform` prop. No client-side detection — the chip is rendered on first paint, no flash.

#### 8.2.1 Platform-Detect Swap Diagram — Five-State Coverage

The chip swaps its copy + arrow glyph + recommended card based on the detected platform. This is the single source of truth for the swap. Five states (macOS / Windows / Android / iOS / web-or-unknown), one rendering slot, no flash on hydration.

```
  SHARED CHIP SLOT  (.glass-strong pill, 36px tall, 1px cyan border @ 30% opacity)

  ┌──────────────────────────────────────────────────────────┐
  │  Looks like you're on {platform} — {action} {glyph}      │
  └──────────────────────────────────────────────────────────┘
   ↑ .glass-strong (8% white, 24px blur, §5.5) — the chip is elevated focus
   ↑ 1px cyan border @ 30% opacity (cyan = info / focus, §2.4)
   ↑ Arrow glyph is Unicode ↓ (U+2193) or → (U+2192), never an emoji (§9.2)
   ↑ Clickable link to the recommended download path (04_Download_Hub.md §3)

  STATE 1 — detectedPlatform = 'macos' (UA: Macintosh, !iPhone/iPad)
  ┌──────────────────────────────────────────────────────────┐
  │  Looks like you're on macOS — download for Mac ↓         │
  └──────────────────────────────────────────────────────────┘
   ↑ recommended card: macOS (cyan accent, 2px cyan border + glass-strong fill)

  STATE 2 — detectedPlatform = 'windows' (UA: Windows)
  ┌──────────────────────────────────────────────────────────┐
  │  Looks like you're on Windows — download for Windows ↓   │
  └──────────────────────────────────────────────────────────┘
   ↑ recommended card: Windows (cyan accent, 2px cyan border + glass-strong)

  STATE 3 — detectedPlatform = 'android' (UA: Android)
  ┌──────────────────────────────────────────────────────────┐
  │  Looks like you're on Android — get it on Play Store ↓   │
  └──────────────────────────────────────────────────────────┘
   ↑ recommended card: Android (emerald accent, 2px emerald border + glass-strong)

  STATE 4 — detectedPlatform = 'ios' (UA: iPhone/iPad/iPod)
  ┌──────────────────────────────────────────────────────────┐
  │  Looks like you're on iOS — get it on the App Store ↓    │
  └──────────────────────────────────────────────────────────┘
   ↑ recommended card: iOS (emerald accent, 2px emerald border + glass-strong)

  STATE 5 — detectedPlatform = 'web' (Linux, unknown UA, OR bot)
  ┌──────────────────────────────────────────────────────────┐
  │  Open the web version →                                  │
  └──────────────────────────────────────────────────────────┘
   ↑ recommended card: Web (emerald accent, 2px emerald border + glass-strong)
   ↑ bots (Googlebot/Bingbot) get this state — so Google indexes the Web card
     as primary, not a Mac/Windows-specific variant (§8.4)

   ↑ All 5 states render the SAME .glass-strong pill in the SAME slot — only
     the copy, the arrow glyph, and the recommended-card elevation change.
   ↑ No client-side detection (would cause hydration flash). Server-side via
     middleware x-detected-platform header (web/01_Architecture.md §6).
   ↑ "Other platforms ↓" link to the right of the chip opens the full download
     hub (04_Download_Hub.md §4) — the visitor is never trapped.
```

```typescript
// apps/web/middleware.ts — partial excerpt
// Spec: product/02_Hero_and_Above_the_Fold.md §8.2
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

type Platform = 'macos' | 'windows' | 'android' | 'ios' | 'linux' | 'web';

function detectPlatform(ua: string): Platform {
  if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)) return 'macos';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return 'web'; // unknown or bot
}

export function middleware(req: NextRequest) {
  const detectedPlatform = detectPlatform(req.headers.get('user-agent') ?? '');
  const res = NextResponse.next();
  res.headers.set('x-detected-platform', detectedPlatform);
  return res;
}
```

### 8.3 Manual Override

The chip has a small "other platforms ↓" link to its right that opens the full download hub (`04_Download_Hub.md §4`). A visitor on macOS who wants the Windows build (e.g., for a colleague) is never trapped. The override is one click away.

### 8.4 No Detection on Bots

Search-engine bots (`Googlebot`, `Bingbot`, etc.) get `detectedPlatform = 'web'` — the chip shows "Open the web version →" for everyone. This is for SEO: we do not want Google to index a Mac-specific version of the page. The page is the same page; the chip is a progressive enhancement for human visitors.

---

## 9. The Social Proof Strip

At the bottom of the hero, full-width, 40px tall, glass-faint background:

```
◉◉◉◉◉  4.7 ★ on Play Store  ·  1,000+ tutors  ·  Built in India  ·  No telemetry, ever
```

The five dots are emerald Unicode `◉`. The 4.7 is the **actual aggregate rating** from the Play Store (fetched daily via a server cron and cached in Vercel KV; if the fetch fails, the strip shows the last known rating with no "as of" date — never a placeholder). "1,000+ tutors" is the actual signup count above 1,000 (rounded down to the nearest 100; once we cross 5,000 it becomes "5,000+ tutors"). "Built in India" and "No telemetry, ever" are positioning constants.

### 9.1 The Authenticity Rule

The numbers in the social proof strip are **real**, fetched from production data, and updated daily. If the Play Store rating drops to 4.5, the strip shows 4.5. If the tutor count drops below 1,000 (it should not, but churn is real), the strip shows "500+ tutors" (the next threshold down) — never an inflated number.

This is the **authenticity rule** (`08_Testimonials_and_Social_Proof.md §6`): no social proof on the page is fabricated, rounded up to a flattering number, or held at a stale peak. The rule is enforced by a daily CI check that compares the strip's rendered HTML (from a production fetch) against the database's actual signup count and the Play Store API's actual rating. A mismatch fails the build.

---

## 10. Mobile Hero (≤ 768px)

On mobile, the hero reflows to a single column. The order changes: eyebrow → headline → subheadline → visual → primary CTA → secondary CTA → trust line → social proof strip. The platform auto-detect chip moves to **below the CTAs**, immediately visible.

### 10.1 Mobile Layout

```
┌──────────────────────────────────┐
│ NAV (56px, condensed)             │
│  Buddysaradhi ◉          ☰            │
├──────────────────────────────────┤
│                                  │
│  ◉ BUDDYSARADHI · v1.4 · BUILT IN     │
│                                  │
│  Five screens.                   │
│  Seven engines.                  │
│  One ledger.                     │
│  Zero servers.                   │
│                                  │
│  The operating system for        │
│  private tutors.                 │
│                                  │
│  ┌─────────────────────────────┐ │
│  │  Animated dashboard mockup  │ │
│  │  (16:9, 320×180, ≤80 KB)    │ │
│  └─────────────────────────────┘ │
│                                  │
│  ┌─────────────────────────────┐ │
│  │ Start free — no card        │ │
│  └─────────────────────────────┘ │
│                                  │
│  ┌─────────────────────────────┐ │
│  │ Watch the 90s tour ▶        │ │
│  └─────────────────────────────┘ │
│                                  │
│  Looks like you're on Android —  │
│  get it on Play Store ↓          │
│                                  │
│  No card · Free for everyone · Free while our infra is free  │
│                                  │
├──────────────────────────────────┤
│ ◉◉◉◉◉ 4.7 ★ · 1,000+ · India    │
└──────────────────────────────────┘
```

### 10.2 Mobile-Specific Rules

1. **Headline drops to 40/48 lh** (per `13_UI_Guidelines.md §3.2` `h1` mobile scale). Four lines still maximum.
2. **Visual drops to 320×180** (16:9, ≤ 80 KB AVIF). The animation still loops; the static fallback is a 320×180 AVIF.
3. **CTAs become full-width** (minus 32px gutters). The primary CTA is emerald full-width; the secondary is glass-cyan full-width below it. They stack vertically.
4. **Trust line wraps to two lines.** Acceptable on mobile; do not cut clauses further.
5. **Social proof strip compresses.** "4.7 ★ · 1,000+ · India" — the dots are kept, the words are abbreviated.
6. **No parallax, no scroll-triggered animations on the hero.** The hero loads and stays. Motion is reserved for the visual mockup only.

### 10.3 The Mobile 5-Second Test

The mobile 5-second test is harder: the visitor sees the eyebrow, headline, subheadline, and the top of the visual. They may not see the CTA without scrolling. The test is adjusted: a mobile visitor passes if they can answer the four questions after **7 seconds and one thumb-scroll**. The CTA must be visible after one scroll — that is why the visual is 180px tall, not 360px. A taller visual pushes the CTA below the fold and the conversion rate drops.

This is tested on a real Pixel 7 and a real iPhone SE (the smallest common screen) at every hero copy change.

---

## 11. Above-the-Fold Performance Budget

The hero must render in **under 1.2 seconds** on a 4G connection (the median Indian mobile connection, ~10 Mbps). This is the LCP target. Breakdown:

| Asset | Weight | Notes |
|---|---|---|
| HTML | ≤ 18 KB | RSC-rendered, no client JS for above-the-fold |
| CSS (critical) | ≤ 14 KB | Inlined in `<head>`, glass tokens + hero classes only |
| Inter font (400, 600) | ≤ 38 KB | `next/font/google`, subset to Latin + Devanagari digits |
| Hero mockup (AVIF) | ≤ 80 KB (mobile) / 180 KB (desktop) | Responsive `srcset` |
| JS (hydration) | ≤ 45 KB | The hero is mostly RSC; only the CTA + chip hydrate |
| **Total** | **≤ 195 KB mobile / 295 KB desktop** | Lighthouse ≥ 95 achievable |

The animation (12s loop) is loaded **after** first paint, via `requestIdleCallback`. The poster frame is shown until the animation loads. A visitor on a slow connection sees the static AVIF; a visitor on a fast connection sees the animation within ~800ms.

### 11.1 No Third-Party Scripts Above the Fold

Zero third-party scripts load above the fold. No GA, no Hotjar, no Clarity, no Sentry, no Intercom, no Drift, no Tawk.to. The only script tags in the hero are first-party (`/_next/static/...`). This is Rule 3 (TELE-1) enforcement at the network layer — verified by a Lighthouse "Best Practices" audit that flags any third-party origin in the network waterfall.

### 11.2 Lighthouse Targets

| Metric | Target | Hard Floor |
|---|---|---|
| Performance | ≥ 95 | 90 |
| Accessibility | ≥ 95 | 90 |
| Best Practices | ≥ 95 | 90 |
| SEO | ≥ 95 | 90 |

Below the hard floor on any metric = the deployment is blocked. The CI gate is in `web/05_Deployment_Vercel.md §4` (preview-deploy QA loop) and runs Lighthouse against every preview deployment.

---

## 12. Hero Accessibility

1. **H1 is the headline.** Exactly one `<h1>` per page, semantically the hero headline. The eyebrow is a `<p>` with `aria-label="Buddysaradhi version 1.4, built in India"`. The subheadline is a `<p>`. The social proof strip is a `<ul>` with `<li>` items.
2. **CTAs are `<a>` tags**, not `<button>`. They navigate, they do not trigger in-page actions. The `aria-label` on the primary CTA is "Start free — no credit card required" (the full phrase, for screen readers).
3. **The mockup image has `alt` text** describing what it shows: "Screenshot of Buddysaradhi Dashboard showing ₹1,24,500 collected, 38 active students, and 3 batches scheduled for today." The alt text is updated when the screenshot is updated (enforced by the same CI lint that checks the perceptual hash).
4. **Colour contrast.** All text in the hero meets WCAG 2.1 AAA (7:1) against the cosmic background. The emerald CTA text (`#0a0a1a` on `#00FF9D`) is 11.2:1.
5. **Focus rings.** The CTAs have a 2px cyan focus ring (`--accent-cyan` at 60% opacity, 2px offset) visible on Tab navigation. The focus ring never uses the emerald glow — that would conflict with the CTA's own glow.
6. **`prefers-reduced-motion`.** The 12-second animation is replaced with the static AVIF. The `.cta-shimmer` hover effect is disabled. The social proof strip's dot animation (if any) is disabled.

---

## 13. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated, neumorphic controls recipe-annotated, cross-references canonical (`§5.5`, `§6.6`, `§8.*`, `BR-*`, `P*`, `AP-*`). Box widths honour §20.3 rule 2 (80–120 for landing-page sections, 60–80 for components). The hero card anatomy (§2.1.1), CTA stack (§2.1.2), and mobile layout (§10.1) already live above; this section adds four new mockups that consolidate the hero composition across desktop + mobile, the platform-detect swap, and the aurora-blob placement.

### 13.1 Design System Reference (§5.5 + §6.6 single rule)

The hero is the strictest enforcement zone on the entire marketing surface (`AGENTS.md §2` Rule 10). It contains **one glass surface** (the headline card, `.glass` per §5.5 marketing-hero-card row) and **two neumorphic controls** (the primary CTA `.neumo-raised` + emerald glow, the secondary CTA `.neumo-raised` + cyan border, per §6.6 primary-button row). The cosmic canvas is the aurora source (`§2.2` root background recipe); the glass blurs the aurora behind the card. **No glass-on-glass** (`§5.3`): the inner CTA stack is rendered as flat controls inside the glass card, not as nested glass panels.

| Hero surface / control (per §5.5 + §6.6) | Tier / recipe | Spec |
|---|---|---|
| Headline card | `.glass` (5% white, 24px blur) | §2.1.1, §5.5 marketing-hero-card |
| CTA #1 — "Start free — no card" | `.neumo-raised` + emerald glow | §2.1.2, §6.6 primary-button, §8.2 |
| CTA #2 — "Watch the 90s tour ▶" | `.neumo-raised` + cyan border (no glow) | §2.1.2, §6.6 primary-button, §8.2 |
| Right-column visual (12s loop) | flat video / AVIF (no glass) | §2.2 |
| Aurora-blob canvas | raw cosmic gradient (no glass) | §2.2 root background recipe, §7.3 aurora-drift |
| Platform-detect chip | flat tinted chip (§2.3) — not glass, not neumorphic | §8.1 |
| Trust line ("No card · Free for everyone…") | inline caption inside the glass card | §7 |

### 13.2 Full Hero Composition — Desktop (NEW)

The hero rendered as a single composition on the cosmic canvas at ≥ 1024px. The left column hosts the glass headline card with eyebrow / H1 / subheadline / CTA stack / trust line; the right column hosts the 12-second looping dashboard mockup. Aurora blobs drift behind the glass; the glass blurs them. This is the artefact the Lighthouse audit (`AGENTS.md §7.1`) measures against.

```
  HERO COMPOSITION — DESKTOP (≥ 1024px), 12-col grid (§4.2)
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  ░░░ cosmic canvas: #0f0c29 → #24243e → #0a0a1a (§2.2) — aurora source ░░░░░░░░░░░░ │
  │  ░░  ╭──────────────── aurora blob (emerald, 3% opacity) ─────────────╮  ░░░░░░░░░░░░ │
  │  ░░  │   drifts 0.8px / 60s, blurred behind the glass card (§7.3)    │  ░░░░░░░░░░░░ │
  │  ░░  ╰───────────────────────────────────────────────────────────────╯  ░░░░░░░░░░░░ │
  │  ░░                                                                        ░░░░░░░░░░░░ │
  │  ░░  ┌── .glass headline card (col-span-7) ────────────────────────╲  ░░░░░░░░░░░░ │
  │  ░░  │▌ ◉  BUDDYSARADHI · v1.4 · BUILT IN INDIA                          │  ░░░░░░░░░░░░ │
  │  ░░  │▌                                                              │  ░░░░░░░░░░░░ │
  │  ░░  │▌ Five screens. Seven engines. One ledger.                    │  ░░░░░░░░░░░░ │
  │  ░░  │▌ Zero servers to manage.                                      │  ░░░░░░░░░░░░ │
  │  ░░  │▌ The operating system for private tutors and                 │  ░░░░░░░░░░░░ │
  │  ░░  │▌ small coaching institutes.                                  │  ░░░░░░░░░░░░ │
  │  ░░  │▌                                                              │  ░░░░░░░░░░░░ │
  │  ░░  │▌ Stop juggling WhatsApp, Excel, and a paper register.        │  ░░░░░░░░░░░░ │
  │  ░░  │▌ Buddysaradhi replaces all three — built for India, free for everyone.│  ░░░░░░░░░░░░ │
  │  ░░  │▌                                                              │  ░░░░░░░░░░░░ │
  │  ░░  │▌ ┌─────────────────────┐  ┌──────────────────────┐           │  ░░░░░░░░░░░░ │
  │  ░░  │▌ │ Start free — no card│  │ Watch the 90s tour ▶ │           │  ░░░░░░░░░░░░ │
  │  ░░  │▌ └─────────────────────┘  └──────────────────────┘           │  ░░░░░░░░░░░░ │
  │  ░░  │▌  ↑ neumo-raised +          ↑ neumo-raised,                   │  ░░░░░░░░░░░░ │
  │  ░░  │▌    emerald glow (CTA #1)    cyan border, no glow (CTA #2)    │  ░░░░░░░░░░░░ │
  │  ░░  │▌                                                              │  ░░░░░░░░░░░░ │
  │  ░░  │▌ No card · Free for everyone · Free while our infra stays free         │  ░░░░░░░░░░░░ │
  │  ░░  └────────────────────────────────────────────────────────────╱░░░░░░░░░░░░ │
  │  ░░                                                                        ░░░░░░░░░░░░ │
  │  ░░                                    ┌── right-column visual (col-5) ──╲░░░░░░░░░░░░ │
  │  ░░                                    │  [ AVIF first frame + delta,    │░░░░░░░░░░░░ │
  │  ░░                                    │    720p H.264 loop, ≤ 180 KB ]  │░░░░░░░░░░░░ │
  │  ░░                                    │   cycles: Dashboard 4s →       │░░░░░░░░░░░░ │
  │  ░░                                    │   Attendance 4s → Fees 4s →    │░░░░░░░░°░░░░ │
  │  ░░                                    │   repeat (600ms cross-fades)   │░░░░░░░░°░░░░ │
  │  ░░                                    └────────────────────────────────╱░░░░░░░░░░░░ │
  │  ░░                                                                        ░░░░░░░░░░░░ │
  │  ░░  ┌── trust strip (.glass-faint) — social proof line (§9) ─────────╲░░░░░░░░░░░░ │
  │  ░░  │  Used by 1,000+ tutors · ★★★★★ 4.9 · Pune · Nagpur · Indore   │░░░░░░░░░░░░ │
  │  ░░  └───────────────────────────────────────────────────────────────╱░░░░░░░░░░░░ │
  │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
  └────────────────────────────────────────────────────────────────────────────────────┘
   ↑ .glass: rgba(255,255,255,0.05) + backdrop-blur(24px) saturate(140%) per §5.1
   ↑ .glass-faint: 2% white + 8px blur per §5.2 (the trust strip recedes)
   ↑ CTA #1 neumo-raised: 4px 4px 8px #0a0a1a, -4px -4px 8px #2a2a5a, + emerald glow
     (§6.1, §6.6, §8.2). 240×56px ≥ 44×44px (§10.2). → /signup route.
   ↑ CTA #2 neumo-raised: same dual-shadow, no glow, 1px cyan border @ 40%
     (§6.1, §6.6, §8.2). ~200×56px ≥ 44×44px (§10.2). → video modal (Vercel Blob MP4).
   ↑ Aurora-blob drift = the only ambient motion permitted on hero (§7.3 aurora-drift,
     P7 — motion is meaning). prefers-reduced-motion freezes the blob (§7.2).
   ↑ Right-column visual is FLAT (no glass, no neumo) — a video frame, not a surface.
   ↑ No glass-on-glass (§5.3): CTA stack rendered as flat controls inside the glass card.
   ↑ All text WCAG 2.1 AAA (7:1) on cosmic canvas per §12; emerald-on-#0a0a1a = 11.2:1.
   ↑ No telemetry SDK (Rule 3, AP-10, TELE-1) — no scroll-tracking, no heatmaps.
```

### 13.3 Full Hero Composition — Mobile (NEW)

The hero at ≤ 768px. The 12-column grid collapses to a single column; the right-column visual drops below the CTA stack; the CTA stack switches from side-by-side to vertical (CTA #1 on top, CTA #2 below). The 16px gap is preserved. The eyebrow caption hides on mobile (≤ 640px) to save vertical space; the platform-detect chip replaces it.

```
  HERO COMPOSITION — MOBILE (≤ 768px)
  ┌────────────────────────────────────────────────┐
  │  ░░░ cosmic canvas: #0f0c29 → #24243e → #0a0a1a │
  │  ░░░ (aurora blob drift preserved, scaled 0.6×) │
  │                                                  │
  │  ┌── .glass headline card (full-width − 32px) ─╲ │
  │  │▌  [▲ macOS detected] ← platform chip §8.1   │ │
  │  │▌                                              │ │
  │  │▌ Five screens. Seven engines.                │ │
  │  │▌ One ledger. Zero servers                    │ │
  │  │▌ to manage.                                  │ │
  │  │▌                                              │ │
  │  │▌ Built for India, free for everyone.                       │ │
  │  │▌                                              │ │
  │  │▌ ┌────────────────────────────────────────┐  │ │
  │  │▌ │   Start free — no card                │  │ │ ← CTA #1
  │  │▌ └────────────────────────────────────────┘  │ │   neumo-raised + emerald
  │  │▌ ┌────────────────────────────────────────┐  │ │
  │  │▌ │   Watch the 90s tour ▶                │  │ │ ← CTA #2
  │  │▌ └────────────────────────────────────────┘  │ │   neumo-raised + cyan
  │  │▌  ↑ 16px gap between CTAs (preserved)        │ │
  │  │▌                                              │ │
  │  │▌ No card · Free for everyone · Free while our infra stays free      │ │
  │  └──────────────────────────────────────────────╱ │
  │                                                  │
  │  ┌── right-column visual (full-width) ─────────╲ │
  │  │  [ AVIF 480p H.264 loop, ≤ 90 KB mobile ]    │ │
  │  │   Dashboard 4s → Attendance 4s → Fees 4s     │ │
  │  └──────────────────────────────────────────────╱ │
  │                                                  │
  │  ┌── trust strip (.glass-faint) ───────────────╲ │
  │  │  Used by 1,000+ tutors · ★★★★★ 4.9           │ │
  │  └──────────────────────────────────────────────╱ │
  └────────────────────────────────────────────────┘
   ↑ .glass: same recipe as desktop, full-width minus 32px gutters (§4.3)
   ↑ CTAs are full-width, stacked vertically, 16px gap preserved (§10.2)
   ↑ Platform chip replaces eyebrow on mobile (§8.1, §10.2)
   ↑ Right-column visual scales to 480p; ≤ 90 KB (§11.1 perf budget)
   ↑ Aurora-blob drift preserved but scaled 0.6× — small screen, small motion
   ↑ prefers-reduced-motion freezes blob AND pauses video loop (§7.2)
   ↑ 44×44px minimum hit area on every CTA (Rule 10, P15, §10.2)
   ↑ Mobile 5-second test: same criterion as desktop (§1) — visitor must
     internalise "Buddysaradhi is the OS for tutors" in 5s on a ₹12,000 Android.
```

### 13.4 Platform-Detect Swap (NEW)

The platform-detect chip swaps between five states based on `navigator.userAgent` (per §8.2 detection logic). On desktop, the chip appears in the eyebrow row; on mobile, it replaces the eyebrow. The chip is a flat tinted badge (§2.3), not glass and not neumorphic — it is a label, not a surface or control. When detected, the corresponding download card in §4 of the download hub gets an emerald "Recommended for your device" ribbon.

```
  PLATFORM-DETECT CHIP — FIVE STATES  (§8.2 detection logic, §8.1 anatomy)

  macOS detected             Windows detected          Android detected
  ╭───────────────────╮     ╭───────────────────╮    ╭───────────────────╮
  │ ▲ macOS detected   │     │ ⊞ Windows detected │    │ 🤖 Android detected│
  ╰───────────────────╯     ╰───────────────────╯    ╰───────────────────╯
   ↑ flat tinted chip        ↑ flat tinted chip       ↑ flat tinted chip
     bg-emerald/10              bg-cyan/10              bg-emerald/10
     border-emerald/30          border-cyan/30          border-emerald/30
     text-emerald               text-cyan               text-emerald
   ↑ tap → scroll to          ↑ tap → scroll to        ↑ tap → scroll to
     macOS download card        Windows download card   Android download card
     (product/04 §2.3)          (product/04 §2.3)       (product/04 §2.3)
   ↑ on the download card,
     an emerald "Recommended
     for your device" ribbon
     appears above the button

  iOS detected (Safari)      Bot / unknown / no-JS
  ╭───────────────────╮     ╌═══════════════════┐
  │  iOS detected      │     │  No chip rendered │
  ╰───────────────────╯     └═══════════════════┘
   ↑ flat tinted chip         ↑ §8.4 — no detection
     bg-cyan/10                  on bots/crawlers;
     border-cyan/30             SSR-safe; the chip
     text-cyan                  only mounts after
   ↑ tap → App Store /          navigator.userAgent
     TestFlight link            is available
     (product/04 §2.3)

   ↑ Every chip is a FLAT TINTED badge (§2.3) — not glass, not neumorphic.
   ↑ The chip is a LABEL, not a control; tapping it scrolls, doesn't trigger.
   ↑ Detection logic per §8.2 — runs client-side in PlatformDetector Island
     (web/07 §4.2); SSR renders the "no chip" state, then the chip hydrates.
   ↑ No telemetry — the detection is local-only (Rule 3, AP-10, TELE-1);
     the user-agent string never leaves the browser.
```

### 13.5 Aurora-Blob Placement (NEW)

The aurora-blob drift is the only ambient motion permitted on the hero (per §7.3 `aurora-drift` token, P7 — motion is meaning). Three blobs drift behind the glass card at 3% opacity, blurred by the glass's `backdrop-filter: blur(24px) saturate(140%)`. The blobs are part of the cosmic canvas (§2.2), not the card; the card blurs them. This is the structural reason the hero is dark-only (§6.5 — neumorphism-on-cosmic, glass-blurs-aurora).

```
  AURORA-BLOB PLACEMENT — TOP-DOWN VIEW (z-axis stack)
  ─────────────────────────────────────────────────────
  z = 0   ┌────────────────────────────────────────────┐
          │  COSMIC CANVAS  (§2.2 root background)     │
          │  gradient #0f0c29 → #24243e → #0a0a1a      │
          └────────────────────────────────────────────┘
                            ▲
  z = 1   ┌────────────────────────────────────────────┐
          │  AURORA BLOBS  (3 blobs, 3% opacity each)   │
          │  ╭─── emerald blob ───╮  ╭── cyan blob ──╮ │
          │  │  600px × 600px     │  │  480px × 480px │ │
          │  │  drift: 0.8px / 60s│  │  drift: 0.6/80s│ │
          │  │  blur(40px)        │  │  blur(32px)    │ │
          │  ╰────────────────────╯  ╰────────────────╯ │
          │            ╭── violet blob ──╮              │
          │            │  420px × 420px  │              │
          │            │  drift: 0.4/100s│              │
          │            │  blur(28px)     │              │
          │            ╰─────────────────╯              │
          └────────────────────────────────────────────┘
                            ▲
  z = 2   ┌────────────────────────────────────────────┐
          │  GLASS HEADLINE CARD  (.glass, §5.1)        │
          │  backdrop-filter: blur(24px) saturate(140%)│
          │  — blurs the aurora behind it (z = 1)      │
          │  — the aurora SEEMS to glow through the     │
          │    card edges; this is the intended effect  │
          └────────────────────────────────────────────┘
                            ▲
  z = 3   ┌────────────────────────────────────────────┐
          │  NEUMORPHIC CTAs  (.neumo-raised, §6.1)     │
          │  — extrude from the cosmic canvas, not from │
          │    the glass card (no glass-on-glass, §5.3) │
          │  — CTA #1 = emerald glow; CTA #2 = cyan     │
          │    border, no glow                          │
          └────────────────────────────────────────────┘

   ↑ z-stack: canvas (0) → aurora (1) → glass card (2) → neumorphic CTAs (3).
   ↑ The glass card's backdrop-filter blurs the aurora behind it — this is
     WHY the system is dark-only (§6.5): on white, the aurora disappears.
   ↑ Aurora-blob drift = the ONLY ambient motion permitted on hero per §7.3
     (aurora-drift token); all other hero motion is state-change only (P7).
   ↑ prefers-reduced-motion: blobs freeze in place, glass stays (§7.2).
   ↑ No parallax, no shimmer on the hero card itself (§8.2 no-parallax rule).
   ↑ The CTAs are not on the glass card — they are on the cosmic canvas, so
     the neumorphic dual-shadow reads correctly (§6.5 — needs mid-tone canvas).
   ↑ All three accent colours (emerald, cyan, violet) appear as aurora tints;
     amber and flare are NOT in the hero palette (reserved for state §2.4).
```

### 13.6 References (External Design Authorities)

The hero mockups and the platform-detect swap synthesise practices from the following public bodies of work. Cite them when a contributor challenges the glass-card recipe, the CTA hierarchy, or the aurora-blob placement.

- **Nielsen Norman Group** — *5-Second Test for UX* and *Above-the-Fold Patterns for SaaS Marketing*. The §13.2 desktop composition and §13.3 mobile composition follow NN/g's first-impression research.
- **Smashing Magazine** — *Hero Region Design* and *Headline Length for Conversion*. The §13.2 single-glass-card composition and the §13.4 platform-detect swap follow Smashing's hero-region research.
- **Baymard Institute** — *CTA Hierarchy and Visual Mass* and *Mobile Hero Layout*. The §13.3 mobile vertical CTA stack and the §13.4 chip-to-card scroll target follow Baymard's mobile-checkout research.
- **Apple Human Interface Guidelines** — *Marketing Surfaces* and *Tactile Foundations*. The §13.5 z-axis stack (canvas → aurora → glass → neumo) follows Apple HIG's layered-surface guidance.
- **A List Apart** — *Headline Writing for the Web* and *Mobile-First Copy*. The §13.3 mobile headline compression (3 lines max, eyebrow → chip swap) follows ALA's mobile-first doctrine.
- **Google Search Central** — *Mobile-First Indexing* and *LCP Budget*. The §13.2 LCP ≤ 1.2s budget on 4G and the §13.3 480p mobile video follow Google's mobile-first indexing requirements.
- **Vercel Web Analytics docs** — *Privacy-Respecting Analytics*. The §13.4 platform-detect local-only rule (user-agent never leaves the browser) follows Vercel's privacy-first analytics posture.

---

## 14. Cross-References

- `01_Product_Positioning.md §1.1` (tagline — the headline is the compressed tagline), §6 (brand voice), §3 (USPs).
- `07_CTA_and_Conversion.md §1` (the 7 CTAs across the page — the hero owns 2 of them), §10 (the two-tap signup target).
- `04_Download_Hub.md §3` (platform auto-detection, shared with the hero chip), §4 (the manual-override download hub).
- `13_UI_Guidelines.md §2.1` (color tokens), §3.2 (type ramp), §4.2 (12-column grid), §5 (glass tiers), §10 (accessibility).
- `09_SEO_and_Analytics.md §2` (title tag, meta description — derived from the headline), §3 (OG image — derived from the hero visual).
- `08_Testimonials_and_Social_Proof.md §5` (the "1,000+ tutors" social proof line and its authenticity rule).
- `web/07_Landing_Page.md §4` (Hero Section Implementation — the HOW: `<h1>` JSX, the platform-badge Client Island, the hero visual pipeline, the A/B variant RSC split. This file owns the words; that file owns the React tree those words render into).
- `web/01_Architecture.md §6` (middleware for platform detection + A/B variant assignment).
- `deployment/02_Vercel_Blob_Build_Storage.md §4` (hosting the hero mockup image and the 90s tour video).
- `10_Security.md §17` (TELE-1 — no telemetry SDK; the hero is the strictest enforcement zone).
- `AGENTS.md §7` (testing protocol — Lighthouse ≥ 95, real-device scroll test).

---

## References

The hero conventions in this file draw on the following public bodies of practice. Cite them when a contributor challenges the 5-second test, the headline-length budget, or the platform-detect swap logic.

- **Nielsen Norman Group** — *5-Second Test for UX* and *Above-the-Fold Patterns for SaaS Marketing*. The §1 five-second test criterion and the §2 vertical-rhythm budget follow NN/g's research on first-impression testing.
- **Smashing Magazine** — *Hero Region Design* and *Headline Length for Conversion*. The §3.3 headline style rules (display 56/64, four lines max, no gradient text, period at end of every sentence) are Smashing-anchored.
- **Baymard Institute** — *CTA Hierarchy and Visual Mass* and *Hero CTA Placement*. The §5.3 CTA hierarchy rule (emerald primary always left, glass-cyan secondary always right) and the §5.1 "why emerald not cyan" rationale are Baymard-anchored.
- **Apple Human Interface Guidelines** — *Marketing Surfaces* and *Tactile Foundations*. The §2.2.1 aurora-blob placement and the §2.1.1 glass-panel layer cake follow Apple HIG's guidance on layered surfaces and depth.
- **A List Apart** — *Headline Writing for the Web* and *Subheadline Strategy*. The §4.2 subheadline rules (two lines max, always include price, always include one USP, no CTA verb) are ALA-anchored.
- **Google Search Central** — *Title Tag Length and Mobile-First Indexing*. The §11 above-the-fold performance budget (LCP ≤ 1.2s on 4G, no third-party scripts above the fold) is calibrated to Google's mobile-first indexing requirements.

---

*The hero is the only part of the page that every visitor sees. If it fails the five-second test, no amount of polish below the fold will save the conversion. Treat every word in this file as load-bearing.*
