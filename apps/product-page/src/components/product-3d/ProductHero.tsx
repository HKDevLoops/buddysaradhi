"use client";

// Implements: 20_3D_Product_Page.md (sticky stage + GSAP scrub proxy, 5 beats,
// Poster loading veil per FM-10) + docs/design/overhaul-plan.md §4.1 (front
// door: one clear action, "Request access") restyled onto the generated tokens.
// The narrative journey is the product's differentiator, so the five beats and
// the pinned stage stay exactly as they were; only the surface language changed.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Poster } from "./Poster";
import { useLowEnd, useReducedMotion, useSceneTokens, useWebGLAvailable } from "./hooks";
import type { ProgressProxy } from "./Journey";

const ProductScene = dynamic(() => import("./ProductScene").then((m) => m.ProductScene), {
  ssr: false,
});

const BEATS = [
  {
    id: "hook",
    pin: "Hook",
    kicker: "Buddysaradhi. Built in India.",
    title: "Five screens. Seven engines. One ledger. Zero servers to manage.",
    body: "The operating system for private tutors and small coaching institutes. Scroll to walk through it.",
  },
  {
    id: "exploration",
    pin: "Chaos",
    kicker: "Beat 1. Exploration.",
    title: "The chaos is real.",
    body: "WhatsApp threads, Excel sheets, a paper register. Thirty eight students, and no single place they all live.",
  },
  {
    id: "relief",
    pin: "Relief",
    kicker: "Beat 2. Relief.",
    title: "Breathe. It is all in one ledger.",
    body: "Attendance in twenty seconds. Every fee recorded, every receipt numbered, nothing editable after the fact.",
  },
  {
    id: "climax",
    pin: "Climax",
    kicker: "Beat 3. Climax.",
    title: "The month closes without a dispute.",
    body: "Dues collected, batches scheduled, the register and the ledger finally saying the same thing.",
  },
  {
    id: "reveal",
    pin: "Reveal",
    kicker: "Beat 4. Reveal.",
    title: "Five screens. Zero servers.",
    body: "Dashboard, Students, Attendance, Fees, Settings. Offline first, yours outright, and free while our infrastructure stays free.",
  },
] as const;

/** Oddy-pattern headline: letters scatter in on every beat change (CSS, cheap).
 *  The per-character spans are hidden from assistive tech; the sr-only copy is
 *  the single accessible reading of the headline. */
function ScatterTitle({ text, beat }: { text: string; beat: number }) {
  return (
    <h1
      key={beat}
      className="scatter-in font-display text-4xl leading-tight font-bold text-balance md:text-6xl"
      style={{ color: "var(--text-primary)" }}
    >
      <span aria-hidden="true">
        {text.split("").map((ch, i) => (
          <span
            key={i}
            className="scatter-char"
            style={{ animationDelay: `${Math.min(i * 12, 400)}ms` }}
          >
            {ch === " " ? " " : ch}
          </span>
        ))}
      </span>
      <span className="sr-only">{text}</span>
    </h1>
  );
}

export function ProductHero() {
  const webgl = useWebGLAvailable();
  const reduced = useReducedMotion();
  const lowEnd = useLowEnd();
  const tokens = useSceneTokens();
  const [ready, setReady] = useState(false);
  const [beat, setBeat] = useState(0);
  const [inView, setInView] = useState(true);
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<ProgressProxy>({ current: 0 });

  const saveData =
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ===
      true;
  // The canvas needs real colours, so it cannot mount before the palette has
  // resolved. Until then the Poster holds the frame.
  const showPoster = webgl === false || saveData || tokens === null;

  // Scrub proxy: section scroll → 0..1. Killed on unmount (FM-15).
  useLayoutEffect(() => {
    if (showPoster) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: sectionRef.current,
        start: "top top",
        end: "bottom bottom",
        scrub: 1,
        onUpdate: (self) => {
          progressRef.current.current = self.progress;
          const b = Math.min(BEATS.length - 1, Math.floor(self.progress * BEATS.length));
          setBeat((prev) => (prev === b ? prev : b));
        },
      });
    }, sectionRef);
    const refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 600);
    return () => {
      clearTimeout(refreshTimer);
      ctx.revert();
    };
  }, [showPoster]);

  // Suspend the render loop off-screen (FM-16).
  useEffect(() => {
    const el = stageRef.current;
    if (!el || showPoster) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [showPoster]);

  const scrollToBeat = (index: number) => {
    const section = sectionRef.current;
    if (!section) return;
    const top = section.offsetTop + (section.offsetHeight * index) / BEATS.length;
    window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  };

  const current = BEATS[beat];

  return (
    <section
      ref={sectionRef}
      aria-label="Product story"
      className="relative"
      style={{ height: "500vh" }}
    >
      <div ref={stageRef} className="sticky top-0 h-[100dvh] w-full overflow-hidden">
        {showPoster || !tokens ? (
          <Poster />
        ) : (
          // Loading veil (FM-10): canvas mounts immediately, Poster holds
          // identical pixels until the first frame. No layout shift.
          <div className="relative h-[100dvh] w-full">
            <div className="absolute inset-0">
              <ProductScene
                progressRef={progressRef.current}
                tokens={tokens}
                frozen={reduced}
                lowEnd={lowEnd}
                inView={inView}
                onReady={() => setReady(true)}
              />
            </div>
            {!ready && (
              <div className="absolute inset-0">
                <Poster />
              </div>
            )}
          </div>
        )}

        {/* DOM overlay: the accessible surface (canvas is aria-hidden). This is
            the one floating region on the page besides the nav, which is what
            material-modes.md §5.2 cap 2 allows. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-center p-6 md:p-12">
          <div className="mat mat-fresnel pointer-events-auto w-full max-w-xl rounded-panel p-6 md:p-8">
            <p className="text-sm font-medium" style={{ color: "var(--accent-primary)" }}>
              {current.kicker}
            </p>
            <div className="mt-3">
              <ScatterTitle text={current.title} beat={beat} />
            </div>
            <p className="mt-4 text-base text-pretty md:text-lg" style={{ color: "var(--text-secondary)" }}>
              {current.body}
            </p>
            <div className="mt-6 flex flex-wrap gap-4">
              <Link href="/request-access" className="btn btn-primary text-base">
                Request access
              </Link>
              <button
                type="button"
                onClick={() => scrollToBeat(BEATS.length - 1)}
                className="btn btn-secondary text-base"
              >
                See the journey
              </button>
            </div>
            <p className="mt-4 text-sm" style={{ color: "var(--text-muted)" }}>
              Nothing is charged on this site. We contract the plan, then an administrator provisions
              your account.
            </p>
          </div>
        </div>

        {/* Pins: jump points as DOM buttons (keyboard-safe). */}
        <nav
          aria-label="Story beats"
          className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-wrap justify-center gap-2 px-6"
        >
          {BEATS.map((b, i) => {
            const active = i === beat;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => scrollToBeat(i)}
                aria-current={active ? "step" : undefined}
                className="min-h-[44px] rounded-full px-4 text-sm font-medium"
                style={{
                  background: active ? "var(--surface-sheet)" : "transparent",
                  color: active ? "var(--accent-primary)" : "var(--text-secondary)",
                  border: `1px solid ${active ? "var(--accent-primary)" : "var(--border-default)"}`,
                }}
              >
                {b.pin}
              </button>
            );
          })}
        </nav>
      </div>

      <style>{`
        .scatter-in { overflow: hidden; }
        .scatter-char {
          display: inline-block;
          opacity: 0;
          transform: translateY(110%) rotate(4deg);
          animation: scatter-in 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
        @keyframes scatter-in {
          to { opacity: 1; transform: translateY(0) rotate(0deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .scatter-char { animation: none; opacity: 1; transform: none; }
        }
      `}</style>
    </section>
  );
}