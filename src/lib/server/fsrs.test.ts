// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Rating, State } from 'ts-fsrs';
import { newReview, applyGrade, toReviewColumns, fromReviewRow, type StoredReview } from './fsrs';

describe('fsrs wrapper', () => {
  const now = new Date('2026-10-24T12:00:00.000Z');

  it('creates a new unscheduled review row', () => {
    const review = newReview(now);
    expect(review.state).toBe(State.New);
    expect(review.reps).toBe(0);
    expect(review.due.toISOString()).toBe(now.toISOString());
    expect(review.stability).toBe(0);
    expect(review.difficulty).toBe(0);
  });

  it('grades a new card with Good into a near-term learning step', () => {
    const review = newReview(now);
    const graded = applyGrade(review, Rating.Good, now);
    const dueGapMs = graded.due.getTime() - now.getTime();
    expect(graded.state).toBe(State.Learning);
    expect(graded.reps).toBe(1);
    expect(dueGapMs).toBeGreaterThan(0);
    expect(dueGapMs).toBeLessThan(24 * 60 * 60 * 1000);
    expectgradedDueIsIsoStored(graded);
  });

  it('sends a new card straight into Review on Easy', () => {
    const review = newReview(now);
    const graded = applyGrade(review, Rating.Easy, now);
    expect(graded.state).toBe(State.Review);
    expect(graded.due.getTime()).toBeGreaterThan(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  });

  it('keeps grading deterministic for identical inputs', () => {
    const a = applyGrade(newReview(now), Rating.Good, now);
    const b = applyGrade(newReview(now), Rating.Good, now);
    expect(a.due.getTime()).toBe(b.due.getTime());
  });

  it('monotonically pushes the next due date on successful reviews', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    let review = newReview(now);
    // two learning steps, then the third review lands in Review state
    review = applyGrade(review, Rating.Good, now);
    const third = applyGrade(review, Rating.Good, review.due);
    review = applyGrade(third, Rating.Good, third.due);
    const dayAfter = new Date(review.due);
    const afterReview = applyGrade(review, Rating.Good, dayAfter);
    expect(afterReview.due.getTime()).toBeGreaterThan(review.due.getTime());
    expect(review.reps).toBe(3);
    expect(afterReview.reps).toBe(4);
    expect(afterReview.state).toBe(State.Review);
  });

  it('registers a lapse on Again from review state', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    let review = newReview(now);
    review = applyGrade(review, Rating.Easy, now);
    expect(review.state).toBe(State.Review);
    const reviewDue = review.due;
    review = applyGrade(review, Rating.Again, reviewDue);
    expect(review.lapses).toBe(1);
    expect(review.state).toBe(State.Relearning);
    const dueGapMs = review.due.getTime() - reviewDue.getTime();
    expect(dueGapMs).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('round-trips through the stored row shape', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    const review = applyGrade(newReview(now), Rating.Good, now);
    const columns = toReviewColumns(review);
    const restored = fromReviewRow({
      due: columns.due,
      stability: columns.stability,
      difficulty: columns.difficulty,
      reps: columns.reps,
      lapses: columns.lapses,
      state: columns.state,
      last_graded: columns.last_graded,
      fsrs_meta: columns.fsrs_meta
    });
    expect(restored.due.getTime()).toBe(review.due.getTime());
    expect(restored.state).toBe(review.state);
    expect(restored.reps).toBe(review.reps);
    expect(restored.lastGraded?.getTime()).toBe(review.lastGraded?.getTime());
  });
});

function expectgradedDueIsIsoStored(review: StoredReview): void {
  expect(Number.isFinite(review.due.getTime())).toBe(true);
}
