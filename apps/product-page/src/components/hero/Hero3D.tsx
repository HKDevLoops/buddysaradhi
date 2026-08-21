'use client';

import React, { Suspense, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useWebGLAvailable } from './hooks/useWebGLAvailable';
import { useReducedMotion } from './hooks/useReducedMotion';
import { HeroSkeleton } from './Skeleton';
import { Poster } from './Poster';
import { Topbar } from './story/Topbar';

// SSR-safe: Canvas and 3D only on client, no external HDR fetches (Rule 2), lightweight defaults per 20_3D §6
const Canvas = dynamic(() => import('@react-three/fiber').then((mod) => mod.Canvas), { ssr: false });
const AdaptiveDpr = dynamic(() => import('@react-three/drei').then((mod) => mod.AdaptiveDpr), { ssr: false });
const ParticleField = dynamic(() => import('./scene/ParticleField').then((mod) => mod.ParticleField), { ssr: false });
const StoryScene = dynamic(() => import('./story/StoryScene').then((mod) => mod.StoryScene), { ssr: false });

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
      if (conn?.saveData || conn?.effectiveType === '2g') {
        setIsSaveData(true);
      }
      if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) {
        setIsLowEnd(true);
      }
    }
  }, []);

  // Guarantee readiness within 500ms so content is never stuck hidden
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // Default to showing poster fallback if WebGL is not confirmed true
  const showFallback = isWebGLAvailable !== true || isSaveData || hasCanvasError;

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[var(--bg-cosmic)] text-[var(--text-primary)]">
      {/* Top Navigation Bar - ALWAYS rendered in DOM */}
      <Topbar />

      {/* 3D WebGL Background Layer (when WebGL is confirmed available) */}
      {isWebGLAvailable === true && !hasCanvasError && !isSaveData && (
        <div className="fixed inset-0 w-full h-full z-0" aria-hidden="true">
          <Suspense fallback={<HeroSkeleton />}>
            <Canvas
              gl={{ antialias: true, powerPreference: isLowEnd ? 'low-power' : 'high-performance', alpha: true }}
              dpr={[1, isLowEnd ? 1.2 : 1.5]}
              camera={{ position: [0, 0, 6], fov: 55 }}
              onCreated={() => setIsReady(true)}
              onError={() => setHasCanvasError(true)}
              style={{
                opacity: isReady ? 1 : 0.8,
                transition: 'opacity 0.3s ease-in-out',
                position: 'absolute',
                inset: 0,
              }}
            >
              <color attach="background" args={['#090919']} />
              <fog attach="fog" args={['#0a0a1a', 5, 20]} />
              <AdaptiveDpr pixelated />
              <ParticleField count={isLowEnd ? 80 : 150} isFrozen={isReducedMotion} />
              <StoryScene isLowEnd={isLowEnd} />
            </Canvas>
          </Suspense>
        </div>
      )}

      {/* Fallback visual background when WebGL unavailable or pending */}
      {showFallback && <Poster />}
    </div>
  );
}


