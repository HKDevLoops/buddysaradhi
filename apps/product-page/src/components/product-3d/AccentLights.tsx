// @ts-nocheck
// Implements: 20_3D_Product_Page.md §7.2 (bioluminescent neumorphic dual-light).
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill (AGENTS.md FM-09).
"use client";

import { Float } from "@react-three/drei";

interface AccentLightsProps {
  frozen?: boolean;
}

export function AccentLights({ frozen = false }: AccentLightsProps) {
  const floatProps = frozen
    ? { speed: 0, rotationIntensity: 0, floatIntensity: 0 }
    : { speed: 1.2, rotationIntensity: 0.4, floatIntensity: 1.2 };
  return (
    <group>
      {/* Abyss ambient + neumorphic key/fill (never pure black/white). */}
      <ambientLight intensity={0.15} color="#0a0a1a" />
      <directionalLight position={[3, 5, 4]} intensity={0.6} color="#1a1a3a" />
      <directionalLight position={[-3, -2, 2]} intensity={0.2} color="#0a0a1a" />
      {/* Bioluminescent orbiters. Accent energy stays under ~8% of frame. */}
      <Float {...floatProps}>
        <pointLight position={[2, 1, 2]} intensity={8} distance={6} color="#00FF9D" />
        <pointLight position={[-2, 1, 2]} intensity={6} distance={6} color="#00F0FF" />
        <pointLight position={[0, -1.5, 2]} intensity={4} distance={6} color="#FFB300" />
      </Float>
    </group>
  );
}
