# 03 — Features Showcase

> The features section is the **proof** that the hero's promise is real. The hero says "five screens, seven engines, one ledger"; this section shows what those five screens look like, what the seven engines do, and why the ledger matters. It is the longest section on the page (it owns the visitor's scroll from ~150% to ~400% viewport depth) and it is the section that converts **interest into desire** (`README.md §3` funnel step 3). Every feature card is a small argument: *this is the screen you will use, this is what it does, this is why it is better than the spreadsheet you are using today.*

---

## 1. The Apple-Keynote Pacing Rule

The features section is paced like an Apple keynote. The rule:

> **One big idea per scroll.**

A visitor scrolling at normal speed (≈ 600px/sec) should encounter exactly one new concept every scroll-length. Concepts do not stack two-deep in a single viewport. If two feature cards are visible at once, they are visually grouped (e.g., the 7-engine grid is 4+3, but the visitor reads it as one concept: "the engines under the hood"). The pacing rule prevents cognitive overload — a tutor scrolling this page on a phone in a 5-minute break between batches cannot absorb three ideas at once.

### 1.1 The Pacing Map

```
Scroll % │  Section
─────────┼─────────────────────────────────────────────────────────
  0%     │  HERO (handled by 02_Hero)
  150%   │  ── FADE-IN: "Five screens. Here they are." (section title)
  180%   │  Screen 1 — Dashboard (full-width feature card)
  260%   │  Screen 2 — Students (full-width feature card, reversed)
  340%   │  Screen 3 — Attendance (full-width feature card)
  420%   │  Screen 4 — Fees & Payments (full-width feature card, reversed)
  500%   │  Screen 5 — Settings (full-width feature card)
  580%   │  ── FADE-IN: "Under the hood: seven engines."
  620%   │  7-engine grid (4 + 3 layout)
  720%   │  ── FADE-IN: "How we compare."
  760%   │  Competitor comparison table
  880%   │  ── FADE-IN: "See it live." (interactive demo CTA)
  920%   │  "See it live" deep-link card
 1000%   │  ── EXIT TO: 04_Download_Hub / 05_Pricing
```

The scroll percentages are not exact — they are guidance for the writer and the implementer. The implementer (`web/07_Landing_Page.md §5`) uses Intersection Observer to trigger fade-ins at the right moments; the writer (this file) ensures each section's content is single-idea.

### 1.2 The Reversed-Card Pattern

Feature cards alternate between left-image / right-text and left-text / right-image. This is the **reversed-card pattern**. It creates visual rhythm on long scrolls and prevents the "wall of identical cards" fatigue that kills feature sections on competitor sites. The pattern: Dashboard (image right), Students (image left), Attendance (image right), Fees (image left), Settings (image right).

---

## 2. The Five-Screen Feature Cards

Each of the five screens gets a **full-width feature card** (the only place on the page where a single concept owns a full viewport). The card structure is identical for all five:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ┌────────────────────────────┐  ┌────────────────────────────────────┐  │
│  │ LEFT (cols 1-6)            │  │ RIGHT (cols 7-12)                  │  │
│  │                            │  │                                    │  │
│  │  ▸ Eyebrow (caption, accent│  │  ┌──────────────────────────────┐  │  │
│  │    per screen)             │  │  │                              │  │  │
│  │                            │  │  │  Screenshot of the screen    │  │  │
│  │  ▸ H2 (h2, 32/40)          │  │  │  (real, from preview deploy, │  │  │
│  │    "Dashboard"             │  │  │   AVIF, ≤ 120 KB)            │  │  │
│  │                            │  │  │                              │  │  │
│  │  ▸ Lead paragraph          │  │  │                              │  │  │
│  │    (body-lg, 18/28, 2 ln)  │  │  └──────────────────────────────┘  │  │
│  │                            │  │                                    │  │
│  │  ▸ 3 bullet benefits       │  │  ▸ "See it live →" deep-link       │  │
│  │    (body, 16/24, each      │  │    (cyan, ghost link)              │  │
│  │    with accent-coloured    │  │                                    │  │
│  │    icon)                   │  │                                    │  │
│  │                            │  │                                    │  │
│  │  ▸ "See it live →" CTA     │  │                                    │  │
│  │    (emerald, ghost button) │  │                                    │  │
│  └────────────────────────────┘  └────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

The reversed card swaps left and right. The bullets are always under the text, the deep-link is always under the image.

### 2.0 Six-Card Features Grid — Compact Summary (Desktop 3×2 + Mobile 1×6)

In addition to the five full-width alternating cards above, the features section opens with a **compact 6-card summary grid** that gives the visitor a bird's-eye view of all five screens plus a sixth "See it in the app" CTA card. The summary grid is the section's **first viewport** — it loads above the alternating cards and serves as the "table of contents" the visitor uses to decide which full-width card to scroll to.

Each card uses the workhorse `.glass` tier (5% white, 24px blur) per §5.5 of `13_UI_Guidelines.md`, with a 2px accent left-border per §5.4 to colour-code the screen's primary accent (matching the in-app accent map, §2.4 of `13_UI_Guidelines.md`). The sixth card is the "See it in the app" deep-link CTA card (emerald accent, the highest-converting CTA on the page after the hero primary, `07_CTA_and_Conversion.md §4`).

```
  DESKTOP 3×2 SUMMARY GRID  (cols 1–4 · 5–8 · 9–12 of the 12-col grid, §4.2)

  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
  │▌ ◉ DASHBOARD             │  │▌ ◉ STUDENTS              │  │▌ ◉ ATTENDANCE            │
  │▌ emerald left-border     │  │▌ cyan left-border        │  │▌ cyan left-border        │
  │▌                         │  │▌                         │  │▌                         │
  │▌ Today at a glance —     │  │▌ Every student, one tap  │  │▌ 38 students, 20 seconds.│
  │▌ batches, attendance,    │  │▌ away. Smart search,     │  │▌ One-tap marking,       │
  │▌ fees collected.         │  │▌ timeline, bulk import.  │  │▌ 24-hour lock, offline.  │
  │▌                         │  │▌                         │  │▌                         │
  │▌ See it in the app →     │  │▌ See it in the app →     │  │▌ See it in the app →     │
  └─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
  │▌ ◉ FEES & PAYMENTS       │  │▌ ◉ SETTINGS              │  │▌ ◉ SEE IT IN THE APP     │
  │▌ emerald left-border     │  │▌ violet left-border      │  │▌ emerald left-border +   │
  │▌                         │  │▌                         │  │▌   emerald glow ring     │
  │▌ Every fee. Every        │  │▌ Your data, your rules.  │  │▌                         │
  │▌ receipt. One ledger.    │  │▌ Encrypted backup,       │  │▌ Skip the carousel —     │
  │▌ Append-only, void with  │  │▌ biometric, reminders.   │  │▌ open the live demo and  │
  │▌ reason, hash-chained.   │  │▌                         │  │▌ tap through all 5.      │
  │▌                         │  │▌                         │  │▌                         │
  │▌ See it in the app →     │  │▌ See it in the app →     │  │▌ Open the demo →         │
  └─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
   ↑ All 6 cards: .glass (5% white, 24px blur, §5.5) + 2px accent left-border (§5.4)
   ↑ 6th card (CTA): .glass → .glass-strong on hover + emerald glow ring (§5.4
     inner glow at 15% opacity) — it is the "summary" CTA, distinct from the
     5 screen CTAs.
   ↑ Card padding p-6 (24px), gap-4 between cards (§4.4 of 13_UI_Guidelines.md)
   ↑ Each "See it in the app →" deep-link is a cyan ghost link, 44×44px touch
     target (§10.2), pointing to https://app.buddysaradhi.app/{screen} (§7.1 below)
   ↑ The 6th card's "Open the demo →" CTA is a neumo-raised emerald-glow
     button (§6.6, §8.2) — same recipe as the hero primary CTA.
   ↑ Card 1 = Dashboard (emerald, USP-1 P2 five screens)
   ↑ Card 2 = Students (cyan, USP-1 info focus)
   ↑ Card 3 = Attendance (cyan, USP-2 P5 offline-first)
   ↑ Card 4 = Fees (emerald, USP-3 BR-LED-06 append-only ledger)
   ↑ Card 5 = Settings (violet, USP-4 P10 backups + USP-5 TELE-1 no telemetry)
   ↑ Card 6 = Demo CTA (emerald + glow, the section's aggregate CTA)

  MOBILE 1×6 STACK  (cols 1–12, full-width, §4.2 base breakpoint)

  ┌──────────────────────────────────┐
  │▌ ◉ DASHBOARD                      │  ← card 1, emerald left-border
  │▌ Today at a glance.              │
  │▌ See it in the app →             │
  └──────────────────────────────────┘
  ┌──────────────────────────────────┐
  │▌ ◉ STUDENTS                       │  ← card 2, cyan left-border
  │▌ Every student, one tap away.    │
  │▌ See it in the app →             │
  └──────────────────────────────────┘
  ┌──────────────────────────────────┐
  │▌ ◉ ATTENDANCE                     │  ← card 3, cyan left-border
  │▌ 38 students, 20 seconds.        │
  │▌ See it in the app →             │
  └──────────────────────────────────┘
  ┌──────────────────────────────────┐
  │▌ ◉ FEES & PAYMENTS                │  ← card 4, emerald left-border
  │▌ Every fee. Every receipt.       │
  │▌ See it in the app →             │
  └──────────────────────────────────┘
  ┌──────────────────────────────────┐
  │▌ ◉ SETTINGS                       │  ← card 5, violet left-border
  │▌ Your data, your rules.          │
  │▌ See it in the app →             │
  └──────────────────────────────────┘
  ┌──────────────────────────────────┐
  │▌ ◉ SEE IT IN THE APP              │  ← card 6, emerald + glow
  │▌ Skip the carousel.              │
  │▌ [Open the demo →]  ← neumo-     │
  │▌                     raised CTA  │
  └──────────────────────────────────┘
   ↑ All 6 cards stack vertically, space-6 (24px) between cards
   ↑ Each card is full-width minus 32px gutters, .glass + 2px accent border
   ↑ The 6th card's CTA is full-width neumo-raised with emerald glow (§6.6)
   ↑ Scroll length: ~6 cards × ~140px = ~840px ≈ 1.5 viewports on a Pixel 7
```

The 6-card summary grid is the **first** thing a visitor sees when they scroll into the features section. It anchors their mental model ("five screens + a demo CTA") before the full-width alternating cards unpack each screen. The full-width cards remain the deeper-proof surface; the summary grid is the index.

### 2.1 Screen 1 — Dashboard

**Eyebrow.** `◉ THE FIRST SCREEN YOU SEE` (accent: emerald)
**Headline.** `Dashboard`
**Lead.** `Open Buddysaradhi and the dashboard answers three questions: how much did I collect this month, how many students showed up this week, and what's on today. No menus. No setup. Just answers.`
**Bullets.**
- `◉ Today at a glance — batches, attendance, fees collected.` (emerald)
- `◉ Monthly KPIs — ₹1,24,500 collected, 33/38 present, 3 upcoming dues.` (emerald)
- `◉ Sparkline trend — last 12 weeks, one look.` (emerald)
**"See it live" link.** `/dashboard` (requires signup; visitors who click are redirected to `/signup?next=/dashboard`).
**Screenshot.** A real screenshot of `/dashboard` from the latest Vercel preview deployment, showing 38 students, ₹1,24,500 collected, and 3 batches for today. AVIF, 16:10, ≤ 120 KB.
**Deep-link target.** `https://app.buddysaradhi.app/dashboard` (the live app). A visitor who clicks the deep-link without an account hits the auth gate (`web/03_Auth_and_Provisioning.md`); the `?next=/dashboard` param returns them to the dashboard after signup.

### 2.2 Screen 2 — Students

**Eyebrow.** `◉ EVERY STUDENT, ONE TAP AWAY` (accent: cyan)
**Headline.** `Students`
**Lead.** `A searchable, sortable list of every student you teach — across batches, across years. Tap once to mark attendance. Tap once to record a fee. Tap once to see their full history.`
**Bullets.**
- `◉ Smart search — name, phone, parent, batch, any field.` (cyan)
- `◉ Per-student timeline — attendance, fees, notes, all in one view.` (cyan)
- `◉ Bulk import — CSV from your existing sheet, 100 students in 30 seconds.` (cyan)
**"See it live" link.** `/students`
**Screenshot.** A real screenshot of `/students` showing 38 students in a searchable list, with one student expanded to show their timeline.
**Cross-reference.** `05_Students.md` (full screen spec). Bulk import: `09_Backup_and_Import_Export.md §BR-IMP-04`.

### 2.3 Screen 3 — Attendance

**Eyebrow.** `◉ 38 STUDENTS, 20 SECONDS` (accent: cyan)
**Headline.** `Attendance`
**Lead.** `Tap once per student. Present, absent, late, excused. The ledger writes itself. Locked after 24 hours — your records are tamper-evident. Works without internet.`
**Bullets.**
- `◉ One-tap marking — present, absent, late, excused.` (cyan)
- `◉ 24-hour lock — no silent edits after the window closes.` (cyan)
- `◉ Offline-first — mark in a basement with no WiFi, sync when you're back.` (cyan)
**"See it live" link.** `/attendance`
**Screenshot.** A real screenshot of `/attendance` showing a batch of 12 students, 11 marked present and 1 absent, with the "lock in 18h 42m" countdown visible.
**Cross-reference.** `06_Attendance.md`, `12_Business_Rules.md §BR-ATT-07` (24-hour lock), `01_Product_Principles.md P5` (offline-first).

### 2.4 Screen 4 — Fees & Payments

**Eyebrow.** `◉ EVERY FEE. EVERY RECEIPT. ONE LEDGER.` (accent: emerald)
**Headline.** `Fees & Payments`
**Lead.** `Record a payment, get a receipt with a tamper-evident hash. Void a wrong entry, the ledger keeps the audit trail. Export a month's collection in one click. No spreadsheet ever again.`
**Bullets.**
- `◉ Append-only ledger — payments are recorded, never silently edited.` (emerald)
- `◉ Receipts with hashes — screenshot, forward on WhatsApp, prove it was paid.` (emerald)
- `◉ Void with reason — corrections are auditable, not hidden.` (emerald)
**"See it live" link.** `/fees`
**Screenshot.** A real screenshot of `/fees` showing the ledger with 8 recent entries, one VOID entry highlighted, and the "Record payment" sheet open on a single student.
**Cross-reference.** `07_Fees_and_Payments.md`, `12_Business_Rules.md §BR-LED-06` (append-only), `12_Business_Rules.md §BR-FEE-04` (receipt hash).

### 2.5 Screen 5 — Settings

**Eyebrow.** `◉ YOUR DATA, YOUR RULES` (accent: violet)
**Headline.** `Settings`
**Lead.** `Configure batches, fee structures, academic year. Export an encrypted backup to a pen drive. Restore on a new device. Toggle biometric login. Change your reminder cadence. Everything in one place.`
**Bullets.**
- `◉ Encrypted backup — AES-256-GCM, Argon2id password, .buddysaradhi file.` (violet)
- `◉ Biometric login — fingerprint or Face ID, never a password to forget.` (violet)
- `◉ Reminder cadence — daily, weekly, or "leave me alone."` (violet)
**"See it live" link.** `/settings`
**Screenshot.** A real screenshot of `/settings` showing the Backup section with the "Export .buddysaradhi file" button and the Biometric toggle on.
**Cross-reference.** `08_Settings.md`, `09_Backup_and_Import_Export.md` (BACKUP-1, BACKUP-2), `12_Business_Rules.md §BR-SEC-04` (biometric).

### 2.6 The Accent Map for the Five Screens

The accent per screen mirrors the in-app accent map (`13_UI_Guidelines.md §2.4`, `web/01_Architecture.md §5`):

| Screen | Accent | Hex | Why |
|---|---|---|---|
| Dashboard | Emerald | `#00FF9D` | Primary surface, "today's numbers" success colour |
| Students | Cyan | `#00F0FF` | Information / focus / searchable data |
| Attendance | Cyan | `#00F0FF` | Information / focus / present-marking |
| Fees & Payments | Emerald | `#00FF9D` | Money in = success/positive |
| Settings | Violet | `#B388FF` | Configuration / less-frequent / neutral-informational |

No screen uses Amber or Flare as its primary accent. Amber and Flare are reserved for state (partial, overdue, void, error) within screens, not as screen-level branding. The "no indigo/blue" rule (`13_UI_Guidelines.md §1.3`) is enforced by CSS lint.

---

## 3. The Seven Hidden Engines

After the five screen cards, a section break: the headline "Under the hood: seven engines." and a 4+3 grid of compact engine cards. These are the **non-screen** systems that make the five screens work. The visitor does not interact with them directly — but knowing they exist builds trust ("this is not a spreadsheet wrapper, this is engineered").

### 3.1 The Engine Grid Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ── UNDER THE HOOD: SEVEN ENGINES.                                       │
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌──────┐│
│  │ 1. Search       │  │ 2. Reminder     │  │ 3. Ledger       │  │ 4.   ││
│  │                 │  │                 │  │                 │  │ Repor││
│  │ Type a name,    │  │ "Fees due       │  │ Append-only,    │  │ t    ││
│  │ phone, batch —  │  │ tomorrow" push  │  │ hash-chained,   │  │      ││
│  │ any field,      │  │ at 7 AM.        │  │ auditable.      │  │ PDF, ││
│  │ instant.        │  │                 │  │                 │  │ CSV, ││
│  │                 │  │                 │  │                 │  │ or   ││
│  │ [Read spec →]   │  │ [Read spec →]   │  │ [Read spec →]   │  │ prin ││
│  │                 │  │                 │  │                 │  │ t.   ││
│  │                 │  │                 │  │                 │  │      ││
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  └──────┘│
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
│  │ 5. Notification │  │ 6. Sync         │  │ 7. Security     │          │
│  │                 │  │                 │  │                 │          │
│  │ Local-first,    │  │ 30-second HTTP  │  │ Biometric at    │          │
│  │ no server push  │  │ polling,        │  │ rest, AES-256   │          │
│  │ required.       │  │ LWW merge,      │  │ at motion, no   │          │
│  │                 │  │ conflict-       │  │ telemetry, no   │          │
│  │                 │  │ immune ledger.  │  │ third-party     │          │
│  │                 │  │                 │  │ APIs that see   │          │
│  │                 │  │                 │  │ PII.            │          │
│  │ [Read spec →]   │  │ [Read spec →]   │  │ [Read spec →]   │          │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘          │
└──────────────────────────────────────────────────────────────────────────┘
```

Each card is `--surface-glass` with a 1px `--border-glass` edge, 24px padding, 12px radius. The engine number is in `caption` style, accent-coloured; the engine name is `h3` (20/28, 600 weight); the description is `body-md` (14/20, `--text-secondary`); the "Read spec →" link is a cyan ghost link to the relevant top-level spec.

### 3.2 The Seven Engines (with spec cross-references)

| # | Engine | One-line description | Spec |
|---|---|---|---|
| 1 | Search | Indexed search across students, batches, ledger entries — any field, sub-50ms. | `02_Core_Logic.md §4` |
| 2 | Reminder | Local push notifications for fees-due-tomorrow, attendance-not-marked, low-balance. Cadence configurable. | `12_Business_Rules.md §BR-REM-01..09` |
| 3 | Ledger | Append-only, hash-chained fees ledger. VOIDs not edits. Tamper-evident. | `12_Business_Rules.md §BR-LED-06`, `02_Core_Logic.md §6` |
| 4 | Report | One-click PDF/CSV exports — monthly collection, attendance summary, student history. | `12_Business_Rules.md §BR-RPT-04/05/08` |
| 5 | Notification | Local notifications only, no server push. Privacy-preserving by design. | `10_Security.md §16` |
| 6 | Sync | 30-second libSQL HTTP polling, last-write-wins for non-ledger, append-only for ledger, conflict-aware. | `12_Business_Rules.md §BR-SYN-01..09`, `web/02_State_and_Data_Flow.md §4` |
| 7 | Security | Biometric at rest, AES-256-GCM backups, Argon2id password derivation, no telemetry, no third-party APIs that see PII. | `10_Security.md` (full file) |

### 3.3 The Engine-Card Copy Rule

Each engine card's description is **one sentence, no jargon undefined.** "LWW merge" is jargon — but it is defined in the spec it links to, and the visitor who clicks "Read spec →" gets the definition. The visitor who does not click still reads "conflict-immune ledger" and understands the intent. The copywriter's job is to make the one-sentence description work for both audiences.

---

## 4. Interactive Demo Embed

Below the seven-engine grid, an interactive demo embed. This is the visitor's chance to **try before signup** — a constrained, read-only sandbox of the Dashboard.

### 4.1 What the Demo Is

The demo is an `<iframe>` pointed at `https://app.buddysaradhi.app/demo` — a read-only, pre-populated instance of the live app with 12 sample students, 1 month of attendance, and 1 month of fees. The visitor can:
- Click between the 5 screens (Dashboard, Students, Attendance, Fees, Settings).
- Tap on a student to see their timeline.
- Tap on a fee entry to see the receipt (with hash).
- Try the search bar (it searches the 12 sample students).
- **Cannot** add, edit, or void anything (all mutations are disabled in demo mode).

The demo is the same code as the live app, with a `DEMO_MODE=true` env flag that:
- Seeds the per-user Turso DB with 12 sample students on first visit (or uses a shared read-only demo DB).
- Disables all `/api/mutation/*` routes (returns 403 with a friendly "Sign up to do this" toast).
- Disables sync (the demo DB is read-only).
- Disables biometric (no SecureStore enrollment).

### 4.2 The Demo CTA

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ── SEE IT LIVE.                                                          │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                                                                  │    │
│  │  [ iframe: 16:9, 1200×675, lazy-loaded on scroll-into-view ]    │    │
│  │                                                                  │    │
│  │  ┌─ Overlay (top-right): "Try the demo — no signup needed" ──┐  │    │
│  │  │  [Tap to load]                                             │  │    │
│  │  └────────────────────────────────────────────────────────────┘  │    │
│  │                                                                  │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ▸ Or [sign up free →] and get the full app with your own students.     │
└──────────────────────────────────────────────────────────────────────────┘
```

The iframe is **lazy-loaded** — it does not fetch until the visitor scrolls it into view (Intersection Observer). This protects the LCP of the hero (`02_Hero_and_Above_the_Fold.md §11`). The "Tap to load" overlay is a privacy-respecting pattern: the visitor explicitly opts in to loading the iframe, which sets a cookie and hits the demo Turso DB. No implicit data collection.

### 4.3 Demo Performance Budget

The iframe adds ~280 KB to the page weight (the live app's JS bundle, minus the parts not needed for read-only demo). This is acceptable because it loads **after** the visitor has scrolled past the hero and the 5 screen cards — they are already engaged. The demo's own LCP target is 1.8 seconds (more lenient than the hero's 1.2s).

### 4.4 Demo Data Freshness

The demo Turso DB is **reset nightly** by a Vercel Cron (`web/05_Deployment_Vercel.md §2.3`) at 03:00 IST. The reset restores the 12 sample students, 1 month of attendance, and 1 month of fees — wiping any demo-mode mutations (which shouldn't exist, since mutations are disabled, but the reset is a safety net). The reset ensures every visitor sees the same demo, regardless of when they visit.

---

## 5. The Competitor Comparison Table

Below the interactive demo, a comparison table. The table is the only place on the page where competitors are **named**. The hero and feature cards do not name competitors (per `01_Product_Positioning.md §4.2` — naming in the hero is insecure). The comparison table is the visitor's "okay, but how does this stack up against what I've heard of?" answer.

### 5.1 The Table

| Feature | Buddysaradhi | Classplus | Teachmint | Google Sheets |
|---|---|---|---|---|
| Five-screen UI | ✅ | ❌ (12+ modules) | ❌ (10+ modules) | N/A |
| Works offline (writes) | ✅ | ❌ (read-only cache) | ❌ | ✅ (with add-on) |
| Append-only fees ledger | ✅ | ❌ (editable) | ❌ (editable) | ❌ (editable) |
| Tamper-evident receipts | ✅ | ❌ | ❌ | ❌ |
| Encrypted backup export | ✅ (.buddysaradhi, AES-256) | ❌ (CSV only) | ❌ (CSV only) | ✅ (xlsx, plaintext) |
| No telemetry SDK | ✅ | ❌ | ❌ | ❌ |
| No ads (free tier) | ✅ | ✅ | ❌ (ads in free) | ✅ |
| Multi-tutor (Institute tier) | ✅ | ✅ | ✅ | N/A |
| Price (per tutor/mo) | ₹299 | ₹1,200+ | Free (with ads) | Free |
| Data is portable | ✅ | ❌ | ❌ | ✅ |
| Built in India | ✅ | ✅ | ✅ | N/A |

### 5.2 The Table's Honesty Rule

The comparison table is **honest**. The "✅" for a competitor means the competitor genuinely has that feature; the "❌" means they genuinely do not. If a competitor ships a feature update that flips a ❌ to a ✅, we update the table within 30 days — even if it makes us look less differentiated. The authenticity rule (`08_Testimonials_and_Social_Proof.md §6`) applies to the comparison table too: a fabricated ❌ is a dark pattern.

The CI lint `comparison-table-freshness.test.ts` runs monthly and flags any cell older than 90 days for review. A reviewer (a human, not an agent) confirms the cell is still accurate or updates it. This is the only place on the page where human review is required on a schedule — the stakes (defamation risk, consumer-court risk under CCPA/DPDP) are too high for automation.

### 5.3 The Table's Footnote

Below the table, a small-print footnote:

> *Comparison accurate as of {month year}. Competitor features verified from their public pricing pages and changelogs. If a competitor has updated and we have not, email hello@buddysaradhi.app and we will verify and update within 7 days.*

This footnote is **non-negotiable**. It signals integrity and gives competitors a path to request correction. It also pre-empts the "you're just making this up" objection.

---

## 6. Feature-Card Screenshot Specifications

Every screenshot in the features section is a **real screenshot** of the live app, not a Figma render. This is the same rule as the hero mockup (`02_Hero_and_Above_the_Fold.md §2.2`). The screenshots are taken by a CI job (`web/05_Deployment_Vercel.md §4`) that runs agent-browser against the latest Vercel preview deployment, navigates to each of the 5 routes, takes a 1440×900 screenshot, crops to 1200×750, converts to AVIF, and uploads to Vercel Blob at `buddysaradhi-releases/screenshots/{screen}.avif`.

### 6.1 The Screenshot Test-Data Spec

The screenshots are taken against a **seeded demo Turso DB** (the same one the interactive demo uses, `§4.4`). The seeded data is:

| Field | Value |
|---|---|
| Tutor name | "Riya Sharma" |
| City | Nagpur |
| 12 students | Aarav, Aditi, Arjun, Diya, Ishaan, Kiara, Maya, Rohan, Sai, Tara, Vihaan, Zara (Class 10 CBSE) |
| Batches | "Class 10 — Mon-Tue", "Class 10 — Wed-Thu", "NEET Foundation — Sun" |
| Today's date | The screenshot's run date (so the dashboard shows "today") |
| Month's collection | ₹1,24,500 (38 students × ₹2,500 + 6 partial payments) — wait, 12 students, so the dashboard shows ₹30,000 collected, with the seeded partial payments making it look realistic |
| Today's attendance | 11/12 present, 1 absent (Aarav, with a note "stomach flu") |

The seeded data is **stable** — the same students, the same batches, the same amounts, every screenshot run. This ensures the screenshots do not flicker between deploys (which would break the perceptual-hash CI lint).

### 6.2 The Screenshot Cropping Rules

| Screen | Crop region | Why |
|---|---|---|
| Dashboard | Top 750px (full above-the-fold view) | Shows KPIs + sparkline + today's batches |
| Students | Top 750px with the first student row expanded | Shows the list + the timeline |
| Attendance | Top 750px with one batch open | Shows the marking grid + the lock countdown |
| Fees | Top 750px with the "Record payment" sheet open | Shows the ledger + the sheet |
| Settings | Top 750px scrolled to the Backup section | Shows the export button + biometric toggle |

---

## 7. The "See It Live" Deep-Link Pattern

Each of the 5 feature cards has a "See it live →" deep-link. The link points to `https://app.buddysaradhi.app/{screen}` (the live app). A visitor who clicks without an account is redirected to `/signup?next=/{screen}` and returns to the screen after signup. This is the **single highest-converting CTA on the page** after the hero primary (`07_CTA_and_Conversion.md §4`).

### 7.1 The Deep-Link URL Contract

| Screen | Deep-link | `?next=` param |
|---|---|---|
| Dashboard | `https://app.buddysaradhi.app/dashboard` | `/dashboard` |
| Students | `https://app.buddysaradhi.app/students` | `/students` |
| Attendance | `https://app.buddysaradhi.app/attendance` | `/attendance` |
| Fees & Payments | `https://app.buddysaradhi.app/fees` | `/fees` |
| Settings | `https://app.buddysaradhi.app/settings` | `/settings` |

The `?next=` param is validated server-side against an allowlist of `/dashboard`, `/students`, `/attendance`, `/fees`, `/settings`. Any other value is ignored and the visitor lands on `/dashboard`. This is the open-redirect-prevention pattern documented in `web/03_Auth_and_Provisioning.md §5`.

### 7.2 The Deep-Link Anchor Text

The link text is **always** `See it live →`. Not "Try it now," not "Open this screen," not "Demo." The phrase "See it live" is consistent across all 5 cards — the visitor learns the pattern after the first card and the next 4 are frictionless. The arrow is a Unicode `→` (U+2192), not an emoji.

---

## 8. Animation and Motion

The features section uses **scroll-triggered fade-ins**. Each feature card fades in (opacity 0 → 1, translateY 16px → 0) when it enters the viewport, over 480ms with `cubic-bezier(0.22, 1, 0.36, 1)`. The fade-in is **once per card** — it does not replay on scroll-up.

### 8.1 The Reduced-Motion Rule

For visitors with `prefers-reduced-motion: reduce`, the fade-ins are **disabled**. All cards are visible at opacity 1 from initial render. The screenshots are static (already are — they're AVIFs). The interactive demo iframe still loads (the visitor can opt in via the "Tap to load" overlay) but its internal animations (if any) are governed by the iframe's own `prefers-reduced-motion` check, which is the live app's check (`13_UI_Guidelines.md §10`).

### 8.2 The No-Parallax Rule

No parallax scrolling in the features section. Parallax is a "wow" effect that costs performance (jank on low-end Android) and accessibility (vestibular discomfort for some users). The features section is paced by content, not by motion. This is enforced by a CSS lint rule (`no-parallax-transforms`).

---

## 9. Mobile Features Section

On mobile, the feature cards reflow to single-column. The reversed-card pattern is **disabled** on mobile — all cards are image-top, text-bottom (the image is the hook, the text is the explanation). The 7-engine grid reflows to 2 columns × 4 rows (with the last cell empty) on mobile, then 1 column × 7 rows on small mobile (< 480px).

The comparison table on mobile becomes a **horizontally-scrollable table** with `overflow-x: auto` and a `-webkit-overflow-scrolling: touch` for momentum scroll. A small "← scroll →" hint appears above the table on mobile only. The first column (feature names) is sticky via `position: sticky; left: 0` so the visitor always sees what they're comparing.

---

## 10. Feature-Card Copy Word Counts

Each feature card has a **strict word budget**. The eyebrow is ≤ 6 words. The headline is 1 word (the screen name). The lead is ≤ 35 words. Each bullet is ≤ 12 words. The "See it live →" link is 4 words. Total per card: ≤ 90 words.

This is enforced by a CI lint (`feature-card-word-budget.test.ts`) that parses the markdown source of this file, extracts each card's copy, and counts. A card over budget fails the build.

The word budget exists because long feature cards kill conversion. The visitor's attention is finite; every extra word is a tax. The writer's job is to compress, not to elaborate. If a feature needs more words, it gets a link to the full screen spec — not a longer card.

---

## 11. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated, neumorphic controls recipe-annotated, cross-references canonical (`§5.5`, `§6.6`, `§8.*`, `BR-*`, `P*`, `AP-*`). Box widths honour §20.3 rule 2 (80–120 for landing-page sections, 60–80 for components). The six-card features grid (§2.0) already lives above; this section adds two new mockups that visualise the desktop 3×2 + mobile 1×6 layouts with the glass tier and accent left-border per card.

### 11.1 Design System Reference (§5.5 + §6.6 single rule)

Every feature card is a `.glass` surface (the workhorse tier per §5.5 marketing-feature-card row) with a 2px accent left-border per §5.4 (the "this card is about emerald/cyan/amber/flare/violet" signal without painting the whole surface). The "See it live" deep-link is a `.neumo-raised` ghost button (transparent, no glow) per §6.6 — it is a control, not a surface. The cosmic canvas is the aurora source; the glass blurs the aurora behind the cards. The accent colours map 1:1 to the five screens (§2.6 of this file): Dashboard = emerald, Students = cyan, Attendance = amber, Fees = flare, Settings = violet — the sixth card is the "Seven Engines" card which carries the cosmic canvas gradient itself.

| Feature card (per §2.6 accent map) | Glass tier | Accent left-border (§5.4) | CTA recipe |
|---|---|---|---|
| Dashboard card | `.glass` | emerald | `.neumo-raised` ghost |
| Students card | `.glass` | cyan | `.neumo-raised` ghost |
| Attendance card | `.glass` | amber | `.neumo-raised` ghost |
| Fees & Payments card | `.glass` | flare | `.neumo-raised` ghost |
| Settings card | `.glass` | violet | `.neumo-raised` ghost |
| Seven Engines card | `.glass` | cosmic gradient (no accent stripe) | `.neumo-raised` ghost |

### 11.2 Six-Card Features Grid — Desktop 3×2 (NEW)

The six feature cards rendered as a 3-column × 2-row grid on desktop (≥ 1024px). Each card carries its 2px accent left-border (§5.4), the screen name, three bullets, a screenshot placeholder (AVIF, real screenshot per §6), and the "See it live →" deep-link (`/app/04..08?feature=…` per §7.1).

```
  SIX-CARD FEATURES GRID — DESKTOP (3 × 2, ≥ 1024px)
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  ░░░ cosmic canvas: #0f0c29 → #24243e → #0a0a1a (§2.2) — aurora source ░░░░░░░░░░░░ │
  │                                                                                    │
  │  ┌── .glass + emerald ──┐  ┌── .glass + cyan ────┐  ┌── .glass + amber ────┐         │
  │  │▌ ◈ DASHBOARD         │  │▌ 👥 STUDENTS        │  │▌ ✓ ATTENDANCE        │         │
  │  │▌                     │  │▌                    │  │▌                     │         │
  │  │▌ [ AVIF screenshot ] │  │▌ [ AVIF screenshot ]│  │▌ [ AVIF screenshot ] │         │
  │  │▌                     │  │▌                    │  │▌                     │         │
  │  │▌ • ₹2,45,500 MTD     │  │▌ • 38 students      │  │▌ • 38 present in 20s │         │
  │  │▌ • 92% attendance    │  │▌ • Bulk add via CSV │  │▌ • Auto-lock 24h     │         │
  │  │▌ • Heatmap, 30 days  │  │▌ • Dup detection    │  │▌ • Holiday badge     │         │
  │  │▌                     │  │▌                    │  │▌                     │         │
  │  │▌ See it live →       │  │▌ See it live →      │  │▌ See it live →       │         │
  │  └──────────────────────┘  └─────────────────────┘  └──────────────────────┘         │
  │   ↑ .glass + 2px emerald   ↑ .glass + 2px cyan      ↑ .glass + 2px amber            │
  │   ↑ "See it live" = neumo-  ↑ neumo-raised ghost     ↑ neumo-raised ghost             │
  │     raised ghost (§6.6,     ↑ → /app/05?feature=     ↑ → /app/06?feature=             │
  │     §8.2)                    students                attendance                       │
  │   ↑ → /app/04?feature=                                                              │
  │     dashboard                                                                        │
  │                                                                                    │
  │  ┌── .glass + flare ───┐  ┌── .glass + violet ──┐  ┌── .glass + cosmic ───┐         │
  │  │▌ ₹ FEES & PAYMENTS  │  │▌ ⚙ SETTINGS         │  │▌ ◉ SEVEN ENGINES     │         │
  │  │▌                     │  │▌                    │  │▌                     │         │
  │  │▌ [ AVIF screenshot ] │  │▌ [ AVIF screenshot ]│  │▌ [ 7-engine grid ]   │         │
  │  │▌                     │  │▌                    │  │▌                     │         │
  │  │▌ • Receipts RCT-…    │  │▌ • Razorpay UPI     │  │▌ • Fee, Reminder,    │         │
  │  │▌ • Append-only       │  │▌ • Backup AES-256   │  │▌   Invoice, Report,  │         │
  │  │▌ • Auto-invoice      │  │▌ • PIN + biometric  │  │▌   Sync, Security,   │         │
  │  │▌                     │  │▌                    │  │▌   Student engines   │         │
  │  │▌ See it live →       │  │▌ See it live →      │  │▌ See it live →       │         │
  │  └──────────────────────┘  └─────────────────────┘  └──────────────────────┘         │
  │   ↑ .glass + 2px flare    ↑ .glass + 2px violet    ↑ .glass + cosmic gradient       │
  │   ↑ neumo-raised ghost    ↑ neumo-raised ghost     ↑ neumo-raised ghost               │
  │   ↑ → /app/07?feature=     ↑ → /app/08?feature=     ↑ → /app/04..08?engines=all        │
  │     fees                    settings                                                  │
  │                                                                                    │
  └────────────────────────────────────────────────────────────────────────────────────┘
   ↑ .glass: rgba(255,255,255,0.05) + backdrop-blur(24px) saturate(140%) per §5.1
   ↑ 2px accent left-border per §5.4 (emerald/cyan/amber/flare/violet — never indigo/blue)
   ↑ "See it live" = .neumo-raised ghost (transparent, no glow, §6.6, §8.2 ghost variant)
   ↑ accent map per §2.6 of this file; no screen uses amber/flare as primary screen-branding
   ↑ card-hover-lift microinteraction (§7.3): y: -2px + shadow 8/32 → 12/48 on hover
   ↑ Mobile (≤768px): grid collapses to 1×6 (see §11.3 below)
   ↑ Screenshots are REAL (per §6) — not Figma renders; alt-text contract per 09_SEO §2.4
   ↑ WCAG 2.1 AA on every card; text-primary on cosmic = 15.2:1, accent-on-cosmic ≥ 11.9:1
```

### 11.3 Six-Card Features Grid — Mobile 1×6 (NEW)

The six feature cards rendered as a single-column stack on mobile (≤ 768px). The accent left-border is preserved; the screenshot scales to 480p; the "See it live" button becomes full-width. The grid uses a 16px gap between cards (preserved from desktop). The seventh "Seven Engines" card sits at the bottom of the stack — it's the climax of the section per the Apple-keynote pacing rule (§1).

```
  SIX-CARD FEATURES GRID — MOBILE (1 × 6, ≤ 768px)
  ┌────────────────────────────────────────────────┐
  │  ░░░ cosmic canvas: #0f0c29 → #24243e → #0a0a1a │
  │                                                  │
  │  ┌── .glass + emerald ─────────────────────╲    │
  │  │▌ ◈ DASHBOARD                              │   │
  │  │▌ [ AVIF 480p screenshot ]                 │   │
  │  │▌ • ₹2,45,500 MTD  • 92% attendance        │   │
  │  │▌ ┌─────────────────────────────────────┐  │   │
  │  │▌ │   See it live →                     │  │   │ ← full-width
  │  │▌ └─────────────────────────────────────┘  │   │   neumo-raised ghost
  │  └──────────────────────────────────────────╱    │
  │  ┌── .glass + cyan ─────────────────────────╲    │
  │  │▌ 👥 STUDENTS                              │   │
  │  │▌ [ AVIF 480p screenshot ]                 │   │
  │  │▌ • 38 students • CSV import • dup detect  │   │
  │  │▌ ┌─────────────────────────────────────┐  │   │
  │  │▌ │   See it live →                     │  │   │
  │  │▌ └─────────────────────────────────────┘  │   │
  │  └──────────────────────────────────────────╱    │
  │  ┌── .glass + amber ────────────────────────╲    │
  │  │▌ ✓ ATTENDANCE                            │   │
  │  │▌ [ AVIF 480p screenshot ]                 │   │
  │  │▌ • 38 present in 20s • auto-lock 24h      │   │
  │  │▌ ┌─────────────────────────────────────┐  │   │
  │  │▌ │   See it live →                     │  │   │
  │  │▌ └─────────────────────────────────────┘  │   │
  │  └──────────────────────────────────────────╱    │
  │  ┌── .glass + flare ────────────────────────╲    │
  │  │▌ ₹ FEES & PAYMENTS                       │   │
  │  │▌ [ AVIF 480p screenshot ]                 │   │
  │  │▌ • Receipts RCT-… • append-only ledger    │   │
  │  │▌ ┌─────────────────────────────────────┐  │   │
  │  │▌ │   See it live →                     │  │   │
  │  │▌ └─────────────────────────────────────┘  │   │
  │  └──────────────────────────────────────────╱    │
  │  ┌── .glass + violet ───────────────────────╲    │
  │  │▌ ⚙ SETTINGS                              │   │
  │  │▌ [ AVIF 480p screenshot ]                 │   │
  │  │▌ • Razorpay UPI • AES-256 backup • PIN    │   │
  │  │▌ ┌─────────────────────────────────────┐  │   │
  │  │▌ │   See it live →                     │  │   │
  │  │▌ └─────────────────────────────────────┘  │   │
  │  └──────────────────────────────────────────╱    │
  │  ┌── .glass + cosmic ───────────────────────╲    │
  │  │▌ ◉ SEVEN ENGINES  (the climax card)       │   │
  │  │▌ [ 7-engine grid, 480p ]                  │   │
  │  │▌ • Fee, Reminder, Invoice, Report, Sync,  │   │
  │  │▌   Security, Student — see product/03 §3  │   │
  │  │▌ ┌─────────────────────────────────────┐  │   │
  │  │▌ │   See it live →                     │  │   │
  │  │▌ └─────────────────────────────────────┘  │   │
  │  └──────────────────────────────────────────╱    │
  └────────────────────────────────────────────────┘
   ↑ Same .glass tier, same 2px accent left-border (§5.4), same neumo-raised ghost CTA
   ↑ 16px gap between cards (preserved from desktop)
   ↑ Screenshots scale to 480p AVIF (≤ 60 KB each per §11 performance budget)
   ↑ 44×44px hit area on every "See it live" CTA (Rule 10, P15, §10.2)
   ↑ The "Seven Engines" card sits LAST — the Apple-keynote climax (§1.1 pacing map)
   ↑ prefers-reduced-motion: card-hover-lift disabled; Intersection Observer fade-in
     becomes opacity-only (§8.1 reduced-motion rule)
```

### 11.4 "See It Live" Deep-Link — Component Anatomy (NEW)

The "See it live" CTA rendered side-by-side in its three states: default (ghost), hover (border tightens, cyan glow), active (neumo-pressed, translateY 1px). The deep-link URL contract is `/app/<screen>?feature=<anchor>` per §7.1, with the `?next=` allowlist enforced server-side.

```
  "SEE IT LIVE" CTA — THREE STATES  (per §7 deep-link pattern, §8.2 ghost variant)

  DEFAULT (ghost)              HOVER (border tightens)     ACTIVE (:pressed)
  ┌──────────────────────┐    ┌ ════════════════════┐    ┌──────────────────────┐
  │   See it live →      │    │   See it live →     │    │   See it live →      │
  └──────────────────────┘    └ ════════════════════┘    └──────────────────────┘
   ↑ transparent bg             ↑ 1px cyan border @ 40%    ↑ neumo-pressed: inset
     no shadow                    → 60%, + cyan glow          2px 2px 4px #0a0a1a,
   ↑ --text-secondary           ↑ --text-primary             -2px -2px 4px #2a2a5a
   ↑ → /app/<screen>?feature=   ↑ cursor: pointer           ↑ translateY(1px)
     <anchor> (§7.1 URL         ↑ 180ms ease-spring          ↑ scale-95 (60ms)
     contract)                  ↑ card-hover-lift on         ↑ aria-pressed="true"
   ↑ neumo-raised ghost           parent card lifts too    ↑ fires the navigation
     (transparent, no glow,                               event; analytics fires
     §6.6, §8.2 ghost)                                     cta_click (Vercel Web
   ↑ 44×44px hit area (§10.2)                             Analytics, no PII)
   ↑ aria-label: "See <screen> live in the app"
   ↑ rel="noopener" + target="_blank" — opens app in new tab
   ↑ Server-side allowlist on ?feature= param (§7.1) — rejects
     unknown anchors with 400 (no silent failure, AP-9)
```

### 11.5 References (External Design Authorities)

The features-grid mockups and the deep-link anatomy synthesise practices from the following public bodies of work. Cite them when a contributor challenges the 3×2 grid, the accent left-border, or the deep-link URL contract.

- **Nielsen Norman Group** — *Feature Card Grids for SaaS Marketing* and *Progressive Disclosure Patterns*. The §11.2 desktop 3×2 grid and §11.3 mobile 1×6 stack follow NN/g's progressive-disclosure research.
- **Smashing Magazine** — *Apple-Keynote Pacing for Feature Sections* and *Comparison Table UX*. The §11.2 Apple-keynote climax (Seven Engines card last) is Smashing-anchored.
- **Baymard Institute** — *Demo Embeds and Try-Before-Signup Patterns*. The §11.4 deep-link `?next=` allowlist and the new-tab behaviour follow Baymard's research on demo friction.
- **Apple Human Interface Guidelines** — *Marketing Surfaces* and *Real Screenshots vs. Figma Renders*. The §11.2 / §11.3 glass + accent left-border recipe follows Apple HIG's marketing-surface guidance.
- **A List Apart** — *Feature Card Copy Strategy* and *The Deep-Link Pattern*. The §11.4 "See it live →" constant anchor text follows ALA's deep-link doctrine.
- **Google Search Central** — *Image Alt Text and Image Search*. The §11.2 / §11.3 AVIF screenshots carry alt-text per the contract in `09_SEO_and_Analytics.md §2.4`.
- **Vercel Web Analytics docs** — *Custom Event Catalogues*. The §11.4 `cta_click` event (no PII, aggregate-only) follows Vercel's privacy-first analytics posture (Rule 3, AP-10, TELE-1).

---

## 12. Cross-References

- `01_Product_Principles.md P2` (five screens), P4 (append-only ledger), P5 (offline-first), P10 (backups are yours), P12 (minutes-per-day), P15 (honest empty states).
- `00_Vision.md §1.1` (the tagline "five screens, seven engines, one ledger"), §16 (platforms & distribution), §11 (guiding commitments / design pillars).
- `04_Dashboard.md`, `05_Students.md`, `06_Attendance.md`, `07_Fees_and_Payments.md`, `08_Settings.md` (full screen specs — the source of truth for what each screenshot shows).
- `02_Core_Logic.md §4` (Search engine), §6 (Ledger engine).
- `12_Business_Rules.md` BR-LED-06 (append-only), BR-ATT-07 (24-hour lock), BR-FEE-04 (receipt hash), BR-REM-01..09 (reminders), BR-RPT-04/05/08 (reports), BR-SYN-01..09 (sync).
- `09_Backup_and_Import_Export.md` BACKUP-1 (AES-256-GCM + Argon2id), BR-IMP-04 (bulk CSV import).
- `10_Security.md §16` (data minimisation inventory), §17 (TELE-1 — no telemetry). `12_Business_Rules.md §BR-SEC-04` (biometric).
- `13_UI_Guidelines.md §2.1` (color tokens), §2.4 (status → accent map), §3.2 (type ramp), §10 (accessibility, reduced-motion).
- `product/02_Hero_and_Above_the_Fold.md §2.2` (real-screenshot rule, shared with the feature cards), §11 (performance budget).
- `product/04_Download_Hub.md §4` (the manual-override download hub, linked from the platform chip).
- `product/07_CTA_and_Conversion.md §1` (the 7 CTAs — features owns the 3rd, "See it live").
- `product/08_Testimonials_and_Social_Proof.md §6` (authenticity rule, applied to the comparison table).
- `web/01_Architecture.md §4` (RSC vs Client Island split — feature cards are RSC, the interactive demo iframe is a Client Island), `web/05_Deployment_Vercel.md §2.3` (Vercel Cron for nightly demo DB reset), `web/05_Deployment_Vercel.md §4` (preview-deploy QA loop, screenshot CI job).
- `web/07_Landing_Page.md §5` (Features Showcase Implementation — the HOW: `<FeatureCard>` RSC composition, the Intersection Observer fade-in, the AVIF screenshot pipeline, the interactive-demo iframe sandbox. This file owns the 5-screen story and the 7-engine grid; that file owns the React tree and the image optimisation that ships them).
- `deployment/02_Vercel_Blob_Build_Storage.md §4` (Vercel Blob hosts the screenshots and the demo iframe's static assets).

---

## References

The features-showcase conventions in this file draw on the following public bodies of practice. Cite them when a contributor challenges the Apple-keynote pacing rule, the word budget, or the deep-link pattern.

- **Nielsen Norman Group** — *Feature Card Grids for SaaS Marketing* and *Progressive Disclosure Patterns*. The §1 Apple-keynote pacing rule (one big idea per scroll) and the §2 reversed-card pattern are NN/g-anchored.
- **Smashing Magazine** — *Apple-Keynote Pacing for Feature Sections* and *Comparison Table UX*. The §5 competitor comparison table's honesty rule and §10 feature-card word budget are Smashing-anchored.
- **Baymard Institute** — *Demo Embeds and Try-Before-Signup Patterns*. The §4 interactive-demo embed (lazy-loaded iframe, "Tap to load" overlay, nightly reset) follows Baymard's research on demo friction.
- **Apple Human Interface Guidelines** — *Marketing Surfaces* and *Real Screenshots vs. Figma Renders*. The §6 "every screenshot is a real screenshot of the live app" rule is Apple-HIG-derived.
- **A List Apart** — *Feature Card Copy Strategy* and *The Deep-Link Pattern*. The §7 "See it live →" deep-link pattern (constant anchor text across all 5 cards, `?next=` param with allowlist) is ALA-anchored.
- **Google Search Central** — *Image Alt Text and Image Search*. The §6.2 screenshot cropping rules and the alt-text contract in `09_SEO_and_Analytics.md §2.4` follow Google's image-SEO guidance.

---

*The features section is where a visitor decides "this is real, not marketing." Every screenshot must be live. Every bullet must be defensible. Every comparison cell must be honest. If any one of these slips, the visitor scrolls to a competitor.*
