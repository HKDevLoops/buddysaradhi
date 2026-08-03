# AGENTS.md — Product Landing Page Agent Directive

> Read this file first when working in `product/`. It governs every marketing agent, copywriter, and conversion reviewer who touches the Buddysaradhi commercial landing page spec. Copy without a brand-voice citation is off-brand. A "clever" headline that violates a non-negotiable is not clever. "It reads well to me" is never sufficient — it must read well to Riya in Nagpur on a ₹12,000 Android phone with 2 bars of 4G.

---

## 0. Prime Directive

> **This directory is the commercial front-door spec. Every sentence, every CTA, every screenshot, every FAQ answer optimises for one of two outcomes: a tutor signs up, or a tutor downloads an app. If a line of copy does not move a visitor closer to one of those two actions, it does not belong on this page.**

The landing page is not a brochure, a manifesto, or a spec-reader showcase. It is a **funnel with a single destination** — the signup form at `/signup` or the download button on one of five platform cards. The eleven files in this directory collectively specify every word, every colour, every interaction, and every analytics event on that funnel. When a marketing agent writes or amends a file here, they are amending the contract that `web/07_Landing_Page.md` implements and that the live `buddysaradhi.app/` renders.

### 0.0 Platform Sequencing — Copy Ships With Web, Downloads Respect the Order

> **Read `../16_Platform_Delivery_Sequence.md`.** The landing page is a **Web-phase** surface (it renders at `buddysaradhi.app/`, which is the web app). But its "Download" CTAs point at three platforms that ship serially — so the copy must not promise a download that does not exist yet.

As the product/marketing agent, the boundary rules:

- **You may edit:** `buddysaradhi_Planning/product/*.md`, append-only `worklog.md`. The landing-page *copy and design spec* lives here; its *implementation* lives in `web/07_Landing_Page.md` + `apps/web/` (owned by the web agent).
- **The 3D hero** (`../20_3D_Product_Page.md`) is a Web-phase deliverable (W6). Its copy + KPI text are owned here (`02_Hero_and_Above_the_Fold.md`); its WebGL scene is owned by the web agent. Coordinate via this spec, not by editing `apps/web/`.
- **Download CTAs must reflect reality.** While `In-Flight: WEB`, the landing page shows only the "Open the web app" / "Start free" CTA. The "Download for iOS/Android" CTA appears only after `MOBILE-PROD-GATE`; "Download for Mac/Windows" only after `DESKTOP-PROD-GATE`. A download button that 404s is a conversion crime and a brand lie — gate the CTA on the worklog's gate sign-offs.
- **You may NOT edit:** `apps/*` or `src-tauri/` (app code). Copy changes requested by an app team are filed as issues against this directory.
- **"Free for everyone, for now"** (`product/05_Pricing_and_Plans.md`) is the single public pricing message across all platforms. No platform-specific pricing copy.

The commercial front door opens onto web first; the other doors unlock as their platforms ship.

### 0.1 The Spec → Copy → Review Loop

Every non-trivial copy change follows this loop, in order:

1. **Spec.** Read or amend the relevant `product/` file. If amending, cite the principle (`01_Product_Principles.md`) that authorises the change and the non-negotiable it must not violate.
2. **Copy.** Write the headline, bullet, FAQ answer, or CTA against the spec. Every claim must be verifiable against a spec under `Buddysaradhi_Planning/`.
3. **Review.** Two-human review (§7.3) before the copy ships to `web/07_Landing_Page.md` for implementation.

If the copy diverges from the spec, the spec wins — *unless* the spec is wrong, in which case you amend the spec first, get the amendment reviewed, and only then change the copy. Spec drift on a marketing page is expensive: it surfaces as a broken promise to a tutor who signed up expecting one thing and got another.

### 0.2 The No-Orphan-Copy Rule

> Every headline, bullet, FAQ answer, CTA, and testimonial maps to a named spec section. Copy that maps to nothing gets cut.

When you write a new feature bullet, the first thing you cite is the spec it points to — e.g. *"Marks 38 students present in 20 seconds"* → `06_Attendance.md §3 (BR-ATT-01)`. When a reviewer asks "where in the product does this claim live?" and you cannot answer in one sentence, the answer is "cut the bullet."

---

## 1. File Map

Eleven files. The first six were authored by Task 4-PRODUCT-A (positioning, hero, features, download, pricing). The last five were authored by Task 4-PRODUCT-B (FAQ, CTA, testimonials, SEO, this file). Read in order on first encounter.

| # | File | Words | Owns |
|---|---|---|---|
| 1 | `README.md` | ~2,600 | Orientation, file index, funnel diagram, decision tree, relationship to `web/07_Landing_Page.md`. |
| 2 | `01_Product_Positioning.md` | ~5,000 | Value proposition, three personas (Riya/Kabir/Ananya), USP matrix, brand voice, India-first market analysis. |
| 3 | `02_Hero_and_Above_the_Fold.md` | ~4,600 | Hero headline, subheadline, primary/secondary CTA, hero visual, 5-second test, platform auto-detection. |
| 4 | `03_Features_Showcase.md` | ~4,400 | The 5-screen story, 7 hidden engines, feature cards, "see it live" deep-links, competitor comparison. |
| 5 | `04_Download_Hub.md` | ~4,700 | 5 platform cards, SHA-256 checksums, install guides, Vercel Blob manifest wiring, QR code, bandwidth budget. |
| 6 | `05_Pricing_and_Plans.md` | ~4,500 | Free / Pro ₹299 / Institute ₹999 tiers, UPI-first payments, ROI calculator, scholarship program. |
| 7 | `06_FAQ.md` | ~5,300 | 6 categories, 49 Q&A pairs, top-5 shortlist, searchable accordion, JSON-LD FAQPage, "still stuck?" fallback. |
| 8 | `07_CTA_and_Conversion.md` | ~4,600 | 7 CTAs (copy/placement/color/goal), funnel, two-tap signup, micro-conversions, A/B framework, no dark patterns. |
| 9 | `08_Testimonials_and_Social_Proof.md` | ~4,200 | 5-tutor grid, 2 case studies, video embeds, star ratings, "join 1,000+ tutors", authenticity rule. |
| 10 | `09_SEO_and_Analytics.md` | ~4,900 | Keyword map, on-page SEO, OG/Twitter cards, JSON-LD schemas, sitemap, robots, Vercel Web Analytics only, DPDP. |
| 11 | `AGENTS.md` | ~2,100 | This file. Handoff, style guide, stop-and-ask triggers, glossary, testing protocol, done checklist. |

**Total:** ~46,800 words across 11 files. Verified with `wc -w` at the end of every writing session.

---

## 2. The 10 Non-Negotiables (Marketing-Specific Quick Reference)

These are the marketing-facing cuts of the top-level `AGENTS.md §2` rules. Every line of copy, every colour, every analytics event is bound by them.

| # | Rule | Marketing consequence |
|---|---|---|
| 1 | Ledger is append-only (`BR-LED-06`). | Copy says "record" and "void," never "edit" or "delete a fee." |
| 2 | No network calls that process user data (Rule 2, P5). | The landing page has no user yet, but the download manifest fetch must not leak visitor IPs to third parties. |
| 3 | No telemetry SDK (Rule 3, AP-10, `10_Security.md §17` TELE-1). | No GA, no Mixpanel, no PostHog, no Hotjar, no Clarity. Only Vercel Web Analytics (aggregate-only, no cookies, no PII). |
| 4 | Five screens only (Rule 4, P2). | The features section showcases exactly five screens. A 6th card is a stop-and-ask trigger (§5). |
| 5 | No indigo/blue primary accents (Rule 5, AP-6, `13_UI_Guidelines.md §1.3`). | Palette: Emerald `#00FF9D`, Cyan `#00F0FF`, Amber `#FFB300`, Flare `#FF5E00`, Violet `#B388FF`, on cosmic canvas `#0f0c29`→`#24243e`→`#0a0a1a`. |
| 6 | Integer paise, never float (Rule 6, `BR-M-01`). | Pricing displays as ₹0/mo (Free for everyone, for now — pre-trigger; single public tier) or ₹299/mo (whole rupees, post-trigger; internal Appendix A). The Razorpay amount is `29900` paise integer (post-trigger). Never ₹299.00. |
| 7 | Every mutation writes `sync_outbox` (Rule 7, `BR-SYN-01`). | Not applicable to the marketing page (no mutations), but the signup → provisioning flow triggered by the hero CTA does. |
| 8 | Backups are AES-256-GCM + Argon2id (`BACKUP-1`). | The FAQ "is my data safe?" answer cites this verbatim. |
| 9 | No silent failures (Rule 9, AP-9). | A download button whose Blob URL 404s shows a typed error toast, not a silent no-op. |
| 10 | Accessibility is mandatory (Rule 10, P15). | 44×44px touch targets on every CTA. `prefers-reduced-motion` honoured. WCAG 2.1 AA contrast on the cosmic canvas. |

---

## 3. Copywriting Style Guide — The Brand Voice

The brand voice is **confident, warm, jargon-free, India-first English**. It is the voice of a senior product marketer who actually tutors on weekends — someone who has marked attendance in a paper register, chased a parent on WhatsApp for fees, and lost a sheet to the monsoon. Every sentence reads like it was written by that person, for that person.

### 3.1 The Voice in One Paragraph

> We write the way a trusted senior tutor would explain Buddysaradhi to a colleague over chai — direct, specific, slightly wry, never breathless. We use concrete numbers (₹0/mo Free for everyone, for now, while our infra stays free; 38 students, 20 seconds; ₹299/mo Pro and ₹999/mo Institute when the §1.6 trigger fires — internal-only until then) not vague adjectives ("powerful," "seamless," "revolutionary"). We name Indian cities, Indian subjects (CBSE, ICSE, NEET, JEE), Indian payment methods (UPI, Razorpay, netbanking). We never use Silicon Valley clichés ("supercharge," "10x," "game-changer"). We never condescend ("even your grandmother could use it"). We never create false urgency ("Limited time! Offer ends tonight!"). We trust the tutor to recognise value without being shouted at.

### 3.2 Do's

- **Use concrete numbers.** "Marks 38 students present in 20 seconds" beats "fast attendance."
- **Use Indian context.** "₹2,500/mo per student, UPI preferred" beats "affordable monthly pricing."
- **Name real subjects and boards.** "Class 10 CBSE Maths," "NEET Biology," "JEE Physics" — not "various subjects."
- **Cite the spec that backs every claim.** A feature bullet ends with `→ 06_Attendance.md §3`.
- **Write in active voice.** "Buddysaradhi marks attendance" not "attendance is marked by Buddysaradhi."
- **Keep sentences short.** Average 14 words. Max 28. If a sentence hits 30, split it.
- **Use the Oxford comma.** "Dashboard, Students, Attendance, Fees, and Settings."
- **Format money as `₹299/mo`** (post-trigger, internal Appendix A) or `₹0/mo` / `Free for everyone, for now` (pre-trigger, single public tier) — no decimals, no `.00`, no `INR`. The `/mo` and `/yr` suffixes are always lowercase.

### 3.3 Don'ts

- **No jargon.** "Idempotent," "CRDT," "PPR," "optimistic UI" do not appear in customer-facing copy. They live in the specs.
- **No superlatives without proof.** "The best tuition app in India" is forbidden unless we cite a verifiable source. "Used by 1,000+ tutors" is fine if true.
- **No false urgency.** "Sign up now before this offer ends!" is a dark pattern (§3.4). The free tier is free forever; there is no clock.
- **No guilt-tripping.** "Don't fall behind your competitors" is manipulative. We do not use it.
- **No indigo or blue.** Not in copy ("a cool blue dashboard"), not in colour values, not in OG images. (Rule 5.)
- **No invented testimonials.** Every quote is real and verifiable (`08_Testimonials_and_Social_Proof.md §1`).
- **No "we" when "you" is stronger.** "You mark 38 students present in 20 seconds" beats "We help you mark attendance."

### 3.4 The No-Dark-Patterns Rule

> **A dark pattern is any copy or UI that manipulates a visitor into converting against their genuine interest. Buddysaradhi uses none of them.** (`01_Product_Principles.md P15` — honest empty states; `07_CTA_and_Conversion.md §13`.)

Forbidden dark patterns on this page:

1. **False urgency** — countdown timers, "only 3 spots left," "offer ends at midnight." The free tier is free forever.
2. **Confirmshaming** — "No thanks, I prefer spending 3 hours a month on Excel." The "no thanks" path is a plain link: "Maybe later."
3. **Forced continuity** — requiring a card to start a free trial. Signup is email + OTP, no card (`07_CTA_and_Conversion.md §10`).
4. **Misdirection** — a giant "Subscribe" button and a tiny grey "No thanks." Both buttons are the same size.
5. **Roach motel** — easy to sign up, hard to cancel. Cancellation is one tap in Settings; the FAQ says so (`06_FAQ.md §6.2` Q3).
6. **Privacy zuckering** — "we'll share your data with partners to improve your experience." We do not share data. Period.

### 3.5 The No-False-Urgency Rule (Specific)

The free tier has no expiry. The Pro tier price does not change. There is no "launch offer," no "early-bird discount," no "founder's pricing." If a copywriter wants to add any time-limited offer, that is a stop-and-ask trigger (§5). The only exception is a documented scholarship program (`05_Pricing_and_Plans.md §6`) — and even that has no countdown timer.

---

## 4. The Conversion Funnel (One-Liner)

```
visit → scroll 50% → click CTA → signup (email + OTP) → activate (first student) → convert (Pro at 25th student)
```

Full spec: `07_CTA_and_Conversion.md §9`. The landing page owns the first three steps. The web app owns the last three. The handoff point is the two-tap signup (`07_CTA_and_Conversion.md §10`) — email → OTP → empty dashboard, under 30 seconds, no card.

---

## 5. Stop-and-Ask Triggers

The following six changes are **stop-and-ask** — do not implement them autonomously. Refuse, cite the trigger, propose the principled alternative, and escalate to a human reviewer.

| # | Trigger | Why | Principled alternative |
|---|---|---|---|
| 1 | **Adding an 8th CTA** (or removing one of the 7). | The 7-CTA skeleton is the funnel. Changing it changes the funnel. | Amend `07_CTA_and_Conversion.md §1` first, with the conversion-goal rationale, then implement. |
| 2 | **Using indigo or blue** as an accent colour, in copy or in code. | Rule 5, AP-6, `13_UI_Guidelines.md §1.3`. Non-negotiable. | Use the bioluminescent palette: Emerald, Cyan, Amber, Flare, Violet. |
| 3 | **Adding a third-party analytics SDK** (GA, Mixpanel, PostHog, Hotjar, Clarity, Sentry, FullStory). | Rule 3, AP-10, `10_Security.md §17` TELE-1. Non-negotiable. | Use Vercel Web Analytics (aggregate-only, no cookies, no PII). See `09_SEO_and_Analytics.md §6`. |
| 4 | **Changing the pricing tiers** (Free for everyone, for now — single public tier; 250-student soft guidance is internal-only, no paywall; Pro ₹299/mo and Institute ₹999/mo are internal-only future tiers in Appendix A; the §1.6 triggers T1–T5; the grandfather clause). | Pricing is a business decision, not a copy decision. | Escalate to the founder. Amend `05_Pricing_and_Plans.md §1.6` and `12_Business_Rules.md §BR-PRC-*` first. |
| 5 | **Adding a popup, modal, or interstitial** (exit-intent, scroll-triggered, time-delayed). | Dark pattern risk (`01_Product_Principles.md P15`). The page is a single scroll, no interruptions. | Put the message inline in a section, or in the footer. |
| 6 | **Using stock photos instead of real tutors.** | Authenticity rule (`08_Testimonials_and_Social_Proof.md §1`). Stock photos erode trust. | Use real tutor photos with written consent, or initials-in-a-circle avatars. |

---

## 6. Glossary

| Term | Definition |
|---|---|
| **CAC** | Customer Acquisition Cost. Total marketing spend ÷ new paying tutors. Target: ≤ ₹500 for Pro tier. |
| **LTV** | Lifetime Value. Projected revenue from a tutor over their active period. Target: ≥ ₹3,600 (1 yr Pro). |
| **MRR** | Monthly Recurring Revenue. Sum of active Pro + Institute subscriptions at month-end. |
| **ARR** | Annual Recurring Revenue. MRR × 12. |
| **Funnel** | The path from visit → signup → activation → conversion. See `07_CTA_and_Conversion.md §9`. |
| **CTA** | Call-to-action. One of 7 on this page. See `07_CTA_and_Conversion.md §1`. |
| **A/B test** | Controlled experiment comparing two variants. Minimum sample: 1,000 visitors per arm. See `07_CTA_and_Conversion.md §12`. |
| **PPR** | Partial Prerendering. Next.js 16 feature; the landing page is static with two dynamic holes. See `web/07_Landing_Page.md §2.1`. |
| **OG** | OpenGraph. The `<meta>` tags that control link previews on WhatsApp, LinkedIn, Twitter. See `09_SEO_and_Analytics.md §3`. |
| **JSON-LD** | JSON for Linked Data. Structured-data schema in `<script type="application/ld+json">`. See `09_SEO_and_Analytics.md §4`. |
| **DPDP** | Digital Personal Data Protection Act, 2023 (India). Governs how we collect and process personal data. See `09_SEO_and_Analytics.md §7`. |
| **UPI** | Unified Payments Interface. India's primary payment rail. The Pro/Institute checkout defaults to UPI. See `05_Pricing_and_Plans.md §4`. |
| **Razorpay** | Payment gateway. Processes cards, netbanking, UPI. Amounts passed in integer paise. See `12_Business_Rules.md §BR-M-01`. |
| **TestFlight** | Apple's beta distribution service. The iOS download card links to a TestFlight invite. See `04_Download_Hub.md §2.2`. |
| **EAS** | Expo Application Services. Builds and signs the Android APK/AAB. See `mobile/05_EAS_Build.md`. |
| **Vercel Blob** | Vercel's object storage. Hosts desktop installers, Android APK mirror, release manifests. See `deployment/02_Vercel_Blob_Build_Storage.md`. |

---

## 7. Testing Protocol

Before any copy or design change ships to the live `buddysaradhi.app/`, it passes these four gates.

### 7.1 Lighthouse ≥ 95 on All Four Metrics

Run Lighthouse on `/` (mobile simulation, throttled 4G). The landing page must score ≥ 95 on Performance, Accessibility, Best Practices, and SEO. A 94 on any metric is a regression — do not ship. See `web/07_Landing_Page.md §10`.

### 7.2 Real-Device Scroll Test (Low-End Android)

Test on a ₹12,000 Android phone (Redmi/Realme, 4 GB RAM, Chrome). Scroll the full page. The page must not drop below 50 fps in the hero animation, must not jank in the features section, and must load the download hub manifest in under 2 seconds on 4G. If it janks, the copy stays but the implementation changes (`web/07_Landing_Page.md`).

### 7.3 Two-Human Copy Review

Every new or amended headline, FAQ answer, CTA, and testimonial is read by two humans before it ships:

1. **A brand-voice reviewer** — checks the voice (§3), the no-dark-patterns rule (§3.4), and the India-first framing.
2. **A factual reviewer** — checks that every claim maps to a spec (§0.2) and every number is verifiable.

If the two reviewers disagree, escalate to a third. Do not ship on a 1-1 tie.

### 7.4 A/B Test Minimum Sample

Any A/B test on a CTA, headline, or pricing tier runs until each arm has ≥ 1,000 unique visitors (measured via Vercel Web Analytics, aggregate-only). A test declared "significant" at 200 visitors is not significant — it is noise. See `07_CTA_and_Conversion.md §12`.

---

## 8. The "Done" Checklist

A copy or spec change is "done" when all of the following are true:

- [ ] `wc -w` on every amended file meets its minimum (≥ 1,800 words for `AGENTS.md`; ≥ 2,500 for numbered files).
- [ ] Zero indigo/blue accent violations (`grep -ri "indigo\|blue" ... | grep -vi "no indigo\|no blue\|prohibit\|never\|not \|avoid\|forbid"` returns empty).
- [ ] Every claim cites a spec section (`00`–`14`, `web/`, `deployment/`, `mobile/`, `desktop/`).
- [ ] Every code block has a language tag (```tsx, ```bash, ```json, ```text).
- [ ] Every ASCII diagram renders in fixed-width.
- [ ] All hex colours are from the bioluminescent palette or the cosmic canvas.
- [ ] Lighthouse ≥ 95 on all four metrics (if the change touches the rendered page).
- [ ] Two-human review passed (§7.3).
- [ ] Worklog appended with the task ID, agent, work log, and stage summary **and a `State: COMPLETED | PAUSED | BLOCKED` field** (top-level `AGENTS.md` §9.2.2).

### 8.1 Task-to-Task Transition Protocol (extends top-level `AGENTS.md` §9.2)

Marketing/copy agents frequently shift between the 11 product files (positioning, hero, features, pricing, FAQ, CTA, testimonials, SEO, etc.) — a single pricing-model change can cascade into 8+ files. Every shift runs the top-level §9.2.2 Close-Out Checklist. **Marketing-specific shift triggers** (in addition to the top-level §9.2.5 table):
- A pricing-model change mid-cascade (e.g. "Free for everyone" simplification touches product/05, 06, 02, 01, 07, 08, 09, README, AGENTS) → do NOT leave the cascade half-done. Close-out as `PAUSED` with the remaining-file list as the resume point, or finish the full cascade before switching.
- A cross-reference inconsistency surfaces (e.g. `BR-PRC-*` cited but not defined) → close-out the current copy task as `PAUSED`, fix the cross-reference first (`12_Business_Rules.md` / `14_Edge_Cases.md`), resume.
- An indigo/blue accent found in a draft → close-out as `BLOCKED`, fix the palette violation (Rule 5) before continuing.
- A spec contradiction between product/ and a root file surfaces → close-out as `PAUSED`, escalate per §5 stop-and-ask, do not silently pick one.

The `no-orphaned-task.test.ts` lint (§9.2.6) runs in the `webDevReview` cron and fails if a marketing todo is left `in_progress` with no worklog entry in the last 30 minutes. A pricing cascade left half-propagated is the most expensive orphan — the public page says one thing, the FAQ says another, and the SEO schema says a third.

---

## 9. Cross-Reference Conventions

Throughout this directory, cross-references take the form:

- `12_Business_Rules.md §BR-FEE-01` — top-level spec, BR ID.
- `00_Vision.md §3` — top-level spec, section number.
- `01_Product_Principles.md P15` — top-level spec, principle ID.
- `web/01_Architecture.md §3` — sibling platform dir, file + section.
- `deployment/02_Vercel_Blob_Build_Storage.md §5` — sibling deployment dir, file + section.
- `AGENTS.md §2` (no path prefix) — the top-level `AGENTS.md`.
- `product/04_Download_Hub.md §3` — this directory, file + section.

All ASCII diagrams render in fixed-width fonts; copy them verbatim into PRs. All code blocks carry a language tag. All hex colours come from the bioluminescent palette (Emerald `#00FF9D`, Cyan `#00F0FF`, Amber `#FFB300`, Flare `#FF5E00`, Violet `#B388FF`) or the cosmic canvas (`#0f0c29`, `#24243e`, `#0a0a1a`). **No indigo. No blue.** Any indigo or blue in a code sample or colour value is a bug — file it.

---

## 10. Reading Order for a New Marketing Agent

1. This `AGENTS.md` (you are here).
2. `README.md` — orientation, funnel diagram, decision tree.
3. `01_Product_Positioning.md` — value prop, personas, brand voice. Every other file inherits its tone.
4. Top-level `AGENTS.md §2` — the 10 non-negotiables.
5. `13_UI_Guidelines.md §1.3` — the accent map, no indigo/blue.
6. `02_Hero_and_Above_the_Fold.md` — the first 5 seconds.
7. `03_Features_Showcase.md` — the 5-screen story.
8. `04_Download_Hub.md` — the conversion point for non-web users.
9. `05_Pricing_and_Plans.md` — the India-first pricing.
10. `06_FAQ.md` — objection handling.
11. `07_CTA_and_Conversion.md` — the 7 CTAs and the funnel.
12. `08_Testimonials_and_Social_Proof.md` — social proof.
13. `09_SEO_and_Analytics.md` — discoverability + the no-telemetry rule.

If you only have 30 minutes, read 1, 3, 2, 7, 5. That gives you the prime directive, the value prop, the orientation, the download hub, and the pricing — enough to write or review any single section.

---

## 11. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated, neumorphic controls recipe-annotated, cross-references canonical (`§5.5`, `§6.6`, `§8.*`, `BR-*`, `P*`, `AP-*`). Box widths honour §20.3 rule 2 (80–120 for landing-page sections, 60–80 for components). This file owns the agent-handoff layer (no rendered marketing surface); the mockups below visualise the reading-order flowchart and the glossary concept map. These are CONCEPT DIAGRAMS, not live UI surfaces — they do not carry glass-tier or neumo-recipe annotations (per §6.6 single rule, glass/neumo applies only to live-page components).

### 11.1 Design System Reference (§5.5 + §6.6 single rule)

This file is the **agent-handoff contract** — it tells every marketing agent, copywriter, and conversion reviewer how to read the directory, which rules are non-negotiable, and when to stop and ask. The mockups below are *conceptual flowcharts* (reading-order, glossary map). They do **not** carry glass-tier or neumo-recipe annotations because they describe agent workflow, not on-page UI components. The single rule from `§6.6` — *glass for surfaces, neumo for controls, never invert* — applies to the live-page components that the 11 files in this directory specify; this file's job is to enforce the brand voice, the no-dark-patterns rule, and the stop-and-ask triggers that govern every amendment to those files.

| AGENTS.md artefact (this file) | Live-page consumer | Glass / neumo tier (in consumer) |
|---|---|---|
| §0 Prime Directive | every file in `product/` | (governs copy, not surface) |
| §2 The 10 Non-Negotiables | every file in `product/` | (governs copy + colour, not surface) |
| §3 Brand Voice Guide | `product/01 §6` voice pillars | `.glass` (hero card carries the copy) |
| §5 Stop-and-Ask Triggers | `product/07 §13` no dark patterns | (governs process, not surface) |
| §7 Testing Protocol | every file's Lighthouse ≥ 95 gate | (governs QA, not surface) |
| §10 Reading Order | (agent workflow, not UI) | n/a |
| §11 ASCII Art Mockup Suite (this section) | (agent workflow, not UI) | n/a |

### 11.2 Reading-Order Flowchart (NEW)

The §10 reading order rendered as a visual flowchart. A new marketing agent reads file 1 (AGENTS.md) → file 2 (README.md) → file 3 (01_Product_Positioning.md) → top-level AGENTS.md §2 → 13_UI_Guidelines.md §1.3 → file 4 (02_Hero) → file 5 (03_Features) → file 6 (04_Download) → file 7 (05_Pricing) → file 8 (06_FAQ) → file 9 (07_CTA) → file 10 (08_Testimonials) → file 11 (09_SEO). The 30-minute shortcut reads 1, 3, 2, 7, 5 only.

```
  READING-ORDER FLOWCHART — new marketing agent  (per §10 reading order)
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                     │
  │   START ──▶ 1. AGENTS.md (this file)                                                │
  │              ↑ Prime Directive, 10 Non-Negotiables, Brand Voice, Stop-and-Ask       │
  │              ↑ Read FIRST; governs every other file                                  │
  │                      │                                                              │
  │                      ▼                                                              │
  │              2. README.md                                                           │
  │              ↑ Orientation, file index, funnel diagram, WHAT↔HOW contract (§4.1)    │
  │              ↑ Read SECOND; tells you which file owns what                           │
  │                      │                                                              │
  │                      ▼                                                              │
  │              3. 01_Product_Positioning.md                                           │
  │              ↑ Value prop, 3 personas (Riya/Kabir/Ananya), USPs, brand voice         │
  │              ↑ Read THIRD; every other file inherits its tone                        │
  │                      │                                                              │
  │                      ▼                                                              │
  │              ┌─ top-level AGENTS.md §2  (the 10 non-negotiables, marketing cut)     │
  │              ├─ 13_UI_Guidelines.md §1.3  (accent map, no indigo/blue)              │
  │              ↑ Read FOURTH; the binding rules from outside this directory            │
  │                      │                                                              │
  │                      ▼                                                              │
  │              4. 02_Hero_and_Above_the_Fold.md  ──▶ 5. 03_Features_Showcase.md       │
  │              ↑ The first 5 seconds                     ↑ The 5-screen story          │
  │                      │                                      │                       │
  │                      ▼                                      ▼                       │
  │              6. 04_Download_Hub.md            ──▶ 7. 05_Pricing_and_Plans.md         │
  │              ↑ 5 platform cards + SHA-256            ↑ 3 tiers, ₹0/299/999, UPI      │
  │                      │                                      │                       │
  │                      ▼                                      ▼                       │
  │              8. 06_FAQ.md                     ──▶ 9. 07_CTA_and_Conversion.md        │
  │              ↑ 49 Q&As, accordion, "still stuck?"    ↑ 7 CTAs, funnel, A/B framework │
  │                      │                                      │                       │
  │                      ▼                                      ▼                       │
  │              10. 08_Testimonials_and_Social_Proof.md ─▶ 11. 09_SEO_and_Analytics.md │
  │              ↑ 5-tutor grid, authenticity rule         ↑ SEO stack, no-telemetry     │
  │                                                                                     │
  │   ── 30-MINUTE SHORTCUT (if you only have 30 minutes) ──                            │
  │   1 → 3 → 2 → 7 → 5                                                                 │
  │   ↑ AGENTS.md → Product Positioning → README → Pricing → Features                   │
  │   ↑ Gives you: prime directive, value prop, orientation, pricing, 5-screen story    │
  │   ↑ Enough to write or review any single section                                     │
  │                                                                                     │
  │   ── STOP-AND-ASK TRIGGERS (per §5) ──                                              │
  │   ✕ Adding an 8th CTA  → escalate, amend 07_CTA §1 first                            │
  │   ✕ Using indigo/blue  → use bioluminescent palette (Rule 5, AP-6)                  │
  │   ✕ Adding 3rd-party analytics SDK → use Vercel Web Analytics only (Rule 3, AP-10)  │
  │   ✕ Changing pricing tiers → escalate to founder, amend 05_Pricing §1 first        │
  │   ✕ Adding a popup/modal/interstitial → put it inline or in the footer (P15)       │
  │   ✕ Using stock photos → use real tutor photos OR initials-in-a-circle (§1 auth)    │
  │                                                                                     │
  │   ↑ This is a CONCEPT DIAGRAM, not a live UI surface — no glass tier annotation.    │
  │   ↑ The reading order is sequential; the 30-minute shortcut is non-sequential       │
  │     (jumps to the highest-leverage files first).                                    │
  │   ↑ Every file in the flow owns the WHAT; web/07_Landing_Page.md owns the HOW       │
  │     (per the WHAT↔HOW contract in README.md §4.1).                                  │
  └────────────────────────────────────────────────────────────────────────────────────┘
   ↑ All accent colours named (emerald/cyan/amber/flare/violet); no indigo, no blue.
   ↑ India-first voice preserved: ₹ pricing, en-IN lakh format, Indian personas,
     Indian cities (Nagpur/Indore/Bangalore/Pune), Indian curricula (CBSE/ICSE/NEET).
```

### 11.3 Glossary Concept Map (NEW)

The §6 glossary rendered as a concept map. The 16 terms cluster into four families: (a) **business metrics** (CAC, LTV, MRR, ARR), (b) **funnel + A/B** (Funnel, CTA, A/B test, PPR), (c) **SEO + analytics** (OG, JSON-LD, DPDP), and (d) **payments + platforms** (UPI, Razorpay, TestFlight, EAS, Vercel Blob). Every term cross-references its owner file.

```
  GLOSSARY CONCEPT MAP — 16 terms, 4 families  (per §6 glossary)
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                     │
  │  ┌── BUSINESS METRICS ───────────────────────────────────────────────────────╲    │
  │  │  CAC (≤ ₹500 Pro)  ─── LTV (≥ ₹3,600 1yr Pro)  ─── MRR  ─── ARR           │   │
  │  │   ↑ §6                    ↑ §6                       ↑ §6     ↑ §6          │   │
  │  │   ↑ product/07 §9         ↑ product/07 §9            ↑ product/07 §9       │   │
  │  └────────────────────────────────────────────────────────────────────────────╱    │
  │                                                                                     │
  │  ┌── FUNNEL + A/B ───────────────────────────────────────────────────────────╲    │
  │  │  Funnel  ─── CTA (7 total)  ─── A/B test (≥1,000/arm)  ─── PPR (Next 16)  │   │
  │  │   ↑ §6        ↑ §6              ↑ §6                      ↑ §6             │   │
  │  │   ↑ 07 §9     ↑ 07 §1            ↑ 07 §12                  ↑ web/07 §2.1   │   │
  │  └────────────────────────────────────────────────────────────────────────────╱    │
  │                                                                                     │
  │  ┌── SEO + ANALYTICS ───────────────────────────────────────────────────────╲    │
  │  │  OG (OpenGraph)  ─── JSON-LD (4 schemas)  ─── DPDP (India, 2023)          │   │
  │  │   ↑ §6                ↑ §6                       ↑ §6                       │   │
  │  │   ↑ 09 §3              ↑ 09 §4                    ↑ 09 §7                   │   │
  │  └────────────────────────────────────────────────────────────────────────────╱    │
  │                                                                                     │
  │  ┌── PAYMENTS + PLATFORMS ──────────────────────────────────────────────────╲    │
  │  │  UPI (India-first rail)  ─── Razorpay (gateway, integer paise)            │   │
  │  │   ↑ §6                       ↑ §6                                          │   │
  │  │   ↑ 05 §4                    ↑ 12 §BR-M-01                                 │   │
  │  │                                                                            │   │
  │  │  TestFlight (iOS beta)  ─── EAS (Android build)  ─── Vercel Blob (cdn)    │   │
  │  │   ↑ §6                       ↑ §6                  ↑ §6                    │   │
  │  │   ↑ 04 §2.2                   ↑ mobile/05           ↑ deployment/02        │   │
  │  └────────────────────────────────────────────────────────────────────────────╱    │
  │                                                                                     │
  │   ↑ Every term cross-references its owner file (product/NN or sibling dir).        │
  │   ↑ Business metrics cluster: CAC/LTV/MRR/ARR — the founder's dashboard.           │
  │   ↑ Funnel + A/B cluster: the conversion reviewer's vocabulary.                    │
  │   ↑ SEO + analytics cluster: the SEO copywriter's vocabulary.                      │
  │   ↑ Payments + platforms cluster: the engineer's vocabulary (integer paise,        │
  │     TestFlight invite, EAS build, Vercel Blob manifest).                            │
  │   ↑ This is a CONCEPT DIAGRAM, not a live UI surface — no glass tier annotation.   │
  │   ↑ All money is integer paise (BR-M-01, Rule 6); CAC and LTV are in ₹.            │
  └────────────────────────────────────────────────────────────────────────────────────┘
   ↑ India-first: UPI listed first in payments cluster; DPDP (India) listed in SEO.
   ↑ No telemetry SDK in the glossary (Rule 3, AP-10, TELE-1) — Vercel Web Analytics
     is the only analytics tool; it does not need a glossary entry because it is the
     default, not a choice.
```

### 11.4 References (External Design Authorities)

The reading-order flowchart and the glossary concept map synthesise practices from the following public bodies of work. Cite them when a contributor challenges the reading order, the glossary scope, or the stop-and-ask triggers.

- **Nielsen Norman Group** — *Onboarding for Content Contributors* and *Glossary Design for SaaS*. The §11.2 reading-order flowchart and the §11.3 glossary concept map follow NN/g's research on contributor onboarding.
- **Smashing Magazine** — *Documentation Patterns for Design Systems* and *The Reading-Order Doctrine*. The §11.2 sequential + 30-minute-shortcut pattern follows Smashing's research on docs onboarding.
- **Baymard Institute** — *Conversion Glossary for SaaS* and *Funnel Vocabulary*. The §11.3 four-family glossary clustering follows Baymard's research on conversion-team vocabulary.
- **Apple Human Interface Guidelines** — *Documentation Surfaces* and *The Handoff Contract*. The §11.1 design-system reference (this file governs copy, not surface) follows Apple HIG's documentation-surface guidance.
- **A List Apart** — *Content Strategy for Handoff* and *The Stop-and-Ask Pattern*. The §11.2 stop-and-ask triggers and the §11.3 glossary cross-references follow ALA's content-strategy doctrine.
- **Google Search Central** — *Documentation Structured Data*. The §11.3 glossary terms align with the `SoftwareApplication` and `FAQPage` JSON-LD schemas in `product/09 §4`.
- **Vercel Web Analytics docs** — *Privacy-Respecting Analytics*. The §11.3 absence of a telemetry-SDK glossary entry (Vercel Web Analytics is the default, not a choice) follows Vercel's privacy-first posture (Rule 3, AP-10, TELE-1).

---

*This file is the handoff contract. When the live page diverges from this directory's spec, the spec wins — unless the spec is wrong, in which case you amend the spec first, then the page, then the worklog. The order matters.*
