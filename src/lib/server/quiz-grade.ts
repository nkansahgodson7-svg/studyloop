import type { QuizAnswer, QuizBreakdown, QuizBreakdownRow, QuizItemFeedback } from '../quiz';
import { QUIZ_KIND_LABELS } from '../quiz';
import { buildQuizGradingPrompt, QUIZ_GRADING_SYSTEM } from './quiz-prompt';
import type { QuizItemRow } from './quiz';

export const GRADING_TIMEOUT_MS = 20_000;

/** Case/punctuation-insensitive comparison used for fill-in-the-blank. */
export function normalizeFillIn(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function asIndex(answer: QuizAnswer | null | undefined): number | null {
  return typeof answer === 'number' && Number.isInteger(answer) ? answer : null;
}

function asIndexes(answer: QuizAnswer | null | undefined): number[] {
  if (!Array.isArray(answer)) return [];
  return [...new Set(answer.filter((entry): entry is number => Number.isInteger(entry)))];
}

function asBoolean(answer: QuizAnswer | null | undefined): boolean | null {
  return typeof answer === 'boolean' ? answer : null;
}

function asText(answer: QuizAnswer | null | undefined): string {
  return typeof answer === 'string' ? answer.trim() : '';
}

/**
 * Deterministic score for the objective kinds: 1, a partial value for
 * multi-select, or 0. Short answers return null because they need the model.
 */
export function gradeObjectiveItem(item: QuizItemRow, answer: QuizAnswer | null | undefined): number | null {
  if (item.kind === 'short') return null;

  if (item.kind === 'mcq') {
    const correct = item.correct as { index: number };
    return asIndex(answer) === correct.index ? 1 : 0;
  }

  if (item.kind === 'multi') {
    const correct = item.correct as { indexes: number[] };
    const selected = asIndexes(answer);
    if (selected.length === 0) return 0;
    const correctSet = new Set(correct.indexes);
    const right = selected.filter((index) => correctSet.has(index)).length;
    const wrong = selected.filter((index) => !correctSet.has(index)).length;
    const partial = (right - wrong) / correct.indexes.length;
    return Math.min(1, Math.max(0, partial));
  }

  if (item.kind === 'truefalse') {
    const correct = item.correct as { value: boolean };
    const given = asBoolean(answer);
    return given != null && given === correct.value ? 1 : 0;
  }

  const correct = item.correct as { accepted: string[] };
  const given = normalizeFillIn(asText(answer));
  if (given.length === 0) return 0;
  return correct.accepted.some((accepted) => normalizeFillIn(accepted) === given) ? 1 : 0;
}

export interface AttemptScores {
  scores: Record<number, number>;
  earned: number;
  max: number;
}

/** Scores every objective item; short answers are left to `gradeShortAnswers`. */
export function scoreObjectiveItems(
  items: QuizItemRow[],
  answers: Record<string, QuizAnswer | null>
): AttemptScores {
  const scores: Record<number, number> = {};
  let earned = 0;
  let max = 0;
  for (const item of items) {
    const value = gradeObjectiveItem(item, answers[String(item.id)]);
    if (value == null) continue;
    scores[item.id] = value;
    earned += value;
    max += 1;
  }
  return { scores, earned, max };
}

export function buildBreakdown(items: QuizItemRow[], scores: Record<number, number>): QuizBreakdown {
  const byTopic = new Map<string, QuizBreakdownRow>();
  const byKind = new Map<string, QuizBreakdownRow>();
  for (const item of items) {
    const score = scores[item.id];
    if (score == null) continue;
    const topicLabel = item.topic.trim().length > 0 ? item.topic.trim() : 'General';
    const topicRow = byTopic.get(topicLabel) ?? { label: topicLabel, earned: 0, max: 0 };
    topicRow.earned += score;
    topicRow.max += 1;
    byTopic.set(topicLabel, topicRow);

    const kindLabel = QUIZ_KIND_LABELS[item.kind];
    const kindRow = byKind.get(kindLabel) ?? { label: kindLabel, earned: 0, max: 0 };
    kindRow.earned += score;
    kindRow.max += 1;
    byKind.set(kindLabel, kindRow);
  }
  const toRows = (map: Map<string, QuizBreakdownRow>): QuizBreakdownRow[] =>
    [...map.values()]
      .map((row) => ({ ...row, earned: Math.round(row.earned * 100) / 100 }))
      .sort((a, b) => b.max - a.max || a.label.localeCompare(b.label));
  return { byTopic: toRows(byTopic), byKind: toRows(byKind) };
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? trimmed).trim();
}

/** Parses `[{itemId, score, comment}]`, clamping scores and dropping unknown ids. */
export function parseGradingReply(
  raw: string,
  validIds: Set<number>
): Record<number, QuizItemFeedback> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const feedback: Record<number, QuizItemFeedback> = {};
  for (const entry of parsed) {
    const value = entry as { itemId?: unknown; score?: unknown; comment?: unknown };
    const itemId = Number(value.itemId);
    if (!Number.isInteger(itemId) || !validIds.has(itemId)) continue;
    const score = Number(value.score);
    if (!Number.isFinite(score)) continue;
    const comment = typeof value.comment === 'string' ? value.comment.trim().slice(0, 240) : '';
    feedback[itemId] = {
      score: Math.min(1, Math.max(0, score)),
      comment
    };
  }
  return Object.keys(feedback).length > 0 ? feedback : null;
}

export interface ShortAnswerEntry {
  itemId: number;
  prompt: string;
  rubric: string;
  modelAnswer: string;
  answer: string;
}

export type BatchCompleter = (apiKey: string, system: string, user: string) => Promise<string>;

async function groqGrade(apiKey: string, system: string, user: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRADING_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.GROQ_QUIZ_MODEL ?? process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b',
        temperature: 0,
        max_tokens: 2000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });
    if (!res.ok) {
      throw Object.assign(new Error(`grading request failed (${res.status})`), { code: 'LLM_ERROR' });
    }
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return body.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Grades every answered short question in one call. Returns null when the model
 * cannot produce usable JSON even after one retry, so the caller can mark the
 * attempt `grading_failed` without losing the objective scores.
 */
export async function gradeShortAnswers(
  apiKey: string,
  entries: ShortAnswerEntry[],
  complete: BatchCompleter = groqGrade
): Promise<Record<number, QuizItemFeedback> | null> {
  if (entries.length === 0) return {};
  const ids = new Set(entries.map((entry) => entry.itemId));
  const prompt = buildQuizGradingPrompt(entries);
  try {
    const first = await complete(apiKey, QUIZ_GRADING_SYSTEM, prompt);
    const parsed = parseGradingReply(first, ids);
    if (parsed) return parsed;
  } catch {
    // retry once below
  }
  try {
    const second = await complete(
      apiKey,
      `${QUIZ_GRADING_SYSTEM}\nYour previous reply was not a usable JSON array. Reply with ONLY the JSON array now.`,
      prompt
    );
    return parseGradingReply(second, ids);
  } catch {
    return null;
  }
}

/** A guessed correct answer for the "add missed to flashcards" path. */
export function correctAnswerText(item: QuizItemRow): string {
  if (item.kind === 'short') return (item.correct as { modelAnswer: string }).modelAnswer;
  if (item.kind === 'fillin') return (item.correct as { accepted: string[] }).accepted[0] ?? '';
  if (item.kind === 'truefalse') return (item.correct as { value: boolean }).value ? 'True' : 'False';
  if (item.kind === 'mcq') {
    const correct = item.correct as { index: number };
    return item.options[correct.index] ?? '';
  }
  const correct = item.correct as { indexes: number[] };
  return correct.indexes.map((index) => item.options[index] ?? '').filter(Boolean).join('; ');
}
