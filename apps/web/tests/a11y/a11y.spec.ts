import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The 5 screens are Zustand-switched views inside /dashboard (not separate routes —
// see glass-shell NAV_ITEMS + dashboard page activeScreen switching). So we
// authenticate, land on /dashboard, click each screen's nav button, and axe the
// active view. Provide E2E_EMAIL / E2E_PASSWORD (and E2E_SUPABASE_* if non-default).
async function authenticate(page: import('@playwright/test').Page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'A11y test requires E2E_EMAIL and E2E_PASSWORD env vars to authenticate. ' +
        'The app redirects unauthenticated users to the Sign-in screen.',
    );
  }
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^Sign In$/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

const SCREENS = ['Dashboard', 'Students', 'Attendance', 'Fees', 'Settings'];

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);
  });

  for (const screen of SCREENS) {
    test(`Screen ${screen} should not have any automatically detectable accessibility issues`, async ({
      page,
    }) => {
      await page.getByRole('button', { name: new RegExp(screen, 'i') }).click();

      const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    });
  }
});
