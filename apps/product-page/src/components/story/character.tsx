// Implements: docs/plans/ANIMATION_MODEL_BRIEF.md §3 (the seeker: primitives
// and the pose rig) and §2 (the beat vocabulary the rig reads).
//
// THE CHARACTER IS CODE, NOT AN ASSET. Seven primitives, one body material,
// no skeleton and no animation mixer: the pose is a set of NAMED KEYFRAMES on
// a handful of bone transforms, lerped by the beat progress. A skeleton would
// cost more, ship more, and - the real reason - would play on a timer instead
// of answering the scroll.
//
// SILHOUETTE FIRST. She has to read as a person at z=40 and at z=4, and
// readability comes from proportion and pose, not from a face. There is no face
// here, deliberately: a character with a face is out of budget and out of
// taste for this product.
//
// THE PHONE IS THE ONLY LIGHT SHE CARRIES. The body material is dark (the
// palette's accent-text role, dimmed) and the phone carries its own emissive
// plus a small point light, so in Act I she is a dark figure with a lit face.
// That contrast is the whole visual idea of the act.
//
// THIS MODULE IS DELIBERATELY FREE OF JSX AND OF REACT THREE FIBER. The scene
// mounts the group it returns with `<primitive>`, and `tests/performance.test.ts`
// constructs the same seeker in Node so the triangle count is measured rather
// than guessed.

import * as THREE from "three";
import type { PoseName } from "./beats";

/**
 * The figure's proportions, in the brief's own numbers (brief §3). The capsule
 * `length` is the cylinder between the caps, so a capsule is longer than its
 * length by both radii.
 */
export const SEEKER_GEOMETRY = {
  torso: { radius: 0.34, length: 0.92, capSegments: 6, radialSegments: 12 },
  head: { radius: 0.17, widthSegments: 20, heightSegments: 14 },
  neck: { radius: 0.07, height: 0.1, radialSegments: 8 },
  arm: { radius: 0.085, length: 0.62, capSegments: 6, radialSegments: 12 },
  leg: { radius: 0.1, length: 0.78, capSegments: 6, radialSegments: 12 },
  phone: { width: 0.09, height: 0.17, depth: 0.008 },
} as const;

/** The material the brief specifies: one standard material for the whole body. */
export const BODY_MATERIAL = { roughness: 0.72, metalness: 0.0 } as const;

/**
 * How much of the palette's accent-text role the body keeps. The figure is a
 * silhouette, not a highlight: she must never compete with the ledger card for
 * attention.
 */
export const FIGURE_DARKENING = 0.38;

/** The figure's world height, in world units (roughly a person). */
export const SEEKER_HEIGHT = 1.79;

/** A named keyframe: the pose every bone transform is set from. */
export interface Pose {
  /** The torso's forward lean, in radians. */
  readonly lean: number;
  /** The torso's side tilt, in radians. */
  readonly tilt: number;
  /** The head's yaw. Positive turns her away from the camera. */
  readonly headYaw: number;
  /** The head's pitch. Positive looks down at the phone. */
  readonly headPitch: number;
  /** The left arm's swing, in radians. */
  readonly armSwingL: number;
  /** The right arm's swing, in radians. */
  readonly armSwingR: number;
  /** How far the arms hang away from the body. */
  readonly armSpread: number;
  /** The left leg's stride, in radians. */
  readonly strideL: number;
  /** The right leg's stride, in radians. */
  readonly strideR: number;
  /** How far the phone is tilted back towards her face. */
  readonly phonePitch: number;
  /** How far the phone has dropped from her chest to her side, 0..1. */
  readonly phoneDrop: number;
  /** The phone's brightness, 0..1. */
  readonly phoneGlow: number;
  /** The idle sway's amplitude, in radians. Zero means she does not move. */
  readonly idleAmp: number;
  /** The idle sway's rate, in hertz. */
  readonly idleRate: number;
}

/**
 * THE POSES (brief §3's table, as named keyframes).
 *
 * - Act I: shoulders forward, head down, arms close to the body, slow small
 *   movements. Compression, searching.
 * - Act II: arms tighter, head turned slightly away, faster idle. Anxiety.
 * - Act III: still. Hands at the sides, and only the phone moves. The pause
 *   before deciding.
 * - Act IV: shoulders open, head up, a longer stride, arms swinging. Relief.
 * - Act V: upright, the phone down at her side, occasionally raised.
 *   Competence.
 */
export const POSES: Readonly<Record<PoseName, Pose>> = {
  "hunt-search": {
    lean: 0.16,
    tilt: 0.02,
    headYaw: -0.06,
    headPitch: 0.4,
    armSwingL: 0.05,
    armSwingR: -0.05,
    armSpread: 0.05,
    strideL: 0.0,
    strideR: 0.0,
    phonePitch: 0.55,
    phoneDrop: 0.15,
    phoneGlow: 1,
    idleAmp: 0.012,
    idleRate: 0.35,
  },
  "hunt-doubt": {
    lean: 0.1,
    tilt: -0.02,
    headYaw: 0.1,
    headPitch: 0.3,
    armSwingL: 0.02,
    armSwingR: -0.02,
    armSpread: 0.04,
    strideL: 0.0,
    strideR: 0.0,
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
    armSwingL: 0.0,
    armSwingR: 0.0,
    armSpread: 0.02,
    strideL: 0.0,
    strideR: 0.0,
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
    armSwingR: 0.0,
    armSpread: 0.0,
    strideL: 0.0,
    strideR: 0.0,
    phonePitch: 0.4,
    phoneDrop: 0.3,
    phoneGlow: 0.55,
    idleAmp: 0.006,
    idleRate: 0.5,
  },
  "still-hands": {
    lean: 0.03,
    tilt: 0.0,
    headYaw: 0.0,
    headPitch: 0.05,
    armSwingL: 0.0,
    armSwingR: 0.0,
    armSpread: 0.03,
    strideL: 0.0,
    strideR: 0.0,
    phonePitch: 0.85,
    phoneDrop: 0.1,
    phoneGlow: 1,
    idleAmp: 0.0,
    idleRate: 0.0,
  },
  "relief-open": {
    lean: -0.1,
    tilt: 0.0,
    headYaw: 0.02,
    headPitch: -0.05,
    armSwingL: 0.24,
    armSwingR: -0.24,
    armSpread: 0.1,
    strideL: 0.12,
    strideR: -0.12,
    phonePitch: 0.7,
    phoneDrop: 0.05,
    phoneGlow: 0.9,
    idleAmp: 0.014,
    idleRate: 0.5,
  },
  "relief-walk": {
    lean: -0.08,
    tilt: 0.0,
    headYaw: 0.0,
    headPitch: -0.04,
    armSwingL: 0.46,
    armSwingR: -0.46,
    armSpread: 0.12,
    strideL: 0.34,
    strideR: -0.34,
    phonePitch: 0.2,
    phoneDrop: 0.55,
    phoneGlow: 0.5,
    idleAmp: 0.02,
    idleRate: 0.9,
  },
  "competence-up": {
    lean: -0.04,
    tilt: 0.0,
    headYaw: 0.0,
    headPitch: -0.02,
    armSwingL: 0.1,
    armSwingR: -0.1,
    armSpread: 0.08,
    strideL: 0.0,
    strideR: 0.0,
    phonePitch: 0.1,
    phoneDrop: 0.75,
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
    armSpread: 0.04,
    strideL: 0,
    strideR: 0,
    phonePitch: 0.3,
    phoneDrop: 0.4,
    phoneGlow: 0.6,
    idleAmp: 0,
    idleRate: 0,
  },
};

/** The bone transforms the poses drive. */
export interface SeekerBones {
  /** The whole figure: its world position and which way it faces. */
  readonly root: THREE.Group;
  /** The hips. Everything above and below the waist hangs off them. */
  readonly hips: THREE.Group;
  /** The torso. Its rotation is the pose's lean and tilt. */
  readonly torso: THREE.Group;
  /** The head, on its own pivot under the neck. */
  readonly head: THREE.Group;
  readonly armL: THREE.Group;
  readonly armR: THREE.Group;
  readonly legL: THREE.Group;
  readonly legR: THREE.Group;
  /** The phone, and the light it carries. */
  readonly phone: THREE.Group;
  readonly phoneLight: THREE.PointLight;
  /** The phone's five labels: Dashboard, Students, Attendance, Fees, Settings. */
  readonly labels: readonly THREE.Mesh[];
}

/** The constructed seeker: its group, its bones, and what to dispose. */
export interface Seeker {
  readonly group: THREE.Group;
  readonly bones: SeekerBones;
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

function makeGeometry(): {
  readonly geometries: THREE.BufferGeometry[];
  readonly torso: THREE.CapsuleGeometry;
  readonly head: THREE.SphereGeometry;
  readonly neck: THREE.CylinderGeometry;
  readonly arm: THREE.CapsuleGeometry;
  readonly leg: THREE.CapsuleGeometry;
  readonly phone: THREE.BoxGeometry;
  readonly label: THREE.PlaneGeometry;
} {
  const g = SEEKER_GEOMETRY;
  const torso = new THREE.CapsuleGeometry(
    g.torso.radius,
    g.torso.length,
    g.torso.capSegments,
    g.torso.radialSegments,
  );
  const head = new THREE.SphereGeometry(g.head.radius, g.head.widthSegments, g.head.heightSegments);
  const neck = new THREE.CylinderGeometry(
    g.neck.radius,
    g.neck.radius,
    g.neck.height,
    g.neck.radialSegments,
  );
  const arm = new THREE.CapsuleGeometry(
    g.arm.radius,
    g.arm.length,
    g.arm.capSegments,
    g.arm.radialSegments,
  );
  const leg = new THREE.CapsuleGeometry(
    g.leg.radius,
    g.leg.length,
    g.leg.capSegments,
    g.leg.radialSegments,
  );
  const phone = new THREE.BoxGeometry(g.phone.width, g.phone.height, g.phone.depth);
  const label = new THREE.PlaneGeometry(0.22, 0.055);
  return {
    geometries: [torso, head, neck, arm, leg, phone, label],
    torso,
    head,
    neck,
    arm,
    leg,
    phone,
    label,
  };
}

/**
 * Builds the seeker.
 *
 * ONE MATERIAL FOR THE BODY. Every body part shares it, so the figure reads
 * as one silhouette rather than as seven lit objects. The phone is the second
 * material, and it has to be: it is the light source.
 */
export function createSeeker(colours: SeekerColours, labelCount = 5): Seeker {
  const geo = makeGeometry();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colours.body).multiplyScalar(FIGURE_DARKENING),
    roughness: BODY_MATERIAL.roughness,
    metalness: BODY_MATERIAL.metalness,
  });
  const phoneMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colours.glow),
    emissive: new THREE.Color(colours.glow),
    emissiveIntensity: 1.6,
    roughness: 0.35,
    metalness: 0,
  });
  const labelMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colours.glow),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  const disposables: { dispose(): void }[] = [
    ...geo.geometries,
    bodyMaterial,
    phoneMaterial,
    labelMaterial,
  ];

  const root = new THREE.Group();
  root.name = "seeker";
  // The rig is authored at roughly three units tall; this puts her at 1.79,
  // which is a person against a camera that sits three units from her.
  root.scale.setScalar(0.6);

  const hips = new THREE.Group();
  hips.position.y = 0.98;
  root.add(hips);

  const torso = new THREE.Group();
  hips.add(torso);

  const torsoMesh = new THREE.Mesh(geo.torso, bodyMaterial);
  torsoMesh.position.y = 0.8;
  torso.add(torsoMesh);

  const neckMesh = new THREE.Mesh(geo.neck, bodyMaterial);
  neckMesh.position.y = 1.62;
  torso.add(neckMesh);

  const head = new THREE.Group();
  head.position.y = 1.84;
  torso.add(head);
  const headMesh = new THREE.Mesh(geo.head, bodyMaterial);
  head.add(headMesh);

  const armL = new THREE.Group();
  armL.position.set(-0.36, 1.5, 0);
  torso.add(armL);
  const armLMesh = new THREE.Mesh(geo.arm, bodyMaterial);
  armLMesh.position.y = -0.395;
  armL.add(armLMesh);

  const armR = new THREE.Group();
  armR.position.set(0.36, 1.5, 0);
  torso.add(armR);
  const armRMesh = new THREE.Mesh(geo.arm, bodyMaterial);
  armRMesh.position.y = -0.395;
  armR.add(armRMesh);

  const legL = new THREE.Group();
  legL.position.set(-0.13, 0, 0);
  hips.add(legL);
  const legLMesh = new THREE.Mesh(geo.leg, bodyMaterial);
  legLMesh.position.y = -0.49;
  legL.add(legLMesh);

  const legR = new THREE.Group();
  legR.position.set(0.13, 0, 0);
  hips.add(legR);
  const legRMesh = new THREE.Mesh(geo.leg, bodyMaterial);
  legRMesh.position.y = -0.49;
  legR.add(legRMesh);

  // The phone hangs off the torso rather than off a hand, so the arms can
  // swing without the phone swinging with them.
  const phone = new THREE.Group();
  torso.add(phone);
  const phoneMesh = new THREE.Mesh(geo.phone, phoneMaterial);
  phone.add(phoneMesh);

  const phoneLight = new THREE.PointLight(new THREE.Color(colours.glow), 3.2, 4, 2);
  phone.add(phoneLight);

  const labels: THREE.Mesh[] = [];
  for (let i = 0; i < labelCount; i += 1) {
    const label = new THREE.Mesh(geo.label, labelMaterial.clone());
    label.position.set(0.02, -0.16 - i * 0.075, 0.01);
    label.visible = false;
    phone.add(label);
    labels.push(label);
    disposables.push(label.material as THREE.Material);
  }

  return {
    group: root,
    bones: { root, hips, torso, head, armL, armR, legL, legR, phone, phoneLight, labels },
    disposables,
  };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Applies a pose.
 *
 * `from` and `to` are two NAMED KEYFRAMES and `t` is the beat progress across
 * them: the rig interpolates every transform between them, so the pose
 * changes with the story and never snaps.
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
  const k = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const bones = seeker.bones;

  bones.torso.rotation.set(lerp(a.lean, b.lean, k), 0, lerp(a.tilt, b.tilt, k));
  bones.head.rotation.set(lerp(a.headPitch, b.headPitch, k), lerp(a.headYaw, b.headYaw, k), 0);

  bones.armL.rotation.x = lerp(a.armSwingL, b.armSwingL, k);
  bones.armR.rotation.x = lerp(a.armSwingR, b.armSwingR, k);
  const spread = lerp(a.armSpread, b.armSpread, k);
  bones.armL.rotation.z = -spread;
  bones.armR.rotation.z = spread;

  bones.legL.rotation.x = lerp(a.strideL, b.strideL, k);
  bones.legR.rotation.x = lerp(a.strideR, b.strideR, k);

  const phonePitch = lerp(a.phonePitch, b.phonePitch, k);
  const phoneDrop = lerp(a.phoneDrop, b.phoneDrop, k);
  const phoneGlow = lerp(a.phoneGlow, b.phoneGlow, k);
  bones.phone.rotation.x = -phonePitch;
  // Raised in front of the chest, or down at her side.
  bones.phone.position.set(0.16, 1.28 - 0.5 * phoneDrop, 0.4 - 0.3 * phoneDrop);

  const phoneMesh = bones.phone.children[0];
  if (phoneMesh && "material" in phoneMesh) {
    (phoneMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + 2.0 * phoneGlow;
  }
  bones.phoneLight.intensity = 0.8 + 3.2 * phoneGlow;

  if (time === undefined) return;
  const amp = lerp(a.idleAmp, b.idleAmp, k);
  if (amp <= 0) return;
  const rate = lerp(a.idleRate, b.idleRate, k);
  const phase = time * rate * Math.PI * 2;
  bones.torso.rotation.y = Math.sin(phase) * amp;
  bones.head.rotation.y += Math.sin(phase * 0.7 + 1.1) * amp * 0.6;
  bones.phone.position.y += Math.sin(phase * 0.5) * amp * 0.8;
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
