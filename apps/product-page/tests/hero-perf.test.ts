// Implements: 20_3D_Product_Page.md §3 (the W6 performance bar) + §3.1 +
// §11.3 (the degradation ladder), and docs/audit/REMEDIATION-PLAN-2026-10-21.md
// row 3.6 (the 3D hero runs at 1.95 FPS).
//
// WHAT THIS IS. The static half of the hero's performance gate. The dynamic
// half is `scripts/measure-hero-fps.mjs --gate`, which measures the real
// frame rate in a real browser - but it needs a production build and a
// browser, so it cannot be the gate that runs on every commit.
//
// These assertions are the cheap half: they pin the four decisions that made
// the hero cost 620 ms a frame instead of 321 ms, so a change that puts one
// of them back is caught by a test that takes a second, with no build and no
// browser.
//
// THE FOUR DECISIONS, AND WHAT EACH ONE COST (measured on the software
// rasteriser, 1440x900, against the same build's reference workload):
//
//   1. THE CONTACT SHADOW IS RENDERED ONCE. drei's <ContactShadows> re-renders
//      the whole scene into a 512x512 depth target and blurs it four times on
//      EVERY frame - five extra render passes for a shadow whose content never
//      changes. The card that casts it floats by 0.12 units inside a 2.5-unit
//      blur; the A/B of the two variants measured a mean channel difference of
//      0.000/255 and a maximum of 1.
//   2. THE ADAPTIVE DPR IS WIRED TO A SIGNAL THAT MOVES. <AdaptiveDpr/> reads
//      `state.performance.current`, which nothing in React Three Fiber ever
//      changes - so the spec's "AdaptiveDpr drops to 0.75" never happened and
//      the scene ran at full resolution on a device that could not afford it.
//      The watchdog (drei's PerformanceMonitor) is what makes the ladder real.
//   3. THE TRANSMISSION CARD GETS ONE SAMPLE UNLESS THE GPU IS DISCRETE. Four
//      samples is three times the fragment cost of one, and the A/B of the two
//      measured a mean channel difference of 0.064/255.
//   4. GSAP IS IMPORTED DYNAMICALLY. The static import put 50.5 KB gzip of
//      scrub library in the INITIAL JavaScript of every visit, including the
//      poster path where the scrub never runs.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");

function source(relative: string): string {
  return readFileSync(resolve(appDir, relative), "utf8");
}

describe("the 3D hero's per-frame cost (20_3D §3, §3.1, §11.3)", () => {
  it("renders the contact shadow ONCE, not once per frame", () => {
    const world = source("src/components/product-3d/World.tsx");
    // `frames={1}` is the switch. Its absence - or `frames={Infinity}` - puts
    // five extra render passes back on every frame.
    expect(world).toMatch(/<ContactShadows[\s\S]*?frames=\{1\}/);
    expect(world).not.toMatch(/frames=\{Infinity\}/);
  });

  it("wires the adaptive DPR to a signal that actually moves", () => {
    const scene = source("src/components/product-3d/ProductScene.tsx");
    // <AdaptiveDpr/> alone is a no-op: `state.performance.current` is pinned at
    // 1 for the whole session because nothing calls
    // `state.performance.regress()`.
    expect(scene).not.toMatch(/import \{[^}]*AdaptiveDpr[^}]*\} from "@react-three\/drei"/);
    // The watchdog that replaces it: a sustained-slow frame rate drops the
    // device pixel ratio to the ladder's floor.
    expect(scene).toMatch(/<PerformanceMonitor/);
    expect(scene).toMatch(/onDecline=/);
    expect(scene).toMatch(/resolveAdaptiveDprFloor/);
  });

  it("gives the transmission card one sample unless the GPU is discrete", () => {
    // The rule itself is unit tested in `scene-tiers.test.ts`; what is pinned
    // here is that the card actually consults it, rather than hard-coding 4.
    const card = source("src/components/product-3d/LedgerCard.tsx");
    expect(card).toMatch(/samples=\{resolveTransmissionSamples\(/);
    expect(card).not.toMatch(/samples=\{4\}/);
  });

  it("keeps GSAP out of the initial JavaScript", () => {
    // A static import puts the scrub library in the initial chunk of every
    // visit - including the poster path, where no trigger is ever created.
    for (const file of [
      "src/components/product-3d/ProductHero.tsx",
      "src/app/tour/_components/tour-experience.tsx",
    ]) {
      const text = source(file);
      expect(text).not.toMatch(/^import gsap from "gsap";$/m);
      expect(text).not.toMatch(/^import \{ ScrollTrigger \} from "gsap\/ScrollTrigger";$/m);
      expect(text).toMatch(/import\("gsap"\)/);
      expect(text).toMatch(/import\("gsap\/ScrollTrigger"\)/);
    }
  });
});
