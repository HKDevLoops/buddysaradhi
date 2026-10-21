// Implements: docs/design/material-modes.md §2.0 (the material layer) +
// 13_UI_Guidelines.md §5.1 (the glass tiers' legibility base) — the regression
// suite for the material modes' translucent overlay.
//
// The overlay is the ONE material role the app paints over the aurora, and it
// is the one that had no legibility base: at 15 % (Acrylic) / 34 % (Liquid
// Glass) opaque it composited straight over the 20 % aurora and dropped
// `--text-primary` from 10.06 : 1 to 8.38 : 1 on `honey-opal` — under the 10 : 1
// floor the role was solved for. These tests pin the cure: the overlay's
// composite is EXACTLY the two-layer paint (tint over base over backdrop), it
// carries the base, and it holds every text role's floor.
//
// The backdrop half of the guarantee — the real aurora, painted at every pixel
// of three viewport aspect ratios — is measured in the app that owns the
// aurora: `apps/web/src/app/token-layer.test.ts`.
import { describe, expect, it } from "vitest";
import { hexToRgb, rgbToHex } from "./oklch";
import { SCHEMES } from "./schemes";
import { buildAllPalettes, TEXT_TARGETS } from "./tokens";
import {
  MATERIALS,
  OVERLAY_LEGIBILITY_BASE,
  buildMaterial,
  compositeOverBase,
  formatComposite,
  paintComposite,
} from "./material";
import { ratio } from "./surfaces";

const palettes = buildAllPalettes(SCHEMES);
const materialIds = Object.keys(MATERIALS) as Array<keyof typeof MATERIALS>;

/** sRGB alpha blending, the way CSS paints an alpha fill. */
function over(fill: string, backdrop: string, alpha: number): string {
  const f = hexToRgb(fill);
  const b = hexToRgb(backdrop);
  const mix = (x: number, y: number): number => Math.round(x * alpha + y * (1 - alpha));
  return rgbToHex({ r: mix(f.r, b.r), g: mix(f.g, b.g), b: mix(f.b, b.b) });
}

describe("the overlay's legibility base", () => {
  it("leaves an opaque tint alone — Minimal is opaque and a base would be invisible", () => {
    for (const palette of palettes) {
      const composite = compositeOverBase(
        palette.tokens.surfaceOverlaySolid,
        palette.tokens.canvas,
        1,
        OVERLAY_LEGIBILITY_BASE,
      );
      expect(composite.alpha).toBe(1);
      expect(rgbToHex(composite.rgb)).toBe(palette.tokens.surfaceOverlaySolid.toUpperCase());
    }
  });

  it("is EXACTLY the two-layer paint: tint over base over backdrop", () => {
    // The single-colour form has to reproduce what the browser paints for
    // "tint @ a, then base @ Y, then the backdrop" — otherwise the token is a
    // different surface than the mechanism claims.
    for (const palette of palettes) {
      const tokens = palette.tokens;
      for (const mode of materialIds) {
        const alpha = Number(MATERIALS[mode].overlayAlpha);
        if (alpha >= 1) continue;
        const composite = compositeOverBase(
          tokens.surfaceOverlaySolid,
          tokens.canvas,
          alpha,
          OVERLAY_LEGIBILITY_BASE,
        );
        const backdrop = tokens.surfaceRaised;
        const oneLayer = paintComposite(composite, backdrop);
        const twoLayers = over(
          tokens.surfaceOverlaySolid,
          over(tokens.canvas, backdrop, OVERLAY_LEGIBILITY_BASE),
          alpha,
        );
        const a = hexToRgb(oneLayer);
        const b = hexToRgb(twoLayers);
        // One 8-bit rounding apart at most: the two-layer form rounds its
        // intermediate, the single-layer form rounds once.
        expect(Math.abs(a.r - b.r), `${palette.id} · ${mode} · red`).toBeLessThanOrEqual(1);
        expect(Math.abs(a.g - b.g), `${palette.id} · ${mode} · green`).toBeLessThanOrEqual(1);
        expect(Math.abs(a.b - b.b), `${palette.id} · ${mode} · blue`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("carries the base in every translucent mode, on every palette", () => {
    for (const palette of palettes) {
      for (const mode of materialIds) {
        const alpha = Number(MATERIALS[mode].overlayAlpha);
        if (alpha >= 1) continue;
        const expected = alpha + (1 - alpha) * OVERLAY_LEGIBILITY_BASE;
        const composite = compositeOverBase(
          palette.tokens.surfaceOverlaySolid,
          palette.tokens.canvas,
          alpha,
          OVERLAY_LEGIBILITY_BASE,
        );
        expect(composite.alpha, `${palette.id} · ${mode}`).toBeCloseTo(expected, 3);
        const emitted = buildMaterial(palette, MATERIALS[mode])["surface-overlay"] ?? "";
        expect(emitted, `${palette.id} · ${mode}`).toBe(formatComposite(composite));
      }
    }
  });

  it("NEGATIVE CONTROL: without the base the overlay is the raw tint, and the base darkens it", () => {
    for (const palette of palettes) {
      const tokens = palette.tokens;
      const raw = compositeOverBase(tokens.surfaceOverlaySolid, tokens.canvas, 0.15, 0);
      expect(rgbToHex(raw.rgb), palette.id).toBe(tokens.surfaceOverlaySolid.toUpperCase());
      expect(raw.alpha, palette.id).toBeCloseTo(0.15, 3);
      const based = compositeOverBase(
        tokens.surfaceOverlaySolid,
        tokens.canvas,
        0.15,
        OVERLAY_LEGIBILITY_BASE,
      );
      // The canvas is darker than the overlay's own tone in every palette, so
      // the base always pulls the overlay's colour DOWN — toward the palette's
      // own ground, where the text roles were solved.
      const before = relativeLuminance(hexToRgb(tokens.surfaceOverlaySolid));
      const after = relativeLuminance(based.rgb);
      expect(after, palette.id).toBeLessThan(before);
    }
  });

  it("holds every text role's floor over the palette's own canvas", () => {
    const floors = {
      textPrimary: TEXT_TARGETS.primary,
      textSecondary: TEXT_TARGETS.secondary,
      textMuted: TEXT_TARGETS.muted,
    } as const;
    for (const palette of palettes) {
      const tokens = palette.tokens;
      for (const mode of materialIds) {
        const composite = compositeOverBase(
          tokens.surfaceOverlaySolid,
          tokens.canvas,
          Number(MATERIALS[mode].overlayAlpha),
          OVERLAY_LEGIBILITY_BASE,
        );
        const painted = paintComposite(composite, tokens.canvas);
        for (const role of ["textPrimary", "textSecondary", "textMuted"] as const) {
          const measured = ratio(tokens[role], painted);
          expect(measured, `${palette.id} · ${mode} · ${role}`).toBeGreaterThanOrEqual(
            floors[role],
          );
        }
      }
    }
  });
});

/** WCAG relative luminance, for the one comparison the tests above need. */
function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}
