// @ts-nocheck
import React, { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll, Html } from '@react-three/drei';
import anime from 'animejs';

export function ScrollBoundAnime({ startScroll, endScroll, sceneId }: { startScroll: number; endScroll: number; sceneId: 'hook' | 'chaos' | 'relief' | 'climax' | 'reveal' }) {
  const scroll = useScroll();
  const containerRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const tl = anime.timeline({ autoplay: false, duration: 1000, easing: 'linear' });
    tlRef.current = tl;
    const q = (sel: string) => containerRef.current!.querySelectorAll(sel);
    const one = (sel: string) => containerRef.current!.querySelector(sel);

    if (sceneId === 'hook') {
      tl.add({ targets: one('.character'), translateX: [-160, 0], opacity: [0, 1], duration: 280 }, 0)
        .add({ targets: one('.phone'), translateY: [40, 0], opacity: [0, 1], rotateZ: [-12, 0], duration: 220 }, 180)
        .add({ targets: one('.building'), scale: [0.92, 1], opacity: [0, 1], duration: 260 }, 360)
        .add({ targets: one('.label'), translateY: [10, 0], opacity: [0, 1], duration: 200 }, 520)
        .add({ targets: one('.character'), translateX: [0, 120], scale: [1, 0.85], opacity: [1, 0], duration: 220 }, 780);
    } else if (sceneId === 'chaos') {
      tl.add({ targets: q('.student'), translateX: () => anime.random(-80, 80), translateY: () => anime.random(-40, 40), rotateZ: () => anime.random(-10, 10), opacity: [0, 1], delay: anime.stagger(60), duration: 380 }, 0)
        .add({ targets: one('.punch'), scale: [0, 1.6], opacity: [0, 1, 0], duration: 200 }, 300)
        .add({ targets: q('.book'), translateY: [-60, 60], rotateZ: 360, opacity: [0, 1, 0], delay: anime.stagger(50), duration: 380 }, 400)
        .add({ targets: q('.student'), translateX: 0, translateY: 0, rotateZ: 0, scale: [1, 1.08, 1], duration: 260 }, 740);
    } else if (sceneId === 'relief') {
      tl.add({ targets: q('.relief-dot'), scale: [0.6, 1], opacity: [0, 1], delay: anime.stagger(60), duration: 300 }, 0)
        .add({ targets: one('.nod'), translateY: [12, 0], opacity: [0, 1], duration: 240 }, 260)
        .add({ targets: one('.breath'), scaleX: [0.7, 1], opacity: [0.4, 1], duration: 300 }, 400);
    } else if (sceneId === 'climax') {
      tl.add({ targets: q('.tutor'), scale: [0.8, 1], opacity: [0, 1], delay: anime.stagger(60), duration: 320 }, 0)
        .add({ targets: one('.crowd-label'), translateY: [12, 0], opacity: [0, 1], duration: 220 }, 320)
        .add({ targets: q('.tutor'), translateY: [-6, 0], delay: anime.stagger(40), duration: 200 }, 600);
    } else if (sceneId === 'reveal') {
      tl.add({ targets: q('.screen'), scale: [0.92, 1], opacity: [0, 1], delay: anime.stagger(60), duration: 280 }, 0)
        .add({ targets: one('.reveal-label'), translateY: [10, 0], opacity: [0, 1], duration: 220 }, 300);
    }

    return () => tl.pause();
  }, [sceneId]);

  useFrame(() => {
    if (!tlRef.current || !scroll) return;
    const range = endScroll - startScroll;
    let p = (scroll.offset - startScroll) / range;
    p = Math.max(0, Math.min(1, p));
    tlRef.current.seek(tlRef.current.duration * p);
  });

  return (
    <Html transform distanceFactor={3} position={[0, 0, 0.02]} zIndexRange={[50, 0]}>
      <div ref={containerRef} className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ width: '800px', height: '450px', transform: 'translate(-50%, -50%)' }}>
        {sceneId === 'hook' && (
          <div className="relative w-full h-full flex items-center justify-center">
            <div className="label absolute top-8 left-1/2 -translate-x-1/2 opacity-0">
              <span className="px-2 py-1 rounded-md border border-white/10 text-[10px] font-mono tracking-widest text-white/70">CHAPTER 01 — THE HOOK</span>
            </div>
            <div className="building absolute right-10 top-1/2 -translate-y-1/2 opacity-0 text-[10px] font-mono tracking-[0.2em] text-white/70 border border-white/20 px-3 py-6 rounded-lg">◆ TUITION</div>
            <div className="character absolute left-[22%] top-1/2 -translate-y-1/2 opacity-0 flex items-center gap-1">
              <span className="w-10 h-10 rounded-full border border-white/30 flex items-center justify-center text-white/80 text-xs">◆</span>
              <span className="phone opacity-0 w-5 h-8 rounded-sm border border-white/30 bg-white/5" />
            </div>
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-center">
              <div className="text-sm font-mono text-white/80">THE SEEKER — phone in hand</div>
              <div className="text-[11px] text-white/50">curious, looking for a tuition</div>
            </div>
          </div>
        )}
        {sceneId === 'chaos' && (
          <div className="relative w-full h-full flex items-center justify-center">
            <div className="student absolute left-[18%] top-[30%] opacity-0 w-14 h-14 rounded-xl border border-white/15 bg-white/[0.04] flex items-center justify-center text-white/60 text-xs">• fight</div>
            <div className="student absolute left-[68%] top-[18%] opacity-0 w-14 h-14 rounded-xl border border-white/15 bg-white/[0.04] flex items-center justify-center text-white/60 text-xs">• tease</div>
            <div className="student absolute left-[38%] top-[62%] opacity-0 w-14 h-14 rounded-xl border border-white/15 bg-white/[0.04] flex items-center justify-center text-white/60 text-xs">• support</div>
            <div className="student absolute left-[78%] top-[68%] opacity-0 w-12 h-12 rounded-xl border border-white/15 bg-white/[0.04] flex items-center justify-center text-white/60 text-xs">• learn</div>
            <div className="student absolute left-[10%] top-[68%] opacity-0 w-12 h-12 rounded-xl border border-white/15 bg-white/[0.04] flex items-center justify-center text-white/60 text-xs">• play</div>
            <div className="punch absolute left-1/2 top-[40%] opacity-0 w-16 h-16 rounded-full border border-white/20 flex items-center justify-center text-white/40 text-xs">◆</div>
            <div className="book absolute left-[30%] top-[10%] opacity-0 w-8 h-10 rounded border border-white/15" />
            <div className="book absolute left-[60%] top-[10%] opacity-0 w-8 h-10 rounded border border-white/15" />
            <div className="book absolute left-[45%] top-[10%] opacity-0 w-8 h-10 rounded border border-white/15" />
          </div>
        )}
        {sceneId === 'relief' && (
          <div className="relative w-full h-full flex items-center justify-center">
            <div className="relief-dot w-16 h-16 rounded-full border border-white/15 flex items-center justify-center text-white/50 text-xs opacity-0">• relief</div>
            <div className="nod absolute bottom-20 left-1/2 -translate-x-1/2 opacity-0 text-sm font-mono text-white/70">— nod, breathes easy —</div>
            <div className="breath absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full border border-emerald-400/20 opacity-0" />
          </div>
        )}
        {sceneId === 'climax' && (
          <div className="relative w-full h-full flex items-center justify-center">
            <div className="tutor w-12 h-16 rounded-lg border border-white/15 bg-white/[0.03] flex items-center justify-center text-white/60 text-[10px] opacity-0">tutor 1</div>
            <div className="tutor w-12 h-16 rounded-lg border border-white/15 bg-white/[0.03] flex items-center justify-center text-white/60 text-[10px] opacity-0 ml-3">tutor 2</div>
            <div className="tutor w-12 h-16 rounded-lg border border-white/15 bg-white/[0.03] flex items-center justify-center text-white/60 text-[10px] opacity-0 ml-3">tutor 3</div>
            <div className="crowd-label absolute bottom-16 left-1/2 -translate-x-1/2 opacity-0">
              <span className="px-2 py-1 rounded-md border border-white/10 text-[10px] font-mono tracking-widest text-white/70">CHAPTER 04 — THE STAFFROOM</span>
            </div>
            <div className="absolute bottom-8 text-center">
              <div className="text-sm font-mono text-white/80">every tutor on BuddySaradhi</div>
            </div>
          </div>
        )}
        {sceneId === 'reveal' && (
          <div className="relative w-full h-full flex items-center justify-center">
            <div className="screen w-20 h-14 rounded-md border border-white/15 bg-white/[0.04] flex items-center justify-center text-[9px] font-mono text-white/60 opacity-0">Dashboard</div>
            <div className="screen w-20 h-14 rounded-md border border-white/15 bg-white/[0.04] flex items-center justify-center text-[9px] font-mono text-white/60 opacity-0 ml-2">Students</div>
            <div className="screen w-20 h-14 rounded-md border border-white/15 bg-white/[0.04] flex items-center justify-center text-[9px] font-mono text-white/60 opacity-0 ml-2">Attendance</div>
            <div className="screen w-20 h-14 rounded-md border border-white/15 bg-white/[0.04] flex items-center justify-center text-[9px] font-mono text-white/60 opacity-0 ml-2">Fees</div>
            <div className="screen w-20 h-14 rounded-md border border-white/15 bg-white/[0.04] flex items-center justify-center text-[9px] font-mono text-white/60 opacity-0 ml-2">Settings</div>
            <div className="reveal-label absolute -bottom-2 left-1/2 -translate-x-1/2 opacity-0 text-[10px] font-mono tracking-widest text-white/60">REVEAL — 5 screens zoom</div>
          </div>
        )}
      </div>
    </Html>
  );
}
