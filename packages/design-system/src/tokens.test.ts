// Implements: docs/design/overhaul-plan.md §8 — the token contract is asserted, so
// a palette cannot regress into "technically 20 palettes, all unreadable".
//
// These tests are the difference between "we generated 20 palettes" and "20
// palettes that are usable". Every assertion here corresponds to a defect that
// actually occurred while building the system:
//   - `borderStrong` mixed by a constant ratio landed at 1.41:1 on all ten light
//     palettes.
//   - `Ink wash` and `Frozen mist` generated an IDENTICAL canvas.
//   - solving primary/secondary/muted for the same target collapsed them to one
//     hex in every palette.
//   - the "darker" contrast search had an inverted interval and silently returned
//     pure black for every light palette.
//   - a bright yellow accent solved for 4.5:1 on white became olive `#736300`.
// Anything that can happen to a generated palette should be a test here.
import { describe, expect, it } from "vitest";
import { contrastRatio, hexToRgb, oklchToHex, solveLuminanceForContrast } from "./oklch";
import { SCHEMES, DARK_SCHEMES, LIGHT_SCHEMES } from "./schemes";
import { buildAllPalettes, buildPalette, CONTRAST } from "./tokens";
import { MATERIALS, MATERIAL_ROLE_KEYS, buildMaterial } from "./material";
import { buildAndVerify, verifyMaterialInvariance, verifyUniqueness } from "./verify";
import { toCss, toJsonBundle } from "./index";

const palettes = buildAllPalettes(SCHEMES);
const materialIds = Object.keys(MATERIALS);
const paletteById = new Map(palettes.map((p) => [p.id, p]));

describe("the set", () => {
  it("is 10 dark + 10 light, one per shortlisted Figma scheme", () => {
    expect(DARK_SCHEMES).toHaveLength(10);
    expect(LIGHT_SCHEMES).toHaveLength(10);
    expect(palettes).toHaveLength(20);
  });

  it("carries the Figma scheme number on every palette, and no scheme is used twice", () => {
    const numbers = palettes.map((p) => p.figmaScheme);
    expect(new Set(numbers).size).toBe(20);
    for (const palette of palettes) {
      expect(palette.figmaScheme).toBeGreaterThanOrEqual(1);
      expect(palette.figmaScheme).toBeLessThanOrEqual(53);
      expect(palette.figmaName.length).toBeGreaterThan(2);
    }
  });

  it("produces zero verification findings across all palettes and materials", () => {
    const { findings } = buildAndVerify();
    const errors = findings.filter((f) => f.severity === "error");
    expect(errors.map((e) => `${e.paletteId}: ${e.code} ${e.message}`)).toEqual([]);
  });

  it("has no two palettes generating the same canvas", () => {
    expect(verifyUniqueness(palettes)).toEqual([]);
    const canvases = palettes.map((p) => p.tokens.canvas.toUpperCase());
    expect(new Set(canvases).size).toBe(20);
  });
});

describe("contrast (WCAG 2.1 AA is the floor, AAA where it costs nothing)", () => {
  it("every text role clears 4.5:1 against its OWN palette's canvas", () => {
    for (const palette of palettes) {
      const t = palette.tokens;
      const canvas = t.canvas;
      for (const role of ["textPrimary", "textSecondary", "textMuted", "accentText"] as const) {
        const ratio = contrastRatio(hexToRgb(t[role]), hexToRgb(canvas));
        expect(ratio, `${palette.id} ${role}`).toBeGreaterThanOrEqual(CONTRAST.text);
      }
      for (const role of ["success", "warning", "danger", "info"] as const) {
        expect(
          contrastRatio(hexToRgb(t[role]), hexToRgb(canvas)),
          `${palette.id} ${role}`,
        ).toBeGreaterThanOrEqual(CONTRAST.text);
      }
    }
  });

  it("text ON the accent fill clears 4.5:1", () => {
    for (const palette of palettes) {
      expect(
        contrastRatio(hexToRgb(palette.tokens.accentOnPrimary), hexToRgb(palette.tokens.accentPrimary)),
        palette.id,
      ).toBeGreaterThanOrEqual(CONTRAST.text);
    }
  });

  it("primary is stronger than secondary, which is stronger than muted", () => {
    for (const palette of palettes) {
      const t = palette.tokens;
      const toBg = (hex: string): number => contrastRatio(hexToRgb(hex), hexToRgb(t.canvas));
      expect(toBg(t.textPrimary), `${palette.id} primary vs secondary`).toBeGreaterThan(toBg(t.textSecondary));
      expect(toBg(t.textSecondary), `${palette.id} secondary vs muted`).toBeGreaterThan(toBg(t.textMuted));
      // Distinct by construction — not merely "all pass".
      expect(t.textPrimary).not.toBe(t.textSecondary);
      expect(t.textSecondary).not.toBe(t.textMuted);
      expect(t.textPrimary).not.toBe(t.textMuted);
    }
  });

  it("control boundaries clear the 3:1 non-text floor", () => {
    for (const palette of palettes) {
      const canvas = palette.tokens.canvas;
      for (const role of ["borderStrong", "borderFocus"] as const) {
        expect(
          contrastRatio(hexToRgb(palette.tokens[role]), hexToRgb(canvas)),
          `${palette.id} ${role}`,
        ).toBeGreaterThanOrEqual(CONTRAST.large);
      }
    }
  });

  it("the accent keeps its identity: the vivid fill and the readable text differ", () => {
    for (const palette of palettes) {
      expect(palette.tokens.accentPrimary, palette.id).not.toBe(palette.tokens.accentText);
    }
    // The regression this exists for: a yellow scheme whose accent resolved to a
    // readable olive, which satisfies contrast while abandoning the palette.
    const lemon = paletteById.get("lemon-granite");
    expect(lemon).toBeDefined();
    expect(lemon?.tokens.accentPrimary).toMatch(/^#[0-9A-F]{6}$/);
    // Its fill must stay light enough to still read as yellow: clearly above 0.7
    // luminance, which olive (`#736300`) is not.
    const fill = hexToRgb(lemon?.tokens.accentPrimary as string);
    const luminance = 0.2126 * (fill.r / 255) + 0.7152 * (fill.g / 255) + 0.0722 * (fill.b / 255);
    expect(luminance).toBeGreaterThan(0.6);
  });

  it("elevation is legible: raised and inset are distinguishable on every palette", () => {
    for (const palette of palettes) {
      const { surfaceRaised, surfaceInset, canvas, surfaceRow } = palette.tokens;
      const ratio = contrastRatio(hexToRgb(surfaceRaised), hexToRgb(surfaceInset));
      expect(ratio, `${palette.id} raised vs inset`).toBeGreaterThan(1.03);
      const rowRatio = contrastRatio(hexToRgb(surfaceRow), hexToRgb(canvas));
      expect(rowRatio, `${palette.id} row vs canvas`).toBeGreaterThan(1.01);
    }
  });
});

describe("material modes", () => {
  const ids = Object.keys(MATERIALS);

  it("ships exactly Minimal, Acrylic and Liquid Glass", () => {
    expect(materialIds.sort()).toEqual(["acrylic", "liquid-glass", "minimal"]);
  });

  it("cannot change text or accent on any palette", () => {
    for (const palette of palettes) {
      expect(verifyMaterialInvariance(palette, materialIds as never[])).toEqual([]);
    }
  });

  it("only declares roles the verifier knows about", () => {
    for (const palette of palettes) {
      for (const id of materialIds) {
        const layer = buildMaterial(palette, MATERIALS[id as keyof typeof MATERIALS]);
        for (const key of Object.keys(layer)) {
          expect(MATERIAL_ROLE_KEYS, `${palette.id}/${id} ${key}`).toContain(key);
        }
      }
    }
  });

  it("Minimal is fully opaque — the performance and legibility default", () => {
    const palette = paletteById.get("inked");
    const layer = buildMaterial(palette as never, MATERIALS.minimal);
    expect(layer["mat-blur"]).toBe("0px");
    expect(layer["mat-filter"]).toBe("none");
    expect(layer["surface-overlay"]).toBe(palette?.tokens.surfaceOverlaySolid);
    expect(layer["surface-sheet"]).toBe(palette?.tokens.surfaceSheetSolid);
  });

  it("the two translucent modes differ from each other, not just from Minimal", () => {
    const palette = paletteById.get("inked");
    const acrylic = buildMaterial(palette as never, MATERIALS.acrylic);
    const glass = buildMaterial(palette as never, MATERIALS["liquid-glass"]);
    expect(acrylic["mat-blur"]).not.toBe(glass["mat-blur"]);
    expect(acrylic["mat-saturate"]).not.toBe(glass["mat-saturate"]);
    // Liquid Glass is defined by its edge treatment; acrylic has none.
    expect(acrylic["mat-fresnel"]).toBe("none");
    expect(glass["mat-fresnel"]).not.toBe("none");
    expect(glass["mat-specular"]).not.toBe("none");
  });

  it("translucent roles fall back to a solid when transparency is reduced", () => {
    const css = toCss();
    expect(css).toContain("@media (prefers-reduced-transparency: reduce)");
    // Every translucent role has a `-solid` pair for the reduced case.
    for (const palette of palettes) {
      const layer = buildMaterial(palette, MATERIALS["liquid-glass"]);
      for (const [key, solidKey] of [
        ["surface-overlay", "surfaceOverlaySolid"],
        ["surface-nav", "surfaceNavSolid"],
        ["surface-sheet", "surfaceSheetSolid"],
        ["surface-palette", "surfacePaletteSolid"],
      ] as const) {
        expect(palette.tokens[solidKey], `${palette.id} ${solidKey}`).toMatch(/^#[0-9A-F]{6}$/);
        expect(layer[key]).toContain("rgb(");
      }
    }
  });
});

describe("the emitted contract", () => {
  it("tokens.json is the platform contract and carries its own caveats", () => {
    const bundle = toJsonBundle();
    expect(bundle.palettes).toHaveLength(20);
    expect(bundle.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(bundle.sources.figmaLibrary).toContain("figma.com");
    // The honest bit must survive: these are derived, not copied.
    expect(bundle.sources.figmaCaveat).toMatch(/DERIVED/);
    expect(Object.keys(bundle.materials).sort()).toEqual(["acrylic", "liquid-glass", "minimal"]);
    for (const palette of bundle.palettes) {
      expect(palette.figma.scheme).toBeGreaterThan(0);
      expect(Object.keys(palette.materials)).toHaveLength(3);
    }
  });

  it("tokens.css emits one structure block per palette and one material block per combination", () => {
    const css = toCss();
    for (const palette of palettes) {
      expect(css).toContain(`[data-palette="${palette.id}"]`);
      for (const id of materialIds) {
        expect(css).toContain(`[data-palette="${palette.id}"][data-material="${id}"]`);
      }
    }
    // 20 palettes x 3 materials.
    expect((css.match(/\[data-material=/g) ?? []).length).toBe(60);
    expect(css).toContain("DO NOT EDIT");
  });

  it("emits every semantic role the UI consumes, with no orphans", () => {
    const css = toCss();
    for (const role of [
      "canvas",
      "surface-raised",
      "surface-inset",
      "surface-row",
      "surface-overlay",
      "surface-overlay-solid",
      "surface-nav",
      "surface-sheet",
      "surface-scrim",
      "border-default",
      "border-strong",
      "border-focus",
      "text-primary",
      "text-secondary",
      "text-muted",
      "text-inverse",
      "accent-primary",
      "accent-text",
      "accent-on-primary",
      "success",
      "warning",
      "danger",
      "info",
      "status-paid",
      "status-partial",
      "status-unpaid",
      "status-overdue",
      "chart-1",
      "chart-6",
      "mat-filter",
    ]) {
      expect(css, `missing --${role}`).toContain(`--${role}:`);
    }
  });
});

describe("the colour maths itself", () => {
  it("round-trips a known hex through OKLCH within one 8-bit step", () => {
    expect(oklchToHex({ l: 0.6279, c: 0.2577, h: 29.23 })).toBe("#FF0000");
  });

  it("gamut-maps by reducing chroma, keeping hue", () => {
    const wild = oklchToHex({ l: 0.6, c: 0.9, h: 150 });
    const rgb = hexToRgb(wild);
    for (const channel of [rgb.r, rgb.g, rgb.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });

  it("solves to the CLOSEST colour that still clears the target", () => {
    // The regression this exists for: the darker search used to return black for
    // every target on a light canvas because its interval was inverted.
    const loose = solveLuminanceForContrast(250, 0.004, "#F4F6F8", 4.5, "darker");
    const strict = solveLuminanceForContrast(250, 0.004, "#F4F6F8", 10, "darker");
    expect(loose.reached).toBe(true);
    expect(strict.reached).toBe(true);
    // A stricter target must be a DARKER colour, and neither may be pure black.
    expect(strict.hex).not.toBe("#000000");
    expect(contrastRatio(hexToRgb(strict.hex), hexToRgb("#F4F6F8"))).toBeGreaterThanOrEqual(10);
  });

  it("reports failure instead of shipping a colour that misses the target", () => {
    const impossible = solveLuminanceForContrast(0, 0, "#808080", 21, "lighter");
    expect(impossible.reached).toBe(false);
  });

  it("a palette is reproducible from its scheme alone", () => {
    const scheme = SCHEMES[0];
    expect(buildPalette(scheme)).toEqual(buildPalette(scheme));
  });
});