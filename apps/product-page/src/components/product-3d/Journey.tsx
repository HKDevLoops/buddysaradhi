// @ts-nocheck
// Implements: 20_3D_Product_Page.md §12 (camera waypoints, 5 beats) + scrub proxy
// (sticky stage → damped CatmullRom path). R3F auto-handles resize (FM-18 notes).
// docs/design/overhaul-plan.md §4.1: the palette is threaded through instead of
// hardcoded colours.
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill.
"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { AccentLights } from "./AccentLights";
import { LedgerCard } from "./LedgerCard";
import { ParticleField } from "./ParticleField";
import { World } from "./World";
import { resolveParticleCount } from "./scene-tiers";
import type { SceneTokens } from "./hooks";

export interface ProgressProxy {
  current: number;
}

interface JourneyProps {
  progressRef: ProgressProxy;
  tokens: SceneTokens;
  frozen?: boolean;
  lowEnd?: boolean;
}

// 5 waypoints. Hook, Exploration, Relief, Climax, Reveal.
const WAYPOINTS: Array<[number, number, number]> = [
  [0, 1.2, 6],
  [-3.4, 1.6, 2.5],
  [3.2, 1.1, -1.5],
  [0, 1.8, -5.5],
  [0, 1.4, -8.5],
];

const TARGETS: Array<[number, number, number]> = [
  [0, 0.4, 0],
  [-1.5, 0, -3],
  [1.5, -0.2, -6],
  [0, 0.4, -9],
  [0, 0.6, -13],
];

export function Journey({ progressRef, tokens, frozen = false, lowEnd = false }: JourneyProps) {
  const curve = useMemo(
    () => new THREE.CatmullRomCurve3(WAYPOINTS.map((w) => new THREE.Vector3(...w))),
    [],
  );
  const targetCurve = useMemo(
    () => new THREE.CatmullRomCurve3(TARGETS.map((t) => new THREE.Vector3(...t))),
    [],
  );
  const smooth = useRef(0);

  // No setState in the loop (research pitfall). Refs only.
  useFrame((state, delta) => {
    const goal = frozen ? 0 : THREE.MathUtils.clamp(progressRef.current, 0, 1);
    smooth.current = THREE.MathUtils.damp(smooth.current, goal, 4, delta);
    const t = THREE.MathUtils.clamp(smooth.current, 0, 1);
    state.camera.position.copy(curve.getPoint(t));
    state.camera.lookAt(targetCurve.getPoint(t));
  });

  return (
    <group>
      <AccentLights tokens={tokens} frozen={frozen} />
      <ParticleField tokens={tokens} count={resolveParticleCount(lowEnd)} frozen={frozen} />
      <LedgerCard tokens={tokens} frozen={frozen} lowEnd={lowEnd} />
      <World tokens={tokens} lowEnd={lowEnd} />
    </group>
  );
}