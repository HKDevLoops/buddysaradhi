import React from "react";
import { MeshTransmissionMaterial, Edges, Html } from "@react-three/drei";
import { useHeroKPI } from "../hooks/useHeroKPI";
import { formatINR } from "@/lib/utils";

interface LedgerCardProps {
  isLowEnd?: boolean;
}

export function LedgerCard({ isLowEnd = false }: LedgerCardProps) {
  const kpi = useHeroKPI();

  return (
    <mesh rotation={[-0.26, 0.2, 0]} position={[0, 0, 0]}>
      <boxGeometry args={[3.2, 2, 0.12]} />

      <MeshTransmissionMaterial
        transmission={1}
        thickness={0.4}
        roughness={0.06}
        ior={1.25}
        chromaticAberration={0.02}
        backside={false}
        samples={isLowEnd ? 1 : 2}
        resolution={256}
        color="#1a1a3a"
      />

      <Edges scale={1.01} threshold={15}>
        <meshBasicMaterial color="#00F0FF" transparent opacity={0.25} />
      </Edges>

      <Html transform position={[0, 0, 0.07]} center>
        <div className="w-[320px] text-center pointer-events-none select-none">
          <p className="text-[var(--text-primary)] font-medium text-lg leading-relaxed whitespace-nowrap">
            {formatINR(kpi.owed * 100)} owed &middot; {kpi.students} students
          </p>
          <p className="text-[var(--text-primary)] font-medium text-lg leading-relaxed whitespace-nowrap">
            {kpi.ledgers} ledger &middot; 5 screens
          </p>
        </div>
      </Html>
    </mesh>
  );
}
