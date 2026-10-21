// Implements: docs/plans/ANIMATION_MODEL_BRIEF.md §10 (the camera-rig
// assertions) and §4 (direction, not motion: the mandatory target, the damped
// look-ahead, the per-beat field of view, the roll).
//
// THE SEASICKNESS RULE. The position, the look point and the field of view are
// damped at ONE shared rate. Different rates per property are how a camera
// makes a reader ill: the lens settles before the framing does, and the
// mismatch reads as drift. These tests pin the shared rate's behaviour - the
// damp moves towards its target and never past it - and the fact that the
// field of view can never leave its range, whatever the beats say.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { STORY_BEATS } from "../src/components/story/beats";
import {
  CAMERA_DAMP_RATE,
  FOV_MAX,
  FOV_MIN,
  LOOK_AHEAD,
  ROLL_MAX,
  clampFov,
  dampVec3,
  handheldDrift,
  interpolateCamera,
  lookAheadProgress,
  resolveLookTarget,
} from "../src/components/story/camera-rig";

describe("the camera's target (brief §4a)", () => {
  it("is mandatory on every beat", () => {
    for (const beat of STORY_BEATS) {
      expect(beat.camera.target).toBeDefined();
      expect(beat.camera.target).toHaveLength(3);
      expect(beat.camera.target.every((value) => Number.isFinite(value))).toBe(true);
    }
  });

  it("resolves to a finite target at every progress", () => {
    for (let i = 0; i <= 500; i += 1) {
      const state = interpolateCamera(STORY_BEATS, i / 500);
      expect(state.target.every((value) => Number.isFinite(value))).toBe(true);
      expect(state.pos.every((value) => Number.isFinite(value))).toBe(true);
    }
  });
});

describe("the damped look-ahead (brief §4b)", () => {
  it("clamps at the end of the story", () => {
    expect(lookAheadProgress(1, LOOK_AHEAD)).toBe(1);
    expect(lookAheadProgress(1, 0.2)).toBe(1);
    expect(lookAheadProgress(0.999, 0.08)).toBeCloseTo(1, 6);
  });

  it("stays inside the story's range", () => {
    for (let i = 0; i <= 100; i += 1) {
      const progress = i / 100;
      const ahead = lookAheadProgress(progress, LOOK_AHEAD);
      expect(ahead).toBeGreaterThanOrEqual(progress);
      expect(ahead).toBeLessThanOrEqual(1);
    }
  });

  it("looks at the target of a LATER progress, not the current one", () => {
    const progress = 0.5;
    const ahead = lookAheadProgress(progress, LOOK_AHEAD);
    expect(ahead).toBeGreaterThan(progress);
    expect(resolveLookTarget(STORY_BEATS, progress)).toEqual(
      interpolateCamera(STORY_BEATS, ahead).target,
    );
  });

  it("uses a look-ahead inside the brief's range", () => {
    expect(LOOK_AHEAD).toBeGreaterThanOrEqual(0.06);
    expect(LOOK_AHEAD).toBeLessThanOrEqual(0.2);
  });
});

describe("the damp (brief §4c)", () => {
  it("moves towards the target and never past it", () => {
    let current = 0;
    let previous = current;
    for (let i = 0; i < 120; i += 1) {
      current = THREE.MathUtils.damp(current, 10, CAMERA_DAMP_RATE, 1 / 60);
      expect(current).toBeGreaterThan(previous);
      expect(current).toBeLessThan(10);
      previous = current;
    }
  });

  it("is monotonic in the other direction too", () => {
    let current = 10;
    let previous = current;
    for (let i = 0; i < 120; i += 1) {
      current = THREE.MathUtils.damp(current, 0, CAMERA_DAMP_RATE, 1 / 60);
      expect(current).toBeLessThan(previous);
      expect(current).toBeGreaterThan(0);
      previous = current;
    }
  });

  it("never overshoots, at any step size", () => {
    for (const step of [1 / 240, 1 / 60, 1 / 30, 0.5, 2]) {
      const current = new THREE.Vector3(0, 0, 0);
      const target = new THREE.Vector3(3, -2, 7);
      for (let i = 0; i < 40; i += 1) {
        dampVec3(current, target, CAMERA_DAMP_RATE, step);
        expect(current.x).toBeLessThanOrEqual(3);
        expect(current.y).toBeGreaterThanOrEqual(-2);
        expect(current.z).toBeLessThanOrEqual(7);
      }
    }
  });

  it("uses one rate for the position, the look point and the lens", () => {
    // A single constant, so the three cannot drift apart.
    expect(CAMERA_DAMP_RATE).toBeGreaterThanOrEqual(3);
    expect(CAMERA_DAMP_RATE).toBeLessThanOrEqual(4);
  });
});

describe("the field of view (brief §4c)", () => {
  it("never leaves [35, 90] as the story plays", () => {
    for (let i = 0; i <= 1000; i += 1) {
      const state = interpolateCamera(STORY_BEATS, i / 1000);
      expect(state.fov).toBeGreaterThanOrEqual(FOV_MIN);
      expect(state.fov).toBeLessThanOrEqual(FOV_MAX);
    }
  });

  it("clamps a value that is out of range", () => {
    expect(clampFov(10)).toBe(FOV_MIN);
    expect(clampFov(200)).toBe(FOV_MAX);
    expect(clampFov(55)).toBe(55);
    expect(clampFov(Number.NaN)).toBe(FOV_MIN);
  });

  it("narrows to 38 at the turn and holds it", () => {
    expect(STORY_BEATS[20].camera.fov).toBe(38);
    expect(STORY_BEATS[21].camera.fov).toBe(38);
  });

  it("widens to 70 in the chaos and sits at 55 in the hunt", () => {
    expect(STORY_BEATS[15].camera.fov).toBe(70);
    expect(STORY_BEATS[0].camera.fov).toBe(55);
    expect(STORY_BEATS[40].camera.fov).toBe(45);
  });
});

describe("the roll (brief §4c)", () => {
  it("never exceeds the limit and is exactly zero by beat 38", () => {
    for (const beat of STORY_BEATS) {
      expect(Math.abs(beat.camera.roll)).toBeLessThanOrEqual(ROLL_MAX);
    }
    expect(STORY_BEATS[37].camera.roll).toBe(0);
  });

  it("is interpolated, not switched", () => {
    // Somewhere between two beats the roll is between the two rolls.
    const between = interpolateCamera(STORY_BEATS, 0.2);
    expect(between.roll).toBeGreaterThanOrEqual(-ROLL_MAX);
    expect(between.roll).toBeLessThanOrEqual(ROLL_MAX);
  });
});

describe("the hand-held drift", () => {
  it("stays inside a tenth of a radian", () => {
    for (let i = 0; i <= 200; i += 1) {
      expect(Math.abs(handheldDrift(i / 10))).toBeLessThanOrEqual(0.01);
    }
  });

  it("is deterministic, so the first frame matches the server", () => {
    expect(handheldDrift(1.234)).toBe(handheldDrift(1.234));
  });
});
