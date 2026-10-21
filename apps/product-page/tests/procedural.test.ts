// Implements: the owner's brief for this surface - "the site's textures,
// backgrounds, noise and gradients are GENERATED IN CODE, procedurally and
// deterministically".
//
// The word that matters is DETERMINISTICALLY. A texture that changes between
// renders is a hydration mismatch waiting to happen (AGENTS.md FM-14) and a
// diff nobody can review. These tests hold the generators to that.

import { describe, expect, it } from "vitest";
import {
  auroraLayers,
  fbm2D,
  grainTileDataUrl,
  hexToRgbTriplet,
  mulberry32,
  seedFromString,
  valueNoise2D,
  vignetteCssFromRgb,
} from "../src/lib/procedural";

describe("mulberry32 (the seeded PRNG)", () => {
  it("produces the same sequence for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 32; i += 1) expect(a()).toBe(b());
  });

  it("produces a different sequence for a different seed", () => {
    expect(mulberry32(42)()).not.toBe(mulberry32(43)());
  });

  it("stays inside [0, 1)", () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 500; i += 1) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("treats a negative seed as a well-defined one", () => {
    expect(Number.isFinite(mulberry32(-1)())).toBe(true);
  });
});

describe("seedFromString", () => {
  it("is stable for the same name", () => {
    expect(seedFromString("buddysaradhi/hero-poster-grain")).toBe(
      seedFromString("buddysaradhi/hero-poster-grain"),
    );
  });

  it("separates different names", () => {
    expect(seedFromString("a")).not.toBe(seedFromString("b"));
  });
});

describe("the noise fields", () => {
  it("value noise is deterministic", () => {
    const a = valueNoise2D(11);
    const b = valueNoise2D(11);
    expect(a(0.3, 0.7)).toBe(b(0.3, 0.7));
    expect(a(2.5, 1.25)).toBe(b(2.5, 1.25));
  });

  it("fbm noise is deterministic and bounded", () => {
    const field = fbm2D(11);
    for (let x = 0; x < 4; x += 0.37) {
      for (let y = 0; y < 4; y += 0.41) {
        const v = field(x, y);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(fbm2D(11)(1.1, 1.2)).toBe(fbm2D(11)(1.1, 1.2));
  });
});

describe("grainTileDataUrl", () => {
  it("is a data URL carrying the seed, so the texture is reproducible", () => {
    const url = grainTileDataUrl(99, 128, 0.05);
    expect(url.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(url).toContain("seed%3D%2299%22");
  });

  it("is byte-identical for the same seed", () => {
    expect(grainTileDataUrl(99)).toBe(grainTileDataUrl(99));
  });

  it("differs for a different seed", () => {
    expect(grainTileDataUrl(99)).not.toBe(grainTileDataUrl(100));
  });
});

describe("the geometry helpers", () => {
  it("builds a vignette from resolved channels", () => {
    const css = vignetteCssFromRgb([28, 29, 32], [
      { at: 0, color: "", alpha: 0 },
      { at: 1, color: "", alpha: 0.8 },
    ]);
    expect(css).toContain("radial-gradient");
    expect(css).toContain("rgba(28, 29, 32, 0.8) 100.00%");
  });

  it("places the aurora layers deterministically", () => {
    const a = auroraLayers(5, ["#00BCBC", "#1F8DBF"], 3);
    const b = auroraLayers(5, ["#00BCBC", "#1F8DBF"], 3);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(a[0]?.color).toBe("#00BCBC");
    expect(a[1]?.color).toBe("#1F8DBF");
  });

  it("parses a hex token, and refuses anything else", () => {
    expect(hexToRgbTriplet("#00BCBC")).toEqual([0, 188, 188]);
    expect(hexToRgbTriplet("rgb(0,0,0)")).toBeNull();
    expect(hexToRgbTriplet("#fff")).toBeNull();
  });
});
