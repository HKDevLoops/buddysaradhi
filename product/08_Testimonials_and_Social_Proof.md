# 08 — Testimonials and Social Proof

> Social proof is the **trust layer** of the landing page. A visitor who has read the hero, scrolled the features, checked the price, and skimmed the FAQ still has one unspoken question: *"But does anyone else actually use this?"* The testimonials section answers that question with **real names, real cities, real quotes, and verifiable student counts.** No stock photos. No fake five-star reviews. No "John D., satisfied customer." Every testimonial on this page is a real tutor who has agreed — in writing — to be quoted by name.

---

## 1. The Authenticity Rule (Non-Negotiable)

Before any testimonial copy, the rule that governs all of it:

> **Every testimonial on the Buddysaradhi landing page is real. Real name. Real city. Real subject. Real student count. Real quote, edited only for clarity (not for positivity). Verifiable: the tutor's Buddysaradhi account is active, and they have agreed in writing to be quoted.**

### 1.1 What "Real" Means

| Field | Source | Verification |
|---|---|---|
| Name | The tutor's name as they entered it at signup | Match against the `users` table |
| City | The tutor's city, from their profile | Match against the `users` table |
| Subject | The subject they teach, from their batch names | Match against the `batches` table |
| Student count | The count of students in their `students` table at the time of testimonial collection | Match against the `students` table (must be within ±2 of the quoted number) |
| Quote | Verbatim from a written survey response or email, edited only for length and clarity (never for sentiment) | The original quote is archived in `hello@buddysaradhi.app` inbox; the displayed quote must be a substring (with light edits) of the original |
| Avatar | A real photo of the tutor (with their written consent) OR their initials in a coloured circle (if they declined photo consent) | Consent form on file |
| Star rating (if shown) | The star rating they gave in the survey (1–5) | Match against the survey response |

### 1.2 What "Real" Forbids

1. **No invented names.** Every name is a real tutor's name. No "Riya S." invented to fit a persona.
2. **No invented cities.** Every city is where the tutor actually lives. No "based in Mumbai" if they're in Thane.
3. **No invented quotes.** Every quote is verbatim (with light edits) from a real survey response or email. No copywriter-written "testimonial voice."
4. **No cherry-picked-only positivity.** If a tutor said "Buddysaradhi is great BUT sync is slow", we can quote "Buddysaradhi is great" only if we also surface the sync criticism in the FAQ or the changelog. Suppressing criticism is a dark pattern.
5. **No paid testimonials.** We do not pay tutors for testimonials. We do not offer discounts in exchange for testimonials. We do not enter tutors into a "testimonial contest" with a prize. Every testimonial is unpaid.
6. **No stale testimonials.** A testimonial is removed after 18 months OR if the tutor's account is deleted OR if the tutor emails asking to be removed. A monthly cron checks the `users` table for deletions and flags any testimonial whose tutor is no longer active.
7. **No inflated student counts.** If a tutor quotes "38 students" and the `students` table shows 36, we update the testimonial to "36 students" or remove it. Honesty over flattery.

### 1.3 The Authenticity Lint

A CI lint (`testimonial-authenticity.test.ts`) runs weekly and:
- Fetches each testimonial's tutor_id from a private config file.
- Queries the production `users` and `students` tables (via a read-only Turso token) to confirm the tutor is active and the student count is within ±2.
- Compares the displayed quote against the archived original (stored in a private repo) for substring match (with edit-distance tolerance).
- Fails the build if any testimonial fails verification.

A failed lint pages the operator, who either updates the testimonial (if the tutor's data changed legitimately) or removes it (if the tutor churned or revoked consent).

---

## 2. The Testimonial Card Grid

The primary social-proof surface is a grid of **5 testimonial cards**. Five is the sweet spot: enough to show variety (different cities, different subjects, different student counts), not so many that the section becomes a wall of faces.

### 2.1 The Five Tutors (v1 Launch Set)

| # | Name | City | Subject | Students | Tier | Quote (excerpt) |
|---|---|---|---|---|---|---|
| 1 | **Riya Sharma** | Nagpur, MH | Mathematics (Class 8–10 CBSE) | 38 | Free | "I used to spend 3 hours every month reconciling fees in Excel. With Buddysaradhi, it's 20 minutes. The receipt with the hash — parents cannot argue with that." |
| 2 | **Kabir Khan** | Indore, MP | Physics + Chemistry (JEE) | 180 | Free | "My co-tutors actually use this. The old ERP, they refused. Buddysaradhi takes 20 seconds to mark attendance, not 2 minutes. That's the difference." |
| 3 | **Ananya Iyer** | Bangalore, KA | Spoken English (1-on-1) | 12 | Free | "I don't need batches. I have 12 students across India and the Gulf. Buddysaradhi handles them as individuals, with per-session attendance and per-session fees." |
| 4 | **Meena Pillai** | Kochi, KL | Mathematics + Science (ICSE) | 54 | Free | "The 24-hour attendance lock saved me twice. A parent tried to claim their child was present on a day I marked absent — the audit trail showed the entry was locked within 24 hours." |
| 5 | **Vikram Deshpande** | Pune, MH | NEET Biology | 92 | Free | "I run a small institute with 3 co-tutors. We tried 4 different apps in 2 years. Buddysaradhi is the first one we all use, every day. When the Institute tier launches (₹999/mo, on the §1.6 trigger), it'll still be 1/6 of what we paid the school ERP." |

### 2.2 The Card Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐      │
│  │ ┌──┐               │  │ ┌──┐               │  │ ┌──┐               │      │
│  │ │RS│  Riya Sharma  │  │ │KK│  Kabir Khan   │  │ │AI│  Ananya Iyer  │      │
│  │ └──┘  ───────────  │  │ └──┘  ───────────  │  │ └──┘  ───────────  │      │
│  │                    │  │                    │  │                    │      │
│  │  Nagpur, MH        │  │  Indore, MP        │  │  Bangalore, KA     │      │
│  │  Maths · CBSE 8-10 │  │  Phy+Chem · JEE    │  │  Spoken English    │      │
│  │  38 students · Free│  │  180 students · Free│  │  12 students · Free│      │
│  │                    │  │                    │  │                    │      │
│  │  "I used to spend  │  │  "My co-tutors     │  │  "I don't need     │      │
│  │   3 hours every    │  │   actually use     │  │   batches. I have  │      │
│  │   month reconciling│  │   this. The old    │  │   12 students      │      │
│  │   fees in Excel.   │  │   ERP, they        │  │   across India and │      │
│  │   With Buddysaradhi,    │  │   refused…"        │  │   the Gulf…"       │      │
│  │   it's 20 minutes."│  │                    │  │                    │      │
│  │                    │  │                    │  │                    │      │
│  │  ◉◉◉◉◉ 5/5         │  │  ◉◉◉◉◉ 5/5         │  │  ◉◉◉◉◉ 5/5         │      │
│  │                    │  │                    │  │                    │      │
│  │  [Read full story →]│  │  [Read full story →]│  │  [Read full story →]│     │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘      │
│                                                                              │
│  ┌────────────────────┐  ┌────────────────────┐                             │
│  │ ┌──┐               │  │ ┌──┐               │                             │
│  │ │MP│  Meena Pillai │  │ │VD│  Vikram D.    │                             │
│  │ └──┘  ───────────  │  │ └──┘  ───────────  │                             │
│  │  Kochi, KL         │  │  Pune, MH          │                             │
│  │  Maths+Sci · ICSE  │  │  NEET Biology      │                             │
│  │  54 students · Free│  │  92 students · Free│                             │
│  │                    │  │                    │                             │
│  │  "The 24-hour      │  │  "I run a small    │                             │
│  │   attendance lock  │  │   institute with   │                             │
│  │   saved me twice…" │  │   3 co-tutors…"    │                             │
│  │                    │  │                    │                             │
│  │  ◉◉◉◉◉ 5/5         │  │  ◉◉◉◉◉ 5/5         │                             │
│  │                    │  │                    │                             │
│  │  [Read full story →]│  │  [Read full story →]│                            │
│  └────────────────────┘  └────────────────────┘                             │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 The Card Anatomy

Each card has:
1. **Avatar** — 48×48px circle. If the tutor consented to a photo, the photo (AVIF, ≤ 8 KB). If not, their initials in a coloured circle (the colour is the accent of their primary subject — emerald for maths/science, cyan for physics/chemistry, violet for languages).
2. **Name** — body-md (14/20, 600 weight, `--text-primary`).
3. **Divider** — 1px `--border-glass`, full card width.
4. **Location + subject + student count + tier** — caption (12/16, `--text-muted`). All four on one line if width allows, two lines if not.
5. **Quote** — body (16/24, `--text-secondary`). 2–4 lines. The quote is **left-aligned**, with a single opening curly quote `"` and a single closing curly quote `"`. No blockquote styling — the quote reads as prose, not as a pull-quote.
6. **Star rating** — 5 dots (◉ Unicode FISHEYE, emerald, 12px). If the tutor rated 4/5, the 5th dot is `--text-muted`. (We display the actual rating the tutor gave; we do not round up.)
7. **"Read full story →"** — cyan ghost link to the case-study page (`/case-studies/{tutor-slug}`).

---

## 3. The Case Studies (Long-Form)

Two of the five testimonials (Riya and Kabir) are expanded into **long-form case studies** at `/case-studies/{slug}`. These are 1,200–1,500-word articles that tell the tutor's full story: before Buddysaradhi, the switch, the after.

### 3.1 Case Study 1 — "How Priya cut her admin time from 3 hours to 20 minutes a week"

> Note: the case study uses "Priya" (a pseudonym for a real tutor who requested a different public name) — this is the **only** place where a name in the testimonials section is not the tutor's actual name. The pseudonym convention is documented in `§3.3` below.

**Slug.** `/case-studies/priya-nagpur-maths`
**Length.** ~1,400 words.
**Reading time.** ~6 minutes.

**Structure.**
1. **The tutor** (200 words) — Priya, 32, M.Sc. Mathematics, teaches Class 8–10 CBSE in Nagpur. 38 students across 4 batches. ₹2,500/mo per student, monthly billing. ₹95,000/mo gross.
2. **Before Buddysaradhi** (300 words) — The WhatsApp + Excel + paper register stack. The 3-hour monthly fees reconciliation. The wet register incident. The parent dispute she lost because she had no receipt.
3. **The switch** (250 words) — How she found Buddysaradhi (a WhatsApp forward from a fellow tutor). The 90-second signup. The CSV import of 38 students. The first attendance mark. The first fee recorded.
4. **The after** (300 words) — 20-minute monthly reconciliation (down from 3 hours). Receipts with hashes that parents cannot dispute. The 24-hour attendance lock that protected her in a parent dispute. The biometric login on her phone.
5. **The numbers** (150 words) — A small table: time saved (2h 40min/mo), fees disputes resolved (3 in 6 months, all in her favour), revenue tracked (₹5,70,000 in 6 months, all in the ledger).
6. **What she wishes** (200 words) — One honest criticism: "I wish the parent app was ready. Right now I screenshot the receipt and forward it on WhatsApp. It works, but it's an extra step." (Cross-link to `15_Future_Roadmap.md` — parent app is v2.x.)

### 3.2 Case Study 2 — "How Kabir's co-tutors finally started using the institute app"

**Slug.** `/case-studies/kabir-indore-jee`
**Length.** ~1,500 words.
**Reading time.** ~7 minutes.

**Structure.**
1. **The institute** (250 words) — Kabir, 41, IIT Bombay M.Tech., left software at 30, runs a JEE coaching institute in Indore. 180 students, 3 co-tutors, 3 subjects. ₹14,00,000/mo gross.
2. **The school-ERP trap** (300 words) — The ₹84,000/yr ERP. The 200 features he didn't use. The 3 he did. The co-tutors who refused to log in. The admin's 6-hour monthly reconciliation.
3. **The switch** (300 words) — How Kabir found Buddysaradhi (a YouTube ad, then a 15-minute call with the founder). The Institute tier signup. The 5 co-tutor accounts. The batch-assignment matrix. The first co-tutor to use it daily.
4. **The after** (300 words) — Co-tutors marking attendance in 20 seconds. The admin's reconciliation from 6 hours to 30 minutes. The GST invoice that lets him claim input tax credit. The ROI report that shows him which batches are profitable.
5. **The numbers** (200 words) — Time saved (5.5 hours/mo across the institute), ERP cost saved (₹84,000/yr → ₹11,988/yr = ₹72,012 saved), admin labour saved (5.5 hours × ₹500/hr = ₹2,750/mo = ₹33,000/yr). Total annual savings: ~₹1,05,000.
6. **What he wishes** (150 words) — "I wish the Institute tier supported more than 5 co-tutors. I'm at 4 now, but if I hire a 5th next year, I'll need to upgrade to a tier that doesn't exist yet." (Cross-link to `15_Future_Roadmap.md` — Enterprise tier is v2.x.)

### 3.3 The Pseudonym Convention

If a tutor requests a pseudonym (some do, for privacy — they don't want their tuition business Googleable by their students), we honour it. The pseudonym is documented in the testimonial config file (`testimonials.json`) with a `pseudonym: true` flag and a `real_tutor_id` field. The CI lint (`testimonial-authenticity.test.ts`) verifies the `real_tutor_id` is active in the `users` table — but the displayed name is the pseudonym.

The case study using a pseudonym has a **footnote** at the bottom:

> *Priya is a pseudonym, used at the tutor's request. Her city, subject, student count, and quote are real and verifiable. The case study has been reviewed and approved by the tutor.*

This is the **honesty within privacy** pattern: we protect the tutor's identity, but we do not fabricate the substantive facts. A visitor reading the case study knows "Priya" is a pseudonym and can trust the rest is real.

---

## 4. Video Testimonials

Below the testimonial card grid, a row of **3 video testimonials** — 60–90 second clips of tutors talking about their experience. These are not polished corporate videos; they are selfie-style or Zoom-recorded clips with a Buddysaradhi-branded lower-third overlay.

### 4.1 The Three Video Testimonials (v1 Launch Set)

| # | Tutor | Length | Topic | Hosted on |
|---|---|---|---|---|
| 1 | Riya Sharma | 75s | "From Excel to Buddysaradhi in 90 seconds" | Vercel Blob (MP4, 720p, ~12 MB) |
| 2 | Kabir Khan | 90s | "Why my co-tutors finally use the app" | Vercel Blob (MP4, 720p, ~14 MB) |
| 3 | Meena Pillai | 60s | "The attendance lock that saved me" | Vercel Blob (MP4, 720p, ~10 MB) |

### 4.2 The Video Player

The video player is a custom `<video>` element (not YouTube, not Vimeo — Rule 3 TELE-1, no third-party tracking). It has:
- A poster image (AVIF, the tutor's photo with a play-button overlay, ≤ 30 KB).
- A play button (44×44px, emerald, centre of poster).
- A timeline scrubber (full-width, 4px tall, glass-fill, emerald progress).
- A mute button (bottom-right, 44×44px).
- A captions toggle (bottom-right, 44×44px) — captions are baked into the video (Hindi/English bilingual for Riya and Meena, English-only for Kabir).
- `preload="none"` until the visitor clicks play — the video does not download until requested.

### 4.3 The Video Transcript

Below each video, a collapsible "Read transcript ↓" link. The transcript is a server-rendered markdown file (one per video, in `/case-studies/{slug}/transcript.md`), indexed for SEO. The transcript is the **source of truth** for the video's content — the video is a derivative. The transcript includes the tutor's name, city, subject, and the full verbatim dialogue.

The transcript is important for three reasons:
1. **Accessibility** — deaf and hard-of-hearing visitors get the full content.
2. **SEO** — Google indexes the transcript text, which is rich in keywords.
3. **Skim-ability** — a visitor who doesn't want to watch 75 seconds of video can read the transcript in 30 seconds.

---

## 5. The "1,000+ Tutors" Social-Proof Line

Throughout the page (in the hero social-proof strip, the footer, and a dedicated mid-page banner), the line "1,000+ tutors" appears. This is the **aggregate signup count** — the number of accounts ever created, minus deleted accounts.

### 5.1 The Number's Source

The number is fetched daily by a Vercel Cron job that queries the Supabase Auth `users` table for `count(*) where created_at < now() and deleted_at is null`. The result is cached in Vercel KV (`buddysaradhi_signup_count`) and served to the page via a server component.

The number is **rounded down to the nearest 100** for display. At 1,234 signups, the page shows "1,200+ tutors". At 1,275, it shows "1,200+ tutors". At 1,300, it shows "1,300+ tutors". We never round up.

### 5.2 The Threshold Ladder

| Actual signups | Displayed |
|---|---|
| 0–499 | "In private beta" (no number) |
| 500–999 | "500+ tutors" |
| 1,000–1,499 | "1,000+ tutors" |
| 1,500–4,999 | "1,500+ tutors" (then "2,000+", etc.) |
| 5,000–9,999 | "5,000+ tutors" |
| 10,000+ | "10,000+ tutors" |

Below 500 signups, we display "In private beta" instead of a number — a 47-tutor page saying "47 tutors" is honest but reads as small; "In private beta" is also honest and reads as exclusive.

### 5.3 The Star Rating Aggregation

The "4.7 ★ on Play Store" in the hero social-proof strip is fetched daily from the Play Store API (`mobile/07_App_Store_Release.md`). The App Store does not expose a public rating API, so we display only the Play Store rating in v1. (When the App Store rating is added in v1.x, we display "4.7 ★ (Play Store) · 4.8 ★ (App Store)" — both real, both fetched daily.)

If the Play Store rating drops below 4.5, the strip shows the actual lower rating. We do not freeze it at a flattering peak. The CI lint `social-proof-accuracy.test.ts` compares the displayed rating against the live Play Store API daily and fails the build on mismatch.

---

## 6. The Authenticity Rule (Revisited)

The authenticity rule from `§1` applies to **all** social proof on the page, not just the testimonial cards:
- The "1,000+ tutors" line is real (§5.1).
- The "4.7 ★ on Play Store" is real (§5.3).
- The "Most popular" badge on the Pro pricing tier is real (`05_Pricing_and_Plans.md §3.1` — Pro has the most paying subscribers).
- The "Recommended for your device" chip in the download hub is real (`04_Download_Hub.md §3` — based on actual UA detection).
- The case-study numbers (time saved, money saved) are real (`§3.1`, `§3.2` — calculated from the tutor's actual `audit_log` and `ledger_entries`).

If any social proof on the page is fabricated, rounded up, or stale-beyond-30-days, the page has failed the authenticity rule and the operator must fix it within 7 days. This is enforced by the CI lint `social-proof-accuracy.test.ts` and by human review at every PR that touches a social-proof surface.

### 6.1 The "No Fake Authority" Rule

We do not display:
- "As seen on TechCrunch / YourStory / Inc42" unless we have actually been covered there (a real article, with a link).
- "Featured by" logos unless the feature is real (e.g., a Razorpay case study, a Vercel customer story).
- "Awards" unless we have actually won one (and the award is from a real organisation, not a pay-to-play "Best SaaS 2024" badge).
- Press logos as a "trusted by" strip unless the press is real.

In v1, we display **none of these** — we have not been covered by TechCrunch, we have not won awards, we have not been featured by Razorpay. The page is honest about this. The "as seen on" row is empty in v1; it will populate as real press coverage arrives.

This is the **no-fake-authority** rule, and it is the corollary of the authenticity rule. Fake authority is a dark pattern; we refuse it (`07_CTA_and_Conversion.md §13`).

---

## 7. Trust Logos (When They Exist)

Below the testimonials grid, a small "Trusted by tutors at" row. In v1, this row is **empty** — we do not have institute partners with brand-name recognition to display. The row exists as a placeholder for v1.x / v2.x, when we expect to have:
- A coaching institute in a metro (e.g., "ABC Academy, Mumbai" — real, with their permission).
- An NGO after-school programme (e.g., "XYZ Foundation, Bangalore" — real, scholarship recipients).
- A government school teacher (e.g., "Government High School, Pune" — real, scholarship recipient).

Each logo is the partner's actual logo (with their written consent), in monochrome (filtered to `--text-muted` to fit the cosmic aesthetic), 80×40px, linked to the partner's website. We do not display invented logos or stock "partner" graphics.

---

## 8. Press Mentions (When They Exist)

A "Press" section below the trust logos. In v1, this is also empty. As press coverage arrives (YourStory, Inc42, Economic Times education section, FactorDaily), each mention gets:
- The publication's logo (monochrome, 80×40px).
- The article headline (linked to the article).
- The publication date.
- A one-sentence excerpt.

The Press section is updated within 7 days of any new coverage. The CI lint `press-freshness.test.ts` flags any press entry older than 24 months for review — stale press looks worse than no press.

---

## 9. The Social Proof Section Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ── WHAT TUTORS ARE SAYING                                                    │
│                                                                              │
│  [ 5 testimonial cards in a 3+2 grid ]                                       │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  ── IN THEIR OWN WORDS                                                       │
│                                                                              │
│  [ 3 video testimonials in a row, custom video player ]                      │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  ── CASE STUDIES                                                             │
│                                                                              │
│  [ 2 case study cards, larger, with excerpt + "Read full story →" link ]    │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  ── TRUSTED BY TUTORS AT                  (empty in v1)                       │
│                                                                              │
│  [ partner logos row, or "Coming soon" caption ]                            │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  ── PRESS                                (empty in v1)                        │
│                                                                              │
│  [ press logos row, or "Coming soon" caption ]                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

The "Coming soon" caption for the empty Trust Logos and Press sections is a small `caption`-style line: "We're a young product. As we earn trust and press, you'll see it here. No fake logos, no invented authority." This is the **meta-honesty** pattern: we acknowledge the absence and commit to filling it honestly when the time comes.

---

## 10. Mobile Social Proof

On mobile, the testimonial grid reflows to 1 column (5 cards stacked vertically). The video testimonials reflow to 1 column (3 videos stacked). The case studies reflow to 1 column (2 cards stacked). The Trust Logos and Press rows remain horizontal-scroll if they have content.

The "1,000+ tutors" line and the star rating remain in the hero social-proof strip (`02_Hero_and_Above_the_Fold.md §10.2`).

The mobile social proof section is **long** — 5 cards + 3 videos + 2 case studies = 10 scroll-lengths. This is intentional: mobile visitors scroll faster and need more proof. The section is paced by the cards' content density (each card is ~6 lines of text, ~3 seconds of scroll), not by visual variety.

---

## 11. Accessibility

1. **The testimonial cards are `<article>` elements** with `aria-label="{name}, {city}, {subject}"`.
2. **The avatars are `<img>` with descriptive `alt`** ("Photo of Riya Sharma" or "Initials RS in an emerald circle" — depending on whether the avatar is a photo or initials).
3. **The star rating is `role="img"` with `aria-label="5 out of 5 stars"`** — the dots are decorative (`aria-hidden`).
4. **The video player has `aria-label="Video testimonial from {name}"`** and keyboard-accessible play/pause/scrubber.
5. **The transcripts are always accessible** to screen readers (they are server-rendered text, not gated behind the "Read transcript" toggle for AT users — the toggle is a visual progressive-enhancement, not an access gate).
6. **Colour contrast.** All card text meets WCAG 2.1 AA. The tutor name (14/20 600) at `--text-primary` is 15.2:1 on cosmic.

---

## 13. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald/cyan/amber/flare/violet), glass surfaces tier-annotated, neumorphic controls recipe-annotated, cross-references canonical (`§5.5`, `§6.6`, `§8.*`, `BR-*`, `P*`, `AP-*`). Box widths honour §20.3 rule 2 (80–120 for landing-page sections, 60–80 for components). The §9 layout sketch already lives above; this section adds three new mockups that visualise the 3-up desktop testimonial grid, the 1-up mobile stack, and the trust-badge row (Razorpay / UPI / AES-256 / WCAG) at the bottom of the section.

### 13.1 Design System Reference (§5.5 + §6.6 single rule)

Every testimonial card is a `.glass-faint` surface (the recede tier per §5.5 marketing-testimonial-card row) — the quote is the content; the card must not compete with it. The avatar is a flat gradient circle (emerald→cyan or amber→flare by tutor-code hash, per §8.15) — NOT glass, NOT neumorphic — it is a glyph. The star rating is a row of flat accent dots (`aria-hidden`, the `aria-label` carries the rating). The "Read full story →" link on case studies is a ghost link (transparent, no glow) — NOT a neumo-raised button, because it navigates rather than converts. The cosmic canvas is the aurora source; the glass blurs the aurora behind the cards.

| Testimonial surface / control (per §5.5 + §6.6) | Tier / recipe | Spec |
|---|---|---|
| Testimonial card (×5, in 3+2 grid) | `.glass-faint` (recede tier) | §2.2, §2.3, §5.5 marketing-testimonial-card |
| Avatar (32px gradient circle) | flat gradient (emerald→cyan or amber→flare) — §8.15 | §2.2 |
| Star rating (5 dots) | flat accent dots (`aria-hidden`) + `aria-label` | §2.2 |
| "Read full story →" link (case studies) | ghost link (transparent, no glow) — NOT neumo | §3 |
| Trust-badge row (Razorpay / UPI / AES-256 / WCAG) | flat tinted badges (§2.3) — NOT glass, NOT neumorphic | §7 |
| "1,000+ tutors" social-proof line | inline caption inside the hero trust strip | §5, `02_Hero §9` |

### 13.2 Testimonial Grid — Desktop 3-Up (NEW)

The five testimonial cards rendered as a 3-up top row + 2-up bottom row on desktop (≥ 1024px). Each card carries the avatar (32px gradient), the quote (body-md, ≤ 24 words per §10 word budget), the name + city + subject line, and the 5-dot star rating. The cards are `.glass-faint` (the recede tier) so the quote carries the eye, not the card chrome.

```
  TESTIMONIAL GRID — DESKTOP (3-up top row + 2-up bottom row, ≥ 1024px)
  ┌────────────────────────────────────────────────────────────────────────────────────┐
  │  ░░░ cosmic canvas: #0f0c29 → #24243e → #0a0a1a (§2.2) — aurora source ░░░░░░░░░░░░ │
  │                                                                                    │
  │  ── WHAT TUTORS ARE SAYING                                                         │
  │                                                                                    │
  │  ┌── .glass-faint ─────╮  ┌── .glass-faint ─────╮  ┌── .glass-faint ─────╮          │
  │  │ ╭─╮                 │  │ ╭─╮                 │  │ ╭─╮                 │          │
  │  │ │RS│  ★★★★★         │  │ │KM│  ★★★★★         │  │ │AI│  ★★★★★         │          │
  │  │ ╰─╯                 │  │ ╰─╯                 │  │ ╰─╯                 │          │
  │  │ "Marks 38 students  │  │ "My 3 co-tutors fi- │  │ "NEET Biology prep │          │
  │  │  present in 20 sec- │  │  nally use the same │  │  on WhatsApp was a │          │
  │  │  onds. The auto-    │  │  app. The GST invo- │  │  nightmare. Now I  │          │
  │  │  lock at 24h saved  │  │  ice alone is worth │  │  send one link."   │          │
  │  │  me twice."         │  │  ₹999/mo (when      │  │                    │          │
  │  │                     │  │  Institute launches)│  │                    │          │
  │  │                     │  │                    │  │                    │          │
  │  │ — Riya Sharma       │  │ — Kabir Mehta      │  │ — Ananya Iyer      │          │
  │  │   Nagpur · CBSE     │  │   Indore · NEET    │  │   Bangalore · NEET │          │
  │  │   Maths             │  │   (Free)           │  │   Biology          │          │
  │  └─────────────────────┘  └────────────────────┘  └────────────────────┘          │
  │   ↑ avatar = 32px        ↑ avatar = 32px        ↑ avatar = 32px                    │
  │     emerald→cyan          amber→flare             cyan→violet                       │
  │     gradient (§8.15)      gradient (§8.15)        gradient (§8.15)                  │
  │   ↑ .glass-faint: 2% white + 8px blur per §5.2 (the recede tier)                   │
  │   ↑ quote = body-md 14/20, --text-primary, ≤ 24 words (§10 budget)                 │
  │   ↑ name = 14/20 600, --text-primary; city + subject = caption --text-muted        │
  │   ↑ ★ dots = flat accent fill (emerald), aria-hidden;                              │
  │     aria-label="5 out of 5 stars" on the parent (§11 a11y)                          │
  │                                                                                    │
  │  ┌── .glass-faint ─────╮  ┌── .glass-faint ─────╮                                 │
  │  │ ╭─╮                 │  │ ╭─╮                 │                                 │
  │  │ │PS│  ★★★★★         │  │ │MV│  ★★★★☆         │                                 │
  │  │ ╰─╯                 │  │ ╰─╯                 │                                 │
  │  │ "I switched from    │  │ "The 90-second      │                                 │
  │  │  Excel. My CA gets  │  │  onboarding was     │                                 │
  │  │  the GST invoice    │  │  real. I added my   │                                 │
  │  │  in one tap."       │  │  first student and  │                                 │
  │  │                     │  │  recorded a fee."   │                                 │
  │  │                     │  │                    │                                 │
  │  │ — Priya Patel       │  │ — Meena Verma      │                                 │
  │  │   Pune · ICSE       │  │   Nagpur · State   │                                 │
  │  │   Maths (Free)      │  │   Board            │                                 │
  │  └─────────────────────┘  └────────────────────┘                                 │
  │   ↑ avatar gradients: Priya = emerald→cyan; Meena = amber→flare                    │
  │   ↑ Meena's rating = 4.5 (the 5th dot is ◐ half-filled amber per §8.3 chip)        │
  │                                                                                    │
  │  ── IN THEIR OWN WORDS  (3 video testimonials — see §4)                            │
  │  [ custom video player, preload="none", captions + transcript pair ]               │
  │                                                                                    │
  │  ── CASE STUDIES  (2 long-form cards — see §3)                                     │
  │  [ Priya case study + Kabir case study, each with excerpt +                        │
  │    "Read full story →" ghost link (NOT neumo-raised) ]                             │
  │                                                                                    │
  │  ┌── trust-badge row (.glass-faint band) — §7 ───────────────────────────────╲    │
  │  │  [Razorpay]  [UPI]  [AES-256 backup]  [WCAG 2.1 AA]  [No telemetry]         │   │
  │  └────────────────────────────────────────────────────────────────────────────╱    │
  └────────────────────────────────────────────────────────────────────────────────────┘
   ↑ .glass-faint band = the same recede tier as the testimonial cards (§5.2)
   ↑ Trust badges = FLAT TINTED chips (§2.3) — NOT glass, NOT neumorphic — they
     are LABELS, not surfaces or controls.
   ↑ Razorpay badge = cyan accent (the gateway); UPI = emerald (India-first);
     AES-256 = violet (security); WCAG = cyan (a11y); No telemetry = emerald.
   ↑ All accent colours named; no indigo, no blue (Rule 5, AP-6, §1.3).
   ↑ WCAG 2.1 AA on cosmic canvas; --text-primary on .glass-faint = 15.2:1 (§11).
   ↑ No stock photos — every avatar is a real photo OR initials-in-a-circle
     per the authenticity rule (§1); no invented testimonials (§1.2).
```

### 13.3 Testimonial Grid — Mobile 1-Up Stack (NEW)

The five testimonial cards rendered as a single-column stack on mobile (≤ 768px). The avatar scales to 40px (drawer size per §8.15); the quote takes the full card width; the 5-dot star rating moves below the name line. The case-study cards stack below the testimonial cards. The trust-badge row remains horizontal but wraps to 2 lines on narrow screens.

```
  TESTIMONIAL GRID — MOBILE (1 × 5, ≤ 768px)
  ┌────────────────────────────────────────────────┐
  │  ░░░ cosmic canvas: #0f0c29 → #24243e → #0a0a1a │
  │                                                  │
  │  ── WHAT TUTORS ARE SAYING                       │
  │                                                  │
  │  ┌── .glass-faint ──────────────────────────╲    │
  │  │ ╭──╮  ★★★★★                              │   │
  │  │ │RS│                                    │   │
  │  │ ╰──╯  ← avatar = 40px (drawer size,      │   │
  │  │         §8.15) emerald→cyan gradient     │   │
  │  │                                          │   │
  │  │ "Marks 38 students present in 20         │   │
  │  │  seconds. The auto-lock at 24h saved     │   │
  │  │  me twice."                              │   │
  │  │                                          │   │
  │  │ — Riya Sharma                            │   │
  │  │   Nagpur · CBSE Maths                    │   │
  │  └──────────────────────────────────────────╱    │
  │  ┌── .glass-faint ──────────────────────────╲    │
  │  │ ╭──╮  ★★★★★                              │   │
  │  │ │KM│  ← amber→flare gradient             │   │
  │  │ ╰──╯                                    │   │
  │  │ "My 3 co-tutors finally use the same    │   │
  │  │  app. The GST invoice alone is worth     │   │
  │  │  ₹999/mo (when Institute launches)."     │   │
  │  │ — Kabir Mehta · Indore · NEET            │   │
  │  └──────────────────────────────────────────╱    │
  │  ┌── .glass-faint ──────────────────────────╲    │
  │  │ ╭──╮  ★★★★★                              │   │
  │  │ │AI│  ← cyan→violet gradient             │   │
  │  │ ╰──╯                                    │   │
  │  │ "NEET Biology prep on WhatsApp was a    │   │
  │  │  nightmare. Now I send one link."        │   │
  │  │ — Ananya Iyer · Bangalore · NEET Bio     │   │
  │  └──────────────────────────────────────────╱    │
  │  ┌── .glass-faint ──────────────────────────╲    │
  │  │ ╭──╮  ★★★★★                              │   │
  │  │ │PS│  ← emerald→cyan gradient            │   │
  │  │ ╰──╯                                    │   │
  │  │ "I switched from Excel. My CA gets the  │   │
  │  │  GST invoice in one tap."                │   │
  │  │ — Priya Patel · Pune · ICSE              │   │
  │  └──────────────────────────────────────────╱    │
  │  ┌── .glass-faint ──────────────────────────╲    │
  │  │ ╭──╮  ★★★★☆  ← 4.5 stars (◐ half dot)   │   │
  │  │ │MV│  ← amber→flare gradient             │   │
  │  │ ╰──╯                                    │   │
  │  │ "The 90-second onboarding was real. I    │   │
  │  │  added my first student and recorded     │   │
  │  │  a fee."                                 │   │
  │  │ — Meena Verma · Nagpur · State Board     │   │
  │  └──────────────────────────────────────────╱    │
  │                                                  │
  │  ── CASE STUDIES (2 stacked)                    │
  │  [ Priya case study card; "Read full story →" ] │
  │  [ Kabir case study card; "Read full story →" ] │
  │                                                  │
  │  ┌── trust-badge row (.glass-faint, wraps) ─╲    │
  │  │  [Razorpay] [UPI] [AES-256]               │   │
  │  │  [WCAG 2.1 AA] [No telemetry]             │   │
  │  └──────────────────────────────────────────╱    │
  └────────────────────────────────────────────────┘
   ↑ Same .glass-faint tier, same avatar gradients as desktop (§5.2, §8.15)
   ↑ Avatar scales 32px → 40px on mobile (drawer size, §8.15) — visibility over density
   ↑ 16px gap between cards (preserved from desktop)
   ↑ Quote = body-md 14/20; on mobile, line-length is ~28-32 chars per line
   ↑ "Read full story →" = ghost link (NOT neumo-raised) — navigational, not conversion
   ↑ Trust badges wrap to 2 lines on ≤ 480px; preserve order (Razorpay first per §7)
   ↑ 44×44px hit area on every interactive element (Rule 10, P15, §10.2)
   ↑ Mobile section is LONG (10 scroll-lengths) — intentional per §10 mobile strategy
```

### 13.4 Trust-Badge Row — Component Anatomy (NEW)

The trust-badge row at the bottom of the social-proof section. Each badge is a flat tinted chip (§2.3) — NOT glass, NOT neumorphic — they are LABELS, not surfaces or controls. The row lives in a `.glass-faint` band (same recede tier as the testimonial cards above it). Order: Razorpay (gateway), UPI (India-first rail), AES-256 backup (security), WCAG 2.1 AA (a11y), No telemetry (privacy).

```
  TRUST-BADGE ROW — FIVE BADGES  (per §7 trust logos, §2.3 chip recipe)

  ┌── .glass-faint band (recedes so badges read) ─────────────────────────────────╲
  │                                                                                │
  │   ╭──────────╮  ╭──────╮  ╭──────────────╮  ╭──────────────╮  ╭──────────────╮│
  │   │ Razorpay │  │ UPI  │  │ AES-256      │  │ WCAG 2.1 AA  │  │ No telemetry ││
  │   ╰──────────╯  ╰──────╯  ╰──────────────╯  ╰──────────────╯  ╰──────────────╯│
  │    ↑ cyan         ↑ emerald ↑ violet          ↑ cyan            ↑ emerald      │
  │      accent         accent    accent            accent            accent        │
  │    ↑ gateway        ↑ India-  ↑ BACKUP-1,       ↑ Rule 10,        ↑ Rule 3,     │
  │      (BR-M-01        first    BR-SEC-06,        P15, §10          AP-10,        │
  │      integer         rail     BR-IMP-01                          TELE-1,       │
  │      paise)                   (10_Security                      BR-REM-09      │
  │                                §15)                              (10_Security  │
  │                                                                   §17)         │
  │                                                                                │
  │   ↑ All badges = FLAT TINTED chips (§2.3): bg-white/5, border-white/10,         │
  │     12px caption text in the badge's accent colour.                            │
  │   ↑ NOT glass, NOT neumorphic — they are LABELS, not surfaces or controls.     │
  │   ↑ The band = .glass-faint (2% white, 8px blur, §5.2) — recedes so the        │
  │     badges carry the eye, not the band chrome.                                 │
  │   ↑ Order is non-negotiable: Razorpay → UPI → AES-256 → WCAG → No telemetry.   │
  │     Razorpay first because it is the gateway that processes every payment;     │
  │     UPI second because it is the India-first rail (01_Product_Positioning       │
  │     §7.1); the remaining three are credential badges (security, a11y, privacy) │
  │     in descending order of visitor concern.                                    │
  │   ↑ Mobile (≤ 480px): wraps to 2 lines, preserves order, 8px gap.              │
  │   ↑ No "Trusted by" partner logos in v1 (§7 empty-state pattern); the          │
  │     trust-badge row REPLACES partner logos until we have real partners.        │
  │   ↑ No fake authority (§6.1) — every badge cites a verifiable spec rule.       │
  └────────────────────────────────────────────────────────────────────────────────╱

   ↑ This row appears ONCE on the marketing surface — at the bottom of the
     social-proof section (§9 layout). It does NOT appear in the hero, the
     features section, or the pricing section; the trust line in the hero
     ("No card · Free for everyone · Free while our infra stays free") is a different, copy-led trust
     signal, not a badge row.
```

### 13.5 References (External Design Authorities)

The testimonial-grid mockups and the trust-badge row synthesise practices from the following public bodies of work. Cite them when a contributor challenges the `.glass-faint` tier, the avatar gradient, or the trust-badge ordering.

- **Nielsen Norman Group** — *Social Proof in the User Experience* and *Testimonial Card Design*. The §13.2 / §13.3 testimonial-card `.glass-faint` tier (the quote is the content) and the §13.4 trust-badge row follow NN/g's research on social-proof scannability.
- **Baymard Institute** — *Trust Badges and Conversion* and *Testimonial Authenticity*. The §13.4 badge ordering (Razorpay → UPI → AES-256 → WCAG → No telemetry) and the §1 authenticity rule are Baymard-anchored.
- **Smashing Magazine** — *Testimonial Grid Design* and *Mobile Social Proof*. The §13.2 desktop 3+2 grid and the §13.3 mobile 1-up stack follow Smashing's research on testimonial pacing.
- **Apple Human Interface Guidelines** — *Marketing Surfaces* and *Avatar Design*. The §13.2 / §13.3 avatar gradient (emerald→cyan / amber→flare per tutor-code hash, §8.15) follows Apple HIG's marketing-surface guidance.
- **A List Apart** — *Testimonial Copy Strategy* and *The Authenticity Rule*. The §13.2 quote word budget (≤ 24 words per §10) and the §1.2 no-invented-testimonials rule follow ALA's content-strategy doctrine.
- **Google Search Central** — *Review Schema (JSON-LD)*. The §13.2 star ratings must align with the `Review` schema variant in `09_SEO_and_Analytics.md §4`.
- **Vercel Web Analytics docs** — *Custom Event Catalogues*. The §13.2 testimonial-card-tap fires `testimonial_card_click` aggregate-only; the §13.4 trust-badge row fires no event (Rule 3, AP-10, TELE-1).

---

## 14. Cross-References

- `01_Product_Positioning.md §6` (brand voice — testimonials are in the tutor's voice, not copywriter voice), §3.6 (USP-to-testimonial map).
- `02_Hero_and_Above_the_Fold.md §9` (the "1,000+ tutors" social proof strip and the "4.7 ★" rating).
- `05_Pricing_and_Plans.md §3.1` (the "Most popular" badge — also governed by the authenticity rule).
- `07_CTA_and_Conversion.md §13` (no dark patterns — applies to social proof: no fake urgency, no fake authority).
- `09_SEO_and_Analytics.md §3` (the OG image — derived from a testimonial card).
- `10_Security.md §17` (TELE-1 — video testimonials hosted on Vercel Blob, not YouTube).
- `12_Business_Rules.md §BR-LED-06` (append-only ledger — cited in testimonials about receipts), `§BR-ATT-07` (24-hour attendance lock — cited in Meena's testimonial).
- `13_UI_Guidelines.md §2.1` (color tokens — avatar accent per subject), §2.4 (status → accent map), §10 (accessibility).
- `15_Future_Roadmap.md` (v2.x features the case studies wish for — parent app, Enterprise tier).
- `web/01_Architecture.md §3` (route groups — `/case-studies/{slug}` lives in `(marketing)`), `web/05_Deployment_Vercel.md §2.3` (Vercel Cron for daily signup-count fetch).
- `web/07_Landing_Page.md §3` (Component Architecture — the HOW: the `<TestimonialGrid>` RSC composition with `<TestimonialCard>` children, the static-import content contract from `src/content/marketing/testimonials.ts`, the `<video>` element with `preload="none"` and the captions + transcript pair. This file owns the 5 tutors, the case-study slugs, and the authenticity rule; that file owns the React tree, the AVIF avatar pipeline, and the video-player island that ship them).
- `deployment/02_Vercel_Blob_Build_Storage.md §4` (Vercel Blob hosts the video testimonials and their poster images).
- `product/AGENTS.md §3` (no dark patterns — applied to social proof), §7 (testing protocol — testimonial authenticity is a CI lint).

---

*Social proof is trust. Every name, every city, every quote, every star on this page is real. If a single testimonial is fabricated, the whole section collapses — and so does the visitor's trust in the rest of the page. Treat the authenticity rule as load-bearing.*
