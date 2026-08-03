# 05 — Pricing and Plans

> The pricing section is where a visitor decides whether Buddysaradhi is worth paying for. In v1 the answer is **free** — and not a 14-day-trial kind of free. **Free for everyone, for now.** While our backend infra (Vercel Hobby, Turso free, Vercel Blob free, Razorpay's UPI-0% band) keeps our infrastructure bill at ₹0/mo, the product is ₹0/mo for every tutor — every screen, every feature, no card required, no caps, no ads. The Pro (₹299/mo) and Institute (₹999/mo) tiers exist as **internal-only future tiers** (Appendix A below) — their prices and feature lists are documented for founder/internal reference, but they are **not surfaced on the public pricing page** until the §1.6 trigger fires and `NEXT_PUBLIC_PAID_TIERS_LIVE` flips to `true`. No asterisks, no "contact sales," no waitlist, no dark patterns. Every line of this file is the contract the live page must honour.

---

## 1. The Public Pricing Tier (one tier shown, free for everyone)

| Tier | Status in v1 | Price | Student ceiling | Multi-tutor | Target persona |
|---|---|---|---|---|---|
| **Free** | ✅ Live | ₹0, for everyone — while our backend infra stays free for us (§1.6) | 250 per tutor (internal soft guidance — see §1.2) | No (single tutor) | Ananya, Riya, Kabir — every Indian private tutor and small coaching institute in v1 |

The public pricing page shows **one tier: Free.** No Pro card. No Institute card. No future-tier badges. No waitlist CTAs. No monthly/yearly toggle. No payment-method icon row. The visitor sees a single glass-strong Free card, a single "Start free →" CTA (links to `/signup`), and the public commitment block below. That is the entire public pricing surface in v1.

**Why a single public tier?** Our infra bill today is ₹0/mo — Vercel Hobby, Turso free, Vercel Blob free, Razorpay UPI-0% all sit inside their free bands. Charging a tutor ₹299/mo while our cost to serve them is ₹0/mo would be a tax on trust, not a business model. And **publishing future-tier prices on the public pricing page adds cognitive load without giving the visitor anything they can act on today** — a waitlist CTA is friction without payoff. So we don't. We say "Free for everyone, for now" and we mean it. When the §1.6 trigger fires, the page flips to the 3-tier layout (Free + Pro + Institute with "Upgrade →" CTAs, per Appendix A); until then, the future-tier details live in Appendix A below — for founder/internal reference, not for the visitor.

### 1.1 What "Free for everyone, for now" Means

"Free for everyone, for now" has three commitments bundled into one phrase:

- **"For everyone"** — every Indian private tutor, every coaching institute, every screen, every feature. There is no "Free with limits" tier where features are greyed out. A Free-tier tutor can:
  - Add students (no hard cap — see §1.2 for the 250 soft guidance).
  - Mark attendance (full feature set).
  - Record fees and generate receipts (full ledger, BR-LED-06).
  - Export encrypted backups (BACKUP-1).
  - Sync across devices (BR-SYN-01..09).
  - Use biometric login (BR-SEC-04).
  - Use all 5 screens (Dashboard, Students, Attendance, Fees, Settings).
- **"For now"** — free while our backend infrastructure bill stays at ₹0/mo. The day that changes, we give 60 days' notice, launch Pro (₹299/mo) and Institute (₹999/mo) tiers, and the public pricing page flips from a single Free card to the 3-tier layout (Appendix A). The §1.6 trigger is the source of truth for "when."
- **"No card required"** — a visitor signs up with email only, lands on the dashboard, and adds students. They will not be asked for payment until they choose to upgrade to a future paid tier (and only after that tier has launched).

The Free tier is **ad-free**. No banner ads, no interstitials, no "upgrade to remove ads" prompts inside the app. The only "you crossed 250 students" surface is a friendly, dismissable "tell us your story" prompt (§1.2) — not an upgrade prompt, not a paywall, not a waitlist.

### 1.2 The 250-Student Internal Soft Guidance (NOT a Public Limit)

250 students per tutor is **internal infra-cost guidance**, not a user-facing limit. The number exists because it is the threshold above which our Turso row-count and Vercel Blob backup-storage bills start to matter (see §1.6.1 for the per-tutor cost math). Below 250, our cost-to-serve is rounding-error ₹0; above 250, it starts to creep up. So 250 is the number we watch internally.

**It is NOT a cap on the tutor.** A tutor with 251, 500, or 1,000 students keeps using Buddysaradhi for free. All their students — every one of the 251+ — remain fully accessible: attendance, fees, receipts, sync, export, biometric login, all 5 screens. There is **no paywall, no waitlist, no degraded experience** when a tutor crosses 250.

**What happens at 250?** When `StudentEngine.create` records a tutor's 251st student, the app:

1. Logs a `student_count_milestone` event to the audit log (BR-STU-11).
2. Surfaces a friendly, dismissable prompt on the Dashboard:

   > "You've crossed 250 students — that's amazing! We'd love to hear your story. [Tell us how you use Buddysaradhi →]"

3. The prompt links to a simple Typeform (or founder email — `hello@buddysaradhi.app`) where the tutor can share their setup. It is **never** an upgrade prompt, never a paywall, never a waitlist prompt.
4. The tutor dismisses it (or not) and keeps using the app. The 251st student is fully created, fully accessible, fully synced. No further nag.

The previous model (in v0.x of the spec) had the 251st-student creation **blocked** behind a paywall. We have removed that. The 250 number is now an **internal milestone** that surfaces a friendly prompt — nothing more. The tutor's data keeps working.

#### 1.2.1 Why 250 (Not 25, Not 50, Not Unlimited) — Internal Guidance

Persona research puts the median private tutor at 25–40 students, the top 10% at 80–120, the top 5% at 150–200, and the top 1% (the coaching-institute owners Kabir represents) at 250+. Setting the internal soft-guidance milestone at 250 means **~99% of Indian private tutors will never see the "tell us your story" prompt** — they get the full product, forever, at ₹0/mo, and we never have to ask them for a rupee.

The previous ceiling (25 students, in the v0.x pricing draft) was anchored to a Western product-led-growth pattern: hit them with a paywall at month 9, convert 30%. We reject that pattern for India. Indian tutors are price-sensitive, trust-driven, and they talk — a tutor who hits a 25-student paywall in month 9 tells fifty other tutors in their WhatsApp group "don't bother, they'll charge you." A tutor who gets 250 students free, then crosses 250 and gets a friendly "tell us your story" prompt, tells fifty other tutors "it's actually free, here's the link." The second behaviour compounds; the first one doesn't.

10 students would be too low as a milestone — tutors would cross it in month 3, before they are hooked, and the prompt would feel like a paywall signal. 50 students would be too low — most growing tutors cross 50 within year 2. Unlimited would be dishonest to ourselves — at 1,000+ students per tutor, our Turso row-count and Vercel Blob backup-storage bills stop being free (see §1.6 trigger 2). 250 is the milestone that is both **honest about our cost curve** (a 250-student tutor costs us ≈ 5 MB of Turso rows + 1 MB of compressed backups per month, well inside every free band) and **generous enough to be remarkable** in a market where every competitor paywalls at 25–50 students.

### 1.3 The Public Commitment Block

The pricing page contains a small, plain-English commitment block under the single Free card:

> *Buddysaradhi is free for everyone, for now. Free while our backend infrastructure (Vercel, Turso, Vercel Blob) stays inside its free bands. When that changes, we'll give 60 days' notice before launching paid tiers. No ads, ever. No card required.*

This block is the **single source of truth** for the public-facing pricing model. Every other pricing claim in the public spec package must trace back to a sentence in §1.3 or §1.6. If a contributor challenges it, the answer is §1.6.

### 1.4 The "No Contact Sales" Rule

There is no "Contact Sales" tier. There is no "Enterprise" tier with "Custom Pricing." If a 500-student institute with 10 co-tutors wants Buddysaradhi today, they sign up Free — they get every feature, every student, every screen, at ₹0/mo. When the Institute tier launches (§1.6 trigger, Appendix A), they can choose to upgrade for multi-tutor + GST invoice — but they are not required to. We do not do sales calls in v1.

This rule is **strategic**, not lazy. Sales calls are expensive (CAC spikes, sales-team hiring, forecast unpredictability). They are also a **dark pattern** when the "Contact Sales" tier exists only to anchor the cheaper tiers ("well, at least it's not Enterprise!"). We refuse the pattern. The v1 pricing page has one tier, one price, one feature list, and a "Start free →" button. That is the entire public pricing surface.

### 1.5 Why a Single Public Tier (No Pro/Institute Cards in v1)

The decision to show **one tier** on the public pricing page (instead of three, with Pro and Institute demoted to future-tier waitlist cards) is deliberate:

- **Cognitive load.** A visitor landing on the pricing page wants one answer: "is this free or not?" Three cards with waitlist CTAs make the visitor compute "Free for me now, Pro later, Institute maybe later" — a 3-way decision they did not ask to make. One card gives them the answer in 1 second.
- **No friction without payoff.** A waitlist CTA captures the visitor's email and gives them nothing in return today. There is no upgrade path to click, no early-access perk, no discount. The visitor gives us their email; we give them nothing. That is a one-sided trade, and one-sided trades erode trust.
- **Honesty about v1.** The cost-anchored pricing model says: "We charge when our infra bill crosses ₹0/mo." Until then, every tier is hypothetical. Surfacing hypothetical tiers on the public page invites the visitor to ask "when do they launch?" — and the answer is "we don't know, it depends on our infra bill." That is not a confident pricing message.
- **Easy migration.** When the §1.6 trigger fires, the page migrates from one card to three (Appendix A). The migration is automated by `NEXT_PUBLIC_PAID_TIERS_LIVE`. The visitor who saw one card yesterday sees three cards tomorrow; the founder does not have to rewrite the pricing page.

The Pro and Institute tier definitions (prices, feature lists, post-trigger rationale) live in Appendix A — for founder/internal reference, not for the visitor. When the §1.6 trigger fires, Appendix A becomes the public spec.

### 1.6 Why Free While Our Infra Is Free — The Cost-Anchored Pricing Model

The Free tier is not a marketing tactic. It is a **cost-anchored pricing model**: the price the tutor pays is a direct function of the price we pay to serve them. As long as our backend infrastructure bill is ₹0/mo (because the products we use — Vercel Hobby, Turso free, Vercel Blob free, Razorpay UPI-0% — sit inside their free bands), the tutor's price is ₹0/mo. The day our infra bill crosses the trigger threshold in §1.6.2 for three consecutive months, we launch the Pro and Institute tiers (Appendix A), the public pricing page flips from a single Free card to the 3-tier layout (Free + Pro + Institute with "Upgrade →" CTAs), and the §1.6 trigger's grandfather clause protects every pre-trigger signup. This is the most honest pricing model a small SaaS can run in v1.

#### 1.6.1 The Infra Cost Stack (Today, v1)

| Infra component | Free band | Our usage per active tutor/mo | Headroom in free band |
|---|---|---|---|
| **Vercel Hobby** (web hosting + edge functions) | 100 GB bandwidth/mo, 100 GB-hr serverless execution | ~12 MB bandwidth (sync_outbox pushes), ~2 GB-hr serverless | ~99% headroom — would need ~8,000 active tutors to cross |
| **Turso free** (libSQL sync layer) | 9 GB total DB, 500 DBs, 1 B row reads/mo, 25 M row writes/mo | ~50 KB DB rows per tutor (students + ledger + attendance + sync_outbox) | ~99.99% headroom — would need ~180,000 active tutors to cross |
| **Vercel Blob free** (encrypted backup storage + installer artifacts) | 1 GB storage, 10 GB bandwidth/mo | ~5 KB backup metadata per tutor (the backups themselves live on the tutor's pen-drive; we only store signed manifest URLs) | ~99% headroom — would need ~200,000 active tutors to cross |
| **Razorpay UPI** (payment gateway for the future Pro/Institute tiers) | 0% fee up to ₹50,000/mo transaction volume | ₹0 (no paid tiers in v1 yet) | N/A — the band only matters after Pro launches |
| **GitHub free** (private repo + Actions minutes) | 2,000 Actions min/mo, unlimited private repos | ~120 Actions min/mo (CI + release builds) | ~94% headroom |
| **Cloudflare free** (DNS + CDN in front of Vercel) | Unlimited DNS queries, 1 B requests/mo | ~30 requests per visitor | Effectively unlimited |

**Total infra bill today: ₹0/mo.** The cost-to-serve an individual v1 tutor is ≈ ₹0.0006/mo (the rounding error of Vercel Hobby + Turso free amortised across the free band). Charging a tutor ₹299/mo when our cost to serve them is ₹0.0006/mo would be a 498,000× markup — a tax on trust, not a business model.

#### 1.6.2 The Pricing-Evolution Triggers (When We Will Charge)

We will launch the Pro and Institute tiers — and end the "free for everyone, for now" public messaging — when **any** of the following triggers fires and persists for 3 consecutive calendar months:

| Trigger | Threshold | Rationale |
|---|---|---|
| **T1 — Vercel Hobby crosses free band** | Vercel bandwidth bill > ₹0/mo for 3 consecutive months | We need to upgrade to Vercel Pro ($20/mo) to keep the web app fast. At that point we have enough traffic to justify a paid tier. |
| **T2 — Turso free crosses free band** | Turso row-read bill > ₹0/mo for 3 consecutive months | We need Turso's Scaler plan ($29/mo). This implies ~180,000+ active tutors — a clear signal that the product has scaled. |
| **T3 — Active tutor count threshold** | 2,000+ active tutors (DAU) for 3 consecutive months | Even if our infra bill is still ₹0/mo, a 2,000-tutor user base is large enough to support a paid tier without risking churn. We launch Pro to capture willingness-to-pay before a competitor does. |
| **T4 — Multi-tutor demand threshold** | 50+ support emails/intercom tickets requesting multi-tutor in a single month | The market is telling us it will pay for the Institute tier feature. We launch Institute. |
| **T5 — Razorpay UPI free band crosses** | Razorpay monthly transaction volume > ₹50,000/mo (only relevant post-Pro-launch) | Triggers the 1.99% gateway fee; we may absorb it (Rule: no surcharge) or revisit Pro pricing. |

When a trigger fires, the sequence is:

1. **Month 0** — Trigger fires. We post a 60-day notice on the pricing page ("Heads up: Pro and Institute are launching on `[date]`. If you're on Free, you stay on Free — your access does not change. The new tiers are for tutors who want unlimited students, multi-tutor, or priority support.").
2. **Month 2** — Pro and Institute launch. The public pricing page flips from the single Free card (§3) to the 3-tier layout (Appendix A). The Free tier stays free, forever — even after Pro launches. A tutor who joined Free in v1 keeps Free for as long as they want.
3. **Month 3 onward** — Free-tier tutors who want unlimited students, multi-tutor, GST invoices, or priority support can upgrade to Pro (₹299/mo) or Institute (₹999/mo). Tutors who don't upgrade keep using every feature free. There is **no paywall in v1** (BR-PRC-03) — the 250-student soft guidance stays a friendly "tell us your story" prompt, never a hard block.

#### 1.6.3 What Does NOT Change When the Triggers Fire

- **The "free for everyone" promise stays for every pre-trigger tutor (grandfather clause, BR-PRC-02).** A tutor who signed up Free in v1 keeps every feature, every screen, every student free, forever — even after Pro and Institute launch. This is non-negotiable — breaking it would be a bait-and-switch that destroys trust.
- **The 250-student soft guidance stays as soft guidance.** Even after Pro launches, crossing 250 never blocks the 251st student for a pre-trigger signup. The friendly "tell us your story" prompt remains the only 250-related surface.
- **The scholarship program stays.** Government-school / NGO / first-generation educators get Pro free, forever, regardless of trigger state.
- **No dark patterns.** The Free tier never gets ads, never gets features removed, never gets sync throttled to push people to Pro.
- **The "no card required" signup stays.** A visitor signs up with email only, lands on the dashboard, and adds students. They are not asked for a card until they choose to upgrade — and only after the §1.6 trigger has fired.

#### 1.6.4 What Changes When the Triggers Fire

- The public pricing page flips from the single Free card (§3) to the 3-tier layout (Appendix A becomes the public card spec): Free + Pro + Institute.
- The "Start free →" CTA stays on the Free card; "Upgrade to Pro →" and "Upgrade to Institute →" CTAs appear on the new cards.
- The Settings → Billing banner (previously absent — nothing to bill) changes to "You're on Free. Upgrade to Pro for unlimited students + priority support →" — but only if the tutor wants to upgrade. There is no nag, no degraded experience for Free users.
- The monthly/yearly toggle renders (was hidden in v1 because there were no paid tiers to toggle).
- The payment-method icon row renders (was hidden in v1 because no checkout was possible).
- The ROI calculator's "Start free →" CTA gains a sibling: "or upgrade to Pro →" (only visible if the visitor has crossed 250 students; otherwise hidden).
- Razorpay checkout goes live for Pro and Institute tiers (the routes are already specced in `web/04_API_Routes.md` — they return `503 Service Unavailable` until the trigger fires).

#### 1.6.5 Internal Source of Truth (§1.3 is Public; §1.6 is Internal)

The single Free card's public commitment block (§1.3 above) is the canonical public source of truth — what the visitor reads. The §1.6.1–§1.6.4 cost-stack, triggers, grandfather clause, and post-trigger state machine are the operational spec — what the engineering and founder team execute against. The visitor sees §1.3; the team executes §1.6. Appendix A documents the post-trigger tier definitions (Pro ₹299/mo, Institute ₹999/mo, feature lists, GST/refund policy) that activate when `NEXT_PUBLIC_PAID_TIERS_LIVE` flips to `true`.

---

## 2. India-Specific Pricing Rationale (Purchasing Power Parity)

### 2.1 The PPP Math (Relevant Post-Trigger; Pre-Trigger the Price Is ₹0/mo)

The PPP math below applies to the **post-trigger** state — i.e., when Pro (₹299/mo) and Institute (₹999/mo) launch (Appendix A). Pre-trigger, the price is ₹0/mo for everyone, so PPP is moot — there is no price to calibrate against income.

| Country | GDP per capita (nominal, 2024) | Typical SaaS price (per user/mo) | As % of monthly income |
|---|---|---|---|
| United States | $80,000 | $20 | 0.30% |
| United Kingdom | $48,000 | £15 (~$19) | 0.48% |
| India | $2,500 | ₹299 (~$3.60) — post-trigger | 1.72% |

At ₹299/mo (post-trigger), Buddysaradhi is **5.7× more expensive as a percentage of income** than a $20/mo US SaaS. This sounds bad — but the comparison is misleading, because the **tutor's income** is not the GDP per capita. A private tutor in India earning ₹50,000/mo is in the top 5% of Indian income earners; the GDP per capita is dragged down by the rural poor who are not our target user.

The **real comparison** is tutor income to tutor income:

| Country | Median tutor income (monthly) | Buddysaradhi price | As % of tutor income |
|---|---|---|---|
| US | $4,000 | $20 | 0.50% |
| India | ₹50,000 (~$600) | ₹299 (~$3.60) — post-trigger | 0.60% |

At this comparison, ₹299/mo is **20% more expensive as a percentage of income** than the US equivalent — close enough to be fair, cheap enough to convert. This is the PPP-adjusted price (post-trigger). Pre-trigger, the price is ₹0/mo for everyone — PPP is moot.

### 2.2 The en-IN Number Formatting Rule

All prices on the page are displayed in **Indian number format** via `Intl.NumberFormat('en-IN')`. This means:

- ₹1,24,500 (not ₹124,500 — Indian numbering uses lakhs and crores, not thousands and millions)
- ₹2,999/yr (not ₹2,999/year)
- ₹299/mo (not ₹299 per month)

This is enforced by a shared utility (`@buddysaradhi/shared` package's `formatINR()` function) that every pricing-display component uses. The utility is also used in-app (`12_Business_Rules.md §BR-M-01` — integer paise, en-IN display). A CI lint (`no-raw-rupee-format.test.ts`) fails any PR that hard-codes a rupee string without going through `formatINR()`. Pre-trigger, the only rupee string on the public pricing page is `₹0/mo` — still formatted via `formatINR()` for consistency.

### 2.3 The GST Treatment (Post-Trigger Only)

Indian SaaS pricing has two conventions: **"₹299 + GST"** (GST added at checkout) and **"₹299 inclusive of GST"** (GST absorbed into the price). Buddysaradhi uses the **first** convention — prices are displayed pre-GST, GST is added at checkout, and the Institute tier generates a GST invoice with the tutor's GSTIN.

**In v1 pre-trigger, there is no GST to charge** — the product is ₹0/mo. GST treatment activates the day the §1.6 trigger fires and Pro/Institute go live.

The checkout page (Razorpay, post-trigger) shows:

```
Pro tier — monthly
  ₹299.00
+ GST (18%)   ₹53.82
─────────────────────
  Total       ₹352.82
```

The 18% GST is the standard rate for SaaS in India. The Pro tier generates a receipt but **not** a GST invoice (single-tutor users are typically not GST-registered). The Institute tier generates a full GST invoice with the tutor's GSTIN, which they can download from Settings → Billing.

---

## 3. The Pricing Card Layout — v1 Public Surface (Single Free Card)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│                    ┌────────────────────────────────┐                    │
│                    │ ▸ FREE              ✅ LIVE     │                    │
│                    │                                │                    │
│                    │  ₹0                             │                    │
│                    │  /mo, for everyone —            │                    │
│                    │  while our infra stays free     │                    │
│                    │                                │                    │
│                    │  For every Indian private       │                    │
│                    │  tutor. Every feature.          │                    │
│                    │  No card. No caps. No ads.      │                    │
│                    │                                │                    │
│                    │  ✓ All 5 screens               │                    │
│                    │  ✓ Attendance + fees + receipts│                    │
│                    │  ✓ Encrypted backup export     │                    │
│                    │  ✓ Cross-device sync           │                    │
│                    │  ✓ Biometric login             │                    │
│                    │                                │                    │
│                    │  ┌──────────────────────────┐  │                    │
│                    │  │   Start free →           │  │                    │
│                    │  └──────────────────────────┘  │                    │
│                    │                                │                    │
│                    │  No card required              │                    │
│                    └────────────────────────────────┘                    │
│                     ↑ .glass-strong + 2px emerald border                 │
│                       + inner emerald glow @ 15% opacity                 │
│                                                                          │
│  Buddysaradhi is free for everyone, for now. Free while our backend      │
│  infra (Vercel, Turso, Vercel Blob) stays inside its free bands. When    │
│  that changes, we'll give 60 days' notice before launching paid tiers.   │
│  No ads, ever. No card required. See §1.6 for the full contract.         │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.1 The Single Card — Why No Tiers in v1

The v1 public pricing page shows **one card: Free.** There are no Pro or Institute cards. There is no "Most popular" badge. There is no "LIVE" vs "FUTURE TIER" badge split (because there are no future tiers on the public page). The single Free card has a small "✅ LIVE" badge in the top-right corner — emerald on glass-strong, 12px caption style. That is the only badge on the page.

There is no monthly/yearly toggle (because Free has no billing period). There is no payment-method icon row (because no checkout is possible yet). There is no "Pay with: UPI / Visa / Mastercard / ..." row (because there is nothing to pay). The visitor sees: one card, one CTA, one commitment block. That is it.

When the §1.6 trigger fires and `NEXT_PUBLIC_PAID_TIERS_LIVE` flips to `true`, the page migrates to the 3-tier layout (Appendix A becomes the public card spec). The CI lint `pricing-surface-state.test.ts` checks the feature-flag state vs. the rendered card layout monthly — when the flag is `false`, exactly one card renders (Free); when `true`, exactly three cards render (Free + Pro + Institute).

### 3.2 The "Start free →" CTA

The Free tier's primary (and only) CTA says "Start free →" — it links to `/signup` and starts the visitor on Free. The CTA is a `.neumo-raised` emerald-glow button per `13_UI_Guidelines.md §6.6 / §8.2`. It is the **5th CTA** on the page (`07_CTA_and_Conversion.md §6`) and the closing CTA of the pricing section.

There is **no waitlist CTA** on the public pricing page in v1. The previous model (with Pro/Institute future-tier cards and waitlist CTAs) has been removed. A visitor who wants Buddysaradhi clicks "Start free →" — that is the only pricing-page CTA.

### 3.3 The Footer Commitment Block

Below the single Free card, a single commitment block (no two-part disclaimer, because there is no future-tier GST/refund to disclaim in v1):

> *Buddysaradhi is free for everyone, for now. Free while our backend infra (Vercel, Turso, Vercel Blob) stays inside its free bands. When that changes, we'll give 60 days' notice before launching paid tiers. No ads, ever. No card required. See §1.6 for the full contract.*

Every clause is a commitment:
- **"Free for everyone, for now"** — every tutor, every feature, every screen, ₹0/mo, while our infra bill is ₹0/mo.
- **"Free while our backend infra stays inside its free bands"** — we publish the cost-anchored pricing model on the page itself. No "we'll figure out pricing later" surprise.
- **"60 days' notice"** — the visitor gets a 60-day window before paid tiers go live. They can stay on Free or upgrade early at the launch price.
- **"No ads, ever"** — we will never add advertising to the Free tier (BR-PRC-05).
- **"No card required"** — signup is email-only; the visitor is never asked for payment until they choose to upgrade, post-trigger.

The post-trigger GST/refund disclaimer (₹299 + 18% GST, refund within 7 days, cancel anytime) is **not shown on the public pricing page in v1** — it appears only after the §1.6 trigger fires and paid tiers go live. Internally, the post-trigger policy is documented in §2.3 above and Appendix A.

### 3.4 Single Free Card — Component Anatomy (Glass-Strong + Emerald Glow)

The single Free card is the canonical "marketing pricing card" surface listed in §5.5 of `13_UI_Guidelines.md`. It uses `.glass-strong` (8% white, 24px blur) plus a 2px emerald border and an inner emerald glow at 15% opacity per §5.4 of `13_UI_Guidelines.md`. The "Start free →" CTA is a `.neumo-raised` emerald-glow button per §6.6 / §8.2. The card is centred on the canvas (max-width 480px) with 64px breathing room above and below.

When the §1.6 trigger fires and paid tiers go live, the page migrates to the 3-tier layout (Appendix A) and the featured elevation moves from Free to Pro (the now-live paid tier that becomes "Most popular"). This is the **single elevation migration** in the spec — it is automated by the `NEXT_PUBLIC_PAID_TIERS_LIVE` feature flag, CI-tested by `featured-tier-accuracy.test.ts`.

```
  SINGLE FREE CARD — V1 PUBLIC PRICING SURFACE  (glass-strong + emerald glow)
  ┌══════════════════════════════════════════════════════════════════════════┐
  ║                                                                          ║
  ║                       ┌────────────────────────────────┐                  ║
  ║                       │ ▸ FREE              ✅ LIVE     │                  ║
  ║                       │                                │                  ║
  ║                       │  ₹0                             │                  ║
  ║                       │  /mo, for everyone —            │                  ║
  ║                       │  while our infra stays free     │                  ║
  ║                       │                                │                  ║
  ║                       │  For every Indian private       │                  ║
  ║                       │  tutor. Every feature.          │                  ║
  ║                       │  No card. No caps. No ads.      │                  ║
  ║                       │                                │                  ║
  ║                       │  ✓ All 5 screens               │                  ║
  ║                       │  ✓ Attendance + fees + receipts│                  ║
  ║                       │  ✓ Encrypted backup export     │                  ║
  ║                       │  ✓ Cross-device sync           │                  ║
  ║                       │  ✓ Biometric login             │                  ║
  ║                       │                                │                  ║
  ║                       │  ┌──────────────────────────┐  │                  ║
  ║                       │  │   Start free →           │  │                  ║
  ║                       │  └──────────────────────────┘  │                  ║
  ║                       │                                │                  ║
  ║                       │  No card required              │                  ║
  ║                       └────────────────────────────────┘                  ║
  ║                        ↑ .glass-strong (8% white, 24px blur)              ║
  ║                        ↑ + 2px emerald border (§5.4)                     ║
  ║                        ↑ + inner emerald glow @ 15% opacity              ║
  ║                                                                          ║
  ║  Buddysaradhi is free for everyone, for now. Free while our backend      ║
  ║  infra (Vercel, Turso, Vercel Blob) stays inside its free bands. When    ║
  ║  that changes, we'll give 60 days' notice before launching paid tiers.   ║
  ║  No ads, ever. No card required. See §1.6 for the full contract.         ║
  ║                                                                          ║
  ╚══════════════════════════════════════════════════════════════════════════╝
   ↑ .glass-strong: rgba(255,255,255,0.08) + backdrop-blur(24px) per §5.1
   ↑ + 2px solid emerald border (§5.4)
   ↑ + inset 0 0 12px rgba(0,255,157,0.15) per §5.4 (the "this card is about emerald"
     signal without painting the whole surface emerald)
   ↑ Card centred on canvas: max-width 480px, margin 0 auto, 64px vertical breathing room
   ↑ "Start free →" = .neumo-raised (§6.1, §6.6, §8.2) + emerald glow (primary)
   ↑ CTA navigates to /signup (§3.2 — there is no other CTA on the v1 pricing page)
   ↑ 44×44px hit area on the CTA (Rule 10, P15, §10.2)
   ↑ WCAG 2.1 AA on the card; emerald-on-cosmic = 12.6:1 (AAA per §8)
   ↑ No dark patterns (§13 of product/07, P15) — single tier, single CTA,
     no waitlist CTA, no future-tier badges
   ↑ The post-trigger 3-tier layout is documented in Appendix A (internal — not the v1
     public surface). When NEXT_PUBLIC_PAID_TIERS_LIVE flips to true, this card layout
     is replaced by the Appendix A 3-tier layout.
```

### 3.5 FAQ Link (Below the Commitment Block)

Below the commitment block, a single FAQ link:

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Questions about pricing?  [Read the pricing FAQ →]                   │
  │                           ↑ cyan ghost link, 44×44px touch target     │
  └──────────────────────────────────────────────────────────────────────┘
   ↑ Click → scrolls to /#faq-pb (the Pricing & Billing FAQ category).
   ↑ The 5-question pricing FAQ shortlist is rendered inline ABOVE this
     link (§7 below), so the visitor can read the top 5 without scrolling.
```

---

## 4. Payment Methods (Internal — Post-Trigger Only)

> In v1 pre-trigger, there are no payment methods to display — the product is ₹0/mo for everyone. The payment stack below is the **internal spec** for what activates when the §1.6 trigger fires and `NEXT_PUBLIC_PAID_TIERS_LIVE` flips to `true`. There is **no payment-method icon row on the public pricing page in v1**.

### 4.1 The Payment Stack (Activates Post-Trigger)

Buddysaradhi uses **Razorpay** as the payment gateway. Razorpay is the default Indian SaaS payment processor — it supports UPI, cards, netbanking, wallets, and EMI, with a single integration. The alternative (Stripe India) has weaker UPI support and higher transaction fees.

| Payment method | Razorpay fee | Buddysaradhi surcharge | Notes |
|---|---|---|---|
| UPI | 0% (free for the merchant until ₹50,000/mo, then 1.99% + ₹3) | None | Primary method. ~75% of Indian SaaS payments by volume. |
| Credit / Debit Card (Indian) | 1.99% + ₹3 | None | ~20% of payments. |
| Netbanking | 1.99% + ₹3 | None | ~3% of payments. Declining. |
| Wallet (Paytm, Mobikwik, etc.) | 1.99% + ₹3 | None | ~2% of payments. |
| International Card | 3% + ₹3 | None | Used by Gulf/NRI tutors in v2.x. |

Buddysaradhi **absorbs** all payment gateway fees. When paid tiers launch (per §1.6 trigger), the tutor pays exactly ₹299 + GST (Pro) or ₹999 + GST (Institute), never ₹299 + GST + "convenience fee." This is the **no-surcharge rule**, and it is non-negotiable. Surcharging payment fees is a dark pattern that erodes trust.

### 4.2 The Checkout Flow (Activates Post-Trigger)

```
                ┌────────────────────────────────────────────────────┐
                │  Settings → Billing → "Upgrade to Pro"              │
                │  Visitor clicks. Modal opens.                       │
                └────────────────────────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────────────┐
                │  PLAN PICKER                                        │
                │  ○ Monthly — ₹299/mo                                │
                │  ● Yearly  — ₹2,999/yr (save ₹589)                  │
                └────────────────────────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────────────┐
                │  RAZORPAY CHECKOUT (modal)                          │
                │  - UPI (default tab, GPay/PhonePe/Paytm/ BHIM)      │
                │  - Card                                             │
                │  - Netbanking                                       │
                │  - Wallet                                           │
                │  Total: ₹352.82 (₹299 + ₹53.82 GST)                │
                │  [Pay ₹352.82]                                      │
                └────────────────────────────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────────────┐
                │  PAYMENT SUCCESS                                    │
                │  Razorpay webhook → /api/billing/webhook            │
                │  Server verifies signature, upgrades user to Pro    │
                │  in settings.tier, writes audit_log row.            │
                │  Toast: "Welcome to Pro. Unlimited students.       │
                │  Receipt sent to your email."                       │
                └────────────────────────────────────────────────────┘
```

The checkout is **inside the app**, not on the landing page. The landing page's pricing section only **displays** prices (and in v1, it only displays ₹0/mo — the single Free card). The visitor is not asked for payment until they have used the product, **the §1.6 trigger has fired (paid tiers are live)**, and they click "Upgrade" from inside the app. This is the **product-led growth** pattern, and it is the single highest-converting pricing pattern in SaaS. Pre-trigger (the v1 default), the checkout flow returns `503 Service Unavailable` and the only pricing-page CTA is "Start free →" — there is no upgrade prompt to click.

### 4.3 The "No Card Required" Signup

The signup flow (`web/03_Auth_and_Provisioning.md`) asks for **email only**. No card. No "trial requires card." No "we'll charge you in 14 days unless you cancel." The visitor signs up, lands on an empty Dashboard, and adds their first student. They are now a Free-tier user. They will not be asked for payment until **both** of the following are true: (a) the §1.6 trigger has fired (paid tiers are live), and (b) they click "Upgrade" from inside the app. **Crossing 250 students does NOT trigger a payment prompt** — the 250 milestone surfaces a friendly "tell us your story" prompt, never a paywall (BR-PRC-03, BR-STU-11).

This is the **"no card required"** principle, named explicitly in the hero trust line (`02_Hero_and_Above_the_Fold.md §7`) and enforced in the signup form's Zod schema (no `cardNumber`, `expiry`, `cvv` fields, ever). The lint rule `no-card-field-at-signup.test.ts` fails any PR that adds a card field to the signup flow.

### 4.4 The Conversion Flow (v1 = Free-Only; Post-Trigger = Optional Upgrade)

In v1 pre-trigger, **there is no conversion flow** — the product is free for every tutor, and the §1.6 trigger has not fired yet. There is no paywall, no upgrade prompt, no waitlist CTA. The flow below is the **future-state** spec: what happens from the day the trigger fires onward. It is published internally today so the founder team can predict the post-trigger state.

```
V1 PRE-TRIGGER  (today — paid tiers not yet live; free for everyone)
─────────────────────────────────────────────────────────────────────
Day 0    │  Visitor signs up (Free tier, 0 students)
         │  Lands on empty Dashboard with honest empty state (P15)
         │  Adds 5 students via bulk CSV import (BR-IMP-04)
         │  Marks first attendance
         │  Records first fee
         │  → "Aha moment" — the visitor sees the receipt with the hash
         │
Day 1-30 │  Visitor marks attendance daily, records fees weekly
         │  Sync works across their phone and laptop
         │  Reminder push at 7 AM ("3 fees due tomorrow")
         │  No paywall, no upgrade prompt — the product is free.
         │
Day 60   │  Visitor crosses 50 students
         │  No prompt — the visitor is well inside the 250 soft guidance.
         │
Day 200  │  Visitor crosses 200 students
         │  No prompt.
         │
Day 365  │  Visitor crosses 250 students (the internal soft-guidance
         │  milestone). Friendly, dismissable prompt appears on Dashboard:
         │  "You've crossed 250 students — that's amazing! We'd love to
         │   hear your story. [Tell us how you use Buddysaradhi →]"
         │  Visitor clicks (or dismisses). No payment asked.
         │  All 251+ students remain fully accessible.
         │
Annual   │  v1 pre-trigger retention:
         │  - Free active retention: ~90% (most tutors never want to leave)
         │  - Churn: ~10% (mostly inactive tutors, not price-driven)

FUTURE-STATE  (the day the §1.6 trigger fires and paid tiers go live)
─────────────────────────────────────────────────────────────────────
Day 0    │  Trigger fires (e.g., Vercel bandwidth bill > ₹0/mo for 3 months)
         │  Pricing page flips from single Free card to 3-tier layout
         │  (Appendix A): Free + Pro + Institute with "Upgrade →" CTAs.
         │  60-day notice posted on the dashboard of every Free user.
         │
Day 60   │  Paid tiers go live. Existing Free users keep every feature
         │  free, forever (grandfather clause, BR-PRC-02). New signups
         │  still get Free with every feature, every screen.
         │
Day 60+  │  Free user who WANTS unlimited students + priority support
         │  can upgrade to Pro (₹299/mo) or Institute (₹999/mo).
         │  Free user who DOESN'T upgrade keeps using every feature
         │  free — including all 251+ students. No paywall, ever.
         │
Day 90+  │  Free → Pro conversion (12-month rolling, post-trigger):
         │  - ~15-25% of active tutors opt into Pro (voluntary upgrade)
         │  - Pro annual retention: ~78%
         │  - Institute annual retention: ~85%
         │  - Free retention stays ~85%+ (the grandfather clause holds)
```

The conversion numbers above are **targets**, not history. They are calibrated from public benchmarks for product-led-growth SaaS at the ₹299–₹999/mo price point in India, **discounted** because we never paywall Free users (the 250-student soft guidance does not block the 251st student even post-trigger). The actual numbers will be measured via Vercel Web Analytics + the audit_log, and published (in aggregate) in the annual report. **Pre-trigger, the only metric that matters is Free-tier activation and retention** — a tutor who gets to 250 students on Free and stays is a long-term user; a tutor who hits a paywall at 25 students and churns is not.

---

## 5. The "Minutes-per-Day" ROI Calculator

Below the single Free card, an interactive "minutes-per-day" ROI calculator. This is the **closing argument** for the pricing section — it shows the visitor that Buddysaradhi pays for itself in time saved, not in money earned. **Since Buddysaradhi is free (for now), the "Net ROI" line is the full value of the time saved — there is no cost to subtract.**

### 5.1 The Calculator UI

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ── MINUTES-PER-DAY ROI CALCULATOR                                            │
│                                                                              │
│  How many students do you teach?     [  38  ] ← input, integer 1–999          │
│  How do you track fees today?        [ Excel + WhatsApp ▼ ] ← dropdown        │
│  How long does monthly fees          [  3 hours  ] ← input, hours             │
│  reconciliation take you?                                                    │
│                                                                              │
│  ──────────────────────────────────────────────────────────────────────       │
│                                                                              │
│  With Buddysaradhi (free, for now):                                          │
│                                                                              │
│  ✦ Time saved per month:        ~2 hours 40 minutes                          │
│  ✦ Time saved per year:         ~32 hours                                    │
│  ✦ Hourly value (your time):    ~₹500/hr (assumed; adjustable)              │
│  ✦ Money value of time saved:   ₹16,000/yr                                   │
│  ✦ Net ROI:                     +₹16,000/yr                                  │
│                                                                              │
│    ↑ Buddysaradhi is free, so you keep 100% of the time saved.               │
│      There is no Buddysaradhi cost to subtract.                              │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────┐                │
│  │  Start free →  (free for everyone, for now —              │                │
│  │                  paid tiers launch when our infra bill    │                │
│  │                  crosses the §1.6 trigger)                 │                │
│  └──────────────────────────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 The Calculator Math

The calculator is **honest**. The "time saved" estimates come from our persona research:

| Activity | Excel + WhatsApp | Buddysaradhi (free, for now) | Time saved |
|---|---|---|---|
| Monthly fees reconciliation (38 students) | 3 hours | 20 minutes | 2 hours 40 minutes |
| Attendance marking (per batch, per session) | 2 minutes (paper register) | 20 seconds (one-tap) | ~12 minutes per session × 4 sessions/wk × 4 wks = ~3 hours/mo |
| Receipt generation (per fee) | 5 minutes (manual Excel + WhatsApp forward) | 10 seconds (auto) | ~5 minutes per fee × ~10 fees/wk × 4 wks = ~3 hours/mo |
| **Total monthly time saved** | — | — | **~8 hours 40 minutes** |

The calculator uses the **fees-reconciliation-only** number (2 hours 40 minutes/mo) because it is the most defensible — every tutor does fees reconciliation, not every tutor marks attendance the same way. The full ~8 hours/mo is mentioned in a footnote: "*Conservative estimate. Total time saved across attendance + fees + receipts is typically 6–10 hours/month.*"

The "hourly value" defaults to ₹500/hr (the median private-tutor hourly rate in metros). The visitor can adjust it. The math updates live via React state. The "money value of time saved" is `time_saved_hours × hourly_value`.

### 5.3 The "Net ROI" Line

The "Net ROI" line is the **only** number the visitor remembers. Because Buddysaradhi is free (for now), the Net ROI = the full money value of time saved. There is **no "Buddysaradhi cost" line to subtract**.

- **Pre-trigger (v1 default):** Net ROI = +₹{full value of time saved}/yr. The line is emerald. A note below reads: "Buddysaradhi is free, so you keep 100% of the time saved."
- **Post-trigger (after §1.6 fires and Pro launches):** the calculator adds a "Buddysaradhi Pro cost (yearly): ₹2,999/yr" line, and Net ROI = (money value of time saved) − ₹2,999/yr. Still emerald for most tutors (time saved > Pro cost); flare if negative.

The Net ROI line is emerald if positive, flare if negative. We do not hide a negative ROI — we show it honestly.

### 5.4 The Calculator's "Start free →" CTA

The calculator's "Start free →" button is the **5th CTA** on the page (`07_CTA_and_Conversion.md §6`). It is the closing CTA of the pricing section. The button is emerald, full-width, 48px tall. It links to `/signup`.

**In v1, there is no "or upgrade to Pro →" sibling CTA.** The sibling CTA appears only after the §1.6 trigger fires (Appendix A) and only if the visitor has crossed 250 students. Pre-trigger, the only ROI-calculator CTA is "Start free →".

---

## 6. The Scholarship Program

Below the ROI calculator, a small section on the scholarship program:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ── SCHOLARSHIP                                                               │
│                                                                              │
│  If you teach in a government school, an NGO-run after-school centre, or    │
│  a free tuition programme for underprivileged students, Buddysaradhi is    │
│  free for you. Forever. No application fee, no approval committee, no       │
│  "while funds last."                                                        │
│                                                                              │
│  Pre-trigger, every tutor is already free. Post-trigger, scholarship        │
│  recipients get Pro (unlimited students + priority support) free, forever.  │
│                                                                              │
│  Email hello@buddysaradhi.app with your school/Org name and a one-line     │
│  description of your work. We upgrade you within 24 hours of Pro launch.    │
│                                                                              │
│  → hello@buddysaradhi.app                                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.1 The Scholarship Rules

The scholarship is **Pro tier, free, forever** (post-trigger) for:
- Government school teachers who tutor after hours.
- NGO after-school programme educators.
- Free tuition programmes for underprivileged students (Slum tuition, EWS coaching, etc.).
- First-generation educators (the first in their family to teach professionally) — we trust the visitor's claim, we do not verify.

The scholarship is **not** for:
- Private coaching institutes (they pay Institute tier, even if they are "non-profit").
- Online course creators with paid courses.
- Tutors who teach in addition to a full-time corporate job (they are not the target).

The scholarship is honoured on the honour system. We do not ask for proof. We do not audit. If a tutor emails and says "I teach at a government school in rural Odisha," we upgrade them the day the Pro tier launches (per §1.6 trigger). Pre-trigger, every tutor is already free — the scholarship simply guarantees that the scholarship recipient gets Pro (unlimited students, priority support) free, forever, once Pro goes live. The scholarship cost to us is ~₹299/mo per tutor (post-trigger) — trivial. The word-of-mouth value is enormous.

### 6.2 Why the Scholarship Exists

The scholarship exists because Buddysaradhi is built in India, for India, and a meaningful slice of Indian tuition happens in non-profit settings where ₹299/mo (post-trigger) is a real cost. Refusing to serve these educators because they cannot pay would violate the "tutor is the user" principle (P1) and the brand voice ("confident, warm, jargon-free, India-first English" — `01_Product_Positioning.md §6`).

The scholarship is **not a marketing tactic.** It is a values claim. If we ever remove it, the page loses its moral centre. This is non-negotiable.

---

## 7. The Pricing FAQ Cross-Link

The pricing section's last block is a "Pricing FAQ" shortlist — 5 questions pulled from `06_FAQ.md §6.2` (Pricing & Billing). Each question is a clickable accordion item that expands to show the answer (a verbatim copy of the FAQ's answer). This is the **cross-link** between the pricing section and the FAQ.

The 5 questions:

1. "Is Buddysaradhi really free?" → `06_FAQ.md §6.2` Q1
2. "Why is Buddysaradhi free? When will you charge?" → `06_FAQ.md §6.2` Q2
3. "What if I have more than 250 students?" → `06_FAQ.md §6.2` Q3
4. "What about GST, refunds, cancellation?" → `06_FAQ.md §6.2` Q4
5. "Will you add ads or lock my data?" → `06_FAQ.md §6.2` Q5

The accordion UI is the same component used in the main FAQ section (`06_FAQ.md §3`). The answers are identical (no copy drift) — enforced by a CI lint that compares the two markdown sources and fails on any diff.

---

## 8. Pricing Page Accessibility

1. **The single Free card is a `<ul role="list">` with one `<li>` item.** Screen readers announce "list, 1 item." (When the §1.6 trigger fires and the 3-tier layout renders per Appendix A, this becomes 3 items.)
2. **The "LIVE" badge is `aria-label`-annotated** on the `<span>`. The ✅ is decorative (`aria-hidden="true"`).
3. **The ROI calculator inputs have `<label>` elements** associated via `htmlFor`/`id`. The number inputs have `inputmode="numeric"` for mobile keyboards.
4. **The calculator's live-updating results are in an `aria-live="polite"` region** so screen readers announce the updated ROI when inputs change.
5. **Colour contrast.** All tier prices meet WCAG 2.1 AAA. The "₹0" price is in `--accent-emerald` (12.6:1 on cosmic).
6. **The "Start free →" CTA on the Free card is an `<a>` tag** with `aria-label="Start free — sign up for Buddysaradhi, no card required"`.
7. **There is no waitlist CTA in v1** — accessibility annotations for that CTA are not needed until the §1.6 trigger fires.

---

## 9. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated, neumorphic controls recipe-annotated, cross-references canonical (`§5.5`, `§6.6`, `§8.*`, `BR-*`, `P*`, `AP-*`). Box widths honour §20.3 rule 2 (80–120 for landing-page sections, 60–80 for components). The single Free card anatomy (§3.4) already lives above; this section adds the post-trigger 3-tier mockup (Appendix A), the monthly/yearly toggle anatomy (post-trigger), and the payment-method icon row (post-trigger) for internal reference.

### 9.1 Design System Reference (§5.5 + §6.6 single rule)

The v1 public pricing section has **one glass surface** (the single Free card) and **zero neumorphic control clusters** (no toggle, no payment icons — both hidden in v1 pre-trigger). The single Free card uses `.glass-strong` (8% white, 24px blur) + an emerald glow ring per §5.4 and §5.5 marketing-pricing-card-featured row, because the Free tier is the only tier today. The Free card's "Start free →" CTA is `.neumo-raised` primary (emerald glow). When the §1.6 trigger fires and paid tiers go live, the page migrates to the 3-tier layout (Appendix A) and the featured elevation moves from Free to Pro (now the live "Most popular" tier). The cosmic canvas is the aurora source; the glass blurs the aurora behind the card.

| Pricing surface / control (per §5.5 + §6.6) | Tier / recipe | Spec |
|---|---|---|
| Free tier card (v1 = single card = featured = LIVE) | `.glass-strong` + emerald glow (§5.4) | §3, §3.1, §3.4, §5.5 marketing-pricing-card-featured |
| Free tier card (post-trigger = standard) | `.glass` | Appendix A, §5.5 marketing-pricing-card |
| Pro tier card (post-trigger = featured = "Most popular") | `.glass-strong` + emerald glow (§5.4) | Appendix A, §5.5 marketing-pricing-card-featured |
| Institute tier card (post-trigger) | `.glass` (no badge post-trigger) | Appendix A, §5.5 marketing-pricing-card |
| Monthly/Yearly toggle (hidden pre-trigger, active post-trigger) | `.neumo-inset` segmented control (§6.6, §8.5) | Appendix A |
| "Start free →" CTA on Free | `.neumo-raised` primary (emerald glow) | §3.2 |
| "Upgrade to Pro →" CTA on Pro (post-trigger) | `.neumo-raised` primary (emerald glow) | Appendix A |
| Payment-method icon row (hidden pre-trigger, renders post-trigger) | flat tinted badges (§2.3) — not glass, not neumorphic | §4.1, Appendix A |
| Footer commitment block (v1 = single-line "free for everyone, for now") | inline caption, no glass | §3.3 |

### 9.2 Three-Tier Pricing Table — Post-Trigger Target (Appendix A Reference Mockup)

The mockup below shows the **post-trigger target state** (Pro featured, Free demoted to `.glass`) — the layout the page migrates to the day the §1.6 trigger fires. It is published internally today (Appendix A) so a contributor can visualise both states without having to compute the migration mentally. **This is NOT the v1 public surface.** The v1 public surface is the single Free card in §3.4 above.

```
  THREE-TIER PRICING TABLE — DESKTOP, POST-TRIGGER  (Pro = featured = glass-strong + emerald glow)
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  ░░░ cosmic canvas: #0f0c29 → #24243e → #0a0a1a (§2.2) — aurora source ░░░░░░░░░░░░ │
  │                                                                                    │
  │              ╭────────── neumo-inset segmented toggle (§6.6, §8.5) ──────────╮      │
  │              │  ╭────────╲╮   ╭──────────╮                                    │      │
  │              │  │ MONTHLY │   │ YEARLY   │ ← active = neumo-raised pill      │      │
  │              │  ╰────────╯   ╰──────────╯   + glass-strong overlay           │      │
  │              │  ↑ -₹0/mo       ↑ -₹589/yr (save 2 months)                    │      │
  │              ╰────────────────────────────────────────────────────────────────╯      │
  │                                                                                    │
  │  ┌── .glass ──────────┐  ┌══ .glass-strong + emerald glow ══┐  ┌── .glass ──────┐  │
  │  │ ▸ FREE              │  ║ ▸ PRO         ⭐ Most popular   ║  │ ▸ INSTITUTE     │  │
  │  │                     │  ║                                ║  │                 │  │
  │  │  ₹0                 │  ║  ₹299                          ║  │  ₹999           │  │
  │  │  /mo, forever       │  ║  /mo, or ₹2,999/yr             ║  │  /mo, or ₹9,999 │  │
  │  │                     │  ║  (save ₹589)                   ║  │  /yr (save ₹1,989)│  │
  │  │  For tutors just    │  ║                                ║  │                 │  │
  │  │  starting out.      │  ║  For tutors who want unlimited ║  │  For coaching   │  │
  │  │                     │  ║  students + priority support.  ║  │  institutes.    │  │
  │  │  ✓ All 5 screens    │  ║                                ║  │                 │  │
  │  │  ✓ Attendance +     │  ║  ✓ Unlimited students          ║  │  ✓ Everything   │  │
  │  │    fees + receipts  │  ║  ✓ All 5 screens               ║  │    in Pro       │  │
  │  │  ✓ Encrypted        │  ║  ✓ Encrypted backup export     ║  │  ✓ Up to 5 co-  │  │
  │  │    backup export    │  ║  ✓ Priority email (24h)        ║  │    tutors       │  │
  │  │  ✓ Cross-device     │  ║                                ║  │  ✓ GST invoice  │  │
  │  │    sync             │  ║                                ║  │  ✓ ROI report   │  │
  │  │                     │  ║                                ║  │  ✓ Priority     │  │
  │  │                     │  ║                                ║  │    email (24h)  │  │
  │  │ ┌────────────────┐  │  ║ ┌════════════════════════════┐ ║  │ ┌─────────────┐ │  │
  │  │ │ Start free →   │  │  ║ │  Upgrade to Pro →          │ ║  │ │ Upgrade to  │ │  │
  │  │ └────────────────┘  │  ║ └════════════════════════════┘ ║  │ │ Institute → │ │  │
  │  │  ↑ neumo-raised     │  ║  ↑ neumo-raised + emerald glow ║  │ └─────────────┘ │  │
  │  │    secondary (cyan) │  ║    (primary)                  ║  │  ↑ neumo-raised │  │
  │  │  No card required   │  ║  No card required             ║  │    secondary    │  │
  │  └─────────────────────┘  ║                                ║  │  (cyan)         │  │
  │                            ╚════════════════════════════════╝  │  No card req.   │  │
  │                                                                  └─────────────────┘  │
  │                                                                                    │
  │  ┌── payment-method icon row (.glass-faint band) — §4.1 ──────────────────────╲    │
  │  │  [UPI]  [Razorpay]  [Visa]  [Mastercard]  [Netbanking]  [Wallets]           │   │
  │  └────────────────────────────────────────────────────────────────────────────╱    │
  │   ↑ UPI first (India-first); Razorpay gateway; all amounts integer paise        │
  │   ↑ Flat tinted badges (§2.3) — NOT glass, NOT neumorphic — they are LABELS     │
  │                                                                                    │
  │  All prices in ₹, ex-GST. 18% GST added at checkout. Annual prices billed       │
  │  yearly. Cancel anytime. Refund within 7 days, no questions.                     │
  └────────────────────────────────────────────────────────────────────────────────────┘
   ↑ .glass: rgba(255,255,255,0.05) + backdrop-blur(24px) per §5.1
   ↑ .glass-strong (Pro only): rgba(255,255,255,0.08) + 24px blur + 2px emerald border
     + inset 0 0 12px rgba(0,255,157,0.15) per §5.4
   ↑ Pro card translateY(-4px) — visually elevated; motion = card-hover-lift sustained
   ↑ Monthly/Yearly toggle = .neumo-inset well (§6.6 segmented-control, §8.5)
   ↑ "Start free →" / "Upgrade to Pro →" / "Upgrade to Institute →" = .neumo-raised (§6.1)
   ↑ 44×44px hit area on every CTA + toggle option (Rule 10, P15, §10.2)
   ↑ WCAG 2.1 AA on every card; emerald-on-cosmic = 12.6:1 (AAA per §8)
   ↑ "Most popular" is a CI-verified fact (most-popular-accuracy.test.ts checks monthly)
   ↑ NOTE: this layout is HIDDEN in v1 pre-trigger. The v1 public surface is the single
     Free card (§3.4). This 3-tier layout renders only when NEXT_PUBLIC_PAID_TIERS_LIVE=true.
```

### 9.3 Monthly/Yearly Toggle — Segmented Control Anatomy (Post-Trigger Only)

The monthly/yearly toggle is the only neumorphic segmented control on the marketing surface (per §6.6 segmented-control row). It is **hidden in v1 pre-trigger** (no paid tiers to toggle). It activates the day the §1.6 trigger fires. It is a `.neumo-inset` well with two options (MONTHLY, YEARLY); the active option is a `.neumo-raised` pill with a `.glass-strong` overlay. Switching triggers the `tab-underline-slide` microinteraction (§7.3). The "save ₹589/yr" callout appears under the YEARLY option only when YEARLY is active.

```
  MONTHLY/YEARLY TOGGLE — SEGMENTED CONTROL  (per §6.6 segmented, §8.5)
  (HIDDEN in v1 pre-trigger — renders post-trigger per Appendix A)

  MONTHLY active                       YEARLY active
  ╭── neumo-inset well ──────────╮    ╭── neumo-inset well ──────────╮
  │                              │    │                              │
  │  ╭════════════════╮ ╭──────╮ │    │  ╭──────╮ ╭════════════════╮ │
  │  ║ ▌ MONTHLY       ║ │YEARLY│ │    │  │MONTH│ ║ ▌ YEARLY        ║ │
  │  ╰════════════════╯ ╰──────╯ │    │  ╰──────╯ ╰════════════════╯ │
  │   ↑ neumo-raised pill         │    │              ↑ neumo-raised  │
  │     + glass-strong overlay    │    │                pill + glass- │
  │   ↑ ▌ = 2px emerald left-bar  │    │                strong overlay│
  │     (tab-underline-slide)     │    │              ↑ ▌ = 2px emerald│
  │   ↑ -₹0/mo (no discount)      │    │                left-bar      │
  │                              │    │              ↑ -₹589/yr        │
  │                              │    │                (save 2 months) │
  ╰──────────────────────────────╯    ╰──────────────────────────────╯
   ↑ Well = .neumo-inset: inset 4px 4px 8px #0a0a1a, -4px -4px 8px #2a2a5a (§6.2)
   ↑ Active pill = .neumo-raised: 4px 4px 8px, -4px -4px 8px + .glass-strong overlay
   ↑ aria role="radiogroup", aria-label="Billing period"
   ↑ State persists in URL (?billing=yearly) for shareable deep-links per §2.5
```

### 9.4 Payment-Method Icon Row + FAQ Link (Post-Trigger Only)

The payment-method icon row sits below the pricing cards in a `.glass-faint` band. **It is hidden in v1 pre-trigger** (no checkout is possible yet). It renders the day the §1.6 trigger fires and the first Razorpay checkout goes live. UPI is listed FIRST (India-first, per `01_Product_Positioning.md §7.1`); Razorpay is the gateway; cards/netbanking/wallets are secondary. Each icon is a flat tinted badge (§2.3) — not glass, not neumorphic — they are LABELS, not surfaces or controls. Below the row, a single FAQ link ("Why is UPI primary?") deep-links to `06_FAQ.md §6.2`.

```
  PAYMENT-METHOD ICON ROW + FAQ LINK  (per §4.1, §4.2 checkout flow)
  (HIDDEN in v1 pre-trigger — renders post-trigger per Appendix A)

  ┌── .glass-faint band (recedes so icons read) ─────────────────────────────────╲
  │                                                                                │
  │   ╭──────╮  ╭──────────╮  ╭─────╮  ╭───────────╮  ╭──────────╮  ╭────────╮  │
  │   │ UPI  │  │ Razorpay │  │Visa │  │Mastercard │  │Netbanking│  │Wallets │  │
  │   ╰──────╯  ╰──────────╯  ╰─────╯  ╰───────────╯  ╰──────────╯  ╰────────╯  │
  │    ↑ FIRST (India-first)                                                       │
  │    ↑ All icons = FLAT TINTED badges (§2.3) — bg-white/5, border-white/10       │
  │    ↑ NOT glass, NOT neumorphic — they are LABELS, not surfaces or controls    │
  │    ↑ UPI icon = emerald accent (the India-first primary rail)                 │
  │    ↑ Razorpay icon = cyan accent (the gateway)                                │
  │    ↑ Card/Netbanking/Wallet icons = --text-muted (secondary rails)            │
  │                                                                                │
  │   ─────────────────────────────────────────────────────────────────────────   │
  │                                                                                │
  │   Why is UPI primary? →  (deep-link to 06_FAQ.md §6.2 Q4)                     │
  │    ↑ ghost link, --text-secondary, hover --text-primary                        │
  │    ↑ NOT a neumo-raised button — it is a navigational link, not a CTA         │
  │                                                                                │
  └──────────────────────────────────────────────────────────────────────────────╱

   ↑ UPI first per 01_Product_Positioning.md §7.1 (UPI maturity in India)
   ↑ Razorpay gateway processes UPI/card/netbanking; amounts in integer paise
   ↑ No 3rd-party ESP sees the email at v1 (Rule 2, P5) — newsletter goes to Turso
   ↑ No surcharge (§4.1 — Buddysaradhi absorbs all gateway fees)
   ↑ Refund policy: 7 days, no questions; automated via Razorpay refund API
   ↑ 18% GST added at checkout (BR-M-01; Institute tier generates GST invoice)
```

### 9.5 References (External Design Authorities)

The single-card v1 layout, the post-trigger 3-tier mockup, the toggle anatomy, and the payment-method row synthesise practices from the following public bodies of work. Cite them when a contributor challenges the single-card layout, the featured-tier elevation, the toggle UX, or the UPI-first ordering.

- **Baymard Institute** — *Pricing Page UX* and *Checkout Usability*. The §3 single-card v1 layout, the Appendix A 3-tier post-trigger layout, the §9.3 monthly/yearly toggle, and the §9.4 no-surcharge rule are Baymard-anchored.
- **Nielsen Norman Group** — *Pricing Tier Patterns for SaaS* and *India-PPP Pricing*. The Appendix A ₹0/₹299/₹999 tier mapping and the §9.4 UPI-first icon row follow NN/g's research on emerging-market pricing.
- **Smashing Magazine** — *Pricing Card Design* and *Toggle UX for Billing Period*. The §3.4 single-card `.glass-strong` + emerald glow elevation and the §9.3 neumo-inset segmented toggle follow Smashing's research on pricing-card visual mass.
- **Apple Human Interface Guidelines** — *Marketing Surfaces* and *Segmented Controls*. The §9.3 toggle follows Apple HIG's segmented-control guidance; the §3.4 single-card glass tier follows Apple HIG's marketing-surface layering.
- **A List Apart** — *India-First Voice in Product Copy* and *Content Strategy for Pricing*. The §9.4 UPI-first ordering and the "Why is UPI primary?" FAQ link follow ALA's content-strategy doctrine.
- **Google Search Central** — *Product Schema (JSON-LD)* and *Price Specification*. The §3 single-card `Offer` schema (`price: 0`, `priceCurrency: "INR"`) must align with the structured data in `09_SEO_and_Analytics.md §4.1`.
- **Vercel Web Analytics docs** — *Conversion Events*. The §3.2 "Start free →" CTA (conversion event) follows Vercel's event-catalogue guidance (Rule 3, AP-10, TELE-1).

---

## 10. Cross-References

- `01_Product_Positioning.md §1.1` (tagline), §6 (brand voice — "₹0/mo for everyone, for now" not "₹299 per month"), §7 (India-first market analysis, PPP).
- `02_Hero_and_Above_the_Fold.md §7` (trust line — "Free for everyone · No card required · Free while our infra stays free").
- `06_FAQ.md §6.2` (Pricing & Billing FAQ — the source of truth for the pricing FAQ cross-link, including the new "free for everyone" Q1/Q2/Q3).
- `07_CTA_and_Conversion.md §1` (the 7 CTAs — pricing owns the 5th, the ROI calculator's "Start free"), §10 (the two-tap signup target).
- `08_Testimonials_and_Social_Proof.md §6` (authenticity rule — the "LIVE" badge accuracy; "Most popular" badge accuracy post-trigger).
- `12_Business_Rules.md §BR-M-01` (integer paise, en-IN display), §BR-STU-11 (Free tier 250-student soft guidance — does NOT block at 250; logs `student_count_milestone` and surfaces friendly prompt), §BR-PRC-01 (free for everyone, for now — single public tier), §BR-PRC-02 (grandfather clause), §BR-PRC-03 (no paywall in v1 — 250 soft guidance, friendly prompt only), §BR-PRC-04 (60-day notice before paid tiers launch), §BR-PRC-05 (no ads), §BR-PRC-06 (no sync throttling), §BR-PRC-07 (no feature removal), §BR-PRC-08 (§1.6 trigger monitor), §BR-PRC-09 (scholarship), §BR-PRC-10 (`NEXT_PUBLIC_PAID_TIERS_LIVE` flag), §BR-FEE-04 (receipts), §BR-LED-06 (append-only ledger).
- `13_UI_Guidelines.md §2.1` (color tokens — emerald for live tier), §3.2 (type ramp — display for prices), §10 (accessibility).
- `web/03_Auth_and_Provisioning.md` (signup flow — no card field), `web/04_API_Routes.md` (Razorpay webhook + refund routes — return `503` pre-trigger, activate post-trigger).
- `web/07_Landing_Page.md §3` (`PricingSection` RSC + `PricingCard` composition — the HOW for the single-card v1 layout and the 3-card post-trigger layout, the monthly/annual toggle Client Island (hidden pre-trigger), the `formatINR()` utility contract, the `NEXT_PUBLIC_PAID_TIERS_LIVE` feature flag), `web/07_Landing_Page.md §8` (CTA & Conversion Implementation — the `cta_pricing_click` event, the `/signup?plan=free` deep-link, the two-tap signup attribution), `web/07_Landing_Page.md §9` (SEO Implementation — the `SoftwareApplication.offers` JSON-LD with `priceCurrency: "INR"` and `price: "0"` for the free tier; the BreadcrumbList for `/pricing`).
- `deployment/01_Vercel_Hosting.md §8` (Vercel Pro tier upgrade — the §1.6 T1 trigger: when we cross Vercel Hobby's free band, we upgrade to Vercel Pro at $20/mo and the paid-tier launch sequence begins).
- `product/AGENTS.md §3` (no dark patterns enforcement, applied to pricing).

---

## Appendix A: Future Paid Tiers (internal — not shown on the public pricing page until the §1.6 trigger fires)

> ⚠️ **Internal-only.** The Pro and Institute tier definitions below are **not surfaced on the public pricing page in v1.** The v1 public pricing page shows a single Free card (§3 above). The tier definitions, prices, feature lists, and post-trigger launch rationale below are the internal/founder reference for what activates when the §1.6 trigger fires and `NEXT_PUBLIC_PAID_TIERS_LIVE` flips to `true`. When that happens, the public pricing page flips from the single Free card to the 3-tier layout (Free + Pro + Institute with "Start free →" / "Upgrade to Pro →" / "Upgrade to Institute →" CTAs), and Appendix A becomes the public spec.

### A.1 The Three Tiers (Post-Trigger Public Layout)

| Tier | Status post-trigger | Price | Student ceiling | Multi-tutor | Target persona |
|---|---|---|---|---|---|
| **Free** | ✅ Live (standard) | ₹0, forever — for pre-trigger signups, every feature stays free (grandfather clause) | 250 soft guidance (no hard cap — friendly prompt only) | No (single tutor) | Ananya, Riya, Kabir — every Indian private tutor and small coaching institute |
| **Pro** | ✅ Live (paid, featured) | ₹299/mo or ₹2,999/yr (save ₹589) | Unlimited | No (single tutor) | Tutors who want unlimited students + priority support |
| **Institute** | ✅ Live (paid) | ₹999/mo or ₹9,999/yr (save ₹1,989) | Unlimited | Yes (up to 5 co-tutors) | Coaching institutes that need multi-tutor + GST invoice |

The annual prices are **exactly 10× the monthly minus a small discount** (₹2,999 = ₹299 × 10 + ₹9 saved, effectively 2 months free). The discount is small enough to be honest ("save ₹589/yr") and large enough to reward annual commitment. We do not offer "save 50% annually!!!" because that would require inflating the monthly price to ₹499, which is dishonest.

### A.2 Why Pro Will Be ₹299/mo When It Launches (Not ₹199, Not ₹499)

Pro launches at ₹299/mo the day the §1.6 trigger fires. ₹299/mo is **below the impulse-purchase threshold** for an Indian tutor earning ₹50,000+/mo. It is the price of two samosas per student per month (₹299 / 25 students = ₹12/student/mo = ~2 samosas). It is also **above the "this is too cheap to be serious" floor** — ₹99/mo reads as "hobby project," ₹199/mo reads as "trying too hard," ₹299/mo reads as "this is a real product priced for India."

₹299/mo is **5.5× cheaper than Classplus** (₹1,200+/mo) and **3× cheaper than Zoho One** (₹750+/mo). It is **2.5× more expensive than Teachmint's ad-supported free tier** — but Teachmint's free tier has ads, and ads in a tuition-management tool are unacceptable (`01_Product_Positioning.md §4.3`).

₹499/mo would convert marginally higher revenue per customer but ~30% lower conversion rate (price-sensitivity research). ₹199/mo would convert ~20% higher but ~50% lower revenue per customer. ₹299/mo is the local maximum.

### A.3 Why Institute Will Be ₹999/mo When It Launches (Not ₹1,999)

Institute launches at ₹999/mo the day the §1.6 trigger fires. ₹999/mo for multi-tutor + GST invoice is **the price an institute owner can expense without a board meeting**. It is below the ₹1,000 psychological barrier. It is **1/6 of the typical school-ERP contract** (₹6,000+/mo). And it unlocks the GST invoice — which means the institute owner can claim input tax credit, effectively reducing the real cost by their GST rate (18% → ₹847/mo net).

₹1,999/mo would price out the smaller institutes (2–3 co-tutors, 80–120 students) that are our sweet spot. ₹1,999/mo is also where Classplus sits, and we do not want to compete on price equality — we want to compete on price *advantage*.

### A.4 The "No Contact Sales" Rule (Carries Forward Post-Trigger)

There is no "Contact Sales" tier. There is no "Enterprise" tier with "Custom Pricing." If a 500-student institute with 10 co-tutors wants Buddysaradhi post-trigger, they buy 2 Institute subscriptions (₹1,998/mo) or they wait for v2.x when we ship a proper Enterprise tier. We do not do sales calls in v1 or in the post-trigger state.

### A.5 Post-Trigger Public Pricing Card Layout (Replaces §3 When `NEXT_PUBLIC_PAID_TIERS_LIVE=true`)

When the §1.6 trigger fires, the public pricing page migrates from the single Free card (§3) to the 3-tier layout below. The migration is automated by the `NEXT_PUBLIC_PAID_TIERS_LIVE` feature flag, CI-tested by `pricing-surface-state.test.ts` (when flag is `false`, one card renders; when `true`, three cards render). The 3-tier ASCII art anatomy is in §9.2 above (the post-trigger target mockup).

### A.6 Grandfather Clause (BR-PRC-02)

Tutors who signed up **pre-trigger** keep every feature, every screen, every student free, forever — even after Pro and Institute launch. The 250-student soft guidance stays as soft guidance for pre-trigger signups (no hard cap, friendly prompt only). Tutors who signed up **post-trigger** also get every feature free at ₹0/mo — Pro/Institute are **voluntary** upgrades for unlimited students + priority support + GST invoice, never required.

---

## References

The pricing-page conventions in this file draw on the following public bodies of practice. Cite them when a contributor challenges the single-card v1 layout, the no-asterisks rule, the UPI-primary ordering, or the PPP math.

- **Baymard Institute** — *SaaS Pricing Page UX* and *Checkout Patterns for Indian Markets*. The §1.6 cost-anchored free-model, the §1.4 "no contact sales" rule, and the §3.4 single-card featured elevation (`.glass-strong` + emerald glow) are Baymard-anchored.
- **Nielsen Norman Group** — *Pricing Tier Display* and *Monthly/Annual Toggle UX*. The Appendix A 3-tier layout and the §9.3 monthly/yearly toggle (`.neumo-inset` segmented control, default yearly) follow NN/g's research on toggle defaults.
- **Smashing Magazine** — *India-PPP SaaS Pricing* and *No-Asterisk Pricing Pages*. The §2 PPP math, the §2.2 en-IN formatting rule, and the §2.3 ex-GST treatment are Smashing-anchored.
- **Apple Human Interface Guidelines** — *In-App Purchase Patterns* and *Tactile Pricing Toggles*. The §9.3 toggle anatomy (neumo-inset well + neumo-raised active pill) is Apple-HIG-derived.
- **A List Apart** — *Pricing Copy That Doesn't Lie* and *The "No Card Required" Pattern*. The §4.3 no-card-at-signup rule and the §3.2 "Start free →" single-CTA rule are ALA-anchored.
- **Razorpay docs** — *UPI Integration* and *Webhook + Refund API*. The §4.1 payment-method table (UPI 0% / cards 1.99% / etc.) and the §4.2 Razorpay checkout flow follow Razorpay's canonical documentation.
- **Google Search Central** — *SoftwareApplication JSON-LD with `Offer`*. The §3 single-card structure is consumed by `09_SEO_and_Analytics.md §4.1` to generate the `SoftwareApplication.offers` JSON-LD payload (`price: 0`, `priceCurrency: "INR"`).

---

*Pricing is where SaaS pages lie. Buddysaradhi does not. One tier (Free, ₹0/mo, for everyone, for now — free while our backend infra stays free). No asterisks, no "contact sales," no waitlist, no hidden fees, no card required to start, no dark patterns. The Pro (₹299/mo) and Institute (₹999/mo) tiers exist internally (Appendix A) and launch the day the §1.6 trigger fires. If a visitor cannot predict their next month's bill — today and after we scale — within 30 seconds on this page, the pricing section has failed.*
