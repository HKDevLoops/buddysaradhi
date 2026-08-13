import React, { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll, Html } from '@react-three/drei';
import anime from 'animejs';

interface ScrollBoundAnimeProps {
  startScroll: number;
  endScroll: number;
  sceneId: 'hook' | 'chaos';
}

export function ScrollBoundAnime({ startScroll, endScroll, sceneId }: ScrollBoundAnimeProps) {
  const scroll = useScroll();
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<anime.AnimeTimelineInstance | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create an anime timeline that doesn't autoplay
    timelineRef.current = anime.timeline({
      autoplay: false,
      duration: 1000,
      easing: 'linear',
    });

    if (sceneId === 'hook') {
      // Scene 1: The Curious Bastard Finds a Tuition
      const character = containerRef.current.querySelector('.character');
      const phone = containerRef.current.querySelector('.phone');
      const building = containerRef.current.querySelector('.building');
      
      timelineRef.current
        .add({
          targets: character,
          translateX: [-200, 0],
          opacity: [0, 1],
          duration: 300,
        }, 0)
        .add({
          targets: phone,
          translateY: [50, 0],
          opacity: [0, 1],
          rotateZ: [-20, 0],
          duration: 200,
        }, 200)
        .add({
          targets: building,
          scale: [0.8, 1],
          opacity: [0, 1],
          duration: 300,
        }, 400)
        .add({
          targets: character,
          translateX: [0, 150],
          scale: [1, 0.5],
          opacity: [1, 0],
          duration: 300,
        }, 700);
    } else if (sceneId === 'chaos') {
      // Scene 2: The Chaos Hallway (Fighting, Teasing, Learning)
      const students = containerRef.current.querySelectorAll('.student');
      const books = containerRef.current.querySelectorAll('.book');
      const punch = containerRef.current.querySelector('.punch');
      
      timelineRef.current
        .add({
          targets: students,
          translateX: () => anime.random(-100, 100),
          translateY: () => anime.random(-50, 50),
          rotate: () => anime.random(-15, 15),
          opacity: [0, 1],
          delay: anime.stagger(100),
          duration: 400,
        }, 0)
        .add({
          targets: punch,
          scale: [0, 2],
          opacity: [0, 1, 0],
          duration: 200,
        }, 300)
        .add({
          targets: books,
          translateY: [-100, 100],
          rotate: 360,
          opacity: [0, 1, 0],
          delay: anime.stagger(50),
          duration: 400,
        }, 400)
        .add({
          targets: students,
          translateX: 0,
          translateY: 0,
          rotate: 0,
          scale: [1, 1.2, 1],
          duration: 300,
        }, 700);
    }

    return () => {
      if (timelineRef.current) {
        timelineRef.current.pause();
      }
    };
  }, [sceneId]);

  useFrame(() => {
    if (!timelineRef.current) return;
    
    // Normalize scroll progress for this specific component
    const range = endScroll - startScroll;
    let progress = (scroll.offset - startScroll) / range;
    progress = Math.max(0, Math.min(1, progress));
    
    // Seek timeline based on scroll progress
    timelineRef.current.seek(timelineRef.current.duration * progress);
  });

  return (
    <Html transform distanceFactor={3} position={[0, 0, 0.02]} zIndexRange={[50, 0]}>
      <div 
        ref={containerRef} 
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{ width: '800px', height: '450px', transform: 'translate(-50%, -50%)' }}
      >
        {sceneId === 'hook' && (
          <div className="relative w-full h-full text-white text-6xl flex items-center justify-center">
            <div className="building absolute right-10 top-1/2 -translate-y-1/2 opacity-0 text-8xl">🏫</div>
            <div className="character absolute left-1/4 top-1/2 -translate-y-1/2 opacity-0 text-7xl z-10 flex">
              😏<span className="phone opacity-0 text-4xl mt-6 -ml-2">📱</span>
            </div>
          </div>
        )}
        
        {sceneId === 'chaos' && (
          <div className="relative w-full h-full text-white text-6xl flex items-center justify-center">
            <div className="student absolute left-[20%] top-[30%] opacity-0">😆</div>
            <div className="student absolute left-[70%] top-[20%] opacity-0">😡</div>
            <div className="student absolute left-[40%] top-[60%] opacity-0">🤓</div>
            <div className="student absolute left-[80%] top-[70%] opacity-0">😴</div>
            <div className="student absolute left-[10%] top-[70%] opacity-0">🏃</div>
            
            <div className="punch absolute left-[50%] top-[40%] opacity-0 text-8xl z-20">💥</div>
            
            <div className="book absolute left-[30%] top-[10%] opacity-0">📚</div>
            <div className="book absolute left-[60%] top-[10%] opacity-0">✏️</div>
            <div className="book absolute left-[45%] top-[10%] opacity-0">📝</div>
          </div>
        )}
      </div>
    </Html>
  );
}
