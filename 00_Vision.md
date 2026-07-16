# 00 — Vision

> Buddysaradhi: Omni-Core — An Operating System for Private Tutors, Tuition Centres & Coaching Institutes.

---

## 1. The One-Sentence Pitch

> **Buddysaradhi is the operating system that lets a single tutor — or a 200-student coaching institute — run their entire tuition business from five screens, offline-first, with the elegance of Apple, the data density of Kite, and the persistent flow of Discord.**

### 1.1 The Tagline

> *Five screens. Seven engines. One ledger. Zero servers to manage.*

### 1.2 Who It Is For

Buddysaradhi is built for the **private tutor and the small coaching institute** — the Maths teacher in Nagpur with 40 students across three batches, the science academy in Indore with 180 students and three co-tutors, the premium home-tutor in South Mumbai with twelve ICSE wards. It is **not** built for school districts, university registrars, edtech platforms, or MOOC providers. Those users have other tools; we do not want them.

### 1.3 What It Replaces

For most tutors, Buddysaradhi replaces the unholy trinity of **WhatsApp + Excel + a paper register** — three tools that should have been one. For coaching institutes, it replaces the school-ERP license they bought, hated, and quietly stopped using. For everyone, it replaces the *cognitive overhead* of remembering which tool holds which truth.

---

## 2. The Problem We Are Solving

Private tutors and small coaching institutes today are trapped between two failure modes:

1. **School ERPs** — 200 mediocre features, 8 nested menus, a 4-week onboarding, and a price tag built for districts, not individuals.
2. **Spreadsheets + WhatsApp + Register Books** — free, familiar, and catastrophically fragile. One missed row in the fees sheet, one wet register, and a month's revenue is invisible.

### 2.1 The Workflow Gap

Neither option respects the actual workflow of a tutor. A tutor's day is a stream of micro-decisions made between classes, between parents, between cups of chai:

- Mark attendance in 30 seconds.
- Know exactly who owes what, today.
- Generate a receipt in two taps.
- Hand a parent a clean monthly statement without opening Excel.
- Do **all** of this even when the internet is down.

### 2.2 The Cognitive Tax of "Three Tools"

The paper register answers *who attended*. The Excel sheet answers *who paid*. WhatsApp answers *who has been told*. None of them answers the question the tutor actually asks at 9:47 PM on a Sunday: **"Of the students coming to my 7 AM batch tomorrow, who is in arrears, who was absent last class, and whose parents need a reminder?"** Answering that question today requires three app switches, two spreadsheet filters, and a memory the tutor does not have.

### 2.3 The Trust Gap

A parent trusts a printed receipt with a number, a date, and a signature. A parent does **not** trust a screenshot of a Google Sheet row that says `=SUM(F2:F47)` at the bottom. The current tooling strips the tutor of the *ceremony* of money — the receipt, the numbered invoice, the auditable trail — and replaces it with a fragile grid anyone can fat-finger.

### 2.4 The Privacy Gap

When a tutor uploads their student roster to a free SaaS tool, they are *paying with data*. Student names, parent phone numbers, fee structures, attendance patterns — all of it becomes the vendor's asset. The tutor has no leverage, no export, no exit. Buddysaradhi exists to put that leverage back in the tutor's pocket.

### 2.5 What Buddysaradhi Does About It

Buddysaradhi collapses the register, the spreadsheet, and the broadcast list into **one local database**, owned by the tutor, on the tutor's device. The five screens are the surface; the seven engines are the labour; the ledger is the spine.

---

## 3. Market Landscape

Buddysaradhi is not the first tool to address tutoring. It is the first to do so without compromising on the tutor's sovereignty. The table below positions Buddysaradhi against the tools a tutor today actually uses or evaluates.

| Tool | Positioning | Offline-First | Immutable Fees Ledger | Single-Tenant (one DB per tutor) | Privacy / No Telemetry |
|------|-------------|:-------------:|:---------------------:|:--------------------------------:|:----------------------:|
| **WhatsApp + Excel + Register** | Free, manual, fragmented | ✅ (mostly) | ❌ (mutable cells) | ✅ (tutor's files) | ✅ (until cloud sheet) |
| **Google Classroom** | Assignment & content flow for schools | ❌ | ❌ (no fees) | ❌ | ❌ |
| **Notion / Airtable** | Generic database, build-it-yourself | ⚠️ partial | ❌ (no ledger semantics) | ❌ | ❌ |
| **Teachmint** | Free tutor app, content + live class | ❌ | ⚠️ (mutable records) | ❌ (multi-tenant SaaS) | ❌ |
| **Classplus** | Coaching-institute SaaS, monetisation-heavy | ❌ | ⚠️ | ❌ | ❌ |
| **Vedantu / Byju's Whiteboard** | Online tutoring marketplace | ❌ | ❌ | ❌ | ❌ |
| **School ERPs (Fedena, Edmingle)** | District-scale, feature bloat | ⚠️ | ⚠️ | ❌ | ❌ |
| **Buddysaradhi: Omni-Core** | **Tutor's operating system** | ✅ | ✅ | ✅ | ✅ |

### 3.1 The Wedge

The wedge is not "better features." Every competitor has more features than Buddysaradhi will ever ship. The wedge is **the combination** of offline-first, immutable ledger, single-tenant sovereignty, and a five-screen ceiling. No competitor offers all four, because all four are *anti-SaaS* — they shrink the vendor's leverage rather than grow it.

### 3.2 Why Tutors Stay on WhatsApp

Tutors do not stay on WhatsApp because it is good. They stay because it is **always there, always offline, never asks permission to use it, and never holds their data hostage**. Buddysaradhi adopts those four properties verbatim and adds the structure WhatsApp refuses to provide.

### 3.3 What Tutors Actually Want From a Tool

In interviews (synthesised from persona research, see §4), tutors ask for four things in this order: *(1)* "Tell me who owes me." *(2)* "Don't make me re-type anything." *(3)* "Work when my Wi-Fi is down." *(4)* "Don't sell my student list." Every competitor fails at least two of these. Buddysaradhi exists to pass all four.

---

## 4. Tutor Personas

Personas are not demographics — they are *bundles of pain*. The four below are the bundles Buddysaradhi is optimised to dissolve.

### 4.1 Persona — "Riya" (Solo Maths Tutor, Tier-2 India)

- **Profile:** 31, teaches Maths to Classes 9–10 in Nagpur. 40 students, 3 batches (Mon/Wed/Fri, Tue/Thu/Sat, Sunday-only doubt class).
- **Current tools:** A4 notebook register + Google Sheet (`fees_2024.xlsx`) + WhatsApp broadcast list.
- **Daily pain:** Every month-end she cross-checks the notebook against the sheet, finds 4–6 students whose payment she forgot to log, and spends two evenings reconciling. She has lost ~₹14,000 in untracked fees in the last year.
- **What Buddysaradhi replaces:** The notebook → Attendance screen with biometric lock. The sheet → Fees screen with immutable ledger. The WhatsApp list → Reminder Engine (signed parent links, not broadcast spam).
- **#1 must-have:** **"Tell me, before tomorrow's 7 AM batch, who hasn't paid this month."** That is the dashboard's *Due Today* widget (see `04_Dashboard.md §3.2`).

### 4.2 Persona — "Kabir" (Science Centre Owner, 3 Teachers)

- **Profile:** 39, runs a 3-teacher science coaching in Indore. 180 students across Class 11, 12, and JEE-dropout batches. Two co-tutors (Physics, Chemistry); Kabir teaches Maths and owns the business.
- **Current tools:** A school ERP (₹18,000/yr) nobody on staff likes + an Excel sheet for the things the ERP can't do + a shared Google Drive for receipts.
- **Daily pain:** Co-tutors mark attendance on paper because the ERP's mobile app crashes; Kabir re-enters it weekly. Receipts are generated in Word, saved as PDF, renamed by hand. Fee disputes with parents are common because the ERP allows in-place edits.
- **What Buddysaradhi replaces:** ERP → Buddysaradhi (v2 multi-user; in v1 Kabir uses it solo with co-tutors as viewer role). Excel → derived reports from the ledger. Drive → receipt archive indexed by student.
- **#1 must-have:** **"An immutable receipt my co-tutors cannot accidentally overwrite."** This is Principle 9 in `01_Product_Principles.md` — receipts are sacred artefacts.

### 4.3 Persona — "Mrs. Menon" (Premium Home Tutor)

- **Profile:** 54, premium ICSE home tutor in South Mumbai. 12 students, Classes 8–10, ₹8,000/month per student. Visits homes; conducts 1-on-1 sessions.
- **Current tools:** A Moleskine planner + a Numbers spreadsheet + iMessage to parents.
- **Daily pain:** Her clients expect a *polished monthly statement* — not a screenshot. She currently hand-formats a PDF in Pages each month. It takes 90 minutes she does not have.
- **What Buddysaradhi replaces:** Planner → Attendance screen (light, 12 students, takes 20 seconds). Numbers → Fees screen with auto-generated statement PDFs. Pages → the receipt engine.
- **#1 must-have:** **"A monthly statement PDF that looks like it came from a Chartered Accountant, not a tutor."** Receipt typography is specified in `13_UI_Guidelines.md §3` (mono-lg for the big amount, mono-sm for the tamper hash and receipt number, tabular-nums throughout).

### 4.4 Persona — "Academy Vikram" (Mid Institute, Out of v1 Scope)

- **Profile:** 47, runs a 600-student JEE/NEET academy in Kota with two branches, 14 tutors, accounts team.
- **Why he's out of v1:** Multi-branch federation, role-based access, and accountant-side fee entry arrive in **v2** (see `15_Future_Roadmap.md §v2.0`). The v1 data model in `11_Data_Model.md` does not preclude him, but the UI does.
- **What he represents:** The proof that the architecture scales. If Vikram's institute can be expressed in the v2 extension of the v1 schema without a rewrite, the vision holds.

### 4.5 Anti-Persona — "The EdTech Operator"

The user Buddysaradhi is *not* for: an edtech founder looking for a content-distribution platform, a marketplace to acquire students, or a white-label LMS to resell. This user will be disappointed and is asked, politely, to leave.

---

## 5. Day in the Life

A concrete narrative — Riya, the solo maths tutor from §4.1 — across one Tuesday, using all five screens.

| Time | Screen | Action |
|------|--------|--------|
| **05:50** | Dashboard | Opens app. Phone was in airplane mode overnight. Dashboard loads instantly from local SQLite. *Due Today* widget: 3 students in tomorrow's 7 AM batch haven't paid November. *Collection this month*: ₹38,200 / ₹52,000 target. |
| **06:15** | Attendance | 7 AM batch arrives. Riya taps **Mark Attendance** from the dashboard quick-action. Batch roster appears, sorted by seat number. She taps Present/Absent in 28 seconds for 14 students. The toggle locks with her fingerprint — a tactile thunk, not a confirm dialog (Principle 11). |
| **06:45** | Students | Aarav's mother calls mid-class: "He's switching to ICSE syllabus." Riya opens Aarav's record, updates the syllabus tag, sees his ledger is clean. The tag change is logged in the audit trail (per `10_Security.md §4`). |
| **09:30** | Fees & Payments | After breakfast, Riya opens Fees. Three students paid via UPI overnight — in v1 she enters these manually in 22 seconds each; in v1.6 the gateway webhook will credit the ledger automatically. Each entry generates an immutable receipt with a monotonic number. |
| **10:15** | Dashboard | Checks *Activity feed*: yesterday's reminders resulted in 2 of 3 overdue parents paying. One parent opened the signed statement link twice but didn't pay. Riya queues a second reminder via the Reminder Engine. |
| **13:00** | Settings → Backup | Lunch. She taps **Back up now** — the entire database writes to a single encrypted `.buddysaradhi` file in 4.8 seconds. She emails it to herself as a monthly ritual. (Per Principle 10 — backups are her property; see `09_Backup_and_Import_Export.md`.) |
| **17:00** | Attendance | Sunday doubt-class batch. Same 30-second flow. The heatmap on her dashboard updates live. |
| **19:30** | Fees & Payments | Walks a parent through the monthly statement link on WhatsApp. Parent can read it on her 6-year-old Redmi without zooming (success criterion #6, §13.1). |
| **21:45** | Dashboard | Glances at the dashboard before bed. *Today*: 28 attendance entries, 3 payments (₹6,400), 2 reminders sent. Total time in app today: **7 minutes 12 seconds**. |
| **22:00** | (closed) | The north-star metric — minutes per day — for Riya is **7.2**. The product is winning. |

> *The product wins when the tutor closes the app and gets on with their life.*

---

## 6. The Five-Screen Doctrine

A tutor should run their entire business from **five screens**. No nested menus. No feature hunting. Every primary action is reachable in at most **2–3 taps**.

| # | Screen | One-line Job |
|---|--------|--------------|
| 1 | **Dashboard** | "Here is the truth of your business, right now, in one glance." |
| 2 | **Students** | "Every student, their lifecycle, their ledger, their invoices — one tap deep." |
| 3 | **Attendance** | "Mark today's attendance in 30 seconds; lock it with your fingerprint." |
| 4 | **Fees & Payments** | "Who paid, who didn't, who's partial — and the immutable ledger behind it." |
| 5 | **Settings** | "Your profile, your theme, your backups, your imports/exports — all in one drawer." |

### 6.1 The Seven Hidden Engines

Everything else — Search, Reminders, Ledger, Reports, Notifications, Sync, Security — exists as a **hidden engine** that powers these five screens, never as a sixth menu item.

| Engine | Surfaces In | Spec |
|--------|-------------|------|
| Search | Command palette (`⌘K`) on every screen | `02_Core_Logic.md §4.1` |
| Reminder | Dashboard activity feed + Fees screen | `07_Fees_and_Payments.md §8` |
| Ledger | Fees & Payments (derived balances) | `12_Business_Rules.md §2` |
| Report | Dashboard export + Fees export | `04_Dashboard.md §6` |
| Notification | In-app toast + (v1.x) system push | `08_Settings.md §5` |
| Sync | Background; invisible to user | `10_Security.md §6` |
| Security | Fingerprint/PIN prompts on mutation | `10_Security.md §3` |

### 6.2 The Two-Tap Rule (Reinforced)

Per Principle 3 in `01_Product_Principles.md`: any primary action — mark attendance, record a payment, generate a receipt, search a student, export a month — must be reachable in **≤ 2 taps** from any screen, via the persistent sidebar or the global command palette. The sidebar is the *geography*; the palette is the *teleport*.

---

## 7. Doctrine Rationale — Why Only Five Screens

The five-screen ceiling is the most controversial decision in the spec. Every competitor has 8–20 top-level surfaces. We have five. Here is the reasoning.

### 7.1 Cognitive Load

A tutor using Buddysaradhi is *between* classes, *between* parents, *between* sleep and dinner. They are not in flow-state; they are in interruption-state. A navigation tree of depth 2 with 5 children is the maximum a human can hold in working memory under interruption. Six is the cliff; eight is the abyss.

### 7.2 Discoverability Through Compression

When there are 12 menu items, the user opens Search. When there are 5, the user opens the right one. Compression *is* discoverability — it forces the designer to choose, and the user to learn the choice. We have made the choice; the user learns it in a day.

### 7.3 The "Second App" Anti-Pattern

When a tool grows a 6th screen that does not belong in the original 5, the user develops a "second app" mental model — "Buddysaradhi for attendance, Excel for the thing Buddysaradhi can't do." The moment that bifurcation happens, Buddysaradhi has lost. The five-screen ceiling prevents the bifurcation by forcing every new capability to either *fit one of the five* or *graduate via amendment* (see §7.5).

### 7.4 The Hidden-Engine Pattern

Capabilities that do not need their own surface become **engines**: services invoked by the screens. Search is invoked from any screen via `⌘K`. Reports are invoked from Dashboard via the Export button. The Reminder Engine is invoked from Fees via a "remind" action. Engines are the *verbs*; screens are the *nouns*. Verbs never need their own tab.

### 7.5 Decision Matrix — What Graduates to a 6th Screen

A proposed capability X graduates to a 6th screen **only if all four are true**:

| # | Criterion | Example pass | Example fail |
|---|-----------|--------------|--------------|
| 1 | X cannot be expressed as a verb invoked from an existing screen. | (rare) | "Courses" — expressible as a tag in Students |
| 2 | X is used by ≥ 40% of tutors on ≥ 3 days/week. | — | "Timetable" — used by < 15% of solo tutors |
| 3 | X does not duplicate an existing engine's job. | — | "Calendar" — duplicates Attendance + Reports |
| 4 | X survives the Principle-2 amendment vote (see `01_Product_Principles.md`). | — | (none in v1; v2 "Team" surface is the first) |

In Buddysaradhi's history, **one** capability has ever passed all four: the **Team** surface in v2, for multi-user tenants (see `15_Future_Roadmap.md §v2.1`). Solo tutors never see it.

---

## 8. The Three Design Inheritances

| Inheritance | What We Take | What We Reject |
|-------------|--------------|----------------|
| **Apple** | 120fps spring motion, SF Pro / Inter typography, generous whitespace, spatial hierarchy, "it just works" defaults | Walled-garden pricing, opaque file formats, refusal to expose power features |
| **Kite (Zerodha)** | High-density data tables, keyboard shortcuts, utilitarian dashboards, every pixel earns its place | Brokerage-domain jargon, grey-on-grey monotony |
| **Discord** | Persistent left sidebar, server-as-tenant mental model, real-time panels, frictionless switching | Notification noise, chat-as-everything sprawl |

### 8.1 The Synthesis

The synthesis of Apple (tactile elegance), Kite (data density), and Discord (persistent flow) is **Vibrant Glass & Neumorphism** — deep cosmic gradients, translucent glass panels, bioluminescent accents, and neumorphic controls that feel physically extruded. The cosmic canvas is the night sky; the glass panels are the aurora on it; the accents are the bioluminescence.

---

## 9. Design Ethos Deep-Dive

### 9.1 Why Vibrant Glass & Neumorphism

The market for tutor tools is exhausted by **flat, monochrome, grey-on-grey SaaS**. Kite-style density without Kite-style greyness. Apple-style tactility without Apple-style preciousness. Glass panels over a deep cosmic canvas solve three problems at once:

1. **Density without darkness.** Translucent panels let dense tables breathe against a calm dark canvas. The eye finds rows; the canvas recedes.
2. **Tactility without skeuomorphism.** Neumorphic controls (extruded buttons, inset inputs) feel *physical* — the fingerprint lock *compresses*; the toggle *thunks*. Per Principle 7, motion is meaning, not decoration.
3. **Calm without sterility.** Bioluminescent accents (emerald, cyan, solar flare) punctuate the canvas without dominating it. The interface feels alive but never loud.

### 9.2 The No-Monochrome Rule

> **A flat grey-on-grey interface is a bug, not a style.**

Every surface in Buddysaradhi carries *at least* one of: a gradient, a translucency, an accent, or a tactile shadow. Pure `#ffffff` on `#f5f5f5` is forbidden. This is the explicit rejection of the school-ERP aesthetic the market is drowning in.

### 9.3 The Bioluminescent Accent System

| Accent | Hex | Used For |
|--------|-----|----------|
| **Bioluminescent Emerald** | `#00FF9D` | Collected fees, paid status, positive deltas |
| **Neon Cyan** | `#00F0FF` | Primary actions, links, focus rings, count-up animations |
| **Solar Flare** | `#FF5E00` | Overdue fees, destructive confirmations |
| **Amber Glow** | `#FFB300` | Due-soon fees, partial payments, warnings |
| **Violet Mist** | `#B388FF` | Neutral informational badges (used sparingly) |

### 9.4 The Indigo / Blue Prohibition

> **Indigo and blue are forbidden as primary accent colors.** They are the visual signature of every generic SaaS dashboard since 2018 — the colour of "we copied Stripe." Buddysaradhi's deep cosmic canvas uses indigo→violet as a *neutral background gradient* (the night sky, not the brand). The brand is the bioluminescent life on that canvas: emerald, cyan, flare. **Never** indigo. **Never** Slack-blue, LinkedIn-blue, or Twitter-blue as an accent.

This is enforced at the token level in `13_UI_Guidelines.md §2`: the `--accent-*` namespace contains no indigo or blue entry. Any PR introducing an indigo accent is rejected by lint.

### 9.5 Accessibility Commitments

- **WCAG 2.1 AA contrast** on all text. The cosmic canvas + glass panels are validated against the emerald/cyan/flare accents at 4.5:1 minimum.
- **44px minimum tap targets** on every interactive element on mobile. The 30-second attendance flow is impossible to flub with a thumb.
- **`prefers-reduced-motion` honoured.** Aurora blobs freeze, count-ups snap, spring animations become instant. Per Principle 7, motion confirms — but never at the cost of vestibular safety.
- **Keyboard parity on web.** Every screen reachable via `G D / G S / G A / G F / G T` (Goto Dashboard/Students/Attendance/Fees/Settings). Power-user flow specified in `08_Settings.md §9`.
- **Screen-reader semantics.** Tables use real `<table>` markup, not divs. Status chips use `aria-label="Paid"` not just a green dot.

---

## 10. Single-Tenant Sovereignty

> **One tutor. One database. One owner. No exceptions.**

### 10.1 Why One DB Per Tutor

Every tutor gets their own **SQLite database** (local) replicated to their own **Turso Cloud** namespace. There is no shared `students` table. There is no `tenant_id` column in v1. There is no possibility — by construction — of one tutor's query returning another tutor's row.

The single-tenant model buys four things a multi-tenant SaaS cannot:

1. **Zero cross-tenant leak.** A bug in a query cannot leak Riya's student list to Kabir. The data lives in different databases.
2. **Offline by default.** Local SQLite *is* the source of truth at interaction time. The network is a replication transport, not a request dependency (Principle 5).
3. **No SaaS dependency at runtime.** If Turso Cloud is down, the tutor's app still works. If Turso Cloud is *gone*, the tutor's encrypted backup is still on their pendrive.
4. **Pricing leverage.** A tutor's data is not the vendor's hostage (Principle 10). They can export, leave, and return without losing a single ledger entry.

### 10.2 The Local-First Sync Model

Sync is **invisible**. The tutor never sees a "Sync now" button in v1 (one exists in Settings for the anxious, but it is not part of any primary flow). The Sync Engine:

- Pushes local mutations to Turso Cloud on every network transition (Wi-Fi join, app foreground).
- Pulls remote mutations on every app launch and every 5 minutes while foregrounded.
- Writes through a single **CRDT-lite** layer that handles the common conflict cases without user intervention.

### 10.3 Conflict Resolution — LWW + Vector Clocks

Two conflict axes exist:

| Conflict Type | Resolution | Rationale |
|---------------|------------|-----------|
| **Same record, different fields** | Last-Writer-Wins per field | Most field edits are independent (notes vs. fee_amount); LWW is correct 99% of the time. |
| **Same record, same field** | Vector-clock-aware merge; both versions kept in audit log | Rare (typically two-device tutors). User is prompted in Settings → Sync Conflicts, defaulting to the higher vector-clock entry. |
| **Ledger entries** | **No conflict resolution needed** — ledger is append-only | Two devices can never produce the same ledger entry; each carries a UUID. The ledger is conflict-free by construction (Principle 4). |

This is the deep magic of Buddysaradhi: the *only* data that can conflict is editable profile/note data. The financial spine — the ledger — is structurally conflict-free.

### 10.4 What Sovereignty Forbids

- ❌ No analytics SDK in the app. No telemetry. No "anonymous usage statistics." (Per the guiding commitment: *no telemetry, ever* — see §11.3.)
- ❌ No remote feature flags that exfiltrate user state.
- ❌ No vendor-side "AI" trained on tutor data.
- ❌ No requiring an account to use the app offline. The app boots and works with **zero network ever**, indefinitely.

---

## 11. Guiding Commitments

The five commitments below are the load-bearing promises of Buddysaradhi. Every one is testable; every one is in scope for v1.

### 11.1 Offline-First, Always

The app's happy path is **no network**. Marking attendance, recording a cash payment, viewing a student's ledger — all work in airplane mode. The network is a replication transport, not a request dependency. (Principle 5.) Acceptance: 72 hours offline, zero data loss, zero duplicate ledgers (success criterion #2, §13.1).

### 11.2 Single-Tenant Sovereignty

One SQLite DB per tutor. No shared tables. No multi-tenant leak surface. (§10 above.)

### 11.3 No Telemetry, Ever

The app makes **zero outbound calls** other than (a) Turso Cloud replication, (b) the user's explicit backup destination (their own email / Drive / pendrive), and (c) v1.x opt-in messaging gateways. No analytics. No crash reporting that includes user data. No "we improved our product by understanding how you use it." We do not need to understand how you use it.

### 11.4 The Immutable Ledger

Money is never edited by mutating a balance. Every financial event is an append-only ledger entry. All balances, dues, and reports are derived views. (Principle 4; see `12_Business_Rules.md §2`.) This is the spine that makes the receipts sacred, the audits clean, and the conflicts impossible.

### 11.5 Backups Are the User's Property

A backup is a single encrypted `.buddysaradhi` file. The user can download it, email it, put it on a pendrive, restore on any device. We never hold backups hostage to a subscription. (Principle 10; see `09_Backup_and_Import_Export.md`.)

---

## 12. Non-Goals (v1)

To protect the five-screen doctrine, the following are **explicitly out of scope** for v1. Each non-goal carries a rationale; none is a permanent refusal.

| Non-Goal | Rationale |
|----------|-----------|
| ❌ Live video classes / whiteboards | Not the tutor's pain. Integrate (Zoom/Meet link-sharing) in v3.x; never build. |
| ❌ Parent-facing mobile app | Parent is a guest in v1 (Principle 14). Read-only signed link only. Parent app is v3.1. |
| ❌ Online payment gateway (v1) | Cash + UPI-offline covers v1 tutors. Gateway is v1.6 — first true server-side write path. |
| ❌ GST / tax filing automation | Out of scope; the ledger exports to Excel (3 worksheets) for the tutor's CA. |
| ❌ Timetable auto-generation | Used by < 15% of solo tutors; fails the 6th-screen decision matrix §7.5. |
| ❌ Email campaigns / marketing CRM | Violates "no telemetry, no SaaS dependency" — and tutors don't need it. |
| ❌ Multi-branch federation | v2.0 (data model supports it; UI does not, by design). |
| ❌ Gamification for students | Violates Principle 1 — tutor is the user, not the student. |
| ❌ Content hosting (worksheets, videos) | A different business. Tutor marketplace is v3.2; content is v3.3. |
| ❌ Multi-currency in v1 | Default INR; multi-currency deferred to v1.x for the small diaspora-tutor segment. |
| ❌ White-label | v3.6. White-label dilutes the brand promise in v1. |
| ❌ Indigo / blue primary accents | Forbidden by design system (§9.4); enforced by lint. |
| ❌ A 6th top-level screen | Forbidden by Principle 2; only "Team" graduates, in v2, for multi-user tenants. |

These are not permanent refusals — they are **v1 discipline**. Each is parked in `15_Future_Roadmap.md` with a version target.

---

## 13. Success Criteria & Metrics

### 13.1 Success Criteria (v1 Release Gate)

A release of Buddysaradhi is "done" when **all six** are true:

1. A brand-new tutor, given only the app and no manual, can onboard, add 5 students, mark attendance, and record a payment in **under 7 minutes**.
2. The app works fully offline for 72 hours and syncs cleanly on reconnection with **zero data loss** and **zero duplicate ledgers**.
3. A monthly finance report can be generated and exported to Excel in **under 3 taps**.
4. The entire database can be backed up to a single encrypted file and restored on a fresh device in **under 60 seconds**.
5. The UI never drops below 55fps on a mid-range Android (Redmi Note 12 class) during attendance marking of 100 students.
6. A tutor's parent — non-technical, 60 years old — can read a fee receipt on their phone without zooming.

### 13.2 Success Metrics Table

| Category | Metric | Target (v1) | Why |
|----------|--------|-------------|-----|
| **Leading** — Activation | Time-to-first-payment (sign-up → first receipt) | < 7 min | Success criterion #1 |
| **Leading** — Retention | Day-7 retention (app opened ≥ 1× in 7 days post-signup) | ≥ 60% | The 5-screen ceiling fails if tutors abandon |
| **Leading** — Engagement | Ledger entries per active tutor per week | ≥ 8 | A tutor not writing to the ledger is a tutor not using the product |
| **Leading** — Reliability | Sync conflict rate | < 0.1% of mutations | Validates the LWW + vector-clock design (§10.3) |
| **Lagging** — Revenue | MRR per active tutor (paid plans, post-trigger) | ≥ ₹299/mo (Pro, post-§1.6-trigger) | Pricing respects Principle 10 — no data hostage; pre-trigger, MRR = ₹0/mo ("Free for everyone, for now" model, `product/05_Pricing_and_Plans.md §1.6`). The 250-student number is internal soft guidance — no paywall, no waitlist, no churn risk in v1. |
| **Lagging** — Churn | Monthly logo churn | < 5% | Tutors are sticky if the ledger holds; churn signals data-hostage fear |
| **Lagging** — NPS | Net Promoter Score (post-onboarding + 30d) | ≥ 40 | Buddysaradhi is referral-driven; no paid acquisition in v1 |
| **Anti-metric** | Features shipped per quarter | **Minimise** | We measure value delivered, not features shipped. A quarter that ships 0 features but cuts minutes-per-day by 10% is a win. |
| **Anti-metric** | Lines of code | **Minimise** | Boring tech (Principle 13) means a small codebase. LOC growth is a smell. |
| **Anti-metric** | Time-in-app per tutor per day | **Minimise** | The North-Star (§14). Lower is better. |

### 13.3 The Anti-Metrics Doctrine

> *We measure what we want to encourage, not what is easy to count.*

Features shipped, sprint velocity, LOC, and time-in-app are **anti-metrics** — explicitly de-prioritised. A team that ships 3 features and raises time-in-app by 4 minutes has *failed*. A team that ships 0 features and lowers time-in-app by 2 minutes has *succeeded*. This is unusual. It is also the only honest expression of the north-star.

---

## 14. North-Star Metric

> **"Minutes per day a tutor spends inside Buddysaradhi."**

The product wins when this number is **low and falling**. A tutor who spends 4 minutes a day in Buddysaradhi and runs a clean business is a success. A tutor who spends 40 minutes a day is a failure — we have pushed complexity onto them instead of absorbing it.

### 14.1 Why This Metric, Not Another

- **Not DAU/MAU.** A daily-active tutor is not a *successful* tutor; they may be *stuck* in the app.
- **Not MRR.** Revenue is a *lagging* consequence of value; it cannot drive weekly decisions.
- **Not NPS.** Satisfaction is a vibe; minutes-per-day is a fact.
- **Minutes-per-day** captures the *actual product hypothesis*: Buddysaradhi should *compress* the tutor's administrative life, not extend it.

### 14.2 How Every Feature Is Judged

Every feature decision is run through this metric: *does this lower the minutes-per-day, or raise it?*

- "Auto-remind unpaid students whose batch meets tomorrow" → **lowers** (removes manual WhatsApp). Ship.
- "Custom receipt logo uploader" → **raises** (adds a fiddly setup flow). Defer to v1.7.
- "Saved filters on Students" → **lowers** (removes re-filtering). Ship in v1.8.

The decision protocol in `01_Product_Principles.md §Decision Protocol` codifies this as question #3.

---

## 15. Naming & Brand

### 15.1 Why "Buddysaradhi"

The **OS** suffix is deliberate. Buddysaradhi is not an "app," a "platform," a "solution," or a "tool." It is an **operating system** for a tuition business — the substrate on which the tutor's livelihood runs. Just as an OS abstracts the hardware, Buddysaradhi abstracts the spreadsheet, the register, the broadcast list, the receipt-book, the WhatsApp group, the audit fear.

The OS framing also sets the user's expectation: an OS *ships once, runs for years, gets patched, never gets re-learnt*. A tutor who learns Buddysaradhi in 2025 should not need to relearn it in 2028. The five-screen ceiling guarantees that.

### 15.2 Why "Omni-Core"

- **Omni** — one codebase, one design system, one sync engine, one ledger, running identically across **Web** (Next.js 16), **Mobile** (Expo), and **Desktop** (Tauri). No "mobile-only" or "desktop-first" hedge. The tutor's data is the same; the surface adapts.
- **Core** — there is one source of truth: the tutor's local SQLite database. Cloud is a replica. Backups are snapshots. Reports are derived views. The *core* is singular and sovereign.

### 15.3 The Tagline

> **Five screens. Seven engines. One ledger. Zero servers to manage.**

The tagline is the doctrine compressed to four beats. It is the only marketing line Buddysaradhi needs in v1.

### 15.4 What the Brand Is Not

- Not "the WhatsApp for tutors." (WhatsApp is the competition we replace.)
- Not "the Notion for tutors." (Notion is a build-it-yourself kit; Buddysaradhi is opinionated.)
- Not "the free tutoring app." (Free is not the wedge; sovereignty is.)
- Not "the AI tutor." (We are not in the AI-tutor business; we are in the tutor's-business business.)

---

## 16. Platforms & Distribution

Buddysaradhi ships on **five runtime surfaces** from one codebase, plus a single **commercial front door** that ties them together. The list is short by design: every additional surface is a maintenance tax, a sync edge, a place for bugs to hide.

### 16.1 The Five Runtime Surfaces

| Surface | Stack | Distribution Channel | Spec |
|---------|-------|----------------------|------|
| **Web** | Next.js 16 (PWA-installable) | `buddysaradhi.in` on Vercel free tier | `web/01_Architecture.md` |
| **macOS** | Tauri 2 (Universal `.dmg`, ≤15 MB) | Direct download, Apple-notarised | `desktop/06_Installers.md` |
| **Windows** | Tauri 2 (per-user `.msi`, ≤15 MB) | Direct download, code-signed | `desktop/06_Installers.md` |
| **Android** | Expo (webview v1, native v3.x) | Play Store + APK sideload | `mobile/07_App_Store_Release.md` |
| **iOS** | Expo (webview v1, native v3.x) | App Store | `mobile/07_App_Store_Release.md` |

All five surfaces sync to the **same per-user SQLite database** through Turso Cloud replication. A tutor can start a session on the web, continue from their Android phone on the bus, and finish on their Mac at home — without thinking about it. Sovereignty is preserved: the database belongs to the tutor, the cloud is a replica, and the surfaces are interchangeable views onto the same ledger.

### 16.2 The Commercial Front Door

The landing page at `buddysaradhi.in` is the **only marketing surface** in v1. It is not a generic SaaS marketing site; it is the **commercial spec** for the product, written down before the marketing team (or the founder) writes a line of copy. The spec lives in [`product/README.md`](product/README.md) — eleven files covering positioning, hero, features, the cross-platform download hub, pricing ("Free for everyone, for now" model: a single public Free tier — ₹0/mo for every tutor, every feature, no card required, free while our backend infra stays free; Pro ₹299/mo and Institute ₹999/mo are internal-only future tiers in Appendix A that launch on the §1.6 trigger; the 250-student number is internal soft guidance — no paywall, no waitlist), FAQ, CTA, testimonials, SEO, and the agent hand-off.

The front door's job is narrow and measurable: take a curious tutor from a Google search or a WhatsApp share to a working install on the platform they prefer, in **under 90 seconds**, without a credit card and without a single third-party tracker (per `10_Security.md §17`, TELE-1). The implementation contract for that page is `web/07_Landing_Page.md`; the WHAT it must say is the `product/` directory.

### 16.3 Why No App Store for Desktop

macOS and Windows builds are distributed via **direct download** from `buddysaradhi.in`, not the Mac App Store or Microsoft Store. Direct download keeps the installer ≤15 MB (no Electron runtime to ship), keeps the update channel ours (Tauri's signed updater, not the store's review cadence), and keeps the tutor out of a 30% store tax we would otherwise pass on. Mobile is the exception: Play Store and App Store are the discovery surface for handheld devices, and we accept their terms for that reach. The trade-off is documented in `deployment/01_Vercel_Hosting.md` (free domain + hosting) and `deployment/02_Vercel_Blob_Build_Storage.md` (where the installers live).

### 16.4 The Distribution Discipline

Five surfaces, one front door, one update channel each, zero telemetry SDKs. The discipline is the strategy: every additional distribution surface (Chrome extension, browser toolbar, smartwatch companion, voice assistant skill) is parked in `15_Future_Roadmap.md` until it can clear the §7.5 sixth-screen decision matrix adapted for platforms. In v1 we ship less surface than the competition and more substance per surface.

---

## 17. Three-Year Horizon — Buddysaradhi in 2028

Three years from v1, Buddysaradhi should be:

### 17.1 The Default Tool for the Indian Private Tutor

By 2028, "I use Buddysaradhi for my tuition business" should be a sentence that needs no explanation in a teachers' WhatsApp group. Not because we marketed it — because tutors tell tutors.

### 17.2 Multi-User, Multi-Branch — Without Betraying Solo

v2 (multi-user, multi-branch) ships in 2026. By 2028, **Kabir's 3-teacher centre** is on v2.x with role-based access; **Riya the solo tutor** is still on the same five screens, never seeing the Team surface. The v2 graduation was *additive* — solo tutors' experience is unchanged.

### 17.3 Ecosystem, Not Empire

v3 (parent app, payment gateway, marketplace, content packs, public API) ships by 2027–2028. Buddysaradhi does **not** become a SaaS behemoth. The marketplace takes a transaction fee on first-time enrolments; the parent app is a separate native install; the API is read-mostly with webhook-out. The tutor's five-screen sovereignty is untouched.

### 17.4 The Diaspora Wedge

By 2028, Buddysaradhi serves the Indian-diaspora tutor in Dubai, Singapore, London, and Toronto — multi-currency, locale-aware, with the same five-screen ceiling. The wedge is the same: sovereignty, offline-first, immutable ledger.

### 17.5 What Buddysaradhi Must NOT Become in 2028

> *A venture-funded SaaS that holds tutor data hostage, ships 40 top-level surfaces, monetises student attention, and calls itself "the operating system for education."*

If by 2028 Buddysaradhi has a 12-item sidebar, a marketplace that dominates the dashboard, or a telemetry SDK that phones home — the vision has failed, regardless of revenue. The five-screen ceiling, the single-tenant model, and the no-telemetry commitment are the three load-bearing walls. Remove any one and the building collapses into just-another-edtech-SaaS.

### 17.6 The 2028 North-Star

A 2028 tutor who has used Buddysaradhi for three years should still spend **under 10 minutes per day** in the app — because every feature shipped since v1 was tested against that metric. The product wins by disappearing into the tutor's routine, not by colonising their attention.

---

## 18. Closing Manifesto

> **We are not building an app. We are building the substrate on which a tutor runs their livelihood.**
>
> Five screens. Seven engines. One ledger. Zero servers to manage. No telemetry. No data hostages. No sixth menu item. No indigo accents. No flat grey.
>
> The tutor is the user. The student is a record. The parent is a guest. The ledger is the truth. The receipt is sacred. The backup is the tutor's property. The network is a transport, not a dependency.
>
> We measure minutes-per-day and we want it to fall. We ship features that lower it and defer features that raise it. We are boring in our stack and radical in our polish.
>
> If, in three years, a tutor in Nagpur opens Buddysaradhi for seven minutes, closes it, and gets on with their life — we have won. If they open it for forty minutes, we have failed, no matter what the MRR says.
>
> This is the vision. The other sixteen documents are how we honour it.

---

## 19. ASCII Art Mockup Suite (§20 Compliance)

> This section operationalises `13_UI_Guidelines.md` §20 (ASCII Art Conventions) for the Vision doc. The Vision is not a screen spec — its mockups are **architecture / scope / persona diagrams**, not UI layouts. Where a UI surface is mentioned, the glass tier (`.glass` / `.glass-strong` / `.glass-faint` per §5.5) or neumorphic recipe (`.neumo-raised` / `.neumo-inset` / `.neumo-pressed` per §6.6) is annotated in the notes. Character set per §20.2. Accent colours named, never hexed. Cross-references use canonical IDs only (`§5.4`, `§5.5`, `§6.6`, `BR-*`, `P*`, `AP-*`).

### 19.1 Design System Reference — Vision

> **The single rule (`13_UI_Guidelines.md` §6.6):** *controls are neumorphic; surfaces are glass. Never invert. Never mix.*

| Glass surfaces referenced by this doc | Tier | Cross-ref |
|---|---|---|
| Cosmic canvas (the night sky itself) | (none — raw gradient `#0f0c29 → #24243e → #0a0a1a`) | §2.2 |
| Sidebar / header / footer of the 5-screen shell | `glass-strong` (sidebar/header), `glass-faint` (footer) | §5.5, §13 |
| KPI cards on the Dashboard | `glass` + 2px accent left-border | §5.4, §8.1 |
| Empty-state card (P15) | `glass` centered | §5.5, §8.19 |
| Receipt PDF surface (P9) | (print — `glass` does not apply; see §12.2 print stylesheet) | §12.2 |

| Neumorphic controls referenced by this doc | Recipe | Cross-ref |
|---|---|---|
| Attendance mark buttons (Present/Absent/Late/Excused) | `neumo-raised`; active = `neumo-pressed` + accent glow | §6.6, §8.16 |
| Toggle (the fingerprint-lock thunk) | `neumo-inset` well + raised knob (emerald→cyan glow when on) | §6.4, §8.16 |
| Quick Action buttons on Dashboard | `neumo-raised` primary (emerald glow) | §6.6, §8.2 |
| Command palette trigger (⌘K) | `neumo-inset` search tray (in header) | §6.6, §8.10 |

> **References:** Nielsen Norman Group — *Personas Make Users Memorable for the Right Reasons*; Apple HIG — *Designing for macOS, iOS, and the Web* (cross-surface consistency); Material Design 3 — *Material Foundations*; Martin Kleppmann — *Designing Data-Intensive Applications* (single-tenant sovereignty as the architectural primitive); Pat Helland — *Life beyond Distributed Transactions* (the local-first rationale).

### 19.2 Mockup V1 — Platform Overview (Web + Desktop + Mobile, Turso per-user DB, Supabase auth)

```
PLATFORM OVERVIEW — Omni-Core, single codebase, 5 surfaces
                                  ┌──────────────────────────────────────────┐
                                  │  SUPABASE AUTH (OIDC)                     │
                                  │  · email + magic-link (no password)       │
                                  │  · 1 tutor = 1 supabase auth user         │
                                  │  · JWT scopes to per-user Turso DB only   │
                                  └────────────────────┬─────────────────────┘
                                                       │ OIDC JWT (sign-in only)
   ┌───────────────────┐  ┌───────────────────┐  ┌────┴──────────────┐  ┌────────────────────┐
   │  WEB (Next.js 16) │  │ DESKTOP (Tauri 2) │  │ MOBILE (Expo)     │  │ COMMERCIAL FRONT   │
   │  buddysaradhi.in/PWA   │  │ macOS · Windows   │  │ Android · iOS     │  │ buddysaradhi.in (WWW)   │
   │  · Vercel free    │  │ · direct DL ≤15MB │  │ · Play + APK      │  │ product/ specs     │
   │  · PWA-install    │  │ · notarised/signd │  │ · App Store       │  │ 11 files, no trackr│
   └─────────┬─────────┘  └─────────┬─────────┘  └─────────┬─────────┘  └─────────┬──────────┘
             │ libSQL client         │ libSQL client         │ libSQL client         │ static (Vercel)
             └───────────┬───────────┴───────────┬──────────┴───────────┬──────────┘
                         │                       │                      │
                         ▼                       ▼                      ▼
   ┌─────────────────────────────────────────────────────────────────────────────────────┐
   │   TURSO CLOUD (per-user SQLite database — replicated, NOT shared)                    │
   │   ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐         │
   │   │  tutor_riya_db      │  │  tutor_kabir_db     │  │  tutor_menon_db     │  …      │
   │   │  (Nagpur, 40 stu)   │  │  (Indore, 180 stu)  │  │  (Mumbai, 12 stu)   │         │
   │   └──────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘         │
   │              │ sync (BR-SYN-02)        │                        │                   │
   │              ▼                         ▼                        ▼                   │
   │   ┌──────────────────────────────────────────────────────────────────────────────┐ │
   │   │  LOCAL SQLite (the actual source of truth at interaction time)               │ │
   │   │  · ledger_entries (append-only, BR-LED-01)  · receipts (P9 sacred)           │ │
   │   │  · students · batches · attendance · sync_outbox · audit_log                 │ │
   │   │  · 1 tenant = 1 local DB → zero cross-tenant leak (P5, §10.1)                │ │
   │   └──────────────────────────────────────────────────────────────────────────────┘ │
   └─────────────────────────────────────────────────────────────────────────────────────┘
             ↑ backups (.buddysaradhi encrypted file) flow OUT — never to a vendor cloud:
             │   email · Drive · pendrive · iCloud Drive — the tutor's choice (P10)
             ↓
   ┌─────────────────────────────────────────────────────────────────────┐
   │  .buddysaradhi ENVELOPE (AES-256-GCM + Argon2id, RFC 8439 + RFC 9100)    │
   │  · full per-user DB snapshot · portable · restore on any device     │
   └─────────────────────────────────────────────────────────────────────┘
```

- ↑ **No telemetry arrows.** The only outbound calls from app code are (a) Supabase OIDC, (b) Turso replication, (c) the user's chosen backup destination (`00_Vision.md §11.3`, `10_Security.md §17` TELE-1).
- ↑ **One codebase.** Next.js + Expo + Tauri share the `src/` tree; surface-specific adapters live in `web/`, `mobile/`, `desktop/` (P13 — boring tech, radical polish).
- ↑ **Sovereignty diagrammed.** The cloud is a replica, never the source of truth; the local SQLite holds the ledger, the receipts, the audit log (P4, P5, P10).

### 19.3 Mockup V2 — The 5 Screens + 7 Hidden Engines Map

```
FIVE SCREENS + SEVEN HIDDEN ENGINES (02_Core_Logic.md §1)
┌────────────────────────────────────────────────────────────────────────────────────┐
│  SHELL (cosmic canvas, persistent sidebar/header/footer)                           │
│  ┌─ Sidebar (.glass-strong) ────────┐  ┌─ Header (.glass-strong, sticky) ──────┐ │
│  │  ◈ Dashboard  👥 Students  ✓ Att │  │  🔍 ⌘K (Search Engine)   🔔 (Notif)  │ │
│  │  ₹ Fees      ⚙ Settings          │  │  ↑ .neumo-inset search tray (§8.10)  │ │
│  └──────────────────────────────────┘  └───────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─ 1. DASHBOARD ──────────────┐  ┌─ 2. STUDENTS ────────────┐                     │
│  │ KPI cards (.glass, §8.1)    │  │ List (.glass-faint rows) │                     │
│  │ Heatmap (.glass)            │  │ Drawer (.glass-strong)   │                     │
│  │ Activity feed (.glass)      │  │ Reminder queue chip      │                     │
│  └─────────────────────────────┘  └──────────────────────────┘                     │
│  ┌─ 3. ATTENDANCE ─────────────┐  ┌─ 4. FEES & PAYMENTS ─────┐                     │
│  │ Batch roster (.glass-faint) │  │ Ledger view (.glass)     │                     │
│  │ Mark buttons (.neumo-raise) │  │ Receipt modal (.glass+)  │                     │
│  │ Toggle (.neumo-inset, §6.4) │  │ Void cascade             │                     │
│  └─────────────────────────────┘  └──────────────────────────┘                     │
│  ┌─ 5. SETTINGS ───────────────┐                                                   │
│  │ Profile · Theme · Backups   │   ← Backups modal = .glass-strong (§8.7)         │
│  │ Import/Export · Quiet hours  │   ↑ typed-EXPORT confirm input = .neumo-inset   │
│  │ Sync · Reset device          │     (§8.9, AP-13)                                │
│  └─────────────────────────────┘                                                   │
└────────────────────────────────────────────────────────────────────────────────────┘
                              │ invoked by all 5 screens, never own a tab
                              ▼
   ┌─ 7 HIDDEN ENGINES (verbs; screens are nouns) ──────────────────────────────────┐
   │  E1 Search     — ⌘K palette on every screen  (02_Core_Logic.md §4.1)            │
   │  E2 Reminder   — Dashboard feed + Fees screen (07_Fees §8)                      │
   │  E3 Ledger     — Fees derived balances         (12_Business_Rules §2)           │
   │  E4 Report     — Dashboard + Fees export       (04_Dashboard §6)                │
   │  E5 Notification — toast (in-app) + v1.x push  (08_Settings §5)                 │
   │  E6 Sync       — invisible background          (10_Security §6)                 │
   │  E7 Security   — PIN/biometric on mutation     (10_Security §3)                 │
   └─────────────────────────────────────────────────────────────────────────────────┘
```

- ↑ **The two-tap rule (P3).** Any primary action is ≤ 2 taps via the sidebar (geography) or ⌘K palette (teleport). The sidebar is `.glass-strong` persistent chrome (§5.5).
- ↑ **Engines have no tab (§6.1).** Search lives in the header as a `.neumo-inset` tray (§8.10); Reminder surfaces as chips on Dashboard/Fees; Ledger is a derived view, not a screen.
- ↑ **Modal-stack ceiling = 2 (AP-15).** No screen grows a 3rd-level modal — that is a 6th screen in disguise (P2, `13_UI_Guidelines.md` §8.7).

### 19.4 Mockup V3 — Persona → Platform Matrix (who uses what, where)

```
PERSONA × PLATFORM × SCREEN MATRIX
                                │  Web  │ macOS │ Win   │ Android│ iOS   │ Primary surface
   ┌────────────────────────────┼───────┼───────┼───────┼────────┼───────┼────────────────┐
   │ P4.1 Riya (Solo Maths,     │  2nd  │  —    │  —    │  1st   │  3rd  │ Android phone  │
   │       Nagpur, 40 students) │       │       │       │        │       │ (mid-range)    │
   ├────────────────────────────┼───────┼───────┼───────┼────────┼───────┼────────────────┤
   │ P4.2 Kabir (Science Centre │  1st  │  2nd  │  —    │  3rd   │  —    │ Web (laptop)   │
   │       3 teachers, 180 stu) │       │       │       │        │       │ + Android (sv) │
   ├────────────────────────────┼───────┼───────┼───────┼────────┼───────┼────────────────┤
   │ P4.3 Menon (Premium Home,  │  2nd  │  1st  │  —    │  —     │  3rd  │ macOS (home)   │
   │       South Mumbai, 12 stu)│       │       │       │        │       │ + iOS (mobile) │
   ├────────────────────────────┼───────┼───────┼───────┼────────┼───────┼────────────────┤
   │ P4.4 Vikram (Academy Kota, │  —    │  —    │  —    │  —     │  —    │ OUT OF v1      │
   │       600 stu, 2 branches) │       │       │       │        │       │ (v2.0 Team)    │
   ├────────────────────────────┼───────┼───────┼───────┼────────┼───────┼────────────────┤
   │ Anti-persona (EdTech ops)  │  —    │  —    │  —    │  —     │  —    │ ASKED TO LEAVE│
   └────────────────────────────┴───────┴───────┴───────┴────────┴───────┴────────────────┘

   Top screen per persona (from §5 Day-in-the-Life):
     Riya   → Dashboard (05:50) → Attendance (06:15) → Fees (09:30) → Dashboard (21:45)
     Kabir  → Fees & Payments (multi-tutor reconcile) → Students (filter by co-tutor)
     Menon  → Students (12 students, 1-on-1) → Fees (monthly statement PDF)
   ↑ North-star: every persona closes the app in ≤ 7 min/day (§14).
```

- ↑ **Mobile-first for the solo tutor (Riya).** Mid-range Android (Redmi Note 12 class) is the floor hardware — 55fps during 100-student attendance mark is success criterion #5 (§13.1).
- ↑ **Desktop for the institute owner (Kabir, Menon).** Tauri ≤15 MB installer, keyboard parity (`G D / G S / G A / G F / G T`), data-density without grey monotony (§9.1, §8 inheritance).
- ↑ **Sovereignty is persona-agnostic.** All four in-scope personas sync to their own per-user Turso DB; none has a "shared" surface in v1 (§10.1).

### 19.5 Mockup V4 — Single-Tenant Sovereignty Trust Boundary

```
TRUST BOUNDARY — "the tutor is the user, the student is a record, the parent is a guest" (P1, P14)
                                  │
   ┌──────────────────────────────┴────────────────────────────────┐
   │  TUTOR-TRUST ZONE (full read/write, biometric/PIN gated)       │
   │  ┌──────────────────────────────────────────────────────────┐ │
   │  │  Local device                                           │ │
   │  │  ┌─ App shell ─────────────────────────────────────┐     │ │
   │  │  │  5 screens · 7 engines · ledger · receipts      │     │ │
   │  │  │  PIN/biometric challenge (10_Security §3)       │     │ │
   │  │  │  ↑ sensitive mutations only (AP-12, BR-LED-05)  │     │ │
   │  │  └─────────────────────────────────────────────────┘     │ │
   │  │  ┌─ SQLite (the truth) ───────────────────────────┐      │ │
   │  │  │  ledger_entries · receipts · audit_log         │      │ │
   │  │  │  sync_outbox (BR-SYN-02, AP-13)                │      │ │
   │  │  └────────────────┬────────────────────────────────┘      │ │
   │  └───────────────────┼───────────────────────────────────────┘ │
   └──────────────────────┼──────────────────────────────────────────┘
                          │ replication transport (not a request dependency — P5)
                          ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  TURSO CLOUD REPLICA (tutor-owned namespace, not shared)         │
   │  · pull/push every network transition + 5 min foreground         │
   │  · CRDT-lite LWW + vector clocks (§10.3)                         │
   │  · ledger is conflict-free by construction (UUID append-only)    │
   └────────────────────────────┬─────────────────────────────────────┘
                                │ signed URL (HMAC, 7-day expiry, P14)
                                ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  PARENT GUEST ZONE (read-only, no account, no local DB)          │
   │  ┌─ Signed statement link ────────────────────────────────────┐ │
   │  │  · views ONE receipt/monthly statement                      │ │
   │  │  · no log-in (AP-8 forbids parent accounts in v1)           │ │
   │  │  · URL expires; can be revoked by tutor from Students scrn  │ │
   │  └──────────────────────────────────────────────────────────────┘ │
   └──────────────────────────────────────────────────────────────────┘
   ✕ NO telemetry · ✕ NO analytics SDK · ✕ NO vendor "AI" trained on tutor data
   ✕ NO account required for offline use · ✕ NO remote feature flags exfiltrating state
   ↑ enforced by 10_Security.md §17 (TELE-1) and lint rule no-indigo-accent / no-telemetry
```

- ↑ **P1 boundary.** The tutor authenticates; the student is a row in `students`; the parent is a bearer of an HMAC token. No parent auth user exists in Supabase (AP-8).
- ↑ **P5 boundary.** Everything inside the tutor-trust zone works in airplane mode. The cloud arrow is replication, not request — there is no read-path that depends on the network (`00_Vision.md §11.1`).
- ↑ **P10 boundary.** The `.buddysaradhi` backup file lives where the tutor puts it; we have no vendor-side copy.

---

## 20. Companion Documents

| Doc | Answers |
|------|---------|
| `01_Product_Principles.md` | *How* we decide what to build. |
| `02_Core_Logic.md` | The five screens + seven hidden engines. |
| `03_User_Flows.md` | The golden paths a tutor walks. |
| `04_Dashboard.md` → `09_Backup…` | Per-screen deep specifications. |
| `10_Security.md` | Trust model, locking, encryption. |
| `11_Data_Model.md` | Turso schema — the immutable core. |
| `12_Business_Rules.md` | Fee logic, ledger rules, attendance rules. |
| `13_UI_Guidelines.md` | The Vibrant Glass design system. |
| `14_Edge_Cases.md` | Everything that will go wrong, and how we behave. |
| `15_Future_Roadmap.md` | What v1.x and v2 unlock. |
| `AGENTS.md` | Directives for AI coding agents operating on this repo. |
| `product/README.md` | The commercial front-door spec — what `buddysaradhi.in` says and how it converts. |
| `web/` · `mobile/` · `desktop/` · `deployment/` | Per-platform implementation + deployment specs. |
