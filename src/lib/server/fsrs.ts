import { createEmptyCard, fsrs, type Card, type Grade, type State } from 'ts-fsrs';

export interface StoredReview {
  due: Date;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number;
  lastGraded: Date | null;
  meta: Card;
}

export interface StoredReviewRow {
  due: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number;
  last_graded: string | null;
  fsrs_meta: string | null;
}

interface TsCardLike {
  due: unknown;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: unknown;
}

function toStoredReview(card: TsCardLike): StoredReview {
  return {
    due: new Date(card.due as string | number | Date),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastGraded: card.last_review ? new Date(card.last_review as string | number | Date) : null,
    meta: {
      ...(card as unknown as Card),
      due: new Date(card.due as string | number | Date),
      last_review: card.last_review ? new Date(card.last_review as string | number | Date) : undefined
    }
  };
}

export function newReview(now: Date): StoredReview {
  const card = createEmptyCard(now);
  return toStoredReview(card as unknown as TsCardLike);
}

const scheduler = fsrs();

export function applyGrade(review: StoredReview, rating: Grade, now: Date): StoredReview {
  const log = Array.from(scheduler.repeat(review.meta, now));
  const item = log[Math.max(1, Math.min(4, rating)) - 1]!;
  return toStoredReview(item.card as unknown as TsCardLike);
}

export function toReviewColumns(review: StoredReview): { due: string; stability: number; difficulty: number; reps: number; lapses: number; state: number; last_graded: string | null; fsrs_meta: string } {
  return {
    due: review.due.toISOString(),
    stability: review.stability,
    difficulty: review.difficulty,
    reps: review.reps,
    lapses: review.lapses,
    state: review.state,
    last_graded: review.lastGraded ? review.lastGraded.toISOString() : null,
    fsrs_meta: JSON.stringify(review.meta)
  };
}

export function fromReviewRow(row: StoredReviewRow): StoredReview {
  let meta: TsCardLike | null = null;
  if (row.fsrs_meta) {
    try {
      meta = JSON.parse(row.fsrs_meta) as TsCardLike;
    } catch {
      // Fall back to the scalar columns if stored metadata is corrupt.
      meta = null;
    }
  }
  if (meta) {
    return toStoredReview(meta);
  }
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    lastGraded: row.last_graded ? new Date(row.last_graded) : null,
    meta: {
      due: new Date(row.due),
      stability: row.stability,
      difficulty: row.difficulty,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: row.reps,
      lapses: row.lapses,
      state: row.state as State,
      last_review: row.last_graded ? new Date(row.last_graded) : undefined
    }
  };
}

export { Rating, State } from 'ts-fsrs';
