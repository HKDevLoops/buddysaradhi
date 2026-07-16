# 02 — Typography System

> The type contract for every screen on every platform of **Buddysaradhi TutorOS**. Type is the *third* axis of the design system (after colour in `01_Color_Palettes.md` and before components in `03_Component_Library.md`). Every token defined here is referenced by CSS variable, never by raw font-family string, raw size, or raw hex colour.

---

## §1 Typography Philosophy

> **"Apple hierarchy + Kite tabular density + Discord readability."**

Buddysaradhi tutors read three things more than anything else: **student names**, **money figures**, and **timestamps**. Each of those has a different optimal reading model, and a single type system that pretends they are the same will fail at all three. This system steals the best of three proven lineages:

1. **Apple HIG hierarchy** — fewer sizes, larger size jumps between levels, generous line-height on body, tight letter-spacing on display. Apple's type scale is famous because it makes the hierarchy *visible at a glance*: a tutor skimming a Dashboard should know which number is the page title, which is a KPI figure, and which is a row label without reading them. We steal the discipline: **no more than 12 size tokens, each at least 1.2× the previous one** until the scale saturates.

2. **Kite (Zerodha) tabular density** — Kite's dealing screens show a 200-row order book where every cell aligns to the paise. That requires `font-variant-numeric: tabular-nums` and `font-feature-settings: "tnum"` so digits have constant width. We inherit this for **every money column, every count column, every timestamp column** in the Fees ledger, the Attendance register, the Reports tables. Money is right-aligned; names are left-aligned; the eye never has to search for the decimal.

3. **Discord readability** — Discord optimises for long-form chat reading at small sizes on cheap displays. Its recipe: a humanist sans (Inter-like) at 15px body, 1.4 line-height, never below 13px, never below 4.5:1 contrast. We inherit this for **student notes, reminder messages, receipt line items, and the Settings help text** — anything a tutor reads for more than 3 seconds.

### The Three Inviolable Rules

1. **No body text smaller than 12px.** Captions, labels, and helper text may go to 12px (`--text-xs`). Anything below 12px is a bug — Indian classrooms have bright sunlight, dusty screens, and tutors over 45 with presbyopia. A 11px label is unreadable in those conditions.
2. **No raw hex in type colour.** Every text colour is `var(--text-primary)`, `var(--text-secondary)`, `var(--text-muted)`, or `var(--text-on-accent)` — defined per palette in `01_Color_Palettes.md`. Hard-coding `color: #1C1410` in a component is a P1 lint violation.
3. **No font-weight above 700.** The type scale uses 400 (body), 500 (medium emphasis), 600 (headings), 700 (display). 800/900 weights are forbidden — they read as "screaming" on a tutor's calm dashboard. The only exception is the Fraunces display face on the landing-page hero, which uses its native 900 optical size *inside* the headline only.

### Why Six Pairings?

A single font pairing cannot serve a 3D hero on the landing page, a 200-row Fees ledger, a Devanagari student-name column, and a Settings form. We define **six pairings**, each tuned for a surface family. Every page in this plan declares its pairing via a `data-typography` attribute on `<body>`, resolved to CSS variables. The eight palettes from `01_Color_Palettes.md` apply colour; the six pairings below apply type.

---

## §2 Font Pairings

> Six pairings, each with a heading face, body face, monospace face, mood, best-for surface, and ready-to-paste `@import`/`next/font` snippet. Pairing 5 (**Onest + Inter + JetBrains Mono**) is the **recommended default** for the tutor app because Onest is one of the few open-source faces with first-class Latin + Devanagari support — critical for Hindi/Marathi student names.

### Pairing Catalogue

| # | Pairing | Heading | Body | Mono | Mood | Best For |
|---|---|---|---|---|---|---|
| 1 | **Sora + Inter + JetBrains Mono** | Sora | Inter | JetBrains Mono | Geometric · modern · confident | Primary app UI (Dashboard, Attendance, default app shell) |
| 2 | **Fraunces + Inter + IBM Plex Mono** | Fraunces | Inter | IBM Plex Mono | Editorial · warm · premium | Landing-page hero headlines, Pricing, Testimonials |
| 3 | **Space Grotesk + Inter + Space Mono** | Space Grotesk | Inter | Space Mono | Data-dense · technical · dashboard | Reports, ROI calculator, multi-series charts |
| 4 | **Bricolage Grotesque + Inter + JetBrains Mono** | Bricolage Grotesque | Inter | JetBrains Mono | Marketing · energetic · modern | Landing features grid, CTA blocks, conversion surfaces |
| 5 | **Onest + Inter + JetBrains Mono** ⭐ | Onest | Inter | JetBrains Mono | Humanist · bilingual · readable | **Recommended default** — app surfaces with student names (Students, Fees, Settings, all Devanagari content) |
| 6 | **Manrope + Source Sans 3 + IBM Plex Mono** | Manrope | Source Sans 3 | IBM Plex Mono | Clean · neutral · alternative UI | Alternative app UI for tutors who prefer a softer geometric |

> ⭐ **Recommended default for the tutor app.** Onest is one of the very few open-source faces with native Latin + Devanagari coverage at multiple weights — see §5 for the multi-script rationale. Sora (pairing 1) is the fallback for surfaces that never show Devanagari (Dashboard, Attendance).

### Pairing 1 — Sora + Inter + JetBrains Mono

- **Heading:** Sora (300/400/600/700) — geometric sans, wide apertures, modern
- **Body:** Inter (400/500/600) — humanist sans, designed for screens, tabular-nums native
- **Mono:** JetBrains Mono (400/500) — code, IDs, timestamps, tabular figures
- **Mood:** Geometric, modern, confident
- **Best for:** Primary app UI shells (Dashboard, Attendance) — pairs with Aurora Cosmic and Cyan Lagoon palettes

```css
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

[data-typography="sora-inter-jetbrains"] {
  --font-heading: 'Sora', system-ui, sans-serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}
```

```typescript
// next/font (self-hosted, app surfaces)
import { Sora, Inter, JetBrains_Mono } from 'next/font/google';
export const sora = Sora({ subsets: ['latin'], weight: ['300','400','600','700'], display: 'swap', variable: '--font-heading' });
export const inter = Inter({ subsets: ['latin'], weight: ['400','500','600'], display: 'swap', variable: '--font-body' });
export const jetbrains = JetBrains_Mono({ subsets: ['latin'], weight: ['400','500'], display: 'swap', variable: '--font-mono' });
```

### Pairing 2 — Fraunces + Inter + IBM Plex Mono

- **Heading:** Fraunces (400/600/900, opsz 144 for display) — warm contemporary serif, optical sizing
- **Body:** Inter — same as pairing 1
- **Mono:** IBM Plex Mono (400/500) — Plex Mono's slight humanist warmth pairs with the serif
- **Mood:** Editorial, warm, premium
- **Best for:** Landing-page hero headlines, pricing, testimonials — pairs with Saffron Marigold and Amber Sunrise palettes

```css
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

[data-typography="fraunces-inter-plex"] {
  --font-heading: 'Fraunces', Georgia, serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
}
```

### Pairing 3 — Space Grotesk + Inter + Space Mono

- **Heading:** Space Grotesk (400/500/700) — slightly condensed, technical
- **Body:** Inter — same as pairing 1
- **Mono:** Space Mono (400/700) — geometric monospace, slightly quirky
- **Mood:** Data-dense, technical, dashboard
- **Best for:** Reports, ROI calculator, multi-series charts — pairs with Emerald Ledger palette

```css
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Inter:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap');

[data-typography="spacegrotesk-inter-spacemono"] {
  --font-heading: 'Space Grotesk', system-ui, sans-serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --font-mono: 'Space Mono', ui-monospace, monospace;
}
```

### Pairing 4 — Bricolage Grotesque + Inter + JetBrains Mono

- **Heading:** Bricolage Grotesque (400/600/800) — expressive, modern marketing face
- **Body:** Inter — same as pairing 1
- **Mono:** JetBrains Mono — same as pairing 1
- **Mood:** Marketing, energetic, modern
- **Best for:** Landing features grid, CTA blocks, conversion surfaces — pairs with Amber Sunrise palette

```css
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

[data-typography="bricolage-inter-jetbrains"] {
  --font-heading: 'Bricolage Grotesque', system-ui, sans-serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}
```

### Pairing 5 — Onest + Inter + JetBrains Mono ⭐ RECOMMENDED

- **Heading:** Onest (400/500/600/700) — humanist, supports Latin + Devanagari + Cyrillic natively
- **Body:** Inter (Latin body) with Onest fallback for Devanagari
- **Mono:** JetBrains Mono — same as pairing 1
- **Mood:** Humanist, bilingual, readable
- **Best for:** All surfaces that display Indian student names — Students master, Fees ledger, Receipts, Settings, Reports with name columns. **This is the recommended default for the tutor app.**

```css
@import url('https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

[data-typography="onest-inter-jetbrains"] {
  /* Onest covers Latin + Devanagari; Inter is the Latin-only fallback for slightly tighter body */
  --font-heading: 'Onest', system-ui, sans-serif;
  --font-body: 'Inter', 'Onest', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}
```

```typescript
// next/font self-hosted (recommended for the tutor app)
import { Onest, Inter, JetBrains_Mono } from 'next/font/google';
export const onest = Onest({ subsets: ['latin'], weight: ['400','500','600','700'], display: 'swap', variable: '--font-heading' });
// Note: Onest's Devanagari subset is loaded via Google Fonts CSS2 link in globals.css because next/font
// does not yet support the 'devanagari' subset param for all faces — see §6 for the load strategy.
export const inter = Inter({ subsets: ['latin'], weight: ['400','500','600'], display: 'swap', variable: '--font-body' });
export const jetbrains = JetBrains_Mono({ subsets: ['latin'], weight: ['400','500'], display: 'swap', variable: '--font-mono' });
```

### Pairing 6 — Manrope + Source Sans 3 + IBM Plex Mono

- **Heading:** Manrope (400/500/600/700) — softer geometric, slightly rounded
- **Body:** Source Sans 3 (400/600) — Adobe's humanist sans, excellent at 13–16px
- **Mono:** IBM Plex Mono — same as pairing 2
- **Mood:** Clean, neutral, alternative UI
- **Best for:** Tutors who prefer a softer geometric over Sora — opt-in via Settings → Appearance

```css
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

[data-typography="manrope-sourcesans-plex"] {
  --font-heading: 'Manrope', system-ui, sans-serif;
  --font-body: 'Source Sans 3', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
}
```

### Per-Page Pairing Assignment

| Platform | Page | Pairing | Rationale |
|---|---|---|---|
| Web | Landing (hero) | 2 (Fraunces) | Editorial serif for the hero headline |
| Web | Landing (features/pricing) | 4 (Bricolage) | Marketing energy for conversion surfaces |
| Web | Auth | 1 (Sora) | Crisp geometric for the auth form |
| Web | Dashboard | 1 (Sora) | Modern UI shell |
| Web | Students | 5 (Onest) ⭐ | Devanagari student names |
| Web | Attendance | 1 (Sora) | Mostly numerics, few names |
| Web | Fees & Payments | 5 (Onest) ⭐ | Student names + money figures |
| Web | Reports | 3 (Space Grotesk) | Data-dense charts and tables |
| Web | Settings | 1 (Sora) | Crisp UI controls |
| Mobile | All app surfaces | 5 (Onest) ⭐ | Devanagari names everywhere |
| Desktop | All app surfaces | 5 (Onest) ⭐ | Devanagari names everywhere |

> **Override hook:** A tutor can switch to pairing 6 (Manrope/Source Sans 3) via Settings → Appearance → Typeface. The choice is persisted in `localStorage.buddysaradhi.typography` and applied via `data-typography` on `<html>`.

---

## §3 Type Scale

> Twelve size tokens, exposed as CSS variables on `:root`. Components reference `var(--text-<size>)`, never raw `px` values. Line-height and letter-spacing are **paired** with the size token — applying the size without its line-height is a P2 lint violation.

### The Twelve Tokens

| Token | Size | Line-height | Letter-spacing | Weight range | Usage |
|---|---|---|---|---|---|
| `--text-xs` | 12px | 1.45 (17.4px) | 0.01em | 400–500 | Captions, table-cell meta, helper text, timestamps in compact tables |
| `--text-sm` | 13px | 1.45 (18.85px) | 0em | 400–500 | Form labels, secondary metadata, breadcrumb segments |
| `--text-base` | 14px | 1.5 (21px) | 0em | 400–600 | Body text, table-cell primary, form input text, list items |
| `--text-md` | 15px | 1.5 (22.5px) | -0.005em | 400–600 | Body large — student notes, reminder messages, receipt line items |
| `--text-lg` | 17px | 1.45 (24.65px) | -0.01em | 500–600 | Small card titles, sub-section headings, KPI labels |
| `--text-xl` | 20px | 1.4 (28px) | -0.015em | 600 | Card titles, modal titles, drawer headers |
| `--text-2xl` | 24px | 1.35 (32.4px) | -0.02em | 600 | Page-section headings (h2) |
| `--text-3xl` | 30px | 1.3 (39px) | -0.02em | 600–700 | Page titles (h1) in dense surfaces |
| `--text-4xl` | 36px | 1.25 (45px) | -0.025em | 700 | Page titles (h1) in spacious surfaces (Settings, Reports) |
| `--text-5xl` | 48px | 1.2 (57.6px) | -0.03em | 700 | KPI figures, landing-page section headlines |
| `--text-6xl` | 60px | 1.15 (69px) | -0.035em | 700 | Landing-page hero sub-headline |
| `--text-display` | 72px | 1.1 (79.2px) | -0.04em | 700–900 | Landing-page hero headline only (Fraunces opsz 144) |

### CSS Definition

```css
:root {
  /* Type scale — sizes, line-heights, letter-spacing paired */
  --text-xs:       12px;  --leading-xs:       1.45; --tracking-xs:       0.01em;
  --text-sm:       13px;  --leading-sm:       1.45; --tracking-sm:       0em;
  --text-base:     14px;  --leading-base:     1.5;  --tracking-base:     0em;
  --text-md:       15px;  --leading-md:       1.5;  --tracking-md:      -0.005em;
  --text-lg:       17px;  --leading-lg:       1.45; --tracking-lg:      -0.01em;
  --text-xl:       20px;  --leading-xl:       1.4;  --tracking-xl:      -0.015em;
  --text-2xl:      24px;  --leading-2xl:      1.35; --tracking-2xl:     -0.02em;
  --text-3xl:      30px;  --leading-3xl:      1.3;  --tracking-3xl:     -0.02em;
  --text-4xl:      36px;  --leading-4xl:      1.25; --tracking-4xl:     -0.025em;
  --text-5xl:      48px;  --leading-5xl:      1.2;  --tracking-5xl:     -0.03em;
  --text-6xl:      60px;  --leading-6xl:      1.15; --tracking-6xl:     -0.035em;
  --text-display:  72px;  --leading-display:  1.1;  --tracking-display: -0.04em;

  /* Font families (resolved by [data-typography] blocks in §2) */
  --font-heading: 'Sora', system-ui, sans-serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}

/* Typography utility classes — use these instead of raw Tailwind text-* utilities
   so the line-height + letter-spacing pair stays coupled to the size. */
.t-xs       { font-size: var(--text-xs);       line-height: var(--leading-xs);       letter-spacing: var(--tracking-xs); }
.t-sm       { font-size: var(--text-sm);       line-height: var(--leading-sm);       letter-spacing: var(--tracking-sm); }
.t-base     { font-size: var(--text-base);     line-height: var(--leading-base);     letter-spacing: var(--tracking-base); }
.t-md       { font-size: var(--text-md);       line-height: var(--leading-md);       letter-spacing: var(--tracking-md); }
.t-lg       { font-size: var(--text-lg);       line-height: var(--leading-lg);       letter-spacing: var(--tracking-lg); }
.t-xl       { font-size: var(--text-xl);       line-height: var(--leading-xl);       letter-spacing: var(--tracking-xl); }
.t-2xl      { font-size: var(--text-2xl);      line-height: var(--leading-2xl);      letter-spacing: var(--tracking-2xl); }
.t-3xl      { font-size: var(--text-3xl);      line-height: var(--leading-3xl);      letter-spacing: var(--tracking-3xl); }
.t-4xl      { font-size: var(--text-4xl);      line-height: var(--leading-4xl);      letter-spacing: var(--tracking-4xl); }
.t-5xl      { font-size: var(--text-5xl);      line-height: var(--leading-5xl);      letter-spacing: var(--tracking-5xl); }
.t-6xl      { font-size: var(--text-6xl);      line-height: var(--leading-6xl);      letter-spacing: var(--tracking-6xl); }
.t-display  { font-size: var(--text-display);  line-height: var(--leading-display);  letter-spacing: var(--tracking-display); }

/* Family + weight utilities */
.font-heading { font-family: var(--font-heading); }
.font-body    { font-family: var(--font-body); }
.font-mono    { font-family: var(--font-mono); }
.fw-regular   { font-weight: 400; }
.fw-medium    { font-weight: 500; }
.fw-semibold  { font-weight: 600; }
.fw-bold      { font-weight: 700; }
```

### Why 12 Tokens (Not 8, Not 20)?

- **Eight is too few** — a KPI figure (48px) and a page title (36px) need to be distinct; collapsing them flattens the hierarchy.
- **Twenty is too many** — designers pick arbitrarily between 13/14/15/16, which produces inconsistent surfaces. Twelve forces deliberate sizing decisions.
- **The 1.2× progression** holds from `--text-base` upward, saturating at the display end where 60→72 is only 1.2× (legitimate — larger sizes need *less* aggressive jumps because the eye already sees them as "big").

---

## §4 Tabular Numerics

> Money, counts, and timestamps must **align to the decimal/colon** so a tutor scanning a 200-row ledger sees the figures line up vertically. This is the Kite/Zerodha lineage — see `00_Design_System_Overview.md` §5 rule 6.

### The Recipe

```css
/* Applied to every <td>, <th>, KPI figure, receipt line-item, chart axis label, and
   chart tooltip that contains money, counts, or timestamps. */
.tnum {
  font-family: var(--font-mono);              /* JetBrains Mono / IBM Plex Mono / Space Mono all have tabular figures native */
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "lnum" 1;  /* tnum = tabular, lnum = lining (no old-style figures) */
  font-variant-ligatures: none;               /* no `fi`, `fl` ligatures inside numerics — they break alignment */
}

/* Money columns: right-aligned, with currency symbol left-padded for visual balance */
.money-cell {
  text-align: right;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  white-space: nowrap;                        /* never wrap a money figure */
}

/* Count columns: right-aligned, same tabular treatment */
.count-cell {
  text-align: right;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  white-space: nowrap;
}

/* Timestamp columns: left-aligned (they're read left-to-right), tabular so the
   colons line up vertically across rows in a list view */
.time-cell {
  text-align: left;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  white-space: nowrap;
}

/* Name columns: left-aligned, body font, NOT tabular (names don't have digits) */
.name-cell {
  text-align: left;
  font-family: var(--font-body);
}
```

### Column Alignment Contract

| Column type | Alignment | Font family | Tabular numerics | Example |
|---|---|---|---|---|
| Student name | left | `--font-body` | n/a | `Riya Sharma` |
| Money (₹) | right | `--font-mono` | yes | `1,500.00` |
| Count | right | `--font-mono` | yes | `12` |
| Percentage | right | `--font-mono` | yes | `87.5%` |
| Date | left | `--font-mono` | yes | `2026-06-30` |
| Time | left | `--font-mono` | yes | `14:30` |
| Status chip | centre | `--font-body` | n/a | `[Paid]` |
| Action button | centre/right | `--font-body` | n/a | `[Edit]` |

### Receipt Money Formatting

Indian currency uses the **lakh-crore** grouping (2-2-3), not the Western 3-3 grouping. A receipt that prints `1,50,000.00` (Indian) must not print `150,000.00` (Western). The formatting function:

```typescript
// lib/format.ts
const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatINR = (paise: number): string => INR_FORMATTER.format(paise / 100);
// formatINR(150000) → "₹1,500.00"
// formatINR(15000000) → "₹1,50,000.00"  (lakh-crore grouping)
```

> **Lint rule:** `no-western-number-grouping.test.ts` greps for `NumberFormat('en-US')` and `toLocaleString('en-US')` in `src/` — Indian currency must use `en-IN`. Receipts printed with Western grouping are a P0 bug.

---

## §5 Multi-Script Support (Latin + Devanagari)

> The tutor app's users are Indian tutors with Indian students. **Student names appear in Latin (English transliteration) AND Devanagari (Hindi/Marathi native script).** A type system that only ships Latin will render Devanagari in a fallback face, breaking the visual hierarchy.

### The Devanagari Requirement

- A tutor named "Sunita" may write her student's name as `Riya Sharma` (Latin) or `रिया शर्मा` (Devanagari) or both.
- The Students master list, Fees ledger rows, Receipts, Attendance register, and Reports all show student names — any of them may contain Devanagari.
- A Latin-only font (Inter alone) falls back to Noto Sans Devanagari for `रिया शर्मा`, which has a **different x-height and stroke weight** than Inter. The visual mismatch is jarring.
- **Onest** (pairing 5) is one of the few open-source faces with native Devanagari coverage that matches its Latin metrics — that's why it's the recommended default.

### Font Fallback Chain

```css
:root {
  /* Latin-first chain: Inter → Onest → system. Inter is slightly tighter than Onest
     for Latin body text, so it leads; Onest covers the Devanagari range. */
  --font-body: 'Inter', 'Onest', system-ui, -apple-system, 'Segoe UI', sans-serif;

  /* Heading chain: Onest leads because its Devanagari is first-class. */
  --font-heading: 'Onest', 'Inter', system-ui, sans-serif;

  /* Mono: Devanagari has no native monospace form; we fall back to Noto Sans Devanagari
     for any Devanagari that sneaks into a mono context (rare — only IDs/samples). */
  --font-mono: 'JetBrains Mono', 'Noto Sans Devanagari', ui-monospace, monospace;
}

/* unicode-range trick: tell the browser to use Onest ONLY for Devanagari codepoints
   when Inter is the primary body face. This avoids loading Onest for Latin-only pages
   but guarantees Devanagari always renders in Onest, not a fallback. */
@font-face {
  font-family: 'Onest-Devanagari';
  src: url('https://fonts.gstatic.com/s/onest/v5/devanagari-400.woff2') format('woff2');
  unicode-range: U+0900-097F, U+1CD0-1CF6, U+1CF8-1CF9, U+200B-200D, U+20A4, U+25CC, U+A830-A839;
  font-weight: 400;
  font-display: swap;
}

/* Then in the body chain, Onest-Devanagari sits between Inter and the system fallback */
[data-typography="onest-inter-jetbrains"] {
  --font-body: 'Inter', 'Onest-Devanagari', 'Onest', system-ui, sans-serif;
}
```

### Sample Name Rendering

| Input | Rendered as | Font that wins |
|---|---|---|
| `Riya Sharma` | Riya Sharma | Inter (Latin) |
| `रिया शर्मा` | रिया शर्मा | Onest-Devanagari (via `unicode-range`) |
| `Riya शर्मा` (mixed) | Riya शर्मा | Inter for `Riya`, Onest-Devanagari for `शर्मा` |
| `12345` in a money cell | 12,345.00 | JetBrains Mono |

### Bilingual Name Field Contract

The Students schema stores both forms:

```prisma
model Student {
  // ... other fields
  name_latin       String   // "Riya Sharma" — required, used in receipts, search index
  name_devanagari  String?  // "रिया शर्मा" — optional, shown as secondary in the master list
}
```

The master-list row renders:

```tsx
<td className="name-cell">
  <span className="t-base fw-medium">{student.name_latin}</span>
  {student.name_devanagari && (
    <span
      className="t-sm text-muted ml-2"
      lang="hi"
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {student.name_devanagari}
    </span>
  )}
</td>
```

> **The `lang="hi"` attribute** on the Devanagari span is mandatory — it tells screen readers to switch pronunciation engines (see `05_Accessibility_Contract.md` §12).

---

## §6 Font Loading Strategy

> Fonts are the largest payload on first paint. A naive `@import` of all six pairings would download ~2 MB of WOFF2 files on every page. This strategy loads only what each page needs, with `font-display: swap` to prevent FOIT (Flash of Invisible Text).

### Strategy Summary

| Surface | Strategy | Why |
|---|---|---|
| App shell + all `/app/*` routes | `next/font` self-hosted, subset to Latin + Devanagari, preload critical weights only | App surfaces are the tutor's daily driver — fastest possible LCP, no third-party dependency |
| Marketing site (`/`, `/pricing`, `/features`) | Google Fonts CDN via `<link rel="preconnect">` | Marketing is one-time-visit; CDN cache hit is fast; no build-time self-host needed for marketing |
| Mockup HTML files (`mockups/**/*.html`) | Google Fonts `<link>` in `<head>` | Mockups are standalone HTML; they don't have a build step |

### Critical Weights Only

Not every weight is needed on first paint. The critical set:

```typescript
// app/layout.tsx
import { Onest, Inter, JetBrains_Mono } from 'next/font/google';

const onest = Onest({
  subsets: ['latin'],          // Devanagari loaded via the @font-face unicode-range trick in §5
  weight: ['500', '600', '700'], // 500 for body-medium, 600 for headings, 700 for display
  display: 'swap',
  preload: true,                // <link rel="preload"> for LCP
  variable: '--font-heading',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'], // 400 for body, 500 for medium, 600 for buttons
  display: 'swap',
  preload: true,
  variable: '--font-body',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],        // 400 for code, 500 for tabular emphasis
  display: 'swap',
  preload: false,                // mono is below-the-fold; preload only above-the-fold fonts
  variable: '--font-mono',
});
```

### Subsetting

`next/font` automatically subsets to the requested `subsets` (Latin by default; Devanagari must be requested explicitly via the `@font-face unicode-range` trick because next/font's `subsets` array does not yet accept `'devanagari'` for all faces — see the Google Fonts CSS2 link below for the Devanagari subset).

```css
/* globals.css — Devanagari subset for Onest, loaded only when a Devanagari codepoint appears */
@font-face {
  font-family: 'Onest';
  src: url('https://fonts.gstatic.com/s/onest/v5/devanagari-400.woff2') format('woff2');
  unicode-range: U+0900-097F, U+1CD0-1CF6, U+1CF8-1CF9, U+200B-200D, U+25CC, U+A830-A839;
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'Onest';
  src: url('https://fonts.gstatic.com/s/onest/v5/devanagari-500.woff2') format('woff2');
  unicode-range: U+0900-097F, U+1CD0-1CF6, U+1CF8-1CF9, U+200B-200D, U+25CC, U+A830-A839;
  font-weight: 500;
  font-display: swap;
}
@font-face {
  font-family: 'Onest';
  src: url('https://fonts.gstatic.com/s/onest/v5/devanagari-600.woff2') format('woff2');
  unicode-range: U+0900-097F, U+1CD0-1CF6, U+1CF8-1CF9, U+200B-200D, U+25CC, U+A830-A839;
  font-weight: 600;
  font-display: swap;
}
```

### Marketing Site (CDN)

```html
<!-- For the landing page ONLY (marketing surface, not the app) -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### `font-display: swap` — Why, Not Just What

`font-display: swap` tells the browser: "Render the text in the system fallback immediately; swap to the web font when it arrives." This prevents FOIT (Flash of Invisible Text) where the user sees blank space for 200–800ms while fonts download. The cost is FOUT (Flash of Unstyled Text) — a brief flash of the fallback face — but on modern systems with `preconnect`, the swap happens in <100ms and is barely perceptible.

For the landing page, the hero headline uses Fraunces 900 opsz 144 — a face so distinctive that FOUT is obvious. We mitigate by `preload`-ing the Fraunces WOFF2 file as a `<link rel="preload" as="font" type="font/woff2" crossorigin>` so it begins downloading in parallel with the HTML.

### Anti-FOIT Lint

```typescript
// no-font-display-block.test.ts — fails if any @font-face lacks font-display: swap
// (font-display: block is forbidden — it forces FOIT which is worse than FOUT for LCP)
```

---

## §7 Type Hierarchy Examples

> Concrete HTML + class examples for every role in the type system. Copy-paste these into components; do not invent new combinations.

### Page Title (h1)

```tsx
<h1 className="t-4xl fw-bold font-heading" style={{ color: 'var(--text-primary)' }}>
  Fees & Payments
</h1>
```

Renders as: **36px / 700 / Sora or Onest / `--text-primary`**

### Page Section Heading (h2)

```tsx
<h2 className="t-2xl fw-semibold font-heading" style={{ color: 'var(--text-primary)' }}>
  Outstanding Arrears
</h2>
```

Renders as: **24px / 600 / heading face / `--text-primary`**

### Card Title (h3)

```tsx
<h3 className="t-xl fw-semibold font-heading" style={{ color: 'var(--text-primary)' }}>
  Riya Sharma — Monthly Fee
</h3>
```

Renders as: **20px / 600 / heading face**

### KPI Figure

```tsx
<div className="t-5xl fw-bold font-mono tnum" style={{ color: 'var(--accent-primary)' }}>
  ₹1,50,000
</div>
```

Renders as: **48px / 700 / JetBrains Mono / tabular-nums / accent colour**

### Body

```tsx
<p className="t-base font-body" style={{ color: 'var(--text-secondary)' }}>
  3 students have arrears totalling ₹4,500 from the previous month.
</p>
```

Renders as: **14px / 400 / Inter or Onest / `--text-secondary`**

### Caption

```tsx
<span className="t-xs font-body" style={{ color: 'var(--text-muted)' }}>
  Last updated 2 min ago
</span>
```

Renders as: **12px / 400 / body face / `--text-muted`**

### Label (form)

```tsx
<label className="t-sm fw-medium font-body" style={{ color: 'var(--text-primary)' }} htmlFor="fee">
  Monthly Fee (₹)
</label>
```

Renders as: **13px / 500 / body face / `--text-primary`**

### Helper text

```tsx
<p className="t-xs font-body" style={{ color: 'var(--text-muted)' }} id="fee-help">
  Enter the per-student monthly fee in whole rupees. Quarterly = 3×, Annual = 12×.
</p>
```

Renders as: **12px / 400 / body face / `--text-muted`**

### Code (inline)

```tsx
<code className="t-sm font-mono" style={{ color: 'var(--accent-info)' }}>
  student.monthly_fee_paise
</code>
```

Renders as: **13px / 400 / JetBrains Mono / info accent**

### Code (block)

```tsx
<pre className="t-sm font-mono" style={{
  color: 'var(--text-primary)',
  background: 'var(--surface-glass)',
  padding: '16px',
  borderRadius: '8px',
  overflowX: 'auto'
}}>
{`const expected = monthlyFee * periodMultiplier;
const collected = await collectedForPeriod(studentId, period);
const arrears = expected - collected;`}
</pre>
```

### Money Cell (table)

```tsx
<td className="money-cell t-base" style={{ color: 'var(--text-primary)' }}>
  {formatINR(row.collected_paise)}
</td>
```

Renders as: **14px / right-aligned / JetBrains Mono / tabular-nums**

### Status Chip Text

```tsx
<span className="t-xs fw-medium font-body" style={{ color: 'var(--accent-success)' }}>
  Paid
</span>
```

Renders as: **12px / 500 / body face / success accent**

---

## §8 Anti-Patterns

> Eight typography anti-patterns that fail CI lint. Each has a `no-*` test name and a one-line rationale.

| # | Anti-pattern | Lint rule | Why it's forbidden |
|---|---|---|---|
| 1 | Body text below 12px | `no-text-below-12px.test.ts` | Unreadable in bright Indian classroom sunlight, especially for tutors over 45 with presbyopia |
| 2 | Gray-on-gray text (muted on muted) | `no-gray-on-gray.test.ts` | `--text-muted` on `--bg-surface-inset` is < 3:1 contrast — fails WCAG AA |
| 3 | Raw hex in component CSS | `no-raw-hex-in-components.test.ts` | Bypasses the palette system in `01_Color_Palettes.md`; components must use `var(--text-*)` |
| 4 | Emoji icons in UI labels | `no-emoji-icons.test.ts` | Emoji render inconsistently across OSes (Apple vs Google vs Windows); use SVG icons from `lucide-react` instead |
| 5 | Font-weight > 700 | `no-weight-above-700.test.ts` | 800/900 reads as "screaming"; Fraunces 900 is the ONLY exception, scoped to the landing hero |
| 6 | Western number grouping for INR | `no-western-number-grouping.test.ts` | Indian currency uses lakh-crore (2-2-3); `Intl.NumberFormat('en-US')` produces Western (3-3) — see §4 |
| 7 | Animating `font-size` or `line-height` | `no-animating-type-metrics.test.ts` | Animating these properties triggers layout reflow on every frame — use `transform: scale()` instead |
| 8 | `font-display: block` (forces FOIT) | `no-font-display-block.test.ts` | FOIT (Flash of Invisible Text) is worse than FOUT for LCP; `swap` is mandatory — see §6 |

### The "Three Things Tutors Read" Reminder

Every typographic decision ladders back to the three things tutors read most:

1. **Student names** → `--font-body` (Inter + Onest-Devanagari fallback), left-aligned, 14px base, 15px on receipt line items.
2. **Money figures** → `--font-mono` (JetBrains Mono), right-aligned, tabular-nums, 14px in tables, 48px in KPI figures.
3. **Timestamps** → `--font-mono`, left-aligned, tabular-nums (so colons line up), 12px in compact tables.

If a typographic choice does not serve one of those three, it's decoration. Decoration is allowed on the landing page (Fraunces 900, Bricolage 800) but forbidden on the app surfaces. The app surfaces are work tools; their type is a tool, not an aesthetic statement.

---

## Status

- **Author:** UI/UX Lead (Task 13-FOUNDATION-DOCS)
- **State:** COMPLETED
- **Depends on:** `00_Design_System_Overview.md` §5 (10 non-negotiables, esp. rule 6 on tabular numerics), `01_Color_Palettes.md` (text token colours per palette)
- **Consumers:** `03_Component_Library.md` (component text uses `--text-*` tokens), `05_Accessibility_Contract.md` §6 (heading hierarchy enforces one h1 per page), every page mockup (`web/*.md`, `mobile/*.md`, `desktop/*.md`)
- **Tokens defined:** 12 size tokens × 3 properties (size, line-height, letter-spacing) = 36 type-scale variables + 3 font-family variables + 4 weight utilities
- **Pairings defined:** 6 (1 default ⭐ + 5 alternates)
- **All text colours verified WCAG AA (≥4.5:1) per `01_Color_Palettes.md` contrast reports.**
