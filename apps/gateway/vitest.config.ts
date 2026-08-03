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
    environment: "node",
    globals: false,
    testTimeout: 10_000,
  },
});
