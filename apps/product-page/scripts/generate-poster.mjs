#!/usr/bin/env node
// Implements: 20_3D_Product_Page.md §2.2 (the Poster veil holds IDENTICAL
// pixels until the first frame) and §3.1 ("no WebGL -> poster (static PNG)").
//
// WHAT THIS IS. The poster used to be a flat colour rectangle. It is now a
// STILL OF THIS SCENE at beat 0, rendered by the same code that draws the
// live scene, so the still and the scene can never be two different pictures.
//
// HOW IT WORKS. Headless Chromium with the SwiftShader software rasteriser
// loads the built site, waits for the canvas to draw, removes the DOM overlay
// (the copy panel, the header, the beat pins) and screenshots the CANVAS
// ELEMENT. That is the scene, at beat 0, through the real camera.
//
// WHY IT IS DETERMINISTIC. The page is loaded with
// `prefers-reduced-motion: reduce`, which the hero honours by FREEZING the
// scene (`resolveFloatProps` -> all zeros, no orbit, no float, no clock). The
// scene's own randomness is seeded (`ParticleField` and `World` both use a
// fixed-seed LCG), so nothing in the frame varies between runs.
//
// REPRODUCIBILITY. `node scripts/generate-poster.mjs` needs a production build
// and a running server; it starts one itself if it can. The output is
// committed at `public/scene/hero-poster.png`. The script prints the SHA-256
// so a re-run that drifts is visible in the diff.
//
// NO NETWORK, NO CDN, NO STOCK IMAGE, NO NEW DEPENDENCY. Playwright and sharp
// are already in the repository root's toolchain; this script resolves them
// from the root's `node_modules` so `apps/product-page/package.json` and the
// lockfile are untouched.
//
// PALETTE NOTE. The scene reads its colours from the generated token roles,
// so the poster is a still of the ACTIVE palette (`inked` today). If the
// palette changes, re-run this script. The script says so loudly if the
// palette is not the one the committed asset was rendered with.

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const repoRoot = resolve(appDir, "../..");
const outPath = resolve(appDir, "public/scene/hero-poster.png");

const VIEWPORT = { width: 1600, height: 900 }; // 16:9 - the poster's aspect
const PORT = Number.parseInt(process.env.POSTER_PORT ?? "3311", 10);
const BASE = process.env.POSTER_URL ?? `http://127.0.0.1:${PORT}`;
const EXPECTED_PALETTE = process.env.POSTER_PALETTE ?? "inked";
/** 20_3D §3: "poster path < 200 KB". */
const BUDGET_BYTES = 200 * 1024;

/** Resolve a tool from the REPOSITORY ROOT toolchain, not from this app. */
function rootRequire(name) {
  const require = createRequire(resolve(repoRoot, "package.json"));
  return require(name);
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function waitForServer(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function startServer() {
  if (await waitForServer(BASE, 1500)) {
    log(`server already up at ${BASE}`);
    return null;
  }
  if (!existsSync(resolve(appDir, ".next/BUILD_ID"))) {
    throw new Error(
      "No production build found. Run `bun run build` in apps/product-page first " +
        "(the poster must be a still of the SHIPPED build, not of a dev server).",
    );
  }
  log(`starting a production server on ${PORT} ...`);
  // The Next binary is resolved from the REPOSITORY ROOT toolchain, so this
  // script needs no dependency of its own and the lockfile is untouched.
  const nextBin = resolve(repoRoot, "node_modules/next/dist/bin/next");
  if (!existsSync(nextBin)) {
    throw new Error(`the Next.js binary is not at ${nextBin}; run the repo install first`);
  }
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
    cwd: appDir,
    stdio: "ignore",
  });
  const up = await waitForServer(BASE, 60000);
  if (!up) {
    child.kill();
    throw new Error(`the server did not come up at ${BASE}`);
  }
  return child;
}

async function main() {
  const { chromium } = rootRequire("playwright");
  let sharp;
  try {
    sharp = rootRequire("sharp");
  } catch {
    sharp = null;
    log("sharp is not available in the repo toolchain; the PNG will not be re-encoded.");
  }

  const server = await startServer();

  // A REAL GPU FIRST. The transmissive ledger card renders through a
  // multisampled render target, and the software rasteriser does not
  // reproduce it: under SwiftShader the card comes out as a black rectangle
  // that a visitor would never see. The poster has to be the picture a
  // visitor's browser draws, so the hardware path is preferred and the
  // software path is only a fallback (and the script says which one ran).
  const GL_MODES = [
    { name: "hardware (ANGLE/D3D11)", args: ["--use-gl=angle", "--use-angle=d3d11"] },
    { name: "software (SwiftShader)", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  ];
  let browser = null;
  let renderer = "";
  for (const mode of GL_MODES) {
    const candidate = await chromium.launch({ args: [...mode.args, "--hide-scrollbars"] });
    const probe = await candidate.newPage();
    const info = await probe.evaluate(() => {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      if (!gl) return null;
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    });
    await probe.close();
    if (info) {
      browser = candidate;
      renderer = info;
      log(`renderer: ${mode.name} -> ${info}`);
      break;
    }
    await candidate.close();
  }
  if (!browser) throw new Error("no WebGL renderer was available");
  if (/swiftshader/i.test(renderer)) {
    log("WARNING: the software rasteriser is in use. The transmissive card does not");
    log("         render correctly under it, so this poster is NOT what a visitor sees.");
  }

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      colorScheme: "dark",
    });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 90000 });

    const palette = await page.getAttribute("html", "data-palette");
    if (palette !== EXPECTED_PALETTE) {
      log(
        `WARNING: the active palette is "${palette}", not "${EXPECTED_PALETTE}". ` +
          "The poster is a still of the ACTIVE palette - re-run this script and commit the result.",
      );
    }

    // The canvas must exist AND must have drawn. The hero renders <Poster/>
    // until the first frame, so waiting for the canvas alone would capture the
    // veil. The veil lifts when the scene reports ready, which removes the
    // poster overlay - so the poster image must be gone before the capture.
    await page.waitForSelector("canvas", { timeout: 60000 });
    await page.waitForFunction(
      () => {
        const stage = document.querySelector('[aria-label="Product story"]');
        if (!stage) return false;
        const imgs = Array.from(stage.querySelectorAll("img"));
        return imgs.length === 0;
      },
      { timeout: 60000 },
    );
    // Let the scene settle: the transmission material, the contact shadows
    // and the adaptive DPR all need a few frames to reach their resting state.
    await page.waitForTimeout(2500);

    // Remove the DOM overlay so the capture is the SCENE and nothing else.
    // (An element screenshot clips to the element's box but still composites
    // whatever is painted on top of it.)
    await page.evaluate(() => {
      const kill = (selector) => {
        document.querySelectorAll(selector).forEach((node) => node.remove());
      };
      kill("header");
      kill('[aria-label="Product story"] .pointer-events-none');
      kill('[aria-label="Product story"] .absolute.inset-x-0');
      kill("footer");
    });
    await page.waitForTimeout(250);

    const canvas = page.locator('[aria-label="Product story"] canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("the canvas has no layout box");
    log(`capturing the canvas at ${Math.round(box.width)}x${Math.round(box.height)} ...`);

    const raw = await canvas.screenshot({ type: "png", animations: "disabled" });

    mkdirSync(dirname(outPath), { recursive: true });
    let bytes = raw;
    if (sharp) {
      // Re-encode: quantise to a palette so the file fits the 20_3D §3
      // "poster path < 200 KB" budget without blurring the gradient. A WebGL
      // frame of fog and glass is mostly smooth gradients, which quantise
      // well; the dithering option keeps the banding out of the fog.
      const encoded = await sharp(raw)
        .resize({ width: VIEWPORT.width, height: VIEWPORT.height, fit: "cover" })
        .png({ quality: 82, palette: true, effort: 10, dither: 1.0 })
        .toBuffer();
      bytes = encoded;
    }
    writeFileSync(outPath, bytes);

    const sha = createHash("sha256").update(bytes).digest("hex");
    log(`wrote ${outPath}`);
    log(`bytes: ${bytes.length} (budget ${BUDGET_BYTES})`);
    log(`sha256: ${sha}`);
    if (bytes.length > BUDGET_BYTES) {
      log("WARNING: the poster is over the 20_3D §3 budget of 200 KB.");
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
