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
  chatDelete,
  chatDetail,
  chatRename,
  chatsCreate,
  chatsList,
  createConversation,
  createMessage,
  listMessages,
  touchConversation
} from './conversations';

function req(
  url: string,
  token: string,
  init: { method?: string; body?: string } = {}
): Request {
  return new Request(url, {
    method: init.method ?? 'GET',
    headers: { cookie: `sl_session=${token}` },
    body: init.body
  });
}

describe('conversations', () => {
  let db: Client;
  let token: string;
  let foreignToken: string;
  let notebookId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-conv-')), 'conv.db'));
    await applySchema(db);
    const user = await createUser(db, {
      email: 'conv@x.local',
      passwordHash: await hashPassword('p'),
      role: 'user'
    });
    token = await createSession(db, user.id);
    notebookId = (await createNotebook(db, user.id, 'Conversations')).id;
    const other = await createUser(db, {
      email: 'conv-other@x.local',
      passwordHash: await hashPassword('p'),
      role: 'user'
    });
    foreignToken = await createSession(db, other.id);
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates a chat with the default title and lists it', async () => {
    const created = await chatsCreate(
      db,
      req(`http://x/api/notebooks/${notebookId}/chats`, token, { method: 'POST' }),
      String(notebookId)
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: number; title: string; titleSource: string };
    expect(body.title).toBe('New chat');
    expect(body.titleSource).toBe('auto');

    const list = await chatsList(
      db,
      req(`http://x/api/notebooks/${notebookId}/chats`, token),
      String(notebookId)
    );
    expect(list.status).toBe(200);
    const chats = (await list.json()) as Array<{ id: number; preview: string }>;
    expect(chats.map((chat) => chat.id)).toContain(body.id);
    expect(chats.find((chat) => chat.id === body.id)!.preview).toBe('');
  });

  it('orders chats by most recently updated and shows a preview', async () => {
    const older = await createConversation(db, notebookId, 'Older chat');
    const newer = await createConversation(db, notebookId, 'Newer chat');
    await createMessage(db, older.id, { role: 'user', content: 'Older question' });
    await touchConversation(db, older.id);
    await createMessage(db, newer.id, { role: 'user', content: 'Newer question' });
    await touchConversation(db, newer.id);

    const res = await chatsList(
      db,
      req(`http://x/api/notebooks/${notebookId}/chats`, token),
      String(notebookId)
    );
    const chats = (await res.json()) as Array<{ id: number; preview: string }>;
    const olderIndex = chats.findIndex((chat) => chat.id === older.id);
    const newerIndex = chats.findIndex((chat) => chat.id === newer.id);
    expect(newerIndex).toBeLessThan(olderIndex);
    expect(chats[newerIndex]!.preview).toBe('Newer question');
  });

  it('returns a page of the newest 50 messages and older pages on demand', async () => {
    const chat = await createConversation(db, notebookId, 'Paged');
    for (let index = 0; index < 55; index += 1) {
      await createMessage(db, chat.id, {
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `message ${index}`
      });
    }

    const first = await chatDetail(
      db,
      req(`http://x/api/chats/${chat.id}`, token),
      String(chat.id)
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      messages: Array<{ id: number; content: string }>;
      hasMore: boolean;
    };
    expect(firstBody.messages).toHaveLength(50);
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.messages[0]!.content).toBe('message 5');
    expect(firstBody.messages.at(-1)!.content).toBe('message 54');

    const oldestId = firstBody.messages[0]!.id;
    const second = await chatDetail(
      db,
      req(`http://x/api/chats/${chat.id}?before=${oldestId}`, token),
      String(chat.id)
    );
    const secondBody = (await second.json()) as {
      messages: Array<{ content: string }>;
      hasMore: boolean;
    };
    expect(secondBody.messages).toHaveLength(5);
    expect(secondBody.hasMore).toBe(false);
    expect(secondBody.messages[0]!.content).toBe('message 0');
  });

  it('renames a chat and marks the title as user-set', async () => {
    const chat = await createConversation(db, notebookId);
    const res = await chatRename(
      db,
      req(`http://x/api/chats/${chat.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ title: '  Cell respiration  ' })
      }),
      String(chat.id)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; titleSource: string };
    expect(body).toMatchObject({ title: 'Cell respiration', titleSource: 'user' });

    const tooLong = await chatRename(
      db,
      req(`http://x/api/chats/${chat.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'x'.repeat(81) })
      }),
      String(chat.id)
    );
    expect(tooLong.status).toBe(400);
  });

  it('deletes a chat and its messages', async () => {
    const chat = await createConversation(db, notebookId);
    await createMessage(db, chat.id, { role: 'user', content: 'gone soon' });
    const res = await chatDelete(
      db,
      req(`http://x/api/chats/${chat.id}`, token, { method: 'DELETE' }),
      String(chat.id)
    );
    expect(res.status).toBe(200);
    const left = await db.execute({
      sql: 'SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ?',
      args: [chat.id]
    });
    expect(Number(left.rows[0]!['n'])).toBe(0);
  });

  it('rejects foreign and unknown chats', async () => {
    const chat = await createConversation(db, notebookId);
    const foreign = await chatDetail(
      db,
      req(`http://x/api/chats/${chat.id}`, foreignToken),
      String(chat.id)
    );
    expect(foreign.status).toBe(404);

    const unknown = await chatDetail(db, req('http://x/api/chats/999999', token), '999999');
    expect(unknown.status).toBe(404);

    const foreignList = await chatsList(
      db,
      req(`http://x/api/notebooks/${notebookId}/chats`, foreignToken),
      String(notebookId)
    );
    expect(foreignList.status).toBe(404);
  });

  it('lists newest messages last', async () => {
    const chat = await createConversation(db, notebookId);
    await createMessage(db, chat.id, { role: 'user', content: 'first' });
    await createMessage(db, chat.id, { role: 'assistant', content: 'second' });
    const page = await listMessages(db, chat.id);
    expect(page.messages.map((message) => message.content)).toEqual(['first', 'second']);
    expect(page.hasMore).toBe(false);
  });
});
