import { describe, expect, it } from 'vitest';
import { describePhase, phaseProgress, type Phase } from './upload-progress';

describe('describePhase', () => {
  it('counts pages while a PDF is being read', () => {
    const phase: Phase = { kind: 'reading', unit: 'page', done: 42, total: 300 };
    expect(describePhase(phase)).toBe('Reading page 42 of 300');
  });

  it('counts slides while a deck is being read', () => {
    const phase: Phase = { kind: 'reading', unit: 'slide', done: 7, total: 120 };
    expect(describePhase(phase)).toBe('Reading slide 7 of 120');
  });

  it('says what is being read before the total is known', () => {
    expect(describePhase({ kind: 'reading', unit: 'page', done: 0, total: 0 })).toBe('Reading pages');
    expect(describePhase({ kind: 'reading', unit: 'slide', done: 0, total: 0 })).toBe('Reading slides');
  });

  it('names the upload without a percentage, which the bar shows', () => {
    expect(describePhase({ kind: 'uploading', label: 'Uploading the deck' })).toBe('Uploading the deck');
  });

  it('passes through labels for unmeasurable work', () => {
    expect(describePhase({ kind: 'working', label: 'Reading and indexing the slides' })).toBe(
      'Reading and indexing the slides'
    );
  });

  it('names the indexing step', () => {
    expect(describePhase({ kind: 'indexing', unit: 'pages', total: 300 })).toBe('Indexing 300 pages');
    expect(describePhase({ kind: 'indexing', unit: 'slides', total: 12 })).toBe('Indexing 12 slides');
  });

  it('is empty without a phase', () => {
    expect(describePhase(null)).toBe('');
  });
});

describe('phaseProgress', () => {
  it('tracks pages read', () => {
    expect(phaseProgress({ kind: 'reading', unit: 'page', done: 75, total: 300 })).toBe(0.25);
  });

  it('tracks slides read', () => {
    expect(phaseProgress({ kind: 'reading', unit: 'slide', done: 1, total: 4 })).toBe(0.25);
  });

  it('has no fraction before the page total is known', () => {
    expect(phaseProgress({ kind: 'reading', unit: 'page', done: 0, total: 0 })).toBeNull();
  });

  it('converts upload percent to a fraction', () => {
    const phase: Phase = { kind: 'uploading', label: 'Uploading the deck' };
    expect(phaseProgress(phase, 63)).toBeCloseTo(0.63);
    expect(phaseProgress(phase, 100)).toBe(1);
  });

  it('has no fraction until the upload reports progress', () => {
    expect(phaseProgress({ kind: 'uploading', label: 'Uploading the deck' }, 0)).toBeNull();
    expect(phaseProgress({ kind: 'uploading', label: 'Uploading the deck' })).toBeNull();
  });

  it('never leaves 0-1, even if a counter overshoots', () => {
    expect(phaseProgress({ kind: 'reading', unit: 'page', done: 320, total: 300 })).toBe(1);
    expect(phaseProgress({ kind: 'uploading', label: 'Uploading the deck' }, 140)).toBe(1);
  });

  it('is null for steps that cannot be measured', () => {
    expect(phaseProgress({ kind: 'indexing', unit: 'pages', total: 300 })).toBeNull();
    expect(phaseProgress({ kind: 'working', label: 'Reading and indexing the slides' })).toBeNull();
    expect(phaseProgress(null)).toBeNull();
  });
});
