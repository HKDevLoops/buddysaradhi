#!/usr/bin/env node
// Implements: AGENTS.md §2 Rule 10 (WCAG 2.1 AA, measured - not eyeballed) and
// 13_UI_Guidelines.md §10, for the ONE place on this site where text sits over
// a live, moving, WebGL backdrop.
//
// WHY THIS TOOL EXISTS. The hero copy panel is a TRANSLUCENT surface:
// `--surface-overlay` is `rgb(28 29 32 / 0.34)` in the inked palette, so the
// text colour is composited over 66% of whatever the 3D scene is painting
// behind it. A contrast check against the TOKEN (the panel colour on its own)
// proves nothing: the real backdrop is an animated scene that swings from a
// near-black alley to an accent-bright glass card, and the composite is a
// different colour on every frame.
//
// So this measures the composite the way a screen reader's eye would meet it:
//   1. screenshot the CANVAS (the scene) with the DOM overlay removed,
//   2. read the panel's real background colour and alpha from the computed
//      style,
//   3. composite: effective = alpha * panelRGB + (1 - alpha) * sceneRGB,
//   4. take the WORST pixel under each text box and compute the WCAG ratio
//      against that text's real colour.
//
// It walks every beat of the story, because the backdrop changes as the
// camera moves, and it fails (exit 1) if any pairing is below 4.5:1.
//
// MEASURED, NOT ASSUMED. Run it and read the numbers.
//
//   node scripts/measure-hero-contrast.mjs
//   node scripts/measure-hero-contrast.mjs --url http://127.0.0.1:3003
//
// It needs a production build and a running server; it starts one itself if it
// can. The exit code is the gate, so it can be wired into CI.

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const repoRoot = resolve(appDir, "../..");

const PORT = Number.parseInt(process.env.CONTRAST_PORT ?? "3312", 10);
const urlArg = process.argv.find((a) => a.startsWith("--url="))?.slice(6);
const BASE = urlArg ?? `http://127.0.0.1:${PORT}`;

const WCAG_AA_TEXT = 4.5;

function rootRequire(name) {
  const require = createRequire(resolve(repoRoot, "package.json"));
  return require(name);
}

const log = (m) => process.stdout.write(`${m}\n`);

/** WCAG 2.1 relative luminance + contrast ratio, on 0..255 sRGB channels. */
function relativeLuminance(r, g, b) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a[0], a[1], a[2]);
  const lb = relativeLuminance(b[0], b[1], b[2]);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

function parseRgb(value) {
  const m = /rgba?\(([^)]+)\)/.exec(value);
  if (m === null) return null;
  const parts = (m[1] ?? "").split(",").map((p) => Number.parseFloat(p.trim()));
  const [r, g, b] = parts;
  const a = parts.length > 3 ? parts[3] : 1;
  if ([r, g, b, a].some((n) => !Number.isFinite(n))) return null;
  return { rgb: [r, g, b], alpha: a };
}

async function waitForServer(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(target, { signal: AbortSignal.timeout(4000) });
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
    throw new Error("no production build; run `bun run build` in apps/product-page first");
  }
  const nextBin = resolve(repoRoot, "node_modules/next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
    cwd: appDir,
    stdio: "ignore",
  });
  if (!(await waitForServer(BASE, 60000))) {
    child.kill();
    throw new Error(`the server did not come up at ${BASE}`);
  }
  return child;
}

async function main() {
  const { chromium } = rootRequire("playwright");
  const sharp = rootRequire("sharp");

  const server = await startServer();
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=d3d11", "--hide-scrollbars"],
  });

  const failures = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForSelector("canvas", { timeout: 60000 });
    // The veil must be gone: the scene, not the poster, is the backdrop.
    await page.waitForFunction(
      () => document.querySelectorAll('[aria-label="Product story"] img').length === 0,
      { timeout: 60000 },
    );
    await page.waitForTimeout(2000);

    const canvas = page.locator('[aria-label="Product story"] canvas').first();
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error("the canvas has no layout box");

    // The panel geometry and each text run's colour.
    const probe = async () => {
      return page.evaluate(() => {
        const stage = document.querySelector('[aria-label="Product story"]');
        const panel = stage?.querySelector(".mat");
        if (!panel) return null;
        const style = getComputedStyle(panel);
        const panelBox = panel.getBoundingClientRect();
        const header = document.querySelector("header");
        const headerBox = header ? header.getBoundingClientRect() : { top: 0, bottom: 0, height: 0 };
        const section = document.querySelector('[aria-label="Product story"]');
        const stageEl = section?.querySelector(":scope > div");
        const stageBox = stageEl ? stageEl.getBoundingClientRect() : null;
        const stageStyle = stageEl ? getComputedStyle(stageEl) : null;
        const texts = [];
        for (const node of panel.querySelectorAll("p, h1, a, button")) {
          const box = node.getBoundingClientRect();
          if (box.width < 1 || box.height < 1) continue;
          const cs = getComputedStyle(node);
          texts.push({
            tag: node.tagName.toLowerCase(),
            text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 52),
            color: cs.color,
            box: { x: box.x, y: box.y, width: box.width, height: box.height },
          });
        }
        return {
          panel: {
            background: style.backgroundColor,
            x: panelBox.x,
            y: panelBox.y,
            width: panelBox.width,
            height: panelBox.height,
          },
          header: { top: headerBox.top, bottom: headerBox.bottom, height: headerBox.height },
          layout: {
            dataStage: document.documentElement.getAttribute("data-stage"),
            sectionHeight: section ? section.getBoundingClientRect().height : 0,
            stageTop: stageBox ? stageBox.top : 0,
            stagePosition: stageStyle ? stageStyle.position : "unknown",
            scrollY: window.scrollY,
            docHeight: document.documentElement.scrollHeight,
          },
          texts,
        };
      });
    };

    // Walk the story. The backdrop changes with the camera, so every beat is
    // measured; the camera is driven through the real scroll, not a mock.
    //
    // The stops stop at 0.8 on purpose: the stage is `sticky top-0` inside a
    // 500vh section, so it stops being pinned once the last 100vh of the
    // section scrolls past - and a panel that has scrolled off the screen is
    // not a backdrop a reader ever sees.
    const beats = [0, 0.2, 0.4, 0.6, 0.8];
    const stage = page.locator('[aria-label="Product story"]');
    const stageBox = await stage.boundingBox();

    for (const [index, progress] of beats.entries()) {
      await page.evaluate(
        ({ top, height, p }) => {
          const max = document.documentElement.scrollHeight - window.innerHeight;
          const target = top + height * p;
          window.scrollTo({ top: Math.min(target, max), behavior: "auto" });
        },
        { top: stageBox.y, height: stageBox.height, p: progress },
      );
      // The scrub proxy is damped; give the camera time to arrive.
      await page.waitForTimeout(1800);

      const info = await probe();
      if (!info) continue;

      // THE EXACT MEASUREMENT. Instead of modelling how the panel, the
      // backdrop-filter blur, the fresnel gradient, the button fills and the
      // 3D scene combine (a model that is only as good as its assumptions),
      // this paints the page TWICE:
      //   1. as the visitor sees it, and
      //   2. with every text run in the panel set to `color: transparent`,
      //      which removes the glyphs but leaves every background, every
      //      filter and every layer exactly where it is.
      // The second screenshot IS the backdrop the text sits on, pixel for
      // pixel, in the browser's own compositor.
      const painted = await page.screenshot({ type: "png" });
      await page.addStyleTag({
        content: `
          [aria-label="Product story"] .mat, [aria-label="Product story"] .mat * { transition: none !important; animation: none !important; }
          /* The scatter-in headline animates from opacity 0. Disabling the
             animation would leave the H1 INVISIBLE, and an invisible headline
             is not a measurement - so the animation is forced to its end
             state instead. */
          [aria-label="Product story"] .scatter-char { opacity: 1 !important; transform: none !important; }
        `,
      });
      await page.evaluate(() => {
        for (const node of document.querySelectorAll(
          '[aria-label="Product story"] .mat p, [aria-label="Product story"] .mat h1, [aria-label="Product story"] .mat a, [aria-label="Product story"] .mat button, [aria-label="Product story"] .mat span',
        )) {
          node.style.setProperty("color", "transparent", "important");
        }
      });
      // Two frames: the colour override must be PAINTED, not merely set. The
      // buttons carry a 140ms `color` transition, so without this the glyphs
      // were still fading out when the shutter opened and the measurement
      // read the text colour as if it were the backdrop.
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      const backdropPng = await page.screenshot({ type: "png" });
      await page.evaluate(() => {
        for (const node of document.querySelectorAll(
          '[aria-label="Product story"] .mat p, [aria-label="Product story"] .mat h1, [aria-label="Product story"] .mat a, [aria-label="Product story"] .mat button, [aria-label="Product story"] .mat span',
        )) {
          node.style.removeProperty("color");
        }
      });

      const raw = await sharp(backdropPng).raw().toBuffer({ resolveWithObject: true });
      const { width, height, channels } = raw.info;
      const paintedRaw = await sharp(painted).raw().toBuffer({ resolveWithObject: true });

      const panel = parseRgb(info.panel.background);
      if (!panel) throw new Error(`could not read the panel background: ${info.panel.background}`);

      log(`\n--- beat ${index + 1} (scroll ${Math.round(progress * 100)}%) ---`);
      log(`panel background ${info.panel.background} (alpha ${panel.alpha})`);
      log(
        `geometry: panel x=${Math.round(info.panel.x)} y=${Math.round(info.panel.y)} ` +
          `w=${Math.round(info.panel.width)} h=${Math.round(info.panel.height)} | ` +
          `header h=${Math.round(info.header.height)} bottom=${Math.round(info.header.bottom)}`,
      );
      log(
        `layout: data-stage=${info.layout.dataStage} section h=${Math.round(info.layout.sectionHeight)} ` +
          `stage top=${Math.round(info.layout.stageTop)} stage pos=${info.layout.stagePosition} ` +
          `scrollY=${Math.round(info.layout.scrollY)} docH=${Math.round(info.layout.docHeight)}`,
      );
      if (info.panel.y < info.header.bottom) {
        log(`  NOTE: the panel starts ${Math.round(info.header.bottom - info.panel.y)}px INSIDE the header band.`);
      }

      for (const t of info.texts) {
        const text = parseRgb(t.color);
        if (!text) continue;
        let worst = Infinity;
        let worstPixel = null;
        let considered = 0;
        // Sample ONLY the pixels the glyphs actually occupy.
        //
        // The element's whole box is not the right area: a rounded button
        // shows the panel through its corner pixels, and a paragraph's box
        // includes leading that no letter ever touches. The glyph mask is
        // the difference between the painted page and the same page with the
        // text made transparent, so it is exactly "where the text is".
        const x0 = Math.max(0, Math.floor(t.box.x));
        const y0 = Math.max(0, Math.floor(t.box.y));
        const x1 = Math.min(width, Math.ceil(t.box.x + t.box.width));
        const y1 = Math.min(height, Math.ceil(t.box.y + t.box.height));
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const i = (y * width + x) * channels;
            const bg = [raw.data[i], raw.data[i + 1], raw.data[i + 2]];
            const p = [
              paintedRaw.data[i],
              paintedRaw.data[i + 1],
              paintedRaw.data[i + 2],
            ];
            const delta = Math.max(
              Math.abs(p[0] - bg[0]),
              Math.abs(p[1] - bg[1]),
              Math.abs(p[2] - bg[2]),
            );
            if (delta < 12) continue; // no glyph here
            considered += 1;
            const ratio = contrastRatio(bg, text.rgb);
            if (ratio < worst) {
              worst = ratio;
              worstPixel = bg;
            }
          }
        }
        if (!Number.isFinite(worst)) continue;
        const verdict = worst >= WCAG_AA_TEXT ? "PASS" : "FAIL";
        log(
          `${verdict}  ${worst.toFixed(2)}:1  ${t.tag} "${t.text}"  ` +
            `(text ${t.color}, worst backdrop rgb(${worstPixel.join(",")}), ${considered} glyph pixels)`,
        );
        if (worst < WCAG_AA_TEXT) {
          failures.push({ beat: index + 1, tag: t.tag, text: t.text, ratio: Number(worst.toFixed(2)) });
        }
      }
      void paintedRaw;
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  log("");
  if (failures.length > 0) {
    log(`FAIL: ${failures.length} pairing(s) below ${WCAG_AA_TEXT}:1 against the LIVE scene.`);
    for (const f of failures) log(`  beat ${f.beat}  ${f.ratio}:1  ${f.tag} "${f.text}"`);
    process.exitCode = 1;
  } else {
    log(`PASS: every measured pairing meets ${WCAG_AA_TEXT}:1 against the LIVE scene.`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
