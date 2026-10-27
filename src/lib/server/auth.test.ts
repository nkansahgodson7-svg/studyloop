// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from './crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createSession, createUser } from './repo';
import { requireAdmin, requireUser, HttpError, login, logout, me, signup } from './auth';
import { resetRateLimits } from './ratelimit';
import { seedAdmin } from './seed-admin';

const PASSWORD = 'correct horse battery staple';

async function requestWithCookie(url: string, token: string): Promise<Request> {
  return new Request(url, {
    headers: { cookie: `sl_session=${token}` }
  });
}

describe('auth guards', () => {
  let dir: string;
  let db: Client;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'studyloop-auth-'));
    db = makeLocalDb(join(dir, 'auth.db'));
    await applySchema(db);
  });

  afterAll(async () => {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('requireUser resolves the session owner from a valid cookie', async () => {
    const user = await seedUser(db, 'guard.user@test.local', 'user');
    const token = await createSession(db, user.id);

    const resolved = await requireUser(db, await requestWithCookie('http://x/api', token));

    expect(resolved.id).toBe(user.id);
    expect(resolved.email).toBe(user.email);
    expect(resolved).not.toHaveProperty('passwordHash');
  });

  it('requireUser throws 401 without a cookie', async () => {
    await expect(requireUser(db, new Request('http://x/api')))
      .rejects.toMatchObject({ status: 401 });
  });

  it('requireUser throws 401 for an unknown or revoked token', async () => {
    await expect(
      requireUser(db, await requestWithCookie('http://x/api', 'not-a-real-token'))
    ).rejects.toMatchObject({ status: 401 });
  });

  it('requireAdmin accepts an admin session with 200 and rejects a plain user with 403', async () => {
    const admin = await seedUser(db, 'guard.admin@test.local', 'admin');
    const plain = await seedUser(db, 'guard.plain@test.local', 'user');
    const adminToken = await createSession(db, admin.id);
    const plainToken = await createSession(db, plain.id);

    const adminReq = await requestWithCookie('http://x/api', adminToken);
    expect((await requireAdmin(db, adminReq)).id).toBe(admin.id);

    const plainReq = await requestWithCookie('http://x/api', plainToken);
    await expect(requireAdmin(db, plainReq))
      .rejects.toMatchObject({ status: 403 });
  });

  it('requireAdmin throws 401 when unauthenticated', async () => {
    await expect(requireAdmin(db, new Request('http://x/api')))
      .rejects.toMatchObject({ status: 401 });
  });

  async function seedUser(dbc: Client, email: string, role: 'admin' | 'user') {
    const user = await createUser(dbc, {
      email,
      passwordHash: await hashPassword(PASSWORD),
      role
    });
    return user;
  }
});

describe('login route', () => {
  let dir: string;
  let db: Client;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'studyloop-login-'));
    db = makeLocalDb(join(dir, 'login.db'));
    await applySchema(db);
    await createUser(db, {
      email: 'login.user@test.local',
      passwordHash: await hashPassword(PASSWORD),
      role: 'user'
    });
    await createUser(db, {
      email: 'login.disabled@test.local',
      passwordHash: await hashPassword(PASSWORD),
      role: 'user'
    });
    await db.execute({ sql: "UPDATE users SET disabled = 1 WHERE email = 'login.disabled@test.local'", args: [] });
  });

  afterAll(async () => {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });

  function loginRequest(email: string, password: string): Request {
    return new Request('http://x/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
  }

  it('returns the user and sets an httpOnly session cookie for valid credentials', async () => {
    const res = await login(db, loginRequest('Login.User@Test.Local', PASSWORD));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ email: 'login.user@test.local', role: 'user' });
    expect(body).not.toHaveProperty('passwordHash');

    const cookie = res.cookies.get('sl_session');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.maxAge).toBeGreaterThan(0);

    // The issued session must actually resolve through the data layer.
    const issued = cookie!.value;
    const rows = await db.execute({ sql: 'SELECT user_id FROM sessions WHERE token = ?', args: [issued] });
    expect(rows.rows.length).toBe(1);
  });

  it('rejects a wrong password with 401', async () => {
    const res = await login(db, loginRequest('login.user@test.local', 'wrong'));
    expect(res.status).toBe(401);
  });

  it('rejects an unknown email with 401', async () => {
    const res = await login(db, loginRequest('ghost@test.local', PASSWORD));
    expect(res.status).toBe(401);
  });

  it('rejects a disabled account with 403', async () => {
    const res = await login(db, loginRequest('login.disabled@test.local', PASSWORD));
    expect(res.status).toBe(403);
  });

  it('rejects a malformed body with 400', async () => {
    const res = await login(db, new Request('http://x/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json'
    }));
    expect(res.status).toBe(400);
  });
});

describe('signup route', () => {
  const INVITE = 'invite-code-for-tests-123';
  let dir: string;
  let db: Client;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'studyloop-signup-'));
    db = makeLocalDb(join(dir, 'signup.db'));
    await applySchema(db);
  });

  beforeEach(() => {
    resetRateLimits();
  });

  afterAll(async () => {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });

  function signupRequest(email: string, password: string, inviteCode: string, role?: string): Request {
    return new Request('http://x/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
      body: JSON.stringify({ email, password, inviteCode, ...(role ? { role } : {}) })
    });
  }

  it('creates a user and signs them in with an httpOnly session cookie', async () => {
    const res = await signup(
      db,
      signupRequest('New.User@Test.Local', PASSWORD, INVITE),
      INVITE
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      email: 'new.user@test.local',
      role: 'user',
      hasPersonalKey: false
    });
    expect(body).not.toHaveProperty('passwordHash');

    const cookie = res.cookies.get('sl_session');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.maxAge).toBeGreaterThan(0);

    const sessions = await db.execute({
      sql: 'SELECT user_id FROM sessions WHERE token = ?',
      args: [cookie!.value]
    });
    expect(sessions.rows.length).toBe(1);
  });

  it('forces the user role even when the body asks for admin', async () => {
    const res = await signup(
      db,
      signupRequest('not.admin@test.local', PASSWORD, INVITE, 'admin'),
      INVITE
    );

    expect(res.status).toBe(201);
    expect((await res.json()).role).toBe('user');

    const row = await db.execute({
      sql: 'SELECT role FROM users WHERE email = ?',
      args: ['not.admin@test.local']
    });
    expect(row.rows[0]!.role).toBe('user');
  });

  it('rejects a wrong invite code with 403', async () => {
    const res = await signup(
      db,
      signupRequest('wrong.invite@test.local', PASSWORD, 'not-the-code'),
      INVITE
    );
    expect(res.status).toBe(403);
  });

  it('disables signup with 503 when no invite code is configured', async () => {
    const res = await signup(
      db,
      signupRequest('closed@test.local', PASSWORD, INVITE),
      ''
    );
    expect(res.status).toBe(503);
  });

  it('rejects a short password with 400', async () => {
    const res = await signup(
      db,
      signupRequest('short@test.local', 'short', INVITE),
      INVITE
    );
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await signup(
      db,
      new Request('http://x/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.11' },
        body: 'not json'
      }),
      INVITE
    );
    expect(res.status).toBe(400);
  });

  it('rejects an already-registered email with 409', async () => {
    await createUser(db, {
      email: 'taken@test.local',
      passwordHash: await hashPassword(PASSWORD),
      role: 'user'
    });

    const res = await signup(
      db,
      signupRequest('taken@test.local', PASSWORD, INVITE),
      INVITE
    );
    expect(res.status).toBe(409);
  });

  it('lets a newly created account log in', async () => {
    const signupRes = await signup(
      db,
      signupRequest('fresh@test.local', PASSWORD, INVITE),
      INVITE
    );
    expect(signupRes.status).toBe(201);

    const loginRes = await login(db, new Request('http://x/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'fresh@test.local', password: PASSWORD })
    }));
    expect(loginRes.status).toBe(200);
  });

  it('throttles repeated attempts from the same client', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await signup(
        db,
        signupRequest(`throttle-${attempt}@test.local`, PASSWORD, 'wrong'),
        INVITE
      );
      expect(res.status).toBe(403);
    }

    const blocked = await signup(
      db,
      signupRequest('throttle-blocked@test.local', PASSWORD, INVITE),
      INVITE
    );
    expect(blocked.status).toBe(429);
  });
});

describe('me + logout routes', () => {
  let dir: string;
  let db: Client;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'studyloop-me-'));
    db = makeLocalDb(join(dir, 'me.db'));
    await applySchema(db);
  });

  afterAll(async () => {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('me returns the current user for a valid session and 401 otherwise', async () => {
    const user = await createUser(db, {
      email: 'me.user@test.local',
      passwordHash: await hashPassword(PASSWORD),
      role: 'user'
    });
    const token = await createSession(db, user.id);

    const res = await me(db, await requestWithCookie('http://x/api/auth/me', token));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: 'me.user@test.local' });

    const anon = await me(db, new Request('http://x/api/auth/me'));
    expect(anon.status).toBe(401);
  });

  it('logout revokes the session and clears the cookie', async () => {
    const user = await createUser(db, {
      email: 'logout.user@test.local',
      passwordHash: await hashPassword(PASSWORD),
      role: 'user'
    });
    const token = await createSession(db, user.id);

    const res = await logout(db, await requestWithCookie('http://x/api/auth/logout', token));
    expect(res.status).toBe(200);
    const cleared = res.cookies.get('sl_session');
    expect(cleared?.value).toBe('');
    expect(cleared?.maxAge).toBe(0);

    const rows = await db.execute({ sql: 'SELECT 1 FROM sessions WHERE token = ?', args: [token] });
    expect(rows.rows.length).toBe(0);
  });
});

describe('seedAdmin', () => {
  it('creates the admin once and is idempotent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'studyloop-seed-'));
    const db = makeLocalDb(join(dir, 'seed.db'));
    await applySchema(db);

    const first = await seedAdmin(db, { email: 'boss@studyloop.local', password: 'long-enough-pass' });
    expect(first.role).toBe('admin');

    const second = await seedAdmin(db, { email: 'boss@studyloop.local', password: 'other-pass-long-enough' });
    expect(second.id).toBe(first.id);

    const count = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM users', args: [] });
    expect(Number(count.rows[0]!.n)).toBe(1);

    await db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('refuses short passwords', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'studyloop-seed-'));
    const db = makeLocalDb(join(dir, 'seed2.db'));
    await applySchema(db);

    await expect(seedAdmin(db, { email: 'boss@studyloop.local', password: 'short' }))
      .rejects.toMatchObject({ code: 'WEAK_PASSWORD' });

    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
});

// HttpError exists so route handlers share one error -> response contract.
describe('HttpError', () => {
  it('carries a status and message', () => {
    const err = new HttpError(403, 'account disabled');
    expect(err.status).toBe(403);
    expect(err.message).toBe('account disabled');
  });
});
