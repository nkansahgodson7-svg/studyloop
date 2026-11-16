import type { Client } from '@libsql/client';
import { listSources } from './ingest/ingest';
import {
  createMessage,
  DEFAULT_TITLE,
  touchConversation,
  type ChatMessageRow,
  type ConversationRow
} from './conversations';
import { generateQuizRecord, type QuizGenerateDeps } from './quiz-generate';
import { QUIZ_GENERATE_LIMIT, rateLimitResponse } from './ratelimit';
import type { QuizKind } from '../quiz';

/** Short enough to answer inside a chat, broad enough to test recall. */
export const INLINE_QUIZ_COUNT = 5;
export const INLINE_QUIZ_TYPES: QuizKind[] = ['mcq', 'multi', 'truefalse', 'fillin'];

export interface QuizTurnContext {
  conversation: ConversationRow;
  userMessage: ChatMessageRow;
  userId: number;
  apiKey: string;
}

export interface QuizTurnDeps {
  quiz?: Partial<QuizGenerateDeps>;
  /** Titles the conversation after the first quiz turn, like a chat answer. */
  genTitle?: (
    db: Client,
    conversation: ConversationRow,
    apiKey: string,
    userId: number
  ) => Promise<void>;
}

/** "Quiz me on this" is an imperative, not a question to answer in prose. */
export function wantsQuiz(question: string): boolean {
  return /\bquiz me\b/i.test(question);
}

const EMPTY_FOCUS = new Set([
  '',
  'this',
  'that',
  'it',
  'these',
  'this material',
  'this notebook',
  'the material',
  'my sources',
  'the sources'
]);

/**
 * The part after "quiz me on/about" is a focus instruction for the generator.
 * "Quiz me on this" has no focus, so it falls back to the whole notebook.
 */
export function quizFocus(question: string): string {
  const after = question.replace(/^[\s\S]*?\bquiz me\b/i, '');
  const focus = after
    .replace(/^\s*(?:on|about|over|from)\s+/i, '')
    .replace(/[.!?]+\s*$/, '')
    .trim();
  return EMPTY_FOCUS.has(focus.toLowerCase()) ? '' : focus.slice(0, 1000);
}

function sseFrame(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Streams a quiz turn: persist the question, write 5 objective questions, then
 * attach the exam to a new assistant message so the chat can render it inline.
 */
export async function answerQuizTurn(
  db: Client,
  req: Request,
  ctx: QuizTurnContext,
  deps: QuizTurnDeps = {}
): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (payload: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(payload)));
        } catch {
          closed = true;
        }
      };

      try {
        send({
          type: 'start',
          userMessageId: ctx.userMessage.id,
          conversationId: ctx.conversation.id
        });

        const limited = await rateLimitResponse(
          db,
          `quiz-generate:${ctx.userId}`,
          QUIZ_GENERATE_LIMIT
        );
        if (limited) {
          send({
            type: 'error',
            status: 429,
            error: 'too many requests — try again later',
            retryable: true,
            retryAfter: limited.headers.get('retry-after'),
            userMessageId: ctx.userMessage.id
          });
          return;
        }

        const sources = await listSources(db, ctx.conversation.notebookId);
        const focus = quizFocus(ctx.userMessage.content);
        const outcome = await generateQuizRecord(
          db,
          ctx.userId,
          ctx.conversation.notebookId,
          {
            selections: sources.map((source) => ({ sourceId: source.id })),
            types: INLINE_QUIZ_TYPES,
            count: INLINE_QUIZ_COUNT,
            timerMinutes: null,
            focus,
            titlePrefix: 'Quick quiz'
          },
          {
            ...deps.quiz,
            resolveLlmKey: async () => ctx.apiKey,
            onEvent: (event) => {
              if (event.type === 'prepared') {
                send({ type: 'quiz_progress', written: 0, total: event.total });
              } else if (event.type === 'progress') {
                send({ type: 'quiz_progress', written: event.written, total: event.total });
              }
            }
          }
        );

        if (!outcome.ok) {
          send({
            type: 'error',
            status: outcome.status,
            error: outcome.error,
            code: outcome.code,
            retryable: true,
            userMessageId: ctx.userMessage.id
          });
          return;
        }

        // A stopped request should not leave a half-answer in the thread.
        if (req.signal?.aborted) return;

        const count = outcome.payload.generated;
        const assistant = await createMessage(db, ctx.conversation.id, {
          role: 'assistant',
          content: `Here's a ${count}-question quiz on this. Answer it below — it's saved in the Quiz tab too.`,
          quizExamId: outcome.payload.exam.id
        });
        await touchConversation(db, ctx.conversation.id);
        send({
          type: 'done',
          messageId: assistant.id,
          createdAt: assistant.createdAt,
          quizExamId: outcome.payload.exam.id
        });

        if (ctx.conversation.title === DEFAULT_TITLE && ctx.conversation.titleSource === 'auto') {
          void deps.genTitle?.(db, ctx.conversation, ctx.apiKey, ctx.userId).catch(() => undefined);
        }
      } catch (error) {
        console.error('chat quiz generation failed', error);
        send({
          type: 'error',
          error: 'generation failed',
          retryable: true,
          userMessageId: ctx.userMessage.id,
          code: 'GENERATION_FAILED'
        });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by the runtime
          }
        }
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
}

/**
 * Returns a quiz stream when the message asks for a quiz and the notebook has
 * sources to write one from; null leaves the turn to the normal answer path.
 */
export async function maybeQuizTurn(
  db: Client,
  req: Request,
  ctx: QuizTurnContext,
  deps: QuizTurnDeps = {}
): Promise<Response | null> {
  if (!wantsQuiz(ctx.userMessage.content)) return null;
  const sources = await listSources(db, ctx.conversation.notebookId);
  if (sources.length === 0) return null;
  return answerQuizTurn(db, req, ctx, deps);
}
