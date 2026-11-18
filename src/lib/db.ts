import type { Client, Config } from '@libsql/client';
import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function isLocalFileUrl(url: string): boolean {
  return url.startsWith('file:');
}

function fileUrlToPath(url: string): string {
  return url.slice('file:'.length);
}

/**
 * SQLite error 14 (CANTOPEN): `file:` targets do not create parent
 * directories, so do it up front. Accepts a `file:` URL or a plain path;
 * relative paths resolve against the process cwd.
 */
export function ensureLocalDir(fileUrl: string): void {
  const raw = fileUrl.startsWith('file:') ? fileUrlToPath(fileUrl) : fileUrl;
  if (raw === ':memory:') {
    return;
  }
  mkdirSync(dirname(resolve(raw)), { recursive: true });
}

function localUrl(path: string): string {
  return `file:${path}`;
}

export function makeLocalDb(filePath: string): Client {
  const url = localUrl(filePath);
  ensureLocalDir(url);
  return createClient({ url });
}

let client: Client | null = null;

export function getDb(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL ?? localUrl('data/studyloop.db');
    if (isLocalFileUrl(url)) {
      ensureLocalDir(url);
    }
    const config: Config = { url };
    if (!isLocalFileUrl(url)) {
      config.authToken = process.env.TURSO_AUTH_TOKEN;
    }
    client = createClient(config);
  }
  return client;
}

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,
  llm_key_encrypted TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  disabled INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  password_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS notebooks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pdf', 'youtube', 'text', 'ppt')),
  title TEXT NOT NULL,
  url TEXT,
  file_key TEXT,
  text TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS source_chunks (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  page INTEGER
);

CREATE VIRTUAL TABLE IF NOT EXISTS source_chunks_fts USING fts5(
  text,
  content='source_chunks',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS source_chunks_ai AFTER INSERT ON source_chunks BEGIN
  INSERT INTO source_chunks_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS source_chunks_ad AFTER DELETE ON source_chunks BEGIN
  INSERT INTO source_chunks_fts(source_chunks_fts, rowid, text)
  VALUES ('delete', old.id, old.text);
END;

CREATE TABLE IF NOT EXISTS chat_conversations (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  title_source TEXT NOT NULL DEFAULT 'auto' CHECK (title_source IN ('auto', 'user', 'fallback')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  grounding TEXT CHECK (grounding IN ('sources', 'general', 'mixed')),
  sources TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete', 'stopped', 'error')),
  quiz_exam_id INTEGER REFERENCES quiz_exams(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_batches (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  source_summary TEXT NOT NULL,
  focus TEXT,
  card_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  batch_id INTEGER REFERENCES card_batches(id) ON DELETE SET NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  card_id INTEGER PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  due TEXT NOT NULL,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0,
  last_graded TEXT,
  fsrs_meta TEXT
);

CREATE TABLE IF NOT EXISTS quiz_items (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('mcq', 'fillin')),
  topic TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES quiz_items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  graded_by TEXT NOT NULL DEFAULT 'ai',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS quiz_exams (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS quiz_exam_items (
  id INTEGER PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES quiz_exams(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mcq', 'multi', 'truefalse', 'fillin', 'short')),
  topic TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  correct TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS quiz_exam_attempts (
  id INTEGER PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES quiz_exams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'submitted', 'grading', 'graded', 'grading_failed')),
  answers TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  graded_at TEXT,
  duration_ms INTEGER,
  score REAL,
  feedback TEXT,
  breakdown TEXT,
  graded_by TEXT NOT NULL DEFAULT 'auto'
);

CREATE INDEX IF NOT EXISTS idx_sources_notebook ON sources(notebook_id);
CREATE INDEX IF NOT EXISTS idx_quiz_exams_notebook ON quiz_exams(notebook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_exam_items_exam ON quiz_exam_items(exam_id, ord);
CREATE INDEX IF NOT EXISTS idx_quiz_exam_attempts_exam ON quiz_exam_attempts(exam_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_exam_attempts_user ON quiz_exam_attempts(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_notebook ON chat_conversations(notebook_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cards_notebook ON cards(notebook_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_notebook ON quiz_items(notebook_id);
CREATE INDEX IF NOT EXISTS idx_notebooks_user ON notebooks(user_id);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON source_chunks(source_id, ord);
CREATE INDEX IF NOT EXISTS idx_reviews_due ON reviews(due);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_cards_source ON cards(source_id);
CREATE INDEX IF NOT EXISTS idx_card_batches_notebook ON card_batches(notebook_id, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);

CREATE TABLE IF NOT EXISTS review_log (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  graded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_review_log_card ON review_log(card_id, graded_at);
`;

const CHAT_REBUILD_KEY = 'chat_overhaul_v1';

/**
 * Chat moved from one implicit thread per notebook to conversations. The
 * product decision was a clean start, so on the first run after this schema
 * lands the old rows are dropped (the table shape changes too). Guarded by a
 * marker so later runs never touch real conversations.
 */
async function rebuildChatTablesOnce(db: Client): Promise<void> {
  const marker = await db.execute({
    sql: 'SELECT value FROM schema_meta WHERE key = ?',
    args: [CHAT_REBUILD_KEY]
  });
  if (marker.rows.length > 0) {
    return;
  }
  await db.executeMultiple(`
    DROP INDEX IF EXISTS idx_chat_notebook;
    DROP TABLE IF EXISTS chat_messages;
    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      grounding TEXT CHECK (grounding IN ('sources', 'general', 'mixed')),
      sources TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete', 'stopped', 'error')),
      quiz_exam_id INTEGER REFERENCES quiz_exams(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, id);
  `);
  await db.execute({
    sql: 'INSERT INTO schema_meta (key, value) VALUES (?, ?)',
    args: [CHAT_REBUILD_KEY, new Date().toISOString()]
  });
}

const PPT_SOURCE_MIGRATION_KEY = 'source_kind_ppt_v1';

/** True while `sources` still has the pre-PowerPoint CHECK or lacks file_key. */
async function sourcesNeedsPptMigration(db: Client): Promise<boolean> {
  const table = await db.execute(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sources'"
  );
  const sql = table.rows[0]?.['sql'];
  if (typeof sql !== 'string') return false;
  return !sql.includes("'ppt'") || !sql.includes('file_key');
}

/**
 * Widen the sources.kind CHECK constraint to accept `ppt` (SQLite cannot ALTER a
 * CHECK) and add sources.file_key.
 *
 * Foreign keys must stay enabled. Turso's HTTP client is stateless: every
 * statement can land on a new logical connection, so a preceding
 * `PRAGMA foreign_keys = OFF` does not reach this rebuild (and the pragma is a
 * no-op inside a transaction anyway). Dropping `sources` with enforcement on
 * makes SQLite cascade into source_chunks, where the FTS triggers fail with
 * SQLITE_LOCKED, and silently nulls cards/quiz_exam_items.source_id.
 *
 * Instead the children are snapshotted, detached, restored with their original
 * ids after the parent swap, and everything runs in one transaction. This works
 * whether or not the server lets us turn foreign key checks off.
 */
async function migrateSourceKindPpt(db: Client): Promise<void> {
  const marker = await db.execute({
    sql: 'SELECT value FROM schema_meta WHERE key = ?',
    args: [PPT_SOURCE_MIGRATION_KEY]
  });
  if (marker.rows.length > 0) return;

  if (await sourcesNeedsPptMigration(db)) {
    const columns = await db.execute('PRAGMA table_info(sources)');
    const fileKey = columns.rows.some((row) => String(row['name']) === 'file_key')
      ? 'file_key'
      : 'NULL';
    await db.executeMultiple(`
      BEGIN;

      -- Leftovers from an interrupted run, plus the snapshot tables.
      DROP TABLE IF EXISTS sources_new;
      DROP TABLE IF EXISTS _ppt_sources_new;
      DROP TABLE IF EXISTS _ppt_chunks_backup;
      DROP TABLE IF EXISTS _ppt_cards_backup;
      DROP TABLE IF EXISTS _ppt_exam_items_backup;

      CREATE TABLE _ppt_chunks_backup (
        id INTEGER PRIMARY KEY,
        source_id INTEGER NOT NULL,
        ord INTEGER NOT NULL,
        text TEXT NOT NULL,
        page INTEGER
      );
      INSERT INTO _ppt_chunks_backup (id, source_id, ord, text, page)
        SELECT id, source_id, ord, text, page FROM source_chunks;

      CREATE TABLE _ppt_cards_backup (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL);
      INSERT INTO _ppt_cards_backup (id, source_id)
        SELECT id, source_id FROM cards WHERE source_id IS NOT NULL;

      CREATE TABLE _ppt_exam_items_backup (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL);
      INSERT INTO _ppt_exam_items_backup (id, source_id)
        SELECT id, source_id FROM quiz_exam_items WHERE source_id IS NOT NULL;

      -- Detach the children so the parent can be dropped without cascade
      -- actions. The FTS triggers are dropped because deleting the chunks would
      -- otherwise write to the FTS index while DROP TABLE is in flight.
      DROP TRIGGER IF EXISTS source_chunks_ai;
      DROP TRIGGER IF EXISTS source_chunks_ad;
      DELETE FROM source_chunks;
      UPDATE cards SET source_id = NULL WHERE source_id IS NOT NULL;
      UPDATE quiz_exam_items SET source_id = NULL WHERE source_id IS NOT NULL;

      CREATE TABLE _ppt_sources_new (
        id INTEGER PRIMARY KEY,
        notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('pdf', 'youtube', 'text', 'ppt')),
        title TEXT NOT NULL,
        url TEXT,
        file_key TEXT,
        text TEXT NOT NULL,
        meta TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO _ppt_sources_new (id, notebook_id, kind, title, url, file_key, text, meta, created_at)
        SELECT id, notebook_id, kind, title, url, ${fileKey}, text, meta, created_at FROM sources;

      DROP TABLE sources;
      ALTER TABLE _ppt_sources_new RENAME TO sources;
      CREATE INDEX IF NOT EXISTS idx_sources_notebook ON sources(notebook_id);

      -- Same ids and text as before: the FTS index stays consistent.
      INSERT INTO source_chunks (id, source_id, ord, text, page)
        SELECT id, source_id, ord, text, page FROM _ppt_chunks_backup;

      UPDATE cards SET source_id = (SELECT b.source_id FROM _ppt_cards_backup b WHERE b.id = cards.id)
        WHERE id IN (SELECT id FROM _ppt_cards_backup);
      UPDATE quiz_exam_items
        SET source_id = (SELECT b.source_id FROM _ppt_exam_items_backup b WHERE b.id = quiz_exam_items.id)
        WHERE id IN (SELECT id FROM _ppt_exam_items_backup);

      DROP TABLE _ppt_chunks_backup;
      DROP TABLE _ppt_cards_backup;
      DROP TABLE _ppt_exam_items_backup;

      CREATE TRIGGER source_chunks_ai AFTER INSERT ON source_chunks BEGIN
        INSERT INTO source_chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER source_chunks_ad AFTER DELETE ON source_chunks BEGIN
        INSERT INTO source_chunks_fts(source_chunks_fts, rowid, text)
        VALUES ('delete', old.id, old.text);
      END;

      COMMIT;
    `);
  }

  await db.execute({
    sql: 'INSERT INTO schema_meta (key, value) VALUES (?, ?)',
    args: [PPT_SOURCE_MIGRATION_KEY, new Date().toISOString()]
  });
}

export async function applySchema(db: Client): Promise<void> {
  await db.executeMultiple(SCHEMA);
  await rebuildChatTablesOnce(db);
  // The sources rebuild below snapshots source_chunks, including this column.
  // Added before the rebuild: pre-existing databases may not have it yet.
  try {
    await db.execute('ALTER TABLE source_chunks ADD COLUMN page INTEGER');
  } catch {
    // column already exists
  }
  await migrateSourceKindPpt(db);
  try {
    await db.execute('ALTER TABLE sources ADD COLUMN file_key TEXT');
  } catch {
    // column already exists
  }
  // Created after the rebuild: on legacy databases the old chat_messages table
  // has no conversation_id column, so this index cannot be part of SCHEMA.
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, id)'
  );
  // Column added after table creation: pre-existing databases get it best-effort.
  try {
    await db.execute('ALTER TABLE reviews ADD COLUMN fsrs_meta TEXT');
  } catch {
    // column already exists
  }
  try {
    await db.execute('ALTER TABLE cards ADD COLUMN generated_at TEXT');
  } catch {
    // column already exists
  }
  try {
    await db.execute('ALTER TABLE cards ADD COLUMN batch_id INTEGER REFERENCES card_batches(id) ON DELETE SET NULL');
  } catch {
    // column already exists
  }
  try {
    await db.execute('ALTER TABLE sessions ADD COLUMN created_at TEXT');
  } catch {
    // column already exists
  }
  try {
    await db.execute('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  } catch {
    // column already exists
  }
  try {
    await db.execute('ALTER TABLE users ADD COLUMN password_expires_at TEXT');
  } catch {
    // column already exists
  }
  try {
    await db.execute(
      'ALTER TABLE chat_messages ADD COLUMN quiz_exam_id INTEGER REFERENCES quiz_exams(id) ON DELETE SET NULL'
    );
  } catch {
    // column already exists
  }
}
