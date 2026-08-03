# 05 — Accessibility Contract

> The accessibility contract for every screen on every platform of **Buddysaradhi TutorOS**. Accessibility is a **palette property**, not an afterthought — every palette in `01_Color_Palettes.md` ships with a contrast report, and every component in `03_Component_Library.md` ships with ARIA attributes, keyboard handlers, and focus-visible styles. This file codifies the rules that make those individual efforts compose into a fully accessible app.

---

## §1 WCAG 2.1 AA is the Floor, AAA is the Target

> WCAG 2.1 **Level AA** is the minimum legal and moral floor. **Level AAA** is the target wherever it does not compromise usability. All 8 palettes in `01_Color_Palettes.md` have been verified AA in both light and dark variants; most pairs hit AAA.

### The Floor (AA — non-negotiable)

| WCAG criterion | Requirement | How we meet it |
|---|---|---|
| 1.4.3 Contrast (Minimum) | Text ≥ 4.5:1; large text (≥18pt or 14pt bold) ≥ 3:1 | Every `--text-*` on `--bg-*` pair verified in `01_Color_Palettes.md` contrast reports |
| 1.4.11 Non-text Contrast | UI components & graphical objects ≥ 3:1 | Icon strokes, chart lines, borders all ≥ 3:1 against their surface |
| 2.1.1 Keyboard | All functionality operable from keyboard | See §3 — keyboard nav maps per page type |
| 2.1.2 No Keyboard Trap | Focus can move into and out of any component | Modals use Radix Dialog (focus-trap + Esc-to-close + focus-return) |
| 2.4.3 Focus Order | Tab order follows reading order | DOM order = visual order; no `tabindex` manipulation except roving tabindex on grids |
| 2.4.7 Focus Visible | Visible focus indicator | See §2 — 2-4px `--accent-cyan` ring at 0.4 opacity, never removed |
| 3.3.2 Labels or Instructions | Form inputs have visible labels | See §11 — no placeholder-only inputs |
| 4.1.2 Name, Role, Value | Every interactive element has accessible name + role | Radix primitives handle this; icon-only buttons get `aria-label` |
| 4.1.3 Status Messages | Status messages announced without stealing focus | Toasts use `aria-live="polite"` (see §4) |

### The Target (AAA — wherever feasible)

| WCAG criterion | Requirement | How we hit it |
|---|---|---|
| 1.4.6 Contrast (Enhanced) | Text ≥ 7:1; large text ≥ 4.5:1 | Most `text-primary` on `bg-canvas` pairs hit 15-17:1 (AAA); only `text-on-accent` on small accent fills sits at AA |
| 2.1.3 Keyboard (No Exception) | All functionality operable from keyboard, no exceptions | No "mouse-only" features; drag-and-drop has keyboard alternatives |
| 2.4.8 Location | Breadcrumbs on multi-step pages | Breadcrumbs on web (see `03_Component_Library.md` §10) |
| 2.4.10 Section Headings | Section headings on every page | Every page has h1 + h2 sections (see §6) |
| 3.3.5 Help | Context-sensitive help available | Helper text under every form input (see `03_Component_Library.md` §8); `?` icon buttons on complex screens |

### Per-Palette Verification

Every palette in `01_Color_Palettes.md` §<palette> ships a **Contrast report** table listing every text-on-surface pair with its ratio and grade. A palette that fails AA on any pair is rejected before it ships. The contrast reports are:

- **Aurora Cosmic** (dark only) — all pairs AA or AAA
- **Saffron Marigold** (light + dark) — all pairs AA or AAA
- **Emerald Ledger** (light + dark) — all pairs AA or AAA
- **Cyan Lagoon** (light + dark) — all pairs AA or AAA
- **Rose Petal** (light + dark) — all pairs AA or AAA
- **Amber Sunrise** (light + dark) — all pairs AA or AAA
- **Violet Nebula** (light + dark) — all pairs AA or AAA
- **Midnight Slate** (light only) — all pairs AA or AAA

> **CI gate:** axe-core runs in CI on every palette × theme combination. A palette that fails AA blocks the build. See §14 QA checklist item 1.

---

## §2 Focus Management

> The visible focus ring is the **most important accessibility affordance** in a keyboard-navigable app. A tutor who tabs through the Fees ledger needs to see exactly which button, link, or row has focus. Removing the focus ring is a P0 accessibility violation.

### The Focus Ring Contract

| Property | Value | Notes |
|---|---|---|
| `outline-width` | 2-4px | 2px for tight components (chips, icons), 3-4px for buttons and inputs |
| `outline-color` | `--accent-cyan` at 0.4 opacity | Cyan because it's the info accent and high-contrast on all 8 palettes |
| `outline-offset` | 2px | Sits *outside* the element so it doesn't overlap the border |
| `border-radius` | matches element | The outline follows the element's shape |
| State | `:focus-visible` only | `:focus` would show on mouse click too, which is noisy; `:focus-visible` is keyboard-only |

```css
/* Global focus-visible contract — applied to every interactive element */
*:focus-visible {
  outline: 2px solid var(--accent-cyan);
  outline-offset: 2px;
  border-radius: inherit;
}

/* Stronger ring for form inputs (already styled in 03_Component_Library.md §8) */
.form-input:focus-visible,
.form-select:focus-visible,
.form-textarea:focus-visible {
  outline: none;  /* replaced by box-shadow ring */
  border-color: var(--accent-cyan);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-cyan) 40%, transparent);
}

/* NEVER do this: */
/* *:focus { outline: none; } */   /* removes keyboard focus — P0 a11y violation */
```

### Logical Tab Order

The DOM order IS the tab order. We do not manipulate `tabindex` except in two cases:

1. **Roving tabindex on grid/table rows** — only one row has `tabindex="0"`; the rest have `tabindex="-1"`. Arrow keys move the `0` between rows. This is the WAI-ARIA grid pattern.
2. **Off-screen/drawer elements** — `tabindex="-1"` on elements that should not be tab-reachable when hidden. When the drawer opens, programmatically focus the first element inside it.

### Focus-Trap in Modals

Radix Dialog handles this automatically:

```tsx
<Dialog>
  <DialogContent>
    {/* When this opens, focus moves to the first focusable element inside.
        Tab cycles within the dialog. Esc closes. On close, focus returns to
        the trigger button. */}
  </DialogContent>
</Dialog>
```

> **Audit:** If you build a custom modal (not Radix), you must implement focus-trap manually. Lint rule `no-custom-modal-without-focus-trap.test.ts` fails on any `<div role="dialog">` that doesn't import a focus-trap utility.

### Focus-Return on Close

When a modal/drawer/sheet closes, focus returns to the element that opened it. Radix handles this automatically. For custom overlays:

```tsx
const triggerRef = useRef<HTMLButtonElement>(null);
const [open, setOpen] = useState(false);

const handleClose = () => {
  setOpen(false);
  // Return focus to the trigger after the close animation completes
  setTimeout(() => triggerRef.current?.focus(), 250);  // --motion-base
};
```

---

## §3 Keyboard Navigation Maps

> Four page types, four keyboard nav contracts. Memorise these; QA tests them.

### Dashboard (card-grid layout)

| Key | Action |
|---|---|
| `Tab` | Move forward through: skip link → header nav → KPI cards (in order) → chart → recent-activity list → footer |
| `Shift+Tab` | Reverse of Tab |
| `Enter` / `Space` | Activate focused KPI card (drill-down to detail page) |
| `Escape` | Close any open command palette / popover |
| `?` | Open keyboard-shortcuts help sheet |
| `Cmd+K` / `Ctrl+K` | Open command palette |

### Table (Fees ledger, Students master, Attendance register)

| Key | Action |
|---|---|
| `Tab` | Move into the table (focus lands on first row, `tabindex="0"`) |
| `↑` / `↓` | Move row focus up / down (roving tabindex) |
| `Home` / `End` | Jump to first / last row |
| `PageUp` / `PageDown` | Jump 10 rows up / down |
| `Enter` | Open focused row's default action (e.g. student profile, fee detail) |
| `Space` | Toggle row selection (multi-select mode only) |
| `Escape` | Clear selection |
| `Tab` (from inside table) | Move to the next focusable element *after* the table |
| `Cmd+A` / `Ctrl+A` | Select all rows (multi-select mode) |

### Form (Settings, Student enrolment, Fee change, Receipt entry, Auth)

| Key | Action |
|---|---|
| `Tab` | Move forward through: field label → input → helper/error → next field |
| `Shift+Tab` | Reverse of Tab |
| `Enter` | Submit form (if the focused element is the submit button) or move to next field (for inputs without explicit submit) |
| `Space` | Toggle checkbox / radio / switch |
| `Escape` | Cancel form (if a cancel button exists; otherwise no-op) |
| `Cmd+Enter` / `Ctrl+Enter` | Submit form from any field (global shortcut) |

### Modal / Sheet / Drawer

| Key | Action |
|---|---|
| `Tab` | Cycle within the modal (focus-trap) |
| `Shift+Tab` | Reverse cycle within the modal |
| `Enter` / `Space` | Activate focused button |
| `Escape` | Close modal; focus returns to trigger |

### Command Palette (Cmd+K)

| Key | Action |
|---|---|
| `↑` / `↓` | Move selection up / down through results |
| `Enter` | Activate selected result |
| `Escape` | Close palette; focus returns to the element that had focus before opening |
| `Tab` | Move focus between search input and result list |

---

## §4 Screen Reader Patterns

> Five patterns that cover 90% of screen-reader edge cases. The other 10% is per-component ARIA documented in `03_Component_Library.md`.

### 1. `aria-label` on Icon-Only Buttons

An icon-only button (the search button, filter button, more-menu button, close button) has **no visible text**. Screen readers would announce nothing — or worse, announce the icon's SVG `title` ("x"). Always set `aria-label`:

```tsx
<IconButton icon={<Search />} aria-label="Search students" onClick={...} />
<IconButton icon={<Filter />} aria-label="Filter by attendance status" onClick={...} />
<IconButton icon={<MoreHorizontal />} aria-label="More actions for Riya Sharma" onClick={...} />
<IconButton icon={<X />} aria-label="Close dialog" onClick={...} />
```

> **Lint rule:** `no-icon-button-without-aria-label.test.ts` — fails on any `<button>` with `aria-label` missing AND only one icon child element.

### 2. `aria-live="polite"` on Toasts

Toasts announce themselves without stealing focus. Use `aria-live="polite"` (not `"assertive"`, which interrupts whatever the screen reader was saying):

```tsx
<Toast aria-live="polite" aria-atomic="true">
  <ToastTitle>Payment recorded</ToastTitle>
  <ToastDescription>₹1,500 collected from Riya Sharma for June 2026.</ToastDescription>
</Toast>
```

> **`aria-atomic="true"`** tells the screen reader to announce the whole toast as one unit, not piecemeal. Without it, the screen reader might announce "Payment recorded" then pause then announce "₹1,500 collected..." — splitting the message.

### 3. `role="alert"` on Form Errors

Form errors must be announced immediately when they appear. Use `role="alert"` (which is implicitly `aria-live="assertive"`, but `role="alert"` is more semantic):

```tsx
{errors.fee && (
  <p id="fee-error" className="form-error" role="alert">
    <AlertCircle size={12} aria-hidden /> {errors.fee.message}
  </p>
)}
```

> **When to use `role="alert"` vs `aria-live="polite"`:** `role="alert"` is for errors that need immediate attention (form validation, sync failures). `aria-live="polite"` is for non-urgent status (payment recorded, sync complete). Never use `aria-live="assertive"` directly — `role="alert"` is the semantic equivalent.

### 4. `aria-sort` on Sortable Table Headers

Sortable columns must announce their sort state:

```tsx
<th
  aria-sort={
    column.getIsSorted() === 'asc' ? 'ascending'
    : column.getIsSorted() === 'desc' ? 'descending'
    : 'none'
  }
  onClick={column.getToggleSortingHandler()}
>
  Amount
</th>
```

Screen reader announces: "Amount, column header, sorted ascending, button".

### 5. `sr-only` Text for Chart Summaries

Charts are SVG; screen readers cannot read them. Provide a visually-hidden text summary:

```tsx
<div role="img" aria-label="Collected vs expected for the last 12 months. Collected peaked at ₹1,50,000 in June 2026. Expected was steady at ₹1,20,000 per month.">
  <ResponsiveContainer>...chart SVG...</ResponsiveContainer>
</div>

{/* Plus a visually-hidden table of the same data for screen readers to navigate */}
<table className="sr-only">
  <caption>Collected vs expected, last 12 months</caption>
  <thead><tr><th>Month</th><th>Collected</th><th>Expected</th></tr></thead>
  <tbody>
    {data.map(d => (
      <tr key={d.month}><td>{d.month}</td><td>{formatINR(d.collected)}</td><td>{formatINR(d.expected)}</td></tr>
    ))}
  </tbody>
</table>
```

```css
.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

---

## §5 Skip Links

> "Skip to main content" must be the **first focusable element** on every page. It is invisible until focused, then becomes visible. A keyboard user presses Tab once and the skip link appears; pressing Enter jumps focus past the header/nav directly to the main content.

### Recipe

```tsx
// In app/layout.tsx, before <Header />
<a
  href="#main"
  className="skip-link"
>
  Skip to main content
</a>

<header>...</header>
<main id="main" tabIndex={-1}>  {/* tabIndex={-1} lets it receive focus programmatically */}
  {children}
</main>
```

```css
.skip-link {
  position: absolute;
  top: -100px;                /* off-screen by default */
  left: 8px;
  z-index: 100;
  padding: 12px 16px;
  background: var(--accent-primary);
  color: var(--text-on-accent);
  border-radius: 8px;
  font-size: var(--text-base);
  font-weight: 500;
  transition: top var(--motion-fast) var(--ease-out);
}
.skip-link:focus {
  top: 8px;                   /* slides into view when focused */
}
```

> **`id="main"` + `tabIndex={-1}`** on the `<main>` element lets the skip link's `href="#main"` actually move focus there (without `tabIndex={-1}`, the browser scrolls to it but doesn't focus it).

---

## §6 Heading Hierarchy

> Exactly one `h1` per page. Sequential `h2` → `h3` → `h4`. No level skip (no `h2` → `h4`).

### The Rule

| Rule | Why |
|---|---|
| Exactly one `h1` per page | Screen reader users navigate by `h1` to identify "what page am I on". Two `h1`s confuse this. |
| Sequential `h2` → `h3` → `h4` | A skip (e.g. `h2` → `h4`) breaks the screen reader's mental model of the page outline. |
| Headings for structure, not style | Never use `h3` because it "looks like the right size" — use the correct heading level + the typography utility class for size. |

### Anti-Pattern

```tsx
// ❌ WRONG: h2 then h4 (skipped h3)
<h2>Reports</h2>
  <h4>Monthly Summary</h4>     {/* skipped h3 */}

// ✅ RIGHT: h2 then h3, with t-lg utility class for visual sizing
<h2 className="t-2xl fw-semibold font-heading">Reports</h2>
  <h3 className="t-lg fw-semibold font-heading">Monthly Summary</h3>
```

### Page Heading Template

```tsx
<>
  <h1 className="t-4xl fw-bold font-heading">{pageTitle}</h1>           {/* e.g. "Fees & Payments" */}
  <section>
    <h2 className="t-2xl fw-semibold font-heading">{sectionTitle}</h2>   {/* e.g. "Outstanding Arrears" */}
    <h3 className="t-xl fw-semibold font-heading">{cardTitle}</h3>       {/* e.g. "Riya Sharma — Monthly Fee" */}
  </section>
</>
```

---

## §7 Colour Is Never the Only Signal

> 8% of Indian men have some colour vision deficiency (deuteranopia/protanopia most common). A red "overdue" chip that relies on colour alone is invisible to them. Every status chip has an icon AND a text label, not just a coloured dot.

### The Chip Contract (from `03_Component_Library.md` §5)

| Semantic | Colour | Icon (lucide) | Text label |
|---|---|---|---|
| Paid | `--accent-success` (green) | `Check` (✓) | "Paid" |
| Partial | `--accent-warning` (amber) | `CircleDashed` (◐) | "Partial" |
| Overdue | `--accent-danger` (red) | `AlertCircle` (✕) | "Overdue" |
| Excused | `--text-muted` (grey) | `Minus` (−) | "Excused" |
| Info | `--accent-info` (cyan) | `Info` (i) | "Info" |

### Anti-Patterns

```tsx
// ❌ WRONG: colour-only status (a red dot)
<span style={{ background: 'var(--accent-danger)' }} className="w-2 h-2 rounded-full" />

// ❌ WRONG: colour + icon but no text (icon meaning not always clear to AT users)
<span className="chip-overdue"><AlertCircle /></span>

// ✅ RIGHT: colour + icon + text
<span className="chip-overdue">
  <AlertCircle aria-hidden />
  <span className="chip-dot" aria-hidden />
  Overdue
</span>
```

> **Lint rule:** `no-colour-only-status.test.ts` — fails on any element with `background: var(--accent-*)` and no text content.

---

## §8 Touch Targets

> Minimum 44×44px (Apple HIG). 8px spacing between targets. Hit area can extend beyond visual bounds (via padding).

### The Rule

| Property | Minimum | Notes |
|---|---|---|
| Width | 44px | Apple HIG; WCAG 2.5.5 (AAA) recommends 44×44 CSS px |
| Height | 44px | Same |
| Spacing between targets | 8px | WCAG 2.4.10 (AAA) recommends ≥ 8px |
| Hit area | Can extend beyond visual bounds | A 32×32 visual icon inside a 44×44 transparent button is compliant |

### Implementation

```tsx
// ❌ WRONG: 32×32 icon button (below 44px minimum)
<button className="p-1"><Search size={24} /></button>

// ✅ RIGHT: 44×44 hit area with 24px icon centred
<button className="btn-icon" aria-label="Search">  {/* btn-icon is 44×44 from 03_Component_Library.md §4 */}
  <Search size={24} aria-hidden />
</button>

// ✅ RIGHT: extend hit area beyond visual bounds via padding
<button className="p-2" aria-label="Close">
  <X size={20} aria-hidden />          {/* 20px visual icon */}
</button>                                {/* 20px + 16px padding = 36px... still below 44! Use btn-icon instead */}
```

### Mobile Bottom Tab Bar

Each tab is minimum 44×44; on a 375px-wide phone with 5 tabs, each tab is 75px wide — comfortably above 44px. The tab bar's height is `56px + env(safe-area-inset-bottom)` to clear the iOS home indicator (see §10).

### Lint Rule

`no-touch-target-below-44px.test.ts` — fails on any `<button>`, `<a>`, or `[role="button"]` with computed width or height < 44px.

---

## §9 Reduced Motion

> See `04_Motion_and_Microinteractions.md` §6 for the full contract. Summary:

1. **CSS `@media (prefers-reduced-motion: reduce)`** collapses all `--motion-*` durations to `0ms`.
2. **Framer Motion `MotionConfig reducedMotion="user"`** at the root respects the OS setting globally.
3. **`useReducedMotion()` hook** for JS-side conditional logic.
4. **What stays on:** spinners (status indicator), indeterminate progress bars (status indicator), focus ring appearance (essential for keyboard nav).
5. **What goes off:** hover/tap scale, entrance animations, page transitions, shared-element transitions, parallax (forbidden anyway), continuous pulse (forbidden anyway), autoplay video/carousel (forbidden anyway).

### Cross-Reference

This section is a stub — `04_Motion_and_Microinteractions.md` §6 is the authoritative source. The two files are kept in sync; if you update one, update the other.

---

## §10 Safe Areas

> iOS notch, Dynamic Island, and home indicator must be respected via `env(safe-area-inset-*)`. A button hidden behind the notch is unusable.

### The Recipe

```css
/* Top — for fixed headers (notch / Dynamic Island) */
.app-header {
  padding-top: env(safe-area-inset-top);
  /* falls back to 0 on devices without a notch (desktop, older Android) */
}

/* Bottom — for fixed footers, bottom tab bars, bottom sheets (home indicator) */
.app-footer,
.tabbar,
.sheet-mobile {
  padding-bottom: env(safe-area-inset-bottom);
}

/* Left/right — for landscape mode on notched devices */
.app-sidebar {
  padding-left: env(safe-area-inset-left);
}
.app-drawer-right {
  padding-right: env(safe-area-inset-right);
}
```

### The Viewport Meta

The viewport meta tag must include `viewport-fit=cover` to enable `env(safe-area-inset-*)`:

```tsx
// app/layout.tsx
export const metadata = {
  viewport: {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',  // ← critical for safe-area-inset to work
  },
};
```

### Audit

Every fixed-position element (header, footer, tabbar, FAB, bottom sheet) must use `env(safe-area-inset-*)` on the edge that touches the screen edge. Lint rule `no-fixed-element-without-safe-area.test.ts` checks this.

---

## §11 Form Accessibility

> Six rules. Forms are the highest-friction surface in the app (Settings, enrolment, fee change, receipt entry, auth); their accessibility is non-negotiable.

### 1. Visible Labels (No Placeholder-Only Inputs)

```tsx
// ❌ WRONG: placeholder as label (disappears on focus, not announced by screen readers)
<input type="text" placeholder="Student name" />

// ✅ RIGHT: visible <label> linked via htmlFor
<label htmlFor="student-name" className="form-label">Student Name</label>
<input id="student-name" type="text" className="form-input" placeholder="e.g. Riya Sharma" />
```

### 2. Error Below Field with `aria-describedby`

```tsx
<label htmlFor="fee" className="form-label">Monthly Fee (₹)</label>
<input
  id="fee"
  type="number"
  className="form-input"
  aria-describedby={errors.fee ? "fee-error" : "fee-helper"}
  aria-invalid={!!errors.fee}
  aria-required="true"
/>
{errors.fee ? (
  <p id="fee-error" className="form-error" role="alert">{errors.fee.message}</p>
) : (
  <p id="fee-helper" className="form-helper">Quarterly = 3×, Annual = 12×.</p>
)}
```

### 3. Required Indicators

```tsx
<label htmlFor="fee" className="form-label">
  Monthly Fee <span className="required" aria-hidden>*</span>
</label>
```

> The `*` is `aria-hidden` because it's a visual indicator. The "required" state is conveyed to screen readers via `aria-required="true"` on the input.

### 4. Autocomplete Attributes

```tsx
<input
  type="email"
  autoComplete="email"           // lets password managers + browser autofill work
  ...
/>
<input
  type="tel"
  autoComplete="tel"             // for guardian phone numbers
  ...
/>
<input
  type="text"
  autoComplete="name"            // for student name
  ...
/>
<input
  type="password"
  autoComplete="current-password"  // login form
  ...
/>
<input
  type="password"
  autoComplete="new-password"      // signup / change password form
  ...
/>
```

### 5. Password Toggle

Password fields must have a show/hide toggle. The toggle is an icon-only button with `aria-label` and `aria-pressed`:

```tsx
<div className="relative">
  <input
    id="password"
    type={showPassword ? 'text' : 'password'}
    className="form-input pr-12"
    autoComplete="current-password"
    aria-describedby="password-helper"
  />
  <button
    type="button"
    className="absolute right-2 top-1/2 -translate-y-1/2 btn-icon"
    aria-label={showPassword ? 'Hide password' : 'Show password'}
    aria-pressed={showPassword}
    onClick={() => setShowPassword(!showPassword)}
  >
    {showPassword ? <EyeOff size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
  </button>
</div>
```

### 6. Fieldset / Legend for Grouped Inputs

```tsx
<fieldset>
  <legend className="form-label">Guardian Contact</legend>
  <div className="form-field">
    <label htmlFor="guardian-name" className="form-label">Name</label>
    <input id="guardian-name" type="text" className="form-input" />
  </div>
  <div className="form-field">
    <label htmlFor="guardian-phone" className="form-label">Phone</label>
    <input id="guardian-phone" type="tel" className="form-input" autoComplete="tel" />
  </div>
</fieldset>
```

---

## §12 Image Alt Text

> Three categories of images, three alt-text rules.

### 1. Decorative Images → `alt=""`

```tsx
// A background pattern, a decorative icon next to a heading, an avatar already
// accompanied by a visible name — all are decorative.
<img src="/patterns/aurora-cosmic-texture.png" alt="" aria-hidden />
<Avatar src={student.photo} alt="" />  {/* name is visible next to avatar */}
```

> **`alt=""` + `aria-hidden`** together tell the screen reader "skip this entirely". Without `alt=""`, the screen reader might announce the image's filename.

### 2. Meaningful Images → Descriptive Alt

```tsx
// A tutor's photo on their profile, a receipt scan, a festival banner with text
<img
  src={student.photo}
  alt={`Photo of ${student.name_latin}`}  // describes the content, not "photo of student"
/>
<img
  src="/banners/diwali-promotion.png"
  alt="Diwali promotion: 20% off annual plan until November 15"  // includes the text in the image
/>
```

> **Alt text rule:** Describe what the image *communicates*, not what it *looks like*. "Photo of Riya Sharma" is correct (it identifies the person). "Photo of a young girl" is wrong (it doesn't identify).

### 3. Charts → `aria-label` Summary

```tsx
// See §4.5 above — charts get a role="img" container with aria-label summary
// plus a visually-hidden table of the underlying data.
```

---

## §13 Language Attribute

> `<html lang="en">` default. `<span lang="hi">` wrapping Devanagari names so screen readers switch pronunciation engines.

### The Recipe

```tsx
// app/layout.tsx
<html lang="en">  {/* default for the whole app */}
  <body>...</body>
</html>

// In a student-name cell with Devanagari
<td className="name-cell">
  <span className="t-base fw-medium">{student.name_latin}</span>
  {student.name_devanagari && (
    <span
      className="t-sm text-muted ml-2"
      lang="hi"                                    {/* ← tells screen reader to switch to Hindi voice */}
      style={{ fontFamily: 'var(--font-body)' }}  /* Onest-Devanagari via unicode-range */
    >
      {student.name_devanagari}
    </span>
  )}
</td>
```

> **Why `lang="hi"` matters:** Without it, an English-locale screen reader tries to pronounce `रिया शर्मा` using English phonetics, producing gibberish. With `lang="hi"`, the screen reader switches to its Hindi voice (if installed) and pronounces it correctly.

### Multi-Language Pages

If a page is primarily in Hindi (rare in the tutor app, but possible for a future Hindi-UI variant), set `<html lang="hi">` and wrap English fragments in `<span lang="en">`:

```tsx
<html lang="hi">
  <body>
    <h1>विद्यार्थी प्रबंधन</h1>
    <p>कुल विद्यार्थी: <span lang="en">12</span></p>  {/* numerals stay English-locale */}
  </body>
</html>
```

---

## §14 QA Checklist (20 Items)

> Every PR that touches UI must pass this 20-item checklist. CI automates items 1-5; manual QA covers 6-20.

### Automated (CI-gated)

1. **axe-core 0 critical violations** — `axe-core` runs in CI on every palette × theme combination. Any critical violation blocks the build.
2. **No raw hex in components** — `no-raw-hex-in-components.test.ts` (see `02_Typography_System.md` §8).
3. **No touch target below 44px** — `no-touch-target-below-44px.test.ts` (see §8 above).
4. **No icon-only button without `aria-label`** — `no-icon-button-without-aria-label.test.ts` (see §4.1).
5. **No colour-only status** — `no-colour-only-status.test.ts` (see §7).

### Manual (per-PR)

6. **Keyboard-only test** — Unplug the mouse. Complete the primary task on the page (record a payment, mark attendance, edit a student) using only the keyboard. Tab through every focusable element; verify focus ring is visible at every step; verify Enter/Space activate; verify Esc closes modals.
7. **Screen reader test (VoiceOver on macOS / NVDA on Windows / TalkBack on Android)** — Navigate the page with the screen reader. Verify:
   - The page title (`h1`) is announced first.
   - Every form input has a label, helper/error, and required state announced.
   - Every icon-only button has a meaningful `aria-label`.
   - Toasts are announced without stealing focus.
   - Charts have an `aria-label` summary or a visually-hidden table.
8. **Reduced-motion test** — Enable `prefers-reduced-motion: reduce` in OS settings (macOS: System Preferences → Accessibility → Display → Reduce Motion). Verify:
   - All hover/tap scale animations collapse to instant state changes.
   - All entrance animations (modal, toast, list stagger) collapse to instant.
   - Page transitions are instant.
   - Spinners and indeterminate progress bars *still animate* (they're status indicators).
   - Focus rings *still appear* (they're essential).
9. **200% zoom test** — Zoom the browser to 200%. Verify:
   - No horizontal scrollbar (content reflows, doesn't overflow).
   - No overlapping text.
   - All touch targets remain ≥ 44px (they scale with zoom).
   - All form inputs remain usable.
10. **Light/dark toggle test** — Toggle light/dark on every palette. Verify:
    - No token leaks (a chip that stays red in light mode when it should be amber is a leak).
    - Text contrast remains ≥ 4.5:1 in both modes.
    - Images and charts render correctly in both modes.
11. **400% zoom test (mobile)** — On a 375px-wide viewport, zoom to 400%. Verify content reflows to a single column with no horizontal scroll.
12. **High-contrast mode test (Windows)** — Enable Windows High Contrast Mode. Verify the app remains usable (all text visible, all interactive elements distinguishable).
13. **Heading hierarchy audit** — Use a browser extension (e.g. Headings Map) to view the page's heading outline. Verify:
    - Exactly one `h1`.
    - No level skip (`h2` → `h4` is a fail).
    - Headings describe their section, not their style.
14. **Tab order audit** — Use a browser extension to view the tab order. Verify DOM order = visual order; no surprise jumps.
15. **Focus-visible audit** — Tab through every focusable element. Verify a visible focus ring appears at every step (never `outline: none` without replacement).
16. **Link-text audit** — Verify no "click here" or "read more" links; every link's text describes its destination.
17. **Form-error audit** — Submit a form with errors. Verify:
    - Errors appear below the field, not at the top of the form.
    - Errors have `role="alert"` and are announced immediately.
    - The first error field receives focus on submit.
    - Errors clear when the field is corrected.
18. **Colour-contrast audit (manual)** — Use the WebAIM Contrast Checker on any colour pair not in the palette's contrast report. Verify ≥ 4.5:1 for text, ≥ 3:1 for UI components.
19. **Mobile device test** — Test on a real iPhone (Safari + VoiceOver) and a real Android (Chrome + TalkBack). Emulators do not catch all touch / scroll / focus quirks.
20. **Screenshot comparison** — Compare the rendered screen against the `.png` screenshot in `images/<platform>/`. Pixel diff should be < 2% (allowing for live data). See `00_Design_System_Overview.md` §6 reviewer audit step 1.

### The Sign-Off

A PR is **a11y-mergeable** when:

- All 5 automated checks pass (CI green).
- All 15 manual checks are verified by the PR author + one reviewer.
- The QA checklist is pasted into the PR description with each item checked off.

> **No PR merges without a complete QA checklist.** This is enforceable via a GitHub status check that requires a `<details><summary>✅ QA Checklist</summary>...</details>` block in the PR description with all 20 items checked.

---

## Status

- **Author:** UI/UX Lead (Task 13-FOUNDATION-DOCS)
- **State:** COMPLETED
- **Depends on:** `00_Design_System_Overview.md` §5 (rule 10: accessibility is a palette property), `01_Color_Palettes.md` (contrast reports per palette), `02_Typography_System.md` (text tokens drive contrast), `03_Component_Library.md` (component-level ARIA), `04_Motion_and_Microinteractions.md` §6 (reduced-motion contract, cross-referenced in §9)
- **Consumers:** every page mockup (`web/*.md`, `mobile/*.md`, `desktop/*.md`), the web agent (implementation must pass the 20-item QA checklist), QA (axe-core + manual tests), CI (5 automated lint rules)
- **Standards:** WCAG 2.1 AA floor, AAA target; Apple HIG 44×44 touch; WAI-ARIA Authoring Practices 1.2 (grid, dialog, alert, switch patterns)
- **Lint rules defined:** 5 automated (`no-raw-hex`, `no-touch-target-below-44px`, `no-icon-button-without-aria-label`, `no-colour-only-status`, `no-custom-modal-without-focus-trap`)
- **Manual QA items:** 15 (keyboard, screen reader, reduced-motion, 200% zoom, light/dark toggle, 400% zoom mobile, high-contrast mode, heading hierarchy, tab order, focus-visible, link-text, form-error, colour-contrast, mobile device, screenshot comparison)
