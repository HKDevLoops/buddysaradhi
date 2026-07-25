import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/gateway/src/**/*.test.ts',
    ],
  },
});
