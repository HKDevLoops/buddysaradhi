"use client";

// Implements: 13_UI_Guidelines.md §7.2 (prefers-reduced-motion is honoured
// unconditionally), AGENTS.md §2 Rule 10 and AP-20, apps/web/DESIGN.md §2
// Anti-Slop #2 ("micro-animations must represent concrete state changes"), and
// craft floor "Motion: one authored moment, not scattered effects".
//
// Why this file had to change in JS, not CSS. `globals.css` already neutralises
// CSS `animation` and `transition` under reduced motion, and it says so — but a
// `requestAnimationFrame` counter is not CSS. The rule shortened the duration of
// transitions and did nothing at all to this component: a tutor with vestibular
// sensitivity watched every dashboard figure count up from zero, 400ms, on every
// re-render, with the OS switch on. So the check has to happen where the frames
// are requested, and the answer is the value itself, immediately — not a
// "reduced" animation.
//
// Both switches are honoured, because the app has two: the OS one
// (`prefers-reduced-motion`) and its own (`html[data-reduced-motion="1"]`, set by
// Settings → Appearance). CSS honours both too; a component that honoured only
// one would honour a setting the stylesheet pretends to honour. Both are
// observed live, so flipping the setting in Settings takes effect without a
// reload.

import React, { useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Is motion currently suppressed? Read imperatively so the animation loop can ask
 * on every frame without becoming a subscriber to two separate sources.
 */
function reducedMotionRequested(): boolean {
  if (typeof window === "undefined") return false;
  if (document.documentElement.getAttribute("data-reduced-motion") === "1") return true;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function CountUp({
  value,
  duration = 400,
  formatFn = (v) => v.toString(),
}: {
  value: number;
  duration?: number;
  formatFn?: (val: number) => string;
}) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (reducedMotionRequested()) {
      setDisplayValue(value);
      return;
    }

    let startTimestamp: number | null = null;
    let rafId = 0;
    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      // easeOutExpo
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplayValue(Math.floor(easeProgress * value));
      if (progress < 1) {
        rafId = window.requestAnimationFrame(step);
      } else {
        setDisplayValue(value);
      }
    };
    rafId = window.requestAnimationFrame(step);

    // Flipping the setting mid-flight must land, not wait for the next value: a
    // running counter that ignores the switch is the exact case this file
    // exists to fix.
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const stopNow = () => {
      window.cancelAnimationFrame(rafId);
      setDisplayValue(value);
    };
    const observer = new MutationObserver(stopNow);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-reduced-motion"],
    });
    mql.addEventListener("change", stopNow);

    return () => {
      observer.disconnect();
      mql.removeEventListener("change", stopNow);
      window.cancelAnimationFrame(rafId);
    };
  }, [value, duration]);

  return <>{formatFn(displayValue)}</>;
}