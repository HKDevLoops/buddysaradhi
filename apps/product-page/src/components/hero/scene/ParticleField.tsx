// @ts-nocheck
import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll } from '@react-three/drei';
import * as THREE from 'three';

export function ParticleField({ count = 2000, isFrozen = false }: { count?: number, isFrozen?: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const scroll = useScroll();

  // Create two sets of target positions: Chaos and Order
  const { chaosPositions, orderPositions, colors } = useMemo(() => {
    const chaos = new Float32Array(count * 3);
    const order = new Float32Array(count * 3);
    const cols = new Float32Array(count * 3);
    
    const colorA = new THREE.Color('#4F46E5'); // Indigo/Violet (Chaos tint)
    const colorB = new THREE.Color('#00ff9d'); // Emerald (Order tint)
    const tempColor = new THREE.Color();

    const gridSize = Math.ceil(Math.cbrt(count));
    const spacing = 1.5;

    for (let i = 0; i < count; i++) {
      // Chaos: Random points in a wide sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const r = 10 + Math.random() * 40;
      
      chaos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      chaos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      chaos[i * 3 + 2] = r * Math.cos(phi);

      // Order: A perfect 3D grid structure (The OS Architecture)
      const x = (i % gridSize) - gridSize / 2;
      const y = (Math.floor(i / gridSize) % gridSize) - gridSize / 2;
      const z = (Math.floor(i / (gridSize * gridSize))) - gridSize / 2;
      
      // Position the grid down the Z axis where the Staffroom UI is
      order[i * 3] = x * spacing;
      order[i * 3 + 1] = (y * spacing) - 5;
      order[i * 3 + 2] = (z * spacing) - 55;

      // Randomize color slightly between emerald and cyan
      const isChaos = Math.random() > 0.5;
      tempColor.lerpColors(colorA, colorB, Math.random());
      cols[i * 3] = tempColor.r;
      cols[i * 3 + 1] = tempColor.g;
      cols[i * 3 + 2] = tempColor.b;
    }
    return { chaosPositions: chaos, orderPositions: order, colors: cols };
  }, [count]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    if (!meshRef.current || isFrozen) return;

    const time = state.clock.elapsedTime;
    // Map scroll from 0 to 1
    const progress = Math.max(0, Math.min(1, scroll.offset));
    
    // Animate the particles
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      
      // The chaotic position has some sine wave noise added over time
      const cx = chaosPositions[i3] + Math.sin(time * 0.5 + i) * 2;
      const cy = chaosPositions[i3 + 1] + Math.cos(time * 0.3 + i) * 2;
      const cz = chaosPositions[i3 + 2] + Math.sin(time * 0.4 + i) * 2;

      // The ordered position is perfectly still
      const ox = orderPositions[i3];
      const oy = orderPositions[i3 + 1];
      const oz = orderPositions[i3 + 2];

      // Interpolate based on scroll (using smoothstep for dramatic snap)
      // At scroll 0-0.5, Mostly Chaos. At 0.5-0.9, snapping to order.
      const lerpFactor = Math.pow(progress, 3); // ease-in cubic

      dummy.position.x = THREE.MathUtils.lerp(cx, ox, lerpFactor);
      dummy.position.y = THREE.MathUtils.lerp(cy, oy, lerpFactor);
      dummy.position.z = THREE.MathUtils.lerp(cz, oz, lerpFactor);

      // Scale down slightly when in order to look like crisp data nodes
      const targetScale = THREE.MathUtils.lerp(1 + Math.sin(time * 2 + i) * 0.5, 0.3, lerpFactor);
      dummy.scale.set(targetScale, targetScale, targetScale);
      
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    
    // Rotate the entire system slightly based on time and scroll
    meshRef.current.rotation.y = time * 0.05 * (1 - progress);
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      {/* We use an Icosahedron for a more unique, sharp "data" look than a sphere */}
      <icosahedronGeometry args={[0.2, 0]}>
        <instancedBufferAttribute attach="attributes-color" args={[colors, 3]} />
      </icosahedronGeometry>
      <meshStandardMaterial 
        vertexColors 
        emissiveIntensity={2}
        roughness={0.2}
        metalness={0.8}
      />
    </instancedMesh>
  );
}
