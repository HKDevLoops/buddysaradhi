// @ts-nocheck
// Implements: docs/plans/ANIMATION_MODEL_BRIEF.md §2 (the scroll is the only
// clock), §4 (the camera direction), §7 (the tier ladder, the DPR cap and the
// off-screen suspend) and §8 (the canvas is decoration: aria-hidden, and the
// poster veil covers it until the first frame).
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill (AGENTS.md FM-09).
"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerformanceMonitor, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { AccentLights } from "../product-3d/AccentLights";
import { ParticleField } from "../product-3d/ParticleField";
import {
  resolveAdaptiveDprFloor,
  resolveDpr,
  resolveParticleCount,
} from "../product-3d/scene-tiers";
import { useGpuClass } from "../product-3d/hooks";
import type { SceneTokens } from "../product-3d/hooks";
import { STORY_BEATS, resolveBeatProgress } from "./beats";
import { applyDirective, buildStoryScene, resolveStoryTier, STORY_BUDGETS } from "./act-directives";
import type { StoryScene } from "./act-directives";
import { CameraRig, clampProgress } from "./camera-rig";
import { applyPhoneLabels, applyPose } from "./character";
import { CHARACTER_ASSET_URL } from "./character-asset";

export interface StoryCanvasProps {
  /** The scroll progress, 0..1. The only clock in the story. */
  readonly progressRef: { current: number };
  readonly tokens: SceneTokens;
  /** Reduced motion: the scene is present and completely still. */
  readonly frozen?: boolean;
  readonly lowEnd?: boolean;
  readonly wide?: boolean;
  /** Off-screen: the render loop is suspended (FM-16). */
  readonly inView?: boolean;
  readonly onReady?: () => void;
}

/**
 * THE DIRECTOR. One place where the scroll progress becomes the scene: the
 * beat's directive mutates the set pieces, and the beat's pose keyframes are
 * lerped across the beat's own progress.
 *
 * No `setState` in the loop - refs only, exactly as the hero's Journey does
 * it. A React state update per frame is what turns a scroll story into a
 * stutter.
 */
function StoryDirector({
  scene,
  progressRef,
  frozen,
}: {
  readonly scene: StoryScene;
  readonly progressRef: { current: number };
  readonly frozen: boolean;
}) {
  useFrame((state) => {
    const progress = clampProgress(progressRef.current);
    const { index, local } = resolveBeatProgress(progress);
    const beat = STORY_BEATS[index];
    const next = STORY_BEATS[Math.min(STORY_BEATS.length - 1, index + 1)];

    applyDirective(scene, beat.scene, progress);
    // The pose answers the scroll, not a timer: it is the interpolation
    // between two NAMED keyframes, across the beat's own progress.
    //
    // REDUCED MOTION holds her in the neutral pose instead. The scene is
    // still the whole scene - it is simply still.
    applyPose(
      scene.seeker,
      frozen ? "neutral" : beat.scene.pose,
      frozen ? "neutral" : next.scene.pose,
      local,
      frozen ? undefined : state.clock.elapsedTime,
    );
    applyPhoneLabels(scene.seeker, beat.scene.phoneLabels, beat.scene.phoneFocus);
  });
  return null;
}

/**
 * THE FIRST FRAME WITH THE SCENE IN IT.
 *
 * The poster veil covers the canvas until the first frame is drawn (fm-10).
 * `onCreated` fires when the WebGL context exists, which is BEFORE anything
 * is drawn, so it is not enough on its own: the veil would lift over an empty
 * canvas and the visitor would see a flash of background. This waits for the
 * renderer to report a frame that actually drew something.
 */
function FirstFrame({ onReady }: { readonly onReady?: () => void }) {
  const fired = useRef(false);
  useFrame((state) => {
    if (fired.current) return;
    if (state.gl.info.render.calls <= 0) return;
    fired.current = true;
    onReady?.();
  });
  return null;
}

/**
 * THE CANVAS, AND THE CHARACTER IT IS WAITING FOR.
 *
 * The seeker is a vendored glTF, so the canvas cannot be built until it is
 * on disk. The `Suspense` boundary is here, at the top of the story canvas
 * and NOT inside it, so the whole canvas waits: the poster veil stays over
 * an empty box until the character has loaded and the first frame with her
 * in it has been drawn. Nothing shifts, and the no-WebGL path still shows the
 * same `<Poster/>` with no JS at all.
 */
export function StoryCanvas(props: StoryCanvasProps) {
  return (
    <Suspense fallback={null}>
      <StoryCanvasInner {...props} />
    </Suspense>
  );
}

function StoryCanvasInner({
  progressRef,
  tokens,
  frozen = false,
  lowEnd = false,
  wide = false,
  inView = true,
  onReady,
}: StoryCanvasProps) {
  const gpuClass = useGpuClass();
  const tier = resolveStoryTier(lowEnd, gpuClass);
  const budget = STORY_BUDGETS[tier];

  // The vendored seeker. drei's `useGLTF` suspends until the file is parsed,
  // and it caches the parsed scene - which is why `createSeeker` clones it
  // before it writes to its bones.
  const character = useGLTF(CHARACTER_ASSET_URL);

  // The ladder's DPR range, and the floor the watchdog may fall back to.
  const tierRange = resolveDpr(lowEnd, wide, gpuClass);
  const adaptiveFloor = resolveAdaptiveDprFloor(gpuClass);
  const [dpr, setDpr] = useState<number | null>(null);
  const degradedRef = useRef(false);

  useEffect(() => {
    setDpr(Math.min(Math.max(window.devicePixelRatio, tierRange[0]), tierRange[1]));
  }, [tierRange]);

  // The scene is built ONCE per tier and palette, and freed on unmount
  // (§7: every geometry and material is disposed).
  const scene = useMemo(
    () =>
      buildStoryScene(
        tier,
        {
          sunken: tokens.sunken,
          inset: tokens.inset,
          raised: tokens.raised,
          accent: tokens.accent,
          accentText: tokens.accentText,
          info: tokens.info,
          warn: tokens.warn,
          key: tokens.key,
        },
        character.scene,
      ),
    [tier, tokens, character.scene],
  );

  useEffect(() => () => scene.dispose(), [scene]);

  return (
    <Canvas
      aria-hidden="true"
      dpr={dpr ?? tierRange}
      gl={{
        antialias: budget.antialiasSamples > 0,
        powerPreference: lowEnd ? "low-power" : "high-performance",
      }}
      camera={{ fov: 55, position: [4.6, 3.0, 9.6] }}
      frameloop={inView ? "always" : "never"}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.25;
        // The transmission knob, in three.js's own terms: the mid tier
        // renders the refraction pass at half resolution, the high tier at
        // full. The low tier has no transmission material at all.
        gl.transmissionResolutionScale = tier === "high" ? 1 : 0.5;
      }}
    >
      <color attach="background" args={[tokens.canvas]} />
      <fog attach="fog" args={[tokens.sunken, 16, 46]} />
      {/*
        The adaptive DPR, wired to a signal that MOVES. `<AdaptiveDpr/>` reads
        `state.performance.current`, which nothing in React Three Fiber ever
        changes, so it is a no-op - the same defect the hero fixed. The
        watchdog below measures the frame rate and drops the resolution to the
        ladder's floor when the scene is sustainedly slow. The decline is
        one-way: a resolution that flickers between two values is worse than
        either of them.
      */}
      <PerformanceMonitor
        iterations={6}
        bounds={() => [35, 55]}
        onDecline={() => {
          if (degradedRef.current) return;
          degradedRef.current = true;
          setDpr((current) =>
            current === null ? adaptiveFloor : Math.min(current, adaptiveFloor),
          );
        }}
      />
      <Suspense fallback={null}>
        {/* The shared rig and the shared dust, imported rather than forked. */}
        <AccentLights tokens={tokens} frozen={frozen} />
        <ParticleField tokens={tokens} count={resolveParticleCount(lowEnd)} frozen={frozen} />
        <primitive object={scene.group} />
        <StoryDirector scene={scene} progressRef={progressRef} frozen={frozen} />
        <CameraRig beats={STORY_BEATS} progressRef={progressRef} frozen={frozen} />
        <FirstFrame onReady={onReady} />
      </Suspense>
    </Canvas>
  );
}
