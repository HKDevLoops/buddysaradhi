// @ts-nocheck
'use client';
import React, { Suspense, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useWebGLAvailable } from './hooks/useWebGLAvailable';
import { useReducedMotion } from './hooks/useReducedMotion';
import { HeroSkeleton } from './Skeleton';
import { Poster } from './Poster';
import { Topbar } from './story/Topbar';

const Canvas = dynamic(() => import('@react-three/fiber').then((m) => m.Canvas), { ssr: false });
const AdaptiveDpr = dynamic(() => import('@react-three/drei').then((m) => m.AdaptiveDpr), { ssr: false });
const ScrollControls = dynamic(() => import('@react-three/drei').then((m) => m.ScrollControls), { ssr: false });
const ParticleField = dynamic(() => import('./scene/ParticleField').then((m) => m.ParticleField), { ssr: false });
const StoryScene = dynamic(() => import('./story/StoryScene').then((m) => m.StoryScene), { ssr: false });

export function Hero3D() {
  const isWebGLAvailable = useWebGLAvailable();
  const isReducedMotion = useReducedMotion();
  const [isReady, setIsReady] = useState(false);
  const [isLowEnd, setIsLowEnd] = useState(false);
  const [isSaveData, setIsSaveData] = useState(false);
  const [hasCanvasError, setHasCanvasError] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const conn = (navigator as any).connection;
      if (conn?.saveData || conn?.effectiveType === '2g') setIsSaveData(true);
      const hc = (navigator as any).hardwareConcurrency;
      const concurrency = typeof hc === 'number' ? hc : 8;
      if (concurrency <= 4) setIsLowEnd(true);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setIsReady(true), 500);
    return () => clearTimeout(t);
  }, []);

  const showFallback = isWebGLAvailable !== true || isSaveData || hasCanvasError;

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[var(--bg-cosmic)] text-[var(--text-primary)]">
      <Topbar />
      {isWebGLAvailable === true && !hasCanvasError && !isSaveData && (
        <div className="fixed inset-0 w-full h-[100dvh] z-0" aria-hidden="true">
          <Suspense fallback={<HeroSkeleton />}>
            <Canvas
              gl={{ antialias: !isLowEnd, powerPreference: isLowEnd ? 'low-power' : 'high-performance', alpha: true }}
              dpr={[1, isLowEnd ? 1.2 : 1.5]}
              camera={{ position: [0, 0.6, 5.8], fov: 55 }}
              onCreated={() => setIsReady(true)}
              onError={() => setHasCanvasError(true)}
              style={{ opacity: isReady ? 1 : 0.8, transition: 'opacity 0.3s ease-in-out', position: 'absolute', inset: 0 }}
            >
              <color attach="background" args={['#090919']} />
              <fog attach="fog" args={['#0a0a1a', 5, 20]} />
              <AdaptiveDpr pixelated />
              <ParticleField count={isLowEnd ? 60 : 120} isFrozen={isReducedMotion} />
              <ScrollControls pages={3} damping={0.25} distance={1} enabled={!isReducedMotion}>
                <StoryScene isLowEnd={isLowEnd} />
              </ScrollControls>
            </Canvas>
          </Suspense>
        </div>
      )}
      {showFallback && <Poster />}
      {!showFallback && !isReducedMotion && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-mono tracking-widest text-white/60">
            ↓ scroll or click pin
          </div>
        </div>
      )}
    </div>
  );
}
