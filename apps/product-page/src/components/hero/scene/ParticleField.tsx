import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function ParticleField({ count, isFrozen }: { count: number, isFrozen: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  
  const particles = useMemo(() => {
    const temp = [];
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 20;
      const y = (Math.random() - 0.5) * 20;
      const z = (Math.random() - 0.5) * 10 - 5;
      const speed = Math.random() * 0.02 + 0.01;
      temp.push({ x, y, z, speed });
    }
    return temp;
  }, [count]);
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  useFrame((state) => {
    if (!mesh.current || isFrozen) return;
    
    particles.forEach((particle, i) => {
      // Parallax effect
      const mx = (state.pointer.x * 2);
      const my = (state.pointer.y * 2);
      
      dummy.position.set(
        particle.x + mx * (particle.z + 5) * 0.1,
        particle.y + my * (particle.z + 5) * 0.1,
        particle.z
      );
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });
  
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <circleGeometry args={[0.03, 8]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.3} />
    </instancedMesh>
  );
}
