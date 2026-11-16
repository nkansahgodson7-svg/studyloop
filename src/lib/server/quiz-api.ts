import type { Client } from '@libsql/client';
import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from './auth';
import { ownNotebook } from './notebooks';
import { createCard, listCardsWithReview } from './cards';
import { normalizeFront } from './generation-material';
import { resolveLlmKey } from './chat';
import { QUIZ_GRADE_LIMIT, rateLimitResponse } from './ratelimit';
import {
  deleteQuizExam,
  listQuizAttempts,
  listQuizExams,
  listQuizItems,
  publicItem,
  quizAttemptOwned,
  quizExamOwned,
  saveQuizAnswers,
  saveQuizAttemptResult,
  startQuizAttempt,
  type QuizAttemptRow,
  type QuizExamRow,
  type QuizItemRow
} from './quiz';
import {
  buildBreakdown,
  correctAnswerText,
  gradeShortAnswers,
  scoreObjectiveItems,
  type ShortAnswerEntry
} from './quiz-grade';
import {
  hasQuizAnswer,
  remainingSecondsFor,
  type QuizAnswers,
  type QuizAttemptResult,
  type QuizItemFeedback
} from '../quiz';

const CARD_FRONT_MAX = 300;
const CARD_BACK_MAX = 2000;

function num(value: string): number {
  return Number(value);
}

function attemptPayload(attempt: QuizAttemptRow, exam: QuizExamRow, now: Date) {
  return {
    id: attempt.id,
    examId: attempt.examId,
    status: attempt.status,
    answers: attempt.answers,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    durationMs: attempt.durationMs,
    score: attempt.score,
    remainingSeconds: remainingSecondsFor(attempt.startedAt, exam.config.timerMinutes, now)
  };
}

/** Shared by GET and submit: recomputes objective scores and reads AI feedback. */
export function buildQuizResult(
  attempt: QuizAttemptRow,
  exam: QuizExamRow,
  items: QuizItemRow[]
): QuizAttemptResult {
  const objective = scoreObjectiveItems(items, attempt.answers);
  const feedback = attempt.feedback ?? {};
  const scores: Record<number, number> = { ...objective.scores };
  for (const item of items) {
    if (item.kind !== 'short') continue;
    const entry = feedback[item.id];
    scores[item.id] = entry ? entry.score : 0;
  }

  const graded = attempt.status === 'graded';
  const gradedItems = graded ? items : items.filter((item) => item.kind !== 'short');
  const earned = gradedItems.reduce((sum, item) => sum + (scores[item.id] ?? 0), 0);
  const max = gradedItems.length;

  return {
    attempt: {
      id: attempt.id,
      examId: attempt.examId,
      status: attempt.status,
      score: attempt.score,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      durationMs: attempt.durationMs
    },
    exam: { id: exam.id, title: exam.title, notebookId: exam.notebookId },
    items: items.map((item) => ({
      ...publicItem(item),
      answer: attempt.answers[String(item.id)] ?? null,
      correct: item.correct,
      explanation: item.explanation,
      score: scores[item.id] ?? 0,
      feedback: feedback[item.id]?.comment ?? null
    })),
    earned: Math.round(earned * 100) / 100,
    max,
    breakdown: graded ? buildBreakdown(items, scores) : buildBreakdown(gradedItems, scores),
    graded
  };
}

export async function quizList(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const notebookId = num(idRaw);
    const notebook = Number.isInteger(notebookId) ? await ownNotebook(db, user.id, notebookId) : null;
    if (!notebook) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    return NextResponse.json({ quizzes: await listQuizExams(db, notebookId, user.id, new Date()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function quizDetail(db: Client, req: Request, examIdRaw: string): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const exam = await quizExamOwned(db, user.id, num(examIdRaw));
    if (!exam) {
      return NextResponse.json({ error: 'unknown exam' }, { status: 404 });
    }
    const [items, attempts] = await Promise.all([
      listQuizItems(db, exam.id),
      listQuizAttempts(db, exam.id, user.id)
    ]);
    return NextResponse.json({
      exam: {
        id: exam.id,
        notebookId: exam.notebookId,
        title: exam.title,
        topic: exam.topic,
        config: exam.config,
        createdAt: exam.createdAt,
        questionCount: items.length
      },
      items: items.map(publicItem),
      attempts
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function quizDelete(db: Client, req: Request, examIdRaw: string): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const deleted = await deleteQuizExam(db, user.id, num(examIdRaw));
    if (!deleted) {
      return NextResponse.json({ error: 'unknown exam' }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function quizStartAttempt(
  db: Client,
  req: Request,
  examIdRaw: string
): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const exam = await quizExamOwned(db, user.id, num(examIdRaw));
    if (!exam) {
      return NextResponse.json({ error: 'unknown exam' }, { status: 404 });
    }
    const items = await listQuizItems(db, exam.id);
    if (items.length === 0) {
      return NextResponse.json({ error: 'this exam has no questions' }, { status: 404 });
    }
    const now = new Date();
    const attempt = await startQuizAttempt(db, exam.id, user.id, now);
    return NextResponse.json({
      attempt: attemptPayload(attempt, exam, now),
      exam: {
        id: exam.id,
        title: exam.title,
        notebookId: exam.notebookId,
        timerMinutes: exam.config.timerMinutes,
        questionCount: items.length
      },
      items: items.map(publicItem)
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function quizAttemptGet(
  db: Client,
  req: Request,
  attemptIdRaw: string
): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const attempt = await quizAttemptOwned(db, user.id, num(attemptIdRaw));
    if (!attempt) {
      return NextResponse.json({ error: 'unknown attempt' }, { status: 404 });
    }
    const exam = await quizExamOwned(db, user.id, attempt.examId);
    if (!exam) {
      return NextResponse.json({ error: 'unknown attempt' }, { status: 404 });
    }
    const items = await listQuizItems(db, exam.id);
    const now = new Date();
    return NextResponse.json({
      attempt: attemptPayload(attempt, exam, now),
      exam: {
        id: exam.id,
        title: exam.title,
        notebookId: exam.notebookId,
        timerMinutes: exam.config.timerMinutes,
        questionCount: items.length
      },
      items: attempt.status === 'in_progress' ? items.map(publicItem) : undefined,
      result: attempt.status === 'in_progress' ? undefined : buildQuizResult(attempt, exam, items)
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function answersFor(items: QuizItemRow[], raw: unknown): QuizAnswers | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const byId = new Map(items.map((item) => [String(item.id), item]));
  const answers: QuizAnswers = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const item = byId.get(key);
    if (!item) return null;
    if (value === null) {
      answers[key] = null;
      continue;
    }
    if (item.kind === 'mcq') {
      if (typeof value !== 'number' || !Number.isInteger(value)) return null;
      answers[key] = value;
      continue;
    }
    if (item.kind === 'multi') {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'number')) return null;
      answers[key] = value.filter((entry): entry is number => Number.isInteger(entry));
      continue;
    }
    if (item.kind === 'truefalse') {
      if (typeof value !== 'boolean') return null;
      answers[key] = value;
      continue;
    }
    if (typeof value !== 'string') return null;
    answers[key] = value.slice(0, 4000);
  }
  return answers;
}

export async function quizAttemptPatch(
  db: Client,
  req: Request,
  attemptIdRaw: string
): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const attempt = await quizAttemptOwned(db, user.id, num(attemptIdRaw));
    if (!attempt) {
      return NextResponse.json({ error: 'unknown attempt' }, { status: 404 });
    }
    const exam = await quizExamOwned(db, user.id, attempt.examId);
    if (!exam) {
      return NextResponse.json({ error: 'unknown attempt' }, { status: 404 });
    }
    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const items = await listQuizItems(db, exam.id);
    const answers = answersFor(items, (parsedBody as { answers?: unknown })?.answers);
    if (!answers) {
      return NextResponse.json({ error: 'invalid answers' }, { status: 400 });
    }
    const saved = await saveQuizAnswers(db, attempt.id, answers);
    if (!saved) {
      return NextResponse.json({ error: 'unknown attempt' }, { status: 404 });
    }
    const remaining = remainingSecondsFor(saved.startedAt, exam.config.timerMinutes, new Date());
    return NextResponse.json({
      saved: true,
      expired: remaining === 0,
      remainingSeconds: remaining
    });
  } catch (error) {
    return errorResponse(error);
  }
}

interface SubmitDeps {
  resolveLlmKey?: typeof resolveLlmKey;
  completeBatch?: (apiKey: string, system: string, user: string) => Promise<string>;
}

export async function quizAttemptSubmit(
  db: Client,
  req: Request,
  attemptIdRaw: string,
  deps: SubmitDeps = {}
): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const attempt = await quizAttemptOwned(db, user.id, num(attemptIdRaw));
    if (!attempt) {
      return NextResponse.json({ error: 'unknown attempt' }, { status: 404 });
    }
    const exam = await quizExamOwned(db, user.id, attempt.examId);
    if (!exam) {
      return NextResponse.json({ error: 'unknown attempt' }, { status: 404 });
    }
    const items = await listQuizItems(db, exam.id);

    if (attempt.status === 'graded') {
      return NextResponse.json(buildQuizResult(attempt, exam, items));
    }

    const now = new Date();
    const submittedAt = attempt.submittedAt ?? now.toISOString();
    const durationMs = Math.max(0, now.getTime() - new Date(attempt.startedAt).getTime());
    const shortItems = items.filter((item) => item.kind === 'short');
    const entries: ShortAnswerEntry[] = [];
    for (const item of shortItems) {
      const answer = attempt.answers[String(item.id)] ?? null;
      if (!hasQuizAnswer(answer)) continue;
      const correct = item.correct as { rubric: string; modelAnswer: string };
      entries.push({
        itemId: item.id,
        prompt: item.prompt,
        rubric: correct.rubric,
        modelAnswer: correct.modelAnswer,
        answer: String(answer).slice(0, 4000)
      });
    }

    const limited = entries.length > 0
      ? await rateLimitResponse(db, `quiz-grade:${user.id}`, QUIZ_GRADE_LIMIT)
      : null;
    if (limited) {
      return limited;
    }

    const objective = scoreObjectiveItems(items, attempt.answers);
    const scores: Record<number, number> = { ...objective.scores };
    let feedback: Record<number, QuizItemFeedback> | null = null;
    let graded = true;

    if (entries.length > 0) {
      const key = await (deps.resolveLlmKey ?? resolveLlmKey)(db, user.id);
      const result = key
        ? await gradeShortAnswers(key, entries, deps.completeBatch)
        : null;
      if (result) {
        feedback = result;
        for (const entry of entries) {
          scores[entry.itemId] = result[entry.itemId]?.score ?? 0;
        }
      } else {
        graded = false;
      }
    }

    let earned = 0;
    let max = 0;
    if (graded) {
      for (const item of items) {
        earned += scores[item.id] ?? 0;
        max += 1;
      }
    } else {
      for (const item of items) {
        if (item.kind === 'short') continue;
        earned += scores[item.id] ?? 0;
        max += 1;
      }
    }
    const score = max > 0 ? earned / max : 0;

    const saved = await saveQuizAttemptResult(db, attempt.id, {
      status: graded ? 'graded' : 'grading_failed',
      score,
      feedback,
      breakdown: buildBreakdown(graded ? items : items.filter((item) => item.kind !== 'short'), scores),
      submittedAt,
      gradedAt: graded ? now.toISOString() : null,
      durationMs,
      gradedBy: entries.length > 0 ? 'ai' : 'auto'
    });

    const body = buildQuizResult(saved, exam, items);
    return NextResponse.json({
      ...body,
      ...(graded ? {} : { gradingError: 'Automatic grading is unavailable right now. Your other answers are saved — try again.' })
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function quizMissedCards(
  db: Client,
  req: Request,
  attemptIdRaw: string
): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const attempt = await quizAttemptOwned(db, user.id, num(attemptIdRaw));
    if (!attempt) {
      return NextResponse.json({ error: 'unknown attempt' }, { status: 404 });
    }
    if (attempt.status === 'in_progress') {
      return NextResponse.json({ error: 'submit the exam first' }, { status: 409 });
    }
    if (attempt.status !== 'graded') {
      return NextResponse.json({ error: 'grade the exam first' }, { status: 409 });
    }
    const exam = await quizExamOwned(db, user.id, attempt.examId);
    if (!exam) {
      return NextResponse.json({ error: 'unknown attempt' }, { status: 404 });
    }
    const items = await listQuizItems(db, exam.id);
    const result = buildQuizResult(attempt, exam, items);
    const missed = result.items.filter((item) => item.score < 1);
    if (missed.length === 0) {
      return NextResponse.json({ created: 0, skipped: 0 });
    }

    const existing = await listCardsWithReview(db, exam.notebookId);
    const seen = new Set(existing.map((card) => normalizeFront(card.front)));
    let created = 0;
    let skipped = 0;
    for (const missedItem of missed) {
      const front = missedItem.prompt.slice(0, CARD_FRONT_MAX).trim();
      const key = normalizeFront(front);
      if (key.length === 0 || seen.has(key)) {
        skipped += 1;
        continue;
      }
      const source = items.find((item) => item.id === missedItem.id);
      const answer = source ? correctAnswerText(source) : '';
      const back = [answer, missedItem.explanation].filter((part) => part.length > 0).join(' — ');
      await createCard(db, exam.notebookId, {
        sourceId: source?.sourceId ?? null,
        front,
        back: back.slice(0, CARD_BACK_MAX) || 'Review this question.',
        generated: true
      });
      seen.add(key);
      created += 1;
    }
    return NextResponse.json({ created, skipped });
  } catch (error) {
    return errorResponse(error);
  }
}

