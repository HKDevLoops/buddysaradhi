import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Root-level config for the gateway package.
    // The setup file injects Deno shims so gateway modules can load under vitest.
    setupFiles: ["./__tests__/setup.ts"],
    alias: {
      "@libsql/client/web": "@libsql/client",
    },
    include: ["__tests__/**/*.test.ts"],
    // The perf gates run in their OWN lane (vitest.perf.config.ts), on one
    // worker, with nothing else competing for the CPU they are timing.
    exclude: [
      "__tests__/low-latency.test.ts",
      "__tests__/performance.test.ts",
    ],
    environment: "node",
    globals: false,
    testTimeout: 10_000,
    // AUD-068: this config had NO `hookTimeout`, so it inherited vitest's
    // 10 000 ms default, while the ROOT config (which is what CI's
    // `bun run test:unit` actually runs) sets 60 000. The same suite therefore
    // had TWO verdicts: `pin-proof-vector.test.ts` imports BOTH the gateway's
    // and the web's `crypto.ts` in a `beforeAll` — the web one pulls in the
    // native argon2 binding, so a cold import can exceed 10 s — and the file
    // was reported as failed under this config while passing under the root
    // one. The two configs must agree, or a developer cannot trust a red.
    hookTimeout: 60_000,
  },
});
