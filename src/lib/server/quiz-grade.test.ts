// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySchema, makeLocalDb } from '@/lib/db';
import { listCards } from './cards';
import { hashPassword } from './crypto';
import { createNotebook } from './notebooks';
import { createSession, createUser } from './repo';
import { createQuizExam, listQuizItems, saveQuizAnswers, startQuizAttempt, type NewQuizItem } from './quiz';
import {
  buildBreakdown,
  gradeObjectiveItem,
  gradeShortAnswers,
  normalizeFillIn,
  parseGradingReply,
  scoreObjectiveItems
} from './quiz-grade';
import {
  quizAttemptGet,
  quizAttemptPatch,
  quizAttemptSubmit,
  quizDetail,
  quizList,
  quizMissedCards,
  quizStartAttempt
} from './quiz-api';

const ITEMS: NewQuizItem[] = [
  {
    kind: 'mcq',
    topic: 'Respiration',
    prompt: 'Which organelle makes most ATP?',
    options: ['Nucleus', 'Mitochondrion', 'Ribosome', 'Golgi'],
    correct: { index: 1 },
    explanation: 'ATP synthase sits in the inner mitochondrial membrane.',
    sourceId: null
  },
  {
    kind: 'truefalse',
    topic: 'Glycolysis',
    prompt: 'Glycolysis requires oxygen.',
    options: ['True', 'False'],
    correct: { value: false },
    explanation: 'Glycolysis is anaerobic.',
    sourceId: null
  },
  {
    kind: 'fillin',
    topic: 'Glycolysis',
    prompt: 'Glycolysis splits glucose into two ____ molecules.',
    options: [],
    correct: { accepted: ['pyruvate', 'pyruvates'] },
    explanation: 'Pyruvate is the end product of glycolysis.',
    sourceId: null
  },
  {
    kind: 'multi',
    topic: 'Citric acid cycle',
    prompt: 'Which products come out of the citric acid cycle?',
    options: ['NADH', 'FADH2', 'Glucose', 'Pyruvate'],
    correct: { indexes: [0, 1] },
    explanation: 'The cycle produces NADH and FADH2.',
    sourceId: null
  },
  {
    kind: 'short',
    topic: 'Chemiosmosis',
    prompt: 'Explain how the proton gradient drives ATP synthesis.',
    options: [],
    correct: {
      rubric: 'Must mention ATP synthase and protons flowing back across the membrane.',
      modelAnswer: 'Protons flow through ATP synthase, which phosphorylates ADP into ATP.'
    },
    explanation: 'Chemiosmosis couples the gradient to ATP production.',
    sourceId: null
  }
];

describe('quiz grading', () => {
  const items = ITEMS.map((item, index) => ({
    ...item,
    id: index + 1,
    examId: 1,
    ord: index
  }));

  it('normalises fill-in answers', () => {
    expect(normalizeFillIn('  Pyruvate, ')).toBe('pyruvate');
    expect(normalizeFillIn('PYRUVATES.')).toBe('pyruvates');
    expect(normalizeFillIn('two pyruvate')).toBe('two pyruvate');
  });

  it('grades objective kinds deterministically', () => {
    expect(gradeObjectiveItem(items[0]!, 1)).toBe(1);
    expect(gradeObjectiveItem(items[0]!, 0)).toBe(0);
    expect(gradeObjectiveItem(items[0]!, null)).toBe(0);
    expect(gradeObjectiveItem(items[1]!, false)).toBe(1);
    expect(gradeObjectiveItem(items[1]!, true)).toBe(0);
    expect(gradeObjectiveItem(items[2]!, ' Pyruvates ')).toBe(1);
    expect(gradeObjectiveItem(items[2]!, 'lactate')).toBe(0);
    expect(gradeObjectiveItem(items[4]!, 'anything')).toBeNull();
  });

  it('awards partial credit for multi-select and penalises wrong picks', () => {
    expect(gradeObjectiveItem(items[3]!, [0, 1])).toBe(1);
    expect(gradeObjectiveItem(items[3]!, [0])).toBe(0.5);
    // one correct pick and one wrong pick cancel out
    expect(gradeObjectiveItem(items[3]!, [0, 2])).toBe(0);
    expect(gradeObjectiveItem(items[3]!, [2, 3])).toBe(0);
    expect(gradeObjectiveItem(items[3]!, [])).toBe(0);
  });

  it('scores only the objective items and builds a breakdown', () => {
    const result = scoreObjectiveItems(items, { '1': 1, '2': false, '3': 'pyruvate', '4': [0] });
    expect(result.scores).toEqual({ 1: 1, 2: 1, 3: 1, 4: 0.5 });
    expect(result.earned).toBe(3.5);
    expect(result.max).toBe(4);

    const breakdown = buildBreakdown(items, result.scores);
    expect(breakdown.byTopic).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Respiration', earned: 1, max: 1 }),
        expect.objectContaining({ label: 'Glycolysis', earned: 2, max: 2 })
      ])
    );
    expect(breakdown.byKind).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Multiple choice', max: 1 })])
    );
  });

  it('parses grading replies, clamping scores and dropping unknown ids', () => {
    const parsed = parseGradingReply(
      '```json\n[{"itemId":5,"score":1.4,"comment":"Solid"},{"itemId":9,"score":1,"comment":"Nope"},{"itemId":6,"score":-2,"comment":""}]\n```',
      new Set([5, 6])
    );
    expect(parsed).toEqual({
      5: { score: 1, comment: 'Solid' },
      6: { score: 0, comment: '' }
    });
    expect(parseGradingReply('not json', new Set([5]))).toBeNull();
  });

  it('retries a malformed grading reply once', async () => {
    let calls = 0;
    const feedback = await gradeShortAnswers(
      'key',
      [{ itemId: 5, prompt: 'Explain.', rubric: 'Rubric text here.', modelAnswer: 'Answer.', answer: 'Mine.' }],
      async () => {
        calls += 1;
        return calls === 1 ? 'Sorry, I cannot.' : '[{"itemId":5,"score":0.7,"comment":"Mostly right."}]';
      }
    );
    expect(calls).toBe(2);
    expect(feedback).toEqual({ 5: { score: 0.7, comment: 'Mostly right.' } });
  });

  it('reports null when grading keeps failing', async () => {
    const feedback = await gradeShortAnswers(
      'key',
      [{ itemId: 5, prompt: 'Explain.', rubric: 'Rubric text here.', modelAnswer: 'Answer.', answer: 'Mine.' }],
      async () => {
        throw new Error('down');
      }
    );
    expect(feedback).toBeNull();
  });
});

describe('quiz attempt API', () => {
  let db: Client;
  let userId: number;
  let otherUserId: number;
  let token: string;
  let otherToken: string;
  let notebookId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-quiz-api-')), 'api.db'));
    await applySchema(db);
    const user = await createUser(db, {
      email: 'quiz-api@x.local',
      passwordHash: await hashPassword('p'),
      role: 'user'
    });
    userId = user.id;
    token = await createSession(db, user.id);
    const other = await createUser(db, {
      email: 'quiz-api-other@x.local',
      passwordHash: await hashPassword('p'),
      role: 'user'
    });
    otherUserId = other.id;
    otherToken = await createSession(db, other.id);
    notebookId = (await createNotebook(db, user.id, 'Biology')).id;
  });

  afterAll(async () => {
    expect(otherUserId).toBeGreaterThan(userId);
    await db.close();
  });

  async function makeExam(timerMinutes: number | null = 30): Promise<number> {
    const { exam } = await createQuizExam(db, {
      notebookId,
      title: 'Mock exam · cell biology',
      topic: 'Cell biology',
      config: { types: ['mcq', 'truefalse', 'fillin', 'multi', 'short'], requestedCount: 5, timerMinutes, sourceSummary: 'Notes' },
      items: ITEMS
    });
    return exam.id;
  }

  function req(url: string, options: { body?: unknown; method?: string; alias?: string } = {}): Request {
    const activeToken = options.alias === 'other' ? otherToken : token;
    return new Request(url, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: `sl_session=${activeToken}`
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    });
  }

  async function startAndSave(examId: number): Promise<{ attemptId: number; itemIds: number[] }> {
    const started = await quizStartAttempt(db, req(`http://x/api/quizzes/${examId}/attempts`), String(examId));
    const startBody = await started.json();
    const attemptId = startBody.attempt.id as number;
    const itemIds = (startBody.items as Array<{ id: number }>).map((item) => item.id);
    const saved = await quizAttemptPatch(
      db,
      req(`http://x/api/quiz-attempts/${attemptId}`, {
        method: 'PATCH',
        body: {
          answers: {
            [itemIds[0]!]: 1,
            [itemIds[1]!]: true,
            [itemIds[2]!]: 'Pyruvate',
            [itemIds[3]!]: [0],
            [itemIds[4]!]: 'Protons flow back through ATP synthase.'
          }
        }
      }),
      String(attemptId)
    );
    expect(saved.status).toBe(200);
    return { attemptId, itemIds };
  }

  it('lists exams and hides correct answers until submission', async () => {
    const examId = await makeExam();
    const list = await quizList(db, req(`http://x/api/notebooks/${notebookId}/quizzes`), String(notebookId));
    const listBody = await list.json();
    expect(listBody.quizzes.some((entry: { id: number }) => entry.id === examId)).toBe(true);

    const started = await quizStartAttempt(db, req(`http://x/api/quizzes/${examId}/attempts`), String(examId));
    const body = await started.json();
    expect(body.attempt.status).toBe('in_progress');
    expect(body.items).toHaveLength(5);
    expect(JSON.stringify(body.items)).not.toContain('correct');
    expect(JSON.stringify(body.items)).not.toContain('rubric');
    expect(body.attempt.remainingSeconds).toBe(30 * 60);
  });

  it('resumes the same attempt instead of starting another', async () => {
    const examId = await makeExam();
    const first = await quizStartAttempt(db, req(`http://x/api/quizzes/${examId}/attempts`), String(examId));
    const second = await quizStartAttempt(db, req(`http://x/api/quizzes/${examId}/attempts`), String(examId));
    expect((await second.json()).attempt.id).toBe((await first.json()).attempt.id);
  });

  it('rejects answers whose shape does not match the question kind', async () => {
    const examId = await makeExam();
    const started = await quizStartAttempt(db, req(`http://x/api/quizzes/${examId}/attempts`), String(examId));
    const body = await started.json();
    const attemptId = body.attempt.id as number;
    const mcqId = body.items[0].id as number;

    const bad = await quizAttemptPatch(
      db,
      req(`http://x/api/quiz-attempts/${attemptId}`, { method: 'PATCH', body: { answers: { [mcqId]: 'one' } } }),
      String(attemptId)
    );
    expect(bad.status).toBe(400);

    const foreign = await quizAttemptPatch(
      db,
      req(`http://x/api/quiz-attempts/${attemptId}`, { method: 'PATCH', body: { answers: { '9999': 1 } } }),
      String(attemptId)
    );
    expect(foreign.status).toBe(400);

    const notMine = await quizAttemptGet(
      db,
      req(`http://x/api/quiz-attempts/${attemptId}`, { alias: 'other' }),
      String(attemptId)
    );
    expect(notMine.status).toBe(404);
  });

  it('reports an expired timer on save', async () => {
    const examId = await makeExam(15);
    const attempt = await startQuizAttempt(db, examId, userId, new Date(Date.now() - 20 * 60 * 1000));
    const saved = await quizAttemptPatch(
      db,
      req(`http://x/api/quiz-attempts/${attempt.id}`, { method: 'PATCH', body: { answers: {} } }),
      String(attempt.id)
    );
    const body = await saved.json();
    expect(body.expired).toBe(true);
    expect(body.remainingSeconds).toBe(0);
  });

  it('scores the exam with AI partial credit and is idempotent', async () => {
    const examId = await makeExam();
    const { attemptId, itemIds } = await startAndSave(examId);
    let calls = 0;

    const res = await quizAttemptSubmit(db, req(`http://x/api/quiz-attempts/${attemptId}/submit`), String(attemptId), {
      resolveLlmKey: async () => 'test-key',
      completeBatch: async () => {
        calls += 1;
        return JSON.stringify([
          { itemId: itemIds[4], score: 0.6, comment: 'Mentions ATP synthase but not the gradient.' }
        ]);
      }
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attempt.status).toBe('graded');
    expect(body.graded).toBe(true);
    expect(calls).toBe(1);
    // 1 (mcq) + 0 (tf) + 1 (fill-in) + 0.5 (multi) + 0.6 (short) = 3.1 / 5
    expect(body.score).toBeUndefined();
    expect(body.attempt.score).toBeCloseTo(0.62, 5);
    expect(body.earned).toBeCloseTo(3.1, 5);
    expect(body.max).toBe(5);
    expect(body.items.find((item: { kind: string }) => item.kind === 'short').feedback).toContain('ATP synthase');
    expect(body.breakdown.byTopic.length).toBeGreaterThan(0);

    const again = await quizAttemptSubmit(db, req(`http://x/api/quiz-attempts/${attemptId}/submit`), String(attemptId), {
      resolveLlmKey: async () => 'test-key',
      completeBatch: async () => {
        calls += 1;
        return '[]';
      }
    });
    expect(again.status).toBe(200);
    expect(calls).toBe(1);

    const read = await quizAttemptGet(db, req(`http://x/api/quiz-attempts/${attemptId}`), String(attemptId));
    const readBody = await read.json();
    expect(readBody.items).toBeUndefined();
    expect(readBody.result.attempt.status).toBe('graded');
  });

  it('keeps the attempt and offers a retry when grading fails', async () => {
    const examId = await makeExam();
    const { attemptId } = await startAndSave(examId);
    const res = await quizAttemptSubmit(db, req(`http://x/api/quiz-attempts/${attemptId}/submit`), String(attemptId), {
      resolveLlmKey: async () => 'test-key',
      completeBatch: async () => {
        throw new Error('provider down');
      }
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attempt.status).toBe('grading_failed');
    expect(body.graded).toBe(false);
    expect(body.gradingError).toContain('try again');
    // objective score over four items: 2.5 / 4
    expect(body.attempt.score).toBeCloseTo(0.625, 5);
    expect(body.breakdown.byKind.some((row: { label: string }) => row.label === 'Short answer')).toBe(false);
  });

  it('adds missed questions to flashcards once', async () => {
    const examId = await makeExam();
    const { attemptId, itemIds } = await startAndSave(examId);
    await quizAttemptSubmit(db, req(`http://x/api/quiz-attempts/${attemptId}/submit`), String(attemptId), {
      resolveLlmKey: async () => 'test-key',
      completeBatch: async () =>
        JSON.stringify([{ itemId: itemIds[4], score: 1, comment: 'Complete.' }])
    });

    const first = await quizMissedCards(
      db,
      req(`http://x/api/quiz-attempts/${attemptId}/missed-cards`),
      String(attemptId)
    );
    const firstBody = await first.json();
    // tf (0), multi (0.5) and short (1.0) — only the true/false and multi missed
    expect(firstBody.created).toBe(2);

    const second = await quizMissedCards(
      db,
      req(`http://x/api/quiz-attempts/${attemptId}/missed-cards`),
      String(attemptId)
    );
    expect((await second.json()).created).toBe(0);

    const cards = await listCards(db, notebookId);
    expect(cards.some((card) => card.front.includes('Glycolysis requires oxygen'))).toBe(true);
  });

  it('returns exam detail with attempts and refuses another user', async () => {
    const examId = await makeExam();
    await startAndSave(examId);
    const detail = await quizDetail(db, req(`http://x/api/quizzes/${examId}`), String(examId));
    const body = await detail.json();
    expect(body.items).toHaveLength(5);
    expect(body.items[0].correct).toBeUndefined();
    expect(body.attempts.length).toBeGreaterThan(0);

    const foreign = await quizDetail(
      db,
      req(`http://x/api/quizzes/${examId}`, { alias: 'other' }),
      String(examId)
    );
    expect(foreign.status).toBe(404);
  });

  it('does not expose other users to the notebook quiz list', async () => {
    const res = await quizList(
      db,
      req(`http://x/api/notebooks/${notebookId}/quizzes`, { alias: 'other' }),
      String(notebookId)
    );
    expect(res.status).toBe(404);
  });

  it('requires a session for every attempt route', async () => {
    const examId = await makeExam();
    const attempt = await startQuizAttempt(db, examId, userId);
    const anonymous = new Request(`http://x/api/quiz-attempts/${attempt.id}`, { method: 'GET' });
    expect((await quizAttemptGet(db, anonymous, String(attempt.id))).status).toBe(401);
    expect((await quizAttemptSubmit(db, anonymous, String(attempt.id))).status).toBe(401);
    expect((await quizMissedCards(db, anonymous, String(attempt.id))).status).toBe(401);
  });

  it('marks the attempt submitted when read back through the repo', async () => {
    const examId = await makeExam();
    const { attemptId, itemIds } = await startAndSave(examId);
    await quizAttemptSubmit(db, req(`http://x/api/quiz-attempts/${attemptId}/submit`), String(attemptId), {
      resolveLlmKey: async () => 'test-key',
      completeBatch: async () => JSON.stringify([{ itemId: itemIds[4], score: 0.2, comment: 'Thin.' }])
    });
    const items = await listQuizItems(db, examId);
    expect(items).toHaveLength(5);
    const saved = await saveQuizAnswers(db, attemptId, { [String(items[0]!.id)]: 0 });
    expect(saved?.status).toBe('graded');
    expect(saved?.answers[String(items[0]!.id)]).toBe(1);
  });
});
