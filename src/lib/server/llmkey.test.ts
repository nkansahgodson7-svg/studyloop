// @vitest-environment node
import { afterAll, beforeEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createSession, createUser } from './repo';
import { saveUserKey, clearUserKey, loadUserPlainKey } from './llmkey';
import { saveKey, clearKey } from './llmkey';

const GROQ_TEST_KEY = 'gsk_test_1234567890abcdef_testkey01';

async function reqWithCookie(url: string, token: string): Promise<Request> {
  return new Request(url, { headers: { cookie: `sl_session=${token}` } });
}

async function seededUserWithSession(db: Client, email: string): Promise<{ token: string; id: number }> {
  const user = await createUser(db, { email, passwordHash: 'x', role: 'user' });
  const token = await createSession(db, user.id);
  return { token, id: user.id };
}

describe('llmkey data layer', () => {
  let db: Client;
  let userId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-key-')), 'key.db'));
    await applySchema(db);
    userId = (await seededUserWithSession(db, 'key.user@test.local')).id;
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_SECRET', 'test-encryption-secret-0123456789');
  });

  it('stores an encrypted blob that does not contain the plaintext key', async () => {
    await saveUserKey(db, userId, GROQ_TEST_KEY);

    const raw = await db.execute({ sql: 'SELECT llm_key_encrypted FROM users WHERE id = ?', args: [userId] });
    const blob = String(raw.rows[0]!.llm_key_encrypted);
    expect(blob).toMatch(/^v1\$/);
    expect(blob).not.toContain(GROQ_TEST_KEY);

    const plain = await loadUserPlainKey(db, userId);
    expect(plain).toBe(GROQ_TEST_KEY);
  });

  it('clear sets the column to null and nothing else', async () => {
    await clearUserKey(db, userId);
    const raw = await db.execute({ sql: 'SELECT llm_key_encrypted FROM users WHERE id = ?', args: [userId] });
    expect(raw.rows[0]!.llm_key_encrypted).toBeNull();
    expect(await loadUserPlainKey(db, userId)).toBeNull();
  });

  it('overwriting replaces the old key', async () => {
    await saveUserKey(db, userId, GROQ_TEST_KEY);
    await saveUserKey(db, userId, 'gsk_replacement_key_abcdefgh_02');
    expect(await loadUserPlainKey(db, userId)).toBe('gsk_replacement_key_abcdefgh_02');
  });

  it('refuses keys shorter than 20 chars', async () => {
    await expect(saveUserKey(db, userId, 'gsk_short')).rejects.toMatchObject({ status: 400 });
  });

  it('throws when ENCRYPTION_SECRET is unset', async () => {
    vi.stubEnv('ENCRYPTION_SECRET', '');
    await expect(saveUserKey(db, userId, GROQ_TEST_KEY)).rejects.toMatchObject({ status: 500 });
    await expect(loadUserPlainKey(db, userId)).rejects.toMatchObject({ status: 500 });
    vi.unstubAllEnvs();
  });
});

describe('llmkey API', () => {
  let db: Client;
  let userId: number;
  let token: string;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-keyapi-')), 'keyapi.db'));
    await applySchema(db);
    const seeded = await seededUserWithSession(db, 'keyapi.user@test.local');
    userId = seeded.id;
    token = seeded.token;
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_SECRET', 'test-encryption-secret-0123456789');
  });

  async function putKey(req: Request) {
    return saveKey(db, req);
  }

  it('PUT saves an owned key and responds with hasPersonalKey only, never the key', async () => {
    const res = await putKey(await new Request('http://x/api/me/key', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
      body: JSON.stringify({ key: GROQ_TEST_KEY })
    }));
    expect(res.status).toBe(201);
    const bodyText = await res.clone().json().then((body) => JSON.stringify(body));
    expect(JSON.parse(bodyText)).toEqual({ hasPersonalKey: true });
    expect(bodyText.includes(GROQ_TEST_KEY)).toBe(false);

    expect(await loadUserPlainKey(db, userId)).toBe(GROQ_TEST_KEY);
  });

  it('DELETE clears the key', async () => {
    await saveUserKey(db, userId, GROQ_TEST_KEY);
    const res = await clearKey(db, await reqWithCookie('http://x/api/me/key', token));
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.json().then(JSON.stringify))).toEqual({ hasPersonalKey: false });
    expect(await loadUserPlainKey(db, userId)).toBeNull();
  });

  it('rejects unauthenticated callers with 401', async () => {
    const res = await putKey(await new Request('http://x/api/me/key', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: 'sl_session=not-real' },
      body: JSON.stringify({ key: GROQ_TEST_KEY })
    }));
    expect(res.status).toBe(401);
  });

  it('rejects a non-string key with 400', async () => {
    const res = await putKey(await new Request('http://x/api/me/key', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
      body: JSON.stringify({ key: 12345 })
    }));
    expect(res.status).toBe(400);
  });

  it('rejects a short key with 400', async () => {
    const res = await putKey(await new Request('http://x/api/me/key', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
      body: JSON.stringify({ key: 'gsk_short' })
    }));
    expect(res.status).toBe(400);
  });
});
