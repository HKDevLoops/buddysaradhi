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
import { hexToRgb, rgbToHex, type Rgb } from "./oklch";
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
 * THE LEGIBILITY BASE the translucent overlay composites over — the same
 * mechanism the app's glass tiers use, at the same measured value.
 *
 * WHY IT EXISTS. The app's glass tiers carry a base (the app declares
 * `--glass-legibility-base: 70%` of `--canvas`): a tier's fill is 2–8% opaque,
 * so without a base the panel's backdrop IS the aurora, and the aurora's lift
 * is what breaks the text roles. The overlay never got one. `GlassCard
 * variant="strong"` paints `var(--surface-overlay)`, which in Acrylic is 15%
 * opaque and in Liquid Glass 34%, so it composited straight over the 20%
 * aurora and dropped `--text-primary` from 10.06:1 to 8.38:1 on `honey-opal`
 * (dark) — under the 10:1 floor the role was solved for. The overlay is the
 * last surface in the app that sees the aurora raw.
 *
 * THE VALUE IS MEASURED, NOT CHOSEN. `apps/web/src/app/token-layer.test.ts`
 * samples the real painted backdrop — the radial falloff, the stacking order,
 * three viewport aspect ratios, a 17×11 grid — and holds every text role to its
 * floor. The minimum base that holds is 60.2 % (Acrylic) and 60.9 % (Liquid
 * Glass) on the dark tier; the light tier needs none. 70 % ships because it is
 * the SAME number the app's tiers use, and it clears the minimum with room
 * (worst margin +0.112 and +0.061 against the floor, where the tiers hold
 * +0.145). The overlay needs MORE base than the tiers' own aurora-equivalent
 * (66.5 % for Acrylic) because its tint is three times heavier than a tier's
 * (15–34 % against 2–8 %), so its composite sits closer to the palette's
 * lightest surface — the one the text roles were solved against.
 */
export const OVERLAY_LEGIBILITY_BASE = 0.7;

/** A painted colour: 0–255 channels plus the alpha it is mixed at. */
export interface Composite {
  rgb: Rgb;
  alpha: number;
}

/**
 * The composite of a translucent tint over a legibility base, as ONE colour.
 *
 * `--surface-overlay` is consumed three ways — `background`, `background-color`
 * and inside `color-mix()` — and only a single COLOUR survives all three: a
 * two-layer value is not a colour, so `background-color` would drop it and
 * `color-mix()` would reject it. So the two layers are collapsed here, at
 * generation time, into the one colour the browser paints:
 *
 *     tint @ a   over   base @ Y   over   backdrop B
 *   = a·tint + (1−a)·Y·base + (1−a)(1−Y)·B
 *   = A·C + (1−A)·B,   A = a + (1−a)·Y,   C = (a·tint + (1−a)·Y·base) / A
 *
 * which is exactly what the browser paints for the two-layer form — the base
 * caps how much of the backdrop (the aurora) the surface's text can see.
 *
 * An opaque tint needs no base: the base would be invisible under it, so the
 * tint is returned unchanged and the Minimal mode's emitted block stays
 * byte-identical.
 */
export function compositeOverBase(
  tintHex: string,
  baseHex: string,
  tintAlpha: number,
  baseAlpha: number,
): Composite {
  if (tintAlpha >= 1) return { rgb: hexToRgb(tintHex), alpha: 1 };
  const tint = hexToRgb(tintHex);
  const base = hexToRgb(baseHex);
  const alpha = tintAlpha + (1 - tintAlpha) * baseAlpha;
  const channel = (t: number, b: number): number =>
    Math.round((tintAlpha * t + (1 - tintAlpha) * baseAlpha * b) / alpha);
  return {
    rgb: {
      r: channel(tint.r, base.r),
      g: channel(tint.g, base.g),
      b: channel(tint.b, base.b),
    },
    alpha: Number(alpha.toFixed(3)),
  };
}

/** A composite as the CSS colour the browser paints. */
export function formatComposite(composite: Composite): string {
  const { r, g, b } = composite.rgb;
  return `rgb(${r} ${g} ${b} / ${composite.alpha})`;
}

/**
 * What the browser paints when the composite sits on a backdrop: the
 * composite's own colour at its own alpha, over the backdrop, in sRGB — the
 * arithmetic CSS uses for an alpha fill.
 */
export function paintComposite(composite: Composite, backdropHex: string): string {
  const backdrop = hexToRgb(backdropHex);
  const mix = (channel: number, behind: number): number =>
    Math.round(channel * composite.alpha + behind * (1 - composite.alpha));
  return rgbToHex({
    r: mix(composite.rgb.r, backdrop.r),
    g: mix(composite.rgb.g, backdrop.g),
    b: mix(composite.rgb.b, backdrop.b),
  });
}

/**
 * The overlay's painted colour: the material's tint over the legibility base.
 *
 * An opaque tint (Minimal) needs no base — the base would be invisible under
 * it — so the tint is returned as the plain hex and Minimal's emitted block
 * stays byte-identical.
 */
function overlayColour(tintHex: string, baseHex: string, tintAlpha: string): string {
  const alpha = Number(tintAlpha);
  if (alpha >= 1) return tintHex;
  return formatComposite(
    compositeOverBase(tintHex, baseHex, alpha, OVERLAY_LEGIBILITY_BASE),
  );
}

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
    "surface-overlay": overlayColour(surfaceOverlaySolid, canvas, material.overlayAlpha),
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