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
import { createCard } from './cards';
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
    await db.execute({
      sql: "INSERT INTO chat_messages (notebook_id, role, content, citations) VALUES (?, 'user', ?, '[]')",
      args: [notebookId, 'What is an alkene?']
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('returns sources, cards, and chat in one response', async () => {
    const res = await notebookBundle(db, await reqWithCookie(`http://x/api/notebooks/${notebookId}/bundle`, token), String(notebookId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: number;
      title: string;
      sources: unknown[];
      cards: Array<{ front: string; due: string }>;
      messages: Array<{ content: string }>;
    };
    expect(body.id).toBe(notebookId);
    expect(body.title).toBe('Organic Chemistry');
    expect(body.sources).toHaveLength(1);
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]!.front).toBe('Alkene bond?');
    expect(typeof body.cards[0]!.due).toBe('string');
    expect(body.messages.map((message) => message.content)).toContain('What is an alkene?');
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
