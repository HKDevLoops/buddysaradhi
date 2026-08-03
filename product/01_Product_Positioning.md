# 01 — Product Positioning

> The **positioning contract** for the Buddysaradhi commercial landing page. Before any headline, feature card, or pricing tier is written, the writer must internalise this file. It answers four questions: *Who is this for? What does it replace? Why is it different? What does it cost in attention, money, and trust?* If a piece of copy on `buddysaradhi.app/` cannot be traced back to a sentence in this file, the copy is off-brand and must be rewritten.

---

## 1. The One-Sentence Value Proposition

> **Buddysaradhi is the operating system for private tutors and small coaching institutes — five screens, seven engines, one ledger, zero servers to manage, that works offline first and respects your data as yours.**

Every word in that sentence does work. "Operating system" sets the ambition — we are not an app, we are the layer the tutor runs their tuition on. "Private tutors and small coaching institutes" narrows the audience (Rule 4, P1 — the tutor is the user). "Five screens, seven engines, one ledger" is the product architecture (`00_Vision.md §1.1`, `01_Product_Principles.md P2`). "Zero servers to manage" defangs the school-ERP fear. "Works offline first" is P5. "Respects your data as yours" is P10.

### 1.1 The Tagline Hierarchy

Three taglines, in descending length, for different placements on the page:

| Length | Tagline | Where it goes |
|---|---|---|
| **Long (≤ 22 words)** | "Five screens. Seven engines. One ledger. Zero servers to manage. The operating system for private tutors and small coaching institutes." | Hero subheadline, meta description, OG description. |
| **Medium (≤ 12 words)** | "Five screens. Seven engines. One ledger. Zero servers." | Footer one-liner, Play Store short description, email signature. |
| **Short (≤ 6 words)** | "Buddysaradhi — your tuition, in five screens." | Nav-bar wordmark tooltip, social bio, push notification attribution. |

The medium tagline is the **canonical** one. It appears verbatim in the hero subheadline, in the footer, in the App Store / Play Store listings (`mobile/07_App_Store_Release.md`), in the email signature template, and in the OpenGraph description. If a writer needs to shorten it for space, they take the short form. They never invent a fourth variant.

### 1.2 The One-Line Elevator Pitch (for sales calls, press, partner decks)

> "Buddysaradhi is what a private tutor would build for themselves if they had a year and a great engineering team. It replaces the WhatsApp-plus-Excel-plus-paper-register stack with one app that runs on the web, on Mac and Windows, and on Android and iOS — and it works without internet, because most Indian tuition still happens in rooms where the WiFi does not."

This is the spoken version. It is warmer, slower, and leads with the empathy beat ("what a private tutor would build for themselves"). It is the answer to "so what is Buddysaradhi?" at a dinner party, a press interview, or a Razorpay partnership call. It must never appear on the landing page itself — the page is for visitors who already clicked through; the elevator pitch is for the founder talking to a journalist.

---

## 2. Target Audience Personas

Buddysaradhi is built for three personas. The landing page must speak to all three without forcing a visitor to self-identify. The trick is to write copy that the most-demanding persona (the institute owner) respects and the least-demanding persona (the solo tutor) finds approachable.

### 2.1 Persona A — Riya, the private tutor in Nagpur (primary)

**Demographics.** Female, 32, M.Sc. Mathematics, lives in Nagpur, Maharashtra. Teaches Class 8–10 CBSE mathematics from a converted study room in her parents' house.

**Business.** 38 students across 4 batches (Mon–Tue CBSE 10, Wed–Thu CBSE 9, Fri–Sat CBSE 8, Sunday NEET foundation). Fees: ₹2,500/mo per student, monthly billing. Collects ₹95,000/mo gross.

**Tools today.** A paper register for attendance (one per batch). A WhatsApp group per batch for homework reminders. An Excel sheet for fees — one row per student per month, manually updated when a parent pays via UPI. A Google Keep list of "things to remember" — whose parent promised to pay next week, whose elder sibling is also in her batch and gets a sibling discount.

**Pain.** The Excel sheet is the pain. Every month she copies the sheet, clears the "paid?" column, and re-enters 38 names. When a parent pays via UPI on the 14th but she forgets to mark it until the 22nd, she has to scroll back through Google Pay transactions to remember. When a parent disputes "I already paid!" she has no receipt to show. The paper register has been wet twice.

**What she wants from Buddysaradhi.** A fees ledger she can trust. A receipt she can screenshot and forward on WhatsApp. An attendance register that does not die in the rain. A way to mark 38 students present in 20 seconds, not 2 minutes.

**Price sensitivity.** ₹299/mo (when Pro launches per §1.6 trigger) is "two samosas per student per month" — trivially affordable. She will pay it without thinking, the day she wants unlimited students AND paid tiers are live. Pre-trigger, she is free, like everyone — no paywall, no waitlist. She will not pay ₹999/mo unless she hires a co-tutor.

**On the landing page, Riya is the visitor who:**
- Reads the hero headline and nods.
- Scrolls straight to Features → Fees & Payments.
- Checks Pricing → confirms Free for everyone, for now (paid tiers ₹299/mo / ₹999/mo launch on the §1.6 trigger, but are not shown on the public pricing page in v1).
- Clicks "Start free — no card" → signs up with her personal Gmail.
- Adds her 38 students in the first 90 seconds via the bulk-import CSV (`09_Backup_and_Import_Export.md §BR-IMP-04`).

### 2.2 Persona B — Kabir, the small coaching institute owner in Indore (secondary)

**Demographics.** Male, 41, B.Tech. + M.Tech. from IIT Bombay, left a software job at 30 to start a JEE coaching institute in Indore, Madhya Pradesh. Now in year 6.

**Business.** 180 students across 3 subjects (Physics, Chemistry, Mathematics) and 3 co-tutors. Three batches per subject per class (Class 11, Class 12, droppers). Fees: ₹8,000/mo per student per subject, or ₹18,000/mo for all three. Collects ~₹14,00,000/mo gross.

**Tools today.** A school-ERP he bought 3 years ago for ₹84,000/yr. He uses it for fees only. The attendance module is unusable (he says "the dropdowns reload every time"). His co-tutors refuse to use it ("too slow"). They keep their own attendance in paper registers. The ERP's parent portal has 4 login issues per week from parents who forget their password. He has a part-time admin who reconciles the fees sheet with the ERP every month — that takes her 6 hours.

**Pain.** The ERP is the pain. It does 200 things badly. He uses 3 of them. He pays for 200. The co-tutors do not use it because the UI feels like a government portal. The admin's 6-hour monthly reconciliation is the most expensive labour line in his business after rent.

**What he wants from Buddysaradhi.** A tool his co-tutors will actually use (because it takes 20 seconds to mark attendance, not 2 minutes). A fees ledger that is the source of truth, so the admin's reconciliation becomes 30 minutes, not 6 hours. Multi-tutor support so each co-tutor sees only their batches. A receipt that a parent can verify without logging in.

**Price sensitivity.** ₹999/mo for Institute tier (when it launches per §1.6 trigger) is "two cups of chai per student per month." He will pay it the day he sees a co-tutor use the app without complaining. He will expense it as a business cost; he needs a GST invoice (the Pro tier does not generate one, the Institute tier does — `05_Pricing_and_Plans.md Appendix A`). Pre-trigger, he is free, like everyone — multi-tutor support is not yet available (it launches with the Institute tier).

**On the landing page, Kabir is the visitor who:**
- Reads the hero headline and is sceptical ("operating system" sounds like marketing fluff).
- Scrolls to Features → confirms multi-tutor support exists.
- Reads Testimonials → looks for another institute owner, not a solo tutor.
- Checks Pricing → confirms Free for everyone, for now; Institute tier (₹999/mo + GST invoice) launches on the §1.6 trigger — internal-only until then.
- Scrolls to FAQ → reads "Can my co-tutors each have their own login?" (`06_FAQ.md §6.4`).
- Clicks "Start free — no card" → signs up with his institute email.
- Books a 15-minute onboarding call (offered in-app, not on the landing page).

### 2.3 Persona C — Ananya, the freelance educator in Bangalore (tertiary, do-not-over-fit)

**Demographics.** Female, 27, B.A. English Literature, teaches spoken English and creative writing online via Zoom to 12 students across India and the Gulf.

**Business.** 12 students, 1-on-1, hourly. Fees: ₹1,200/hr for Indian students, ₹2,500/hr for Gulf students. Collects ~₹1,80,000/mo.

**Tools today.** Calendly for scheduling. Google Meet for sessions. A Notion database for student notes. Razorpay payment links for fees. A spreadsheet for tracking who paid for which session.

**Pain.** The spreadsheet is the pain. Calendly and Razorpay do not talk to each other. She marks attendance in Notion after the session ("did the student show up?"). She marks payment in the spreadsheet after the parent pays. When a parent cancels 2 hours before and Calendly refunds nothing, she has to manually track the credit.

**What she wants from Buddysaradhi.** A single place where attendance + fees + notes live together. She does not need batches; she needs per-student sessions. She does not need parent SMS; she needs email receipts. She is the visitor for whom Buddysaradhi is "good enough" — not perfect, but better than the spreadsheet.

**Price sensitivity.** ₹299/mo (when Pro launches) is fine. She will never need Institute tier. Pre-trigger, she is free, like everyone.

**On the landing page, Ananya is the visitor we must not over-fit to.** She is the visitor who:
- Reads the hero headline and thinks "this is for offline tutors, not me."
- Scrolls to Features → confirms it handles 1-on-1 sessions (it does — batches are optional).
- Checks Pricing → confirms Free tier covers her 12 students forever.
- Signs up, uses it, refers a friend.
- **We do not write hero copy aimed at Ananya.** We write hero copy aimed at Riya. Ananya is smart enough to translate.

### 2.4 Persona Anti-targets (who we explicitly do NOT serve)

The landing page must not appeal to:

- **School administrators** (CBSE/ICSE/IB school IT staff). They need school ERPs. Buddysaradhi does not do timetabling, parent portals with 500 logins, transport management, library, or report cards in the school format.
- **MOOC providers** (Coursera, Udemy-style course creators). They need video hosting, quiz engines, certificate generation. Buddysaradhi does none of that.
- **University registrars.** They need credit-hour tracking, transcript generation, accreditation reports. Buddysaradhi does none of that.
- **Edtech platforms with their own apps.** They need white-label SDKs. Buddysaradhi is not a white-label product.

If a piece of copy on the landing page reads like it is selling to any of these, the copy is wrong. Rewrite.

### 2.5 Persona Card — Three-Up Layout

The three personas render as three `.glass` cards on the positioning page (a marketing sub-page at `/positioning`, linked from the footer's "About" link — separate from the hero). On desktop they sit in a 3-column grid; on mobile they stack 1-column. Each card uses the workhorse `.glass` tier (5% white, 24px blur) per §5.5 of `13_UI_Guidelines.md`, with a 2px accent left-border per §5.4 to colour-code the persona's primary USP.

```
  DESKTOP 3-UP (cols 1–4 · 5–8 · 9–12 of the 12-col grid, §4.2 of 13_UI_Guidelines.md)

  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐
  │▌ PERSONA A · PRIMARY     │  │▌ PERSONA B · SECONDARY   │  │▌ PERSONA C · TERTIARY    │
  │▌                         │  │▌                         │  │▌                         │
  │▌ Riya, 32, Nagpur        │  │▌ Kabir, 41, Indore       │  │▌ Ananya, 27, Bangalore   │
  │▌ M.Sc. Mathematics       │  │▌ IIT Bombay M.Tech.      │  │▌ B.A. English Lit.       │
  │▌                         │  │▌                         │  │▌                         │
  │▌ 38 students · 4 batches │  │▌ 180 students · 3 co-    │  │▌ 12 students · 1-on-1    │
  │▌ ₹2,500/mo per student   │  │▌ tutors · 3 subjects     │  │▌ ₹1,200/hr (India)       │
  │▌ Collects ₹95,000/mo     │  │▌ Collects ₹14,00,000/mo  │  │▌ Collects ₹1,80,000/mo   │
  │▌                         │  │▌                         │  │▌                         │
  │▌ Today: WhatsApp + Excel │  │▌ Today: ₹84k/yr school   │  │▌ Today: Calendly + Razor-│
  │▌ + paper register.       │  │▌ ERP (uses 3% of it).    │  │▌ pay + Notion + Sheets.  │
  │▌                         │  │▌ Co-tutors refuse to use │  │▌                         │
  │▌ Pain: Excel sheet is    │  │▌ it. Admin spends 6h/mo  │  │▌ Pain: Calendly + Razor- │
  │▌ the pain. Wet register  │  │▌ reconciling fees.       │  │▌ pay don't talk. Manual  │
  │▌ twice. No receipt to    │  │▌                         │  │▌ per-session tracking.   │
  │▌ show disputing parent.  │  │▌ Wants: co-tutors who    │  │▌                         │
  │▌                         │  │▌ will actually use the   │  │▌ Wants: one place where  │
  │▌ Wants: a fees ledger    │  │▌ app, 20-sec attendance, │  │▌ attendance + fees +     │
  │▌ she can trust, a        │  │▌ GST invoice, ROI report.│  │▌ notes live together.    │
  │▌ screenshotable receipt, │  │▌                         │  │▌                         │
  │▌ 20-sec attendance.      │  │▌ Tier: Institute ₹999/mo │  │▌ Tier: Free, for everyone│
  │▌                         │  │▌ (GST invoice unlocks    │  │▌ (for now — all features│
  │▌ Tier: Free, for everyone│  │▌ input tax credit,       │  │▌ for 12 students, no   │
  │▌ (for now — Pro ₹299/mo  │  │▌ launches on §1.6 trig-  │  │▌ paywall, no waitlist).│
  │▌ launches on §1.6 trig-  │  │▌ ger).                   │  │▌                        │
  │▌ ger, post-trigger only).│  │▌                         │  │▌ DO NOT OVER-FIT HERO   │
  │▌                         │  │▌ Reads: testimonials +   │  │▌ COPY TO ANANYA. Hero    │
  │▌                         │  │▌ Institute FAQ.          │  │▌ copy aims at Riya; she  │
  │▌ Reads: hero + features  │  │▌                         │  │▌ translates.             │
  │▌ → Fees + pricing.       │  │▌                         │  │▌                         │
  └──────────────────────────┘  └──────────────────────────┘  └──────────────────────────┘
   ↑ .glass (5% white, 24px blur, §5.5)
   ↑ 2px accent left-border (§5.4):
     Riya = emerald (USP-3 ledger, primary CTA colour)
     Kabir = cyan (USP-1 five screens, info focus)
     Ananya = violet (USP-4 backups, neutral informational)
   ↑ Card padding p-6 (24px), gap-3 internal (§4.4 of 13_UI_Guidelines.md)
   ↑ 44×44px min touch target on the "Read persona brief →" link (§10.2)
   ↑ en-IN lakh format: ₹14,00,000 (14 lakh), ₹1,80,000 (1.8 lakh), ₹95,000

  MOBILE 1-UP STACK (cols 1–12, full-width, §4.2 base breakpoint)
  ┌──────────────────────────────────┐
  │▌ PERSONA A · PRIMARY              │
  │▌ Riya, 32, Nagpur · M.Sc. Maths   │
  │▌ 38 students · ₹95,000/mo gross   │
  │▌ … (same content, narrower wrap)  │
  │▌                                  │
  │▌ [Read persona brief →]           │  ← neumo-raised ghost button (§6.6, §8.2)
  └──────────────────────────────────┘
   ↑ .glass + 2px emerald left-border, full-width, p-6
   ↑ Stacks vertically: A → B → C, with space-8 (32px) between cards
```

The persona card is **not** on the landing page itself — the landing page speaks to all three personas simultaneously through the hero, features, and pricing sections. The persona card lives on the deeper `/positioning` page (linked from footer "About"), where a visitor who wants to verify "is this really for someone like me?" can read the full persona brief.

---

## 3. The Unique Selling Proposition (USP) — Five Differentiators

Buddysaradhi has exactly five differentiators vs the competitive set. Every feature card, every testimonial, every FAQ answer should trace back to one of these. If a differentiator cannot be defended, it is not a differentiator — it is a feature parity claim, and feature parity claims belong in the comparison table, not the hero.

### 3.1 USP-1 — Five screens, not fifty (P2)

School ERPs have 200 features across 12 modules. Buddysaradhi has five screens: Dashboard, Students, Attendance, Fees, Settings. Every feature a tutor needs is reachable in two taps from any screen. The land page's hero headline implies this; the features section makes it literal; the FAQ's "where do I do X?" answers all redirect to one of the five.

**Defense.** Defensible. Competitors cannot match this without re-architecting. They can only add features, never remove them — their existing customers depend on the clutter.

### 3.2 USP-2 — Offline-first, not online-required (P5)

Buddysaradhi works fully offline. A tutor in a basement classroom with no WiFi can mark attendance, record a fee, void a receipt, generate a report. Sync happens when the internet returns. Competitors (Classplus, Teachmint) are online-first; their offline modes are read-only caches, not write-capable replicas.

**Defense.** Defensible. The local-first architecture (`mobile/02_Native_Modules_and_Storage.md`, `desktop/02_Rust_Core.md`) is a 12-month engineering investment. Competitors cannot copy it in a quarter.

### 3.3 USP-3 — One ledger, append-only, with receipts (`12_Business_Rules.md §BR-LED-06`)

Fees in Buddysaradhi are not rows in a spreadsheet. They are entries in an append-only ledger. Every payment creates a receipt with a tamper-evident hash. Every correction is a VOID entry, not an edit. The ledger is the source of truth, not the Excel sheet the admin updates on the 1st of every month.

**Defense.** Defensible. No competitor markets this. Most competitors' fees modules are editable spreadsheets with a UI wrapper; the "edit" button is a feature, not a bug, in their mental model.

### 3.4 USP-4 — Backups are yours, encrypted, exportable (P10, BACKUP-1)

A tutor can export their entire database as a `.buddysaradhi` envelope — AES-256-GCM encrypted, Argon2id password-derived. The envelope is a single file. They can put it on a pen drive, email it to themselves, store it in Google Drive. They can restore from it on a new device. They can leave Buddysaradhi tomorrow and take their data with them in a readable format (`09_Backup_and_Import_Export.md`).

**Defense.** Defensible and uniquely marketed. Competitors lock data in; their export is a CSV with half the fields missing. The "your data is yours" line is not a feature claim — it is a values claim.

### 3.5 USP-5 — No telemetry, no third-party APIs that see PII (Rule 3, TELE-1, Rule 2)

Buddysaradhi does not call Mixpanel, Sentry, GA, or any third-party analytics SDK. The web app does not load Hotjar, Clarity, or FullStory. The mobile app does not crash-report to Crashlytics. The only network calls are to Turso (the per-user database) and the update-check ping. Vercel Web Analytics is aggregate-only — it cannot see a single tutor's data, only page-view counts.

**Defense.** Defensible and uniquely marketed. Competitors' privacy policies are 4 pages of "we share data with these 17 partners." Buddysaradhi's privacy policy is one page. This is the line that wins the privacy-conscious tutor and the institute owner whose advocate friend reviewed the competitor's privacy policy.

### 3.6 The USP-to-Copy Map

| USP | Hero mention | Feature card | Testimonial hook | FAQ answer |
|---|---|---|---|---|
| USP-1 Five screens | Tagline | Features section header | "I stopped scrolling through menus" | "How is this different from a school ERP?" |
| USP-2 Offline-first | Subheadline | Attendance card | "I mark attendance in my basement with no WiFi" | "Does it work without internet?" |
| USP-3 Append-only ledger | Implicit | Fees card | "I finally have a receipt I can show parents" | "Can I edit a fee entry?" |
| USP-4 Backups are yours | Footer | Settings card | "I exported my data when I changed laptops" | "Can I export my data?" |
| USP-5 No telemetry | Footer | Settings card (security) | "My advocate friend reviewed the privacy policy" | "Do you track me?" |

---

## 4. Competitive Landscape

Buddysaradhi does not exist in a vacuum. The visitor has heard of (or uses) at least one of: Zoho, Classplus, Teachmint, or just Google Sheets. The landing page must position Buddysaradhi against these without naming them in the hero (naming competitors in the hero is insecure). The comparison lives in the features section, the FAQ, and the pricing rationale.

### 4.1 The Competitor Set

| Competitor | Category | Price (India, per tutor/mo) | Strength | Weakness |
|---|---|---|---|---|
| **Zoho One** (used as a tuition tool) | Generic SaaS suite | ₹750+/mo (full suite) | 40+ apps, deep integrations | 40+ apps, no tuition-specific flow; setup takes weeks |
| **Classplus** | Coaching-class app | ₹1,200–₹2,500/mo (sales-negotiated) | Strong sales team, parent app, content distribution | Online-first; UI cluttered; data export is hostile; high churn |
| **Teachmint** (free ISM) | Mobile-first ISM | Free (with ads + paid tiers) | Free, mobile-first, widely adopted | Online-only writes; ads in the free tier; data is not portable |
| **Google Sheets + WhatsApp** | DIY stack | Free | Free, infinitely flexible | Fragile; no receipts; no audit trail; wet registers die |
| **School ERP** (Vidyalaya, Fedena, Edmingle) | School ERP | ₹1,500+/mo, often ₹50k+/yr contracts | Multi-role, parent portal, transport | Built for schools, not tutors; UI is government-portal-grade |

### 4.2 The Positioning Matrix

```
                                Simple ←─────────────────────→ Complex
                                       │                       │
                                       │                       │
   Free / Cheap ───────────────────────┤                       │
                                       │   Google Sheets ◉     │
                                       │   Teachmint (free) ◉  │
                                       │                       │
                                       │          Buddysaradhi ◉    │
                                       │                       │
   Paid ───────────────────────────────┤                       │
                                       │                       │
                                       │      Classplus ◉      │
                                       │                       │
                                       │              Zoho ◉   │
                                       │                       │
                                       │        School ERP ◉   │
                                       │                       │
                                       └───────────────────────┘
                                          Offline ←──────────→ Online
```

Buddysaradhi occupies the **simple + offline + affordable** quadrant. No competitor sits there. Google Sheets is simple + free + offline-capable but has no receipts, no audit trail, no app. Teachmint is simple + free but online-only. Classplus is offline-capable (caches) but complex and expensive. The empty quadrant is the positioning.

#### 4.2.1 Market-Landscape Quadrant — Annotated Coverage Map

The previous matrix shows the landscape at a glance. This annotated version is the **canonical quadrant diagram** for PR reviews, sales decks, and press briefings. It follows §20.3 layout rules (annotations point with ↑, accent colours named not hexed, cross-references use canonical IDs).

```
                        Simple ←────────────────────────────────────→ Complex
                                 │                                            │
                                 │                                            │
   Free /          ╔════════════╧════════════════════════════════════════════╧══╗
   Affordable      ║                                                              ║
                   ║   Google Sheets ◉          ← simple, free, no receipts      ║
                   ║   Teachmint (free) ◉       ← simple, free, online-only      ║
                   ║                                                              ║
                   ║   ──────────────  Buddysaradhi ◉  ──────────────                  ║
                   ║                  ↑ the empty quadrant                       ║
                   ║                  ↑ offline + simple + ₹299/mo               ║
                   ║                  ↑ USP-1 (P2), USP-2 (P5), USP-3 (BR-LED-06)║
                   ║                                                              ║
   Paid            ║                                                              ║
                   ║   Classplus ◉              ← offline-cache, complex, ₹1.2k+ ║
                   ║                                                              ║
                   ║                                                  Zoho ◉      ║
                   ║                                                  ← 40+ apps  ║
                   ║                                                              ║
                   ║                                        School ERP ◉          ║
                   ║                                        ← ₹6k+/mo, 12 modules ║
                   ║                                                              ║
                   ╚══════════════════════════════════════════════════════════════╝
                                 │                                            │
                              Offline ←────────────────────────────────────→ Online

   ↑ Vertical axis = price band (Free/Affordable vs Paid). Horizontal = complexity
     (Simple 5-screen doctrine vs Complex 12+-module ERPs). Depth axis (implicit)
     = offline capability — Buddysaradhi is the only product that is simple + offline +
     affordable simultaneously.
   ↑ The empty quadrant is the positioning. No competitor can occupy it without
     re-architecting (USP-1 defensible, USP-2 defensible).
   ↑ Quadrant background = raw cosmic gradient (§2.2 of 13_UI_Guidelines.md), not
     a glass surface — the matrix is a marketing diagram, not a component.
   ↑ Dots = Unicode ◉ (FISHEYE, the same glyph used for emerald status dots per
     §9.4 of 13_UI_Guidelines.md) — colour-coded: Buddysaradhi = emerald, competitors
     = --text-muted (we do not colour competitors in their brand colours).
```

### 4.3 The "Why Not Just Use X?" Objection Map

Every competitive objection maps to a USP. The landing page handles these in the FAQ (`06_FAQ.md §6.1`), but the hero and features sections implicitly answer them.

| Objection | Answer | USP |
|---|---|---|
| "Why not just use Google Sheets? It's free." | "Sheets die in the rain. Buddysaradhi gives you receipts, an audit trail, and works offline." | USP-2, USP-3 |
| "Why not Classplus? They have a parent app." | "Classplus is online-first, costs ₹1,500+/mo, and won't let you export your data. Buddysaradhi works offline, is free for everyone for now (paid tiers ₹299/mo / ₹999/mo launch when our infra bill crosses the §1.6 trigger, but are not shown on the public pricing page in v1), and your data is yours to export." | USP-2, USP-4, USP-1 |
| "Why not Teachmint? It's free." | "Teachmint's free tier has ads and is online-only. Buddysaradhi is ad-free forever on the Free tier, and works offline." | USP-2, USP-5 |
| "Why not Zoho? We already pay for it." | "Zoho does 40 things. You use 3. Buddysaradhi does 5 things, all of them for tutors. You will spend less time configuring and more time teaching." | USP-1 |
| "Why not a school ERP?" | "School ERPs are built for schools, with 200 features for principals. Buddysaradhi is built for tutors, with 5 screens for the person who teaches." | USP-1 |

---

## 5. The Positioning Statement (Geoffrey Moore template)

> **For** private tutors and small coaching institutes in India **who** are trapped between the fragility of WhatsApp-Excel-paper and the bloat of school ERPs, **Buddysaradhi** is **the operating system for tuition** **that** works offline-first, organises every student, fee, and attendance mark into one append-only ledger, and exports to an encrypted backup you control. **Unlike** Classplus, Teachmint, or Zoho, **Buddysaradhi** is built around five screens — not fifty — and refuses to ship telemetry, ads, or data lock-in.

This statement is the **single source of truth** for the page's narrative arc. The hero headline is a compressed version of it. The features section is the proof. The pricing section is the cost. The FAQ is the objection-handling. If any section drifts, return to this statement and re-anchor.

### 5.1 Positioning-Statement Anatomy

The Geoffrey Moore template decomposed into its five load-bearing slots. Each slot is owned by exactly one section of the marketing surface; no slot is shared.

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  FOR     │  private tutors and small coaching institutes in India         │
  │          │  ↑ owned by 01_Product_Positioning.md §2 (personas)            │
  │          │  ↑ verified by Riya (Nagpur), Kabir (Indore), Ananya (Bangalore)│
  ├──────────┼─────────────────────────────────────────────────────────────────┤
  │  WHO     │  are trapped between the fragility of WhatsApp-Excel-paper     │
  │          │  and the bloat of school ERPs                                  │
  │          │  ↑ owned by 01_Product_Positioning.md §4.3 (objection map)     │
  │          │  ↑ answered in 06_FAQ.md §6.1 Q2 (vs school ERP)               │
  ├──────────┼─────────────────────────────────────────────────────────────────┤
  │  Buddysaradhi │  IS the operating system for tuition                          │
  │          │  ↑ owned by 01_Product_Positioning.md §1 (one-sentence VP)     │
  │          │  ↑ surfaces in hero eyebrow + wordmark (02_Hero §6)             │
  ├──────────┼─────────────────────────────────────────────────────────────────┤
  │  THAT    │  works offline-first, organises every student, fee, and        │
  │          │  attendance mark into one append-only ledger, and exports to   │
  │          │  an encrypted backup you control                              │
  │          │  ↑ owned by 03_Features_Showcase.md §2–§3 (5 screens + 7       │
  │          │    engines) and 09_Backup_and_Import_Export.md (BACKUP-1)      │
  │          │  ↑ USP-2 (P5 offline-first), USP-3 (BR-LED-06 ledger),         │
  │          │    USP-4 (P10 backups are yours)                               │
  ├──────────┼─────────────────────────────────────────────────────────────────┤
  │  UNLIKE  │  Classplus, Teachmint, or Zoho, Buddysaradhi is built around five   │
  │          │  screens — not fifty — and refuses to ship telemetry, ads, or  │
  │          │  data lock-in                                                 │
  │          │  ↑ owned by 03_Features_Showcase.md §5 (comparison table)      │
  │          │  ↑ USP-1 (P2 five screens), USP-5 (Rule 3 TELE-1 no telemetry) │
  └──────────┴─────────────────────────────────────────────────────────────────┘

   ↑ Each slot maps to exactly one product/ file (the WHAT) and is consumed
     by exactly one web/07 §X section (the HOW).
   ↑ If a piece of copy on the live page cannot be traced back to one of these
     five slots, the copy is off-brand (AGENTS.md §0.2 no-orphan-copy rule).
   ↑ The "UNLIKE" slot is the only one that names competitors — and only in
     the comparison table (03_Features_Showcase.md §5), never in the hero.
   ↑ The diagram itself is a flat tinted bg-white/[0.04] panel — NOT a glass
     surface, NOT a neumorphic control (§5.3 no-glass-on-glass rule).
```

---

## 6. Brand Voice & Tone

### 6.1 The Voice in One Sentence

> **Confident, warm, jargon-free, India-first English — like a senior product marketer who actually tutors on weekends.**

### 6.2 Voice Pillars

1. **Confident, not boastful.** "Buddysaradhi is the operating system for tuition." Not "we believe Buddysaradhi could be the operating system for tuition, maybe." But also not "Buddysaradhi is the #1 best tuition management software in India!!1!" Confidence is declarative; boasting is superlative.
2. **Warm, not chummy.** "We built this because the maths teacher in Nagpur we know was drowning in Excel." Not "hey tutor bestie, let's crush those fees together 💪." Warm is human; chummy is performative.
3. **Jargon-free, not dumbed-down.** "Append-only ledger" is allowed because it is a precise term and we define it in the FAQ. "AI-powered hyper-automation" is forbidden because it means nothing. The visitor is a tutor, not an idiot — but they are also not a software engineer.
4. **India-first, not India-exclusive.** Examples use Indian names (Riya, Kabir, Ananya), Indian cities (Nagpur, Indore, Bangalore), Indian classes (Class 10 CBSE, ICSE, NEET, JEE), Indian money (₹1,24,500 not ₹124,500, `Intl.NumberFormat('en-IN')`). But the copy does not say "only for India." A tutor in Dubai reading the page should think "this works for me too, with UPI replaced by card."
5. **Specific, not generic.** "Mark 38 students present in 20 seconds" is specific. "Save time on attendance" is generic. Specific beats generic every time.

### 6.3 Tone Calibration by Section

| Section | Tone | Example |
|---|---|---|
| Hero | Confident, declarative, warm | "Five screens. Seven engines. One ledger. Zero servers." |
| Features | Specific, demonstrative, jargon-defined | "Tap once per student. The ledger writes itself." |
| Pricing | Direct, no haggling, no asterisks | "Free for everyone, for now. Pro ₹299/mo, Institute ₹999/mo launch on the §1.6 trigger (internal-only until then). No card required." |
| FAQ | Patient, specific, never condescending | "Yes — your data is yours. Export it as an encrypted .buddysaradhi file anytime." |
| Testimonials | Verbatim, lightly edited for clarity only | "I cut my admin time from 3 hours to 20 minutes a week." — Priya, Pune |
| Download hub | Technical, reassuring, signed | "SHA-256: `a3f2…`. Verify before installing." |
| Footer | Quiet, values-led, no marketing | "Built in India. No telemetry. Your data is yours." |

### 6.4 Words to Use / Words to Avoid

| Use | Avoid | Why |
|---|---|---|
| Tutor | Teacher / Educator / Mentor | The product is named Buddysaradhi. The user is a tutor. |
| Tuition | Coaching / Class / Academy (in copy) | "Tuition" is the Indian-English word for the after-school session. "Coaching" is fine in persona names (Kabir runs a coaching institute) but not in product copy. |
| Fees | Payments / Transactions / Billing | "Fees" is the word the tutor uses. The ledger is a fees ledger. |
| Receipt | Invoice / Bill | Tutors issue receipts, not invoices. Invoices imply GST registration. |
| Append-only ledger | Database / Backend / Sync engine | "Ledger" is the user-facing word. Database is engineering. |
| Offline-first | Works offline / Has offline mode | "Offline-first" implies the architecture. "Works offline" implies it is a feature. |
| Free tier | Free plan / Free trial | The Free tier is forever, not a trial. The word "trial" implies expiry. |
| No card required | No credit card required | In India, debit cards and UPI are primary. "Credit card" is American framing. |
| ₹299/mo | ₹299 per month / ₹299 monthly | `/mo` is compact and matches Indian SaaS convention. |
| Your data is yours | We respect your privacy / Your privacy matters | The first is a claim. The second is a sentiment. |

### 6.5 The "Would I Say This to Riya?" Test

Before any sentence ships on the landing page, the writer must ask: *Would I say this sentence to Riya, the maths tutor in Nagpur, while sitting in her tuition room?* If the answer is no — because the sentence is too marketing-y, too technical, too American, too boastful — the sentence is wrong. Rewrite.

This test is the brand-voice enforcement gate. It is referenced in `AGENTS.md §3` and applied in code review by the copy reviewer.

---

## 7. India-First Market Analysis

### 7.1 Why India First

Buddysaradhi launches in India first because:

1. **Market size.** India has an estimated 70+ million private tutors and 250,000+ coaching institutes (NAS, 2023 estimate). Even 0.1% market share is 70,000 tutors — a healthy SaaS business at ₹299/mo (₹2,50,00,000/mo ARR) once paid tiers launch per the §1.6 trigger. Pre-trigger, market share is captured by the free-for-everyone tier at zero marginal cost to us.
2. **Cost structure.** Our backend infra bill is ₹0/mo today (Vercel Hobby, Turso free, Vercel Blob free, Razorpay UPI-0%). The cost-anchored free model (`05_Pricing_and_Plans.md §1.6`) lets us capture market share at zero marginal cost. When the §1.6 trigger fires, paid tiers launch — at that point we already have a user base to convert.
3. **Pain concentration.** The WhatsApp-Excel-paper stack is the dominant toolchain. There is no incumbent that owns the category. Classplus, Teachmint, and Byju's-owned-white-label have all fragmented without winning.
4. **Price elasticity.** ₹299/mo (when Pro launches) is below the impulse-purchase threshold for a tutor earning ₹50,000+/mo. At ₹999/mo (Institute tier), it is still cheaper than the cheapest school-ERP contract. Pre-trigger, the price is ₹0/mo for everyone — no elasticity calculation needed.
5. **UPI maturity.** UPI is the default payment rail. Razorpay + UPI handles 90% of payment collection without card-network fees eating the margin. This is structural — competitors in the US pay 2.9% + $0.30 per transaction; we pay ~1.99% on UPI and zero on bank transfers.
6. **Smartphone density.** 750M+ smartphone users; 5G roll-out completed in all major cities; sub-₹10,000 Android phones handle the app smoothly. Mobile is the primary surface for most tutors.
7. **Language tailwind.** Indian-English is the de facto business language; we ship English-first with Hindi/Marathi/Tamil/Bengali planned for v2.x. English-first is not a constraint — it is the default in Indian tuition.

### 7.2 The Tier-1 / Tier-2 / Tier-3 Strategy

| Tier | Cities | Strategy |
|---|---|---|
| **Tier-1** | Mumbai, Delhi, Bangalore, Chennai, Hyderabad, Kolkata, Pune | Digital-first acquisition: Google Ads on "tuition management app", YouTube pre-roll, Instagram Reels. Price-insensitive; Institute tier converts. |
| **Tier-2** | Nagpur, Indore, Jaipur, Lucknow, Kochi, Coimbatore, Bhopal, Patna, Surat, Vadodara | Word-of-mouth + WhatsApp groups. Free for everyone, for now — converts to Pro voluntarily when paid tiers launch (§1.6 trigger). Hindi/Marathi localization unlocks conversion. |
| **Tier-3** | All other cities + towns | Offline-first pitch (the "works without WiFi" line is the conversion lever). WhatsApp forward is the growth loop. Free tier forever for most. |

The landing page must read well to a Tier-2 tutor on a 4G connection. That means: fast page load (Lighthouse ≥ 95 — `AGENTS.md §7`), minimal imagery weight (≤ 200 KB hero image), no autoplay video, copy that does not assume fast internet.

### 7.3 The Pricing Parity Argument

India's GDP per capita (nominal) is ~$2,500. The US is ~$80,000. A $20/mo SaaS is 0.1% of a US tutor's monthly income; it is 6% of an Indian tutor's. Pricing must be India-PPP-adjusted. Pre-trigger, the price is ₹0/mo for everyone — PPP is moot. Post-trigger, ₹299/mo is ~$3.60/mo — a 5.5× PPP discount vs a US $20/mo SaaS. This is not charity; it is the price the market clears at. Full rationale in `05_Pricing_and_Plans.md §2`.

---

## 8. Expansion Markets (v2.x and beyond)

The landing page does not sell to these markets yet, but the positioning must not preclude them. A visitor in Dubai, Singapore, São Paulo, or London reading `buddysaradhi.app/` should think "this is built for me, with India as the first market."

The expansion sequence is grouped by region — **MENA → SEA → LATAM → Anglo** — because each cluster shares payment rails, curriculum tags, and a price-sensitivity band. We enter one cluster at a time so that localisation, payment integration, and curriculum tag-sets ship as a unit, not piecemeal.

| Market | Region | When | What changes |
|---|---|---|---|
| **UAE / Gulf (KSA, Qatar, Kuwait)** | MENA | v2.0 | AED/SAR pricing, Arabic UI (RTL), card-primary payment (no UPI), ICSE/CBSE diaspora + British-curriculum tutors, VAT-compliant invoice |
| **Egypt, Jordan, Morocco** | MENA | v2.1 | EGP/JOD/MAD pricing, Arabic UI (RTL), Fawry / cash-on-delivery payment rails, British + national curriculum tags |
| **Singapore** | SEA | v2.2 | SGD pricing, English-only, MOE-aligned curriculum tags, PayNow payment |
| **Indonesia, Philippines, Vietnam** | SEA | v2.3 | IDR/PHP/VND pricing, English-first with Bahasa/Filipino/Vietnamese subtitles, QRIS / GCash / MoMo payment rails, offline-first as primary USP (intermittent 4G) |
| **Brazil** | LATAM | v2.4 | BRL pricing, Portuguese UI, Pix payment (instant, free, ubiquitous — the LATAM analogue of UPI), ENEM/Vestibular curriculum tags |
| **Mexico, Colombia, Argentina** | LATAM | v2.5 | MXN/COP/ARS pricing, Spanish UI, SPEI / PSE payment rails, IB-aligned curriculum tags |
| **UK / Australia** | Anglo | v3.0 | GBP/AUD pricing, GCSE/A-Level/ATAR tags, Stripe payment, English-only |
| **Africa (Nigeria, Kenya)** | Africa | v3.1 | NGN/KES pricing, mobile-money payment (M-Pesa), offline-first as primary USP (infrastructure gap) |
| **US / Canada** | Anglo | v3.2 | USD/CAD pricing, AP/SAT/ACT tags, Stripe + Plaid, English-only |

The hero headline "operating system for private tutors and small coaching institutes" is deliberately geography-free. It works in every market above. The India-first signals (₹ pricing, UPI mention, Indian names in testimonials) are scoped to the India instance of the page; the architecture supports per-region page variants via Next.js's `headers()` + `geo` (see `web/01_Architecture.md §3`).

### 8.1 Why MENA first, then SEA, then LATAM

The MENA cluster goes first because the **UAE/Gulf tutor market is the closest cultural cousin** to India's — large South Asian diaspora, ICSE/CBSE curriculum already in use, English as the business language, and card-primary payments (no UPI re-engineering required, just disable the UPI rail in the checkout). The localisation cost is one RTL pass and one currency formatter.

The SEA cluster goes second because **Pix-style instant-payment rails** (Singapore's PayNow, Indonesia's QRIS, the Philippines' GCash) are mature, ubiquitous, and culturally aligned with UPI's "scan-and-pay" UX. The tutor persona in Jakarta is structurally similar to the tutor persona in Pune — same income bracket relative to national GDP, same mobile-first behaviour, same "I have 5G at home but 0 bars at the tuition centre" offline-first need.

The LATAM cluster goes third because **Brazil's Pix is the global gold standard for instant payment** — launched in 2020, now used by 87% of Brazilian adults. The LATAM tutor persona is structurally similar to the Indian tutor persona (price-sensitive, mobile-first, heavy WhatsApp user, paper-register holdout). The localisation cost is Portuguese/Spanish UI and curriculum tags (ENEM/Vestibular for Brazil, IB for the Spanish-speaking markets).

The Anglo cluster goes last because the US/UK tutor market is **structurally different** — higher willingness-to-pay (we can charge $9/mo not ₹299/mo), but also higher competition (Wyzant, Tutorbird, TeachWorks, Crumb). The Anglo launch is a brand-and-SEO play, not a price play. We do not enter Anglo until we have 5,000+ paying Indian customers as proof-of-PMF.

---

## 9. The "Five Screens" Elevator Pitch (Variants by Audience)

The same core pitch, adapted for who is listening. All three are off-page (spoken or in decks); the landing page itself uses only the visitor-facing variant in §1.

### 9.1 For a tutor (Riya)

> "You know the Excel sheet you copy every month? The paper register that gets wet? The WhatsApp group where parents ask 'fees kab tak?' Buddysaradhi replaces all three with one app. Five screens. Dashboard, Students, Attendance, Fees, Settings. You mark attendance in 20 seconds, you record a fee and a receipt pops up, you export your data anytime. It works without internet — your basement tuition room with no WiFi is fine. Free for everyone, for now — free while our backend infra stays free. Pro ₹299/mo, Institute ₹999/mo launch when we scale (internal-only until then). No card to start."

### 9.2 For an institute owner (Kabir)

> "You pay ₹84,000/yr for a school ERP you use 3% of. Your co-tutors refuse to log in. Your admin spends 6 hours a month reconciling fees. Buddysaradhi replaces that with five screens your co-tutors will actually use, because marking attendance takes 20 seconds not 2 minutes. The fees ledger is append-only — every payment has a receipt, every correction is a void, nothing is silently edited. Multi-tutor, multi-batch. Free for everyone, for now — Institute tier (₹999/mo with a GST invoice) launches when our infra bill crosses the §1.6 trigger. Free to try, no card. Your admin's 6 hours becomes 30 minutes."

### 9.3 For an investor / journalist

> "Buddysaradhi is the operating system for the long tail of Indian tuition — 70 million private tutors and 250,000 coaching institutes, today running on WhatsApp, Excel, and paper. The category is fragmented: Classplus raised $70M and lost the script; Teachmint pivoted; school ERPs are over-built for the segment. We are the offline-first, append-only-ledger, no-telemetry, free-for-everyone-for-now alternative — paid tiers (₹299/mo Pro, ₹999/mo Institute) launch when our backend infra bill crosses the §1.6 trigger. Built for the maths teacher in Nagpur, defensible against the well-funded incumbents because they cannot copy our five-screen doctrine without re-architecting, and they cannot match our free-while-infra-is-free model without re-pricing."

---

## 10. Cross-References

- `00_Vision.md §1.1` (one-sentence pitch), §16 (platforms & distribution), §4.1 (Riya, Kabir), §11 (guiding commitments / design pillars), §8–§9 (lineages).
- `01_Product_Principles.md` P1 (tutor is the user), P2 (five screens), P4 (append-only ledger), P5 (offline-first), P10 (backups are yours), P12 (minutes-per-day), P15 (honest empty states), AP-6 (no indigo/blue), AP-9 (no silent failures), AP-10 (no telemetry).
- `12_Business_Rules.md` BR-LED-06 (append-only ledger), BR-M-01 (integer paise), BR-FEE-* (fees rules), BR-SYN-* (sync rules), BR-SEC-04 (biometric).
- `13_UI_Guidelines.md §1.3` (no indigo/blue), §2 (color tokens), §2.4 (status → accent map).
- `10_Security.md §17` (TELE-1 — no telemetry).
- `09_Backup_and_Import_Export.md` (the .buddysaradhi envelope, BACKUP-1).
- `deployment/02_Vercel_Blob_Build_Storage.md §5` (Vercel Blob manifest schema).
- `web/01_Architecture.md §3` (route groups, per-region variants).
- `mobile/07_App_Store_Release.md` (App Store / Play Store listings, which inherit the tagline).
- `product/02_Hero_and_Above_the_Fold.md` (hero copy is the compressed form of this file).
- `product/05_Pricing_and_Plans.md §2` (India PPP pricing rationale).
- `product/06_FAQ.md §6.1` (competitor objection handling).
- `product/AGENTS.md §3` (brand-voice enforcement gate).

---

## 11. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated, neumorphic controls recipe-annotated, cross-references canonical. Box widths honour §20.3 rule 2 (80–120 for landing-page sections, 60–80 for components). The three mockups below visualise the *positioning* primitives — the market quadrant, the persona card, and the positioning-statement anatomy — that every other file in this directory inherits.

### 11.1 Design System Reference (§5.5 + §6.6 single rule)

This file owns the **positioning layer**, not the marketing surface layer. The mockups below are *conceptual diagrams* (quadrants, persona cards, anatomy tables) — they are not rendered components on the live page. They are governed by `§20.1` (why ASCII art) and `§20.6` (coverage requirement: every spec describes its content with a mockup), but they do **not** carry glass-tier or neumo-recipe annotations because they are not rendered in the UI. The single rule from `§6.6` — *glass for surfaces, neumo for controls, never invert* — applies only to the live-page components that downstream files (`02_Hero`, `03_Features`, `04_Download`, `05_Pricing`, `06_FAQ`, `07_CTA`, `08_Testimonials`) specify; this file's job is to feed those files the personas, the quadrant logic, and the positioning-statement template they consume.

| Positioning artefact (this file) | Live-page consumer | Glass / neumo tier (in consumer) |
|---|---|---|
| §2 Persona card (Riya/Kabir/Ananya) | `product/02 §2.1.1` hero card | `.glass` (hero) |
| §4.2 Positioning matrix | `product/03 §5.1` competitor table | flat tinted table (not glass — table cells are flat) |
| §5 Positioning statement | `product/02 §3` hero headline copy | `.glass` (hero card carries the headline) |
| §3 USP matrix | `product/03 §2.0` feature cards | `.glass` + 2px accent left-border (§5.4) |

### 11.2 Market-Landscape Quadrant (NEW)

The §4.2 positioning matrix rendered as a 2×2 quadrant. The x-axis is **simplicity** (low → high); the y-axis is **offline-first / data-ownership** (low → high). Buddysaradhi occupies the upper-right quadrant alone; every named competitor sits in one of the other three. This is the artefact the §4.3 objection map (`product/06_FAQ.md §6.1`) argues from.

```
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │  MARKET QUADRANT — simplicity × offline-first × data-ownership  (§4.2 matrix)     │
  │                                                                                    │
  │   offline-first +                                                                 │
  │   data-yours   ▲                                                                  │
  │                │                          ┌─────────────────────────────────┐     │
  │                │                          │  ★ Buddysaradhi  (₹0/mo, for now)       │     │
  │                │                          │  — 5 screens, append-only      │     │
  │                │                          │    ledger, no telemetry        │     │
  │                │                          │    (P5, P10, P14, USP-1..5)    │     │
  │                │                          │  → product/02 §1 (hero copy)   │     │
  │                │                          │  → product/05 §1 (pricing)     │     │
  │                │                          └─────────────────────────────────┘     │
  │                │  ┌──────────────┐         (no other player occupies this cell)   │
  │                │  │ Teachmint    │                                                 │
  │                │  │ (free, ads-  │                                                 │
  │                │  │  supported,  │                                                 │
  │                │  │  cloud-only) │                                                 │
  │                │  └──────────────┘                                                 │
  │                │  ┌──────────────┐    ┌─────────────────────────────────┐         │
  │                │  │ Classplus    │    │  Zoho One (₹750+/mo)            │         │
  │                │  │ (₹1,200+/mo, │    │  — powerful but complex;        │         │
  │                │  │  cloud-only, │    │    cloud-first; tutor must      │         │
  │                │  │  bloat)      │    │    configure 40+ modules        │         │
  │                │  └──────────────┘    └─────────────────────────────────┘         │
  │   cloud-only   │  ┌──────────────┐    ┌─────────────────────────────────┐         │
  │   ▼            │  │ School ERPs  │    │  Excel + WhatsApp + paper       │         │
  │                │  │ (₹6,000+/mo, │    │  (₹0, the status quo we         │         │
  │                │  │  over-built, │    │   replace — Riya's today)       │         │
  │                │  │  school-only)│    │                                 │         │
  │                │  └──────────────┘    └─────────────────────────────────┘         │
  │                └──────────────────────────────────────────────────────────────────│
  │                  low simplicity ←────────────────────────────→ high simplicity     │
  │                                                                                    │
  │   ↑ Quadrant logic per §4.2 (3 axes: simple × affordable × offline-first).         │
  │   ↑ Objection map per §4.3; FAQ objections per product/06 §6.1.                    │
  │   ↑ Buddysaradhi price ₹0/mo (pre-trigger, free for everyone); ₹299/mo Pro post-trigger (BR-M-01 integer paise; ₹2,999/yr annual).     │
  │   ↑ Accent colours: emerald (Buddysaradhi), amber (Free+ads risk), flare (over-built), │
  │     cyan (status quo). No indigo, no blue (Rule 5, AP-6, §1.3).                    │
  │   ↑ The quadrant is a CONCEPT DIAGRAM, not a live UI surface — so no glass         │
  │     tier annotation here (§6.6 single rule applies to live components only).       │
  └──────────────────────────────────────────────────────────────────────────────────┘
```

### 11.3 Persona Card — Three-Up Layout (NEW)

The §2.5 persona-card three-up layout, rendered as the live marketing surface WILL render it (a `.glass-faint` band of three persona cards on the cosmic canvas). Riya (primary, emerald accent), Kabir (secondary, cyan accent), Ananya (tertiary, violet accent — do-not-over-fit per §2.3). This mockup is the bridge from positioning (this file) to surface (`product/02 §2.1.1`, `product/08 §2.3`).

```
  THREE-UP PERSONA STRIP  (rendered on /, anchored to §2.1–§2.3 of this file)
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │  .glass-faint band — recedes so the persona names carry the eye  (§5.2, §5.5)    │
  │                                                                                    │
  │  ╭────────────────────╮   ╭────────────────────╮   ╭────────────────────╮         │
  │  │▌ ●  Riya Sharma    │   │▌ ●  Kabir Mehta    │   │▌ ●  Ananya Iyer    │         │
  │  │▌     Nagpur        │   │▌     Indore        │   │▌     Bangalore     │         │
  │  │▌                   │   │▌                   │   │▌                   │         │
  │  │▌  Private tutor    │   │▌  Institute owner  │   │▌  Freelance edu    │         │
  │  │▌  38 students      │   │▌  120 students,    │   │▌  12 students,     │         │
  │  │▌  Class 10 CBSE    │   │▌  3 co-tutors,     │   │▌  NEET Biology,    │         │
  │  │▌  Maths, 6pm batch │   │▌  GST-registered   │   │▌  online + offline │         │
  │  │▌                   │   │▌                   │   │▌                   │         │
  │  │▌  → ₹0/mo Free        │   │▌  → ₹999/mo Inst.  │   │▌  → ₹0/mo Free       │         │
  │  ╰────────────────────╯   ╰────────────────────╯   ╰────────────────────╯         │
  │   ↑ emerald accent        ↑ cyan accent            ↑ violet accent                │
  │   ↑ primary persona       ↑ secondary persona      ↑ tertiary (do-not-over-fit)   │
  │   ↑ P1 (tutor is user)    ↑ P12 (minutes/day)      ↑ §2.3 anti-targets guard      │
  │   ↑ 2px accent left-      ↑ 2px accent left-       ↑ 2px accent left-border (§5.4)│
  │     border (§5.4)           border (§5.4)                                           │
  │   ↑ .glass-faint: 2% white + 8px blur (§5.2) — recedes so names carry the eye    │
  │   ↑ No CTA on persona cards — they are content surfaces, not controls (§6.6)      │
  │   ↑ Mobile (≤768px): stack 1×3, accent left-border preserved, 44px tap on name    │
  │     opens the relevant testimonial (product/08 §2.1) — the deep-link is the CTA   │
  └──────────────────────────────────────────────────────────────────────────────────┘
   ↑ India-first voice preserved: Nagpur / Indore / Bangalore, CBSE / NEET, ₹299/999/0.
   ↑ All accent colours named (no hex) per §20.3 rule 6; WCAG 2.1 AA on cosmic canvas.
```

### 11.4 Positioning-Statement Anatomy (NEW)

The §5 Geoffrey Moore template rendered as an annotated anatomy table. Each slot (`For`, `Who`, `IS`, `That`, `Unlike`) maps to a downstream file's first sentence. This is the artefact the hero subheadline compresses (`product/02 §4`) and the FAQ objection-handling argues from (`product/06 §6.1`).

```
  POSITIONING-STATEMENT ANATOMY  (Geoffrey Moore template, §5)
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │  For        │  private tutors and small coaching institutes in India              │
  │             │  ↑ §2.1 (Riya, Nagpur), §2.2 (Kabir, Indore)                       │
  │             │  ↑ P1 — the tutor is the user (not the student, not the parent)    │
  ├─────────────┼─────────────────────────────────────────────────────────────────── │
  │  Who        │  juggle WhatsApp, Excel, and a paper register every month, lose    │
  │             │  receipts to the monsoon, and have no software that respects       │
  │             │  their offline-first workflow                                     │
  │             │  ↑ §4.1 (the competitor set); §4.3 (the objection map)            │
  │             │  ↑ P5 — offline-first, always                                     │
  ├─────────────┼─────────────────────────────────────────────────────────────────── │
  │  IS         │  Buddysaradhi — the operating system with five screens, seven engines,  │
  │             │  one append-only ledger, and zero servers to manage               │
  │             │  ↑ §1 (the one-sentence value proposition)                        │
  │             │  ↑ P2 (five screens), P4 (append-only ledger), USP-1..5 (§3)      │
  ├─────────────┼─────────────────────────────────────────────────────────────────── │
  │  That        │  works offline, keeps backups as the tutor's encrypted property,  │
  │             │  and never sends telemetry or PII to a third party                │
  │             │  ↑ P5 (offline-first), P10 (backups are yours), AP-10 (no tel.)   │
  │             │  ↑ USP-2, USP-4, USP-5 (§3.2, §3.4, §3.5)                         │
  ├─────────────┼─────────────────────────────────────────────────────────────────── │
  │  Unlike     │  Classplus (₹1,200+/mo, cloud-only, bloat), Zoho One (₹750+/mo,   │
  │             │  40+ modules, configuration tax), and the school-ERP category      │
  │             │  (₹6,000+/mo, over-built for a single tutor) —                    │
  │             │  Buddysaradhi is free for everyone, for now (₹0/mo, pre-trigger) —      │
  │             │  Pro ₹299/mo, Institute ₹999/mo launch on the §1.6 trigger (Appendix A)  │
  │             │  ↑ §4.2 (the positioning matrix); §4.3 (the objection map)        │
  │             │  ↑ BR-M-01 (integer paise); Rule 5 (no indigo/blue); AP-6         │
  └──────────────────────────────────────────────────────────────────────────────────┘
   ↑ Every slot maps to a sentence in a downstream product/ file — this is the
     WHAT that product/02..09 consume as their first paragraph.
   ↑ ₹0/mo is the pre-trigger public price (free for everyone, for now); ₹299/mo Pro and
     ₹999/mo Institute are post-trigger prices (Appendix A) — internal-only until §1.6 fires.
   ↑ Annual pricing ₹2,999/yr and ₹9,999/yr per product/05 §1 (10× monthly).
   ↑ The anatomy is a CONCEPT DIAGRAM, not a live UI surface — no glass tier
     annotation; the hero card that renders the compressed form IS .glass
     (product/02 §2.1.1).
```

### 11.5 References (External Design Authorities)

The mockups and the positioning primitives in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the quadrant logic, the persona card layout, or the positioning-statement template.

- **Geoffrey Moore** — *Crossing the Chasm* (1991, revised 2014). The §5 anatomy (§11.4 mockup) is Moore's canonical `For / Who / IS / That / Unlike` form, used verbatim.
- **Nielsen Norman Group** — *Persona Creation Toolkit* and *User Segmentation for SaaS*. The §11.3 three-up persona strip follows NN/g's guidance on primary/secondary/tertiary-do-not-over-fit segmentation.
- **Baymard Institute** — *SaaS Pricing Page UX* and *Competitor Comparison Tables*. The §11.2 quadrant logic (simple × affordable × offline-first) is Baymard-anchored.
- **Smashing Magazine** — *India-PPP SaaS Pricing* and *Tier-2/Tier-3 Market Strategy*. The §11.3 Indian cities (Nagpur/Indore/Bangalore) and ₹299/999/0 tier mapping follow Smashing's India-PPP research.
- **Apple Human Interface Guidelines** — *Marketing Surfaces* and *Avoiding Cliché in Product Voice*. The §11.3 accent discipline (one accent per persona) follows Apple HIG's marketing-surface guidance.
- **A List Apart** — *Content Strategy for the Web*. The §11.4 anatomy-to-downstream-file mapping (each slot feeds a downstream file's first sentence) follows ALA's content-strategy-first doctrine.
- **Google Search Central** — *Person Schema (JSON-LD)*. The §11.3 persona-card structure aligns with the `Person` schema variant used in `product/09 §4` for founder-markup.

---

## References

The positioning framework in this file draws on the following public bodies of practice. Cite them when a contributor challenges the persona definitions, the quadrant logic, or the Geoffrey Moore template.

- **Geoffrey Moore** — *Crossing the Chasm* (1991, revised 2014). The §5 positioning-statement template (`For / Who / IS / That / Unlike`) is Moore's canonical form, used verbatim.
- **Nielsen Norman Group** — *Persona Creation Toolkit* and *User Segmentation for SaaS*. The three-persona split (primary / secondary / tertiary-do-not-over-fit) in §2 follows NN/g's recommendation against over-segmenting early-stage SaaS.
- **Baymard Institute** — *SaaS Pricing Page UX* and *Competitor Comparison Tables*. The §4.2 quadrant logic (simple × affordable × offline) and the §4.3 objection map are Baymard-anchored.
- **A List Apart** — *Content Strategy for the Web* and *India-First Voice in Product Copy*. The §6 brand-voice pillars (confident, warm, jargon-free, India-first) and the §6.5 "Would I Say This to Riya?" test are ALA-anchored.
- **Apple Human Interface Guidelines** — *Marketing Surfaces* and *Avoiding Cliché in Product Voice*. The §6.4 "words to use / words to avoid" table follows Apple's HIG guidance on avoiding boastful or jargon-laden copy.
- **Smashing Magazine** — *India-PPP SaaS Pricing* and *Tier-2/Tier-3 Market Strategy*. The §7.2 Tier-1/Tier-2/Tier-3 city strategy is Smashing-anchored, calibrated to Indian tuition-market research.

---

*This file is the positioning constitution. If a piece of copy on the live page cannot be traced to a sentence here, the copy is off-brand. Fix the copy first; do not amend this file to match the copy. The order matters.*
