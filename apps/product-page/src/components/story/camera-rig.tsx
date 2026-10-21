// Implements: docs/plans/ANIMATION_MODEL_BRIEF.md §4 (camera direction: the
// mandatory target, the damped look-ahead, the per-beat FOV and roll) and
// 20_3D_Product_Page.md §12 (the `/story` expansion).
//
// A CAMERA HAS TO LOOK AT SOMETHING. The existing hero dolly moves a position
// along a curve, which is motion; the story's camera is DIRECTION. Every beat
// declares what it is about (`camera.target`, mandatory), the rig points
// slightly AHEAD of that along the path of travel, and the look-ahead is
// damped so the move feels operated rather than lerped.
//
// ONE DAMP RATE FOR EVERYTHING. The position, the target and the field of view
// are damped at the SAME rate (brief §4). Different rates per property are
// how a camera gets seasickness: the lens would settle before the framing did,
// or the other way round, and the viewer would feel the difference even if
// they could not name it.
//
// ROLL IS ACT II ONLY, AND IT IS EXACTLY ZERO BY BEAT 38. The chaos tilts;
// the recovery levels. A roll that never returns reads as a bug, not as style.

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { resolveBeatProgress } from "./beats";
import type { Beat } from "./beats";

/** The shared damping rate for the position, the target and the FOV. */
export const CAMERA_DAMP_RATE = 3.5;

/**
 * The look-ahead, as a fraction of the story's progress.
 *
 * It is the smallest of the brief's range (0.06-0.20): the target path moves
 * a long way between two beats of the same act, so a large look-ahead would
 * point the camera at the subject of a beat that is still a minute away.
 */
export const LOOK_AHEAD = 0.08;

/** The field of view's limits. Every beat declares one inside them. */
export const FOV_MIN = 35;
export const FOV_MAX = 90;

/** The roll's limit. Act II may tilt; nothing else may. */
export const ROLL_MAX = 0.08;

/** The framing a beat resolves to. */
export interface CameraState {
  readonly pos: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number;
  readonly roll: number;
}

/** Clamps a field of view into the range the story is allowed to use. */
export function clampFov(fov: number): number {
  if (!Number.isFinite(fov)) return FOV_MIN;
  return Math.min(FOV_MAX, Math.max(FOV_MIN, fov));
}

/** Clamps a scroll progress into 0..1. */
export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

/**
 * The progress the camera LOOKS ahead to.
 *
 * At the end of the story there is nothing ahead, so the look-ahead clamps at
 * 1 rather than running off the end of the beat list.
 */
export function lookAheadProgress(progress: number, lookAhead: number): number {
  const p = clampProgress(progress);
  const ahead = Number.isFinite(lookAhead) ? lookAhead : 0;
  return Math.min(1, p + ahead);
}

/**
 * The framing at a scroll progress: the beat the progress lands in, and the
 * next one, interpolated across the beat's own progress.
 *
 * This is why a beat transition never cuts: the camera is always somewhere
 * between two beats, and the damping smooths what is left.
 */
export function interpolateCamera(beats: readonly Beat[], progress: number): CameraState {
  const { index, local } = resolveBeatProgress(progress);
  const current = beats[index];
  const next = beats[Math.min(beats.length - 1, index + 1)];
  const t = local;
  const lerp = (a: number, b: number): number => a + (b - a) * t;
  return {
    pos: [
      lerp(current.camera.pos[0], next.camera.pos[0]),
      lerp(current.camera.pos[1], next.camera.pos[1]),
      lerp(current.camera.pos[2], next.camera.pos[2]),
    ],
    target: [
      lerp(current.camera.target[0], next.camera.target[0]),
      lerp(current.camera.target[1], next.camera.target[1]),
      lerp(current.camera.target[2], next.camera.target[2]),
    ],
    fov: lerp(current.camera.fov, next.camera.fov),
    roll: lerp(current.camera.roll, next.camera.roll),
  };
}

/** The point the camera looks at: the target, pushed ahead along the path. */
export function resolveLookTarget(
  beats: readonly Beat[],
  progress: number,
  lookAhead: number = LOOK_AHEAD,
): readonly [number, number, number] {
  return interpolateCamera(beats, lookAheadProgress(progress, lookAhead)).target;
}

/** Damps one vector towards another, in place. */
export function dampVec3(
  current: THREE.Vector3,
  target: THREE.Vector3,
  lambda: number,
  delta: number,
): THREE.Vector3 {
  current.x = THREE.MathUtils.damp(current.x, target.x, lambda, delta);
  current.y = THREE.MathUtils.damp(current.y, target.y, lambda, delta);
  current.z = THREE.MathUtils.damp(current.z, target.z, lambda, delta);
  return current;
}

/**
 * The hand-held drift of Act II.
 *
 * Deterministic on purpose: `Math.random` in the render path would make the
 * server's markup and the client's first frame disagree (FM-14). Two sines at
 * incommensurate rates read as noise and never repeat visibly.
 */
export function handheldDrift(time: number): number {
  return Math.sin(time * 1.7) * 0.006 + Math.sin(time * 2.9 + 1.3) * 0.004;
}

export interface CameraRigProps {
  /** The beats. The rig reads their camera declarations. */
  readonly beats: readonly Beat[];
  /** The scroll progress, 0..1. The only clock. */
  readonly progressRef: { current: number };
  /** Reduced motion: the scene is present but completely still. */
  readonly frozen?: boolean;
}

/**
 * THE RIG. It owns the camera for the whole story: where it is, what it
 * looks at, how wide the lens is, and how far it is tilted.
 */
export function CameraRig({ beats, progressRef, frozen = false }: CameraRigProps) {
  const camera = useThree((state) => state.camera);
  const position = useRef(new THREE.Vector3(...beats[0].camera.pos));
  const look = useRef(new THREE.Vector3(...beats[0].camera.target));
  const fov = useRef(clampFov(beats[0].camera.fov));
  const roll = useRef(0);
  const desiredPosition = useRef(new THREE.Vector3());
  const desiredLook = useRef(new THREE.Vector3());
  const parked = useRef(false);

  useFrame((state, delta) => {
    const progress = clampProgress(progressRef.current);

    // REDUCED MOTION: a full scene, completely still. No camera travel, no
    // drift, no roll, and the lens parked on the opening framing.
    if (frozen) {
      if (parked.current) return;
      parked.current = true;
      position.current.set(...beats[0].camera.pos);
      look.current.set(...beats[0].camera.target);
      fov.current = clampFov(beats[0].camera.fov);
      roll.current = 0;
      camera.position.copy(position.current);
      camera.lookAt(look.current);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = fov.current;
        camera.updateProjectionMatrix();
      }
      return;
    }

    const stateNow = interpolateCamera(beats, progress);
    desiredPosition.current.set(...stateNow.pos);
    desiredLook.current.set(...resolveLookTarget(beats, progress));

    // The hand-held drift belongs to Act II only: the chaos shakes, the
    // recovery does not.
    const act = beats[resolveBeatProgress(progress).index].act;
    if (act === 2) {
      const drift = handheldDrift(state.clock.elapsedTime);
      desiredLook.current.x += drift;
      desiredLook.current.y += drift * 0.6;
    }

    dampVec3(position.current, desiredPosition.current, CAMERA_DAMP_RATE, delta);
    dampVec3(look.current, desiredLook.current, CAMERA_DAMP_RATE, delta);
    fov.current = THREE.MathUtils.damp(
      fov.current,
      clampFov(stateNow.fov),
      CAMERA_DAMP_RATE,
      delta,
    );
    roll.current = THREE.MathUtils.damp(roll.current, stateNow.roll, CAMERA_DAMP_RATE, delta);

    camera.position.copy(position.current);
    camera.lookAt(look.current);
    // The dutch angle, about the lens's own axis.
    camera.rotateZ(roll.current);

    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = fov.current;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
