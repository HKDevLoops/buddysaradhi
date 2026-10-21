// Implements: docs/audit/REMEDIATION-PLAN-2026-10-21.md row 3.7 - "the
// perf-budget gates measure the machine, not the code" - and the isolation
// half of the fix (docs/audit/DYNAMIC-PERFORMANCE.md §6.2).
//
// WHY A LANE OF ITS OWN. The perf gates are the only tests in the repository
// whose result depends on how fast the machine is. Measured three times on
// one machine, the same test produced 12.4 ms, 6.3 ms and 8.4 ms against a
// 2 ms budget - a 33x spread on identical code (audit AUD-066). Two of the
// three mechanisms that fix that are in the test files themselves (the budgets
// are ratios against a stick measured in the same run, and every single-shot
// measurement is now batched). The third is this file: a lane where the perf
// files are the ONLY thing running, on ONE worker, with no other file
// competing for the CPU they are timing.
//
//   bunx vitest run --config apps/gateway/vitest.perf.config.ts
//
// The same files are excluded from the parallel suites (the root config, the
// integration config and the gateway's own config), so a perf measurement is
// never taken while fifty-eight other files are burning the CPU. They are
// still part of the gate: this config is the lane, and it is the lane CI
// should run.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ONLY the perf files. Nothing else may run here: the measurement's
    // validity depends on there being no other work on the machine.
    include: [
      "__tests__/low-latency.test.ts",
      "__tests__/performance.test.ts",
      "__tests__/perf-negative-control.test.ts",
    ],
    // The Deno shims, so the gateway modules load.
    setupFiles: ["./__tests__/setup.ts"],
    alias: {
      "@libsql/client/web": "@libsql/client",
    },
    environment: "node",
    globals: false,
    // ONE worker, no file parallelism: the measurement must not compete with
    // another test file for the CPU it is timing. (Vitest 4 moved the pool
    // options to the top level; `poolOptions` is deprecated.)
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
    // The same ceilings as the other two configs, so one tree has one verdict
    // (audit AUD-068: three configs with three timeout sets is how a suite
    // ends up with two verdicts).
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
