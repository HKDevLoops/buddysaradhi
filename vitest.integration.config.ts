import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["apps/gateway/__tests__/**/*.test.ts", "apps/gateway/src/__tests__/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // The perf gates run in their OWN lane (apps/gateway/vitest.perf.config.ts):
      // a perf measurement taken while the rest of the suite burns the CPU is a
      // measurement of the suite.
      "apps/gateway/__tests__/low-latency.test.ts",
      "apps/gateway/__tests__/performance.test.ts",
    ],
    // Gateway tests need Deno shims (stdout.writeSync, env.get, serve).
    setupFiles: [path.resolve(__dirname, "apps/gateway/__tests__/setup.ts")],
    // MUST match `apps/gateway/vitest.config.ts` — this config runs the SAME 43
    // test files, so the two must not disagree about how long a test may take.
    //
    // This omission was a live red gate, not a latent one. `pnpm run
    // test:integration` is run by `.github/workflows/lint.yml`, and with no
    // `testTimeout` declared Vitest falls back to its 5,000ms default, while the
    // gateway package's own config declares 10,000ms for the identical set. The
    // timing-sensitive suites in `__tests__/low-latency.test.ts` therefore
    // passed under `pnpm --filter @buddysaradhi/gateway test` and failed under
    // `pnpm run test:integration` — one tree, two verdicts, and CI only ran the
    // stricter one.
    //
    // The file that proves it is `low-latency.test.ts`, whose outlier-policy
    // tests perform ~9.4s of deliberate busy-wait: `p95PerOp` runs
    // `BATCHES + 1` = 21 batches of `BATCH` = 200 operations, so
    // `p95PerOp(busy(1), 20)` alone costs 21 × 200 × 1ms = 4,200ms. That is
    // arithmetic, not timing noise — under the 5s default the suite could not
    // pass on any machine. Those tests are now sized to leave real margin
    // (see the timings note in that file); this ceiling is the backstop, not
    // the mechanism.
    testTimeout: 10_000,
  },
});
