"use client";

// Implements: 20_3D_Product_Page.md (sticky stage + GSAP scrub proxy, 5 beats,
// Poster loading veil per FM-10) + product/02 copy (hero words, R-02: no em dash).

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Poster } from "./Poster";
import { useLowEnd, useReducedMotion, useWebGLAvailable } from "./hooks";
import type { ProgressProxy } from "./Journey";

const ProductScene = dynamic(() => import("./ProductScene").then((m) => m.ProductScene), {
  ssr: false,
});

const BEATS = [
  {
    id: "hook",
    pin: "Hook",
    kicker: "Buddysaradhi. v1.4. Built in India.",
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
    title: "Every tutor on BuddySaradhi.",
    body: "The staffroom moment. Dues collected, batches scheduled, the month closed without a single dispute.",
  },
  {
    id: "reveal",
    pin: "Reveal",
    kicker: "Beat 4. Reveal.",
    title: "Five screens. Zero servers.",
    body: "Dashboard, Students, Attendance, Fees, Settings. Offline first, yours outright, free for everyone while our infra stays free.",
  },
] as const;

/** Oddy-pattern headline: letters scatter in on every beat change (CSS, cheap). */
function ScatterTitle({ text, beat }: { text: string; beat: number }) {
  return (
    <h1
      key={beat}
      className="scatter-in text-4xl leading-tight font-bold md:text-6xl"
      style={{ color: "rgba(255,255,255,0.95)" }}
    >
      {text.split("").map((ch, i) => (
        <span
          key={i}
          aria-hidden={ch === " " ? undefined : false}
          className="scatter-char"
          style={{ animationDelay: `${Math.min(i * 12, 400)}ms` }}
        >
          {ch === " " ? " " : ch}
        </span>
      ))}
      <span className="sr-only">{text}</span>
    </h1>
  );
}

export function ProductHero() {
  const webgl = useWebGLAvailable();
  const reduced = useReducedMotion();
  const lowEnd = useLowEnd();
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
  const showPoster = webgl === false || saveData;

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
        {showPoster || webgl === null ? (
          <Poster />
        ) : (
          // Loading veil (FM-10): canvas mounts immediately, Poster holds
          // identical pixels until the first frame. No layout shift.
          <div className="relative h-[100dvh] w-full">
            <div className="absolute inset-0">
              <ProductScene
                progressRef={progressRef.current}
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

        {/* DOM overlay: the accessible surface (canvas is aria-hidden). */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-center p-6 md:p-12">
          <div className="glass max-w-xl rounded-2xl p-6 md:p-8">
            <p
              className="text-xs font-semibold tracking-widest uppercase"
              style={{ color: "#00FF9D" }}
            >
              {current.kicker}
            </p>
            <div className="mt-3">
              <ScatterTitle text={current.title} beat={beat} />
            </div>
            <p className="mt-4 text-base md:text-lg" style={{ color: "rgba(255,255,255,0.7)" }}>
              {current.body}
            </p>
            <div className="pointer-events-auto mt-6 flex flex-wrap gap-4">
              <a
                href="https://buddysaradhi.vercel.app/signup"
                aria-label="Start free. No credit card needed."
                className="neumo-raised inline-flex min-h-[44px] min-w-[44px] items-center rounded-xl px-6 py-4 text-base font-semibold"
                style={{
                  background: "#00FF9D",
                  color: "#0a0a1a",
                  boxShadow: "0 8px 32px rgba(0,255,157,0.25)",
                }}
              >
                Start free. No card needed.
              </a>
              <button
                type="button"
                onClick={() => scrollToBeat(BEATS.length - 1)}
                className="neumo-raised inline-flex min-h-[44px] min-w-[44px] items-center rounded-xl border px-6 py-4 text-base font-semibold"
                style={{ borderColor: "rgba(0,240,255,0.4)", color: "#00F0FF" }}
              >
                See the journey
              </button>
            </div>
            <p className="mt-4 text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
              No card. Free for everyone. Free while our infra stays free.
            </p>
          </div>
        </div>

        {/* Pins: jump points as DOM buttons (keyboard-safe). */}
        <nav
          aria-label="Story beats"
          className="absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-2"
        >
          {BEATS.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => scrollToBeat(i)}
              aria-current={i === beat ? "true" : undefined}
              className="min-h-[44px] rounded-full px-4 text-sm font-medium"
              style={{
                background: i === beat ? "rgba(0,255,157,0.2)" : "rgba(255,255,255,0.05)",
                color: i === beat ? "#00FF9D" : "rgba(255,255,255,0.7)",
                border: `1px solid ${i === beat ? "rgba(0,255,157,0.5)" : "rgba(255,255,255,0.15)"}`,
              }}
            >
              {b.pin}
            </button>
          ))}
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
