import type { Client, InValue } from '@libsql/client';
import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireUser } from './auth';
import { ownNotebook } from './notebooks';

export const TITLE_MAX = 80;
export const DEFAULT_TITLE = 'New chat';
export const MESSAGE_PAGE_SIZE = 50;
const PREVIEW_MAX = 140;

export type Grounding = 'sources' | 'general' | 'mixed';

export interface SourceRef {
  sourceId: number;
  sourceTitle: string;
  ord: number;
  page: number | null;
  /** Display hint: "p. 12" for paged PDFs, "chunk 3" otherwise. */
  label: string;
}

export interface ConversationRow {
  id: number;
  notebookId: number;
  title: string;
  titleSource: 'auto' | 'user' | 'fallback';
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSummary extends ConversationRow {
  preview: string;
}

export interface ChatMessageRow {
  id: number;
  conversationId: number;
  role: 'user' | 'assistant';
  content: string;
  grounding: Grounding | null;
  sources: SourceRef[];
  status: 'complete' | 'stopped' | 'error';
  createdAt: string;
}

const CONVERSATION_COLUMNS =
  'id, notebook_id, title, title_source, created_at, updated_at';

function rowToConversation(row: Record<string, InValue>): ConversationRow {
  return {
    id: Number(row['id']),
    notebookId: Number(row['notebook_id']),
    title: String(row['title']),
    titleSource:
      row['title_source'] === 'user'
        ? 'user'
        : row['title_source'] === 'fallback'
          ? 'fallback'
          : 'auto',
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at'])
  };
}

function parseSources(raw: unknown): SourceRef[] {
  if (raw == null) return [];
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
      .map((item) => ({
        sourceId: Number(item['sourceId'] ?? 0),
        sourceTitle: String(item['sourceTitle'] ?? 'Unknown source'),
        ord: Number(item['ord'] ?? 0),
        page: item['page'] == null ? null : Number(item['page']),
        label: String(item['label'] ?? '')
      }))
      .filter((item) => Number.isFinite(item.sourceId) && item.sourceId > 0);
  } catch {
    return [];
  }
}

export function rowToMessage(row: Record<string, InValue>): ChatMessageRow {
  const grounding =
    row['grounding'] === 'sources' || row['grounding'] === 'general' || row['grounding'] === 'mixed'
      ? row['grounding']
      : null;
  const status =
    row['status'] === 'stopped' ? 'stopped' : row['status'] === 'error' ? 'error' : 'complete';
  return {
    id: Number(row['id']),
    conversationId: Number(row['conversation_id']),
    role: row['role'] === 'user' ? 'user' : 'assistant',
    content: String(row['content']),
    grounding,
    sources: parseSources(row['sources']),
    status,
    createdAt: String(row['created_at'])
  };
}

export function sourceRefLabel(hit: { ord: number; page: number | null }): string {
  return hit.page != null ? `p. ${hit.page}` : `chunk ${hit.ord + 1}`;
}

/** Conversation owned by `userId` (via its notebook), or null. */
export async function ownConversation(
  db: Client,
  userId: number,
  conversationId: number
): Promise<ConversationRow | null> {
  if (!Number.isInteger(conversationId)) {
    return null;
  }
  const result = await db.execute({
    sql: `SELECT c.id, c.notebook_id, c.title, c.title_source, c.created_at, c.updated_at
          FROM chat_conversations c
          JOIN notebooks nb ON nb.id = c.notebook_id
          WHERE c.id = ? AND nb.user_id = ?`,
    args: [conversationId, userId]
  });
  const row = result.rows[0];
  return row ? rowToConversation(row) : null;
}

export async function createConversation(
  db: Client,
  notebookId: number,
  title = DEFAULT_TITLE
): Promise<ConversationRow> {
  const result = await db.execute({
    sql: 'INSERT INTO chat_conversations (notebook_id, title) VALUES (?, ?)',
    args: [notebookId, title]
  });
  const id = Number(result.lastInsertRowid!);
  const row = await db.execute({
    sql: `SELECT ${CONVERSATION_COLUMNS} FROM chat_conversations WHERE id = ?`,
    args: [id]
  });
  return rowToConversation(row.rows[0]!);
}

function previewOf(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1).trimEnd()}…` : flat;
}

export async function listConversations(
  db: Client,
  notebookId: number
): Promise<ConversationSummary[]> {
  const result = await db.execute({
    sql: `SELECT ${CONVERSATION_COLUMNS},
                 (SELECT m.content FROM chat_messages m
                   WHERE m.conversation_id = chat_conversations.id
                   ORDER BY m.id DESC LIMIT 1) AS preview
          FROM chat_conversations
          WHERE notebook_id = ?
          ORDER BY updated_at DESC, id DESC`,
    args: [notebookId]
  });
  return result.rows.map((row) => ({
    ...rowToConversation(row),
    preview: row['preview'] == null ? '' : previewOf(String(row['preview']))
  }));
}

export async function renameConversation(
  db: Client,
  conversationId: number,
  title: string
): Promise<ConversationRow> {
  await db.execute({
    sql: "UPDATE chat_conversations SET title = ?, title_source = 'user' WHERE id = ?",
    args: [title, conversationId]
  });
  const row = await db.execute({
    sql: `SELECT ${CONVERSATION_COLUMNS} FROM chat_conversations WHERE id = ?`,
    args: [conversationId]
  });
  return rowToConversation(row.rows[0]!);
}

export async function setGeneratedTitle(
  db: Client,
  conversationId: number,
  title: string,
  titleSource: 'auto' | 'fallback'
): Promise<void> {
  await db.execute({
    sql: `UPDATE chat_conversations SET title = ?, title_source = ?
          WHERE id = ? AND title_source != 'user'`,
    args: [title, titleSource, conversationId]
  });
}

export async function deleteConversation(db: Client, conversationId: number): Promise<void> {
  await db.execute({ sql: 'DELETE FROM chat_conversations WHERE id = ?', args: [conversationId] });
}

export async function touchConversation(db: Client, conversationId: number): Promise<void> {
  await db.execute({
    sql: 'UPDATE chat_conversations SET updated_at = ? WHERE id = ?',
    args: [new Date().toISOString(), conversationId]
  });
}

export interface MessagePage {
  messages: ChatMessageRow[];
  hasMore: boolean;
}

export async function listMessages(
  db: Client,
  conversationId: number,
  options: { before?: number; limit?: number } = {}
): Promise<MessagePage> {
  const limit = options.limit ?? MESSAGE_PAGE_SIZE;
  const result = await db.execute({
    sql: `SELECT id, conversation_id, role, content, grounding, sources, status, created_at
          FROM chat_messages
          WHERE conversation_id = ?${options.before != null ? ' AND id < ?' : ''}
          ORDER BY id DESC
          LIMIT ?`,
    args: [
      conversationId,
      ...(options.before != null ? [options.before] : []),
      limit + 1
    ] as InValue[]
  });
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit).map(rowToMessage);
  return { messages: rows.reverse(), hasMore };
}

export async function createMessage(
  db: Client,
  conversationId: number,
  input: {
    role: 'user' | 'assistant';
    content: string;
    grounding?: Grounding | null;
    sources?: SourceRef[];
    status?: 'complete' | 'stopped' | 'error';
  }
): Promise<ChatMessageRow> {
  const result = await db.execute({
    sql: `INSERT INTO chat_messages (conversation_id, role, content, grounding, sources, status)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      conversationId,
      input.role,
      input.content,
      input.grounding ?? null,
      JSON.stringify(input.sources ?? []),
      input.status ?? 'complete'
    ]
  });
  const row = await db.execute({
    sql: `SELECT id, conversation_id, role, content, grounding, sources, status, created_at
          FROM chat_messages WHERE id = ?`,
    args: [Number(result.lastInsertRowid!)]
  });
  return rowToMessage(row.rows[0]!);
}

export async function updateMessageContent(
  db: Client,
  messageId: number,
  content: string
): Promise<void> {
  await db.execute({
    sql: 'UPDATE chat_messages SET content = ? WHERE id = ?',
    args: [content, messageId]
  });
}

/** Removes messages after `messageId` within the conversation (edit/regenerate). */
export async function deleteMessagesAfter(
  db: Client,
  conversationId: number,
  messageId: number
): Promise<void> {
  await db.execute({
    sql: 'DELETE FROM chat_messages WHERE conversation_id = ? AND id > ?',
    args: [conversationId, messageId]
  });
}

export async function messageOwned(
  db: Client,
  conversationId: number,
  messageId: number
): Promise<ChatMessageRow | null> {
  const result = await db.execute({
    sql: `SELECT id, conversation_id, role, content, grounding, sources, status, created_at
          FROM chat_messages WHERE id = ? AND conversation_id = ?`,
    args: [messageId, conversationId]
  });
  const row = result.rows[0];
  return row ? rowToMessage(row) : null;
}

/** The user message immediately preceding `messageId` (for regenerate). */
export async function previousUserMessage(
  db: Client,
  conversationId: number,
  messageId: number
): Promise<ChatMessageRow | null> {
  const result = await db.execute({
    sql: `SELECT id, conversation_id, role, content, grounding, sources, status, created_at
          FROM chat_messages
          WHERE conversation_id = ? AND id < ? AND role = 'user'
          ORDER BY id DESC LIMIT 1`,
    args: [conversationId, messageId]
  });
  const row = result.rows[0];
  return row ? rowToMessage(row) : null;
}

/**
 * Conversational history for the prompt: messages before `beforeId`, oldest
 * first, capped by turn count and a character budget (newest kept first).
 */
export async function historyForPrompt(
  db: Client,
  conversationId: number,
  beforeId: number | null,
  turns: number,
  charBudget: number
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const limit = Math.max(1, turns) * 2;
  const result = await db.execute({
    sql: `SELECT role, content FROM chat_messages
          WHERE conversation_id = ?${beforeId != null ? ' AND id < ?' : ''}
          ORDER BY id DESC LIMIT ?`,
    args: [
      conversationId,
      ...(beforeId != null ? [beforeId] : []),
      limit
    ] as InValue[]
  });
  const kept: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let used = 0;
  for (const row of result.rows) {
    const role = row['role'] === 'user' ? 'user' : 'assistant';
    const content = String(row['content']);
    if (content.trim().length === 0) continue;
    const next = used + content.length;
    if (kept.length > 0 && next > charBudget) break;
    kept.push({ role, content });
    used = next;
  }
  return kept.reverse();
}

function notebookIdFrom(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

async function ownedNotebookOr404(db: Client, userId: number, notebookId: number) {
  const notebook = await ownNotebook(db, userId, notebookId);
  if (!notebook) {
    throw new HttpError(404, 'unknown notebook');
  }
  return notebook;
}

function parseBefore(url: string): number | undefined {
  try {
    const value = new URL(url).searchParams.get('before');
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function chatsList(
  db: Client,
  req: Request,
  idRaw: string
): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const notebookId = notebookIdFrom(idRaw);
    if (notebookId === null) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    await ownedNotebookOr404(db, user.id, notebookId);
    return NextResponse.json(await listConversations(db, notebookId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function chatsCreate(
  db: Client,
  req: Request,
  idRaw: string
): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const notebookId = notebookIdFrom(idRaw);
    if (notebookId === null) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    await ownedNotebookOr404(db, user.id, notebookId);
    const conversation = await createConversation(db, notebookId);
    return NextResponse.json(conversation, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function chatDetail(
  db: Client,
  req: Request,
  chatIdRaw: string
): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const chatbotId = Number(chatIdRaw);
    const conversation = await ownConversation(db, user.id, chatbotId);
    if (!conversation) {
      return NextResponse.json({ error: 'unknown chat' }, { status: 404 });
    }
    const page = await listMessages(db, conversation.id, { before: parseBefore(req.url) });
    return NextResponse.json({
      conversation,
      messages: page.messages,
      hasMore: page.hasMore
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function chatRename(
  db: Client,
  req: Request,
  chatIdRaw: string
): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const conversation = await ownConversation(db, user.id, Number(chatIdRaw));
    if (!conversation) {
      return NextResponse.json({ error: 'unknown chat' }, { status: 404 });
    }
    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const title = typeof (parsedBody as { title?: unknown })?.title === 'string'
      ? (parsedBody as { title: string }).title.trim()
      : '';
    if (title.length < 1 || title.length > TITLE_MAX) {
      return NextResponse.json(
        { error: `title must be 1-${TITLE_MAX} characters` },
        { status: 400 }
      );
    }
    return NextResponse.json(await renameConversation(db, conversation.id, title));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function chatDelete(
  db: Client,
  req: Request,
  chatIdRaw: string
): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const conversation = await ownConversation(db, user.id, Number(chatIdRaw));
    if (!conversation) {
      return NextResponse.json({ error: 'unknown chat' }, { status: 404 });
    }
    await deleteConversation(db, conversation.id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
