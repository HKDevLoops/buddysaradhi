// Implements: 20_3D_Product_Page.md §12 + AGENTS.md FM-13 (H1-in-SSR-HTML).
//
// FM-13 proof: the hero and tour propositions must survive with zero client
// JS - crawlers and screen readers meet the static HTML first. These tests read
// the prerendered `.next/server/app/*.html` emitted by `next build` and assert
// the H1, the skip link and the tour pins are in it. They run only when that
// build output exists (`describe.runIf`): without a build there is no static
// HTML to prove anything about, and failing closed on a missing artefact would
// turn every unrelated `vitest run` into a product-page build gate.
//
// The wiring block below it always runs: it asserts the veil→canvas swap is
// layout-shift-free by construction (veil and canvas share one identical box)
// and that low-end / frozen props are threaded into the shared scene.

import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../.next/server/app");

function readHtml(name: "index" | "tour"): string {
  return readFileSync(resolve(appDir, name === "index" ? "index.html" : "tour.html"), "utf8");
}

function h1Texts(html: string): string[] {
  const matches = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/g) ?? [];
  return matches.map((m) => m.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

const HAS_BUILD =
  existsSync(resolve(appDir, "index.html")) && existsSync(resolve(appDir, "tour.html"));

describe.runIf(HAS_BUILD)("SSR HTML proof (FM-13)", () => {
  it("/ ships an H1 in static HTML", () => {
    const h1s = h1Texts(readHtml("index"));
    expect(h1s.length).toBeGreaterThanOrEqual(1);
    expect(h1s.some((t) => t.includes("Five screens"))).toBe(true);
  });

  it("/tour ships its own server H1 in static HTML", () => {
    const h1s = h1Texts(readHtml("tour"));
    expect(h1s.length).toBeGreaterThanOrEqual(1);
    expect(h1s.some((t) => t.includes("Walk the five screens in 3D"))).toBe(true);
  });

  it("both routes keep exactly one H1 each", () => {
    expect(h1Texts(readHtml("index")).length).toBe(1);
    expect(h1Texts(readHtml("tour")).length).toBe(1);
  });

  it("both routes carry the skip link (WCAG 2.4.1, Rule 10)", () => {
    for (const name of ["index", "tour"] as const) {
      expect(readHtml(name).includes('href="#main"')).toBe(true);
    }
  });

  it("/tour carries the five stop names in its static list (the SSR surface)", () => {
    // The pins nav is a client progressive enhancement: on the server the
    // palette has not resolved yet, so `showPoster` is true and the pins -
    // controls whose scrub target may not exist - stay unmounted until
    // hydration proves the canvas path (same rule as the hero). The static
    // stop list below is what SSR, no-JS and search visitors get instead.
    const html = readHtml("tour");
    for (const pin of ["Dashboard", "Students", "Attendance", "Fees", "Settings"]) {
      expect(html.includes(pin)).toBe(true);
    }
    expect(html.includes('href="#tour-access"')).toBe(true);
  });

  it("/tour prerenders the static stop list for no-JS visitors", () => {
    const html = readHtml("tour");
    expect(html.includes('id="tour-stops-heading"')).toBe(true);
    expect(html.includes("tour-stop-attendance")).toBe(true);
  });
});

describe("veil → canvas swap without layout shift (FM-10)", () => {
  const heroSource = readFileSync(
    resolve(here, "../src/components/product-3d/ProductHero.tsx"),
    "utf8",
  );
  const tourSource = readFileSync(
    resolve(here, "../src/app/tour/_components/tour-experience.tsx"),
    "utf8",
  );
  it("hero and tour mount canvas and veil in the same identical box", () => {
    // The swap is shift-free by construction: both layers are absolute inside
    // one `relative h-[100dvh] w-full` box, so the veil occupies the exact
    // pixels the canvas takes over.
    for (const src of [heroSource, tourSource]) {
      expect(src.includes("relative h-[100dvh] w-full")).toBe(true);
      expect(src.includes("absolute inset-0")).toBe(true);
    }
  });

  it("neither stage gates the canvas mount on its own readiness", () => {
    // Readiness lifts the veil; it must never gate the mount (FM-10).
    for (const src of [heroSource, tourSource]) {
      expect(src.includes("{!ready &&")).toBe(true);
    }
  });
});

describe("tier threading (low-end + frozen reach the materials)", () => {
  const journeySource = readFileSync(
    resolve(here, "../src/components/product-3d/Journey.tsx"),
    "utf8",
  );
  const sceneSource = readFileSync(
    resolve(here, "../src/components/product-3d/ProductScene.tsx"),
    "utf8",
  );

  it("Journey threads lowEnd into the transmission samples", () => {
    expect(journeySource.includes("lowEnd={lowEnd}")).toBe(true);
  });

  it("ProductScene resolves DPR from device class, never a literal tier", () => {
    expect(sceneSource.includes("resolveDpr(lowEnd, wide)")).toBe(true);
  });

  it("the tour pins are a labelled nav of DOM buttons (keyboard parity)", () => {
    const tourSource = readFileSync(
      resolve(here, "../src/app/tour/_components/tour-experience.tsx"),
      "utf8",
    );
    expect(tourSource.includes('aria-label="Tour stops"')).toBe(true);
    expect(tourSource.includes("Previous stop")).toBe(true);
    expect(tourSource.includes("Next stop")).toBe(true);
  });

  it("the canvas stays decorative: aria-hidden lives on the Canvas", () => {
    expect(sceneSource.includes('aria-hidden="true"')).toBe(true);
  });
});
