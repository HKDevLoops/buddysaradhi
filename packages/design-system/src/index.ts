// Implements: docs/design/overhaul-plan.md §2.2 — the platform contract.
//
// `tokens.json` is the single artefact every platform reads: Tailwind 4 in
// apps/web, NativeWind 5 in apps/mobile, the shared globals.css in apps/desktop,
// and the hand-written mappings for SwiftUI / WinUI / macOS vibrancy. `tokens.css`
// is the web projection of the same data — generated, never edited, so the CSS and
// the JSON cannot drift.
//
// Consumers must not import internals: `index.ts` is the only public surface.

import { SCHEMES, type SchemeDefinition } from "./schemes";
import { buildAllPalettes, type GeneratedPalette } from "./tokens";
import { MATERIALS, buildMaterial, type MaterialId } from "./material";
import { buildAndVerify, type Finding } from "./verify";
import { contrastRatio, hexToRgb, oklchToHex } from "./oklch";

export {
  SCHEMES,
  SCHEMES_BY_ID,
  DARK_SCHEMES,
  LIGHT_SCHEMES,
  type SchemeDefinition,
  type SemanticHues,
} from "./schemes";
export { buildPalette, buildAllPalettes, CONTRAST, type GeneratedPalette, type PaletteTokens } from "./tokens";
export {
  MATERIALS,
  MATERIAL_IDS,
  MATERIAL_ROLE_KEYS,
  buildMaterial,
  type MaterialDefinition,
  type MaterialId,
} from "./material";
export { buildAndVerify, verifyPalette, verifyUniqueness, verifyMaterialInvariance, type Finding } from "./verify";
export {
  oklchToRgb,
  oklchToHex,
  hexToRgb,
  rgbToHex,
  contrastRatio,
  relativeLuminance,
  meetsContrast,
  maxChroma,
  solveLuminanceForContrast,
  mixHex,
  type Rgb,
  type Oklch,
} from "./oklch";

/** Palette id + CSS-safe selector, e.g. `amethyst-mint` → `amethyst-mint`. */
export function paletteSelector(id: string): string {
  return id;
}

/**
 * camelCase token key → kebab-case CSS custom property.
 * The digit rule matters: without it `chart1` emitted as `--chart1`, which reads
 * as a typo next to `--chart-2`-style names in every future stylesheet.
 */
function cssVar(key: string): string {
  const kebab = key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .toLowerCase();
  return `--${kebab}`;
}

export interface TokenBundleJson {
  version: string;
  generator: string;
  sources: {
    figmaLibrary: string;
    figmaCaveat: string;
    contrastStandard: string;
  };
  materials: Record<MaterialId, { name: string; blurb: string }>;
  palettes: Array<{
    id: string;
    name: string;
    tier: "dark" | "light";
    figma: { scheme: number; name: string; note: string };
    structure: Record<string, string>;
    materials: Record<MaterialId, Record<string, string>>;
  }>;
}

export const TOKEN_VERSION = "1.0.0";

/** `{ minimal: {name, blurb}, ... }` — typed, so a new mode cannot be half-added. */
function materialSummaries(): Record<MaterialId, { name: string; blurb: string }> {
  const out = {} as Record<MaterialId, { name: string; blurb: string }>;
  for (const id of Object.keys(MATERIALS) as MaterialId[]) {
    out[id] = { name: MATERIALS[id].name, blurb: MATERIALS[id].blurb };
  }
  return out;
}

/** One palette's material layer, one key per mode. */
function materialLayers(palette: GeneratedPalette): Record<MaterialId, Record<string, string>> {
  const out = {} as Record<MaterialId, Record<string, string>>;
  for (const id of Object.keys(MATERIALS) as MaterialId[]) {
    out[id] = buildMaterial(palette, MATERIALS[id]);
  }
  return out;
}

export function toJsonBundle(): TokenBundleJson {
  const palettes = buildAllPalettes(SCHEMES);
  return {
    version: TOKEN_VERSION,
    generator: "@buddysaradhi/design-system",
    sources: {
      figmaLibrary: "https://www.figma.com/resource-library/website-color-schemes/",
      figmaCaveat:
        "The library publishes 53 scheme names and descriptions, no hex values. Every colour here is DERIVED from each scheme's documented hue/chroma/temperature and then contrast-verified; the figma.scheme number travels with each palette for auditing.",
      contrastStandard: "WCAG 2.1 AA — 4.5:1 text, 3:1 large text and UI components.",
    },
    materials: materialSummaries(),
    palettes: palettes.map((palette) => ({
      id: palette.id,
      name: palette.name,
      tier: palette.tier,
      figma: { scheme: palette.figmaScheme, name: palette.figmaName, note: palette.note },
      structure: palette.tokens as unknown as Record<string, string>,
      materials: materialLayers(palette),
    })),
  };
}

/**
 * The web CSS projection.
 *
 * Structure first (once, `:root`), then each palette's structure under
 * `[data-palette="<id>"]`, then each palette×material overlay under
 * `[data-palette="<id>"][data-material="<mode>"]`. Cascade order means a material
 * block only needs to declare the MATERIAL roles — the structure inherits from the
 * palette block, which is what keeps the emitted CSS about 40% smaller and makes
 * the "material cannot change text" invariant true in the stylesheet itself, not
 * only in the verifier.
 */
export function toCss(): string {
  const palettes = buildAllPalettes(SCHEMES);
  const materialIds = Object.keys(MATERIALS) as MaterialId[];
  const lines: string[] = [];

  lines.push("/* GENERATED by @buddysaradhi/design-system — DO NOT EDIT.");
  lines.push(" * Source: packages/design-system/src (schemes.ts + tokens.ts + material.ts)");
  lines.push(" * Regenerate: pnpm --filter @buddysaradhi/design-system emit");
  lines.push(" * Verify:    pnpm --filter @buddysaradhi/design-system verify");
  lines.push(" * Spec: docs/design/overhaul-plan.md §2");
  lines.push(" */");

  const structEntries = (palette: GeneratedPalette): string[] =>
    Object.entries(palette.tokens).map(([key, value]) => `  ${cssVar(key)}: ${value};`);

  lines.push(":root {");
  lines.push("  color-scheme: dark;");
  lines.push(...structEntries(palettes.find((p) => p.tier === "dark") as GeneratedPalette));
  lines.push("}");

  for (const palette of palettes) {
    lines.push("");
    lines.push(`/* ${palette.name} — Figma scheme ${palette.figmaScheme} (${palette.figmaName}) */`);
    lines.push(`[data-palette="${paletteSelector(palette.id)}"] {`);
    lines.push(`  color-scheme: ${palette.tier};`);
    lines.push(...structEntries(palette));
    lines.push("}");
  }

  for (const palette of palettes) {
    for (const id of materialIds) {
      const material = buildMaterial(palette, MATERIALS[id]);
      lines.push("");
      lines.push(
        `/* ${palette.name} · ${MATERIALS[id].name} — material layer (text/accent inherited) */`,
      );
      lines.push(
        `[data-palette="${paletteSelector(palette.id)}"][data-material="${id}"] {`,
      );
      for (const [key, value] of Object.entries(material)) lines.push(`  ${cssVar(key)}: ${value};`);
      lines.push("}");
    }
  }

  lines.push("");
  lines.push("@media (prefers-reduced-transparency: reduce) {");
  lines.push("  /* Solid fallbacks for the translucent roles — legibility before material. */");
  for (const palette of palettes) {
    lines.push(`  [data-palette="${paletteSelector(palette.id)}"] {`);
    for (const key of ["surface-overlay", "surface-nav", "surface-sheet", "surface-palette"]) {
      lines.push(`    ${cssVar(key)}: var(${cssVar(`${key}-solid`)});`);
    }
    lines.push(`    ${cssVar("mat-filter")}: none;`);
    lines.push("  }");
  }
  lines.push("}");

  lines.push("");
  lines.push("@media (prefers-contrast: more) {");
  lines.push("  [data-palette] {");
  lines.push(`    ${cssVar("border-default")}: var(${cssVar("border-strong")});`);
  lines.push(`    ${cssVar("text-muted")}: var(${cssVar("text-secondary")});`);
  lines.push("  }");
  lines.push("}");

  return `${lines.join("\n")}\n`;
}

/** The three material modes, exported for a Settings picker. */
export function materialOptions(): Array<{ id: MaterialId; name: string; blurb: string }> {
  return Object.values(MATERIALS).map((m) => ({ id: m.id, name: m.name, blurb: m.blurb }));
}

export { buildAndVerify as verifyTokens };

/** Convenience for the settings screen: a palette's swatch hexes. */
export function paletteSwatches(id: string): { canvas: string; raised: string; accent: string } | null {
  const palette = buildAllPalettes(SCHEMES).find((p) => p.id === id);
  if (!palette) return null;
  return {
    canvas: palette.tokens.canvas,
    raised: palette.tokens.surfaceRaised,
    accent: palette.tokens.accentPrimary,
  };
}

export type { Finding as TokenFinding };