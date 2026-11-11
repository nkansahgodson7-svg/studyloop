// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from './crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createNotebook } from './notebooks';
import { createSession, createUser } from './repo';
import {
  messageEdit,
  messagePost,
  messageRegenerate,
  messageRetry,
  resolveLlmKey,
  type ChatDeps,
  type PromptExcerpt
} from './chat';
import { createConversation, listMessages } from './conversations';
import { ingestTextSource } from './ingest/ingest';

function makeRequest(
  url: string,
  body: string | null,
  token: string | null,
  signal?: AbortSignal
): Request {
  return new Request(url, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      ...(token ? { cookie: `sl_session=${token}` } : {})
    },
    body: body ?? undefined
  });
}

async function readSse(res: Response): Promise<Array<Record<string, unknown>>> {
  const raw = await res.text();
  return raw
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice('data: '.length)) as Record<string, unknown>);
}

function iterOf(chunks: string[]): AsyncIterable<string> {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

function streamOf(chunks: string[]): ChatDeps['completeStream'] {
  return () => iterOf(chunks);
}

describe('chat conversations', () => {
  let db: Client;
  let userId: number;
  let token: string;
  let notebookId: number;
  let foreignToken: string;
  let chatId: number;

  const searchHit = {
    id: 11,
    sourceId: 0,
    ord: 0,
    text: 'Mitochondria produce ATP through oxidative phosphorylations.',
    page: null,
    rank: 0.5
  };

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-chat-')), 'chat.db'));
    await applySchema(db);
    const user = await createUser(db, {
      email: 'chat@x.local',
      passwordHash: await hashPassword('p'),
      role: 'user'
    });
    userId = user.id;
    token = await createSession(db, userId);
    notebookId = (await createNotebook(db, userId, 'Chat notebook')).id;
    await ingestTextSource(db, {
      notebookId,
      title: 'Cell Biology Notes',
      text: 'Mitochondria produce ATP through oxidative phosphorylations. The inner membrane folds are called cristae.'
    });
    chatId = (await createConversation(db, notebookId)).id;
    const other = await createUser(db, {
      email: 'other@x.local',
      passwordHash: await hashPassword('p'),
      role: 'user'
    });
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

  it('resolves the env default when the user has no BYO key', async () => {
    const savedEnv = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = 'env-default-key';
    try {
      expect(await resolveLlmKey(db, userId)).toBe('env-default-key');
    } finally {
      if (savedEnv === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = savedEnv;
    }
  });

  it('streams a grounded answer, labels it, and persists the turn', async () => {
    const sources = await db.execute({
      sql: 'SELECT id FROM sources WHERE notebook_id = ? ORDER BY id',
      args: [notebookId]
    });
    const sourceId = Number(sources.rows[0]!['id']);
    const seen: { apiKey: string; system: string; excerpt?: PromptExcerpt }[] = [];
    const res = await messagePost(
      db,
      makeRequest(
        `http://x/api/chats/${chatId}/messages`,
        JSON.stringify({ question: 'How do mitochondria produce ATP?' }),
        token
      ),
      String(chatId),
      {
        search: async (_db, _notebookId, query, k) => {
          expect(query).toBe('How do mitochondria produce ATP?');
          expect(k).toBe(5);
          return [
            { ...searchHit, sourceId },
            {
              ...searchHit,
              id: 12,
              sourceId,
              ord: 1,
              text: 'The inner membrane folds are called cristae.'
            }
          ];
        },
        resolveLlmKey: async () => 'test-key',
        completeStream: (apiKey, system) => {
          seen.push({ apiKey, system });
          return (async function* () {
            yield '[[grounding:sources]] [[used:1]]\n';
            yield 'Mitochondria produce ATP ';
            yield 'through cristae folds.';
          })();
        },
        genTitle: async () => undefined
      }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    const frames = await readSse(res);

    expect(frames[0]).toMatchObject({ type: 'start' });
    const grounding = frames.find((frame) => frame.type === 'grounding');
    expect(grounding).toMatchObject({ label: 'sources' });
    const usedRefs = grounding?.['sources'] as
      | Array<{ sourceTitle: string; label: string }>
      | undefined;
    expect(usedRefs).toHaveLength(1);
    expect(usedRefs?.[0]).toMatchObject({
      sourceTitle: 'Cell Biology Notes',
      label: 'chunk 1'
    });

    const text = frames
      .filter((frame) => frame.type === 'delta')
      .map((frame) => frame.text)
      .join('');
    expect(text).toBe('Mitochondria produce ATP through cristae folds.');
    // The control line must never leak into the visible answer.
    expect(text).not.toContain('[[grounding');
    expect(frames.some((frame) => frame.type === 'done')).toBe(true);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.apiKey).toBe('test-key');
    expect(seen[0]!.system).toContain('cristae');

    const page = await listMessages(db, chatId);
    expect(page.messages).toHaveLength(2);
    expect(page.messages[0]).toMatchObject({
      role: 'user',
      content: 'How do mitochondria produce ATP?'
    });
    expect(page.messages[1]).toMatchObject({
      role: 'assistant',
      grounding: 'sources',
      status: 'complete'
    });
    expect(page.messages[1]!.sources).toHaveLength(1);
  });

  it('sends the previous turns as context', async () => {
    let seenMessages: Array<{ role: string; content: string }> = [];
    const res = await messagePost(
      db,
      makeRequest(`http://x/api/chats/${chatId}/messages`, JSON.stringify({ question: 'And the folds?' }), token),
      String(chatId),
      {
        search: async () => [],
        resolveLlmKey: async () => 'test-key',        completeStream: (_apiKey, _system, messages) => {
          seenMessages = messages;
          return iterOf(['[[grounding:general]] [[used:]]\n', 'They are cristae.']);
        },
        genTitle: async () => undefined
      }
    );
    await readSse(res);
    expect(seenMessages.length).toBe(3);
    expect(seenMessages[0]!.role).toBe('user');
    expect(seenMessages[0]!.content).toContain('How do mitochondria produce ATP?');
    expect(seenMessages[1]!.role).toBe('assistant');
    expect(seenMessages[2]).toMatchObject({ role: 'user', content: 'And the folds?' });
  });

  it('answers from general knowledge with an explicit label', async () => {
    const emptyChat = (await createConversation(db, notebookId)).id;
    const res = await messagePost(
      db,
      makeRequest(
        `http://x/api/chats/${emptyChat}/messages`,
        JSON.stringify({ question: 'What is a derivative?' }),
        token
      ),
      String(emptyChat),
      {
        search: async () => [],
        resolveLlmKey: async () => 'test-key',
        completeStream: streamOf(['[[grounding:general]] [[used:]]\n', 'A rate of change.']),
        genTitle: async () => undefined
      }
    );
    const frames = await readSse(res);
    expect(frames.find((frame) => frame.type === 'grounding')).toMatchObject({
      label: 'general',
      sources: []
    });
    const page = await listMessages(db, emptyChat);
    expect(page.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'A rate of change.',
      grounding: 'general',
      sources: []
    });
  });

  it('stores a partial answer as stopped when the client aborts', async () => {
    const abortChat = (await createConversation(db, notebookId)).id;
    const controller = new AbortController();
    const res = await messagePost(
      db,
      makeRequest(
        `http://x/api/chats/${abortChat}/messages`,
        JSON.stringify({ question: 'Explain ATP synthase' }),
        token,
        controller.signal
      ),
      String(abortChat),
      {
        search: async () => [],
        resolveLlmKey: async () => 'test-key',
        completeStream: () =>
          (async function* () {
            yield '[[grounding:general]] [[used:]]\n';
            yield 'ATP synthase spins ';
            controller.abort();
            yield 'and never arrives.';
          })(),
        genTitle: async () => undefined
      }
    );
    await readSse(res);
    const page = await listMessages(db, abortChat);
    expect(page.messages).toHaveLength(2);
    expect(page.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'ATP synthase spins ',
      status: 'stopped'
    });
  });

  it('regenerates an answer in place and drops older turns', async () => {
    const target = (await listMessages(db, chatId)).messages.at(-1)!;
    expect(target.role).toBe('assistant');
    const res = await messageRegenerate(
      db,
      makeRequest(`http://x/api/chats/${chatId}/messages/${target.id}/regenerate`, null, token),
      String(chatId),
      String(target.id),
      {
        search: async () => [],
        resolveLlmKey: async () => 'test-key',
        completeStream: streamOf(['[[grounding:general]] [[used:]]\n', 'A fresher answer.']),
        genTitle: async () => undefined
      }
    );
    expect(res.status).toBe(200);
    await readSse(res);
    const page = await listMessages(db, chatId);
    const answers = page.messages.filter((message) => message.role === 'assistant');
    expect(answers).toHaveLength(2);
    expect(answers.at(-1)!.content).toBe('A fresher answer.');
    expect(page.messages.some((message) => message.id === target.id)).toBe(false);
  });

  it('edits a question, replaces what followed, and re-answers', async () => {
    const firstUser = (await listMessages(db, chatId)).messages.find((m) => m.role === 'user')!;
    const res = await messageEdit(
      db,
      makeRequest(
        `http://x/api/chats/${chatId}/messages/${firstUser.id}/edit`,
        JSON.stringify({ question: 'Where is ATP made?' }),
        token
      ),
      String(chatId),
      String(firstUser.id),
      {
        search: async () => [],
        resolveLlmKey: async () => 'test-key',
        completeStream: streamOf(['[[grounding:general]] [[used:]]\n', 'In the mitochondria.']),
        genTitle: async () => undefined
      }
    );
    expect(res.status).toBe(200);
    await readSse(res);
    const page = await listMessages(db, chatId);
    expect(page.messages).toHaveLength(2);
    expect(page.messages[0]).toMatchObject({ role: 'user', content: 'Where is ATP made?' });
    expect(page.messages[1]).toMatchObject({ role: 'assistant', content: 'In the mitochondria.' });
  });

  it('retries a question that previously failed', async () => {
    const firstUser = (await listMessages(db, chatId)).messages[0]!;
    const res = await messageRetry(
      db,
      makeRequest(`http://x/api/chats/${chatId}/messages/${firstUser.id}/retry`, null, token),
      String(chatId),
      String(firstUser.id),
      {
        search: async () => [],
        resolveLlmKey: async () => 'test-key',
        completeStream: streamOf(['[[grounding:general]] [[used:]]\n', 'Second try.']),
        genTitle: async () => undefined
      }
    );
    expect(res.status).toBe(200);
    await readSse(res);
    const page = await listMessages(db, chatId);
    expect(page.messages).toHaveLength(2);
    expect(page.messages[1]).toMatchObject({ role: 'assistant', content: 'Second try.' });
  });

  it('answers 503 with a clear setup message when no key is configured', async () => {
    const res = await messagePost(
      db,
      makeRequest(`http://x/api/chats/${chatId}/messages`, JSON.stringify({ question: 'hello?' }), token),
      String(chatId),
      { resolveLlmKey: async () => null }
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain('key');
  });

  it('answers 400 for a blank or oversized question', async () => {
    const blank = await messagePost(
      db,
      makeRequest(`http://x/api/chats/${chatId}/messages`, JSON.stringify({ question: '   ' }), token),
      String(chatId)
    );
    expect(blank.status).toBe(400);
    const long = await messagePost(
      db,
      makeRequest(
        `http://x/api/chats/${chatId}/messages`,
        JSON.stringify({ question: 'x'.repeat(2001) }),
        token
      ),
      String(chatId)
    );
    expect(long.status).toBe(400);
  });

  it('answers 404 for foreign or unknown chats', async () => {
    const foreign = await messagePost(
      db,
      makeRequest(`http://x/api/chats/${chatId}/messages`, JSON.stringify({ question: 'hi' }), foreignToken),
      String(chatId)
    );
    expect(foreign.status).toBe(404);
    const unknown = await messagePost(
      db,
      makeRequest('http://x/api/chats/999999/messages', JSON.stringify({ question: 'hi' }), token),
      '999999'
    );
    expect(unknown.status).toBe(404);
  });
});
