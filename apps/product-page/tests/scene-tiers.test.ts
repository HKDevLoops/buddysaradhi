// Implements: 20_3D_Product_Page.md §3 + §7.1 + §11.3 + §12 (tier decisions).
// Unit tests for `scene-tiers.ts`: the ladder both 3D routes share. No WebGL,
// no browser - these are pure functions, which is exactly why the decisions
// live in a pure module instead of inline in the components.

import { describe, expect, it } from "vitest";
import {
  FOV_PEAK,
  FOV_REST,
  POSTER_ASPECT,
  beatIdToIndex,
  beatIndexToId,
  classifyGpu,
  resolveAdaptiveDprFloor,
  resolveBeatIndex,
  resolveCoverFov,
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
    expect(resolveDpr(false, true, "discrete")).toEqual([1, 2]);
  });

  it("gives a wide INTEGRATED gpu the spec's 0.75-1.5 tier, not the discrete one", () => {
    // 20_3D §3.1: "integrated GPU -> ... DPR 0.75-1.5". Before the ladder
    // learned the GPU class, a wide screen was served the discrete tier no
    // matter what it was drawing on.
    expect(resolveDpr(false, true, "integrated")).toEqual([0.75, 1.5]);
  });

  it("gives a software rasteriser the [0.75, 1] tier", () => {
    expect(resolveDpr(false, true, "software")).toEqual([0.75, 1]);
  });
});

describe("classifyGpu (the ladder has to know what it draws on)", () => {
  it("recognises a software rasteriser", () => {
    expect(classifyGpu("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))")).toBe(
      "software",
    );
    expect(classifyGpu("Mesa/X.org llvmpipe")).toBe("software");
    expect(classifyGpu("Microsoft Basic Render Driver")).toBe("software");
  });

  it("recognises a dedicated gpu", () => {
    expect(classifyGpu("ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0)")).toBe(
      "discrete",
    );
    expect(classifyGpu("AMD Radeon RX 6800")).toBe("discrete");
  });

  it("treats an integrated gpu as integrated", () => {
    expect(classifyGpu("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.1)")).toBe(
      "integrated",
    );
    expect(classifyGpu("Apple M2 Pro")).toBe("integrated");
  });

  it("falls back to the CHEAP tier when the browser hides the renderer", () => {
    // Firefox with resistFingerprinting and Safari's RESISTED both hide it.
    expect(classifyGpu("")).toBe("integrated");
    expect(classifyGpu(null)).toBe("integrated");
    expect(classifyGpu(undefined)).toBe("integrated");
  });
});

describe("resolveAdaptiveDprFloor (20_3D §3.1: AdaptiveDpr drops to 0.75)", () => {
  it("lets everything but a discrete gpu fall back to 0.75", () => {
    expect(resolveAdaptiveDprFloor("integrated")).toBe(0.75);
    expect(resolveAdaptiveDprFloor("software")).toBe(0.75);
  });

  it("keeps a discrete gpu at 1x - it has the pixels to spare", () => {
    expect(resolveAdaptiveDprFloor("discrete")).toBe(1);
  });
});

describe("transmission samples + particles (20_3D §7.1, §3)", () => {
  it("gives the 4-sample card only to a discrete gpu", () => {
    expect(resolveTransmissionSamples("discrete")).toBe(4);
    expect(resolveTransmissionSamples("integrated")).toBe(1);
    expect(resolveTransmissionSamples("software")).toBe(1);
  });

  it("never spends 4 samples on a low-end device", () => {
    expect(resolveTransmissionSamples("discrete", true)).toBe(1);
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

describe("resolveCoverFov (the live scene frames like the poster)", () => {
  it("leaves the field of view alone at the poster's own aspect", () => {
    expect(resolveCoverFov(FOV_REST, POSTER_ASPECT)).toBe(FOV_REST);
  });

  it("leaves the field of view alone on a NARROWER viewport", () => {
    // `cover` crops the poster left and right, so the vertical extent the
    // camera shows is unchanged.
    expect(resolveCoverFov(FOV_REST, 0.5)).toBe(FOV_REST);
    expect(resolveCoverFov(FOV_REST, 1.6)).toBe(FOV_REST);
  });

  it("narrows the field of view on a WIDER viewport, by the cover factor", () => {
    // `cover` crops the poster top and bottom, so the camera must show the
    // same vertical extent: tan(fov/2) shrinks by posterAspect/viewportAspect.
    const wide = resolveCoverFov(FOV_REST, 2.4);
    expect(wide).toBeLessThan(FOV_REST);
    const half = (FOV_REST * Math.PI) / 360;
    const expected = (2 * Math.atan(Math.tan(half) * (POSTER_ASPECT / 2.4)) * 180) / Math.PI;
    expect(wide).toBeCloseTo(expected, 6);
  });

  it("is monotonic: the wider the viewport, the narrower the field", () => {
    const narrow = resolveCoverFov(FOV_REST, 1.9);
    const wide = resolveCoverFov(FOV_REST, 2.6);
    expect(wide).toBeLessThan(narrow);
  });

  it("refuses garbage rather than producing a broken camera", () => {
    expect(resolveCoverFov(Number.NaN, 1.8)).toBe(FOV_REST);
    expect(resolveCoverFov(0, 1.8)).toBe(FOV_REST);
    expect(resolveCoverFov(FOV_REST, Number.NaN)).toBe(FOV_REST);
    expect(resolveCoverFov(FOV_REST, 0)).toBe(FOV_REST);
    expect(resolveCoverFov(FOV_REST, -1)).toBe(FOV_REST);
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
