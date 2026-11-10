import { describe, expect, it } from 'vitest';
import { detectChapters } from './pages';

describe('detectChapters', () => {
  it('turns headings into chapters with page ranges', () => {
    const pages = [
      'Chapter 1: Cells\nAll living things are made of cells.',
      'Cells contain organelles such as mitochondria.',
      'Chapter 2: Tissues\nGroups of similar cells form tissues.',
      'Tissues combine to form organs.',
      'Chapter 3: Organs\nOrgans work together in systems.'
    ];

    expect(detectChapters(pages)).toEqual([
      { label: 'Chapter 1: Cells', fromPage: 1, toPage: 2 },
      { label: 'Chapter 2: Tissues', fromPage: 3, toPage: 4 },
      { label: 'Chapter 3: Organs', fromPage: 5, toPage: 5 }
    ]);
  });

  it('recognises units, modules, sections, parts, and roman numerals', () => {
    const pages = [
      'Unit IV: Waves\nWave properties and interference.',
      'Module 2: Optics\nLenses and mirrors.',
      '  section 1.2 — Refraction\nSnell law.',
      'Part B: Practice\nWorked examples.'
    ];

    expect(detectChapters(pages).map((chapter) => chapter.label)).toEqual([
      'Unit IV: Waves',
      'Module 2: Optics',
      'section 1.2 — Refraction',
      'Part B: Practice'
    ]);
  });

  it('collapses repeated running headers into one chapter', () => {
    const pages = [
      'Chapter 1: Intro\nBody one.',
      'Chapter 1: Intro\nBody two.',
      'Chapter 2: Next\nBody three.',
      'Chapter 2: Next\nBody four.'
    ];

    expect(detectChapters(pages)).toEqual([
      { label: 'Chapter 1: Intro', fromPage: 1, toPage: 2 },
      { label: 'Chapter 2: Next', fromPage: 3, toPage: 4 }
    ]);
  });

  it('only scans the first non-empty line of each page', () => {
    const pages = [
      'Photosynthesis overview.\nThis page mentions Chapter 9 in the body.',
      '\n\nChapter 2: Respiration\nGlycolysis happens in the cytoplasm.'
    ];

    expect(detectChapters(pages)).toEqual([
      { label: 'Chapter 2: Respiration', fromPage: 2, toPage: 2 }
    ]);
  });

  it('returns no chapters for plain prose or empty pages', () => {
    expect(detectChapters([])).toEqual([]);
    expect(detectChapters(['', '   ', 'Just a paragraph of notes.'])).toEqual([]);
  });

  it('ignores overly long first lines', () => {
    const pages = [`Chapter 1: ${'very long heading '.repeat(20)}\nBody.`];
    expect(detectChapters(pages)).toEqual([]);
  });
});
