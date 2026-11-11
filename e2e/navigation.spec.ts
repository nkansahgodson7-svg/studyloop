import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type BrowserContext, type TestInfo } from '@playwright/test';

const PASSWORD = 'studyloop-e2e-1';

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

test.describe.configure({ timeout: 90_000 });

function accountFor(testInfo: TestInfo) {
  const project = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-');
  return { email: `e2e-navigation-${project}@studyloop.local`, password: PASSWORD };
}

async function ensureSignedIn(context: BrowserContext, email: string): Promise<void> {
  const login = await context.request.post('/api/auth/login', {
    data: { email, password: PASSWORD }
  });
  if (login.ok()) return;
  expect(login.status(), await login.text()).toBe(401);

  const signup = await context.request.post('/api/auth/signup', {
    data: { email, password: PASSWORD, inviteCode: INVITE }
  });
  if (signup.ok()) return;

  expect(signup.status(), await signup.text()).toBe(409);
  const retry = await context.request.post('/api/auth/login', {
    data: { email, password: PASSWORD }
  });
  expect(retry.ok(), await retry.text()).toBeTruthy();
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

async function createNotebook(context: BrowserContext, title: string): Promise<number> {
  const res = await context.request.post('/api/notebooks', { data: { title } });
  expect(res.status(), await res.text()).toBe(201);
  const notebook = (await res.json()) as { id: number };
  return notebook.id;
}

test.describe('Back navigation', () => {
  test.beforeEach(() => {
    test.skip(!INVITE, 'SIGNUP_INVITE_CODE is not configured');
  });

  test('chat back returns to the notebook, then the notebook back returns Home', async (
    { page, context },
    testInfo
  ) => {
    const account = accountFor(testInfo);
    await ensureSignedIn(context, account.email);
    await deleteAllNotebooks(context);
    const notebookId = await createNotebook(context, 'Navigation Test');

    try {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: /Keep the/ })).toBeVisible({ timeout: 30_000 });

      await page.getByRole('link', { name: 'Navigation Test' }).click();
      await expect(page.getByRole('heading', { name: 'Navigation Test' })).toBeVisible({
        timeout: 45_000
      });

      await page.getByRole('tab', { name: 'Chat' }).click();
      await page.getByRole('button', { name: /New chat/ }).click();
      await expect(page.getByRole('button', { name: 'Back to notebook' })).toBeVisible({
        timeout: 30_000
      });

      await page.getByRole('button', { name: 'Back to notebook' }).click();
      await expect(page).toHaveURL(new RegExp(`/notebooks/${notebookId}(\\?tab=chat)?$`), {
        timeout: 30_000
      });

      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
      await expect(page.getByRole('heading', { name: /Keep the/ })).toBeVisible();
    } finally {
      await deleteAllNotebooks(context);
    }
  });
});
