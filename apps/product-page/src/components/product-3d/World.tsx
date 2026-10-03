// @ts-nocheck
// Implements: 20_3D_Product_Page.md §12 (5-beat open world, code-built set).
// Floor + desk clusters (beats 1-3) + 5 screen cards (beat 4 reveal).
// No external assets: zero GLB/font fetches. Seeded layout (AGENTS.md FM-14).
// docs/design/overhaul-plan.md §4.1: every surface colour is a palette token,
// and the reveal uses the single accent role instead of five retired colours.
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill.
"use client";

import { useMemo } from "react";
import { ContactShadows } from "@react-three/drei";
import type { SceneTokens } from "./hooks";

const SCREEN_CARDS = [
  { label: "Dashboard", x: -3.4 },
  { label: "Students", x: -1.7 },
  { label: "Attendance", x: 0 },
  { label: "Fees", x: 1.7 },
  { label: "Settings", x: 3.4 },
];

interface WorldProps {
  tokens: SceneTokens;
  lowEnd?: boolean;
}

export function World({ tokens, lowEnd = false }: WorldProps) {
  const desks = useMemo(() => {
    const out: { x: number; z: number; r: number; c: string }[] = [];
    let seed = 42;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    // Seeded order, palette colour values: identical layout per palette run.
    const palette = [tokens.inset, tokens.row, tokens.raised, tokens.inset];
    for (let i = 0; i < (lowEnd ? 14 : 26); i++) {
      out.push({
        x: (rand() - 0.5) * 16,
        z: -4 - rand() * 14,
        r: (rand() - 0.5) * 0.9,
        c: palette[i % palette.length],
      });
    }
    return out;
  }, [lowEnd, tokens]);

  return (
    <group>
      {/* Alley floor. The sunken surface, never pure black. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.6, -8]}>
        <planeGeometry args={[40, 30]} />
        <meshStandardMaterial color={tokens.sunken} roughness={0.9} metalness={0} />
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
            <meshStandardMaterial color={tokens.raised} roughness={0.4} metalness={0.2} />
          </mesh>
          <mesh position={[0, 0.55, 0.02]}>
            <boxGeometry args={[1.4, 0.08, 0.02]} />
            <meshBasicMaterial color={tokens.accent} transparent opacity={0.85} />
          </mesh>
        </group>
      ))}

      <ContactShadows position={[0, -1.55, 0]} opacity={0.4} blur={2.5} far={4} />
    </group>
  );
}