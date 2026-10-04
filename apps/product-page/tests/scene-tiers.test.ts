// Implements: 20_3D_Product_Page.md §3 + §7.1 + §11.3 + §12 (tier decisions).
// Unit tests for `scene-tiers.ts`: the ladder both 3D routes share. No WebGL,
// no browser - these are pure functions, which is exactly why the decisions
// live in a pure module instead of inline in the components.

import { describe, expect, it } from "vitest";
import {
  FOV_PEAK,
  FOV_REST,
  beatIdToIndex,
  beatIndexToId,
  resolveBeatIndex,
  resolveDpr,
  resolveFloatProps,
  resolveFovTarget,
  resolveParticleCount,
  resolveStageMode,
  resolveTransmissionSamples,
} from "../src/components/product-3d/scene-tiers";

describe("resolveDpr (20_3D §11.3)", () => {
  it("caps low-end at [0.75, 1] regardless of viewport", () => {
    expect(resolveDpr(true, false)).toEqual([0.75, 1]);
    expect(resolveDpr(true, true)).toEqual([0.75, 1]);
  });

  it("keeps the hero [1, 1.5] cap on narrow viewports", () => {
    expect(resolveDpr(false, false)).toEqual([1, 1.5]);
  });

  it("opens the discrete [1, 2] tier only on wide, non-low-end screens", () => {
    expect(resolveDpr(false, true)).toEqual([1, 2]);
  });
});

describe("transmission samples + particles (20_3D §7.1, §3)", () => {
  it("drops LedgerCard transmission to 1 sample on low-end, 4 otherwise", () => {
    expect(resolveTransmissionSamples(true)).toBe(1);
    expect(resolveTransmissionSamples(false)).toBe(4);
  });

  it("drops the particle field to 80 on low-end, 200 otherwise", () => {
    expect(resolveParticleCount(true)).toBe(80);
    expect(resolveParticleCount(false)).toBe(200);
  });
});

describe("resolveStageMode (poster / veil / canvas contract)", () => {
  it("renders poster with no WebGL, even if everything else is ready", () => {
    expect(
      resolveStageMode({ webgl: false, saveData: false, tokensReady: true, sceneReady: true }),
    ).toBe("poster");
  });

  it("renders poster on Save-Data, skipping the 3D bundle entirely", () => {
    expect(
      resolveStageMode({ webgl: true, saveData: true, tokensReady: true, sceneReady: true }),
    ).toBe("poster");
  });

  it("renders poster before the palette resolves - never invented colours", () => {
    expect(
      resolveStageMode({ webgl: true, saveData: false, tokensReady: false, sceneReady: false }),
    ).toBe("poster");
  });

  it("holds the veil until the first frame (mount first, overlay, FM-10)", () => {
    expect(
      resolveStageMode({ webgl: true, saveData: false, tokensReady: true, sceneReady: false }),
    ).toBe("veil");
  });

  it("lifts the veil once the first frame renders", () => {
    expect(
      resolveStageMode({ webgl: true, saveData: false, tokensReady: true, sceneReady: true }),
    ).toBe("canvas");
  });
});

describe("resolveFloatProps (reduced-motion freeze, Rule 10)", () => {
  it("freezes every Float channel to zero", () => {
    expect(resolveFloatProps(true)).toEqual({
      speed: 0,
      rotationIntensity: 0,
      floatIntensity: 0,
    });
  });

  it("keeps the live 1.2 / 0.4 / 1.2 values when motion is allowed", () => {
    expect(resolveFloatProps(false)).toEqual({
      speed: 1.2,
      rotationIntensity: 0.4,
      floatIntensity: 1.2,
    });
  });
});

describe("resolveBeatIndex (scrub → stop)", () => {
  it("maps progress across five stops", () => {
    expect(resolveBeatIndex(0, 5)).toBe(0);
    expect(resolveBeatIndex(0.2, 5)).toBe(1);
    expect(resolveBeatIndex(0.99, 5)).toBe(4);
    expect(resolveBeatIndex(1, 5)).toBe(4);
  });

  it("clamps out-of-range progress instead of leaving the stop list", () => {
    expect(resolveBeatIndex(-0.1, 5)).toBe(0);
    expect(resolveBeatIndex(1.5, 5)).toBe(4);
  });

  it("treats non-finite progress (pre-settle updates) as the first stop", () => {
    expect(resolveBeatIndex(NaN, 5)).toBe(0);
    expect(resolveBeatIndex(0.5, 0)).toBe(0);
  });
});

describe("resolveFovTarget (shonen whip 55→75→55)", () => {
  it("rests at 55 when still and peaks at 75 at full whip", () => {
    expect(resolveFovTarget(0)).toBe(FOV_REST);
    expect(resolveFovTarget(1)).toBe(FOV_PEAK);
    expect(FOV_REST).toBe(55);
    expect(FOV_PEAK).toBe(75);
  });

  it("interpolates linearly and clamps garbage", () => {
    expect(resolveFovTarget(0.5)).toBe(65);
    expect(resolveFovTarget(-1)).toBe(55);
    expect(resolveFovTarget(2)).toBe(75);
    expect(resolveFovTarget(NaN)).toBe(55);
  });
});

describe("beat deep links (?beat=)", () => {
  const ids = ["dashboard", "students", "attendance", "fees", "settings"];

  it("resolves known ids and falls back to 0 for unknown or missing", () => {
    expect(beatIdToIndex("fees", ids)).toBe(3);
    expect(beatIdToIndex("nope", ids)).toBe(0);
    expect(beatIdToIndex(null, ids)).toBe(0);
  });

  it("round-trips index → id → index, clamped at the ends", () => {
    expect(beatIndexToId(0, ids)).toBe("dashboard");
    expect(beatIndexToId(4, ids)).toBe("settings");
    expect(beatIndexToId(99, ids)).toBe("settings");
    expect(beatIndexToId(-1, ids)).toBe("dashboard");
    expect(beatIdToIndex(beatIndexToId(2, ids), ids)).toBe(2);
  });
});
