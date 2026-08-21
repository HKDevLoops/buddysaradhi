'use client';

import dynamic from 'next/dynamic';

export const HeroWrapper = dynamic(
  () => import('./Hero3D').then((mod) => mod.Hero3D),
  { ssr: false }
);
