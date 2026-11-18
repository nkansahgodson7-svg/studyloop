import type { Client } from '@libsql/client';
import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from './auth';
import { ownNotebook } from './notebooks';
import { ingestTextSource, listSources, SOURCE_KINDS, type IngestableKind } from './ingest/ingest';
import { detectChapters } from './ingest/pages';
import { extractPptText } from './ingest/ppt';
import { signedSourceFileUrl, storeSourceFile } from './source-files';
import { INGEST_LIMIT, rateLimitResponse } from './ratelimit';

const MAX_SOURCE_TEXT = 2_000_000;

function statusForCode(code: string): number {
  if (code === 'INVALID_TEXT') return 400;
  if (code === 'FORBIDDEN_NOTEBOOK') return 404;
  if (code === 'LIMIT_REACHED') return 409;
  return 500;
}

interface CodedError extends Error {
  code?: string;
}

export async function textSourceCreate(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const notebookId = Number(idRaw);
    if (!Number.isInteger(notebookId)) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    // Ownership and budget are checked before the (up to 2 MB) body is parsed.
    const notebook = await ownNotebook(db, user.id, notebookId);
    if (!notebook) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    const limited = await rateLimitResponse(db, `ingest:${user.id}`, INGEST_LIMIT);
    if (limited) {
      return limited;
    }

    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const body = parsedBody as {
      title?: unknown;
      text?: unknown;
      pages?: unknown;
      kind?: unknown;
      pageCount?: unknown;
      fileKey?: unknown;
    };
    let fileKey: string | null = null;
    if (body.fileKey != null) {
      if (typeof body.fileKey !== 'string' || body.fileKey.length === 0 || body.fileKey.length > 512) {
        return NextResponse.json({ error: 'invalid file key' }, { status: 400 });
      }
      fileKey = body.fileKey;
    }
    let pages: string[] | undefined;
    let text: string;
    if (body.pages !== undefined) {
      if (!Array.isArray(body.pages) || body.pages.some((page) => typeof page !== 'string')) {
        return NextResponse.json({ error: 'pages must be an array of strings' }, { status: 400 });
      }
      pages = body.pages as string[];
      text = pages.join('\f');
    } else if (typeof body.text === 'string') {
      text = body.text;
    } else {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }
    if (text.length > MAX_SOURCE_TEXT) {
      return NextResponse.json({ error: 'source text too large' }, { status: 413 });
    }
    if (body.kind != null && !SOURCE_KINDS.includes(body.kind as IngestableKind)) {
      return NextResponse.json({ error: 'unsupported source kind' }, { status: 400 });
    }
    const title = typeof body.title === 'string' ? body.title : undefined;
    const kind = body.kind as IngestableKind | undefined;
    const pageCount =
      typeof body.pageCount === 'number' && Number.isInteger(body.pageCount) && body.pageCount > 0
        ? body.pageCount
        : pages
          ? pages.length
          : null;

    const result = await ingestTextSource(db, {
      notebookId,
      userId: user.id,
      title,
      text,
      pages,
      kind,
      // Only PowerPoint sources keep the original file for rendering.
      fileKey: kind === 'ppt' ? fileKey : null
    });
    if ((kind === 'pdf' || kind === 'ppt') && pageCount) {
      const unit = kind === 'ppt' ? 'slides' : 'pages';
      await db.execute({
        sql: 'UPDATE sources SET meta = ? WHERE id = ?',
        args: [`${pageCount} ${unit} · ${result.chunks} chunks`, result.id]
      });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if ((error as CodedError).code) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: statusForCode((error as CodedError).code!) }
      );
    }
    return errorResponse(error);
  }
}

const MAX_PPT_BYTES = 4 * 1024 * 1024;

export async function pptSourceCreate(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const notebookId = Number(idRaw);
    if (!Number.isInteger(notebookId)) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    const notebook = await ownNotebook(db, user.id, notebookId);
    if (!notebook) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    const limited = await rateLimitResponse(db, `ingest:${user.id}`, INGEST_LIMIT);
    if (limited) return limited;

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file required' }, { status: 400 });
    }
    const name = file.name || 'presentation.ppt';
    if (!name.toLowerCase().endsWith('.ppt')) {
      return NextResponse.json({ error: 'only .ppt files are accepted here' }, { status: 400 });
    }
    if (file.size > MAX_PPT_BYTES) {
      return NextResponse.json({ error: 'PowerPoint file too large (max 4 MB)' }, { status: 413 });
    }
    const buffer = await file.arrayBuffer();
    let extracted: ReturnType<typeof extractPptText>;
    try {
      extracted = extractPptText(buffer);
    } catch {
      return NextResponse.json(
        { error: 'Could not read that PowerPoint file (it may be password-protected or corrupt).' },
        { status: 400 }
      );
    }
    if (extracted.pages.every((p) => p.trim().length === 0)) {
      return NextResponse.json({ error: 'no extractable text in this presentation' }, { status: 400 });
    }
    const fileKey = await storeSourceFile(new Uint8Array(buffer), name, 'application/vnd.ms-powerpoint');
    const result = await ingestTextSource(db, {
      notebookId,
      userId: user.id,
      title: name,
      pages: extracted.pages,
      kind: 'ppt',
      fileKey
    });
    if (extracted.pageCount > 0) {
      await db.execute({
        sql: 'UPDATE sources SET meta = ? WHERE id = ?',
        args: [`${extracted.pageCount} slides · ${result.chunks} chunks`, result.id]
      });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if ((error as CodedError).code) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: statusForCode((error as CodedError).code!) }
      );
    }
    return errorResponse(error);
  }
}

export async function sourcesList(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const notebookId = Number(idRaw);
    if (!Number.isInteger(notebookId)) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    const notebook = await ownNotebook(db, user.id, notebookId);
    if (!notebook) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    return NextResponse.json(await listSources(db, notebookId));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Source detail for the in-app preview. Pages are split on form feeds, so a
 * PowerPoint source returns one entry per slide (empty slides included).
 */
export async function sourceGet(
  db: Client,
  req: Request,
  idRaw: string,
  sourceIdRaw: string
): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const notebookId = Number(idRaw);
    const sourceId = Number(sourceIdRaw);
    if (!Number.isInteger(notebookId) || !Number.isInteger(sourceId)) {
      return NextResponse.json({ error: 'unknown source' }, { status: 404 });
    }
    const notebook = await ownNotebook(db, user.id, notebookId);
    if (!notebook) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    const result = await db.execute({
      sql: `SELECT s.id, s.kind, s.title, s.url, s.meta, s.file_key, s.text, s.created_at
              FROM sources s
             WHERE s.id = ? AND s.notebook_id = ?`,
      args: [sourceId, notebookId]
    });
    const row = result.rows[0];
    if (!row) {
      return NextResponse.json({ error: 'unknown source' }, { status: 404 });
    }
    return NextResponse.json({
      id: Number(row['id']),
      kind: String(row['kind']),
      title: String(row['title']),
      url: row['url'] == null ? null : String(row['url']),
      meta: String(row['meta']),
      fileUrl: row['file_key'] == null ? null : await signedSourceFileUrl(String(row['file_key'])),
      pages: String(row['text'] ?? '').split('\f'),
      createdAt: String(row['created_at'])
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Heuristically scan the first line of each stored page for a chapter-style
 * heading. Returns an empty list for unpaged (legacy) sources and for sources
 * whose pages do not look chaptered.
 */
export async function chaptersGet(
  db: Client,
  req: Request,
  idRaw: string,
  sourceIdRaw: string
): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const notebookId = Number(idRaw);
    const sourceId = Number(sourceIdRaw);
    if (!Number.isInteger(notebookId) || !Number.isInteger(sourceId)) {
      return NextResponse.json({ error: 'unknown source' }, { status: 404 });
    }
    const notebook = await ownNotebook(db, user.id, notebookId);
    if (!notebook) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    const result = await db.execute({
      sql: `SELECT s.text AS text,
                   (SELECT MAX(page) FROM source_chunks WHERE source_id = s.id) AS page_count
            FROM sources s
            WHERE s.id = ? AND s.notebook_id = ?`,
      args: [sourceId, notebookId]
    });
    const row = result.rows[0];
    if (!row) {
      return NextResponse.json({ error: 'unknown source' }, { status: 404 });
    }
    if (row.page_count == null) {
      return NextResponse.json([]);
    }
    const pages = String(row.text).split('\f');
    return NextResponse.json(detectChapters(pages));
  } catch (error) {
    return errorResponse(error);
  }
}
