// @ts-nocheck
// Implements: 20_3D_Product_Page.md §1 (particle field 200 points, parallax on pointer)
// Lightweight SSR-safe: Points with BufferGeometry, no instanced mesh, bioluminescent palette only.
'use client';

import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export function ParticleField({ count = 200, isFrozen = false }: { count?: number; isFrozen?: boolean }) {
  const pointsRef = useRef<THREE.Points>(null);

  // Spec: 200 points, cosmic parallax. Colors from bioluminescent palette only (emerald/cyan/amber), no indigo.
  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const palette = [new THREE.Color('#00FF9D'), new THREE.Color('#00F0FF'), new THREE.Color('#FFB300')];
    for (let i = 0; i < count; i++) {
      // Sphere distribution radius 6 (spec) — lightweight
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 6 + Math.random() * 2;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      const c = palette[Math.floor(Math.random() * palette.length)]!;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    return { positions: pos, colors: col };
  }, [count]);

  const { pointer } = useThree();

  useFrame((state) => {
    if (!pointsRef.current || isFrozen) return;
    // Lightweight parallax on pointer move (spec) — no per-particle sin, just group rotation
    const t = state.clock.elapsedTime;
    pointsRef.current.rotation.y = THREE.MathUtils.lerp(
      pointsRef.current.rotation.y,
      pointer.x * 0.15 + t * 0.01,
      0.03,
    );
    pointsRef.current.rotation.x = THREE.MathUtils.lerp(
      pointsRef.current.rotation.x,
      -pointer.y * 0.1,
      0.03,
    );
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.025} sizeAttenuation vertexColors transparent opacity={0.85} depthWrite={false} />
    </points>
  );
}
