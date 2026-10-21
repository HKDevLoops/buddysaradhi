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
import { resolveFloatProps } from "./scene-tiers";

interface AccentLightsProps {
  tokens: SceneTokens;
  frozen?: boolean;
}

export function AccentLights({ tokens, frozen = false }: AccentLightsProps) {
  const floatProps = resolveFloatProps(frozen);
  return (
    <group>
      {/*
        A light's COLOUR MULTIPLIES ITS INTENSITY. The key/fill were coloured
        with SURFACE roles (#1C1D20 = 11% grey, #060709 = 2%), so the rig
        emitted ~11% of a white light and the whole scene rendered black
        (measured: the desks, the floor and the reveal screens were
        indistinguishable from the canvas). The rig now uses the palette's own
        LIGHT roles: --text-primary key, --text-muted fill, --text-secondary
        ambient. Same tokens, same discipline (Rule 5), a lit scene.
      */}
      <ambientLight intensity={0.9} color={tokens.ambient} />
      <directionalLight position={[3, 5, 4]} intensity={4.5} color={tokens.key} />
      <directionalLight position={[-3, -2, 2]} intensity={1.4} color={tokens.fill} />
      {/* A cool rim from behind, so the glass card has an edge to refract. */}
      <directionalLight position={[-2, 3, -8]} intensity={2} color={tokens.key} />
      {/* `distance` is a hard cutoff: at 6 units the accent lights died
          before the first row of desks. */}
      <Float {...floatProps}>
        <pointLight position={[2, 1, 2]} intensity={16} distance={16} color={tokens.accent} />
        <pointLight position={[-2, 1, 2]} intensity={10} distance={16} color={tokens.info} />
        <pointLight position={[0, -1.5, 2]} intensity={7} distance={14} color={tokens.warn} />
      </Float>
    </group>
  );
}
