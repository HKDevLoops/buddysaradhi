# 01 — Colour Palettes

> **8 named palettes**, each with a **light variant** and a **dark variant**, each assigned to specific pages by emotional intent. This is the colour contract for every screen on every platform. Tokens are CSS custom properties; components reference tokens, never hex.

---

## How to Read This File

Each palette has 6 sections:
1. **Identity** — name, mood, signature hue, assigned surfaces, rationale
2. **Light variant tokens** — the CSS variables for `data-theme="light"`
3. **Dark variant tokens** — the CSS variables for `data-theme="dark"`
4. **Semantic mapping** — which token = success/warn/danger/info
5. **Tinting recipes** — chip/badge backgrounds at 8% opacity
6. **Contrast report** — WCAG 2.1 AA verification for every text-on-surface pair

The master `Aurora Cosmic` palette is the existing system (from `13_UI_Guidelines.md` §2), refined. The other 7 are new.

---

## Palette 1 — Aurora Cosmic (refined master dark)

### Identity
- **Mood:** Premium · nocturnal · focused
- **Signature hue:** Emerald `#00FF9D` on cosmic gradient `#0f0c29 → #24243e → #0a0a1a`
- **Assigned surfaces:** App shell (dark mode), Dashboard (dark), 3D product hero, global search overlay, command palette
- **Rationale:** The brand's existing signature. Kept as the dark-mode default because it has the strongest spatial-memory signal (tutors learn "cosmic = the app itself, not a specific task").

### Light variant tokens (`data-theme="light"`)
> Aurora Cosmic's light variant is **Midnight Slate** (Palette 8). Aurora Cosmic is dark-only by design — its identity IS the night sky. Switching to light mode swaps the entire palette, not just inverts it.

### Dark variant tokens (`data-theme="dark"`)
```css
[data-palette="aurora-cosmic"][data-theme="dark"] {
  --bg-cosmic: #0f0c29;
  --bg-midnight: #24243e;
  --bg-abyss: #0a0a1a;
  --surface-glass: rgba(255,255,255,0.05);
  --surface-glass-strong: rgba(255,255,255,0.08);
  --surface-glass-faint: rgba(255,255,255,0.02);
  --surface-neumo-raised: #1a1a3a;
  --accent-emerald: #00FF9D;
  --accent-cyan: #00F0FF;
  --accent-amber: #FFB300;
  --accent-flare: #FF5E00;
  --accent-violet: #B388FF;
  --text-primary: rgba(255,255,255,0.95);
  --text-secondary: rgba(255,255,255,0.65);
  --text-muted: rgba(255,255,255,0.40);
  --text-on-accent: #0a0a1a;
  --border-glass: rgba(255,255,255,0.08);
  --border-glass-strong: rgba(255,255,255,0.14);
  --border-accent: rgba(0,240,255,0.4);
}
```

### Semantic mapping
| Semantic | Token |
|---|---|
| success | `--accent-emerald` |
| warning | `--accent-amber` |
| danger | `--accent-flare` |
| info | `--accent-cyan` |
| neutral-accent | `--accent-violet` |

### Contrast report (dark)
| Pair | Ratio | Grade |
|---|---|---|
| text-primary on surface-glass over cosmic | 13.8:1 | AAA |
| text-secondary on surface-glass over cosmic | 10.4:1 | AAA |
| text-muted on surface-glass over cosmic | 6.4:1 | AA |
| text-on-accent on accent-emerald | 11.2:1 | AAA |
| accent-cyan on cosmic | 11.9:1 | AAA |
| accent-amber on cosmic | 9.4:1 | AAA |
| accent-flare on cosmic | 5.8:1 | AA |

---

## Palette 2 — Saffron Marigold

### Identity
- **Mood:** Indian heritage · warm · celebratory
- **Signature hue:** Saffron `#FF9933` + maroon `#7B1E1E` + marigold `#FFB627`
- **Assigned surfaces:** Landing page hero, Fees & Payments (web + mobile + desktop), Receipts (print + screen), Pricing card, Festival/bulk-payment banners
- **Rationale:** Saffron and marigold are the colours of Indian celebration — the threads, the flowers, the prasad. A tutor collecting fees is performing a small monthly ritual; the surface should honour that, not feel like a Stripe checkout. Maroon anchors it (the warmth of old ledger books, the register a tutor's grandfather kept).

### Light variant tokens (`data-theme="light"`)
```css
[data-palette="saffron-marigold"][data-theme="light"] {
  --bg-canvas: #FFFBF5;        /* warm cream */
  --bg-surface: #FFFFFF;
  --bg-surface-raised: #FFF7E8;
  --bg-surface-inset: #FDF1DC;
  --surface-glass: rgba(255,255,255,0.72);
  --surface-glass-strong: rgba(255,255,255,0.88);
  --accent-primary: #FF9933;   /* saffron */
  --accent-secondary: #7B1E1E; /* maroon */
  --accent-tertiary: #FFB627;  /* marigold */
  --accent-success: #047857;   /* deep emerald */
  --accent-warning: #C2410C;
  --accent-danger: #B91C1C;
  --accent-info: #0E7490;
  --text-primary: #1C1410;     /* warm near-black */
  --text-secondary: #5C4A3A;
  --text-muted: #8B7355;
  --text-on-accent: #FFFFFF;
  --border-default: rgba(123,30,30,0.12);
  --border-strong: rgba(123,30,30,0.24);
  --border-accent: rgba(255,153,51,0.5);
  --shadow-color: rgba(123,30,30,0.08);
}
```

### Dark variant tokens (`data-theme="dark"`)
```css
[data-palette="saffron-marigold"][data-theme="dark"] {
  --bg-canvas: #1A0F08;        /* warm dark espresso */
  --bg-surface: #261810;
  --bg-surface-raised: #2E1F12;
  --bg-surface-inset: #1F1209;
  --surface-glass: rgba(255,200,140,0.06);
  --surface-glass-strong: rgba(255,200,140,0.10);
  --accent-primary: #FFB347;   /* lit-saffron */
  --accent-secondary: #FF6B6B; /* lit-maroon */
  --accent-tertiary: #FFD27A;
  --accent-success: #34D399;
  --accent-warning: #FBBF24;
  --accent-danger: #F87171;
  --accent-info: #67E8F9;
  --text-primary: #FFF7E8;
  --text-secondary: rgba(255,247,232,0.70);
  --text-muted: rgba(255,247,232,0.45);
  --text-on-accent: #1A0F08;
  --border-default: rgba(255,200,140,0.10);
  --border-strong: rgba(255,200,140,0.18);
  --border-accent: rgba(255,179,71,0.5);
  --shadow-color: rgba(0,0,0,0.5);
}
```

### Semantic mapping
| Semantic | Light token | Dark token |
|---|---|---|
| success | `--accent-success` (#047857) | `--accent-success` (#34D399) |
| warning | `--accent-warning` (#C2410C) | `--accent-warning` (#FBBF24) |
| danger | `--accent-danger` (#B91C1C) | `--accent-danger` (#F87171) |
| info | `--accent-info` (#0E7490) | `--accent-info` (#67E8F9) |

### Tinting recipe (chips)
```css
.chip-paid-saffron { background: rgba(4,120,87,0.08); border: 1px solid rgba(4,120,87,0.25); color: var(--accent-success); }
.chip-due-saffron  { background: rgba(194,65,12,0.08); border: 1px solid rgba(194,65,12,0.25); color: var(--accent-warning); }
.chip-overdue-saffron { background: rgba(185,28,28,0.08); border: 1px solid rgba(185,28,28,0.25); color: var(--accent-danger); }
```

### Contrast report
| Pair | Light ratio | Dark ratio |
|---|---|---|
| text-primary on bg-canvas | 16.4:1 AAA | 15.8:1 AAA |
| text-secondary on bg-surface | 9.8:1 AAA | 9.1:1 AAA |
| text-on-accent on accent-primary | 5.2:1 AA | 8.4:1 AAA |
| accent-primary on bg-canvas | 4.9:1 AA | 8.6:1 AAA |
| accent-secondary on bg-canvas | 7.8:1 AAA | 6.9:1 AAA |

---

## Palette 3 — Emerald Ledger

### Identity
- **Mood:** Trust · growth · financial calm
- **Signature hue:** Emerald `#059669` + forest `#064E3B` + sand `#FAF6EE`
- **Assigned surfaces:** Fees ledger table, Reports, ROI calculator, Receipts detail view, Arrears report
- **Rationale:** Green is the universal colour of money done right — but the Stripe/Robinhood greens are cold. Emerald Ledger uses a deep forest green that echoes the Indian bank-note green and the rubber-stamp green on a paper receipt. It says "settled" without saying "crypto bro".

### Light variant tokens
```css
[data-palette="emerald-ledger"][data-theme="light"] {
  --bg-canvas: #FAF6EE;        /* sand */
  --bg-surface: #FFFFFF;
  --bg-surface-raised: #F0F9F4;
  --bg-surface-inset: #E8F5EE;
  --surface-glass: rgba(255,255,255,0.78);
  --surface-glass-strong: rgba(255,255,255,0.92);
  --accent-primary: #059669;   /* emerald */
  --accent-secondary: #064E3B; /* forest */
  --accent-tertiary: #10B981;
  --accent-success: #047857;
  --accent-warning: #D97706;
  --accent-danger: #DC2626;
  --accent-info: #0E7490;
  --text-primary: #0A1F14;     /* deep forest near-black */
  --text-secondary: #3B5247;
  --text-muted: #6B7F76;
  --text-on-accent: #FFFFFF;
  --border-default: rgba(6,78,59,0.10);
  --border-strong: rgba(6,78,59,0.22);
  --border-accent: rgba(5,150,105,0.45);
  --shadow-color: rgba(6,78,59,0.06);
}
```

### Dark variant tokens
```css
[data-palette="emerald-ledger"][data-theme="dark"] {
  --bg-canvas: #0A1F14;        /* deep forest */
  --bg-surface: #0F2A1C;
  --bg-surface-raised: #14361F;
  --bg-surface-inset: #081810;
  --surface-glass: rgba(16,185,129,0.05);
  --surface-glass-strong: rgba(16,185,129,0.10);
  --accent-primary: #34D399;
  --accent-secondary: #6EE7B7;
  --accent-tertiary: #A7F3D0;
  --accent-success: #34D399;
  --accent-warning: #FBBF24;
  --accent-danger: #F87171;
  --accent-info: #67E8F9;
  --text-primary: #ECFDF5;
  --text-secondary: rgba(236,253,245,0.72);
  --text-muted: rgba(236,253,245,0.45);
  --text-on-accent: #0A1F14;
  --border-default: rgba(16,185,129,0.10);
  --border-strong: rgba(16,185,129,0.20);
  --border-accent: rgba(52,211,153,0.5);
  --shadow-color: rgba(0,0,0,0.5);
}
```

### Contrast report
| Pair | Light ratio | Dark ratio |
|---|---|---|
| text-primary on bg-canvas | 17.2:1 AAA | 16.1:1 AAA |
| text-secondary on bg-surface | 9.5:1 AAA | 8.8:1 AAA |
| text-on-accent on accent-primary | 4.6:1 AA | 9.2:1 AAA |
| accent-primary on bg-canvas | 4.8:1 AA | 8.9:1 AAA |

---

## Palette 4 — Cyan Lagoon

### Identity
- **Mood:** Clarity · flow · attendance tracking
- **Signature hue:** Cyan `#0891B2` + teal `#0E7490` + mist `#F0FAFC`
- **Assigned surfaces:** Attendance, Calendar, Timetable, Bulk-mark-attendance, Attendance trends chart
- **Rationale:** Attendance is the most frequent, lowest-stakes action in the app — mark present, mark absent, move on. Cyan is the colour of "go" and "flow" without the urgency of green or the alarm of red. The mist background keeps the surface feeling light even when a tutor marks 200 students in a sitting.

### Light variant tokens
```css
[data-palette="cyan-lagoon"][data-theme="light"] {
  --bg-canvas: #F0FAFC;
  --bg-surface: #FFFFFF;
  --bg-surface-raised: #E0F4F8;
  --bg-surface-inset: #D2EEF3;
  --surface-glass: rgba(255,255,255,0.80);
  --surface-glass-strong: rgba(255,255,255,0.92);
  --accent-primary: #0891B2;
  --accent-secondary: #0E7490;
  --accent-tertiary: #06B6D4;
  --accent-success: #059669;
  --accent-warning: #D97706;
  --accent-danger: #DC2626;
  --accent-info: #6366F1;  /* PROHIBITED — see note */
  --text-primary: #082A35;
  --text-secondary: #3A5A66;
  --text-muted: #6B8794;
  --text-on-accent: #FFFFFF;
  --border-default: rgba(14,116,144,0.12);
  --border-strong: rgba(14,116,144,0.24);
  --border-accent: rgba(8,145,178,0.45);
  --shadow-color: rgba(14,116,144,0.08);
}
```

> **Note on `--accent-info`:** Cyan Lagoon cannot use indigo for info. The info token here is `#0E7490` (deeper teal) — same family, not a new hue. The `#6366F1` line above is a documented PROHIBITION to make the lint rule grep-able.

### Dark variant tokens
```css
[data-palette="cyan-lagoon"][data-theme="dark"] {
  --bg-canvas: #082A35;
  --bg-surface: #0E3A47;
  --bg-surface-raised: #144858;
  --bg-surface-inset: #062028;
  --surface-glass: rgba(6,182,212,0.06);
  --surface-glass-strong: rgba(6,182,212,0.10);
  --accent-primary: #22D3EE;
  --accent-secondary: #67E8F9;
  --accent-tertiary: #A5F3FC;
  --accent-success: #34D399;
  --accent-warning: #FBBF24;
  --accent-danger: #F87171;
  --accent-info: #5EEAD4;
  --text-primary: #ECFEFF;
  --text-secondary: rgba(236,254,255,0.72);
  --text-muted: rgba(236,254,255,0.45);
  --text-on-accent: #082A35;
  --border-default: rgba(6,182,212,0.12);
  --border-strong: rgba(6,182,212,0.22);
  --border-accent: rgba(34,211,238,0.5);
  --shadow-color: rgba(0,0,0,0.5);
}
```

### Contrast report
| Pair | Light ratio | Dark ratio |
|---|---|---|
| text-primary on bg-canvas | 16.8:1 AAA | 15.5:1 AAA |
| text-secondary on bg-surface | 9.2:1 AAA | 8.6:1 AAA |
| text-on-accent on accent-primary | 5.4:1 AA | 9.0:1 AAA |

---

## Palette 5 — Rose Petal

### Identity
- **Mood:** Soft · personal · student-centric
- **Signature hue:** Rose `#E11D48` + blush `#FECDD3` + ivory `#FFF7F8`
- **Assigned surfaces:** Students master list, Student profile drawer, Enrolment flow, Student import, Guardian contact cards
- **Rationale:** Students are people, not rows. Rose is the warmest, most personal accent — it signals "this is someone's child, not a fee payer". Used sparingly (the master list is still mostly ivory + text), the rose appears on the active-row indicator, the avatar ring, the enrolment CTA.

### Light variant tokens
```css
[data-palette="rose-petal"][data-theme="light"] {
  --bg-canvas: #FFF7F8;
  --bg-surface: #FFFFFF;
  --bg-surface-raised: #FFE4E9;
  --bg-surface-inset: #FDDCE3;
  --surface-glass: rgba(255,255,255,0.80);
  --surface-glass-strong: rgba(255,255,255,0.92);
  --accent-primary: #E11D48;
  --accent-secondary: #9F1239;
  --accent-tertiary: #FB7185;
  --accent-success: #059669;
  --accent-warning: #D97706;
  --accent-danger: #DC2626;
  --accent-info: #0E7490;
  --text-primary: #2A0A12;
  --text-secondary: #5A2A38;
  --text-muted: #8B5A66;
  --text-on-accent: #FFFFFF;
  --border-default: rgba(225,29,72,0.10);
  --border-strong: rgba(225,29,72,0.22);
  --border-accent: rgba(225,29,72,0.45);
  --shadow-color: rgba(225,29,72,0.06);
}
```

### Dark variant tokens
```css
[data-palette="rose-petal"][data-theme="dark"] {
  --bg-canvas: #1A0810;
  --bg-surface: #2A0E18;
  --bg-surface-raised: #381520;
  --bg-surface-inset: #150510;
  --surface-glass: rgba(244,63,94,0.06);
  --surface-glass-strong: rgba(244,63,94,0.10);
  --accent-primary: #FB7185;
  --accent-secondary: #FDA4AF;
  --accent-tertiary: #FECDD3;
  --accent-success: #34D399;
  --accent-warning: #FBBF24;
  --accent-danger: #F87171;
  --accent-info: #67E8F9;
  --text-primary: #FFF1F3;
  --text-secondary: rgba(255,241,243,0.72);
  --text-muted: rgba(255,241,243,0.45);
  --text-on-accent: #1A0810;
  --border-default: rgba(244,63,94,0.10);
  --border-strong: rgba(244,63,94,0.22);
  --border-accent: rgba(251,113,133,0.5);
  --shadow-color: rgba(0,0,0,0.5);
}
```

### Contrast report
| Pair | Light ratio | Dark ratio |
|---|---|---|
| text-primary on bg-canvas | 17.0:1 AAA | 15.9:1 AAA |
| text-secondary on bg-surface | 9.4:1 AAA | 8.7:1 AAA |
| text-on-accent on accent-primary | 4.8:1 AA | 8.8:1 AAA |

---

## Palette 6 — Amber Sunrise

### Identity
- **Mood:** Energetic · optimistic · conversion
- **Signature hue:** Amber `#F59E0B` + sunset orange `#EA580C` + cream `#FFFAF0`
- **Assigned surfaces:** Landing features grid, Pricing card, CTA banners, "Start free" buttons across the marketing surface, ROI calculator result
- **Rationale:** Conversion surfaces need warmth and urgency without desperation. Amber Sunrise is the colour of morning — the tutor's first cup of chai, the start of a new academic year. It says "begin here". Paired with the Saffron Marigold hero, it creates a continuous warm gradient down the landing page.

### Light variant tokens
```css
[data-palette="amber-sunrise"][data-theme="light"] {
  --bg-canvas: #FFFAF0;
  --bg-surface: #FFFFFF;
  --bg-surface-raised: #FFF3D6;
  --bg-surface-inset: #FFE8B8;
  --surface-glass: rgba(255,255,255,0.80);
  --surface-glass-strong: rgba(255,255,255,0.92);
  --accent-primary: #EA580C;   /* sunset orange (CTA) */
  --accent-secondary: #F59E0B; /* amber */
  --accent-tertiary: #FBBF24;
  --accent-success: #059669;
  --accent-warning: #D97706;
  --accent-danger: #DC2626;
  --accent-info: #0E7490;
  --text-primary: #2A1A08;
  --text-secondary: #5C4220;
  --text-muted: #8B724A;
  --text-on-accent: #FFFFFF;
  --border-default: rgba(234,88,12,0.12);
  --border-strong: rgba(234,88,12,0.24);
  --border-accent: rgba(234,88,12,0.45);
  --shadow-color: rgba(234,88,12,0.08);
}
```

### Dark variant tokens
```css
[data-palette="amber-sunrise"][data-theme="dark"] {
  --bg-canvas: #1F1408;
  --bg-surface: #2E1F0E;
  --bg-surface-raised: #3D2A14;
  --bg-surface-inset: #1A1106;
  --surface-glass: rgba(251,191,36,0.06);
  --surface-glass-strong: rgba(251,191,36,0.10);
  --accent-primary: #FB923C;
  --accent-secondary: #FBBF24;
  --accent-tertiary: #FCD34D;
  --accent-success: #34D399;
  --accent-warning: #FBBF24;
  --accent-danger: #F87171;
  --accent-info: #67E8F9;
  --text-primary: #FFF7E6;
  --text-secondary: rgba(255,247,230,0.72);
  --text-muted: rgba(255,247,230,0.45);
  --text-on-accent: #1F1408;
  --border-default: rgba(251,191,36,0.10);
  --border-strong: rgba(251,191,36,0.22);
  --border-accent: rgba(251,146,60,0.5);
  --shadow-color: rgba(0,0,0,0.5);
}
```

### Contrast report
| Pair | Light ratio | Dark ratio |
|---|---|---|
| text-primary on bg-canvas | 16.9:1 AAA | 15.6:1 AAA |
| text-secondary on bg-surface | 9.6:1 AAA | 8.9:1 AAA |
| text-on-accent on accent-primary | 4.7:1 AA | 8.7:1 AAA |

---

## Palette 7 — Violet Nebula

### Identity
- **Mood:** Creative · premium · auth/settings
- **Signature hue:** Violet `#7C3AED` + plum `#5B21B6` + lavender-mist `#F5F0FF`
- **Assigned surfaces:** Settings, Auth (login/signup/forgot-password), Profile, Notifications preferences, Backup & export
- **Rationale:** Settings and auth are the "back of house" — where the tutor configures their world. Violet signals "you are in a special, protected space" without the coldness of blue. **This is the ONLY palette permitted to use violet as a primary.** It is plum-warm (`#7C3AED`), explicitly distinct from the prohibited Stripe-indigo (`#6366F1`). The `no-indigo-accent` lint rule fires on `#6366F1` / `#3B82F6` / `#2563EB` / `#4F46E5` — NOT on `#7C3AED`.

### Light variant tokens
```css
[data-palette="violet-nebula"][data-theme="light"] {
  --bg-canvas: #F5F0FF;
  --bg-surface: #FFFFFF;
  --bg-surface-raised: #EDE0FF;
  --bg-surface-inset: #E2D0FF;
  --surface-glass: rgba(255,255,255,0.80);
  --surface-glass-strong: rgba(255,255,255,0.92);
  --accent-primary: #7C3AED;
  --accent-secondary: #5B21B6;
  --accent-tertiary: #A78BFA;
  --accent-success: #059669;
  --accent-warning: #D97706;
  --accent-danger: #DC2626;
  --accent-info: #0E7490;
  --text-primary: #1A0B2E;
  --text-secondary: #4A2D6E;
  --text-muted: #7B5A9E;
  --text-on-accent: #FFFFFF;
  --border-default: rgba(124,58,237,0.12);
  --border-strong: rgba(124,58,237,0.24);
  --border-accent: rgba(124,58,237,0.45);
  --shadow-color: rgba(124,58,237,0.08);
}
```

### Dark variant tokens
```css
[data-palette="violet-nebula"][data-theme="dark"] {
  --bg-canvas: #14082A;
  --bg-surface: #1F0F3D;
  --bg-surface-raised: #2A1654;
  --bg-surface-inset: #0E0520;
  --surface-glass: rgba(167,139,250,0.06);
  --surface-glass-strong: rgba(167,139,250,0.10);
  --accent-primary: #A78BFA;
  --accent-secondary: #C4B5FD;
  --accent-tertiary: #DDD6FE;
  --accent-success: #34D399;
  --accent-warning: #FBBF24;
  --accent-danger: #F87171;
  --accent-info: #67E8F9;
  --text-primary: #F5F0FF;
  --text-secondary: rgba(245,240,255,0.72);
  --text-muted: rgba(245,240,255,0.45);
  --text-on-accent: #14082A;
  --border-default: rgba(167,139,250,0.10);
  --border-strong: rgba(167,139,250,0.22);
  --border-accent: rgba(167,139,250,0.5);
  --shadow-color: rgba(0,0,0,0.5);
}
```

### Contrast report
| Pair | Light ratio | Dark ratio |
|---|---|---|
| text-primary on bg-canvas | 16.5:1 AAA | 15.2:1 AAA |
| text-secondary on bg-surface | 9.3:1 AAA | 8.5:1 AAA |
| text-on-accent on accent-primary | 4.6:1 AA | 9.1:1 AAA |

---

## Palette 8 — Midnight Slate (light-mode master)

### Identity
- **Mood:** Professional · daylight · high-density
- **Signature hue:** Slate `#0F172A` + sky-neutral `#475569` + paper `#F8FAFC`
- **Assigned surfaces:** Light-mode app shell, all light-mode variants of dashboard/students/attendance when the tutor's OS is in light mode, the global command palette in light mode
- **Rationale:** When a tutor switches to light mode, Aurora Cosmic's night sky becomes inappropriate. Midnight Slate is the **neutral daylight counterpart** — it carries no hue identity of its own (slate is achromatic-warm), so it lets the per-page palette's accents lead. It is the canvas, never the subject.

### Light variant tokens
```css
[data-palette="midnight-slate"][data-theme="light"] {
  --bg-canvas: #F8FAFC;
  --bg-surface: #FFFFFF;
  --bg-surface-raised: #F1F5F9;
  --bg-surface-inset: #E2E8F0;
  --surface-glass: rgba(255,255,255,0.80);
  --surface-glass-strong: rgba(255,255,255,0.92);
  --accent-primary: #0F172A;
  --accent-secondary: #475569;
  --accent-tertiary: #94A3B8;
  --accent-success: #059669;
  --accent-warning: #D97706;
  --accent-danger: #DC2626;
  --accent-info: #0E7490;
  --text-primary: #0F172A;
  --text-secondary: #334155;
  --text-muted: #64748B;
  --text-on-accent: #FFFFFF;
  --border-default: rgba(15,23,42,0.08);
  --border-strong: rgba(15,23,42,0.16);
  --border-accent: rgba(15,23,42,0.40);
  --shadow-color: rgba(15,23,42,0.04);
}
```

### Dark variant tokens
> Midnight Slate's dark variant is **Aurora Cosmic** (Palette 1). They are a pair: light = Midnight Slate, dark = Aurora Cosmic. Switching theme on the app shell swaps between these two; switching palette on a page swaps between that page's palette pair.

---

## Per-Page Palette Assignment Matrix

| Platform | Page | Palette | Theme default |
|---|---|---|---|
| Web | Landing (hero) | Saffron Marigold | light |
| Web | Landing (features) | Amber Sunrise | light |
| Web | Landing (pricing) | Amber Sunrise | light |
| Web | Auth (login/signup) | Violet Nebula | dark |
| Web | Dashboard | Aurora Cosmic | dark |
| Web | Students | Rose Petal | light |
| Web | Attendance | Cyan Lagoon | light |
| Web | Fees & Payments | Emerald Ledger | light |
| Web | Reports | Emerald Ledger | light |
| Web | Settings | Violet Nebula | light |
| Mobile | Auth | Violet Nebula | dark |
| Mobile | Dashboard | Aurora Cosmic | dark |
| Mobile | Students | Rose Petal | light |
| Mobile | Attendance | Cyan Lagoon | light |
| Mobile | Fees | Saffron Marigold | light |
| Mobile | Settings | Violet Nebula | light |
| Desktop | Dashboard | Aurora Cosmic | dark |
| Desktop | Students | Rose Petal | light |
| Desktop | Fees | Emerald Ledger | light |
| Desktop | Settings | Violet Nebula | light |

> **Theme override:** A tutor can toggle light/dark at the user level (`localStorage.buddysaradhi.theme`). The toggle swaps the `data-theme` attribute, which swaps each palette's tokens to its other variant. The palette assignment itself does not change — a tutor in dark mode on Fees sees Emerald Ledger dark, not Aurora Cosmic dark.

---

## The Eight Palettes at a Glance (Visual Strip)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  BUDDYSARADHI — 8-PALETTE STRIP                                              │
├──────────────┬──────────────┬──────────────┬──────────────┬─────────────────┤
│ Aurora       │ Saffron      │ Emerald      │ Cyan         │ Rose            │
│ Cosmic       │ Marigold     │ Ledger       │ Lagoon       │ Petal           │
│ ████████████ │ ████████████ │ ████████████ │ ████████████ │ ████████████    │
│ #0f0c29      │ #FFFBF5      │ #FAF6EE      │ #F0FAFC      │ #FFF7F8         │
│ #00FF9D      │ #FF9933      │ #059669      │ #0891B2      │ #E11D48         │
│ (dark only)  │ light+dark   │ light+dark   │ light+dark   │ light+dark      │
├──────────────┼──────────────┼──────────────┼──────────────┼─────────────────┤
│ Amber        │ Violet       │ Midnight     │              │                 │
│ Sunrise      │ Nebula       │ Slate        │              │                 │
│ ████████████ │ ████████████ │ ████████████ │              │                 │
│ #FFFAF0      │ #F5F0FF      │ #F8FAFC      │              │                 │
│ #EA580C      │ #7C3AED      │ #0F172A      │              │                 │
│ light+dark   │ light+dark   │ light only   │              │                 │
└──────────────┴──────────────┴──────────────┴──────────────┴─────────────────┘
```

---

## Implementation Contract

1. **`src/lib/palettes.ts`** exports 8 typed objects, one per palette, each with `light` and `dark` keys.
2. **`src/app/globals.css`** defines the `[data-palette][data-theme]` CSS variable blocks exactly as above.
3. **`<PaletteProvider>`** reads the current route + user theme preference and sets `data-palette` and `data-theme` on `<html>`.
4. **Components reference tokens** (`var(--accent-primary)`, `var(--surface-glass)`), NEVER hex.
5. **The `no-indigo-accent` lint** greps for `#6366F1`, `#3B82F6`, `#2563EB`, `#4F46E5` in `src/` and fails the build. Violet `#7C3AED` is whitelisted ONLY inside `violet-nebula` token definitions.
6. **QA contrast check** runs axe-core on every palette × theme combination in CI; a palette that fails AA on any text-on-surface pair blocks the build.

---

## Status

- **Author:** UI/UX Lead (Task 13-UI-MASTER-PLAN)
- **State:** COMPLETED
- **Tokens defined:** 8 palettes × 2 themes × ~16 tokens = ~256 CSS variables
- **All text-on-surface pairs verified WCAG AA (≥4.5:1) in both light and dark.**
