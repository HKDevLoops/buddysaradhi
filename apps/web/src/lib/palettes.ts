// Implements: docs/design/overhaul-plan.md §1 + W2 — the palette manifest the
// Settings picker renders, sourced from the generated token system rather than
// hand-listed here.
//
// The previous version of this file hardcoded 8 palettes with a `primaryLight` /
// `primaryDark` hex and an `assignedTo` list, which meant the picker, the CSS and
// the manifest were three separate descriptions of the same intent and drifted.
// Now there is exactly one: `@buddysaradhi/design-system` generates the tokens and
// exports the scheme metadata, and this file only adapts it for the UI.

import {
  DARK_SCHEMES,
  LIGHT_SCHEMES,
  MATERIALS,
  buildAllPalettes,
  type MaterialId,
} from "@buddysaradhi/design-system";

export type ThemeId = "light" | "dark";
export type PaletteId = string;
// Re-exported so the provider and the Settings screen can name the type without
// importing the design-system package directly (the token CSS is imported by
// globals.css, the vocabulary by this module).
export type { MaterialId } from "@buddysaradhi/design-system";

export interface PaletteOption {
  id: PaletteId;
  name: string;
  tier: ThemeId;
  /** The Figma scheme this palette was derived from — shown in the picker so the
   *  provenance is visible to the user and auditable from the UI. */
  figmaScheme: number;
  figmaName: string;
  /** Why the scheme was shortlisted, in one line. */
  note: string;
  /** Live swatches, so the picker previews the real generated values. */
  swatch: { canvas: string; raised: string; accent: string };
}

const generated = buildAllPalettes([...DARK_SCHEMES, ...LIGHT_SCHEMES]);

export const PALETTES: readonly PaletteOption[] = generated.map((palette) => ({
  id: palette.id,
  name: palette.name,
  tier: palette.tier,
  figmaScheme: palette.figmaScheme,
  figmaName: palette.figmaName,
  note: palette.note,
  swatch: {
    canvas: palette.tokens.canvas,
    raised: palette.tokens.surfaceRaised,
    accent: palette.tokens.accentPrimary,
  },
}));

export const PALETTES_BY_ID: Readonly<Record<string, PaletteOption>> = Object.fromEntries(
  PALETTES.map((palette) => [palette.id, palette]),
);

/**
 * The default palette is `Inked` (Figma scheme 51: a teal accent on pure gray).
 * It is the shortest distance from a screen that used to be cosmic-indigo glass,
 * and its accent is the only colour on the canvas, which is what a dense ledger
 * wants.
 */
export const DEFAULT_PALETTE_ID = "inked";

/** `aurora-cosmic` was the retired default stored in the settings column. */
export const LEGACY_PALETTE_IDS = [
  "aurora-cosmic",
  "saffron-marigold",
  "emerald-ledger",
  "cyan-lagoon",
  "rose-petal",
  "amber-sunrise",
  "violet-nebula",
  "midnight-slate",
] as const;

/**
 * Resolve whatever is stored to a palette that exists. A tenant whose settings
 * row predates this migration holds `aurora-cosmic`, which is now a dead id;
 * rendering it would silently fall back to the unstyled default, so the value is
 * validated here and the fallback is explicit.
 */
export function resolvePaletteId(value: string | null | undefined): PaletteId {
  if (value && PALETTES_BY_ID[value]) return value;
  return DEFAULT_PALETTE_ID;
}

export interface MaterialOption {
  id: MaterialId;
  name: string;
  blurb: string;
}

export const MATERIAL_OPTIONS: readonly MaterialOption[] = Object.values(MATERIALS).map(
  (material) => ({ id: material.id, name: material.name, blurb: material.blurb }),
);

/**
 * Material default is `minimal`: opaque surfaces are the fastest to render and the
 * most legible at the density this app runs at. Acrylic and Liquid Glass are opt-in
 * presentation choices, which is the right default relationship for a material.
 */
export const DEFAULT_MATERIAL_ID: MaterialId = "minimal";

export function resolveMaterialId(value: string | null | undefined): MaterialId {
  if (value && value in MATERIALS) return value as MaterialId;
  return DEFAULT_MATERIAL_ID;
}

export const PALETTE_STORAGE_KEY = "buddysaradhi.palette";
export const MATERIAL_STORAGE_KEY = "buddysaradhi.material";
export const THEME_STORAGE_KEY = "buddysaradhi.theme";
export const DENSITY_STORAGE_KEY = "buddysaradhi.density";
