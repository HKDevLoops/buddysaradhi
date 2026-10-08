# PRODUCT.md — BuddySaradhi Product Page Surface Brief

> **Surface Class:** Persuade Surface
> **Target Audience:** Indian private tutors and coaching institute owners (1-200 students) discovering the product for the first time.
> **Primary Goal:** Communicate value proposition clearly, build trust, and convert visitors to free self-serve sign-up.

---

## 1. Product Context & Persuasion Principles

1. **The Promise**: "Five screens. Seven engines. One ledger. Zero servers. The operating system for private tutors and coaching institutes in India. Free for everyone while our infra stays free."

2. **Persuade Mode Priority**:
   - UI priority is clarity, trust-building, and conversion to free self-serve sign-up.
   - Every element must earn its pixels by advancing the visitor toward understanding and action.
   - No decorative filler; every animation, image, and word must carry persuasive weight.

3. **Trust Signals**:
   - No telemetry, ever (explicitly stated).
   - Built in India, for Indian tutors.
   - Offline-first, sovereign data ownership.
   - Free while infrastructure stays free.

---

## 2. Page Architecture (Persuade Surface)

| Section | Purpose | Persuasion Lever |
|---------|---------|------------------|
| **Hero** | Hook + value prop + primary CTA | Immediate value comprehension |
| **Facts Strip** | Verified claims from live API | Evidence over marketing |
| **Five Screens** | Product walkthrough | Mental model formation |
| **Access Panel** | Free sign-up + contracted plan | Funnel to conversion |
| **Footer** | Trust reinforcement | Final trust signal |

---

## 3. Navigation & IA

| Entry Point | Mechanism |
|-------------|-----------|
| **Primary Nav** | Screens → Pricing → Platforms (quiet sign-up shortcut) |
| **Hero CTA** | Free self-serve sign-up (primary) |
| **Footer** | Pricing, Request Access, Platforms, Sign In |
| **Deep Links** | `#screens`, `#access`, `/pricing`, `/platforms`, `/request-access` |

---

## 4. Key User Stories

> **As** Solo Rohan (30-student solo tutor),
> **when** I land on the page,
> **I want** to understand in 5 seconds what this product does and that it's free,
> **so that** I can decide to sign up without friction.

> **As** Centre Priya (150-student coaching institute owner),
> **when** I scroll through the screens section,
> **I want** to see that the product handles my scale and complexity,
> **so that** I trust it can replace my current Excel + WhatsApp workflow.

> **As** a privacy-conscious tutor,
> **when** I read "No telemetry, ever",
> **I want** to verify that claim technically,
> **so that** I trust my student data is truly mine.

---

## 5. Persuade Mode UX Principles

1. **Clarity Over Cleverness**: Every word, image, and interaction must be immediately comprehensible.
2. **Evidence Over Claims**: Facts strip pulls live data from API; no unsourced benchmarks.
3. **One Primary Action Per Viewport**: Hero has one primary CTA (free sign-up); access request is quiet.
4. **Trust Through Transparency**: No telemetry, open about pricing (free), explicit about data ownership.
5. **Accessibility Is Persuasion**: WCAG 2.1 AA minimum; if they can't use it, they can't be persuaded.

---

## 6. Success Metrics

| Metric | Target |
|--------|--------|
| Hero CTA click-through rate | > 3% |
| Time to first meaningful interaction | < 8 seconds |
| Scroll depth to Access panel | > 60% |
| Sign-up completion rate (from landing) | > 40% |
| Lighthouse Performance | ≥ 90 |
| Lighthouse Accessibility | ≥ 95 |

---

## 6. Anti-Goals (What This Page Is NOT)

- **Not a dashboard** — no data entry, no operational UI.
- **Not a feature encyclopedia** — five screens, seven engines, one ledger; that's it.
- **Not a sales brochure** — no fake metrics, no stock photos, no vague promises.
- **Not a support portal** — help lives in the app; this page is for acquisition.

---

## 7. Technical Constraints

- **Force-static + 1h ISR** — page must be statically generated with hourly revalidation.
- **Edge-first** — all API calls to gateway (`/api/v1/marketing/stats`) with 1h cache.
- **3D Hero** — Canvas-based 3D stage (500vh) with poster fallback for no-WebGL/low-end/save-data.
- **Accessibility floor** — WCAG 2.1 AA minimum; focus-visible, skip link, ARIA live regions.
- **Material modes** — Three modes (Minimal/Acrylic/Liquid Glass) via `[data-material]` attribute.
- **Palettes** — 20 palettes (10 dark + 10 light) from generated tokens; default `inked` / `liquid-glass`.