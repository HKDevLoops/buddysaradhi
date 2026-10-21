// Implements: docs/plans/ANIMATION_MODEL_BRIEF.md §8 (accessibility: the
// fifty beats exist as static HTML, the canvas is aria-hidden, the poster
// veil covers it, reduced motion freezes the scene) and 20_3D_Product_Page.md
// §4 + §12.
//
// WHY THIS FILE EXISTS. The story's claim is that a visitor with no WebGL, no
// JavaScript or a screen reader has read the SAME fifty beats. That is a claim
// about the built HTML, so it is proved against the built HTML - the same way
// `tests/ssr.test.ts` proves the H1 for `/` and `/tour` (FM-13). The wiring
// block below it always runs: it asserts that the veil and the canvas share
// one box, that the canvas is decorative, that the render loop stops when the
// stage leaves the viewport, and that the reduced-motion path holds the scene
// still.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STORY_BEATS } from "../src/components/story/beats";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const buildDir = resolve(appDir, ".next/server/app");

const storyHtmlPath = resolve(buildDir, "story.html");
const HAS_BUILD = existsSync(storyHtmlPath);

function source(relative: string): string {
  return readFileSync(resolve(appDir, relative), "utf8");
}

describe.runIf(HAS_BUILD)("the /story route's static HTML (brief §8)", () => {
  const html = readFileSync(storyHtmlPath, "utf8");

  it("ships exactly one H1, and it is the story's proposition", () => {
    const h1s = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/g) ?? [];
    expect(h1s).toHaveLength(1);
    const text = (h1s[0] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    expect(text).toContain("going wrong");
    expect(text).toContain("going right");
  });

  it("carries all fifty beats as readable HTML", () => {
    for (const beat of STORY_BEATS) {
      expect(html.includes(`id="story-beat-${beat.id}"`)).toBe(true);
      expect(html.includes(beat.caption.title)).toBe(true);
    }
  });

  it("renders the five acts as five static lists", () => {
    expect((html.match(/<ol/g) ?? []).length).toBe(5);
    for (const title of ["The Hunt", "The Chaos", "The Turn", "The Relief", "The Five Screens"]) {
      expect(html.includes(title)).toBe(true);
    }
  });

  it("does not ship a canvas in the server HTML", () => {
    // The canvas is `ssr:false`: it is decoration that arrives after the
    // hydration, and the story is already on the page without it.
    expect(html.includes("<canvas")).toBe(false);
  });

  it("carries the skip link and the primary action", () => {
    expect(html.includes('href="#main"')).toBe(true);
    expect(html.includes("Create your free account")).toBe(true);
  });
});

describe("the story's wiring (brief §7, §8)", () => {
  const experience = source("src/components/story/story-experience.tsx");
  const canvas = source("src/components/story/story-canvas.tsx");

  it("mounts the canvas and the veil in one identical box", () => {
    // FM-10: the veil holds the frame until the first frame is rendered, and
    // the two share a box, so nothing shifts when the veil lifts.
    expect(experience.includes("relative h-[100dvh] w-full")).toBe(true);
    expect(experience.includes("absolute inset-0")).toBe(true);
    expect(experience.includes("{!ready &&")).toBe(true);
  });

  it("keeps the canvas decorative", () => {
    expect(canvas.includes('aria-hidden="true"')).toBe(true);
  });

  it("suspends the render loop when the stage leaves the viewport", () => {
    // FM-16: a page that burns a phone battery rendering an unseen corridor
    // is a bug.
    expect(canvas.includes('frameloop={inView ? "always" : "never"}')).toBe(true);
    expect(experience.includes("new IntersectionObserver")).toBe(true);
    expect(experience.includes("io.disconnect()")).toBe(true);
  });

  it("imports GSAP dynamically, so the poster path never pays for it", () => {
    expect(experience).not.toMatch(/^import gsap from "gsap";$/m);
    expect(experience).toMatch(/import\("gsap"\)/);
    expect(experience).toMatch(/import\("gsap\/ScrollTrigger"\)/);
  });

  it("reverts the ScrollTrigger and refreshes it after the fonts settle", () => {
    // FM-21: a trigger measured before the fonts settle lands in the wrong
    // place, and every beat drifts against the camera with it.
    expect(experience.includes("ctx?.revert()")).toBe(true);
    expect(experience.includes("ScrollTrigger.refresh()")).toBe(true);
    expect(experience.includes("document.fonts") || experience.includes("fonts.ready")).toBe(true);
  });

  it("freezes the scene under reduced motion", () => {
    // The scene is present and completely still: no camera travel, no idle,
    // no particle motion, and the character held in the neutral pose.
    expect(canvas.includes('frozen ? "neutral"')).toBe(true);
    expect(canvas.includes("frozen ? undefined : state.clock.elapsedTime")).toBe(true);
    expect(canvas.includes("<AccentLights tokens={tokens} frozen={frozen} />")).toBe(true);
    expect(canvas.includes("frozen={frozen}")).toBe(true);
  });

  it("caps the device pixel ratio and never raises the budget", () => {
    expect(canvas.includes("resolveDpr(lowEnd, wide, gpuClass)")).toBe(true);
    expect(canvas).not.toMatch(/dpr=\{\[/);
    expect(canvas.includes("STORY_BUDGETS[tier]")).toBe(true);
  });
});
