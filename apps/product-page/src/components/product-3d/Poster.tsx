// Implements: 20_3D_Product_Page.md §2.2 (the Poster veil) and §3.1 ("no WebGL
// -> poster (static PNG)") + §3 (the poster path budget).
//
// WHAT THIS IS. A real still of THIS scene at beat 0, rendered offline by
// `scripts/generate-poster.mjs` and committed at
// `public/scene/hero-poster.png`. It used to be a flat `--canvas` rectangle,
// which is not a poster - and the no-WebGL path is the one the budget phone
// and the Save-Data visitor take.
//
// HOW IT IS GENERATED (reproducible, committed, no CDN):
//   1. build the app, then
//   2. `node scripts/generate-poster.mjs` launches headless Chromium on the
//      hardware GL path, loads `/` with `prefers-reduced-motion: reduce`
//      (which freezes every animation, so the frame is deterministic), waits
//      for the canvas, and screenshots the CANVAS ELEMENT ONLY.
// The scene is fully procedural and seeded (`ParticleField`, `World`), so
// the render is reproducible: same seed, same camera, same pixels.
//
// WHY THE CAMERA HAS A "COVER" FOV. The poster is a fixed 16:9 image and a
// visitor's viewport is not 16:9, so `resolveCoverFov` narrows the camera by
// exactly the factor `object-fit: cover` crops by. That is what makes the
// veil honest: the still and the live scene are the SAME PICTURE at every
// aspect ratio, so lifting the veil is not a zoom.
//
// RULE 5: no colour literal here. The grain and the vignette are derived from
// token roles (`--canvas`) at paint time, and the grain is an SVG
// `feTurbulence` tile generated in code (src/lib/procedural.ts), so it is a
// real procedural texture with zero bytes of image payload.

import Image from "next/image";
import { POSTER_SRC } from "./scene-tiers";
import { grainTileDataUrl, seedFromString } from "@/lib/procedural";

/**
 * The grain tile, computed ONCE at module scope so the server HTML and the
 * client render the identical string. The seed is derived from a name, not
 * from a counter, so it never drifts.
 */
const GRAIN_TILE = grainTileDataUrl(seedFromString("buddysaradhi/hero-poster-grain"), 128, 0.05);

export function Poster() {
  return (
    <div
      aria-hidden="true"
      className="relative h-[100dvh] w-full overflow-hidden"
      style={{ backgroundColor: "var(--canvas)" }}
    >
      {/*
        The still. `fill` + `object-cover` so it covers the stage box at any
        viewport; `sizes="100vw"` lets the optimiser hand a phone a 640px
        file instead of the desktop one, and `priority` because on the poster
        path this IS the largest contentful paint.
      */}
      <Image
        src={POSTER_SRC}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
        style={{ objectPosition: "50% 50%" }}
      />

      {/*
        The grain. A procedural SVG turbulence tile (no image bytes, no
        request), laid over the still at low opacity so the large flat
        gradients of a WebGL render stop looking like a banding artefact.
      */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: GRAIN_TILE, backgroundRepeat: "repeat" }}
      />

      {/*
        The vignette. It darkens the edges of the frame so the copy panel has
        a predictable, quiet backdrop and the eye is pulled to the middle.
        The colour is `--canvas` mixed toward transparent - a token role, not a
        literal - and it is the same shape the procedural module describes.
      */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 78% 72% at 50% 42%, transparent 34%, color-mix(in oklab, var(--canvas) 82%, transparent) 100%)",
        }}
      />
    </div>
  );
}
