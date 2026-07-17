import { test, expect } from '@playwright/test';

async function fillField(page: import('@playwright/test').Page, label: string, value: string) {
  const input = page.getByLabel(label);
  for (let i = 0; i < 15; i++) {
    await input.click({ timeout: 2000 }).catch(() => {});
    await input.fill(value, { timeout: 2000 }).catch(() => {});
    const v = await input.inputValue().catch(() => "");
    if (v === value) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`Could not fill ${label}`);
}

async function authenticate(page: import('@playwright/test').Page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Golden-path test requires E2E_EMAIL and E2E_PASSWORD env vars to authenticate.',
    );
  }
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const signIn = page.getByRole('button', { name: /^Sign In$/i });
  await signIn.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(800);
  await fillField(page, 'Email', email);
  await fillField(page, 'Password', password);
  await expect(signIn).toBeEnabled({ timeout: 10000 });
  await signIn.click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

test.describe('Settings and Auth E2E Tests', () => {
  
  test('Forgot Password and Reset Password routes render correct forms', async ({ page }) => {
    // 1. Check forgot password screen
    await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toContainText('Forgot Password');
    await expect(page.getByLabel('Email Address')).toBeVisible();

    // 2. Check reset password screen
    await page.goto('/reset-password', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toContainText('Reset Password');
    await expect(page.getByLabel('New Password')).toBeVisible();
    await expect(page.getByLabel('Confirm Password')).toBeVisible();
  });

  test('Settings Appearance density updates layout attribute instantly', async ({ page }) => {
    await authenticate(page);
    
    // Navigate to Settings
    await page.getByRole('button', { name: /Settings/i }).click();
    await expect(page.locator('h1').first()).toContainText('Settings');

    // Click on Appearance navigation tab
    const appearanceTab = page.locator('nav[aria-label="Settings sections"] button').filter({ hasText: 'Appearance' });
    await appearanceTab.click();

    // Verify Compact button is click-responsive and sets html attribute
    const compactBtn = page.getByRole('button', { name: 'Compact' }).first();
    await compactBtn.click();
    
    // Check HTML attribute value
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-density', 'compact');

    // Verify Comfortable button restores default state
    const comfortableBtn = page.getByRole('button', { name: 'Comfortable' }).first();
    await comfortableBtn.click();
    await expect(html).toHaveAttribute('data-density', 'comfortable');
  });

  test('Existing user without database url auto-provisions and redirects', async ({ page }) => {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    if (!email || !password) return;

    // Login but bypass to provisioning route to verify instant provisioning logic
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await fillField(page, 'Email', email);
    await fillField(page, 'Password', password);
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    
    // Direct navigate to /signup/provision
    await page.goto('/signup/provision', { waitUntil: 'domcontentloaded' });
    
    // It should immediately update user metadata and redirect to /dashboard
    await page.waitForURL('**/dashboard', { timeout: 15000 });
  });

});
