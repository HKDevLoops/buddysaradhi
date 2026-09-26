// @ts-nocheck
// Implements: 20_3D_Product_Page.md §12 (5-beat open world, code-built set).
// Floor + desk clusters (beats 1-3) + 5 screen cards (beat 4 reveal).
// No external assets: zero GLB/font fetches. Seeded layout (AGENTS.md FM-14).
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill.
"use client";

import { useMemo } from "react";
import { ContactShadows } from "@react-three/drei";

const SCREEN_CARDS = [
  { label: "Dashboard", color: "#00FF9D", x: -3.4 },
  { label: "Students", color: "#00F0FF", x: -1.7 },
  { label: "Attendance", color: "#FFB300", x: 0 },
  { label: "Fees", color: "#00FF9D", x: 1.7 },
  { label: "Settings", color: "#B388FF", x: 3.4 },
];

interface WorldProps {
  lowEnd?: boolean;
}

export function World({ lowEnd = false }: WorldProps) {
  const desks = useMemo(() => {
    const out: { x: number; z: number; r: number; c: string }[] = [];
    let seed = 42;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const palette = ["#1a1a3a", "#24243e", "#1a1a3a", "#2a2a5a"];
    for (let i = 0; i < (lowEnd ? 14 : 26); i++) {
      out.push({
        x: (rand() - 0.5) * 16,
        z: -4 - rand() * 14,
        r: (rand() - 0.5) * 0.9,
        c: palette[i % palette.length],
      });
    }
    return out;
  }, [lowEnd]);

  return (
    <group>
      {/* Alley floor. Abyss, never pure black. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.6, -8]}>
        <planeGeometry args={[40, 30]} />
        <meshStandardMaterial color="#0a0a1a" roughness={0.9} metalness={0} />
      </mesh>

      {/* Desk clusters. Tuition hallway chaos (beats 1-3). */}
      {desks.map((d, i) => (
        <mesh key={i} position={[d.x, -1.1, d.z]} rotation={[0, d.r, 0]}>
          <boxGeometry args={[1.1, 0.9, 0.7]} />
          <meshStandardMaterial color={d.c} roughness={0.7} metalness={0.1} />
        </mesh>
      ))}

      {/* Reveal. The 5 screens fanned out (beat 4). DOM overlay names them. */}
      {SCREEN_CARDS.map((s) => (
        <group key={s.label} position={[s.x, 0.6, -13]}>
          <mesh>
            <boxGeometry args={[1.4, 0.9, 0.08]} />
            <meshStandardMaterial color="#1a1a3a" roughness={0.4} metalness={0.2} />
          </mesh>
          <mesh position={[0, 0.55, 0.02]}>
            <boxGeometry args={[1.4, 0.08, 0.02]} />
            <meshBasicMaterial color={s.color} transparent opacity={0.85} />
          </mesh>
        </group>
      ))}

      <ContactShadows position={[0, -1.55, 0]} opacity={0.4} blur={2.5} far={4} />
    </group>
  );
}
