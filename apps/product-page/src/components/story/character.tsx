// Implements: docs/plans/ANIMATION_MODEL_BRIEF.md §0.1 (the vendored-asset
// rule: a small, curated, LICENSED set of vendored assets, with the source,
// the licence, the attribution and the SHA-256 recorded beside the file, a
// size budget and no runtime fetch), §3 (the seeker, and the per-act pose
// keyframes) and §7 (the budget the character has to fit inside).
//
// THE CHARACTER IS A VENDORED HUMAN, NOT CODE.
//
// It used to be seven primitives - a capsule torso, a sphere head, a cylinder
// neck, two arm capsules, two leg capsules - and it looked like a snowman.
// The owner overruled the code-first rule for the character only: a real,
// rigged human is vendored into `public/scene/character/seeker.glb`, served
// from this app's own origin, with its provenance in `ATTRIBUTION.md` beside
// it. The rule was amended in the same commit (brief §9).
//
// THE POSE IS STILL HAND-AUTHORED KEYFRAMES.
//
// The rig gives her bones; it does not give her a performance. There is no
// `AnimationMixer`, no `AnimationClip` and no "play a clip and hope" anywhere
// in this file. Each act has a NAMED keyframe, and the keyframe is a set of
// numbers on the bones; the story lerps between two keyframes by the beat
// progress, so the pose answers the SCROLL rather than a timer.
//
// THE DELTAS ARE IN THE CHARACTER'S FRAME.
//
// X is her left, Y is up, Z is the way she faces. A "lean" is a rotation
// about X, a "tilt" about Z, a "yaw" about Y - the same words the brief
// uses, so the numbers in the pose table can be read as the body language
// they are. Each bone's rest transform is captured when the seeker is built,
// and a delta is expressed in the bone's own rest frame before it is
// applied, which is what makes "swing the left arm forward" mean the same
// thing on both arms.
//
// ONE MATERIAL, AND THE PHONE IS THE ONLY LIGHT SHE CARRIES.
//
// The body is a single `meshStandardMaterial` in the palette's accent-text
// role, dimmed into a silhouette: she must never compete with the ledger
// card. The phone is the second material, because the phone is the light.

import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { PoseName } from "./beats";
import { SEEKER_BONE_NAMES } from "./character-asset";

/**
 * The figure's world height, in world units (roughly a person). The rig is
 * 1.81 units tall in its rest pose; it is scaled to this.
 */
export const SEEKER_HEIGHT = 1.79;

/** The material the brief specifies: one standard material for the whole body. */
export const BODY_MATERIAL = { roughness: 0.72, metalness: 0.0 } as const;

/**
 * How much of the palette's accent-text role the body keeps. The figure is a
 * silhouette, not a highlight.
 */
export const FIGURE_DARKENING = 0.38;

/**
 * The phone, in world units. It is 8.5 cm by 16 cm: a phone.
 */
export const PHONE_GEOMETRY = { width: 0.085, height: 0.16, depth: 0.008 } as const;

/**
 * A named keyframe: the pose every bone transform is set from.
 *
 * The angles are in the character's own frame - X is her left, Y is up, Z is
 * the way she faces - so "lean" is a lean and "stride" is a stride.
 */
export interface Pose {
  /** The torso's forward lean, in radians. Positive leans her forwards. */
  readonly lean: number;
  /** The torso's side tilt, in radians. Positive tilts her to her right. */
  readonly tilt: number;
  /** The head's yaw, in radians. Positive turns her to her left. */
  readonly headYaw: number;
  /** The head's pitch, in radians. Positive looks down. */
  readonly headPitch: number;
  /** The left arm's swing, in radians. Positive swings it forwards. */
  readonly armSwingL: number;
  /** The right arm's swing, in radians. Positive swings it forwards. */
  readonly armSwingR: number;
  /** How far the left arm hangs away from her body, in radians. */
  readonly armSpreadL: number;
  /** How far the right arm hangs away from her body, in radians. */
  readonly armSpreadR: number;
  /** The left elbow's bend, in radians. Positive brings the forearm forwards. */
  readonly elbowL: number;
  /** The right elbow's bend, in radians. */
  readonly elbowR: number;
  /** The left leg's stride, in radians. Positive steps forwards. */
  readonly strideL: number;
  /** The right leg's stride, in radians. Positive steps forwards. */
  readonly strideR: number;
  /** The left knee's bend, in radians. */
  readonly kneeL: number;
  /** The right knee's bend, in radians. */
  readonly kneeR: number;
  /** How far the phone is tipped back towards her face, in radians. */
  readonly phonePitch: number;
  /** How far the phone has rolled away from her face, 0..1. */
  readonly phoneDrop: number;
  /** The phone's brightness, 0..1. */
  readonly phoneGlow: number;
  /** The idle sway's amplitude, in radians. Zero means she does not move. */
  readonly idleAmp: number;
  /** The idle sway's rate, in hertz. */
  readonly idleRate: number;
}

/**
 * THE POSES (brief §3's table, as named keyframes on the rig's bones).
 *
 * - Act I: shoulders forward, head down, arms close to the body, slow small
 *   movements. Compression, searching. The right forearm is up, because the
 *   phone is in her right hand and she is reading it.
 * - Act II: arms tighter, head turned slightly away, faster idle. Anxiety.
 * - Act III: still. The body does not move at all; only the phone's light
 *   does. The pause before deciding.
 * - Act IV: shoulders open, head up, a longer stride, arms swinging. Relief.
 * - Act V: upright, the phone down at her side. Competence.
 */
export const POSES: Readonly<Record<PoseName, Pose>> = {
  "hunt-search": {
    lean: 0.16,
    tilt: 0.02,
    headYaw: -0.06,
    headPitch: 0.4,
    armSwingL: 0.08,
    armSwingR: 0.26,
    armSpreadL: 0.04,
    armSpreadR: 0.1,
    elbowL: 0.1,
    elbowR: 1.02,
    strideL: 0.0,
    strideR: 0.0,
    kneeL: 0.0,
    kneeR: 0.0,
    phonePitch: 0.55,
    phoneDrop: 0.15,
    phoneGlow: 1,
    idleAmp: 0.012,
    idleRate: 0.35,
  },
  "hunt-doubt": {
    lean: 0.1,
    tilt: -0.02,
    headYaw: 0.14,
    headPitch: 0.3,
    armSwingL: 0.06,
    armSwingR: 0.22,
    armSpreadL: 0.03,
    armSpreadR: 0.12,
    elbowL: 0.12,
    elbowR: 0.94,
    strideL: 0.0,
    strideR: 0.0,
    kneeL: 0.0,
    kneeR: 0.0,
    phonePitch: 0.5,
    phoneDrop: 0.18,
    phoneGlow: 0.9,
    idleAmp: 0.01,
    idleRate: 0.3,
  },
  "anxiety-tight": {
    lean: 0.2,
    tilt: 0.0,
    headYaw: -0.3,
    headPitch: 0.22,
    armSwingL: 0.04,
    armSwingR: 0.16,
    armSpreadL: 0.0,
    armSpreadR: 0.05,
    elbowL: 0.05,
    elbowR: 0.78,
    strideL: 0.0,
    strideR: 0.0,
    kneeL: 0.0,
    kneeR: 0.0,
    phonePitch: 0.45,
    phoneDrop: 0.25,
    phoneGlow: 0.8,
    idleAmp: 0.02,
    idleRate: 1.1,
  },
  collapse: {
    lean: 0.34,
    tilt: 0.0,
    headYaw: -0.18,
    headPitch: 0.16,
    armSwingL: 0.0,
    armSwingR: 0.1,
    armSpreadL: 0.0,
    armSpreadR: 0.02,
    elbowL: 0.0,
    elbowR: 0.58,
    strideL: 0.0,
    strideR: 0.0,
    kneeL: 0.0,
    kneeR: 0.0,
    phonePitch: 0.4,
    phoneDrop: 0.3,
    phoneGlow: 0.55,
    idleAmp: 0.006,
    idleRate: 0.5,
  },
  "still-hands": {
    lean: 0.02,
    tilt: 0.0,
    headYaw: 0.0,
    headPitch: 0.08,
    armSwingL: 0.0,
    armSwingR: 0.05,
    armSpreadL: 0.02,
    armSpreadR: 0.02,
    elbowL: 0.0,
    elbowR: 0.3,
    strideL: 0.0,
    strideR: 0.0,
    kneeL: 0.0,
    kneeR: 0.0,
    phonePitch: 0.9,
    phoneDrop: 0.6,
    phoneGlow: 1,
    idleAmp: 0.0,
    idleRate: 0.0,
  },
  "relief-open": {
    lean: -0.08,
    tilt: 0.0,
    headYaw: 0.02,
    headPitch: -0.05,
    armSwingL: 0.26,
    armSwingR: -0.2,
    armSpreadL: 0.12,
    armSpreadR: 0.12,
    elbowL: 0.18,
    elbowR: 0.24,
    strideL: 0.14,
    strideR: -0.14,
    kneeL: 0.1,
    kneeR: 0.22,
    phonePitch: 0.6,
    phoneDrop: 0.3,
    phoneGlow: 0.9,
    idleAmp: 0.014,
    idleRate: 0.5,
  },
  "relief-walk": {
    lean: -0.06,
    tilt: 0.0,
    headYaw: 0.0,
    headPitch: -0.04,
    armSwingL: 0.46,
    armSwingR: -0.46,
    armSpreadL: 0.14,
    armSpreadR: 0.14,
    elbowL: 0.28,
    elbowR: 0.3,
    strideL: 0.34,
    strideR: -0.34,
    kneeL: 0.28,
    kneeR: 0.42,
    phonePitch: 0.25,
    phoneDrop: 0.55,
    phoneGlow: 0.5,
    idleAmp: 0.02,
    idleRate: 0.9,
  },
  "competence-up": {
    lean: -0.03,
    tilt: 0.0,
    headYaw: 0.0,
    headPitch: -0.02,
    armSwingL: 0.08,
    armSwingR: -0.06,
    armSpreadL: 0.08,
    armSpreadR: 0.06,
    elbowL: 0.08,
    elbowR: 0.1,
    strideL: 0.0,
    strideR: 0.0,
    kneeL: 0.0,
    kneeR: 0.0,
    phonePitch: 0.12,
    phoneDrop: 0.85,
    phoneGlow: 0.45,
    idleAmp: 0.01,
    idleRate: 0.4,
  },
  /**
   * The neutral pose. Under reduced motion the character is HELD here: no
   * story pose, no idle, nothing that moves (brief §8.4).
   */
  neutral: {
    lean: 0,
    tilt: 0,
    headYaw: 0,
    headPitch: 0,
    armSwingL: 0,
    armSwingR: 0,
    armSpreadL: 0.04,
    armSpreadR: 0.04,
    elbowL: 0,
    elbowR: 0.06,
    strideL: 0,
    strideR: 0,
    kneeL: 0,
    kneeR: 0,
    phonePitch: 0.3,
    phoneDrop: 0.6,
    phoneGlow: 0.6,
    idleAmp: 0,
    idleRate: 0,
  },
};

/**
 * A transform the poses drive, with the transforms it was captured at.
 *
 * `restLocal` is the object's own local rotation, and `restWorld` is its
 * world rotation at rest. A delta written in the character's frame is
 * expressed in the object's rest frame before it is applied, which is what
 * makes the same number mean the same thing on the left arm and the right.
 */
export interface DrivenTransform {
  readonly object: THREE.Object3D;
  readonly restLocal: THREE.Quaternion;
  readonly restWorld: THREE.Quaternion;
}

/** Every transform the per-act keyframes drive. */
export interface SeekerDriven {
  readonly hips: DrivenTransform;
  readonly chest: DrivenTransform;
  readonly neck: DrivenTransform;
  readonly head: DrivenTransform;
  readonly upperArmL: DrivenTransform;
  readonly lowerArmL: DrivenTransform;
  readonly upperArmR: DrivenTransform;
  readonly lowerArmR: DrivenTransform;
  readonly upperLegL: DrivenTransform;
  readonly lowerLegL: DrivenTransform;
  readonly upperLegR: DrivenTransform;
  readonly lowerLegR: DrivenTransform;
  readonly phone: DrivenTransform;
}

/** The seeker's bones. */
export interface SeekerBones {
  /** The whole figure: its world position and which way it faces. */
  readonly root: THREE.Group;
  /** The cloned rig, so the scene can measure it or free it. */
  readonly figure: THREE.Object3D;
  /** Every transform the poses drive. */
  readonly driven: SeekerDriven;
  /** The phone, and the light it carries. */
  readonly phone: THREE.Group;
  readonly phoneLight: THREE.PointLight;
  readonly phoneMaterial: THREE.MeshStandardMaterial;
  /** The phone's five labels: Dashboard, Students, Attendance, Fees, Settings. */
  readonly labels: readonly THREE.Mesh[];
}

/**
 * What the pose is doing right now, in numbers.
 *
 * The probe reads this instead of the bones' Euler angles: a bone's local
 * rotation is relative to its rest transform, so it is not the lean, the
 * pitch, the swing or the stride a reader would recognise.
 */
export interface SeekerReadout {
  lean: number;
  headPitch: number;
  armSwingL: number;
  strideL: number;
}

/** The constructed seeker: its group, its bones, and what to dispose. */
export interface Seeker {
  readonly group: THREE.Group;
  readonly bones: SeekerBones;
  /** The pose currently applied, in the character's own frame. */
  readonly readout: SeekerReadout;
  /** Everything this seeker allocated, so the scene can free it on unmount. */
  readonly disposables: readonly { dispose(): void }[];
}

/** The colours the seeker is built from. Both come from the palette. */
export interface SeekerColours {
  /** The body's colour role: the palette's accent-text, dimmed into a silhouette. */
  readonly body: string;
  /** The phone's glow: the palette's accent. */
  readonly glow: string;
}

/** The character frame: X is her left, Y is up, Z is the way she faces. */
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

/** Scratch objects, so the frame loop allocates nothing. */
const scratchDelta = new THREE.Quaternion();
const scratchLocal = new THREE.Quaternion();
const scratchAccumulator = new THREE.Quaternion();

const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Finds a bone by its sanitised glTF name. */
function findBone(root: THREE.Object3D, name: string): THREE.Bone {
  let found: THREE.Bone | null = null;
  root.traverse((object) => {
    if (found) return;
    const bone = object as THREE.Bone;
    if (bone.isBone && bone.name === name) found = bone;
  });
  if (!found) throw new Error(`the seeker rig has no bone called "${name}"`);
  return found;
}

/** Captures an object's rest transforms, so a delta can be applied to it. */
function capture(object: THREE.Object3D): DrivenTransform {
  return {
    object,
    restLocal: object.quaternion.clone(),
    restWorld: object.getWorldQuaternion(new THREE.Quaternion()),
  };
}

/**
 * Builds the seeker from a loaded rig.
 *
 * ONE MATERIAL FOR THE BODY. Every mesh in the rig shares it, so the figure
 * reads as one silhouette rather than as a handful of lit objects. The phone
 * is the second material, and it has to be: it is the light source.
 */
export function createSeeker(rig: THREE.Group, colours: SeekerColours, labelCount = 5): Seeker {
  const disposables: { dispose(): void }[] = [];

  const root = new THREE.Group();
  root.name = "seeker";

  // The rig is cloned: the loader caches ONE parsed scene, and the pose
  // writes to the bones, so the cached copy must not be the one on screen.
  // The clone shares the geometry and the loader's materials - only the
  // bones and the transforms are new - so the geometry is NOT disposed here.
  const figure = cloneSkeleton(rig);
  root.add(figure);

  // The rig is 1.81 units tall in its rest pose. Scale it to a person.
  const bounds = new THREE.Box3().setFromObject(figure);
  const height = bounds.max.y - bounds.min.y;
  if (height > 0) figure.scale.setScalar(SEEKER_HEIGHT / height);

  root.updateMatrixWorld(true);

  // The bones, and the transforms they were captured at.
  const bone = (name: string): DrivenTransform => capture(findBone(figure, name));
  const hips = bone(SEEKER_BONE_NAMES.hips);
  const chest = bone(SEEKER_BONE_NAMES.chest);
  const neck = bone(SEEKER_BONE_NAMES.neck);
  const head = bone(SEEKER_BONE_NAMES.head);
  const upperArmL = bone(SEEKER_BONE_NAMES.upperArmL);
  const lowerArmL = bone(SEEKER_BONE_NAMES.lowerArmL);
  const upperArmR = bone(SEEKER_BONE_NAMES.upperArmR);
  const lowerArmR = bone(SEEKER_BONE_NAMES.lowerArmR);
  const upperLegL = bone(SEEKER_BONE_NAMES.upperLegL);
  const lowerLegL = bone(SEEKER_BONE_NAMES.lowerLegL);
  const upperLegR = bone(SEEKER_BONE_NAMES.upperLegR);
  const lowerLegR = bone(SEEKER_BONE_NAMES.lowerLegR);

  // One material for the whole body, in the palette's accent-text role,
  // dimmed into a silhouette.
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colours.body).multiplyScalar(FIGURE_DARKENING),
    roughness: BODY_MATERIAL.roughness,
    metalness: BODY_MATERIAL.metalness,
  });
  disposables.push(bodyMaterial);
  figure.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) mesh.material = bodyMaterial;
  });

  /* -- the phone, in her right hand --------------------------------------- */

  const wrist = findBone(figure, SEEKER_BONE_NAMES.wristR);
  const index = findBone(figure, SEEKER_BONE_NAMES.indexR);

  const wristWorld = new THREE.Vector3();
  const indexWorld = new THREE.Vector3();
  wrist.getWorldPosition(wristWorld);
  index.getWorldPosition(indexWorld);
  // Out along the hand, so the phone sits in the palm and not in the wrist.
  const alongHand = indexWorld.clone().sub(wristWorld);
  if (alongHand.lengthSq() < 1e-8) alongHand.set(0, -1, 0);
  alongHand.normalize();

  const phone = new THREE.Group();
  phone.name = "phone";
  // The phone lies flat in the hand, screen up, at rest: the screen is the
  // phone's local +Z, and the world rotation below puts that along +Y.
  const phoneWorldRotation = new THREE.Quaternion().setFromAxisAngle(AXIS_X, -Math.PI / 2);
  const wristWorldRotation = wrist.getWorldQuaternion(new THREE.Quaternion());
  phone.quaternion.copy(wristWorldRotation).invert().multiply(phoneWorldRotation);
  phone.position.copy(wristWorld).addScaledVector(alongHand, 0.085);
  wrist.worldToLocal(phone.position);
  wrist.add(phone);

  const phoneGeometry = new THREE.BoxGeometry(
    PHONE_GEOMETRY.width,
    PHONE_GEOMETRY.height,
    PHONE_GEOMETRY.depth,
  );
  disposables.push(phoneGeometry);
  const phoneMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colours.glow),
    emissive: new THREE.Color(colours.glow),
    emissiveIntensity: 1.6,
    roughness: 0.35,
    metalness: 0,
  });
  disposables.push(phoneMaterial);
  const phoneMesh = new THREE.Mesh(phoneGeometry, phoneMaterial);
  phone.add(phoneMesh);

  const phoneLight = new THREE.PointLight(new THREE.Color(colours.glow), 3.2, 4, 2);
  phone.add(phoneLight);

  const labelGeometry = new THREE.PlaneGeometry(0.22, 0.055);
  disposables.push(labelGeometry);
  const labelMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colours.glow),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  disposables.push(labelMaterial);

  const labels: THREE.Mesh[] = [];
  for (let i = 0; i < labelCount; i += 1) {
    const label = new THREE.Mesh(labelGeometry, labelMaterial.clone());
    label.position.set(0.02, -0.16 - i * 0.075, 0.006);
    label.visible = false;
    phone.add(label);
    labels.push(label);
    disposables.push(label.material as THREE.Material);
  }

  root.updateMatrixWorld(true);

  const driven: SeekerDriven = {
    hips,
    chest,
    neck,
    head,
    upperArmL,
    lowerArmL,
    upperArmR,
    lowerArmR,
    upperLegL,
    lowerLegL,
    upperLegR,
    lowerLegR,
    phone: capture(phone),
  };

  return {
    group: root,
    bones: {
      root,
      figure,
      driven,
      phone,
      phoneLight,
      phoneMaterial,
      labels,
    },
    readout: { lean: 0, headPitch: 0, armSwingL: 0, strideL: 0 },
    disposables,
  };
}

/**
 * Applies a rotation, written in the character's frame, to one transform.
 *
 * The delta is expressed in the object's rest frame before it is applied, so
 * "rotate about X" means the same thing on the left arm and the right arm
 * even though the two bones point in opposite directions.
 */
function applyDelta(driven: DrivenTransform, delta: THREE.Quaternion): void {
  scratchLocal
    .copy(driven.restWorld)
    .invert()
    .multiply(delta)
    .multiply(driven.restWorld);
  driven.object.quaternion.copy(driven.restLocal).multiply(scratchLocal);
}

/** Multiplies a rotation about one axis into an accumulator. */
function addDelta(out: THREE.Quaternion, axis: THREE.Vector3, angle: number): void {
  if (angle === 0) return;
  scratchDelta.setFromAxisAngle(axis, angle);
  out.multiply(scratchDelta);
}

/**
 * Applies a pose.
 *
 * `from` and `to` are two NAMED KEYFRAMES and `t` is the beat progress across
 * them: the rig interpolates every bone between them, so the pose changes
 * with the story and never snaps.
 *
 * `time` is optional on purpose. Pass it for the idle sway - the small
 * movements that make her a person rather than a prop - and omit it under
 * reduced motion, when the scene must be completely still (Rule 10). The
 * sway's amplitude and rate come from the pose, so Act I is slow, Act II is
 * fast and Act III does not move at all.
 */
export function applyPose(
  seeker: Seeker,
  from: PoseName,
  to: PoseName,
  t: number,
  time?: number,
): void {
  const a = POSES[from];
  const b = POSES[to];
  const k = clamp01(t);
  const driven = seeker.bones.driven;

  const lean = lerp(a.lean, b.lean, k);
  const tilt = lerp(a.tilt, b.tilt, k);
  const headYaw = lerp(a.headYaw, b.headYaw, k);
  const headPitch = lerp(a.headPitch, b.headPitch, k);
  const armSwingL = lerp(a.armSwingL, b.armSwingL, k);
  const armSwingR = lerp(a.armSwingR, b.armSwingR, k);
  const armSpreadL = lerp(a.armSpreadL, b.armSpreadL, k);
  const armSpreadR = lerp(a.armSpreadR, b.armSpreadR, k);
  const elbowL = lerp(a.elbowL, b.elbowL, k);
  const elbowR = lerp(a.elbowR, b.elbowR, k);
  const strideL = lerp(a.strideL, b.strideL, k);
  const strideR = lerp(a.strideR, b.strideR, k);
  const kneeL = lerp(a.kneeL, b.kneeL, k);
  const kneeR = lerp(a.kneeR, b.kneeR, k);
  const phonePitch = lerp(a.phonePitch, b.phonePitch, k);
  const phoneDrop = lerp(a.phoneDrop, b.phoneDrop, k);
  const phoneGlow = lerp(a.phoneGlow, b.phoneGlow, k);

  let idleYaw = 0;
  let idleHead = 0;
  if (time !== undefined) {
    const amp = lerp(a.idleAmp, b.idleAmp, k);
    if (amp > 0) {
      const rate = lerp(a.idleRate, b.idleRate, k);
      const phase = time * rate * Math.PI * 2;
      idleYaw = Math.sin(phase) * amp;
      idleHead = Math.sin(phase * 0.7 + 1.1) * amp * 0.6;
    }
  }

  /* -- the body ------------------------------------------------------------ */

  scratchAccumulator.identity();
  addDelta(scratchAccumulator, AXIS_X, lean);
  addDelta(scratchAccumulator, AXIS_Z, tilt);
  addDelta(scratchAccumulator, AXIS_Y, idleYaw);
  applyDelta(driven.hips, scratchAccumulator);

  // The chest carries half the lean: a forward lean is a spine, not a hip.
  scratchAccumulator.identity();
  addDelta(scratchAccumulator, AXIS_X, lean * 0.55);
  addDelta(scratchAccumulator, AXIS_Y, idleYaw * 0.4);
  applyDelta(driven.chest, scratchAccumulator);

  // The neck takes a third of the pitch, so the head does not hinge on the
  // spine alone.
  scratchAccumulator.identity();
  addDelta(scratchAccumulator, AXIS_X, headPitch * 0.3);
  applyDelta(driven.neck, scratchAccumulator);

  scratchAccumulator.identity();
  addDelta(scratchAccumulator, AXIS_X, headPitch * 0.7);
  addDelta(scratchAccumulator, AXIS_Y, headYaw + idleHead);
  applyDelta(driven.head, scratchAccumulator);

  /* -- the arms ------------------------------------------------------------ */

  // The arm hangs down, so a rotation about X swings it forwards (the sign
  // is negative because +X tips the arm backwards) and a rotation about Z
  // swings it away from the body - which is +Z's direction on the left arm
  // and -Z's on the right.
  scratchAccumulator.identity();
  addDelta(scratchAccumulator, AXIS_X, -armSwingL);
  addDelta(scratchAccumulator, AXIS_Z, armSpreadL);
  applyDelta(driven.upperArmL, scratchAccumulator);

  scratchAccumulator.identity();
  addDelta(scratchAccumulator, AXIS_X, -elbowL);
  applyDelta(driven.lowerArmL, scratchAccumulator);

  scratchAccumulator.identity();
  addDelta(scratchAccumulator, AXIS_X, -armSwingR);
  addDelta(scratchAccumulator, AXIS_Z, -armSpreadR);
  applyDelta(driven.upperArmR, scratchAccumulator);

  scratchAccumulator.identity();
  addDelta(scratchAccumulator, AXIS_X, -elbowR);
  applyDelta(driven.lowerArmR, scratchAccumulator);

  /* -- the legs ------------------------------------------------------------ */

  scratchAccumulator.identity();
  addDelta(scratchAccumulator, AXIS_X, -strideL);
  applyDelta(driven.upperLegL, scratchAccumulator);

  scratchAccumulator.identity();
  addDelta(scratchAccumulator, AXIS_X, kneeL);
  applyDelta(driven.lowerLegL, scratchAccumulator);

  scratchAccumulator.identity();
  addDelta(scratchAccumulator, AXIS_X, -strideR);
  applyDelta(driven.upperLegR, scratchAccumulator);

  scratchAccumulator.identity();
  addDelta(scratchAccumulator, AXIS_X, kneeR);
  applyDelta(driven.lowerLegR, scratchAccumulator);

  /* -- the phone ----------------------------------------------------------- */

  // The phone tips back towards her face and rolls away from it. Both are
  // rotations of the phone in its own hand, not of the arm.
  scratchAccumulator.identity();
  addDelta(scratchAccumulator, AXIS_X, -phonePitch);
  addDelta(scratchAccumulator, AXIS_Z, phoneDrop);
  applyDelta(driven.phone, scratchAccumulator);

  seeker.bones.phoneMaterial.emissiveIntensity = 0.4 + 2.0 * phoneGlow;
  seeker.bones.phoneLight.intensity = 0.8 + 3.2 * phoneGlow;

  seeker.readout.lean = lean;
  seeker.readout.headPitch = headPitch;
  seeker.readout.armSwingL = armSwingL;
  seeker.readout.strideL = strideL;
}

/**
 * Lights the phone's five labels. `count` is how many are on, `focus` is the
 * bright one (-1 for none). The labels are the five screens, and they are the
 * only place the product names appear inside the 3D scene.
 */
export function applyPhoneLabels(seeker: Seeker, count: number, focus: number): void {
  seeker.bones.labels.forEach((label, index) => {
    label.visible = index < count;
    const material = label.material as THREE.MeshBasicMaterial;
    material.opacity = index === focus ? 0.95 : 0.45;
  });
}
