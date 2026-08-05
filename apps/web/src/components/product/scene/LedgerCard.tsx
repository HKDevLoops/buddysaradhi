import React, { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshTransmissionMaterial, Edges, Html, Float } from "@react-three/drei";
import { useHeroKPI } from "../hooks/useHeroKPI";
import { formatINR } from "@/lib/utils";
import * as THREE from "three";

interface LedgerCardProps {
  isLowEnd?: boolean;
}

export function LedgerCard({ isLowEnd = false }: LedgerCardProps) {
  const kpi = useHeroKPI();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meshRef = useRef<any>(null);

  useFrame((state) => {
    if (meshRef.current) {
      // Smooth pointer-following rotation tilt
      const targetX = (state.pointer.y * 0.2) - 0.2;
      const targetY = (state.pointer.x * 0.25) + 0.15;
      meshRef.current.rotation.x = THREE.MathUtils.lerp(meshRef.current.rotation.x, targetX, 0.05);
      meshRef.current.rotation.y = THREE.MathUtils.lerp(meshRef.current.rotation.y, targetY, 0.05);
    }
  });

  return (
    <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.8}>
      <mesh ref={meshRef} rotation={[-0.2, 0.15, 0]} position={[0, 0.2, 0]}>
        <boxGeometry args={[4.2, 2.6, 0.14]} />

        <MeshTransmissionMaterial
          transmission={0.98}
          thickness={0.45}
          roughness={0.08}
          ior={1.25}
          chromaticAberration={0.03}
          backside={false}
          samples={isLowEnd ? 1 : 2}
          resolution={256}
          color="#121528"
        />

        <Edges scale={1.008} threshold={15}>
          <meshBasicMaterial color="#00F0FF" transparent opacity={0.35} />
        </Edges>

        <Html transform position={[0, 0, 0.08]} center scale={0.9}>
          <div className="w-[380px] p-6 rounded-2xl bg-[#0A0D1A]/80 backdrop-blur-xl border border-white/10 text-left pointer-events-none select-none shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-[var(--accent-emerald)] font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--accent-emerald)] animate-pulse" />
                Tuition OS &middot; Offline Sovereign
              </span>
              <span className="text-[10px] text-gray-400 font-mono bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                5 Screens
              </span>
            </div>

            <div>
              <h3 className="text-xl font-bold text-white tracking-tight">
                Built for Relentless Tutors
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Zero server friction. Instant billing &amp; roster management.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
                <span className="text-[10px] text-gray-400 uppercase font-medium">Pending Dues</span>
                <p className="text-sm font-semibold text-[var(--accent-flare)] mt-0.5">
                  {formatINR(kpi.owed)}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
                <span className="text-[10px] text-gray-400 uppercase font-medium">Active Roster</span>
                <p className="text-sm font-semibold text-[var(--accent-cyan)] mt-0.5">
                  {kpi.students} Students
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-gray-300 pt-1 border-t border-white/5">
              <span className="flex items-center gap-1 text-[var(--accent-emerald)]">
                ✓ 1-Click WhatsApp Receipts
              </span>
              <span className="text-[10px] text-gray-500 font-mono">
                Paise Precision
              </span>
            </div>
          </div>
        </Html>
      </mesh>
    </Float>
  );
}
