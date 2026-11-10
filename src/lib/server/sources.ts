import type { Client } from '@libsql/client';
import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from './auth';
import { ownNotebook } from './notebooks';
import { ingestTextSource, listSources, SOURCE_KINDS, type IngestableKind } from './ingest/ingest';
import { detectChapters } from './ingest/pages';
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
    };
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

    const result = await ingestTextSource(db, { notebookId, userId: user.id, title, text, pages, kind });
    if (kind === 'pdf' && pageCount) {
      await db.execute({
        sql: 'UPDATE sources SET meta = ? WHERE id = ?',
        args: [`${pageCount} pages · ${result.chunks} chunks`, result.id]
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
