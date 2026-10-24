import type { Client, InValue } from '@libsql/client';
import { chunkText } from './chunker';
import { ownNotebook } from '../notebooks';

export interface SourceRow {
  id: number;
  notebookId: number;
  kind: 'pdf' | 'youtube' | 'text';
  title: string;
  url: string | null;
  meta: string;
  createdAt: string;
}

export interface ChunkHit {
  id: number;
  sourceId: number;
  ord: number;
  text: string;
  rank: number;
}

export interface IngestResult {
  id: number;
  title: string;
  chunks: number;
}

export type IngestableKind = 'text' | 'pdf' | 'youtube';

export const SOURCE_KINDS: readonly IngestableKind[] = ['text', 'pdf', 'youtube'];

const SOURCE_COLUMNS = 'id, notebook_id, kind, title, url, meta, created_at';

function rowToSource(row: Record<string, InValue>): SourceRow {
  return {
    id: Number(row['id']),
    notebookId: Number(row['notebook_id']),
    kind: row['kind'] === 'pdf' ? 'pdf' : row['kind'] === 'youtube' ? 'youtube' : 'text',
    title: String(row['title']),
    url: row['url'] == null ? null : String(row['url']),
    meta: String(row['meta']),
    createdAt: String(row['created_at'])
  };
}

function conflict(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export async function ingestTextSource(
  db: Client,
  input: { notebookId: number; title?: string; text: string; userId?: number; url?: string; kind?: IngestableKind }
): Promise<IngestResult> {
  const kind: IngestableKind = input.kind ?? 'text';
  if (!SOURCE_KINDS.includes(kind)) {
    throw conflict('INVALID_KIND', `unsupported source kind ${String(input.kind)}`);
  }
  const text = input.text.trim();
  if (text.length === 0) {
    throw conflict('INVALID_TEXT', 'source text must not be empty');
  }
  if (input.userId != null) {
    const notebook = await ownNotebook(db, input.userId, input.notebookId);
    if (!notebook) {
      throw conflict('FORBIDDEN_NOTEBOOK', 'notebook not found for this user');
    }
  }
  const title = (input.title ?? '').trim() || 'Untitled source';

  const inserted = await db.execute({
    sql: 'INSERT INTO sources (notebook_id, kind, title, url, text) VALUES (?, ?, ?, ?, ?)',
    args: [input.notebookId, kind, title, input.url ?? null, text]
  });
  const sourceId = Number(inserted.lastInsertRowid!);

  const chunks = chunkText(text);
  for (let ord = 0; ord < chunks.length; ord++) {
    await db.execute({
      sql: 'INSERT INTO source_chunks (source_id, ord, text) VALUES (?, ?, ?)',
      args: [sourceId, ord, chunks[ord]!]
    });
  }

  return { id: sourceId, title, chunks: chunks.length };
}

export async function listSources(db: Client, notebookId: number): Promise<SourceRow[]> {
  const result = await db.execute({
    sql: `SELECT ${SOURCE_COLUMNS} FROM sources WHERE notebook_id = ? ORDER BY created_at DESC, id DESC`,
    args: [notebookId]
  });
  return result.rows.map(rowToSource);
}

const MAX_QUERY_TERMS = 12;

export async function searchChunks(db: Client, notebookId: number, query: string, k: number): Promise<ChunkHit[]> {
  const match = query
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_QUERY_TERMS)
    .join(' ')
    .trim();
  if (match.length === 0) {
    return [];
  }
  const terms = match.split(/\s+/).filter(Boolean);
  const ftsQuery = terms.length > 1 ? terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ') : match;
  const result = await db.execute({
    sql: `SELECT sc.id AS id, sc.source_id AS source_id, sc.ord AS ord, sc.text AS text,
                 bm25(source_chunks_fts) AS rank
          FROM source_chunks_fts
          JOIN source_chunks sc ON sc.id = source_chunks_fts.rowid
          JOIN sources s ON s.id = sc.source_id
          WHERE source_chunks_fts MATCH ? AND s.notebook_id = ?
          ORDER BY rank
          LIMIT ?`,
    args: [ftsQuery, notebookId, k]
  });
  return result.rows.map((row) => ({
    id: Number(row['id']),
    sourceId: Number(row['source_id']),
    ord: Number(row['ord']),
    text: String(row['text']),
    rank: Number(row['rank'])
  }));
}
