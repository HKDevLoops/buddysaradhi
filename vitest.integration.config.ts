import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["apps/gateway/__tests__/**/*.test.ts", "apps/gateway/src/__tests__/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Gateway tests need Deno shims (stdout.writeSync, env.get, serve).
    setupFiles: [path.resolve(__dirname, "apps/gateway/__tests__/setup.ts")],
  },
});
