import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // lib/crypto.ts fails closed at module load (10_Security.md §15) unless a
    // secret is present. Test-only value: never used at runtime, never in prod.
    env: {
      GATEWAY_SHARED_SECRET: 'vitest-only-shared-secret-not-for-production-0000',
    },
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    include: ['tests/components/**/*.test.tsx', 'src/**/*.test.tsx', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.config.*',
        '**/*.d.ts',
        '.next/',
      ],
    },
  },
});
