// packages/security/vitest.config.ts
// Vitest configuration for the @buddysaradhi/security package.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
