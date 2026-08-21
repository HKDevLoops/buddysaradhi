import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'apps/services/**',
      'apps/web/**',
    ],
    // Gateway tests need Deno shims (stdout.writeSync, env.get, serve).
    // The setup file is a no-op for tests that don't use Deno APIs.
    setupFiles: [path.resolve(__dirname, 'apps/gateway/__tests__/setup.ts')],
    hookTimeout: 60000,
    testTimeout: 30000,
  },
});
