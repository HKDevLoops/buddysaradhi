// Implements: 20_3D_Product_Page.md §12 (the `/tour` long-scroll narrative).
// A 600vh pinned stage reusing the hero's pins pattern: DOM buttons scroll to
// stop fractions, a GSAP scrub proxy drives the shared Journey camera, and the
// route-local set pieces (TourTube, TourFovRig) ride along through
// ProductScene's composition outlet. No new deps, no new assets.

"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Poster } from "@/components/product-3d/Poster";
import {
  useLowEnd,
  useReducedMotion,
  useSceneTokens,
  useWebGLAvailable,
  useWideDesktop,
} from "@/components/product-3d/hooks";
import {
  beatIdToIndex,
  beatIndexToId,
  resolveBeatIndex,
} from "@/components/product-3d/scene-tiers";
import type { ProgressProxy } from "@/components/product-3d/Journey";
import { TOUR_IDS, TOUR_STOPS } from "./tour-copy";

const TourCanvas = dynamic(() => import("./tour-canvas").then((m) => m.TourCanvas), {
  ssr: false,
});

/** Stop heading: the hero's scatter-in treatment, one level down. The `/tour`
 *  H1 lives in the server page (FM-13: H1-in-SSR-HTML), so every overlay
 *  heading here is an H2 - one H1 per document. */
function StopTitle({ text, stop }: { text: string; stop: number }) {
  return (
    <h2
      key={stop}
      className="scatter-in font-display text-3xl leading-tight font-bold text-balance md:text-5xl"
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
    </h2>
  );
}

function readBeatParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("beat");
}

export function TourExperience() {
  const webgl = useWebGLAvailable();
  const reduced = useReducedMotion();
  const lowEnd = useLowEnd();
  const wide = useWideDesktop();
  const tokens = useSceneTokens();
  const [ready, setReady] = useState(false);
  const [stop, setStop] = useState(0);
  const [inView, setInView] = useState(true);
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<ProgressProxy>({ current: 0 });
  const stopRef = useRef(0);

  // SAFETY: `navigator.connection` is a real Chromium API absent from
  // lib.dom's Navigator - the widened read is guarded by `typeof navigator`
  // above and optional chaining, so non-Chromium browsers get `undefined`.
  const saveData =
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ===
      true;
  // Same contract as the hero: no canvas without WebGL, with Save-Data, or
  // before the palette resolves (invented colours are forbidden).
  const showPoster = webgl === false || saveData || tokens === null;

  const stopTop = (index: number): number => {
    const section = sectionRef.current;
    if (!section) return 0;
    const clamped = Math.min(TOUR_STOPS.length - 1, Math.max(0, index));
    return section.offsetTop + (section.offsetHeight * clamped) / TOUR_STOPS.length;
  };

  const goToStop = (index: number, history: "push" | "replace" | "none") => {
    const clamped = Math.min(TOUR_STOPS.length - 1, Math.max(0, index));
    stopRef.current = clamped;
    setStop(clamped);
    window.scrollTo({ top: stopTop(clamped), behavior: reduced ? "auto" : "smooth" });
    if (history === "none") return;
    const url = `?beat=${beatIndexToId(clamped, TOUR_IDS)}`;
    if (window.location.search === url) return;
    if (history === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  };

  // Scrub proxy: section scroll → 0..1. Killed on unmount (FM-15). The beat in
  // the URL is replaced (not pushed) on scroll so the back button walks
  // explicit stop visits, not every scrub tick.
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
          const b = resolveBeatIndex(self.progress, TOUR_STOPS.length);
          if (b !== stopRef.current) {
            stopRef.current = b;
            setStop(b);
            const url = `?beat=${beatIndexToId(b, TOUR_IDS)}`;
            if (window.location.search !== url) window.history.replaceState(null, "", url);
          }
        },
      });
    }, sectionRef);
    // FM-21: triggers measured before fonts and late assets settle land in the
    // wrong place. Refresh after settle, and again when webfonts arrive.
    // SAFETY: `document.fonts` is a real FontFaceSet API absent from this
    // tsconfig's lib.dom - the widened read only ever calls `.ready.then`.
    const refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 600);
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    if (fonts) {
      fonts.ready.then(() => {
        ScrollTrigger.refresh();
      });
    }
    return () => {
      clearTimeout(refreshTimer);
      ctx.revert();
    };
  }, [showPoster]);

  // Deep link: `?beat=<id>` lands on that stop after the triggers settle.
  // Instant scroll - a shared link should arrive, not perform the journey.
  useLayoutEffect(() => {
    if (showPoster) return;
    const target = beatIdToIndex(readBeatParam(), TOUR_IDS);
    if (target === 0) return;
    const landTimer = setTimeout(() => {
      stopRef.current = target;
      setStop(target);
      window.scrollTo({ top: stopTop(target), behavior: "auto" });
    }, 700);
    return () => clearTimeout(landTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPoster]);

  // Back/forward: a popped `?beat=` scrolls to that stop. Instant, like the
  // landing - the browser already animated the gesture.
  useEffect(() => {
    const onPop = () => {
      const target = beatIdToIndex(readBeatParam(), TOUR_IDS);
      stopRef.current = target;
      setStop(target);
      window.scrollTo({ top: stopTop(target), behavior: "auto" });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suspend the render loop off-screen (FM-16): the loop never runs when the
  // stage leaves the viewport.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || showPoster) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [showPoster]);

  const current = TOUR_STOPS[stop];

  const canvasNote = (() => {
    if (webgl === null) return "Checking whether this device can show the 3D tour.";
    if (saveData) return "Data saver is on, so a still image stands in for the 3D tour.";
    if (webgl === false) {
      return "This device cannot draw the 3D tour, so a still image stands in for it.";
    }
    if (!ready) return "The 3D tour is loading.";
    if (reduced) return "The 3D tour is held still because reduced motion is on.";
    if (lowEnd) return "The 3D tour is running in its lighter version for this device.";
    return "The 3D tour is ready.";
  })();

  const atFirst = stop === 0;
  const atLast = stop === TOUR_STOPS.length - 1;

  return (
    <section
      ref={sectionRef}
      aria-label="Guided tour"
      className="relative"
      style={{ height: "600vh" }}
    >
      <div ref={stageRef} className="sticky top-0 h-[100dvh] w-full overflow-hidden">
        {showPoster || !tokens ? (
          <Poster />
        ) : (
          // Loading veil (FM-10): canvas mounts immediately, Poster holds
          // identical pixels until the first frame. No layout shift - the veil
          // and the canvas share the same h-[100dvh] w-full box.
          <div className="relative h-[100dvh] w-full">
            <div className="absolute inset-0">
              <TourCanvas
                progressRef={progressRef.current}
                tokens={tokens}
                frozen={reduced}
                lowEnd={lowEnd}
                wide={wide}
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
          <div className="mat mat-fresnel pointer-events-auto w-full max-w-xl rounded-panel p-6 md:p-8">
            <p className="text-sm font-medium" style={{ color: "var(--accent-primary)" }}>
              {current.kicker}
            </p>
            <div className="mt-3">
              <StopTitle text={current.title} stop={stop} />
            </div>
            <p
              className="mt-4 text-base text-pretty md:text-lg"
              style={{ color: "var(--text-secondary)" }}
            >
              {current.body}
            </p>
          </div>
        </div>

        {/* The stops and the canvas state, announced. Visually hidden, never
            `display:none` - a hidden live region is never announced. */}
        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {`Tour stop ${stop + 1} of ${TOUR_STOPS.length}. ${current.pin}. ${canvasNote}`}
        </p>

        {/* Bottom cluster: stop pins + prev/next when the stops can actually
            change (never on the poster path - a control whose target cannot
            exist is removed, not disabled), the way past the tour always. */}
        <div className="absolute inset-x-0 bottom-5 flex flex-col items-center gap-2 px-6">
          {!showPoster && (
            <>
              <nav aria-label="Tour stops" className="flex flex-wrap justify-center gap-2">
                {TOUR_STOPS.map((s, i) => {
                  const active = i === stop;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => goToStop(i, "push")}
                      aria-current={active ? "step" : undefined}
                      className="min-h-[44px] rounded-full px-4 text-sm font-medium"
                      style={{
                        background: active ? "var(--surface-sheet)" : "transparent",
                        color: active ? "var(--accent-primary)" : "var(--text-secondary)",
                        border: `1px solid ${active ? "var(--accent-primary)" : "var(--border-default)"}`,
                      }}
                    >
                      {s.pin}
                    </button>
                  );
                })}
              </nav>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => goToStop(stop - 1, "push")}
                  disabled={atFirst}
                  className="inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-medium disabled:opacity-50"
                  style={{
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-default)",
                  }}
                >
                  Previous stop
                </button>
                <button
                  type="button"
                  onClick={() => goToStop(stop + 1, "push")}
                  disabled={atLast}
                  className="inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-medium disabled:opacity-50"
                  style={{
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-default)",
                  }}
                >
                  Next stop
                </button>
              </div>
            </>
          )}
          <a href="#tour-access" className="action inline-flex min-h-[44px] items-center text-sm">
            Skip the tour and go to the free plan
          </a>
          <Link href="/" className="action inline-flex min-h-[44px] items-center text-sm">
            Back to the product story
          </Link>
        </div>
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
