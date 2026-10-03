// Implements: docs/design/overhaul-plan.md §5 + AGENTS.md §2 Rule 5 — the hero CTA
// stack, on the palette instead of on literals.
//
// This file previously hardcoded an indigo fill (`#1a1a3a`), near-black ink
// (`#0a0a1a`), a violet shadow pair (`#2a2a5a`) and bioluminescent cyan
// (`#00F0FF`) — the retired Vibrant Glass palette, written directly into a class
// list. It is the clearest example of why the palette existed as literals: these
// four colours glowed the same on all 20 schemes and contradicted whichever one the
// tutor had chosen. The neumorphic shadow recipe now lives in globals.css as
// `.neumo-raised` / `.neumo-pressed`, so it is written once and follows the theme.
//
// Mode: Persuade. One primary action, one secondary, both reachable by keyboard
// with a visible focus ring, both carrying a real label rather than an icon.
import React, { useState } from "react";
import Link from "next/link";
import { log } from "@/lib/logger";
import { VideoTourModal } from "@/components/hero/video-tour-modal";

export function CtaStack() {
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);

  return (
    <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto items-center">
      <Link
        href="/signup"
        aria-label="Start free — no credit card required"
        className="w-full md:w-[240px] h-[56px] px-4 rounded-xl flex items-center justify-center
                   bg-[var(--accent-primary)] text-[var(--accent-on-primary)] font-semibold text-base
                   neumo-raised
                   hover:brightness-110
                   active:translate-y-[1px] neumo-pressed
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2
                   transition-all duration-200 cta-shimmer relative overflow-hidden"
      >
        <span className="relative z-10">Start free — no card</span>
      </Link>

      <button
        type="button"
        onClick={() => {
          log.info("video_modal_opened", "CTA stack invoked Open video modal");
          setIsVideoModalOpen(true);
        }}
        className="w-full md:w-[200px] h-[56px] px-4 rounded-xl flex items-center justify-center
                   bg-[var(--surface-raised)] text-[var(--accent-text)] font-semibold text-base
                   border border-[var(--border-default)]
                   neumo-raised
                   hover:border-[var(--border-strong)] hover:bg-[var(--surface-overlay)]
                   active:translate-y-[1px] neumo-pressed
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-text)] focus-visible:ring-offset-2
                   transition-all duration-200"
      >
        Watch the 90s tour
      </button>

      <VideoTourModal isOpen={isVideoModalOpen} onClose={() => setIsVideoModalOpen(false)} />
    </div>
  );
}