import { test, expect } from '@playwright/test';

const DEMO_COOKIE = {
  name: 'sl_session',
  value: 'HQM_9H8OtFAEdxNsTcl-xt8UyuHyeggJYY-SCIFXUHo',
  domain: 'localhost',
  path: '/'
};

test.describe('Desktop Layout & Page Visibility', () => {
  test('login page loads and form is centered on desktop', async ({ page }) => {
    await page.goto('/login');

    const shell = page.locator('.shell');
    await expect(shell).toBeVisible();

    const shellBox = await shell.boundingBox();
    expect(shellBox).not.toBeNull();
    expect(shellBox!.height).toBeGreaterThan(400);

    const auth = page.locator('.auth');
    await expect(auth).toBeVisible();

    // Verify auth form does not stretch across ultra-wide desktop
    const authBox = await auth.boundingBox();
    expect(authBox).not.toBeNull();
    expect(authBox!.width).toBeLessThanOrEqual(460);

    const emailInput = page.locator('input#email');
    await expect(emailInput).toBeVisible();
  });

  test('home page loads content and is not collapsed on desktop', async ({ page, context }) => {
    await context.addCookies([DEMO_COOKIE]);
    await page.goto('/');

    const shell = page.locator('.shell');
    await expect(shell).toBeVisible();

    const shellBox = await shell.boundingBox();
    expect(shellBox).not.toBeNull();
    // Verify shell didn't collapse to 0 height
    expect(shellBox!.height).toBeGreaterThan(500);

    const screen = page.locator('.screen');
    await expect(screen).toBeVisible();
    const screenBox = await screen.boundingBox();
    expect(screenBox!.height).toBeGreaterThan(500);

    // Verify greet and hero elements load
    await expect(page.locator('.greet')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.hero')).toBeVisible();

    // Verify tabbar is visible and centered
    const tabbar = page.locator('.tabbar');
    await expect(tabbar).toBeVisible();
    const tabBox = await tabbar.boundingBox();
    expect(tabBox!.width).toBeLessThanOrEqual(520);
  });

  test('review page loads and displays content on desktop', async ({ page, context }) => {
    await context.addCookies([DEMO_COOKIE]);
    await page.goto('/review');

    const screen = page.locator('.screen');
    await expect(screen).toBeVisible();

    await expect(page.locator('h1.h1')).toHaveText('Review', { timeout: 10_000 });
  });

  test('notebook page loads and displays sections on desktop', async ({ page, context }) => {
    await context.addCookies([DEMO_COOKIE]);
    await page.goto('/notebooks/4');

    const screen = page.locator('.screen');
    await expect(screen).toBeVisible();

    await expect(page.locator('.nb-hero__title')).toContainText('Organic Chemistry', { timeout: 10_000 });
    await expect(page.locator('.segmented')).toBeVisible();
  });
});
