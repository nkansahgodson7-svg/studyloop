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
  kind TEXT NOT NULL CHECK (kind IN ('pdf', 'youtube', 'text')),
  title TEXT NOT NULL,
  url TEXT,
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

CREATE INDEX IF NOT EXISTS idx_sources_notebook ON sources(notebook_id);
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
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, id);
  `);
  await db.execute({
    sql: 'INSERT INTO schema_meta (key, value) VALUES (?, ?)',
    args: [CHAT_REBUILD_KEY, new Date().toISOString()]
  });
}

export async function applySchema(db: Client): Promise<void> {
  await db.executeMultiple(SCHEMA);
  await rebuildChatTablesOnce(db);
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
    await db.execute('ALTER TABLE source_chunks ADD COLUMN page INTEGER');
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
}
