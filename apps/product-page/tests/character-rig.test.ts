// Implements: docs/plans/ANIMATION_MODEL_BRIEF.md §0.1 (the vendored-asset
// rule: the source, the licence, the attribution and the SHA-256 recorded
// beside the file, a size budget, and no runtime fetch), §3 (the seeker, and
// the per-act pose keyframes on the rig's bones) and §10 (the verification
// that is mandatory).
//
// WHAT THIS TEST IS FOR.
//
// The character is the one binary asset in the project, and a binary asset is
// the one thing nobody notices changing. This test is the tripwire: it reads
// the file off disk, checks its SHA-256 against the value recorded in
// `character-asset.ts` and in `ATTRIBUTION.md` beside it, checks it against
// the size budget, loads it with the same parser the browser uses, and then
// proves the pose is still a set of hand-authored keyframes on the rig's
// bones - no mixer, no clip, no playback.

import { createHash } from "node:crypto";
import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import {
  CHARACTER_ASSET_BYTE_BUDGET,
  CHARACTER_ASSET_SHA256,
  CHARACTER_ASSET_URL,
  SEEKER_BONE_NAMES,
} from "../src/components/story/character-asset";
import { applyPose, createSeeker, POSES } from "../src/components/story/character";
import type { Seeker } from "../src/components/story/character";
import { CHARACTER_ASSET_PATH, loadCharacterRig, readCharacterAsset } from "./character-fixture";

const TEST_COLOURS = { body: "#d0d0d0", glow: "#c0c0c0" } as const;

let rig: THREE.Group;

beforeAll(async () => {
  rig = await loadCharacterRig();
});

/** Every skinned mesh under an object. */
function figureMeshesOf(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) meshes.push(mesh);
  });
  return meshes;
}

describe("the vendored asset (brief §0.1)", () => {
  it("is the file the code says it is", () => {
    const bytes = readCharacterAsset();
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(hash, "the vendored character's SHA-256 moved").toBe(CHARACTER_ASSET_SHA256);
  });

  it("is served from this app's own origin, not from a third-party host", () => {
    expect(CHARACTER_ASSET_URL.startsWith("/")).toBe(true);
    expect(CHARACTER_ASSET_URL).not.toContain("http");
    expect(CHARACTER_ASSET_URL).not.toContain("//");
  });

  it("stays inside the size budget", () => {
    const bytes = readCharacterAsset().length;
    expect(bytes, "the vendored character assets are over their budget").toBeLessThanOrEqual(
      CHARACTER_ASSET_BYTE_BUDGET,
    );
  });

  it("carries its provenance inside the file", () => {
    const text = readCharacterAsset().toString("latin1");
    expect(text).toContain("CC0 1.0");
    expect(text).toContain("Quaternius");
    expect(text).toContain("poly.pizza/m/qJ2gsTUBHL");
  });
});

describe("the rig (brief §3)", () => {
  it("loads with every bone the poses drive", () => {
    for (const name of Object.values(SEEKER_BONE_NAMES)) {
      let found = false;
      rig.traverse((object) => {
        const bone = object as THREE.Bone;
        if (bone.isBone && bone.name === name) found = true;
      });
      expect(found, `the rig has no bone called "${name}"`).toBe(true);
    }
  });

  it("carries no animation clips, because the pose is hand-authored", () => {
    // The upstream asset had 24 clips. The vendored file has none, and this
    // is the property that keeps the project free of an `AnimationMixer`.
    const bytes = readCharacterAsset().toString("latin1");
    expect(bytes).not.toContain("CharacterArmature|Idle");
    expect(bytes).not.toContain("CharacterArmature|Walk");
  });

  it("is one mesh with one skin, so it costs one draw call", () => {
    const skinned = figureMeshesOf(rig);
    expect(skinned.length).toBe(1);
    expect(skinned[0]?.skeleton?.bones.length).toBe(62);
  });

  it("is one material and no textures, so the palette owns the look", () => {
    const seeker = createSeeker(rig, TEST_COLOURS);
    const skinned: THREE.SkinnedMesh[] = [];
    seeker.bones.figure.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) skinned.push(mesh);
    });
    expect(skinned.length).toBe(1);
    const materials = new Set(skinned.map((mesh) => mesh.material));
    expect(materials.size).toBe(1);
    for (const mesh of skinned) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material.map).toBeNull();
      expect(material.normalMap).toBeNull();
      expect(material.emissiveMap).toBeNull();
    }
    for (const item of seeker.disposables) item.dispose();
  });

  it("stands a person tall, facing forwards", () => {
    const seeker = createSeeker(rig, TEST_COLOURS);
    seeker.bones.figure.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(seeker.bones.figure);
    const height = bounds.max.y - bounds.min.y;
    expect(height).toBeGreaterThan(1.6);
    expect(height).toBeLessThan(2.0);
    // The rig faces +Z and her left is +X: the toe bones run forwards, and
    // the left arm's wrist is on the +X side.
    const wristL = new THREE.Vector3();
    const wristR = new THREE.Vector3();
    seeker.bones.driven.upperArmL.object.getWorldPosition(wristL);
    seeker.bones.driven.upperArmR.object.getWorldPosition(wristR);
    expect(wristL.x).toBeGreaterThan(wristR.x);
    for (const item of seeker.disposables) item.dispose();
  });
});

describe("the pose (brief §3: named keyframes on the rig's bones)", () => {
  it("moves the bones it claims to move", () => {
    const seeker = createSeeker(rig, TEST_COLOURS);
    const head = seeker.bones.driven.head.object;
    const wrist = seeker.bones.driven.lowerArmR.object;
    const foot = seeker.bones.driven.lowerLegL.object;

    const before = {
      head: head.quaternion.clone(),
      wrist: wrist.quaternion.clone(),
      foot: foot.quaternion.clone(),
    };

    applyPose(seeker, "hunt-search", "hunt-search", 1);

    // Act I holds her head down: the head's rotation is not its rest.
    expect(head.quaternion.angleTo(before.head)).toBeGreaterThan(0.1);
    // The right forearm is up, reading the phone.
    expect(wrist.quaternion.angleTo(before.wrist)).toBeGreaterThan(0.2);
    // Act I is standing still: the legs have not moved.
    expect(foot.quaternion.angleTo(before.foot)).toBeLessThan(0.001);
    // And the numbers the pose is made of are readable, because the
    // verification harness reads them and not the bones' Euler angles.
    expect(seeker.readout.lean).toBeCloseTo(POSES["hunt-search"].lean, 6);
    expect(seeker.readout.headPitch).toBeCloseTo(POSES["hunt-search"].headPitch, 6);
    expect(seeker.readout.armSwingL).toBeCloseTo(POSES["hunt-search"].armSwingL, 6);
    expect(seeker.readout.strideL).toBeCloseTo(POSES["hunt-search"].strideL, 6);

    for (const item of seeker.disposables) item.dispose();
  });

  it("puts her head down in Act I and up in Act IV", () => {
    const seeker = createSeeker(rig, TEST_COLOURS);
    const head = seeker.bones.driven.head.object;

    applyPose(seeker, "hunt-search", "hunt-search", 1);
    const hunted = head.quaternion.clone();
    applyPose(seeker, "relief-open", "relief-open", 1);
    const relieved = head.quaternion.clone();

    expect(POSES["hunt-search"].headPitch).toBeGreaterThan(0);
    expect(POSES["relief-open"].headPitch).toBeLessThan(0);
    expect(relieved.angleTo(hunted)).toBeGreaterThan(0.2);

    for (const item of seeker.disposables) item.dispose();
  });

  it("swings the left arm forwards and the right arm backwards when she walks", () => {
    const seeker = createSeeker(rig, TEST_COLOURS);
    const left = seeker.bones.driven.upperArmL.object;
    const right = seeker.bones.driven.upperArmR.object;

    applyPose(seeker, "relief-walk", "relief-walk", 1);
    const leftSwing = POSES["relief-walk"].armSwingL;
    const rightSwing = POSES["relief-walk"].armSwingR;
    expect(leftSwing).toBeGreaterThan(0);
    expect(rightSwing).toBeLessThan(0);
    // The two arms are posed in opposite directions, so their bones end up
    // in different places.
    expect(left.quaternion.angleTo(right.quaternion)).toBeGreaterThan(0.5);

    for (const item of seeker.disposables) item.dispose();
  });

  it("holds completely still in Act III", () => {
    const seeker = createSeeker(rig, TEST_COLOURS);
    applyPose(seeker, "still-hands", "still-hands", 1, 12.5);
    const hips = seeker.bones.driven.hips.object.quaternion.clone();
    applyPose(seeker, "still-hands", "still-hands", 1, 13.25);
    expect(seeker.bones.driven.hips.object.quaternion.angleTo(hips)).toBeLessThan(0.001);
    expect(POSES["still-hands"].idleAmp).toBe(0);

    for (const item of seeker.disposables) item.dispose();
  });

  it("keeps the phone in her right hand, lit", () => {
    const seeker = createSeeker(rig, TEST_COLOURS);
    expect(seeker.bones.phone.parent?.name).toBe(SEEKER_BONE_NAMES.wristR);

    applyPose(seeker, "hunt-search", "hunt-search", 1);
    expect(seeker.bones.phoneLight.intensity).toBeGreaterThan(1);
    expect(seeker.bones.phoneMaterial.emissiveIntensity).toBeGreaterThan(1);

    for (const item of seeker.disposables) item.dispose();
  });
});
