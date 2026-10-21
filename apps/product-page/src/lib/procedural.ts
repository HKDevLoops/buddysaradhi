// Implements: docs/design/material-modes.md §2 (the token contract) and the
// owner's brief for this surface: the site's textures, backgrounds, noise and
// gradients are GENERATED IN CODE, procedurally and deterministically - no
// bought image, no stock texture, no CDN asset.
//
// THE CONTRACT. Every generator here is a pure function of its seed, so the
// same seed produces the same bytes on the server, in the browser, and in the
// poster generator that renders the offline still. `Math.random()` in a
// render path is a hydration mismatch waiting to happen (AGENTS.md FM-14).
//
// Colours come from the GENERATED TOKEN ROLES, never a hand-picked hex
// (AGENTS.md Rule 5). This module owns geometry and seeds; the caller resolves
// the token and passes the values in.
//
// NO NETWORK, NO ASSET, NO DEPENDENCY. The noise is an SVG `feTurbulence`
// filter with the seed baked into the filter itself, inlined as a `data:`
// URL: the browser's own renderer generates the pixels, so the "texture" is
// zero bytes of payload and zero requests. `img-src` allows `data:`.

/**
 * A small, fast, deterministic PRNG (mulberry32). Chosen over the LCG the 3D
 * scene uses because it has a much better distribution for the short runs
 * here, and it is 32-bit clean: `seed >>> 0` makes a negative or fractional
 * seed well-defined.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hash of a string into a 32-bit seed, so callers can seed by name. */
export function seedFromString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Smooth 2D value noise on a unit lattice. Deterministic in `seed`. */
export function valueNoise2D(seed: number): (x: number, y: number) => number {
  const rand = mulberry32(seed);
  const SIZE = 256;
  const lattice = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = rand();
  const at = (ix: number, iy: number): number =>
    lattice[(((iy % SIZE) + SIZE) % SIZE) * SIZE + (((ix % SIZE) + SIZE) % SIZE)];
  const fade = (t: number): number => t * t * (3 - 2 * t);
  return (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = fade(x - x0);
    const fy = fade(y - y0);
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** Fractal (multi-octave) noise: the same field at four scales, summed. */
export function fbm2D(seed: number, octaves = 4): (x: number, y: number) => number {
  const fields = Array.from({ length: octaves }, (_, i) => valueNoise2D(seed + i * 7919));
  return (x: number, y: number): number => {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    for (const field of fields) {
      sum += field(x * freq, y * freq) * amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum;
  };
}

/**
 * A grain tile as an SVG data URL.
 *
 * The pixels come from the browser's own `feTurbulence`, with the seed baked
 * into the filter - so the texture is a real procedural texture that costs
 * zero bytes of image payload and zero requests, and it is IDENTICAL on every
 * machine because the seed is identical.
 *
 * `feTurbulence` is not universally bit-identical across renderers, so this is
 * deterministic in the sense that matters (the same input always produces the
 * same texture on a given renderer, and never flickers between renders), not
 * bit-identical across browsers. That is the correct contract for a grain
 * overlay: it must not be a "random" per-load image.
 */
export function grainTileDataUrl(seed: number, size = 128, opacity = 0.035): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<filter id="g" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">`,
    `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="${seed >>> 0}" stitchTiles="stitch"/>`,
    `<feColorMatrix type="saturate" values="0"/>`,
    `</filter>`,
    `<rect width="100%" height="100%" filter="url(#g)" opacity="${opacity}"/>`,
    `</svg>`,
  ].join("");
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export interface VignetteStop {
  /** 0..1 along the gradient. */
  readonly at: number;
  readonly color: string;
  readonly alpha: number;
}

/**
 * A radial vignette as a CSS `background-image` value.
 *
 * The colour is passed in from a TOKEN ROLE (`--canvas`, `--surface-sunken`,
 * `--accent-primary`), never a literal. The alpha is the only thing this
 * module decides, because it is a geometric property, not a brand colour.
 */
export function vignetteCss(color: string, stops: readonly VignetteStop[], shape = "ellipse"): string {
  const parts = stops
    .map((s) => `rgba-token(${color}, ${s.alpha}) ${(s.at * 100).toFixed(2)}%`)
    .join(", ");
  return `radial-gradient(${shape} at 50% 42%, ${parts})`;
}

/**
 * The same vignette, as a resolved CSS value.
 *
 * `rgba-token()` is a placeholder the caller replaces with the resolved
 * channel values: this module never parses a colour, because the token
 * values in this codebase are hex and a hand-rolled parser is exactly the
 * kind of thing that silently breaks when a palette switches to a different
 * notation. The caller resolves the token and passes the channels in.
 */
export function vignetteCssFromRgb(
  rgb: readonly [number, number, number],
  stops: readonly VignetteStop[],
  shape = "ellipse",
): string {
  const parts = stops
    .map((s) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${s.alpha}) ${(s.at * 100).toFixed(2)}%`)
    .join(", ");
  return `radial-gradient(${shape} at 50% 42%, ${parts})`;
}

/**
 * A layered "aurora" background: several soft radial gradients stacked over
 * one another, each seeded to sit somewhere different. This is what replaces a
 * flat colour panel behind the hero copy.
 *
 * The positions come from the seeded PRNG, so the composition is stable across
 * renders; the COLOURS come from token roles.
 */
export function auroraLayers(
  seed: number,
  colors: readonly string[],
  count = 3,
): readonly { readonly color: string; readonly x: number; readonly y: number; readonly radius: number; readonly alpha: number }[] {
  if (colors.length === 0) return [];
  const rand = mulberry32(seed);
  const out: { color: string; x: number; y: number; radius: number; alpha: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const color = colors[i % colors.length] as string;
    out.push({
      color,
      x: Math.round((18 + rand() * 64) * 10) / 10,
      y: Math.round((14 + rand() * 62) * 10) / 10,
      radius: Math.round((28 + rand() * 46) * 10) / 10,
      alpha: Math.round((6 + rand() * 10) * 10) / 100,
    });
  }
  return out;
}

/**
 * The CSS `background-image` value for an aurora, from resolved `rgb()` channel
 * triples. The caller resolves the tokens; this module owns only geometry.
 */
export function auroraCss(
  layers: readonly { readonly rgb: readonly [number, number, number]; readonly x: number; readonly y: number; readonly radius: number; readonly alpha: number }[],
): string {
  if (layers.length === 0) return "none";
  return layers
    .map(
      (l) =>
        `radial-gradient(${l.radius}% ${l.radius}% at ${l.x}% ${l.y}%, rgba(${l.rgb[0]}, ${l.rgb[1]}, ${l.rgb[2]}, ${l.alpha}) 0%, rgba(${l.rgb[0]}, ${l.rgb[1]}, ${l.rgb[2]}, 0) 70%)`,
    )
    .join(", ");
}

/**
 * Parses a `#rrggbb` token value into channel triples. Only hex is accepted,
 * and only because the generated token file emits hex (packages/design-system
 * `emit.ts`). Anything else returns null, and the caller falls back to the
 * plain token value rather than guessing a colour.
 */
export function hexToRgbTriplet(hex: string): readonly [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) return null;
  const value = match[1] as string;
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}
