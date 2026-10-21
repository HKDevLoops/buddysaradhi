// The product page's own vitest configuration.
//
// It exists so `bunx vitest run` inside this app collects the app's vitest
// suites and nothing else. Without it, vitest resolves the REPOSITORY ROOT
// config, whose `exclude` list is written in root-relative paths - and those
// paths do not match when the root is this app. The two suites below are
// `node --test` suites, not vitest suites: they run under
// `pnpm --filter product-page test` (see this package's `test` script) and
// vitest cannot collect them.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      // node:test suites, run by `bun run test` in this package.
      "src/app/admin/_lib/access-requests.test.ts",
      "src/app/admin/_lib/engine.test.ts",
    ],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
