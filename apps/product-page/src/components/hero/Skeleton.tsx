// Lightweight fallback — no boneyard-js (avoids extra dep, SSR-safe)
import React from 'react';

export function HeroSkeleton() {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
      <div className="w-[300px] h-[100px] rounded-xl bg-white/5 border border-white/10 backdrop-blur-md shadow-2xl animate-pulse" />
    </div>
  );
}

