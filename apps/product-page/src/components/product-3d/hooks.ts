"use client";

// Implements: 20_3D_Product_Page.md §3.1 (degradation ladder inputs)

import { useEffect, useState } from "react";

/** Tri-state WebGL gate: null = probing (render poster/veil), false = poster, true = canvas. */
export function useWebGLAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let ok = false;
    try {
      const canvas = document.createElement("canvas");
      ok = !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      ok = false;
    }
    setAvailable(ok);
  }, []);
  return available;
}

/** prefers-reduced-motion → frozen scene (Rule 10, P15). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Low-end gate: Save-Data, weak CPU/RAM, or small viewport → lite scene. */
export function useLowEnd(): boolean {
  const [lowEnd, setLowEnd] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { saveData?: boolean };
    };
    const saveData = nav.connection?.saveData === true;
    const weakCpu = (navigator.hardwareConcurrency ?? 8) <= 4;
    const weakRam = (nav.deviceMemory ?? 8) <= 4;
    const smallScreen = window.innerWidth < 768;
    setLowEnd(saveData || weakCpu || weakRam || smallScreen);
  }, []);
  return lowEnd;
}
