import type { Client } from '@libsql/client';
import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from './auth';
import { ownNotebook } from './notebooks';
import { ingestTextSource, listSources, SOURCE_KINDS, type IngestableKind } from './ingest/ingest';

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

    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const body = parsedBody as { title?: unknown; text?: unknown; kind?: unknown; pageCount?: unknown };
    if (typeof body.text !== 'string') {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }
    if (body.text.length > MAX_SOURCE_TEXT) {
      return NextResponse.json({ error: 'source text too large' }, { status: 413 });
    }
    if (body.kind != null && !SOURCE_KINDS.includes(body.kind as IngestableKind)) {
      return NextResponse.json({ error: 'unsupported source kind' }, { status: 400 });
    }
    const title = typeof body.title === 'string' ? body.title : undefined;
    const kind = body.kind as IngestableKind | undefined;
    const pageCount = typeof body.pageCount === 'number' && Number.isInteger(body.pageCount) && body.pageCount > 0 ? body.pageCount : null;

    const result = await ingestTextSource(db, { notebookId, userId: user.id, title, text: body.text, kind });
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
