// @ts-nocheck
// Implements: 20_3D_Product_Page.md §7.1 (transmissive ledger card). The card is
// the one place a real transparent material is load bearing: it is the product
// itself, the ledger, floating in the world. Colour follows the active palette
// (docs/design/overhaul-plan.md §4.1) rather than the retired literals.
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill (AGENTS.md FM-09).
"use client";

import { Edges, Float, MeshTransmissionMaterial } from "@react-three/drei";
import type { SceneTokens } from "./hooks";

interface LedgerCardProps {
  tokens: SceneTokens;
  frozen?: boolean;
}

export function LedgerCard({ tokens, frozen = false }: LedgerCardProps) {
  return (
    <Float
      speed={frozen ? 0 : 1.2}
      rotationIntensity={frozen ? 0 : 0.4}
      floatIntensity={frozen ? 0 : 1.2}
    >
      <mesh rotation={[-0.26, 0.2, 0]} position={[0, 0.4, 0]}>
        <boxGeometry args={[3.2, 2, 0.12]} />
        <MeshTransmissionMaterial
          transmission={1}
          thickness={0.4}
          roughness={0.06}
          ior={1.25}
          chromaticAberration={0.02}
          backside={false}
          samples={1}
          resolution={256}
          color={tokens.row}
        />
        <Edges scale={1.01} threshold={15}>
          <meshBasicMaterial color={tokens.accent} transparent opacity={0.3} />
        </Edges>
      </mesh>
    </Float>
  );
}