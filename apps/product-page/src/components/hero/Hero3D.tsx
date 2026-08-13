// @ts-nocheck
'use client';

import React, { Suspense, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useWebGLAvailable } from './hooks/useWebGLAvailable';
import { useReducedMotion } from './hooks/useReducedMotion';
import { HeroSkeleton } from './Skeleton';
import { Poster } from './Poster';

import { ScrollControls, Scroll } from '@react-three/drei';
import { EffectComposer, Bloom, ChromaticAberration, Noise } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import { StoryScene } from './story/StoryScene';
import { Topbar } from './story/Topbar'; // We'll create this or just inline it

const Canvas = dynamic(() => import('@react-three/fiber').then(mod => mod.Canvas), { ssr: false });
const AdaptiveDpr = dynamic(() => import('@react-three/drei').then(mod => mod.AdaptiveDpr), { ssr: false });
const Environment = dynamic(() => import('@react-three/drei').then(mod => mod.Environment), { ssr: false });
const ParticleField = dynamic(() => import('./scene/ParticleField').then(mod => mod.ParticleField), { ssr: false });

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
    <div className="absolute inset-0 w-full h-full bg-[var(--bg-cosmic)]" style={{ zIndex: 0 }} aria-hidden="true">
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
            <fog attach="fog" args={["#0a0a1a", 5, 20]} />
            
            <AdaptiveDpr pixelated />
            <Environment preset="city" />
            
            <EffectComposer disableNormalPass>
              <Bloom 
                luminanceThreshold={0.2} 
                mipmapBlur 
                intensity={1.2} 
              />
              <ChromaticAberration 
                blendFunction={BlendFunction.NORMAL}
                offset={new THREE.Vector2(0.002, 0.002)}
              />
              <Noise opacity={0.02} />
            </EffectComposer>
            
            <ScrollControls pages={5} damping={0.2}>
              {/* 3D Scene Layer */}
              <Scroll>
                <ParticleField count={isLowEnd ? 80 : 200} isFrozen={isReducedMotion} />
                <StoryScene isLowEnd={isLowEnd} />
              </Scroll>
              
              {/* HTML Overlay Layer synced with scroll */}
              <Scroll html style={{ width: '100vw', height: '100vh' }}>
                <Topbar />
                
                {/* Zone 1 HTML */}
                <div className="absolute top-[15vh] left-[10vw] max-w-md pointer-events-none">
                  <h1 className="font-[family-name:var(--font-heading)] text-5xl md:text-7xl font-semibold tracking-tight gradient-text leading-[1.05]">
                    Discover the ultimate OS.
                  </h1>
                  <p className="mt-6 text-[var(--text-secondary)] text-lg glass-faint rounded-2xl p-4">
                    Scroll down to join our curious nerd on a journey through the modern tuition centre.
                  </p>
                </div>

                {/* Zone 2 HTML */}
                <div className="absolute top-[120vh] right-[10vw] max-w-md pointer-events-none text-right">
                  <h2 className="font-[family-name:var(--font-heading)] text-4xl font-bold text-[var(--accent-cyan)]">
                    Vibrant & Dynamic
                  </h2>
                  <p className="mt-4 text-[var(--text-secondary)] text-lg">
                    Tutors handle chaos effortlessly. From tracking attendance to managing daily operations.
                  </p>
                </div>

                {/* Zone 3 HTML */}
                <div className="absolute top-[240vh] left-[10vw] max-w-md pointer-events-none">
                  <h2 className="font-[family-name:var(--font-heading)] text-4xl font-bold text-[var(--accent-emerald)]">
                    Relief from chaos.
                  </h2>
                  <p className="mt-4 text-[var(--text-secondary)] text-lg">
                    Everything just works. No missing receipts. No lost attendance logs.
                  </p>
                </div>

                {/* Zone 4 HTML */}
                <div className="absolute top-[350vh] w-full flex justify-center pointer-events-none">
                  <div className="text-center">
                    <h2 className="font-[family-name:var(--font-heading)] text-5xl font-bold text-white mb-6 drop-shadow-[0_0_15px_rgba(0,240,255,0.5)]">
                      Welcome to the Staffroom.
                    </h2>
                    <a
                      href="/signup"
                      style={{ pointerEvents: 'auto' }}
                      className="inline-flex min-h-[52px] px-10 items-center justify-center rounded-xl bg-[var(--accent-emerald)] text-[var(--text-on-accent)] font-bold text-lg no-underline shadow-[0_8px_32px_rgba(0,255,157,0.4)] hover:brightness-110 active:translate-y-[1px] transition-all"
                    >
                      Start Free Today
                    </a>
                  </div>
                </div>
              </Scroll>
            </ScrollControls>
          </Canvas>
        </Suspense>
      )}
    </div>
  );
}

