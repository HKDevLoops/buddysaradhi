// Implements: docs/plans/ANIMATION_MODEL_BRIEF.md §7 (the performance budgets)
// and §10 (the performance assertion: "for each tier, the scene graph's total
// draw calls / triangles / textures stay within the §7 budget COUNTED FROM THE
// CONSTRUCTED SCENE, not measured in a browser").
//
// HOW THE COUNT IS TAKEN. The scene is built by the same factory the renderer
// uses, then walked with the same camera the visitor sees at each beat. The
// frustum test is three.js's own: an object is counted when its bounding
// sphere, transformed by its world matrix, intersects the camera's frustum -
// which is exactly what `renderer.info.render.calls` counts.
//
// THE TRANSMISSION PASS IS COUNTED, NOT FORGOTTEN. A refractive material makes
// three.js render the OPAQUE objects a second time, into a transmission
// render target, before the main pass (WebGLRenderer.js, renderTransmissionPass).
// Those draw calls land in the same `renderer.info`, so a scene with a glass
// card issues roughly twice the opaque draw calls of one without. Counting
// only the main pass would flatter the scene by a factor of two.
//
// THE BUDGETS ARE NEVER RAISED. A scene that misses them is simplified until
// it fits; the numbers in `STORY_BUDGETS` are the brief's.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { STORY_BEATS } from "../src/components/story/beats";
import {
  STORY_BUDGETS,
  applyDirective,
  buildStoryScene,
  resolveStoryTier,
} from "../src/components/story/act-directives";
import type { StoryScene, StoryTier } from "../src/components/story/act-directives";

/**
 * The story mounts two components from `product-3d/`: the shared dust and the
 * shared light rig. The dust is ONE `THREE.Points` - one draw call, no
 * triangles, no textures - and a light is not a draw call at all.
 */
const SHARED_MOUNT_COST = { calls: 1, triangles: 0, textures: 0 } as const;

/**
 * Placeholder palette values. The scene is built from roles, not literals, so
 * a test that cannot read the document's palette still exercises the real
 * geometry, the real materials and the real tier decisions.
 */
const TEST_COLOURS = {
  sunken: "#808080",
  inset: "#606060",
  raised: "#a0a0a0",
  accent: "#c0c0c0",
  accentText: "#d0d0d0",
  info: "#909090",
  warn: "#b0b0b0",
  key: "#e0e0e0",
} as const;

const TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "emissiveMap",
  "alphaMap",
  "aoMap",
  "bumpMap",
  "displacementMap",
  "envMap",
  "lightMap",
  "specularMap",
] as const;

interface FrameCost {
  readonly calls: number;
  readonly triangles: number;
  readonly textures: number;
}

/** Whether an object and all of its ancestors are visible. */
function isVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function isTransmissive(material: THREE.Material): boolean {
  const transmission = (material as THREE.MeshPhysicalMaterial).transmission;
  return typeof transmission === "number" && transmission > 0;
}

/** The camera a beat declares, as the renderer would place it. */
function cameraFor(beat: (typeof STORY_BEATS)[number]): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(beat.camera.fov, 16 / 9, 0.1, 140);
  camera.position.set(...beat.camera.pos);
  camera.lookAt(new THREE.Vector3(...beat.camera.target));
  camera.updateMatrixWorld(true);
  return camera;
}

/**
 * The cost of one frame: the draw calls, the triangles and the textures the
 * renderer would issue at this beat.
 */
function countFrame(scene: StoryScene, camera: THREE.PerspectiveCamera): FrameCost {
  scene.group.updateMatrixWorld(true);

  const frustum = new THREE.Frustum();
  frustum.setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );

  let opaqueCalls = 0;
  let transmissiveCalls = 0;
  let transparentCalls = 0;
  let opaqueTriangles = 0;
  let transmissiveTriangles = 0;
  let transparentTriangles = 0;
  const textures = new Set<THREE.Texture>();
  let hasTransmission = false;

  scene.group.traverse((object) => {
    const drawable = object as THREE.Mesh & {
      isMesh?: boolean;
      isPoints?: boolean;
      isLine?: boolean;
      isLineSegments?: boolean;
    };
    if (!drawable.isMesh && !drawable.isPoints && !drawable.isLine && !drawable.isLineSegments) {
      return;
    }
    if (!isVisible(object)) return;
    const geometry = drawable.geometry;
    if (!geometry) return;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    if (geometry.boundingSphere) {
      const sphere = geometry.boundingSphere.clone().applyMatrix4(object.matrixWorld);
      if (!frustum.intersectsSphere(sphere)) return;
    }

    const material = drawable.material as THREE.Material | THREE.Material[];
    const materials = Array.isArray(material) ? material : [material];
    const transmissive = materials.some(isTransmissive);
    const transparent = materials.some((one) => one.transparent);
    if (transmissive) hasTransmission = true;

    const index = geometry.getIndex();
    const position = geometry.getAttribute("position");
    const vertices = index ? index.count : position ? position.count : 0;
    // Points and lines are not triangles: three.js counts them in
    // `render.points` and `render.lines`, not in `render.triangles`.
    const triangles = drawable.isMesh ? Math.floor(vertices / 3) : 0;

    if (transmissive) {
      transmissiveCalls += 1;
      transmissiveTriangles += triangles;
    } else if (transparent) {
      transparentCalls += 1;
      transparentTriangles += triangles;
    } else {
      opaqueCalls += 1;
      opaqueTriangles += triangles;
    }

    for (const one of materials) {
      for (const slot of TEXTURE_SLOTS) {
        const texture = (one as unknown as Record<string, unknown>)[slot];
        if (texture instanceof THREE.Texture) textures.add(texture);
      }
    }
  });

  // The transmission pass renders the opaque objects a second time, into the
  // refraction target, and that render target is a texture.
  const transmissionPass = hasTransmission ? opaqueCalls : 0;
  const transmissionTriangles = hasTransmission ? opaqueTriangles : 0;

  return {
    calls:
      opaqueCalls +
      transmissionPass +
      transmissiveCalls +
      transparentCalls +
      SHARED_MOUNT_COST.calls,
    triangles:
      opaqueTriangles +
      transmissionTriangles +
      transmissiveTriangles +
      transparentTriangles +
      SHARED_MOUNT_COST.triangles,
    textures: textures.size + (hasTransmission ? 1 : 0) + SHARED_MOUNT_COST.textures,
  };
}

/**
 * The worst frame the story can draw, at a tier.
 *
 * Each metric is tracked independently: the frame with the most draw calls is
 * not necessarily the frame with the most triangles, and the budget is
 * checked against each of them.
 */
function worstFrame(tier: StoryTier): {
  readonly calls: { readonly cost: number; readonly beatId: string };
  readonly triangles: { readonly cost: number; readonly beatId: string };
  readonly textures: { readonly cost: number; readonly beatId: string };
} {
  const scene = buildStoryScene(tier, TEST_COLOURS);
  const worst = {
    calls: { cost: 0, beatId: "" },
    triangles: { cost: 0, beatId: "" },
    textures: { cost: 0, beatId: "" },
  };
  for (const beat of STORY_BEATS) {
    applyDirective(scene, beat.scene, beat.scroll[0]);
    const cost = countFrame(scene, cameraFor(beat));
    if (cost.calls > worst.calls.cost) {
      worst.calls = { cost: cost.calls, beatId: beat.id };
    }
    if (cost.triangles > worst.triangles.cost) {
      worst.triangles = { cost: cost.triangles, beatId: beat.id };
    }
    if (cost.textures > worst.textures.cost) {
      worst.textures = { cost: cost.textures, beatId: beat.id };
    }
  }
  scene.dispose();
  return worst;
}

describe("the tier ladder (brief §7, scene-tiers.ts)", () => {
  it("gives the low rung to a low-end device and the high rung to a discrete GPU", () => {
    expect(resolveStoryTier(true, "discrete")).toBe("low");
    expect(resolveStoryTier(false, "integrated")).toBe("mid");
    expect(resolveStoryTier(false, "discrete")).toBe("high");
    expect(resolveStoryTier(false, "software")).toBe("mid");
  });

  it("keeps the budgets the brief wrote down", () => {
    expect(STORY_BUDGETS.low.drawCalls).toBe(30);
    expect(STORY_BUDGETS.mid.drawCalls).toBe(70);
    expect(STORY_BUDGETS.high.drawCalls).toBe(140);
    expect(STORY_BUDGETS.low.triangles).toBe(30_000);
    expect(STORY_BUDGETS.mid.triangles).toBe(90_000);
    expect(STORY_BUDGETS.high.triangles).toBe(180_000);
    expect(STORY_BUDGETS.low.textures).toBe(8);
    expect(STORY_BUDGETS.mid.textures).toBe(16);
    expect(STORY_BUDGETS.high.textures).toBe(24);
  });

  it("caps the device pixel ratio at two, even on the high rung", () => {
    expect(STORY_BUDGETS.high.dpr[1]).toBeLessThanOrEqual(2);
    expect(STORY_BUDGETS.mid.dpr[1]).toBeLessThanOrEqual(1.5);
    expect(STORY_BUDGETS.low.dpr[1]).toBeLessThanOrEqual(0.75);
  });

  it("gives the low rung no transmission at all", () => {
    expect(STORY_BUDGETS.low.transmissionSamples).toBe(0);
    expect(STORY_BUDGETS.mid.transmissionSamples).toBe(1);
    expect(STORY_BUDGETS.high.transmissionSamples).toBe(4);
  });
});

describe("the constructed scene, counted (brief §7, §10)", () => {
  for (const tier of ["low", "mid", "high"] as const) {
    it(`keeps the ${tier} rung inside its budget`, () => {
      const worst = worstFrame(tier);
      const budget = STORY_BUDGETS[tier];
      expect(
        worst.calls.cost,
        `${tier}: ${worst.calls.cost} draw calls at beat "${worst.calls.beatId}", budget ${budget.drawCalls}`,
      ).toBeLessThanOrEqual(budget.drawCalls);
      expect(
        worst.triangles.cost,
        `${tier}: ${worst.triangles.cost} triangles at beat "${worst.triangles.beatId}", budget ${budget.triangles}`,
      ).toBeLessThanOrEqual(budget.triangles);
      expect(
        worst.textures.cost,
        `${tier}: ${worst.textures.cost} textures at beat "${worst.textures.beatId}", budget ${budget.textures}`,
      ).toBeLessThanOrEqual(budget.textures);
    });
  }

  it("builds a scene with no textures at all, because the story is code-first", () => {
    // No `.png`, no `.hdr`, no video: nothing to load, nothing to 404.
    const scene = buildStoryScene("high", TEST_COLOURS);
    let textureCount = 0;
    scene.group.traverse((object) => {
      const drawable = object as THREE.Mesh;
      if (!drawable.isMesh) return;
      const material = drawable.material as THREE.Material | THREE.Material[];
      for (const one of Array.isArray(material) ? material : [material]) {
        for (const slot of TEXTURE_SLOTS) {
          if ((one as unknown as Record<string, unknown>)[slot]) textureCount += 1;
        }
      }
    });
    scene.dispose();
    expect(textureCount).toBe(0);
  });

  it("falls back to a standard material on the low rung", () => {
    const low = buildStoryScene("low", TEST_COLOURS);
    const high = buildStoryScene("high", TEST_COLOURS);
    expect(isTransmissive(low.cardMaterial as THREE.Material)).toBe(false);
    expect(isTransmissive(high.cardMaterial as THREE.Material)).toBe(true);
    low.dispose();
    high.dispose();
  });

  it("builds a smaller scene on the low rung than on the high one", () => {
    const low = buildStoryScene("low", TEST_COLOURS);
    const high = buildStoryScene("high", TEST_COLOURS);
    expect(low.crowd.length).toBeLessThan(high.crowd.length);
    expect(low.bubbles.length).toBeLessThan(high.bubbles.length);
    low.dispose();
    high.dispose();
  });
});
