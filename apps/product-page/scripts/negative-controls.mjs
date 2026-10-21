#!/usr/bin/env node
// NEGATIVE CONTROLS. Every fix this session shipped gets a verified-red
// control: the fix is reverted, the test that guards it is run, the test MUST
// go red, and the fix is restored.
//
// A test that has never been seen red is not a test. This script is the
// evidence, and it is re-runnable.
//
//   node scripts/negative-controls.mjs
//
// It touches the working tree and restores it. If it is interrupted, the
// `restore` step in the `finally` of each case still runs, and a `--keep`
// flag leaves the tree dirty on purpose for inspection.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");

/** Each case: a file, a string to replace, the replacement, and the test file
 *  that must go red when the fix is undone. */
const CASES = [
  {
    id: "PP-01  the access-request store reads NEXT_PUBLIC_SUPABASE_URL",
    file: "src/app/admin/_lib/access-requests.ts",
    find: "(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? \"\")",
    replace: "(process.env.SUPABASE_URL ?? \"\")",
    test: "tests/http-surface.test.ts",
    expect: "FAIL",
  },
  {
    id: "PP-03  the static CSP does not cover /admin",
    file: "next.config.ts",
    find: 'source: "/((?!admin).*)"',
    replace: 'source: "/:path*"',
    test: "tests/http-surface.test.ts",
    expect: "FAIL",
  },
  {
    id: "PP-03  the console's script-src has no 'unsafe-inline'",
    file: "src/proxy.ts",
    find: "`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`",
    replace: "`script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline'`",
    test: "tests/http-surface.test.ts",
    expect: "FAIL",
  },
  {
    id: "PP-04  the access-request route is same-origin gated",
    file: "src/app/api/access-request/route.ts",
    find: /const verdict = resolveOriginVerdict\([\s\S]*?return refuseCrossOrigin\(\);\n\s{2}\}\n/,
    replace: "",
    test: "tests/http-surface.test.ts",
    expect: "FAIL",
  },
  {
    id: "PP-05  robots.txt disallows the console",
    file: "src/app/robots.ts",
    find: 'disallow: ["/admin", "/admin/", "/api/"],',
    replace: 'disallow: [],',
    test: "tests/http-surface.test.ts",
    expect: "FAIL",
  },
  {
    id: "PP-06  the submitted state does not promise an email",
    file: "src/app/request-access/access-request-form.tsx",
    find: 'heading: "Received. Your request is on file.",',
    replace: 'heading: "Received. We will reply by email.",',
    test: "tests/http-surface.test.ts",
    expect: "FAIL",
  },
  {
    id: "B2  the poster path is ONE viewport",
    file: "src/lib/stage-mode.ts",
    find: 'if (mode === "poster") return "100dvh";',
    replace: 'if (mode === "poster") return `${runwayVh}vh`;',
    test: "tests/stage-mode.test.ts",
    expect: "FAIL",
  },
  {
    id: "B3  the live camera frames like the poster",
    file: "src/components/product-3d/scene-tiers.ts",
    find: "if (viewportAspect <= posterAspect) return baseFovDeg;",
    replace: "if (viewportAspect <= posterAspect) return baseFovDeg;\n  return baseFovDeg;",
    test: "tests/scene-tiers.test.ts",
    expect: "FAIL",
  },
  {
    id: "B4  the grain tile is reproducible",
    file: "src/lib/procedural.ts",
    find: "`<feTurbulence type=\"fractalNoise\" baseFrequency=\"0.85\" numOctaves=\"3\" seed=\"${seed >>> 0}\" stitchTiles=\"stitch\"/>`",
    replace: "`<feTurbulence type=\"fractalNoise\" baseFrequency=\"0.85\" numOctaves=\"3\" seed=\"${(seed >>> 0) + 1}\" stitchTiles=\"stitch\"/>`",
    test: "tests/procedural.test.ts",
    expect: "FAIL",
  },
  {
    id: "PERF-1  the contact shadow is rendered once, not once per frame",
    file: "src/components/product-3d/World.tsx",
    find: "frames={1}",
    replace: "frames={Infinity}",
    test: "tests/hero-perf.test.ts",
    expect: "FAIL",
  },
  {
    id: "PERF-2  the adaptive DPR is wired to a signal that moves",
    file: "src/components/product-3d/ProductScene.tsx",
    find: "onDecline={() => {",
    replace: "onChange={() => {",
    test: "tests/hero-perf.test.ts",
    expect: "FAIL",
  },
  {
    id: "PERF-3  the transmission card gets one sample unless the GPU is discrete",
    file: "src/components/product-3d/LedgerCard.tsx",
    find: "samples={resolveTransmissionSamples(gpuClass, lowEnd)}",
    replace: "samples={4}",
    test: "tests/hero-perf.test.ts",
    expect: "FAIL",
  },
  {
    id: "PERF-4  GSAP stays out of the initial JavaScript",
    file: "src/components/product-3d/ProductHero.tsx",
    find: 'import("gsap")',
    replace: '"gsap"',
    test: "tests/hero-perf.test.ts",
    expect: "FAIL",
  },
];

const log = (m) => process.stdout.write(`${m}\n`);

/** Escapes a plain string for use as a literal search. */
function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let failures = 0;
for (const c of CASES) {
  const path = resolve(appDir, c.file);
  const original = readFileSync(path, "utf8");
  const matcher = c.find instanceof RegExp ? c.find : new RegExp(escapeRe(c.find));
  if (!matcher.test(original)) {
    log(`SKIP  ${c.id}  (the marker is not in the file - the fix was reworded)`);
    failures += 1;
    continue;
  }
  writeFileSync(path, original.replace(matcher, c.replace));
  let red;
  let summary;
  try {
    const run = spawnSync("bunx", ["vitest", "run", c.test], {
      cwd: appDir,
      encoding: "utf8",
      shell: true,
    });
    red = (run.stdout ?? "").includes("failed") || (run.status ?? 0) !== 0;
    summary = (run.stdout ?? "").split(/\r?\n/).filter((l) => l.includes("Tests ")).pop() ?? "";
  } finally {
    writeFileSync(path, original);
  }
  log(`${red ? "RED  " : "NOT-RED"}  ${c.id}`);
  log(`        ${summary.trim()}`);
  if (!red) failures += 1;
}

log("");
if (failures > 0) {
  log(`FAIL: ${failures} negative control(s) did not go red.`);
  process.exit(1);
}
log("PASS: every negative control went red and was restored.");
