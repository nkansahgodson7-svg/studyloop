// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from './crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createNotebook } from './notebooks';
import { createUser } from './repo';
import { createConversation, createMessage } from './conversations';
import { fallbackTitle, generateConversationTitle, sanitizeTitle } from './chat-title';

describe('chat titles', () => {
  const question =
    'Can you please explain how the electron transport chain produces a proton gradient across the inner mitochondrial membrane?';

  it('falls back to a clipped version of the first question', () => {
    const title = fallbackTitle(question);
    expect(title.length).toBeLessThanOrEqual(40);
    expect(title.endsWith('…')).toBe(true);
    expect(fallbackTitle('   ')).toBe('New chat');
  });

  it('sanitizes model output', () => {
    expect(sanitizeTitle('  "Cell Respiration."  ')).toBe('Cell Respiration');
    expect(sanitizeTitle('### **ATP synthesis**')).toBe('ATP synthesis');
    expect(sanitizeTitle('a')).toBeNull();
    expect(sanitizeTitle('')).toBeNull();
    expect(sanitizeTitle('x'.repeat(120))!.length).toBe(60);
  });

  it('stores a generated title after the first exchange', async () => {
    const db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-title-')), 'title.db'));
    await applySchema(db);
    const user = await createUser(db, {
      email: 'title@x.local',
      passwordHash: await hashPassword('p'),
      role: 'user'
    });
    const notebook = await createNotebook(db, user.id, 'Title notebook');
    const conversation = await createConversation(db, notebook.id);
    await createMessage(db, conversation.id, { role: 'user', content: question });
    await createMessage(db, conversation.id, { role: 'assistant', content: 'Here is how...' });

    await generateConversationTitle(db, conversation, 'key', user.id, {
      complete: async () => '"Mitochondrial Gradient"'
    });

    const row = await db.execute({
      sql: 'SELECT title, title_source FROM chat_conversations WHERE id = ?',
      args: [conversation.id]
    });
    expect(row.rows[0]).toMatchObject({
      title: 'Mitochondrial Gradient',
      title_source: 'auto'
    });
    await db.close();
  });

  it('falls back when the model fails', async () => {
    const db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-title-')), 'title.db'));
    await applySchema(db);
    const user = await createUser(db, {
      email: 'title-fail@x.local',
      passwordHash: await hashPassword('p'),
      role: 'user'
    });
    const notebook = await createNotebook(db, user.id, 'Title notebook');
    const conversation = await createConversation(db, notebook.id);
    await createMessage(db, conversation.id, { role: 'user', content: 'What is osmosis?' });

    await generateConversationTitle(db, conversation, 'key', user.id, {
      complete: async () => {
        throw new Error('provider down');
      }
    });

    const row = await db.execute({
      sql: 'SELECT title, title_source FROM chat_conversations WHERE id = ?',
      args: [conversation.id]
    });
    expect(row.rows[0]).toMatchObject({ title: 'What is osmosis?', title_source: 'fallback' });
    await db.close();
  });

  it('does not call the model once the hourly title budget is spent', async () => {
    const db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-title-')), 'title.db'));
    await applySchema(db);
    const user = await createUser(db, {
      email: 'title-limit@x.local',
      passwordHash: await hashPassword('p'),
      role: 'user'
    });
    const notebook = await createNotebook(db, user.id, 'Title notebook');
    const conversation = await createConversation(db, notebook.id);
    await createMessage(db, conversation.id, { role: 'user', content: 'Explain entropy.' });
    await db.execute({
      sql: 'INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 30, ?)',
      args: [`chat-title:${user.id}`, Date.now() + 60_000]
    });

    let called = false;
    await generateConversationTitle(db, conversation, 'key', user.id, {
      complete: async () => {
        called = true;
        return 'Entropy';
      }
    });

    expect(called).toBe(false);
    const row = await db.execute({
      sql: 'SELECT title, title_source FROM chat_conversations WHERE id = ?',
      args: [conversation.id]
    });
    expect(row.rows[0]).toMatchObject({ title: 'Explain entropy.', title_source: 'fallback' });
    await db.close();
  });
});
