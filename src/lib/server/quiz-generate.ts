import type { Client } from '@libsql/client';
import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from './auth';
import { ownNotebook } from './notebooks';
import { resolveLlmKey } from './llm-key';
import { QUIZ_GENERATE_LIMIT, rateLimitResponse } from './ratelimit';
import { validationError } from './errors';
import {
  buildGenerationContext,
  normalizeFront,
  resolveGenerationSelections,
  type RequestedGenerationSource
} from './generation-material';
import { createQuizExam, publicItem, type NewQuizItem, type QuizExamRow } from './quiz';
import {
  buildQuizGenerationPrompt,
  QUIZ_GENERATION_SYSTEM,
  type BatchCounts
} from './quiz-prompt';
import {
  DEFAULT_QUIZ_QUESTIONS,
  MAX_QUIZ_QUESTIONS,
  QUIZ_EXPLANATION_MAX,
  QUIZ_FOCUS_MAX,
  QUIZ_KINDS,
  QUIZ_OPTION_MAX,
  QUIZ_PROMPT_MAX,
  QUIZ_TOPIC_MAX,
  type QuizExamConfig,
  type QuizKind,
  type QuizPublicItem
} from '../quiz';

export const QUIZ_BATCH_SIZE = 6;
export const MAX_QUIZ_BATCHES = 8;
export const QUIZ_GENERATION_DEADLINE_MS = 40_000;
export const QUIZ_LLM_TIMEOUT_MS = 15_000;

function isQuizKind(value: unknown): value is QuizKind {
  return QUIZ_KINDS.includes(value as QuizKind);
}

/** Round-robin the requested count across the chosen question types. */
export function allocateQuizKinds(types: QuizKind[], count: number): BatchCounts {
  const allocation: BatchCounts = {};
  if (types.length === 0 || count <= 0) return allocation;
  for (let index = 0; index < count; index += 1) {
    const kind = types[index % types.length]!;
    allocation[kind] = (allocation[kind] ?? 0) + 1;
  }
  return allocation;
}

/** Next batch plan: up to `max` questions, largest remaining quota first. */
export function planNextBatch(remaining: BatchCounts, max: number): BatchCounts {
  const plan: BatchCounts = {};
  let left = max;
  const order = (Object.entries(remaining) as Array<[QuizKind, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  for (const [kind, count] of order) {
    if (left <= 0) break;
    const take = Math.min(count, left);
    plan[kind] = take;
    left -= take;
  }
  return plan;
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function stringList(value: unknown, max: number, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const list: string[] = [];
  for (const entry of value) {
    const cleaned = text(entry, max);
    if (cleaned.length > 0 && !list.includes(cleaned)) list.push(cleaned);
    if (list.length >= limit) break;
  }
  return list;
}

function indexIn(value: unknown, length: number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < length ? parsed : null;
}

/** Validates and normalises one model-written item; null means drop it. */
export function normalizeGeneratedItem(raw: unknown): NewQuizItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const kind = value.kind;
  if (!isQuizKind(kind)) return null;

  const prompt = text(value.prompt, QUIZ_PROMPT_MAX);
  if (prompt.length < 5) return null;
  const topic = text(value.topic, QUIZ_TOPIC_MAX);
  const explanation = text(value.explanation, QUIZ_EXPLANATION_MAX);

  if (kind === 'mcq') {
    const options = stringList(value.options, QUIZ_OPTION_MAX, 5);
    if (options.length < 3) return null;
    const correct = indexIn(value.correctIndex, options.length);
    if (correct == null) return null;
    return { kind, topic, prompt, options, correct: { index: correct }, explanation, sourceId: null };
  }

  if (kind === 'multi') {
    const options = stringList(value.options, QUIZ_OPTION_MAX, 6);
    if (options.length < 3) return null;
    const rawIndexes = Array.isArray(value.correctIndexes) ? value.correctIndexes : [];
    const indexes = [...new Set(rawIndexes.map((entry) => indexIn(entry, options.length)))]
      .filter((entry): entry is number => entry != null)
      .sort((a, b) => a - b);
    if (indexes.length < 2 || indexes.length >= options.length) return null;
    return { kind, topic, prompt, options, correct: { indexes }, explanation, sourceId: null };
  }

  if (kind === 'truefalse') {
    const answer =
      typeof value.answer === 'boolean'
        ? value.answer
        : value.answer === 'true'
          ? true
          : value.answer === 'false'
            ? false
            : null;
    if (answer == null) return null;
    return {
      kind,
      topic,
      prompt,
      options: ['True', 'False'],
      correct: { value: answer },
      explanation,
      sourceId: null
    };
  }

  if (kind === 'fillin') {
    const accepted = stringList(value.accepted ?? value.answers, 100, 3);
    if (accepted.length === 0) return null;
    return { kind, topic, prompt, options: [], correct: { accepted }, explanation, sourceId: null };
  }

  const rubric = text(value.rubric, QUIZ_EXPLANATION_MAX);
  const modelAnswer = text(value.modelAnswer, QUIZ_EXPLANATION_MAX);
  if (rubric.length < 10 || modelAnswer.length < 2) return null;
  return {
    kind,
    topic,
    prompt,
    options: [],
    correct: { rubric, modelAnswer },
    explanation,
    sourceId: null
  };
}

export function parseGeneratedBatch(
  raw: string,
  allowed: Set<QuizKind>
): { items: NewQuizItem[]; rejected: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return { items: [], rejected: 0 };
  }
  if (!Array.isArray(parsed)) {
    return { items: [], rejected: 0 };
  }
  const items: NewQuizItem[] = [];
  let rejected = 0;
  for (const entry of parsed) {
    const item = normalizeGeneratedItem(entry);
    if (!item || !allowed.has(item.kind)) {
      rejected += 1;
      continue;
    }
    items.push(item);
  }
  return { items, rejected };
}

async function groqQuizBatch(apiKey: string, system: string, user: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUIZ_LLM_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.GROQ_QUIZ_MODEL ?? process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b',
        temperature: 0.4,
        max_tokens: 3000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw validationError('LLM_ERROR', `LLM request failed (${res.status}) ${detail}`, 502);
    }
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return body.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

export interface QuizGenerationSettings {
  selections: RequestedGenerationSource[];
  types: QuizKind[];
  count: number;
  timerMinutes: number | null;
  focus: string;
  /** Exam title prefix; chat quizzes use a different one from the tab. */
  titlePrefix?: string;
}

export interface QuizGenerationPayload {
  exam: QuizExamRow;
  items: QuizPublicItem[];
  requested: number;
  generated: number;
  truncated: boolean;
  failedBatches: number;
}

export type QuizGenerationOutcome =
  | { ok: true; payload: QuizGenerationPayload }
  | { ok: false; status: number; error: string; code?: string };

export type QuizGenerateEvent =
  | { type: 'prepared'; total: number; sources: number }
  | { type: 'progress'; written: number; total: number }
  | ({ type: 'done' } & QuizGenerationPayload);

export interface QuizGenerateDeps {
  resolveLlmKey?: typeof resolveLlmKey;
  completeBatch?: (apiKey: string, system: string, user: string) => Promise<string>;
  deadlineMs?: number;
  /** Real progress for the streaming route; nothing is emitted when omitted. */
  onEvent?: (event: QuizGenerateEvent) => void;
}

function titleFor(focus: string, sourceSummary: string, prefix = 'Mock exam'): string {
  const base = focus.trim().length > 0 ? focus.trim() : sourceSummary;
  return `${prefix} · ${base}`.slice(0, 80);
}

/**
 * Generates and stores one exam. Shared by the exam route and the chat quiz
 * turn, which is why it reports failures as values instead of HTTP responses.
 */
export async function generateQuizRecord(
  db: Client,
  userId: number,
  notebookId: number,
  settings: QuizGenerationSettings,
  deps: QuizGenerateDeps = {}
): Promise<QuizGenerationOutcome> {
  const selections = await resolveGenerationSelections(db, notebookId, settings.selections);
  const resolveKey = deps.resolveLlmKey ?? resolveLlmKey;
  const apiKey = await resolveKey(db, userId);
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      error:
        'No LLM key is configured. The owner can set GROQ_API_KEY, or you can add a personal key in Settings.'
    };
  }

  const { types, count, timerMinutes, focus } = settings;
  const built = await buildGenerationContext(db, notebookId, selections, focus || null);
  if (!built) {
    return { ok: false, status: 400, error: 'no source material found for that selection' };
  }
  deps.onEvent?.({ type: 'prepared', total: count, sources: selections.length });

  const complete =
    deps.completeBatch ??
    (async (key: string, system: string, prompt: string) => groqQuizBatch(key, system, prompt));
  const deadline = Date.now() + (deps.deadlineMs ?? QUIZ_GENERATION_DEADLINE_MS);
  const remaining = allocateQuizKinds(types, count);
  const seen = new Set<string>();
  const existing = await db.execute({
    sql: 'SELECT prompt FROM quiz_exam_items WHERE exam_id IN (SELECT id FROM quiz_exams WHERE notebook_id = ?)',
    args: [notebookId]
  });
  for (const row of existing.rows) {
    seen.add(normalizeFront(String(row.prompt)));
  }

  const accepted: NewQuizItem[] = [];
  let failedBatches = 0;
  let batches = 0;
  const singleSourceId = selections.length === 1 ? selections[0]!.sourceId : null;

  while (accepted.length < count && batches < MAX_QUIZ_BATCHES) {
    if (Date.now() >= deadline) break;
    const plan = planNextBatch(remaining, Math.min(QUIZ_BATCH_SIZE, count - accepted.length));
    if (Object.keys(plan).length === 0) break;
    batches += 1;
    const prompt = buildQuizGenerationPrompt({
      context: built.context,
      focus: focus || null,
      counts: plan
    });

    const allowed = new Set(Object.keys(plan).filter(isQuizKind));
    let reply: string | null = null;
    try {
      reply = await complete(apiKey, QUIZ_GENERATION_SYSTEM, prompt);
    } catch {
      failedBatches += 1;
      if (failedBatches >= 2) break;
      continue;
    }
    let parsed = parseGeneratedBatch(reply, allowed);
    if (parsed.items.length === 0) {
      try {
        reply = await complete(
          apiKey,
          `${QUIZ_GENERATION_SYSTEM}\nYour previous reply was not a usable JSON array. Reply with ONLY the JSON array now.`,
          prompt
        );
      } catch {
        reply = null;
      }
      if (reply) parsed = parseGeneratedBatch(reply, allowed);
    }
    if (parsed.items.length === 0) {
      failedBatches += 1;
      if (failedBatches >= 2) break;
      continue;
    }

    failedBatches = 0;
    const before = accepted.length;
    for (const item of parsed.items) {
      const quota = remaining[item.kind] ?? 0;
      if (quota <= 0) continue;
      const key = normalizeFront(item.prompt);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      remaining[item.kind] = quota - 1;
      accepted.push({ ...item, sourceId: singleSourceId });
      if (accepted.length >= count) break;
    }
    if (accepted.length > before) {
      deps.onEvent?.({ type: 'progress', written: accepted.length, total: count });
    }
  }

  if (accepted.length === 0) {
    return {
      ok: false,
      status: 502,
      error: 'the model did not return usable questions',
      code: 'GENERATION_INVALID'
    };
  }

  const config: QuizExamConfig = {
    types,
    requestedCount: count,
    timerMinutes,
    sourceSummary: built.sourceSummary
  };
  const created = await createQuizExam(db, {
    notebookId,
    title: titleFor(focus, built.sourceSummary, settings.titlePrefix),
    topic: focus,
    config,
    items: accepted
  });

  const payload: QuizGenerationPayload = {
    exam: created.exam,
    items: created.items.map(publicItem),
    requested: count,
    generated: accepted.length,
    truncated: accepted.length < count,
    failedBatches
  };
  deps.onEvent?.({ type: 'done', ...payload });
  return { ok: true, payload };
}

export async function quizGenerate(
  db: Client,
  req: Request,
  idRaw: string,
  deps: QuizGenerateDeps = {}
): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const notebookId = Number(idRaw);
    const notebook = Number.isInteger(notebookId) ? await ownNotebook(db, user.id, notebookId) : null;
    if (!notebook) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }

    const limited = await rateLimitResponse(db, `quiz-generate:${user.id}`, QUIZ_GENERATE_LIMIT);
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
      sources?: unknown;
      types?: unknown;
      count?: unknown;
      timerMinutes?: unknown;
      focus?: unknown;
    };

    if (!Array.isArray(body.sources) || body.sources.length === 0) {
      return NextResponse.json({ error: 'select at least one source' }, { status: 400 });
    }
    const requested: RequestedGenerationSource[] = [];
    for (const item of body.sources) {
      const raw = item as { sourceId?: unknown; from?: unknown; to?: unknown } | null;
      const sourceId = Number(raw?.sourceId);
      if (!Number.isInteger(sourceId) || sourceId <= 0) {
        return NextResponse.json({ error: 'invalid source selection' }, { status: 400 });
      }
      const fromPage = raw?.from == null ? undefined : Number(raw.from);
      const toPage = raw?.to == null ? undefined : Number(raw.to);
      if (
        (fromPage !== undefined && (!Number.isInteger(fromPage) || fromPage < 1)) ||
        (toPage !== undefined && (!Number.isInteger(toPage) || toPage < 1))
      ) {
        return NextResponse.json({ error: 'page numbers must be positive integers' }, { status: 400 });
      }
      if (fromPage !== undefined && toPage !== undefined && fromPage > toPage) {
        return NextResponse.json({ error: 'from page must be before to page' }, { status: 400 });
      }
      requested.push({ sourceId, fromPage, toPage });
    }

    const types = Array.isArray(body.types) ? [...new Set(body.types.filter(isQuizKind))] : [];
    if (types.length === 0) {
      return NextResponse.json({ error: 'choose at least one question type' }, { status: 400 });
    }

    let count = DEFAULT_QUIZ_QUESTIONS;
    if (body.count !== undefined) {
      if (typeof body.count !== 'number' || !Number.isFinite(body.count)) {
        return NextResponse.json({ error: 'count must be a number' }, { status: 400 });
      }
      count = Math.min(MAX_QUIZ_QUESTIONS, Math.max(1, Math.floor(body.count)));
    }

    let timerMinutes: number | null = null;
    if (body.timerMinutes !== undefined && body.timerMinutes !== null) {
      const parsed = Number(body.timerMinutes);
      if (!Number.isInteger(parsed) || parsed < 5 || parsed > 180) {
        return NextResponse.json({ error: 'timer must be 5-180 minutes' }, { status: 400 });
      }
      timerMinutes = parsed;
    }

    if (body.focus !== undefined && typeof body.focus !== 'string') {
      return NextResponse.json({ error: 'focus must be text' }, { status: 400 });
    }
    const focus = typeof body.focus === 'string' ? body.focus.trim() : '';
    if (focus.length > QUIZ_FOCUS_MAX) {
      return NextResponse.json({ error: `focus must be at most ${QUIZ_FOCUS_MAX} characters` }, { status: 400 });
    }

    const outcome = await generateQuizRecord(
      db,
      user.id,
      notebookId,
      { selections: requested, types, count, timerMinutes, focus },
      deps
    );
    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.error, ...(outcome.code ? { code: outcome.code } : {}) },
        { status: outcome.status }
      );
    }
    return NextResponse.json(outcome.payload, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
