// Implements: docs/design/overhaul-plan.md §2.1–§2.3 — one canonical semantic
// token set, GENERATED from a scheme definition. There is no hand-authored colour
// anywhere in the system: `globals.css` used to carry 129 ad-hoc custom
// properties across five overlapping families (`--accent-*`, `--color-accent-*`,
// `--text-primary`, `--color-text-primary`, `--foreground`, …), which is why no
// two screens looked related. This file produces ONE set, from ONE place.
//
// Two invariants this file is responsible for (docs/design/material-modes.md §0):
//
//  1. TEXT AND ACCENT ARE MODE-INVARIANT. Switching material (Minimal / Acrylic /
//     Liquid Glass) may only change the four translucent roles and the shadow
//     ramp. It can never change a text or accent colour, so it can never change a
//     contrast ratio. That is why `buildPalette()` takes no material argument.
//
//  2. EVERY TEXT ROLE CLEARS ITS TARGET. Primary/secondary/muted and every accent
//     are SOLVED for their contrast target against the palette's own canvas
//     rather than eyeballed; `verifyTokens()` fails the build if any of them
//     falls short. Roles that are decorative (borders, surfaces) are not solved
//     and are held to a separate non-text floor.
import {
  contrastRatio,
  hexToRgb,
  maxChroma,
  mixHex,
  oklchToHex,
  solveLuminanceForContrast,
  type Oklch,
} from "./oklch";
import { solveTextAcrossSurfaces, ratio, TEXT_SURFACES } from "./surfaces";
import type { SchemeDefinition } from "./schemes";

/** WCAG 2.1 AA targets. Rule 10 holds these as a floor, not a goal. */
export const CONTRAST = {
  /** Body text and text-on-accent fills. */
  text: 4.5,
  /** Large text (>=24px, or >=18.66px bold) and UI component boundaries. */
  large: 3,
} as const;

export interface PaletteTokens {
  // Structure — opaque, mode-invariant
  canvas: string;
  surfaceRaised: string;
  surfaceInset: string;
  surfaceRow: string;
  surfaceSunken: string;
  surfaceScrim: string;
  /** Solid fallbacks paired with every translucent role below. */
  surfaceOverlaySolid: string;
  surfaceNavSolid: string;
  surfaceSheetSolid: string;
  surfacePaletteSolid: string;
  borderDefault: string;
  borderStrong: string;
  borderFocus: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  /** The scheme's vivid fill — buttons, selected chips, active states. */
  accentPrimary: string;
  /** The same hue solved to 4.5:1 on this canvas — links, icons, focus rings. */
  accentText: string;
  accentOnPrimary: string;
  /** Status colours are TEXT-SAFE (solved to 4.5:1 on canvas). A filled chip tints the surface with color-mix, which is a surface decision, not a token. */
  success: string;
  warning: string;
  danger: string;
  info: string;
  statusPaid: string;
  statusPartial: string;
  statusUnpaid: string;
  statusOverdue: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  chart6: string;
}

export interface GeneratedPalette {
  id: string;
  name: string;
  tier: "dark" | "light";
  figmaScheme: number;
  figmaName: string;
  note: string;
  /** The scheme inputs, kept so a palette can be regenerated or re-tuned. */
  source: {
    groundHue: number;
    groundChroma: number;
    accentHue: number;
    accentChroma: number;
  };
  tokens: PaletteTokens;
}

function at(l: number, c: number, h: number): string {
  return oklchToHex({ l, c, h } satisfies Oklch);
}

/**
 * Solve a text role: walk away from the background's lightness until the target
 * contrast is met. Near-neutral hues are used (chroma 0.004) so a "gray" role
 * still belongs to its palette's temperature instead of being a dead #888.
 *
 * `target` is what makes the hierarchy structural rather than decorative: primary
 * is solved for a much higher ratio than muted, so the three greys are guaranteed
 * to be visually distinct. Solving all three for the same target made every
 * palette emit `text-primary === text-muted`, which is a hierarchy collapse no
 * contrast check would ever flag.
 *
 * The background it solves against is the WORST surface the role will sit on
 * (`solveTextAcrossSurfaces`), not the canvas — see `surfaces.ts` for the
 * measurement that forced this.
 */
function solveText(hue: number, tokens: PaletteTokens, tier: "dark" | "light", target: number): string {
  const solved = solveTextAcrossSurfaces(hue, 0.004, tokens, tier, target);
  if (solved !== null) return solved;
  // The hue cannot reach the target even at the extreme — fall back to the
  // safest neutral there is rather than shipping a low-contrast token. The
  // verifier still measures it, so the failure stays visible.
  return tier === "dark" ? "#FFFFFF" : "#000000";
}

/** Per-role contrast targets: a hierarchy, not three copies of the same grey. */
const TEXT_TARGETS = { primary: 10, secondary: 7, muted: CONTRAST.text } as const;

/**
 * The accent is TWO tokens, because a bright accent cannot be both a vivid FILL
 * and a readable on-canvas TEXT colour:
 *
 *   - `accentPrimary` (FILL) keeps the scheme's chroma, because that is where its
 *     character lives. A "bright yellow accent" on a near-white canvas only reads
 *     as yellow at a high lightness — where it is nowhere near 4.5:1 on white. The
 *     paired `accentOnPrimary` is chosen to clear 4.5:1 ON THE FILL, which is the
 *     contrast that actually governs a filled button.
 *   - `accentText` (TEXT/ICON/LINK/FOCUS) is solved for 4.5:1 on the palette's own
 *     canvas, so a yellow scheme gets a deep gold for its links and focus ring
 *     instead of an unreadable lemon bar.
 *
 * Collapsing these into one token is what produced `#736300` — mathematically
 * correct, visually nothing like a yellow accent.
 */
function solveAccent(
  hue: number,
  chroma: number,
  tokens: PaletteTokens,
  tier: "dark" | "light",
  fillL: number,
): { fill: string; onFill: string; text: string } {
  const fillHex = oklchToHex({ l: fillL, c: chroma, h: hue });
  const ink = tier === "dark" ? "#0A0A0C" : "#FFFFFF";
  const alt = tier === "dark" ? "#FFFFFF" : "#0A0A0C";
  const onFill =
    contrastRatio(hexToRgb(fillHex), hexToRgb(ink)) >= CONTRAST.text
      ? ink
      : contrastRatio(hexToRgb(fillHex), hexToRgb(alt)) >= CONTRAST.text
        ? alt
        : ink;
  // `accentText` is solved across every surface like a text role, not against the
  // canvas: it is drawn on raised cards and inset panels as often as on the canvas,
  // and a version that only cleared the canvas measured 4.05:1 on both.
  const text =
    solveTextAcrossSurfaces(hue, chroma, tokens, tier, CONTRAST.text) ?? fillHex;
  return { fill: fillHex, onFill, text };
}

/**
 * Chart colours carry values in a bar or a sparkline, so they are held to the
 * non-text floor — and, like every other role, against the surface STACK rather
 * than the canvas. Solving them on the canvas alone left chart1 at 2.79–2.98:1 on
 * `--surface-raised` in six dark palettes, which is the surface a chart actually
 * sits on.
 */
function chartRamp(
  accentHue: number,
  accentChroma: number,
  surfaces: PaletteTokens,
  tier: "dark" | "light",
): string[] {
  const offsets = [0, 32, -32, 64, -64, 96];
  return offsets.map((offset, index) => {
    const hue = (accentHue + offset + 360) % 360;
    const chroma = Math.max(0.06, accentChroma * (1 - index * 0.08));
    const l = Math.max(0.22, Math.min(0.86, 0.52 + index * 0.045));
    const candidate = oklchToHex({ l, c: chroma, h: hue });
    const solved = solveTextAcrossSurfaces(hue, chroma, surfaces, tier, CONTRAST.large);
    if (solved === null) return candidate;
    // Prefer the saturated candidate when it already clears every surface, so the
    // ramp keeps its intended lightness ladder instead of collapsing to one step.
    const clearsEverywhere = TEXT_SURFACES.every(
      (key) => ratio(candidate, surfaces[key] as string) >= CONTRAST.large,
    );
    return clearsEverywhere ? candidate : solved;
  });
}

export function buildPalette(scheme: SchemeDefinition): GeneratedPalette {
  const dark = scheme.tier === "dark";
  const { groundHue, groundChroma, accentHue, accentChroma } = scheme;

  // Surface ramp: perceptual-lightness steps. Dark tier is a near-black stack
  // (raised LIGHTER than canvas, sunken darker) so elevation reads as a value
  // change, not a colour change; the light tier inverts it.
  const canvasL = dark ? 0.185 : 0.972;
  const canvasC = Math.min(groundChroma, maxChroma(canvasL, groundHue) * 0.9);
  const canvas = at(canvasL, canvasC, groundHue);

  const ramp = dark
    ? { raised: 0.232, inset: 0.152, row: 0.208, sunken: 0.128 }
    : { raised: 1.0, inset: 0.938, row: 0.99, sunken: 0.905 };
  const rampC = (l: number): number => Math.min(groundChroma, maxChroma(l, groundHue) * 0.9);

  const surfaceRaised = at(ramp.raised, rampC(ramp.raised), groundHue);
  const surfaceInset = at(ramp.inset, rampC(ramp.inset), groundHue);
  const surfaceRow = at(ramp.row, rampC(ramp.row), groundHue);
  const surfaceSunken = at(ramp.sunken, rampC(ramp.sunken), groundHue);

  // Text roles are solved against the surface STACK, not the canvas, so the
  // palette object they solve against has to exist first.
  const surfaces: PaletteTokens = {
    canvas,
    surfaceRaised,
    surfaceInset,
    surfaceRow,
    surfaceSunken,
  } as PaletteTokens;

  const textPrimary = solveText(groundHue, surfaces, scheme.tier, TEXT_TARGETS.primary);
  const textSecondary = solveText(groundHue, surfaces, scheme.tier, TEXT_TARGETS.secondary);
  const textMuted = solveText(groundHue, surfaces, scheme.tier, TEXT_TARGETS.muted);
  const textInverse = dark ? at(0.14, rampC(0.14), groundHue) : at(0.99, rampC(0.99), groundHue);

  const accentFillL = dark
    ? scheme.accentLightness?.dark ?? 0.72
    : scheme.accentLightness?.light ?? 0.62;
  const accent = solveAccent(accentHue, accentChroma, surfaces, scheme.tier, accentFillL);
  const semanticFillL = dark ? 0.68 : 0.58;
  const success = solveAccent(scheme.semantics.success, 0.13, surfaces, scheme.tier, semanticFillL);
  const warning = solveAccent(scheme.semantics.warning, 0.14, surfaces, scheme.tier, semanticFillL);
  const danger = solveAccent(scheme.semantics.danger, 0.15, surfaces, scheme.tier, semanticFillL);
  const info = solveAccent(scheme.semantics.info, 0.12, surfaces, scheme.tier, semanticFillL);

  // Borders are solid, never alpha: three runtimes (web, Swift, WinUI) must agree,
  // and only the web composites alpha. BOTH roles are SOLVED against the surface
  // stack for the WCAG 1.4.11 non-text floor, because both are component
  // boundaries in this app:
  //
  //   - `borderStrong` is the emphasised boundary (hover, active, control).
  //   - `borderDefault` is the RESTING boundary of every unselected button, every
  //     table row and the search field. It measured 1.10–2.58:1 on all 20 palettes
  //     against all four surfaces when it was mixed by a constant ratio, and it was
  //     not in the checked role list at all — the one border the app leans on
  //     hardest was the one nobody measured.
  //
  // `borderFocus` reuses `accentText`, which is already solved to the text floor
  // and so clears 3:1 everywhere.
  const solveBorder = (target: number, chroma: number): string => {
    const solved = solveTextAcrossSurfaces(groundHue, chroma, surfaces, scheme.tier, target);
    return solved ?? (dark ? textPrimary : "#000000");
  };
  const borderStrong = solveBorder(CONTRAST.large, 0.006);
  // A hair lighter than `borderStrong` so a resting boundary still reads as
  // quieter than an emphasised one, while clearing the same non-text floor.
  const borderDefault = solveBorder(CONTRAST.large + 0.35, 0.005);

  const charts = chartRamp(accentHue, accentChroma, surfaces, scheme.tier);
  // `chartRamp` is total by construction; the non-null assertions are replaced by
  // explicit fallbacks so a future edit that returns a short array fails here
  // rather than emitting an `undefined` colour into CSS.
  const chart1 = charts[0] ?? accent.fill;
  const chart2 = charts[1] ?? accent.fill;
  const chart3 = charts[2] ?? accent.fill;
  const chart4 = charts[3] ?? accent.fill;
  const chart5 = charts[4] ?? accent.fill;
  const chart6 = charts[5] ?? accent.fill;

  return {
    id: scheme.id,
    name: scheme.name,
    tier: scheme.tier,
    figmaScheme: scheme.figmaScheme,
    figmaName: scheme.figmaName,
    note: scheme.note,
    source: { groundHue, groundChroma, accentHue, accentChroma },
    tokens: {
      canvas,
      surfaceRaised,
      surfaceInset,
      surfaceRow,
      surfaceSunken,
      surfaceScrim: dark ? "rgb(0 0 0 / 0.56)" : "rgb(12 12 14 / 0.42)",
      surfaceOverlaySolid: surfaceRaised,
      surfaceNavSolid: mixHex(surfaceRaised, canvas, 0.35),
      surfaceSheetSolid: mixHex(surfaceRaised, textPrimary, 0.05),
      surfacePaletteSolid: mixHex(surfaceRaised, accent.text, 0.08),
      borderDefault,
      borderStrong,
      borderFocus: accent.text,
      textPrimary,
      textSecondary,
      textMuted,
      textInverse,
      accentPrimary: accent.fill,
      accentText: accent.text,
      accentOnPrimary: accent.onFill,
      success: success.text,
      warning: warning.text,
      danger: danger.text,
      info: info.text,
      statusPaid: success.text,
      statusPartial: warning.text,
      statusUnpaid: textSecondary,
      statusOverdue: danger.text,
      chart1,
      chart2,
      chart3,
      chart4,
      chart5,
      chart6,
    },
  };
}

export function buildAllPalettes(schemes: readonly SchemeDefinition[]): GeneratedPalette[] {
  return schemes.map(buildPalette);
}