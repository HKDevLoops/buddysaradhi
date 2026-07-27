import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60 * 1000,
  expect: {
    timeout: 10000
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Firefox disabled due to local headless SWGL framebuffer mapping driver crash on Windows
    /*
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    */
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  // Only spawn a local server when targeting localhost.
  // When PLAYWRIGHT_TEST_BASE_URL points to a deployed URL (Vercel etc),
  // skip local server — Playwright will hit the remote app directly.
  ...(baseURL.startsWith('http://localhost') ? {
    webServer: {
      command: process.env.CI
        // In CI the app is pre-built; just start Next.js.
        // The BFF handles gateway-down gracefully (503/fallback).
        ? 'pnpm run start'
        // Local dev: start all services for full integration.
        : 'cd ../.. && bun run scripts/start-all.js',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  } : {}),
});
