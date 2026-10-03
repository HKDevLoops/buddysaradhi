// @ts-nocheck
// Implements: 20_3D_Product_Page.md §1 (particle field).
// docs/design/overhaul-plan.md §4.1: particles take the palette accent instead
// of the retired cyan literal, so the scene follows whichever palette is live.
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill (AGENTS.md FM-09).
"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SceneTokens } from "./hooks";

interface ParticleFieldProps {
  tokens: SceneTokens;
  count?: number;
  frozen?: boolean;
}

export function ParticleField({ tokens, count = 200, frozen = false }: ParticleFieldProps) {
  const ref = useRef<THREE.Points>(null);
  const pointer = useRef({ x: 0, y: 0 });

  // Seeded layout (FM-14): identical geometry on server and client.
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    let seed = 1234567;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (rand() - 0.5) * 14;
      arr[i * 3 + 1] = (rand() - 0.5) * 9;
      arr[i * 3 + 2] = -2 - rand() * 8;
    }
    return arr;
  }, [count]);

  useFrame((state, delta) => {
    const pts = ref.current;
    if (!pts || frozen) return;
    pointer.current.x += ((state.pointer.x ?? 0) - pointer.current.x) * Math.min(1, delta * 2);
    pointer.current.y += ((state.pointer.y ?? 0) - pointer.current.y) * Math.min(1, delta * 2);
    pts.rotation.y = pointer.current.x * 0.12;
    pts.rotation.x = -pointer.current.y * 0.08;
    pts.position.y = Math.sin(state.clock.elapsedTime * 0.15) * 0.15;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.035}
        color={tokens.accent}
        transparent
        opacity={0.4}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}