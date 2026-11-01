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
