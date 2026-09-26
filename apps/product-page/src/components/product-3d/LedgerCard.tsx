// @ts-nocheck
// Implements: 20_3D_Product_Page.md §7.1 (neumorphic-glass ledger card).
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill (AGENTS.md FM-09).
"use client";

import { Edges, Float, MeshTransmissionMaterial } from "@react-three/drei";

interface LedgerCardProps {
  frozen?: boolean;
}

export function LedgerCard({ frozen = false }: LedgerCardProps) {
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
          color="#1a1a3a"
        />
        <Edges scale={1.01} threshold={15}>
          <meshBasicMaterial color="#00F0FF" transparent opacity={0.25} />
        </Edges>
      </mesh>
    </Float>
  );
}
