// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySchema, makeLocalDb } from '@/lib/db';
import { hashPassword } from './crypto';
import { createNotebook } from './notebooks';
import { createSession, createUser } from './repo';
import {
  createQuizExam,
  deleteQuizExam,
  listQuizAttempts,
  listQuizExams,
  listQuizItems,
  quizAttemptOwned,
  quizExamOwned,
  saveQuizAnswers,
  saveQuizAttemptResult,
  startQuizAttempt,
  type NewQuizItem
} from './quiz';
import type { QuizExamConfig } from '../quiz';

const CONFIG: QuizExamConfig = {
  types: ['mcq', 'truefalse'],
  requestedCount: 2,
  timerMinutes: 30,
  sourceSummary: 'Cell biology'
};

function items(): NewQuizItem[] {
  return [
    {
      kind: 'mcq',
      topic: 'Respiration',
      prompt: 'Which organelle produces most ATP?',
      options: ['Nucleus', 'Mitochondrion', 'Ribosome', 'Golgi'],
      correct: { index: 1 },
      explanation: 'Oxidative phosphorylation happens in the mitochondrion.',
      sourceId: null
    },
    {
      kind: 'truefalse',
      topic: 'Glycolysis',
      prompt: 'Glycolysis needs oxygen to proceed.',
      options: ['True', 'False'],
      correct: { value: false },
      explanation: 'Glycolysis is anaerobic.',
      sourceId: null
    }
  ];
}

describe('quiz repo', () => {
  let db: Client;
  let userId: number;
  let otherUserId: number;
  let notebookId: number;
  let token: string;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-quiz-')), 'quiz.db'));
    await applySchema(db);
    const user = await createUser(db, {
      email: 'quiz@x.local',
      passwordHash: await hashPassword('p'),
      role: 'user'
    });
    userId = user.id;
    token = await createSession(db, user.id);
    otherUserId = (
      await createUser(db, {
        email: 'quiz-other@x.local',
        passwordHash: await hashPassword('p'),
        role: 'user'
      })
    ).id;
    notebookId = (await createNotebook(db, user.id, 'Biology')).id;
  });

  afterAll(async () => {
    expect(token.length).toBeGreaterThan(0);
    await db.close();
  });

  it('stores an exam with ordered items and parsed config', async () => {
    const { exam, items: stored } = await createQuizExam(db, {
      notebookId,
      title: 'Mock exam · Cell biology',
      topic: 'Cell biology',
      config: CONFIG,
      items: items()
    });

    expect(exam.notebookId).toBe(notebookId);
    expect(exam.config.timerMinutes).toBe(30);
    expect(exam.config.types).toEqual(['mcq', 'truefalse']);
    expect(stored.map((item) => item.ord)).toEqual([0, 1]);
    expect(stored[0]?.correct).toEqual({ index: 1 });
    expect(stored[1]?.correct).toEqual({ value: false });
    expect(stored[0]?.options).toHaveLength(4);
  });

  it('scopes exams to the owning user', async () => {
    const { exam } = await createQuizExam(db, {
      notebookId,
      title: 'Scoped',
      topic: '',
      config: CONFIG,
      items: items()
    });
    expect(await quizExamOwned(db, userId, exam.id)).not.toBeNull();
    expect(await quizExamOwned(db, otherUserId, exam.id)).toBeNull();
  });

  it('keeps a single active attempt per exam and user', async () => {
    const { exam } = await createQuizExam(db, {
      notebookId,
      title: 'Attempts',
      topic: '',
      config: CONFIG,
      items: items()
    });
    const first = await startQuizAttempt(db, exam.id, userId, new Date('2026-11-16T10:00:00Z'));
    const second = await startQuizAttempt(db, exam.id, userId, new Date('2026-11-16T10:05:00Z'));
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('in_progress');
    expect(second.startedAt).toBe(first.startedAt);

    const other = await startQuizAttempt(db, exam.id, otherUserId, new Date());
    expect(other.id).not.toBe(first.id);
  });

  it('merges saved answers and freezes the attempt after submission', async () => {
    const { exam, items: stored } = await createQuizExam(db, {
      notebookId,
      title: 'Saving',
      topic: '',
      config: CONFIG,
      items: items()
    });
    const attempt = await startQuizAttempt(db, exam.id, userId);
    const firstItemId = stored[0]!.id;
    const secondItemId = stored[1]!.id;

    const saved = await saveQuizAnswers(db, attempt.id, { [firstItemId]: 1 });
    expect(saved?.answers[String(firstItemId)]).toBe(1);

    const merged = await saveQuizAnswers(db, attempt.id, {
      [secondItemId]: false,
      [firstItemId]: 2
    });
    expect(merged?.answers[String(firstItemId)]).toBe(2);
    expect(merged?.answers[String(secondItemId)]).toBe(false);

    const cleared = await saveQuizAnswers(db, attempt.id, { [firstItemId]: null });
    expect(cleared?.answers[String(firstItemId)]).toBeUndefined();

    await saveQuizAttemptResult(db, attempt.id, {
      status: 'graded',
      score: 0.5,
      feedback: null,
      breakdown: { byTopic: [], byKind: [] },
      submittedAt: '2026-11-16T10:20:00Z',
      gradedAt: '2026-11-16T10:20:02Z',
      durationMs: 1_200_000,
      gradedBy: 'auto'
    });
    const frozen = await saveQuizAnswers(db, attempt.id, { [firstItemId]: 3 });
    expect(frozen?.answers[String(firstItemId)]).toBeUndefined();
    expect(frozen?.status).toBe('graded');
  });

  it('summarises question counts, scores and the resumable attempt', async () => {
    const { exam } = await createQuizExam(db, {
      notebookId,
      title: 'Summary',
      topic: 'Enzymes',
      config: { ...CONFIG, requestedCount: 2, timerMinutes: 30 },
      items: items()
    });
    const now = new Date('2026-11-16T12:00:00Z');
    const attempt = await startQuizAttempt(db, exam.id, userId, now);
    await saveQuizAnswers(db, attempt.id, { '1': 0 });

    let summaries = await listQuizExams(db, notebookId, userId, new Date('2026-11-16T12:10:00Z'));
    let summary = summaries.find((entry) => entry.id === exam.id)!;
    expect(summary.questionCount).toBe(2);
    expect(summary.timerMinutes).toBe(30);
    expect(summary.types).toEqual(['mcq', 'truefalse']);
    expect(summary.activeAttempt?.id).toBe(attempt.id);
    expect(summary.activeAttempt?.answered).toBe(1);
    expect(summary.activeAttempt?.remainingSeconds).toBe(30 * 60 - 600);
    expect(summary.lastAttempt).toBeNull();

    await saveQuizAttemptResult(db, attempt.id, {
      status: 'graded',
      score: 0.5,
      feedback: null,
      breakdown: { byTopic: [], byKind: [] },
      submittedAt: '2026-11-16T12:11:00Z',
      gradedAt: '2026-11-16T12:11:01Z',
      durationMs: 66_000,
      gradedBy: 'auto'
    });
    summaries = await listQuizExams(db, notebookId, userId, new Date('2026-11-16T12:12:00Z'));
    summary = summaries.find((entry) => entry.id === exam.id)!;
    expect(summary.activeAttempt).toBeNull();
    expect(summary.bestScore).toBe(0.5);
    expect(summary.lastAttempt?.id).toBe(attempt.id);

    const attempts = await listQuizAttempts(db, exam.id, userId);
    expect(attempts.map((entry) => entry.id)).toContain(attempt.id);
  });

  it('rejects attempts that belong to another user', async () => {
    const { exam } = await createQuizExam(db, {
      notebookId,
      title: 'Ownership',
      topic: '',
      config: CONFIG,
      items: items()
    });
    const attempt = await startQuizAttempt(db, exam.id, userId);
    expect(await quizAttemptOwned(db, userId, attempt.id)).not.toBeNull();
    expect(await quizAttemptOwned(db, otherUserId, attempt.id)).toBeNull();
  });

  it('deletes the exam and its items', async () => {
    const { exam } = await createQuizExam(db, {
      notebookId,
      title: 'Delete me',
      topic: '',
      config: CONFIG,
      items: items()
    });
    expect(await listQuizItems(db, exam.id)).toHaveLength(2);
    expect(await deleteQuizExam(db, otherUserId, exam.id)).toBe(false);
    expect(await deleteQuizExam(db, userId, exam.id)).toBe(true);
    expect(await listQuizItems(db, exam.id)).toHaveLength(0);
    expect(await quizExamOwned(db, userId, exam.id)).toBeNull();
  });
});
