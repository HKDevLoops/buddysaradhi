// Implements: 20_3D_Product_Page.md §3 + §7.1 + §11.3 (performance tiers).
//
// The single place that maps device class to render cost. Every 3D surface in
// this app (the `/` hero and the `/tour` route) reads these helpers instead of
// branching inline, so the degradation ladder (§11.3) cannot drift between
// routes: one ladder, tested here, consumed twice. Pure and dependency-free so
// `tests/scene-tiers.test.ts` can assert it without WebGL or a browser.

/** Desktop-class width: at or above this, a non-low-end device gets the §11.3
 *  discrete-GPU DPR tier. Mirrors the `useWideDesktop` media query in
 *  `./hooks`; the constant lives here so the hook and the tests share it. */
export const WIDE_DESKTOP_MIN_WIDTH = 1280;

/** Resting field of view for the journey camera (20_3D §12 shonen pacing). */
export const FOV_REST = 55;

/** Whip-pan peak: scroll velocity pushes FOV toward this, then it falls back
 *  to {@link FOV_REST}. Both bounds are the spec's `55->75->55`. */
export const FOV_PEAK = 75;

/**
 * DPR tiers per 20_3D §11.3.
 *
 * - Low-end (Save-Data, weak CPU/RAM, small viewport): `[0.75, 1]`.
 * - Full scene on a narrow screen: `[1, 1.5]` - the hero's long-standing cap,
 *   kept because a phone-width viewport gains nothing from more pixels.
 * - Full scene on a desktop-class viewport (>1280px, not low-end): `[1, 2]` -
 *   the spec's discrete tier. `<AdaptiveDpr>` still sheds load under pressure,
 *   so the wider cap only spends pixels the GPU has already proven it can
 *   afford.
 */
export function resolveDpr(lowEnd: boolean, wide: boolean): readonly [number, number] {
  if (lowEnd) return [0.75, 1];
  if (wide) return [1, 2];
  return [1, 1.5];
}

/** Transmission samples per 20_3D §7.1: the degradation lever on the card's
 *  `MeshTransmissionMaterial`. 1 on low-end, 4 on full scene. */
export function resolveTransmissionSamples(lowEnd: boolean): 1 | 4 {
  return lowEnd ? 1 : 4;
}

/** Particle budget per 20_3D §3: 80 on low-end, 200 on full scene. */
export function resolveParticleCount(lowEnd: boolean): 80 | 200 {
  return lowEnd ? 80 : 200;
}

export type StageMode = "poster" | "veil" | "canvas";

export interface StageInputs {
  /** Tri-state WebGL probe: null while probing. */
  readonly webgl: boolean | null;
  readonly saveData: boolean;
  readonly tokensReady: boolean;
  /** First frame rendered (`onCreated` fired). */
  readonly sceneReady: boolean;
}

/**
 * Which layer the sticky stage shows. One decision function shared by hero and
 * tour, so the no-WebGL / Save-Data visitor gets the identical contract on
 * both routes:
 * - `poster`: no canvas is ever mounted (no WebGL, Save-Data, or the palette
 *   has not resolved - mounting a canvas with invented colours is forbidden).
 * - `veil`: the canvas is mounted immediately and the Poster holds
 *   pixel-identical space over it until the first frame (FM-10: mount first,
 *   overlay, never gate the mount on readiness).
 * - `canvas`: the live scene, veil lifted.
 */
export function resolveStageMode(inputs: StageInputs): StageMode {
  if (inputs.webgl === false || inputs.saveData || !inputs.tokensReady) return "poster";
  if (!inputs.sceneReady) return "veil";
  return "canvas";
}

export interface FloatProps {
  readonly speed: number;
  readonly rotationIntensity: number;
  readonly floatIntensity: number;
}

/**
 * The `prefers-reduced-motion` freeze (Rule 10, 20_3D §4) as data: frozen
 * means every drei `Float` in the scene gets zeros - no orbit, no bob, no
 * parallax. Tested: frozen output is all zeros; live output matches the
 * long-standing `1.2 / 0.4 / 1.2` values.
 */
export function resolveFloatProps(frozen: boolean): FloatProps {
  if (frozen) return { speed: 0, rotationIntensity: 0, floatIntensity: 0 };
  return { speed: 1.2, rotationIntensity: 0.4, floatIntensity: 1.2 };
}

/**
 * Scroll progress (0..1) to beat index. Clamps out-of-range progress and
 * treats non-finite input (a ScrollTrigger update that fired before layout
 * settled) as the first beat rather than propagating NaN into state.
 */
export function resolveBeatIndex(progress: number, count: number): number {
  if (!Number.isFinite(progress) || count <= 0) return 0;
  const clamped = Math.min(1, Math.max(0, progress));
  return Math.min(count - 1, Math.floor(clamped * count));
}

/**
 * FOV whip target for a normalised scroll speed (0 = still, 1 = full whip).
 * The rig damps the live FOV toward this with `THREE.MathUtils.damp`, so fast
 * scrolling peaks at {@link FOV_PEAK} and stillness rests at
 * {@link FOV_REST} - the spec's `55->75->55` without a new animation dep
 * (GSAP already present; `maath` stays dropped).
 */
export function resolveFovTarget(normalisedSpeed: number): number {
  const t = Number.isFinite(normalisedSpeed) ? Math.min(1, Math.max(0, normalisedSpeed)) : 0;
  return FOV_REST + (FOV_PEAK - FOV_REST) * t;
}

/**
 * Deep-link lookup: `?beat=<id>` to an index into an id list. Unknown or
 * missing ids fall back to 0 - a shared or typed link never lands the visitor
 * in a blank section.
 */
export function beatIdToIndex(id: string | null, ids: readonly string[]): number {
  if (id === null) return 0;
  const found = ids.indexOf(id);
  return found < 0 ? 0 : found;
}

/** The inverse: the slug a beat index serialises to in `?beat=`. */
export function beatIndexToId(index: number, ids: readonly string[]): string {
  const id = ids[Math.min(ids.length - 1, Math.max(0, index))];
  return typeof id === "string" ? id : "";
}
