// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from './crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createNotebook } from './notebooks';
import { createUser, createSession } from './repo';
import { chatStream, chatMessagesGet, REFUSAL_MESSAGE, resolveLlmKey } from './chat';
import { ingestTextSource } from './ingest/ingest';

function makeRequest(url: string, body: string, token: string | null): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { cookie: `sl_session=${token}` } : {})
    },
    body
  });
}

async function readSse(res: Response): Promise<Array<Record<string, unknown>>> {
  const raw = await res.text();
  return raw
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice('data: '.length)) as Record<string, unknown>);
}

describe('chat()', () => {
  let db: Client;
  let userId: number;
  let token: string;
  let notebookId: number;
  let foreignToken: string;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-chat-')), 'chat.db'));
    await applySchema(db);
    const user = await createUser(db, { email: 'chat@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    userId = user.id;
    token = await createSession(db, userId);
    notebookId = (await createNotebook(db, userId, 'Chat notebook')).id;
    await ingestTextSource(db, {
      notebookId,
      title: 'Cell Biology Notes',
      text: 'Mitochondria produce ATP through oxidative phosphorylations. The inner membrane folds are called cristae.'
    });
    const other = await createUser(db, { email: 'other@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    foreignToken = await createSession(db, other.id);
  });

  afterAll(async () => {
    await db.close();
  });

  it('has no key when nothing is configured', async () => {
    const savedEnv = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    const key = await resolveLlmKey(db, userId);
    expect(key).toBeNull();
    if (savedEnv !== undefined) process.env.GROQ_API_KEY = savedEnv;
  });

  it('resolves the BYO key over the env default', async () => {
    const savedEnv = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = 'env-default-key';
    try {
      const envKey = await resolveLlmKey(db, userId);
      expect(envKey).toBe('env-default-key');
    } finally {
      if (savedEnv === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = savedEnv;
    }
  });

  it('streams a grounded answer with citations and persists the turn (mocked model)', async () => {
    const seen: { apiKey: string; system: string; question: string }[] = [];
    const deltas = ['Mitochondria ', 'produce ATP ', 'through cristae folds.'];
    const res = await chatStream(
      db,
      makeRequest(`http://x/api/notebooks/${notebookId}/chat`, JSON.stringify({ question: 'How do mitochondria produce ATP?' }), token),
      String(notebookId),
      {
        search: async (_db, _notebookId, query) => {
          expect(query).toBe('How do mitochondria produce ATP?');
          return [
            { id: 11, sourceId: 1, ord: 0, text: 'Mitochondria produce ATP through oxidative phosphorylations.', page: null, rank: 0.5 },
            { id: 12, sourceId: 1, ord: 1, text: 'The inner membrane folds are called cristae.', page: null, rank: 0.9 }
          ];
        },
        resolveLlmKey: async () => 'byo-or-default',
        completeStream: (apiKey, system, question) => {
          seen.push({ apiKey, system, question });
          return deltas[Symbol.iterator]() as unknown as AsyncIterableIterator<string>;
        }
      }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    const frames = await readSse(res);
    const citations = frames.find((frame) => frame.type === 'citations') as { items: Array<{ n: number; sourceTitle: string }> } | undefined;
    expect(citations?.items[0]).toMatchObject({ n: 1, sourceTitle: 'Cell Biology Notes' });
    expect(citations?.items).toHaveLength(2);
    const text = frames
      .filter((frame) => frame.type === 'delta')
      .map((frame) => frame.text)
      .join('');
    expect(text).toBe('Mitochondria produce ATP through cristae folds.');
    const done = frames.find((frame) => frame.type === 'done');
    expect(done).toBeDefined();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.apiKey).toBe('byo-or-default');
    expect(seen[0]!.question).toBe('How do mitochondria produce ATP?');
    expect(seen[0]!.system).toContain('cristae');

    const turn = await db.execute({
      sql: 'SELECT role, content, citations FROM chat_messages WHERE notebook_id = ? ORDER BY id',
      args: [notebookId]
    });
    expect(turn.rows).toHaveLength(2);
    expect(turn.rows[0]).toMatchObject({ role: 'user', content: 'How do mitochondria produce ATP?' });
    expect(turn.rows[1]).toMatchObject({ role: 'assistant', content: 'Mitochondria produce ATP through cristae folds.' });
    expect(JSON.parse(String(turn.rows[1]!.citations))).toHaveLength(2);
  });

  it('answers with the deterministic refusal and never calls the model when retrieval is empty', async () => {
    let modelCalled = false;
    const emptyNotebook = (await createNotebook(db, userId, 'Empty notebook')).id;
    const res = await chatStream(
      db,
      makeRequest(`http://x/api/notebooks/${emptyNotebook}/chat`, JSON.stringify({ question: 'What is quantum chromodynamics?' }), token),
      String(emptyNotebook),
      {
        search: async () => [],
        resolveLlmKey: async () => 'some-key',
        completeStream: () => {
          modelCalled = true;
          return [] as unknown as AsyncIterableIterator<string>;
        }
      }
    );
    expect(modelCalled).toBe(false);
    const frames = await readSse(res);
    const text = frames.filter((frame) => frame.type === 'delta').map((frame) => frame.text).join('');
    expect(text).toBe(REFUSAL_MESSAGE);
    expect(frames.some((frame) => frame.type === 'citations')).toBe(false);
    const turn = await db.execute({
      sql: "SELECT role, content, citations FROM chat_messages WHERE notebook_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1",
      args: [emptyNotebook]
    });
    expect(turn.rows[0]).toMatchObject({ role: 'assistant', content: REFUSAL_MESSAGE });
    expect(String(turn.rows[0]!.citations)).toBe('[]');
  });

  it('answers 503 with a clear setup message when no key is configured', async () => {
    const res = await chatStream(
      db,
      makeRequest(`http://x/api/notebooks/${notebookId}/chat`, JSON.stringify({ question: 'hello?' }), token),
      String(notebookId),
      { resolveLlmKey: async () => null }
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain('key');
  });

  it('answers 400 for a blank or oversized question', async () => {
    const blank = await chatStream(
      db,
      makeRequest(`http://x/api/notebooks/${notebookId}/chat`, JSON.stringify({ question: '   ' }), token),
      String(notebookId)
    );
    expect(blank.status).toBe(400);
    const long = await chatStream(
      db,
      makeRequest(`http://x/api/notebooks/${notebookId}/chat`, JSON.stringify({ question: 'x'.repeat(1001) }), token),
      String(notebookId)
    );
    expect(long.status).toBe(400);
  });

  it('answers 404 for a foreign notebook', async () => {
    const res = await chatStream(
      db,
      makeRequest(`http://x/api/notebooks/${notebookId}/chat`, JSON.stringify({ question: 'hello?' }), foreignToken),
      String(notebookId)
    );
    expect(res.status).toBe(404);
  });

  it('lists history ascending with parsed citations for the owner', async () => {
    await db.execute({
      sql: "INSERT INTO chat_messages (notebook_id, role, content, citations) VALUES (?, 'user', 'first question', '[]'), (?, 'assistant', 'first answer', ?)",
      args: [notebookId, notebookId, JSON.stringify([{ n: 1, sourceId: 1, ord: 0, sourceTitle: 'Cell Biology Notes' }])]
    });
    const res = await chatMessagesGet(
      db,
      makeRequest(`http://x/api/notebooks/${notebookId}/chat/messages`, '', token),
      String(notebookId)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: Array<{ role: string; content: string; citations: unknown[] }> };
    expect(body.messages.length).toBeGreaterThanOrEqual(2);
    const contents = body.messages.map((message) => message.content);
    expect(contents.indexOf('first question')).toBeLessThan(contents.indexOf('first answer'));
    const cited = body.messages.find((message) => message.content === 'first answer');
    expect(cited?.citations[0]).toMatchObject({ n: 1, sourceTitle: 'Cell Biology Notes' });
  });

  it('answers 404 for history of a foreign notebook', async () => {
    const res = await chatMessagesGet(
      db,
      makeRequest(`http://x/api/notebooks/${notebookId}/chat/messages`, '', foreignToken),
      String(notebookId)
    );
    expect(res.status).toBe(404);
  });
});
