// @ts-nocheck
import React, { useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Plane, Html, useScroll, Float, Text } from '@react-three/drei';
import * as THREE from 'three';
import { ScrollBoundVideo } from '../scene/ScrollBoundVideo';

// ----------------------------------------------------------------------
// Phase 2: Narrative Environment (Cloud Studio / Naruko Alley DNA)
// ----------------------------------------------------------------------

// Interactive hovering orb
function GlitchOrb({ position, color, speed = 1 }: { position: [number, number, number], color: string, speed?: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = state.clock.elapsedTime * speed;
      meshRef.current.rotation.y = state.clock.elapsedTime * speed * 1.5;
      
      const targetScale = hovered ? 1.5 : 1;
      meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
    }
  });

  return (
    <Float speed={2} rotationIntensity={1} floatIntensity={2}>
      <mesh 
        ref={meshRef} 
        position={position}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <icosahedronGeometry args={hovered ? [0.6, 2] : [0.5, 0]} />
        <meshStandardMaterial 
          color={color} 
          wireframe={!hovered}
          emissive={color}
          emissiveIntensity={hovered ? 2 : 0.5}
        />
      </mesh>
    </Float>
  );
}

export function StoryScene({ isLowEnd }: { isLowEnd: boolean }) {
  const scroll = useScroll();
  const { camera } = useThree();

  // Define a curved path through the "Tuition Centre"
  const curve = useMemo(() => {
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 5),     // Zone 1: Hook Exterior
      new THREE.Vector3(-5, 0, -10),  // Curve left into hallway
      new THREE.Vector3(5, -2, -25),  // Drop down and right into chaos
      new THREE.Vector3(0, 0, -40),   // Zone 3: The Relief
      new THREE.Vector3(0, 0, -55),   // Zone 4: The Climax (Staffroom)
    ], false, 'chordal', 0.5);
  }, []);

  // Geometry for the stylized tunnel
  const tubeGeom = useMemo(() => {
    return new THREE.TubeGeometry(curve, 64, 4, 8, false);
  }, [curve]);

  // Points along the curve to place objects
  const ptHook = curve.getPointAt(0.1);
  const ptChaos = curve.getPointAt(0.4);
  const ptRelief = curve.getPointAt(0.7);
  const ptClimax = curve.getPointAt(1.0);

  // Hook for scrolling camera animation
  useFrame((state, delta) => {
    // scroll.offset goes from 0 to 1
    const offset = Math.max(0, Math.min(1, scroll.offset));
    
    // Position camera exactly on the curve
    const camPos = curve.getPointAt(offset);
    camera.position.lerp(camPos, 0.1);
    
    // Look slightly ahead on the curve
    const lookAtOffset = Math.min(1, offset + 0.05);
    const lookAtPos = curve.getPointAt(lookAtOffset);
    
    // If we are at the very end (Staffroom), stabilize the look direction
    if (offset > 0.95) {
      lookAtPos.set(0, 0, -60);
    }
    
    camera.lookAt(lookAtPos);
  });

  return (
    <group>
      {/* The Architectural Tunnel */}
      <mesh geometry={tubeGeom}>
        <meshBasicMaterial 
          color="#4F46E5" 
          wireframe 
          transparent 
          opacity={0.05} 
          side={THREE.BackSide} 
        />
      </mesh>

      {/* --- ZONE 1: The Hook (Exterior) --- */}
      <group position={[ptHook.x - 2, ptHook.y + 0.5, ptHook.z - 3]} rotation={[0, 0.4, 0]}>
        <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.5}>
          <Plane args={[4, 2.25]}>
            <meshPhysicalMaterial 
              color="#050510" 
              transmission={0.9} 
              opacity={1} 
              transparent 
              roughness={0.2}
              thickness={2}
              envMapIntensity={1.5}
            />
            {/* The video will overlay the glass if the file exists in /public. It scrubs from scroll 0.0 to 0.4 */}
            <ScrollBoundVideo url="/curious_bastard_hook.mp4" startScroll={0.0} endScroll={0.4} />
            <Html transform distanceFactor={3} position={[0, 0, 0.01]}>
              <div className="w-[800px] h-[450px] bg-black/60 backdrop-blur-xl border border-[var(--accent-cyan)]/30 rounded-2xl flex flex-col items-center justify-center p-8 overflow-hidden relative">
                {/* Video Placeholder Indicator */}
                <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
                  <span className="text-[var(--accent-cyan)] font-mono text-4xl text-center">
                    [ VIDEO ASSET REQUIRED ]<br/>public/curious_bastard_hook.mp4
                  </span>
                </div>
                
                <div className="text-center relative z-10">
                  <div className="text-[var(--accent-cyan)] text-xl font-mono mb-4 animate-pulse px-4 py-1 border border-[var(--accent-cyan)] rounded-full inline-block">REC • VEO FEED ACTIVE</div>
                  <h3 className="text-4xl text-white font-[family-name:var(--font-heading)] font-bold">The Curious Bastard Finds a Tuition</h3>
                  <p className="text-[var(--text-secondary)] mt-4 text-xl">A Veo-generated shōnen cinematic.</p>
                </div>
              </div>
            </Html>
          </Plane>
        </Float>
      </group>

      {/* --- ZONE 2: The Chaos Hallway --- */}
      <group position={[ptChaos.x + 3, ptChaos.y, ptChaos.z - 2]} rotation={[0, -0.5, 0]}>
        <Float speed={2} rotationIntensity={0.5} floatIntensity={1}>
          <Plane args={[5, 2.8]}>
            <meshPhysicalMaterial 
              color="#050510" 
              transmission={0.95} 
              opacity={1} 
              transparent 
              roughness={0.3}
              thickness={3}
              envMapIntensity={2}
            />
            {/* The chaos video scrubs as you move past it from scroll 0.3 to 0.7 */}
            <ScrollBoundVideo url="/chaos_hallway.mp4" startScroll={0.3} endScroll={0.7} />
            <Html transform distanceFactor={3} position={[0, 0, 0.01]}>
              <div className="w-[900px] h-[500px] bg-[var(--accent-emerald)]/5 backdrop-blur-xl border border-[var(--accent-emerald)]/40 rounded-3xl p-8 flex flex-col justify-end overflow-hidden relative shadow-[0_0_50px_rgba(0,255,157,0.05)]">
                {/* Video Placeholder Indicator */}
                <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
                  <span className="text-[var(--accent-emerald)] font-mono text-4xl text-center">
                    [ VIDEO ASSET REQUIRED ]<br/>public/chaos_hallway.mp4
                  </span>
                </div>

                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent z-0" />
                <div className="relative z-10">
                  <span className="px-3 py-1 bg-[var(--accent-emerald)] text-black text-sm font-bold uppercase tracking-widest rounded-full shadow-[0_0_15px_var(--accent-emerald)]">Hallway Cam 04</span>
                  <h3 className="text-5xl text-white font-[family-name:var(--font-heading)] font-bold mt-4 drop-shadow-lg">Chaos ensues.</h3>
                  <p className="text-gray-300 mt-2 text-2xl max-w-2xl drop-shadow-md">Students fighting, teasing, learning. The raw energy of a 200-student batch.</p>
                </div>
              </div>
            </Html>
          </Plane>
        </Float>
      </group>
      
      {/* Interactive Orbs floating in the chaos */}
      <GlitchOrb position={[ptChaos.x - 2, ptChaos.y + 1, ptChaos.z + 2]} color="var(--accent-cyan)" speed={2} />
      <GlitchOrb position={[ptChaos.x - 4, ptChaos.y - 1, ptChaos.z - 1]} color="var(--accent-flare)" speed={1.5} />
      <GlitchOrb position={[ptChaos.x + 1, ptChaos.y + 2, ptChaos.z - 4]} color="var(--accent-amber)" speed={3} />

      {/* --- ZONE 3 & 4: The Relief & Staffroom --- */}
      {/* As we approach the end, the architecture straightens out */}
      <group position={[0, 0, -56]}>
        {/* The pristine glass dashboard (Impeccable style) */}
        <Plane args={[12, 6.75]} position={[0, 0, 0]}>
          <meshPhysicalMaterial 
            color="#020205" 
            transmission={0.8} 
            opacity={1} 
            transparent 
            roughness={0.1}
            thickness={5}
            envMapIntensity={3}
            clearcoat={1}
          />
          <Html transform distanceFactor={4} position={[0, 0, 0.1]} zIndexRange={[100, 0]}>
            <div className="w-[1200px] h-[675px] bg-[var(--bg-cosmic)]/80 backdrop-blur-2xl border border-[var(--border-glass)] rounded-3xl p-10 text-white shadow-[0_30px_100px_rgba(0,240,255,0.1)] flex flex-col relative overflow-hidden">
              
              {/* Decorative glows */}
              <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-[var(--accent-emerald)]/20 blur-[100px] pointer-events-none" />
              <div className="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] rounded-full bg-[var(--accent-violet)]/20 blur-[100px] pointer-events-none" />

              {/* Header */}
              <div className="flex justify-between items-start z-10">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="w-4 h-4 rounded-full bg-[var(--accent-emerald)] shadow-[0_0_15px_var(--accent-emerald)] animate-pulse" />
                    <h2 className="text-4xl font-bold font-[family-name:var(--font-heading)] text-white tracking-tight">BuddySaradhi OS</h2>
                  </div>
                  <p className="text-[var(--text-secondary)] mt-2 text-xl">The Staffroom Terminal. Total control.</p>
                </div>
                <div className="flex gap-4">
                  <div className="px-6 py-2 rounded-full glass-faint border border-[var(--border-glass)] text-[var(--accent-cyan)] font-mono text-lg">
                    SYNC_OUTBOX: 0
                  </div>
                </div>
              </div>

              {/* Bento Grid */}
              <div className="grid grid-cols-4 grid-rows-2 gap-6 flex-grow mt-10 z-10">
                {/* Main Ledger Chart */}
                <div className="col-span-2 row-span-2 glass-strong rounded-2xl border border-[var(--border-glass)] p-8 flex flex-col">
                  <h4 className="text-[var(--text-secondary)] text-lg uppercase tracking-wider font-semibold mb-4">Ledger Activity</h4>
                  <div className="flex-grow flex items-end gap-2">
                    {[40, 70, 45, 90, 65, 100, 80].map((h, i) => (
                      <div key={i} className="flex-1 bg-gradient-to-t from-[var(--accent-emerald)]/20 to-[var(--accent-emerald)] rounded-t-sm" style={{ height: `${h}%` }} />
                    ))}
                  </div>
                </div>

                {/* KPIs */}
                <div className="glass-strong rounded-2xl border border-[var(--border-glass)] p-8 flex flex-col justify-between hover:border-[var(--accent-cyan)]/50 transition-colors cursor-pointer group">
                  <h4 className="text-[var(--text-secondary)] text-lg">Active Students</h4>
                  <div>
                    <span className="text-5xl font-bold text-[var(--text-primary)] group-hover:text-[var(--accent-cyan)] transition-colors">342</span>
                    <div className="text-[var(--accent-emerald)] text-sm mt-2 font-mono">+12 this week</div>
                  </div>
                </div>

                <div className="glass-strong rounded-2xl border border-[var(--border-glass)] p-8 flex flex-col justify-between hover:border-[var(--accent-violet)]/50 transition-colors cursor-pointer group">
                  <h4 className="text-[var(--text-secondary)] text-lg">Unsynced Edits</h4>
                  <div>
                    <span className="text-5xl font-bold text-[var(--text-primary)] group-hover:text-[var(--accent-violet)] transition-colors">0</span>
                    <div className="text-[var(--text-muted)] text-sm mt-2 font-mono">Offline-first active</div>
                  </div>
                </div>

                <div className="col-span-2 glass-strong rounded-2xl border border-[var(--border-glass)] p-8 flex items-center justify-between hover:bg-[var(--surface-glass-strong)] transition-all cursor-pointer">
                  <div>
                    <h4 className="text-2xl font-bold text-[var(--text-primary)]">Ready to take control?</h4>
                    <p className="text-[var(--text-secondary)] text-lg mt-2">Join the waitlist for the tuition-business OS.</p>
                  </div>
                  <button className="px-8 py-4 bg-[var(--accent-emerald)] text-black font-bold text-lg rounded-xl shadow-[0_0_20px_rgba(0,255,157,0.3)] hover:scale-105 transition-transform">
                    Start Free Trial
                  </button>
                </div>
              </div>
            </div>
          </Html>
        </Plane>
      </group>
    </group>
  );
}

