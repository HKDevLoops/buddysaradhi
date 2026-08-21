import React from 'react';
import { HeroWrapper } from '@/components/hero/HeroWrapper';
import { HeroSections } from '@/components/hero/HeroSections';

// Marketing page is static — no per-request DB work (lightweight server).
// 3D canvas is client-island (ssr:false inside HeroWrapper); all copy is SSR.
export const dynamic = 'force-static';
export const revalidate = 3600;

export default function LandingPage() {
  return (
    <main className="relative min-h-screen w-full bg-[var(--bg-cosmic)] text-[var(--text-primary)]">
      {/* Client island: Topbar + 3D background (Poster fallback on SSR/no-WebGL) */}
      <HeroWrapper />
      {/* Server-rendered marketing sections — SEO, no JS, lightweight */}
      <HeroSections />
    </main>
  );
}

