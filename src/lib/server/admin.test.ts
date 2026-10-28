// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from './crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createSession, createUser, listUsers, findUserBySession } from './repo';
import { requireUser } from './auth';
import { adminCreateUser, adminListUsers, adminSetDisabled, adminStats, type AdminStats } from './admin';

const PASSWORD = 'correct horse battery staple';

async function reqWithCookie(url: string, token: string): Promise<Request> {
  return new Request(url, { headers: { cookie: `sl_session=${token}` } });
}

async function adminRequest(url: string, method: string, body: unknown, token: string): Promise<Request> {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

describe('admin data layer', () => {
  let db: Client;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-admin-')), 'admin.db'));
    await applySchema(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('listUsers returns all users ordered by creation, without secrets', async () => {
    const first = await createUser(db, {
      email: 'owner@test.local',
      passwordHash: await hashPassword(PASSWORD),
      role: 'admin'
    });
    await createUser(db, {
      email: 'second@test.local',
      passwordHash: await hashPassword(PASSWORD),
      role: 'user'
    });

    const users = await listUsers(db);
    expect(users.map((u) => u.email)).toEqual(['owner@test.local', 'second@test.local']);
    for (const user of users) {
      expect(user).not.toHaveProperty('passwordHash');
      expect(user).not.toHaveProperty('llmKeyEncrypted');
      expect(user).toHaveProperty('disabled', false);
    }
    expect(users[0]!.id).toBe(first.id);
  });
});

describe('disableUser purges sessions', () => {
  let db: Client;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-dis-')), 'dis.db'));
    await applySchema(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('revokes every session when a user is disabled and restores none when re-enabled', async () => {
    const user = await createUser(db, {
      email: 'victim@test.local',
      passwordHash: await hashPassword(PASSWORD),
      role: 'user'
    });
    await createSession(db, user.id);
    await createSession(db, user.id);
    const sessionsBefore = await db.execute({ sql: 'SELECT COUNT(*) n FROM sessions WHERE user_id = ?', args: [user.id] });
    expect(Number(sessionsBefore.rows[0]!.n)).toBe(2);

    await adminSetDisabledRow(db, user.id, true);
    const after = await db.execute({ sql: 'SELECT COUNT(*) n FROM sessions WHERE user_id = ?', args: [user.id] });
    expect(Number(after.rows[0]!.n)).toBe(0);

    const row = await db.execute({ sql: 'SELECT disabled FROM users WHERE id = ?', args: [user.id] });
    expect(Number(row.rows[0]!.disabled)).toBe(1);

    await adminSetDisabledRow(db, user.id, false);
    const restored = await db.execute({ sql: 'SELECT disabled FROM users WHERE id = ?', args: [user.id] });
    expect(Number(restored.rows[0]!.disabled)).toBe(0);
  });

  async function adminSetDisabledRow(dbc: Client, id: number, disabled: boolean): Promise<void> {
    const { setUserDisabled } = await import('./repo');
    await setUserDisabled(dbc, id, disabled);
  }
});

describe('admin API guards', () => {
  let db: Client;
  let userToken: string;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-admapi-')), 'admapi.db'));
    await applySchema(db);
    const admin = await createUser(db, { email: 'boss@test.local', passwordHash: await hashPassword(PASSWORD), role: 'admin' });
    const plain = await createUser(db, { email: 'plain@test.local', passwordHash: await hashPassword(PASSWORD), role: 'user' });
    await createSession(db, admin.id);
    userToken = await createSession(db, plain.id);
  });

  afterAll(async () => {
    await db.close();
  });

  it('rejects user creation from an unauthenticated caller (401)', async () => {
    const res = await adminCreateUser(db, await adminRequest('http://x/api/admin/users', 'POST', {
      email: 'newbie@test.local', password: 'long-enough-password'
    }, 'not-a-token'));
    expect(res.status).toBe(401);
  });

  it('rejects user creation from a non-admin (403)', async () => {
    const res = await adminCreateUser(db, await adminRequest('http://x/api/admin/users', 'POST', {
      email: 'newbie@test.local', password: 'long-enough-password'
    }, userToken));
    expect(res.status).toBe(403);
  });

  it('rejects listing and disabling from a non-admin (403)', async () => {
    expect((await adminListUsers(db, await reqWithCookie('http://x/api/admin/users', userToken))).status).toBe(403);
    expect((await adminSetDisabled(db, await adminRequest('http://x/api/admin/users/9', 'PATCH', {
      disabled: true
    }, userToken), '9')).status).toBe(403);
  });
});

describe('admin create user', () => {
  let db: Client;
  let adminToken: string;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-admcre-')), 'admcre.db'));
    await applySchema(db);
    const admin = await createUser(db, { email: 'creator@test.local', passwordHash: await hashPassword(PASSWORD), role: 'admin' });
    adminToken = await createSession(db, admin.id);
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates a user who can then log in; response carries no secrets', async () => {
    const res = await adminCreateUser(db, await adminRequest('http://x/api/admin/users', 'POST', {
      email: 'Friend@StudyLoop.Local',
      password: 'friend-password-123'
    }, adminToken));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body).toMatchObject({ email: 'friend@studyloop.local', role: 'user' });
    expect(body).not.toHaveProperty('passwordHash');

    const { login } = await import('./auth');
    const loginRes = await login(db, new Request('http://x/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'Friend@StudyLoop.Local', password: 'friend-password-123' })
    }));
    expect(loginRes.status).toBe(200);
  });

  it('rejects weak passwords with 400', async () => {
    const res = await adminCreateUser(db, await adminRequest('http://x/api/admin/users', 'POST', {
      email: 'weak@test.local', password: 'short'
    }, adminToken));
    expect(res.status).toBe(400);
  });

  it('rejects invalid emails with 400', async () => {
    const res = await adminCreateUser(db, await adminRequest('http://x/api/admin/users', 'POST', {
      email: 'not-an-email', password: 'long-enough-password'
    }, adminToken));
    expect(res.status).toBe(400);
  });

  it('rejects duplicate emails with 409', async () => {
    const res = await adminCreateUser(db, await adminRequest('http://x/api/admin/users', 'POST', {
      email: 'Friend@StudyLoop.Local', password: 'friend-password-123'
    }, adminToken));
    expect(res.status).toBe(409);
  });

  it('allows creating a second admin with role admin', async () => {
    const res = await adminCreateUser(db, await adminRequest('http://x/api/admin/users', 'POST', {
      email: 'co-admin@test.local', password: 'long-enough-password', role: 'admin'
    }, adminToken));
    expect(res.status).toBe(201);
    expect((await res.json()).role).toBe('admin');
  });

  it('rejects unknown roles with 400', async () => {
    const res = await adminCreateUser(db, await adminRequest('http://x/api/admin/users', 'POST', {
      email: 'ghost-role@test.local', password: 'long-enough-password', role: 'root'
    }, adminToken));
    expect(res.status).toBe(400);
  });
});

describe('admin disable enable APIs', () => {
  let db: Client;
  let adminToken: string;
  let userId: number;
  let userSession: string;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-admdis-')), 'admdis.db'));
    await applySchema(db);
    const admin = await createUser(db, { email: 'boss2@test.local', passwordHash: await hashPassword(PASSWORD), role: 'admin' });
    adminToken = await createSession(db, admin.id);
    const user = await adminCreateUser(db, await adminRequest('http://x/api/admin/users', 'POST', {
      email: 'target@test.local', password: 'target-password-long'
    }, adminToken));
    userId = (await user.json()).id as number;
    userSession = await createSession(db, userId);
  });

  afterAll(async () => {
    await db.close();
  });

  it('disable through API purges sessions: revoked token no longer resolves', async () => {
    const res = await adminSetDisabled(db, await adminRequest(`http://x/api/admin/users/${userId}`, 'PATCH', {
      disabled: true
    }, adminToken), String(userId));
    expect(res.status).toBe(200);

    expect(await findUserBySession(db, userSession, new Date())).toBeNull();
  });

  it('disabled target cannot log in even with the right password', async () => {
    const { login } = await import('./auth');
    const res = await login(db, new Request('http://x/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'target@test.local', password: 'target-password-long' })
    }));
    expect(res.status).toBe(403);
  });

  it('re-enable through API allows login again', async () => {
    await adminSetDisabled(db, await adminRequest(`http://x/api/admin/users/${userId}`, 'PATCH', {
      disabled: false
    }, adminToken), String(userId));

    const { login } = await import('./auth');
    const res = await login(db, new Request('http://x/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'target@test.local', password: 'target-password-long' })
    }));
    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown user id', async () => {
    const res = await adminSetDisabled(db, await adminRequest('http://x/api/admin/users/999', 'PATCH', {
      disabled: true
    }, adminToken), '999');
    expect(res.status).toBe(404);
  });
});

describe('admin list through API', () => {
  it('returns the full user list for an admin without secrets', async () => {
    const db2 = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-admlist-')), 'l.db'));
    await applySchema(db2);
    const admin = await createUser(db2, { email: 'bossX@test.local', passwordHash: await hashPassword(PASSWORD), role: 'admin' });
    const token = await createSession(db2, admin.id);

    const res = await adminListUsers(db2, await reqWithCookie('http://x/api/admin/users', token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({ email: 'bossx@test.local', role: 'admin', disabled: false });
    expect(body[0]).not.toHaveProperty('passwordHash');

    await db2.close();
  });

  it('requireUser works alongside requireAdmin for existing flows', async () => {
    const db3 = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-reqadm-')), 'r.db'));
    await applySchema(db3);
    const user = await createUser(db3, { email: 'u1@test.local', passwordHash: await hashPassword(PASSWORD), role: 'user' });
    const token = await createSession(db3, user.id);
    expect((await requireUser(db3, await reqWithCookie('http://x', token))).id).toBe(user.id);
    await db3.close();
  });
});

describe('admin stats', () => {
  let db: Client;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-admstats-')), 'stats.db'));
    await applySchema(db);

    const admin = await createUser(db, { email: 'stats-admin@test.local', passwordHash: await hashPassword(PASSWORD), role: 'admin' });
    const learner = await createUser(db, { email: 'stats-user@test.local', passwordHash: await hashPassword(PASSWORD), role: 'user' });
    adminToken = await createSession(db, admin.id);
    userToken = await createSession(db, learner.id);

    const notebook = await db.execute({
      sql: 'INSERT INTO notebooks (user_id, title) VALUES (?, ?)',
      args: [learner.id, 'Stats notebook']
    });
    const notebookId = Number(notebook.lastInsertRowid);
    await db.execute({
      sql: 'INSERT INTO sources (notebook_id, kind, title, text) VALUES (?, ?, ?, ?)',
      args: [notebookId, 'text', 'Source', 'body']
    });
    const card = await db.execute({
      sql: 'INSERT INTO cards (notebook_id, front, back) VALUES (?, ?, ?)',
      args: [notebookId, 'front', 'back']
    });
    const cardId = Number(card.lastInsertRowid);
    await db.execute({
      sql: 'INSERT INTO reviews (card_id, due) VALUES (?, ?)',
      args: [cardId, new Date(Date.now() - 60_000).toISOString()]
    });
    await db.execute({ sql: 'INSERT INTO review_log (card_id, rating) VALUES (?, 3)', args: [cardId] });
    await db.execute({
      sql: "INSERT INTO chat_messages (notebook_id, role, content) VALUES (?, 'user', 'hello')",
      args: [notebookId]
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('rejects anonymous (401) and non-admin (403) callers', async () => {
    expect((await adminStats(db, await reqWithCookie('http://x/api/admin/stats', 'not-a-token'))).status).toBe(401);
    expect((await adminStats(db, await reqWithCookie('http://x/api/admin/stats', userToken))).status).toBe(403);
  });

  it('returns totals, activity and a gap-free 14-day series without secrets', async () => {
    const res = await adminStats(db, await reqWithCookie('http://x/api/admin/stats', adminToken));
    expect(res.status).toBe(200);

    const body = (await res.json()) as AdminStats;
    expect(body.users).toMatchObject({ total: 2, admins: 1, disabled: 0, newLast7d: 2 });
    expect(body.content).toMatchObject({ notebooks: 1, sources: 1, cards: 1 });
    expect(body.activity).toMatchObject({ reviews: 1, dueNow: 1, chatPrompts: 1, activeUsers7d: 1 });

    expect(body.series.signups).toHaveLength(14);
    expect(body.series.reviews).toHaveLength(14);
    // Both users signed up today (last bucket); the window still starts empty.
    expect(body.series.signups[13]!.count).toBe(2);
    expect(body.series.signups[0]!.count).toBe(0);
    expect(body.series.signups[0]!.date < body.series.signups[13]!.date).toBe(true);
    expect(body.series.reviews[13]!.count).toBe(1);

    expect(JSON.stringify(body)).not.toMatch(/password|pw_hash|gsk_/i);
  });
});
