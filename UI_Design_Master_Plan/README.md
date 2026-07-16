# Buddysaradhi TutorOS — UI Design Master Plan

> **A professional, colourful, multi-palette UI design master plan for the Buddysaradhi tutor platform — covering Web, Mobile, and Desktop with real visual mockups for every page.**

This package delivers what was requested: **not a sloppy AI-generated UI**, but a professional, stylish, colourful design system with **8 distinct palettes**, **18 page mockups** (each with HTML + PNG screenshot), **30 AI-generated design reference images** (10 per platform), and **6 foundation documents** codifying the visual language.

---

## What's Inside

```
UI_Design_Master_Plan/
├── README.md                           ← you are here
├── 00_Design_System_Overview.md        ← philosophy + palette index + reading order
├── 01_Color_Palettes.md                ← 8 palettes × light/dark variants + contrast reports
├── 02_Typography_System.md             ← 6 font pairings + 12-token type scale + Devanagari
├── 03_Component_Library.md             ← glass/neumo cards, buttons, chips, tables, forms, nav
├── 04_Motion_and_Microinteractions.md  ← Framer Motion variants + reduced-motion contract
├── 05_Accessibility_Contract.md        ← WCAG 2.1 AA + keyboard maps + 20-item QA checklist
│
├── web/                                ← 8 web page specs (markdown)
│   ├── 01_Landing_Page.md
│   ├── 02_Auth.md
│   ├── 03_Dashboard.md
│   ├── 04_Students.md
│   ├── 05_Attendance.md
│   ├── 06_Fees_and_Payments.md
│   ├── 07_Reports.md
│   └── 08_Settings.md
│
├── mobile/                             ← 6 mobile page specs (markdown)
│   ├── 01_Mobile_Auth.md
│   ├── 02_Mobile_Dashboard.md
│   ├── 03_Mobile_Students.md
│   ├── 04_Mobile_Attendance.md
│   ├── 05_Mobile_Fees.md
│   └── 06_Mobile_Settings.md
│
├── desktop/                            ← 4 desktop page specs (markdown)
│   ├── 01_Desktop_Dashboard.md
│   ├── 02_Desktop_Students.md
│   ├── 03_Desktop_Fees.md
│   └── 04_Desktop_Settings.md
│
├── mockups/                            ← 18 standalone HTML mockups + shared CSS
│   ├── shared/
│   │   └── styles.css                  ← the codified design system (8 palettes, components)
│   ├── web/        (8 .html files)
│   ├── mobile/     (6 .html files)
│   └── desktop/    (4 .html files)
│
└── images/
    ├── web/        (8 .png screenshots — 1440×900)
    ├── mobile/     (6 .png screenshots — 440×900 / 900×900 for auth)
    ├── desktop/    (4 .png screenshots — 1440×900)
    └── references/                     ← 30 AI-generated design references (10 per platform)
        ├── INDEX.md                    ← catalog of all 30 reference images
        ├── web/        (10 .png — 1344×768 landscape)
        ├── mobile/     (10 .png — 768×1344 portrait)
        └── desktop/    (10 .png — 1344×768 landscape)
```

**Totals:** 6 foundation docs + 18 page specs + 18 HTML mockups + 18 PNG screenshots + **30 AI-generated design references** + 1 shared CSS + 1 reference index + this README = **94 files**.

> **Image reference system (two tiers):**
> - `images/<platform>/` — **Pixel-perfect screenshots** of the HTML mockups (the visual QA contract).
> - `images/references/<platform>/` — **AI-generated design reference images** (10 per platform) showing richer visual concepts, moods, and palette explorations beyond what the static HTML mockups cover. Use these for inspiration, stakeholder presentations, and onboarding new designers to the visual language.

---

## The 8 Palettes at a Glance

| # | Palette | Mood | Signature Hue | Used On |
|---|---|---|---|---|
| 1 | **Aurora Cosmic** | Premium · nocturnal | Emerald `#00FF9D` on cosmic `#0f0c29` | Dashboards (dark), 3D hero |
| 2 | **Saffron Marigold** | Indian heritage · warm | Saffron `#FF9933` + maroon `#7B1E1E` | Landing hero, mobile fees, receipts |
| 3 | **Emerald Ledger** | Trust · financial calm | Emerald `#059669` + forest `#064E3B` | Fees ledger, reports |
| 4 | **Cyan Lagoon** | Clarity · flow | Cyan `#0891B2` + teal `#0E7490` | Attendance, calendar |
| 5 | **Rose Petal** | Soft · personal | Rose `#E11D48` + blush `#FECDD3` | Students master, profile |
| 6 | **Amber Sunrise** | Energetic · conversion | Amber `#F59E0B` + sunset `#EA580C` | Landing features, pricing CTA |
| 7 | **Violet Nebula** | Creative · premium | Violet `#7C3AED` + plum `#5B21B6` | Auth, settings |
| 8 | **Midnight Slate** | Professional · daylight | Slate `#0F172A` + paper `#F8FAFC` | Light-mode app shell |

Every palette has a **light variant** and a **dark variant**, each with ~16 CSS tokens, semantic mapping (success/warn/danger/info), tinting recipes, and a **WCAG 2.1 AA contrast report**. See `01_Color_Palettes.md`.

> **The four prohibitions (inherited from the existing brand):** No monochrome. No pure black. No pure white. **No indigo/blue primaries** — the `no-indigo-accent` lint rule fires on `#6366F1`, `#3B82F6`, `#2563EB`, `#4F46E5`. Violet `#7C3AED` is the only purple permitted, and only in the Violet Nebula palette (auth/settings context).

---

## The 18 Page Mockups

### Web (8 pages)
| # | Page | Palette | Theme | Screenshot |
|---|---|---|---|---|
| 1 | Landing | Saffron Marigold (+ Amber Sunrise features) | light | `images/web/01_landing.png` |
| 2 | Auth (login/signup) | Violet Nebula | dark | `images/web/02_auth.png` |
| 3 | Dashboard | Aurora Cosmic | dark | `images/web/03_dashboard.png` |
| 4 | Students | Rose Petal | light | `images/web/04_students.png` |
| 5 | Attendance | Cyan Lagoon | light | `images/web/05_attendance.png` |
| 6 | Fees & Payments | Emerald Ledger | light | `images/web/06_fees.png` |
| 7 | Reports | Emerald Ledger (+ amber CTA) | light | `images/web/07_reports.png` |
| 8 | Settings | Violet Nebula | light | `images/web/08_settings.png` |

### Mobile (6 pages — iPhone 14 Pro frames, 390×844)
| # | Page | Palette | Theme | Screenshot |
|---|---|---|---|---|
| 1 | Auth (2 phones: phone entry + OTP) | Violet Nebula | dark | `images/mobile/01_auth.png` |
| 2 | Dashboard | Aurora Cosmic | dark | `images/mobile/02_dashboard.png` |
| 3 | Students | Rose Petal | light | `images/mobile/03_students.png` |
| 4 | Attendance | Cyan Lagoon | light | `images/mobile/04_attendance.png` |
| 5 | Fees | Saffron Marigold | light | `images/mobile/05_fees.png` |
| 6 | Settings | Violet Nebula | light | `images/mobile/06_settings.png` |

### Desktop (4 pages — macOS-style window frames, 1440×900)
| # | Page | Palette | Theme | Screenshot |
|---|---|---|---|---|
| 1 | Dashboard | Aurora Cosmic | dark | `images/desktop/01_dashboard.png` |
| 2 | Students (3-pane) | Rose Petal | light | `images/desktop/02_students.png` |
| 3 | Fees (13-col ledger) | Emerald Ledger | light | `images/desktop/03_fees.png` |
| 4 | Settings (3-pane) | Violet Nebula | light | `images/desktop/04_settings.png` |

---

## How to View the Mockups

### Option A: Open the PNG screenshots (fastest)
Navigate to `images/<platform>/<page>.png` — these are the visual references QA compares against.

### Option B: Open the HTML mockups in a browser (interactive)
```bash
# From the UI_Design_Master_Plan folder:
open mockups/web/01_landing.html          # macOS
xdg-open mockups/web/01_landing.html      # Linux
start mockups/web/01_landing.html         # Windows
```
Each HTML file is **standalone** — no build step, no dependencies (Google Fonts + shared/styles.css load via relative paths). Open in Chrome/Firefox/Safari at 1440×900 (web/desktop) or any width (mobile frames are fixed-size).

### Option C: Serve the whole folder over HTTP
```bash
cd UI_Design_Master_Plan/mockups
python3 -m http.server 8088
# Then visit http://localhost:8088/web/01_landing.html
```

---

## How to Read the Specs

**For an implementer building a screen:**
1. Start with `00_Design_System_Overview.md` — pick your platform + page.
2. Read `01_Color_Palettes.md` §<your-palette> for the token definitions.
3. Read `02_Typography_System.md` for the type scale + font loading.
4. Read `03_Component_Library.md` for the component recipes.
5. Read `04_Motion_and_Microinteractions.md` for the motion variants.
6. Read `05_Accessibility_Contract.md` for the a11y contract.
7. Open the page's `.md` spec (e.g. `web/03_Dashboard.md`) for the page-specific layout, content, interaction model, data bindings, and edge cases.
8. Open the page's `.html` mockup — the mockup is the pixel-perfect reference.
9. Open the page's `.png` screenshot — the visual contract for QA.

**For a reviewer auditing a screen:**
1. Compare the rendered screen against the `.png` screenshot — pixel diff should be < 2%.
2. Run the `no-indigo-accent` lint — must pass.
3. Run axe-core — must report 0 critical violations.
4. Toggle reduced-motion — all animations must collapse to instant state changes.
5. Toggle light/dark — both must render correctly with no token leaks.

---

## Design Principles (The 10 Non-Negotiables)

1. **Palette-per-surface, not palette-per-app.** Each page declares its palette via `data-palette` on `<body>`. A tutor scanning tabs sees colour shift = context shift.
2. **No monochrome, no pure black, no pure white.** Warm off-whites in light mode; warm near-blacks in dark mode.
3. **No indigo/blue primaries.** The `no-indigo-accent` lint fires on `#6366F1`, `#3B82F6`, `#2563EB`, `#4F46E5`.
4. **Glass + neumorphism, never either/or.** Cards are translucent glass with neumorphic dual-shadow.
5. **Bioluminescent accents ≤ 8% screen real-estate.** Accents are dots, borders, 1px edges, icon strokes — never large fills.
6. **Tabular numerics for all money/count/time columns.** `font-variant-numeric: tabular-nums` + JetBrains Mono.
7. **Right-aligned money, left-aligned names.** Kite/Zerodha lineage.
8. **One primary CTA per screen.** Secondary actions are glass-ghost; tertiary are text links.
9. **Motion conveys cause-effect, never decoration.** No continuous pulse on CTAs. Reduced-motion = instant state changes.
10. **Accessibility is a palette property.** Every palette ships with a contrast report; AA failure blocks the build.

---

## Relationship to Existing Specs

This plan **extends** (does not replace) `buddysaradhi_Planning/13_UI_Guidelines.md`:
- This plan wins on: palette count (1 → 8), light mode (new), per-page palette assignment (new), component variants (expanded).
- `13_UI_Guidelines.md` wins on: the Aurora Cosmic palette itself (refined, not replaced), the four prohibitions, the glass + neumorphism technique, the bioluminescent accent rule.

Where this plan conflicts with screen specs (`04_Dashboard.md`, `05_Students.md`, etc. in `buddysaradhi_Planning/`):
- This plan wins on: visual layout, colour, typography, motion.
- Screen specs win on: data model, business rules, interaction logic, edge cases.

The screen specs' ASCII art layouts are **superseded** by the HTML mockups here. The ASCII art remains as a structural reference; the mockup is the visual contract.

---

## Implementation Bridge (for the web agent)

When the web agent reaches the UI implementation phase:
1. **Create `src/lib/palettes.ts`** — export the 8 palettes as typed objects (matches `01_Color_Palettes.md` token-for-token).
2. **Create `src/app/globals.css`** — define CSS custom properties per palette, switched via `[data-palette="..."][data-theme="..."]` on `<html>`. Copy from `mockups/shared/styles.css`.
3. **Customise shadcn/ui components** per `03_Component_Library.md` — glass + neumorphic variants.
4. **Create `src/lib/motion.ts`** — Framer Motion variants per `04_Motion_and_Microinteractions.md`.
5. **Wrap every route in `<PaletteProvider>`** — sets `data-palette` based on route segment (e.g. `/fees` → `emerald-ledger`, `/attendance` → `cyan-lagoon`).
6. **Implement the sticky-footer + min-h-screen flex-col wrapper** at the root layout level.

The mockups in `mockups/` are standalone HTML files (no Next.js, no React) so they render in any browser and screenshot cleanly. They use the **same CSS tokens** the Next.js app will use — copy-paste from `mockups/shared/styles.css` into `globals.css`.

---

## Verification

### Tier 1 — HTML mockup screenshots (18 PNGs)
All 18 PNG screenshots were captured via `agent-browser` at the correct viewport sizes and verified via VLM (vision language model) to confirm:
- ✅ Each page renders with its assigned palette (not a blank screen, not the wrong palette)
- ✅ Web landing: Saffron Marigold (orange/maroon/cream) — professional, warm
- ✅ Web dashboard: Aurora Cosmic (dark glassmorphic, emerald accents) — KPIs ₹47,250 / ₹8,400 / ₹52,800 / 84 visible
- ✅ Mobile auth: 2 phones side by side, Violet Nebula (purple) — OTP + phone entry states
- ✅ All palettes render with correct light/dark variants
- ✅ Tabular numerics on all money columns
- ✅ Real Indian data (Devanagari names, ₹ amounts, batch names)

### Tier 2 — AI-generated design reference images (30 PNGs)
All 30 design reference images were generated via the `z-ai-web-dev-sdk` image generation API using highly-specific prompts anchored to the 8-palette system. Each image was verified via VLM to confirm:
- ✅ Each image renders with its assigned palette (aurora cosmic / violet nebula / rose petal / cyan lagoon / saffron marigold / emerald ledger / amber sunrise)
- ✅ Each image exhibits the glassmorphic + neumorphic component language (translucent panels, dual-shadow depth)
- ✅ Bioluminescent accent dots/strokes are present but occupy ≤ 8% of canvas
- ✅ Web references (10): landing hero, auth, dashboard, students, attendance, fees, reports, schedule, messaging, settings
- ✅ Mobile references (10): splash, onboarding, dashboard, student profile, quick attendance, fee payment (UPI), schedule, notifications, reports, settings
- ✅ Desktop references (10): dashboard, students, bulk attendance, fees/invoices, reports, calendar, communication, marketing CRM, settings, multi-window workspace
- ✅ All images are 1344×768 (web/desktop landscape) or 768×1344 (mobile portrait)
- ⚠️ Note: AI-generated text inside images may contain minor typos — these images are **visual mood references**, not pixel-perfect layouts. The pixel-perfect contract lives in the Tier 1 screenshots + HTML mockups.

---

## Status

- **Author:** UI/UX Lead (Task 13-UI-MASTER-PLAN)
- **State:** COMPLETED
- **Deliverables:** 6 foundation docs + 18 page specs + 18 HTML mockups + 18 PNG screenshots + 30 AI design references + 1 shared CSS + 1 reference index + this README = 94 files
- **Palettes:** 8 (Aurora Cosmic, Saffron Marigold, Emerald Ledger, Cyan Lagoon, Rose Petal, Amber Sunrise, Violet Nebula, Midnight Slate) × light + dark variants
- **All text-on-surface pairs verified WCAG 2.1 AA (≥4.5:1)** in both light and dark
- **No indigo/blue primaries** anywhere (lint-ready)
- **Real Indian data throughout** (Devanagari names, ₹ amounts, batch names, Indian cities)

---

## Made for Indian private tutors. Made colourful. Made professional.
