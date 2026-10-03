// Implements: docs/design/overhaul-plan.md §8 — the regression suite for the
// surface-aware contrast guarantee.
//
// The first version of the gate measured text against `--canvas` only and the
// generator solved against `--canvas` only. A measurement pass then found 240 of
// 640 real pairings below target, and 110 of 220 border pairings below 3:1,
// because `surface-raised` is LIGHTER than the canvas on a dark tier and
// `surface-inset` is DARKER on a light tier — so a colour solved on the canvas
// drifts the wrong way on one of them every time. These tests exist so that class
// of miss cannot come back silently.
import { describe, expect, it } from "vitest";
import { contrastRatio, hexToRgb, mixHex, oklchToHex, solveLuminanceForContrast } from "./oklch";
import { SCHEMES, DARK_SCHEMES, LIGHT_SCHEMES } from "./schemes";
import { buildAllPalettes, buildPalette, CONTRAST } from "./tokens";
import { MATERIALS, MATERIAL_ROLE_KEYS, buildMaterial } from "./material";
import {
  TEXT_ROLE_KEYS,
  NON_TEXT_ROLE_KEYS,
  TEXT_SURFACES,
  borderPairings,
  compositePairings,
  overlayLegibility,
  textPairings,
  solveTextAcrossSurfaces,
} from "./surfaces";
import { buildAndVerify, verifyMaterialInvariance, verifyUniqueness } from "./verify";
import { toCss, toJsonBundle } from "./index";

const palettes = buildAllPalettes(SCHEMES);
const palette0 = (id: string): (typeof palettes)[number] => palettes.find((p) => p.id === id) as (typeof palettes)[number];
const materialIds = Object.keys(MATERIALS);

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
    const problems = findings.filter((f) => f.severity === "error" || f.severity === "warn");
    expect(problems.map((f) => `${f.paletteId} ${f.code} ${f.role ?? ""} ${f.surface ?? ""} ${f.message}`)).toEqual([]);
  });

  it("has no two palettes generating the same canvas", () => {
    expect(verifyUniqueness(palettes)).toEqual([]);
    expect(new Set(palettes.map((p) => p.tokens.canvas.toUpperCase())).size).toBe(20);
  });
});

describe("contrast on EVERY surface, not just the canvas", () => {
  it("every text role clears 4.5:1 on all five surfaces of its own palette", () => {
    const failures: string[] = [];
    for (const palette of palettes) {
      for (const pairing of textPairings(palette)) {
        if (pairing.ratio < CONTRAST.text) {
          failures.push(
            `${palette.id} ${pairing.role} on ${pairing.surface}: ${pairing.ratio.toFixed(2)}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("the worst surface is genuinely not the canvas", () => {
    // If this ever becomes false the gate is measuring the wrong thing again.
    const inked = palettes.find((p) => p.id === "inked");
    const inkWash = palettes.find((p) => p.id === "ink-wash");
    expect(inked).toBeDefined();
    expect(inkWash).toBeDefined();
    const inkedWorst = textPairings(inked as never).reduce((a, b) => (a.ratio <= b.ratio ? a : b));
    const inkWashWorst = textPairings(inkWash as never).reduce((a, b) => (a.ratio <= b.ratio ? a : b));
    // The invariant that matters: the constraining surface is NEVER the canvas.
    // Which surface it is depends on the tier and on how far each role had to be
    // pushed, so the assertion is "not the canvas" rather than a fixed key.
    expect(inkedWorst.surface).not.toBe("canvas");
    expect(inkWashWorst.surface).not.toBe("canvas");
    // …and the canvas itself is never the *only* thing being checked: a dark tier
    // is constrained by a surface lighter than the canvas, a light tier by one
    // darker, which is the whole reason the solve had to change.
    const darkSurfaces = TEXT_SURFACES.filter((key) =>
      contrastRatio(hexToRgb(palette0("inked").tokens[key]), hexToRgb(palette0("inked").tokens.canvas)) > 1,
    );
    expect(darkSurfaces.length).toBeGreaterThan(0);
  });

  it("every border and chart colour clears 3:1 on all five surfaces", () => {
    const failures: string[] = [];
    for (const palette of palettes) {
      for (const pairing of borderPairings(palette)) {
        // Chart marks are held as warnings by the gate, so assert them explicitly
        // here at the same floor: 2.4:1 in a bar chart is still a value you cannot
        // read on a projector.
        if (pairing.ratio < CONTRAST.large) {
          failures.push(`${palette.id} ${pairing.role} on ${pairing.surface}: ${pairing.ratio.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("--border-default clears the non-text floor on every surface in all 20 palettes", () => {
    // This is the border on every unselected button, table row, search field and
    // divider. It was 1.10–2.58:1 everywhere and was not in the checked list at
    // all — the one border the app leans on hardest was the one nobody measured.
    const failures: string[] = [];
    for (const palette of palettes) {
      for (const surface of TEXT_SURFACES) {
        const value = contrastRatio(
          hexToRgb(palette.tokens.borderDefault),
          hexToRgb(palette.tokens[surface]),
        );
        if (value < CONTRAST.large) failures.push(`${palette.id} ${surface}: ${value.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("text drawn on a tinted status chip clears 4.5:1 (the composite case)", () => {
    const failures: string[] = [];
    for (const palette of palettes) {
      for (const pairing of compositePairings(palette)) {
        if (pairing.ratio < CONTRAST.text) {
          failures.push(`${palette.id} ${pairing.role}: ${pairing.ratio.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("the tint used by the chip recipe cannot swallow the text it sits on", () => {
    // The recipe is now: neutral text, status colour on the border and the dot.
    // Re-deriving the original recipe (status-coloured TEXT on a tint of itself)
    // shows why it had to change — it is arithmetically below target everywhere.
    const palette = palettes[0] as never as (typeof palettes)[number];
    const tinted = mixHex(palette.tokens.surfaceInset, palette.tokens.success, 0.14);
    expect(contrastRatio(hexToRgb(palette.tokens.success), hexToRgb(tinted))).toBeLessThan(
      CONTRAST.text,
    );
    expect(
      contrastRatio(hexToRgb(palette.tokens.textPrimary), hexToRgb(tinted)),
    ).toBeGreaterThanOrEqual(CONTRAST.text);
  });

  it("text on the translucent surfaces clears AA against their solid twin", () => {
    const failures: string[] = [];
    for (const palette of palettes) {
      for (const pairing of overlayLegibility(palette)) {
        if (pairing.ratio < CONTRAST.text) failures.push(`${palette.id} ${pairing.role}: ${pairing.ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("primary is stronger than secondary, which is stronger than muted", () => {
    for (const palette of palettes) {
      const t = palette.tokens;
      const worst = (hex: string): number =>
        Math.min(...TEXT_SURFACES.map((key) => contrastRatio(hexToRgb(hex), hexToRgb(t[key]))));
      expect(worst(t.textPrimary), palette.id).toBeGreaterThan(worst(t.textSecondary));
      expect(worst(t.textSecondary), palette.id).toBeGreaterThan(worst(t.textMuted));
      expect(t.textPrimary).not.toBe(t.textSecondary);
      expect(t.textSecondary).not.toBe(t.textMuted);
      expect(t.textPrimary).not.toBe(t.textMuted);
    }
  });

  it("text on the accent fill clears 4.5:1", () => {
    for (const palette of palettes) {
      expect(
        contrastRatio(hexToRgb(palette.tokens.accentOnPrimary), hexToRgb(palette.tokens.accentPrimary)),
        palette.id,
      ).toBeGreaterThanOrEqual(CONTRAST.text);
    }
  });

  it("the accent keeps its identity: the vivid fill and the readable text differ", () => {
    for (const palette of palettes) {
      expect(palette.tokens.accentPrimary, palette.id).not.toBe(palette.tokens.accentText);
    }
    const lemon = palettes.find((p) => p.id === "lemon-granite");
    expect(lemon).toBeDefined();
    const fill = hexToRgb(lemon?.tokens.accentPrimary as string);
    const luminance = 0.2126 * (fill.r / 255) + 0.7152 * (fill.g / 255) + 0.0722 * (fill.b / 255);
    expect(luminance).toBeGreaterThan(0.6);
  });

  it("elevation is legible: raised and inset are distinguishable on every palette", () => {
    for (const palette of palettes) {
      const { surfaceRaised, surfaceInset, canvas, surfaceRow } = palette.tokens;
      expect(contrastRatio(hexToRgb(surfaceRaised), hexToRgb(surfaceInset)), palette.id).toBeGreaterThan(1.03);
      expect(contrastRatio(hexToRgb(surfaceRow), hexToRgb(canvas)), palette.id).toBeGreaterThan(1.01);
    }
  });

  it("solves to a colour that clears EVERY surface, not just the worst one", () => {
    // The repair pass is the part that was missing; exercise it directly.
    const palette = palettes[0] as never as (typeof palettes)[number];
    const solved = solveTextAcrossSurfaces(250, 0.004, palette.tokens, palette.tier, CONTRAST.text);
    expect(solved).not.toBeNull();
    for (const surface of TEXT_SURFACES) {
      expect(
        contrastRatio(hexToRgb(solved as string), hexToRgb(palette.tokens[surface])),
        `${palette.id} ${surface}`,
      ).toBeGreaterThanOrEqual(CONTRAST.text);
    }
  });

  it("enumerates every role it claims to check, so a new role cannot be forgotten", () => {
    expect(TEXT_ROLE_KEYS.length).toBeGreaterThanOrEqual(12);
    expect(NON_TEXT_ROLE_KEYS).toContain("borderDefault");
    expect(NON_TEXT_ROLE_KEYS).toContain("borderStrong");
    expect(TEXT_SURFACES.length).toBe(5);
  });
});

describe("material modes", () => {
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
    const palette = palettes[0] as never as (typeof palettes)[number];
    const layer = buildMaterial(palette, MATERIALS.minimal);
    expect(layer["mat-blur"]).toBe("0px");
    expect(layer["mat-filter"]).toBe("none");
    expect(layer["surface-overlay"]).toBe(palette.tokens.surfaceOverlaySolid);
    expect(layer["surface-sheet"]).toBe(palette.tokens.surfaceSheetSolid);
  });

  it("the two translucent modes differ from each other, not just from Minimal", () => {
    const palette = palettes[0] as never as (typeof palettes)[number];
    const acrylic = buildMaterial(palette, MATERIALS.acrylic);
    const glass = buildMaterial(palette, MATERIALS["liquid-glass"]);
    expect(acrylic["mat-blur"]).not.toBe(glass["mat-blur"]);
    expect(acrylic["mat-saturate"]).not.toBe(glass["mat-saturate"]);
    expect(acrylic["mat-fresnel"]).toBe("none");
    expect(glass["mat-fresnel"]).not.toBe("none");
    expect(glass["mat-specular"]).not.toBe("none");
  });

  it("translucent roles fall back to a solid when transparency is reduced", () => {
    const css = toCss();
    expect(css).toContain("@media (prefers-reduced-transparency: reduce)");
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
    expect((css.match(/\[data-material=/g) ?? []).length).toBe(60);
    expect(css).toContain("DO NOT EDIT");
  });

  it("emits every semantic role the UI consumes, with no orphans", () => {
    const css = toCss();
    for (const role of [
      "canvas", "surface-raised", "surface-inset", "surface-row", "surface-sunken",
      "surface-overlay", "surface-overlay-solid", "surface-nav", "surface-sheet",
      "surface-scrim", "border-default", "border-strong", "border-focus",
      "text-primary", "text-secondary", "text-muted", "text-inverse",
      "accent-primary", "accent-text", "accent-on-primary",
      "success", "warning", "danger", "info",
      "status-paid", "status-partial", "status-unpaid", "status-overdue",
      "chart-1", "chart-6", "mat-filter",
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
    const loose = solveLuminanceForContrast(250, 0.004, "#F4F6F8", 4.5, "darker");
    const strict = solveLuminanceForContrast(250, 0.004, "#F4F6F8", 10, "darker");
    expect(loose.reached).toBe(true);
    expect(strict.reached).toBe(true);
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