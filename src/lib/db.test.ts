import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySchema, ensureLocalDir, makeLocalDb } from './db';

describe('db: local file setup', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'studyloop-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates the parent directory of a missing local database path', async () => {
    const nested = join(dir, 'does-not-exist-yet', 'studyloop.db');
    await ensureLocalDir(nested);
    const info = await stat(join(dir, 'does-not-exist-yet'));
    expect(info.isDirectory()).toBe(true);
  });
});

describe('db: schema + FTS', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'studyloop-db-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seedNotebookWithChunk(name: string) {
    const db = makeLocalDb(join(dir, `${name}.db`));
    await applySchema(db);
    const u = await db.execute({
      sql: 'INSERT INTO users (email, pw_hash, role) VALUES (?, ?, ?)',
      args: ['x@y.test', 'testhash', 'admin']
    });
    const n = await db.execute({
      sql: 'INSERT INTO notebooks (user_id, title) VALUES (?, ?)',
      args: [u.lastInsertRowid!, 'Bio 101']
    });
    const s = await db.execute({
      sql: "INSERT INTO sources (notebook_id, kind, title, url, text) VALUES (?, 'text', 'Lecture 1', NULL, 'body')",
      args: [n.lastInsertRowid!]
    });
    return {
      db,
      user: Number(u.lastInsertRowid),
      notebook: Number(n.lastInsertRowid),
      source: Number(s.lastInsertRowid)
    };
  }

  it('rebuilds legacy chat tables once and keeps new conversations on later runs', async () => {
    const db = makeLocalDb(join(dir, 'legacy-chat.db'));
    await db.executeMultiple(`
      CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY,
        notebook_id INTEGER,
        role TEXT,
        content TEXT,
        citations TEXT,
        created_at TEXT
      );
      INSERT INTO chat_messages (notebook_id, role, content, citations)
      VALUES (1, 'user', 'old history', '[]');
    `);

    await applySchema(db);

    const columns = await db.execute('PRAGMA table_info(chat_messages)');
    const names = columns.rows.map((row) => String(row['name']));
    expect(names).toContain('conversation_id');
    expect(names).not.toContain('notebook_id');
    const leftover = await db.execute('SELECT COUNT(*) AS n FROM chat_messages');
    expect(Number(leftover.rows[0]!['n'])).toBe(0);

    const user = await db.execute({
      sql: "INSERT INTO users (email, pw_hash, role) VALUES ('legacy@test.local', 'h', 'user')"
    });
    const notebook = await db.execute({
      sql: 'INSERT INTO notebooks (user_id, title) VALUES (?, ?)',
      args: [user.lastInsertRowid!, 'Kept']
    });
    const conversation = await db.execute({
      sql: 'INSERT INTO chat_conversations (notebook_id, title) VALUES (?, ?)',
      args: [notebook.lastInsertRowid!, 'Kept chat']
    });
    await db.execute({
      sql: "INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, 'user', 'new history')",
      args: [conversation.lastInsertRowid!]
    });

    await applySchema(db); // the marker prevents a second wipe

    const kept = await db.execute('SELECT content FROM chat_messages');
    expect(kept.rows.map((row) => row['content'])).toEqual(['new history']);
    await db.close();
  });

  it('full-text search returns the chunk matching the query', async () => {
    const { db, source } = await seedNotebookWithChunk('fts-hit');
    const c = await db.execute({
      sql: 'INSERT INTO source_chunks (source_id, ord, text) VALUES (?, ?, ?)',
      args: [source, 0, 'The neuron is the basic cell of the nervous system.']
    });

    await applySchema(db); // idempotent: IF NOT EXISTS everywhere

    const hit = await db.execute(
      "SELECT rowid FROM source_chunks_fts WHERE source_chunks_fts MATCH 'neuron'"
    );
    expect(hit.rows).toHaveLength(1);
    expect(hit.rows[0]!['rowid']).toBe(Number(c.lastInsertRowid));

    const miss = await db.execute(
      "SELECT rowid FROM source_chunks_fts WHERE source_chunks_fts MATCH 'quantum'"
    );
    expect(miss.rows).toHaveLength(0);
  });

  it('applySchema upgrades a legacy users table', async () => {
    const db = makeLocalDb(join(dir, 'legacy.db'));
    await db.execute(`CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      pw_hash TEXT NOT NULL,
      llm_key_encrypted TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`);

    await applySchema(db);
    await applySchema(db);

    const columns = await db.execute('PRAGMA table_info(users)');
    expect(columns.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(['must_change_password', 'password_expires_at'])
    );
    await db.close();
  });

  it('applySchema upgrades legacy cards and chunks with batch/page columns', async () => {
    const db = makeLocalDb(join(dir, 'legacy-cards.db'));
    await db.execute(`CREATE TABLE source_chunks (
      id INTEGER PRIMARY KEY,
      source_id INTEGER NOT NULL,
      ord INTEGER NOT NULL,
      text TEXT NOT NULL
    )`);
    await db.execute(`CREATE TABLE cards (
      id INTEGER PRIMARY KEY,
      notebook_id INTEGER NOT NULL,
      source_id INTEGER,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);

    await applySchema(db);
    await applySchema(db);

    const cardColumns = await db.execute('PRAGMA table_info(cards)');
    expect(cardColumns.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(['generated_at', 'batch_id'])
    );
    const chunkColumns = await db.execute('PRAGMA table_info(source_chunks)');
    expect(chunkColumns.rows.map((row) => row.name)).toContain('page');
    await db.close();
  });

  it('widens sources.kind for PowerPoint without touching chunks or source refs', async () => {
    const db = makeLocalDb(join(dir, 'legacy-ppt.db'));
    // Pre-PowerPoint database: old kind CHECK, no file_key, and a leftover
    // sources_new table from a failed rebuild attempt.
    await db.executeMultiple(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        pw_hash TEXT NOT NULL
      );
      CREATE TABLE notebooks (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL
      );
      CREATE TABLE sources (
        id INTEGER PRIMARY KEY,
        notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('pdf', 'youtube', 'text')),
        title TEXT NOT NULL,
        url TEXT,
        text TEXT NOT NULL,
        meta TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE source_chunks (
        id INTEGER PRIMARY KEY,
        source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        ord INTEGER NOT NULL,
        text TEXT NOT NULL,
        page INTEGER
      );
      CREATE VIRTUAL TABLE source_chunks_fts USING fts5(
        text,
        content='source_chunks',
        content_rowid='id'
      );
      CREATE TRIGGER source_chunks_ai AFTER INSERT ON source_chunks BEGIN
        INSERT INTO source_chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER source_chunks_ad AFTER DELETE ON source_chunks BEGIN
        INSERT INTO source_chunks_fts(source_chunks_fts, rowid, text)
        VALUES ('delete', old.id, old.text);
      END;
      CREATE TABLE cards (
        id INTEGER PRIMARY KEY,
        notebook_id INTEGER NOT NULL,
        source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
        front TEXT NOT NULL,
        back TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE quiz_exams (
        id INTEGER PRIMARY KEY,
        notebook_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE quiz_exam_items (
        id INTEGER PRIMARY KEY,
        exam_id INTEGER NOT NULL REFERENCES quiz_exams(id) ON DELETE CASCADE,
        ord INTEGER NOT NULL,
        kind TEXT NOT NULL,
        prompt TEXT NOT NULL,
        correct TEXT NOT NULL,
        source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL
      );
      CREATE TABLE sources_new (id INTEGER PRIMARY KEY);
      INSERT INTO sources_new (id) VALUES (1);

      INSERT INTO users (id, email, pw_hash) VALUES (1, 'ppt@test.local', 'h');
      INSERT INTO notebooks (id, user_id, title) VALUES (1, 1, 'Bio');
      INSERT INTO sources (id, notebook_id, kind, title, text) VALUES
        (1, 1, 'pdf', 'Slides', 'cell body'),
        (2, 1, 'text', 'Notes', 'mitochondria');
      INSERT INTO source_chunks (id, source_id, ord, text, page) VALUES
        (1, 1, 0, 'Active recall strengthens memory.', 1),
        (2, 1, 1, 'Spaced repetition schedules reviews.', 2);
      INSERT INTO cards (id, notebook_id, source_id, front, back, created_at)
        VALUES (1, 1, 1, 'Q', 'A', '2026-01-01T00:00:00.000Z');
      INSERT INTO quiz_exams (id, notebook_id, title, created_at)
        VALUES (1, 1, 'Exam', '2026-01-01T00:00:00.000Z');
      INSERT INTO quiz_exam_items (id, exam_id, ord, kind, prompt, correct, source_id)
        VALUES (1, 1, 0, 'short', 'Why?', 'Because', 2);
    `);

    await applySchema(db);

    const schema = await db.execute("SELECT sql FROM sqlite_master WHERE name = 'sources'");
    expect(String(schema.rows[0]!['sql'])).toContain("'ppt'");
    const columns = await db.execute('PRAGMA table_info(sources)');
    expect(columns.rows.map((row) => row.name)).toContain('file_key');

    const chunks = await db.execute('SELECT id, page FROM source_chunks ORDER BY id');
    expect(chunks.rows).toEqual([
      expect.objectContaining({ id: 1, page: 1 }),
      expect.objectContaining({ id: 2, page: 2 })
    ]);

    const hit = await db.execute(
      "SELECT rowid FROM source_chunks_fts WHERE source_chunks_fts MATCH 'recall'"
    );
    expect(hit.rows.map((row) => row['rowid'])).toEqual([1]);

    const card = await db.execute('SELECT source_id FROM cards WHERE id = 1');
    expect(card.rows[0]!['source_id']).toBe(1);
    const examItem = await db.execute('SELECT source_id FROM quiz_exam_items WHERE id = 1');
    expect(examItem.rows[0]!['source_id']).toBe(2);

    const leftovers = await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE '_ppt%' OR name = 'sources_new')"
    );
    expect(leftovers.rows).toHaveLength(0);
    const fkErrors = await db.execute('PRAGMA foreign_key_check');
    expect(fkErrors.rows).toHaveLength(0);

    await db.execute({
      sql: "INSERT INTO sources (notebook_id, kind, title, text) VALUES (1, 'ppt', 'Deck', 'slide text')"
    });

    await applySchema(db); // the marker prevents a second rebuild
    const kept = await db.execute('SELECT COUNT(*) AS n FROM source_chunks');
    expect(Number(kept.rows[0]!['n'])).toBe(2);
    await db.close();
  });

  it('deleting a notebook cascades chunks and keeps FTS in sync', async () => {
    const { db, source } = await seedNotebookWithChunk('cascade');
    await db.execute({
      sql: 'INSERT INTO source_chunks (source_id, ord, text) VALUES (?, ?, ?)',
      args: [source, 0, 'Arithmetic circuits in the cerebellum.']
    });

    await db.execute('DELETE FROM notebooks');

    const chunks = await db.execute('SELECT COUNT(*) AS n FROM source_chunks');
    expect(chunks.rows[0]!['n']).toBe(0);

    const fts = await db.execute(
      "SELECT rowid FROM source_chunks_fts WHERE source_chunks_fts MATCH 'cerebellum'"
    );
    expect(fts.rows).toHaveLength(0);
  });
});
