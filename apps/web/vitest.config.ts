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
    /**
     * Vitest's default is 5000ms, which this suite could not keep.
     *
     * Nine files here run the PRODUCTION crypto path — Argon2id at Rule 8's
     * parameters (m=64MiB, t=3, p=2) plus AES-256-GCM. That cost is not incidental:
     * it is the property `10_Security.md` §15 specifies and that
     * `09_Backup_and_Import_Export.md` §11 pins with a round-trip test, so it
     * cannot be reduced to make tests faster. On an idle machine a KDF test costs
     * ~1–2s; loaded with the rest of the 74-file suite it measures 5.0–5.7s, and
     * the suite failed INTERMITTENTLY with a bare "test timed out" while passing
     * in isolation every time.
     *
     * That is a defect in the harness, not a signal about the code: a timeout is
     * not an assertion, and nothing here is stubbed, so a real regression still
     * fails on its own assertions at full speed. 30s leaves the KDF roughly an
     * order of magnitude of headroom while still catching a genuine hang in a
     * suite whose whole run is ~2 minutes.
     *
     * Set globally rather than per-file so a NEW crypto test inherits the budget
     * instead of re-discovering this flake, and so nobody is tempted to
     * `skip` the slow test to get a green run.
     */
    testTimeout: 30_000,
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
