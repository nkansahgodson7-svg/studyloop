// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from './crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createNotebook } from './notebooks';
import { createUser, createSession } from './repo';
import { ingestTextSource } from './ingest/ingest';
import {
  createCard,
  listCards,
  listCardsWithReview,
  listCardBatches,
  dueQueue,
  gradeCard,
  streakDays,
  deleteCard,
  cardOwned,
  updateCard,
  normalizeFront,
  stratifiedSample
} from './cards';
import {
  cardsAdd,
  cardsList,
  cardsDue,
  cardsEdit,
  cardsDelete,
  cardsGrade,
  cardsGenerate,
  cardsBatchAdd
} from './cards';
import { Rating } from './fsrs';

function makeRequest(url: string, body: string | null, token: string | null, method = 'POST'): Request {
  const init: RequestInit = {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { cookie: `sl_session=${token}` } : {})
    }
  };
  if (body) {
    init.body = body;
  }
  return new Request(url, init);
}

describe('cards data layer', () => {
  let db: Client;
  let userId: number;
  let notebookId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-cards-')), 'cards.db'));
    await applySchema(db);
    const user = await createUser(db, { email: 'cards@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    userId = user.id;
    notebookId = (await createNotebook(db, userId, 'Cards notebook')).id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('adds a card and an initial review row due now', async () => {
    const card = await createCard(db, notebookId, { front: 'Define FSRS', back: 'A modern spaced-repetition algorithm.' });
    expect(card.front).toBe('Define FSRS');
    const queue = await dueQueue(db, notebookId, new Date(new Date(card.createdAt).getTime() + 1000));
    const queuedIds = queue.map((queued) => queued.cardId);
    expect(queuedIds).toContain(card.id);
    const review = queue.find((queued) => queued.cardId === card.id);
    expect(review?.state).toBe(0);
  });

  it('lists cards and edits them', async () => {
    const card = await createCard(db, notebookId, { front: 'F1', back: 'B1' });
    const cards = await listCards(db, notebookId);
    expect(cards.map((row) => row.id)).toContain(card.id);
    const updated = await updateCard(db, userId, card.id, { front: 'F1 edit', back: 'B1 edit' });
    expect(updated).toMatchObject({ front: 'F1 edit', back: 'B1 edit' });
    const owned = await cardOwned(db, userId, card.id);
    expect(owned?.id).toBe(card.id);
  });

  it('deletes a card and its review row', async () => {
    const card = await createCard(db, notebookId, { front: 'F-Del', back: 'B-Del' });
    expect(await deleteCard(db, userId, card.id)).toBe(true);
    expect(await cardOwned(db, userId, card.id)).toBeNull();
  });

  it('grades a card forward through the queue', async () => {
    const card = await createCard(db, notebookId, { front: 'Grade me', back: 'yes' });
    const review = new Date(card.createdAt);
    const graded = await gradeCard(db, card.id, Rating.Good, review);
    expect(graded.state).toBe(1);
    expect(graded.due.getTime()).toBeGreaterThan(review.getTime());
    expect(graded.lastGraded?.getTime()).toBe(review.getTime());
    const after = await dueQueue(db, notebookId, new Date(review.getTime() + 1));
    expect(after.map((row) => row.cardId)).not.toContain(card.id);
    const later = await dueQueue(db, notebookId, graded.due);
    expect(later.map((row) => row.cardId)).toContain(card.id);
  });
});

describe('streak()', () => {
  let db: Client;
  let notebookId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-streak-')), 'streak.db'));
    await applySchema(db);
    const user = await createUser(db, { email: 'streak@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    notebookId = (await createNotebook(db, user.id, 'Streak notebook')).id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('counts consecutive grading days ending today', async () => {
    const card = await createCard(db, notebookId, { front: 'F', back: 'B' });
    const today = new Date('2026-10-24T10:00:00.000Z');
    const yesterdayMidnight = new Date('2026-10-23T09:00:00.000Z');
    await gradeCard(db, card.id, Rating.Good, yesterdayMidnight);
    expect(await streakDays(db, notebookId, new Date('2026-10-23T12:00:00.000Z'))).toBe(1);
    await gradeCard(db, card.id, Rating.Good, today);
    expect(await streakDays(db, notebookId, today)).toBe(2);
  });

  it('returns 0 for a notebook never graded', async () => {
    const other = (await createNotebook(db, 1, 'Other notebook')).id;
    expect(await streakDays(db, other, new Date('2026-10-24T10:00:00.000Z'))).toBe(0);
  });
});

describe('cards handlers', () => {
  let db: Client;
  let userId: number;
  let token: string;
  let notebookId: number;
  let sourceId: number;
  let pagedSourceId: number;
  let foreignToken: string;
  let foreignSourceId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-cardsh-')), 'cards-h.db'));
    await applySchema(db);
    const user = await createUser(db, { email: 'owner@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    userId = user.id;
    token = await createSession(db, userId);
    notebookId = (await createNotebook(db, userId, 'Handler notebook')).id;
    sourceId = (await ingestTextSource(db, {
      notebookId,
      title: 'Biology notes',
      text: 'Photosynthesis converts light energy into chemical energy. The Calvin cycle fixes carbon dioxide in the stroma.'
    })).id;
    pagedSourceId = (await ingestTextSource(db, {
      notebookId,
      title: 'Paged slides',
      kind: 'pdf',
      pages: [
        'Chapter 1: Light reactions. Chlorophyll absorbs photons in the thylakoid membrane.',
        'Chapter 2: Calvin cycle. RuBisCO fixes carbon dioxide in the stroma.'
      ]
    })).id;
    const other = await createUser(db, { email: 'other@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    foreignToken = await createSession(db, other.id);
    const foreignNotebook = await createNotebook(db, other.id, 'Foreign notebook');
    foreignSourceId = (await ingestTextSource(db, {
      notebookId: foreignNotebook.id,
      userId: other.id,
      title: 'Private notes',
      text: 'This source belongs to another user and must never be used for generation.'
    })).id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('cardsAdd creates a card; cardsList shows it', async () => {
    const res = await cardsAdd(
      db,
      makeRequest(`http://x/api/notebooks/${notebookId}/cards`, JSON.stringify({ front: 'H front', back: 'H back' }), token),
      String(notebookId)
    );
    expect(res.status).toBe(201);
    const list = await cardsList(db, makeRequest(`http://x/api/notebooks/${notebookId}/cards`, null, token, 'GET'), String(notebookId));
    expect(list.status).toBe(200);
    const body = (await list.json()) as { cards: Array<{ front: string }> };
    expect(body.cards.map((card) => card.front)).toContain('H front');
  });

  it('cardsDue returns due cards; cardsGrade reschedules them', async () => {
    const res = await cardsDue(db, makeRequest(`http://x/api/notebooks/${notebookId}/cards/due`, null, token, 'GET'), String(notebookId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cards: Array<{ cardId: number; front: string; due: string }> };
    expect(body.cards.length).toBeGreaterThan(0);
    const first = body.cards[0]!;
    const gradedRes = await cardsGrade(
      db,
      makeRequest(`http://x/api/cards/${first.cardId}/grade`, JSON.stringify({ rating: 3 }), token),
      String(first.cardId)
    );
    expect(gradedRes.status).toBe(200);
    const gradedBody = (await gradedRes.json()) as { due: string; state: number };
    expect(gradedBody.state).toBe(1);
    const dueAgain = await cardsDue(
      db,
      makeRequest(`http://x/api/notebooks/${notebookId}/cards/due?at=${encodeURIComponent(gradedBody.due)}`, null, token, 'GET'),
      String(notebookId)
    );
    const dueAgainBody = (await dueAgain.json()) as { cards: Array<{ cardId: number }> };
    expect(dueAgainBody.cards.map((row) => row.cardId)).toContain(first.cardId);
  });

  it('cardsEdit updates and cardsDelete removes', async () => {
    await cardsAdd(db, makeRequest(`http://x/api/notebooks/${notebookId}/cards`, JSON.stringify({ front: 'E front', back: 'E back' }), token), String(notebookId));
    const listBody = (await (await cardsList(db, makeRequest(`http://x/api/notebooks/${notebookId}/cards`, null, token, 'GET'), String(notebookId))).json()) as {
      cards: Array<{ id: number; front: string }>;
    };
    const target = listBody.cards.find((card) => card.front === 'E front')!;
    const editRes = await cardsEdit(
      db,
      makeRequest(`http://x/api/cards/${target.id}`, JSON.stringify({ front: 'E front v2' }), token),
      String(target.id)
    );
    expect(editRes.status).toBe(200);
    const delRes = await cardsDelete(db, makeRequest(`http://x/api/cards/${target.id}`, null, token, 'DELETE'), String(target.id));
    expect(delRes.status).toBe(200);
  });

  it('rejects handler access for foreign owners (404)', async () => {
    const list = await cardsList(db, makeRequest(`http://x/api/notebooks/${notebookId}/cards`, null, foreignToken, 'GET'), String(notebookId));
    expect(list.status).toBe(404);
    const add = await cardsAdd(db, makeRequest(`http://x/api/notebooks/${notebookId}/cards`, JSON.stringify({ front: 'x', back: 'x' }), foreignToken), String(notebookId));
    expect(add.status).toBe(404);
    const del = await cardsDelete(db, makeRequest(`http://x/api/cards/1`, null, foreignToken, 'DELETE'), '1');
    expect(del.status).toBe(404);
  });

  it('rejects a source id that belongs to another notebook', async () => {
    const generate = await cardsGenerate(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards/generate`,
        JSON.stringify({ sources: [{ sourceId: foreignSourceId }] }),
        token
      ),
      String(notebookId),
      {
        resolveLlmKey: async () => 'mock-key',
        completeBatch: async () => JSON.stringify([{ front: 'Leaked', back: 'Leaked' }])
      }
    );
    expect(generate.status).toBe(404);

    const add = await cardsAdd(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards`,
        JSON.stringify({ front: 'x', back: 'x', sourceId: foreignSourceId }),
        token
      ),
      String(notebookId)
    );
    expect(add.status).toBe(404);
  });

  it('cardsGenerate returns drafts without writing cards and uses one call', async () => {
    let calls = 0;
    const prompts: string[] = [];
    const generate = async (_key: string, _system: string, prompt: string): Promise<string> => {
      calls += 1;
      prompts.push(prompt);
      return JSON.stringify([
        { front: 'G1', back: 'B1' },
        { front: 'G2', back: 'B2' },
        { front: 'G3', back: 'B3' }
      ]);
    };
    const res = await cardsGenerate(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards/generate`,
        JSON.stringify({ sources: [{ sourceId }] }),
        token
      ),
      String(notebookId),
      { completeBatch: generate, resolveLlmKey: async () => 'mock-key' }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      drafts: Array<{ front: string; sourceId: number | null }>;
      skippedDuplicates: number;
      sourceSummary: string;
    };
    expect(body.drafts.map((draft) => draft.front)).toEqual(['G1', 'G2', 'G3']);
    expect(body.drafts.every((draft) => draft.sourceId === sourceId)).toBe(true);
    expect(body.skippedDuplicates).toBe(0);
    expect(body.sourceSummary).toContain('Biology notes');
    expect(calls).toBe(1);
    expect(prompts[0]).toContain('Photosynthesis');

    const listBody = (await (await cardsList(db, makeRequest(`http://x/api/notebooks/${notebookId}/cards`, null, token, 'GET'), String(notebookId))).json()) as {
      cards: Array<{ front: string }>;
    };
    expect(listBody.cards.map((card) => card.front)).not.toContain('G1');
  });

  it('deduplicates in-batch and against existing notebook cards', async () => {
    await cardsAdd(
      db,
      makeRequest(`http://x/api/notebooks/${notebookId}/cards`, JSON.stringify({ front: 'Dup front', back: 'Existing' }), token),
      String(notebookId)
    );
    const res = await cardsGenerate(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards/generate`,
        JSON.stringify({ sources: [{ sourceId }] }),
        token
      ),
      String(notebookId),
      {
        resolveLlmKey: async () => 'mock-key',
        completeBatch: async () =>
          JSON.stringify([
            { front: 'DUP front!', back: 'Existing copy' },
            { front: 'dup   front', back: 'Another copy' },
            { front: 'Fresh card', back: 'Fresh back' }
          ])
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      drafts: Array<{ front: string }>;
      skippedDuplicates: number;
    };
    expect(body.drafts.map((draft) => draft.front)).toEqual(['Fresh card']);
    expect(body.skippedDuplicates).toBe(2);
  });

  it('retries once on malformed JSON then 502', async () => {
    let calls = 0;
    const mock = async (): Promise<string> => {
      calls += 1;
      return calls === 1 ? 'not-json' : '{broken';
    };
    const res = await cardsGenerate(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards/generate`,
        JSON.stringify({ sources: [{ sourceId }] }),
        token
      ),
      String(notebookId),
      { resolveLlmKey: async () => 'mock-key', completeBatch: mock }
    );
    expect(res.status).toBe(502);
    expect(calls).toBe(2);
  });

  it('answers 400 when no source is selected', async () => {
    const res = await cardsGenerate(
      db,
      makeRequest(`http://x/api/notebooks/${notebookId}/cards/generate`, JSON.stringify({}), token),
      String(notebookId),
      { completeBatch: async () => '[]' }
    );
    expect(res.status).toBe(400);
  });

  it('answers 503 without a key', async () => {
    const res = await cardsGenerate(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards/generate`,
        JSON.stringify({ sources: [{ sourceId }] }),
        token
      ),
      String(notebookId),
      { resolveLlmKey: async () => null }
    );
    expect(res.status).toBe(503);
  });

  it('clamps the requested card count to 20', async () => {
    const many = Array.from({ length: 25 }, (_, index) => ({ front: `C${index}`, back: `B${index}` }));
    const res = await cardsGenerate(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards/generate`,
        JSON.stringify({ sources: [{ sourceId }], count: 50 }),
        token
      ),
      String(notebookId),
      { resolveLlmKey: async () => 'mock-key', completeBatch: async () => JSON.stringify(many) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { drafts: unknown[] };
    expect(body.drafts).toHaveLength(20);
  });

  it('uses only the selected page range and clamps a too-wide range', async () => {
    const prompts: string[] = [];
    const res = await cardsGenerate(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards/generate`,
        JSON.stringify({ sources: [{ sourceId: pagedSourceId, from: 1, to: 1 }] }),
        token
      ),
      String(notebookId),
      {
        resolveLlmKey: async () => 'mock-key',
        completeBatch: async (_key, _system, prompt) => {
          prompts.push(prompt);
          return JSON.stringify([{ front: 'Paged card', back: 'Answer' }]);
        }
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sourceSummary: string };
    expect(body.sourceSummary).toContain('Paged slides · pp. 1–1');
    expect(prompts[0]).toContain('Chlorophyll');
    expect(prompts[0]).not.toContain('RuBisCO');

    const clamped = await cardsGenerate(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards/generate`,
        JSON.stringify({ sources: [{ sourceId: pagedSourceId, from: 1, to: 99 }] }),
        token
      ),
      String(notebookId),
      {
        resolveLlmKey: async () => 'mock-key',
        completeBatch: async () => JSON.stringify([{ front: 'Clamped card', back: 'Answer' }])
      }
    );
    expect(clamped.status).toBe(200);
    const clampedBody = (await clamped.json()) as { sourceSummary: string };
    expect(clampedBody.sourceSummary).toContain('Paged slides · pp. 1–2');
  });

  it('rejects page ranges on sources without page information', async () => {
    const res = await cardsGenerate(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards/generate`,
        JSON.stringify({ sources: [{ sourceId, from: 1, to: 1 }] }),
        token
      ),
      String(notebookId),
      { resolveLlmKey: async () => 'mock-key', completeBatch: async () => '[]' }
    );
    expect(res.status).toBe(400);
  });

  it('scopes the focus FTS filter to the selected sources', async () => {
    const prompts: string[] = [];
    const res = await cardsGenerate(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards/generate`,
        JSON.stringify({ sources: [{ sourceId: pagedSourceId }], focus: 'photosynthesis' }),
        token
      ),
      String(notebookId),
      {
        resolveLlmKey: async () => 'mock-key',
        completeBatch: async (_key, _system, prompt) => {
          prompts.push(prompt);
          return JSON.stringify([{ front: 'Focused card', back: 'Answer' }]);
        }
      }
    );
    expect(res.status).toBe(200);
    expect(prompts[0]).not.toContain('Photosynthesis converts');
    expect(prompts[0]).toContain('Focus instruction: photosynthesis');
  });
});

describe('stratified generation sampling', () => {
  it('covers the start, middle, and end of a source', () => {
    const candidates = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      text: `chunk-${index}-${'x'.repeat(400)}`
    }));
    const picked = stratifiedSample(candidates, new Set(), 5000);
    const ids = picked.map((chunk) => chunk.id);
    expect(ids).toContain(1);
    expect(ids.some((id) => id > 10 && id < 20)).toBe(true);
    expect(ids.some((id) => id > 24)).toBe(true);
  });

  it('prefers focus hits within each stratum', () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      text: `chunk-${index}-${'x'.repeat(200)}`
    }));
    const picked = stratifiedSample(candidates, new Set([2, 5, 9]), 1200);
    expect(picked.map((chunk) => chunk.id)).toEqual(expect.arrayContaining([2, 5, 9]));
  });
});

describe('card batch commit', () => {
  let db: Client;
  let userId: number;
  let token: string;
  let notebookId: number;
  let sourceId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-batch-')), 'batch.db'));
    await applySchema(db);
    const user = await createUser(db, { email: 'batch@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    userId = user.id;
    token = await createSession(db, userId);
    notebookId = (await createNotebook(db, userId, 'Batch notebook')).id;
    sourceId = (await ingestTextSource(db, {
      notebookId,
      title: 'Batch source',
      text: 'Batch material about cell membranes and diffusion.'
    })).id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates a batch, its cards, and their reviews atomically', async () => {
    const res = await cardsBatchAdd(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards/batch`,
        JSON.stringify({
          cards: [
            { front: 'What is diffusion?', back: 'Movement down a concentration gradient.', sourceId },
            { front: 'What is a membrane?', back: 'A selective barrier.' }
          ],
          sourceSummary: 'Batch source · pp. 1–2',
          focus: 'membranes'
        }),
        token
      ),
      String(notebookId)
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      created: number;
      batch: { id: number; cardCount: number; sourceSummary: string; focus: string | null };
    };
    expect(body.created).toBe(2);
    expect(body.batch.cardCount).toBe(2);
    expect(body.batch.sourceSummary).toBe('Batch source · pp. 1–2');
    expect(body.batch.focus).toBe('membranes');

    const cards = await listCardsWithReview(db, notebookId);
    expect(cards).toHaveLength(2);
    expect(cards.every((card) => card.batchId === body.batch.id)).toBe(true);
    expect(cards.every((card) => card.batchSourceSummary === 'Batch source · pp. 1–2')).toBe(true);
    const reviews = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM reviews', args: [] });
    expect(Number(reviews.rows[0]!.n)).toBe(2);
    const batches = await listCardBatches(db, notebookId);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.cardCount).toBe(2);
  });

  it('validates card limits, count, and ownership', async () => {
    const tooMany = Array.from({ length: 31 }, (_, index) => ({ front: `F${index}`, back: `B${index}` }));
    const manyRes = await cardsBatchAdd(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards/batch`,
        JSON.stringify({ cards: tooMany, sourceSummary: 'Too many' }),
        token
      ),
      String(notebookId)
    );
    expect(manyRes.status).toBe(400);

    const emptyRes = await cardsBatchAdd(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards/batch`,
        JSON.stringify({ cards: [], sourceSummary: 'Empty' }),
        token
      ),
      String(notebookId)
    );
    expect(emptyRes.status).toBe(400);

    const longRes = await cardsBatchAdd(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards/batch`,
        JSON.stringify({
          cards: [{ front: 'x'.repeat(301), back: 'ok' }],
          sourceSummary: 'Long front'
        }),
        token
      ),
      String(notebookId)
    );
    expect(longRes.status).toBe(400);

    const foreignRes = await cardsBatchAdd(
      db,
      makeRequest(
        `http://x/api/notebooks/${notebookId}/cards/batch`,
        JSON.stringify({
          cards: [{ front: 'F', back: 'B', sourceId: 99999 }],
          sourceSummary: 'Foreign'
        }),
        token
      ),
      String(notebookId)
    );
    expect(foreignRes.status).toBe(404);
  });

  it('keeps cards when a batch is deleted and removes batches with the notebook', async () => {
    const cards = await listCardsWithReview(db, notebookId);
    const batchId = cards[0]!.batchId!;
    await db.execute({ sql: 'DELETE FROM card_batches WHERE id = ?', args: [batchId] });
    const afterDelete = await listCardsWithReview(db, notebookId);
    expect(afterDelete).toHaveLength(2);
    expect(afterDelete.every((card) => card.batchId == null)).toBe(true);

    await db.execute({ sql: 'DELETE FROM notebooks WHERE id = ?', args: [notebookId] });
    const batches = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM card_batches', args: [] });
    expect(Number(batches.rows[0]!.n)).toBe(0);
  });
});

describe('front normalization', () => {
  it('ignores case, punctuation, and whitespace differences', () => {
    expect(normalizeFront('  What is   ATP?! ')).toBe(normalizeFront('what is atp'));
  });
});
