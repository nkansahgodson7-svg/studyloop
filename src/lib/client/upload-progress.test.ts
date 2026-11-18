import { describe, expect, it } from 'vitest';
import { describePhase, type Phase } from './upload-progress';

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

  it('reports upload progress as a percentage', () => {
    const phase: Phase = { kind: 'uploading', label: 'Uploading the deck' };
    expect(describePhase(phase, 43)).toBe('Uploading the deck… 43%');
    expect(describePhase(phase, 43.6)).toBe('Uploading the deck… 44%');
  });

  it('drops the percentage when no progress has been reported', () => {
    const phase: Phase = { kind: 'uploading', label: 'Uploading the deck' };
    expect(describePhase(phase, 0)).toBe('Uploading the deck…');
    expect(describePhase(phase, 100)).toBe('Uploading the deck…');
    expect(describePhase(phase)).toBe('Uploading the deck…');
  });

  it('names the indexing step', () => {
    expect(describePhase({ kind: 'indexing', unit: 'pages', total: 300 })).toBe('Indexing 300 pages');
    expect(describePhase({ kind: 'indexing', unit: 'slides', total: 12 })).toBe('Indexing 12 slides');
  });

  it('is empty without a phase', () => {
    expect(describePhase(null)).toBe('');
  });
});
