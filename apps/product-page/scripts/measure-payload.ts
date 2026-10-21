#!/usr/bin/env node
// Implements: 20_3D_Product_Page.md §3 — the 3D stack's PAYLOAD REGRESSION
// GUARD (the byte budget the section used to carry, replaced on 2026-10-21 by
// a measured baseline plus an allowance).
//
// WHAT THIS IS. A measurement of the bytes a visitor downloads for the 3D
// stack, taken from the PRODUCTION BUILD (the build `next start` would serve),
// and a check that the number has not grown past the recorded baseline by
// more than the recorded allowance.
//
// WHY IT IS NOT A CEILING. The section used to budget the stack at 180 KB
// gzip. Measured on the production build of 2026-10-21, three.js 0.182's own
// module is 631,039 B raw / 125,517 B gzip and the whole 3D stack is
// 154,617 B gzip - so the old number was a guess that happened to sit above
// the dependency's own cost, and a guess is a gate nobody can check. The
// owner's instruction is that the 3D go as high as possible, so this guard
// protects against an ACCIDENT (a dependency that drags half a megabyte in)
// and asks for a DECISION - recorded in the spec - for anything larger.
//
//   node scripts/measure-payload.ts           # measure and print
//   node scripts/measure-payload.ts --gate    # measure and enforce
//   node scripts/measure-payload.ts --json    # machine-readable only
//
// It is TypeScript because the repository's L7 principle-lint keeps JavaScript
// out of product paths (AGENTS.md §6.1). The file is plain JavaScript with
// type annotations, so Node's type stripping runs it directly; `bun scripts/
// measure-payload.ts` works too.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");

/**
 * The MEASURED baseline (2026-10-21): the 3D stack's chunks in the
 * production build, gzipped with Node's zlib.
 *
 * 20_3D_Product_Page.md §3.2 states this number and the reason for it, and
 * `apps/product-page/tests/payload-budget.test.ts` pins the two to each
 * other, so the spec and this file cannot drift apart.
 *
 * The measurement is Node's zlib on purpose: it is the runtime the product
 * page's other harness uses, and Bun's zlib measures the same file 0.9 %
 * larger (142,857 B against 141,593 B for the three.js chunk) - which is why
 * the allowance is 20 % and not 2 %.
 */
export const BASELINE_BYTES = 154_617;

/**
 * The growth allowance, as a fraction of the baseline (20 %).
 *
 * WHY 20 %. It is 30,923 B of gzip - roughly 60 KB of source. That is
 * several times the cost of a scene change (a feature's worth of 3D source
 * measures in the low single-digit KB of gzip) and an order of magnitude
 * below the class of change the guard exists to catch: a second WebGL
 * runtime, or a heavy post-processing suite, is 50-150 KB gzip (32-97 %),
 * and the smallest of those trips a 20 % allowance. It is also deliberately
 * NOT tighter than the ceiling it replaces: the old 180 KB sat 19.2 % above
 * this baseline, and the new limit is within 0.7 % of it.
 */
export const GROWTH_ALLOWANCE = 0.2;

/** The ceiling the guard enforces: the baseline plus the allowance. */
export const LIMIT_BYTES = Math.round(BASELINE_BYTES * (1 + GROWTH_ALLOWANCE));

/**
 * The markers that identify a chunk as part of the 3D stack.
 *
 * three.js's renderer class, React Three Fiber's reconciler key, and drei's
 * transmission material. The sum of the gzip size of the chunks that carry
 * any of them is the stack's cost.
 */
const STACK_MARKERS = ["WebGLRenderer", "__r3f", "MeshTransmissionMaterial"];

/**
 * The marker that MUST be present for the measurement to mean anything.
 *
 * Without it the measurement would silently report a number for a build in
 * which the 3D stack was tree-shaken away, and a guard that reads zero is
 * worse than no guard. So the script refuses to report instead.
 */
const REQUIRED_MARKER = "WebGLRenderer";

export interface PayloadMeasurement {
  /** The gzip size of every 3D stack chunk, in bytes. */
  stackBytes: number;
  /** The chunks that carried the stack. */
  chunks: Array<{ name: string; raw: number; gzip: number }>;
  /** The gzip size of EVERY JS chunk the build ships, for context. */
  allChunksBytes: number;
}

/** The pure comparison the gate and the test both use. */
export function evaluatePayload(
  stackBytes: number,
  baseline: number = BASELINE_BYTES,
  allowance: number = GROWTH_ALLOWANCE,
): { ok: boolean; limit: number; overBy: number } {
  const limit = Math.round(baseline * (1 + allowance));
  return { ok: stackBytes <= limit, limit, overBy: Math.max(0, stackBytes - limit) };
}

/** Measure the 3D stack's gzip cost from a production build. */
export function measurePayload(buildDir: string = resolve(appDir, ".next")): PayloadMeasurement {
  const chunkDir = resolve(buildDir, "static/chunks");
  if (!existsSync(chunkDir)) {
    throw new Error(
      `No production build at ${buildDir}. Run \`bun run build\` in apps/product-page first ` +
        "(the measurement must be of the SHIPPED build, not of a dev server).",
    );
  }
  const chunks: PayloadMeasurement["chunks"] = [];
  let allChunksBytes = 0;
  let found = false;
  for (const name of readdirSync(chunkDir)) {
    if (!name.endsWith(".js")) continue;
    const bytes = readFileSync(resolve(chunkDir, name));
    const gzip = gzipSync(bytes).length;
    allChunksBytes += gzip;
    if (!STACK_MARKERS.some((marker) => bytes.includes(marker))) continue;
    if (bytes.includes(REQUIRED_MARKER)) found = true;
    chunks.push({ name, raw: bytes.length, gzip });
  }
  if (!found) {
    throw new Error(
      `The 3D stack could not be located in ${chunkDir}: no chunk contains "${REQUIRED_MARKER}". ` +
        "Either the stack was tree-shaken out of the build or three.js changed its internals - " +
        "in both cases the measurement would be meaningless, so it is refused.",
    );
  }
  chunks.sort((a, b) => b.gzip - a.gzip);
  return {
    stackBytes: chunks.reduce((sum, chunk) => sum + chunk.gzip, 0),
    chunks,
    allChunksBytes,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const gate = argv.includes("--gate");
  const log = (message: string): void => {
    if (!asJson) process.stdout.write(`${message}\n`);
  };

  const measurement = measurePayload();
  const verdict = evaluatePayload(measurement.stackBytes);

  log(`3D stack: ${measurement.chunks.length} chunks, ${(measurement.stackBytes / 1024).toFixed(1)} KB gzip (${measurement.stackBytes} B)`);
  for (const chunk of measurement.chunks) {
    log(`  ${chunk.name}  ${(chunk.raw / 1024).toFixed(1)} KB raw  ${(chunk.gzip / 1024).toFixed(1)} KB gzip`);
  }
  log(`baseline: ${(BASELINE_BYTES / 1024).toFixed(1)} KB gzip (${BASELINE_BYTES} B)`);
  log(`allowance: +${(GROWTH_ALLOWANCE * 100).toFixed(0)} %  ->  limit ${(verdict.limit / 1024).toFixed(1)} KB gzip (${verdict.limit} B)`);
  log(`all JS the build ships: ${(measurement.allChunksBytes / 1024).toFixed(1)} KB gzip`);

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        {
          stackBytes: measurement.stackBytes,
          chunks: measurement.chunks,
          allChunksBytes: measurement.allChunksBytes,
          baselineBytes: BASELINE_BYTES,
          growthAllowance: GROWTH_ALLOWANCE,
          limitBytes: verdict.limit,
          overBy: verdict.overBy,
          withinBudget: verdict.ok,
        },
        null,
        2,
      )}\n`,
    );
  }

  if (gate && !verdict.ok) {
    process.stderr.write(
      `FAIL: the 3D stack is ${measurement.stackBytes} B gzip, ${verdict.overBy} B over the ` +
        `${verdict.limit} B limit (baseline ${BASELINE_BYTES} B + ${GROWTH_ALLOWANCE * 100} %). ` +
        "Growth past the allowance is not forbidden - it is a DECISION: record it in " +
        "20_3D_Product_Page.md §3 and raise the baseline there and in this file.\n",
    );
    process.exitCode = 1;
    return;
  }
  if (gate) {
    log("PASS: the 3D stack is within the payload allowance.");
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  }
}
