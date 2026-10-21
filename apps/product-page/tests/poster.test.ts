// Implements: 20_3D_Product_Page.md §2.2 (the Poster veil) and §3.1 ("no WebGL
// -> poster (static PNG)").
//
// The Poster used to be a flat colour rectangle. These tests hold it to the
// contract: a real generated image of the scene, committed to the repo,
// inside the performance budget, and wired into BOTH the no-WebGL path and the
// first-frame veil.
//
// The asset is checked on disk, not mocked: a test that asserts a constant
// proves nothing about the file that actually ships.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { POSTER_ASPECT, POSTER_SRC } from "../src/components/product-3d/scene-tiers";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const posterPath = resolve(appDir, "public", POSTER_SRC.replace(/^\//, ""));

/** 20_3D §3: "poster path < 200 KB". */
const BUDGET_BYTES = 200 * 1024;

describe("the committed poster (20_3D §2.2, §3.1)", () => {
  it("exists in the repo at the path the Poster component asks for", () => {
    expect(existsSync(posterPath)).toBe(true);
  });

  it("is a real PNG, not an empty or placeholder file", () => {
    const bytes = readFileSync(posterPath);
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(bytes.length).toBeGreaterThan(10_000);
  });

  it("fits the 20_3D §3 performance budget", () => {
    expect(statSync(posterPath).size).toBeLessThanOrEqual(BUDGET_BYTES);
  });

  it("is authored at the aspect the camera is matched to", () => {
    // The PNG header carries the dimensions at a fixed offset: IHDR width and
    // height are big-endian uint32s at bytes 16 and 20.
    const bytes = readFileSync(posterPath);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    expect(height).toBeGreaterThan(0);
    expect(width / height).toBeCloseTo(POSTER_ASPECT, 2);
  });
});

describe("the Poster component is a real poster, not a flat rectangle", () => {
  const source = readFileSync(
    resolve(appDir, "src/components/product-3d/Poster.tsx"),
    "utf8",
  );

  it("renders the generated image", () => {
    expect(source).toContain("POSTER_SRC");
    expect(source).toContain("<Image");
  });

  it("is not a bare background colour any more", () => {
    // The old implementation was a single div with
    // `backgroundColor: "var(--canvas)"` and nothing else.
    expect(source).not.toMatch(/backgroundColor:\s*"var\(--canvas\)"\s*\}\s*\/>/);
  });

  it("carries the procedural grain, so a WebGL frame does not band", () => {
    expect(source).toContain("grainTileDataUrl");
  });

  it("is used by BOTH the no-WebGL path and the first-frame veil", () => {
    const hero = readFileSync(
      resolve(appDir, "src/components/product-3d/ProductHero.tsx"),
      "utf8",
    );
    // The veil: the Poster overlays the canvas until the first frame.
    expect(hero).toMatch(/\{!ready && \(\s*<div className="absolute inset-0">\s*<Poster \/>/);
    // The no-WebGL path: the Poster IS the stage.
    expect(hero).toMatch(/\{showPoster \|\| !tokens \? \(\s*<Poster \/>/);
  });
});
