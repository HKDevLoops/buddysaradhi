// Implements: 20_3D_Product_Page.md §3.1 (the degradation ladder) and §2.2
// (the Poster veil), plus the fix for the "500vh of frozen content" defect.
//
// The stage height is a DECISION, so it lives in a pure module and is tested
// here rather than read out of a style attribute.

import { describe, expect, it } from "vitest";
import { HERO_RUNWAY_VH, TOUR_RUNWAY_VH } from "../src/components/product-3d/scene-tiers";
import { resolveStageMode, storyHeightCss } from "../src/lib/stage-mode";

describe("resolveStageMode (20_3D §3.1 degradation ladder)", () => {
  it("takes the poster path when the device cannot draw the scene", () => {
    expect(resolveStageMode(false, false)).toBe("poster");
  });

  it("takes the poster path when the visitor asked for less data", () => {
    expect(resolveStageMode(true, true)).toBe("poster");
  });

  it("takes the canvas path for an ordinary device", () => {
    expect(resolveStageMode(true, false)).toBe("canvas");
  });
});

describe("storyHeightCss (the stage height)", () => {
  it("gives the poster path ONE viewport, not a scroll runway", () => {
    // The defect: the stage was always 500vh, so a budget phone scrolled
    // five screens of a frozen still with the same copy pinned in place.
    expect(storyHeightCss("poster", HERO_RUNWAY_VH)).toBe("100dvh");
    expect(storyHeightCss("poster", TOUR_RUNWAY_VH)).toBe("100dvh");
  });

  it("keeps the scroll runway on the canvas path", () => {
    expect(storyHeightCss("canvas", HERO_RUNWAY_VH)).toBe("500vh");
    expect(storyHeightCss("canvas", TOUR_RUNWAY_VH)).toBe("600vh");
  });

  it("refuses a nonsense runway rather than writing a broken length", () => {
    expect(storyHeightCss("canvas", 0)).toBe("0vh");
    expect(storyHeightCss("canvas", -5)).toBe("0vh");
    expect(storyHeightCss("canvas", Number.NaN)).toBe("0vh");
  });
});
