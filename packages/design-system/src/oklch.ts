// Implements: docs/design/overhaul-plan.md §2.3 — deterministic colour
// derivation. Palettes are GENERATED, never hand-picked, so every one of the 20
// schemes is perceptually even and every contrast ratio is computed rather than
// eyeballed (WCAG 2.1 AA, AGENTS.md §2 Rule 10).
//
// Why OKLCH: perceptual lightness means "step 4 of the surface ramp" is the same
// visual step in all 20 palettes, and it keeps a 200-row ledger evenly banded
// regardless of hue. HSL lightness does not (yellow at 50% L is far lighter than
// blue at 50% L), which is exactly how hand-authored palettes end up muddier in
// some hues than others.
//
// Dependency-free on purpose: this is consumed by apps/web, apps/product-page and
// a build-time verification script across three runtimes, and a colour library
// would be the only place in the repo where a dependency exists purely for maths
// (AGENTS.md §6 "boring technology", §3 Rule 2 — no new runtime deps).

export interface Rgb {
  /** 0–255, integers after `toHex`. */
  r: number;
  g: number;
  b: number;
}

export interface Oklch {
  /** Perceptual lightness 0–1. */
  l: number;
  /** Chroma 0–~0.4. */
  c: number;
  /** Hue in degrees 0–360. */
  h: number;
}

// --- sRGB transfer function (IEC 61966-2-1) -------------------------------

function linearToSrgbChannel(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

function srgbToLinearChannel(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance from sRGB. */
export function relativeLuminance(rgb: Rgb): number {
  const r = srgbToLinearChannel(rgb.r);
  const g = srgbToLinearChannel(rgb.g);
  const b = srgbToLinearChannel(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1–21. Order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** True when a hex string's ratio against `hex` clears `target`. */
export function meetsContrast(hex: string, against: string, target: number): boolean {
  return contrastRatio(hexToRgb(hex), hexToRgb(against)) >= target;
}

// --- OKLab / OKLCH -> sRGB (Björn Ottosson's transform) -------------------

export function oklchToLinearRgb({ l, c, h }: Oklch): { r: number; g: number; b: number } {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  };
}

function inGamut(linear: { r: number; g: number; b: number }): boolean {
  const eps = 1e-4;
  return (
    linear.r >= -eps &&
    linear.r <= 1 + eps &&
    linear.g >= -eps &&
    linear.g <= 1 + eps &&
    linear.b >= -eps &&
    linear.b <= 1 + eps
  );
}

/**
 * OKLCH → 8-bit sRGB with gamut mapping: chroma is reduced (lightness and hue
 * preserved) until the colour fits. Reducing chroma rather than clipping
 * channels keeps hue stable — clipping shifts a saturated hue toward whatever
 * channel clipped, which is how a "teal" silently becomes "gray-blue".
 */
export function oklchToRgb(input: Oklch): Rgb {
  let { c } = input;
  let linear = oklchToLinearRgb({ ...input, c });
  if (!inGamut(linear)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24 && hi - lo > 1e-4; i++) {
      const mid = (lo + hi) / 2;
      const candidate = oklchToLinearRgb({ ...input, c: mid });
      if (inGamut(candidate)) {
        lo = mid;
        linear = candidate;
      } else {
        hi = mid;
      }
    }
    c = lo;
    linear = oklchToLinearRgb({ ...input, c });
  }
  const to8 = (v: number): number => Math.max(0, Math.min(255, Math.round(linearToSrgbChannel(v) * 255)));
  return { r: to8(linear.r), g: to8(linear.g), b: to8(linear.b) };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const hex = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  if (full.length !== 6) throw new Error(`INVALID_HEX: ${hex}`);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function oklchToHex(input: Oklch): string {
  return rgbToHex(oklchToRgb(input));
}

// --- contrast-solving lightness -------------------------------------------

/**
 * Binary-search the OKLCH lightness that hits `target` contrast against `bg`,
 * moving away from the background's own lightness.
 *
 * `direction: "lighter" | "darker"` says which side of the background to search,
 * so an accent on a near-black canvas is solved upward and the same accent on a
 * near-white canvas is solved downward. Returns the hex plus the contrast it
 * actually achieved — the caller (the verifier) checks the achieved value, so a
 * hue whose maximum chroma cannot reach the target is reported rather than
 * silently shipped.
 */
export function solveLuminanceForContrast(
  hue: number,
  chroma: number,
  bgHex: string,
  target: number,
  direction: "lighter" | "darker",
): { hex: string; contrast: number; reached: boolean } {
  const bg = hexToRgb(bgHex);
  // The search interval is always [0,1]; the DIRECTION decides which bound moves.
  // (Seeding `lo=1, hi=0` for the darker case put the bounds the wrong way round,
  // so `(lo+hi)/2` walked back up instead of down and every darker solve either
  // returned the fallback black or reported "not reached".)
  let lo = 0;
  let hi = 1;
  let best = { hex: bgHex, contrast: 1, reached: false };

  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const hex = oklchToHex({ l: mid, c: chroma, h: hue });
    const contrast = contrastRatio(hexToRgb(hex), bg);
    if (contrast >= target) {
      best = { hex, contrast, reached: true };
      // Keep descending toward the background so the result is the CLOSEST
      // colour that still clears the target — that is what makes three text
      // roles solved for different targets come out as a visible hierarchy.
      // (An early exit on "good enough" collapsed primary/secondary/muted to the
      // same hex in every palette.)
      if (direction === "lighter") hi = mid;
      else lo = mid;
    } else if (direction === "lighter") {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

/**
 * Largest chroma at (or below) `max` that stays inside sRGB at this
 * lightness/hue. Keeps a generated ramp from producing clipped garbage where the
 * hue family is intrinsically vivid.
 */
export function maxChroma(l: number, h: number, max = 0.37): number {
  let lo = 0;
  let hi = max;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinearRgb({ l, c: mid, h }))) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Mix two hexes in linear-light space (for tinted surfaces, not UI blending). */
export function mixHex(a: string, b: string, weight: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const mix = (x: number, y: number): number => {
    const lx = srgbToLinearChannel(x);
    const ly = srgbToLinearChannel(y);
    return linearToSrgbChannel(lx + (ly - lx) * weight) * 255;
  };
  return rgbToHex({ r: mix(ca.r, cb.r), g: mix(ca.g, cb.g), b: mix(ca.b, cb.b) });
}