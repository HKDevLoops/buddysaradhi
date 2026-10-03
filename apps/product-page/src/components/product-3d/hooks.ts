"use client";

// Implements: 20_3D_Product_Page.md §3.1 (degradation ladder inputs) and
// docs/design/overhaul-plan.md §4.1 (the scene reads the ACTIVE palette from
// the generated tokens instead of hardcoded colours).

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

/** The palette values the WebGL scene needs. No literals: three.js needs real
 * colours, not `var(--x)`, so they are read from the generated stylesheet. */
export interface SceneTokens {
  readonly canvas: string;
  readonly sunken: string;
  readonly inset: string;
  readonly row: string;
  readonly raised: string;
  readonly accent: string;
  readonly accentText: string;
  readonly ok: string;
  readonly info: string;
  readonly warn: string;
}

const SCENE_TOKEN_NAMES: Readonly<Record<keyof SceneTokens, string>> = {
  canvas: "--canvas",
  sunken: "--surface-sunken",
  inset: "--surface-inset",
  row: "--surface-row",
  raised: "--surface-raised",
  accent: "--accent-primary",
  accentText: "--accent-text",
  ok: "--success",
  info: "--info",
  warn: "--warning",
};

/**
 * Reads the active palette from the document. Returns `null` until every token
 * resolves, so the caller can hold the Poster rather than mount a canvas with
 * invented colours (docs/design/overhaul-plan.md §8.2: zero references to the
 * retired palette remain).
 */
export function useSceneTokens(): SceneTokens | null {
  const [tokens, setTokens] = useState<SceneTokens | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const computed = getComputedStyle(root);
      const entries = Object.entries(SCENE_TOKEN_NAMES).map(([key, name]) => [
        key,
        computed.getPropertyValue(name).trim(),
      ]) as Array<[keyof SceneTokens, string]>;
      const complete = entries.every(([, value]) => value.length > 0);
      const next: SceneTokens | null = complete
        ? Object.fromEntries(entries) as unknown as SceneTokens
        : null;
      setTokens((prev) => (shallowEqual(prev, next) ? prev : next));
    };
    read();

    // A palette or material switch must retheme the scene.
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-palette", "data-material"] });
    return () => observer.disconnect();
  }, []);

  return tokens;
}

function shallowEqual(a: SceneTokens | null, b: SceneTokens | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (Object.keys(SCENE_TOKEN_NAMES) as Array<keyof SceneTokens>).every((k) => a[k] === b[k]);
}