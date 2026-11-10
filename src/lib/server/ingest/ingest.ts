import type { Client, InValue } from '@libsql/client';
import { chunkPages, chunkText } from './chunker';
import { ownNotebook } from '../notebooks';

export interface SourceRow {
  id: number;
  notebookId: number;
  kind: 'pdf' | 'youtube' | 'text';
  title: string;
  url: string | null;
  meta: string;
  pageCount: number | null;
  createdAt: string;
}

export interface ChunkHit {
  id: number;
  sourceId: number;
  ord: number;
  text: string;
  page: number | null;
  rank: number;
}

export interface IngestResult {
  id: number;
  title: string;
  chunks: number;
}

export type IngestableKind = 'text' | 'pdf' | 'youtube';

export const MAX_SOURCES_PER_NOTEBOOK = 100;

export const SOURCE_KINDS: readonly IngestableKind[] = ['text', 'pdf', 'youtube'];

const SOURCE_COLUMNS = 's.id, s.notebook_id, s.kind, s.title, s.url, s.meta, s.created_at';

function rowToSource(row: Record<string, InValue>): SourceRow {
  return {
    id: Number(row['id']),
    notebookId: Number(row['notebook_id']),
    kind: row['kind'] === 'pdf' ? 'pdf' : row['kind'] === 'youtube' ? 'youtube' : 'text',
    title: String(row['title']),
    url: row['url'] == null ? null : String(row['url']),
    meta: String(row['meta']),
    pageCount: row['page_count'] == null ? null : Number(row['page_count']),
    createdAt: String(row['created_at'])
  };
}

function conflict(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export async function ingestTextSource(
  db: Client,
  input: {
    notebookId: number;
    title?: string;
    text?: string;
    pages?: string[];
    userId?: number;
    url?: string;
    kind?: IngestableKind;
    meta?: string;
  }
): Promise<IngestResult> {
  const kind: IngestableKind = input.kind ?? 'text';
  if (!SOURCE_KINDS.includes(kind)) {
    throw conflict('INVALID_KIND', `unsupported source kind ${String(input.kind)}`);
  }
  const hasPages = Array.isArray(input.pages);
  if (hasPages && input.pages!.some((page) => typeof page !== 'string')) {
    throw conflict('INVALID_TEXT', 'pages must be an array of strings');
  }
  // Preserve form feeds verbatim when pages are supplied: trimming the joined
  // string would strip leading blank pages and shift every page number.
  const text = hasPages ? input.pages!.join('\f') : (input.text ?? '').trim();
  if (text.replace(/\f/g, '').trim().length === 0) {
    throw conflict('INVALID_TEXT', 'source text must not be empty');
  }
  if (input.userId != null) {
    const notebook = await ownNotebook(db, input.userId, input.notebookId);
    if (!notebook) {
      throw conflict('FORBIDDEN_NOTEBOOK', 'notebook not found for this user');
    }
  }
  const count = await db.execute({
    sql: 'SELECT COUNT(*) AS n FROM sources WHERE notebook_id = ?',
    args: [input.notebookId]
  });
  if (Number(count.rows[0]?.['n'] ?? 0) >= MAX_SOURCES_PER_NOTEBOOK) {
    throw conflict('LIMIT_REACHED', `a notebook can hold at most ${MAX_SOURCES_PER_NOTEBOOK} sources`);
  }
  const title = (input.title ?? '').trim() || 'Untitled source';

  const chunks = hasPages
    ? chunkPages(input.pages!)
    : chunkText(text).map((chunk) => ({ text: chunk, page: null }));
  const inserted = await db.execute({
    sql: 'INSERT INTO sources (notebook_id, kind, title, url, text, meta) VALUES (?, ?, ?, ?, ?, ?)',
    args: [input.notebookId, kind, title, input.url ?? null, text, input.meta || `${chunks.length} chunks`]
  });
  const sourceId = Number(inserted.lastInsertRowid!);

  // One round trip instead of one per chunk (matters on remote Turso).
  const BATCH = 200;
  for (let i = 0; i < chunks.length; i += BATCH) {
    await db.batch(
      chunks.slice(i, i + BATCH).map((chunk, j) => ({
        sql: 'INSERT INTO source_chunks (source_id, ord, text, page) VALUES (?, ?, ?, ?)',
        args: [sourceId, i + j, chunk.text, chunk.page] as InValue[]
      })),
      'write'
    );
  }

  return { id: sourceId, title, chunks: chunks.length };
}

export async function sourceInNotebook(
  db: Client,
  notebookId: number,
  sourceId: number
): Promise<boolean> {
  const result = await db.execute({
    sql: 'SELECT 1 FROM sources WHERE id = ? AND notebook_id = ?',
    args: [sourceId, notebookId]
  });
  return result.rows.length > 0;
}

export async function listSources(db: Client, notebookId: number): Promise<SourceRow[]> {
  const result = await db.execute({
    sql: `SELECT ${SOURCE_COLUMNS},
                 (SELECT MAX(page) FROM source_chunks WHERE source_id = s.id) AS page_count
          FROM sources s
          WHERE s.notebook_id = ?
          ORDER BY s.created_at DESC, s.id DESC`,
    args: [notebookId]
  });
  return result.rows.map(rowToSource);
}

const MAX_QUERY_TERMS = 12;

function ftsQueryFor(query: string): string | null {
  const match = query
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_QUERY_TERMS)
    .join(' ')
    .trim();
  if (match.length === 0) {
    return null;
  }
  const terms = match.split(/\s+/).filter(Boolean);
  return terms.length > 1 ? terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ') : match;
}

function rowToHit(row: Record<string, InValue>): ChunkHit {
  return {
    id: Number(row['id']),
    sourceId: Number(row['source_id']),
    ord: Number(row['ord']),
    text: String(row['text']),
    page: row['page'] == null ? null : Number(row['page']),
    rank: Number(row['rank'])
  };
}

export async function searchChunks(db: Client, notebookId: number, query: string, k: number): Promise<ChunkHit[]> {
  const ftsQuery = ftsQueryFor(query);
  if (ftsQuery === null) {
    return [];
  }
  const result = await db.execute({
    sql: `SELECT sc.id AS id, sc.source_id AS source_id, sc.ord AS ord, sc.text AS text, sc.page AS page,
                 bm25(source_chunks_fts) AS rank
          FROM source_chunks_fts
          JOIN source_chunks sc ON sc.id = source_chunks_fts.rowid
          JOIN sources s ON s.id = sc.source_id
          WHERE source_chunks_fts MATCH ? AND s.notebook_id = ?
          ORDER BY rank
          LIMIT ?`,
    args: [ftsQuery, notebookId, k]
  });
  return result.rows.map(rowToHit);
}

/** FTS search limited to an explicit set of sources in the notebook. */
export async function searchChunksInSources(
  db: Client,
  notebookId: number,
  sourceIds: number[],
  query: string,
  k: number
): Promise<ChunkHit[]> {
  const ids = [...new Set(sourceIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) {
    return [];
  }
  const ftsQuery = ftsQueryFor(query);
  if (ftsQuery === null) {
    return [];
  }
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.execute({
    sql: `SELECT sc.id AS id, sc.source_id AS source_id, sc.ord AS ord, sc.text AS text, sc.page AS page,
                 bm25(source_chunks_fts) AS rank
          FROM source_chunks_fts
          JOIN source_chunks sc ON sc.id = source_chunks_fts.rowid
          JOIN sources s ON s.id = sc.source_id
          WHERE source_chunks_fts MATCH ?
            AND s.notebook_id = ?
            AND sc.source_id IN (${placeholders})
          ORDER BY rank
          LIMIT ?`,
    args: [ftsQuery, notebookId, ...ids, k]
  });
  return result.rows.map(rowToHit);
}
