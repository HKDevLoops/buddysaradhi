'use client';

import React, { Suspense, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useWebGLAvailable } from './hooks/useWebGLAvailable';
import { useReducedMotion } from './hooks/useReducedMotion';
import { HeroSkeleton } from './Skeleton';
import { Poster } from './Poster';

const Canvas = dynamic(() => import('@react-three/fiber').then(mod => mod.Canvas), { ssr: false });
const AdaptiveDpr = dynamic(() => import('@react-three/drei').then(mod => mod.AdaptiveDpr), { ssr: false });
const Environment = dynamic(() => import('@react-three/drei').then(mod => mod.Environment), { ssr: false });

const LedgerCard = dynamic(() => import('./scene/LedgerCard').then(mod => mod.LedgerCard), { ssr: false });
const AccentLights = dynamic(() => import('./scene/AccentLights').then(mod => mod.AccentLights), { ssr: false });
const ParticleField = dynamic(() => import('./scene/ParticleField').then(mod => mod.ParticleField), { ssr: false });
const ContactShadow = dynamic(() => import('./scene/ContactShadow').then(mod => mod.ContactShadow), { ssr: false });

export function Hero3D() {
  const isWebGLAvailable = useWebGLAvailable();
  const isReducedMotion = useReducedMotion();
  const [isReady, setIsReady] = useState(false);
  const [isLowEnd, setIsLowEnd] = useState(false);
  const [isSaveData, setIsSaveData] = useState(false);
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const conn = (navigator as any).connection;
      if (conn?.saveData || conn?.effectiveType === '2g') {
        setIsSaveData(true);
      }
      if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) {
        setIsLowEnd(true);
      }
    }
  }, []);

  if (isWebGLAvailable === false || isSaveData) {
    return <Poster />;
  }

  return (
    <div className="absolute inset-0 w-full h-full" style={{ zIndex: 0 }} aria-hidden="true">
      {(!isReady || isWebGLAvailable === null) && <HeroSkeleton />}
      
      {isWebGLAvailable && (
        <Suspense fallback={null}>
          <Canvas
            gl={{ antialias: true, powerPreference: "high-performance" }}
            dpr={[0.75, isLowEnd ? 1.5 : 2]}
            onCreated={() => setIsReady(true)}
            style={{ opacity: isReady ? 1 : 0, transition: 'opacity 0.3s ease-in-out', position: 'absolute', inset: 0 }}
          >
            <color attach="background" args={["transparent"]} />
            <fog attach="fog" args={["#0a0a1a", 6, 14]} />
            
            <AdaptiveDpr pixelated />
            <Environment preset="city" />
            
            <AccentLights isFrozen={isReducedMotion} />
            <ParticleField count={isLowEnd ? 80 : 200} isFrozen={isReducedMotion} />
            <LedgerCard isLowEnd={isLowEnd} />
            <ContactShadow />
          </Canvas>
        </Suspense>
      )}
    </div>
  );
}
