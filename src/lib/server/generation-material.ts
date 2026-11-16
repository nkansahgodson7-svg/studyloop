import type { Client } from '@libsql/client';
import { searchChunksInSources } from './ingest/ingest';
import { validationError } from './errors';

/**
 * Source selection and sampling shared by flashcard and exam generation. Kept
 * out of `cards.ts` so both features build prompts from the same material and
 * the same page-range rules.
 */

export const SOURCE_SUMMARY_MAX = 1000;
export const GENERATION_BUDGET = 12_000;

export interface RequestedGenerationSource {
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

async function chunksForSelection(
  db: Client,
  selection: GenerationSourceSelection
): Promise<GenerationChunk[]> {
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

export async function buildGenerationContext(
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

export async function resolveGenerationSelections(
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
