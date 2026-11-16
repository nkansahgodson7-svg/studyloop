// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySchema, makeLocalDb } from '@/lib/db';
import { hashPassword } from './crypto';
import { ingestTextSource } from './ingest/ingest';
import { createNotebook } from './notebooks';
import { createSession, createUser } from './repo';
import { allocateQuizKinds, normalizeGeneratedItem, parseGeneratedBatch, planNextBatch, quizGenerate } from './quiz-generate';
import { listQuizItems } from './quiz';

const MATERIAL = [
  'Cellular respiration converts glucose into ATP. Glycolysis splits glucose into two pyruvate molecules and happens in the cytoplasm without oxygen.',
  'The pyruvate is oxidised in the mitochondrion, releasing carbon dioxide and feeding the citric acid cycle. The electron transport chain pumps protons.',
  'ATP synthase uses the proton gradient to make ATP. Oxidative phosphorylation produces most of the cell ATP. Fermentation regenerates NAD+ when oxygen is absent.'
].join(' ');

function mcq(index: number, suffix = ''): Record<string, unknown> {
  return {
    kind: 'mcq',
    topic: 'Respiration',
    prompt: `Which organelle makes most ATP question ${index}${suffix}?`,
    options: ['Nucleus', 'Mitochondrion', 'Ribosome', 'Golgi'],
    correctIndex: 1,
    explanation: 'Atp synthase sits in the mitochondrial membrane.'
  };
}

function truefalse(index: number, suffix = ''): Record<string, unknown> {
  return {
    kind: 'truefalse',
    topic: 'Glycolysis',
    prompt: `Glycolysis requires oxygen statement ${index}${suffix}.`,
    answer: false,
    explanation: 'Glycolysis is anaerobic.'
  };
}

function multi(index: number, suffix = ''): Record<string, unknown> {
  return {
    kind: 'multi',
    topic: 'Respiration',
    prompt: `Select every product of the citric acid cycle ${index}${suffix}.`,
    options: ['NADH', 'FADH2', 'ATP', 'Pyruvate'],
    correctIndexes: [0, 1, 2],
    explanation: 'The cycle yields reducing equivalents and GTP/ATP.'
  };
}

function allKinds(suffix = ''): unknown[] {
  return [
    mcq(1, suffix),
    mcq(2, suffix),
    mcq(3, suffix),
    mcq(4, suffix),
    multi(1, suffix),
    multi(2, suffix),
    multi(3, suffix),
    multi(4, suffix),
    truefalse(1, suffix),
    truefalse(2, suffix),
    truefalse(3, suffix),
    truefalse(4, suffix)
  ];
}

describe('quiz generation helpers', () => {
  it('allocates the count round-robin across the chosen types', () => {
    expect(allocateQuizKinds(['mcq', 'multi', 'truefalse'], 10)).toEqual({
      mcq: 4,
      multi: 3,
      truefalse: 3
    });
    expect(allocateQuizKinds(['mcq'], 5)).toEqual({ mcq: 5 });
    expect(allocateQuizKinds([], 5)).toEqual({});
  });

  it('plans batches of at most six, largest quota first', () => {
    expect(planNextBatch({ mcq: 4, multi: 3, truefalse: 3 }, 6)).toEqual({ mcq: 4, multi: 2 });
    expect(planNextBatch({ mcq: 1, multi: 1 }, 6)).toEqual({ mcq: 1, multi: 1 });
  });

  it('accepts every question shape and fills in fixed true/false options', () => {
    const mcqItem = normalizeGeneratedItem(mcq(1));
    expect(mcqItem?.correct).toEqual({ index: 1 });
    expect(mcqItem?.options).toHaveLength(4);

    const multiItem = normalizeGeneratedItem(multi(1));
    expect(multiItem?.correct).toEqual({ indexes: [0, 1, 2] });

    const tfItem = normalizeGeneratedItem(truefalse(1));
    expect(tfItem?.options).toEqual(['True', 'False']);
    expect(tfItem?.correct).toEqual({ value: false });

    const fill = normalizeGeneratedItem({
      kind: 'fillin',
      topic: 'Glycolysis',
      prompt: 'Glycolysis splits glucose into two ____ molecules.',
      accepted: ['pyruvate', 'pyruvates'],
      explanation: 'Pyruvate is the end product.'
    });
    expect(fill?.correct).toEqual({ accepted: ['pyruvate', 'pyruvates'] });

    const short = normalizeGeneratedItem({
      kind: 'short',
      topic: 'ATP',
      prompt: 'Explain how the proton gradient drives ATP synthesis.',
      rubric: 'Must mention ATP synthase and the proton gradient.',
      modelAnswer: 'Protons flow back through ATP synthase, driving phosphorylation of ADP.',
      explanation: 'Chemiosmosis couples the gradient to ATP production.'
    });
    expect(short?.correct).toMatchObject({ rubric: expect.stringContaining('ATP synthase') });
  });

  it('drops unusable questions instead of storing them', () => {
    expect(normalizeGeneratedItem({ kind: 'mcq', prompt: 'short' })).toBeNull();
    expect(
      normalizeGeneratedItem({
        kind: 'mcq',
        prompt: 'Which one is right?',
        options: ['a', 'b', 'c'],
        correctIndex: 9
      })
    ).toBeNull();
    expect(
      normalizeGeneratedItem({
        kind: 'multi',
        prompt: 'Pick the correct ones.',
        options: ['a', 'b', 'c'],
        correctIndexes: [0, 1, 2]
      })
    ).toBeNull();
    expect(
      normalizeGeneratedItem({
        kind: 'fillin',
        prompt: 'The answer is ____.',
        accepted: []
      })
    ).toBeNull();
    expect(
      normalizeGeneratedItem({
        kind: 'short',
        prompt: 'Explain oxidative phosphorylation.',
        modelAnswer: 'Proton gradient.'
      })
    ).toBeNull();
    expect(normalizeGeneratedItem({ kind: 'essay', prompt: 'Nope, unknown kind.' })).toBeNull();
  });

  it('parses fenced replies and keeps only the allowed kinds', () => {
    const raw = `\`\`\`json\n${JSON.stringify([mcq(1), truefalse(1)])}\n\`\`\``;
    const parsed = parseGeneratedBatch(raw, new Set(['mcq']));
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.kind).toBe('mcq');
    expect(parsed.rejected).toBe(1);
    expect(parseGeneratedBatch('not json', new Set(['mcq'])).items).toHaveLength(0);
  });
});

describe('quizGenerate()', () => {
  let db: Client;
  let userId: number;
  let token: string;
  let notebookId: number;
  let otherNotebookId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-quiz-gen-')), 'gen.db'));
    await applySchema(db);
    const user = await createUser(db, {
      email: 'quiz-gen@x.local',
      passwordHash: await hashPassword('p'),
      role: 'user'
    });
    userId = user.id;
    token = await createSession(db, user.id);
    notebookId = (await createNotebook(db, user.id, 'Biology')).id;
    otherNotebookId = (await createNotebook(db, user.id, 'Empty')).id;
    await ingestTextSource(db, {
      notebookId,
      userId,
      title: 'Respiration notes',
      kind: 'text',
      text: MATERIAL
    });
  });

  afterAll(async () => {
    await db.close();
  });

  function request(body: unknown, withToken = true): Request {
    return new Request(`http://x/api/notebooks/${notebookId}/quizzes/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(withToken ? { cookie: `sl_session=${token}` } : {})
      },
      body: JSON.stringify(body)
    });
  }

  function setSources(): unknown {
    return [{ sourceId: 1 }];
  }

  it('writes a mixed exam in batches and stores it', async () => {
    let calls = 0;
    const res = await quizGenerate(db, request({ sources: setSources(), types: ['mcq', 'multi', 'truefalse'], count: 10 }), String(notebookId), {
      resolveLlmKey: async () => 'test-key',
      completeBatch: async () => {
        calls += 1;
        return JSON.stringify(allKinds(`-${calls}`));
      }
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.generated).toBe(10);
    expect(body.truncated).toBe(false);
    expect(body.exam.title).toContain('Mock exam');
    expect(body.items).toHaveLength(10);
    expect(calls).toBe(2);
    expect(body.items.some((item: { kind: string }) => item.kind === 'multi')).toBe(true);
    expect(body.items.some((item: { kind: string }) => item.kind === 'truefalse')).toBe(true);

    const stored = await listQuizItems(db, body.exam.id);
    expect(stored).toHaveLength(10);
    expect(stored.every((item) => item.topic.length > 0)).toBe(true);
    expect(stored.some((item) => item.kind === 'mcq' && item.correct)).toBe(true);
  });

  it('retries a malformed batch once, then gives up with a readable 502', async () => {
    const res = await quizGenerate(db, request({ sources: setSources(), types: ['mcq'], count: 5 }), String(notebookId), {
      resolveLlmKey: async () => 'test-key',
      completeBatch: async () => 'I cannot write questions.'
    });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('GENERATION_INVALID');
  });

  it('keeps a partial exam when the model stops early', async () => {
    let calls = 0;
    const res = await quizGenerate(db, request({ sources: setSources(), types: ['mcq'], count: 5 }), String(notebookId), {
      resolveLlmKey: async () => 'test-key',
      completeBatch: async () => {
        calls += 1;
        return calls === 1 ? JSON.stringify([mcq(1, '-partial')]) : '[]';
      }
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.generated).toBe(1);
    expect(body.truncated).toBe(true);
  });

  it('deduplicates questions that repeat earlier prompts', async () => {
    const res = await quizGenerate(db, request({ sources: setSources(), types: ['mcq'], count: 2 }), String(notebookId), {
      resolveLlmKey: async () => 'test-key',
      completeBatch: async () => JSON.stringify([mcq(1)])
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.generated).toBe(1);
  });

  it('rejects a request with no question types', async () => {
    const res = await quizGenerate(db, request({ sources: setSources(), types: [], count: 5 }), String(notebookId), {
      resolveLlmKey: async () => 'test-key',
      completeBatch: async () => '[]'
    });
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range timer', async () => {
    const res = await quizGenerate(
      db,
      request({ sources: setSources(), types: ['mcq'], count: 5, timerMinutes: 600 }),
      String(notebookId),
      { resolveLlmKey: async () => 'test-key', completeBatch: async () => '[]' }
    );
    expect(res.status).toBe(400);
  });

  it('requires a session', async () => {
    const res = await quizGenerate(db, request({ sources: setSources(), types: ['mcq'], count: 5 }, false), String(notebookId), {
      resolveLlmKey: async () => 'test-key',
      completeBatch: async () => '[]'
    });
    expect(res.status).toBe(401);
  });

  it('404s when the selected source belongs to another notebook', async () => {
    const res = await quizGenerate(
      db,
      new Request(`http://x/api/notebooks/${otherNotebookId}/quizzes/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
        body: JSON.stringify({ sources: [{ sourceId: 1 }], types: ['mcq'], count: 5 })
      }),
      String(otherNotebookId),
      { resolveLlmKey: async () => 'test-key', completeBatch: async () => '[]' }
    );
    expect(res.status).toBe(404);
  });
});
