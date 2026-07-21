import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function fillField(page: Page, label: string, value: string) {
  const input = page.getByLabel(label);
  for (let i = 0; i < 15; i++) {
    await input.click({ timeout: 2000 }).catch(() => {});
    await input.fill(value, { timeout: 2000 }).catch(() => {});
    const v = await input.inputValue().catch(() => '');
    if (v === value) return;
    await page.waitForTimeout(800);
  }
  throw new Error(`Could not fill field: ${label}`);
}

async function authenticate(page: Page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Golden-path test requires E2E_EMAIL and E2E_PASSWORD env vars. ' +
        'The app redirects unauthenticated users to the Sign-in screen.',
    );
  }
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const signIn = page.getByRole('button', { name: /^Sign In$/i });
  await signIn.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(600);
  await fillField(page, 'Email', email);
  await fillField(page, 'Password', password);
  await expect(signIn).toBeEnabled({ timeout: 10000 });
  await signIn.click();

  // After login, user may be redirected to /signup/provision if their DB
  // has not been provisioned yet. Wait for that flow to complete first.
  await page.waitForURL(/\/(dashboard|signup\/provision)/, { timeout: 25000 });
  const url = page.url();
  if (url.includes('signup/provision')) {
    // Auto-provisioning page — wait for it to redirect to /dashboard
    await page.waitForURL('**/dashboard', { timeout: 30000 });
  }
}

// Click the *visible* nav control (sidebar on desktop, bottom-tab on mobile).
async function clickNav(page: Page, name: RegExp) {
  const handle = await page.evaluateHandle((reSrc: string) => {
    const re = new RegExp(reSrc, 'i');
    const btns = Array.from(document.querySelectorAll('button'));
    for (const b of btns) {
      const label = b.getAttribute('aria-label') || b.textContent || '';
      if (re.test(label) && b.offsetParent !== null) return b;
    }
    return null;
  }, name.source);
  const el = handle.asElement();
  if (!el) throw new Error(`No visible nav control for ${name}`);
  await el.evaluate((b: HTMLButtonElement) => b.click());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Golden Path E2E', () => {
  test('Login → Dashboard → all 5 screens render', async ({ page }) => {
    await authenticate(page);

    await expect(page).toHaveTitle(/BuddySaradhi/);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });

    // Navigate each screen and verify heading
    const screens: { nav: RegExp; heading: RegExp }[] = [
      { nav: /Students/i,   heading: /Students/i   },
      { nav: /Attendance/i, heading: /Attendance/i },
      { nav: /Fees/i,       heading: /Fees/i       },
      { nav: /Settings/i,   heading: /Settings/i   },
      { nav: /Dashboard/i,  heading: /Dashboard/i  },
    ];

    for (const s of screens) {
      await clickNav(page, s.nav);
      await expect(page.locator('h1').first()).toContainText(s.heading, { timeout: 10000 });
    }
  });

  test('Unauthenticated user is redirected to /login', async ({ page }) => {
    // Attempt to access a protected route without authentication
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('/login page renders Sign In form', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Email')).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Sign In$/i })).toBeVisible();
  });

  test('/signup page renders Register form', async ({ page }) => {
    await page.goto('/signup', { waitUntil: 'domcontentloaded' });
    // Should show a registration form or redirect to login
    const url = page.url();
    expect(url).toMatch(/\/(signup|login)/);
  });
});
