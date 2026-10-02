// Implements: docs/design/overhaul-plan.md §2.4 + docs/design/material-modes.md —
// the three material modes: Minimal, Acrylic, Liquid Glass.
//
// The whole point of splitting structure from material: a mode may only touch the
// four TRANSLUCENT roles (overlay / nav / sheet / command palette) and the shadow
// ramp. It never touches text or accents, so switching mode cannot change a
// contrast ratio — that invariance is the accessibility guarantee, and
// `verifyTokens()` asserts it by diffing the two token sets and failing on any
// non-material change.
//
// Values are ports of real materials, not guesses: the acrylic tint/alpha come
// from WinUI's `AcrylicInAppFillColorDefaultBrush` (#2C2C2C @ 0.15 dark, #FCFCFC
// @ 0.0 light) and the shadow ramp follows Fluent 2 (blur = n, 28% dark).
// Microsoft's blur radius is system-derived and unpublished, so `--mat-blur` is
// an explicitly tuned port, marked as such in material-modes.md §2.
import type { GeneratedPalette } from "./tokens";

export const MATERIAL_IDS = ["minimal", "acrylic", "liquid-glass"] as const;
export type MaterialId = (typeof MATERIAL_IDS)[number];

export interface MaterialDefinition {
  id: MaterialId;
  name: string;
  /** One-line description, surfaced in Settings → Appearance. */
  blurb: string;
  /** Mode-invariant across every palette. */
  blur: string;
  saturate: string;
  brightness: string;
  /** Alpha for the four translucent roles, as `rgb(r g b / a)`. */
  overlayAlpha: string;
  navAlpha: string;
  sheetAlpha: string;
  paletteAlpha: string;
  scrim: string;
  borderDefaultAlpha: string;
  borderStrongAlpha: string;
  /** Inner highlight that reads as a lit edge on a curved surface. */
  specular: string;
  /** Fresnel sheen, liquid-glass only. */
  fresnel: string;
  shadowOverlay: string;
  shadowSheet: string;
  /** Whether `backdrop-filter` is used at all. */
  translucent: boolean;
}

export const MATERIALS: Readonly<Record<MaterialId, MaterialDefinition>> = {
  minimal: {
    id: "minimal",
    name: "Minimal",
    blurb: "Opaque surfaces. Fastest to render and the most legible under heavy density.",
    blur: "0px",
    saturate: "100%",
    brightness: "100%",
    overlayAlpha: "1",
    navAlpha: "1",
    sheetAlpha: "1",
    paletteAlpha: "1",
    scrim: "rgb(0 0 0 / 0.56)",
    borderDefaultAlpha: "1",
    borderStrongAlpha: "1",
    specular: "none",
    fresnel: "none",
    shadowOverlay: "0 8px 16px rgb(0 0 0 / 0.24)",
    shadowSheet: "0 32px 64px rgb(0 0 0 / 0.20)",
    translucent: false,
  },
  acrylic: {
    id: "acrylic",
    name: "Acrylic",
    blurb: "Windows Fluent acrylic. A single soft blur behind overlays and navigation.",
    blur: "40px",
    saturate: "125%",
    brightness: "105%",
    // WinUI AcrylicInAppFillColorDefaultBrush: tint #2C2C2C at 15% in dark.
    overlayAlpha: "0.15",
    navAlpha: "0.15",
    sheetAlpha: "0.32",
    paletteAlpha: "0.2",
    scrim: "rgb(0 0 0 / 0.56)",
    borderDefaultAlpha: "0.16",
    borderStrongAlpha: "0.28",
    specular: "inset 0 1px 0 rgb(255 255 255 / 0.06)",
    fresnel: "none",
    shadowOverlay: "0 8px 28px rgb(0 0 0 / 0.40)",
    shadowSheet: "0 28px 64px rgb(0 0 0 / 0.45)",
    translucent: true,
  },
  "liquid-glass": {
    id: "liquid-glass",
    name: "Liquid Glass",
    blurb: "Apple-style layered glass. Lens edges, a lit top edge and a sheen.",
    blur: "48px",
    saturate: "150%",
    brightness: "108%",
    overlayAlpha: "0.34",
    navAlpha: "0.3",
    sheetAlpha: "0.52",
    paletteAlpha: "0.4",
    scrim: "rgb(0 0 0 / 0.60)",
    borderDefaultAlpha: "0.22",
    borderStrongAlpha: "0.34",
    specular: "inset 0 1px 0 rgb(255 255 255 / 0.10), inset 0 -1px 0 rgb(0 0 0 / 0.20)",
    fresnel: "linear-gradient(180deg, rgb(255 255 255 / 0.10) 0%, rgb(255 255 255 / 0) 42%)",
    shadowOverlay: "0 12px 40px rgb(0 0 0 / 0.50), 0 2px 8px rgb(0 0 0 / 0.30)",
    shadowSheet: "0 32px 64px rgb(0 0 0 / 0.55)",
    translucent: true,
  },
};

/**
 * The material layer for one palette. Tints are derived from the palette's own
 * canvas/accent so acrylic never introduces a hue the palette does not contain —
 * a material that recolours the product is exactly the "generic glass" failure
 * mode.
 */
export function buildMaterial(
  palette: GeneratedPalette,
  material: MaterialDefinition,
): Record<string, string> {
  const { canvas, surfaceOverlaySolid, surfaceNavSolid, surfaceSheetSolid, surfacePaletteSolid } =
    palette.tokens;
  const rgba = (hex: string, alpha: string): string => {
    if (alpha === "1") return hex;
    const value = hex.replace("#", "");
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgb(${r} ${g} ${b} / ${alpha})`;
  };
  return {
    "mat-blur": material.blur,
    "mat-saturate": material.saturate,
    "mat-brightness": material.brightness,
    "mat-translucent": material.translucent ? "1" : "0",
    "surface-overlay": rgba(surfaceOverlaySolid, material.overlayAlpha),
    "surface-nav": rgba(surfaceNavSolid, material.navAlpha),
    "surface-sheet": rgba(surfaceSheetSolid, material.sheetAlpha),
    "surface-palette": rgba(surfacePaletteSolid, material.paletteAlpha),
    "surface-scrim": material.scrim,
    "mat-border-alpha": material.borderDefaultAlpha,
    "mat-specular": material.specular,
    "mat-fresnel": material.fresnel,
    "shadow-overlay": material.shadowOverlay,
    "shadow-sheet": material.shadowSheet,
    // Convenience: the canonical blur filter, so components never hand-build it.
    "mat-filter": material.translucent
      ? `blur(var(--mat-blur)) saturate(var(--mat-saturate)) brightness(var(--mat-brightness))`
      : "none",
    // Recorded for the native platforms, which map this to Mica/vibrancy rather
    // than to CSS (docs/design/material-modes.md §4).
    "mat-native": canvas,
  };
}

export const MATERIAL_ROLE_KEYS: readonly string[] = [
  "mat-blur",
  "mat-saturate",
  "mat-brightness",
  "mat-translucent",
  "surface-overlay",
  "surface-nav",
  "surface-sheet",
  "surface-palette",
  "surface-scrim",
  "mat-border-alpha",
  "mat-specular",
  "mat-fresnel",
  "shadow-overlay",
  "shadow-sheet",
  "mat-filter",
  "mat-native",
];