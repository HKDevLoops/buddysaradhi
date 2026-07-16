# 00 — UI Design Master Plan: Overview

> The single source of truth for the **Buddysaradhi TutorOS** visual language across Web, Mobile, and Desktop. This master plan *extends* (does not replace) `buddysaradhi_Planning/13_UI_Guidelines.md`. It adds: (a) **8 new professional palettes** with light + dark variants, (b) **per-page palette assignments** so every screen has a distinct, purposeful colour identity, (c) **real visual mockups** (HTML+CSS+PNG) for every page on every platform, (d) **typography, motion, component, and accessibility contracts** codified for implementation.

---

## 1. Why This Plan Exists

The previous UI Guidelines (`13_UI_Guidelines.md`) defined a single dark-cosmic glassmorphic system. It is beautiful but **monolithic**: every screen shares the same night-sky canvas. Three problems follow:

1. **Visual monotony** — Dashboard, Students, Fees, Attendance, Settings all look like the same page with different content. Tutors cannot form spatial memory ("the green screen = fees").
2. **No light mode** — Indian tutors often work in bright classrooms on low-end laptops; a forced dark UI strains battery and eyes in daylight.
3. **No mood differentiation** — A landing page should feel *energetic*, a fees ledger should feel *grounded/trustworthy*, a settings panel should feel *calm*. One palette cannot do all three.

This plan solves all three by introducing a **palette-per-surface** system: 8 named palettes, each with a light and dark variant, each assigned to specific pages by emotional intent. The brand DNA (Vibrant Glass + Neumorphism, no indigo/blue primaries, bioluminescent accents) is preserved as the **master dark mode**; the new palettes are *additions*, not replacements.

---

## 2. The Eight Palettes (Summary)

> Full specs in `01_Color_Palettes.md`. Each palette has: light variant, dark variant, primary/secondary/CTA/surface/text tokens, semantic mapping (success/warn/danger/info), and a contrast report.

| # | Palette Name | Mood | Assigned Surfaces | Signature Hue |
|---|---|---|---|---|
| 1 | **Aurora Cosmic** (existing, refined) | Premium · nocturnal · focused | App shell, Dashboard (dark), 3D product hero | Emerald `#00FF9D` on cosmic `#0f0c29` |
| 2 | **Saffron Marigold** | Indian heritage · warm · celebratory | Landing page hero, Fees & Payments, Receipts | Saffron `#FF9933` + maroon `#7B1E1E` |
| 3 | **Emerald Ledger** | Trust · growth · financial calm | Fees ledger, Reports, ROI calculator | Emerald `#059669` + forest `#064E3B` |
| 4 | **Cyan Lagoon** | Clarity · flow · attendance tracking | Attendance, Calendar, Timetable | Cyan `#0891B2` + teal `#0E7490` |
| 5 | **Rose Petal** | Soft · personal · student-centric | Students master, Student profile, Enrolment | Rose `#E11D48` + blush `#FECDD3` |
| 6 | **Amber Sunrise** | Energetic · optimistic · conversion | Landing features, Pricing, CTA blocks | Amber `#F59E0B` + sunset `#EA580C` |
| 7 | **Violet Nebula** | Creative · premium · settings/auth | Settings, Auth (login/signup), Profile | Violet `#7C3AED` + plum `#5B21B6` |
| 8 | **Midnight Slate** (light mode master) | Professional · daylight · high-density | Light-mode app shell, all light variants | Slate `#0F172A` + sky-neutral `#475569` |

> **Rule:** Violet Nebula is the **only** palette permitted to use violet as a primary (auth/settings context, where "creative/premium" is the intent). It is NOT indigo/blue — it is a warm plum-leaning violet (`#7C3AED`), explicitly distinct from the prohibited Stripe-indigo `#6366F1`. The `no-indigo-accent` lint rule still fires on `#6366F1` and `#3B82F6`.

---

## 3. Platform Coverage

| Platform | Pages in this plan | Mockup format | Viewport |
|---|---|---|---|
| **Web** | Landing, Auth, Dashboard, Students, Attendance, Fees, Reports, Settings | HTML + PNG | 1440×900 (desktop), 375×812 (mobile-responsive section) |
| **Mobile** | Dashboard, Students, Attendance, Fees, Settings, Auth | HTML + PNG | 390×844 (iPhone 14 Pro) |
| **Desktop** | Dashboard, Students, Fees, Settings | HTML + PNG | 1440×900 (Tauri window) |

**Total: 18 pages × (1 markdown spec + 1 HTML mockup + 1 PNG screenshot) = 54 deliverables + this overview + 4 foundation docs.**

---

## 4. Document Index

### Foundation (this folder)
| File | Contents |
|---|---|
| `00_Design_System_Overview.md` | This file — philosophy, palette index, platform coverage, reading order |
| `01_Color_Palettes.md` | Full 8-palette spec: light + dark variants, tokens, semantic mapping, contrast reports, tinting recipes |
| `02_Typography_System.md` | Font pairings, type scale, tabular numerics, multi-script (Latin + Devanagari), font-loading strategy |
| `03_Component_Library.md` | shadcn/ui customisations, glass + neumorphic component recipes, chip/badge/card/button variants per palette |
| `04_Motion_and_Microinteractions.md` | Framer Motion variants, spring physics, page transitions, reduced-motion contract |
| `05_Accessibility_Contract.md` | WCAG 2.1 AA per palette, focus management, screen-reader patterns, keyboard nav maps |

### Web (`web/`)
| File | Mockup | Screenshot |
|---|---|---|
| `01_Landing_Page.md` | `mockups/web/01_landing.html` | `images/web/01_landing.png` |
| `02_Auth.md` | `mockups/web/02_auth.html` | `images/web/02_auth.png` |
| `03_Dashboard.md` | `mockups/web/03_dashboard.html` | `images/web/03_dashboard.png` |
| `04_Students.md` | `mockups/web/04_students.html` | `images/web/04_students.png` |
| `05_Attendance.md` | `mockups/web/05_attendance.html` | `images/web/05_attendance.png` |
| `06_Fees_and_Payments.md` | `mockups/web/06_fees.html` | `images/web/06_fees.png` |
| `07_Reports.md` | `mockups/web/07_reports.html` | `images/web/07_reports.png` |
| `08_Settings.md` | `mockups/web/08_settings.html` | `images/web/08_settings.png` |

### Mobile (`mobile/`)
| File | Mockup | Screenshot |
|---|---|---|
| `01_Mobile_Auth.md` | `mockups/mobile/01_auth.html` | `images/mobile/01_auth.png` |
| `02_Mobile_Dashboard.md` | `mockups/mobile/02_dashboard.html` | `images/mobile/02_dashboard.png` |
| `03_Mobile_Students.md` | `mockups/mobile/03_students.html` | `images/mobile/03_students.png` |
| `04_Mobile_Attendance.md` | `mockups/mobile/04_attendance.html` | `images/mobile/04_attendance.png` |
| `05_Mobile_Fees.md` | `mockups/mobile/05_fees.html` | `images/mobile/05_fees.png` |
| `06_Mobile_Settings.md` | `mockups/mobile/06_settings.html` | `images/mobile/06_settings.png` |

### Desktop (`desktop/`)
| File | Mockup | Screenshot |
|---|---|---|
| `01_Desktop_Dashboard.md` | `mockups/desktop/01_dashboard.html` | `images/desktop/01_dashboard.png` |
| `02_Desktop_Students.md` | `mockups/desktop/02_students.html` | `images/desktop/02_students.png` |
| `03_Desktop_Fees.md` | `mockups/desktop/03_fees.html` | `images/desktop/03_fees.png` |
| `04_Desktop_Settings.md` | `mockups/desktop/04_settings.html` | `images/desktop/04_settings.png` |

---

## 5. Design Principles (The Non-Negotiables)

These ten rules govern every mockup in this plan. Any deviation is a bug.

1. **Palette-per-surface, not palette-per-app.** Each page declares its palette in a `data-palette` attribute on `<body>`. The CSS variable layer resolves tokens from that attribute. A tutor scanning tabs sees colour shift = context shift.
2. **No monochrome, no pure black, no pure white.** Inherited from `13_UI_Guidelines.md` §1.3. Light-mode surfaces use warm off-whites (`#FAFAF9`, `#FFFBF5`); dark-mode surfaces use warm near-blacks (`#0F0C29`, `#0A0A1A`).
3. **No indigo/blue primaries.** The `no-indigo-accent` lint rule fires on `#6366F1`, `#3B82F6`, `#2563EB`, and `#4F46E5`. Violet `#7C3AED` is permitted only in Violet Nebula (auth/settings) — it is plum-warm, not Stripe-indigo.
4. **Glass + neumorphism, never either/or.** Cards are glass (translucent fill + 1px white-edge) with neumorphic shadow (dual-light extrusion). Flat cards are forbidden; pure-neumorphic cards (no translucency) are forbidden.
5. **Bioluminescent accents ≤ 8% screen real-estate.** Accents are dots, borders, 1px edges, icon strokes, tiny chips — never large fills. A 200×200 emerald block is a bug.
6. **Tabular numerics for all money/count/time columns.** `font-variant-numeric: tabular-nums; font-feature-settings: "tnum";` on every `<td>` containing currency, counts, or timestamps.
7. **Right-aligned money, left-aligned names.** Kite/Zerodha lineage (`13_UI_Guidelines.md` §1.1). Money columns are `text-align: right; font-variant-numeric: tabular-nums`.
8. **One primary CTA per screen.** Secondary actions are glass-ghost buttons (transparent fill, 1px border). Tertiary actions are text links. Never two filled-emerald buttons in the same viewport.
9. **Motion conveys cause-effect, never decoration.** A hover scale of 1.02 on a card says "I am tappable". A continuous pulse on a CTA says nothing and is forbidden. Reduced-motion users get instant state changes.
10. **Accessibility is a palette property, not an afterthought.** Every palette ships with a contrast report. A palette that cannot hit 4.5:1 on body text in both light and dark is rejected before it ships.

---

## 6. The Reading Order

**For an implementer building a screen:**
1. Read `00_Design_System_Overview.md` (this file) — pick your platform + page.
2. Read `01_Color_Palettes.md` §<palette-name> for your page's palette.
3. Read `02_Typography_System.md` for the type scale + font loading.
4. Read `03_Component_Library.md` for the component recipes you need.
5. Read `04_Motion_and_Microinteractions.md` for the motion variants.
6. Read `05_Accessibility_Contract.md` for the a11y contract.
7. Open the page's `.md` spec (e.g. `web/03_Dashboard.md`) for the page-specific layout, content, and interaction model.
8. Open the page's `.html` mockup in a browser; the mockup is the pixel-perfect reference.
9. Open the page's `.png` screenshot for the visual contract (what QA compares against).

**For a reviewer auditing a screen:**
1. Compare the rendered screen against the `.png` screenshot — pixel diff should be < 2% (allowing for live data).
2. Run the `no-indigo-accent` lint — must pass.
3. Run axe-core — must report 0 critical violations.
4. Toggle reduced-motion — all animations must collapse to instant state changes.
5. Toggle light/dark — both must render correctly with no token leaks.

---

## 7. Relationship to Existing Specs

This plan is **authoritative for visual design**. Where it conflicts with `13_UI_Guidelines.md`:
- This plan wins on: palette count, light mode, per-page palette assignment, component variants.
- `13_UI_Guidelines.md` wins on: the Aurora Cosmic palette itself (refined, not replaced), the four prohibitions, the glass + neumorphism technique, the bioluminescent accent rule.

Where it conflicts with screen specs (`04_Dashboard.md`, `05_Students.md`, etc.):
- This plan wins on: visual layout, colour, typography, motion.
- Screen specs win on: data model, business rules, interaction logic, edge cases.

The screen specs' ASCII art layouts are **superseded** by the HTML mockups in this plan. The ASCII art remains as a structural reference; the mockup is the visual contract.

---

## 8. Implementation Bridge (for the web agent)

When the web agent reaches the UI implementation phase, it should:

1. **Create `src/lib/palettes.ts`** — exports the 8 palettes as typed objects (matches `01_Color_Palettes.md` token-for-token).
2. **Create `src/app/globals.css`** — defines CSS custom properties per palette, switched via `[data-palette="..."]` on `<html>`.
3. **Create `src/components/ui/*` customisations** — extend shadcn primitives with glass + neumorphic variants per `03_Component_Library.md`.
4. **Create `src/lib/motion.ts`** — Framer Motion variants per `04_Motion_and_Microinteractions.md`.
5. **Wrap every route in `<PaletteProvider>`** — sets `data-palette` based on route segment (e.g. `/fees` → `emerald-ledger`, `/attendance` → `cyan-lagoon`).
6. **Implement the sticky-footer + min-h-screen flex-col wrapper** at the root layout level.

The mockups in `mockups/` are **standalone HTML files** (no Next.js, no React) so they render in any browser and screenshot cleanly. They use the same CSS tokens the Next.js app will use — copy-paste from `mockups/shared.css` into `globals.css`.

---

## 9. Status

- **Author:** UI/UX Lead (Task 13-UI-MASTER-PLAN)
- **State:** COMPLETED (foundation + 18 page mockups + screenshots + zip)
- **Depends on:** `buddysaradhi_Planning/13_UI_Guidelines.md` (Aurora Cosmic palette), `buddysaradhi_Planning/00_Vision.md` (brand DNA)
- **Consumers:** Web agent (UI implementation phase), Mobile agent (post-WEB-PROD-GATE), Desktop agent (post-MOBILE-PROD-GATE), QA (screenshot comparison)
