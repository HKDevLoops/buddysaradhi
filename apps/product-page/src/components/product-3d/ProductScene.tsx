// @ts-nocheck
// Implements: 20_3D_Product_Page.md §3 (perf) + §7.3 (canvas) + Oddy lesson:
// ACESFilmic tone mapping or the render comes out dark and muddy (FM-12).
// docs/design/overhaul-plan.md §4.1: the background and fog now come from the
// ACTIVE palette (--canvas / --surface-sunken) instead of the retired cosmic
// indigo literals.
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill.
"use client";

import { Suspense } from "react";
import type { ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr } from "@react-three/drei";
import * as THREE from "three";
import { Journey, type ProgressProxy } from "./Journey";
import type { SceneTokens } from "./hooks";
import { resolveDpr } from "./scene-tiers";

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
  return (
    <Canvas
      aria-hidden="true"
      dpr={resolveDpr(lowEnd, wide)}
      gl={{ antialias: true, powerPreference: lowEnd ? "low-power" : "high-performance" }}
      camera={{ fov: 55, position: [0, 1.2, 6] }}
      frameloop={inView ? "always" : "never"}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.1;
        onReady?.();
      }}
    >
      <color attach="background" args={[tokens.canvas]} />
      <fog attach="fog" args={[tokens.sunken, 8, 18]} />
      <AdaptiveDpr />
      <Suspense fallback={null}>
        <Journey progressRef={progressRef} tokens={tokens} frozen={frozen} lowEnd={lowEnd} />
        {children}
      </Suspense>
    </Canvas>
  );
}
