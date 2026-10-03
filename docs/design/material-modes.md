# Material Modes — Minimal / Acrylic / Liquid Glass

**Status:** implementation-grade specification
**Scope:** `apps/web` (Next.js 16 + Tailwind 4), `apps/product-page`, and the same three modes mapped forward to NativeWind 5, Tauri (Windows/macOS/Linux), iOS/SwiftUI, and WinUI.
**Applies to:** the five-screen tuition-operations app (Dashboard, Students, Attendance, Fees & Payments, Settings) and the marketing site.
**Craft floor:** this file assumes `craft-floor.md`, `colorize.md`, and `animate.md` have been read. Nothing here overrides them; where they conflict, they win.

---

## 0. TL;DR — the 3-mode CSS token table

One set of semantic names. Three values each. **Only the surface/border/shadow rows change; text and accent rows are mode-invariant by law.**

| Token | `minimal` | `acrylic` | `liquid-glass` |
| --- | --- | --- | --- |
| `--mat-blur` | `0px` | `40px` | `48px` |
| `--mat-saturate` | `100%` | `125%` | `150%` |
| `--mat-brightness` | `100%` | `105%` | `108%` |
| `--mat-contrast` | `100%` | `105%` | `112%` |
| `--mat-tint` / `--mat-tint-alpha` | `#2C2C2C` / `0` | `#2C2C2C` / `0.15` | `#1C1A40` / `0.35` |
| `--surface-canvas` | `#0F0C29` | `#0F0C29` | `#0F0C29` |
| `--surface-raised` | `#181546` | `#181546` | `#16133F` |
| `--surface-inset` | `#0A0819` | `#0A0819` | `#090716` |
| `--surface-row` | `#120F33` | `#120F33` | `#100E2E` |
| `--surface-sunken` | `#07050F` | `#07050F` | `#07050F` |
| `--surface-overlay` *(translucent role)* | `#1D1A4F` | `color-mix(in srgb, #2C2C2C 15%, transparent)` | `color-mix(in srgb, #1C1A40 35%, transparent)` |
| `--surface-overlay-solid` *(paired fallback)* | `#1D1A4F` | `#2C2C2C` | `#1A1840` |
| `--surface-nav` / `--surface-nav-solid` | `#14123A` / `#14123A` | `color-mix(in srgb, #2C2C2C 15%, transparent)` / `#232326` | `color-mix(in srgb, #1C1A40 30%, transparent)` / `#181634` |
| `--surface-sheet` / `--surface-sheet-solid` | `#191647` / `#191647` | `color-mix(in srgb, #202020 60%, transparent)` / `#202020` | `color-mix(in srgb, #1C1A40 55%, transparent)` / `#16142F` |
| `--surface-palette` / `--surface-palette-solid` | `#1D1A4F` / `#1D1A4F` | `color-mix(in srgb, #2C2C2C 15%, transparent)` / `#2C2C2C` | `color-mix(in srgb, #1C1A40 40%, transparent)` / `#1A1840` |
| `--surface-scrim` | `rgb(0 0 0 / 0.56)` | `rgb(0 0 0 / 0.56)` | `rgb(0 0 0 / 0.60)` |
| `--border-default` | `rgb(255 255 255 / 0.14)` | `rgb(255 255 255 / 0.16)` | `rgb(255 255 255 / 0.22)` |
| `--border-strong` | `rgb(255 255 255 / 0.24)` | `rgb(255 255 255 / 0.28)` | `rgb(255 255 255 / 0.34)` |
| `--mat-specular` (inner hairline) | `none` | `inset 0 1px 0 rgb(255 255 255 / 0.06)` | `inset 0 1px 0 rgb(255 255 255 / 0.10), inset 0 -1px 0 rgb(0 0 0 / 0.20)` |
| `--mat-fresnel` (edge lens) | `none` | `none` | `linear-gradient(180deg, rgb(255 255 255 / 0.10) 0%, rgb(255 255 255 / 0) 42%)` |
| `--shadow-overlay` | `0 8px 16px rgb(0 0 0 / 0.24)` | `0 8px 28px rgb(0 0 0 / 0.40)` | `0 12px 40px rgb(0 0 0 / 0.50), 0 2px 8px rgb(0 0 0 / 0.30)` |
| `--shadow-sheet` | `0 32px 64px rgb(0 0 0 / 0.20)` | `0 28px 64px rgb(0 0 0 / 0.45)` | `0 32px 64px rgb(0 0 0 / 0.55)` |
| `--text-primary` | `rgb(255 255 255 / 0.95)` | **same** | **same** |
| `--text-secondary` | `rgb(255 255 255 / 0.70)` | **same** | **same** |
| `--text-muted` | `rgb(255 255 255 / 0.48)` | **same** | **same** |
| `--accent-primary` | `#00FF9D` | **same** | **same** |

Light mode mirrors every row (values in §2.5). The full copy-pasteable contract is §2.

---

## 1. Definitions

| | **Minimal** | **Acrylic** | **Liquid Glass** |
| --- | --- | --- | --- |
| **One-line definition** | Opaque, flat, hairline-bordered surfaces where depth comes from a 1px border and a Fluent elevation shadow — zero blur anywhere. | A frosted-glass material: the page behind is blurred and saturated, a low-alpha neutral tint is laid over it, and a 1px light edge separates it from what is behind. | A floating glass layer: heavier blur + saturation, an adaptive tint, a top specular hairline and a fresnel falloff, so the surface reads as a shaped lens floating over a flat sheet of content. |
| **CSS mechanism** | `background` (opaque) + `border: 1px solid var(--border-default)` + `box-shadow: var(--shadow-*)`. No `backdrop-filter` is ever declared. | `backdrop-filter: blur(40px) saturate(125%) brightness(105%) contrast(105%)` + `background: color-mix(in srgb, #2C2C2C 15%, transparent)` + `border` + `inset 0 1px 0 rgba(255,255,255,.06)`. | Everything Acrylic has, plus `blur(48px) saturate(150%) brightness(108%) contrast(112%)`, a thicker tint, a 1px specular hairline, and a `linear-gradient` fresnel layer. Optionally an SVG `feDisplacementMap` via `backdrop-filter: url(#refract)` — **progressive enhancement only, Chromium-only, never load-bearing.** |
| **Allowed on** | Everything. All five screens, all 200 rows of a dense table, every form field, every inset well. | Floating roles only: nav rail / top bar, command palette, sheets, popovers, the sticky footer, floating action buttons, the focused-row inspector. | The same floating roles as Acrylic, and only on the Persuade surface (`apps/product-page` hero furniture, pricing card headers, floating download button). It may **not** be applied to more than two regions simultaneously. |
| **Forbidden on** | Nothing is forbidden (this is the mode with no prohibitions) — but do not add `backdrop-filter` to it, because the point of the mode is that the material is absent. | Any text-bearing data surface: tables, ledger rows, the student roster, form inputs, inline edit fields, the attendance grid, anything inside a scroll container that the user reads as data. Never two adjacent translucent panes (Microsoft: "placing multiple acrylic panes next to each other results in an undesirable visible seam"). Never a large full-window acrylic background. | Everything Acrylic forbids, **plus** any surface carrying primary task text. Never nested inside another translucent surface. Never more than two at once. Never on a scrollable list. Never with the blur radius animated. |
| **Why it exists** | It is the accessibility and performance **default**. A dense Operate surface is read, not admired: contrast must be computable, hit targets must be stable, and the frame budget belongs to the table. | Depth *where depth carries meaning* — z-order, "this is above that", "this belongs to the element I just clicked". It is the Windows-native equivalent, so the desktop app and the web app feel like the same product. | It is the marketing/Persuade voice, and the Apple-native equivalent. Reserved for `apps/product-page` and the app's most important floating affordance. |

### 1.1 What "Minimal" must mean for a dense Operate surface — and why it is the default

Fluent itself puts **Solid** first: "Solid is the most common material. It's an opaque material that uses color and varying elevation to highlight different UI regions and interactions" (https://fluent2.microsoft.design/material). Microsoft only reaches for Acrylic on "transient, light-dismiss surfaces such as flyouts and context menus" (https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/materials). Apple says the same about Liquid Glass: "Limit these effects to the most important functional elements in your app" (https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass).

So for a 200-student roster:

- **Contrast becomes computable.** On an opaque surface you can prove `--text-primary` on `--surface-raised` is N:1. Behind a `backdrop-filter` the effective background is *whatever happens to be underneath* — a white row, an amber overdue badge, a chart — and the ratio is a function of scroll position. WCAG G18 requires 4.5:1 against "the background behind the text" (https://learn.microsoft.com/en-us/windows/apps/design/accessibility/accessible-text-requirements), and a translucent row makes that untestable.
- **Rendering cost is paid by the scroller, not the decorator.** Microsoft: "Rendering acrylic surfaces is GPU-intensive, which can increase device power consumption and shorten battery life" (https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic). Apple: "Creating too many Liquid Glass effect containers and applying too many effects to views outside of containers can degrade performance. Limit the use of Liquid Glass effects onscreen at the same time" (https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views). A tutor on a mid-range Android phone running the Fees screen mid-month is exactly the case where that budget is already spent.
- **Nothing in the product language needs glass on a data row.** Elevation is already carried by hairline borders and the Fluent shadow ramp (§2.4). Glass on a row would say "this row is special", and then every row that is *also* special (overdue, locked session, voided receipt) needs glass too, and the language collapses. That is the anti-slop failure `craft-floor.md` names: "Glass and blur as decoration rather than as a specific effect."

**Therefore: `data-material="minimal"` is the shipped default on `apps/web`.** Acrylic and Liquid Glass are opt-in Settings choices, and the marketing site may ship Liquid Glass as its default.

---

## 2. The CSS token contract (copy-pasteable)

### 2.0 Architecture: two token layers

This is the load-bearing structural decision, and it is what prevents glass slop.

- **Layer A — structure** (`--surface-canvas/raised/inset/row/sunken`, `--text-*`, `--accent-*`). Opaque in **all three modes**. These are the surfaces a tutor *reads*. They are allowed to shift luminance by a couple of percent between modes; they are **never** allowed to gain alpha < 1 or a `backdrop-filter`.
- **Layer B — material** (`--surface-overlay`, `--surface-nav`, `--surface-sheet`, `--surface-palette`, `--surface-scrim`, `--border-*`, `--mat-*`, `--shadow-overlay/sheet`). These are the surfaces that float *above* content. Only these change materially between modes.

**Every Layer-B translucent role ships with a paired `-solid` token.** The `-solid` value is the legible no-blur fallback (no `backdrop-filter` support, Reduce Transparency, forced colors, battery saver). Components reference only the translucent name; the fallbacks remap it globally, so **no component ever needs to branch.**

### 2.1 Layer A + shared ramps

```css
/* ============================================================================
   MATERIAL MODES — Buddysaradhi
   Three modes over ONE set of semantic token names.
   Base: aurora-cosmic dark (default). Light is the mirror — see §2.5.
   Mode is selected by [data-material] on <html>. NEVER redefined inside
   @theme (Tailwind requires top-level, non-nested theme vars) — see §4.1.
   ========================================================================== */

:root {
  color-scheme: dark;

  /* ---- Layer A · structure (OPAQUE in every mode) ---- */
  --surface-canvas: #0F0C29;
  --surface-raised: #181546;
  --surface-inset:  #0A0819;
  --surface-row:    #120F33;
  --surface-sunken: #07050F;   /* ledger / spreadsheet gutter */

  /* ---- Layer A · type + accent (MODE-INVARIANT — the a11y guarantee) ---- */
  --text-primary:   rgb(255 255 255 / 0.95);
  --text-secondary: rgb(255 255 255 / 0.70);
  --text-muted:     rgb(255 255 255 / 0.48);
  --text-on-accent: #0A0A1A;

  --accent-primary: #00FF9D;   /* Rule 5: no indigo/blue as accent */
  --accent-cyan:    #00F0FF;
  --accent-amber:   #FFB300;
  --accent-flare:   #FF5E00;
  --accent-violet:  #B388FF;

  /* ---- Fluent 2 elevation ramp, dark (blur = n; ambient 28% low / 20% high)
         https://fluent2.microsoft.design/elevation ---- */
  --shadow-2:  0 1px 2px  rgb(0 0 0 / 0.28);
  --shadow-4:  0 2px 4px  rgb(0 0 0 / 0.28);
  --shadow-8:  0 4px 8px  rgb(0 0 0 / 0.28);
  --shadow-16: 0 8px 16px rgb(0 0 0 / 0.24);
  --shadow-28: 0 14px 28px rgb(0 0 0 / 0.20);
  --shadow-64: 0 32px 64px rgb(0 0 0 / 0.20);

  /* ---- Touch target floor (AGENTS.md Rule 10) ---- */
  --target-min: 44px;
}

/* Default. Set in JS/SSR before first paint to avoid a flash. */
html:not([data-material]) { /* treated as minimal */ }
```

### 2.2 Minimal

```css
[data-material="minimal"] {
  /* Material: none. These exist so components can be mode-agnostic. */
  --mat-blur:       0px;
  --mat-saturate:   100%;
  --mat-brightness: 100%;
  --mat-contrast:   100%;
  --mat-tint:       #2C2C2C;
  --mat-tint-alpha: 0;
  --mat-specular:   none;
  --mat-fresnel:    none;

  /* Layer B — all opaque */
  --surface-overlay:        #1D1A4F;
  --surface-overlay-solid:  #1D1A4F;
  --surface-nav:            #14123A;
  --surface-nav-solid:      #14123A;
  --surface-sheet:          #191647;
  --surface-sheet-solid:    #191647;
  --surface-palette:        #1D1A4F;
  --surface-palette-solid:  #1D1A4F;
  --surface-scrim:          rgb(0 0 0 / 0.56); /* Fluent "Smoke" — always
                                                 translucent black, per
                                                 Fluent 2 material doc */

  --border-default: rgb(255 255 255 / 0.14);
  --border-strong:  rgb(255 255 255 / 0.24);

  --shadow-overlay: var(--shadow-16);
  --shadow-sheet:   var(--shadow-64);
}
```

### 2.3 Acrylic

Values are a direct port of the WinUI in-app acrylic theme resource. Source: `AcrylicBrush_19h1_themeresources.xaml` at commit `6aed8d9` — dark default is `TintColor="#2C2C2C" TintOpacity="0.15" FallbackColor="#2C2C2C" BackgroundSource="Backdrop"`; the "Base" variant is `#202020` at opacity `0.0`; accent acrylic uses `TintOpacity="0.8"`; the whole HighContrast dictionary swaps to `SolidColorBrush` + `SystemColorWindowColor`
(https://raw.githubusercontent.com/microsoft/microsoft-ui-xaml/6aed8d97fdecfe9b19d70c36bd1dacd9c6add7c1/dev/Materials/Acrylic/AcrylicBrush_19h1_themeresources.xaml, linked from https://learn.microsoft.com/en-us/windows/apps/develop/ui/in-app-acrylic).

```css
[data-material="acrylic"] {
  --mat-tint:       #2C2C2C;   /* WinUI AcrylicInAppFillColorDefaultBrush */
  --mat-tint-alpha: 0.15;      /* WinUI TintOpacity                      */
  --mat-blur:       40px;      /* TUNED PORT — Microsoft publishes no px value (§2.6) */
  --mat-saturate:   125%;      /* our CSS stand-in for TintLuminosityOpacity */
  --mat-brightness: 105%;
  --mat-contrast:   105%;
  --mat-specular:   inset 0 1px 0 rgb(255 255 255 / 0.06);
  --mat-fresnel:    none;

  --surface-overlay:       color-mix(in srgb, #2C2C2C 15%, transparent);
  --surface-overlay-solid: #2C2C2C;                          /* = WinUI FallbackColor */
  --surface-nav:           color-mix(in srgb, #2C2C2C 15%, transparent);
  --surface-nav-solid:     #232326;
  --surface-sheet:         color-mix(in srgb, #202020 60%, transparent); /* Acrylic "Base" */
  --surface-sheet-solid:   #202020;
  --surface-palette:       color-mix(in srgb, #2C2C2C 15%, transparent);
  --surface-palette-solid: #2C2C2C;
  --surface-scrim:         rgb(0 0 0 / 0.56);

  --border-default: rgb(255 255 255 / 0.16);
  --border-strong:  rgb(255 255 255 / 0.28);

  --shadow-overlay: 0 8px 28px  rgb(0 0 0 / 0.40);
  --shadow-sheet:   0 28px 64px rgb(0 0 0 / 0.45);
}
```

### 2.4 Liquid Glass

CSS-achievable subset of Apple's material: blur + adaptive saturation + tint + specular hairline + fresnel falloff. Real refraction, pointer-reactive lensing, and shape morphing are **native-only** (§3.2, §4.2).

```css
[data-material="liquid-glass"] {
  --mat-tint:       #1C1A40;
  --mat-tint-alpha: 0.35;
  --mat-blur:       48px;
  --mat-saturate:   150%;
  --mat-brightness: 108%;
  --mat-contrast:   112%;
  --mat-specular:
    inset 0 1px 0 rgb(255 255 255 / 0.10),
    inset 0 -1px 0 rgb(0 0 0 / 0.20);
  --mat-fresnel: linear-gradient(180deg,
    rgb(255 255 255 / 0.10) 0%,
    rgb(255 255 255 / 0) 42%);

  --surface-overlay:       color-mix(in srgb, #1C1A40 35%, transparent);
  --surface-overlay-solid: #1A1840;
  --surface-nav:           color-mix(in srgb, #1C1A40 30%, transparent);
  --surface-nav-solid:     #181634;
  /* Apple: "When a half sheet expands to full height, it transitions to a more
     opaque appearance to help maintain focus on the task." (adopting-liquid-glass) */
  --surface-sheet:         color-mix(in srgb, #1C1A40 55%, transparent);
  --surface-sheet-solid:   #16142F;
  --surface-palette:       color-mix(in srgb, #1C1A40 40%, transparent);
  --surface-palette-solid: #1A1840;
  --surface-scrim:         rgb(0 0 0 / 0.60);

  --border-default: rgb(255 255 255 / 0.22);
  --border-strong:  rgb(255 255 255 / 0.34);

  --shadow-overlay: 0 12px 40px rgb(0 0 0 / 0.50), 0 2px 8px rgb(0 0 0 / 0.30);
  --shadow-sheet:   0 32px 64px rgb(0 0 0 / 0.55);
}
```

### 2.5 Light mode

`colorize.md`: "Light and dark themes are each composed, not mechanically inverted." The light mirror must be authored, not `filter: invert()`.

```css
@media (prefers-color-scheme: light) {
  [data-material="minimal"] {
    --surface-canvas: #F2FBF6; --surface-raised: #FFFFFF; --surface-inset: #DBF7EA;
    --surface-row:   #F7FDFA; --surface-sunken: #EAF7F0;
    --surface-overlay:       #FFFFFF;
    --surface-overlay-solid: #FFFFFF;
    --surface-nav:           #E6FBF0;
    --surface-nav-solid:     #E6FBF0;
    --surface-sheet:         #FFFFFF;
    --surface-sheet-solid:   #FFFFFF;
    --surface-palette:       #FFFFFF;
    --surface-palette-solid: #FFFFFF;
    --text-primary: #07271A; --text-secondary: #2F5247; --text-muted: #5E7C70;
    --border-default: rgb(5 150 105 / 0.16); --border-strong: rgb(5 150 105 / 0.28);
    /* Fluent light ramp: ambient 14% (low) / 20% (high) */
    --shadow-2:  0 1px 2px  rgb(0 0 0 / 0.14);
    --shadow-4:  0 2px 4px  rgb(0 0 0 / 0.14);
    --shadow-8:  0 4px 8px  rgb(0 0 0 / 0.14);
    --shadow-16: 0 8px 16px rgb(0 0 0 / 0.12);
    --shadow-28: 0 14px 28px rgb(0 0 0 / 0.10);
    --shadow-64: 0 32px 64px rgb(0 0 0 / 0.10);
  }

  /* Windows acrylic in light theme is essentially UNTINTED:
     TintColor="#FCFCFC" TintOpacity="0.0" FallbackColor="#F9F9F9".
     All the work is done by luminosity opacity → our saturate(). */
  [data-material="acrylic"] {
    --mat-tint: #FCFCFC; --mat-tint-alpha: 0;
    --mat-brightness: 100%; --mat-contrast: 100%; --mat-saturate: 125%;
    --surface-overlay:       color-mix(in srgb, #FCFCFC 0%, transparent);
    --surface-overlay-solid: #F9F9F9;   /* = WinUI FallbackColor, light */
    --surface-nav:           color-mix(in srgb, #FCFCFC 0%, transparent);
    --surface-nav-solid:     #F3F3F3;
    --surface-sheet:         color-mix(in srgb, #F3F3F3 60%, transparent);
    --surface-sheet-solid:   #F3F3F3;
    --surface-palette:       color-mix(in srgb, #FCFCFC 0%, transparent);
    --surface-palette-solid: #F9F9F9;
    --border-default: rgb(255 255 255 / 0.70);
    --border-strong:  rgb(255 255 255 / 0.90);
    --mat-specular: inset 0 1px 0 rgb(255 255 255 / 0.80);
  }

  [data-material="liquid-glass"] {
    --mat-tint: #EAF6FF; --mat-tint-alpha: 0.30;
    --mat-brightness: 100%; --mat-contrast: 104%;
    --surface-overlay:       color-mix(in srgb, #EAF6FF 30%, transparent);
    --surface-overlay-solid: #F2F8FF;
    --surface-nav:           color-mix(in srgb, #EAF6FF 25%, transparent);
    --surface-nav-solid:     #EDF5FF;
    --surface-sheet:         color-mix(in srgb, #EAF6FF 55%, transparent);
    --surface-sheet-solid:   #F7FBFF;
    --surface-palette:       color-mix(in srgb, #EAF6FF 35%, transparent);
    --surface-palette-solid: #F2F8FF;
    --border-default: rgb(255 255 255 / 0.80);
    --border-strong:  rgb(255 255 255 / 0.95);
    --mat-specular: inset 0 1px 0 rgb(255 255 255 / 0.90),
                     inset 0 -1px 0 rgb(15 23 42 / 0.10);
  }
}
```

> In-app `data-theme="light"` (Settings override) wins over the media query — the repo already ships 8 palettes × light/dark in `apps/web/src/app/globals.css`; every `[data-palette]` block re-declares the Layer-A values, and the Layer-B blocks above are what the mode switch adds. Keep the palettes owning colour and the material blocks owning blur/alpha/shadow.

### 2.6 Applying the material — the one class that all three modes share

```css
/* ---- The material primitive. One class; all three modes route through it. ---- */
.mat {
  background: var(--surface-overlay);
  border: 1px solid var(--border-default);
  box-shadow: var(--mat-specular), var(--shadow-overlay);
  -webkit-backdrop-filter: blur(var(--mat-blur)) saturate(var(--mat-saturate))
                           brightness(var(--mat-brightness)) contrast(var(--mat-contrast));
  backdrop-filter: blur(var(--mat-blur)) saturate(var(--mat-saturate))
                   brightness(var(--mat-brightness)) contrast(var(--mat-contrast));
}
.mat-nav    { background: var(--surface-nav);    box-shadow: var(--mat-specular), var(--shadow-overlay); }
.mat-sheet  { background: var(--surface-sheet);  box-shadow: var(--mat-specular), var(--shadow-sheet); }
.mat-palette{ background: var(--surface-palette);box-shadow: var(--mat-specular), var(--shadow-overlay); }

/* Liquid Glass only: the fresnel lens gradient, painted under the content. */
.mat-fresnel::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--mat-fresnel);
  pointer-events: none;
}

/* ---- FALLBACK 1: no backdrop-filter support (or a browser that silently
       drops it). Swap to the paired -solid tokens. Legibility is preserved
       because the -solid values are the ones Microsoft itself ships as
       AcrylicBrush.FallbackColor, and every text token is mode-invariant. ---- */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .mat,
  .mat-nav,
  .mat-sheet,
  .mat-palette {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    background: var(--surface-overlay-solid);
  }
  .mat-nav     { background: var(--surface-nav-solid); }
  .mat-sheet   { background: var(--surface-sheet-solid); }
  .mat-palette { background: var(--surface-palette-solid); }
}

/* ---- FALLBACK 2: the user asked for less transparency.
       MDN: `prefers-reduced-transparency` is how a UA reports the device
       setting; it is honoured from Windows 10/11 (Settings > Personalization >
       Colors > Transparency effects), macOS (Accessibility > Display > Reduce
       transparency) and iOS (Accessibility > Display & Text Size > Reduce
       Transparency). NOTE: MDN marks this feature "Limited availability" —
       not Baseline. Therefore §6.4 also requires an in-app Materials setting. ---- */
@media (prefers-reduced-transparency: reduce) {
  :root, [data-material] {
    --surface-overlay:  var(--surface-overlay-solid);
    --surface-nav:      var(--surface-nav-solid);
    --surface-sheet:    var(--surface-sheet-solid);
    --surface-palette:  var(--surface-palette-solid);
    --mat-blur: 0px;
    --mat-specular: none;
    --mat-fresnel:  none;
    --border-default: rgb(255 255 255 / 0.24);
  }
  .mat, .mat-nav, .mat-sheet, .mat-palette {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}

/* ---- FALLBACK 3: Windows High Contrast / forced colors.
       Mirrors what WinUI does: every Acrylic/Mica brush in the
       HighContrast ResourceDictionary is replaced by
       SolidColorBrush SystemColorWindowColor. ---- */
@media (forced-colors: active) {
  .mat, .mat-nav, .mat-sheet, .mat-palette {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    background: Canvas;
    color: CanvasText;
    border-color: CanvasText;
    box-shadow: none;
    forced-color-adjust: none;
  }
}

/* ---- FALLBACK 4: user wants more contrast than the palette gives. ---- */
@media (prefers-contrast: more) {
  [data-material] {
    --surface-overlay:  var(--surface-overlay-solid);
    --surface-nav:      var(--surface-nav-solid);
    --surface-sheet:    var(--surface-sheet-solid);
    --surface-palette:  var(--surface-palette-solid);
    --mat-blur: 0px;
    --border-default: rgb(255 255 255 / 0.40);
    --border-strong:  rgb(255 255 255 / 0.60);
  }
}
```

### 2.7 Reduced motion

`animate.md`: Operate surfaces get fast, functional transitions. The material is not a licence to add motion; where the material *does* animate (a palette opening, a sheet rising), Reduce Motion removes the movement and keeps the state change legible.

```css
@media (prefers-reduced-motion: reduce) {
  .mat, .mat-nav, .mat-sheet, .mat-palette {
    transition-property: background-color, border-color;
    transition-duration: 100ms;
  }
  /* No morph, no scale, no shimmer, no parallax, no animated blur radius. */
  .mat-fresnel::before { display: none; }

  /* The app's own motion budget collapses to state-only. */
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 100ms !important;
    scroll-behavior: auto !important;
  }
}
```

Source: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion — honours Windows 10/11 (Settings > Accessibility > Visual Effects > Animation Effects), macOS (Accessibility > Display, or Motion on 25+), iOS (Accessibility > Motion), Android (Remove animations), and Firefox `ui.prefersReducedMotion`.

### 2.8 What is *not* ported, and why

Microsoft's acrylic recipe is **"background, blur, exclusion blend, color/tint overlay, noise"** (https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic). Three of the five layers have no honest CSS equivalent here:

| Acrylic layer | CSS status in this spec | Reason |
| --- | --- | --- |
| Blur | ✅ `backdrop-filter: blur(40px)` | Exact port, value tuned (see §2.9). |
| Color/tint overlay | ✅ `color-mix(... 15%, transparent)` | Exact port of `TintColor` + `TintOpacity`. |
| Luminosity opacity | ⚠️ approximated by `saturate(125%)` | `AcrylicBrush.TintLuminosityOpacity` "controls the amount of saturation that is allowed through the acrylic surface" and is otherwise set by the system from `TintColor`/`TintOpacity`. `saturate()` is the closest CSS filter function; the percentage is ours, not Microsoft's. |
| Exclusion blend | ❌ dropped | Guarantees legibility. Replaced by the §6.1 contrast-floor rule, which is *testable*; an exclusion layer is neither. |
| Noise | ❌ dropped | `craft-floor.md` Refuse list: "`feTurbulence` grain read as amateur." Replaced by the 1px specular hairline (`--mat-specular`). |
| Refraction / lensing / pointer reaction | ❌ native-only | Needs per-frame geometry normals. See §3.2. |

### 2.9 Honesty note on the tuned values

Only the **tint and opacity** numbers are Microsoft-published (`#2C2C2C` / `0.15` dark, `#FCFCFC` / `0.0` light, `#F9F9F9` and `#202020` fallbacks, `0.8` accent). The **blur radius (40px / 48px), saturate (125% / 150%), brightness and contrast** values are **our port, chosen by eye against the same visual target and to be validated in-browser at the §5.6 checkpoints.** Microsoft publishes no pixel value for acrylic blur, and the docs say the luminosity opacity is "automatically adjusted" when unspecified. Treat these four rows as a tunable surface, not as a spec constant, and record any change in the worklog with a before/after screenshot.

---

## 3. What each material is, in the sources' own terms

### 3.1 Windows Acrylic and Mica

- **Acrylic** is "a type of Brush that creates a translucent texture to add depth and help establish a visual hierarchy." Two blend types: **background acrylic** (reveals the desktop wallpaper and other windows — depth *between* windows) and **in-app acrylic** (depth *within* the app frame — focus and hierarchy). https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic
- **Use it for:** transient surfaces (context menus, flyouts, non-modal popups, light-dismiss panes) and supporting UI / vertical panes that overlap content when scrolled. "Many XAML controls draw acrylic by default. `MenuFlyout`, `AutoSuggestBox`, `ComboBox`, and similar controls with light-dismiss popups all use acrylic while open."
- **Do not:** "put desktop acrylic on large background surfaces of your app"; "place multiple acrylic panes next to each other because this results in an undesirable visible seam"; "place accent-colored text over acrylic surfaces" (explicitly "likely to not pass minimum contrast ratio requirements at the default 14px font size"); "try to avoid placing hyperlinks over acrylic elements."
- **Legibility:** "We've optimized the acrylic resources such that text meets contrast ratios on top of acrylic."
- **Adaptation:** becomes a solid colour when Reduce Transparency is on, in Battery Saver, on low-end hardware, in High Contrast; background acrylic also goes solid on window deactivation, on Xbox/HoloLens/tablet mode.
- **Mica** is **opaque**: "an opaque, dynamic material that incorporates theme and desktop wallpaper to paint the background of long-lived windows." "Mica is specifically designed for app performance as it only samples the desktop wallpaper once to create its visualization." Use it as the *base layer* only. https://learn.microsoft.com/en-us/windows/apps/design/style/mica
- **Mica's two hard rules** (these matter for Tauri): "Don't apply backdrop material more than once in an application"; "Don't apply backdrop material to a UI element. The backdrop material will not appear on the element itself. It will only appear if all layers between the UI element and the window are set to transparent."
- **Elevation values** (Windows 11): Layer `1`, Control `2`, Card `8`, Flyout `32`, Tooltip `16`, Dialog `128`, Window `128`; contour stroke width `1` at every level. https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/layering
- **Smoke** is the modal scrim: "always translucent black in both light and dark mode" (https://fluent2.microsoft.design/material). That is our `--surface-scrim`.

### 3.2 Apple Liquid Glass — real techniques and the CSS/native line

Liquid Glass "is a material that **blurs content behind it**, **reflects color and light of surrounding content**, and **reacts to touch and pointer interactions in real time**." It "forms a distinct functional layer for controls and navigation elements." https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views and https://developer.apple.com/documentation/technologyoverviews/liquid-glass

| Technique | What it is | CSS-achievable today? |
| --- | --- | --- |
| **Layered blur** | `Glass.regular` applied via `glassEffect(_:in:)` behind the content, defaulting to a `Capsule` shape | **Partly.** `backdrop-filter: blur() saturate()` + `border-radius` on the element gives the same read. |
| **Adaptive tinting** | `.tint(.orange)`, tint as a prominence cue; system bars adapt to overlap and focus | **Partly.** `color-mix()` + a `data-material`/palette attribute. The *automatic* adaptation to content behind is not. |
| **Specular highlight** | The system adds "reflection, refraction, shadow, blur, and highlights" | **Partly.** A static top hairline (`--mat-specular`) + a fresnel gradient. A highlight that tracks the real light source is not. |
| **Lensing / refraction** | Content behind is displaced by the glass volume; edges magnify | **Only in Chromium, as an enhancement.** `backdrop-filter: url(#refract)` with an inline SVG `feDisplacementMap`. Do not ship it as a requirement; it will not render in Safari/Firefox and it is expensive. |
| **Interactivity** | `.interactive()` makes the glass "react to touch and pointer interactions" | **No.** Requires per-frame normals; a hover/press transform is a *different* effect and should be labelled as one. |
| **Morphing between shapes** | `GlassEffectContainer(spacing:)`, `glassEffectID(_:in:)`, `GlassEffectTransition(.matchedGeometry` / `.materialize)` | **Partly**, and only as a declared, authored transition — the View Transitions API on the web. This is out of scope for the five-screen Operate surface. |
| **Scroll edge effect** | `scrollEdgeEffectStyle(_:for:)`, `safeAreaBar(edge:alignment:spacing:content:)`, `UIScrollEdgeElementContainerInteraction` — "helps maintain sufficient legibility and contrast for controls by obscuring content that scrolls beneath them" | **Yes, in CSS** — this is the one we must copy. A `position: sticky` header with a `mask-image` gradient fade at its lower edge plus the material background. Apple's own rule: use it for "a custom bar with elements like controls, text, or icons that have content scrolling beneath them." |
| **Performance contract** | "Limit the use of Liquid Glass effects onscreen at the same time"; "Combine custom Liquid Glass effects using a `GlassEffectContainer`, which helps optimize performance" | **Yes** — mirrors our ≤2-regions rule in §5.2. |
| **Accessibility contract** | "people can choose a preferred look for Liquid Glass in their device's settings, or turn on accessibility settings that **reduce transparency or motion** in the interface. These settings can remove or modify certain effects." | **Yes** — §2.7 and §2.6 Fallback 2. Apple's "reduce transparency" is the same device preference that surfaces in CSS as `prefers-reduced-transparency`. |

Apple's other two rules that bind this spec:
- "**Avoid overusing Liquid Glass effects.** If you apply Liquid Glass effects to a custom control, do so sparingly. Liquid Glass seeks to bring attention to the underlying content, and overusing this material in multiple custom controls can provide a subpar user experience by distracting from that content."
- "**Reduce your use of custom backgrounds in controls and navigation elements.** Any custom backgrounds and appearances you use in these elements might overlay or interfere with Liquid Glass or other effects that the system provides, such as the scroll edge effect."

macOS vibrancy, for the Tauri/macOS mapping (`NSVisualEffectView`): translucency + blur of background content for depth, plus "vibrancy," a "subtle blending of foreground and background colors to increase the contrast." Choose `material` by *intended use* — `.sidebar` for a window sidebar, `.headerView`, `.popover`, `.sheet`, `.menu`, `.titlebar`, `.hudWindow`, `.contentBackground`. `blendingMode` is `.behindWindow` (sheets, popovers) or `.withinWindow` (toolbars, scrolling content). Vibrancy is opt-in per view via `allowsVibrancy`, works best on **leaf** views, works best with **grayscale** foreground, and `NSColor.labelColor` / `secondaryLabelColor` / `tertiaryLabelColor` / `quaternaryLabelColor` give the contrast ramp. https://developer.apple.com/documentation/appkit/nsvisualeffectview and https://developer.apple.com/documentation/appkit/nsvisualeffectview/material-swift.enum

> The full Apple HIG *Materials* page and the HIG *Legibility* / *Accessibility* pages are JavaScript-rendered and could not be read by the research tooling used here. The HIG guidance quoted in this file is taken from the two reachable `developer.apple.com/documentation/…` technology-overview and SwiftUI articles above, which restate the relevant HIG rules. Marked as **(Apple HIG, restated by Apple's adoption guide)** where used.

### 3.3 What "Minimal" is in Fluent's vocabulary

Fluent names four materials — **solid, mica, acrylic, smoke** — and describes Solid as "the most common material" (https://fluent2.microsoft.design/material). "Minimal" in this spec is Fluent's **Solid**, executed with Fluent's elevation ramp and a 1px contour at every level. That is not a lesser mode; it is the material Fluent ships for the 95% case.

---

## 4. Cross-platform mapping

### 4.1 (a) Tailwind 4 — `apps/web`, `apps/product-page`

Tailwind 4 theme variables are declared with `@theme`, must be **top-level** (not nested in a media query), and when one theme variable references another you need the `inline` option or the utility resolves against the wrong scope. https://tailwindcss.com/docs/theme

**Consequence:** the mode blocks above must stay plain CSS attribute selectors, and the Tailwind bridge must be a single `@theme inline` layer.

```css
/* packages/design-system/material.css — the single bridge */
@import "tailwindcss";

@theme inline {
  --color-canvas:          var(--surface-canvas);
  --color-raised:          var(--surface-raised);
  --color-inset:           var(--surface-inset);
  --color-row:             var(--surface-row);
  --color-sunken:          var(--surface-sunken);
  --color-overlay:         var(--surface-overlay);
  --color-overlay-solid:   var(--surface-overlay-solid);
  --color-primary-fg:      var(--text-primary);
  --color-secondary-fg:    var(--text-secondary);
  --color-muted-fg:        var(--text-muted);
  --color-accent:          var(--accent-primary);
  --border-hairline:       var(--border-default);
  --shadow-overlay:        var(--shadow-overlay);
  --shadow-sheet:          var(--shadow-sheet);

  /* blur utilities read the live material value */
  --blur-material:    var(--mat-blur);
  --blur-material-lg: calc(var(--mat-blur) * 1.2);
}

@layer components {
  .mat-nav     { @apply bg-overlay border border-hairline shadow-overlay; }
  .mat-sheet   { @apply bg-overlay-solid border border-hairline shadow-sheet; }
  /* Opaque roles never get a material utility: use bg-raised / bg-row. */
}
```

- Mode switch = `document.documentElement.dataset.material = 'minimal' | 'acrylic' | 'liquid-glass'`, written from a Settings control, persisted in the same store as the 8 palettes, and applied **before first paint** (inline script in the root layout or a `data-material` attribute on `<html>` from the server) to avoid a flash of the wrong material.
- **Do not** add a Tailwind `data-material:` variant for the mode itself. Attribute selectors on the material classes are the whole mechanism, and they compose with every existing `dark:` / `data-palette:` variant for free.
- `apps/product-page` ships the identical file and differs only in the default value of `data-material`.

### 4.2 (b) NativeWind 5 / Expo

NativeWind compiles Tailwind into `StyleSheet.create` objects on native, where **no `backdrop-filter` utility exists** — the NativeWind Effects utility list is Background Blend Mode, Box Shadow, Box Shadow Color, Mix Blend Mode, and Opacity; there is no Filter/Backdrop-filter section. https://www.nativewind.dev/docs (stable is 4.2.7 on Tailwind v3; v5 is the Tailwind-4 line this repo targets per `AGENTS.md` §1.2).

| Mode | React Native | How |
| --- | --- | --- |
| **minimal** | ✅ fully supported | `--surface-*` map to `backgroundColor`, `--border-*` to `borderColor`, `--shadow-*` to the box-shadow props NativeWind emits. 1:1. |
| **acrylic** | ⚠️ partial, native module required | A blur cannot be produced from a style. Render a native blur view (`expo-blur`, or a platform blur view) *behind* the overlay's content and give the overlay a translucent `backgroundColor` from `--surface-overlay`. The blur radius and tint must be read from the token values in JS, not re-derived. |
| **liquid-glass** | ⚠️ partial, and capped | Same structure as Acrylic, plus a 1px `borderTopColor`/`borderBottomColor` pair for the specular hairline. True Liquid Glass requires a native `UIGlassEffectView` / `glassEffect` host view with a transparent bridge — **not available in Expo today.** Ship the Acrylic approximation. |

Rules:
- Keep the token *names* identical in NativeWind (via `vars()` / theme mapping) so a value changed in one place is visible on all four platforms. The values are shared; the *mechanism* is not.
- `44×44` minimum touch targets are native law (AGENTS.md Rule 10) and the neumorphic press effect replaces the web's hover/active states.
- Never attempt a cross-fading "material transition" on native; state changes are instant there, and Reduce Motion on iOS (`UIAccessibility.isReduceMotionEnabled`) collapses them further.

### 4.3 (c) Tauri on Windows → Mica / Acrylic

| Mode | Native material | Fidelity |
| --- | --- | --- |
| **minimal** | No backdrop. Opaque `SolidColorFill` on the window frame. | **Full.** |
| **acrylic** | `MicaBackdrop { Kind = MicaKind.BaseAlt }` on the window frame + in-webview `backdrop-filter` on nav/sheet/palette. | **Frame only.** The window-level material is real; in-webview element materials are the CSS approximation. |
| **liquid-glass** | `MicaBackdrop { Kind = MicaKind.Base }` + the CSS Liquid Glass classes on the same ≤2 floating roles. | **Approximation.** |

Hard constraints from Microsoft's Mica guidance, which the Tauri implementation must respect:
- Mica is a **base layer only**, applied once. "Don't apply backdrop material more than once in an application."
- "Don't apply backdrop material to a UI element… It will only appear if all layers between the UI element and the window are set to transparent." In a WebView2 shell the document background must therefore be `transparent`, and every Layer-A token must be **opaque above** the frame.
- Mica is captured **once** from the wallpaper, so it costs nothing on scroll; it falls back to a neutral colour when the window deactivates. That makes Mica the *right* choice for a desktop frame and the *wrong* choice for anything that must track scroll.
- Acrylic is GPU-intensive and "automatically disabled when a device enters Battery Saver mode"; a web app cannot detect this, so the desktop build must expose the same explicit Materials setting and default it to Minimal on low-power devices.
- **Not achievable:** WinUI's `AcrylicBrush` / `SystemBackdropElement` are WinAppSDK APIs and are unreachable from a WebView2 document. The mapping is *visual intent*, not API parity.

### 4.4 (d) Tauri on macOS → vibrancy

| Mode | `NSVisualEffectView` | Fidelity |
| --- | --- | --- |
| **minimal** | none | Full |
| **acrylic** | `material: .sidebar` or `.headerView`, `blendingMode: .withinWindow` (for nav) / `.behindWindow` (for popovers and sheets), `state: .active` | **Full at window level**, via a native vibrancy layer behind the webview. |
| **liquid-glass** | `material: .popover` / `.sheet` / `.hudWindow` for the two floating roles; `isEmphasized = true` for the tone | **Approximation** — macOS vibrancy is the pre-Liquid-Glass material and does not lens or morph. |

Rules carried from Apple's `NSVisualEffectView` docs:
- Pick `material` by **intended use**, not by the colour it happens to impart.
- Enable vibrancy only on **leaf** views; a parent that allows vibrancy cannot have it turned off by a subview, which is a permanent styling decision.
- `Reduce Transparency` (macOS: System Settings > Accessibility > Display > Reduce transparency) must force the webview to `data-material="minimal"`; the app cannot do this implicitly, so it must read the OS preference or require the user to pick.
- Vibrancy works best with grayscale foreground content, which matches our Layer-A text tokens.

### 4.5 (e) iOS / SwiftUI → Liquid Glass

| Mode | API | Fidelity |
| --- | --- | --- |
| **minimal** | plain opaque `View`s | Full |
| **acrylic** | `.background(.ultraThinMaterial)` / `.regularMaterial`, or a custom `material` matching the Acrylic tint | Full (system material) |
| **liquid-glass** | `.glassEffect(.regular, in: .rect(cornerRadius:))`, `.tint()`, `.interactive()`, grouped in a `GlassEffectContainer(spacing:)`, with `.glassEffectID(_:in:)` + `GlassEffectTransition(.matchedGeometry)` for morphing | **Full** |

Additional native obligations, all already satisfied by §2.7/§2.6:
- Group every glass view in a `GlassEffectContainer` — "applying too many effects to views outside of containers can degrade performance."
- Use the **scroll edge effect** (`safeAreaBar`, `scrollEdgeEffectStyle`) on any custom bar with content scrolling beneath it, rather than a hand-rolled alpha fade.
- Prefer `NavigationStack` / `NavigationSplitView` / `TabView(style: .sidebarAdaptable)` and let the system supply the material, per "Reduce your use of custom backgrounds in controls and navigation elements."
- Every toolbar icon needs an accessibility label.

### 4.6 (f) WinUI

| Mode | API | Fidelity |
| --- | --- | --- |
| **minimal** | `SolidColorFill` + `ThemeShadow` + 1px `CardStrokeColorDefault` | Full |
| **acrylic** | `AcrylicBrush` (theme resources `AcrylicInAppFillColorDefaultBrush`, `AcrylicInAppFillColorBaseBrush`, `AccentAcrylicInAppFillColorDefaultBrush` with `TintOpacity="0.8"`), or `DesktopAcrylicBackdrop { Kind = DesktopAcrylicKind.Thin }` | Full |
| **liquid-glass** | `DesktopAcrylicBackdrop { Kind = DesktopAcrylicKind.Base }` + the CSS fresnel/specular approximations; `MicaBackdrop { Kind = BaseAlt }` for the base layer | **Approximation** — Liquid Glass has no WinUI equivalent. |
| **scrim (all modes)** | Smoke: translucent black, not mode-aware | Full |

- Element-scoped system materials need `SystemBackdropElement` (Windows App SDK **2.0+**). Below that, a material only appears on a `Window.SystemBackdrop`.
- Always set the four controller properties — `FallbackColor`, `LuminosityOpacity`, `TintColor`, `TintOpacity` — per theme, because "After customizing any of the controller's four properties, it no longer applies default Light or Dark values."
- The High Contrast dictionary already proves the fallback strategy: every acrylic/mica key becomes a `SolidColorBrush` on `SystemColorWindowColor`. That is precisely our `--surface-*-solid` layer.
- Fluent elevation values in WinUI: Layer `1`, Control `2`, Card `8`, Flyout `32`, Tooltip `16`, Dialog `128`, Window `128`, stroke width `1` throughout.

### 4.7 Mapping summary — which native material for which mode

| Mode | Tailwind 4 | NativeWind/Expo | Tauri + Windows | Tauri + macOS | iOS/SwiftUI | WinUI |
| --- | --- | --- | --- | --- | --- | --- |
| **minimal** | opaque tokens + Fluent shadow ramp | native colours + shadows | opaque frame | no vibrancy | opaque views | `SolidColorFill` |
| **acrylic** | `backdrop-filter` + `color-mix` tint + `-solid` fallbacks | native blur view + translucent bg (module required) | `MicaBackdrop` + CSS in-webview | `NSVisualEffectView` `.withinWindow` | `.regularMaterial` | `AcrylicBrush` / `DesktopAcrylicBackdrop` |
| **liquid-glass** | `backdrop-filter` + tint + specular + fresnel (+ optional SVG refraction, Chromium) | Acrylic approximation (no true glass in Expo) | `MicaBackdrop Base` + CSS approximation | `.popover`/`.sheet` vibrancy, emphasized | `.glassEffect` in a `GlassEffectContainer` — **full** | `DesktopAcrylicBackdrop` approximation |

**Fidelity summary:** the *only* place Liquid Glass is fully achievable is Apple-native. Everywhere else it is a faithful *appearance* of the same idea, built from blur + saturation + tint + a specular hairline, and must be described as such in release notes.

---

## 5. Performance budget

### 5.1 What is safe at 60 fps

| Property | Verdict | Condition |
| --- | --- | --- |
| `transform` (translate/scale) | ✅ safe | compositor-only; `animate.md`'s foundation |
| `opacity` | ✅ safe | ≤ 2 stacked translucent layers (browser rule of thumb) |
| `backdrop-filter: blur() saturate()` | ⚠️ safe in a **bounded, non-scrolling** region | radius ≤ 40 px; region ≤ 25% of the viewport; never inside a scroller that is actively scrolling |
| `backdrop-filter` radius change | ❌ never animate | re-blurs the region every frame; also a motion-sickness trigger |
| `box-shadow` (static) | ✅ safe | static values only; animating it is a paint-per-frame repaint |
| `color-mix()` | ✅ safe | resolved once at computed-value time; no per-frame work |
| `border-radius`, `border-color` | ✅ safe | |
| `filter` (non-backdrop) | ⚠️ | avoid on any element that also has a `backdrop-filter`; it creates a **backdrop root** |
| `mix-blend-mode` | ❌ avoid | also creates a backdrop root, forcing extra render surfaces |
| `mask-image` on the scroller | ✅ safe | used once, on a sticky element, not per row |

### 5.2 The hard caps

1. **At most two `backdrop-filter` regions on screen at once** — Apple's own rule ("Limit the use of Liquid Glass effects onscreen at the same time") and Microsoft's ("Avoid layering multiple acrylic surfaces: multiple layers of background acrylic can create distracting optical illusions").
2. **At most one on mobile.** The Students/Fees screens are where the CPU is busy reconciling 200 rows; the nav is the only worth-it region.
3. **Blur radius ≤ 40 px in `apps/web`.** The 48 px Liquid Glass value is for `apps/product-page` only, where there is no dense table.
4. **Zero `backdrop-filter` inside a scroll container.** Ever.

### 5.3 The backdrop-root trap (the most common real bug here)

Per MDN, a "backdrop root" is created by `html`, by any element with `filter` other than `none`, `opacity` < `1`, a non-`none` `mask`/`mask-image`/`mask-border`/`clip-path`, a non-`none` `backdrop-filter`, `mix-blend-mode` other than `normal`, or `will-change` set to any of those. https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter

"If a parent element has `opacity: 0.9`, it becomes a backdrop root and any child's `backdrop-filter` will only blur the content between that parent and the child — not the content behind the parent. This is a common source of confusion when `backdrop-filter` appears to have no visible effect despite being correctly applied."

**Consequence for this spec:** never set `opacity < 1`, `filter`, `mix-blend-mode`, or `clip-path` on an ancestor of a `.mat*` element. The material's own transparency must come from `background` alpha, never from `opacity`.

### 5.4 Keeping a dense table smooth while overlays are translucent

The pattern that satisfies both:

```css
/* The translucent thing is a SIBLING of the scroller, not an ancestor or a child. */
.layout {
  display: grid;
  grid-template-rows: auto 1fr;   /* nav (mat) + scroller (opaque) */
  min-height: 0;
}
.scroller {
  overflow-y: auto;
  contain: paint;                 /* isolate the scroller's repaint region */
  overscroll-behavior: contain;
  background: var(--surface-canvas);
}
```

Rules for the five-screen Operate surface:

- **Tables, ledger rows, the attendance grid, the student roster: `--surface-raised` / `--surface-row`. No blur, no alpha, no shadow per row.** Per-row `box-shadow` is also a repaint cost across 200 rows — use a `border-bottom` hairline instead, which is a paint-cheap, GPU-friendly edge and matches Fluent's "Windows uses strokes instead of key shadows to outline an object."
- **The sticky column header is opaque.** Apple's scroll edge effect exists precisely so a floating bar stays legible over moving content, but in an Operate surface the header is *data*; make it opaque and give it a `mask-image` fade only if a row would otherwise slide visibly under it.
- **Reserve the translucency for a sibling nav + a sibling overlay portal.** The overlay portals to the document root, so it never becomes part of a scroller's paint region.
- **`will-change: backdrop-filter` only during a known animation**, then remove it. Permanent promotion of a large blurred region is how a "smooth" material becomes a 4-frame stutter.
- **Scroll-triggered demotion.** When a scroller containing a material sibling starts scrolling, drop the blur to the `-solid` value and restore on `scrollend` (or a 120 ms debounce):

```js
const scroller = document.querySelector("[data-material-scroll]");
const mat = document.querySelector(".mat-nav");
let t;
scroller.addEventListener("scroll", () => {
  if (mat.dataset.scrolling === "true") return;
  mat.dataset.scrolling = "true";
}, { passive: true });
const settle = () => { delete mat.dataset.scrolling; };
scroller.addEventListener("scrollend", settle);
scroller.addEventListener("touchmove", () => { clearTimeout(t); t = setTimeout(settle, 120); }, { passive: true });
```

```css
.mat-nav[data-scrolling="true"] {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  background: var(--surface-nav-solid);
}
```

The trade-off is a visible seam where a row passes under the nav. That is the *correct* trade for this product: a 120 ms opaque flash during a fling is invisible, and a re-blur of the full nav width on every scroll frame is not.

- **Virtualise first.** At 200+ students the roster is `FlashList`/virtualised; a 200-row DOM inside a `backdrop-filter` subtree is the failure mode, not the blur itself.
- **Battery / low-power:** Windows disables acrylic in Battery Saver automatically; the web cannot detect that, so treat the in-app Materials setting (§6.4) as the user-facing equivalent and default to `minimal` on `navigator.hardwareConcurrency <= 4`.

### 5.5 Budgets to assert in CI

| Metric | Budget |
| --- | --- |
| Elements with a computed `backdrop-filter` other than `none` | ≤ 2 |
| Elements with a computed `opacity` < 1 that are ancestors of a `.mat*` | 0 |
| `backdrop-filter` blur radius | ≤ 40 px in `apps/web` |
| Elements with `will-change` on a material | 0 at rest |
| INP during a 200-row scroll with the nav open | ≤ 200 ms (p75) |
| Long tasks during a Fees-screen scroll | 0 over 5 s |

### 5.6 Verify at

390×844, 768×1024, 1440×900, 1920×1080, 2560×1440 — per the repo's existing viewport matrix. In each, in all three modes, with the command palette open, a sheet open, a row focused, and the roster scrolled to 200. Check the `backdrop-root` cascade in devtools, not by eye.

---

## 6. Accessibility contract

### 6.1 Contrast on every material

Minimums (WCAG 2.1 AA; MS's Windows guidance states the same 4.5:1 and points at G18):

| Content | Minimum |
| --- | --- |
| Body text, table cells, ledger amounts | **4.5:1** |
| Large text (≥ 24 px, or ≥ 18.66 px bold) | **3:1** |
| Controls, icons, focus indicators, borders that carry state | **3:1** |

`colorize.md` adds the operative rule for this file: "**Prefer explicit colors over chains of translucent overlays when alpha would make contrast context-dependent.**" That is the entire reason Layer A is opaque.

**The contrast floor for a translucent role.** A translucent overlay sits on unknown content, so test it against the *worst* plausible backdrop, not the nominal one:

1. Compute the overlay's composite over the **most adverse** backdrop in the app: in dark mode that is `--accent-amber` and `--accent-flare` badges and the aurora accent wash; in light mode it is a white row and the `--accent-emerald` fill.
2. Require `--text-primary` on that composite to be **≥ 4.5:1**, and `--text-secondary` **≥ 4.5:1** (`--text-muted` may be ≥ 4.5:1 only for non-essential metadata; if it is load-bearing, promote it to `--text-secondary`).
3. If a mode fails, the fix is **more tint alpha or the `-solid` fallback — never a lighter text colour.** Microsoft: "We've optimized the acrylic resources such that text meets contrast ratios on top of acrylic"; we get the same result by raising the tint until the worst case passes.
4. Microsoft explicitly forbids one escape hatch: "**We don't recommend placing accent-colored text on your acrylic surfaces** because these combinations are likely to not pass minimum contrast ratio requirements at the default 14px font size. Try to avoid placing hyperlinks over acrylic elements." Our command palette and sheets are therefore `--text-primary`/`--text-secondary` only, with `--accent-primary` reserved for the *selection ring* and the focused item's marker — never for a hyperlink or a body label sitting on glass.

### 6.2 Touch targets

44×44 px minimum for every interactive element, in every mode, on every platform (AGENTS.md Rule 10). The material does not change this: a `.mat` pill button is 44 px tall with a 44 px hit area, and its translucent visual bounds are **not** its hit bounds — pad the hit area with a transparent box if the glass needs to look smaller.

### 6.3 Translucency never carries meaning

Hard rule, and it is the one most likely to be violated by a mode switch:

> A status, a selection, an error, or an amount is communicated by **text + icon + shape + position**. Never by the colour, transparency, blur, or tint of the surface it sits on.

Concretely, in a Liquid Glass build:
- "Overdue" is an amber chip with an icon and the word "overdue" — not a row that happens to look warm.
- "Selected" is a 2 px `--accent-cyan` left rule **plus** `--accent-primary` text **plus** `aria-selected="true"` — not a brighter glass.
- "Voided" keeps its reversed receipt row and its strikethrough — never a lowered-opacity row, because opacity is already carrying the material.
- Every state needs an `axe-core`-verifiable accessible name. The `no-color-only-status` lint in the repo is the enforcement.

This also means: **a mode switch must not change the meaning of any existing element.** If a row's meaning reads differently in Minimal than in Liquid Glass, the row is wrong, not the mode.

### 6.4 Preference handling — a required checklist

| Preference | Mechanism | Where |
| --- | --- | --- |
| Reduce Transparency (Windows / macOS / iOS) | `@media (prefers-reduced-transparency: reduce)` | §2.6 Fallback 2 |
| — plus an in-app override | `data-material="minimal"` forced from Settings | **Required**, because MDN marks `prefers-reduced-transparency` "Limited availability… not Baseline" — it does not work in all widely-used browsers. The Settings control must be present in every build regardless. |
| Increase Contrast | `@media (prefers-contrast: more)` | §2.6 Fallback 4 |
| Reduce Motion / Remove animations | `@media (prefers-reduced-motion: reduce)` | §2.7 |
| Windows High Contrast | `@media (forced-colors: active)` | §2.6 Fallback 3 |
| No `backdrop-filter` support | `@supports not (…)` | §2.6 Fallback 1 |
| Touch target size | 44 px min | §6.2 |
| Client-Hint mirror for motion | `Sec-CH-Prefers-Reduced-Motion` (server can read it) | optional |

Apple's contract, restated by their adoption guide: "people can choose a preferred look for Liquid Glass in their device's settings, or turn on accessibility settings that reduce transparency or motion in the interface. These settings can remove or modify certain effects. If you use standard components from system frameworks, this experience adapts automatically. Ensure you test your app's custom elements, colors, and animations with different configurations of these settings." Our Material tokens are the "custom elements", so **§6.4's checklist is a test matrix, not a footnote.**

### 6.5 Keyboard and focus

Focus rings are drawn on top of the material with `outline: 2px solid var(--accent-cyan); outline-offset: 2px;` — never a shadow, and never a colour-only ring. On a translucent surface the ring must clear **3:1 against the worst-case composite** (§6.1), which in practice means an outer dark/light double ring:

```css
.mat :focus-visible, .mat:focus-visible {
  outline: 2px solid var(--accent-cyan);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgb(0 0 0 / 0.55);  /* guarantees separation from any backdrop */
}
```

---

## 7. Layering rules (the anti-slop contract)

The mechanical rule from `craft-floor.md`: *"Controls are neumorphic; surfaces are glass. Never invert. Never mix."* and *"Declare elevation once, border or shadow. A 1px border under a wide soft shadow is the ghost card."* This section decides **which** surfaces are allowed to be glass at all.

### 7.1 The allow list — only these may ever be translucent

| Role | Token | Why it qualifies |
| --- | --- | --- |
| Nav rail / top bar | `--surface-nav` | It is chrome. It must be separable from content at a glance, and content scrolling beneath it needs the material to prove the relationship. Microsoft's own recommendation: in-app acrylic "on surfaces that may overlap content when scrolled." |
| Command palette (Ctrl+K) | `--surface-palette` | Transient, light-dismiss, interruptive. This is Acrylic's home use case. |
| Sheets / drawers / popovers | `--surface-sheet` | Same. A sheet is a temporary, interrupting surface — exactly what "modal" is for (`craft-floor.md`: "A modal for a task that needs neither interruption nor protected focus" is a *refuse*; when we do use a sheet, it earns it). |
| Sticky footer | `--surface-nav` | Chrome. |
| Floating action button | `--surface-overlay` | The single most important floating affordance. |

**Maximum simultaneously translucent: 2.** A sheet suppresses the nav's material; a command palette suppresses the nav's material. Never three.

### 7.2 The deny list — these must stay opaque in every mode

| Role | Token | Reasoning |
| --- | --- | --- |
| Student roster, attendance grid, ledger table, any data table | `--surface-raised` / `--surface-row` | Contrast is a function of scroll position (§1.1). Rendering cost is paid per frame while scrolling. Row-level glass would say "this row is special" and destroy the signal. |
| Column headers, sort indicators | `--surface-raised` | Data, not chrome. |
| Ledger amounts, balances, receipt numbers, dates | inherits row | The financial spine. A number you cannot read at a glance is a defect (AGENTS §1.3). |
| Form inputs, text fields, selects, textareas | `--surface-inset` | Editable content; the caret must be unambiguous and the placeholder must hold 4.5:1. Microsoft's `TextField` gained a larger, inset well in the same pass that introduced the material — the inset is the point. |
| Search field in the nav | `--surface-inset` | It is an input, not a surface. |
| Empty states, banners, callouts, toasts, audit rows | `--surface-raised` / `--surface-inset` | These carry text that must survive a bright-sunlight reading of a laptop. `colorize.md`: check "overlays, text on images, disabled content, and both themes." |
| The modal scrim | `--surface-scrim` | The one exception: Smoke is *by definition* translucent black, in both themes. It is not a surface, it is an occluder. |
| Full-window / full-section background wash | `--surface-canvas` | Acrylic's "don't put desktop acrylic on large background surfaces" rule. Mica is opaque for exactly this reason. |

### 7.3 The three glass-slop patterns this section exists to kill

1. **Nested glass.** A glass card inside a glass card. Both Microsoft ("Avoid layering multiple acrylic surfaces") and Apple ("avoid overcrowding or layering Liquid Glass elements on top of each other") forbid it, and `craft-floor.md` calls nested cards "always wrong." **Rule: a `.mat*` element may never contain another `.mat*` element.** Sheets and the command palette are the *innermost* glass; the nav is the outermost. Nothing in between.
2. **The edge-to-edge seam.** Two translucent panes side by side produce a visible seam between two blurred regions (Microsoft: "avoid creating a striping effect"). **Rule: at most one glass region per axis band.** Two stacked glass elements (nav above, sheet above that) must have the lower one's material dropped while the upper one is open.
3. **Glass as a status badge.** A row that turns glassy when it is selected, overdue, or locked. **Rule: §6.3** — meaning is text + icon + shape. Glass is z-order, always.

### 7.4 One line of enforcement

Add to the lint suite:

```
forbidden: backdrop-filter on any element matching
  [data-dense]            /* tables, grids, forms, lists */
  [data-role="table|row|input|field"] /class containing mat|glass
forbidden: a .mat* ancestor of another .mat* (nesting)
forbidden: opacity < 1 on an ancestor of a .mat* (backdrop root, §5.3)
forbidden: more than 2 elements with a non-none backdrop-filter (runtime)
```

The third is a runtime assertion, not a static lint — put it in the existing browser smoke test.

---

## 8. Implementation checklist (per surface)

1. `data-material` written before first paint; default `minimal` on `apps/web`, `liquid-glass` on `apps/product-page`.
2. `packages/design-system/material.css` holds §2 verbatim; the 8 palettes keep owning Layer A colour.
3. Layer A tokens have **no** alpha and **no** `backdrop-filter` — verified by the lint above.
4. Every Layer-B role has a `-solid` companion and is used only via the four `.mat*` classes.
5. All four fallbacks present and tested (§2.6 × 4, §2.7).
6. Settings → Appearance gains a **Materials** control (Minimal / Acrylic / Liquid Glass) plus a **Reduce transparency** override, persisted alongside the palette choice.
7. Focus rings carry a 4 px dark outer ring on every material.
8. `axe-core` green on all five screens in all three modes × light/dark.
9. §5.5 CI assertions in place.
10. Browser pass at all five viewports in all three modes, including a 200-row scroll, the palette open, and a sheet open.

---

## 9. Sources

**Microsoft (Fluent / WinUI)** — primary for Acrylic, Mica, elevation
- Acrylic material — https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic
- Mica material — https://learn.microsoft.com/en-us/windows/apps/design/style/mica
- Materials used in Windows apps — https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/materials
- In-app acrylic (`AcrylicBrush` properties) — https://learn.microsoft.com/en-us/windows/apps/develop/ui/in-app-acrylic
- System backdrops (Mica/Acrylic, `SystemBackdropElement`) — https://learn.microsoft.com/en-us/windows/apps/develop/ui/system-backdrops
- Layering and elevation (elevation values, two-layer system, shadows) — https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/layering
- Accessible text requirements (4.5:1, G18) — https://learn.microsoft.com/en-us/windows/apps/design/accessibility/accessible-text-requirements
- Fluent 2 · Material (solid / mica / acrylic / smoke) — https://fluent2.microsoft.design/material
- Fluent 2 · Elevation (shadow ramp, blur = n, opacity 14%/28%/20%) — https://fluent2.microsoft.design/elevation
- `AcrylicBrush_19h1_themeresources.xaml` (tint/opacity/fallback values, HighContrast solid swap) — https://raw.githubusercontent.com/microsoft/microsoft-ui-xaml/6aed8d97fdecfe9b19d70c36bd1dacd9c6add7c1/dev/Materials/Acrylic/AcrylicBrush_19h1_themeresources.xaml

**Apple** — primary for Liquid Glass and vibrancy
- Liquid Glass (technology overview) — https://developer.apple.com/documentation/technologyoverviews/liquid-glass
- Adopting Liquid Glass (accessibility settings, over-use warnings, scroll edge effect, background-extension effect, sheets) — https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass
- Applying Liquid Glass to custom views (`glassEffect`, `GlassEffectContainer`, `glassEffectID`, `GlassEffectTransition`, performance limits) — https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views
- `NSVisualEffectView` (blending modes, `allowsVibrancy`, leaf views, label colours) — https://developer.apple.com/documentation/appkit/nsvisualeffectview
- `NSVisualEffectView.Material` (the material list) — https://developer.apple.com/documentation/appkit/nsvisualeffectview/material-swift.enum
- HIG *Materials* — https://developer.apple.com/design/human-interface-guidelines/materials — **not machine-readable** (JavaScript-rendered); its guidance is used here only as restated by the two reachable Apple documents above.

**Web platform** — for the CSS mechanism
- `backdrop-filter` + **backdrop root** semantics — https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter
- `prefers-reduced-transparency` (Limited availability; the three OS settings it maps to) — https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency
- `prefers-reduced-motion` (OS settings per platform) — https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
- Tailwind CSS theme variables (`@theme`, top-level requirement, `@theme inline`) — https://tailwindcss.com/docs/theme
- NativeWind (Effects utilities; no filter/backdrop-filter on native) — https://www.nativewind.dev/docs

**Local craft floor**
- `.agents/skills/impeccable/reference/craft-floor.md`, `colorize.md`, `animate.md`

**Marked as unverified / from prior knowledge**
- The exact browser-support matrix for `prefers-reduced-transparency` beyond MDN's "Limited availability" statement — Chromium-based browsers honour it; confirm per-target-browser in CI rather than assuming.
- `tauri-plugin-window-vibrancy` (the Rust crate that applies `NSVisualEffectView` / Windows backdrop to a Tauri window) — the README was unreachable during this research (404 on both `main` and `dev`). The macOS/Windows material *names* and *semantics* in §4.3/§4.4 are taken from Apple and Microsoft directly and are authoritative; the crate's exact API surface is **(from prior knowledge, unverified)** and must be confirmed at implementation time.
- Whether Tauri's WebView2 host exposes a genuinely transparent document background (required for Mica to show through). Verify with a spike before committing to §4.3's Acrylic row; if it does not, ship Minimal on Windows and say so.
