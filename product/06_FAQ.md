# 06 — FAQ

> The FAQ is where a visitor's **unspoken objections meet their spoken questions**. Every Q&A pair on this page exists because a real tutor (in persona research, in beta feedback, in support emails) asked it. There are no filler questions, no "what is the cloud?" condescension, no SEO-keyword-stuffed non-questions. Every answer is in the brand voice (`01_Product_Positioning.md §6`) — confident, warm, jargon-free, India-first English — and every answer ends with a cross-reference to the spec that backs it up. If a tutor cannot find their answer here, the page has failed and they will email hello@buddysaradhi.app, which is the fallback we want them to use rather than bounce.

---

## 1. The Six Categories

The FAQ is organised into six categories. The order is **funnel-aware**: the categories a top-of-funnel visitor asks first come first; the categories a near-conversion visitor asks come later.

| # | Category | When asked | # Q&As |
|---|---|---|---|
| 1 | Getting Started | "What is this? How do I begin?" | 8 |
| 2 | Pricing & Billing | "How much? What if I cancel?" | 8 |
| 3 | Data & Privacy | "Is my data safe? Do you sell it?" | 10 |
| 4 | Sync & Backup | "Does it work offline? What if my phone dies?" | 8 |
| 5 | Platforms & Downloads | "Mac? Windows? Android? iOS? Web?" | 7 |
| 6 | Account & Security | "Biometric? Two-factor? Forgot password?" | 8 |

Total: 49 Q&A pairs. Each is ≤ 120 words (the strict word budget, enforced by lint). At ~80 words average per answer, the full FAQ is ~4,000 words — readable in 15 minutes, skimmable in 3, searchable in 10 seconds.

---

## 2. The Top-5-Questions Shortlist (Above-the-Fold)

Above the full FAQ accordion, a "Top 5 questions" shortlist. These are the 5 questions that account for ~70% of all FAQ clicks (measured via Vercel Web Analytics). They are surfaced above-the-fold so a visitor with one of these questions does not need to scroll.

### 2.1 The Top 5

| # | Question | Answer (excerpt) |
|---|---|---|
| 1 | Is Buddysaradhi really free? | Yes. Free for everyone, for now. Every feature, every screen, no card required. You will not be asked to pay a single rupee until our backend infrastructure bill stops being ₹0/mo — and we'll give 60 days' notice before that happens. We make money when we scale, not when you sign up. (`05_Pricing_and_Plans.md §1.1`, `§1.6`.) |
| 2 | Does it work without internet? | Yes. Buddysaradhi is offline-first. You can mark attendance, record fees, generate receipts, and export backups with no internet. Sync happens when you reconnect. (`01_Product_Principles.md P5`, `12_Business_Rules.md §BR-SYN-01`.) |
| 3 | Is my data safe? Do you sell it? | Your data is yours. We do not sell it, do not share it with third parties, do not run analytics on it. Backups are AES-256-GCM encrypted. The only network call is to your per-user database on Turso (Mumbai region). (`10_Security.md`, `01_Product_Principles.md P10`.) |
| 4 | Can I export my data if I stop using Buddysaradhi? | Yes. Settings → Backup → Export. You get a `.buddysaradhi` file — a single encrypted envelope with your entire database. You can restore from it on a new device, or open it with our open-source reader tool. (`09_Backup_and_Import_Export.md`, BACKUP-1.) |
| 5 | What platforms does it work on? | Web (any modern browser), macOS, Windows, Android, iOS. All five sync to the same per-user database. Pick the platform you use most. (`00_Vision.md §16`, `04_Download_Hub.md §2`.) |

### 2.2 The Shortlist UI

The Top 5 are rendered as 5 glass cards in a 5-column grid on desktop (or 1-column on mobile). Each card has the question (h3, 20/28, 600 weight, `--text-primary`) and the answer excerpt (body, 16/24, `--text-secondary`). A "Read full answer →" link at the bottom of each card jumps to the full Q&A in the accordion below.

The Top 5 shortlist is **not** an accordion — it is always-visible. The visitor sees the answers immediately, without clicking. This is the "anticipate the objection" pattern: the 5 most-asked questions are answered before the visitor even asks.

---

## 3. The Accordion UI Spec

The full FAQ is a **single-accordion** component with 6 category sections, each containing its Q&A pairs. Only one Q&A is expanded at a time (clicking another collapses the previous). This is the **single-open** accordion pattern, chosen over multi-open because most visitors only need one answer at a time.

### 3.1 The Accordion Anatomy

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │ ▸ GETTING STARTED                                              8 questions ││ ← category header
│  └──────────────────────────────────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │ 1. What is Buddysaradhi?                                              [+] expand ││ ← collapsed Q
│  └──────────────────────────────────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │ 2. How is this different from a school ERP?                      [-] collapse││ ← expanded Q
│  │                                                                          ││
│  │  School ERPs are built for principals — 200 features, 12 modules, 4-week ││
│  │  onboarding. Buddysaradhi is built for tutors — 5 screens, 7 engines, 90-second││
│  │  onboarding. A school ERP does timetabling, transport, parent portals with││
│  │  500 logins. Buddysaradhi does attendance, fees, receipts — and does them well.││
│  │                                                                          ││
│  │  Read more → 01_Product_Positioning.md §4.1                              ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │ 3. Do I need to install anything?                                [+] expand ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│  ...                                                                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Accordion Rules

1. **Single-open within the page.** Clicking a new question collapses the previously-open one. The visitor can have at most one Q&A expanded at a time.
2. **The category headers are always visible.** Clicking a category header scrolls to that category's first question. The header does not collapse its category (we want all questions visible for skimming).
3. **The `[+]` / `[-]` icon is a Unicode `+` / `−`** (not an emoji), in `--accent-cyan`, 16px.
4. **The expand/collapse animation is 240ms** with `cubic-bezier(0.22, 1, 0.36, 1)` — fast enough to feel responsive, slow enough to track visually. Disabled under `prefers-reduced-motion`.
5. **Deep-linking.** Each Q&A has an `id` (`faq-gs-1`, `faq-pb-2`, etc.) and the URL updates to `/#faq-gs-1` when expanded. A visitor can bookmark or share a specific Q&A. The page scrolls the Q&A into view on load if a hash is present.
6. **Keyboard navigation.** Each question is a `<button>` (not a `<div>`) with `aria-expanded` and `aria-controls`. Tab moves between questions; Enter/Space expands. The `aria-controls` points to the answer panel's `id`.

### 3.3 Accordion Layout — Closed vs Open States + Category Tabs + Contact-CTA

The FAQ accordion is the canonical "marketing FAQ accordion row" surface listed in §5.5 of `13_UI_Guidelines.md` (`.glass-faint` band, the recede tier). The category tabs above are a `.neumo-inset` segmented control (§6.6, §8.5) — a control, not a surface. The contact-CTA at the bottom is a `.neumo-raised` cyan-border ghost button (§8.2).

```
  CATEGORY TABS  (.neumo-inset segmented control, §6.6, §8.5)
  ╭─ neumo-inset well ──────────────────────────────────────────────────────────╮
  │  ╭──────────────╮ ╭──────────────╮ ╭──────────────╮ ╭──────────────╮          │
  │  │▌Getting      │ │ Pricing &    │ │ Data &       │ │ Sync &       │  ...      │
  │  │ Started      │ │ Billing      │ │ Privacy      │ │ Backup       │          │
  │  ╰──────────────╯ ╰──────────────╯ ╰──────────────╯ ╰──────────────╯          │
  │   ↑ ACTIVE pill:    ↑ inactive:     ↑ inactive:     ↑ inactive:               │
  │     .neumo-raised     --text-        --text-         --text-                  │
  │     + .glass-strong   secondary      secondary       secondary                │
  │     + 2px cyan                                                                  │
  │       left-bar                                                                  │
  │       (tab-underline-slide)                                                     │
  ╰─────────────────────────────────────────────────────────────────────────────╯
   ↑ 6 category tabs: Getting Started / Pricing & Billing / Data & Privacy /
     Sync & Backup / Platforms & Downloads / Account & Security (§1 above).
   ↑ Click a tab → scroll to that category's first question. Tabs do NOT
     collapse their category — all 49 Q&As are visible for skimming.
   ↑ Active pill is the only one with cyan accent — single-open rule §3.2.1.

  ACCORDION ROWS  (closed + open side-by-side per §20.3 rule 4)

  CLOSED STATE                         OPEN STATE
  ┌──────────────────────────────────┐ ┌──────────────────────────────────┐
  │ 1. What is Buddysaradhi?        [+] expand │ │ 2. How is this different      [-] collapse │
  └──────────────────────────────────┘ │    from a school ERP?                       │
   ↑ .glass-faint band (2% white, 8px  │                                                                              │
     blur, §5.5 marketing FAQ row)     │    School ERPs are built for principals —   │
   ↑ [+] = Unicode + (not emoji),      │    200 features, 12 modules, 4-week         │
     --accent-cyan, 16px                │    onboarding. Buddysaradhi is built for tutors  │
   ↑ row is a <button> with             │    — 5 screens, 7 engines, 90-second        │
     aria-expanded="false"              │    onboarding. A school ERP does            │
   ↑ row height 48px (≥44×44 §10.2)     │    timetabling, transport, parent portals   │
   ↑ .glass-faint = recede tier; the    │    with 500 logins. Buddysaradhi does attendance,│
     QUESTION is the content, the       │    fees, receipts — and does them well.     │
     band must not compete with it      │                                                                              │
                                       │    Read more → 01_Product_Positioning.md §4.1│
                                       └──────────────────────────────────┘
                                        ↑ .glass-faint band, same tier as closed
                                        ↑ [-] = Unicode − (not emoji), --accent-cyan
                                        ↑ row is a <button> with aria-expanded="true"
                                        ↑ aria-controls points to answer panel id
                                        ↑ Answer body in body-md (14/20, --text-secondary)
                                        ↑ "Read more →" is a cyan ghost link to the
                                          cited spec section
                                        ↑ Expand/collapse animation = 240ms
                                          cubic-bezier(0.22, 1, 0.36, 1), §3.2.4

  CONTACT-CTA AT BOTTOM  (after the last Q&A, §5 fallback)

  ┌──────────────────────────────────────────────────────────────────────┐
  │  ── STILL STUCK?                                                      │
  │                                                                       │
  │  We did not answer your question. That is our fault, not yours.       │
  │                                                                       │
  │  Email hello@buddysaradhi.app with your question. A real human (yes,       │
  │  really) responds within 24 hours, Monday to Saturday, 9 AM to 7 PM   │
  │  IST.                                                                 │
  │                                                                       │
  │  ┌─────────────────────────────────────────┐                          │
  │  │  Email hello@buddysaradhi.app →              │  ← .neumo-raised,         │
  │  └─────────────────────────────────────────┘     cyan border @ 40%      │
  │                                                  + cyan text, no glow  │
  │                                                  (§6.6, §8.2 secondary │
  │                                                  variant)              │
  └──────────────────────────────────────────────────────────────────────┘
   ↑ The "Still stuck?" block sits in a .glass panel (5% white, 24px blur,
     §5.5 workhorse tier) — it is a deliberate elevation above the .glass-faint
     accordion rows because it is the LAST conversion surface in the FAQ.
   ↑ The CTA is CTA #6 in the 7-CTA skeleton (07_CTA_and_Conversion.md §7).
   ↑ Click → opens the visitor's email client with a pre-filled mailto:
     hello@buddysaradhi.app?subject=Question%20about%20Buddysaradhi
   ↑ The 24-hour SLA is documented in §5.1; the no-chatbot rule in §5.2.
```

The closed + open states render side-by-side here so the reviewer can verify the state matrix at a glance (per §20.3 rule 4 of `13_UI_Guidelines.md`). The open state's answer body uses the same `.glass-faint` band as the closed state — the band is the constant; the icon (`+` → `−`) and the answer body (collapsed → visible) are the variables.

---

## 4. The Searchable FAQ Spec

Above the Top 5 shortlist, a search input:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │ 🔍  Search the FAQ…                                            [type here]││
│  └──────────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

The 🔍 is a Unicode `🔍` (allowed in this one specific UI element because it is a search-icon convention; banned everywhere else per `AGENTS.md §3`).

### 4.1 The Search Behaviour

- **Indexed fields:** question text, answer text, category name. The index is built at build time from this markdown file and shipped as a static JSON blob (~30 KB) with the page.
- **Search is client-side.** No server round-trip. The visitor types, results appear within 50ms (FUSE.js with a weighted index: question 0.7, answer 0.25, category 0.05).
- **Results appear inline.** As the visitor types, the Top 5 shortlist and the accordion are replaced by a results list. Each result is the question + an answer excerpt (first 80 chars) + a "Read full answer →" link to the Q&A's hash.
- **No results state.** If the visitor's query matches nothing, the page shows: "No results for '{query}'. Email hello@buddysaradhi.app — we'll answer in 24 hours." This is the **fallback** (§5 below).
- **Clearing the search.** The visitor clicks the `×` in the search input or presses Esc. The page returns to the Top 5 + accordion view.

### 4.2 The Search Privacy Rule

The search is **client-side only**. The visitor's keystrokes are never sent to the server. There is no `track('faq_search', { query })` event — we do not log what visitors search for. This is the **no-telemetry** rule (`10_Security.md §17`, TELE-1) applied to the FAQ search. A visitor searching "how do I cancel my subscription" should not have that fact logged, aggregated, or sold.

---

## 5. The "Still Stuck? Email Hello@buddysaradhi.app" Fallback

Below the full FAQ accordion, a final block:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ── STILL STUCK?                                                              │
│                                                                              │
│  We did not answer your question. That is our fault, not yours.              │
│                                                                              │
│  Email hello@buddysaradhi.app with your question. A real human (yes, really)      │
│  responds within 24 hours, Monday to Saturday, 9 AM to 7 PM IST.             │
│                                                                              │
│  → hello@buddysaradhi.app                                                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 The SLA

- **First response within 24 hours**, Monday–Saturday, 9 AM–7 PM IST. (Sundays and public holidays: 48 hours.)
- **The first response is from a human**, not an auto-responder. We do not use Intercom, Drift, Tawk.to, or any chatbot. The visitor emails, a human reads, a human responds.
- **The human response includes the answer** — not "thanks for reaching out, we'll get back to you." If we don't know the answer, the human says "I don't know, let me check and respond by {specific time}."

### 5.2 Why a Human, Not a Chatbot

The "no chatbot" rule is non-negotiable. Chatbots on SaaS landing pages are a dark pattern: they impersonate a human, they push the visitor toward pre-baked answers, they collect conversational data for "AI training." Buddysaradhi refuses all three. The hello@buddysaradhi.app address is monitored by a rotating rota of 3 humans (the founders in v1, customer-support hires in v2.x). The response time is real. The human is real.

This rule costs ~6 hours/week of founder time at v1 launch volume (~30 emails/week × 12 minutes average). It is the cheapest trust-building investment on the page.

### 5.3 The Email Privacy

The visitor's email and question are stored in a single Google Workspace inbox (hello@buddysaradhi.app). They are not synced to a CRM, not aggregated, not sold. The inbox is accessed by the 3-humans rota only. The visitor's email is used to reply, then archived. We do not add the visitor to a newsletter without explicit opt-in (`09_SEO_and_Analytics.md §7`).

This is the **PII minimisation** rule (Rule 2, P10) applied to support. We collect the minimum (email + question) to answer, and we do not reuse it.

---

## 6. The 49 Q&A Pairs

Each Q&A below is the **verbatim** source-of-truth copy. The live page renders these exactly; deviations are bugs. Cross-references in `[brackets]` link to the relevant spec.

### 6.1 Getting Started (8 questions)

**Q1. What is Buddysaradhi?**
Buddysaradhi is the operating system for private tutors and small coaching institutes. Five screens — Dashboard, Students, Attendance, Fees, Settings. Seven engines under the hood. One append-only ledger. Zero servers to manage. It works offline-first, exports to an encrypted file you control, and refuses to ship telemetry, ads, or data lock-in. [`01_Product_Positioning.md §1`]

**Q2. How is this different from a school ERP?**
School ERPs are built for principals — 200 features, 12 modules, 4-week onboarding. Buddysaradhi is built for tutors — 5 screens, 7 engines, 90-second onboarding. A school ERP does timetabling, transport, parent portals with 500 logins. Buddysaradhi does attendance, fees, receipts — and does them well. We do not compete with school ERPs; we replace the WhatsApp-Excel-paper stack. [`01_Product_Positioning.md §4.1`]

**Q3. Do I need to install anything?**
No. The web version runs in any modern browser at app.buddysaradhi.app — no install, no permission prompts. If you prefer a native app, you can download Buddysaradhi for macOS, Windows, Android, or iOS from the download hub. All five versions sync to the same per-user database. Pick the platform you use most. [`04_Download_Hub.md §2`]

**Q4. How long does it take to set up?**
About 90 seconds. Sign up with your email + OTP. You land on an empty Dashboard. Add your first student (name + phone + parent name, 30 seconds). Mark today's attendance (20 seconds per batch). Record your first fee (15 seconds). You are now using Buddysaradhi. No configuration, no batch setup, no fee-structure definition — those happen inline when you need them. [`web/03_Auth_and_Provisioning.md`]

**Q5. Can I import my existing students from Excel?**
Yes. Settings → Import → Upload CSV. The CSV format is flexible — name, phone, parent name, batch, monthly fee, joined date. We map your columns to ours. 100 students import in ~30 seconds. The import is reversible — if it goes wrong, you can undo the entire batch from Settings → Import → History. [`09_Backup_and_Import_Export.md §BR-IMP-04`]

**Q6. What classes / boards / subjects does Buddysaradhi support?**
All of them. Buddysaradhi is class-agnostic, board-agnostic, subject-agnostic. You define your batches (e.g., "Class 10 CBSE Maths — Mon-Tue"). You define your fee structures (₹2,500/mo, ₹25,000/yr, ₹500/session — whatever you charge). CBSE, ICSE, IB, IGCSE, State Board, NEET, JEE, CA Foundation, spoken English, music, dance — all work. [`12_Business_Rules.md §BR-STU-05`]

**Q7. Do my students or parents need to install anything?**
No. Students and parents are not users in v1. They are data inside your Buddysaradhi. You mark their attendance, you record their fees, you generate their receipts. You forward a receipt to a parent on WhatsApp — that is the only parent-facing surface in v1. A parent app is on the v2.x roadmap. [`01_Product_Principles.md P1`, `15_Future_Roadmap.md`]

**Q8. Is there an onboarding demo or walkthrough?**
Yes. Sign up and the Dashboard shows a 4-step "first visit" guide (add a student, mark attendance, record a fee, generate a receipt). Each step is dismissable. The guide does not reappear after you complete it. There is also a 90-second product tour video on the landing page (the hero's secondary CTA). [`02_Hero_and_Above_the_Fold.md §5.2`, `01_Product_Principles.md P15`]

### 6.2 Pricing & Billing (8 questions)

**Q1. Is Buddysaradhi really free?**
Yes. Free for everyone, for now. Every feature, every screen, no card required. You will not be asked to pay a single rupee until our backend infrastructure bill stops being ₹0/mo — and we'll give 60 days' notice before that happens. There is no paywall, no waitlist, no future-tier card on the pricing page. The pricing page shows one tier: Free. [`05_Pricing_and_Plans.md §1.1`, `§1.6`]

**Q2. Why is Buddysaradhi free? When will you charge?**
Because our backend infra (Vercel, Turso, Vercel Blob) is free for us right now, so it's free for you. Our cost to serve you is ≈ ₹0.0006/mo — charging you ₹299/mo while our cost is ₹0/mo would be a tax on trust, not a business model. The day that changes, we'll give 60 days' notice and launch Pro (₹299/mo) and Institute (₹999/mo) tiers. Your Free access never lowers. The trigger is any of T1–T5 in `05_Pricing_and_Plans.md §1.6.2` firing for 3 consecutive months (Vercel/Turso bill crosses ₹0/mo, 2,000+ active tutors, 50+ multi-tutor requests, Razorpay UPI volume > ₹50,000/mo). [`05_Pricing_and_Plans.md §1.6`]

**Q3. What if I have more than 250 students?**
Buddysaradhi stays free. If you cross 250 students, we'd love to hear your story — but your app keeps working, all your students stay accessible, and there's no paywall. The 250 number is our internal infra-cost guidance (the threshold above which our Turso row-count and Vercel Blob backup-storage bills start to matter), not a limit on you. When you cross 250, you get a friendly, dismissable prompt: "You've crossed 250 students — that's amazing! We'd love to hear your story. [Tell us how you use Buddysaradhi →]" — and your 251st student (and 252nd, 500th, 1,000th) all keep working, fully synced, fully exportable. [`05_Pricing_and_Plans.md §1.2`, `12_Business_Rules.md §BR-PRC-03`, `§BR-STU-11`]

**Q4. What about GST, refunds, cancellation?**
Not relevant yet — the app is free, so there is nothing to refund, cancel, or pay GST on. When paid tiers launch (with 60 days' notice, per §1.6 trigger), GST is 18% added at checkout, refund within 7 days (no questions), cancel anytime from Settings → Billing → Cancel (cancellation takes effect at the end of your billing period). Institute tier generates a GST invoice with your GSTIN; Pro tier generates a receipt. [`05_Pricing_and_Plans.md §2.3`, `§3.3`]

**Q5. Will you add ads or lock my data?**
Never, and never. No banner ads, no interstitials, no "upgrade to remove ads" prompts (BR-PRC-05). No data lock-in — your data is yours; you can export it as a `.buddysaradhi` encrypted file any time, and we cannot read it without your JWT (BR-PRC-03, BR-PRC-07). Even after paid tiers launch, the Free tier never gets ads, never loses features, never gets sync throttled to push you to upgrade. [`05_Pricing_and_Plans.md §1.6.3`, `12_Business_Rules.md §BR-PRC-05`, `§BR-PRC-06`, `§BR-PRC-07`]

**Q6. What payment methods will you accept — when paid tiers launch?**
UPI (GPay, PhonePe, Paytm, BHIM — primary), credit/debit cards (Indian and international), netbanking (50+ banks), wallets (Paytm, Mobikwik, Freecharge). All processed via Razorpay. We absorb all payment gateway fees — you pay exactly the listed price, no "convenience fee." Payment methods activate the day the §1.6 trigger fires and paid tiers go live. Pre-trigger, there is no checkout, so no payment methods are shown on the pricing page. [`05_Pricing_and_Plans.md §4.1`]

**Q7. What is the difference between Pro and Institute — and why aren't they on the pricing page?**
Pro (₹299/mo, single tutor, unlimited students + priority support) and Institute (₹999/mo, up to 5 co-tutors + GST invoice + ROI report) are **internal-only future tiers** — they are documented in `05_Pricing_and_Plans.md Appendix A` for founder/internal reference but are **not shown on the public pricing page** in v1. The v1 pricing page shows a single Free card. When the §1.6 trigger fires, the page flips to the 3-tier layout (Free + Pro + Institute with "Upgrade →" CTAs). We do not publish future-tier cards with waitlist CTAs today because that would be friction without payoff — a waitlist sign-up gives you nothing actionable. [`05_Pricing_and_Plans.md §1.5`, `Appendix A`]

**Q8. Is there a scholarship or free programme for educators?**
Yes. If you teach in a government school, an NGO after-school centre, or a free tuition programme for underprivileged students, Pro is free for you, forever — once Pro launches (per §1.6 trigger). Pre-trigger, every tutor is already free. The scholarship simply guarantees that the scholarship recipient gets Pro (unlimited students, priority support) free, forever, once Pro goes live. Email hello@buddysaradhi.app with your organisation name and a one-line description. We upgrade you within 24 hours of the Pro launch, no proof required. [`05_Pricing_and_Plans.md §6`]

### 6.3 Data & Privacy (10 questions)

**Q1. Is my data safe?**
Yes. Your data is stored in a per-user Turso database (libSQL, Mumbai region `bom1`). The database is scoped to a JWT that only you hold. We (the Buddysaradhi team) cannot read your data without your JWT — and we do not have it. Backups are AES-256-GCM encrypted with a password only you know (Argon2id-derived). [`10_Security.md`, `01_Product_Principles.md P10`]

**Q2. Do you sell my data?**
No. Never. Not to advertisers, not to "partners," not to "data enrichment" services, not to anyone. Our business model is subscriptions (₹299/mo and ₹999/mo). Selling data would destroy the trust that makes the subscriptions viable. This is non-negotiable. [`10_Security.md §17`, `01_Product_Positioning.md §3.5` USP-5]

**Q3. Do you track me?**
Only with Vercel Web Analytics, which is aggregate-only — it counts page views and button clicks in aggregate, never tied to your identity. We do not use Google Analytics, Mixpanel, PostHog, Sentry, Hotjar, Clarity, FullStory, or any other third-party analytics or session-replay SDK. The web app does not load any third-party script that could see your data. [`10_Security.md §17` TELE-1, `09_SEO_and_Analytics.md §6`]

**Q4. Where is my data stored?**
In a Turso (libSQL) database hosted in the Mumbai region (`bom1`) for Indian tutors. The database is per-user — you get your own database, not a shared table. The database is encrypted at rest. The connection is encrypted in transit (TLS 1.3). Backups you export are encrypted with AES-256-GCM and never stored on our servers — they live on your pen drive, your Google Drive, wherever you put them. [`10_Security.md`, `web/02_State_and_Data_Flow.md §1`]

**Q5. Can I export all my data?**
Yes. Settings → Backup → Export. You get a `.buddysaradhi` file — a single encrypted envelope containing your entire database (students, attendance, ledger, settings, audit log). The file is AES-256-GCM encrypted with a password you choose (Argon2id-derived, 64MB memory, 3 iterations). You can restore from it on a new device, or open it with our open-source `.buddysaradhi` reader tool (planned v1.5). [`09_Backup_and_Import_Export.md`, BACKUP-1]

**Q6. What happens to my data if I cancel?**
Nothing immediately. Your data stays in your Turso database for 90 days after cancellation — you can re-subscribe and pick up where you left off. After 90 days, we email you a final reminder. After 180 days, we delete your database and the per-user Turso instance. We keep only the audit log of the deletion (date, user ID, reason) for our own compliance — no student data, no ledger entries. [`12_Business_Rules.md §BR-SEC-10`, `01_Product_Principles.md P10`]

**Q7. Can I delete my data immediately?**
Yes. Settings → Account → Delete account. You get a confirmation modal: "This permanently deletes your database, your backups on our server (none — they're on your devices), and your account. This cannot be undone." Type your email to confirm. The deletion is immediate and irreversible. [`12_Business_Rules.md §BR-SEC-10`]

**Q8. Do you comply with India's DPDP Act?**
Yes. The Digital Personal Data Protection Act 2023 requires (a) consent for data collection, (b) purpose limitation, (c) data minimisation, (d) right to access, (e) right to correction, (f) right to erasure. Buddysaradhi complies with all six: you consent at signup, we collect only what's needed to run the app, you can access all your data via export, you can correct any field, and you can erase your account anytime. [`09_SEO_and_Analytics.md §7`, `10_Security.md`]

**Q9. What about GDPR for European users?**
Yes. We comply with GDPR for visitors from the EU (and the UK GDPR for the UK). Same six rights as DPDP, plus the right to data portability (the `.buddysaradhi` export satisfies this) and the right to object to processing. Our data processing agreement is at buddysaradhi.app/dpa. We do not currently have an EU data residency region — your data is in Mumbai — but the v2.x EU launch will add a Frankfurt (`fra1`) region. [`09_SEO_and_Analytics.md §7`]

**Q10. Can the government subpoena my data?**
Only your government, with a valid court order to Turso (the database provider), not to us. We do not have your data — Turso does. We would be legally required to comply with a court order directed at us, but we could only provide what we have, which is your account metadata (email, signup date, plan tier) — not your student data, which lives in Turso under your JWT. [`10_Security.md`, `01_Product_Positioning.md §3.5` USP-5]

### 6.4 Sync & Backup (8 questions)

**Q1. Does it work without internet?**
Yes. Buddysaradhi is offline-first. Every write (add student, mark attendance, record fee, void entry, change setting) goes to your local database first (SQLite on mobile, SQLCipher on desktop, IndexedDB on web). The sync engine pushes changes to Turso when you reconnect — every 30 seconds on web/desktop, every 30 seconds when foregrounded on mobile. [`01_Product_Principles.md P5`, `12_Business_Rules.md §BR-SYN-01`]

**Q2. What if I mark attendance on my phone and my laptop at the same time?**
The sync engine handles conflicts. For attendance and student records, it uses last-write-wins (the most recent change wins, based on a server-reconciled timestamp). For the fees ledger, it is append-only — there are no conflicts, because two devices writing two different ledger entries do not collide. The audit log records every conflict resolution. [`12_Business_Rules.md §BR-SYN-03`, `BR-SYN-04`, `mobile/04_Offline_Sync_and_Conflict_Resolution.md`]

**Q3. What if my phone dies?**
Your data is safe. It is in your Turso database, which is replicated across Turso's multi-region cluster. Install Buddysaradhi on a new phone, sign in with the same email, and your data syncs down in ~10 seconds (for a 50-student database; larger databases take proportionally longer). [`12_Business_Rules.md §BR-SYN-09`, `01_Product_Principles.md P10`]

**Q4. How often should I export a backup?**
Weekly is good. Daily is paranoid but fine. Monthly is risky. The backup is your off-Turso copy — if Turso has an outage, or your account is compromised, or you want to migrate to a self-hosted setup (planned v2.x), the `.buddysaradhi` file is your escape hatch. Settings → Backup → Schedule lets you set a weekly reminder; the actual export is one click. [`09_Backup_and_Import_Export.md`, BACKUP-2]

**Q5. Can I restore from a backup on a different platform?**
Yes. The `.buddysaradhi` file is platform-agnostic. Export on Mac, restore on Android. Export on web, restore on iOS. The file contains the full database schema and data, encrypted with your password. The restore process validates the schema version and prompts if a migration is needed. [`09_Backup_and_Import_Export.md §BR-IMP-06`]

**Q6. What happens if two people edit the same student at the same time?**
Last-write-wins for non-ledger data. The most recent edit (by server-reconciled timestamp) is kept; the older edit is recorded in the audit log. For the fees ledger, there is no "same entry" — every payment is a new entry, every void is a new entry. The ledger is conflict-immune by design. [`12_Business_Rules.md §BR-SYN-03`, `BR-LED-06`]

**Q7. Does sync use a lot of battery?**
No. The sync engine polls every 30 seconds via HTTP, not WebSocket. Each poll is ~2 KB of data and ~5 ms of CPU. Over a 10-hour tutoring day, that's 1,200 polls = 2.4 MB of data and ~6 seconds of CPU — negligible. On mobile, sync pauses when the app is backgrounded (unless you've enabled the optional foreground service on Android). [`mobile/04_Offline_Sync_and_Conflict_Resolution.md`, `12_Business_Rules.md §BR-SYN-09`]

**Q8. Can I sync between two tutors (co-tutors)?**
Only on the Institute tier. Pro and Free are single-tutor. Institute tier (₹999/mo) supports up to 5 co-tutors sharing one Buddysaradhi account — each co-tutor has their own login, sees only the batches you assign them, and their writes sync to the same shared database. [`05_Pricing_and_Plans.md §1`, `12_Business_Rules.md §BR-SEC-04`]

### 6.5 Platforms & Downloads (7 questions)

**Q1. What platforms does Buddysaradhi work on?**
Five: web (any modern browser), macOS (Universal .dmg, Intel + Apple Silicon), Windows (per-user .msi, Windows 10+), Android (Play Store, Android 8.0+), iOS (App Store, iOS 15.0+). All five sync to the same per-user database. Pick the platform you use most — you can switch any time. [`00_Vision.md §16`, `04_Download_Hub.md §2`]

**Q2. Is the web version the same as the desktop / mobile apps?**
Yes, functionally. The five screens (Dashboard, Students, Attendance, Fees, Settings) and the seven engines (Search, Reminder, Ledger, Report, Notification, Sync, Security) are identical. The differences are platform-specific: biometric login on mobile/desktop (Face ID, Touch ID, Windows Hello), push notifications on mobile, file-system backups on desktop, PWA installability on web. [`00_Vision.md §16`, `web/01_Architecture.md`]

**Q3. How do I download for Mac?**
Go to buddysaradhi.app/download. Click "Download for Mac — 14 MB." The `Buddysaradhi-1.4.0-universal.dmg` downloads. Double-click, drag Buddysaradhi to Applications, open. The first launch shows a Gatekeeper dialog — right-click → Open → Open in the confirmation. This is normal for non-App-Store apps. We are notarized by Apple. [`04_Download_Hub.md §6.1`, `desktop/06_Installers.md`]

**Q4. How do I download for Windows?**
Go to buddysaradhi.app/download. Click "Download for Windows — 12 MB." The `Buddysaradhi-1.4.0-x64.msi` downloads. Double-click. Windows SmartScreen may show "Windows protected your PC" — click "More info" → "Run anyway." This is normal for non-Microsoft-Store apps with limited reputation. The installer is EV-code-signed. [`04_Download_Hub.md §6.2`, `desktop/04_Code_Signing.md`]

**Q5. How do I install on Android?**
Open the Google Play Store on your phone, search "Buddysaradhi," tap Install. Or scan the QR code on buddysaradhi.app/download with your phone camera — it deep-links to the Play Store listing. If you cannot access the Play Store (Huawei, enterprise-locked), tap "APK mirror (sideload) ↓" on the Android card to download the universal APK directly. [`04_Download_Hub.md §2.2`, `mobile/07_App_Store_Release.md`]

**Q6. How do I install on iOS?**
Open the App Store on your iPhone or iPad, search "Buddysaradhi," tap Get. Or scan the QR code on buddysaradhi.app/download with your phone camera — it deep-links to the App Store listing. For the beta channel, tap "TestFlight (beta) ↓" on the iOS card to join TestFlight. [`04_Download_Hub.md §2.2`, `mobile/07_App_Store_Release.md`]

**Q7. How do I verify the download is genuine?**
Click "SHA-256: a3f2…" on the download card to expand the full hash. On macOS, run `shasum -a 256 Buddysaradhi-1.4.0-universal.dmg` in Terminal. On Windows, run `certutil -hashfile Buddysaradhi-1.4.0-x64.msi SHA256` in Command Prompt. The hash should match the published one. If it does not, do not install — email hello@buddysaradhi.app. [`04_Download_Hub.md §7.1`, `deployment/02_Vercel_Blob_Build_Storage.md §2`]

### 6.6 Account & Security (8 questions)

**Q1. How do I log in?**
Email + OTP. Enter your email at signup or login, we send a 6-digit OTP to your inbox (valid for 10 minutes). Enter the OTP, you're in. No passwords in v1. After signup, you can enable biometric login (fingerprint, Face ID, Windows Hello) so you don't need to OTP every time. [`web/03_Auth_and_Provisioning.md`, `12_Business_Rules.md §BR-SEC-04`]

**Q2. Can I use biometric login?**
Yes. After your first signup, Settings → Security → Enable biometric. On macOS: Touch ID or Apple Watch. On Windows: Windows Hello (fingerprint, face, or PIN). On Android: fingerprint or face unlock. On iOS: Touch ID or Face ID. The biometric unlocks a stored JWT in the platform's secure enclave (Keychain on macOS/iOS, Credential Manager on Windows, Keystore on Android, WebAuthn on web). [`12_Business_Rules.md §BR-SEC-04`, `13_UI_Guidelines.md`]

**Q3. Is there two-factor authentication?**
The OTP login is already two-factor (email knowledge + email possession). For an additional factor, enable biometric (possession of your face/finger). We do not offer TOTP (Google Authenticator) in v1 — it adds friction without proportional security benefit for a tuition-management app. TOTP is on the v2.x roadmap for Institute tier. [`12_Business_Rules.md §BR-SEC-04`, `15_Future_Roadmap.md`]

**Q4. What if I forget my email?**
Your email is your account identifier — there is no username. If you forget which email you signed up with, email hello@buddysaradhi.app from any email you have access to, with the tutor name and a couple of student names you remember. We'll find your account and confirm the email. (We do this manually to prevent account-takeover attacks.) [`10_Security.md`, `web/03_Auth_and_Provisioning.md`]

**Q5. What if I lose access to my email?**
Email hello@buddysaradhi.app from your new email, with proof of identity (a photo of your Aadhaar or PAN, with the ID number partially masked — last 4 digits only). We'll migrate your account to the new email. This is manual and takes ~24 hours. We require the ID proof because email takeover is the #1 account-theft vector. [`10_Security.md`, `01_Product_Principles.md P10`]

**Q6. Can someone else access my account if they have my email?**
No, not without your OTP. Every login from a new device requires a fresh OTP. After login, the device is trusted for 30 days (configurable in Settings → Security). After 30 days, a new OTP is required. If you suspect unauthorised access, Settings → Security → Sign out all devices immediately revokes all trusted sessions. [`10_Security.md`, `web/03_Auth_and_Provisioning.md`]

**Q7. What if I lose my phone with the Buddysaradhi app installed?**
Your data is safe in your Turso database — it is not on your phone (the phone has a local replica, but the source of truth is Turso). Sign in on a new device, your data syncs down. For security, sign out all devices from Settings → Security (do this from a web browser on a computer, since you don't have the phone) to revoke the lost phone's trusted session. [`12_Business_Rules.md §BR-SEC-04`, `12_Business_Rules.md §BR-SYN-09`]

**Q8. Can I share my account with my co-tutor?**
On the Institute tier (₹999/mo), yes — you can add up to 5 co-tutors, each with their own email login, each seeing only the batches you assign. On Free and Pro, no — account sharing is a security risk (you'd share your OTP) and a violation of our terms. Upgrade to Institute if you need co-tutor access. [`05_Pricing_and_Plans.md §1`, `12_Business_Rules.md §BR-SEC-04`]

---

## 7. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated, neumorphic controls recipe-annotated, cross-references canonical (`§5.5`, `§6.6`, `§8.*`, `BR-*`, `P*`, `AP-*`). Box widths honour §20.3 rule 2 (80–120 for landing-page sections, 60–80 for components). The accordion layout (§3.3) already lives above with closed + open states, category tabs, and the contact-CTA; this section adds two new mockups that visualise the Top-5 above-the-fold shortlist and the search empty / no-results state.

### 7.1 Design System Reference (§5.5 + §6.6 single rule)

The FAQ section has **one workhorse glass surface** (the "Still stuck?" contact card, `.glass` per §5.5 workhorse tier), **one recede surface family** (the 49 accordion rows, each `.glass-faint` per §5.5 marketing-FAQ-accordion-row), and **two neumorphic controls** (the 6-tab category segmented control `.neumo-inset` per §6.6, and the contact-CTA `.neumo-raised` secondary per §6.6). The cosmic canvas is the aurora source; the glass blurs the aurora behind the cards. **No glass-on-glass** (§5.3): the `[+]` / `[-]` icon inside each accordion row is a flat glyph, not a nested glass panel.

| FAQ surface / control (per §5.5 + §6.6) | Tier / recipe | Spec |
|---|---|---|
| Top-5 shortlist card (above-the-fold) | `.glass` (workhorse) | §2.2 |
| Accordion row (×49, closed) | `.glass-faint` band (recede) | §3.1, §3.3, §5.5 marketing-FAQ-row |
| Accordion row (×49, open) | `.glass-faint` band (recede) — same tier | §3.1, §3.3 |
| `[+]` / `[-]` expand icon | flat glyph (Unicode + or −) — not glass, not neumorphic | §3.1 |
| Category tabs (6) | `.neumo-inset` segmented control + `.neumo-raised` active pill | §3.3, §6.6 segmented, §8.5 |
| "Still stuck?" contact card | `.glass` (workhorse) | §5, §5.5 workhorse |
| "Email hello@buddysaradhi.app →" CTA | `.neumo-raised` secondary (cyan border, no glow) | §5, §6.6 primary-button, §8.2 |
| Search input (top of accordion) | `.neumo-inset` well | §4.1, §6.6 input-field, §8.9 |

### 7.2 Top-5 Above-the-Fold Shortlist (NEW)

The §2 Top-5-Questions Shortlist is the first thing a visitor sees when they land on `/faq` (or scroll to the FAQ section on `/`). It is a single `.glass` card listing the 5 most-asked questions as inline links; tapping a link scrolls to that Q&A in the full accordion below (the question stays closed until tapped). This is the conversion-triage surface — it answers 80% of visitor questions in one screen, no scrolling.

```
  TOP-5 SHORTLIST CARD  (above-the-fold on /faq, §2 above)
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  ░░░ cosmic canvas: #0f0c29 → #24243e → #0a0a1a (§2.2) — aurora source ░░░░░░░░░░░░ │
  │                                                                                    │
  │  ┌── .glass card (workhorse tier, §5.5) ──────────────────────────────────────╲    │
  │  │▌ ◉ 5 QUESTIONS TUTORs ASK FIRST                                            │   │
  │  │▌                                                                            │   │
  │  │▌ 1. Is Buddysaradhi really free?                                  → §6.2 Q1 │   │
  │  │▌    ↑ tap scrolls to Q1; the row stays closed until tapped                │   │
  │  │▌                                                                            │   │
  │  │▌ 2. Why is Buddysaradhi free? When will you charge?              → §6.2 Q2 │   │
  │  │▌    ↑ "Free while our infra stays free" — cost-anchored pricing, §1.6    │   │
  │  │▌                                                                            │   │
  │  │▌ 3. Does Buddysaradhi work offline?                                     → §6.4 Q1 │   │
  │  │▌    ↑ P5 (offline-first); BR-SYN-01 (local-only sync stub in v1)          │   │
  │  │▌                                                                            │   │
  │  │▌ 4. Is my data safe? Does Buddysaradhi sell it?                         → §6.3 Q1 │   │
  │  │▌    ↑ No telemetry (Rule 3, AP-10, TELE-1); AES-256 backups (BACKUP-1)    │   │
  │  │▌                                                                            │   │
  │  │▌ 5. Will you add ads or lock my data?                              → §6.2 Q5 │   │
  │  │▌    ↑ Never. No ads, no data lock-in. BR-PRC-05, BR-PRC-07                  │   │
  │  │▌                                                                            │   │
  │  │▌ ─────────────────────────────────────────────────────────────────────     │   │
  │  │▌ Or browse all 49 questions by category ↓                                  │   │
  │  └────────────────────────────────────────────────────────────────────────────╱    │
  │                                                                                    │
  │  ╭── neumo-inset segmented control: 6 category tabs (§3.3, §6.6) ──────────╮      │
  │  │  ╭══════════╮ ╭────────╮ ╭────────╮ ╭────────╮ ╭────────╮ ╭────────╮   │      │
  │  │  ║▌Started  ║ │Pricing │ │Privacy │ │Sync    │ │Platform│ │Account │   │      │
  │  │  ╰══════════╯ ╰────────╯ ╰────────╯ ╰────────╯ ╰────────╯ ╰────────╯   │      │
  │  ╰────────────────────────────────────────────────────────────────────────╯      │
  │   ↑ .glass card: rgba(255,255,255,0.05) + backdrop-blur(24px) per §5.1            │
  │   ↑ Each Q link is a ghost link (--text-secondary → --text-primary on hover);     │
  │     NOT a neumo-raised button — it is a navigational scroll, not a CTA.           │
  │   ↑ "→ §6.1 Q1" = a small caption hint showing where the answer lives;            │
  │     NOT a separate link, just a visual anchor.                                    │
  │   ↑ Category tabs = .neumo-inset well + .neumo-raised active pill (§3.3, §8.5)    │
  │   ↑ Active pill carries 2px cyan left-bar (tab-underline-slide, §7.3)             │
  │   ↑ 44×44px hit area on every link + tab (Rule 10, P15, §10.2)                     │
  │   ↑ The shortlist + tabs together = "above the fold" on /faq at 1024×768          │
  │   ↑ WCAG 2.1 AA on cosmic canvas; --text-primary on .glass = 15.2:1               │
  │   ↑ All 49 Q&As are present in the DOM (for SEO + search) but visually below     │
  │     the fold; the shortlist is a triage surface, not a filter.                     │
  └────────────────────────────────────────────────────────────────────────────────────┘
   ↑ India-first voice preserved: "tutors", ₹0/mo (free for everyone, for now), IST business hours.
   ↑ No dark patterns (§13 of product/07, P15) — the shortlist answers, never sells.
```

### 7.3 Search Empty State + No-Results State (NEW)

The §4 Searchable FAQ has two non-default states that must be designed, not left to chance: (a) the empty state — the search input is focused but no query typed yet (placeholder visible, hints visible); (b) the no-results state — the query matched zero Q&As (the contact-CTA is hoisted into view immediately). Both states use `.glass-faint` bands for the result rows (same tier as the default accordion), and both surface the contact-CTA as the fallback.

```
  SEARCH STATES — EMPTY (focus, no query) + NO-RESULTS (zero matches)
  (per §4 search behaviour, §5 contact-CTA fallback)

  STATE A — EMPTY (focus, no query typed yet)
  ┌────────────────────────────────────────────────────────────────────────┐
  │  ╭── search input (.neumo-inset well, §8.9) ──────────────────────╮   │
  │  │ 🔍  Search 49 questions…|                                       │   │
  │  ╰─────────────────────────────────────────────────────────────────╯   │
  │   ↑ .neumo-inset: inset 4px 4px 8px #0a0a1a, -4px -4px 8px #2a2a5a     │
  │   ↑ cyan 2px inset ring + 12px inset glow (focus state, §10.3)         │
  │   ↑ placeholder --text-muted, caret blinks                              │
  │   ↑ aria-label="Search the 49 frequently asked questions"               │
  │                                                                         │
  │  ┌── hint row (.glass-faint, recedes) ─────────────────────────────╲   │
  │  │  Try:  "free tier"  ·  "offline"  ·  "GST"  ·  "cancel"           │   │
  │  └─────────────────────────────────────────────────────────────────╱   │
  │   ↑ Tapping a hint fills the search input (no navigation).              │
  │   ↑ Hints are flat tinted chips (§2.3) — NOT neumorphic (they are      │
  │     labels, not controls).                                              │
  │                                                                         │
  │  (All 49 accordion rows still visible below; search filters live.)      │
  └────────────────────────────────────────────────────────────────────────┘

  STATE B — NO-RESULTS (query matched zero Q&As)
  ┌────────────────────────────────────────────────────────────────────────┐
  │  ╭── search input (.neumo-inset well) ────────────────────────────╮   │
  │  │ 🔍  zzzzznonexistentquestion|                              ✕    │   │
  │  ╰─────────────────────────────────────────────────────────────────╯   │
  │   ↑ clear-✕ appears (neumo-raised micro-button, 44px hit area, §8.10)  │
  │   ↑ input still focused; cyan ring + glow preserved                    │
  │                                                                         │
  │  ┌── empty-result card (.glass, §8.19 empty-state pattern) ──────╲   │
  │  │                                                                  │   │
  │  │                       ╭────────╮                                  │   │
  │  │                       │  ┌──┐  │   ← 120×120 SVG line-art         │   │
  │  │                       │  │ ? │  │     cyan+emerald (§9.3 custom)  │   │
  │  │                       │  └──┘  │                                  │   │
  │  │                       ╰────────╯                                  │   │
  │  │                                                                  │   │
  │  │              No questions match your search.                     │   │
  │  │         We may not have written the answer yet.                   │   │
  │  │                                                                  │   │
  │  │         ┌──────────────────────────────────────┐                 │   │
  │  │         │  Email hello@buddysaradhi.app →           │ ← CTA #6        │   │
  │  │         └──────────────────────────────────────┘   neumo-raised   │   │
  │  │                                                    secondary      │   │
  │  │                                                    (cyan border)  │   │
  │  │              or browse all 49 questions                            │   │
  │  │                                                                  │   │
  │  └──────────────────────────────────────────────────────────────────╱   │
  │   ↑ .glass card (workhorse tier, §5.5) — the empty-result surface       │
  │   ↑ CTA = .neumo-raised secondary (cyan border @ 40%, no glow, §6.6)     │
  │   ↑ Same CTA as the §5 "Still stuck?" fallback — single conversion       │
  │     surface, two trigger paths (search-fail + scroll-to-bottom).         │
  │   ↑ Empty-state SVG = custom line-art (NOT lucide, §9.3); honours        │
  │     prefers-reduced-motion (no animation).                              │
  │   ↑ "or browse all 49 questions" = ghost link, clears the search input   │
  │     and restores the full accordion (no navigation).                     │
  │   ↑ No telemetry on search queries (Rule 3, AP-10, TELE-1) — the         │
  │     query never leaves the browser; FUSE.js runs client-side.            │
  └────────────────────────────────────────────────────────────────────────┘

   ↑ STATE A and STATE B share the same .neumo-inset search well.
   ↑ STATE A: hints visible, accordion intact (no filter applied yet).
   ↑ STATE B: hints hidden, accordion hidden, contact-CTA hoisted (P15 —
     honest empty state: "we may not have written the answer yet" is the
     truth; the CTA is the next action).
   ↑ Both states: 44×44px hit area on every interactive element (§10.2).
   ↑ Search is client-side FUSE.js (web/07 §7.3 Search Island); SSR renders
     the full accordion + the empty-state placeholder, hydrates the search.
```

### 7.4 References (External Design Authorities)

The FAQ mockups, the top-5 shortlist, and the search-empty states synthesise practices from the following public bodies of work. Cite them when a contributor challenges the accordion pattern, the top-5 triage, or the no-results fallback.

- **Nielsen Norman Group** — *FAQ Accordion UX* and *Empty States for Search*. The §7.2 top-5 shortlist (above-the-fold triage) and §7.3 no-results state (CTA hoisted) follow NN/g's research on FAQ patterns and empty-state design.
- **Smashing Magazine** — *FAQ UX Patterns* and *Single-Open Accordion Rules*. The §3.3 single-open rule (only one Q open at a time) and the §7.2 top-5 shortlist follow Smashing's research on FAQ scannability.
- **Baymard Institute** — *Search UX for Content Sites* and *No-Results Patterns*. The §7.3 search-empty + no-results states and the FUSE.js client-side search follow Baymard's research on search friction.
- **Apple Human Interface Guidelines** — *Marketing Surfaces* and *Accordions*. The §3.3 `.glass-faint` accordion row tier and the §7.2 `.glass` shortlist card follow Apple HIG's marketing-surface layering.
- **A List Apart** — *Content Strategy for FAQ* and *The Triage Pattern*. The §7.2 top-5 shortlist (answers 80% of questions in one screen) follows ALA's content-strategy doctrine.
- **Google Search Central** — *FAQPage Schema (JSON-LD)* and *Search-Result URLs*. The §7.2 shortlist and the §4 search must align with the `FAQPage` JSON-LD schema in `09_SEO_and_Analytics.md §4.2`.
- **Vercel Web Analytics docs** — *Custom Event Catalogues*. The §7.3 search-empty + no-results states fire no telemetry (search queries are local-only); the §7.2 shortlist-tap fires `faq_shortlist_click` aggregate-only (Rule 3, AP-10, TELE-1).

---

## 8. Cross-References

- `01_Product_Positioning.md §6` (brand voice — every FAQ answer follows this), §3 (USPs referenced throughout).
- `02_Hero_and_Above_the_Fold.md §5.2` (90s tour video — referenced in Q1.8).
- `04_Download_Hub.md §2` (5 download cards — referenced in §6.5), §6 (install guides — referenced in §6.5), §7 (SHA-256 verification — referenced in §6.5).
- `05_Pricing_and_Plans.md` (the entire pricing spec — referenced throughout §6.2).
- `07_CTA_and_Conversion.md §1` (the 7 CTAs — FAQ-bottom owns the 6th).
- `09_SEO_and_Analytics.md §6` (no-telemetry rule — referenced in §6.3 Q3), §7 (GDPR/DPDP — referenced in §6.3 Q8/Q9).
- `10_Security.md` (the full security spec — referenced throughout §6.3 and §6.6), §17 (TELE-1 — no telemetry). `12_Business_Rules.md` §BR-SEC-04 (biometric), §BR-SEC-10 (account deletion).
- `09_Backup_and_Import_Export.md` (the .buddysaradhi envelope — referenced throughout §6.4), BACKUP-1 (AES-256-GCM + Argon2id), BR-IMP-04 (CSV import), BR-IMP-06 (cross-platform restore).
- `12_Business_Rules.md` BR-SYN-01..09 (sync rules — referenced throughout §6.4), BR-LED-06 (append-only ledger), BR-STU-05 (class/board/subject agnostic), BR-STU-11 (Free-tier 250-student soft guidance — does NOT block at 250; logs `student_count_milestone` and surfaces a friendly "tell us your story" prompt), BR-PRC-01 (free for everyone, for now — single public tier), BR-PRC-02 (grandfather clause — Free access never lowers), BR-PRC-03 (no paywall in v1 — 250 soft guidance, friendly prompt only), BR-PRC-04 (60-day notice before paid tiers launch), BR-PRC-05 (no ads, ever), BR-PRC-06 (no sync throttling), BR-PRC-07 (no feature removal), BR-FEE-04 (receipt hash), BR-M-01 (integer paise).
- `13_UI_Guidelines.md §10` (accessibility — the accordion's keyboard nav), §5 (glass tiers — accordion card styling).
- `web/01_Architecture.md §3` (route groups — `/faq` lives in `(marketing)`), §6 (middleware — FAQ search is client-side, not middleware-routed).
- `web/03_Auth_and_Provisioning.md` (the signup/login flow — referenced in §6.1 Q4, §6.6 Q1/Q4/Q5).
- `web/07_Landing_Page.md §7` (FAQ Implementation — the HOW: the `<FAQAccordion>` RSC, the client-side search island with FUSE.js, the JSON-LD `FAQPage` schema, the "Top 5 questions" surface, the deep-linking + hash-routing. This file owns the 49 Q&A pairs and the authenticity rule; that file owns the React tree, the search index, and the structured-data payload that ship them).
- `mobile/04_Offline_Sync_and_Conflict_Resolution.md` (sync conflicts — referenced in §6.4 Q2).
- `mobile/07_App_Store_Release.md` (App Store / Play Store listings — referenced in §6.5).
- `desktop/04_Code_Signing.md` (EV code signing — referenced in §6.5 Q4), `desktop/06_Installers.md` (.dmg/.msi formats).
- `15_Future_Roadmap.md` (v2.x features — referenced in §6.1 Q7, §6.6 Q3).
- `product/AGENTS.md §3` (no-emoji rule — the FAQ search icon is the only exception).

---

## References

The FAQ conventions in this file draw on the following public bodies of practice. Cite them when a contributor challenges the single-open accordion, the search privacy rule, or the no-chatbot fallback.

- **Nielsen Norman Group** — *Accordion UX Patterns* and *FAQ Page Design for SaaS*. The §3.2 single-open rule, the §3.2.4 240ms expand animation, and the §2 above-the-fold top-5 shortlist are NN/g-anchored.
- **Smashing Magazine** — *FAQ Search UX* and *The "Still Stuck?" Pattern*. The §4 client-side search (FUSE.js, no server round-trip, no keystroke logging) and the §5 hello@ fallback follow Smashing's research on objection-handling UX.
- **Baymard Institute** — *Objection Handling in SaaS Marketing* and *No-Chatbot Patterns*. The §5.2 no-chatbot rule and the §5.1 24-hour-human-response SLA are Baymard-anchored.
- **Apple Human Interface Guidelines** — *Disclosure Patterns* and *Keyboard Navigation for Accordion Controls*. The §3.2.6 keyboard-nav contract (`<button>` with `aria-expanded` + `aria-controls`, Tab + Enter/Space) is Apple-HIG-derived.
- **A List Apart** — *Writing FAQ Answers That Convert* and *The Cross-Reference Pattern*. The §6 49-Q&A verbatim-source-of-truth rule and the cross-reference brackets at the end of every answer are ALA-anchored.
- **Google Search Central** — *FAQPage JSON-LD Schema*. The §6 Q&A source is consumed by `09_SEO_and_Analytics.md §4.2` to generate the `FAQPage` JSON-LD payload that powers rich results in Google Search.

---

*The FAQ is where objections meet answers. Every Q&A on this page exists because a real tutor asked it. Every answer traces to a spec that backs it up. If a visitor cannot find their answer here, the page has failed — and they should email hello@buddysaradhi.app, where a human will respond in 24 hours.*
