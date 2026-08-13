// @ts-nocheck
import React from 'react';
import { Float } from '@react-three/drei';

export function AccentLights({ isFrozen }: { isFrozen: boolean }) {
  const speed = isFrozen ? 0 : 1.2;
  const rotationIntensity = isFrozen ? 0 : 0.4;
  const floatIntensity = isFrozen ? 0 : 1.2;

  return (
    <>
      <ambientLight intensity={0.15} color="#0a0a1a" />
      <directionalLight position={[3, 5, 4]} intensity={0.6} color="#1a1a3a" />
      <directionalLight position={[-3, -2, 2]} intensity={0.2} color="#0a0a1a" />
      
      <Float speed={speed} rotationIntensity={rotationIntensity} floatIntensity={floatIntensity}>
        <pointLight position={[2, 1, 2]} intensity={8} color="#00FF9D" distance={6} />
        <pointLight position={[-2, 1, 2]} intensity={6} color="#00F0FF" distance={6} />
        <pointLight position={[0, -1.5, 2]} intensity={4} color="#FFB300" distance={6} />
      </Float>
    </>
  );
}

