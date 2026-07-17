"use client";

import React, { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { LedgerCard } from "./scene/LedgerCard";
import { AccentLights } from "./scene/AccentLights";
import { ParticleField } from "./scene/ParticleField";
import { useWebGLAvailable } from "./hooks/useWebGLAvailable";
import { Skeleton } from "./Skeleton";
import { Poster } from "./Poster";

export function Hero3D() {
  const gl = useWebGLAvailable();

  if (gl === null) {
    return <Skeleton />;
  }

  if (gl === false) {
    return <Poster />;
  }

  return (
    <div className="fixed inset-0 z-0 bg-[var(--bg-canvas)] pointer-events-none">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        gl={{ antialias: true, alpha: true, depth: true }}
        dpr={[1, 1.75]}
      >
        <Suspense fallback={null}>
          <AccentLights />
          <ParticleField />
          <LedgerCard />
        </Suspense>
      </Canvas>
    </div>
  );
}
