# DESIGN.md — BuddySaradhi Product Page Impeccable Design System

> **Surface Class:** Persuade Surface
> **Visual Identity:** Vibrant Glass dark-default canvas with bioluminescent accents and cinematic 3D hero stage.
> **Token Source:** `packages/design-system/tokens.css` (generated, 20 palettes × 3 material modes).

---

## 1. Core Color System & Tokens

* **Backdrop Canvas**: Cosmic Indigo Gradient (`--bg-cosmic`: `#0f0c29` → `#24243e` → `#0a0a1a`).
* **Bioluminescent Accents**:
  * `--accent-emerald` (`#00FF9D`): Primary action / Success / Positive balance.
  * `--accent-cyan` (`#00F0FF`): Interactive elements / Information / Secondary focus.
  * `--accent-amber` (`#FFB300`): Warnings / Pending dues / Attention required.
  * `--accent-flare` (`#FF5E00`): Destructive actions / Overdue balances / Critical alerts.
  * `--accent-violet` (`#B388FF`): Special badges / Structural contrast.

---

## 2. Material Modes (Three-Mode Contract)

| Mode | `--mat-filter` | `--mat-specular` | Use Case |
|------|----------------|------------------|----------|
| **Minimal** | `blur(8px) saturate(120%)` | `0 0 0 transparent` | Low-end devices, save-data mode |
| **Acrylic** | `blur(16px) saturate(140%)` | `0 0 8px rgba(255,255,255,0.06)` | Default desktop |
| **Liquid Glass** | `blur(24px) saturate(160%)` | `0 0 16px rgba(255,255,255,0.12)` | High-end desktop, hero stage |

Switching material **never** changes text or accent contrast — only translucency and shadow ramp.

---

## 3. Anti-Slop Design Constraints

1. **No Decorative Motion on Product Surfaces**:
   - The 3D hero stage is the **only** motion surface. All other sections are static.
   - `prefers-reduced-motion` honored unconditionally; in-app toggle mirrors to `<html>`.

2. **No Glass Cards on Content**:
   - Glass (`.mat`, `.mat-nav`, `.mat-sheet`) reserved for chrome and floating shells.
   - Content sections use opaque `.panel` / `.panel-inset` with 1px borders.

3. **One Primary Action Per Viewport**:
   - Hero: single primary CTA (free sign-up).
   - Decision panels: one primary, quiet secondary.
   - No competing CTAs at equal visual weight.

4. **Evidence Over Claims**:
   - Facts strip pulls live data from gateway; degraded state named honestly.
   - No unsourced benchmarks ("38 students in 30 seconds" removed).

5. **Typography & Scanability**:
   - Headings: `Sora` (`--font-heading`).
   - Body: `Onest` (`--font-sans`).
   - Financial/Code: `JetBrains Mono` (`--font-mono`).
   - Touch targets ≥ 44px.

---

## 4. Component Primitives

| Primitive | Class | Use Case |
|-----------|-------|----------|
| Material shell | `.mat` | Floating shells, modals, sheets |
| Nav bar | `.mat-nav` | Sticky header/nav |
| Sheet/modal | `.mat-sheet` | Overlays, drawers |
| Fresnel lens | `.mat-fresnel` | 3D hero stage only |
| Opaque panel | `.panel` | Content cards, sections |
| Inset panel | `.panel-inset` | Inset backgrounds |
| Primary button | `.btn-primary` | One per viewport |
| Secondary button | `.btn-secondary` | Supporting actions |
| Quiet action | `.action` | Text links, quiet CTAs |
| Form input | `.input` | All form fields |
| Data row | `.row` | Scrollable lists |

---

## 5. Accessibility Floor (Non-Negotiable)

| Requirement | Implementation |
|-------------|----------------|
| **WCAG 2.1 AA** | Minimum contrast 4.5:1 text, 3:1 UI elements |
| **Focus Visible** | `outline: 2px solid var(--border-focus); outline-offset: 2px; box-shadow: 0 0 0 5px var(--canvas);` |
| **Skip Link** | Off-screen until focus; 44px target |
| **Touch Targets** | ≥ 44×44px for all interactive elements |
| **Reduced Motion** | `@media (prefers-reduced-motion: reduce)` + `html[data-reduced-motion="1"]` |
| **High Contrast** | `@media (prefers-contrast: more)` strengthens borders |
| **Forced Colors** | `@media (forced-colors: active)` disables backdrop-filter |
| **Reduced Transparency** | `@media (prefers-reduced-transparency: reduce)` falls back to solid tokens |

---

## 5. 3D Hero Stage (Cinematic Persuade)

| Aspect | Specification |
|--------|---------------|
| **Canvas** | `500vh` sticky stage, `100dvh` height |
| **Fallback** | Poster image (identical pixels) until first frame |
| **Progress** | GSAP ScrollTrigger scrub proxy (`progressRef.current`) |
| **Beats** | 5 narrative beats, each pins at 20% increments |
| **Pins** | DOM buttons (keyboard-safe), only when WebGL active |
| **Way Past** | Real `<a href="#access">` anchor (not button) |
| **Accessibility** | `aria-live="polite"` beat announcer, `sr-only` H1 in static HTML |
| **Fallback Chain** | WebGL check → Save-Data → Low-End → Poster |

---

## 6. Palette Contract

* **20 palettes** (10 dark + 10 light) from Figma website colour schemes library.
* **Default**: `inked` (dark) + `liquid-glass` material.
* **Generated tokens**: `packages/design-system/tokens.css` — never edited manually.
* **Regenerate**: `pnpm --filter @buddysaradhi/design-system emit`
* **Verify**: `pnpm --filter @buddysaradhi/design-system verify`

---

## 7. Component State Contracts

| State | Visual Treatment |
|-------|------------------|
| **Hover** | `background: var(--accent-text);` for `.btn-primary` |
| **Focus** | `outline: 2px solid var(--border-focus); outline-offset: 2px; box-shadow: 0 0 0 5px var(--canvas);` |
| **Disabled** | `opacity: 0.55; cursor: not-allowed;` |
| **Active/Pressed** | `transform: scale(0.98) translateY(1px);` |
| **Focus Visible** | `outline: 2px solid var(--border-focus); outline-offset: 2px; box-shadow: 0 0 0 5px var(--canvas);` |

---

## 8. Responsive Breakpoints

| Breakpoint | Width | Behavior |
|------------|-------|----------|
| **Base** | < 640px | Mobile-first; hero canvas full-width; nav collapses |
| **sm** | ≥ 640px | Hero canvas constrained; nav visible |
| **md** | ≥ 768px | Side-by-side layouts; full hero stage |
| **lg** | ≥ 1024px | Full desktop layout; max-w-6xl container |
| **xl** | ≥ 1280px | Generous whitespace; hero stage max-width |

---

## 9. Fallback Contracts

| Fallback | Trigger | Remapping |
|----------|---------|-----------|
| **No backdrop-filter** | `@supports not (backdrop-filter: blur(1px))` | `.mat` → `--surface-overlay-solid`; `.mat-nav` → `--surface-nav-solid`; `.mat-sheet` → `--surface-sheet-solid` |
| **Reduced Transparency** | `@media (prefers-reduced-transparency: reduce)` | Disable backdrop-filter; use solid tokens |
| **Forced Colors** | `@media (forced-colors: active)` | Disable filters/shadows; `forced-color-adjust: none` |
| **High Contrast** | `@media (prefers-contrast: more)` | Strengthen borders to `--border-strong` |
| **Reduced Motion** | `@media (prefers-reduced-motion: reduce)` | Collapse transitions to 100ms; disable animations; static spinners |

---

## 10. Design Token Mapping (Tailwind Bridge)

```css
@theme inline {
  --color-canvas: var(--canvas);
  --color-raised: var(--surface-raised);
  --color-inset: var(--surface-inset);
  --color-row: var(--surface-row);
  --color-sunken: var(--surface-sunken);
  --color-nav: var(--surface-nav);
  --color-sheet: var(--surface-sheet);
  --color-overlay: var(--surface-overlay);
  --color-fg: var(--text-primary);
  --color-fg-secondary: var(--text-secondary);
  --color-fg-muted: var(--text-muted);
  --color-fg-inverse: var(--text-inverse);
  --color-accent: var(--accent-primary);
  --color-accent-text: var(--accent-text);
  --color-accent-fg: var(--accent-on-primary);
  --color-ok: var(--success);
  --color-warn: var(--warning);
  --color-bad: var(--danger);
  --color-info: var(--info);
  --color-hairline: var(--border-default);
  --shadow-float: var(--shadow-overlay);
  --shadow-drawer: var(--shadow-sheet);
  --font-display: var(--font-heading);
  --font-body: var(--font-sans);
  --radius-panel: 0.875rem;
}
```

---

## 10. Content Principles

| Principle | Rule |
|-----------|------|
| **Evidence over claims** | Facts strip from live API; degraded state named |
| **One primary per viewport** | Hero, pricing, platforms, request-access each have one primary CTA |
| **Quiet actions are text** | `.action` for secondary; no box, no border |
| **States are real** | Disabled = `opacity: 0.55` + `cursor: not-allowed` |
| **No glass on content** | Glass only for chrome; content uses `.panel`/`.panel-inset` |
| **Focus is visible** | Every interactive element has `focus-visible` ring |

---

## 11. Animation Budget

| Animation | Duration | Easing | Purpose |
|-----------|----------|--------|---------|
| **Fast** | 140ms | `cubic-bezier(0, 0, 0.2, 1)` | Button hover, border transitions |
| **Base** | 250ms | `cubic-bezier(0.16, 1, 0.3, 1)` | Panel transitions |
| **Slow** | 400ms | `cubic-bezier(0.16, 1, 0.3, 1)` | Sheet/modal entry |
| **Scroll** | — | `smooth` (auto under reduced motion) | Anchor navigation |

**Reduced Motion**: All durations collapse to 100ms; animations disabled; spinners become static rings.