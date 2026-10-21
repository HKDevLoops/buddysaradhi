// Implements: AGENTS.md §2 Rule 5 (colour comes from the generated palette or it
// does not ship) + Rule 10 (accessibility is not optional) +
// 13_UI_Guidelines.md §1.3 (no pure black, no pure white), §2.1 (the token
// contract and its contrast floors), §5.1-§5.2 (the three glass tiers and their
// opacities), §6.1/§6.6 (neumorphic controls, never mixed with glass),
// §2.2 (the accessibility fallbacks).
//
// WHY THIS FILE IS A TEST AND NOT A COMMENT. Every claim below is a MEASUREMENT
// that used to be an assertion in a review comment:
//
//   · `.badge-count` painted `#FFFFFF` on `--danger`: measured 3.71:1, under the
//     4.5:1 floor for its 10px label. It now paints `--text-inverse`, which
//     measures 5.31:1 as the worst of the 20 palettes.
//   · Every `.glass*` surface painted an alpha-1 background and paid for a
//     24px blur that an opaque fill makes mathematically unobservable.
//   · A translucent tier changes the backdrop its text sits on, so the tier
//     composite has to be MEASURED against the palette's solved surface stack —
//     not assumed. That measurement is what chose the tier colour and the
//     aurora strength, and it is re-run here on every change.
//   · The aurora's strength and the panels' translucency are the SAME VARIABLE:
//     a 5 %-alpha tier over an aurora-lit canvas means the text's effective
//     backdrop is 95 % the aurora. So the tiers carry a LEGIBILITY BASE - the
//     palette's own canvas at 70 % - and the aurora went from 6 % to 20 %:
//     3.3x stronger in the open canvas, and every measured text ratio on the
//     panel is identical to the 6 % baseline, because the panel still sees the
//     same aurora it saw before.
//   · The MATERIAL MODES' overlay had the same hole and the same cure. The
//     overlay is 15 % (Acrylic) / 34 % (Liquid Glass) opaque, so it composited
//     straight over the 20 % aurora: `--text-primary` measured 8.38:1 on
//     `honey-opal` against its 10:1 floor. It now carries the same base, so
//     the floating chrome and the panels read the SAME backdrop.
//   · `.neumo-raised` was `border-radius: var(--radius-full)`: every neumorphic
//     control in the app was a pill.
//
// Five negative controls live inside this file: the old `#FFFFFF` badge label,
// the old white veil, the old 10 %-aurora with no base, the SHIPPED aurora
// with the legibility base removed, and the overlay with its base removed. All
// five are measured and asserted to FAIL, so the test cannot pass by accident
// if the tokens change underneath it.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MATERIALS,
  OVERLAY_LEGIBILITY_BASE,
  SCHEMES,
  TEXT_TARGETS,
  buildMaterial,
  buildPalette,
  compositeOverBase,
  contrastRatio,
  hexToRgb,
  rgbToHex,
  type MaterialId,
  type PaletteTokens,
} from "@buddysaradhi/design-system";

/** Vitest runs with the app directory as its working directory. */
const globalsCssPath = join(process.cwd(), "src", "app", "globals.css");
const globalsCss = readFileSync(globalsCssPath, "utf8");

/**
 * The design system's SHIPPED CSS, resolved through the package's own export
 * map. The overlay lives in that file, not in the app's stylesheet, so the
 * harness has to read the token the app actually paints - not a model of it.
 */
const designSystemCss = readFileSync(
  createRequire(import.meta.url).resolve("@buddysaradhi/design-system/tokens.css"),
  "utf8",
);

/* ------------------------------------------------------------------ *
 * CSS reading — small, deliberately literal
 * ------------------------------------------------------------------ */

/** Comments are stripped first: prose must never be measured as CSS. */
const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the FIRST rule with this exact selector, or a hard failure. */
function ruleBody(selector: string): string {
  const marker = `${selector} {`;
  const start = css.indexOf(marker);
  if (start === -1) throw new Error(`RULE_NOT_FOUND: ${selector}`);
  const open = css.indexOf("{", start);
  const end = css.indexOf("}", open);
  if (end === -1) throw new Error(`RULE_UNTERMINATED: ${selector}`);
  return css.slice(open + 1, end);
}

/** The declarations of a rule body, keyed by property. */
function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    const property = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (property.length > 0 && value.length > 0) out[property] = value;
  }
  return out;
}

function rule(selector: string): Record<string, string> {
  return declarations(ruleBody(selector));
}

/* ------------------------------------------------------------------ *
 * Colour maths — the same model the browser uses for an alpha fill
 * ------------------------------------------------------------------ */

/** `fill` at `alpha` over `backdrop`, composited in sRGB (what CSS does). */
function over(fill: string, backdrop: string, alpha: number): string {
  const f = hexToRgb(fill);
  const b = hexToRgb(backdrop);
  const mix = (x: number, y: number): number => Math.round(x * alpha + y * (1 - alpha));
  const hex = (v: number): string => v.toString(16).padStart(2, "0").toUpperCase();
  return `#${hex(mix(f.r, b.r))}${hex(mix(f.g, b.g))}${hex(mix(f.b, b.b))}`;
}

function ratio(a: string, b: string): number {
  return contrastRatio(hexToRgb(a), hexToRgb(b));
}

/**
 * The stylesheet names a token in kebab-case; the palette object keys are
 * camelCase. Without this translation the backdrop model silently skipped
 * every aurora stop and the measurement proved nothing.
 */
function paletteToken(tokens: PaletteTokens, name: string): string | undefined {
  const camel = name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const value = tokens[camel as keyof PaletteTokens];
  return typeof value === "string" ? value : undefined;
}

/** The surfaces the design system solves every text role against (§2.1). */
const SOLVED_SURFACES = [
  "canvas",
  "surfaceRaised",
  "surfaceInset",
  "surfaceRow",
  "surfaceSunken",
] as const;

type SolvedSurface = (typeof SOLVED_SURFACES)[number];

/** The role a palette solves, and the floor it was solved for (§2.1). */
const TEXT_ROLES = [
  { token: "textPrimary", floor: TEXT_TARGETS.primary },
  { token: "textSecondary", floor: TEXT_TARGETS.secondary },
  { token: "textMuted", floor: TEXT_TARGETS.muted },
] as const;

/* ------------------------------------------------------------------ *
 * 4.8 — no colour literals in the token layer
 * ------------------------------------------------------------------ */

/** Properties that PAINT. A literal in one of these is a hand-picked colour. */
const PAINTING_PROPERTIES = new Set([
  "background",
  "background-color",
  "background-image",
  "color",
  "border",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "box-shadow",
  "text-shadow",
  "outline",
  "outline-color",
  "fill",
  "stroke",
  "filter",
  "caret-color",
  "text-decoration-color",
  "accent-color",
]);

/** A hex colour or an rgb()/rgba()/hsl() literal. `color-mix(in srgb, …)` is not. */
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/i;

describe("the web token layer carries no colour literal (Rule 5, §1.3)", () => {
  it("paints every colour-bearing declaration from a token role", () => {
    const offenders: string[] = [];
    // Every `{ … }` block; nested at-rules are read as their own blocks.
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = match[2] ?? "";
      for (const [property, value] of Object.entries(declarations(body))) {
        if (!PAINTING_PROPERTIES.has(property)) continue;
        if (!COLOUR_LITERAL.test(value)) continue;
        offenders.push(`${property}: ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the canvas gradient off pure black", () => {
    const body = ruleBody('[data-theme="dark"] body');
    expect(declarations(body).background).toBeDefined();
    expect(declarations(body).background).not.toMatch(/#000\b|#04040c\b/i);
  });
});

/* ------------------------------------------------------------------ *
 * 4.8 — `.badge-count` text role, measured
 * ------------------------------------------------------------------ */

describe("the count badge label clears the text floor on its fill", () => {
  const badge = rule(".badge-count");

  it("paints the label with a token role, never a literal", () => {
    expect(badge.color).toBe("var(--text-inverse)");
  });

  it("measures at least 4.5:1 on the danger fill in every palette", () => {
    const measured = SCHEMES.map((scheme) => {
      const tokens = buildPalette(scheme).tokens;
      return { id: scheme.id, value: ratio(tokens.textInverse, tokens.danger) };
    });
    const worst = measured.reduce((a, b) => (a.value <= b.value ? a : b));
    expect(worst.value).toBeGreaterThanOrEqual(4.5);
  });

  it("NEGATIVE CONTROL: the old pure-white label does NOT clear the floor", () => {
    // If the palettes ever move under this file, the control must keep failing —
    // otherwise the assertion above proves nothing.
    const failures = SCHEMES.filter(
      (scheme) => ratio("#FFFFFF", buildPalette(scheme).tokens.danger) < 4.5,
    );
    expect(failures.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * 4.9 — the glass tiers are genuinely translucent, and the composite is
 *       measured against the palette's solved surface stack
 * ------------------------------------------------------------------ */

const TIER_CONTRACT = [
  { selector: ".glass-faint", alpha: 0.02 },
  { selector: ".glass", alpha: 0.05 },
  { selector: ".glass-strong", alpha: 0.08 },
] as const;

/** The tier's own fill: the panel's surface role at the tier's contract opacity. */
const TIER_FILL = /^color-mix\(in srgb, var\(--surface-raised\) (\d+)%, transparent\)$/;

/** The legibility base under it: a role, at `--glass-legibility-base`. */
const TIER_BASE = /^color-mix\(in srgb, var\(--([a-z-]+)\) var\(--glass-legibility-base\), transparent\)$/;

/** Every surface that paints a tier: the three classes and their content twins. */
const TIER_SURFACES = [
  ".glass-faint",
  ".glass",
  ".glass-strong",
  ".glass-card",
  ".glass-card-strong",
  ".glass-panel",
  ".sidebar",
  ".topbar",
] as const;

/** Split a `background` shorthand into its layers, respecting parentheses. */
function layers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of value) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim().length > 0) out.push(current.trim());
  return out;
}

describe("the three glass tiers keep the §5 tier contract", () => {
  it.each(TIER_CONTRACT)(
    "$selector is translucent at its contract opacity",
    ({ selector, alpha }) => {
      const fill = layers(rule(selector).background ?? "")[0] ?? "";
      const match = TIER_FILL.exec(fill);
      expect(match).not.toBeNull();
      expect(Number(match?.[1]) / 100).toBe(alpha);
    },
  );

  it.each(TIER_CONTRACT)(
    "$selector carries a blur the translucent fill can show",
    ({ selector }) => {
      const blur = rule(selector)["backdrop-filter"] ?? "";
      expect(blur).toMatch(/blur\((\d+)px\)/);
      expect(Number(/blur\((\d+)px\)/.exec(blur)?.[1] ?? 0)).toBeGreaterThanOrEqual(8);
    },
  );

  it("the content tiers carry a translucent fill too", () => {
    for (const selector of [".glass-card", ".glass-card-strong", ".glass-panel"]) {
      const fill = layers(rule(selector).background ?? "")[0] ?? "";
      expect(TIER_FILL.test(fill)).toBe(true);
    }
  });

  it("every tier composites over the legibility base", () => {
    for (const selector of TIER_SURFACES) {
      const base = layers(rule(selector).background ?? "")[1] ?? "";
      expect(TIER_BASE.test(base), selector).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The aurora — the backdrop every glass tier composites over
 * ------------------------------------------------------------------ */

/** One aurora stop, read out of the stylesheet: colour role, strength, geometry. */
interface AuroraStop {
  token: string;
  alpha: number;
  x: number;
  y: number;
  radius: number;
}

/** The stylesheet's own gradient syntax, so the harness measures what ships. */
const AURORA_STOP =
  /radial-gradient\(circle at ([\d.]+)% ([\d.]+)%, color-mix\(in srgb, var\(--([a-zA-Z-]+)\) (\d+)%, transparent\), transparent ([\d.]+)%\)/g;

function auroraStops(theme: "dark" | "light"): AuroraStop[] {
  const body = ruleBody(`[data-theme="${theme}"] body::before`);
  return Array.from(body.matchAll(AURORA_STOP)).map((match) => ({
    token: match[3] ?? "",
    alpha: Number(match[4] ?? 0) / 100,
    x: Number(match[1] ?? 0) / 100,
    y: Number(match[2] ?? 0) / 100,
    radius: Number(match[5] ?? 0) / 100,
  }));
}

/**
 * The distance from an aurora stop to the farthest corner of the viewport —
 * the radius the browser's `transparent 42%` falloff is measured against.
 */
function farthestCorner(x: number, y: number, aspect: number): number {
  const width = aspect;
  const height = 1;
  let farthest = 0;
  for (const [cx, cy] of [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ]) {
    const distance = Math.hypot(cx - x * width, cy - y * height);
    if (distance > farthest) farthest = distance;
  }
  return farthest;
}

/** The backdrop the browser paints at one point of the viewport. */
function paintedBackdrop(
  stops: AuroraStop[],
  tokens: PaletteTokens,
  x: number,
  y: number,
  aspect: number,
): string {
  let colour = tokens.canvas;
  // The stops are listed top-first; the browser composites bottom-up.
  for (let index = stops.length - 1; index >= 0; index -= 1) {
    const stop = stops[index];
    if (stop === undefined) continue;
    const ray = farthestCorner(stop.x, stop.y, aspect);
    const distance = Math.hypot((x - stop.x) * aspect, y - stop.y);
    const reach = stop.radius * ray;
    if (distance >= reach) continue;
    const hex = paletteToken(tokens, stop.token);
    if (hex === undefined) continue;
    colour = over(hex, colour, stop.alpha * (1 - distance / reach));
  }
  return colour;
}

/** The base every tier composites over: the role, and the strength. */
function legibilityBase(): { token: string; alpha: number } {
  const declared = (rule(":root")["--glass-legibility-base"] ?? "").trim();
  const match = /^(\d+)%$/.exec(declared);
  const layer = layers(rule(".glass").background ?? "")[1] ?? "";
  return { token: TIER_BASE.exec(layer)?.[1] ?? "canvas", alpha: Number(match?.[1] ?? 0) / 100 };
}

/** The worst text role on a tier, over every palette and every aurora stop. */
interface Measurement {
  role: string;
  margin: number;
  measured: number;
  required: number;
  where: string;
}

const NO_MEASUREMENT: Measurement = { role: "", margin: Infinity, measured: 0, required: 0, where: "" };

/**
 * The composite the browser paints, in the order it paints it: the aurora over
 * the canvas, the legibility base over that, and the tier's fill over that.
 * `baseAlpha` of 0 removes the base, which is the negative control.
 */
function worstOnTier(opts: {
  theme: "dark" | "light";
  stops: AuroraStop[];
  baseAlpha: number;
  tierAlpha: number;
}): Measurement {
  const worst: Measurement = { ...NO_MEASUREMENT };
  const base = legibilityBase();
  for (const scheme of SCHEMES) {
    if (scheme.tier !== opts.theme) continue;
    const tokens = buildPalette(scheme).tokens;
    const baseHex = paletteToken(tokens, base.token);
    if (baseHex === undefined) continue;
    for (const stop of opts.stops) {
      const stopHex = paletteToken(tokens, stop.token);
      if (stopHex === undefined) continue;
      const backdrop = over(stopHex, tokens.canvas, stop.alpha);
      const bounded = over(baseHex, backdrop, opts.baseAlpha);
      const composite = over(tokens.surfaceRaised, bounded, opts.tierAlpha);
      for (const role of TEXT_ROLES) {
        const colour = tokens[role.token];
        const required = Math.min(
          ...SOLVED_SURFACES.map((surface) => ratio(colour, tokens[surface as SolvedSurface])),
        );
        const needed = Math.min(required, role.floor);
        const measured = ratio(colour, composite);
        if (measured - needed < worst.margin) {
          worst.role = role.token;
          worst.margin = measured - needed;
          worst.measured = measured;
          worst.required = needed;
          worst.where = `${scheme.id} · ${stop.token}`;
        }
      }
    }
  }
  return worst;
}

describe("a text role on a glass tier is no worse than on the surface it was solved against", () => {
  it.each(["dark", "light"] as const)("reads the %s aurora stops out of the stylesheet", (theme) => {
    expect(auroraStops(theme).length).toBeGreaterThan(0);
  });

  it.each(["dark", "light"] as const)("resolves every %s aurora stop to a palette token", (theme) => {
    for (const scheme of SCHEMES) {
      if (scheme.tier !== theme) continue;
      const tokens = buildPalette(scheme).tokens;
      for (const stop of auroraStops(theme)) {
        expect(paletteToken(tokens, stop.token), `${scheme.id} · ${stop.token}`).toBeDefined();
      }
    }
  });

  it.each(TIER_CONTRACT)(
    "$selector keeps every text role at its solved floor",
    ({ selector, alpha }) => {
      for (const theme of ["dark", "light"] as const) {
        const worst = worstOnTier({
          theme,
          stops: auroraStops(theme),
          baseAlpha: legibilityBase().alpha,
          tierAlpha: alpha,
        });
        expect(
          worst.margin,
          `${theme} · ${selector} · ${worst.role} over ${worst.where} (${worst.measured.toFixed(2)} / ${worst.required.toFixed(1)})`,
        ).toBeGreaterThanOrEqual(-0.02);
      }
    },
  );

  it("NEGATIVE CONTROL: the canonical white veil does NOT hold the floor", () => {
    // The tier fill is the panel's own tone, not a white veil: a white veil
    // lifts the composite out of the solved stack. This control keeps that
    // measured fact honest if the palette ever moves.
    let worst = Infinity;
    for (const scheme of SCHEMES) {
      const tokens = buildPalette(scheme).tokens;
      for (const stop of auroraStops("dark")) {
        const stopToken = paletteToken(tokens, stop.token);
        if (stopToken === undefined) continue;
        const backdrop = over(stopToken, tokens.canvas, stop.alpha);
        const composite = over(tokens.textPrimary, backdrop, 0.05);
        worst = Math.min(worst, ratio(tokens.textMuted, composite));
      }
    }
    expect(worst).toBeLessThan(4.5);
  });

  it("NEGATIVE CONTROL: the OLD 10% aurora with no legibility base does NOT hold the floor", () => {
    // The configuration this change replaced. The floor was already broken
    // there — that measurement is why the aurora was cut to 6% in the first
    // place. It must keep failing, or the base layer proves nothing.
    const stops = auroraStops("dark").map((stop) => ({ ...stop, alpha: 0.1 }));
    const worst = worstOnTier({ theme: "dark", stops, baseAlpha: 0, tierAlpha: 0.05 });
    expect(worst.margin).toBeLessThan(0);
  });

  it("NEGATIVE CONTROL: the SHIPPED aurora with the legibility base REMOVED does NOT hold the floor", () => {
    // Break the change on purpose: the aurora is strong, and without the base
    // the panel's backdrop IS the aurora, so the text loses its floor.
    const worst = worstOnTier({
      theme: "dark",
      stops: auroraStops("dark"),
      baseAlpha: 0,
      tierAlpha: 0.05,
    });
    expect(worst.margin).toBeLessThan(0);
  });
});

describe("the aurora is strong enough to read as a glow, and the model is faithful", () => {
  /**
   * The per-stop model above measures ONE stop at its peak over the canvas. The
   * browser paints all of them, at every point of the viewport, at partial
   * strength. The geometry sampler below paints the real thing — the same
   * radial falloff, the same stacking order — and proves the model is not
   * optimistic: the worst pixel the browser can produce is never worse than the
   * single stop the model measures.
   */
  it.each(["dark", "light"] as const)("the %s aurora is not dialled back to a tint", (theme) => {
    for (const stop of auroraStops(theme)) {
      expect(stop.alpha, `${theme} · ${stop.token}`).toBeGreaterThanOrEqual(0.15);
    }
  });

  it.each(["dark", "light"] as const)(
    "the %s aurora never paints a backdrop worse than the model measures",
    (theme) => {
      const stops = auroraStops(theme);
      const base = legibilityBase();
      const model = worstOnTier({ theme, stops, baseAlpha: base.alpha, tierAlpha: 0.05 });
      const painted: Measurement = { ...NO_MEASUREMENT };

      for (const aspect of [16 / 9, 4 / 3, 3 / 4]) {
        for (const scheme of SCHEMES) {
          if (scheme.tier !== theme) continue;
          const tokens = buildPalette(scheme).tokens;
          const baseHex = paletteToken(tokens, base.token) ?? tokens.canvas;
          for (const tierAlpha of [0.02, 0.05, 0.08]) {
            for (let gx = 0; gx <= 16; gx += 1) {
              for (let gy = 0; gy <= 10; gy += 1) {
                const backdrop = paintedBackdrop(stops, tokens, gx / 16, gy / 10, aspect);
                const bounded = over(baseHex, backdrop, base.alpha);
                const composite = over(tokens.surfaceRaised, bounded, tierAlpha);
                for (const role of TEXT_ROLES) {
                  const colour = tokens[role.token];
                  const required = Math.min(
                    ...SOLVED_SURFACES.map((surface) =>
                      ratio(colour, tokens[surface as SolvedSurface]),
                    ),
                  );
                  const needed = Math.min(required, role.floor);
                  const measured = ratio(colour, composite);
                  if (measured - needed < painted.margin) {
                    painted.role = role.token;
                    painted.margin = measured - needed;
                    painted.measured = measured;
                    painted.required = needed;
                    painted.where = `${scheme.id} · ${role.token} at (${gx}/16, ${gy}/10) aspect ${aspect.toFixed(2)}`;
                  }
                }
              }
            }
          }
        }
      }

      // The floors hold at every pixel the browser can paint …
      expect(painted.margin, painted.where).toBeGreaterThanOrEqual(-0.02);
      // … and the cheap per-stop model never claims more headroom than the
      // painted geometry actually has.
      expect(painted.margin, painted.where).toBeGreaterThanOrEqual(model.margin - 0.05);
    },
  );
});

/* ------------------------------------------------------------------ *
 * 4.9 — the material modes' translucent overlay
 *
 * The glass tiers got a legibility base; the material modes' overlay did
 * not. `GlassCard variant="strong"` paints `var(--surface-overlay)`, which
 * in Acrylic is 15 % opaque and in Liquid Glass 34 %, so it composited
 * straight over the 20 % aurora: `--text-primary` measured 8.38 : 1 on
 * `honey-opal` against its 10 : 1 floor. The overlay now composites over
 * the SAME base the tiers use, so the floating chrome and the panels read
 * the same backdrop — the overlay's floor is the tiers' floor, because
 * `surfaceOverlaySolid` IS `surfaceRaised`, the surface the roles were
 * solved against.
 * ------------------------------------------------------------------ */

const MATERIAL_IDS = ["minimal", "acrylic", "liquid-glass"] as const;

/** A painted colour: the hex and the alpha it is mixed at. */
interface Painted {
  hex: string;
  alpha: number;
}

/** The value of a material role, read out of the design system's CSS. */
function shippedMaterialValue(paletteId: string, mode: MaterialId, role: string): string {
  const marker = `[data-palette="${paletteId}"][data-material="${mode}"] {`;
  const start = designSystemCss.indexOf(marker);
  if (start === -1) throw new Error(`MATERIAL_BLOCK_NOT_FOUND: ${paletteId} · ${mode}`);
  const open = designSystemCss.indexOf("{", start);
  const end = designSystemCss.indexOf("}", open);
  const match = new RegExp(`--${role}:\\s*([^;]+);`).exec(designSystemCss.slice(open + 1, end));
  const value = match?.[1]?.trim();
  if (value === undefined) {
    throw new Error(`MATERIAL_ROLE_NOT_FOUND: ${role} · ${paletteId} · ${mode}`);
  }
  return value;
}

/** A shipped colour token: `rgb(r g b / a)` or a plain hex. */
function parseColourToken(value: string): Painted {
  if (value.startsWith("#")) return { hex: value.toUpperCase(), alpha: 1 };
  const match = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)$/.exec(value);
  if (match === null) throw new Error(`UNREADABLE_COLOUR_TOKEN: ${value}`);
  const hex = (v: string): string => Number(v).toString(16).padStart(2, "0").toUpperCase();
  return {
    hex: `#${hex(match[1] ?? "0")}${hex(match[2] ?? "0")}${hex(match[3] ?? "0")}`,
    alpha: Number(match[4] ?? 1),
  };
}

/**
 * The overlay as the design system builds it: the material's tint over the
 * legibility base. `baseAlpha` of 0 removes the base — the negative control.
 */
function overlayModel(
  tokens: PaletteTokens,
  mode: MaterialId,
  baseAlpha: number,
): Painted {
  const tintAlpha = Number(MATERIALS[mode].overlayAlpha);
  const composite = compositeOverBase(
    tokens.surfaceOverlaySolid,
    tokens.canvas,
    tintAlpha,
    baseAlpha,
  );
  return { hex: rgbToHex(composite.rgb), alpha: composite.alpha };
}

/** The worst text role over the overlay, over every palette and every pixel. */
function worstOnOverlay(opts: {
  theme: "dark" | "light";
  stops: AuroraStop[];
  mode: MaterialId;
  baseAlpha: number;
  geometry: boolean;
}): Measurement {
  const worst: Measurement = { ...NO_MEASUREMENT };
  for (const scheme of SCHEMES) {
    if (scheme.tier !== opts.theme) continue;
    const tokens = buildPalette(scheme).tokens;
    const overlay = overlayModel(tokens, opts.mode, opts.baseAlpha);
    const backdrops: string[] = [];
    if (opts.geometry) {
      for (const aspect of [16 / 9, 4 / 3, 3 / 4]) {
        for (let gx = 0; gx <= 16; gx += 1) {
          for (let gy = 0; gy <= 10; gy += 1) {
            backdrops.push(paintedBackdrop(opts.stops, tokens, gx / 16, gy / 10, aspect));
          }
        }
      }
    } else {
      for (const stop of opts.stops) {
        const stopHex = paletteToken(tokens, stop.token);
        if (stopHex === undefined) continue;
        backdrops.push(over(stopHex, tokens.canvas, stop.alpha));
      }
    }
    for (const backdrop of backdrops) {
      const composite = over(overlay.hex, backdrop, overlay.alpha);
      for (const role of TEXT_ROLES) {
        const colour = tokens[role.token];
        const required = Math.min(
          ...SOLVED_SURFACES.map((surface) => ratio(colour, tokens[surface as SolvedSurface])),
        );
        const needed = Math.min(required, role.floor);
        const measured = ratio(colour, composite);
        if (measured - needed < worst.margin) {
          worst.role = role.token;
          worst.margin = measured - needed;
          worst.measured = measured;
          worst.required = needed;
          worst.where = `${scheme.id} · ${role.token}`;
        }
      }
    }
  }
  return worst;
}

describe("the material modes' translucent overlay holds the same floors the panels do", () => {
  it.each(MATERIAL_IDS)("ships the %s overlay as the design system builds it", (mode) => {
    for (const scheme of SCHEMES) {
      const tokens = buildPalette(scheme).tokens;
      const shipped = shippedMaterialValue(scheme.id, mode, "surface-overlay");
      const model = buildMaterial(buildPalette(scheme), MATERIALS[mode])["surface-overlay"];
      expect(shipped, `${scheme.id} · ${mode}`).toBe(model);
      if (mode === "minimal") {
        // Minimal is opaque: the base would be invisible under it.
        expect(shipped, `${scheme.id} · ${mode}`).toBe(tokens.surfaceOverlaySolid);
      }
    }
  });

  it.each(MATERIAL_IDS)("the %s overlay carries the legibility base", (mode) => {
    const tintAlpha = Number(MATERIALS[mode].overlayAlpha);
    if (tintAlpha >= 1) return; // Minimal is opaque; a base would be invisible.
    for (const scheme of SCHEMES) {
      const tokens = buildPalette(scheme).tokens;
      const shipped = parseColourToken(shippedMaterialValue(scheme.id, mode, "surface-overlay"));
      const expected = tintAlpha + (1 - tintAlpha) * OVERLAY_LEGIBILITY_BASE;
      expect(shipped.alpha, `${scheme.id} · ${mode}`).toBeCloseTo(expected, 3);
    }
  });

  it.each(MATERIAL_IDS)(
    "every text role over the %s overlay holds its floor",
    (mode) => {
      for (const theme of ["dark", "light"] as const) {
        const worst = worstOnOverlay({
          theme,
          stops: auroraStops(theme),
          mode,
          baseAlpha: OVERLAY_LEGIBILITY_BASE,
          geometry: false,
        });
        expect(
          worst.margin,
          `${theme} · ${mode} · ${worst.role} over ${worst.where} (${worst.measured.toFixed(2)} / ${worst.required.toFixed(1)})`,
        ).toBeGreaterThanOrEqual(-0.02);
      }
    },
  );

  it.each(MATERIAL_IDS)(
    "the painted geometry never paints a worse overlay than the model measures",
    (mode) => {
      for (const theme of ["dark", "light"] as const) {
        const stops = auroraStops(theme);
        const model = worstOnOverlay({
          theme,
          stops,
          mode,
          baseAlpha: OVERLAY_LEGIBILITY_BASE,
          geometry: false,
        });
        const painted: Measurement = { ...NO_MEASUREMENT };
        for (const aspect of [16 / 9, 4 / 3, 3 / 4]) {
          for (const scheme of SCHEMES) {
            if (scheme.tier !== theme) continue;
            const tokens = buildPalette(scheme).tokens;
            const overlay = overlayModel(tokens, mode, OVERLAY_LEGIBILITY_BASE);
            for (let gx = 0; gx <= 16; gx += 1) {
              for (let gy = 0; gy <= 10; gy += 1) {
                const backdrop = paintedBackdrop(stops, tokens, gx / 16, gy / 10, aspect);
                const composite = over(overlay.hex, backdrop, overlay.alpha);
                for (const role of TEXT_ROLES) {
                  const colour = tokens[role.token];
                  const required = Math.min(
                    ...SOLVED_SURFACES.map((surface) =>
                      ratio(colour, tokens[surface as SolvedSurface]),
                    ),
                  );
                  const needed = Math.min(required, role.floor);
                  const measured = ratio(colour, composite);
                  if (measured - needed < painted.margin) {
                    painted.role = role.token;
                    painted.margin = measured - needed;
                    painted.measured = measured;
                    painted.required = needed;
                    painted.where = `${scheme.id} · ${role.token} at (${gx}/16, ${gy}/10) aspect ${aspect.toFixed(2)}`;
                  }
                }
              }
            }
          }
        }
        expect(painted.margin, painted.where).toBeGreaterThanOrEqual(-0.02);
        expect(painted.margin, painted.where).toBeGreaterThanOrEqual(model.margin - 0.05);
      }
    },
  );

  it("NEGATIVE CONTROL: the overlay with the legibility base REMOVED does NOT hold the floor", () => {
    // Break the change on purpose: the overlay is 15 % (Acrylic) / 34 %
    // (Liquid Glass) opaque, so without the base it composites straight over
    // the 20 % aurora and the text loses its floor.
    for (const mode of ["acrylic", "liquid-glass"] as const) {
      const worst = worstOnOverlay({
        theme: "dark",
        stops: auroraStops("dark"),
        mode,
        baseAlpha: 0,
        geometry: false,
      });
      expect(worst.margin, `${mode} · ${worst.role} over ${worst.where}`).toBeLessThan(0);
    }
  });

  it("NEGATIVE CONTROL: the OLD 10 % aurora with no base does NOT hold the floor", () => {
    // The configuration the strong aurora replaced, on the overlay.
    const stops = auroraStops("dark").map((stop) => ({ ...stop, alpha: 0.1 }));
    const worst = worstOnOverlay({
      theme: "dark",
      stops,
      mode: "acrylic",
      baseAlpha: 0,
      geometry: false,
    });
    expect(worst.margin).toBeLessThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * 4.10 — controls are neumorphic, surfaces are glass, never both
 * ------------------------------------------------------------------ */

describe("a control is neumorphic and never a glass surface", () => {
  it("gives the raised control a real radius, not a pill", () => {
    const radius = rule(".neumo-raised")["border-radius"] ?? "";
    expect(radius).toBe("var(--radius-control)");
    expect(radius).not.toBe("var(--radius-full)");
  });

  it("declares a control radius that is a real corner", () => {
    const radius = rule("@theme inline")["--radius-control"] ?? "";
    expect(radius).toMatch(/^\d+px$/);
    expect(Number.parseInt(radius, 10)).toBeLessThan(100);
  });

  it("keeps the press layer free of any glass material", () => {
    const press = rule(".btn-glass");
    for (const property of ["background", "backdrop-filter", "border", "box-shadow"]) {
      expect(press[property]).toBeUndefined();
    }
  });

  it("gives a raised control the §6.3 pressed recipe", () => {
    const active = css.includes(".neumo-raised:active");
    expect(active).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 4.11 — the accessibility fallbacks the spec lists
 * ------------------------------------------------------------------ */

describe("the token layer ships the accessibility fallbacks", () => {
  it.each([
    ["no backdrop-filter support", "@supports not ((backdrop-filter: blur(1px))"],
    ["reduced transparency", "@media (prefers-reduced-transparency: reduce)"],
    ["forced colours", "@media (forced-colors: active)"],
    ["more contrast", "@media (prefers-contrast: more)"],
  ])("ships the %s fallback", (_label, marker) => {
    expect(css).toContain(marker);
  });

  it("drops the blur in every fallback that cannot composite one", () => {
    const fallbacks = css.split("@supports not ((backdrop-filter: blur(1px))").slice(1).join("\n");
    expect(fallbacks).toContain("backdrop-filter: none");
  });
});
