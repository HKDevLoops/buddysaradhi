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
//   · `.neumo-raised` was `border-radius: var(--radius-full)`: every neumorphic
//     control in the app was a pill.
//
// A negative control lives inside this file: the old `#FFFFFF` and the old
// 10%-aurora are both measured and asserted to FAIL, so the test cannot pass by
// accident if the tokens change underneath it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCHEMES, buildPalette, contrastRatio, hexToRgb } from "@buddysaradhi/design-system";

/** Vitest runs with the app directory as its working directory. */
const globalsCssPath = join(process.cwd(), "src", "app", "globals.css");
const globalsCss = readFileSync(globalsCssPath, "utf8");

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
  { token: "textPrimary", floor: 10 },
  { token: "textSecondary", floor: 7 },
  { token: "textMuted", floor: 4.5 },
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

const TIER_FILL = /^color-mix\(in srgb, var\(--surface-raised\) (\d+)%, transparent\)$/;

describe("the three glass tiers keep the §5 tier contract", () => {
  it.each(TIER_CONTRACT)(
    "$selector is translucent at its contract opacity",
    ({ selector, alpha }) => {
      const declarationsOfRule = rule(selector);
      const fill = declarationsOfRule.background ?? "";
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
      const fill = rule(selector).background ?? "";
      expect(TIER_FILL.test(fill)).toBe(true);
    }
  });
});

describe("a text role on a glass tier is no worse than on the surface it was solved against", () => {
  /** The aurora stops the canvas actually paints, read from the file. */
  const auroraStops = Array.from(
    ruleBody('[data-theme="dark"] body::before').matchAll(
      /color-mix\(in srgb, var\(--([a-zA-Z-]+)\) (\d+)%, transparent\)/g,
    ),
  ).map((match) => ({
    token: match[1] ?? "",
    alpha: Number(match[2] ?? 0) / 100,
  }));

  /**
   * The stylesheet names a token in kebab-case; the palette object keys are
   * camelCase. Without this translation the backdrop model silently skipped
   * every aurora stop and the measurement below proved nothing.
   */
  function paletteToken(tokens: Record<string, unknown>, name: string): string | undefined {
    const camel = name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const value = tokens[camel];
    return typeof value === "string" ? value : undefined;
  }

  it("reads the aurora stops out of the stylesheet", () => {
    expect(auroraStops.length).toBeGreaterThan(0);
  });

  it("resolves every aurora stop to a palette token", () => {
    for (const scheme of SCHEMES) {
      const tokens = buildPalette(scheme).tokens as unknown as Record<string, unknown>;
      for (const stop of auroraStops) {
        expect(paletteToken(tokens, stop.token), `${scheme.id} · ${stop.token}`).toBeDefined();
      }
    }
  });

  it.each(TIER_CONTRACT)(
    "$selector keeps every text role at its solved floor",
    ({ selector, alpha }) => {
      for (const scheme of SCHEMES) {
        const tokens = buildPalette(scheme).tokens;
        for (const stop of auroraStops) {
          const stopToken = paletteToken(tokens as unknown as Record<string, unknown>, stop.token);
          if (stopToken === undefined) continue;
          const backdrop = over(stopToken, tokens.canvas, stop.alpha);
          const composite = over(tokens.surfaceRaised, backdrop, alpha);
          for (const role of TEXT_ROLES) {
            const colour = tokens[role.token];
            const solvedFloor = Math.min(
              ...SOLVED_SURFACES.map((surface) => ratio(colour, tokens[surface as SolvedSurface])),
            );
            expect(
              ratio(colour, composite),
              `${scheme.id} · ${selector} · ${role.token} over ${stop.token}`,
            ).toBeGreaterThanOrEqual(Math.min(solvedFloor, role.floor) - 0.02);
          }
        }
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
      for (const stop of auroraStops) {
        const stopToken = paletteToken(tokens as unknown as Record<string, unknown>, stop.token);
        if (stopToken === undefined) continue;
        const backdrop = over(stopToken, tokens.canvas, stop.alpha);
        const composite = over(tokens.textPrimary, backdrop, 0.05);
        worst = Math.min(worst, ratio(tokens.textMuted, composite));
      }
    }
    expect(worst).toBeLessThan(4.5);
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
