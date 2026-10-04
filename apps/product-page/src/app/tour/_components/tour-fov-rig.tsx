// @ts-nocheck
// Implements: 20_3D_Product_Page.md §12 (shonen FOV whip `55->75->55` on the
// `/tour` route). Scroll velocity pushes the camera FOV toward 75; stillness
// falls back to 55. The easing is `THREE.MathUtils.damp` - already in the
// bundle - so no `maath` and no `anime` dep (zero-dep discipline). Reduced
// motion parks the lens at 55 and never whips (Rule 10).
// R3F + turpopack + TS 7 → ts-nocheck per buddysaradhi-3d skill (AGENTS.md FM-09).
"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ProgressProxy } from "@/components/product-3d/Journey";
import { FOV_REST, resolveFovTarget } from "@/components/product-3d/scene-tiers";

/** Progress-per-second that counts as a full whip. A stop-to-stop fling at
 *  this speed peaks the lens; gentle reading scrolls barely breathe it. */
const WHIP_SPEED = 0.6;

interface TourFovRigProps {
  progressRef: ProgressProxy;
  frozen?: boolean;
}

export function TourFovRig({ progressRef, frozen = false }: TourFovRigProps) {
  const prev = useRef(0);
  const primed = useRef(false);

  // Refs only, no setState in the loop (the Journey pitfall note applies here
  // too). Runs after Journey's own useFrame; it touches only `fov`, never the
  // camera transform, so the two rigs cannot fight.
  useFrame((state, delta) => {
    const cam = state.camera;
    if (frozen) {
      if (cam.fov !== FOV_REST) {
        cam.fov = FOV_REST;
        cam.updateProjectionMatrix();
      }
      prev.current = THREE.MathUtils.clamp(progressRef.current, 0, 1);
      primed.current = true;
      return;
    }
    const curr = THREE.MathUtils.clamp(progressRef.current, 0, 1);
    if (!primed.current) {
      prev.current = curr;
      primed.current = true;
    }
    const dt = Math.max(delta, 1e-3);
    const speed = Math.abs(curr - prev.current) / dt;
    prev.current = curr;
    const target = resolveFovTarget(Math.min(1, speed / WHIP_SPEED));
    const next = THREE.MathUtils.damp(cam.fov, target, 6, delta);
    if (Math.abs(next - cam.fov) > 0.01) {
      cam.fov = next;
      cam.updateProjectionMatrix();
    }
  });

  return null;
}
