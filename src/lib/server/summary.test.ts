// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from './crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createNotebook } from './notebooks';
import { createSession, createUser } from './repo';
import { createCard, gradeCard } from './cards';
import { Rating } from './fsrs';
import { summaryGet, userSummary } from './summary';

function makeRequest(token: string | null): Request {
  return new Request('http://x/api/me/summary', {
    headers: token ? { cookie: `sl_session=${token}` } : {}
  });
}

describe('summary()', () => {
  let db: Parameters<typeof userSummary>[0];
  let userId: number;
  let notebookId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-summary-')), 'summary.db'));
    await applySchema(db);
    const user = await createUser(db, { email: 'summary@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    userId = user.id;
    notebookId = (await createNotebook(db, userId, 'Summary notebook')).id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('is all zeros for a fresh user', async () => {
    expect(await userSummary(db, userId, new Date())).toEqual({
      streak: 0,
      dueTotal: 0,
      cardsTotal: 0,
      mastery: 0,
      reviewedToday: 0
    });
  });

  it('counts new cards as due with zero mastery', async () => {
    await createCard(db, notebookId, { front: 'F', back: 'B' });
    const now = new Date();
    expect(await userSummary(db, userId, now)).toMatchObject({
      streak: 0,
      dueTotal: 1,
      cardsTotal: 1,
      mastery: 0,
      reviewedToday: 0
    });
  });

  it('updates streak, mastery and reviewedToday after grading', async () => {
    const card = await createCard(db, notebookId, { front: 'F2', back: 'B2' });
    const now = new Date();
    await gradeCard(db, card.id, Rating.Good, now);
    const summary = await userSummary(db, userId, now);
    const expectedMastery = Math.round((1 / (2 * 3)) * 100);
    expect(summary.streak).toBe(1);
    expect(summary.reviewedToday).toBe(1);
    expect(summary.dueTotal).toBe(1);
    expect(summary.cardsTotal).toBe(2);
    expect(summary.mastery).toBe(expectedMastery);
  });

  it('scopes results to the owning user', async () => {
    const other = await createUser(db, { email: 'other@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    expect(await userSummary(db, other.id, new Date())).toEqual({
      streak: 0,
      dueTotal: 0,
      cardsTotal: 0,
      mastery: 0,
      reviewedToday: 0
    });
  });
});

describe('summary handler', () => {
  let db: Parameters<typeof summaryGet>[0];
  let token: string;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-summaryh-')), 'summary-h.db'));
    await applySchema(db);
    const user = await createUser(db, { email: 'handler@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    token = await createSession(db, user.id);
  });

  afterAll(async () => {
    await db.close();
  });

  it('requires a session', async () => {
    expect((await summaryGet(db, makeRequest(null))).status).toBe(401);
  });

  it('returns the payload for a valid session', async () => {
    const res = await summaryGet(db, makeRequest(token));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      streak: 0,
      dueTotal: 0,
      cardsTotal: 0,
      mastery: 0,
      reviewedToday: 0
    });
  });
});
