// Implements: docs/plans/ANIMATION_MODEL_BRIEF.md §8 (accessibility: the
// static story, the poster veil, reduced motion, the keyboard target) and §2
// (native scroll is the timeline); 20_3D_Product_Page.md §12 (the `/story`
// expansion).
//
// THE SCROLL IS THE TIMELINE. No scroll-jacking, no hijack, no custom scroll
// container: native document scroll drives ONE normalised progress, and that
// progress is the only clock the story reads. GSAP's ScrollTrigger owns the
// scrub and nothing else - it is already a dependency, and a second animation
// library for one job would be a second owner (brief §0.2).

"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Poster } from "../product-3d/Poster";
import {
  useGpuClass,
  useLowEnd,
  useReducedMotion,
  useSceneTokens,
  useWebGLAvailable,
  useWideDesktop,
} from "../product-3d/hooks";
import { resolveStageMode, storyHeightCss } from "@/lib/stage-mode";
import type { ProgressProxy } from "../product-3d/Journey";
import { APP_SIGNUP_URL, FREE_SIGNUP_CTA, FREE_SIGNUP_NOTE } from "@/lib/access-request";
import { ACT_TITLES, STORY_BEATS, resolveBeatProgress } from "./beats";
import { resolveStoryTier } from "./act-directives";

const StoryCanvas = dynamic(() => import("./story-canvas").then((m) => m.StoryCanvas), {
  ssr: false,
});

/**
 * The scroll runway, in viewport heights.
 *
 * Fifty beats need more room than the hero's five, and less than fifty
 * screens: at 700vh every beat is about fourteen viewport hundredths of
 * scrolling, which is enough to read a caption and short enough that the
 * story does not become a chore.
 */
const STORY_RUNWAY_VH = 700;

export function StoryExperience() {
  const webgl = useWebGLAvailable();
  const reduced = useReducedMotion();
  const lowEnd = useLowEnd();
  const wide = useWideDesktop();
  const gpuClass = useGpuClass();
  const tokens = useSceneTokens();
  const [ready, setReady] = useState(false);
  const [beatIndex, setBeatIndex] = useState(0);
  const [inView, setInView] = useState(true);
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<ProgressProxy>({ current: 0 });

  const saveData =
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ===
      true;
  // The canvas needs real colours, so it cannot mount before the palette has
  // resolved. Until then the poster holds the frame.
  const showPoster = webgl === false || saveData || tokens === null;

  // The stage height: one viewport on the poster path, the runway on the
  // canvas path. The same pure rule the hero and the tour use.
  const stageMode = resolveStageMode(!showPoster, false);
  const storyStyle = { height: storyHeightCss(stageMode, STORY_RUNWAY_VH) };

  // Scrub proxy: the section's scroll becomes 0..1. Killed on unmount
  // (FM-15). GSAP is imported DYNAMICALLY, for the same reason as the hero:
  // the poster path never creates a trigger, so it must never pay for the
  // scrub library.
  useLayoutEffect(() => {
    if (showPoster) return;
    let cancelled = false;
    let ctx: { revert: () => void } | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      const [{ default: gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      ctx = gsap.context(() => {
        ScrollTrigger.create({
          trigger: sectionRef.current,
          start: "top top",
          end: "bottom bottom",
          scrub: 1,
          onUpdate: (self) => {
            progressRef.current.current = self.progress;
            const { index } = resolveBeatProgress(self.progress);
            setBeatIndex((previous) => (previous === index ? previous : index));
          },
        });
      }, sectionRef);
      // FM-21: a trigger measured before the fonts and the late assets
      // settle lands in the wrong place, and every beat drifts against the
      // camera with it.
      refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 600);
      const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
      if (fonts) {
        fonts.ready.then(() => ScrollTrigger.refresh());
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(refreshTimer);
      ctx?.revert();
    };
  }, [showPoster]);

  // Suspend the render loop off-screen (FM-16): the loop never runs when the
  // stage leaves the viewport.
  useEffect(() => {
    const element = stageRef.current;
    if (!element || showPoster) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0,
    });
    io.observe(element);
    return () => io.disconnect();
  }, [showPoster]);

  const beat = STORY_BEATS[beatIndex];
  const tier = resolveStoryTier(lowEnd, gpuClass);

  const canvasNote = (() => {
    if (webgl === null) return "Checking whether this device can show the 3D story.";
    if (saveData) return "Data saver is on, so a still image stands in for the 3D story.";
    if (webgl === false) {
      return "This device cannot draw the 3D story, so a still image stands in for it.";
    }
    if (!ready) return "The 3D story is loading.";
    if (reduced) return "The 3D story is held still because reduced motion is on.";
    return `The 3D story is ready, in its ${tier} version for this device.`;
  })();

  return (
    <section
      ref={sectionRef}
      aria-label="The story"
      className="story-stage relative"
      style={storyStyle}
    >
      <div ref={stageRef} className="sticky top-0 h-[100dvh] w-full overflow-hidden">
        {showPoster || !tokens ? (
          <Poster />
        ) : (
          // The loading veil (FM-10): the canvas mounts immediately and the
          // poster holds identical pixels until the first frame. The two share
          // one box, so nothing shifts.
          <div className="relative h-[100dvh] w-full">
            <div className="absolute inset-0">
              <StoryCanvas
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

        {/*
          The caption. It is the accessible surface: the canvas is
          aria-hidden, so the words the visitor reads are the words a screen
          reader reads. The panel scrolls internally on a short viewport
          instead of overlapping the cluster below it.
        */}
        <div className="pointer-events-none absolute inset-0 flex min-h-0 flex-col justify-center px-6 pt-6 pb-44 md:px-12 md:pt-[5.5rem] md:pb-40">
          <div className="mat mat-copy mat-fresnel rounded-panel pointer-events-auto max-h-full w-full max-w-xl overflow-y-auto p-6 md:p-8">
            <p className="text-sm font-medium" style={{ color: "var(--accent-primary)" }}>
              {`Act ${beat.act}. ${ACT_TITLES[beat.act]}. Beat ${beatIndex + 1} of ${STORY_BEATS.length}.`}
            </p>
            <h2 className="font-display mt-3 text-2xl leading-tight font-bold text-balance md:text-4xl">
              {beat.caption.title}
            </h2>
            <p
              className="mt-4 text-base text-pretty md:text-lg"
              style={{ color: "var(--text-secondary)" }}
            >
              {beat.caption.body}
            </p>
            <div className="mt-6 flex flex-col items-start gap-3">
              <a href={APP_SIGNUP_URL} className="btn btn-primary text-base" rel="noopener">
                {FREE_SIGNUP_CTA}
              </a>
              <p
                className="max-w-[46ch] text-sm text-pretty"
                style={{ color: "var(--text-muted)" }}
              >
                {FREE_SIGNUP_NOTE}
              </p>
            </div>
          </div>
        </div>

        {/* The beat and the canvas state, announced. Visually hidden, never
            `display:none`: a hidden live region is never announced. */}
        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {`Beat ${beatIndex + 1} of ${STORY_BEATS.length}. ${beat.caption.title}. ${beat.caption.body} ${canvasNote}`}
        </p>

        {/* The way past the story is a real anchor, not a button that calls
            `window.scrollTo`: a 700vh pinned section with no exit is a
            keyboard trap in effect. */}
        <div className="absolute inset-x-0 bottom-5 flex flex-col items-center gap-2 px-6">
          <a href="#story-acts" className="action inline-flex min-h-[44px] items-center text-sm">
            Read the whole story as text
          </a>
          <Link href="/" className="action inline-flex min-h-[44px] items-center text-sm">
            Back to the front door
          </Link>
        </div>
      </div>
    </section>
  );
}
