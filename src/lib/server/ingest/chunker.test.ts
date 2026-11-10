import { describe, expect, it } from 'vitest';
import { chunkPages, chunkText } from './chunker';

describe('chunkText', () => {
  it('keeps short text as a single chunk', () => {
    const text = 'Cellular respiration converts glucose and oxygen into ATP.';
    expect(chunkText(text)).toEqual([text]);
  });

  it('splits long text into chunks of at most the target size', () => {
    const paragraphs = Array.from(
      { length: 40 },
      (_, i) => `Paragraph ${i}: ${'The mitochondrion is the powerhouse of the cell. '.repeat(8)}`
    );
    const text = paragraphs.join('\n\n');

    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1300);
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it('overlaps consecutive chunks', () => {
    const text = Array.from(
      { length: 30 },
      (_, i) => `Section ${i}: ${'DNA replication proceeds in a semiconservative manner. '.repeat(6)}`
    ).join('\n\n');

    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(2);

    const tailWords = chunks[0]!.slice(-60).trim().split(/\s+/);
    const headWords = chunks[1]!.slice(0, 200).trim().split(/\s+/);
    const overlapShared = tailWords.filter((word) => headWords.includes(word));
    expect(overlapShared.length).toBeGreaterThan(0);
  });

  it('never emits empty chunks', () => {
    const text = 'A' + ' word '.repeat(2000);
    for (const chunk of chunkText(text)) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('chunkPages', () => {
  it('tags short pages with their 1-based page number', () => {
    const chunks = chunkPages(['Page one text.', 'Page two text.', '   ']);
    expect(chunks).toEqual([
      { text: 'Page one text.', page: 1 },
      { text: 'Page two text.', page: 2 }
    ]);
  });

  it('splits long pages without crossing page boundaries', () => {
    const pageOne = 'Alpha page one sentence. '.repeat(120);
    const pageTwo = 'Beta page two sentence. '.repeat(120);
    const chunks = chunkPages([pageOne, pageTwo]);
    const one = chunks.filter((chunk) => chunk.page === 1);
    const two = chunks.filter((chunk) => chunk.page === 2);
    expect(one.length).toBeGreaterThan(1);
    expect(two.length).toBeGreaterThan(1);
    expect(one.every((chunk) => chunk.text.includes('Alpha'))).toBe(true);
    expect(two.every((chunk) => chunk.text.includes('Beta'))).toBe(true);
    expect(chunks.every((chunk) => chunk.text.length <= 1300)).toBe(true);
  });
});
