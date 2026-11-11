// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from './crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createSession, createUser } from './repo';
import { createNotebook } from './notebooks';
import { createCard, cardsBatchAdd } from './cards';
import { notebookBundle } from './bundle';

const PASSWORD = 'correct horse battery staple';

async function reqWithCookie(url: string, token: string): Promise<Request> {
  return new Request(url, { headers: { cookie: `sl_session=${token}` } });
}

async function userWithToken(db: Client, email: string): Promise<{ token: string; id: number }> {
  const user = await createUser(db, { email, passwordHash: await hashPassword(PASSWORD), role: 'user' });
  return { token: await createSession(db, user.id), id: user.id };
}

describe('notebook bundle', () => {
  let db: Client;
  let token: string;
  let ownerId: number;
  let notebookId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-bundle-')), 'bundle.db'));
    await applySchema(db);
    const owner = await userWithToken(db, 'bundle.owner@test.local');
    token = owner.token;
    ownerId = owner.id;
    const notebook = await createNotebook(db, ownerId, 'Organic Chemistry');
    notebookId = notebook.id;
    await db.execute({
      sql: "INSERT INTO sources (notebook_id, kind, title, text) VALUES (?, 'text', ?, ?)",
      args: [notebookId, 'Alkenes', 'Alkenes are hydrocarbons with a double bond.']
    });
    await createCard(db, notebookId, { front: 'Alkene bond?', back: 'Double bond.' });
    const batchRes = await cardsBatchAdd(
      db,
      new Request(`http://x/api/notebooks/${notebookId}/cards/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
        body: JSON.stringify({
          cards: [{ front: 'Batch alkene card?', back: 'A batch answer.' }],
          sourceSummary: 'Alkenes · pp. 1–2',
          focus: 'naming'
        })
      }),
      String(notebookId)
    );
    expect(batchRes.status).toBe(201);
  });

  afterAll(async () => {
    await db.close();
  });

  it('returns sources, cards, and batches in one response', async () => {
    const res = await notebookBundle(db, await reqWithCookie(`http://x/api/notebooks/${notebookId}/bundle`, token), String(notebookId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: number;
      title: string;
      sources: unknown[];
      cards: Array<{
        front: string;
        due: string;
        batchId: number | null;
        batchCreatedAt: string | null;
        batchSourceSummary: string | null;
        generatedAt: string | null;
      }>;
      batches: Array<{ id: number; sourceSummary: string; focus: string | null; cardCount: number }>;
    };
    expect(body.id).toBe(notebookId);
    expect(body.title).toBe('Organic Chemistry');
    expect(body.sources).toHaveLength(1);
    expect(body.cards).toHaveLength(2);
    expect(typeof body.cards[0]!.due).toBe('string');

    const manual = body.cards.find((card) => card.front === 'Alkene bond?')!;
    expect(manual.batchId).toBeNull();
    expect(manual.batchCreatedAt).toBeNull();
    expect(manual.batchSourceSummary).toBeNull();
    expect(manual.generatedAt).toBeNull();

    expect(body.batches).toHaveLength(1);
    expect(body.batches[0]).toMatchObject({
      sourceSummary: 'Alkenes · pp. 1–2',
      focus: 'naming',
      cardCount: 1
    });
    const generated = body.cards.find((card) => card.front === 'Batch alkene card?')!;
    expect(generated.batchId).toBe(body.batches[0]!.id);
    expect(generated.batchSourceSummary).toBe('Alkenes · pp. 1–2');
    expect(typeof generated.batchCreatedAt).toBe('string');
    expect(typeof generated.generatedAt).toBe('string');
    expect(body).not.toHaveProperty('messages');
  });

  it('rejects foreign, invalid, and unauthenticated requests', async () => {
    const other = await userWithToken(db, 'bundle.other@test.local');
    const foreign = await notebookBundle(
      db,
      await reqWithCookie(`http://x/api/notebooks/${notebookId}/bundle`, other.token),
      String(notebookId)
    );
    expect(foreign.status).toBe(404);

    const invalid = await notebookBundle(db, await reqWithCookie('http://x/api/notebooks/nope/bundle', token), 'nope');
    expect(invalid.status).toBe(404);

    const anon = await notebookBundle(db, new Request(`http://x/api/notebooks/${notebookId}/bundle`), String(notebookId));
    expect(anon.status).toBe(401);
  });
});
