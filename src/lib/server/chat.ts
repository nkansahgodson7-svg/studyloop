import type { Client, InValue } from '@libsql/client';
import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from './auth';
import { loadUserPlainKey } from './llmkey';
import { listSources, searchChunks, type ChunkHit } from './ingest/ingest';
import { ownNotebook } from './notebooks';

export const CHAT_QUESTION_MAX = 1000;
export const SEARCH_K = 5;
export const REFUSAL_MESSAGE = "The sources in this notebook don't cover that, so I can't answer from them.";

export interface CitationItem {
  n: number;
  sourceId: number;
  ord: number;
  sourceTitle: string;
}

export type ChunkSearcher = (db: Client, notebookId: number, query: string, k: number) => Promise<ChunkHit[]>;
export type LlmKeyResolver = (db: Client, userId: number) => Promise<string | null>;
export type DeltaStream = (apiKey: string, system: string, question: string) => AsyncIterable<string>;

export interface ChatDeps {
  search: ChunkSearcher;
  resolveLlmKey: LlmKeyResolver;
  completeStream: DeltaStream;
}

export async function resolveLlmKey(db: Client, userId: number): Promise<string | null> {
  const personal = await loadUserPlainKey(db, userId);
  if (personal && personal.trim().length > 0) {
    return personal;
  }
  const envKey = process.env.GROQ_API_KEY;
  return envKey && envKey.trim().length > 0 ? envKey : null;
}

export function buildSystemPrompt(items: Array<{ n: number; sourceTitle: string; text: string }>): string {
  const excerpts = items
    .map((item) => `[${item.n}] (${item.sourceTitle}) ${item.text}`)
    .join('\n');
  return [
    'You are StudyLoop, a study assistant whose answers are grounded ONLY in the numbered excerpts below, which come from the notebook sources.',
    '',
    'Excerpts:',
    excerpts,
    '',
    'Rules:',
    '- Every factual claim must cite the excerpt number(s) in square brackets right after the claim, e.g. [1] or [1][3].',
    `- If the excerpts do not support answering the question, reply with exactly: ${REFUSAL_MESSAGE}`,
    '- Never use knowledge beyond the excerpts. Keep answers concrete and at most about 6 sentences.'
  ].join('\n');
}

export async function* groqDeltas(apiKey: string, system: string, question: string): AsyncGenerator<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b',
      stream: true,
      temperature: 0.2,
      max_tokens: 800,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: question }
      ]
    })
  });
  if (!res.ok || !res.body) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw Object.assign(new Error(`LLM request failed (${res.status}) ${detail}`), { code: 'LLM_ERROR' });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) {
      const line = event.split('\n').find((candidate) => candidate.startsWith('data: '));
      if (!line) continue;
      const payload = line.slice('data: '.length);
      if (payload === '[DONE]') return;
      let parsed: { choices?: Array<{ delta?: { content?: string } }> };
      try {
        parsed = JSON.parse(payload) as typeof parsed;
      } catch {
        continue;
      }
      const text = parsed.choices?.[0]?.delta?.content;
      if (text) {
        yield text;
      }
    }
  }
}

export interface ChatMessageRow {
  id: number;
  notebookId: number;
  role: 'user' | 'assistant';
  content: string;
  citations: CitationItem[];
  createdAt: string;
}

function rowToMessage(row: Record<string, unknown>): ChatMessageRow {
  let citations: CitationItem[] = [];
  try {
    citations = JSON.parse(String(row.citations)) as CitationItem[];
  } catch {
    citations = [];
  }
  return {
    id: Number(row.id),
    notebookId: Number(row.notebook_id),
    role: row.role === 'user' ? 'user' : 'assistant',
    content: String(row.content),
    citations,
    createdAt: String(row.created_at)
  };
}

export async function listChatMessages(db: Client, notebookId: number): Promise<ChatMessageRow[]> {
  const result = await db.execute({
    sql: 'SELECT id, notebook_id, role, content, citations, created_at FROM chat_messages WHERE notebook_id = ? ORDER BY id',
    args: [notebookId]
  });
  return result.rows.map(rowToMessage);
}

export async function chatMessagesGet(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
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
    return NextResponse.json({ messages: await listChatMessages(db, notebookId) });
  } catch (error) {
    return errorResponse(error);
  }
}

function sseFrame(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function chatStream(
  db: Client,
  req: Request,
  idRaw: string,
  deps: Partial<ChatDeps> = {}
): Promise<Response> {
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

    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const raw = typeof (parsedBody as { question?: unknown })?.question === 'string' ? (parsedBody as { question: string }).question : '';
    const question = raw.trim();
    if (question.length === 0 || question.length > CHAT_QUESTION_MAX) {
      return NextResponse.json(
        { error: `question must be 1-${CHAT_QUESTION_MAX} characters` },
        { status: 400 }
      );
    }

    const search = deps.search ?? searchChunks;
    const resolveKey = deps.resolveLlmKey ?? resolveLlmKey;
    const completeStream = deps.completeStream ?? groqDeltas;

    const apiKey = await resolveKey(db, user.id);
    if (!apiKey) {
      return NextResponse.json(
        { error: 'No LLM key is configured. The owner can set GROQ_API_KEY, or you can add a personal key in Settings.' },
        { status: 503 }
      );
    }

    const hits = await search(db, notebookId, question, SEARCH_K);
    const sources = hits.length > 0 ? await listSources(db, notebookId) : [];
    const sourceTitle = new Map(sources.map((source) => [source.id, source.title]));
    const citationItems: CitationItem[] = hits.map((hit, index) => ({
      n: index + 1,
      sourceId: hit.sourceId,
      ord: hit.ord,
      sourceTitle: sourceTitle.get(hit.sourceId) ?? 'Unknown source'
    }));

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(sseFrame(payload)));
        };
        let answer = '';
        try {
          if (hits.length === 0) {
            answer = REFUSAL_MESSAGE;
            send({ type: 'delta', text: answer });
          } else {
            send({ type: 'citations', items: citationItems });
            const promptItems = hits.map((hit, index) => ({
              n: index + 1,
              sourceTitle: citationItems[index]!.sourceTitle,
              text: hit.text
            }));
            for await (const delta of completeStream(apiKey, buildSystemPrompt(promptItems), question)) {
              answer += delta;
              if (delta.length > 0) {
                send({ type: 'delta', text: delta });
              }
            }
          }
          send({ type: 'done' });
        } catch (error) {
          send({ type: 'error', error: error instanceof Error ? error.message : 'generation failed' });
        } finally {
          const rows: Array<{ role: string; content: string; citations: string }> = [
            { role: 'user', content: question, citations: '[]' },
            { role: 'assistant', content: answer, citations: hits.length === 0 ? '[]' : JSON.stringify(citationItems) }
          ];
          for (const row of rows) {
            try {
              await db.execute({
                sql: 'INSERT INTO chat_messages (notebook_id, role, content, citations) VALUES (?, ?, ?, ?)',
                args: [notebookId, row.role as InValue, row.content as InValue, row.citations as InValue]
              });
            } catch {
              // history persistence is best-effort; the turn already streamed
            }
          }
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
