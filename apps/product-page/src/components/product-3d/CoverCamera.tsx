// @ts-nocheck
// Implements: 20_3D_Product_Page.md §2.2 (the Poster veil holds IDENTICAL
// pixels until the first frame) and §3.1 (the poster path).
//
// THE CONTRACT. The poster is a fixed 16:9 image and the visitor's viewport
// is not 16:9. `object-fit: cover` crops the poster, and if the camera kept
// its 55 degree field of view the canvas would show a DIFFERENT slice - and
// lifting the veil would be a visible zoom. `resolveCoverFov` in
// ./scene-tiers holds the geometry and is unit tested; this file is the
// three.js binding for it.
//
// WHY `useLayoutEffect`: the field of view has to be right on the FIRST
// DRAWN FRAME. A layout effect runs before the browser paints, and R3F draws
// in the following animation frame.
//
// NO `Math.random`, NO `Date.now`: the poster is a COMMITTED asset and the
// live canvas must match it frame for frame (AGENTS.md FM-14).

import { useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { resolveCoverFov } from "./scene-tiers";

interface CoverCameraProps {
  /** The camera's resting vertical field of view, in degrees. */
  readonly baseFov?: number;
}

export function CoverCamera({ baseFov = 55 }: CoverCameraProps) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    if (size.width <= 0 || size.height <= 0) return;
    const aspect = size.width / size.height;
    camera.fov = resolveCoverFov(baseFov, aspect);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, baseFov]);

  return null;
}
