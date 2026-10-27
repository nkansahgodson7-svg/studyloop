import type { Client } from '@libsql/client';
import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from './auth';
import { ownNotebook } from './notebooks';
import { listSources } from './ingest/ingest';
import { listCardsWithReview } from './cards';
import { listChatMessages } from './chat';

export async function notebookBundle(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
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

    const [sources, cards, messages] = await Promise.all([
      listSources(db, notebookId),
      listCardsWithReview(db, notebookId),
      listChatMessages(db, notebookId)
    ]);

    return NextResponse.json({
      id: notebook.id,
      title: notebook.title,
      sources,
      cards,
      messages
    });
  } catch (error) {
    return errorResponse(error);
  }
}
