import type { Client } from '@libsql/client';
import { rateLimit } from './ratelimit';
import {
  DEFAULT_TITLE,
  setGeneratedTitle,
  type ConversationRow
} from './conversations';

export const TITLE_MAX = 60;
export const TITLE_HOURLY_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 };
const TITLE_TIMEOUT_MS = 5000;

/** Title used when the model cannot produce one (or the budget is spent). */
export function fallbackTitle(question: string): string {
  const flat = question.replace(/\s+/g, ' ').trim();
  const clipped = flat.length > 40 ? `${flat.slice(0, 39).trimEnd()}…` : flat;
  return clipped || DEFAULT_TITLE;
}

export function sanitizeTitle(raw: string): string | null {
  const cleaned = raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/^["'“”‘’`*#\s]+/, '')
    .replace(/["'“”‘’`*\s.]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < 2) {
    return null;
  }
  return cleaned.length > TITLE_MAX
    ? `${cleaned.slice(0, TITLE_MAX - 1).trimEnd()}…`
    : cleaned;
}

export type TitleCompleter = (apiKey: string, prompt: string) => Promise<string>;

export const groqTitle: TitleCompleter = async (apiKey, prompt) => {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b',
      stream: false,
      temperature: 0.3,
      max_tokens: 24,
      messages: [
        {
          role: 'system',
          content:
            'You name study conversations. Reply with a 2-5 word title only. No quotes, no punctuation at the end.'
        },
        { role: 'user', content: prompt }
      ]
    })
  });
  if (!res.ok) {
    throw new Error(`title request failed (${res.status})`);
  }
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return body.choices?.[0]?.message?.content ?? '';
};

/**
 * Names a conversation after its first exchange. Best-effort: every failure
 * path (rate limit, provider error, unusable output) falls back to the first
 * question so the drawer never shows "New chat" forever.
 */
export async function generateConversationTitle(
  db: Client,
  conversation: ConversationRow,
  apiKey: string,
  userId: number,
  deps: { complete?: TitleCompleter } = {}
): Promise<void> {
  const first = await db.execute({
    sql: `SELECT role, content FROM chat_messages
          WHERE conversation_id = ? ORDER BY id LIMIT 2`,
    args: [conversation.id]
  });
  const question = String(first.rows.find((row) => row['role'] === 'user')?.['content'] ?? '');
  if (question.trim().length === 0) {
    return;
  }
  const answer = String(first.rows.find((row) => row['role'] === 'assistant')?.['content'] ?? '');

  const gate = await rateLimit(db, `chat-title:${userId}`, TITLE_HOURLY_LIMIT);
  if (!gate.allowed) {
    await setGeneratedTitle(db, conversation.id, fallbackTitle(question), 'fallback');
    return;
  }

  try {
    const complete = deps.complete ?? groqTitle;
    const raw = await complete(
      apiKey,
      `First question: ${question.slice(0, 500)}\nFirst answer: ${answer.slice(0, 500)}`
    );
    const title = sanitizeTitle(raw);
    await setGeneratedTitle(
      db,
      conversation.id,
      title ?? fallbackTitle(question),
      title ? 'auto' : 'fallback'
    );
  } catch {
    await setGeneratedTitle(db, conversation.id, fallbackTitle(question), 'fallback');
  }
}
