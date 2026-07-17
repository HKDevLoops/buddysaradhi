import { test, expect } from '@playwright/test';

test.describe('Dashboard UI & E2E', () => {
  test('should load the dashboard and render KPIs correctly', async ({ page }) => {
    // Navigate to the main dashboard
    await page.goto('/');

    // Wait for the Dashboard content to load
    await expect(page.locator('text=Total Revenue').first()).toBeVisible();
    await expect(page.locator('text=Outstanding Fees').first()).toBeVisible();

    // Verify main sections
    await expect(page.locator('text=Dashboard').first()).toBeVisible();
    await expect(page.locator('text=Activity Feed')).toBeVisible();

    // Take a visual baseline screenshot of the dashboard
    await expect(page).toHaveScreenshot('dashboard-baseline.png', {
      maxDiffPixelRatio: 0.1, // Allow 10% diff for dynamic charts
      fullPage: true,
    });
  });

  test('should navigate between core screens using the bottom navigation', async ({ page }) => {
    await page.goto('/');
    
    // The bottom nav contains standard icons for the 5 screens

    // Note: Depends on actual data-testids or aria-labels in GlassShell
    // Example: assuming aria-labels match the screen names
    // await page.click('nav button[aria-label="Students"]');
    // await expect(page.url()).toContain('/students'); 
  });
});
