// Implements: UI/01_Color_Palettes.md — 8 palettes typed manifest
// Used by PaletteProvider and any code that needs to reference palette metadata.

export type PaletteId =
  | "aurora-cosmic"
  | "saffron-marigold"
  | "emerald-ledger"
  | "cyan-lagoon"
  | "rose-petal"
  | "amber-sunrise"
  | "violet-nebula"
  | "midnight-slate";

export type ThemeId = "light" | "dark";

export interface PaletteDefinition {
  id: PaletteId;
  name: string;
  mood: string;
  /** Signature primary hex for identification/display */
  primaryLight: string;
  primaryDark: string;
  /** Which theme this palette defaults to per spec */
  defaultTheme: ThemeId;
  /** Pages this palette is assigned to */
  assignedTo: string[];
}

export const PALETTES: Record<PaletteId, PaletteDefinition> = {
  "aurora-cosmic": {
    id: "aurora-cosmic",
    name: "Aurora Cosmic",
    mood: "Premium · nocturnal · focused",
    primaryLight: "#00FF9D", // Emerald — light n/a (dark-only palette, pair = midnight-slate)
    primaryDark: "#00FF9D",
    defaultTheme: "dark",
    assignedTo: ["App shell (dark)", "Dashboard", "3D hero", "Command palette"],
  },
  "saffron-marigold": {
    id: "saffron-marigold",
    name: "Saffron Marigold",
    mood: "Indian heritage · warm · celebratory",
    primaryLight: "#FF9933",
    primaryDark: "#FFB347",
    defaultTheme: "light",
    assignedTo: ["Landing hero", "Fees & Payments (mobile)", "Receipts"],
  },
  "emerald-ledger": {
    id: "emerald-ledger",
    name: "Emerald Ledger",
    mood: "Trust · growth · financial calm",
    primaryLight: "#059669",
    primaryDark: "#34D399",
    defaultTheme: "light",
    assignedTo: ["Fees & Payments (web/desktop)", "Reports", "ROI calculator"],
  },
  "cyan-lagoon": {
    id: "cyan-lagoon",
    name: "Cyan Lagoon",
    mood: "Clarity · flow · attendance tracking",
    primaryLight: "#0891B2",
    primaryDark: "#22D3EE",
    defaultTheme: "light",
    assignedTo: ["Attendance", "Calendar", "Timetable"],
  },
  "rose-petal": {
    id: "rose-petal",
    name: "Rose Petal",
    mood: "Soft · personal · student-centric",
    primaryLight: "#E11D48",
    primaryDark: "#FB7185",
    defaultTheme: "light",
    assignedTo: ["Students master list", "Student profile", "Enrolment"],
  },
  "amber-sunrise": {
    id: "amber-sunrise",
    name: "Amber Sunrise",
    mood: "Energetic · optimistic · conversion",
    primaryLight: "#EA580C",
    primaryDark: "#FB923C",
    defaultTheme: "light",
    assignedTo: ["Landing features", "Pricing CTA", "ROI calculator result"],
  },
  "violet-nebula": {
    id: "violet-nebula",
    name: "Violet Nebula",
    mood: "Creative · premium · auth/settings",
    primaryLight: "#7C3AED",
    primaryDark: "#A78BFA",
    defaultTheme: "dark",
    assignedTo: ["Auth (login/signup)", "Settings", "Profile", "Backup & export"],
  },
  "midnight-slate": {
    id: "midnight-slate",
    name: "Midnight Slate",
    mood: "Professional · daylight · high-density",
    primaryLight: "#0F172A",
    primaryDark: "#0F172A", // same — slate is achromatic-warm
    defaultTheme: "light",
    assignedTo: ["Light-mode app shell", "All light-mode screen variants"],
  },
} as const;

// NOTE: Per-page palette assignment is intentionally NOT used. The user's
// single global palette selection (localStorage, applied app-wide by
// PaletteProvider in providers.tsx + the FOUC script in layout.tsx) is the
// only source of truth. See AGENTS.md §13 + the theme-fix work.
