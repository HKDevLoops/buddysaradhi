# 03 — Component Library

> The component contract for every screen on every platform of **Buddysaradhi TutorOS**. Every component in this file extends a shadcn/ui primitive; nothing is built from scratch. Every component exists in 8 palette variants via CSS variables defined in `01_Color_Palettes.md`. Every component references typography tokens from `02_Typography_System.md` and motion variants from `04_Motion_and_Microinteractions.md`.

---

## §1 Component Philosophy

> **Extend shadcn/ui. Do NOT build from scratch. Every component exists in 8 palette variants via CSS variables.**

The Buddysaradhi UI is built on [shadcn/ui](https://ui.shadcn.com/) — a collection of copy-into-your-codebase React components built on Radix UI primitives + Tailwind. shadcn's philosophy ("you own the code") fits a tutor app that needs custom glass + neumorphic variants that no off-the-shelf library ships. We do not reinvent buttons, dialogs, dropdowns, or tooltips — we extend them.

### The Three Rules

1. **Every component is a CSS-variable consumer, never a hex hard-coder.** A `<Button>` in the Fees ledger (Emerald Ledger palette) and the same `<Button>` in the Students master (Rose Petal palette) use the **same JSX**, the **same Tailwind classes**, and resolve to different colours purely because `data-palette` on `<html>` swaps the tokens. A component that hard-codes `bg-[#059669]` is a P1 lint violation.
2. **Glass + neumorphism, never either/or.** Cards are glass (translucent fill + 1px white-edge) with neumorphic shadow (dual-light extrusion). Flat cards are forbidden; pure-neumorphic cards (no translucency) are forbidden. See §2 for the recipe — it applies to every surface that floats above the canvas.
3. **Components are accessible by default, opt-out by explicit prop.** Every interactive component ships with `aria-*` attributes, keyboard handlers, and focus-visible styles. A developer may only remove accessibility by passing `aria-hidden` or `disabled` explicitly — never by accident.

### The Palette-Variant Mechanism

```tsx
// The same component, two palettes, zero code branches:
<Button variant="primary">Save</Button>

// Renders in Emerald Ledger (Fees page) as:
//   background: var(--accent-primary) → #059669 (emerald)
//   color:      var(--text-on-accent)  → #FFFFFF
//
// Renders in Rose Petal (Students page) as:
//   background: var(--accent-primary) → #E11D48 (rose)
//   color:      var(--text-on-accent)  → #FFFFFF
//
// The component code is identical. The palette swap is purely a CSS-variable swap
// driven by [data-palette="..."] on <html>.
```

### Component Inventory

This file defines recipes for: Glass Card, Neumorphic Controls, Button, Chip/Badge, KPI Card, Data Table, Form Input, Modal/Sheet/Drawer, Navigation, Chart, Empty State, Toast, Avatar, and Sticky Footer. Each recipe is a **CSS block + a React/TSX skeleton** — copy-paste-ready into `src/components/ui/`.

---

## §2 Glass Card Recipe

> The fundamental surface. Every card in the app — KPI cards, student cards, fee cards, settings panels — is a variant of this base. Glass + neumorphism, never either/or.

### The Recipe

```css
.glass-card {
  /* Glass: translucent fill + 1px white-edge */
  background: var(--surface-glass);          /* rgba(255,255,255,0.05) dark / rgba(255,255,255,0.72) light */
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--border-glass);     /* rgba(255,255,255,0.08) dark / rgba(255,255,255,0.14) light */

  /* Neumorphism: dual-light extrusion (one light top-left, one dark bottom-right) */
  box-shadow:
    0 1px 0 0 rgba(255,255,255,0.10) inset,  /* 1px white inner-edge — the "glass edge" */
    -4px -4px 12px 0 rgba(255,255,255,0.04), /* light extrusion from top-left */
    4px 4px 16px 0 var(--shadow-color);      /* dark extrusion to bottom-right */

  border-radius: 16px;
  padding: 24px;
  position: relative;
  overflow: hidden;
  transition: transform var(--motion-base) var(--ease-out),
              box-shadow var(--motion-base) var(--ease-out);
}

/* Strong variant: more opaque, for modals and elevated cards */
.glass-card-strong {
  background: var(--surface-glass-strong);   /* 0.08 dark / 0.88 light */
  border: 1px solid var(--border-glass-strong);
  box-shadow:
    0 1px 0 0 rgba(255,255,255,0.14) inset,
    -6px -6px 20px 0 rgba(255,255,255,0.06),
    6px 6px 24px 0 var(--shadow-color);
}

/* Faint variant: less opaque, for nested cards inside other cards */
.glass-card-faint {
  background: var(--surface-glass-faint);    /* 0.02 dark / 0.60 light */
  border: 1px solid var(--border-glass);
  box-shadow:
    0 1px 0 0 rgba(255,255,255,0.06) inset,
    -2px -2px 8px 0 rgba(255,255,255,0.02),
    2px 2px 10px 0 var(--shadow-color);
}

/* Hover lift: 2px translate-y + shadow expansion (NEVER scale on a card — too noisy) */
.glass-card-interactive:hover {
  transform: translateY(-2px);
  box-shadow:
    0 1px 0 0 rgba(255,255,255,0.14) inset,
    -6px -6px 18px 0 rgba(255,255,255,0.06),
    8px 8px 28px 0 var(--shadow-color);
}

/* The 1px accent edge — optional, for cards in the "active" state */
.glass-card-accent-edge::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(135deg, var(--accent-primary), transparent 40%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}
```

### React Skeleton

```tsx
// src/components/ui/glass-card.tsx
import { forwardRef, HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'strong' | 'faint';
  interactive?: boolean;
  accentEdge?: boolean;
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, variant = 'default', interactive, accentEdge, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'glass-card',
        variant === 'strong' && 'glass-card-strong',
        variant === 'faint' && 'glass-card-faint',
        interactive && 'glass-card-interactive cursor-pointer',
        accentEdge && 'glass-card-accent-edge',
        className
      )}
      {...props}
    />
  )
);
GlassCard.displayName = 'GlassCard';
```

### Forbidden Variants

- **Flat card** — `background: var(--bg-surface)` with no translucency, no blur, no shadow. Use `<div>` if you really need flat; do not call it a card.
- **Pure-neumorphic card** — solid fill + dual shadow, no translucency. This was the 2020 aesthetic; it died. Glass is mandatory.
- **Card with `scale-105` on hover** — too noisy across a 200-row grid. Use `translateY(-2px)` instead.

---

## §3 Neumorphic Raised / Inset Controls

> Toggles, knobs, segmented controls, range sliders, and "physical" buttons use neumorphic extrusion to feel pressable. The recipe is dual-shadow: a light shadow top-left, a dark shadow bottom-right. Pressed = inset (shadows flip).

### Raised (default state)

```css
.neumo-raised {
  background: var(--bg-surface-raised);
  border-radius: 12px;
  box-shadow:
    -3px -3px 8px 0 rgba(255,255,255,0.06),  /* light extrusion */
    3px 3px 10px 0 var(--shadow-color);      /* dark extrusion */
  border: none;                                /* neumorphic controls have no border — the shadow IS the edge */
  transition: box-shadow var(--motion-fast) var(--ease-out),
              transform var(--motion-fast) var(--ease-out);
}

.neumo-raised:hover {
  box-shadow:
    -4px -4px 10px 0 rgba(255,255,255,0.08),
    4px 4px 12px 0 var(--shadow-color);
}

.neumo-raised:active,
.neumo-raised[data-state="pressed"] {
  /* Inset: shadows flip inward — the control "sinks" into the surface */
  box-shadow:
    inset -2px -2px 6px 0 rgba(255,255,255,0.04),
    inset 2px 2px 8px 0 var(--shadow-color);
  transform: translateY(0.5px);
}
```

### Inset (default-state for "track" of a toggle / slider)

```css
.neumo-inset {
  background: var(--bg-surface-inset);
  border-radius: 12px;
  box-shadow:
    inset -2px -2px 6px 0 rgba(255,255,255,0.04),
    inset 2px 2px 8px 0 var(--shadow-color);
  border: none;
}
```

### Toggle Recipe

```tsx
// src/components/ui/neumo-toggle.tsx
<button
  className="neumo-raised w-12 h-7 rounded-full relative"
  role="switch"
  aria-checked={isOn}
  aria-label={label}
  onClick={() => setIsOn(!isOn)}
>
  <span
    className={cn(
      'absolute top-1 w-5 h-5 rounded-full transition-transform',
      'bg-[var(--accent-primary)]',
      isOn ? 'translate-x-6' : 'translate-x-1'
    )}
  />
</button>
```

### Knob Recipe (used in settings — e.g. notification volume)

```tsx
<div
  className="neumo-raised w-16 h-16 rounded-full relative cursor-grab active:cursor-grabbing"
  role="slider"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={value}
  aria-label="Notification volume"
  tabIndex={0}
  onKeyDown={handleKnobKeydown}  // Arrow Up/Right = +5, Arrow Down/Left = -5
>
  <div
    className="absolute top-2 left-1/2 w-1 h-4 bg-[var(--accent-primary)] rounded-full origin-bottom"
    style={{ transform: `translateX(-50%) rotate(${angle}deg)` }}
  />
</div>
```

---

## §4 Button Variants

> Five variants. Each is a CSS class; the React `<Button>` accepts `variant` and `size` props. Every variant has hover / active / disabled / loading states. One primary CTA per screen (rule from `00_Design_System_Overview.md` §5.8).

### Variants Table

| Variant | Visual | When to use | Hover | Active | Disabled | Loading |
|---|---|---|---|---|---|---|
| `primary` | Filled `--accent-primary` | The single primary CTA per screen ("Save", "Record Payment", "Mark All Present") | Brighten accent by 8% (`filter: brightness(1.08)`) | `scale(0.98)` | `opacity: 0.5; cursor: not-allowed` | Spinner replaces label, button non-interactive |
| `secondary` | Glass-ghost (transparent fill + 1px border) | Secondary actions ("Cancel", "Export CSV") | Background → `--surface-glass-faint` | `scale(0.98)` | `opacity: 0.5` | Spinner replaces label |
| `tertiary` | Text link (no fill, no border) | Tertiary actions inside dense rows ("View", "Edit") | Underline + colour shift to `--accent-primary` | `scale(0.98)` | `opacity: 0.5` | Inline spinner to the left |
| `destructive` | Filled `--accent-danger` | Destructive confirmations ("Delete Student", "Void Receipt") | Brighten danger by 8% | `scale(0.98)` | `opacity: 0.5` | Spinner replaces label |
| `icon` | 44×44 minimum, transparent or glass fill | Icon-only actions (search, filter, more, close) | Background → `--surface-glass-faint` | `scale(0.94)` | `opacity: 0.5` | Spinner replaces icon |

### CSS

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: var(--font-body);
  font-size: var(--text-base);
  font-weight: 500;
  line-height: 1;
  letter-spacing: var(--tracking-base);
  border-radius: 10px;
  padding: 0 16px;
  height: 40px;                                /* below 40px is not tappable on mobile */
  cursor: pointer;
  user-select: none;
  transition: transform var(--motion-fast) var(--ease-out),
              background var(--motion-fast) var(--ease-out),
              filter var(--motion-fast) var(--ease-out),
              opacity var(--motion-fast) var(--ease-out);
  border: 1px solid transparent;
}

/* Sizes */
.btn-sm  { height: 32px; padding: 0 12px; font-size: var(--text-sm); border-radius: 8px; }
.btn-md  { height: 40px; padding: 0 16px; font-size: var(--text-base); }
.btn-lg  { height: 48px; padding: 0 24px; font-size: var(--text-md); border-radius: 12px; }

/* Primary */
.btn-primary {
  background: var(--accent-primary);
  color: var(--text-on-accent);
}
.btn-primary:hover:not(:disabled)  { filter: brightness(1.08); }
.btn-primary:active:not(:disabled) { transform: scale(0.98); }
.btn-primary:disabled              { opacity: 0.5; cursor: not-allowed; }

/* Secondary — glass ghost */
.btn-secondary {
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border-strong);
  backdrop-filter: blur(8px);
}
.btn-secondary:hover:not(:disabled)  { background: var(--surface-glass-faint); }
.btn-secondary:active:not(:disabled) { transform: scale(0.98); }
.btn-secondary:disabled              { opacity: 0.5; cursor: not-allowed; }

/* Tertiary — text link */
.btn-tertiary {
  background: transparent;
  color: var(--text-secondary);
  border: none;
  padding: 0 4px;
  height: auto;
}
.btn-tertiary:hover:not(:disabled)  { color: var(--accent-primary); text-decoration: underline; text-underline-offset: 4px; }
.btn-tertiary:active:not(:disabled) { transform: scale(0.98); }
.btn-tertiary:disabled              { opacity: 0.5; cursor: not-allowed; }

/* Destructive */
.btn-destructive {
  background: var(--accent-danger);
  color: var(--text-on-accent);
}
.btn-destructive:hover:not(:disabled)  { filter: brightness(1.08); }
.btn-destructive:active:not(:disabled) { transform: scale(0.98); }
.btn-destructive:disabled              { opacity: 0.5; cursor: not-allowed; }

/* Icon-only */
.btn-icon {
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid transparent;
}
.btn-icon:hover:not(:disabled)  { background: var(--surface-glass-faint); color: var(--text-primary); }
.btn-icon:active:not(:disabled) { transform: scale(0.94); }
.btn-icon:disabled              { opacity: 0.5; cursor: not-allowed; }

/* Loading — spinner replaces label/icon; button becomes non-interactive */
.btn-loading { pointer-events: none; }
.btn-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: btn-spin 0.8s linear infinite;
}
@keyframes btn-spin { to { transform: rotate(360deg); } }

/* Focus ring — NEVER removed (see 05_Accessibility_Contract.md §2) */
.btn:focus-visible {
  outline: 2px solid var(--accent-cyan);
  outline-offset: 2px;
}
```

### React Skeleton

```tsx
// src/components/ui/button.tsx
import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, icon, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn('btn', `btn-${variant}`, `btn-${size}`, loading && 'btn-loading', className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="btn-spinner" aria-hidden /> : (
        <>
          {icon && <span aria-hidden>{icon}</span>}
          {children}
        </>
      )}
    </button>
  )
);
Button.displayName = 'Button';
```

---

## §5 Chip / Badge Variants

> Status chips appear in every table — paid / partial / overdue / excused / info. Each is a tinted pill: 8% accent background + 1px border + accent dot + label text. Colour is **never** the only signal (see `05_Accessibility_Contract.md` §7) — every chip has a text label AND an icon.

### The Tinting Recipe

```css
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1;
  letter-spacing: var(--tracking-xs);
  white-space: nowrap;
}

/* The 8% accent + 1px border + accent-dot recipe */
.chip-paid      { background: color-mix(in srgb, var(--accent-success) 8%, transparent);
                  border: 1px solid color-mix(in srgb, var(--accent-success) 25%, transparent);
                  color: var(--accent-success); }
.chip-partial   { background: color-mix(in srgb, var(--accent-warning) 8%, transparent);
                  border: 1px solid color-mix(in srgb, var(--accent-warning) 25%, transparent);
                  color: var(--accent-warning); }
.chip-overdue   { background: color-mix(in srgb, var(--accent-danger) 8%, transparent);
                  border: 1px solid color-mix(in srgb, var(--accent-danger) 25%, transparent);
                  color: var(--accent-danger); }
.chip-excused   { background: color-mix(in srgb, var(--text-muted) 8%, transparent);
                  border: 1px solid color-mix(in srgb, var(--text-muted) 25%, transparent);
                  color: var(--text-secondary); }
.chip-info      { background: color-mix(in srgb, var(--accent-info) 8%, transparent);
                  border: 1px solid color-mix(in srgb, var(--accent-info) 25%, transparent);
                  color: var(--accent-info); }

/* The accent dot — the colour signal that survives a black-and-white printout */
.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
```

### Semantic Variants Table

| Semantic | Token source | Icon (lucide) | Label | When |
|---|---|---|---|---|
| Paid | `--accent-success` | `Check` | "Paid" | Fee fully collected for the period |
| Partial | `--accent-warning` | `CircleDashed` | "Partial" | Fee partially collected (some paise outstanding) |
| Overdue | `--accent-danger` | `AlertCircle` | "Overdue" | Fee past due date with zero collection |
| Excused | `--text-muted` | `Minus` | "Excused" | Student excused for the period (no fee expected) |
| Info | `--accent-info` | `Info` | "Info" | Neutral info chip (e.g. "Auto-renew on") |

### React Skeleton

```tsx
// src/components/ui/chip.tsx
import { forwardRef, HTMLAttributes } from 'react';
import { Check, CircleDashed, AlertCircle, Minus, Info, LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  paid: Check, partial: CircleDashed, overdue: AlertCircle, excused: Minus, info: Info,
};
const LABELS: Record<string, string> = {
  paid: 'Paid', partial: 'Partial', overdue: 'Overdue', excused: 'Excused', info: 'Info',
};

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant: 'paid' | 'partial' | 'overdue' | 'excused' | 'info';
  label?: string;
}

export const Chip = forwardRef<HTMLSpanElement, ChipProps>(
  ({ className, variant, label, ...props }, ref) => {
    const Icon = ICONS[variant];
    return (
      <span ref={ref} className={cn('chip', `chip-${variant}`, className)} {...props}>
        <Icon className="w-3 h-3" aria-hidden />
        <span className="chip-dot" aria-hidden />
        {label ?? LABELS[variant]}
      </span>
    );
  }
);
Chip.displayName = 'Chip';
```

> **Rule:** Every chip ships with BOTH an icon AND a text label. A red dot alone is forbidden — colour-blind users (8% of Indian men) cannot distinguish a red overdue dot from a green paid dot.

---

## §6 KPI Card Anatomy

> Used heavily in Dashboard and Reports. A KPI card answers a single question: "What is the value of X right now, and is it better or worse than last period?"

### Anatomy

```
┌────────────────────────────────────────────┐
│  [Period Toggle: M | Q | Y]      [⋯ menu]  │
│                                            │
│  Collected This Month              ←label  │
│  ₹1,50,000                         ←figure │
│  ↑ +12.4% vs last month            ←delta  │
│                                            │
│  ▁▂▄▅▇▆▄▂▁                          ←sparkline │
└────────────────────────────────────────────┘
```

| Element | Token | Notes |
|---|---|---|
| Label | `t-sm fw-medium` `--text-secondary` | Top-left, "Collected This Month" |
| Figure | `t-5xl fw-bold font-mono tnum` `--text-primary` | The hero number — 48px, mono, tabular |
| Delta | `t-sm fw-medium` `--accent-success` (positive) or `--accent-danger` (negative) | `↑ +12.4%` or `↓ -3.1%`; arrow icon + percentage |
| Sparkline | 40px tall, `--accent-primary` line, no axis | Last 7 data points; animates only on first mount per `04_Motion_and_Microinteractions.md` §4 `chartDraw` |
| Period toggle | 3-segment control (M/Q/Y) | Switches the figure + sparkline + delta to that period |
| Overflow menu | `⋯` icon button | Export, drill-down, configure |

### CSS

```css
.kpi-card { /* extends glass-card */
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 280px;
}
.kpi-label  { font-size: var(--text-sm); font-weight: 500; color: var(--text-secondary); }
.kpi-figure { font-size: var(--text-5xl); font-weight: 700;
              font-family: var(--font-mono);
              font-variant-numeric: tabular-nums;
              font-feature-settings: "tnum" 1;
              color: var(--text-primary); line-height: 1.1; }
.kpi-delta  { font-size: var(--text-sm); font-weight: 500; display: inline-flex; align-items: center; gap: 4px; }
.kpi-delta-up    { color: var(--accent-success); }
.kpi-delta-down  { color: var(--accent-danger); }
.kpi-sparkline { height: 40px; width: 100%; }
```

### React Skeleton

```tsx
<GlassCard className="kpi-card">
  <header className="flex items-center justify-between">
    <SegmentedControl value={period} onChange={setPeriod} options={['M','Q','Y']} />
    <IconButton icon={<MoreHorizontal />} label="KPI actions" />
  </header>
  <div>
    <div className="kpi-label">Collected This {periodLabel}</div>
    <div className="kpi-figure">{formatINR(collectedPaise)}</div>
    <div className={cn('kpi-delta', delta >= 0 ? 'kpi-delta-up' : 'kpi-delta-down')}>
      {delta >= 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
      {Math.abs(delta).toFixed(1)}% vs last {periodLabel.toLowerCase()}
    </div>
  </div>
  <Sparkline data={sparkData} stroke="var(--accent-primary)" />
</GlassCard>
```

---

## §7 Data Table Recipe

> The Fees ledger, the Students master, the Attendance register, the Reports tables — all use this recipe. Sticky header, zebra rows, right-aligned money, hover-highlight, selected-row left-bar, tabular numerics on every numeric column.

### Recipe

```css
.data-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-family: var(--font-body);
  font-size: var(--text-base);
  color: var(--text-primary);
}

/* Sticky header — survives vertical scroll */
.data-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface-glass-strong);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-strong);
  padding: 12px 16px;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
  text-align: left;
  white-space: nowrap;
}

/* Sortable header — aria-sort set by Radix */
.data-table th[aria-sort="ascending"]::after  { content: ' ↑'; color: var(--accent-primary); }
.data-table th[aria-sort="descending"]::after { content: ' ↓'; color: var(--accent-primary); }

/* Zebra rows — even rows get a faint tint for scanning */
.data-table tbody tr:nth-child(even) {
  background: color-mix(in srgb, var(--text-primary) 2%, transparent);
}

/* Hover highlight — subtle lift, NOT a colour change */
.data-table tbody tr:hover {
  background: color-mix(in srgb, var(--accent-primary) 6%, transparent);
}

/* Selected row — 3px accent left-bar */
.data-table tbody tr[data-selected="true"] {
  background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  box-shadow: inset 3px 0 0 var(--accent-primary);
}

/* Cells */
.data-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-default);
  vertical-align: middle;
}

/* Money column — right-aligned + tabular */
.data-table td.money-cell,
.data-table th.money-col {
  text-align: right;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  white-space: nowrap;
}

/* Name column — left-aligned, body font */
.data-table td.name-cell,
.data-table th.name-col {
  text-align: left;
}

/* Action column — right-aligned buttons */
.data-table td.action-cell {
  text-align: right;
  white-space: nowrap;
}

/* Focus ring on rows for keyboard nav (see 05_Accessibility_Contract.md §3) */
.data-table tbody tr:focus-visible {
  outline: 2px solid var(--accent-cyan);
  outline-offset: -2px;
}
```

### Keyboard Navigation (per `05_Accessibility_Contract.md` §3)

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Move between table and other focusables |
| `↑` / `↓` | Move row focus up/down (table must be a `tabindex` roving container) |
| `Enter` | Open the row's default action (e.g. student profile) |
| `Space` | Toggle row selection (multi-select mode) |
| `Escape` | Clear selection |

### React Skeleton (TanStack Table)

```tsx
<Table className="data-table">
  <thead>
    {table.getHeaderGroups().map(hg => (
      <tr key={hg.id}>
        {hg.headers.map(header => (
          <th
            key={header.id}
            aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending'
                       : header.column.getIsSorted() === 'desc' ? 'descending' : 'none'}
            className={cn(header.column.columnDef.meta?.align === 'right' && 'money-col')}
            onClick={header.column.getToggleSortingHandler()}
          >
            {flexRender(header.column.columnDef.header, header.getContext())}
          </th>
        ))}
      </tr>
    ))}
  </thead>
  <tbody>
    {table.getRowModel().rows.map(row => (
      <tr
        key={row.id}
        data-selected={row.getIsSelected()}
        tabIndex={0}
        onKeyDown={(e) => handleRowKeydown(e, row)}
      >
        {row.getVisibleCells().map(cell => (
          <td key={cell.id} className={cn(cell.column.columnDef.meta?.align === 'right' && 'money-cell')}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
      </tr>
    ))}
  </tbody>
</Table>
```

---

## §8 Form Input Recipe

> Forms appear in Settings, Student enrolment, Fee change, Receipt entry, and Auth. Every input has a visible label, helper text below, error below that, and a focus ring at `--accent-cyan` 0.4 opacity. Touch height is 44px minimum.

### Recipe

```css
.form-field { display: flex; flex-direction: column; gap: 6px; }

.form-label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
}
.form-label .required { color: var(--accent-danger); margin-left: 2px; }
.form-label .optional { color: var(--text-muted); font-weight: 400; margin-left: 6px; font-size: var(--text-xs); }

.form-input,
.form-select,
.form-textarea {
  height: 44px;                                   /* touch target minimum */
  padding: 0 12px;
  background: var(--surface-glass);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: var(--text-base);
  transition: border-color var(--motion-fast) var(--ease-out),
              box-shadow var(--motion-fast) var(--ease-out);
}
.form-textarea { height: auto; min-height: 96px; padding: 12px; resize: vertical; }

.form-input:hover,
.form-select:hover,
.form-textarea:hover { border-color: var(--accent-primary); }

.form-input:focus-visible,
.form-select:focus-visible,
.form-textarea:focus-visible {
  outline: none;
  border-color: var(--accent-cyan);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-cyan) 40%, transparent);
}

.form-input::placeholder { color: var(--text-muted); }

.form-helper {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.form-error {
  font-size: var(--text-xs);
  color: var(--accent-danger);
  display: flex; align-items: center; gap: 4px;
}

.form-input[aria-invalid="true"],
.form-select[aria-invalid="true"],
.form-textarea[aria-invalid="true"] {
  border-color: var(--accent-danger);
}
.form-input[aria-invalid="true"]:focus-visible,
.form-select[aria-invalid="true"]:focus-visible,
.form-textarea[aria-invalid="true"]:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-danger) 40%, transparent);
}

.form-input:disabled { opacity: 0.5; cursor: not-allowed; }
```

### React Skeleton

```tsx
<div className="form-field">
  <label htmlFor="fee" className="form-label">
    Monthly Fee <span className="required" aria-hidden>*</span>
    <span className="optional">(in ₹)</span>
  </label>
  <input
    id="fee"
    type="number"
    className="form-input"
    aria-describedby="fee-helper fee-error"
    aria-invalid={!!errors.fee}
    aria-required="true"
    autoComplete="off"
    {...register('fee')}
  />
  {errors.fee ? (
    <p id="fee-error" className="form-error" role="alert">
      <AlertCircle size={12} aria-hidden /> {errors.fee.message}
    </p>
  ) : (
    <p id="fee-helper" className="form-helper">
      Quarterly = 3×, Annual = 12×. Use whole rupees only.
    </p>
  )}
</div>
```

> **Rules:** (1) Placeholder is NOT a label — the visible `<label>` is mandatory. (2) Error has `role="alert"` so screen readers announce it immediately. (3) `aria-describedby` links input → helper/error so screen readers read context after the label. (4) `aria-invalid` flips the border colour to danger.

---

## §9 Modal / Sheet / Drawer Recipes

> Three overlay surfaces, one recipe family. All use `--surface-glass-strong` for the surface, `backdrop-filter: blur(8px)` for the backdrop, and a slide-from-bottom (mobile) or scale+fade (desktop) entrance per `04_Motion_and_Microinteractions.md` §4.

| Surface | Mobile | Desktop | Width | Close on backdrop click | Close on Esc |
|---|---|---|---|---|---|
| Modal | Bottom sheet (slide up, 90vh) | Centre dialog (scale+fade, max 560px) | 560px max | yes | yes |
| Sheet | Bottom sheet (slide up, full height) | Right-side sheet (slide from right, 480px) | 480px | yes | yes |
| Drawer | Left drawer (slide from left, 84vw) | Left drawer (slide from left, 320px) | 320px | no (must use close button) | yes |

### CSS

```css
.overlay-backdrop {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--bg-canvas) 60%, transparent);
  backdrop-filter: blur(8px);
  z-index: 50;
}

.overlay-surface {
  background: var(--surface-glass-strong);
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--border-glass-strong);
  border-radius: 16px;
  box-shadow:
    0 1px 0 0 rgba(255,255,255,0.14) inset,
    0 24px 80px 0 var(--shadow-color);
}

/* Modal — desktop center */
.modal-desktop {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: min(560px, calc(100vw - 48px));
  max-height: calc(100vh - 96px);
  overflow-y: auto;
}

/* Sheet — mobile bottom */
.sheet-mobile {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  border-radius: 16px 16px 0 0;
  max-height: 90vh;
  overflow-y: auto;
  padding-bottom: env(safe-area-inset-bottom);  /* iOS home indicator */
}

/* Drawer — left */
.drawer-left {
  position: fixed;
  top: 0; bottom: 0; left: 0;
  width: min(320px, 84vw);
  border-radius: 0 16px 16px 0;
  overflow-y: auto;
}
```

### React Skeleton (Radix Dialog)

```tsx
<Dialog>
  <DialogTrigger asChild><Button variant="primary">Record Payment</Button></DialogTrigger>
  <DialogPortal>
    <DialogOverlay className="overlay-backdrop" />
    <DialogContent className="overlay-surface modal-desktop">
      <DialogHeader>
        <DialogTitle className="t-xl fw-semibold font-heading">Record Payment</DialogTitle>
        <DialogDescription className="t-sm text-secondary">
          Enter the amount collected from Riya Sharma for June 2026.
        </DialogDescription>
      </DialogHeader>
      {/* form fields */}
      <DialogFooter>
        <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="primary" loading={isSubmitting}>Save Payment</Button>
      </DialogFooter>
    </DialogContent>
  </DialogPortal>
</Dialog>
```

> **A11y contract:** Radix Dialog handles focus-trap and focus-return automatically. The `DialogDescription` is required — Radix warns if missing because screen readers need context.

---

## §10 Navigation Recipes

> Four navigation surfaces: left sidebar (web/desktop), bottom tab bar (mobile, max 5 items), breadcrumbs (web), command palette (Cmd+K). All consume the same nav tokens.

### Left Sidebar (web/desktop)

```css
.sidebar {
  width: 256px;
  height: 100vh;
  position: sticky;
  top: 0;
  background: var(--surface-glass);
  backdrop-filter: blur(24px);
  border-right: 1px solid var(--border-glass);
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
}
.sidebar-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  color: var(--text-secondary);
  font-size: var(--text-base);
  font-weight: 500;
  height: 44px;
  transition: background var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out);
}
.sidebar-item:hover { background: var(--surface-glass-faint); color: var(--text-primary); }
.sidebar-item[data-active="true"] {
  background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  color: var(--accent-primary);
  box-shadow: inset 3px 0 0 var(--accent-primary);
}
.sidebar-item:focus-visible {
  outline: 2px solid var(--accent-cyan);
  outline-offset: -2px;
}
```

### Bottom Tab Bar (mobile, max 5 items)

```css
.tabbar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  height: calc(56px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--surface-glass-strong);
  backdrop-filter: blur(24px);
  border-top: 1px solid var(--border-glass);
  display: flex;
  z-index: 30;
}
.tabbar-item {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 500;
  min-width: 44px;                         /* touch target */
  min-height: 44px;
}
.tabbar-item[data-active="true"] { color: var(--accent-primary); }
```

> **Max 5 items rule:** More than 5 and the touch targets drop below 44px on a 375px-wide phone. The 6th destination goes into a "More" sheet.

### Breadcrumbs (web)

```tsx
<nav aria-label="Breadcrumb" className="flex items-center gap-2 t-sm text-secondary">
  <ol className="flex items-center gap-2">
    <li><a href="/students" className="hover:text-[var(--accent-primary)]">Students</a></li>
    <li aria-hidden>/</li>
    <li><a href="/students/riya-sharma" className="hover:text-[var(--accent-primary)]">Riya Sharma</a></li>
    <li aria-hidden>/</li>
    <li aria-current="page" className="text-primary">Fee History</li>
  </ol>
</nav>
```

### Command Palette (Cmd+K)

Built on [`cmdk`](https://cmdk.paco.me/) (shadcn wraps it). Opens with `Cmd+K` (macOS) / `Ctrl+K` (Win/Linux) / long-press home gesture (mobile). Glass-strong surface, scale+fade entrance per `04_Motion_and_Microinteractions.md` §4 `modalEnter`.

```tsx
<CommandDialog open={open} onOpenChange={setOpen}>
  <CommandInput placeholder="Search students, fees, actions…" />
  <CommandList>
    <CommandGroup heading="Students">
      <CommandItem onSelect={() => router.push('/students/riya-sharma')}>
        <UserIcon /> Riya Sharma
      </CommandItem>
    </CommandGroup>
    <CommandGroup heading="Actions">
      <CommandItem onSelect={() => router.push('/fees?new=payment')}>
        <PlusIcon /> Record Payment
      </CommandItem>
    </CommandGroup>
  </CommandList>
</CommandDialog>
```

---

## §11 Chart Recipe

> Charts use [Recharts](https://recharts.org/) with palette-aware colors via CSS variables. Gridlines low-contrast. Tooltip is a glass card. Legend is interactive (click to toggle series). Skeleton while loading. Reduced-motion = no entrance animation.

### Recipe

```tsx
<ResponsiveContainer width="100%" height={300}>
  <AreaChart data={data}>
    <defs>
      <linearGradient id="grad-collected" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stopColor="var(--accent-primary)" stopOpacity={0.3} />
        <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity={0} />
      </linearGradient>
    </defs>
    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
    <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false}
           tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
    <Tooltip
      contentStyle={{
        background: 'var(--surface-glass-strong)',
        border: '1px solid var(--border-glass-strong)',
        borderRadius: '12px',
        backdropFilter: 'blur(24px)',
      }}
      labelStyle={{ color: 'var(--text-secondary)', fontSize: 12 }}
      itemStyle={{ color: 'var(--text-primary)', fontSize: 14 }}
      formatter={(v: number) => formatINR(v)}
    />
    <Legend wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12 }} />
    <Area
      type="monotone"
      dataKey="collected"
      stroke="var(--accent-primary)"
      strokeWidth={2}
      fill="url(#grad-collected)"
      isAnimationActive={!prefersReducedMotion}    /* see 04_Motion §6 */
      animationDuration={600}                       /* chartDraw token */
    />
  </AreaChart>
</ResponsiveContainer>
```

### Chart Accessibility

- The `<svg>` from Recharts gets `role="img"` and `aria-label="Collected vs expected for the last 12 months: collected peaked at ₹1,50,000 in June."`
- A visually-hidden `<table>` of the same data sits below the chart — screen readers read the table, not the SVG.
- Legend is keyboard-focusable; `Enter` toggles series visibility.

### Skeleton (while loading)

```tsx
{isLoading ? <ChartSkeleton height={300} /> : <Chart data={data} />}
// ChartSkeleton = boneyard-js shimmer rectangle matching the chart's dimensions
```

---

## §12 Empty State Recipe

> Every list/grid has an empty state. A blank screen is a bug. The recipe: illustration + headline + sub-headline + primary CTA.

### Recipe

```tsx
<div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-4">
  <div className="w-24 h-24 rounded-full flex items-center justify-center"
       style={{ background: 'var(--surface-glass-faint)' }}>
    <UsersIcon size={40} style={{ color: 'var(--text-muted)' }} aria-hidden />
  </div>
  <div>
    <h3 className="t-xl fw-semibold font-heading" style={{ color: 'var(--text-primary)' }}>
      No students yet
    </h3>
    <p className="t-base mt-1" style={{ color: 'var(--text-secondary)' }}>
      Add your first student to start tracking attendance and fees.
    </p>
  </div>
  <Button variant="primary" icon={<Plus size={16} />} onClick={() => router.push('/students/new')}>
    Add Student
  </Button>
</div>
```

---

## §13 Toast Recipe

> Toasts are non-blocking notifications. Bottom-right on web, top on mobile. `aria-live="polite"`. Auto-dismiss 4s. Swipe-to-dismiss on mobile.

```tsx
<ToastProvider>
  <Toast className="overlay-surface" duration={4000}>
    <ToastTitle>Payment recorded</ToastTitle>
    <ToastDescription>₹1,500 collected from Riya Sharma for June 2026.</ToastDescription>
    <ToastClose aria-label="Dismiss notification" />
  </Toast>
</ToastProvider>
```

```css
.toast-viewport-web {
  position: fixed;
  bottom: 24px; right: 24px;
  display: flex; flex-direction: column; gap: 8px;
  z-index: 60;
  max-width: 420px;
}
.toast-viewport-mobile {
  position: fixed;
  top: calc(12px + env(safe-area-inset-top));
  left: 12px; right: 12px;
  z-index: 60;
}
```

> **Auto-dismiss contract:** 4s for success/info, 6s for warning, persistent for error (must be dismissed manually). Swipe-to-dismiss on mobile via `onTouchStart`/`onTouchMove` translate-x.

---

## §14 Avatar Recipe

> Avatars show a photo if available, else initials on a palette-derived background. Active state = 2px ring in `--accent-primary`.

```tsx
<div className="relative inline-flex">
  {photoUrl ? (
    <img src={photoUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
  ) : (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center font-medium text-sm"
      style={{
        background: `color-mix(in srgb, var(--accent-primary) 15%, var(--bg-surface-raised))`,
        color: 'var(--accent-primary)',
      }}
      aria-hidden
    >
      {initials}                                    {/* "RS" for Riya Sharma */}
    </div>
  )}
  {isActive && (
    <span
      className="absolute inset-0 rounded-full ring-2"
      style={{ ringColor: 'var(--accent-primary)' }}
      aria-hidden
    />
  )}
</div>
```

> **Initials algorithm:** First letter of first name + first letter of last name, uppercased. For Devanagari names, use the first letter of each word (e.g. `रिया शर्मा` → `रश`).

---

## §15 Sticky Footer Contract

> Every page has a sticky footer at the bottom, even on short pages. The root layout uses `min-h-screen flex flex-col`; the footer uses `mt-auto`.

### Root Layout

```tsx
// app/layout.tsx
<html lang="en" data-palette={palette} data-theme={theme} data-typography={typography}>
  <body className="min-h-screen flex flex-col">
    <SkipLink />                                  {/* first focusable element — see 05_A11y §5 */}
    <Header />
    <main id="main" className="flex-1">
      {children}
    </main>
    <Footer className="mt-auto" />
  </body>
</html>
```

### Footer Recipe

```css
.footer {
  background: var(--surface-glass);
  backdrop-filter: blur(24px);
  border-top: 1px solid var(--border-glass);
  padding: 24px;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  padding-bottom: calc(24px + env(safe-area-inset-bottom));   /* iOS home indicator */
}
```

```tsx
<footer className="footer mt-auto">
  <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
    <p>© 2026 Buddysaradhi TutorOS. Made in India.</p>
    <nav aria-label="Footer" className="flex gap-4">
      <a href="/privacy" className="hover:text-[var(--accent-primary)]">Privacy</a>
      <a href="/terms"   className="hover:text-[var(--accent-primary)]">Terms</a>
      <a href="/help"    className="hover:text-[var(--accent-primary)]">Help</a>
    </nav>
  </div>
</footer>
```

> **The `mt-auto` rule:** Without `mt-auto`, a short page leaves the footer floating in the middle of the viewport. `mt-auto` pushes it to the bottom of the flex column, so a page with 3 rows of content has the footer at the viewport bottom — not at row 4.

---

## Status

- **Author:** UI/UX Lead (Task 13-FOUNDATION-DOCS)
- **State:** COMPLETED
- **Depends on:** `00_Design_System_Overview.md` §5 (10 non-negotiables, esp. rules 4/5/8), `01_Color_Palettes.md` (all 8 palettes' tokens drive component colours), `02_Typography_System.md` (component text uses `--text-*` tokens), `04_Motion_and_Microinteractions.md` (hover/active durations), `05_Accessibility_Contract.md` §2/§3/§7/§8 (focus ring, keyboard nav, chip icons, 44px touch)
- **Consumers:** every page mockup (`web/*.md`, `mobile/*.md`, `desktop/*.md`), the web agent (implementation in `src/components/ui/*`)
- **Components defined:** 15 (Glass Card, Neumorphic Controls, Button, Chip, KPI Card, Data Table, Form Input, Modal/Sheet/Drawer, Sidebar/Tabbar/Breadcrumb/CmdK, Chart, Empty State, Toast, Avatar, Sticky Footer)
- **Every component consumes `var(--*)` tokens — zero raw hex.**
