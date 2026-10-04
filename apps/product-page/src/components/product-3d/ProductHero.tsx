"use client";

// Implements: 20_3D_Product_Page.md (sticky stage + GSAP scrub proxy, 5 beats,
// Poster loading veil per FM-10) + docs/design/overhaul-plan.md §4.1 (front
// door: one clear action) restyled onto the generated tokens.
// The narrative journey is the product's differentiator, so the five beats and
// the pinned stage stay exactly as they were; only the surface language changed.
// Claims-audit pass: the panel carries ONE primary action. The old
// "See the journey" button competed with it at equal weight in the first
// viewport, and a button with that label that jumps 400vh is an action the
// visitor cannot predict (docs/design/marketing-claims-audit.md rows 3–4).
// Funnel pass: that one primary is now free self-serve sign-up, because it is the
// only action on this surface that completes immediately — `POST
// /api/access-request` validates, persists to the console store and returns a
// receipt, while mail delivery to a person is not connected
// (src/app/api/access-request/route.ts). The contracted-plan request
// moved to the quiet text action beside it.
// Way past the story pass: the way past 500vh is now a real anchor link at the
// bottom of the stage, on BOTH canvas paths, so it cannot land a keyboard or
// reduced-motion visitor in 400vh of the same panel. The earlier pass deleted the
// unpredictable 400vh button and nothing replaced it.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Poster } from "./Poster";
import { useLowEnd, useReducedMotion, useSceneTokens, useWebGLAvailable, useWideDesktop } from "./hooks";
import { resolveBeatIndex } from "./scene-tiers";
import {
  APP_SIGNUP_URL,
  CONTRACTED_PLAN_CTA,
  FREE_SIGNUP_CTA,
  FREE_SIGNUP_NOTE,
} from "@/lib/access-request";
import type { ProgressProxy } from "./Journey";

const ProductScene = dynamic(() => import("./ProductScene").then((m) => m.ProductScene), {
  ssr: false,
});

// FM-13: these literals are safe as client state ONLY because the beat-0 H1
// prerenders into the static HTML (this is a client component, but Next still
// emits its initial tree at build time - only the `ssr: false` ProductScene is
// omitted). `tests/ssr.test.ts` asserts an H1 is present in
// `.next/server/app/index.html`; if that test ever goes red, these literals
// must move to server copy first and this comment is wrong.
const BEATS = [
  {
    id: "hook",
    pin: "Hook",
    kicker: "Buddysaradhi. Built in India.",
    title: "Five screens. Seven engines. One ledger. Zero servers to manage.",
    body: "The operating system for private tutors and small coaching institutes. Scroll to walk through it.",
  },
  // "Thirty eight students marked in thirty seconds" was removed from every beat.
// It is an unsourced benchmark, and the one figure in the repo is `06_Attendance.md`
// (3 minutes for a 32-student day view) — a different claim about a different flow.
// The landing page now states the mechanism instead, which is true either way:
// the whole class is one tap from the student list. See
// docs/design/marketing-claims-audit.md row 9.
  {
    id: "exploration",
    pin: "Chaos",
    kicker: "Beat 1. Exploration.",
    title: "The chaos is real.",
    // "Thirty eight students" was removed here too. The figure was never a
    // measurement of anything this repository can produce — it was scene-setting
    // wearing a number's clothes — and an unsourced count is the same defect
    // class as the thirty-second benchmark (audit row 9), so it does not survive
    // just because it is small.
    body: "WhatsApp threads, an Excel sheet, a paper register. Every student somewhere, and no single place they all live.",
  },
  {
    id: "relief",
    pin: "Relief",
    kicker: "Beat 2. Relief.",
    title: "Breathe. It is all in one ledger.",
    body: "Every student is one tap from marked, billed and paid. Every fee recorded, every receipt numbered, nothing editable after the fact.",
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
  const wide = useWideDesktop();
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
          const b = resolveBeatIndex(self.progress, BEATS.length);
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

  /* ---- What a screen reader is told, and when -----------------------------
     The stage re-keys its <h1> on every beat, which animates the letters and
     announces nothing: a visitor listening to this page was pinned to beat 0
     for the whole 500vh section with no signal that four more panels had gone
     past. One polite region carries the beat AND the canvas state, so a
     degradation is announced where the visitor is rather than being a silent
     visual downgrade. `aria-atomic` because these are two facts the listener
     needs together, and `polite` because nothing here is urgent.

     Each sentence is complete and standalone: a listener hears it once, with no
     context, so it names the device state rather than saying "it changed". */
  const canvasNote = (() => {
    if (webgl === null) return "Checking whether this device can show the 3D story.";
    if (saveData) return "Data saver is on, so a still image stands in for the 3D story.";
    if (webgl === false) {
      return "This device cannot draw the 3D story, so a still image stands in for it.";
    }
    if (!ready) return "The 3D story is loading.";
    if (reduced) return "The 3D story is held still because reduced motion is on.";
    if (lowEnd) return "The 3D story is running in its lighter version for this device.";
    return "The 3D story is ready.";
  })();

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
            {/* One primary action, and it is the only thing on this surface that
                completes. A visitor who clicks it is in the app. */}
            <div className="mt-6 flex flex-col items-start gap-3">
              <a href={APP_SIGNUP_URL} className="btn btn-primary text-base" rel="noopener">
                {FREE_SIGNUP_CTA}
              </a>
              <p className="max-w-[46ch] text-sm text-pretty" style={{ color: "var(--text-muted)" }}>
                {FREE_SIGNUP_NOTE}
              </p>
              <Link href="/request-access" className="action inline-flex min-h-[44px] items-center">
                {CONTRACTED_PLAN_CTA}
              </Link>
            </div>
          </div>
        </div>

        {/* The beats and the canvas state, announced. Visually hidden, not
            `display:none`: a hidden live region is not announced, which would
            make this the third silent degradation on a page about not hiding
            things. */}
        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {`Story step ${beat + 1} of ${BEATS.length}. ${current.pin}. ${canvasNote}`}
        </p>

        {/* Bottom of the stage: the pins, when the beats can actually change, and
            the way past the story, always. ONE region holding both, because the
            page allows two floating regions beside the nav
            (material-modes.md §5.2 cap 2) and the overlay panel spends one.

            The way past the story is a real `href`, not a button that calls
            `window.scrollTo`. A 500vh pinned section with no exit is a keyboard
            trap in effect: Tab reaches the pins, Tab reaches the way past, and
            neither of them is a link the browser understands as navigation. An
            in-page anchor needs no JavaScript, works with reduced motion (the
            `scroll-behavior: smooth` in globals.css collapses to `auto` under
            `prefers-reduced-motion`), and lands clear of the sticky header
            because of the container's `scroll-padding-top`.

            It is here, and not only inside the pin row, for the exact reason the
            pins are conditional: on the poster path there are no pins, and that
            is the path a budget phone takes. */}
        <div className="absolute inset-x-0 bottom-5 flex flex-col items-center gap-2 px-6">
          {/* Pins: jump points as DOM buttons (keyboard-safe). Only when the
              beats can actually change. With no WebGL (or Save-Data on) the
              scrub ScrollTrigger never runs, `beat` is pinned at 0, and the
              section is still 500vh — so every pin would scroll a budget-phone
              visitor 400vh into blank space while the same beat-0 copy stayed on
              screen: five controls with no referent. A control whose target
              cannot exist is removed, not disabled. `useLayoutEffect` above
              already early-returns on `showPoster`, so `!showPoster` is exactly
              the condition under which the beats advance. */}
          {!showPoster && (
            <nav aria-label="Story beats" className="flex flex-wrap justify-center gap-2">
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
          )}
          <a href="#access" className="action inline-flex min-h-[44px] items-center text-sm">
            Skip the story and go to the free plan
          </a>
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