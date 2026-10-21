// @ts-nocheck
// Implements: 20_3D_Product_Page.md §7.1 (transmissive ledger card). The card is
// the one place a real transparent material is load bearing: it is the product
// itself, the ledger, floating in the world. Colour follows the active palette
// (docs/design/overhaul-plan.md §4.1) rather than the retired literals.
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill (AGENTS.md FM-09).
"use client";

import { Edges, Float, MeshTransmissionMaterial } from "@react-three/drei";
import type { SceneTokens } from "./hooks";
import { resolveFloatProps, resolveTransmissionSamples } from "./scene-tiers";

interface LedgerCardProps {
  tokens: SceneTokens;
  frozen?: boolean;
  /** Low-end → transmission samples drop to 1 (§7.1 degradation lever). */
  lowEnd?: boolean;
}

export function LedgerCard({ tokens, frozen = false, lowEnd = false }: LedgerCardProps) {
  const floatProps = resolveFloatProps(frozen);
  return (
    <Float
      speed={floatProps.speed}
      rotationIntensity={floatProps.rotationIntensity}
      floatIntensity={floatProps.floatIntensity}
    >
      <mesh rotation={[-0.26, 0.2, 0]} position={[0, 0.4, 0]}>
        <boxGeometry args={[3.2, 2, 0.12]} />
        {/*
          The card is the product, and it rendered as a black rectangle: a
          `transmission={1}` material shows what is BEHIND it, and what was
          behind it was the black alley floor. `attenuationColor` +
          `attenuationDistance` are the physically correct way to tint glass
          (light is absorbed toward the accent colour with depth), and `color`
          moved off the near-black `--surface-row` onto the palette's lightest
          surface role. The spec's own note on this prop is "so it's not
          invisible glass" (20_3D §7.1).
        */}
        <MeshTransmissionMaterial
          transmission={1}
          thickness={0.45}
          roughness={0.08}
          ior={1.25}
          chromaticAberration={0.02}
          backside={false}
          samples={resolveTransmissionSamples(lowEnd)}
          resolution={256}
          color={tokens.key}
          attenuationColor={tokens.accent}
          attenuationDistance={1.4}
        />
        <Edges scale={1.01} threshold={15}>
          <meshBasicMaterial color={tokens.accent} transparent opacity={0.45} />
        </Edges>
      </mesh>
    </Float>
  );
}