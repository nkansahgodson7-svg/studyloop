import type { Client } from '@libsql/client';
import { NextResponse } from 'next/server';
import { errorResponse, HttpError, requireUser } from './auth';
import { ownNotebook } from './notebooks';
import { searchChunksInSources, sourceInNotebook } from './ingest/ingest';
import { resolveLlmKey } from './chat';
import { LLM_GENERATE_LIMIT, rateLimitResponse } from './ratelimit';
import { applyGrade, fromReviewRow, newReview, toReviewColumns, type StoredReview } from './fsrs';

export const MIN_GENERATE_CARDS = 1;
export const MAX_GENERATE_CARDS = 20;
export const DEFAULT_GENERATE_CARDS = 10;
export const MAX_BATCH_CARDS = 30;
export const FRONT_MAX = 300;
export const BACK_MAX = 2000;
export const FOCUS_MAX = 1000;
export const SOURCE_SUMMARY_MAX = 1000;
export const GENERATION_BUDGET = 12_000;

export interface CardRow {
  id: number;
  notebookId: number;
  sourceId: number | null;
  batchId?: number | null;
  batchCreatedAt?: string | null;
  batchSourceSummary?: string | null;
  front: string;
  back: string;
  createdAt: string;
  generatedAt?: string | null;
}

export interface CardBatchSummary {
  id: number;
  createdAt: string;
  sourceSummary: string;
  focus: string | null;
  cardCount: number;
}

export interface QueuedCard {
  cardId: number;
  front: string;
  back: string;
  due: Date;
  state: number;
  stability: number;
}

const CARD_COLUMNS = 'id, notebook_id, source_id, batch_id, front, back, created_at, generated_at';

function rowToCard(row: Record<string, unknown>): CardRow {
  return {
    id: Number(row.id),
    notebookId: Number(row.notebook_id),
    sourceId: row.source_id == null ? null : Number(row.source_id),
    batchId: row.batch_id == null ? null : Number(row.batch_id),
    front: String(row.front),
    back: String(row.back),
    createdAt: String(row.created_at),
    generatedAt: row.generated_at == null ? null : String(row.generated_at)
  };
}

export async function createCard(
  db: Client,
  notebookId: number,
  input: {
    sourceId?: number | null;
    batchId?: number | null;
    front: string;
    back: string;
    createdAt?: Date;
    generated?: boolean;
  }
): Promise<CardRow> {
  const createdAt = input.createdAt ?? new Date();
  const createdAtIso = createdAt.toISOString();
  const result = await db.execute({
    sql: `INSERT INTO cards (notebook_id, source_id, batch_id, front, back, created_at, generated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      notebookId,
      input.sourceId ?? null,
      input.batchId ?? null,
      input.front,
      input.back,
      createdAtIso,
      input.generated ? createdAtIso : null
    ]
  });
  const cardId = Number(result.lastInsertRowid);
  const review = newReview(createdAt);
  await insertReviewRow(db, cardId, review);
  return {
    id: cardId,
    notebookId,
    sourceId: input.sourceId ?? null,
    batchId: input.batchId ?? null,
    front: input.front,
    back: input.back,
    createdAt: createdAtIso,
    generatedAt: input.generated ? createdAtIso : null
  };
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

export interface CardWithReview extends CardRow {
  due: string;
  state: number;
  stability: number;
}

export async function listCardsWithReview(db: Client, notebookId: number): Promise<CardWithReview[]> {
  const result = await db.execute({
    sql: `SELECT c.id, c.notebook_id, c.source_id, c.batch_id, c.front, c.back, c.created_at, c.generated_at,
                 cb.created_at AS batch_created_at, cb.source_summary AS batch_source_summary,
                 r.due, r.state, r.stability
          FROM cards c
          JOIN reviews r ON r.card_id = c.id
          LEFT JOIN card_batches cb ON cb.id = c.batch_id
          WHERE c.notebook_id = ?
          ORDER BY c.created_at DESC, c.id DESC`,
    args: [notebookId]
  });
  return result.rows.map((row) => ({
    id: Number(row.id),
    notebookId: Number(row.notebook_id),
    sourceId: row.source_id == null ? null : Number(row.source_id),
    batchId: row.batch_id == null ? null : Number(row.batch_id),
    batchCreatedAt: row.batch_created_at == null ? null : String(row.batch_created_at),
    batchSourceSummary: row.batch_source_summary == null ? null : String(row.batch_source_summary),
    front: String(row.front),
    back: String(row.back),
    createdAt: String(row.created_at),
    generatedAt: row.generated_at == null ? null : String(row.generated_at),
    due: String(row.due),
    state: Number(row.state),
    stability: Number(row.stability)
  }));
}

export async function listCardBatches(db: Client, notebookId: number): Promise<CardBatchSummary[]> {
  const result = await db.execute({
    sql: `SELECT id, created_at, source_summary, focus, card_count
          FROM card_batches
          WHERE notebook_id = ?
          ORDER BY created_at DESC, id DESC`,
    args: [notebookId]
  });
  return result.rows.map((row) => ({
    id: Number(row.id),
    createdAt: String(row.created_at),
    sourceSummary: String(row.source_summary),
    focus: row.focus == null ? null : String(row.focus),
    cardCount: Number(row.card_count)
  }));
}

export async function cardOwned(db: Client, userId: number, cardId: number): Promise<CardRow | null> {
  if (!Number.isInteger(cardId)) {
    return null;
  }
  const result = await db.execute({
    sql: `SELECT c.id AS id, c.notebook_id AS notebook_id, c.source_id AS source_id, c.batch_id AS batch_id,
                 c.front AS front, c.back AS back, c.created_at AS created_at, c.generated_at AS generated_at
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

export function streakFromDays(days: string[], now: Date): number {
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

async function streakDaysFor(db: Client, where: string, arg: number, now: Date): Promise<number> {
  const result = await db.execute({
    sql: `SELECT DISTINCT substr(r.graded_at, 1, 10) AS day FROM review_log r
          JOIN cards c ON c.id = r.card_id
          JOIN notebooks nb ON nb.id = c.notebook_id
          WHERE ${where} AND date(r.graded_at) <= date(?)
          ORDER BY day DESC`,
    args: [arg, now.toISOString()]
  });
  return streakFromDays(result.rows.map((row) => String(row.day)), now);
}

export async function streakDays(db: Client, notebookId: number, now: Date): Promise<number> {
  return streakDaysFor(db, 'nb.id = ?', notebookId, now);
}

export async function streakDaysForUser(db: Client, userId: number, now: Date): Promise<number> {
  return streakDaysFor(db, 'nb.user_id = ?', userId, now);
}

function validationError(code: string, message: string, status: number): HttpError {
  return new HttpError(status, message, code);
}

const GENERATE_SYSTEM = [
  'You write high-quality spaced-repetition flashcards from study material.',
  'Reply with ONLY a JSON array, no markdown, no commentary: [{"front": "...", "back": "..."}].',
  'Rules:',
  '- Each card tests exactly one atomic fact. Never combine two facts in one card.',
  '- The front must be a question or an imperative prompt (for example "Explain…" or "What…"), never a yes/no question, and at most 90 characters.',
  '- The back is a precise, self-contained answer of at most 240 characters.',
  '- Do not refer to the material, the text, the source, or "the passage"; the card must stand alone.',
  '- Cover distinct facts evenly across all provided sources; do not cluster on the first section.',
  '- Use ONLY facts stated in the provided material. If the material does not support a card, omit it.',
  '- When a focus instruction is present, prioritise it while still covering the selected material.',
  `- Produce no more than ${MAX_GENERATE_CARDS} cards.`
].join('\n');

interface GenerateBatchDeps {
  resolveLlmKey?: typeof resolveLlmKey;
  completeBatch?: (apiKey: string, system: string, user: string) => Promise<string>;
}

interface RequestedGenerationSource {
  sourceId: number;
  fromPage?: number;
  toPage?: number;
}

export interface GenerationSourceSelection {
  sourceId: number;
  title: string;
  fromPage: number | null;
  toPage: number | null;
  minPage: number | null;
  maxPage: number | null;
}

interface GenerationChunk {
  id: number;
  text: string;
  page: number | null;
  ord: number;
}

interface ParsedDraft {
  front: string;
  back: string;
}

export function normalizeFront(front: string): string {
  return front
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pick chunks from every part of the source instead of always taking the first
 * ones. One chunk per stratum is chosen first (focus hits win ties), then the
 * remaining budget is filled round-robin across the strata.
 */
export function stratifiedSample<T extends { id: number; text: string }>(
  candidates: T[],
  focusIds: Set<number>,
  budget: number
): T[] {
  if (candidates.length === 0 || budget <= 0) {
    return [];
  }
  const strataCount = Math.min(candidates.length, Math.max(1, Math.ceil(budget / 1200)));
  const strata: T[][] = [];
  for (let index = 0; index < strataCount; index += 1) {
    const start = Math.floor((index * candidates.length) / strataCount);
    const end = Math.floor(((index + 1) * candidates.length) / strataCount);
    strata.push(candidates.slice(start, end));
  }
  const ordered = (group: T[]): T[] =>
    [...group].sort((a, b) => Number(focusIds.has(b.id)) - Number(focusIds.has(a.id)));

  const picked: T[] = [];
  const pickedIds = new Set<number>();
  let used = 0;
  const take = (chunk: T): boolean => {
    if (pickedIds.has(chunk.id)) {
      return false;
    }
    const cost = chunk.text.length + (picked.length > 0 ? 2 : 0);
    if (used + cost > budget) {
      return false;
    }
    picked.push(chunk);
    pickedIds.add(chunk.id);
    used += cost;
    return true;
  };

  for (const group of strata) {
    for (const chunk of ordered(group)) {
      if (take(chunk)) {
        break;
      }
    }
  }

  let added = true;
  while (added) {
    added = false;
    for (const group of strata) {
      for (const chunk of ordered(group)) {
        if (pickedIds.has(chunk.id)) {
          continue;
        }
        if (take(chunk)) {
          added = true;
          break;
        }
      }
    }
  }

  // A single chunk can be larger than a very small per-source budget. Keep it
  // so the source is represented at all; the caller trims the joined section.
  if (picked.length === 0) {
    picked.push(candidates[0]!);
  }
  return picked;
}

function parseBatchCards(raw: string): ParsedDraft[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const cards: ParsedDraft[] = [];
  for (const item of parsed) {
    const front = typeof (item as { front?: unknown })?.front === 'string' ? (item as { front: string }).front.trim() : '';
    const back = typeof (item as { back?: unknown })?.back === 'string' ? (item as { back: string }).back.trim() : '';
    if (front.length > 0 && back.length > 0) {
      cards.push({ front, back });
    }
    if (cards.length >= MAX_GENERATE_CARDS * 2) {
      break;
    }
  }
  return cards;
}

async function chunksForSelection(db: Client, selection: GenerationSourceSelection): Promise<GenerationChunk[]> {
  if (selection.fromPage != null && selection.toPage != null) {
    const result = await db.execute({
      sql: `SELECT id, text, page, ord FROM source_chunks
            WHERE source_id = ? AND page IS NOT NULL AND page >= ? AND page <= ?
            ORDER BY ord`,
      args: [selection.sourceId, selection.fromPage, selection.toPage]
    });
    return result.rows.map((row) => ({
      id: Number(row.id),
      text: String(row.text),
      page: row.page == null ? null : Number(row.page),
      ord: Number(row.ord)
    }));
  }
  const result = await db.execute({
    sql: 'SELECT id, text, page, ord FROM source_chunks WHERE source_id = ? ORDER BY ord',
    args: [selection.sourceId]
  });
  return result.rows.map((row) => ({
    id: Number(row.id),
    text: String(row.text),
    page: row.page == null ? null : Number(row.page),
    ord: Number(row.ord)
  }));
}

function sourceSummaryFor(selections: GenerationSourceSelection[]): string {
  return selections
    .map((selection) =>
      selection.fromPage != null && selection.toPage != null
        ? `${selection.title} · pp. ${selection.fromPage}–${selection.toPage}`
        : selection.title
    )
    .join(' + ')
    .slice(0, SOURCE_SUMMARY_MAX);
}

async function buildGenerationContext(
  db: Client,
  notebookId: number,
  selections: GenerationSourceSelection[],
  focus: string | null
): Promise<{ context: string; sourceSummary: string } | null> {
  const sourceIds = selections.map((selection) => selection.sourceId);
  const focusIds = new Set<number>();
  if (focus) {
    const hits = await searchChunksInSources(
      db,
      notebookId,
      sourceIds,
      focus,
      Math.min(60, Math.max(20, selections.length * 8))
    );
    for (const hit of hits) {
      focusIds.add(hit.id);
    }
  }

  const overhead = selections.length * 80;
  const perSourceBudget = Math.max(300, Math.floor((GENERATION_BUDGET - overhead) / selections.length));
  const sections: string[] = [];
  for (const selection of selections) {
    const candidates = await chunksForSelection(db, selection);
    if (candidates.length === 0) {
      continue;
    }
    const picked = stratifiedSample(candidates, focusIds, perSourceBudget);
    let text = picked.map((chunk) => chunk.text).join('\n\n');
    if (text.length > perSourceBudget) {
      text = text.slice(0, perSourceBudget).trim();
    }
    if (text.length === 0) {
      continue;
    }
    const header =
      selection.fromPage != null && selection.toPage != null
        ? `[Source: ${selection.title} · pp. ${selection.fromPage}–${selection.toPage}]`
        : `[Source: ${selection.title}]`;
    sections.push(`${header}\n${text}`);
  }
  if (sections.length === 0) {
    return null;
  }
  const context = sections.join('\n\n').slice(0, GENERATION_BUDGET);
  return { context, sourceSummary: sourceSummaryFor(selections) };
}

async function resolveGenerationSelections(
  db: Client,
  notebookId: number,
  requested: RequestedGenerationSource[]
): Promise<GenerationSourceSelection[]> {
  const ids = [...new Set(requested.map((item) => item.sourceId))];
  const placeholders = ids.map(() => '?').join(', ');
  const sourceResult = await db.execute({
    sql: `SELECT id, title FROM sources WHERE notebook_id = ? AND id IN (${placeholders})`,
    args: [notebookId, ...ids]
  });
  const sourceById = new Map<number, string>();
  for (const row of sourceResult.rows) {
    sourceById.set(Number(row.id), String(row.title));
  }

  const spanResult = await db.execute({
    sql: `SELECT source_id, MIN(page) AS min_page, MAX(page) AS max_page
          FROM source_chunks
          WHERE source_id IN (${placeholders}) AND page IS NOT NULL
          GROUP BY source_id`,
    args: ids
  });
  const spanBySource = new Map<number, { minPage: number; maxPage: number }>();
  for (const row of spanResult.rows) {
    spanBySource.set(Number(row.source_id), {
      minPage: Number(row.min_page),
      maxPage: Number(row.max_page)
    });
  }

  const selections: GenerationSourceSelection[] = [];
  const seen = new Set<number>();
  for (const item of requested) {
    if (seen.has(item.sourceId)) {
      continue;
    }
    seen.add(item.sourceId);
    const title = sourceById.get(item.sourceId);
    if (title == null) {
      throw validationError('UNKNOWN_SOURCE', 'unknown source', 404);
    }
    const span = spanBySource.get(item.sourceId);
    const hasRange = item.fromPage !== undefined || item.toPage !== undefined;
    if (hasRange && !span) {
      throw validationError(
        'PAGE_RANGE_UNAVAILABLE',
        'page ranges are only available for paginated sources',
        400
      );
    }
    if (!span) {
      selections.push({
        sourceId: item.sourceId,
        title,
        fromPage: null,
        toPage: null,
        minPage: null,
        maxPage: null
      });
      continue;
    }
    if (hasRange && item.fromPage !== undefined && item.toPage !== undefined && item.fromPage > item.toPage) {
      throw validationError('INVALID_PAGE_RANGE', 'from page must be before to page', 400);
    }
    let fromPage = item.fromPage ?? span.minPage;
    let toPage = item.toPage ?? span.maxPage;
    if (!Number.isInteger(fromPage) || !Number.isInteger(toPage) || fromPage < 1 || toPage < 1) {
      throw validationError('INVALID_PAGE_RANGE', 'page numbers must be positive integers', 400);
    }
    if (fromPage > span.maxPage || toPage < span.minPage) {
      throw validationError('INVALID_PAGE_RANGE', 'page range is outside this source', 400);
    }
    fromPage = Math.max(fromPage, span.minPage);
    toPage = Math.min(toPage, span.maxPage);
    if (fromPage > toPage) {
      throw validationError('INVALID_PAGE_RANGE', 'from page must be before to page', 400);
    }
    selections.push({
      sourceId: item.sourceId,
      title,
      fromPage,
      toPage,
      minPage: span.minPage,
      maxPage: span.maxPage
    });
  }
  return selections;
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

    // Generation spends LLM tokens; gate before parsing the body.
    const limited = await rateLimitResponse(db, `cards-generate:${user.id}`, LLM_GENERATE_LIMIT);
    if (limited) {
      return limited;
    }

    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const body = parsedBody as { sources?: unknown; count?: unknown; focus?: unknown };
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

    let count = DEFAULT_GENERATE_CARDS;
    if (body.count !== undefined) {
      if (typeof body.count !== 'number' || !Number.isFinite(body.count)) {
        return NextResponse.json({ error: 'count must be a number' }, { status: 400 });
      }
      count = Math.min(MAX_GENERATE_CARDS, Math.max(MIN_GENERATE_CARDS, Math.floor(body.count)));
    }
    if (body.focus !== undefined && typeof body.focus !== 'string') {
      return NextResponse.json({ error: 'focus must be text' }, { status: 400 });
    }
    const focus = typeof body.focus === 'string' ? body.focus.trim() : '';
    if (focus.length > FOCUS_MAX) {
      return NextResponse.json({ error: `focus must be at most ${FOCUS_MAX} characters` }, { status: 400 });
    }

    const selections = await resolveGenerationSelections(db, notebookId, requested);
    const resolveKey = deps.resolveLlmKey ?? resolveLlmKey;
    const apiKey = await resolveKey(db, user.id);
    if (!apiKey) {
      return NextResponse.json(
        { error: 'No LLM key is configured. The owner can set GROQ_API_KEY, or you can add a personal key in Settings.' },
        { status: 503 }
      );
    }

    const built = await buildGenerationContext(db, notebookId, selections, focus || null);
    if (!built) {
      return NextResponse.json(
        { error: 'no source material found for that selection' },
        { status: 400 }
      );
    }
    const userPrompt = [
      'Material:',
      built.context,
      '',
      `Generate up to ${count} flashcards.`,
      focus ? `Focus instruction: ${focus}` : ''
    ]
      .filter((line) => line.length > 0)
      .join('\n');

    const complete =
      deps.completeBatch ?? (async (key: string, system: string, prompt: string) => groqBatch(key, system, prompt));
    let cards = parseBatchCards(await complete(apiKey, GENERATE_SYSTEM, userPrompt));
    if (cards === null) {
      cards = parseBatchCards(
        await complete(
          apiKey,
          `${GENERATE_SYSTEM}\nYour previous reply was not a bare JSON array. Reply with ONLY the JSON array now.`,
          userPrompt
        )
      );
    }
    if (cards === null || cards.length === 0) {
      throw validationError('GENERATION_INVALID', 'the model did not return usable cards', 502);
    }

    const existing = await db.execute({
      sql: 'SELECT front FROM cards WHERE notebook_id = ?',
      args: [notebookId]
    });
    const seen = new Set(existing.rows.map((row) => normalizeFront(String(row.front))));
    const drafts: Array<{ front: string; back: string; sourceId: number | null }> = [];
    let skippedDuplicates = 0;
    for (const card of cards) {
      const front = card.front.slice(0, FRONT_MAX).trim();
      const back = card.back.slice(0, BACK_MAX).trim();
      const key = normalizeFront(front);
      if (front.length === 0 || back.length === 0 || key.length === 0 || seen.has(key)) {
        skippedDuplicates += 1;
        continue;
      }
      seen.add(key);
      drafts.push({
        front,
        back,
        sourceId: selections.length === 1 ? selections[0]!.sourceId : null
      });
      if (drafts.length >= count) {
        break;
      }
    }

    return NextResponse.json({
      drafts,
      skippedDuplicates,
      sourceSummary: built.sourceSummary
    });
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
      max_tokens: 4000,
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

interface BatchCardInput {
  front: string;
  back: string;
  sourceId: number | null;
}

async function createCardBatch(
  db: Client,
  notebookId: number,
  input: { sourceSummary: string; focus: string | null; cards: BatchCardInput[] }
): Promise<CardBatchSummary> {
  const createdAt = new Date().toISOString();
  const reviewDate = new Date(createdAt);
  const transaction = await db.transaction('write');
  try {
    const batchResult = await transaction.execute({
      sql: `INSERT INTO card_batches (notebook_id, source_summary, focus, card_count, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [notebookId, input.sourceSummary, input.focus, input.cards.length, createdAt]
    });
    const batchId = Number(batchResult.lastInsertRowid);
    for (const card of input.cards) {
      const cardResult = await transaction.execute({
        sql: `INSERT INTO cards (notebook_id, source_id, batch_id, front, back, created_at, generated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [notebookId, card.sourceId, batchId, card.front, card.back, createdAt, createdAt]
      });
      const cardId = Number(cardResult.lastInsertRowid);
      const columns = toReviewColumns(newReview(reviewDate));
      await transaction.execute({
        sql: `INSERT INTO reviews (card_id, due, stability, difficulty, reps, lapses, state, last_graded, fsrs_meta)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          cardId,
          columns.due,
          columns.stability,
          columns.difficulty,
          columns.reps,
          columns.lapses,
          columns.state,
          columns.last_graded,
          columns.fsrs_meta
        ]
      });
    }
    await transaction.commit();
    return {
      id: batchId,
      createdAt,
      sourceSummary: input.sourceSummary,
      focus: input.focus,
      cardCount: input.cards.length
    };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
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
    if (sourceId != null && !(await sourceInNotebook(db, notebookId, sourceId))) {
      return NextResponse.json({ error: 'unknown source' }, { status: 404 });
    }
    const card = await createCard(db, notebookId, { sourceId, front, back });
    return NextResponse.json(card, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function cardsBatchAdd(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
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
    const body = parsedBody as { cards?: unknown; sourceSummary?: unknown; focus?: unknown };
    if (!Array.isArray(body.cards) || body.cards.length === 0) {
      return NextResponse.json({ error: 'cards are required' }, { status: 400 });
    }
    if (body.cards.length > MAX_BATCH_CARDS) {
      return NextResponse.json({ error: `a batch can hold at most ${MAX_BATCH_CARDS} cards` }, { status: 400 });
    }
    const sourceSummary = typeof body.sourceSummary === 'string' ? body.sourceSummary.trim() : '';
    if (sourceSummary.length === 0 || sourceSummary.length > SOURCE_SUMMARY_MAX) {
      return NextResponse.json(
        { error: `sourceSummary must be 1-${SOURCE_SUMMARY_MAX} characters` },
        { status: 400 }
      );
    }
    if (body.focus !== undefined && typeof body.focus !== 'string') {
      return NextResponse.json({ error: 'focus must be text' }, { status: 400 });
    }
    const focus = typeof body.focus === 'string' ? body.focus.trim() : '';
    if (focus.length > FOCUS_MAX) {
      return NextResponse.json({ error: `focus must be at most ${FOCUS_MAX} characters` }, { status: 400 });
    }

    const cards: BatchCardInput[] = [];
    const sourceCache = new Map<number, boolean>();
    for (const item of body.cards) {
      const raw = item as { front?: unknown; back?: unknown; sourceId?: unknown } | null;
      const front = typeof raw?.front === 'string' ? raw.front.trim() : '';
      const back = typeof raw?.back === 'string' ? raw.back.trim() : '';
      if (front.length === 0 || front.length > ADD_LIMITS.front || back.length === 0 || back.length > ADD_LIMITS.back) {
        return NextResponse.json(
          { error: `front (1-${ADD_LIMITS.front}) and back (1-${ADD_LIMITS.back}) are required` },
          { status: 400 }
        );
      }
      let sourceId: number | null = null;
      if (raw?.sourceId != null) {
        sourceId = Number(raw.sourceId);
        if (!Number.isInteger(sourceId) || sourceId <= 0) {
          return NextResponse.json({ error: 'unknown source' }, { status: 404 });
        }
        let owned = sourceCache.get(sourceId);
        if (owned === undefined) {
          owned = await sourceInNotebook(db, notebookId, sourceId);
          sourceCache.set(sourceId, owned);
        }
        if (!owned) {
          return NextResponse.json({ error: 'unknown source' }, { status: 404 });
        }
      }
      cards.push({ front, back, sourceId });
    }

    const batch = await createCardBatch(db, notebookId, {
      sourceSummary,
      focus: focus.length > 0 ? focus : null,
      cards
    });
    return NextResponse.json({ batch, created: cards.length }, { status: 201 });
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
    const cards = await listCardsWithReview(db, notebookId);
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
