import { test, expect, type BrowserContext } from '@playwright/test';

// The demo account is seeded by `npm run seed:admin` with DEMO_PASSWORD set.
// Override these if your local demo user uses different credentials.
const DEMO_EMAIL = process.env.E2E_DEMO_EMAIL ?? 'demo@studyloop.app';
const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'studyloop';

async function signInAsDemo(context: BrowserContext): Promise<void> {
  const res = await context.request.post('/api/auth/login', {
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD }
  });
  expect(res.ok()).toBeTruthy();
}

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
    await signInAsDemo(context);
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
    await signInAsDemo(context);
    await page.goto('/review');

    const screen = page.locator('.screen');
    await expect(screen).toBeVisible();

    await expect(page.locator('h1.h1')).toHaveText('Review', { timeout: 10_000 });
  });

  test('notebook page loads and displays sections on desktop', async ({ page, context }) => {
    await signInAsDemo(context);

    const res = await context.request.get('/api/notebooks');
    expect(res.ok()).toBeTruthy();
    const notebooks = (await res.json()) as Array<{ id: number; title: string }>;
    const organic = notebooks.find((notebook) => notebook.title === 'Organic Chemistry');
    expect(organic).toBeTruthy();

    await page.goto(`/notebooks/${organic!.id}`);

    const screen = page.locator('.screen');
    await expect(screen).toBeVisible();

    await expect(page.locator('.nb-hero__title')).toContainText('Organic Chemistry', { timeout: 10_000 });
    await expect(page.locator('.segmented')).toBeVisible();
  });
});
