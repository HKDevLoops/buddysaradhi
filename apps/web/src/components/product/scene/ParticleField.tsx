import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Points, PointMaterial } from "@react-three/drei";
import * as random from "maath/random";
import { useReducedMotion } from "../hooks/useReducedMotion";

export function ParticleField() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null);
  const sphere = useMemo(
    () =>
      random.inSphere(new Float32Array(1500 * 3), { radius: 6 }) as Float32Array,
    []
  );
  const reducedMotion = useReducedMotion();

  useFrame((_state, delta) => {
    if (!reducedMotion && ref.current) {
      ref.current.rotation.x -= delta / 10;
      ref.current.rotation.y -= delta / 15;
    }
  });

  return (
    <group rotation={[0, 0, Math.PI / 4]}>
      <Points ref={ref} positions={sphere} stride={3} frustumCulled={false}>
        <PointMaterial
          transparent
          color="#00F0FF"
          size={0.012}
          sizeAttenuation
          depthWrite={false}
        />
      </Points>
    </group>
  );
}
