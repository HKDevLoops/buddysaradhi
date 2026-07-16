# 13 — UI Guidelines

> The **Vibrant Glass & Neumorphism** design system for Buddysaradhi Omni-Core. *Apple feel, Kite density, Discord flow.* **No monochrome. No pure black. No pure white. No indigo/blue primaries.** This is the visual contract — every component, screen, and prototype implements exactly this system. Any deviation is a bug.

*Last updated: Task 23-LIVEUI-TAILWIND — added §23 (Live Prototype Canon from `src/components/tutoros/`) + §24 (Cross-Platform Tailwind Uniformity: `packages/design-system/` + NativeWind v5 + Tauri v2). Previous: Task 16-UI-GUIDELINES-OPTIMIZE — added pro-* polish layer (§20), sticky-footer hard rule, component decision tree; deduplicated.*

---

## 1. Design Philosophy & Manifesto

### 1.1 The Three Inheritances

Buddysaradhi synthesises three lineages into one visual language (`00_Vision.md` §8–§9):

| Lineage | What we inherit | What we reject |
|---|---|---|
| **Apple** | Tactile surfaces, spring-physics motion, focus-clarity, type hierarchy | Preciousness; hiding density behind whitespace |
| **Kite (Zerodha)** | Information density, tabular numerics, right-aligned amounts, sticky headers, drill-down | Greyness; the cold monochrome Bloomberg-terminal aesthetic |
| **Discord** | Persistent left rail, bottom-tab mobile, channel-as-context switching, soft micro-interactions | Notification noise; the gamer-purple accent; screen clutter |

### 1.2 The Manifesto

> The cosmic canvas is the **night sky**. The glass panels are the **aurora** on it. The accents are the **bioluminescence**.

Backgrounds never compete with content. Accents never exceed 8% of any screen real-estate unless they are the primary CTA. The eye is always led: cosmic bg → glass surface → text → accent.

### 1.3 The Four Prohibitions + One Layout Mandate

1. **No monochrome.** Every surface carries at least one of: gradient, translucency, accent, or tactile shadow. A flat `#fff` on `#f5f5f5` panel is forbidden (`00_Vision.md` §9.2).
2. **No pure black.** Black is `#0a0a1a` (Abyss) at its darkest — a *warm* black with violet undertone. Pure `#000` kills the aurora.
3. **No pure white.** White is `rgba(255,255,255,0.95)` (text-primary) at its brightest — *translucent*. Pure `#fff` flattens glass panels into plastic.
4. **No indigo/blue primaries.** The indigo→violet cosmic gradient is the **neutral night sky**, not the brand. Indigo and blue are the visual signature of every generic SaaS dashboard since 2018 — the colour of "we copied Stripe" (`00_Vision.md` §9.4). The brand is the **bioluminescent life** on the canvas: emerald, cyan, flare, amber, violet. A `no-indigo-accent` lint rule rejects any PR introducing an indigo accent (`01_Product_Principles.md` AP-6).
5. **Sticky-footer mandate (layout, non-negotiable).** Every screen root is `min-h-screen flex flex-col`; the footer carries `mt-auto flex-shrink-0`. No fixed overlays, no gap below the footer on short content. Full pattern + `pro-sticky-footer` helper in §13.

### 1.4 Where This System Lives

Enforced at four layers: (a) CSS custom properties in `globals.css` (`:root` tokens, §2), (b) Tailwind utilities + `.glass` / `.neumo-*` component classes (§5, §6), (c) **`.pro-*` Professional Polish Layer utilities in `globals.css` lines 1050+** (§20 — the refined glassmorphic cards, button system, KPI strip, avatar, status pill, tab strip, list row, empty state, sticky-footer helper applied across the app in Task 15), (d) Framer Motion variants in `lib/motion.ts` (§7). Every screen spec (`04_Dashboard.md` §3, `05_Students.md` §6, `06_Attendance.md`, `07_Fees_and_Payments.md` §4, `08_Settings.md` §5) references tokens by name — never raw hex. The commercial landing page is no exception: `product/02_Hero_and_Above_the_Fold.md` and `product/03_Features_Showcase.md` consume the same tokens, so the tutor's first encounter with Buddysaradhi (the marketing surface) and every subsequent session (the product surface) share one visual language. See §19 for the commercial-surface contract.

**Reference implementation.** The running `/` route (`src/app/page.tsx` + the six prototype components in `src/components/tutoros/`) is the canonical reference implementation of this design system — 159 `.pro-*` utility instances were applied across it in Task 15-UI-OVERHAUL. When in doubt about how a token, glass tier, or `.pro-*` utility renders, open `/` and inspect. The visual regression baselines in `21_Automation_Testing.md` §5 encode THIS design system — any visual change requires a baseline update there.

---

## 2. Color Token System

### 2.1 Full Token Table

Every color in Buddysaradhi is a CSS custom property. Components reference tokens, never hex.

| Token | Hex / Value | rgba | Usage | Contrast | Semantic role |
|---|---|---|---|---|---|
| `--bg-cosmic` | `#0f0c29` | `rgba(15,12,41,1)` | Root gradient top | — canvas | Neutral night-sky floor |
| `--bg-midnight` | `#24243e` | `rgba(36,36,62,1)` | Root gradient mid (55%) | — canvas | Neutral night-sky mid |
| `--bg-abyss` | `#0a0a1a` | `rgba(10,10,26,1)` | Root gradient bottom; neumorphic dark shadow | — canvas | Warm-black floor |
| `--bg-neumo-light` | `#1a1a3a` | `rgba(26,26,58,1)` | Neumorphic light-shadow source; raised knob body | — surface | Tactile extrusion light |
| `--surface-glass` | `rgba(255,255,255,0.05)` | — | Default glass fill (cards, sheets, drawers) | — translucent | Primary surface tier |
| `--surface-glass-strong` | `rgba(255,255,255,0.08)` | — | Hover/elevated glass (modal, active nav, sticky header) | — translucent | Elevated surface tier |
| `--surface-glass-faint` | `rgba(255,255,255,0.02)` | — | Row-zebra, table gridlines, dividers | — translucent | Background tier |
| `--surface-neumo-raised` | `#1a1a3a` | — | Raised neumo controls (toggles, knobs, buttons) | — tactile | Extruded affordance |
| `--surface-neumo-inset` | `rgba(0,0,0,0.25)` over `#1a1a3a` | — | Inset wells (input fields, search bar, pressed toggles) | — tactile | Receptacle affordance |
| `--accent-emerald` | `#00FF9D` | `rgba(0,255,157,1)` | Paid / present / active / positive delta / primary CTA | 12.6:1 | Success & primary action |
| `--accent-cyan` | `#00F0FF` | `rgba(0,240,255,1)` | Info / links / focus rings / active nav / count-up | 11.9:1 | Focus & selection |
| `--accent-amber` | `#FFB300` | `rgba(255,179,0,1)` | Partial / late / upcoming-due / pending | 9.4:1 | Cautionary |
| `--accent-flare` | `#FF5E00` | `rgba(255,94,0,1)` | Overdue / void / destructive-confirm / error | 5.8:1 | Critical & destructive |
| `--accent-violet` | `#B388FF` | `rgba(179,136,255,1)` | Secondary highlights, tags, inactive/excused badges (sparingly) | 7.2:1 | Neutral informational |
| `--text-primary` | `rgba(255,255,255,0.95)` | — | Body text, headings, KPI figures | 15.2:1 | Highest-contrast text |
| `--text-secondary` | `rgba(255,255,255,0.65)` | — | Sub-headings, captions, secondary labels | 10.4:1 | Standard secondary text |
| `--text-muted` | `rgba(255,255,255,0.40)` | — | Hints, placeholders, table headers, footnotes | 6.4:1 | Low-priority text (still AA) |
| `--text-on-accent` | `#0a0a1a` | `rgba(10,10,26,1)` | Text on emerald/cyan buttons (dark on bright accent) | 11.2:1 on emerald | Reversed text |
| `--border-glass` | `rgba(255,255,255,0.08)` | — | Default 1px glass edge | — edge | Panel boundary |
| `--border-glass-strong` | `rgba(255,255,255,0.14)` | — | Hover/active panel edge, focus-adjacent | — edge | Emphasised boundary |
| `--border-accent` | `rgba(0,240,255,0.4)` | — | Selected row left-bar, focus trap edge | — edge | Selection marker |

> **Contrast is verified against the rendered rgba stack**, not the token alone. Glass over cosmic at `0.05` opacity yields an effective background of approximately `#181538`; text-primary reads at 13.8:1 on that composite. The values above are the worst-case (against pure cosmic). All tokens meet WCAG 2.1 AA at 4.5:1 minimum; most exceed AAA at 7:1 (§10).

### 2.2 Root Background Recipe

```css
:root {
  --bg-cosmic: #0f0c29;
  --bg-midnight: #24243e;
  --bg-abyss: #0a0a1a;
}

body {
  background: radial-gradient(ellipse at top, var(--bg-cosmic), var(--bg-midnight) 55%, var(--bg-abyss) 100%);
  background-attachment: fixed;
}
```

The gradient is **fixed** so the aurora feels like a sky. Three aurora blobs (emerald, cyan, violet) drift at 3% opacity behind the gradient (§7.3 `aurora-drift`).

### 2.3 Tinting Recipe (Chips & Badges)

Status chips and badges never use the full-saturation accent. Instead, the accent is **tinted at 8% opacity over the glass surface**, with the full accent reserved for the dot/icon and 1px border.

```css
.chip-paid {
  background: rgba(0, 255, 157, 0.08);   /* emerald tint */
  border: 1px solid rgba(0, 255, 157, 0.25);
  color: var(--accent-emerald);
}
```

| Chip state | Tint | Border | Dot/Icon | Text |
|---|---|---|---|---|
| Paid | emerald 8% | emerald 25% | emerald ✓ | emerald |
| Partial | amber 8% | amber 25% | amber ◐ | amber |
| Overdue | flare 8% | flare 25% | flare ✕ | flare |
| Excused | violet 8% | violet 25% | violet − | violet |
| Info | cyan 8% | cyan 25% | cyan • | cyan |

> **Rule:** an accent is never used as a chip background above 12% opacity. The eye reads the dot first, the text second, the tint third.

### 2.4 Status → Accent Mapping

| Status | Icon (lucide) | Accent | Used on |
|---|---|---|---|
| Paid / Present / Active / Locked | `Check` | Emerald | Fee chip, attendance toggle-on, locked-period badge |
| Partial / Late / Upcoming-due / Pending | `CircleDot` | Amber | Partial-payment chip, due-soon invoice, late attendance |
| Unpaid / Absent / Overdue / Void / Error | `X` | Flare | Unpaid chip, absent dot, overdue banner, void receipt |
| Excused / Holiday / Inactive / Archived | `Minus` | Violet | Excused chip, holiday calendar cell, archived student |
| Info / Focus / Selected / Active-nav | `Info` | Cyan | Tooltips, focus rings, active sidebar item, count-up |

> This is the canonical status table — icon + accent + usage in one place. §9 iconography and §10.6 a11y both build on it.

---

## 3. Typography Scale

### 3.1 Font Stack

| Role | Stack | Notes |
|---|---|---|
| **Headings** | `"SF Pro Display", "Inter", system-ui, -apple-system, sans-serif` | Apple-system rounded first (native feel); Inter cross-platform fallback |
| **Body** | `"Inter", "SF Pro Text", system-ui, -apple-system, sans-serif` | Inter workhorse; SF Pro Text on Apple. Loaded via `next/font/google` (subset + `display: swap`) |
| **Mono (ledger, code, sequences)** | `"JetBrains Mono", "SF Mono", ui-monospace, monospace` | Every ledger amount, receipt number, student code. Tabular figures by default |

A single webfont (Inter, 400/600) is loaded; SF Pro and SF Mono are free on Apple platforms. Total font payload ≤ 38 KB.

### 3.2 Type Ramp

| Token | Size / LH | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 48 / 56 px | 700 | −0.02em | Landing hero, dashboard welcome |
| `h1` | 32 / 40 px | 700 | −0.01em | Screen titles ("Students", "Fees & Payments") |
| `h2` | 24 / 32 px | 600 | 0 | Section titles within a screen |
| `h3` | 20 / 28 px | 600 | 0 | Card titles, drawer section heads |
| `body` | 16 / 24 px | 400 | 0 | Default body text |
| `body-md` | 14 / 20 px | 500 | 0 | Table rows, list items, button labels |
| `small` | 14 / 20 px | 400 | 0 | Helper text, metadata |
| `caption` | 12 / 16 px | 500 | +0.05em uppercase | Eyebrows, table headers, KPI labels |
| `mono-lg` | 28 / 32 px | 500 | 0 | KPI figure, receipt big amount |
| `mono-md` | 16 / 24 px | 500 | 0 | Ledger row amount, student code |
| `mono-sm` | 13 / 18 px | 500 | 0 | Tamper hash, receipt number |

### 3.3 Weight Usage

**400** body/helper. **500** table rows, button labels, mono numerics, captions — the weight that carries density. **600** section titles, card titles, drawer heads. **700** screen titles, display, KPI labels. Never 300 (too thin on cosmic bg) or 800+ (too shouty).

### 3.4 Numeric & Figure Features

```css
.amount, .kpi-figure, .ledger-row, td.numeric, code, kbd {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "zero" 1;
  letter-spacing: -0.01em;
}
```

- **Tabular figures everywhere numbers align** — KPI cards, ledger rows, invoice tables, heatmaps, sparkline labels — so digits don't jitter during count-up.
- **Slashed zero** prevents `0` vs `O` confusion in student codes and receipt hashes.
- **Amounts** are mono, right-aligned, currency symbol in `--text-muted`, figure in `--text-primary`: `₹ 12,500`.
- **Locale formatting** via `Intl.NumberFormat('en-IN')` → `₹ 1,24,500`; en-US fallback `$1,245.00`.

---

## 4. Spacing and Layout Grid

### 4.1 The 4px Base Scale

Every padding, margin, gap, and dimension is a multiple of **4px** — no 5px, no 7px, no 13px.

| Token | px | rem | Typical use |
|---|---|---|---|
| `space-1` | 4 | 0.25 | Icon-to-label within a button, tight gaps |
| `space-2` | 8 | 0.5 | Chip internal padding, small gaps |
| `space-3` | 12 | 0.75 | List row internal padding |
| `space-4` | 16 | 1 | Card gap, dense table padding (`p-4`) |
| `space-5` | 20 | 1.25 | Form field vertical spacing |
| `space-6` | 24 | 1.5 | Default card padding (`p-6`) |
| `space-8` | 32 | 2 | Section gap, gutter on `xl+` |
| `space-10` | 40 | 2.5 | Drawer top inset, screen padding on `xl+` |
| `space-12` | 48 | 3 | Hero block spacing |
| `space-16` | 64 | 4 | Empty-state illustration block |

### 4.2 12-Column Grid

```css
.content-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: var(--space-4);
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 var(--space-8);
}
```

- Sidebar (248px expanded / 72px collapsed) is *outside* the 12-column grid; the grid lives in the content pane.
- KPI grids: 1 KPI = 12 cols on `base` → 6 on `sm` → 4 on `lg` → 3 on `2xl` (per §14).
- Tables span all 12 columns. Drawer opens *over* the right 4 columns on `xl+`; over the bottom 100% on `< md`. Gutter: 32px on `xl+`, 24px on `lg`, 16px below.

### 4.3 Safe-Area Insets

Mobile respects `env(safe-area-inset-*)` everywhere:

```css
.app-shell {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}
.bottom-tab-bar {
  padding-bottom: max(env(safe-area-inset-bottom), 8px);
}
```

Status bar (iOS notch / Android punch-hole) never overlaps glass; home-indicator bar never underlaps the bottom tab bar; mobile drawer sheets get `max-height: calc(100vh - env(safe-area-inset-top) - 44px)`.

### 4.4 Glass-Panel Padding Recipe

| Panel type | Padding | Internal gap |
|---|---|---|
| KPI card | `p-6` (24px) | `gap-3` |
| Section card | `p-6` | `gap-4` |
| List row | `px-4 py-3` (16/12) | `gap-3` |
| Table cell | `px-4 py-3` | — |
| Drawer | `p-6` outer, `p-5` inner | `gap-6` |
| Modal | `p-6` | `gap-4` |
| Toast | `px-4 py-3` | `gap-3` |
| Chip / badge | `px-2.5 py-1` | `gap-1.5` |
| Button (default) | `px-4 py-2` | `gap-2` |
| Button (compact) | `px-3 py-1.5` | `gap-1.5` |

---

## 5. Glass Panel Recipe

### 5.1 The Canonical Glass Class

```css
.glass {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.37),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.glass-strong { /* hover/elevated */
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.14);
  box-shadow:
    0 12px 48px rgba(0, 0, 0, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.glass-faint { /* recede surfaces */
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(8px) saturate(120%);
  border-color: rgba(255, 255, 255, 0.04);
  box-shadow: none;
}
```

### 5.2 The Three Glass Tiers

The three tiers are defined in the §5.1 CSS (`.glass`, `.glass-strong`, `.glass-faint`); the canonical per-surface assignment lives in the §5.5 coverage map. Quick mnemonic: **faint** (2% / 8px blur) recedes, **default** (5% / 24px) is the workhorse, **strong** (8% / 24px) elevates focus.

### 5.3 The No-Glass-on-Glass Rule

> **Never nest a `.glass` panel inside another `.glass` panel.** Two `backdrop-filter` layers compound blur and produce a muddy, opaque-looking result that loses the aurora. Inside a glass panel, use **flat tinted surfaces** — `bg-white/[0.04]` with `border-white/5`, no `backdrop-filter`.

| Inside a `.glass` panel | Allowed? | Notes |
|---|---|---|
| `.glass-faint` divider | ✅ | Faint tier has no blur |
| `.neumo-raised` button | ✅ | Neumorphic, not glass |
| Flat `bg-white/[0.04]` sub-card | ✅ | No blur — safe to nest |
| Nested `.glass` / `.glass-strong` | ❌ | Muddy result, fails the aurora |

### 5.4 Glass + Accent Border (Status Surfaces)

When a glass panel signals status (KPI card with emerald accent, alert panel with flare), use a 2px left border + inner glow, not a full accent stroke:

```css
.glass-accent-emerald {
  border-left: 2px solid var(--accent-emerald);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.37),
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    inset 2px 0 12px rgba(0, 255, 157, 0.15);
}
```

A 2px border + inner glow reads as "this card is about emerald" without painting the whole surface emerald.

### 5.5 Glass Backgrounds — Screen-Level Coverage Map

**Glassmorphism is the background system.** Every structural surface in Buddysaradhi is a glass panel on the cosmic canvas. The table below is the canonical coverage map — every screen spec, every platform directory, every component anatomy must reference the glass tier used for its background. If a spec describes a surface not in this table, it is a bug.

| Surface | Glass tier | Rationale | Where specified |
|---|---|---|---|
| App shell root (the cosmic canvas itself) | (none — raw gradient `#0f0c29 → #24243e → #0a0a1a`) | The canvas is the aurora source; glass blurs what is behind it | §2.2 Root Background Recipe |
| Sidebar / bottom-tab bar (mobile) | `glass-strong` | Persistent chrome must stay legible over scrolling content | `04_Dashboard.md §3`, `mobile/03 §2` |
| Top header bar (desktop) | `glass-strong` sticky | Same — persistent chrome | `desktop/01 §4` |
| Screen container (the main scroll area) | (none — transparent over canvas) | The screen itself is not a panel; its cards are | `04_Dashboard.md §2` |
| KPI card | `glass` + accent left-border (§5.4) | Workhorse content card; accent signals semantic | §8.1, `04_Dashboard.md §4` |
| List row / table row | `glass-faint` band | Must recede so the data reads | §8.4, `05_Students.md §5` |
| Drawer / sheet panel | `glass-strong` | Elevated focus surface; slides over content | §8.7, `05_Students.md §7` |
| Modal dialog | `glass-strong` + backdrop `bg-black/60 + backdrop-blur-sm` | Highest focus; backdrop dims and blurs the screen beneath | §8.7 |
| Toast notification | `glass-strong` + 4px accent left-bar | Transient; must read over any screen | §8.8 |
| Command palette | `glass-strong` + backdrop | Modal-class focus | §8.11 |
| Empty-state card | `glass` | Centered content card, not elevated | §8.19 |
| Search bar tray | (none — `neumo-inset`, see §6) | Controls are neumorphic, not glass | §8.10 |
| Segmented control well | (none — `neumo-inset`) | Control | §8.5 |
| Toggle well | (none — `neumo-inset`) | Control | §6.4, §8.16 |
| Heatmap cell | flat tinted `bg-white/[0.04]` | Nested inside a glass dashboard card; no-glass-on-glass rule (§5.3) | §8.12, `06_Attendance.md §5` |
| Bar chart / sparkline | flat tinted or `glass-faint` gridlines only | Data viz must not compete with its container | §8.13, §8.14 |
| Marketing surfaces (hero / feature / pricing / download / testimonial / FAQ) | `glass` / `glass-strong` / `glass-faint` per role | Same tiers as product; one card per principle family, featured tier elevated | `product/02`–`product/08` (see §19) |
| Footer | `glass-faint` | Must recede; sticky per §13 | §13 |

> **Audit rule.** Any new surface introduced in a screen spec must be added to this table. A surface described without a glass tier (or a neumorphic recipe, for controls) is a spec defect — file it.

---

## 6. Neumorphic Surfaces

Neumorphism is the tactile extrusion layer. Used for **controls** (toggles, sliders, steppers, knobs, raised buttons) — never for content panels (those are glass). It lives on the cosmic canvas; it does **not** work on white (§6.5).

### 6.1 Raised Recipe

```css
.neumo-raised {
  background: #1a1a3a;
  border-radius: 12px;
  box-shadow:
    4px 4px 8px #0a0a1a,      /* dark shadow bottom-right */
    -4px -4px 8px #2a2a5a;    /* light shadow top-left */
}
```

Dual-shadow distance is always equal and opposite (`±4px` for 8px radius, `±6px` for 12px, `±8px` for 16px). Light source: top-left, 45°. Never rotate the light source — the entire OS shares one sun.

### 6.2 Inset Recipe

```css
.neumo-inset {
  background: #1a1a3a;
  border-radius: 12px;
  box-shadow:
    inset 4px 4px 8px #0a0a1a,
    inset -4px -4px 8px #2a2a5a;
}
```

Used for: input fields, search bar trays, pressed toggle wells, segmented-control backgrounds. The inset *receives* the raised knob.

### 6.3 Pressed Recipe

```css
.neumo-pressed {
  background: #15153a;
  border-radius: 12px;
  box-shadow:
    inset 2px 2px 4px #0a0a1a,
    inset -2px -2px 4px #2a2a5a;
  transform: translateY(1px);
}
```

A pressed control is an inset with **half the shadow distance** + a 1px downward translate. Used for `:active` on raised buttons and toggles mid-flip.

### 6.4 Toggle Anatomy (the attendance switch)

The toggle is a *raised* knob (emerald→cyan gradient + glow when on) inside an *inset* well; on = knob translates 28px right + emerald glow, off = muted slate. Full anatomy, states, and the `neumo-inset`/`neumo-raised` recipe breakdown live in **§8.16** (canonical). The snippet below is the inline JSX shorthand used in `06_Attendance.md`:

```tsx
<button className="relative h-9 w-16 rounded-full bg-[#1a1a3a]
                   shadow-[inset_4px_4px_8px_#0a0a1a,inset_-4px_-4px_8px_#2a2a5a]
                   transition-all duration-300">
  <span className="absolute top-1 left-1 h-7 w-7 rounded-full
                   bg-gradient-to-br from-[#00FF9D] to-[#00F0FF]
                   shadow-[0_0_12px_rgba(0,255,157,0.6)]
                   transition-transform duration-300
                   data-[on=true]:translate-x-7" />
</button>
```

Press feedback: `scale-95` + 60ms haptic (`P7 — motion is meaning`).

### 6.5 Why Neumorphism Works on Cosmic, Not on White

Neumorphism requires a **mid-tone canvas** so both shadows are visible. On the cosmic bg (`#1a1a3a`), the dark shadow reads as depth and the light shadow reads as elevation. On white, the light shadow disappears (white-on-white), the dark shadow alone looks like a flat 1990s bevel, and the dual-shadow extrusion illusion collapses.

> This is the structural reason Buddysaradhi is **dark-only** (§12). The neumorphic controls that give the OS its Apple-tactile feel are physically impossible on a light background without inventing a second, parallel surface system — exactly the kind of design debt that ages an app.

### 6.6 Neumorphic Component Coverage Map

**Neumorphism is the control system.** Every tactile control in Buddysaradhi is a neumorphic surface. The table below is the canonical coverage map — any spec describing a control must reference the neumorphic recipe used. If a control is not in this table, it is a bug.

| Control | Recipe | Knob / Active element | Where specified |
|---|---|---|---|
| Primary button (raised) | `neumo-raised` | n/a (the whole button is raised) | §8.2 |
| Pressed button (`:active`) | `neumo-pressed` | n/a | §6.3, §8.2 |
| Input field well | `neumo-inset` | the typed text + caret | §8.9 |
| Search bar tray | `neumo-inset` | the typed query | §8.10 |
| Segmented control background | `neumo-inset` | active option = `neumo-raised` pill | §8.5 |
| Toggle switch well | `neumo-inset` | raised knob (emerald→cyan gradient when on) | §6.4, §8.16 |
| Slider track | `neumo-inset` | raised knob (scales 1.1 on drag) | §8.17 |
| Stepper well | `neumo-inset` | `±` buttons = `neumo-raised` | §8.18 |
| Checkbox (rare — toggles preferred) | `neumo-inset` + raised check | emerald check on press | (not in v1 core) |
| Radio group (rare) | `neumo-inset` + raised dot | active dot = `neumo-raised` | (not in v1 core) |
| Attendance mark button (Present/Absent/Late/Excused) | `neumo-raised`; active = `neumo-pressed` + accent glow | the active mark | `06_Attendance.md §4`, §8.16 |
| Command palette list row (keyboard-highlighted) | flat `bg-cyan/10` (NOT neumorphic — list rows are glass-faint per §8.4) | n/a | §8.11 |

> **The single rule.** If it is a **control** (the user manipulates it: button, toggle, slider, input, stepper, segmented control), it is **neumorphic**. If it is a **surface** (the user reads it: card, panel, row, modal, toast), it is **glass**. Never invert. Never mix. A glass button or a neumorphic content panel is a design-system violation — file it.

> **Accessibility note.** Neumorphic controls must **never** rely on shadow alone to communicate state. Every neumorphic control pairs its shadow change with (a) an accent colour change (emerald glow on toggle-on, cyan ring on input-focus) and (b) a text/icon label change. This satisfies WCAG 2.1 §1.4.1 (Use of Color) and §1.4.11 (Non-text Contrast) — see §10.6.

---

## 7. Motion Principles & Microinteraction Catalogue

### 7.1 Motion Tokens

| Token | Easing / Duration | Use |
|---|---|---|
| `ease-out-quart` | `cubic-bezier(0.25, 1, 0.5, 1)` | Default enter/exit |
| `ease-in-quart` | `cubic-bezier(0.5, 0, 1, 0.25)` | Exit only |
| `ease-in-out-quart` | `cubic-bezier(0.76, 0, 0.24, 1)` | State transitions |
| `ease-spring` | Framer `{ stiffness: 380, damping: 30, mass: 0.8 }` | Default physical motion |
| `ease-spring-soft` | Framer `{ stiffness: 320, damping: 32 }` | Sheets, drawers, modals |
| `dur-fast` / `dur-base` / `dur-slow` / `dur-xslow` | 120 / 180 / 240 / 400ms | Hover / card-enter / sheet-enter / count-up |
| `stagger-step` | 30ms | Stagger between siblings (≤4 only) |

### 7.2 Reduced-Motion Override

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Framer Motion variants read `useReducedMotion()` and substitute `dur-instant` + `opacity`-only transitions. Aurora blobs freeze. KPI count-ups snap to final value.

### 7.3 Named Microinteractions

| Name | Trigger | Duration | Easing | Snippet |
|---|---|---|---|---|
| **`tab-underline-slide`** | Tab change | 220ms | `ease-out-quart` | `layoutId="tab-underline"` on active pill; Framer animates `layout` |
| **`kpi-count-up`** | First paint per session | 400ms | `ease-out-quart` | `useMotionValue(0)` → `animate(mv, target, { duration: 0.4 })` → `useTransform` → `₹ 1,24,500` |
| **`card-hover-lift`** | Mouse enter | 180ms | `ease-spring` | `whileHover={{ y: -2 }}` + shadow 8/32 → 12/48 |
| **`modal-enter`** | Open modal | 240ms | `ease-spring-soft` | `initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}`; backdrop fade 120ms |
| **`row-press`** | Tap row | 120ms | `ease-out-quart` | `whileTap={{ scale: 0.985, backgroundColor: rgba(255,255,255,0.08) }}` |
| **`shimmer-loading`** | Skeleton visible | 1600ms loop | linear sweep | `linear-gradient(90deg, …0.02, …0.08, …0.02); background-size: 200%; animation: shimmer 1.6s infinite;` |
| **`aurora-drift`** | Always | 24s loop | `ease-in-out` | Three radial-gradient blobs (emerald/cyan/violet @ 3%) translate-rotate via CSS keyframes; disabled under reduced-motion |

### 7.4 Stagger & Motion Rules

- Stagger **only the first 4** siblings entering together (`delay = i * 30ms` for `i < 4`, `delay = 0` beyond). Never on tables of >10 rows (disorienting) and never on re-renders — only first mount per session.

> 1. **NEVER** parallax on scroll. (Breaks the cosmic-is-sky metaphor; vestibular discomfort.)
> 2. **NEVER** auto-rotate carousels. (Tutors reading a number shouldn't have it yanked away.)
> 3. **NEVER** enter animations delaying first paint > 16ms. (Perf budget — `04_Dashboard.md` §6 O1: median < 1.5s to truth.)

Per `01_Product_Principles.md` P7, motion has two jobs: confirm state changes and preserve spatial continuity. Decorative motion — confetti, pulsing CTA, wobble on hover — is forbidden. The OS is a tool, not a toy.

---

## 8. Component Vocabulary

Every component below is specified to design-system grade. For each: anatomy, states, accent usage, spacing, minimum touch target.

### 8.1 KPI Card
**Anatomy:** caption label (top, `--text-muted`) → mono-lg figure (`--text-primary`, accent left-border) → delta row (accent) → sparkline (24px, accent stroke 60%). **States:** default → hover (`card-hover-lift`) → loading (skeleton + `shimmer-loading`). **Accent:** 2px left-border in semantic accent; figure stays `--text-primary`. **Spacing:** `p-6`, `gap-3`. **Min target:** full card clickable, 44px on mobile.

**Background:** `.glass` (5% white, 24px blur) + 2px accent left-border (§5.4). **Not neumorphic** — this is a surface, not a control.

```
┌─────────────────────────────┐
│▌ Collected (MTD)            │   ← caption, --text-muted
│▌                             │
│▌ ₹ 2,45,500                 │   ← mono-lg, --text-primary, tabular-nums
│▌ ▲ 12.4% vs last month      │   ← delta, emerald accent
│▌                             │
│▌ ╱╲╱╲╱╲╲╱╲╱╲╱╲╲╲╱╲╱╲╱╲       │   ← sparkline, 24px, accent 60%
└─────────────────────────────┘
   ↑ 2px emerald left-border + inset glow (§5.4)
   ↑ .glass: rgba(255,255,255,0.05) + backdrop-blur(24px)
   ↑ p-6 (24px) padding
```

### 8.2 Glass Button
**Anatomy:** `[icon?] label` centered, `rounded-xl`, `glass` or `neumo-raised`. **States:** default → hover (`glass-strong`) → active (`neumo-pressed` + `scale-95`) → focus-visible (cyan ring) → disabled (`opacity-40`). **Variants:** primary (emerald glow + `--text-on-accent`), secondary (`glass` + `--text-primary`), ghost (transparent + `--text-secondary`), destructive (flare glow + `--text-on-accent`). **Spacing:** `px-4 py-2`, `gap-2`. **Min target:** 44px on mobile, 36px desktop.

**Background:** Primary/secondary = `.neumo-raised` (it is a tactile control — §6.6); Ghost = transparent. **On `:active`** → `.neumo-pressed` (inset shadows + 1px translate). See §6.6 coverage map.

```
  PRIMARY (emerald glow)        SECONDARY (glass)         GHOST (transparent)
┌──────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│   [+] Add Student    │    │   Filter           │    │   Cancel           │
└──────────────────────┘    └────────────────────┘    └────────────────────┘
  ↑ neumo-raised:               ↑ neumo-raised:         ↑ transparent, no shadow
    4px 4px 8px #0a0a1a          4px 4px 8px #0a0a1a     --text-secondary
   -4px -4px 8px #2a2a5a        -4px -4px 8px #2a2a5a   hover: --text-primary
   + emerald glow ring          + no glow              focus: cyan ring

  PRESSED (:active)            FOCUS-VISIBLE          DISABLED
┌──────────────────────┐    ┌ ═══════════════════┐    ┌──────────────────────┐
│   [+] Add Student    │    │   [+] Add Student  │    │   [+] Add Student    │
└──────────────────────┘    └ ═══════════════════┘    └──────────────────────┘
  ↑ neumo-pressed:              ↑ cyan 2px ring +         ↑ opacity-40, no glow
    inset 2px 2px 4px            glow (§10.3)             cursor-not-allowed
    translateY(1px)              keyboard parity
```

### 8.3 Chip / Badge
**Anatomy:** `[dot/icon] label` inline, `rounded-full`, tinted bg (§2.3). **States:** default → hover (border tightens) → active (border 40%) → dismissible (X at right). **Accent:** per §2.4. **Spacing:** `px-2.5 py-1`, `gap-1.5`. **Min target:** 28px height (informational, not primary action).

**Background:** flat tinted (§2.3 tinting recipe) — NOT glass, NOT neumorphic. Chips are inline labels, not surfaces or controls. Dismissible chips gain a `neumo-raised` X button (44px hit area padded beyond 28px visual).

```
  PAID (emerald)      PARTIAL (amber)     OVERDUE (flare)     EXCUSED (violet)
 ╭───────────╮      ╭─────────────╮    ╭─────────────╮    ╭──────────────╮
 │ ● Paid     │      │ ◐ Partial   │    │ ✕ Overdue   │    │ − Excused    │
 ╰───────────╯      ╰─────────────╯    ╰─────────────╯    ╰──────────────╯
   bg-emerald/10       bg-amber/10        bg-flare/10        bg-violet/10
   border-emerald/30   border-amber/30    border-flare/30    border-violet/30
   text-emerald        text-amber         text-flare         text-violet

  DISMISSIBLE                   ACTIVE (selected filter)
 ╭───────────────────╮         ╭───────────────────╮
 │ ● Paid          ✕ │         │ █ All Students    │
 ╰───────────────────╯         ╰───────────────────╯
   ↑ X is neumo-raised            ↑ border-40%, bg-accent/15
     44px hit area                   text-accent
```

### 8.4 List Row
**Anatomy:** `[avatar/icon] [primary] [secondary] [right-meta] [chevron?]` in a `glass-faint` band. **States:** default → hover (`bg-white/5`) → selected (`bg-cyan/10` + cyan 2px left-bar) → pressed (`row-press`). **Spacing:** `px-4 py-3`, `gap-3`. **Min target:** full row, ≥ 48px on mobile.

**Background:** `.glass-faint` (2% white, 8px blur) — the receding tier (§5.1, §5.5). Selected state adds a 2px cyan left-bar (no full border). NOT neumorphic — it is a surface.

```
  DEFAULT                          HOVER                      SELECTED
┌────────────────────────────┐  ┌────────────────────────────┐  ┌▌──────────────────────────┐
│ ●  Aarav Sharma             │  │ ●  Aarav Sharma            ▌│  │▌●  Aarav Sharma           │
│    Grade 10 · CBSE          │  │    Grade 10 · CBSE         ▌│  │▌    Grade 10 · CBSE       │
│                    ₹ 4,500 ▌│  │                    ₹ 4,500▌│  │▌                  ₹ 4,500 │
│                         ›   │  │                         ›  ▌│  │▌                        ›│
└────────────────────────────┘  └────────────────────────────┘  └▌──────────────────────────┘
   ↑ glass-faint band              ↑ bg-white/5 overlay          ↑ bg-cyan/10 + 2px cyan left-bar
   ↑ avatar=32px gradient          ↑ cursor-pointer              ↑ text-cyan on primary
   ↑ right-meta = mono-sm          ↑ 60ms transition             ↑ aria-selected="true"
```

### 8.5 Segmented Control
**Anatomy:** N options in a `neumo-inset` well; active option is a `neumo-raised` pill with `glass-strong` overlay; underline uses `tab-underline-slide`. **States:** inactive (`--text-secondary`) → active (`--text-primary` + cyan glow) → hover. **Spacing:** `p-1` well, `px-3 py-1.5` per option. **Min target:** 36px height.

**Background:** Well = `.neumo-inset` (control, §6.6); active pill = `.neumo-raised` + `.glass-strong` overlay. NOT a glass surface — it is a control.

```
  ╭─ neumo-inset well ──────────────────────────────────────╮
  │                                                          │
   │  ╭────────╱╮   ╭──────────╮   ╭──────────╮   ╭────────╮  │
   │  │ ▌ List  │   │  Board   │   │ Calendar │   │ Stats  │  │
   │  ╰────────╯   ╰──────────╯   ╰──────────╯   ╰────────╯  │
  │     ↑ active        ↑ hover       ↑ inactive    ↑ inactive│
  ╰──────────────────────────────────────────────────────────╯
     ↑ inset 4px 4px 8px #0a0a1a, -4px -4px 8px #2a2a5a

  ACTIVE pill detail:
    ╭────────╱╮
    │ ▌ List  │   ← neumo-raised (extruded up) + glass-strong overlay
    ╰────────╯   ← text-primary + cyan glow ring
                   ← ▌ = 2px cyan left-bar inside the pill (tab-underline-slide)
```

### 8.6 Tab Bar
**Anatomy:** row of tabs, `tab-underline-slide` indicator (cyan, 2px, full pill behind active label). **States:** inactive → hover (`--text-secondary` → `--text-primary`) → active (cyan pill `bg-cyan/10`). **Spacing:** `gap-2`, `px-4 py-2` per tab. **Min target:** 40px height.

**Background (desktop top-bar tabs):** `.glass-strong` sticky (§5.5). **Background (mobile bottom-tab bar):** `.glass-strong` + safe-area inset (§4.3). Active tab = cyan pill `bg-cyan/10` (flat tinted, not neumorphic — the pill is an indicator, not a control).

```
  DESKTOP TOP TABS (in glass-strong sticky header)
┌──────────────────────────────────────────────────────────────────┐
│  [Logo]   Dashboard   Students   Attendance   Fees   Settings  │
│             ═════════                                           │
│             ↑ cyan 2px underline, tab-underline-slide          │
│             ↑ active: bg-cyan/10 pill behind label             │
└──────────────────────────────────────────────────────────────────┘
  ↑ glass-strong: 8% white, 24px blur, sticky top-0, z-30

  MOBILE BOTTOM TAB BAR (in glass-strong + safe-area)
┌────────┬────────┬────────┬────────┬────────┐
│   ◈    │   👥   │   ✓    │   ₹    │   ⚙   │
│ Home   │Students│ Attend │  Fees  │ Setngs │
└────────┴────────┴────────┴────────┴────────┘
  ↑          ↑ active: cyan glow icon + text-cyan
  ↑ glass-strong + padding-bottom: env(safe-area-inset-bottom)
  ↑ 44×44px min touch target per tab (§10.2)
```

### 8.7 Modal / Sheet
**Anatomy:** backdrop (`bg-black/60` + `backdrop-blur-sm`) + `.glass-strong` panel + close button (top-right, ghost). **States:** enter (`modal-enter`) → idle → exit (mirror, 180ms). **Accent:** headline `--text-primary`, body `--text-secondary`, CTA row uses button variants. **Spacing:** `p-6`, `gap-4`. `aria-modal="true"`, focus-trap active. Backdrop click = cancel. ESC = cancel.

**Background:** Backdrop = `bg-black/60` + `backdrop-blur-sm` (dims and blurs the screen beneath). Panel = `.glass-strong` (8% white, 24px blur) — the highest-focus tier. Close button = ghost (transparent). CTAs = `.neumo-raised` (controls, §6.6).

```
  ┌──────────────────────────────────────────────────────────┐
  │  ░░░░░░░░░░░░░ backdrop: bg-black/60 + backdrop-blur ░░░  │
  │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
  │  ░░░░░░  ┌───────────────────────────────────╲░░░░░░░░░  │
  │  ░░░░░░  │  Record Payment                ✕  │░░░░░░░░░  │
  │  ░░░░░░  ├───────────────────────────────────┤░░░░░░░░░  │
  │  ░░░░░░  │                                   │░░░░░░░░░  │
  │  ░░░░░░  │  Student:  Aarav Sharma    ›      │░░░░░░░░░  │
  │  ░░░░░░  │  Amount:   ₹ [_____________]     │░░░░░░░░░  │
  │  ░░░░░░  │  Method:   [Cash ▼]               │░░░░░░░░░  │
  │  ░░░░░░  │  Date:     [2025-01-15]            │░░░░░░░░░  │
  │  ░░░░░░  │                                   │░░░░░░░░░  │
  │  ░░░░░░  │  ┌────────────┐  ┌──────────────┐ │░░░░░░░░░  │
  │  ░░░░░░  │  │   Cancel   │  │ ▌ Save Payment│ │░░░░░░░░░  │
  │  ░░░░░░  │  └────────────┘  └──────────────┘ │░░░░░░░░░  │
  │  ░░░░░░  └───────────────────────────────────┘░░░░░░░░░  │
  │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
  └──────────────────────────────────────────────────────────┘
     ↑ backdrop: click = cancel. ESC = cancel. focus-trap active.
     ↑ panel: .glass-strong (8% white, 24px blur), p-6, gap-4
     ↑ ✕ = ghost button (transparent, --text-secondary)
     ↑ inputs = neumo-inset (§8.9). CTAs = neumo-raised (§8.2)
```

### 8.8 Toast
**Anatomy:** `[accent-icon] [headline + body] [action?] [close]` in a `glass-strong` card with accent left-bar (4px). **States:** enter (slide up + fade 240ms) → idle (4s auto-dismiss) → swipe-to-dismiss → exit (slide down + fade 180ms). **Accent:** per severity (§2.4); error persistent. **Spacing:** `px-4 py-3`, `gap-3`. `aria-live="polite"`; error uses `aria-live="assertive"`.

**Background:** `.glass-strong` (8% white, 24px blur) + 4px accent left-bar. NOT neumorphic — it is a transient surface. Positioned `fixed bottom-4 right-4` (desktop) / `fixed bottom-20 inset-x-4` (mobile, above tab bar).

```
  SUCCESS (emerald)              ERROR (flare, persistent)       INFO (cyan)
┌▌──────────────────────────┐  ┌▌──────────────────────────┐   ┌▌──────────────────────────┐
│▌ ✓  Payment recorded      │  │▌ ✕  Receipt void failed   │   │▌ ℹ  Sync paused — back up │
│▌    RCP-000043 · ₹4,500   │  │▌    PIN required. Retry?  │   │▌    to resume.            │
│▌              [Undo]  ✕   │  │▌              [Retry]  ✕  │   │▌                   ✕       │
└▌──────────────────────────┘  └▌──────────────────────────┘   └▌──────────────────────────┘
  ↑ 4px emerald left-bar         ↑ 4px flare left-bar             ↑ 4px cyan left-bar
  ↑ .glass-strong                ↑ .glass-strong                  ↑ .glass-strong
  ↑ aria-live="polite"           ↑ aria-live="assertive"          ↑ aria-live="polite"
  ↑ 4s auto-dismiss              ↑ persistent (no auto-dismiss)   ↑ 4s auto-dismiss
  ↑ swipe-down to dismiss        ↑ must tap ✕ or Retry            ↑ swipe-down to dismiss
```

### 8.9 Input Field
**Anatomy:** `neumo-inset` well + label (caption, `--text-muted`) + input text (`--text-primary`) + helper/error below. **States:** default → focus (cyan ring + cyan glow `box-shadow: inset 0 0 0 2px rgba(0,240,255,0.4)`) → error (flare ring + flare helper) → disabled (`opacity-50`). **Spacing:** `px-3 py-2`, `gap-1` label-input. **Min target:** 44px on mobile.

**Background:** `.neumo-inset` (control, §6.6). The typed text sits inside the inset well. Focus adds a cyan inset ring + glow. Error swaps the ring to flare.

```
  DEFAULT                        FOCUS                          ERROR
  Student name                   Student name                   Student name
  ┌──────────────────────┐      ┌══════════════════════┐      ┌──────────────────────┐
  │ Aarav Sharma         │      │ Aarav Sharma|        │      │ Aa                   │
  └──────────────────────┘      └══════════════════════┘      └──────────────────────┘
  ↑ neumo-inset                   ↑ cyan 2px inset ring          ↑ flare 2px inset ring
    inset 4px 4px 8px #0a0a1a     + inset 0 0 12px rgba(0,240,255,0.3)
   -4px -4px 8px #2a2a5a         ↑ caret blinks                  "Name must be at least 3 chars"
  ↑ --text-muted label           ↑ --text-primary                ↑ flare helper text below

  ── with helper text ──
  Monthly fee (₹)
  ┌──────────────────────┐
  │ 4500                 │
  └──────────────────────┘
  Enter the amount in rupees. Stored as integer paise.
  ↑ --text-muted helper, 12px caption
```

### 8.10 Search Bar
**Anatomy:** `neumo-inset` well + `Search` lucide icon (left, `--text-muted`) + input + `⌘K` kbd chip (right) + clear-X (when populated). **States:** default → focus (cyan ring + 60ms widening on `md+`) → populated → loading. **Spacing:** `px-3 py-2`, `gap-2`. Min 40px height. `Cmd/Ctrl+K` from anywhere → focuses global search.

**Background:** `.neumo-inset` (control, §6.6). The `⌘K` kbd chip is a flat tinted badge (§2.3). The clear-X is a `neumo-raised` micro-button (44px hit area).

```
  DEFAULT (unfocused)             FOCUS                          POPULATED
  ┌──────────────────────────┐   ┌══════════════════════════┐   ┌──────────────────────────┐
  │ 🔍  Search students…  ⌘K │   │ 🔍  Aarav|          ⌘K   │   │ 🔍  Aarav Sha|      ✕  ⌘K│
  └──────────────────────────┘   └══════════════════════════┘   └──────────────────────────┘
  ↑ neumo-inset well              ↑ cyan ring + glow              ↑ clear-X appears (neumo-raised)
  ↑ 🔍 = lucide Search icon       ↑ 60ms width widen on md+       ↑ dropdown opens below:
  ↑ placeholder --text-muted      ↑ caret blinks                    ┌────────────────────────┐
  ↑ ⌘K = flat tinted kbd chip                                       │ ● Aarav Sharma  10-A  │
                                                                    │ ● Aarav Patel   9-B   │
                                                                    └────────────────────────┘
```

### 8.11 Command Palette
**Anatomy:** modal + search input (top) + grouped list (Actions, Navigate, Students, Specs) + footer hint (`↑↓ navigate · ↵ select · esc close`). **States:** open → typing (filters, fuzzy match) → arrow-navigate (cyan highlight) → select (action runs, palette closes). **Spacing:** `p-4`, rows `px-3 py-2`. `aria-modal="true"`, `role="combobox"`.

**Background:** Backdrop = `bg-black/60 + backdrop-blur-sm`. Panel = `.glass-strong`. Search input = `.neumo-inset` (control). List rows = flat `bg-cyan/10` on highlight (NOT neumorphic — rows are surfaces, §6.6).

```
  ┌──────────────────────────────────────────────────────────┐
  │  ░░░░░░░░░░░░ backdrop: bg-black/60 + backdrop-blur ░░░░  │
  │  ░░░░  ┌──────────────────────────────────────────╲░░░░  │
  │  ░░░░  │  ┌──────────────────────────────────┐   │░░░░  │
  │  ░░░░  │  │ 🔍  Add payment, jump to student…│   │░░░░  │
  │  ░░░░  │  └──────────────────────────────────┘   │░░░░  │
  │  ░░░░  │                                        │░░░░  │
  │  ░░░░  │  Actions                               │░░░░  │
  │  ░░░░  │  ┌──────────────────────────────────┐  │░░░░  │
  │  ░░░░  │  │ +  Record Payment         ⌘P     │  │░░░░  │
  │  ░░░░  │  │ ✓  Mark Attendance        ⌘A     │  │░░░░  │
  │  ░░░░  │  └──────────────────────────────────┘  │░░░░  │
  │  ░░░░  │  Navigate                              │░░░░  │
  │  ░░░░  │  ┌══════════════════════════════════┐  │░░░░  │
  │  ░░░░  │  ║ → Go to Dashboard         ⌘1     ║  │░░░░  │   ← arrow-highlighted
  │  ░░░░  │  └──────────────────────────────────┘  │░░░░  │      flat bg-cyan/10
  │  ░░░░  │    Go to Students         ⌘2           │░░░░  │
  │  ░░░░  │                                        │░░░░  │
  │  ░░░░  │  ↑↓ navigate · ↵ select · esc close    │░░░░  │
  │  ░░░░  └──────────────────────────────────────────░░░░  │
  └──────────────────────────────────────────────────────────┘
```

### 8.12 Heatmap Cell
**Anatomy:** 12×12 (mobile) / 16×16 (desktop) `rounded-[2px]` square; color = intensity (per BR-CALC-07/08, `12_Business_Rules.md`). **States:** default → hover (tooltip) → click (drill). **Accent:** emerald gradient (low → high); amber for partial; flare for absent. **Min target:** cell below 44px, but parent grid wraps each cell in a 44px hit-target; keyboard nav moves cell-by-cell.

**Background:** flat tinted `bg-white/[0.04]` — NOT glass, NOT neumorphic. Nested inside a `.glass` dashboard card (§5.3 no-glass-on-glass rule). Cell colour = semantic intensity (emerald/amber/flare/violet-stripe).

```
  12×12 grid (mobile) inside a .glass dashboard card:
  ┌──────────────────────────────────────────────┐
  │  Attendance Heatmap — January 2025           │
  │  ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐        │
  │  │██│██│░░│██│██│██│▓▓│██│██│██│██│██│  W1   │
  │  ├──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┤        │
  │  │██│▓▓│██│██│██│██│██│██│░░│██│██│██│  W2   │
  │  ├──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┤        │
  │  │██│██│██│▓▓│██│██│██│██│██│  │  │  │  W3   │
  │  └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘        │
  │   M  T  W  T  F  S  S  M  T  W  T  F          │
  │  ██ = present (emerald)   ▓▓ = late (amber)    │
  │  ░░ = absent (flare)       ▒▒ = holiday (violet-stripe)
  └──────────────────────────────────────────────┘
   ↑ parent = .glass card. Cells = flat bg-white/[0.04] + semantic tint.
   ↑ each cell wrapped in 44px hit-target (§10.2)
   ↑ hover = tooltip "Tue 14 Jan: Present, 9:02 AM"
```

### 8.13 Bar Chart
**Anatomy:** vertical bars, `rounded-t-sm`, `glass-faint` gridlines, x-axis labels (caption, `--text-muted`), y-axis labels (mono-sm). **States:** default → hover (highlight + tooltip) → click (drill). **Accent:** emerald (collected) or amber (due); hover bar brightens + inner glow.

**Background:** flat tinted gridlines (`glass-faint`, §5.1) — the gridlines must recede. Bars are flat accent fills (emerald or amber), NOT glass, NOT neumorphic. Nested inside a `.glass` dashboard card.

```
  Fees Collected — Last 6 Months (inside .glass card)
  ┌──────────────────────────────────────────────────┐
  │ ₹3L ┤  ┌──┐                                    │
  │     │  │  │                                    │
  │ ₹2L ┤  │██│        ┌──┐                        │
  │     │  │██│        │██│        ┌──┐            │
  │ ₹1L ┤  │██│  ┌──┐  │██│  ┌──┐  │██│  ┌──┐      │
  │     │  │██│  │██│  │██│  │██│  │██│  │██│      │
  │  ₹0 ┼──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──    │
  │        Aug  Sep  Oct  Nov  Dec  Jan            │
  │        ↑ --text-muted caption labels            │
  │        ↑ bars = flat emerald (collected)        │
  │        ↑ hover bar: brightens + inset glow       │
  │        ↑ gridlines = .glass-faint (recede)       │
  └──────────────────────────────────────────────────┘
```

### 8.14 Sparkline
**Anatomy:** 80×24 px SVG path, 1.5px stroke, no axes, last-point dot. **States:** static; hover on parent KPI highlights last dot. **Accent:** matches KPI semantic (emerald collected / amber due / cyan attendance).

**Background:** none — transparent SVG inside a `.glass` KPI card (§8.1). NOT glass, NOT neumorphic — it is a data glyph.

```
  Inside a .glass KPI card (§8.1):
  ┌─────────────────────────────┐
  │▌ Collected (MTD)            │
  │▌ ₹ 2,45,500                 │
  │▌ ▲ 12.4% vs last month      │
  │▌                             │
  │▌     ╱╲                      │
  │▌    ╱  ╲    ╱╲      ╱●← last-point dot (emerald)
  │▌   ╱    ╲  ╱  ╲    ╱         │   ← 1.5px stroke
  │▌  ╱      ╲╱    ╲__╱          │   ← accent at 60% opacity
  │▌                             │
  └─────────────────────────────┘
```

### 8.15 Avatar
**Anatomy:** 32×32 default (40×40 drawer, 24×24 lists), `rounded-full`, gradient bg (emerald→cyan or amber→flare by student-code hash), initials in `--text-on-accent`. **States:** default → hover (subtle ring) → with status dot (bottom-right). No min target — surrounding row carries the tap.

**Background:** gradient fill (emerald→cyan OR amber→flare, deterministic by student-code hash). NOT glass, NOT neumorphic — it is a glyph. Status dot = flat accent fill.

```
  24px (list row)        32px (default)          40px (drawer)         with status dot
   ╭───╮                  ╭─────╮                 ╭───────╮               ╭───────╮
   │ AS│                  │ AS  │                 │  AS   │              │  AS   │
   ╰───╯                  ╰─────╯                 ╰───────╯              ╰───────╯╮●
    ↑ emerald→cyan         ↑ amber→flare            ↑ emerald→cyan          ↑ status dot
      gradient               gradient                 gradient                 (bottom-right)
      initials = white       20px font                24px font                emerald=paid
                                                                                   flare=overdue
```

### 8.16 Toggle
**Anatomy:** `neumo-inset` well (64×36px) + raised knob (28×28px) (§6.4). **States:** off (slate knob, no glow) → on (emerald→cyan gradient knob, emerald glow) → disabled. **Accent:** on-state glow = emerald; destructive toggles use flare. **Min target:** 44×44px hit area (padded beyond the 64×36 visual).

**Background:** `.neumo-inset` well (control, §6.6). Knob = `.neumo-raised` (extruded up). On = knob translates 28px right + emerald→cyan gradient + glow. Off = slate knob, no glow, no gradient.

```
  OFF                                ON                               DISABLED
  ┌──────────────────────┐           ┌──────────────────────┐          ┌──────────────────────┐
  │  ●                   │           │                   ●  │          │  ●                   │
  └──────────────────────┘           └──────────────────────┘          └──────────────────────┘
   ↑ neumo-inset well                 ↑ neumo-inset well                 ↑ neumo-inset well
     inset 4px 4px 8px #0a0a1a          inset 4px 4px 8px #0a0a1a          opacity-50
    -4px -4px 8px #2a2a5a              -4px -4px 8px #2a2a5a              cursor-not-allowed
   ↑ knob = neumo-raised             ↑ knob = neumo-raised              ↑ knob = slate, no glow
     slate (#3a3a5a)                   emerald→cyan gradient
     no glow                           + 0 0 12px rgba(0,255,157,0.6)
   ↑ 44×44px hit area                 ↑ translateY(0)                    ← off-position
     (padded beyond 64×36 visual)      (knob translated 28px right)
```

### 8.17 Slider
**Anatomy:** `neumo-inset` track + raised knob + accent fill (left of knob). **States:** default → focus (cyan ring) → drag (knob scales `1.1`) → disabled. **Accent:** fill in cyan (selection) or emerald (value). **Min target:** knob 24px visual, 44px hit area.

**Background:** Track = `.neumo-inset` (control, §6.6). Knob = `.neumo-raised`. Fill = flat accent tint (cyan or emerald). NOT glass.

```
  DEFAULT (value = 40%)              DRAGGING (knob scales 1.1)
  ┌──────────────────────────────┐   ┌──────────────────────────────┐
  │  ████████░░░░░░░░░░░░░░░░░░ │   │  ████████░░░░░░░░░░░░░░░░░░ │
  │           ●                  │   │           ◉  ← scale(1.1)     │
  └──────────────────────────────┘   └──────────────────────────────┘
   ↑ track = neumo-inset               ↑ track = neumo-inset
   ↑ fill = flat cyan tint (40%)       ↑ knob = neumo-raised, scaled
   ↑ knob = neumo-raised (24px)        ↑ cyan ring + glow
   ↑ 44px hit area (padded)            ↑ haptic 60ms on grab
```

### 8.18 Stepper
**Anatomy:** `[-] [value] [+]` in a `neumo-inset` well; `±` are `neumo-raised` buttons. **States:** default → hover → press (`neumo-pressed`) → at-min (`−` disabled) → at-max (`+` disabled). **Accent:** value mono `--text-primary`; ± buttons `--text-secondary` → cyan on hover. **Min target:** 44px buttons on mobile.

**Background:** Well = `.neumo-inset` (control, §6.6). `±` buttons = `.neumo-raised`; on `:active` → `.neumo-pressed`. Value = flat display, mono font.

```
  DEFAULT                  HOVER (+ button)          AT-MIN (− disabled)        AT-MAX (+ disabled)
  ┌──────────────────┐    ┌──────────────────┐     ┌──────────────────┐       ┌──────────────────┐
  │ (−)   3    (+)   │    │ (−)   3   ╱(+)╲  │     │(−)disabled 4 (+)│       │ (−)   0  (+)dis.│
  └──────────────────┘    └──────────────────┘     └──────────────────┘       └──────────────────┘
   ↑ well = neumo-inset     ↑ + button = neumo-raised  ↑ − = opacity-40          ↑ + = opacity-40
   ↑ (−)(+) = neumo-raised    + cyan glow on hover       cursor-not-allowed        cursor-not-allowed
   ↑ value = mono            ↑ value unchanged          ↑ value = 4 (min)          ↑ value = 0 (max)
   ↑ 44px buttons (mobile)                              ↑ − disabled (at min)      ↑ + disabled (at max)
```

### 8.19 Empty State
**Anatomy:** illustration (120×120, line-art cyan/emerald) → headline (`h3`) → sub (`body-md`, `--text-secondary`) → primary CTA (emerald glass button) → secondary link. **Spacing:** `p-12` outer, `gap-4` internal. **Min target:** CTA at 44px height.

**Background:** `.glass` card (5% white, 24px blur) — centered content card, not elevated. Illustration = custom SVG line-art (NOT lucide, per §9.3). CTA = `.neumo-raised` (control, §6.6).

```
  ┌──────────────────────────────────────────────────┐
  │                                                  │
  │                    ╭────────╮                    │
  │                    │  ┌──┐  │   ← 120×120 SVG    │
  │                    │  │Grad│  │     line-art      │
  │                    │  └──┘  │     cyan+emerald   │
  │                    ╰────────╯                    │
  │                                                  │
  │              No students yet                     │  ← h3, --text-primary
  │         Add your first student in 30s.            │  ← body-md, --text-secondary
  │                                                  │
  │         ┌──────────────────────┐                 │
  │         │  [+] Add Student     │                 │  ← neumo-raised, emerald glow
  │         └──────────────────────┘                 │
  │              or import a CSV                     │  ← ghost link, --text-secondary
  │                                                  │
  └──────────────────────────────────────────────────┘
   ↑ .glass card, p-12, gap-4, centered text
```

### 8.20 Skeleton
**Anatomy:** `glass-faint` block + `shimmer-loading` overlay, shaped to match eventual content (KPI skeleton = label bar + figure bar + delta bar; row skeleton = avatar circle + two text bars). **States:** shimmering → resolved (fade 120ms). Neutral — no accent. `aria-busy="true"` on parent.

**Background:** `.glass-faint` blocks (2% white, 8px blur) — the receding tier. Shimmer overlay = diagonal gradient sweep, 1.2s loop, accent-neutral (white at 5% opacity). NOT neumorphic.

```
  KPI SKELETON                   LIST ROW SKELETON (×3)
  ┌─────────────────────────┐    ┌──────────────────────────────────┐
  │▌░░░░░░░░░░░░░░░░░░░░░░░│    │ ●  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
  │▌                         │    │    ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
  │▌░░░░░░░░░░░░░░░░░░       │    └──────────────────────────────────┘
  │▌                         │    ┌──────────────────────────────────┐
  │▌░░░░░░░░░░               │    │ ●  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
  │▌                         │    │    ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
  │▌░░░░░░░░░░░░░░░░░░░░░░░  │    └──────────────────────────────────┘
  └─────────────────────────┘    ┌──────────────────────────────────┐
   ↑ .glass-faint + shimmer        │ ●  ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
   ↑ shimmer sweeps 1.2s loop      │    ░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
   ↑ aria-busy="true" on parent   └──────────────────────────────────┘
   ↑ 120ms fade-out on resolve      ↑ .glass-faint + shimmer, aria-busy
```

---

## 9. Iconography

### 9.1 Library: Lucide Only

```tsx
import { Search, Check, CircleDot, X, Minus, Plus, GraduationCap } from "lucide-react";
```

- **One library, one stroke.** `lucide-react`, 1.5px stroke, 20px default (16px inline in chips, 24px in empty-state illustrations).
- **Never** invent a custom SVG when a lucide icon exists. New icons go through design review and are contributed upstream.
- **Never** mix icon libraries (Heroicons, Phosphor, Tabler) — stroke width + corner radius consistency is part of the system.

### 9.2 The No-Emoji Rule

> **No emoji in UI chrome.** Emoji render differently per platform (Apple vs Google vs Microsoft), break visual rhythm, and age badly. Buddysaradhi uses the same `GraduationCap` lucide icon everywhere — pixel-identical across platforms.

Emoji are permitted **only** in (a) user-entered content (notes, remarks) and (b) WhatsApp notification payloads. Never in nav, buttons, chips, toasts, empty states, or status indicators.

### 9.3 Icon + Label Convention

| Context | Pattern | Example |
|---|---|---|
| Sidebar nav | icon + label (collapsed shows tooltip) | `[GraduationCap] Students` |
| Primary button | icon + label OR label only | `[Plus] Add Student` |
| Icon-only button | icon + `sr-only` label + tooltip | `[Search]` (tooltip "Search ⌘K") |
| Chip | icon + label (icon = status dot) | `[Check] Paid` |
| Empty state | custom SVG line-art (NOT lucide) | graduation-cap 120×120 |
| Status indicator | icon alone permitted IF paired with text in same row | `✓` + "Paid" |

> **Color is never the only signal** (§10.6). Status icons must be paired with text in the same row OR have a tooltip / sr-only label.

### 9.4 Status Icon Pairings

Canonical status → icon → accent table lives in **§2.4** (single source of truth). Lucide icon names: `Check`, `CircleDot`, `X`, `Minus`, `Info`.

---

## 10. Accessibility Commitments

### 10.1 WCAG 2.1 AA (Targeting AAA Where Stated)

Every text token meets AA (4.5:1) against its rendered composite background; most exceed AAA (7:1) — see §2.1. Verified by `axe-core` in CI on every screen route + manual review per release.

### 10.2 44px Touch Targets

> Every interactive element on mobile is ≥ 44×44px. Chips below 44px height are padded with an invisible hit-area extension.

Desktop allows 32×32 for icon-only buttons (mouse precision) but keyboard focus ring + tooltip mandatory.

### 10.3 Focus-Visible Rings

```css
:focus-visible {
  outline: 2px solid var(--accent-cyan);
  outline-offset: 2px;
  border-radius: inherit;
}
```

Focus rings are **never removed**. `outline: none` is a lint error.

### 10.4 Reduced-Motion Media Query

Per §7.2. Springs → 120ms fades. Aurora freezes. Count-ups snap.

### 10.5 Screen-Reader Live Regions

- `aria-live="polite"` on the toast region; `aria-live="assertive"` on error toasts.
- `aria-busy="true"` on skeletons / loading containers.
- `aria-modal="true"` + focus-trap on modals, drawers, command palette.
- `role="status"` on KPI cards so count-up announces final value once.

### 10.6 Color Is Never the Only Signal

> A red dot alone is not "overdue." A red dot + `X` icon + "Overdue" text is. Every status indicator carries **three signals**: color + icon + text. Color-blind users (8% of male tutors) read the icon; screen-reader users read the text; sighted color-typical users read the color first.

Enforced by lint: any element using `--accent-*` for status must have a paired text label or `aria-label`. `axe-color-contrast` + `axe-nested-interactive` run in CI on every PR.

### 10.7 Keyboard Parity

`Tab` order follows visual order (never positive `tabindex`). `Cmd/Ctrl+K` → command palette. `?` → shortcut cheatsheet. `G D / G S / G A / G F / G T` → goto Dashboard/Students/Attendance/Fees/Settings (`08_Settings.md` §9). `↑`/`↓` → list rows; `↵` → open; `Esc` → close drawer. Every mouse-only affordance has a keyboard alternative.

---

## 11. Density Modes

### 11.1 Comfortable (Default)

Default density. Optimised for the solo tutor on a laptop.

| Property | Comfortable |
|---|---|
| Table row height | 48px |
| List row padding | `py-3` |
| Card padding | `p-6` |
| KPI figure | 28px mono |
| Section gap | `gap-6` |
| Body font size | 16px |

### 11.2 Compact

Opt-in via Settings → Profile → Density. Optimised for the 200-student institute scrolling a 600-row student list.

| Property | Compact |
|---|---|
| Table row height | 36px |
| List row padding | `py-2` |
| Card padding | `p-4` |
| KPI figure | 24px mono |
| Section gap | `gap-4` |
| Body font size | 14px |

### 11.3 What Compresses, What Doesn't

| Compresses in compact | Stays the same |
|---|---|
| Row heights, internal padding, font size, section gaps, KPI figure size, drawer padding, empty-state illustration (120 → 96) | Touch targets on mobile (always 44px), focus ring (2px), KPI label caption (12px), icon stroke (1.5px), glass blur (24px), color tokens, empty-state CTA (44px) |

> **Rule:** compact mode is a density dial, not an accessibility eraser. Touch targets, focus rings, and color contrast are invariant.

---

## 12. Dark-Only Doctrine

### 12.1 Why There Is No Light Mode

Buddysaradhi is **dark-only**. The previous version of this spec described a light variant; it has been removed. Three reasons:

1. **Neumorphism is physically impossible on white** (§6.5) — the dual-shadow extrusion collapses; tactile controls become flat bevels.
2. **The cosmic canvas is the brand** — the night-sky → aurora → bioluminescence metaphor (§1.2) is the visual identity. A light variant would be a different product.
3. **OLED + late-night tutors** — private tutors work 6 AM – 10 PM; evening batches are the peak. Dark mode saves OLED battery and the tutor's eyes.

A theme toggle in Settings → Profile (per the old spec) is **removed**. The OS is dark; the OS is Buddysaradhi.

### 12.2 The Print Stylesheet Exception

Print is a different medium — light background (paper), high contrast, no glass blur, no neumorphism. The print stylesheet (`@media print`) renders a **flat, high-contrast, black-on-white** document, but only for the spec reader and for receipts/invoices. The app UI itself is never printed.

```css
@media print {
  body { background: white !important; color: #0a0a1a !important; }
  .glass, .glass-strong, .glass-faint { background: white !important; backdrop-filter: none !important; border: 1px solid #d0d0e0 !important; box-shadow: none !important; }
  .neumo-raised, .neumo-inset, .neumo-pressed { background: white !important; box-shadow: none !important; border: 1px solid #d0d0e0 !important; }
  .accent-emerald { color: #00875A !important; }
  .accent-cyan    { color: #006B8F !important; }
  .accent-flare   { color: #C44000 !important; }
  .accent-amber   { color: #B07000 !important; }
}
```

Print accents are darker than on-screen because the bright `#00FF9D` would be illegible on paper.

### 12.3 What This Means for Implementation

No `next-themes`. No light-mode CSS variables. One `:root` token set, one surface system, one focus-ring color. The print stylesheet is the only light-surface code path, and it lives entirely in `@media print`.

---

## 13. Sticky Footer (NON-NEGOTIABLE)

> This is **Prohibition #5** from §1.3 — the layout mandate. It is non-negotiable. Every screen root in Buddysaradhi implements this exact pattern. A screen where the footer floats mid-viewport on short content, or where the footer overlaps content on long pages, is a P1 bug — file it.

**The pattern (use exactly this):**

```tsx
<html>
  <body className="min-h-screen flex flex-col tutoros-cosmic-bg-pro">
    <div className="pro-sticky-footer-content"> {/* flex-1 0 auto — grows to fill */}
      <GlassShell />                            {/* all app content lives here */}
    </div>
    <footer className="pro-sticky-footer mt-auto flex-shrink-0 …">
      {/* sync status · tenant · version · ©  — never primary actions */}
    </footer>
  </body>
</html>
```

**The three rules:**

1. **Root is `min-h-screen flex flex-col`.** The `min-h-screen` guarantees the body is at least viewport-tall; `flex flex-col` makes the footer's `mt-auto` work. Both classes are required — neither alone is sufficient.
2. **Footer carries `mt-auto` + `flex-shrink-0`.** `mt-auto` pushes the footer to the bottom of the flex column when content is short; `flex-shrink-0` prevents the footer from being squeezed when content is tall. The `.pro-sticky-footer` helper class (`flex-shrink-0`) and `.pro-sticky-footer-shell` / `.pro-sticky-footer-content` helpers (§20) encode this — prefer them over hand-rolled utilities.
3. **No fixed/absolute footer overlays.** The footer is in normal document flow. When content > 100vh, the footer is pushed down naturally (scrolls into view at the bottom). A `position: fixed` footer that overlaps content is a violation.

**Mobile:** footer respects `env(safe-area-inset-bottom)` via `pb-[env(safe-area-inset-bottom)]` so the home-indicator bar never underlaps it.

**Footer contents:** left = sync status (synced · pending · offline), center = tenant name, right = version + ©. The footer **never** contains primary actions — it is a status bar, not a toolbar.

**Verification:** `footer.getBoundingClientRect().bottom ≈ document.documentElement.scrollHeight` (no gap below footer on short content, no overlap on long content). This was verified on the `/` route in Task 15 — footer bottom (15808.58px) ≈ document height (15809px).

---

## 14. Responsive Breakpoints

| Breakpoint | Width | Behaviour |
|---|---|---|
| `base` | < 640px | Single column, sidebar → bottom-tab bar (5 icons + sync), tables → card lists, KPIs 1×N stack |
| `sm` | ≥ 640px | KPIs 2×N, tables condense to 4 columns + expandable row |
| `md` | ≥ 768px | Sidebar reappears (collapsed icon-only), KPIs 2×3 |
| `lg` | ≥ 1024px | Sidebar expanded (248px), KPIs 3×2, tables full columns |
| `xl` | ≥ 1280px | Content max-width 1440px, gutter 32px, master-detail splits enabled |
| `2xl` | ≥ 1536px | Dashboard moves to 4-column KPI grid |

Touch targets: ≥ 44×44px on `base`/`sm`. Desktop allows 32×32 for icon buttons with tooltip.

---

## 15. Empty States, Loading, Toasts, Confirmations

Component anatomy for each of these lives in §8 (§8.19 Empty State, §8.20 Skeleton, §8.8 Toast, §8.7 Modal/Sheet for confirm dialogs). This section covers the **orchestration rules** — when each appears, and how they interact with data state.

### 15.1 Orchestration Rules

| State | Component (§8) | Trigger | Rule |
|---|---|---|---|
| **Empty** | §8.19 Empty State | First visit / no data | Every screen has a designed empty state (Principle 15): illustration → `h3` headline → `body-md` sub → primary CTA (emerald) → secondary cyan link |
| **Loading (first paint)** | §8.20 Skeleton | Data fetch in progress | Skeletons (not spinners) for lists/tables; `glass-faint` blocks + `shimmer-loading`. Never a full-screen blocker for primary data |
| **Loading (mutation)** | Inline 16px cyan ring | Saving / generating receipt | Inline spinner only; optimistic UI reflects the change immediately, rolls back via toast on failure |
| **Offline** | Last-known data + "offline" chip | Network lost | Show last-known + subtle chip; never blank the screen |
| **Toast (success/info)** | §8.8 Toast | Action completed | bottom-right (desktop) / top (mobile); 4s auto-dismiss; swipe-to-dismiss; severity → accent (§2.4) |
| **Toast (error)** | §8.8 Toast | Action failed | Persistent (no auto-dismiss); `aria-live="assertive"`; must tap ✕ or Retry |
| **Confirm dialog** | §8.7 Modal/Sheet | Destructive action | glass sheet; cancel ghost + confirm emerald (or flare for destructive) |
| **Typed confirm** | §8.7 + text input | Bulk delete / full export | Input requires exact word ("DELETE" / "EXPORT"); button disabled until match (`10_Security.md` §4.1) |

> **Optimistic-UI rule.** Attendance toggle and payment record reflect immediately; rollback is via an error toast (§8.8) with a Retry action. Never leave the user staring at a spinner for a mutation they've already tapped.

---

## 16. Copy & Microcopy

Tone: confident, short, tutor-respecting. No exclamation marks. No "Oops!". Numbers locale-formatted (`en-IN` → `₹ 1,24,500`; `en-US` → `$1,245.00`). Empty verbs: "Add", "Mark", "Record", "Generate", "Export". Avoid "Click here". Confirmation verbs match action: "Void receipt", "Lock attendance", "Archive student". States are adjectives not nouns: "Paid" not "Payment-completed".

---

## 17. Do / Don't Gallery

> Quick-reference summary. The canonical rules live in §1.3 (Prohibitions), §5 (Glass), §6 (Neumorphism), §7 (Motion), §9 (Icons), §10 (A11y), §20 (pro-* utilities). Items below are the most-cited quick-glance Do/Don'ts.

| # | Do | Don't | Why |
|---|---|---|---|
| 1 | Apply `backdrop-filter: blur(24px) saturate(140%)` to glass | Apply no blur, just translucent fill | Without blur the panel reads as flat plastic; blur makes it "glass" (§5.1) |
| 2 | Use `tabular-nums` on every numeric column | Use proportional figures on ledger amounts | Proportional digits jitter on update; tabular figures stay column-aligned (§3.4) |
| 3 | Nest flat `bg-white/[0.04]` cards inside glass | Nest `.glass` inside `.glass` | Double backdrop-filter compounds blur into mud; the aurora is lost (§5.3) |
| 4 | Pair every status color with icon AND text | Signal status by color alone | Color-blind users (8% of male tutors) can't read color alone; WCAG AA requires redundant signal (§10.6) |
| 5 | Use `lucide-react` icons at 1.5px stroke, 20px | Use emoji in nav/buttons/chips | Emoji render differently per platform, break visual rhythm, age badly (§9.2) |
| 6 | Use `--accent-cyan` for focus rings, `outline-offset: 2px` | Remove `:focus` outline for "cleaner" UI | Removing focus outline is a lint error; keyboard users lose navigation (§10.3) |
| 7 | Animate KPI count-up once per session, 400ms ease-out | Animate count-up on every re-render | Re-rendering count-up feels broken; the tutor thinks the value changed (§7.3) |
| 8 | Stagger only the first 4 entering siblings | Stagger every row of a 50-row table | A 1.5s stagger on a long table is disorienting; render the whole table instantly (§7.4) |
| 9 | Respect `prefers-reduced-motion`, freeze aurora | Always animate, ignore user preference | Vestibular safety; some users get motion-sick from drifting blobs (§7.2) |
| 10 | Use `--accent-flare` for destructive confirmations with typed input | Use a generic red "Are you sure?" modal | Typed confirmation ("DELETE") prevents accidental bulk-delete; flare signals irreversible (§15) |
| 11 | Use `neumo-raised` for toggles, knobs, raised buttons | Use neumorphism for content panels | Neumorphism is for tactile controls; glass is for content. Mixing them destroys hierarchy (§6.6) |
| 12 | Use `.pro-card` / `.pro-kpi` / `.pro-btn-*` / `.pro-avatar` etc. | Invent ad-hoc `glass rounded-2xl border …` wrappers | The pro-* layer is the consistency contract; ad-hoc wrappers drift and regress (§20, §21) |

---

## 18. Implementation Contracts

- **Token layer:** `app/globals.css` defines every token in §2.1 as a CSS custom property on `:root`. No raw hex anywhere else.
- **Component layer:** `components/ui/*` exports `<GlassCard>`, `<NeumoButton>`, `<Chip>`, `<Toggle>`, `<KpiCard>`, `<Drawer>`, `<Modal>`, `<Toast>`, `<CommandPalette>` — all consuming tokens.
- **Motion layer:** `lib/motion.ts` exports every variant in §7.1.
- **Lint layer:** ESLint rules `no-indigo-accent`, `no-pure-black`, `no-pure-white`, `no-emoji-in-chrome`, `require-tabular-nums-on-amounts`, `require-focus-visible` enforced in CI.
- **A11y layer:** `axe-core` runs on every Playwright route test; zero violations is the gate.

This is the visual contract. Any component not following it is a bug.

---

## 19. The Commercial Surface

The commercial landing page at `buddysaradhi.in` is the only marketing surface in v1, and it consumes the same design system as the product. A tutor's first impression of Buddysaradhi — the hero, the features showcase, the download hub, the pricing table — must feel like the same artefact they install and use. Two specs govern that surface:

- **[`product/02_Hero_and_Above_the_Fold.md`](product/02_Hero_and_Above_the_Fold.md)** — the hero composition: cosmic gradient background, glass-panel headline card, emerald primary CTA, aurora-blob motion (the one place ambient motion is permitted, per P7's marketing-surface carve-out), platform-detect logic that swaps the CTA label between "Open on Web" / "Download for Mac" / "Get it on Play" / "Download for iOS" / "Download for Windows". The hero lives above the fold on a 1280×800 desktop viewport and a 360×640 mobile viewport; nothing critical scrolls.
- **[`product/03_Features_Showcase.md`](product/03_Features_Showcase.md)** — the features grid: six glass cards (one per principle-derived claim: five-screen ceiling, immutable ledger, offline-first, single-tenant sovereignty, no telemetry, tactile security), each with a Lucide icon, a one-line headline, a two-line sub, and a "See it in the app" deep link. Cards use `.glass` with a 2px emerald/cyan/violet left border to colour-code the principle family (§5.4). On `base`/`sm` breakpoints the grid collapses to a single column with full-width cards.

Both specs reuse the tokens in §2.1, the glass recipe in §5.1, the motion variants in §7.1, and the typography ramp in §3.2 — no marketing-specific tokens, no marketing-specific components. The aurora-blob drift permitted on the hero is the **only** ambient motion in the entire system; it is forbidden inside the product surfaces (P7) and gated by `prefers-reduced-motion` (AP-20). The lint rules in §18 (Implementation Contracts) apply unchanged to the marketing routes; the `no-indigo-accent` rule fires on the landing page exactly as it fires on the dashboard.

The commercial surface is not a separate design system — it is the same design system, demonstrated.

---

## 20. The Professional Polish Layer — `pro-*` Component Utilities

> The `pro-*` utilities are the **refinement layer** of the Vibrant Glass & Neumorphism system — not a replacement for it. They encode the exact glass tier (§5), neumorphic control recipe (§6), and motion token (§7) for each recurring component pattern into a single class name, so that every KPI card, every primary CTA, every avatar, every list row across the app renders identically. They live in `globals.css` lines 1050+ (the "Professional Polish Layer" block, added in Task 15-UI-OVERHAUL) and are the **default surface for every new component**. Ad-hoc `glass rounded-2xl border …` wrappers are a regression — file it.

### 20.1 Why a Polish Layer

Without a utility layer, the same KPI card gets re-implemented 20 times across 6 prototype components, each with slightly different blur, opacity, radius, and shadow values. After Task 15 audited and consolidated these, 159 `pro-*` instances now render the dashboard, students, fees-ledger, attendance, settings, and backup prototypes from one shared definition. A token change (e.g. KPI accent bar color) now propagates to all KPIs by editing one CSS rule, not 20 className strings.

### 20.2 The `pro-*` Utility Catalogue

| Utility | Replaces | Surface (refines) | When to use |
|---|---|---|---|
| `.tutoros-cosmic-bg-pro` | `.tutoros-cosmic-bg` | §2.2 root bg + 48px grid + 3 aurora radials | **App root wrapper** — every screen. Deep navy gradient with subtle grid pattern and emerald/cyan/violet aurora glows. |
| `.pro-card` | ad-hoc `glass rounded-2xl …` | §5.1 `.glass` (5% white, 20px blur, 16px radius, soft shadow) | **Default content card** — section panels, detail cards, form groupings. Hover lifts border-color + shadow. |
| `.pro-card-elevated` | ad-hoc `glass-strong …` | §5.1 `.glass-strong` (gradient bg, 14px radius, translateY(-2px) hover) | **Featured/elevated card** — device frames, hero blocks, the one card-per-screen that deserves lift. |
| `.pro-kpi` | ad-hoc `glass rounded-2xl border-l-2 …` | §5.4 glass + accent left-border (3px `::before` bar via `--kpi-accent`) | **Every KPI figure card**. Set `style={{ '--kpi-accent': '#00FF9D' }}` per card (emerald/cyan/violet/amber/flare). Hover lifts 2px. |
| `.pro-btn-primary` | ad-hoc gradient CTA buttons | §6.1 neumo-raised + emerald→cyan gradient + glow | **Primary CTA** — the one button per screen that confirms/creates/records. Dark text on bright gradient. |
| `.pro-btn-secondary` | ad-hoc `glass border …` buttons | §6.1 neumo-raised + glass outline | **Secondary action** — Filter, Cancel, Open, Export. Glass outline, white text. Accepts `!border-{accent}/30 !bg-{accent}/10 !text-{accent}` overrides for accent-tinted variants. |
| `.pro-btn-ghost` | ad-hoc transparent text buttons | transparent + `--text-secondary` | **Tertiary/text action** — "Read more", "Cancel", footer links. Transparent, subtle hover wash. |
| `.pro-tab-strip` + `.pro-tab` | ad-hoc pill tab implementations | §8.6 tab bar (pill variant) | **In-content tab strip** (not the app's main nav). Active tab = emerald→cyan gradient pill via `data-active="true"`. |
| `.pro-avatar` | ad-hoc `flex h-N w-N rounded-{lg,2xl} bg-gradient …` | §8.15 avatar (circular, gradient bg, initials, inset ring) | **Every avatar** — students, tutor profile, ledger contacts. Pair with `h-N w-N` sizing + a gradient bg utility. |
| `.pro-status-pill` | ad-hoc `rounded-full border px-2 py-0.5 text-[9px] …` | §8.3 chip (compact uppercase variant) | **Compact status indicator** — Fee Model, Sync State, Encrypted badge, scope tag. Uppercase 11px, 999px radius. |
| `.pro-list-row` | ad-hoc `flex items-center gap-3 rounded-xl border border-white/5 …` | §8.4 list row (glass-faint band + hover wash) | **Every list row** — student roster, ledger entries, backup history, settings rows. Hover washes bg + border. |
| `.pro-empty` | ad-hoc `rounded-xl border border-dashed … px-4 py-10` | §8.19 empty state (dashed border, centered) | **Empty/zero-state container** — empty ledger, empty filter result, import drop zone, "no student selected". |
| `.pro-section-eyebrow` + `.pro-section-title` + `.pro-section-sub` | ad-hoc eyebrow + headline + sub | §3.2 type ramp (caption / display / body) | **Section heading kit** — the eyebrow pill + clamp-sized headline + muted sub that opens every major section. |
| `.pro-divider` | ad-hoc `<hr>` or `border-t` | flat gradient hairline | **Inline section divider** — transparent → 10% white → transparent. |
| `.pro-sticky-footer-shell` + `.pro-sticky-footer-content` + `.pro-sticky-footer` | ad-hoc `min-h-screen flex flex-col … mt-auto flex-shrink-0` | §13 sticky-footer mandate | **Footer layout helpers** — shell = `min-h-screen flex flex-col`, content = `flex-1 0 auto`, footer = `flex-shrink-0`. Use together (§13). |

### 20.3 The Consistency Contract (Non-Negotiable)

Every recurring component pattern uses its `pro-*` utility. There are no exceptions for "this one's slightly different" — the override pattern (§20.4) handles accent variation without abandoning the utility.

| Pattern | Required utility | Forbidden |
|---|---|---|
| KPI figure card | `.pro-kpi` + `--kpi-accent` | `glass rounded-2xl border-l-2 ${color}` |
| Primary CTA (confirm/create/record) | `.pro-btn-primary` | ad-hoc `bg-gradient-to-br from-… to-… glow-…` |
| Secondary button (filter/cancel/export) | `.pro-btn-secondary` | ad-hoc `glass border border-white/10 …` |
| Tertiary text button | `.pro-btn-ghost` | ad-hoc `text-white/60 hover:text-white` |
| Avatar (student/tutor/contact) | `.pro-avatar` + size + gradient bg | ad-hoc `flex h-N w-N rounded-{lg,2xl} bg-gradient …` |
| Compact status pill | `.pro-status-pill` + accent override | ad-hoc `rounded-full border px-2 py-0.5 text-[9px] …` |
| List row (roster/ledger/settings) | `.pro-list-row` | ad-hoc `flex items-center gap-3 rounded-xl border border-white/5 …` |
| In-content tab strip | `.pro-tab-strip` + `.pro-tab[data-active]` | ad-hoc pill tab implementations |
| Empty/zero state | `.pro-empty` | ad-hoc `rounded-xl border border-dashed …` |
| Default content card | `.pro-card` | ad-hoc `glass rounded-2xl …` |
| Featured/elevated card / device frame | `.pro-card-elevated` | ad-hoc `glass-strong rounded-3xl …` |
| App root background | `.tutoros-cosmic-bg-pro` | `.tutoros-cosmic-bg` (legacy) or ad-hoc gradient |
| Footer layout | `.pro-sticky-footer-shell` + content + `.pro-sticky-footer` | ad-hoc `min-h-screen flex flex-col …` |

### 20.4 The Override Pattern (Accent Variation, Not Structure Abandonment)

When a `pro-*` component needs an accent variation (e.g. a secondary button tinted flare for a destructive action, or an amber-accented KPI), **keep the utility class and override only the accent** with Tailwind `!important` (`!`) utilities:

```tsx
// ✅ Correct: keep pro-btn-secondary, override accent only
<button className="pro-btn-secondary !border-[#FF5E00]/40 !bg-[#FF5E00]/10 !text-[#FF5E00]">
  Erase all data
</button>

// ✅ Correct: keep pro-kpi, set accent via CSS variable
<div className="pro-kpi" style={{ '--kpi-accent': '#FFB300' }}>
  <span className="caption">Due Today</span>
  <span className="kpi-figure">₹ 48,000</span>
</div>

// ❌ Forbidden: abandon the utility, hand-roll the whole thing
<button className="inline-flex items-center gap-2 rounded-lg border border-[#FF5E00]/40
                   bg-[#FF5E00]/10 px-3 py-1.5 text-xs font-semibold text-[#FF5E00]">
  Erase all data
</button>
```

The override pattern preserves the structural contract (radius, padding, blur, shadow, hover behavior) while allowing the accent to vary. Sizing overrides (`!px-3 !py-1.5 !text-xs`) for compact/dense contexts are also permitted — they override spacing, not structure.

### 20.5 Relationship to §5 (Glass) and §6 (Neumorphism)

The `pro-*` layer does **not** replace the glass/neumorphism system — it is a refinement of it:

- `.pro-card` / `.pro-card-elevated` / `.pro-kpi` → refine `.glass` / `.glass-strong` / glass+accent-border (§5.1, §5.4). Same opacity/blur tier, tightened radius (14–16px) and shadow elevation.
- `.pro-btn-primary` / `.pro-btn-secondary` → refine `.neumo-raised` buttons (§6.1, §8.2). The primary keeps the emerald→cyan gradient + glow; the secondary replaces the dual-shadow extrusion with a cleaner glass outline (a deliberate Task-15 refinement — the dual-shadow read as heavy at button scale).
- `.pro-avatar`, `.pro-status-pill`, `.pro-list-row`, `.pro-empty`, `.pro-tab-strip` → refine their §8 counterparts (§8.3, §8.4, §8.6, §8.15, §8.19) into a single class name.

The foundational recipes in §5 and §6 remain the source of truth for **why** each surface looks the way it does; the `pro-*` utilities are the **what to type** to get them.

### 20.6 Reduced-Motion Handling

All `pro-*` utilities with `transition` or `transform` hover effects are neutralized under `@media (prefers-reduced-motion: reduce)` (globals.css line 1230):

```css
@media (prefers-reduced-motion: reduce) {
  .pro-card, .pro-card-elevated, .pro-kpi, .pro-btn-primary,
  .hero-stat-card, .pro-tab { transition: none !important; }
  .pro-card-elevated:hover, .pro-kpi:hover, .pro-btn-primary:hover { transform: none !important; }
}
```

This complements the §7.2 reduced-motion override — the `pro-*` hover lifts and gradient hovers freeze alongside the aurora and count-ups.

### 20.7 Audit & Drift Prevention

A `pro-*` audit runs as part of the visual-regression baseline (see `21_Automation_Testing.md` §5). The baseline encodes the 159 `pro-*` instances on the `/` route; a PR that removes a `pro-*` class or adds an ad-hoc wrapper will fail the visual diff until either (a) the change is reverted, or (b) the baseline is explicitly updated with a justification. This is the enforcement mechanism for the §20.3 consistency contract.

---

## 21. Component Decision Tree

> Use this tree **before** writing a className string. If the pattern you need is in this tree, use the `pro-*` utility — do not invent an ad-hoc wrapper. If the pattern is not in this tree, it is a new component and warrants a §8 entry + a new `pro-*` utility (or a documented exception).

```
  ┌─ Need a surface to hold content? ─────────────────────────────────────┐
  │                                                                        │
  │  KPI figure card (number + label + accent)  → .pro-kpi  + --kpi-accent │
  │  Default content card (section, detail)     → .pro-card                │
  │  Featured/elevated card (device frame)      → .pro-card-elevated       │
  │  Empty/zero-state container                 → .pro-empty               │
  │  Inline divider                             → .pro-divider             │
  │                                                                        │
  └────────────────────────────────────────────────────────────────────────┘

  ┌─ Need a button? ──────────────────────────────────────────────────────┐
  │                                                                        │
  │  Primary CTA (confirm/create/record)        → .pro-btn-primary         │
  │  Secondary action (filter/cancel/export)    → .pro-btn-secondary       │
  │  Tertiary text action (read more / link)    → .pro-btn-ghost           │
  │                                                                        │
  │  Accent variation?  Keep the utility, override with !border/!bg/!text  │
  │  (§20.4).  Never abandon the utility for an ad-hoc button.             │
  │                                                                        │
  └────────────────────────────────────────────────────────────────────────┘

  ┌─ Need a list/tab/avatar/pill? ────────────────────────────────────────┐
  │                                                                        │
  │  List row (roster / ledger / settings)      → .pro-list-row            │
  │  In-content tab strip                       → .pro-tab-strip + .pro-tab│
  │     (active = data-active="true")                                       │
  │  Avatar (student / tutor / contact)         → .pro-avatar + h-N w-N    │
  │     + bg-gradient-to-br from-{a} to-{b}                                 │
  │  Compact status pill (Fee Model / Sync)     → .pro-status-pill         │
  │     + accent border/bg/text overrides                                   │
  │                                                                        │
  └────────────────────────────────────────────────────────────────────────┘

  ┌─ Need a section heading or footer layout? ────────────────────────────┐
  │                                                                        │
  │  Section heading kit                        → .pro-section-eyebrow     │
  │                                               + .pro-section-title      │
  │                                               + .pro-section-sub        │
  │  Footer layout (sticky bottom)              → .pro-sticky-footer-shell │
  │     (root) + .pro-sticky-footer-content       + .pro-sticky-footer     │
  │     (footer).  See §13 for the mandate.                                 │
  │                                                                        │
  └────────────────────────────────────────────────────────────────────────┘

  ┌─ Need a control (toggle / slider / input / stepper)? ─────────────────┐
  │                                                                        │
  │  → Use the §6 neumorphic recipes (.neumo-raised / .neumo-inset /       │
  │    .neumo-pressed) directly.  These are tactile controls, not surfaces;│
  │    the pro-* layer does not (yet) wrap them.  See §6.6 coverage map.   │
  │                                                                        │
  └────────────────────────────────────────────────────────────────────────┘

  ┌─ Need the app background? ────────────────────────────────────────────┐
  │                                                                        │
  │  → .tutoros-cosmic-bg-pro  (every screen root, §20.2)                 │
  │    Replaces the legacy .tutoros-cosmic-bg.  Do not use both.           │
  │                                                                        │
  └────────────────────────────────────────────────────────────────────────┘
```

**If none of the above match:** the component is either (a) a new pattern that warrants a new §8 entry + a new `pro-*` utility, or (b) a one-off (e.g. the spec-filter buttons with multi-accent state, the settings sidebar with per-section accent). One-offs are permitted but must be commented with `// one-off: <reason>` so the next agent knows it is intentional and not drift.

---

## 22. ASCII Art Conventions (Spec-Wide)

Every screen, modal, flow, and component in the Buddysaradhi spec package is accompanied by an ASCII art mockup. This section defines the canonical style so that every mockup — across all 6 directories (root + web + mobile + desktop + deployment + product) — reads as one coherent design language.

### 22.1 Why ASCII Art

> **A spec without a picture is a spec open to interpretation.** ASCII art mockups make layout, hierarchy, and component composition unambiguous before a single line of JSX is written. They diff cleanly, render identically in every markdown renderer, and survive copy-paste into Slack/Notion/Linear. The ASCII mockup is the **contract** between design and engineering — synthesised from Apple HIG, IBM CUA, Stripe API docs, Linear's spec, and Basecamp Shape Up.

### 22.2 Character Set

| Character | Meaning | Example |
|---|---|---|
| `┌ ┐ └ ┘` | Corner (top-left, top-right, bottom-left, bottom-right) | Panel / card border |
| `├ ┤` | T-junction (left, right) | Section divider inside a panel |
| `┬ ┴` | T-junction (top, bottom) | Column divider |
| `─` | Horizontal line | Panel border, table row |
| `│` | Vertical line | Panel border, table column |
| `┼` | Cross junction | Table grid intersection |
| `═` | Double horizontal | Focus ring, active indicator, emphasis border |
| `║` | Double vertical | Focus ring sides |
| `╔ ╗ ╚ ╝` | Double corners | Modal / focused element border |
| `╭ ╮ ╰ ╯` | Rounded corners | Chip, pill, toggle, avatar |
| `▌` | Left-bar (accent stripe) | KPI card accent, selected row, status surface |
| `░` | Light fill | Backdrop blur, disabled, placeholder |
| `▒` | Medium fill | Skeleton shimmer, secondary surface |
| `▓` | Medium-heavy fill | Late/partial state (amber), hover overlay |
| `█` | Heavy fill | Active/pressed state, primary accent fill |
| `●` | Filled circle | Avatar, toggle knob (on), status dot |
| `○` | Empty circle | Toggle knob (off), radio unchecked |
| `◉` | Filled circle with dot | Dragging knob (scaled) |
| `◐` | Half circle | Partial state |
| `✕ ✗` | X mark | Close, void, absent, error |
| `✓` | Check mark | Paid, present, active, success |
| `▲ ▼` | Triangles | Delta indicators, dropdown caret |
| `› »` | Chevrons | Drill-down, breadcrumb, "more" |
| `← → ↑ ↓` | Arrows | Navigation, flow direction |
| `⌘ ⌥ ⇧` | Modifier keys | kbd chips (⌘K, ⌘P, etc.) |
| `₹` | Indian Rupee | Money (en-IN formatting) |
| `·` | Middle dot | Separator in metadata |
| `│` (in tables) | Pipe | Markdown table column |

### 22.3 Layout Rules

1. **Every mockup sits inside a fenced code block** (` ``` `) so it renders in monospace and survives copy-paste. Never use inline code for mockups.
2. **Box width: 60–80 characters** for mobile components, 80–120 for desktop screens, 40–60 for inline component anatomy. Never exceed 120 chars (breaks GitHub render).
3. **Annotations point with `↑` or `←`** from the element to the note, never the reverse. Notes sit below or to the right of the element, never inside it.
4. **State variants render side-by-side** (DEFAULT | HOVER | SELECTED | DISABLED) so the reader can compare. Label each variant in CAPS above its mockup.
5. **Glass surfaces show the tier label** (`.glass`, `.glass-strong`, `.glass-faint`) in a note. Neumorphic controls show the recipe (`.neumo-raised`, `.neumo-inset`, `.neumo-pressed`). If a surface is flat-tinted (neither glass nor neumorphic), say so explicitly.
6. **Accent colours are named, not hexed** in the mockup notes ("emerald", "cyan", "amber", "flare", "violet") — the hex lives in §2.1, not in every mockup.
7. **Touch targets are annotated** when relevant (`↑ 44×44px hit area (§10.2)`).
8. **A11y attributes are annotated** when relevant (`↑ aria-modal="true"`, `↑ aria-live="polite"`, `↑ aria-selected="true"`).
9. **Motion is annotated** with the token name (`↑ modal-enter 240ms ease-out-quart`, `↑ tab-underline-slide`).
10. **Cross-references use the canonical ID** (`§5.4`, `BR-CALC-07`, `EC-F-06`, `P7`, `AP-6`) — never a prose description.

### 22.4 Mockup Types

Every screen spec (04_Dashboard, 05_Students, 06_Attendance, 07_Fees, 08_Settings) must include these mockup types:

| Mockup type | When | Purpose |
|---|---|---|
| **Full-screen layout** | Once per screen | Shows the shell, sidebar, header, content area, footer |
| **Empty state** | Once per screen | What the user sees on first visit |
| **Loading / skeleton** | Once per screen | What renders during data fetch |
| **Modal / drawer** | Per major action | The form or confirmation the action opens |
| **Toast / confirmation** | Per destructive action | The feedback after the action |
| **Error state** | Per form | Validation failure rendering |
| **Mobile variant** | Per screen (if different) | Bottom-tab layout, safe-area, 44px targets |
| **State matrix** | Per interactive component | DEFAULT / HOVER / FOCUS / ACTIVE / DISABLED side-by-side |

### 22.5 Example: Full-Screen Dashboard Layout

```
  DESKTOP (≥ 1024px)
┌──────────────────────────────────────────────────────────────────────────┐
│ ┌─ Sidebar (glass-strong) ─┐  ┌─ Header (glass-strong, sticky) ────────┐ │
│ │  ◈ Buddysaradhi               │  │  Dashboard    🔍 Search… ⌘K    🔔 ⚙ │ │
│ │  ─────────               │  ├────────────────────────────────────────┤ │
│ │  ◈ Dashboard    ←active  │  │                                        │ │
│ │  👥 Students             │  │  ┌─ KPI Row (4 × .glass cards) ──────┐ │ │
│ │  ✓ Attendance            │  │  │▌Collected  ▌Due Today  ▌Present  │ │ │
│ │  ₹ Fees                  │  │  │▌₹2,45,500 ▌₹48,000  ▌92%       │ │ │
│ │  ⚙ Settings              │  │  └────────────────────────────────────┘ │ │
│ │                          │  │                                        │ │
│ │  ─────────               │  │  ┌─ Heatmap (.glass) ─┐ ┌─ Feed (.glass)┐│ │
│ │  Aarav S.                │  │  │ ██░██▓░░██ │ │ ● Payment  ₹4,500││ │
│ │  Nagpur · 38 students    │  │  │ ██▓░░░██░░ │ │ ● Aarav present ││ │
│ │                          │  │  └─────────────┘ └──────────────────┘│ │
│ └──────────────────────────┘  └────────────────────────────────────────┘ │
│ ┌─ Footer (glass-faint, sticky bottom) ─────────────────────────────────┐ │
│ │  v1.4.2 · Last sync: 2m ago · 38 students · ₹2,45,500 MTD            │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
   ↑ cosmic canvas: #0f0c29 → #24243e → #0a0a1a (§2.2)
   ↑ sidebar + header = .glass-strong (8% white, 24px blur) — persistent chrome (§5.5)
   ↑ KPI cards = .glass + 2px accent left-border (§5.4, §8.1)
   ↑ heatmap + feed = .glass cards (workhorse tier)
   ↑ footer = .glass-faint (recede), sticky per §13
```

### 22.6 Coverage Requirement

> **Every screen spec, every platform architecture file, every user-flow doc, and every component anatomy must include at least one ASCII art mockup.** A spec section describing a UI without a mockup is a spec defect — file it. The mockup is the single source of truth for layout; the prose is the single source of truth for behaviour. Both are required.

Files that must have mockups (minimum count):
- **Root screen specs** (04, 05, 06, 07, 08): ≥ 5 mockups each (full-screen, empty, modal, toast, mobile)
- **Root non-screen specs** (00, 01, 02, 03, 09, 10, 11, 12, 13, 14, 15): ≥ 1 architecture/flow diagram each
- **web/**: ≥ 2 mockups per file (route tree + at least one component)
- **mobile/**: ≥ 2 mockups per file (screen layout + at least one native interaction)
- **desktop/**: ≥ 2 mockups per file (window layout + at least one IPC/flow)
- **deployment/**: ≥ 1 pipeline/architecture diagram per file
- **product/**: ≥ 2 mockups per file (landing-page section + at least one component)

### 22.7 References & Further Reading

These conventions synthesise practices from Apple HIG (1987, 2018), IBM CUA, Shape Up (Basecamp, 2019), Linear's public product spec, Stripe API docs, and NN/g "Wireframing for UX Design."

> **The mockup is not the design. The mockup is the contract.** The pixel-perfect Figma file comes later; the ASCII art is what the spec reviewer, the engineer, and the QA agent all read first. If they disagree on layout, the ASCII is the arbiter.

---

## 23. The Live Prototype Canon (copy-paste from `src/`)

> The 6 live prototype components in `src/components/tutoros/` are the **canonical reference implementation** of this design system. They are not mockups of a future product — they are the rendered, interactive, Framer-Motion-animated screens that the `/` route ships today. Any agent building the same screen on web (Next.js), mobile (Expo/RN), or desktop (Tauri) reproduces these pixel-faithfully. **The src/ file is the canon; this section makes it citable from the planning docs.**
>
> Each subsection gives (a) an ASCII mockup of the rendered layout, (b) a Structure table mapping region → exact className string from src → `pro-*` utility → data shape, (c) a Mock Data code block with the TypeScript types + 2–3 sample rows (Indian names, ₹ amounts in integer paise, TUT-0001 codes), and (d) a `pro-*` Utility Inventory (counts + what each utility replaces). Open the src/ file in parallel to verify any className.

**Shared imports (every prototype):**

```ts
import { ACCENT_MAP, type Accent } from "./data";          // src/components/tutoros/data.ts
import { CountUp, SectionTag, useMounted } from "./primitives";  // src/components/tutoros/primitives.tsx
```

**Shared Accent type + ACCENT_MAP** (from `src/components/tutoros/data.ts`):

```ts
export type Accent = "emerald" | "cyan" | "violet" | "amber" | "flare";

export const ACCENT_MAP: Record<Accent, AccentClasses> = {
  emerald: { text: "text-[#00FF9D]", border: "border-[#00FF9D]/40",
             bg: "bg-[#00FF9D]/10", glow: "glow-emerald", hex: "#00FF9D" },
  cyan:    { text: "text-[#00F0FF]", border: "border-[#00F0FF]/40",
             bg: "bg-[#00F0FF]/10", glow: "glow-cyan",    hex: "#00F0FF" },
  violet:  { text: "text-[#B388FF]", border: "border-[#B388FF]/40",
             bg: "bg-[#B388FF]/10", glow: "shadow-[0_0_24px_rgba(179,136,255,0.35)]", hex: "#B388FF" },
  amber:   { text: "text-[#FFB300]", border: "border-[#FFB300]/40",
             bg: "bg-[#FFB300]/10", glow: "glow-amber",   hex: "#FFB300" },
  flare:   { text: "text-[#FF5E00]", border: "border-[#FF5E00]/40",
             bg: "bg-[#FF5E00]/10", glow: "glow-flare",   hex: "#FF5E00" },
};
```

**Section-tag accent conventions** (`primitives.tsx` `SectionTag`): Dashboard → emerald, Students → cyan, Attendance → amber, Fees Ledger → emerald, Settings → violet, Backup → flare.

---

### 23.1 Dashboard Prototype — `src/components/tutoros/dashboard-prototype.tsx` (496 lines)

The opening live demo on `/`. Three tabs (Overview / Collection / Attendance) inside a single `pro-card-elevated` device frame, with a 4-card KPI strip always visible and a quick-actions footer.

```
┌─ device frame (pro-card-elevated, rounded-3xl, shadow-[0_24px_80px_rgba(0,0,0,0.5)]) ─────┐
│ ● ● ●                       tutoros · dashboard · 14 Nov                  ● LIVE          │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─ pro-tab-strip (mb-5) ─────────────────────────────────────────────────────────────┐  │
│  │ [ Overview ]   Collection    Attendance         ← active pill = emerald→cyan grad  │  │
│  └─────────────────────────────────────────────────────────────────────────────────────┘  │
│  ┌─ KPI grid (grid-cols-2 lg:grid-cols-4 gap-3) ──────────────────────────────────────┐  │
│  │ ▌Collected·Nov    ▌Due Till Date   ▌Active Students  ▌Overdue                     │  │
│  │ ▌₹ 1,24,500 emr   ▌₹ 38,200 amb    ▌47 cyan           ▌₹ 9,400 flare              │  │
│  │ ▌sparkline SVG    ▌sparkline        ▌sparkline         ▌sparkline                  │  │
│  └─────────────────────────────────────────────────────────────────────────────────────┘  │
│  ┌─ Due Today (pro-card, lg:col-span-2) ──────┐  ┌─ Activity (pro-card) ────────────┐  │
│  │ ● AS  Aarav Sharma  Class 10·Maths  ₹4,500  │  │ ● Aarav paid ₹4,500       2h ago │  │
│  │ ● DP  Diya Patel   Class 9·Sci     ₹3,000  │  │ ● Diya marked absent     5h ago │  │
│  │ ● IV  Ishaan Verma Class 12·Phy    ₹6,000  │  │ ● Ishaan fee charged ₹6k  1d ago │  │
│  │ ● AR  Ananya Reddy Class 8·Maths   ₹2,500  │  │ ● Ananya partial ₹1,500   1d ago │  │
│  │ ● VG  Vivaan Gupta Class 11·Chem   ₹5,500  │  │ ● Vivaan enrolled         2d ago │  │
│  └─────────────────────────────────────────────┘  └──────────────────────────────────┘  │
│  Quick actions: [Mark Attendance] [Record Payment] [Add Student] [Generate Report]       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
   ↑ KPI cards: .pro-kpi + style={{ '--kpi-accent': a.hex }} — the 3px left bar via ::before
   ↑ avatars: .pro-avatar h-8 w-8 + bg-gradient-to-br from-white/15 to-white/5
   ↑ list rows: .pro-list-row !gap-3 (override default 0.75rem → 0.75rem is fine, !gap-3 emphasises)
   ↑ quick-action buttons: .pro-btn-secondary !px-2.5 !py-1.5 !text-[11px] + accent overrides
```

**Structure:**

| Region | Exact className from src (`dashboard-prototype.tsx`) | `pro-*` utility | Data shape |
|---|---|---|---|
| Device frame | `pro-card-elevated mx-auto max-w-5xl overflow-hidden rounded-3xl !rounded-3xl shadow-[0_24px_80px_rgba(0,0,0,0.5)]` | `pro-card-elevated` | n/a (chrome) |
| Title bar | `flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5` | (none — chrome) | `mounted` for date |
| Tab strip | `pro-tab-strip mb-5 flex flex-wrap` | `pro-tab-strip` | `tab: "overview"\|"collection"\|"attendance"` |
| Tab button | `pro-tab relative` + `data-active` attr | `pro-tab` | `["overview","Overview"]` tuples |
| KPI card | `pro-kpi p-4` + `style={{ '--kpi-accent': a.hex }}` | `pro-kpi` | `{ label, value, prefix?, accent, delta, icon, spark: number[] }` |
| KPI grid | `grid grid-cols-2 gap-3 lg:grid-cols-4` | (none — Tailwind grid) | `KPIS: Kpi[]` |
| Due-today card | `pro-card p-4 lg:col-span-2` | `pro-card` | `DUE_TODAY: {name, cls, amount, status, days}[]` |
| Status pill | `pro-status-pill border-[#FFB300]/30 bg-[#FFB300]/10 text-[#FFB300]` | `pro-status-pill` | `STATUS_META[status]` |
| List row | `pro-list-row !gap-3` | `pro-list-row` | row from `DUE_TODAY` |
| Avatar | `pro-avatar h-8 w-8 !text-[10px] bg-gradient-to-br from-white/15 to-white/5 !text-white/80` | `pro-avatar` | initials from name split |
| Activity card | `pro-card p-4` | `pro-card` | `ACTIVITY: {who, what, when, accent, icon}[]` |
| Collection bars card | `pro-card p-5 lg:col-span-3` | `pro-card` | `COLLECTION_BARS: {month, value, amount}[]` |
| Heatmap card | `pro-card p-5 lg:col-span-3` | `pro-card` | `Cell[][]` 7×18 |
| Quick-action btn | `pro-btn-secondary !px-2.5 !py-1.5 !text-[11px] !font-medium !border ${a.border} !bg-white/[0.04] ${a.text}` | `pro-btn-secondary` (with accent override §20.4) | `{ label, icon, accent }` |
| Ghost link | `pro-btn-ghost ml-auto !text-[11px]` | `pro-btn-ghost` | static link to `#specs` |

**Mock data (canonical seed — Indian names, ₹ amounts, TUT codes shared with §23.2–§23.4):**

```ts
const KPIS = [
  { label: "Collected · Nov", value: 124500, prefix: "₹ ", accent: "emerald" as Accent,
    delta: "↑ 18% vs last month", icon: Wallet,
    spark: [42, 55, 48, 67, 72, 61, 85, 91, 88, 95] },
  { label: "Due Till Date", value: 38200, prefix: "₹ ", accent: "amber" as Accent,
    delta: "12 students owe", icon: Clock,
    spark: [30, 28, 35, 32, 40, 38, 44, 41, 39, 42] },
  { label: "Active Students", value: 47, accent: "cyan" as Accent,
    delta: "3 inactive · 14d", icon: Users,
    spark: [38, 40, 41, 43, 44, 45, 46, 46, 47, 47] },
  { label: "Overdue", value: 9400, prefix: "₹ ", accent: "flare" as Accent,
    delta: "4 students · flare", icon: AlertTriangle,
    spark: [12, 10, 14, 11, 9, 8, 10, 7, 6, 8] },
];

const DUE_TODAY = [
  { name: "Aarav Sharma",  cls: "Class 10 · Maths",   amount: 4500, status: "due" as const,      days: 2 },
  { name: "Diya Patel",    cls: "Class 9 · Science",  amount: 3000, status: "overdue" as const,  days: 9 },
  { name: "Ishaan Verma",  cls: "Class 12 · Physics", amount: 6000, status: "due" as const,      days: 0 },
];

const ACTIVITY = [
  { who: "Aarav Sharma",  what: "paid ₹4,500",          when: "2h ago", accent: "emerald" as Accent, icon: CheckCircle2 },
  { who: "Diya Patel",    what: "marked absent",        when: "5h ago", accent: "flare"   as Accent, icon: AlertTriangle },
  { who: "Ishaan Verma",  what: "fee charged ₹6,000",   when: "1d ago", accent: "cyan"    as Accent, icon: Plus },
];
```

**`pro-*` Utility Inventory (per screen):**

| Utility | Count | Replaces |
|---|---|---|
| `pro-card-elevated` | 1 | ad-hoc `glass-strong rounded-3xl` device frame |
| `pro-card` | 4 | ad-hoc `glass rounded-2xl` content cards (due-today, activity, collection, heatmap) |
| `pro-kpi` | 4 | ad-hoc `glass rounded-2xl border-l-2` KPI cards |
| `pro-tab-strip` + `pro-tab` | 1 + 3 | ad-hoc pill tab strip |
| `pro-status-pill` | 1 | ad-hoc `rounded-full border px-2 py-0.5 text-[9px]` count pill |
| `pro-list-row` | 5 | ad-hoc `flex items-center gap-3 rounded-xl border border-white/5` rows |
| `pro-avatar` | 5 | ad-hoc `flex h-8 w-8 rounded-full bg-gradient …` avatars |
| `pro-btn-secondary` | 4 | ad-hoc `glass border` quick-action buttons |
| `pro-btn-ghost` | 1 | ad-hoc transparent text link |

Source: `src/components/tutoros/dashboard-prototype.tsx:1-496`. Open this file to verify any className cited above.

---

### 23.2 Students Prototype — `src/components/tutoros/students-prototype.tsx` (742 lines)

The largest prototype — a true master–detail split: left roster (300px) + right detail pane with 4 tabs (Overview / Ledger / Attendance / Notes). Each roster row is a `pro-list-row` button with a status-dot + accent-tinted avatar; the detail header stacks `pro-avatar h-14 w-14` + two `pro-status-pill`s + Record-Payment button.

```
┌─ device frame (pro-card-elevated, rounded-3xl) ───────────────────────────────────────────┐
│ ● ● ●   tutoros://students                                ● LIVE   8 students             │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─ roster (300px, border-r) ────┐  ┌─ detail pane (1fr) ─────────────────────────────────┐│
│ │ 🔍 Search name, code, class…  │  │ ●●  Aarav Sharma   [Partial] [Postpaid]   [Rec Pay] ││
│ │                               │  │     TUT-0001 · Class 10 · Mathematics               ││
│ │ ┌─ pro-list-row (active) ────┐│  │ ───────────────────────────────────────────────────││
│ │ │ AS Aarav Sharma   ● ₹4.5k  ││  │ ┌─ pro-tab-strip (inline-flex) ─────────────────┐ ││
│ │ │    Class 10 · Maths        ││  │ │ Overview  Ledger  Attendance  Notes           │ ││
│ │ └────────────────────────────┘│  │ └─────────────────────────────────────────────────┘ ││
│ │ ┌─ pro-list-row ─────────────┐│  │ ┌─ 4× pro-kpi (Attendance/Total Paid/Balance/Mo) ┐ ││
│ │ │ DP Diya Patel     ● ₹6.0k  ││  │ │ ▌92%   ▌₹22.5k   ▌₹4.5k   ▌₹7,500             │ ││
│ │ │    Class 9 · Science       ││  │ └─────────────────────────────────────────────────┘ ││
│ │ └────────────────────────────┘│  │ ┌─ Contact (pro-card) ─┐ ┌─ Enrolment (pro-card) ─┐││
│ │ ┌─ pro-list-row ─────────────┐│  │ │ 📞 +91 98xxx 12345    │ │ Code     TUT-0001       ││
│ │ │ IV Ishaan Verma   ●  —     ││  │ │ ✉ rohit.s@gmail.com   │ │ Joined   Apr 2024       ││
│ │ │    Class 12 · Physics      ││  │ │ 📍 Rohit Sharma (G)   │ │ Batch     M-W-F · 5 PM  │││
│ │ └────────────────────────────┘│  │ └───────────────────────┘ └────────────────────────┘││
│ │            ⋮ 5 more rows      │  │ ┌─ Last Payment (pro-card, --kpi-accent) ──────────┐││
│ │                               │  │ │ ₹3,000 · 12 Nov · RC-000142                      │││
│ │ [+ Add student] (dashed)      │  │ └────────────────────────────────────────────────────┘││
│ └───────────────────────────────┘  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────────────────┘
   ↑ roster row active state: !border-white/20 !bg-white/10 + a.glow
   ↑ status dot: h-1.5 w-1.5 rounded-full + a.bg.replace("/10","") (10/40/100 opacity ladder)
   ↑ detail header avatar: pro-avatar h-14 w-14 !text-lg bg-gradient-to-br avatarGradient(id)
   ↑ ledger tab: append-only table, hash 0x{id}a3f1, Lock icon flare-coloured
```

**Structure (detail pane has 4 tabs — full table abbreviated to the master layout):**

| Region | Exact className from src (`students-prototype.tsx`) | `pro-*` utility | Data shape |
|---|---|---|---|
| Device frame | `pro-card-elevated overflow-hidden rounded-3xl !rounded-3xl shadow-[0_24px_80px_rgba(0,0,0,0.5)]` | `pro-card-elevated` | n/a |
| Master-detail grid | `grid gap-0 md:grid-cols-[300px_1fr]` | (Tailwind grid) | n/a |
| Roster panel | `border-b border-white/10 bg-black/10 p-3 md:border-b-0 md:border-r` | (chrome) | n/a |
| Roster row (active) | `pro-list-row group w-full !gap-3 text-left … !border-white/20 !bg-white/10 ${a.glow}` | `pro-list-row` (with active override) | `Student` |
| Roster avatar | `pro-avatar h-9 w-9 !text-[11px] bg-gradient-to-br ${avatarGradient(id)} !text-black/80` | `pro-avatar` | initials via `initials(name)` |
| Detail header avatar | `pro-avatar h-14 w-14 !text-lg bg-gradient-to-br ${avatarGradient(id)} !text-black/80` | `pro-avatar` | same |
| Status pill (fee) | `pro-status-pill ${sa.border} ${sa.bg} ${sa.text}` | `pro-status-pill` | `STATUS_META[status]` |
| Status pill (fee model) | `pro-status-pill ${ACCENT_MAP[FEE_MODEL_META[feeModel].accent].border …}` | `pro-status-pill` | `FEE_MODEL_META[feeModel]` |
| Tab strip | `pro-tab-strip mb-4 !inline-flex` | `pro-tab-strip` | `TABS: {id,label,icon}[]` |
| Tab button | `pro-tab relative flex items-center gap-1.5` | `pro-tab` | `Tab = "overview"\|"ledger"\|"attendance"\|"notes"` |
| Overview KPI | `pro-kpi p-3` + `style={{ '--kpi-accent': sa.hex }}` | `pro-kpi` | `stats: {label,value,accent,icon}[]` |
| Contact card | `pro-card p-4` | `pro-card` | `Student` (phone, email, guardian) |
| Enrolment card | `pro-card p-4` | `pro-card` | `Student` (code, joinedOn, batch) |
| Last payment card | `pro-card p-4` + `style={{ '--kpi-accent': a.hex }}` | `pro-card` | `Student.lastPayment` |
| Fee model card | `pro-card p-4` | `pro-card` | `Student.feeModel` |
| Add-student btn | `pro-btn-secondary mt-3 w-full !border-dashed !border-white/15 !bg-transparent !text-white/50 …` | `pro-btn-secondary` (override) | static |
| Record-payment btn | `pro-btn-secondary !px-3 !py-1.5 !text-xs` | `pro-btn-secondary` | static |
| Open-full btn | `pro-btn-secondary !px-3 !py-1.5 !text-xs !border-[#00FF9D]/30 !bg-[#00FF9D]/10 !text-[#00FF9D] …` | `pro-btn-secondary` (accent override) | static |
| Notes Add btn | `pro-btn-secondary !px-2.5 !py-1 !text-[11px]` | `pro-btn-secondary` | static |
| Note card | `pro-card p-3` | `pro-card` | `NOTES[s.id]: {date,text,tag?}[]` |
| Ledger table | `overflow-hidden rounded-xl border border-white/10` + `<table>` | (no pro-* — semantic table) | `LEDGER[s.id]: LedgerEntry[]` |

**Mock data (Student + Ledger types — shared with §23.3 Fees Ledger):**

```ts
type FeeModel = "Postpaid" | "Prepaid" | "Mixed";
type FeeStatus = "paid" | "partial" | "unpaid" | "no-dues";

type Student = {
  id: string; name: string; code: string;   // code format: "TUT-0001"
  cls: string; subject: string; feeModel: FeeModel; status: FeeStatus;
  balance: number; monthlyFee: number;      // integer paise (e.g. 4500 = ₹45.00 — see 11_Data_Model.md §3)
  attendancePct: number; totalPaid: number;
  lastPayment?: { amount: number; date: string; receipt: string };  // receipt: "RC-000142"
  guardian: string; phone: string; email: string; joinedOn: string; batch: string;
};

const STUDENTS: Student[] = [
  { id: "s1", name: "Aarav Sharma",  code: "TUT-0001", cls: "Class 10", subject: "Mathematics",
    feeModel: "Postpaid", status: "partial", balance: 4500, monthlyFee: 7500,
    attendancePct: 92, totalPaid: 22500,
    lastPayment: { amount: 3000, date: "12 Nov", receipt: "RC-000142" },
    guardian: "Rohit Sharma", phone: "+91 98xxx 12345", email: "rohit.s@gmail.com",
    joinedOn: "Apr 2024", batch: "Mon–Wed–Fri · 5 PM" },
  { id: "s3", name: "Ishaan Verma",  code: "TUT-0003", cls: "Class 12", subject: "Physics",
    feeModel: "Prepaid",  status: "paid",    balance: 0,    monthlyFee: 6000,
    attendancePct: 96, totalPaid: 36000,
    lastPayment: { amount: 6000, date: "10 Nov", receipt: "RC-000139" },
    guardian: "Sanjay Verma", phone: "+91 98xxx 34567", email: "sanjay.v@gmail.com",
    joinedOn: "Jan 2024", batch: "Daily · 6 AM" },
  { id: "s7", name: "Aditya Nair",   code: "TUT-0007", cls: "Class 9",  subject: "Mathematics",
    feeModel: "Postpaid", status: "no-dues", balance: 0,    monthlyFee: 5000,
    attendancePct: 99, totalPaid: 30000,
    guardian: "Prakash Nair", phone: "+91 98xxx 78901", email: "prakash.n@gmail.com",
    joinedOn: "Mar 2024", batch: "Daily · 7 AM" },
];

const STATUS_META: Record<FeeStatus, { accent: Accent; label: string }> = {
  paid:      { accent: "emerald", label: "Paid" },
  partial:   { accent: "amber",   label: "Partial" },
  unpaid:    { accent: "flare",   label: "Unpaid" },
  "no-dues": { accent: "cyan",    label: "No Dues" },
};

const FEE_MODEL_META: Record<FeeModel, { accent: Accent; desc: string }> = {
  Postpaid: { accent: "cyan",    desc: "Pay after the month" },
  Prepaid:  { accent: "emerald", desc: "Pay before the month" },
  Mixed:    { accent: "violet",  desc: "Part prepaid, part postpaid" },
};
```

The 8 sample students are: Aarav Sharma (TUT-0001), Diya Patel (TUT-0002), Ishaan Verma (TUT-0003), Ananya Reddy (TUT-0004), Vivaan Gupta (TUT-0005), Saanvi Iyer (TUT-0006), Aditya Nair (TUT-0007), Myra Kapoor (TUT-0008). All names are common Indian first names; classes range Class 7–Class 12; subjects span Mathematics / Science / Physics / Chemistry / Biology.

**`pro-*` Utility Inventory:**

| Utility | Count | Replaces |
|---|---|---|
| `pro-card-elevated` | 1 | device frame |
| `pro-card` | ~12 | contact/enrolment/last-payment/fee-model cards + per-note cards across tabs |
| `pro-kpi` | 4 | overview stat grid + 4 in attendance tab |
| `pro-tab-strip` + `pro-tab` | 1 + 4 | detail-pane tab strip |
| `pro-status-pill` | ~8 | fee status + fee model pills (1 per active student, plus per-note tag pills) |
| `pro-list-row` | 8 + ~5 (settings-style rows in panels) | roster rows + contact/enrolment detail rows |
| `pro-avatar` | 9 | roster avatars + 1 large detail avatar |
| `pro-btn-secondary` | ~6 | Record Payment / Open Full / Add Student / Add Note / nav arrows |
| `pro-btn-ghost` | 0 | (none — no ghost buttons on this screen) |

Source: `src/components/tutoros/students-prototype.tsx:1-742`.

---

### 23.3 Fees Ledger Prototype — `src/components/tutoros/fees-ledger-prototype.tsx` (640 lines)

The "heart" screen. 4-card KPI strip → 5/3 master-detail split: left = student list with status tabs + search; right = immutable ledger table with running balance. The Record Payment sheet is a right-side drawer with live preview + predicted balance.

```
┌─ device frame (pro-card-elevated, max-w-6xl) ────────────────────────────────────────────┐
│ ● ● ●   tutoros · fees & payments · ledger mode                          🔒 APPEND-ONLY │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─ KPI strip (grid-cols-2 lg:grid-cols-4) ─────────────────────────────────────────────┐ │
│ │ ▌Collected·Nov  ▌Due Till Date  ▌Overdue       ▌Advance Held                        │ │
│ │ ▌₹ 1,24,500 emr ▌₹ 38,200 amb   ▌₹ 9,400 flare ▌₹ 6,500 cyan                       │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌─ student list (lg:col-span-2) ──────────┐  ┌─ ledger detail (lg:col-span-3) ───────┐ │
│ │ 🔍 Search students…                      │  │ AS  Aarav Sharma  TUT-0001 · Maths    │ │
│ │ [All] [Unpaid] [Partial] [Paid] [No Due]│  │     · Postpaid         Balance due    │ │
│ │                                          │  │                          ₹4,500 amb  │ │
│ │ ┌─ pro-list-row (selected) ─────────────┐│  │ ──────────────────────────────────────│ │
│ │ │ AS Aarav Sharma    ₹4,500  ● Partial  ││  │ 🔒 Immutable Ledger · 3 entries       │ │
│ │ │    Class 10 · Maths                   ││  │ ┌──────────────────────────────────┐  │ │
│ │ └───────────────────────────────────────┘│  │ │ Date   Entry        Dr    Cr  Bal │  │ │
│ │ ┌─ pro-list-row ────────────────────────┐│  │ │ 01 Nov Nov tuition  ₹7,500 —  ₹7.5k│ │ │
│ │ │ DP Diya Patel      ₹6,000  ● Unpaid   ││  │ │ 12 Nov UPI partial  —   ₹3k  ₹4.5k│  │ │
│ │ │    Class 9 · Science                  ││  │ │ 01 Dec Dec tuition  ₹7,500 —  ₹12k │  │ │
│ │ └───────────────────────────────────────┘│  │ └──────────────────────────────────┘  │ │
│ │            ⋮ 6 more rows                 │  │ [+ Record Pay] [Invoice] [Statement]   │ │
│ └──────────────────────────────────────────┘  └────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
   ↑ record-payment sheet (right drawer, max-w-md): ₹ input + method grid + Live Preview card
   ↑ footer rules (3 pro-card grid below the frame): Append-only / Balances derived / Tamper-evident
```

**Structure:**

| Region | Exact className from src (`fees-ledger-prototype.tsx`) | `pro-*` utility | Data shape |
|---|---|---|---|
| Device frame | `pro-card-elevated relative mx-auto max-w-6xl overflow-hidden rounded-3xl !rounded-3xl shadow-[0_24px_80px_rgba(0,0,0,0.5)]` | `pro-card-elevated` | n/a |
| KPI card | `pro-kpi p-4` + `style={{ '--kpi-accent': a.hex }}` | `pro-kpi` | `FEE_KPIS: {label,value,prefix,accent,delta,icon}[]` |
| Search card | `pro-card mb-3 flex items-center gap-2 !rounded-xl p-2` | `pro-card` | search input state |
| Filter tab strip | `pro-tab-strip mb-3 !inline-flex flex-wrap` | `pro-tab-strip` | `TABS: {key: FeeStatus\|"all", label}[]` |
| Filter tab | `pro-tab relative` | `pro-tab` | count from `statusCounts` |
| Student list row | `pro-list-row group w-full !gap-3 text-left … !border-[#00FF9D]/30 !bg-[#00FF9D]/10` (selected) or `!border-white/5 !bg-white/[0.02]` | `pro-list-row` | `Student` |
| Student avatar | `pro-avatar h-8 w-8 !text-[10px] bg-gradient-to-br from-white/15 to-white/5 !text-white/80` | `pro-avatar` | initials |
| Empty state | `pro-empty !rounded-xl !py-8 text-xs text-white/40` | `pro-empty` | static |
| Detail card | `pro-card p-4` | `pro-card` | selected student |
| Detail avatar | `pro-avatar h-10 w-10 !text-xs bg-gradient-to-br from-[#00FF9D]/30 to-[#00F0FF]/30 !text-white` | `pro-avatar` | initials |
| Empty ledger | `pro-empty !rounded-xl !py-10` | `pro-empty` | static (no entries) |
| Ledger table | `scroll-glass max-h-[280px] overflow-y-auto` + `<table>` | (no pro-* — semantic table) | `LedgerEntry[]` with running balance |
| Record payment btn | `pro-btn-primary !px-3 !py-2 !text-xs` | `pro-btn-primary` | opens `RecordPaymentSheet` |
| Invoice btn | `pro-btn-secondary !px-3 !py-2 !text-xs !font-medium !border-[#00F0FF]/30 !bg-[#00F0FF]/10 !text-[#00F0FF] …` | `pro-btn-secondary` (cyan accent override) | static |
| Statement btn | `pro-btn-secondary !px-3 !py-2 !text-xs !font-medium` | `pro-btn-secondary` | static |
| Record-payment sheet | `absolute inset-0 z-30 flex items-end justify-end sm:items-stretch` + inner `relative z-10 … bg-[#14142a]/95 backdrop-blur-2xl` | (none — chrome) | `Student` + sheet state |
| Sheet record btn | `pro-btn-primary w-full !py-3 !text-sm !font-bold disabled:cursor-not-allowed …` | `pro-btn-primary` | disabled when `amt <= 0` |
| Footer rules card | `pro-card flex items-start gap-3 p-4` | `pro-card` | `{icon, t, d, a}[]` (3 rules) |
| Read-spec link | `pro-btn-ghost !text-xs` | `pro-btn-ghost` | static |

**Mock data (`LedgerEntry` is the canonical immutable-ledger row — see `11_Data_Model.md` §5):**

```ts
type LedgerEntry = {
  id: string;
  date: string;            // "01 Nov" — display format
  type: "FEE_CHARGED" | "PAYMENT_RECEIVED" | "DISCOUNT" | "VOID" | "ADVANCE";
  description: string;
  debit: number;           // integer paise — amount owed (fee charged)
  credit: number;          // integer paise — amount paid
  receipt?: string;        // "RC-000142" — issued on PAYMENT_RECEIVED only
  voided?: boolean;
  reverses?: string;       // for VOID entries, the id of the voided row
};

const LEDGER: Record<string, LedgerEntry[]> = {
  s1: [
    { id: "l1", date: "01 Nov", type: "FEE_CHARGED",      description: "Nov tuition · Maths", debit: 7500, credit: 0 },
    { id: "l2", date: "12 Nov", type: "PAYMENT_RECEIVED", description: "UPI · partial",       debit: 0,    credit: 3000, receipt: "RC-000142" },
    { id: "l3", date: "01 Dec", type: "FEE_CHARGED",      description: "Dec tuition · Maths", debit: 7500, credit: 0 },
  ],
  s3: [
    { id: "l5", date: "01 Nov", type: "FEE_CHARGED",      description: "Nov tuition · Physics", debit: 6000, credit: 0 },
    { id: "l6", date: "10 Nov", type: "PAYMENT_RECEIVED", description: "Cash · full",           debit: 0,    credit: 6000, receipt: "RC-000139" },
  ],
};

const ENTRY_META: Record<LedgerEntry["type"], { accent: Accent; label: string; icon; sign }> = {
  FEE_CHARGED:      { accent: "flare",   label: "FEE_CHARGED",      icon: ArrowUpRight, sign: "debit" },
  PAYMENT_RECEIVED: { accent: "emerald", label: "PAYMENT_RECEIVED", icon: ArrowDownLeft, sign: "credit" },
  DISCOUNT:         { accent: "violet",  label: "DISCOUNT",         icon: ArrowDownLeft, sign: "credit" },
  VOID:             { accent: "flare",   label: "VOID",             icon: X,             sign: "neutral" },
  ADVANCE:          { accent: "cyan",    label: "ADVANCE",          icon: ArrowDownLeft, sign: "credit" },
};

const FEE_KPIS = [
  { label: "Collected · Nov", value: 124500, prefix: "₹ ", accent: "emerald" as Accent, delta: "↑ 18% vs Oct", icon: Wallet },
  { label: "Due Till Date",   value: 38200,  prefix: "₹ ", accent: "amber"   as Accent, delta: "5 students owe", icon: Clock },
  { label: "Overdue",         value: 9400,   prefix: "₹ ", accent: "flare"   as Accent, delta: "2 students · 9d+", icon: AlertTriangle },
  { label: "Advance Held",    value: 6500,   prefix: "₹ ", accent: "cyan"    as Accent, delta: "3 students prepaid", icon: TrendingUp },
];
```

**`pro-*` Utility Inventory:**

| Utility | Count | Replaces |
|---|---|---|
| `pro-card-elevated` | 1 | device frame |
| `pro-card` | ~5 | search card + detail card + 3 footer-rule cards |
| `pro-kpi` | 4 | KPI strip |
| `pro-tab-strip` + `pro-tab` | 1 + 5 | filter tab strip |
| `pro-list-row` | 8 | student list rows |
| `pro-avatar` | 9 | list avatars (8) + 1 detail avatar |
| `pro-empty` | 2 | empty filter result + empty ledger |
| `pro-btn-primary` | 2 | Record Payment (in detail + sheet) |
| `pro-btn-secondary` | 3 | Invoice / Statement / footer CTA |
| `pro-btn-ghost` | 1 | "Read the full spec" link |

Source: `src/components/tutoros/fees-ledger-prototype.tsx:1-640`.

---

### 23.4 Attendance Prototype — `src/components/tutoros/attendance-prototype.tsx` (721 lines)

Mark-today flow. Batch selector (4 batches as `pro-btn-secondary` segmented cards) + horizontal week strip (7 day buttons, colour-coded by lock/today/open state) + 4-card stats row + per-student roster with a 4-state segmented mark control (Present/Late/Absent/Off). The PIN gate is a centered modal with a 6-dot indicator + neumorphic keypad.

```
┌─ device frame (pro-card-elevated, max-w-5xl) ────────────────────────────────────────────┐
│ ● ● ●   tutoros · attendance · Nov 2025                            ● TODAY (or 🔒 LOCKED) │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  [Class 10 · Maths]  [Class 12 · Physics]  [Class 9 · Sci]  [Class 11 · Chem]            │
│   ← [M 14] [T 15] [W 16*] [T 17] [F 18] [S 19] [S 20] →     (* = selected/today)         │
│  ┌─ stats (grid-cols-2 sm:grid-cols-4) ─────────────────────────────────────────────────┐ │
│  │ ▌Present  ▌Late   ▌Absent  ▌Present Rate                                            │ │
│  │ ▌ 6 emr   ▌ 1 amb ▌ 1 flare ▌ 75% cyan                                              │ │
│  └──────────────────────────────────────────────────────────────────────────────────────┘ │
│  ┌─ roster (pro-card p-3) ──────────────────────────────────────────────────────────────┐ │
│  │ Class 10 · Maths · 3 students    [✓ All present] [✕ All absent]                      │ │
│  │ ┌─ pro-list-row ───────────────────────────────────────────────────────────────────┐ │ │
│  │ │ AS Aarav Sharma           [✓] [⏰] [✕] [—]   ← segmented mark control, 4 states  │ │ │
│  │ │    10 · Maths                                                                     │ │ │
│  │ └──────────────────────────────────────────────────────────────────────────────────┘ │ │
│  │ ┌─ pro-list-row ───────────────────────────────────────────────────────────────────┐ │ │
│  │ │ DP Diya Patel             [✓] [⏰*] [✕] [—]   ← * = active (Late = amber)        │ │ │
│  │ └──────────────────────────────────────────────────────────────────────────────────┘ │ │
│  │  Legend: ✓ Present  ⏰ Late  ✕ Absent  — Off       🛡 Audit-logged   [Save & lock]   │ │
│  └──────────────────────────────────────────────────────────────────────────────────────┘ │
│  Quick actions: [Mark holiday] [Bulk late → present] [Export register]                    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
   ↑ locked day click → PIN gate modal (fixed inset-0 z-70, centered max-w-xs, neumo keypad)
   ↑ save toast: fixed bottom-6 left-1/2, pro-card !rounded-xl, emerald CheckCircle2 icon
```

**Structure:**

| Region | Exact className from src (`attendance-prototype.tsx`) | `pro-*` utility | Data shape |
|---|---|---|---|
| Device frame | `pro-card-elevated mx-auto max-w-5xl overflow-hidden rounded-3xl !rounded-3xl shadow-[0_24px_80px_rgba(0,0,0,0.5)]` | `pro-card-elevated` | n/a |
| Batch button (active) | `pro-btn-secondary group relative !flex-col !items-start !gap-0 !px-3 !py-1.5 !text-left !border-[#FFB300]/40 !bg-[#FFB300]/10` | `pro-btn-secondary` (column override) | `BATCHES: {id,name,time,students}[]` |
| Week-strip day button | `relative flex h-12 w-10 flex-col items-center justify-center rounded-lg border text-center transition …` (4 state branches: selected/today/locked/default) | (none — custom button) | `DayState` |
| Day-stat KPI | `pro-kpi p-3` + `style={{ '--kpi-accent': a.hex }}` | `pro-kpi` | `{label, value, accent, icon}[]` |
| Locked banner | `flex flex-wrap items-center gap-3 rounded-xl border border-[#FF5E00]/30 bg-[#FF5E00]/8 px-4 py-3` | (none — banner chrome) | derived from `selected.isLocked` |
| Roster card | `pro-card p-3` | `pro-card` | `batchStudents` |
| Roster row | `pro-list-row group !gap-3` | `pro-list-row` | `Student` |
| Roster avatar | `pro-avatar h-8 w-8 !text-[11px] bg-gradient-to-br from-[#FFB300]/30 to-[#FF5E00]/20 !text-[#FFB300]` | `pro-avatar` | `Student.avatar` (2-letter initials) |
| Segmented mark control | `flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-0.5` + 4 inner buttons | (none — segmented control, §8.5) | `MARK_META: Record<Mark, {…}>` |
| All-present btn | `pro-btn-secondary !px-2 !py-1 !text-[10px] !font-medium !border-[#00FF9D]/30 !bg-[#00FF9D]/10 !text-[#00FF9D] …` | `pro-btn-secondary` (emerald override) | static |
| All-absent btn | `pro-btn-secondary !px-2 !py-1 !text-[10px] !font-medium !border-[#FF5E00]/30 !bg-[#FF5E00]/10 !text-[#FF5E00] …` | `pro-btn-secondary` (flare override) | static |
| Unlock-with-PIN btn | `pro-btn-secondary !px-3 !py-1.5 !text-[11px] !font-semibold !border-[#FF5E00]/40 !bg-[#FF5E00]/15 !text-[#FF5E00] …` | `pro-btn-secondary` (flare override) | static |
| Save & lock btn | `pro-btn-secondary !px-3 !py-1.5 !text-[11px] !font-semibold !border-[#00FF9D]/40 !bg-gradient-to-r from-[#00FF9D]/20 to-[#00F0FF]/20 !text-[#00FF9D] …` | `pro-btn-secondary` (gradient override) | static |
| Quick-action btn | `pro-btn-secondary !px-2.5 !py-1.5 !text-[11px] !font-medium !border ${a.border} !bg-white/[0.04] ${a.text}` | `pro-btn-secondary` (accent override) | `{ label, icon, accent }[]` |
| PIN gate modal | `fixed inset-0 z-[70] flex items-center justify-center p-4` + inner `relative z-10 w-full max-w-xs … bg-[#14142a]/95 backdrop-blur-2xl` | (none — modal chrome) | `PinGate` props |
| PIN keypad btn | `neumo-raised h-12 rounded-xl text-lg font-semibold text-white transition active:scale-95` | `neumo-raised` (§6.1) | static |
| Save toast | `fixed bottom-6 left-1/2 z-[80] … pro-card !rounded-xl` + emerald CheckCircle2 | `pro-card` | derived from `dayMarks` |

**Mock data:**

```ts
type Mark = "present" | "absent" | "late" | "off";

type Student = { id: string; name: string; cls: string; avatar: string; defaultMark: Mark };

const STUDENTS: Student[] = [
  { id: "s1", name: "Aarav Sharma",   cls: "10 · Maths",   avatar: "AS", defaultMark: "present" },
  { id: "s2", name: "Diya Patel",     cls: "10 · Maths",   avatar: "DP", defaultMark: "present" },
  { id: "s3", name: "Ishaan Verma",   cls: "12 · Physics", avatar: "IV", defaultMark: "present" },
  { id: "s5", name: "Vivaan Gupta",   cls: "11 · Chem",    avatar: "VG", defaultMark: "present" },
];

const BATCHES = [
  { id: "b1", name: "Class 10 · Maths",   time: "Mon–Sat · 07:00",       students: ["s1","s2","s6"] },
  { id: "b2", name: "Class 12 · Physics", time: "Mon–Sat · 17:00",       students: ["s3","s7"] },
  { id: "b3", name: "Class 9 · Science",  time: "Tue·Thu·Sat · 18:30",   students: ["s4","s8"] },
  { id: "b4", name: "Class 11 · Chem",    time: "Sun · 10:00",           students: ["s5"] },
];

const MARK_META: Record<Mark, { label: string; icon; accent: Accent; key: string }> = {
  present: { label: "Present", icon: Check, accent: "emerald", key: "p" },
  late:    { label: "Late",    icon: Clock, accent: "amber",   key: "l" },
  absent:  { label: "Absent",  icon: X,     accent: "flare",   key: "a" },
  off:     { label: "Off",     icon: Minus, accent: "violet",  key: "o" },
};
```

**`pro-*` Utility Inventory:**

| Utility | Count | Replaces |
|---|---|---|
| `pro-card-elevated` | 1 | device frame |
| `pro-card` | 2 | roster card + save toast |
| `pro-kpi` | 4 | day-stats row |
| `pro-list-row` | 3 (per batch, varies) | roster rows |
| `pro-avatar` | 3+ (per student) | roster avatars |
| `pro-btn-secondary` | ~8 | batch buttons (4) + All present/absent + Unlock + Save & lock + quick actions (3) |
| `neumo-raised` (§6.1, not pro-*) | ~11 | PIN keypad digits (1–9, 0) |

Source: `src/components/tutoros/attendance-prototype.tsx:1-721`.

---

### 23.5 Settings Prototype — `src/components/tutoros/settings-prototype.tsx` (516 lines)

Sidebar + content split. The 56-wide sidebar holds 8 `pro-list-row`-styled buttons (Profile / Appearance / Security / Backups / Import-Export / Reminders / Audit / Diagnostics), each with its own accent. The right pane renders the matching panel via `AnimatePresence`. Toggles use the §6 `NeumoToggle` neumorphic primitive.

```
┌─ device frame (pro-card-elevated, max-w-5xl) ────────────────────────────────────────────┐
│ ● ● ●   tutoros · settings                                ● INSTANT-APPLY (violet pulse)  │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─ sidebar (md:w-56) ──────┐  ┌─ content (1fr, p-6) ────────────────────────────────────┐ │
│ │ 👤 Profile      ▸ emerald│  │  ◯ PS   Priya Sharma                                     │ │
│ │ 🎨 Appearance   ▸ cyan   │  │         Solo home tutor · 47 active students            │ │
│ │ 🛡 Security     ▸ flare  │  │         ● Provisoned · Turso db-priya-001               │ │
│ │ 💾 Backups      ▸ violet │  │  ─────────────────────────────────────────────────────  │ │
│ │ 📤 Import/Expt  ▸ amber  │  │  Full name      [Priya Sharma           ]               │ │
│ │ 🔔 Reminders    ▸ amber  │  │  Phone          [+91 98765 43210        ]               │ │
│ │ 📋 Audit Log    ▸ cyan   │  │  Institution    [Priya's Maths Academy  ]               │ │
│ │ 🖥 Diagnostics  ▸ violet │  │  ✓ Auto-saved · changes replicate via sync_outbox       │ │
│ └─────────────────────────┘  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
   ↑ sidebar row active: a.bg + a.border (accent-tinted, not gradient)
   ↑ sidebar row inactive: border-transparent hover:bg-white/[0.04]
   ↑ NeumoToggle: neumo-inset h-9 w-16 + spring-physics knob (emerald→cyan gradient when on)
```

**Structure (the 8 panels share these primitives):**

| Region | Exact className from src (`settings-prototype.tsx`) | `pro-*` utility | Data shape |
|---|---|---|---|
| Device frame | `pro-card-elevated mx-auto max-w-5xl overflow-hidden rounded-3xl !rounded-3xl shadow-[0_24px_80px_rgba(0,0,0,0.5)]` | `pro-card-elevated` | n/a |
| Sidebar row (active) | `group flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition … ${a.bg} border ${a.border}` | (custom row — sidebar nav) | `SECTIONS: SettingsSection[]` |
| Sidebar row (inactive) | `… border border-transparent hover:bg-white/[0.04]` | (custom row) | same |
| Profile avatar | `pro-avatar h-16 w-16 !text-2xl bg-gradient-to-br from-[#00FF9D]/30 to-[#00F0FF]/20 !text-[#00FF9D]` | `pro-avatar` | initials "PS" |
| Theme row | `pro-list-row !justify-start gap-3` | `pro-list-row` | n/a |
| Accent colour picker | `relative h-9 w-9 rounded-full transition …` + `style={{ background: radial-gradient(${a.hex}, ${a.hex}88) }}` | (custom swatch button) | `Accent` |
| Density picker | `rounded-lg border px-3 py-1.5 text-xs font-medium capitalize …` | (custom button) | `"comfortable"\|"compact"` |
| Security PIN row | `pro-list-row !justify-start gap-3` | `pro-list-row` | static |
| Security toggle | `NeumoToggle on={biometric}` | (neumo §6.4) | boolean state |
| Security status pill | `pro-status-pill border-[#FFB300]/30 bg-[#FFB300]/10 text-[#FFB300]` | `pro-status-pill` | lockout steps "30s → 1m → 5m" |
| Backup list row | `pro-list-row group !gap-3` | `pro-list-row` | `backups: {name,size,date,status}[]` |
| Backup status pill | `pro-status-pill border-[#00FF9D]/30 bg-[#00FF9D]/10 text-[#00FF9D]` | `pro-status-pill` | `"encrypted"` |
| Create backup btn | `pro-btn-secondary flex-1 !text-[11px] !font-semibold !border-[#B388FF]/40 !bg-[#B388FF]/10 !text-[#B388FF] …` | `pro-btn-secondary` (violet override) | static |
| Restore btn | `pro-btn-secondary flex-1 !text-[11px] !font-semibold !border-[#00FF9D]/40 !bg-[#00FF9D]/10 !text-[#00FF9D] …` | `pro-btn-secondary` (emerald override) | static |
| Export card | `pro-card p-3` | `pro-card` | `{label, desc, accent}[]` |
| Export row | `pro-list-row group w-full !gap-3 text-left` | `pro-list-row` | export option |
| Import drop zone | `pro-empty !rounded-xl !p-6 hover:!border-[#00F0FF]/30` | `pro-empty` | static |
| Diagnostics row | `pro-list-row !justify-start gap-3` | `pro-list-row` | `{label, value, icon, accent}[]` |
| Erase btn (destructive) | `pro-btn-secondary flex-1 !text-[11px] !font-semibold !border-[#FF5E00]/40 !bg-[#FF5E00]/10 !text-[#FF5E00] …` | `pro-btn-secondary` (flare override) | static |

**Mock data (canonical):**

```ts
type SettingsSection = { id: string; label: string; icon: typeof Settings; accent: Accent; desc: string };

const SECTIONS: SettingsSection[] = [
  { id: "profile",      label: "Profile",        icon: User,         accent: "emerald", desc: "Name, phone, email, institution" },
  { id: "appearance",   label: "Appearance",     icon: Palette,      accent: "cyan",    desc: "Dark-mode only, accent colour, density" },
  { id: "security",     label: "Security",       icon: ShieldCheck,  accent: "flare",   desc: "PIN, biometric, lockout policy" },
  { id: "backups",      label: "Backups",        icon: Database,     accent: "violet",  desc: "Auto-backup, .tutoros files, restore" },
  { id: "import",       label: "Import / Export", icon: Upload,      accent: "amber",   desc: "Excel, CSV, bulk import" },
  { id: "reminders",    label: "Reminders",      icon: Bell,         accent: "amber",   desc: "Quiet hours, channels, snooze" },
  { id: "audit",        label: "Audit Log",      icon: Activity,     accent: "cyan",    desc: "Every mutation, timestamped" },
  { id: "diagnostics",  label: "Diagnostics",    icon: Monitor,      accent: "violet",  desc: "DB size, schema version, integrity" },
];

// Profile defaults (Priya Sharma — the canonical tutor persona, see 00_Vision.md §6):
const [name, setName]               = useState("Priya Sharma");
const [phone, setPhone]             = useState("+91 98765 43210");
const [institution, setInstitution] = useState("Priya's Maths Academy");

// Diagnostics rows reference the canonical counts used across prototypes:
const diagItems = [
  { label: "Database size",    value: "4.2 MB",                              icon: Database,     accent: "emerald" },
  { label: "Schema version",   value: "7 (PRAGMA user_version)",             icon: HardDrive,    accent: "cyan"    },
  { label: "Ledger integrity", value: "✓ Hash chain valid (1,247 entries)",  icon: ShieldCheck,  accent: "emerald" },
  { label: "Sync status",      value: "Local-only (v1 stub)",                icon: RefreshCw,    accent: "amber"   },
  { label: "FTS5 index",       value: "Healthy · 47 students indexed",       icon: Search,       accent: "cyan"    },
  { label: "Last backup",      value: "Today 06:30 · 4.2 MB",                icon: Download,     accent: "violet"  },
];
```

**`pro-*` Utility Inventory:**

| Utility | Count | Replaces |
|---|---|---|
| `pro-card-elevated` | 1 | device frame |
| `pro-card` | ~3 | export card + import card + (varies by panel) |
| `pro-list-row` | ~8 | theme row + 4 security rows + 3 backup rows + diagnostics rows |
| `pro-avatar` | 1 | profile avatar (large) |
| `pro-status-pill` | 2 | lockout policy pill + encrypted pill |
| `pro-empty` | 1 | import drop zone |
| `pro-btn-secondary` | ~4 | Create backup / Restore / Erase / Verify integrity |
| `NeumoToggle` (§6, not pro-*) | 3 | theme / biometric / auto-backup toggles |

Source: `src/components/tutoros/settings-prototype.tsx:1-516`.

---

### 23.6 Backup Prototype — `src/components/tutoros/backup-prototype.tsx` (811 lines)

Two side-by-side device frames (`lg:grid-cols-2`): left = Create Backup (4-step wizard: Scope → Password → Review → Progress); right = Restore (3-step wizard: File → Password → Restore). Below them, a full-width `pro-card-elevated` history table with 5 rows.

```
┌─ CREATE (pro-card-elevated, lg:col-span-1) ─────┐  ┌─ RESTORE (pro-card-elevated, lg:col-span-1) ───┐
│ ● ● ●  tutoros · create-backup   ● CREATE        │  │ ● ● ●  tutoros · restore-from-file  ● RESTORE  │
├──────────────────────────────────────────────────┤  ├──────────────────────────────────────────────────┤
│ ① Scope    ② Password   ③ Review   ④ Progress   │  │ ① Drop file   ② Password   ③ Restore           │
│  ↓ (vertical Stepper)                            │  │  ↓ (vertical Stepper)                            │
│  Step 1 · Choose scope                           │  │  Step 1 · Choose a file                          │
│  ┌────────────────────────────────────────────┐  │  │  ┌──────────────────────────────────────────┐  │
│  │ ◉ Full backup        [≈ 2.4 MB]  emerald   │  │  │  ┌─ pro-empty (drop zone) ─────────────┐    │  │
│  │   All students, ledger, attendance, audit  │  │  │  │     ⬆ UploadCloud                     │    │  │
│  ├────────────────────────────────────────────┤  │  │  │  Drop your .tutoros file here        │    │  │
│  │ ◯ Ledger only       [≈ 180 KB]  cyan       │  │  │  │  or click to browse                  │    │  │
│  ├────────────────────────────────────────────┤  │  │  └──────────────────────────────────────┘    │  │
│  │ ◯ Snapshot (read-only) [≈ 1.1 MB] violet   │  │  │  Recent backups:                              │  │
│  └────────────────────────────────────────────┘  │  │  ┌─ pro-list-row ─────────────────────────┐  │  │
│  [✓ Include media]   [Continue →]                │  │  │ 💾 tutoros-backup-…-1830.tutoros       │  │  │
└──────────────────────────────────────────────────┘  └──────────────────────────────────────────────────┘

┌─ Backup History (pro-card-elevated, full-width, mt-6) ───────────────────────────────────┐
│ 📋 Backup History   [last 5]                              audit_log · BR-SEC-03         │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ Date          File                                              Size    Scope      Status │
│ 15 Nov, 14:30 tutoros-backup-2024-11-15-1430.tutoros           2.4 MB  Full       ● Comp │
│ 14 Nov, 18:30 tutoros-backup-2024-11-14-1830.tutoros           2.4 MB  Full       ● Comp │
│ 13 Nov, 21:14 tutoros-backup-2024-11-13-2114.tutoros           1.1 MB  Snapshot   ● Interr│
└──────────────────────────────────────────────────────────────────────────────────────────┘
   ↑ Stepper: vertical, 8-step indicator + label + desc; accent per step from `accents: Accent[]`
   ↑ ProgressCard: linear-gradient bar + 4 phase chips (Snapshotting / Serializing / Deriving / Encrypting)
   ↑ success state: border-[#00FF9D]/40 bg-[#00FF9D]/10 + glow-emerald
```

**Structure:**

| Region | Exact className from src (`backup-prototype.tsx`) | `pro-*` utility | Data shape |
|---|---|---|---|
| Create device frame | `pro-card-elevated overflow-hidden rounded-3xl !rounded-3xl shadow-[0_24px_80px_rgba(0,0,0,0.5)]` | `pro-card-elevated` | n/a |
| Restore device frame | (same) | `pro-card-elevated` | n/a |
| Status pill (CREATE) | `pro-status-pill border-[#00FF9D]/30 bg-[#00FF9D]/10 text-[#00FF9D]` | `pro-status-pill` | static |
| Status pill (RESTORE) | `pro-status-pill border-[#00F0FF]/30 bg-[#00F0FF]/10 text-[#00F0FF]` | `pro-status-pill` | static |
| Scope button (selected) | `flex w-full items-start gap-3 rounded-xl border p-3 text-left transition … ${a.border} ${a.bg}` | (custom card-button) | `SCOPES: {id,label,desc,size,accent}[]` |
| Scope size pill | `rounded-full border ${a.border} ${a.bg} px-1.5 py-0.5 text-[9px] font-medium ${a.text}` | (mini pill — not pro-status-pill in src) | `Scope.size` |
| Continue btn (step 1→2) | `pro-btn-secondary !h-9 !px-3 !text-[11px] !font-semibold !border-[#00FF9D]/40 !bg-[#00FF9D]/10 !text-[#00FF9D] …` | `pro-btn-secondary` (emerald override) | static |
| Back btn | `pro-btn-secondary !h-9 !px-3 !text-[11px] !font-medium !text-white/60 hover:!text-white` | `pro-btn-secondary` | static |
| Continue btn (step 2→3) | `pro-btn-secondary !h-9 !px-3 !text-[11px] !font-semibold … disabled:cursor-not-allowed disabled:!opacity-40` | `pro-btn-secondary` | disabled when `!canAdvanceStep2` |
| Create backup btn | `pro-btn-primary !h-10 !px-4 !text-[11px] !font-bold` | `pro-btn-primary` | triggers `startBackup()` |
| Download btn (success) | `pro-btn-primary h-10 flex-1 !text-[11px] !font-bold` | `pro-btn-primary` | static |
| Create-another btn | `pro-btn-secondary h-10 !px-3 !text-[11px] !font-medium` | `pro-btn-secondary` | calls `resetAll()` |
| Verify integrity btn | `pro-btn-secondary !h-9 !px-3 !text-[11px] !font-semibold !border-[#00F0FF]/40 !bg-[#00F0FF]/10 !text-[#00F0FF] …` | `pro-btn-secondary` (cyan override) | static |
| Restore now btn | `pro-btn-primary h-10 w-full !text-[11px] !font-bold !bg-gradient-to-r !from-[#FF5E00] !to-[#FFB300]` | `pro-btn-primary` (gradient override) | static |
| View Dashboard btn | `pro-btn-secondary h-10 w-full !text-[11px] !font-semibold !border-[#00FF9D]/40 !bg-[#00FF9D]/10 !text-[#00FF9D] …` | `pro-btn-secondary` (emerald override) | static |
| Restore drop zone | `pro-empty group w-full !rounded-2xl !p-8 hover:!border-[#00F0FF]/40 hover:!bg-[#00F0FF]/[0.03]` | `pro-empty` (cyan hover override) | static |
| Recent-backup row | `pro-list-row group !gap-2.5` | `pro-list-row` | `RECENT_BACKUPS: {name, date, size}[]` |
| Recent-backup icon | `flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#B388FF]/10 text-[#B388FF]` | (custom mini-icon, not pro-avatar) | static |
| History device frame | `pro-card-elevated overflow-hidden rounded-2xl !rounded-2xl` | `pro-card-elevated` | n/a |
| History table | `overflow-x-auto tutoros-scroll` + `<table>` | (no pro-* — semantic table) | `HISTORY_ROWS` |
| History scope pill | `pro-status-pill border-white/15 bg-white/[0.04] !text-white/70` | `pro-status-pill` (neutral override) | `r.scope` |
| History status pill | `pro-status-pill ${sa.border} ${sa.bg.replace("/10","/15")} ${sa.text}` | `pro-status-pill` | `r.status` |

**Mock data:**

```ts
type Scope = "full" | "ledger" | "snapshot";
type Strength = "none" | "weak" | "fair" | "strong" | "excellent";

const SCOPES: { id: Scope; label: string; desc: string; size: string; accent: Accent }[] = [
  { id: "full",     label: "Full backup",          desc: "All students, ledger, attendance, settings, audit log.", size: "≈ 2.4 MB", accent: "emerald" },
  { id: "ledger",   label: "Ledger only",          desc: "Just the immutable ledger + receipts.",                   size: "≈ 180 KB", accent: "cyan" },
  { id: "snapshot", label: "Snapshot (read-only)", desc: "A point-in-time view, no restore.",                       size: "≈ 1.1 MB", accent: "violet" },
];

const DEMO_PASSWORD = "demo1234";
const MOCK_RESTORE_FILE = { name: "tutoros-backup-2024-11-15-1430.tutoros", size: "2.4 MB" };

const RECENT_BACKUPS = [
  { name: "tutoros-backup-2024-11-14-1830.tutoros", date: "Yesterday, 18:30", size: "2.4 MB" },
  { name: "tutoros-backup-2024-11-13-0630.tutoros", date: "13 Nov, 06:30",    size: "2.3 MB" },
  { name: "tutoros-backup-2024-11-12-0630.tutoros", date: "12 Nov, 06:30",    size: "2.3 MB" },
];

const HISTORY_ROWS = [
  { date: "15 Nov, 14:30", file: "tutoros-backup-2024-11-15-1430.tutoros", size: "2.4 MB", scope: "Full",     status: "Completed"   },
  { date: "14 Nov, 18:30", file: "tutoros-backup-2024-11-14-1830.tutoros", size: "2.4 MB", scope: "Full",     status: "Completed"   },
  { date: "13 Nov, 21:14", file: "tutoros-backup-2024-11-13-2114.tutoros", size: "1.1 MB", scope: "Snapshot", status: "Interrupted" },
];

const CREATE_PHASES = [
  { from: 0,  to: 25,  label: "Snapshotting database" },
  { from: 25, to: 55,  label: "Serializing to NDJSON" },
  { from: 55, to: 85,  label: "Deriving key (Argon2id)" },
  { from: 85, to: 101, label: "Encrypting (AES-256-GCM)" },
];
```

**`pro-*` Utility Inventory:**

| Utility | Count | Replaces |
|---|---|---|
| `pro-card-elevated` | 3 | create frame + restore frame + history frame |
| `pro-status-pill` | ~10 | CREATE / RESTORE header pills + history scope pills (5) + history status pills (5) |
| `pro-empty` | 1 | restore drop zone |
| `pro-list-row` | 3 | recent-backup rows |
| `pro-btn-primary` | 4 | Create backup / Download / Restore now / Restore (in verify state) |
| `pro-btn-secondary` | ~8 | Continue/Back ×2 wizards + Create-another + View Dashboard + Verify integrity + Recent-backup refresh buttons |

Source: `src/components/tutoros/backup-prototype.tsx:1-811`.

---

### 23.7 The Shared Canon Summary

The 6 prototypes share the same **canonical seed dataset** — opening them on `/` should render the same 8 students, the same KPI figures (₹1,24,500 collected · ₹38,200 due · ₹9,400 overdue · ₹6,500 advance), the same 4 batches, the same recent-backup list, and the same Priya Sharma tutor profile. Any agent porting these screens to mobile or desktop **must use these exact seed values** in their prototype stories so the visual-regression baseline (`21_Automation_Testing.md` §5) recognises them.

| Canonical datum | Value | Where it lives |
|---|---|---|
| Tutor persona | Priya Sharma · +91 98765 43210 · Priya's Maths Academy | `settings-prototype.tsx:63-65` |
| Active student count | 47 (diagnostics), 8 (roster sample) | `settings-prototype.tsx:377` + `students-prototype.tsx:55-64` |
| November collection | ₹ 1,24,500 (integer paise = 124500) | `dashboard-prototype.tsx:27`, `fees-ledger-prototype.tsx:99` |
| Due till date | ₹ 38,200 | `dashboard-prototype.tsx:36`, `fees-ledger-prototype.tsx:100` |
| Overdue | ₹ 9,400 | `dashboard-prototype.tsx:54`, `fees-ledger-prototype.tsx:101` |
| Advance held | ₹ 6,500 | `fees-ledger-prototype.tsx:102` |
| Student code format | `TUT-NNNN` (zero-padded 4-digit) | `students-prototype.tsx:56-63` |
| Receipt format | `RC-NNNNNN` (zero-padded 6-digit) | `students-prototype.tsx:84`, `fees-ledger-prototype.tsx:68` |
| Backup file format | `tutoros-backup-YYYY-MM-DD-HHMM.tutoros` | `backup-prototype.tsx:84-88` |
| Ledger integrity | ✓ Hash chain valid (1,247 entries) | `settings-prototype.tsx:375` |
| DB size | 4.2 MB | `settings-prototype.tsx:373` |
| Schema version | 7 (PRAGMA user_version) | `settings-prototype.tsx:374` |
| Demo restore password | `demo1234` | `backup-prototype.tsx:35` |
| Encryption | AES-256-GCM + Argon2id (64 MB · 3 iterations) | `backup-prototype.tsx:401-402` |

> **Cross-platform porting rule:** every platform's prototype story (web `/`, Expo storybook, Tauri dev window) opens to a screen seeded with these values. The visual-regression baseline encodes THIS seed; changing it requires a baseline update.

---

## 24. Cross-Platform Tailwind Uniformity (web + Expo + Tauri)

> A tutor sees the **same screen on web, mobile, and desktop** — only the chrome differs. This section encodes how a single Tailwind v4 design system (the §2 tokens + the §20 `pro-*` utilities) is shared verbatim across all three platforms, grounded in `research_R-TAILWIND-CROSSPLATFORM.md`. Anything beyond that research file is marked UNVERIFIED.
>
> **The rule:** a `pro-card` className string on web = the same `pro-card` string on mobile (NativeWind v5) = the same `pro-card` string on desktop (Tauri). One className, three runtimes, one rendered surface. The only deliberate divergences are the device-frame chrome (web/desktop only — mobile is full-screen) and the blur primitive (web/desktop = CSS `backdrop-filter`; mobile = `expo-blur`).

### 24.1 The Shared Design-System Package — `packages/design-system/`

Adopt a Turborepo monorepo with a `packages/design-system/` package that holds the **single source of truth** for tokens, `pro-*` utilities, and TypeScript exports. Each app (web/mobile/desktop) imports `@buddysaradhi/design-system/css/globals.css` once and gets identical utilities everywhere. This pattern is the canonical 2025 topology — confirmed by Turborepo's Tailwind guide ([turborepo.dev/docs/guides/tools/tailwind](https://turborepo.dev/docs/guides/tools/tailwind)), the SO Q "How to enable Tailwind CSS v4.0 for the packages/ui components in turborepo" ([stackoverflow.com/q/79416157](https://stackoverflow.com/questions/79416157/how-to-enable-tailwind-css-v4-0-for-the-packages-ui-components-in-turborepo)), the dev.to "Managing Tailwind CSS in Turborepo Packages" guide ([dev.to/ippatev/managing-tailwind-css-in-turborepo-packages-4j34](https://dev.to/ippatev/managing-tailwind-css-in-turborepo-packages-4j34)), NativeWind's monorepo guide ([nativewind.dev/v5/guides/using-with-monorepos](https://www.nativewind.dev/v5/guides/using-with-monorepos)), and the "Universal React Monorepo Template: Next.js 15 + Expo + Tauri" Reddit thread ([reddit.com/r/reactnative/comments/1n986vg](https://www.reddit.com/r/reactnative/comments/1n986vg/built_a_universal_react_monorepo_template_nextjs)) — see research Q3.

**Three layers:**

```
packages/design-system/
├── tokens/
│   └── tokens.json                 ← Style Dictionary source of truth
│                                     8 palettes × 11 shades + 5 accents × 11 shades
│                                     + semantic tokens (text-*, surface-*, border-*)
├── css/
│   ├── tokens.css                  ← Style Dictionary output, wrapped in @theme { … }
│                                     generates --color-* CSS vars AND bg-*/text-*/border-* utilities
│   ├── pro.css                     ← the EXACT pro-* @utility blocks from src/app/globals.css lines 1060-1234
│                                     (pro-card, pro-card-elevated, pro-kpi, pro-btn-primary/secondary/ghost,
│                                      pro-tab-strip, pro-tab, pro-status-pill, pro-avatar,
│                                      pro-list-row, pro-empty, pro-divider, pro-section-*,
│                                      pro-sticky-footer-*, tutoros-cosmic-bg-pro)
│   └── globals.css                 ← entry: @import "tailwindcss";
│                                     @import "./tokens.css";
│                                     @import "./pro.css";
│                                     :root { … } (default CSS var values)
├── index.ts                        ← TypeScript-typed token exports for non-CSS consumers
│                                     (RN PlatformColor, Tauri Rust-side via FFI)
├── package.json                    ← { "name": "@buddysaradhi/design-system",
│                                     "exports": { "./css/globals.css": "./css/globals.css",
│                                                  ".": "./index.ts" } }
└── README.md                       ← how to consume from each app
```

**Why three layers (research Q3 (1) + (2)):**

1. **`tokens/tokens.json`** — Style Dictionary source of truth ([styledictionary.com/getting-started/examples](https://styledictionary.com/getting-started/examples)). Industry-standard token transformer (JSON → CSS/iOS/Android/JS). Integrates with Tailwind v4 by generating the `@theme` block (see Drew Minns' "Tailwind v4 and Style Dictionary Together" — [linkedin.com/posts/drew-minns_tailwind-v4-and-style-dictionary-together-activity-7346563973485326336-Qnqe](https://www.linkedin.com/posts/drew-minns_tailwind-v4-and-style-dictionary-together-activity-7346563973485326336-Qnqe); Nicola Lazzari's "Integrating design tokens with Tailwind CSS" — [nicolalazzari.ai/articles/integrating-design-tokens-with-tailwind-css](https://nicolalazzari.ai/articles/integrating-design-tokens-with-tailwind-css); the dev.to Style Dictionary transform recipe — [dev.to/philw_/using-style-dictionary-to-transform-tailwind-config-into-scss-variables-css-custom-properties-and-javascript-via-design-tokens-24h5](https://dev.to/philw_/using-style-dictionary-to-transform-tailwind-config-into-scss-variables-css-custom-properties-and-javascript-via-design-tokens-24h5)).
2. **`css/`** — generated + hand-authored CSS, all Tailwind v4 syntax. `tokens.css` (Style Dictionary output, wrapped in `@theme { … }` — generates `--color-*` CSS vars AND `bg-*`/`text-*`/`border-*` utilities). `pro.css` (the EXACT `pro-*` utilities from `src/app/globals.css` lines 1060–1234, authored as `@utility pro-card { … }` blocks). `globals.css` (entry: `@import "tailwindcss"; @import "./tokens.css"; @import "./pro.css"; :root { … }`). NativeWind v5's Dynamic Themes doc directs: "define the variables in both `@theme` (so Tailwind generates the utility classes) and `:root` (so the CSS variables have default values)" ([nativewind.dev/v5/guides/themes](https://www.nativewind.dev/v5/guides/themes)).
3. **`index.ts`** — TypeScript-typed token exports for non-CSS consumers (RN `PlatformColor`, Tauri Rust-side).

**Per-app consumption (research Q3 (2)):**

```css
/* apps/web/src/app/globals.css  (Next.js 16) */
@import "@buddysaradhi/design-system/css/globals.css";
@import "tw-animate-css";
/* … any web-only overrides (e.g. body background) … */

/* apps/mobile/global.css  (Expo SDK 52) — same import */
@import "@buddysaradhi/design-system/css/globals.css";

/* apps/desktop/src/globals.css  (Tauri v2 + Vite) — same import */
@import "@buddysaradhi/design-system/css/globals.css";
```

> **Avoid** vanilla-extract (web-only, no RN support — [bit.dev/blog/creating-a-cross-platform-design-system-for-react-and-react-native-with-bit-l7i3qgmw](https://bit.dev/blog/creating-a-cross-platform-design-system-for-react-and-react-native-with-bit-l7i3qgmw)). **Avoid** per-app `tailwind.config.js` — Tailwind v4 deprecated the JS config; the CSS file *is* the config.

**Risks (research Q3 (3)):**

- Style Dictionary's Tailwind v4 integration is community-recipe-driven (no official plugin); maintain a small transform script.
- Single-source means a token bug propagates to all three platforms simultaneously — invest in snapshot tests.
- Tauri Rust-side cannot consume CSS variables directly; if Rust code needs brand colors (tray icon, native theming), Style Dictionary must emit a Rust output target too.

### 24.2 Web (Next.js 16) — the Reference Implementation

The web app is already on Tailwind 4 (see `src/app/globals.css:1` `@import "tailwindcss";`). It consumes `packages/design-system/css/*` via the app's `globals.css` `@import` (§24.1). **No change to existing `pro-*` utilities** — the `@utility pro-card { … }` blocks move verbatim from `src/app/globals.css` lines 1073–1227 into `packages/design-system/css/pro.css`, and the web `globals.css` re-imports them. The visual output is identical (the visual-regression baseline `21_Automation_Testing.md` §5 still passes).

The `/` route (`src/app/page.tsx` + the 6 prototypes in `src/components/tutoros/`) is the **reference implementation** of the design system on web. Every screen spec, every platform port, every commercial-surface component is verified against it. When in doubt about how a token or `pro-*` utility renders on web, open `/` and inspect.

**Build pipeline (research Q2 (f)):** Next.js 16 uses `@tailwindcss/postcss` in `postcss.config.mjs`. The `pro-*` `@utility` blocks compile to standard CSS utilities at build time; Framer Motion handles runtime animation (§7). No LightningCSS configuration needed on web — modern Chromium/Safari/Firefox all satisfy the Tailwind 4 baseline natively.

### 24.3 Mobile (Expo SDK 52 / RN 0.76) — NativeWind v5

**The critical fork (research Q1 (1)(a)):** NativeWind is split across two majors that target *different Tailwind majors*. **v4.x** peer-depends on `tailwindcss ^3.3.0` — does **not** support Tailwind 4. Confirmed in GH issue #1354 where contributor Zack Sheppard notes "As NativeWind does not support Tailwind v4 today…" ([github.com/nativewind/nativewind/issues/1354](https://github.com/nativewind/nativewind/issues/1354)). **v5** supports Tailwind v4 ("Nativewind v5 uses Tailwind CSS v4, which introduces a CSS-first configuration approach" — [nativewind.dev/v5/core-concepts/tailwindcss](https://www.nativewind.dev/v5/core-concepts/tailwindcss)) using v4's new directives (`@import`, `@theme`, `@utility`, `@custom-variant`, `@source`).

> **CRITICAL CAVEAT:** every page on the v5 docs carries the banner *"This is a pre-release version of Nativewind. It is not intended for production use."* (visible at [nativewind.dev/v5/getting-started/installation](https://www.nativewind.dev/v5/getting-started/installation)). The package ships as `nativewind@preview`. v5 architecture: "a thin wrapper around `react-native-css`" ([nativewind.dev/v5/guides/migrate-from-v4](https://www.nativewind.dev/v5/guides/migrate-from-v4)) — `react-native-css` was renamed and moved to a peer dep.

**Recommendation (research Q1 (2)):** Pair NativeWind v5 (`nativewind@preview`) with Tailwind CSS v4. This is the *only* NativeWind version that lets the project share its existing Tailwind-4 `globals.css` and `pro-*` utilities with mobile. Pairing NativeWind v4 + Tailwind 3 on mobile while web uses Tailwind 4 would bifurcate the design system — opposite of the project's goal. Accept the v5 pre-release banner risk in exchange for token/utility parity; **pin `nativewind@5.0.0-preview.<latest>` exactly (not `^`)** — version fragility is real (e.g. "4.2.0 breaks Expo 53 #1574" — [github.com/nativewind/nativewind/issues/1574](https://github.com/nativewind/nativewind/issues/1574)).

**Expo SDK 52 install (research Q1 (1)(g)):** Per [nativewind.dev/v5/getting-started/installation](https://www.nativewind.dev/v5/getting-started/installation) + [/v5/guides/migrate-from-v4](https://www.nativewind.dev/v5/guides/migrate-from-v4):

```bash
# 1. install runtime deps
npx expo install nativewind@preview react-native-css@latest \
  react-native-reanimated react-native-safe-area-context
# 2. install dev deps
npx expo install --dev tailwindcss @tailwindcss/postcss postcss
# 3. postcss.config.mjs → { plugins: { "@tailwindcss/postcss": {} } }
# 4. wrap metro with withNativewind
#    metro.config.js: withNativewind(getDefaultConfig(__dirname), { input: "./global.css" })
# 5. remove nativewind/preset from babel.config.js (v5 doesn't need it)
# 6. override the lightningcss version (migration step 6 — known Expo transitive conflict)
# 7. npx expo start --clear
```

The Expo SDK 52 / RN 0.76 combination is confirmed working — see the "Migrating a production Web app to Expo SDK 52 + NativeWind v4" Reddit case study ([reddit.com/r/reactnative/comments/1r4x44n](https://www.reddit.com/r/reactnative/comments/1r4x44n)) and the dev.to v52+ setup guide ([dev.to/aramoh3ni/taming-the-beast-a-foolproof-nativewind-react-native-setup-v52-2025-4dd8](https://dev.to/aramoh3ni/taming-the-beast-a-foolproof-nativewind-react-native-setup-v52-2025-4dd8)).

**Compile-time vs runtime mapping (research Q1 (1)(c)):** Two phases. **Build-time:** PostCSS (`@tailwindcss/postcss`) compiles `globals.css` (`@theme`, `@utility`, `@custom-variant`) into CSS; the `withNativewind` metro wrapper transforms that CSS into a JS form RN consumes ([nativewind.dev/v5/getting-started/installation](https://www.nativewind.dev/v5/getting-started/installation)). **Runtime:** `react-native-css` interprets dynamic/arbitrary/variant classes via RN StyleSheet. Third-party components without a `className` prop are bridged via `cssInterop` / `remapProps` ([nativewind.dev/v5/api/css-interop](https://www.nativewind.dev/v5/api/css-interop)).

**Sharing the project's `pro-*` utilities (research Q1 (1)(d)):** Tailwind v4 lets you define custom utilities via `@utility` in CSS; NativeWind v5 honours these because it consumes the same Tailwind v4 source ([nativewind.dev/v5/core-concepts/tailwindcss](https://www.nativewind.dev/v5/core-concepts/tailwindcss)). CSS variables in `@theme` are honoured on RN — v4 already shipped CSS-variable support; v5 extends it to the full `@theme` system. **Conclusion: `pro-*` utilities can be shared verbatim between web and mobile via a single `globals.css`** — provided each utility only uses CSS features RN can express (see the 5 caveats below).

**The 5 mobile caveats (research Q1 (1)(f) + Q4 (1)(c) + Q4 (1)(d)):**

| # | Caveat | Mitigation |
|---|---|---|
| (a) | **No real `backdrop-filter` on RN.** RN has no native `backdrop-filter`. Expo `BlurView` blurs underneath but **iOS only** natively; Android falls back to a semi-transparent overlay ([docs.expo.dev/versions/latest/sdk/blur-view](https://docs.expo.dev/versions/latest/sdk/blur-view)). Android options: `react-native-blur` (iOS+Android, adds progressive blur and liquidGlass — [github.com/sbaiahmed1/react-native-blur](https://github.com/sbaiahmed1/react-native-blur)), `@react-native-community/blur`, or `@shopify/react-native-skia` for per-pixel blur ([shopify.github.io/react-native-skia/docs/backdrops-filters](https://shopify.github.io/react-native-skia/docs/backdrops-filters)). None are className-based. | Replace `<View className="pro-card backdrop-blur-xl">` with `<BlurView className="pro-card" intensity={20} tint="dark">` — the `pro-card` className still applies border/shadow/rounded; blur is rendered by the native component. See §24.5 (3) — the `<Glass>` abstraction. |
| (b) | **Dark mode.** `dark:` follows device system preference by default — "No additional configuration is needed" ([nativewind.dev/v5/core-concepts/dark-mode](https://www.nativewind.dev/v5/core-concepts/dark-mode)). Programmatic override via `useColorScheme()` hook wrapping RN's `Appearance` API ([nativewind.dev/docs/api/use-color-scheme](https://www.nativewind.dev/docs/api/use-color-scheme)). | The project is **dark-only** (§12) — no toggle needed; NativeWind's default system-preference behaviour is correct. Known bug #1626: NativeWind's wrapper may lag the RN-native `useColorScheme()` on system theme changes ([github.com/nativewind/nativewind/issues/1626](https://github.com/nativewind/nativewind/issues/1626)) — UNVERIFIED fix status; if a user reports theme fl...
| (c) | **Breakpoints.** NativeWind v5's responsive variants work on native by using media queries based on **window width** ([nativewind.dev/v5/core-concepts/responsive-design](https://www.nativewind.dev/v5/core-concepts/responsive-design)). Critical: NativeWind's default breakpoints (`sm=640px`, `md=768px`, `lg=1024px`) were "mostly designed for web" ([nativewind.dev/docs/core-concepts/responsive-design](https://www.nativewind.dev/docs/core-concepts/responsive-design); issue #1078 [github.com/nativewind/nativewind/issues/1078](https://github.com/nativewind/nativewind/issues/1078)). Most phones have window width < 640px, so `sm:` never triggers on a phone. | Override breakpoints in `@theme { --breakpoint-sm: 380px; --breakpoint-md: 768px; --breakpoint-lg: 1024px; … }` so `sm:` means "phablet / small tablet". For binary phone/tablet switches, use RN's `useWindowDimensions()` directly. |
| (d) | **`min-h-screen` → `<SafeAreaView>`.** NativeWind maps `min-h-screen` to RN's `minHeight` semantics, but the canonical RN pattern is `<SafeAreaView style={{ flex: 1 }}>` from `react-native-safe-area-context` wrapping a flex column, with `<SafeAreaView edges={['bottom']}>` on the footer ([blog.mrinalmaheshwari.com/react-native-safeareaview-deprecated-safe-migration-guide-b9255d63edbe](https://blog.mrinalmaheshwari.com/react-native-safeareaview-deprecated-safe-migration-guide-b9255d63edbe)). NativeWind v5 ships built-in `pt-safe` and `pb-safe` utilities for safe-area insets ([nativewind.dev/v5/tailwind/new-concepts/safe-area-insets](https://www.nativewind.dev/v5/tailwind/new-concepts/safe-area-insets)). | The shared className `"flex-1 flex flex-col"` works on all three platforms; only the outer wrapper differs (`<body>` on web/desktop, `<SafeAreaView>` on mobile). See §24.5 (4) — the `<AppShell>` abstraction. |
| (e) | **Sticky-footer mandate (§13) becomes `<AppShell>`.** The web rule `min-h-screen flex flex-col` + `mt-auto flex-shrink-0` footer cannot be expressed via className alone on RN (no real DOM, `vh` unit doesn't exist). `min-h-screen` on RN does not always equal "device height" if a soft keyboard is open — the footer may be pushed above the keyboard. | Write an `<AppShell>` that renders `<div className="min-h-screen flex flex-col">` on web/desktop and `<SafeAreaView className="flex-1 flex flex-col">` on mobile, footer receiving `pb-safe` on mobile and `pb-6` on web. For text-input screens, wrap in `KeyboardAvoidingView`. See §24.5 (4). |

### 24.4 Desktop (Tauri v2)

**Tauri v2 webview matrix (research Q2 (1)(a)):** Tauri v2 uses the system webview: **WebView2 (Chromium) on Windows**, **WKWebView (WebKit) on macOS**, **WebKitGTK 2.42+ (API 4.1) on Linux** ([v2.tauri.app/blog/tauri-2-0-0-alpha-3](https://v2.tauri.app/blog/tauri-2-0-0-alpha-3) — "You will need to install the new WebKit2GTK package with API version 4.1"; [servo.org/blog/2023/10/26/css-filters-testing-tauri](https://servo.org/blog/2023/10/26/css-filters-testing-tauri) corroborates).

**Tailwind v4 browser baseline (research Q2 (1)(b)):** Per [tailwindcss.com/docs/compatibility](https://tailwindcss.com/docs/compatibility): "the core functionality of the framework specifically depends on these browser versions: **Chrome 111 (March 2023), Safari 16.4 (March 2023), Firefox 128 (July 2024)**." Mapping: WebView2 (Chromium 130+) ✅; WKWebView macOS (Safari 16.4 = macOS Ventura 13.3+) ✅; WebKitGTK ≥ 2.42 (Sep 2023, Safari 16.4-equivalent) ✅. ⚠️ Older LTS distros (Debian 11 ships 2.38, Ubuntu 22.04 ships 2.36) — UNVERIFIED for `oklch()` and CSS nesting.

**`oklch()` colors — the Tailwind v4 risk (research Q2 (1)(c)):** Tailwind v4 ships OKLCH by default; issue #16351 reports "global penetration of supporting browsers is just short of 93%. In some countries, this falls to as low as 70%" ([github.com/tailwindlabs/tailwindcss/issues/16351](https://github.com/tailwindlabs/tailwindcss/issues/16351), CLOSED/COMPLETED) — Tailwind decided *not* to ship automatic fallbacks; users must configure LightningCSS browser targets to downlevel OKLCH → sRGB. Per caniwebview ([caniwebview.com/features/mdn-css-type-color-oklch](https://caniwebview.com/features/mdn-css-type-color-oklch)): WKWebView macOS ✅, iOS 15.4+, Android WebView 111+, WebView2 ✅, WPE/Linux 2026-07. WebKitGTK shares the WebKit engine — UNVERIFIED for older WebKitGTK < 2.42.

**`backdrop-filter` & CSS nesting (research Q2 (1)(d)):** `backdrop-filter` is Baseline since September 2024 ([caniuse.com/?search=-webkit-backdrop-filter](https://caniuse.com/?search=-webkit-backdrop-filter)) — works in WebView2 and WKWebView. Known lightningcss bug #695 ([github.com/parcel-bundler/lightningcss/issues/695](https://github.com/parcel-bundler/lightningcss/issues/695)) can emit only the `-webkit-` prefix; author both prefixed and unprefixed, or set lightningcss targets. CSS nesting is supported in Safari 16.4+, Chrome 112+ — safe in all three webviews.

**Single Tailwind build vs separate (research Q2 (1)(e)):** SO Q "Integrating shadcn/ui with Tailwind CSS v4 in a Tauri Application Using Vite and React" ([stackoverflow.com/q/79423511](https://stackoverflow.com/questions/79423511/integrating-shadcn-ui-with-tailwind-css-v4-in-a-tauri-application-using-vite-and)) — viewed 3k times, confirms the combination works with some friction. Tauri GH issue #11710 (closed, [github.com/tauri-apps/tauri/issues/11710](https://github.com/tauri-apps/tauri/issues/11710)) was actually a SvelteKit virtual-CSS-module interaction with `@tailwindcss/vite` + lightningcss — *not* a Tauri bug, doesn't affect React+Vite+Tauri. **Share the EXACT same `globals.css` between Next.js and Tauri** — Tailwind v4's CSS-first config means the CSS file *is* the config; no per-app `tailwind.config.js` divergence.

**Tauri + Vite + Tailwind 4 setup (research Q2 (1)(f)):** Use `@tailwindcss/vite` (preferred for Vite, [tailwindcss.com/docs](https://tailwindcss.com/docs)) in `vite.config.ts`; `@import "tailwindcss";` and `@theme { … }` at the top of `src/globals.css`; import that CSS once in `main.tsx`. `tauri.conf.json` `frontendDist` → Vite's `dist/`, `devUrl` → `http://localhost:1420` (standard scaffold).

**LightningCSS targets (research Q2 (2)) — set explicitly:**

```ts
// apps/desktop/vite.config.ts
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  css: {
    transformer: "lightningcss",
    lightningcss: {
      targets: {
        // Tailwind v4 baseline (research Q2 (1)(b)) — downlevels oklch → sRGB
        // for older Linux WebKitGTK < 2.42 (sidesteps the 7% issue, GH #16351)
        chrome: 111, safari: 16.4, firefox: 128,
      },
    },
  },
});
```

**Native window chrome (research Q2 (1)(g)):** Per [v2.tauri.app/learn/window-customization](https://v2.tauri.app/learn/window-customization): "You can create custom titlebars, have transparent windows, enforce size constraints." Recipe: `decorations: false` in `tauri.conf.json` + custom HTML/CSS titlebar. For platform-polished overlays (macOS traffic lights, Windows 11 Snap Layout) use **`tauri-plugin-decorum`** ([crates.io/crates/tauri-plugin-decorum](https://crates.io/crates/tauri-plugin-decorum)) or **`tauri-plugin-decoration`** ([lib.rs/crates/tauri-plugin-decoration](https://lib.rs/crates/tauri-plugin-decoration)). On Linux there is "no transparent native titlebar — most apps hide the native titlebar (`.decorations(false)`) and draw their own" ([github.com/orgs/tauri-apps/discussions/8387](https://github.com/orgs/tauri-apps/discussions/8387)). The project's existing glassmorphic chrome (the `pro-card-elevated` device-frame top bar in §23.1–§23.6) becomes the custom titlebar — making desktop visually identical to web. Reserve the 28px left safe-area on macOS for traffic lights.

**Risks (research Q2 (3)):**

- **OKLCH on older Linux WebKitGTK** (< 2.42) — silent color failure on Debian 11 / Ubuntu 22.04 LTS. LightningCSS targets mitigate if set explicitly (see config above).
- **`prefers-color-scheme` broken on Linux Tauri** — issue #9427 ([github.com/tauri-apps/tauri/issues/9427](https://github.com/tauri-apps/tauri/issues/9427)). UNVERIFIED fix status. Mitigation: read theme via Tauri Rust API and inject a class on `<html>` (irrelevant for this project — §12 dark-only doctrine means there is no light theme to switch to).
- **lightningcss `-webkit-`-only emission for `backdrop-filter`** (#695) — author both prefixed and unprefixed. The §20 `pro-*` utilities already author both: see `globals.css:1077-1078` (`.pro-card { backdrop-filter: blur(20px) saturate(150%); -webkit-backdrop-filter: blur(20px) saturate(150%); }`).
- **`@tailwindcss/vite` + SvelteKit virtual CSS** has an unresolved interaction (#11710) — irrelevant for React/Next.js.
- Custom titlebar requires `data-tauri-drag-region` on the drag surface; Tailwind handles this fine.

### 24.5 The Component Uniformity Stack — 4 Layers

Adopt a four-layer uniformity stack (research Q4 (2)) so that the same `pro-*` className string produces visually identical UI on web, desktop, and mobile:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: Shared className strings                                                       │
│   pro-card, pro-kpi, pro-btn-primary, pro-btn-secondary, pro-btn-ghost,                 │
│   pro-tab-strip, pro-tab, pro-status-pill, pro-avatar, pro-list-row, pro-empty,         │
│   pro-divider, pro-section-*, pro-sticky-footer-*, tutoros-cosmic-bg-pro                │
│   Authored as Tailwind v4 @utility blocks in packages/design-system/css/pro.css         │
│   Compiled for all three platforms from the same source.                                │
│   THE SAME className string renders identically on web, desktop, mobile.                │
└─────────────────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: React Native Reusables (mobile-only interactive components)                    │
│   https://reactnativereusables.com  ·  https://github.com/founded-labs/react-native-     │
│   reusables  ·  8.5k GH stars  ·  MIT  ·  "Bringing shadcn/ui to React Native.           │
│   Beautifully crafted components with Nativewind or Uniwind, open source, and           │
│   almost as easy to use."  Built on @rn-primitives (Radix-UI port to RN).               │
│   Drop-in for the web shadcn/ui usage; pair with @rn-primitives for headless parity.    │
│   For: Button, Dialog, DropdownMenu, Select, Tabs, Toast, Tooltip.                       │
└─────────────────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: Platform-specific glassmorphism — the <Glass> abstraction                      │
│   <Glass className="pro-card" intensity={20}>                                           │
│     web/desktop:  <div className={className + " backdrop-blur-xl"}>                     │
│     mobile iOS:    <BlurView className={className} intensity={intensity} tint="dark">   │
│     mobile Android: <BlurView className={className} intensity={intensity * 2}>          │
│                     (or react-native-blur / @shopify/react-native-skia)                 │
│   The pro-card className is SHARED; only the blur primitive swaps.                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ LAYER 4: <AppShell> — the sticky-footer layout mandate, cross-platform                  │
│   <AppShell footer={<Footer />}>                                                        │
│     web/desktop:  <div className="min-h-screen flex flex-col">{children}{footer}</div>  │
│     mobile:       <SafeAreaView className="flex-1 flex flex-col">                        │
│                       {children}<SafeAreaView edges={['bottom']}>{footer}</SafeAreaView> │
│                   </SafeAreaView>                                                        │
│   pb-safe on mobile, pb-6 on web. Handled by AppShell, NOT scattered conditionals.      │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

**Layer 1** (research Q4 (1)(a) option (iv) — RECOMMENDED): Author `pro-card`, `pro-kpi`, `pro-btn-primary`, etc. as Tailwind v4 `@utility` blocks in `packages/design-system/css/pro.css`. They compile for web (Next.js), desktop (Tauri/Vite), and mobile (NativeWind v5) from the same source. NativeWind's "Built on Tailwind CSS" doc confirms `@utility` directives are honoured ([nativewind.dev/v5/core-concepts/tailwindcss](https://www.nativewind.dev/v5/core-concepts/tailwindcss)). Caveat: any CSS feature RN can't express (real `backdrop-filter`, multi-stop `oklch()` gradients, complex `box-shadow` layers) needs a mobile-classname variant — handled by Layer 3.

**Layer 2** (research Q4 (1)(b)): React Native Reusables ([reactnativereusables.com](https://reactnativereusables.com), [github.com/founded-labs/react-native-reusables](https://github.com/founded-labs/react-native-reusables)) — 8.5k GitHub stars, MIT, "Bringing shadcn/ui to React Native. Beautifully crafted components with Nativewind or Uniwind, open source, and almost as easy to use." Built on `@rn-primitives` (Radix-UI port to RN — repo's pnpm-lock shows `@rn-primitives/*` v1.5.2). Topics: `react-native-web`, `expo`, `radix-ui`, `shadcn-ui`, `shadcn` — meaning the same components work on web and mobile with the same shadcn copy-paste philosophy.

**Layer 3** (research Q4 (2) + Q1 (1)(f)): Abstract blur into a `<Glass>` component. `<div className="pro-card backdrop-blur-xl">` on web/desktop, `<BlurView className="pro-card" intensity={20} tint="dark">` on iOS, `<BlurView className="pro-card" intensity={40}>` (or `react-native-blur`) on Android. The `pro-card` className is shared; only the blur primitive swaps. Add a lint rule (e.g. `no-raw-backdrop-blur`) so teams don't forget to use it.

**Layer 4** (research Q4 (2) + Q4 (1)(d)): Write an `<AppShell>` that renders `<div className="min-h-screen flex flex-col">` on web/desktop and `<SafeAreaView className="flex-1 flex flex-col">` on mobile, footer receiving `pb-safe` on mobile and `pb-6` on web — handled by the platform-aware `<AppShell>` rather than scattered conditional classes. This is the §13 sticky-footer mandate, encoded for all three platforms.

### 24.6 The Uniformity Contract (Non-Negotiable)

A tutor sees the SAME screen on web, mobile, desktop — only the chrome differs. The table below is the contract: for every UI element, the className on web = mobile = desktop unless the row explicitly notes a divergence.

| UI element | Web className | Mobile className (NativeWind v5) | Desktop className (Tauri v2) | Notes |
|---|---|---|---|---|
| App root bg | `tutoros-cosmic-bg-pro` | `tutoros-cosmic-bg-pro` (radial gradients honoured by RN — research Q1 (1)(d)) | `tutoros-cosmic-bg-pro` | Identical on all 3. The grid pattern (linear-gradient 1px lines) renders as expected on web/desktop; on RN, NativeWind maps to RN's background-image support. |
| Content card | `pro-card` | `pro-card` | `pro-card` | Identical. Blur falls back to `expo-blur` via `<Glass>` on mobile (Layer 3). |
| Elevated card / device frame | `pro-card-elevated` | (not rendered — mobile is full-screen, no device frame) | `pro-card-elevated` | **DIVERGENCE:** the device-frame chrome (the `pro-card-elevated` wrapper + the 3-dot title bar) is web/desktop only. On mobile, the screen IS the device — full-bleed, no frame. |
| KPI card | `pro-kpi` + `style={{ '--kpi-accent': a.hex }}` | `pro-kpi` + `style={{ '--kpi-accent': a.hex }}` | `pro-kpi` + `style={{ '--kpi-accent': a.hex }}` | Identical. The 3px `::before` accent bar renders on all 3 — NativeWind honours `::before` via the `@utility` block. |
| Primary CTA | `pro-btn-primary` | `pro-btn-primary` | `pro-btn-primary` | Identical. The emerald→cyan gradient + glow renders on all 3. |
| Secondary button | `pro-btn-secondary` (+ accent override §20.4) | `pro-btn-secondary` (+ accent override) | `pro-btn-secondary` (+ accent override) | Identical. |
| Ghost button / text link | `pro-btn-ghost` | `pro-btn-ghost` | `pro-btn-ghost` | Identical. |
| Tab strip | `pro-tab-strip` + `pro-tab[data-active]` | `pro-tab-strip` + `pro-tab[data-active]` | `pro-tab-strip` + `pro-tab[data-active]` | Identical. The emerald→cyan gradient pill on active renders on all 3. |
| Status pill | `pro-status-pill` + accent border/bg/text | `pro-status-pill` + accent border/bg/text | `pro-status-pill` + accent border/bg/text | Identical. |
| Avatar | `pro-avatar h-N w-N bg-gradient-to-br from-{a} to-{b}` | `pro-avatar h-N w-N bg-gradient-to-br from-{a} to-{b}` | `pro-avatar h-N w-N bg-gradient-to-br from-{a} to-{b}` | Identical. |
| List row | `pro-list-row` | `pro-list-row` | `pro-list-row` | Identical. |
| Empty state | `pro-empty` | `pro-empty` | `pro-empty` | Identical. |
| Sticky-footer shell | `pro-sticky-footer-shell` + `pro-sticky-footer-content` + `pro-sticky-footer` | `<AppShell>` (renders `<SafeAreaView className="flex-1 flex flex-col">` + `pb-safe` on footer) | `pro-sticky-footer-shell` + `pro-sticky-footer-content` + `pro-sticky-footer` | **DIVERGENCE:** mobile uses `<AppShell>` (Layer 4) because `min-h-screen` ≠ device height on RN when soft keyboard is open. |
| Backdrop blur (glass) | CSS `backdrop-filter: blur(20px)` (authored in `pro-card` `@utility`) | `expo-blur` `<BlurView>` via `<Glass>` abstraction (Layer 3) — `pro-card` className still applies border/shadow/rounded | CSS `backdrop-filter` (same as web) | **DIVERGENCE:** RN has no native `backdrop-filter` (research Q1 (1)(f)). |
| Section heading kit | `pro-section-eyebrow` + `pro-section-title` + `pro-section-sub` | (same) | (same) | Identical. |
| Divider | `pro-divider` | `pro-divider` | `pro-divider` | Identical. |
| PIN keypad button | `neumo-raised h-12 rounded-xl` | `neumo-raised h-12 rounded-xl` (NativeWind honours §6 neumo-* classes via `@utility`) | `neumo-raised h-12 rounded-xl` | Identical. Touch target ≥44px — `h-12` = 48px, satisfies WCAG 2.1 AA (§10.2). |
| Device-frame title bar (3 dots + URL) | rendered (chrome) | **NOT rendered** (mobile is full-screen) | rendered (chrome + `data-tauri-drag-region` for window drag) | **DIVERGENCE:** mobile omits the device frame entirely; desktop adds `data-tauri-drag-region` so the title bar is the window drag handle. |

> **The rule, restated:** open `/` (web), the Expo storybook (mobile), and the Tauri dev window (desktop) side-by-side. The Dashboard should look identical on all three — same KPI figures (₹1,24,500 · ₹38,200 · 47 · ₹9,400), same `pro-kpi` accent bars, same `pro-list-row` avatars, same `pro-tab-strip` emerald→cyan active pill. The only visible difference: web and desktop render the `pro-card-elevated` device frame around the screen; mobile renders full-bleed (the phone screen IS the frame). Anything else is a bug — file it.

### 24.7 Responsiveness

**Web / desktop (research Q4 (1)(c)):** Use Tailwind v4's default breakpoints (`sm: 640px`, `md: 768px`, `lg: 1024px`, `xl: 1280px`, `2xl: 1536px`). The 6 prototypes in §23 use `grid-cols-2 lg:grid-cols-4` for KPI strips, `lg:grid-cols-3` for content splits, `md:grid-cols-[300px_1fr]` for master-detail — these are the canonical responsive patterns. The 5-screen doctrine (P2 in `01_Product_Principles.md`) holds: no platform adds a 6th screen.

**Mobile (research Q4 (1)(c)):** Override NativeWind's web-defaults in `@theme`:

```css
@theme {
  --breakpoint-sm: 380px;   /* phablet / small tablet */
  --breakpoint-md: 768px;   /* tablet portrait */
  --breakpoint-lg: 1024px;  /* tablet landscape */
  --breakpoint-xl: 1280px;
  --breakpoint-2xl: 1536px;
}
```

Most phones have window width < 640px, so the default `sm:` never triggers on a phone — overriding `sm:` to 380px means `sm:` triggers on phablets / small tablets, which is what we want. For binary phone/tablet switches (e.g. master-detail collapses to single-pane on phone, splits on tablet), use RN's `useWindowDimensions()` directly. NativeWind breakpoints are window-width-based; rotating the device changes the breakpoint (usually desired, testable only on device — research Q4 (3)).

**The 2-tap rule (P3 in `01_Product_Principles.md`) holds on all 3 platforms.** Any student, any fee, any attendance day, any backup — reachable in ≤2 taps from the home screen. On mobile, the bottom-tab nav (Discord-flow inheritance, §1.1) replaces the desktop sidebar; the tap count stays ≤2.

**Touch targets ≥44px on mobile (§10.2, WCAG 2.1 AA).** The §23 prototypes already use `h-7 w-7` (28px) for compact icon buttons — these are fine for desktop/web pointer interaction. On mobile, bump to `h-11 w-11` (44px) via the `sm:` breakpoint (which triggers at 380px on mobile after the override above):

```tsx
<button className="pro-btn-secondary h-7 w-7 sm:h-11 sm:w-11 …">
```

**The 5-screen doctrine (P2) holds on all 3 platforms — no platform adds a 6th screen.** Dashboard, Students, Attendance, Fees & Payments, Settings — that's it. Backup is a flow inside Settings (§23.5 BackupPanel) and a top-level Settings sub-screen on desktop (where it deserves the larger canvas); on mobile it's a Settings panel. No 6th top-level screen.

### 24.8 Risks

| Risk | Severity | Mitigation | Source |
|---|---|---|---|
| **NativeWind v5 is pre-release** ("not for production use" as of Nov 2025 — banner on every v5 docs page). | High | Pin `nativewind@5.0.0-preview.<latest>` exactly (not `^`). Maintain a frozen fork in `packages/nativewind-fork/` if a regression breaks production. Track the v5 stable release. | research Q1 (3), [nativewind.dev/v5/getting-started/installation](https://www.nativewind.dev/v5/getting-started/installation) |
| **NativeWind version fragility** across SDK bumps (e.g. 4.2.0 broke Expo 53, #1574). | Medium | Pin SDK 52 + RN 0.76 exactly. Do not bump Expo SDK without re-running the full visual-regression baseline. | research Q1 (3), [github.com/nativewind/nativewind/issues/1574](https://github.com/nativewind/nativewind/issues/1574) |
| **OKLCH on older Linux WebKitGTK** (< 2.42) — silent color failure on Debian 11 / Ubuntu 22.04 LTS. | Medium | Set LightningCSS targets in `vite.config.ts` to `chrome 111, safari 16.4, firefox 128` — downlevels OKLCH → sRGB. | research Q2 (3), [github.com/tailwindlabs/tailwindcss/issues/16351](https://github.com/tailwindlabs/tailwindcss/issues/16351) |
| **No real `backdrop-filter` on RN Android.** `expo-blur` is iOS-only; `react-native-blur` or Skia required (adds native dep). | Medium | The `<Glass>` abstraction (§24.5 Layer 3) isolates the blur divergence. On Android, accept a semi-transparent overlay fallback (still readable, just not blurred) — the `pro-card` border + shadow + rounded corner still render. | research Q1 (3), [docs.expo.dev/versions/latest/sdk/blur-view](https://docs.expo.dev/versions/latest/sdk/blur-view) |
| **`react-native-reusables` is community-maintained** (founded-labs), not officially from shadcn — version drift vs shadcn/ui is possible. | Low-Medium | Pin to a specific tag; contribute upstream. Some shadcn components don't exist in RNR (e.g. Calendar, Combobox) — hand-port with the same `pro-*` className contract. | research Q4 (3), [github.com/founded-labs/react-native-reusables](https://github.com/founded-labs/react-native-reusables) |
| **`prefers-color-scheme` broken on Linux Tauri** (#9427, UNVERIFIED fix status). | Low (this project is dark-only, §12) | Read theme via Tauri Rust API and inject a class on `<html>`. Irrelevant in practice — the project has no light theme to switch to. | research Q2 (3), [github.com/tauri-apps/tauri/issues/9427](https://github.com/tauri-apps/tauri/issues/9427) |
| **`useColorScheme` from NativeWind may lag** the RN-native hook on system theme changes (#1626, UNVERIFIED fix status). | Low (dark-only) | Use the RN-native `useColorScheme()` directly if theme-reactivity is needed; NativeWind's wrapper is a convenience, not a requirement. | research Q1 (3), [github.com/nativewind/nativewind/issues/1626](https://github.com/nativewind/nativewind/issues/1626) |
| **`lightningcss -webkit-`-only emission for `backdrop-filter`** (#695). | Low | Author both prefixed and unprefixed. The §20 `pro-*` utilities already do this — see `globals.css:1077-1078`. | research Q2 (3), [github.com/parcel-bundler/lightningcss/issues/695](https://github.com/parcel-bundler/lightningcss/issues/695) |
| **Style Dictionary Tailwind v4 integration is community-recipe-driven** (no official plugin). | Low | Maintain a small transform script in `packages/design-system/scripts/transform-tokens.ts`. Snapshot-test the generated `tokens.css` so a transform regression is caught before it propagates to all 3 platforms. | research Q3 (3) |
| **Token bug propagates to all 3 platforms simultaneously.** | Medium (single-source risk) | Invest in snapshot tests. CI must run the visual-regression baseline (`21_Automation_Testing.md` §5) on all 3 platforms before a token PR merges. | research Q3 (3) |
| **NativeWind breakpoints are window-width-based** — rotating the device changes the breakpoint. | Low | Usually desired (tablet portrait ≠ landscape). Testable only on device. Document the rotation behaviour in the mobile test plan. | research Q4 (3) |
| **`min-h-screen` on RN ≠ device height when soft keyboard is open.** | Low | `<AppShell>` wraps text-input screens in `KeyboardAvoidingView`. The footer's `pb-safe` retracts when keyboard is visible. | research Q4 (3) |

**Net assessment:** the uniformity strategy is sound — the 4-layer stack (§24.5) isolates the 2 deliberate divergences (device-frame chrome + blur primitive) behind abstractions (`<Glass>`, `<AppShell>`), and the `pro-*` className contract (§24.6) is identical on all 3 platforms for everything else. The dominant risk is NativeWind v5's pre-release status; the mitigation is exact version pinning + a frozen fork escape hatch. The OKLCH-on-Linux risk is mitigated by LightningCSS targets. Everything else is low-severity and contained.

---

*End of §23 + §24. For the source of truth, open the 6 prototype components in `src/components/tutoros/` (§23) and `research_R-TAILWIND-CROSSPLATFORM.md` (§24). For the design tokens + `pro-*` utility definitions, open `src/app/globals.css` lines 1–200 (tokens) + 1060–1234 (pro-* layer). For the enforcement mechanism, see `21_Automation_Testing.md` §5 (visual-regression baseline).*
