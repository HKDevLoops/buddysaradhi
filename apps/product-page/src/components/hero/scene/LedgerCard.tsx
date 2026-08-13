// @ts-nocheck
import React from 'react';
import { MeshTransmissionMaterial, Edges, Html } from '@react-three/drei';
import { glassMaterialConfig } from '../materials/glassMaterial';
import { neumoEdgeConfig } from '../materials/neumoEdgeMaterial';
import { useHeroKPI } from '../hooks/useHeroKPI';

export function LedgerCard({ isLowEnd }: { isLowEnd: boolean }) {
  const kpi = useHeroKPI();
  
  return (
    <mesh rotation={[-0.26, 0.2, 0]} position={[0, 0, 0]}>
      <boxGeometry args={[3.2, 2, 0.12]} />
      <MeshTransmissionMaterial
        {...glassMaterialConfig}
        samples={isLowEnd ? 1 : 4}
      />
      <Edges scale={neumoEdgeConfig.scale} threshold={neumoEdgeConfig.threshold}>
        <meshBasicMaterial 
          color={neumoEdgeConfig.color} 
          transparent={neumoEdgeConfig.transparent} 
          opacity={neumoEdgeConfig.opacity} 
        />
      </Edges>
      <Html transform position={[0, 0, 0.07]} center distanceFactor={1.5} style={{ pointerEvents: 'none' }}>
        <div className="w-[300px] text-center font-[family-name:var(--font-heading)] select-none">
          <div className="text-xl font-bold tracking-tight text-white/95">
            {kpi.owed} owed &middot; {kpi.students} students
          </div>
          <div className="text-sm font-medium text-white/70 mt-1">
            {kpi.ledgers} ledger &middot; {kpi.screens} screens
          </div>
        </div>
      </Html>
    </mesh>
  );
}

