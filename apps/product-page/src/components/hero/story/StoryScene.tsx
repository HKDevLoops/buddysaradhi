// @ts-nocheck
import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Plane, Html, useScroll, Float } from '@react-three/drei';
import * as THREE from 'three';
import { ScrollBoundAnime } from './ScrollBoundAnime';
import { LedgerCard } from '../scene/LedgerCard';
import { AccentLights } from '../scene/AccentLights';

function GlitchOrb({ position, color, speed = 1 }: { position: [number, number, number]; color: string; speed?: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = state.clock.elapsedTime * speed;
      meshRef.current.rotation.y = state.clock.elapsedTime * speed * 1.5;
      const s = hovered ? 1.5 : 1;
      meshRef.current.scale.lerp(new THREE.Vector3(s, s, s), 0.1);
    }
  });
  return (
    <Float speed={2} rotationIntensity={1} floatIntensity={2}>
      <mesh ref={meshRef} position={position} onPointerOver={() => setHovered(true)} onPointerOut={() => setHovered(false)}>
        <icosahedronGeometry args={hovered ? [0.6, 2] : [0.5, 0]} />
        <meshStandardMaterial color={color} wireframe={!hovered} emissive={color} emissiveIntensity={hovered ? 2 : 0.5} />
      </mesh>
    </Float>
  );
}

function SpeedLines({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <Plane args={[6, 3]} position={[0, 0, 0.4]}>
      <meshBasicMaterial color="#ffffff" transparent opacity={0.06} wireframe />
    </Plane>
  );
}

function Pin({ label, position, onClick }: { label: string; position: [number, number, number]; onClick: () => void }) {
  return (
    <group position={position}>
      <Html center distanceFactor={6} position={[0, 0, 0]}>
        <button onClick={onClick} className="px-2 py-1 rounded-full bg-white/5 border border-white/15 text-[10px] font-mono tracking-widest text-white/70 hover:bg-white/10 hover:text-white transition-colors whitespace-nowrap">
          {label}
        </button>
      </Html>
      <mesh position={[0, -0.25, 0]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshStandardMaterial color="#00F0FF" emissive="#00F0FF" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

export function StoryScene({ isLowEnd }: { isLowEnd: boolean }) {
  const scroll = useScroll();
  const { camera } = useThree();
  const [targetOffset, setTargetOffset] = useState<number | null>(null);
  const camFovRef = useRef(55);

  const curve = useMemo(
    () =>
      new THREE.CatmullRomCurve3(
        [new THREE.Vector3(0, 0.6, 5), new THREE.Vector3(0, 0.2, -2), new THREE.Vector3(0, -0.4, -14), new THREE.Vector3(0, 0, -28), new THREE.Vector3(0, 0, -42)],
        false,
        'chordal',
        0.5
      ),
    []
  );

  const tubeGeom = useMemo(() => {
    if (isLowEnd) return null;
    return new THREE.TubeGeometry(curve, 48, 4, 6, false);
  }, [curve, isLowEnd]);

  useEffect(() => {
    return () => {
      if (tubeGeom) tubeGeom.dispose();
    };
  }, [tubeGeom]);

  const ptHook = curve.getPointAt(0.1);
  const ptChaos = curve.getPointAt(0.4);
  const ptMid = curve.getPointAt(0.5);
  const ptRelief = curve.getPointAt(0.65);
  const ptClimax = curve.getPointAt(0.8);

  const isChaosPunch = (() => {
    const o = scroll ? scroll.offset : 0;
    return o > 0.30 && o < 0.55;
  })();

  useFrame((state) => {
    let offset: number;
    if (targetOffset !== null) {
      const cur = scroll ? scroll.offset : 0;
      offset = THREE.MathUtils.lerp(cur, targetOffset, 0.06);
      if (Math.abs(offset - targetOffset) < 0.005) setTargetOffset(null);
    } else {
      if (!scroll) {
        camera.position.set(0, 0.6, 5.8);
        camera.lookAt(0, 0, 0);
        return;
      }
      offset = Math.max(0, Math.min(1, scroll.offset));
    }
    const camPos = curve.getPointAt(offset);
    camera.position.lerp(camPos, 0.09);
    const lookAtPos = curve.getPointAt(Math.min(1, offset + 0.06));
    camera.lookAt(lookAtPos.x * 0.5, lookAtPos.y * 0.5, lookAtPos.z);

    const targetFov = offset > 0.30 && offset < 0.42 ? 75 : 55;
    camFovRef.current = THREE.MathUtils.damp(camFovRef.current, targetFov, 8, state.clock.getDelta());
    if ((camera as any).fov !== undefined) {
      (camera as any).fov = camFovRef.current;
      (camera as any).updateProjectionMatrix();
    }
  });

  if (isLowEnd) return <group />;

  const flyTo = (o: number) => setTargetOffset(o);

  return (
    <group>
      {tubeGeom && (
        <mesh geometry={tubeGeom}>
          <meshBasicMaterial color="#00F0FF" wireframe transparent opacity={0.05} side={THREE.BackSide} />
        </mesh>
      )}

      {/* LedgerCard diorama center at pt 0.5 */}
      <group position={[ptMid.x, ptMid.y, ptMid.z]}>
        <Float speed={1.2} rotationIntensity={0.2} floatIntensity={0.4}>
          <LedgerCard isLowEnd={isLowEnd} />
        </Float>
        <AccentLights isFrozen={false} />
      </group>

      <Pin label="01 — THE HOOK" position={[ptHook.x, ptHook.y + 1.2, ptHook.z]} onClick={() => flyTo(0.05)} />
      <Pin label="02 — CHAOS" position={[ptChaos.x, ptChaos.y + 1.2, ptChaos.z]} onClick={() => flyTo(0.38)} />
      <Pin label="03 — RELIEF" position={[ptRelief.x, ptRelief.y + 1.0, ptRelief.z]} onClick={() => flyTo(0.62)} />
      <Pin label="04 — STAFFROOM" position={[ptClimax.x, ptClimax.y + 1.2, ptClimax.z]} onClick={() => flyTo(0.78)} />
      <Pin label="05 — REVEAL" position={[0, 0.9, -38]} onClick={() => flyTo(0.92)} />

      {/* ZONE 1 hook */}
      <group position={[0, 0.3, 0.5]}>
        <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.5}>
          <Plane args={[4, 2.25]}>
            <meshPhysicalMaterial color="#050510" transmission={0.9} roughness={0.2} thickness={2} envMapIntensity={1.2} transparent opacity={1} />
            <ScrollBoundAnime sceneId="hook" startScroll={0.0} endScroll={0.25} />
            <Html transform distanceFactor={3} position={[0, 0, 0.01]}>
              <div className="w-[92vw] max-w-[560px] bg-black/40 border border-[var(--accent-cyan)]/20 rounded-2xl flex flex-col items-center justify-end p-6 overflow-hidden">
                <div className="text-[var(--accent-cyan)] text-xs font-mono tracking-widest border border-[var(--accent-cyan)]/30 rounded px-2 py-1">CHAPTER 01 — THE HOOK</div>
                <h3 className="text-xl text-white font-bold mt-3 text-center">A curious seeker finds a tuition</h3>
                <p className="text-white/60 text-sm mt-2 text-center">phone in hand, looking for the right place</p>
              </div>
            </Html>
          </Plane>
        </Float>
      </group>

      {/* ZONE 2 chaos */}
      <group position={[0, 0, -9]}>
        <Float speed={2} rotationIntensity={0.4} floatIntensity={0.8}>
          <Plane args={[5, 2.8]}>
            <meshPhysicalMaterial color="#050510" transmission={0.95} roughness={0.3} thickness={3} envMapIntensity={1.6} transparent opacity={1} />
            <ScrollBoundAnime sceneId="chaos" startScroll={0.25} endScroll={0.55} />
            <SpeedLines visible={isChaosPunch} />
            <Html transform distanceFactor={3} position={[0, 0, 0.01]}>
              <div className="w-[92vw] max-w-[640px] bg-[var(--accent-emerald)]/5 border border-[var(--accent-emerald)]/30 rounded-2xl p-6 flex flex-col justify-end">
                <span className="px-2 py-1 bg-[var(--accent-emerald)] text-black text-xs font-bold uppercase tracking-widest rounded self-start">CHAPTER 02 — HALLWAY CHAOS</span>
                <h3 className="text-2xl text-white font-bold mt-3">Fighting · teasing · supporting</h3>
                <p className="text-white/60 text-sm mt-1">learning, competing, laughing — the life of a tuition centre</p>
              </div>
            </Html>
          </Plane>
        </Float>
      </group>

      <GlitchOrb position={[ptChaos.x - 2, ptChaos.y + 1, ptChaos.z + 1]} color="#00F0FF" speed={2} />
      <GlitchOrb position={[ptChaos.x + 2, ptChaos.y - 0.5, ptChaos.z - 1]} color="#FF5E00" speed={1.5} />
      <GlitchOrb position={[ptChaos.x, ptChaos.y + 1.5, ptChaos.z - 3]} color="#FFB300" speed={2.5} />

      {/* ZONE 3 relief */}
      <group position={[ptRelief.x, ptRelief.y, ptRelief.z]}>
        <Plane args={[4.2, 2.2]}>
          <meshPhysicalMaterial color="#050510" transmission={0.9} roughness={0.25} thickness={2.5} transparent opacity={1} />
          <ScrollBoundAnime sceneId="relief" startScroll={0.55} endScroll={0.70} />
          <Html transform distanceFactor={4} position={[0, 0, 0.02]}>
            <div className="w-[92vw] max-w-[520px] bg-white/[0.03] border border-white/10 rounded-2xl p-6 text-center">
              <div className="text-xs font-mono tracking-widest text-white/50">CHAPTER 03 — RELIEF</div>
              <h3 className="text-xl text-white font-bold mt-2">Doubts cleared — breathes easy</h3>
              <p className="text-white/50 text-sm mt-1">a nod — this is the right place</p>
            </div>
          </Html>
        </Plane>
      </group>

      {/* ZONE 4 staffroom climax */}
      <group position={[ptClimax.x, ptClimax.y, ptClimax.z]}>
        <Plane args={[5.5, 3.0]}>
          <meshPhysicalMaterial color="#050510" transmission={0.9} roughness={0.2} thickness={3} transparent opacity={1} />
          <ScrollBoundAnime sceneId="climax" startScroll={0.70} endScroll={0.85} />
          <Html transform distanceFactor={4} position={[0, 0, 0.02]}>
            <div className="w-[92vw] max-w-[620px] bg-[var(--bg-cosmic)]/60 border border-white/10 rounded-2xl p-6 text-center">
              <div className="text-xs font-mono tracking-widest text-white/50">CHAPTER 04 — STAFFROOM</div>
              <h3 className="text-xl text-white font-bold mt-2">Every tutor on BuddySaradhi</h3>
              <p className="text-white/50 text-sm mt-1">the secret behind the centre&apos;s seamless operation</p>
            </div>
          </Html>
        </Plane>
      </group>

      {/* ZONE 5 reveal — near -38, includes 5 screens */}
      <group position={[0, 0, -38]}>
        <Plane args={[6.5, 3.6]}>
          <meshPhysicalMaterial color="#020205" transmission={0.8} roughness={0.12} thickness={4} envMapIntensity={2} transparent opacity={1} />
          <ScrollBoundAnime sceneId="reveal" startScroll={0.85} endScroll={1.0} />
          <Html transform distanceFactor={5} position={[0, 0, 0.03]}>
            <div className="w-[92vw] max-w-[720px] bg-white/[0.04] border border-white/10 rounded-2xl p-6 text-center">
              <div className="text-xs font-mono tracking-widest text-white/50">CHAPTER 05 — REVEAL</div>
              <h3 className="text-xl text-white font-bold mt-2">Zoom into 5 screens</h3>
              <p className="text-white/50 text-sm mt-1">Dashboard · Students · Attendance · Fees · Settings — transparent, offline, yours</p>
            </div>
          </Html>
        </Plane>
      </group>

      {/* Bento far plane kept but pushed to -56 as ambient background, not story */}
      <group position={[0, 0, -56]}>
        <Plane args={[10, 5.6]} position={[0, 0, 0]}>
          <meshPhysicalMaterial color="#020205" transmission={0.75} roughness={0.12} thickness={5} envMapIntensity={2} transparent opacity={0.9} />
          <Html transform distanceFactor={6} position={[0, 0, 0.05]} zIndexRange={[10, 0]}>
            <div className="w-[900px] h-[480px] bg-[var(--bg-cosmic)]/70 border border-white/10 rounded-3xl p-8 text-white flex flex-col relative overflow-hidden opacity-90">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-[var(--accent-emerald)]" />
                    <span className="text-lg font-bold tracking-tight">BuddySaradhi OS</span>
                  </div>
                  <p className="text-white/50 text-sm mt-1">Staffroom Terminal · Total control</p>
                </div>
                <div className="px-3 py-1 rounded-full bg-white/[0.05] border border-white/10 text-[var(--accent-cyan)] font-mono text-xs">SYNC_OUTBOX: 0</div>
              </div>
              <div className="grid grid-cols-4 grid-rows-2 gap-4 flex-grow mt-6">
                <div className="col-span-2 row-span-2 bg-white/[0.04] rounded-2xl border border-white/10 p-6 flex flex-col">
                  <span className="text-white/40 text-xs uppercase tracking-widest">Ledger Activity</span>
                  <div className="flex-grow flex items-end gap-1.5 mt-4">
                    {[40, 70, 45, 90, 65, 100, 80].map((h, i) => (
                      <div key={i} className="flex-1 bg-gradient-to-t from-[var(--accent-emerald)]/20 to-[var(--accent-emerald)] rounded-t-sm" style={{ height: `${h}%` }} />
                    ))}
                  </div>
                </div>
                <div className="bg-white/[0.04] rounded-2xl border border-white/10 p-5 flex flex-col justify-between">
                  <span className="text-white/50 text-xs">Active Students</span>
                  <span className="text-3xl font-bold">342</span>
                </div>
                <div className="bg-white/[0.04] rounded-2xl border border-white/10 p-5 flex flex-col justify-between">
                  <span className="text-white/50 text-xs">Unsynced</span>
                  <span className="text-3xl font-bold">0</span>
                </div>
                <div className="col-span-2 bg-white/[0.04] rounded-2xl border border-white/10 p-5 flex items-center justify-between">
                  <span className="text-sm font-semibold">Ready to take control?</span>
                  <a href={`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/login`} className="px-5 py-2.5 bg-[var(--accent-emerald)] text-black font-bold text-sm rounded-xl no-underline">Open Web Portal</a>
                </div>
              </div>
            </div>
          </Html>
        </Plane>
      </group>
    </group>
  );
}
