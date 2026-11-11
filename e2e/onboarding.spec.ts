import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type BrowserContext, type TestInfo } from '@playwright/test';

const PASSWORD = 'studyloop-e2e-1';

// Playwright does not load Next's env files, so fall back to .env.local when
// the invite code is not exported into the test process.
function inviteCode(): string {
  const fromEnv = process.env.SIGNUP_INVITE_CODE?.trim();
  if (fromEnv) return fromEnv;
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const line = env.split(/\r?\n/).find((entry) => entry.startsWith('SIGNUP_INVITE_CODE='));
    return line?.slice('SIGNUP_INVITE_CODE='.length).trim().replace(/^['"]|['"]$/g, '') ?? '';
  } catch {
    return '';
  }
}

const INVITE = inviteCode();

// The first visit to the notebook route compiles a heavy client page in dev;
// allow that cold compile without weakening any element assertions.
test.describe.configure({ timeout: 90_000 });

function accountFor(testInfo: TestInfo, kind: 'new' | 'returning') {
  const project = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-');
  return {
    email: `e2e-onboarding-${project}-${kind}@studyloop.local`,
    password: PASSWORD
  };
}

async function ensureSignedIn(context: BrowserContext, email: string): Promise<void> {
  // Accounts are reused across runs, so log in first. Signing up on every run
  // would burn the signup rate-limit budget.
  const login = await context.request.post('/api/auth/login', {
    data: { email, password: PASSWORD }
  });
  if (login.ok()) return;
  expect(login.status(), await login.text()).toBe(401);

  const signup = await context.request.post('/api/auth/signup', {
    data: { email, password: PASSWORD, inviteCode: INVITE }
  });
  if (signup.ok()) return;

  // Another worker may have created the same account between our login and
  // signup; in that case the retry login succeeds.
  expect(signup.status(), await signup.text()).toBe(409);
  const retry = await context.request.post('/api/auth/login', {
    data: { email, password: PASSWORD }
  });
  expect(retry.ok(), await retry.text()).toBeTruthy();
}

async function clearKey(context: BrowserContext): Promise<void> {
  const res = await context.request.delete('/api/me/key');
  expect(res.ok()).toBeTruthy();
}

async function deleteAllNotebooks(context: BrowserContext): Promise<void> {
  const res = await context.request.get('/api/notebooks');
  if (!res.ok()) return;
  const notebooks = (await res.json()) as Array<{ id: number }>;
  for (const notebook of notebooks) {
    const deleted = await context.request.delete(`/api/notebooks/${notebook.id}`);
    if (!deleted.ok()) return;
  }
}

async function resetAccount(context: BrowserContext): Promise<void> {
  await clearKey(context);
  await deleteAllNotebooks(context);
}

async function createNotebook(context: BrowserContext, title: string): Promise<number> {
  const res = await context.request.post('/api/notebooks', { data: { title } });
  expect(res.status(), await res.text()).toBe(201);
  const notebook = (await res.json()) as { id: number };
  return notebook.id;
}

test.describe('Onboarding', () => {
  test.beforeEach(() => {
    test.skip(!INVITE, 'SIGNUP_INVITE_CODE is not configured');
  });

  test('new user names a notebook, skips the key, and opens the first source', async (
    { page, context },
    testInfo
  ) => {
    const account = accountFor(testInfo, 'new');
    await ensureSignedIn(context, account.email);
    await resetAccount(context);

    try {
      await page.goto('/onboarding');

      await expect(page.getByRole('heading', { name: 'See what your notes can do.' })).toBeVisible({
        timeout: 10_000
      });
      await expect(page.getByText('Sample chat')).toBeVisible();
      const progress = page.getByRole('progressbar', { name: 'Setup progress' });
      await expect(progress).toHaveAttribute('aria-valuemax', '3');
      await expect(progress).toHaveAttribute('aria-valuenow', '1');

      await page.getByRole('button', { name: /Get started/ }).click();

      await expect(page.getByRole('heading', { name: 'What are you studying?' })).toBeVisible();
      await expect(progress).toHaveAttribute('aria-valuenow', '2');
      await page.getByLabel('Notebook name').fill('Biology 101');
      await page.getByRole('button', { name: /Continue/ }).click();

      await expect(page.getByRole('heading', { name: 'Connect your AI.' })).toBeVisible();
      await expect(progress).toHaveAttribute('aria-valuenow', '3');
      await expect(page.getByLabel('Groq API key')).toHaveAttribute('type', 'password');

      await page.getByRole('button', { name: 'Show API key' }).click();
      await expect(page.getByLabel('Groq API key')).toHaveAttribute('type', 'text');

      await page.getByLabel('Groq API key').fill('short');
      await page.getByRole('button', { name: 'Save key & finish' }).click();
      await expect(page.locator('.form-error')).toContainText('too short');
      await expect(page).toHaveURL(/\/onboarding$/);

      await page.getByRole('button', { name: 'I’ll connect it later' }).click();

      await expect(page.getByRole('heading', { name: 'Ready to study.' })).toBeVisible();
      await expect(page.getByText('Biology 101')).toBeVisible();
      await expect(page.getByText('Not connected yet')).toBeVisible();

      await page.getByRole('button', { name: /Add my first source/ }).click();

      // The first client navigation to the notebook compiles that route in dev.
      await expect(page).toHaveURL(/\/notebooks\/\d+$/, { timeout: 45_000 });
      await expect(page.locator('.sheet-root.is-open')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.sheet-panel').getByText('Add a source')).toBeVisible();
      await expect(page.getByText('PDF', { exact: true })).toBeVisible();
    } finally {
      await deleteAllNotebooks(context);
      await context.request.delete('/api/me/key');
    }
  });

  test('returning user skips the notebook step and keeps their existing notebook', async (
    { page, context },
    testInfo
  ) => {
    const account = accountFor(testInfo, 'returning');
    await ensureSignedIn(context, account.email);
    await resetAccount(context);
    await createNotebook(context, 'Calculus II');

    try {
      await page.goto('/onboarding');

      await expect(page.getByRole('heading', { name: 'See what your notes can do.' })).toBeVisible({
        timeout: 10_000
      });
      const progress = page.getByRole('progressbar', { name: 'Setup progress' });
      await expect(progress).toHaveAttribute('aria-valuemax', '2');
      await expect(progress).toHaveAttribute('aria-valuenow', '1');
      await expect(page.locator('.onboard__stepcount .eyebrow')).toHaveText('Step 1 of 2');

      await page.getByRole('button', { name: /Get started/ }).click();

      await expect(page.getByRole('heading', { name: 'Connect your AI.' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'What are you studying?' })).toHaveCount(0);

      await page.getByRole('button', { name: 'I’ll connect it later' }).click();

      await expect(page.getByRole('heading', { name: 'Ready to study.' })).toBeVisible();
      await expect(page.getByText('Your existing notebooks')).toBeVisible();
      await expect(page.getByText('Not connected yet')).toBeVisible();

      await page.getByRole('button', { name: /Go to StudyLoop/ }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator('.sheet-root.is-open')).toHaveCount(0);
    } finally {
      await deleteAllNotebooks(context);
      await context.request.delete('/api/me/key');
    }
  });
});
