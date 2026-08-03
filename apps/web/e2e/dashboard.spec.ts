import { test, expect } from '@playwright/test';

test.describe('Dashboard UI & E2E', () => {
  test('should load the login page or dashboard correctly', async ({ page }) => {
    // Navigate to the main application
    await page.goto('/');

    // Unauthenticated users are redirected to /login
    await expect(page).toHaveURL(/\/(login|dashboard)/, { timeout: 15000 });
  });

  test('should render login page with email and password fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible({ timeout: 15000 });
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Sign In$/i })).toBeVisible();
  });
});
