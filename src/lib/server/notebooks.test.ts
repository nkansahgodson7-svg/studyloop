// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from './crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createSession, createUser } from './repo';
import {
  createNotebook,
  listNotebooks,
  ownNotebook,
  notebooksCreate,
  notebooksList,
  notebooksDelete
} from './notebooks';

const PASSWORD = 'correct horse battery staple';

async function reqWithCookie(url: string, token: string): Promise<Request> {
  return new Request(url, { headers: { cookie: `sl_session=${token}` } });
}

async function userWithToken(db: Client, email: string, role: 'admin' | 'user' = 'user'): Promise<{ token: string; id: number }> {
  const user = await createUser(db, { email, passwordHash: await hashPassword(PASSWORD), role });
  return { token: await createSession(db, user.id), id: user.id };
}

describe('notebook data layer', () => {
  let db: Client;
  let ownerId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-nb-')), 'nb.db'));
    await applySchema(db);
    const owner = await createUser(db, { email: 'nb.owner@test.local', passwordHash: await hashPassword(PASSWORD), role: 'user' });
    ownerId = owner.id;
    await createUser(db, { email: 'nb.other@test.local', passwordHash: await hashPassword(PASSWORD), role: 'user' });
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates a notebook owned by the session user and lists it newest-first', async () => {
    const first = await createNotebook(db, ownerId, 'Physics 201');
    const second = await createNotebook(db, ownerId, 'Organic Chemistry');

    expect(first.title).toBe('Physics 201');
    expect(second.userId).toBe(ownerId);

    const listed = await listNotebooks(db, ownerId);
    expect(listed.map((nb) => nb.title)).toEqual(['Organic Chemistry', 'Physics 201']);
    expect(listed[1]!.id).toBe(first.id);
  });

  it('lists nothing for a user with no notebooks', async () => {
    const fresh = await createUser(db, { email: 'nb.empty@test.local', passwordHash: await hashPassword(PASSWORD), role: 'user' });
    expect(await listNotebooks(db, fresh.id)).toEqual([]);
  });

  it('hides other users notebooks from the list', async () => {
    const otherList = await listNotebooks(db, ownerId + 100);
    expect(otherList).toEqual([]);
  });
});

describe('notebook API', () => {
  let db: Client;
  let ownerToken: string;
  let otherToken: string;
  let ownerId: number;
  let otherId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-nbapi-')), 'nbapi.db'));
    await applySchema(db);
    const owner = await userWithToken(db, 'api.owner@test.local', 'user');
    ownerToken = owner.token;
    ownerId = owner.id;
    const other = await userWithToken(db, 'api.other@test.local', 'user');
    otherToken = other.token;
    otherId = other.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('POST /api/notebooks creates one for the session user (201)', async () => {
    const res = await notebooksCreate(db, await new Request('http://x/api/notebooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${ownerToken}` },
      body: JSON.stringify({ title: 'History of the Roman Republic' })
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ title: 'History of the Roman Republic' });
    expect(body.id).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/notebooks returns only the caller notebooks', async () => {
    const ownList = await notebooksList(db, await reqWithCookie('http://x/api/notebooks', ownerToken));
    expect(ownList.status).toBe(200);
    const own = await ownList.json();
    expect(own).toHaveLength(1);
    expect(own[0].title).toBe('History of the Roman Republic');

    const otherList = await notebooksList(db, await reqWithCookie('http://x/api/notebooks', otherToken));
    expect(await otherList.json()).toEqual([]);
  });

  it('rejects unauthenticated create/list with 401', async () => {
    const createRes = await notebooksCreate(db, await new Request('http://x/api/notebooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'sl_session=nope' },
      body: JSON.stringify({ title: 'Stealth' })
    }));
    expect(createRes.status).toBe(401);

    const listNoCookie = await notebooksList(db, new Request('http://x/api/notebooks'));
    expect(listNoCookie.status).toBe(401);

    const listBad = await notebooksList(db, await reqWithCookie('http://x/api/notebooks', 'bad-token'));
    expect(listBad.status).toBe(401);
  });

  it('rejects blank and oversized titles with 400', async () => {
    const blank = await notebooksCreate(db, await new Request('http://x/api/notebooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${ownerToken}` },
      body: JSON.stringify({ title: '   ' })
    }));
    expect(blank.status).toBe(400);

    const oversized = await notebooksCreate(db, await new Request('http://x/api/notebooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${ownerToken}` },
      body: JSON.stringify({ title: 'x'.repeat(201) })
    }));
    expect(oversized.status).toBe(400);
  });

  it('ownership check: a foreign notebook id is invisible to another user', async () => {
    const foreign = await createNotebook(db, otherId, 'Foreign Notebook');
    expect(await ownNotebook(db, ownerId, foreign.id)).toBeNull();
    expect(await ownNotebook(db, otherId, foreign.id)).not.toBeNull();
  });
});

describe('notebook delete', () => {
  let db: Client;
  let ownerToken: string;
  let ownerId: number;
  let otherId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-nbdel-')), 'nbdel.db'));
    await applySchema(db);
    const owner = await userWithToken(db, 'del.owner@test.local', 'user');
    ownerToken = owner.token;
    ownerId = owner.id;
    const other = await userWithToken(db, 'del.other@test.local', 'user');
    otherId = other.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('deletes the owner notebook; foreign ids 404', async () => {
    const mine = await createNotebook(db, ownerId, 'Delete Me');
    const res = await notebooksDelete(db, await reqWithCookie(`http://x/api/notebooks/${mine.id}`, ownerToken), String(mine.id));
    expect(res.status).toBe(200);
    expect(await ownNotebook(db, ownerId, mine.id)).toBeNull();

    const other = await createNotebook(db, otherId, 'Not Yours');
    const foreign = await notebooksDelete(db, await reqWithCookie(`http://x/api/notebooks/${other.id}`, ownerToken), String(other.id));
    expect(foreign.status).toBe(404);
    expect(await ownNotebook(db, otherId, other.id)).not.toBeNull();

    const gone = await notebooksDelete(db, await reqWithCookie(`http://x/api/notebooks/999999`, ownerToken), '999999');
    expect(gone.status).toBe(404);
  });
});
