// @ts-nocheck
// Implements: 20_3D_Product_Page.md §3 (perf) + §7.3 (cosmic bg) + Oddy lesson:
// ACESFilmic tone mapping or the render comes out dark and muddy (FM-12).
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill.
"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr } from "@react-three/drei";
import * as THREE from "three";
import { Journey, type ProgressProxy } from "./Journey";

interface ProductSceneProps {
  progressRef: ProgressProxy;
  frozen?: boolean;
  lowEnd?: boolean;
  inView?: boolean;
  onReady?: () => void;
}

export function ProductScene({
  progressRef,
  frozen = false,
  lowEnd = false,
  inView = true,
  onReady,
}: ProductSceneProps) {
  return (
    <Canvas
      aria-hidden="true"
      dpr={lowEnd ? [0.75, 1] : [1, 1.5]}
      gl={{ antialias: true, powerPreference: lowEnd ? "low-power" : "high-performance" }}
      camera={{ fov: 55, position: [0, 1.2, 6] }}
      frameloop={inView ? "always" : "never"}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.1;
        onReady?.();
      }}
    >
      <color attach="background" args={["#0f0c29"]} />
      <fog attach="fog" args={["#0a0a1a", 8, 18]} />
      <AdaptiveDpr />
      <Suspense fallback={null}>
        <Journey progressRef={progressRef} frozen={frozen} lowEnd={lowEnd} />
      </Suspense>
    </Canvas>
  );
}
