import type { Client } from '@libsql/client';
import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from './auth';
import { ownNotebook } from './notebooks';
import { searchChunks } from './ingest/ingest';
import { resolveLlmKey } from './chat';
import { applyGrade, fromReviewRow, newReview, toReviewColumns, type StoredReview } from './fsrs';

export const MAX_GENERATE_CARDS = 10;
export const FRONT_MAX = 300;
export const BACK_MAX = 2000;

export interface CardRow {
  id: number;
  notebookId: number;
  sourceId: number | null;
  front: string;
  back: string;
  createdAt: string;
}

export interface QueuedCard {
  cardId: number;
  front: string;
  back: string;
  due: Date;
  state: number;
  stability: number;
}

const CARD_COLUMNS = 'id, notebook_id, source_id, front, back, created_at';

function rowToCard(row: Record<string, unknown>): CardRow {
  return {
    id: Number(row.id),
    notebookId: Number(row.notebook_id),
    sourceId: row.source_id == null ? null : Number(row.source_id),
    front: String(row.front),
    back: String(row.back),
    createdAt: String(row.created_at)
  };
}

export async function createCard(
  db: Client,
  notebookId: number,
  input: { sourceId?: number | null; front: string; back: string; createdAt?: Date }
): Promise<CardRow> {
  const createdAt = input.createdAt ?? new Date();
  const createdAtIso = createdAt.toISOString();
  const result = await db.execute({
    sql: 'INSERT INTO cards (notebook_id, source_id, front, back, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [notebookId, input.sourceId ?? null, input.front, input.back, createdAtIso]
  });
  const cardId = Number(result.lastInsertRowid);
  const review = newReview(createdAt);
  await insertReviewRow(db, cardId, review);
  return { id: cardId, notebookId, sourceId: input.sourceId ?? null, front: input.front, back: input.back, createdAt: createdAtIso };
}

async function insertReviewRow(db: Client, cardId: number, review: StoredReview): Promise<void> {
  const columns = toReviewColumns(review);
  await db.execute({
    sql: `INSERT INTO reviews (card_id, due, stability, difficulty, reps, lapses, state, last_graded, fsrs_meta)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [cardId, columns.due, columns.stability, columns.difficulty, columns.reps, columns.lapses, columns.state, columns.last_graded, columns.fsrs_meta]
  });
}

export async function listCards(db: Client, notebookId: number): Promise<CardRow[]> {
  const result = await db.execute({
    sql: `SELECT ${CARD_COLUMNS} FROM cards WHERE notebook_id = ? ORDER BY created_at DESC, id DESC`,
    args: [notebookId]
  });
  return result.rows.map(rowToCard);
}

export async function cardOwned(db: Client, userId: number, cardId: number): Promise<CardRow | null> {
  if (!Number.isInteger(cardId)) {
    return null;
  }
  const result = await db.execute({
    sql: `SELECT c.id AS id, c.notebook_id AS notebook_id, c.source_id AS source_id, c.front AS front, c.back AS back, c.created_at AS created_at
          FROM cards c JOIN notebooks nb ON nb.id = c.notebook_id
          WHERE c.id = ? AND nb.user_id = ?`,
    args: [cardId, userId]
  });
  const row = result.rows[0];
  return row ? rowToCard(row) : null;
}

export async function updateCard(
  db: Client,
  userId: number,
  cardId: number,
  patch: { front?: string; back?: string }
): Promise<CardRow | null> {
  const owned = await cardOwned(db, userId, cardId);
  if (!owned) {
    return null;
  }
  await db.execute({
    sql: 'UPDATE cards SET front = ?, back = ? WHERE id = ?',
    args: [patch.front ?? owned.front, patch.back ?? owned.back, cardId]
  });
  return cardOwned(db, userId, cardId);
}

export async function deleteCard(db: Client, userId: number, cardId: number): Promise<boolean> {
  const owned = await cardOwned(db, userId, cardId);
  if (!owned) {
    return false;
  }
  await db.execute({ sql: 'DELETE FROM cards WHERE id = ?', args: [cardId] });
  return true;
}

export async function dueQueue(db: Client, notebookId: number, now: Date): Promise<QueuedCard[]> {
  const result = await db.execute({
    sql: `SELECT c.id AS card_id, c.front, c.back, r.due, r.stability, r.state, r.reps, r.lapses, r.last_graded, r.fsrs_meta
          FROM reviews r JOIN cards c ON c.id = r.card_id
          WHERE c.notebook_id = ? AND r.due <= ?
          ORDER BY r.due ASC`,
    args: [notebookId, now.toISOString()]
  });
  return result.rows.map((row) => {
    const cardId = Number(row.card_id);
    const review = fromReviewRow({
      due: String(row.due),
      stability: Number(row.stability),
      difficulty: 0,
      reps: Number(row.reps),
      lapses: Number(row.lapses),
      state: Number(row.state),
      last_graded: row.last_graded == null ? null : String(row.last_graded),
      fsrs_meta: row.fsrs_meta == null ? null : String(row.fsrs_meta)
    });
    return {
      cardId,
      front: String(row.front),
      back: String(row.back),
      due: review.due,
      state: review.state,
      stability: review.stability
    };
  });
}

export interface GradedCard {
  cardId: number;
  due: Date;
  state: number;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastGraded: Date | null;
}

export async function gradeCard(
  db: Client,
  cardId: number,
  rating: 1 | 2 | 3 | 4,
  now: Date
): Promise<GradedCard> {
  const result = await db.execute({
    sql: 'SELECT due, stability, difficulty, reps, lapses, state, last_graded, fsrs_meta FROM reviews WHERE card_id = ?',
    args: [cardId]
  });
  const row = result.rows[0];
  if (!row) {
    throw Object.assign(new Error('review row missing for card'), { code: 'REVIEW_MISSING' });
  }
  const current = fromReviewRow({
    due: String(row.due),
    stability: Number(row.stability),
    difficulty: Number(row.difficulty),
    reps: Number(row.reps),
    lapses: Number(row.lapses),
    state: Number(row.state),
    last_graded: row.last_graded == null ? null : String(row.last_graded),
    fsrs_meta: row.fsrs_meta == null ? null : String(row.fsrs_meta)
  });
  const graded = applyGrade(current, rating, now);
  const columns = toReviewColumns(graded);
  await db.execute({
    sql: `UPDATE reviews SET due = ?, stability = ?, difficulty = ?, reps = ?, lapses = ?, state = ?, last_graded = ?, fsrs_meta = ?
          WHERE card_id = ?`,
    args: [columns.due, columns.stability, columns.difficulty, columns.reps, columns.lapses, columns.state, columns.last_graded, columns.fsrs_meta, cardId]
  });
  await db.execute({
    sql: 'INSERT INTO review_log (card_id, rating, graded_at) VALUES (?, ?, ?)',
    args: [cardId, rating, now.toISOString()]
  });
  return {
    cardId,
    due: graded.due,
    state: graded.state,
    stability: graded.stability,
    difficulty: graded.difficulty,
    reps: graded.reps,
    lapses: graded.lapses,
    lastGraded: graded.lastGraded
  };
}

export async function streakDays(db: Client, notebookId: number, now: Date): Promise<number> {
  const result = await db.execute({
    sql: `SELECT DISTINCT substr(r.graded_at, 1, 10) AS day FROM review_log r
          JOIN cards c ON c.id = r.card_id
          JOIN notebooks nb ON nb.id = c.notebook_id
          WHERE nb.id = ? AND date(r.graded_at) <= date(?)
          ORDER BY day DESC`,
    args: [notebookId, now.toISOString()]
  });
  const days = result.rows.map((row) => String(row.day));
  if (days.length === 0) {
    return 0;
  }
  let streak = 0;
  const cursor = new Date(now.toISOString().slice(0, 10) + 'T00:00:00.000Z');
  for (const day of days) {
    const expected = cursor.toISOString().slice(0, 10);
    if (day === expected) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      continue;
    }
    if (streak === 0 && day < expected) {
      break;
    }
    break;
  }
  return streak;
}

function validationError(code: string, message: string, status: number): Error {
  return Object.assign(new Error(message), { code, status });
}

const GENERATE_SYSTEM = [
  'You generate flashcards for a study app from study material.',
  'Reply with ONLY a JSON array, no markdown, no commentary: [{"front": "...", "back": "..."}].',
  `Produce at most ${MAX_GENERATE_CARDS} cards.`,
  'Each front is a concise question (max 120 chars); each back is a precise answer they could write in (max 240 chars).',
  'Cover distinct facts; never repeat a front. Use only the provided material.'
].join('\n');

interface GenerateBatchDeps {
  resolveLlmKey?: typeof resolveLlmKey;
  completeBatch?: (apiKey: string, system: string, user: string) => Promise<string>;
}

function parseBatchCards(raw: string): Array<{ front: string; back: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const cards: Array<{ front: string; back: string }> = [];
  for (const item of parsed) {
    const front = typeof (item as { front?: unknown })?.front === 'string' ? (item as { front: string }).front.trim() : '';
    const back = typeof (item as { back?: unknown })?.back === 'string' ? (item as { back: string }).back.trim() : '';
    if (front.length > 0 && back.length > 0) {
      cards.push({ front, back });
    }
    if (cards.length >= MAX_GENERATE_CARDS) {
      break;
    }
  }
  return cards;
}

async function buildGenerationContext(db: Client, notebookId: number, topic: string | null, sourceId: number | null): Promise<string | null> {
  if (sourceId != null && Number.isInteger(sourceId)) {
    const result = await db.execute({
      sql: 'SELECT text FROM source_chunks WHERE source_id = ? ORDER BY ord LIMIT 12',
      args: [sourceId]
    });
    const text = result.rows.map((row) => String(row.text)).join('\n\n').slice(0, 8000);
    return text.length > 0 ? text : null;
  }
  if (topic) {
    const hits = await searchChunks(db, notebookId, topic, 8);
    const text = hits.map((hit) => hit.text).join('\n\n').slice(0, 8000);
    return text.length > 0 ? text : null;
  }
  return null;
}

export async function cardsGenerate(
  db: Client,
  req: Request,
  idRaw: string,
  deps: GenerateBatchDeps = {}
): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const notebookId = Number(idRaw);
    const notebook = Number.isInteger(notebookId) ? await ownNotebook(db, user.id, notebookId) : null;
    if (!notebook) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }

    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const body = parsedBody as { topic?: unknown; sourceId?: unknown };
    const topic = typeof body.topic === 'string' && body.topic.trim().length > 0 ? body.topic.trim() : null;
    const sourceId = typeof body.sourceId === 'number' && Number.isInteger(body.sourceId) ? body.sourceId : null;
    if (!topic && sourceId == null) {
      return NextResponse.json({ error: 'topic or sourceId is required' }, { status: 400 });
    }

    const resolveKey = deps.resolveLlmKey ?? resolveLlmKey;
    const apiKey = await resolveKey(db, user.id);
    if (!apiKey) {
      return NextResponse.json(
        { error: 'No LLM key is configured. The owner can set GROQ_API_KEY, or you can add a personal key in Settings.' },
        { status: 503 }
      );
    }

    const context = await buildGenerationContext(db, notebookId, topic, sourceId);
    if (context === null) {
      return NextResponse.json(
        { error: 'no source material found for that topic' },
        { status: 400 }
      );
    }
    const userPrompt = `Material:\n${context}\n\nGenerate up to ${MAX_GENERATE_CARDS} flashcards${topic ? ` about: ${topic}` : ''}.`;

    const complete = deps.completeBatch ?? (async (key: string, system: string, prompt: string) => groqBatch(key, system, prompt));
    let cards = parseBatchCards(await complete(apiKey, GENERATE_SYSTEM, userPrompt));
    if (cards.length === 0) {
      cards = parseBatchCards(await complete(apiKey, `${GENERATE_SYSTEM}\nYour previous reply was not a bare JSON array. Reply with ONLY the JSON array now.`, userPrompt));
    }
    if (cards.length === 0) {
      throw validationError('GENERATION_INVALID', 'the model did not return usable cards', 502);
    }

    let created = 0;
    for (const card of cards) {
      await createCard(db, notebookId, {
        sourceId: sourceId ?? null,
        front: card.front.slice(0, FRONT_MAX),
        back: card.back.slice(0, BACK_MAX)
      });
      created += 1;
    }
    return NextResponse.json({ created }, { status: 201 });
  } catch (error) {
    const known = error as { code?: string };
    if (known.code === 'GENERATION_INVALID') {
      return NextResponse.json({ error: 'the model did not return usable cards' }, { status: 502 });
    }
    return errorResponse(error);
  }
}

async function groqBatch(apiKey: string, system: string, user: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b',
      temperature: 0.4,
      max_tokens: 2000,
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
}

const ADD_LIMITS = { front: FRONT_MAX, back: BACK_MAX };

export async function cardsAdd(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const notebookId = Number(idRaw);
    const notebook = Number.isInteger(notebookId) ? await ownNotebook(db, user.id, notebookId) : null;
    if (!notebook) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const body = parsedBody as { front?: unknown; back?: unknown; sourceId?: unknown };
    const front = typeof body.front === 'string' ? body.front.trim() : '';
    const back = typeof body.back === 'string' ? body.back.trim() : '';
    if (front.length === 0 || front.length > ADD_LIMITS.front || back.length === 0 || back.length > ADD_LIMITS.back) {
      return NextResponse.json(
        { error: `front (1-${ADD_LIMITS.front}) and back (1-${ADD_LIMITS.back}) are required` },
        { status: 400 }
      );
    }
    const sourceId = typeof body.sourceId === 'number' && Number.isInteger(body.sourceId) ? body.sourceId : null;
    const card = await createCard(db, notebookId, { sourceId, front, back });
    return NextResponse.json(card, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function cardsList(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const notebookId = Number(idRaw);
    const notebook = Number.isInteger(notebookId) ? await ownNotebook(db, user.id, notebookId) : null;
    if (!notebook) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    const cards = await listCards(db, notebookId);
    return NextResponse.json({ cards });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function cardsDue(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const notebookId = Number(idRaw);
    const notebook = Number.isInteger(notebookId) ? await ownNotebook(db, user.id, notebookId) : null;
    if (!notebook) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    const url = new URL(req.url);
    const atParam = url.searchParams.get('at');
    const at = atParam ? new Date(atParam) : new Date();
    if (Number.isNaN(at.getTime())) {
      return NextResponse.json({ error: 'invalid at timestamp' }, { status: 400 });
    }
    const cards = await dueQueue(db, notebookId, at);
    return NextResponse.json({ cards, streak: await streakDays(db, notebookId, at) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function cardsEdit(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const cardId = Number(idRaw);
    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const body = parsedBody as { front?: unknown; back?: unknown };
    const patch: { front?: string; back?: string } = {};
    if (typeof body.front === 'string') {
      const front = body.front.trim();
      if (front.length === 0 || front.length > ADD_LIMITS.front) {
        return NextResponse.json({ error: `front must be 1-${ADD_LIMITS.front} characters` }, { status: 400 });
      }
      patch.front = front;
    }
    if (typeof body.back === 'string') {
      const back = body.back.trim();
      if (back.length === 0 || back.length > ADD_LIMITS.back) {
        return NextResponse.json({ error: `back must be 1-${ADD_LIMITS.back} characters` }, { status: 400 });
      }
      patch.back = back;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
    }
    const card = await updateCard(db, user.id, cardId, patch);
    if (!card) {
      return NextResponse.json({ error: 'unknown card' }, { status: 404 });
    }
    return NextResponse.json(card);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function cardsDelete(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const cardId = Number(idRaw);
    const deleted = await deleteCard(db, user.id, cardId);
    if (!deleted) {
      return NextResponse.json({ error: 'unknown card' }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function cardsGrade(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const cardId = Number(idRaw);
    const owned = await cardOwned(db, user.id, cardId);
    if (!owned) {
      return NextResponse.json({ error: 'unknown card' }, { status: 404 });
    }
    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const rating = (parsedBody as { rating?: unknown }).rating;
    if (typeof rating !== 'number' || rating < 1 || rating > 4 || !Number.isInteger(rating)) {
      return NextResponse.json({ error: 'rating must be 1-4 (again to easy)' }, { status: 400 });
    }
    const graded = await gradeCard(db, cardId, rating as 1 | 2 | 3 | 4, new Date());
    return NextResponse.json({ ...graded, due: graded.due.toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}
