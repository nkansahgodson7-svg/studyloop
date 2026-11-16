/**
 * Shared quiz vocabulary. Imported by the server (generation, grading, routes)
 * and by the client (tab, generate sheet, take and results screens), so it must
 * stay free of server-only imports.
 */

export const QUIZ_KINDS = ['mcq', 'multi', 'truefalse', 'fillin', 'short'] as const;
export type QuizKind = (typeof QUIZ_KINDS)[number];

export const QUIZ_KIND_LABELS: Record<QuizKind, string> = {
  mcq: 'Multiple choice',
  multi: 'Multiple select',
  truefalse: 'True / false',
  fillin: 'Fill in the blank',
  short: 'Short answer'
};

export const QUIZ_COUNTS = [5, 10, 20] as const;
export type QuizCount = (typeof QUIZ_COUNTS)[number];

export const MAX_QUIZ_QUESTIONS = 20;
export const DEFAULT_QUIZ_QUESTIONS = 10;
export const QUIZ_TIMER_PRESETS = [15, 30, 60] as const;
export type QuizTimerMinutes = (typeof QUIZ_TIMER_PRESETS)[number];

export const QUIZ_FOCUS_MAX = 1000;
export const QUIZ_PROMPT_MAX = 400;
export const QUIZ_OPTION_MAX = 160;
export const QUIZ_EXPLANATION_MAX = 600;
export const QUIZ_TOPIC_MAX = 60;
export const QUIZ_SHORT_ANSWER_MAX = 4000;

/** Stored correctness, never sent to the client before submission. */
export type QuizCorrect =
  | { index: number }
  | { indexes: number[] }
  | { value: boolean }
  | { accepted: string[] }
  | { rubric: string; modelAnswer: string };

/** A stored answer, keyed by item id. `null` in a patch clears the answer. */
export type QuizAnswer = number | number[] | boolean | string;
export type QuizAnswers = Record<string, QuizAnswer | null>;

/** What the take screen is allowed to see. */
export interface QuizPublicItem {
  id: number;
  ord: number;
  kind: QuizKind;
  topic: string;
  prompt: string;
  options: string[];
}

export interface QuizExamConfig {
  types: QuizKind[];
  requestedCount: number;
  timerMinutes: number | null;
  sourceSummary: string;
}

export interface QuizExamSummary {
  id: number;
  notebookId: number;
  title: string;
  topic: string;
  createdAt: string;
  questionCount: number;
  timerMinutes: number | null;
  types: QuizKind[];
  lastAttempt: { id: number; score: number; at: string } | null;
  bestScore: number | null;
  activeAttempt: { id: number; answered: number; remainingSeconds: number | null } | null;
}

export interface QuizAttemptSummary {
  id: number;
  examId: number;
  status: QuizAttemptStatus;
  score: number | null;
  startedAt: string;
  submittedAt: string | null;
  durationMs: number | null;
}

export type QuizAttemptStatus =
  | 'in_progress'
  | 'submitted'
  | 'grading'
  | 'graded'
  | 'grading_failed';

export interface QuizBreakdownRow {
  label: string;
  earned: number;
  max: number;
}

export interface QuizBreakdown {
  byTopic: QuizBreakdownRow[];
  byKind: QuizBreakdownRow[];
}

export interface QuizItemFeedback {
  score: number;
  comment: string;
}

export interface QuizResultItem extends QuizPublicItem {
  answer: QuizAnswer | null;
  correct: QuizCorrect;
  explanation: string;
  score: number;
  feedback: string | null;
}

export interface QuizAttemptResult {
  attempt: QuizAttemptSummary;
  exam: { id: number; title: string; notebookId: number };
  items: QuizResultItem[];
  earned: number;
  max: number;
  breakdown: QuizBreakdown | null;
  graded: boolean;
}

export function parseQuizConfig(raw: unknown): QuizExamConfig {
  const value = (raw ?? {}) as Partial<QuizExamConfig>;
  return {
    types: Array.isArray(value.types)
      ? value.types.filter((kind): kind is QuizKind => QUIZ_KINDS.includes(kind as QuizKind))
      : [...QUIZ_KINDS],
    requestedCount:
      typeof value.requestedCount === 'number' && Number.isFinite(value.requestedCount)
        ? value.requestedCount
        : DEFAULT_QUIZ_QUESTIONS,
    timerMinutes:
      typeof value.timerMinutes === 'number' && Number.isFinite(value.timerMinutes)
        ? value.timerMinutes
        : null,
    sourceSummary: typeof value.sourceSummary === 'string' ? value.sourceSummary : ''
  };
}

/** True when an answer is present and not an empty string / empty selection. */
export function hasQuizAnswer(answer: QuizAnswer | undefined | null): boolean {
  if (answer === undefined || answer === null) return false;
  if (typeof answer === 'string') return answer.trim().length > 0;
  if (Array.isArray(answer)) return answer.length > 0;
  return true;
}

export function remainingSecondsFor(
  startedAt: string,
  timerMinutes: number | null,
  now: Date
): number | null {
  if (timerMinutes == null) return null;
  const elapsed = Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000);
  return Math.max(0, timerMinutes * 60 - elapsed);
}

/** Fire-and-forget friendly: score as a whole percentage. */
export function scorePercent(score: number | null): number | null {
  return score == null ? null : Math.round(score * 100);
}
