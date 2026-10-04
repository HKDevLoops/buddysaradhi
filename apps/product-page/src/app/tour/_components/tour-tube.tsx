// @ts-nocheck
// Implements: 20_3D_Product_Page.md §12 (the `/tour` code-first set piece).
// The ledger thread: a 48×6 tube running the length of the alley and tying the
// five reveal screens together - the visual answer to "one ledger". Code-first:
// fixed waypoints (no Math.random in the render path, FM-14), palette material
// only (Rule 5 - the accent role, never a literal, never indigo/blue), no
// external assets, no new deps. Geometry is disposed on unmount (§12).
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill (AGENTS.md FM-09).
"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SceneTokens } from "@/components/product-3d/hooks";

// Fixed control points: the thread leaves the hero card, weaves the desk
// clusters (beats 1–3) and lands across the five screen cards (beat 4).
const THREAD_POINTS: Array<[number, number, number]> = [
  [0, 0.4, 2.5],
  [-2.2, 0.9, -0.5],
  [2.1, 0.2, -3.5],
  [-1.8, 1.1, -6.5],
  [1.6, 0.1, -9.5],
  [0, 0.6, -13],
];

interface TourTubeProps {
  tokens: SceneTokens;
  frozen?: boolean;
}

export function TourTube({ tokens, frozen = false }: TourTubeProps) {
  const geometry = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(
      THREAD_POINTS.map((p) => new THREE.Vector3(...p)),
    );
    return new THREE.TubeGeometry(curve, 48, 0.09, 6, false);
  }, []);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // A slow breathing pulse on the emissive channel; frozen holds it flat
  // (Rule 10 - reduced motion never pulses).
  useFrame((state) => {
    if (frozen) return;
    const mat = materialRef.current;
    if (!mat) return;
    mat.emissiveIntensity = 0.55 + Math.sin(state.clock.elapsedTime * 0.8) * 0.15;
  });

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        ref={materialRef}
        color={tokens.accent}
        emissive={tokens.accent}
        emissiveIntensity={0.55}
        roughness={0.35}
        metalness={0.1}
      />
    </mesh>
  );
}
