import type { Client, InValue } from '@libsql/client';
import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from './auth';

const MAX_TITLE_LENGTH = 200;

export interface NotebookRow {
  id: number;
  userId: number;
  title: string;
  createdAt: string;
}

const NOTEBOOK_COLUMNS = 'id, user_id, title, created_at';

function rowToNotebook(row: Record<string, InValue>): NotebookRow {
  return {
    id: Number(row['id']),
    userId: Number(row['user_id']),
    title: String(row['title']),
    createdAt: String(row['created_at'])
  };
}

export async function createNotebook(db: Client, userId: number, title: string): Promise<NotebookRow> {
  const result = await db.execute({
    sql: 'INSERT INTO notebooks (user_id, title) VALUES (?, ?)',
    args: [userId, title.trim()]
  });
  const id = Number(result.lastInsertRowid!);
  const row = await db.execute({
    sql: `SELECT ${NOTEBOOK_COLUMNS} FROM notebooks WHERE id = ?`,
    args: [id]
  });
  return rowToNotebook(row.rows[0]!);
}

export async function listNotebooks(db: Client, userId: number): Promise<NotebookRow[]> {
  const result = await db.execute({
    sql: `SELECT ${NOTEBOOK_COLUMNS} FROM notebooks WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
    args: [userId]
  });
  return result.rows.map(rowToNotebook);
}

export interface NotebookViewRow {
  notebook: NotebookRow;
  sources: number;
  cards: number;
  due: number;
}

export async function listNotebookViews(
  db: Client,
  userId: number,
  now: Date
): Promise<NotebookViewRow[]> {
  const result = await db.execute({
    sql: `SELECT nb.id, nb.user_id, nb.title, nb.created_at,
                 COUNT(DISTINCT s.id) AS sources,
                 COUNT(DISTINCT c.id) AS cards,
                 COUNT(DISTINCT CASE WHEN r.due <= ? THEN c.id END) AS due
          FROM notebooks nb
          LEFT JOIN sources s ON s.notebook_id = nb.id
          LEFT JOIN cards c ON c.notebook_id = nb.id
          LEFT JOIN reviews r ON r.card_id = c.id
          WHERE nb.user_id = ?
          GROUP BY nb.id
          ORDER BY nb.created_at DESC, nb.id DESC`,
    args: [now.toISOString(), userId]
  });
  return result.rows.map((row) => ({
    notebook: rowToNotebook(row),
    sources: Number(row.sources),
    cards: Number(row.cards),
    due: Number(row.due)
  }));
}

export async function ownNotebook(db: Client, userId: number, id: number): Promise<NotebookRow | null> {
  const result = await db.execute({
    sql: `SELECT ${NOTEBOOK_COLUMNS} FROM notebooks WHERE id = ? AND user_id = ?`,
    args: [id, userId]
  });
  const row = result.rows[0];
  return row ? rowToNotebook(row) : null;
}

export async function deleteNotebook(db: Client, userId: number, id: number): Promise<boolean> {
  const result = await db.execute({
    sql: 'DELETE FROM notebooks WHERE id = ? AND user_id = ?',
    args: [id, userId]
  });
  return Number(result.rowsAffected) > 0;
}

export async function notebooksList(db: Client, req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    return NextResponse.json(await listNotebooks(db, user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function notebooksViews(db: Client, req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    return NextResponse.json(await listNotebookViews(db, user.id, new Date()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function notebooksCreate(db: Client, req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const title = typeof (parsedBody as { title?: unknown })?.title === 'string'
      ? (parsedBody as { title: string }).title.trim()
      : '';
    if (title.length < 1 || title.length > MAX_TITLE_LENGTH) {
      return NextResponse.json(
        { error: `title must be 1-${MAX_TITLE_LENGTH} characters` },
        { status: 400 }
      );
    }
    const notebook = await createNotebook(db, user.id, title);
    return NextResponse.json(notebook, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function notebooksDelete(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const id = Number(idRaw);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    const deleted = await deleteNotebook(db, user.id, id);
    if (!deleted) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function notebooksDetail(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const id = Number(idRaw);
    const notebook = Number.isInteger(id) ? await ownNotebook(db, user.id, id) : null;
    if (!notebook) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    return NextResponse.json(notebook);
  } catch (error) {
    return errorResponse(error);
  }
}
