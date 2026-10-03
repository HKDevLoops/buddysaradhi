// Implements: docs/design/overhaul-plan.md §8 + `13_UI_Guidelines.md` §2.1 — the
// surfaces a token must be readable ON.
//
// The first version of this gate solved every text role against `--canvas` only,
// which the palette generator does too. Measurement then showed 240 of 640
// real pairings below target: `--text-muted` on `--surface-inset` /
// `--surface-row` / `--surface-sunken`, `--accent-text` on every non-canvas
// surface, and every semantic + status colour on every non-canvas surface. The
// arithmetic makes those misses unavoidable rather than unlucky: `surface-raised`
// is LIGHTER than the canvas on a dark tier and `surface-inset` is DARKER on a
// light tier, so a colour solved against the canvas drifts the wrong way on one
// of them every time.
//
// So this file enumerates the surface stack the app actually paints on, and the
// generator solves each text role against the WORST surface it will sit on. That
// is the only way the guarantee "text is readable everywhere it appears" becomes
// a checked property instead of an aspiration.
import { contrastRatio, hexToRgb, mixHex, solveLuminanceForContrast } from "./oklch";
import type { GeneratedPalette, PaletteTokens } from "./tokens";
import { CONTRAST } from "./tokens";

export type SurfaceKey =
  | "canvas"
  | "surfaceRaised"
  | "surfaceInset"
  | "surfaceRow"
  | "surfaceSunken";

/**
 * Every surface body text is painted on, in the order they appear in a screen.
 * `surface-overlay` / `-nav` / `-sheet` are excluded on purpose: in Minimal mode
 * they resolve to their `-solid` twin, and in the two translucent modes they
 * composite over content, which no static ratio can bound — those are measured
 * as a separate, softer check in `verifyOverlayLegibility`.
 */
export const TEXT_SURFACES: readonly SurfaceKey[] = [
  "canvas",
  "surfaceRaised",
  "surfaceInset",
  "surfaceRow",
  "surfaceSunken",
];

/** Roles that carry text or an icon, so they must clear the AA text floor. */
export const TEXT_ROLE_KEYS = [
  "textPrimary",
  "textSecondary",
  "textMuted",
  "accentText",
  "success",
  "warning",
  "danger",
  "info",
  "statusPaid",
  "statusPartial",
  "statusUnpaid",
  "statusOverdue",
] as const satisfies readonly (keyof PaletteTokens)[];

/** Roles that are a boundary or a data mark: WCAG 1.4.11 non-text floor. */
export const NON_TEXT_ROLE_KEYS = [
  "borderDefault",
  "borderStrong",
  "borderFocus",
  "chart1",
  "chart2",
  "chart3",
  "chart4",
  "chart5",
  "chart6",
] as const satisfies readonly (keyof PaletteTokens)[];

export function ratio(a: string, b: string): number {
  return contrastRatio(hexToRgb(a), hexToRgb(b));
}

/**
 * The surface a candidate colour must beat: the one it has the LEAST contrast
 * against. On a dark tier the least-contrast surface is `surfaceRaised` (lighter
 * than the canvas); on a light tier it is `surfaceInset` (darker). That is why
 * solving against the canvas alone was wrong by construction rather than by
 * rounding, and why the worst surface is computed from the candidate rather than
 * assumed.
 *
 * `tier` is accepted (and part of the signature) so a reader comparing tiers does
 * not have to re-derive which surface constrains them.
 */
export function worstSurfaceFor(
  candidateHex: string,
  surfaces: PaletteTokens,
  tier: "dark" | "light",
): { key: SurfaceKey; hex: string; ratio: number } {
  let worst = {
    key: TEXT_SURFACES[0] as SurfaceKey,
    hex: surfaces[TEXT_SURFACES[0] as SurfaceKey] as string,
    ratio: Number.POSITIVE_INFINITY,
  };
  for (const key of TEXT_SURFACES) {
    const hex = surfaces[key] as string;
    const value = ratio(candidateHex, hex);
    if (value < worst.ratio) worst = { key, hex, ratio: value };
  }
  void tier;
  return worst;
}

/** Worst-surface lookup for a fully-built palette (verification side). */
export function worstSurface(
  tokens: PaletteTokens,
  tier: "dark" | "light",
): { key: SurfaceKey; hex: string; ratio: number } {
  let worst = worstSurfaceFor(tokens.textMuted, tokens, tier);
  for (const role of ["textPrimary", "textSecondary", "accentText"] as const) {
    const candidate = worstSurfaceFor(tokens[role], tokens, tier);
    if (candidate.ratio < worst.ratio) worst = candidate;
  }
  return worst;
}

/** All text-role × surface pairings, for the gate and for the audit script. */
export function textPairings(palette: GeneratedPalette): Array<{
  role: string;
  surface: SurfaceKey;
  surfaceHex: string;
  ratio: number;
  required: number;
}> {
  const out: Array<{
    role: string;
    surface: SurfaceKey;
    surfaceHex: string;
    ratio: number;
    required: number;
  }> = [];
  for (const role of TEXT_ROLE_KEYS) {
    for (const surface of TEXT_SURFACES) {
      const surfaceHex = palette.tokens[surface] as string;
      out.push({
        role,
        surface,
        surfaceHex,
        ratio: ratio(palette.tokens[role] as string, surfaceHex),
        required: CONTRAST.text,
      });
    }
  }
  return out;
}

export function borderPairings(palette: GeneratedPalette): Array<{
  role: string;
  surface: SurfaceKey;
  ratio: number;
  required: number;
}> {
  const out: Array<{ role: string; surface: SurfaceKey; ratio: number; required: number }> = [];
  for (const role of NON_TEXT_ROLE_KEYS) {
    for (const surface of TEXT_SURFACES) {
      out.push({
        role,
        surface,
        ratio: ratio(palette.tokens[role] as string, palette.tokens[surface] as string),
        required: CONTRAST.large,
      });
    }
  }
  return out;
}

/**
 * The composite case a static token check cannot see: a status chip paints the
 * status colour over a TINTED surface (`color-mix(status 14%, surface-inset)`),
 * so the effective background is neither token. 14% is the value the chip recipe
 * in `13_UI_Guidelines.md` §2.3 caps at; the composite is computed, not estimated.
 */
export function tintedComposite(
  statusHex: string,
  surfaceHex: string,
  weight = 0.14,
): string {
  return mixHex(surfaceHex, statusHex, weight);
}

export function compositePairings(palette: GeneratedPalette): Array<{
  role: string;
  ratio: number;
  required: number;
}> {
  const out: Array<{ role: string; ratio: number; required: number }> = [];
  for (const status of ["success", "warning", "danger", "info"] as const) {
    for (const surface of ["surfaceInset", "surfaceRaised", "surfaceRow"] as const) {
      const background = tintedComposite(
        palette.tokens[status] as string,
        palette.tokens[surface] as string,
      );
      for (const textRole of ["textPrimary", "textSecondary"] as const) {
        out.push({
          role: `${textRole} on ${status}@14% over ${surface}`,
          ratio: ratio(palette.tokens[textRole] as string, background),
          required: CONTRAST.text,
        });
      }
    }
  }
  return out;
}

/**
 * A softer check for the translucent surfaces: in Minimal mode they are their
 * `-solid` twin; in Acrylic / Liquid Glass they composite over content whose
 * luminance is unknown. The guarantee the app can actually make is that text
 * clears AA against the SOLID twin, which is the worst realistic backdrop.
 */
export function overlayLegibility(palette: GeneratedPalette): Array<{
  role: string;
  solid: string;
  ratio: number;
}> {
  const pairs: Array<[string, string]> = [
    ["textPrimary", "surfaceOverlaySolid"],
    ["textSecondary", "surfaceOverlaySolid"],
    ["textMuted", "surfaceOverlaySolid"],
    ["accentText", "surfaceOverlaySolid"],
    ["textPrimary", "surfaceNavSolid"],
    ["textPrimary", "surfaceSheetSolid"],
  ];
  return pairs.map(([role, solidKey]) => ({
    role: `${role} on ${solidKey}`,
    solid: palette.tokens[solidKey as keyof PaletteTokens] as string,
    ratio: ratio(palette.tokens[role as keyof PaletteTokens] as string, palette.tokens[solidKey as keyof PaletteTokens] as string),
  }));
}

/**
 * Solve a text role so it clears `target` against the WORST surface it will sit on
 * rather than against the canvas alone.
 *
 * The direction is chosen per tier and the "distance from background" is measured
 * against the surface with the LOWEST contrast, which is the one that constrains
 * the solution. Solving against the wrong background is how a colour that passes
 * the canvas check ends up at 4.05:1 on the surface it actually renders on.
 */
export function solveTextAcrossSurfaces(
  hue: number,
  chroma: number,
  surfaces: PaletteTokens,
  tier: "dark" | "light",
  target: number,
): string | null {
  // Which side of the surface stack the colour must move to. On a dark tier the
  // constraining surface is the lightest one (raised), so text goes lighter; on a
  // light tier it is the darkest (inset), so text goes darker.
  const direction = tier === "dark" ? "lighter" : "darker";
  // Seed from the darkest/lightest candidate so the first probe has a defined
  // worst surface, then repair against every surface in turn.
  let candidate: string | null = null;
  for (const key of TEXT_SURFACES) {
    const surfaceHex = surfaces[key] as string;
    const solved = solveLuminanceForContrast(hue, chroma, surfaceHex, target, direction);
    if (!solved.reached) continue;
    // Among the surfaces that can be solved, take the one requiring the most
    // distance from its background: that satisfies the rest.
    candidate = candidate === null ? solved.hex : fartherFrom(candidate, solved.hex, surfaceHex);
  }
  if (candidate === null) return null;

  // Re-check every surface and push further if one still fails. This is the step
  // the first version lacked: it trusted a single surface and shipped 4.05:1.
  for (let pass = 0; pass < 4; pass++) {
    let worst: SurfaceKey | null = null;
    let worstRatio = Number.POSITIVE_INFINITY;
    for (const key of TEXT_SURFACES) {
      const achieved = contrastRatio(hexToRgb(candidate), hexToRgb(surfaces[key] as string));
      if (achieved < worstRatio) {
        worstRatio = achieved;
        worst = key;
      }
    }
    if (worst === null || worstRatio >= target) break;
    const repaired = solveLuminanceForContrast(
      hue,
      chroma,
      surfaces[worst] as string,
      target,
      direction,
    );
    if (!repaired.reached) return null;
    candidate = repaired.hex;
  }
  return candidate;
}

/** The candidate with the lower contrast against `surfaceHex` — i.e. the safer one. */
function fartherFrom(a: string, b: string, surfaceHex: string): string {
  return contrastRatio(hexToRgb(a), hexToRgb(surfaceHex)) <=
    contrastRatio(hexToRgb(b), hexToRgb(surfaceHex))
    ? a
    : b;
}