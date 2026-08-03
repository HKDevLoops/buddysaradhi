import React, { useState } from 'react';
import Link from 'next/link';
import { log } from '@/lib/logger';
import { VideoTourModal } from '@/components/hero/video-tour-modal';

export function CtaStack() {
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);

  return (
    <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto items-center">
      {/* Primary CTA - Emerald Glow */}
      <Link
        href="/signup"
        aria-label="Start free — no credit card required"
        className="w-full md:w-[240px] h-[56px] px-4 rounded-xl flex items-center justify-center
                   bg-[#1a1a3a] text-[#0a0a1a] font-semibold text-base
                   shadow-[4px_4px_8px_#0a0a1a,-4px_-4px_8px_#2a2a5a,0_8px_32px_rgba(0,255,157,0.25),inset_0_0_12px_rgba(0,255,157,0.15)]
                   hover:shadow-[4px_4px_8px_#0a0a1a,-4px_-4px_8px_#2a2a5a,0_12px_48px_rgba(0,255,157,0.35),inset_0_0_12px_rgba(0,255,157,0.15)]
                   active:shadow-[inset_4px_4px_8px_#0a0a1a,inset_-4px_-4px_8px_#2a2a5a] active:translate-y-[1px]
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] focus-visible:ring-offset-2
                   transition-all duration-200 cta-shimmer relative overflow-hidden"
      >
        <span className="relative z-10">Start free — no card</span>
      </Link>

      {/* Secondary CTA - Glass Cyan */}
      <button
        type="button"
        onClick={() => {
          log.info('video_modal_opened', 'CTA stack invoked Open video modal');
          setIsVideoModalOpen(true);
        }}
        className="w-full md:w-[200px] h-[56px] px-4 rounded-xl flex items-center justify-center
                   bg-[#1a1a3a] text-[#00F0FF] font-semibold text-base
                   border border-[#00F0FF]/40
                   shadow-[4px_4px_8px_#0a0a1a,-4px_-4px_8px_#2a2a5a]
                   hover:border-[#00F0FF]/60 hover:bg-[var(--surface-glass-strong)]
                   active:shadow-[inset_4px_4px_8px_#0a0a1a,inset_-4px_-4px_8px_#2a2a5a] active:translate-y-[1px]
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] focus-visible:ring-offset-2
                   transition-all duration-200"
      >
        Watch the 90s tour ▶
      </button>

      <VideoTourModal
        isOpen={isVideoModalOpen}
        onClose={() => setIsVideoModalOpen(false)}
      />
    </div>
  );
}
