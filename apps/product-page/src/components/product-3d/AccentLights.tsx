// @ts-nocheck
// Implements: 20_3D_Product_Page.md §7.2 (dual light rig) restyled onto
// docs/design/overhaul-plan.md §4.1: every colour now comes from the active
// palette. The bioluminescent emerald/cyan/amber trio the overhaul retired is
// gone; the palette's accent role is the only accent, with the info and
// warning roles as the two supporting lights.
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill (AGENTS.md FM-09).
"use client";

import { Float } from "@react-three/drei";
import type { SceneTokens } from "./hooks";

interface AccentLightsProps {
  tokens: SceneTokens;
  frozen?: boolean;
}

export function AccentLights({ tokens, frozen = false }: AccentLightsProps) {
  const floatProps = frozen
    ? { speed: 0, rotationIntensity: 0, floatIntensity: 0 }
    : { speed: 1.2, rotationIntensity: 0.4, floatIntensity: 1.2 };
  return (
    <group>
      {/* Ambient + key/fill are never pure black or pure white (20_3D §7.2). */}
      <ambientLight intensity={0.2} color={tokens.canvas} />
      <directionalLight position={[3, 5, 4]} intensity={0.7} color={tokens.raised} />
      <directionalLight position={[-3, -2, 2]} intensity={0.25} color={tokens.inset} />
      {/* Accent energy stays a small fraction of the frame. */}
      <Float {...floatProps}>
        <pointLight position={[2, 1, 2]} intensity={9} distance={6} color={tokens.accent} />
        <pointLight position={[-2, 1, 2]} intensity={5} distance={6} color={tokens.info} />
        <pointLight position={[0, -1.5, 2]} intensity={4} distance={6} color={tokens.warn} />
      </Float>
    </group>
  );
}
