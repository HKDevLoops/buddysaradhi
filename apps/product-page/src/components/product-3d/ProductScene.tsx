// @ts-nocheck
// Implements: 20_3D_Product_Page.md §3 (perf), §3.1 + §11.3 (the degradation
// ladder), §7.3 (canvas) + Oddy lesson: ACESFilmic tone mapping or the render
// comes out dark and muddy (FM-12).
// docs/design/overhaul-plan.md §4.1: the background and fog now come from the
// ACTIVE palette (--canvas / --surface-sunken) instead of the retired cosmic
// indigo literals.
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill.
"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { Journey, type ProgressProxy } from "./Journey";
import { CoverCamera } from "./CoverCamera";
import { useGpuClass, type SceneTokens } from "./hooks";
import { resolveAdaptiveDprFloor, resolveDpr } from "./scene-tiers";

interface ProductSceneProps {
  progressRef: ProgressProxy;
  tokens: SceneTokens;
  frozen?: boolean;
  lowEnd?: boolean;
  /** Desktop-class viewport (>1280px): opens the §11.3 discrete DPR tier.
   *  The hero keeps `[1, 1.5]` below that width; only a wide, non-low-end
   *  screen gets `[1, 2]`. See `resolveDpr`. */
  wide?: boolean;
  inView?: boolean;
  onReady?: () => void;
  /** Extra scene content mounted inside the same Canvas (e.g. the `/tour`
   *  set pieces). The hero passes nothing; composition, not a fork. */
  children?: ReactNode;
}

export function ProductScene({
  progressRef,
  tokens,
  frozen = false,
  lowEnd = false,
  wide = false,
  inView = true,
  onReady,
  children,
}: ProductSceneProps) {
  // The ladder is keyed on the GPU, so the scene has to know what it is
  // drawing on (20_3D §3.1). `useGpuClass` reads the renderer's own name.
  const gpuClass = useGpuClass();
  const tier = resolveDpr(lowEnd, wide, gpuClass);
  const tierFloor = tier[0];
  const tierCap = tier[1];
  const adaptiveFloor = resolveAdaptiveDprFloor(gpuClass);

  // The device pixel ratio the renderer will actually use, as a NUMBER: the
  // watchdog below has to be able to move it.
  const [dpr, setDpr] = useState<number | null>(null);
  // The ratchet. Once the scene has been judged too slow, its resolution
  // stays low for the rest of the session - a resolution that flickers between
  // two values is worse than either of them.
  const degradedRef = useRef(false);

  useEffect(() => {
    setDpr(Math.min(Math.max(window.devicePixelRatio, tierFloor), tierCap));
  }, [tierFloor, tierCap]);

  return (
    <Canvas
      aria-hidden="true"
      dpr={dpr ?? tier}
      gl={{ antialias: true, powerPreference: lowEnd ? "low-power" : "high-performance" }}
      camera={{ fov: 55, position: [0, 1.2, 6] }}
      frameloop={inView ? "always" : "never"}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        // 1.1 -> 1.25. The scene is a dark palette lit by a light rig; at 1.1
        // the mid-tones sat in the bottom of the curve and the desks read as
        // black boxes. Measured on the rendered poster, not guessed.
        gl.toneMappingExposure = 1.25;
        onReady?.();
      }}
    >
      <color attach="background" args={[tokens.canvas]} />
      {/* The fog was 8..18, which put the far half of the alley - and
          everything the glass card refracts - inside the black. 16..46 keeps
          the depth cue and lets the corridor read. */}
      <fog attach="fog" args={[tokens.sunken, 16, 46]} />
      {/*
        THE ADAPTIVE DPR, AND WHY `<AdaptiveDpr/>` IS NOT HERE.

        `<AdaptiveDpr/>` reads `state.performance.current` and multiplies it by
        the initial DPR. Nothing in React Three Fiber ever calls
        `state.performance.regress()`, so `performance.current` was pinned at 1
        for the whole session and the component was a NO-OP: the spec's
        "AdaptiveDpr drops to 0.75" (20_3D §3.1) never happened, and the
        scene ran at full resolution on a device that could not afford it.

        The watchdog below is the same idea, wired to a signal that actually
        moves: drei's `PerformanceMonitor` measures the frame rate and calls
        `onDecline` when the scene is SUSTAINABLY slower than 35 fps (eight of
        its ten 250 ms windows, so a single hitch cannot trip it). On a
        decline the device pixel ratio drops to the ladder's floor - 0.75 for
        everything but a discrete GPU (20_3D §3.1, §11.3).

        THE RATCHET. A decline is one-way. The alternative - restoring the
        resolution when the frame rate recovers - makes the canvas breathe
        between two resolutions every few seconds, which is visible and
        maddening. A scene that was too slow once stays at the resolution it
        can afford.
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
      {/* Frames the live scene exactly the way the 16:9 poster frames it, so
          the veil lift is not a zoom (20_3D §2.2). */}
      <CoverCamera baseFov={55} />
      <Suspense fallback={null}>
        <Journey
          progressRef={progressRef}
          tokens={tokens}
          frozen={frozen}
          lowEnd={lowEnd}
          gpuClass={gpuClass}
        />
        {children}
      </Suspense>
    </Canvas>
  );
}
