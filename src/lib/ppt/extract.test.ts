import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractPptxText, MAX_PPTX_SLIDES } from './extract';

function buildPptx(slides: string[], notes: Record<number, string> = {}): ArrayBuffer {
  const files: Record<string, Uint8Array> = {};
  slides.forEach((body, i) => {
    const n = i + 1;
    files[`ppt/slides/slide${n}.xml`] = strToU8(
      `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>` +
        body
          .split('\n')
          .map((line) => `<p:sp><a:p><a:r><a:t>${line}</a:t></a:r></a:p></p:sp>`)
          .join('') +
        `</p:spTree></p:cSld></p:sld>`
    );
    if (notes[n]) {
      files[`ppt/slides/_rels/slide${n}.xml.rels`] = strToU8(
        `<?xml version="1.0"?><Relationships><Relationship Type="http://x/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/></Relationships>`
      );
      files[`ppt/notesSlides/notesSlide${n}.xml`] = strToU8(
        `<?xml version="1.0"?><p:notes xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>${notes[n]}</a:t></a:r></a:p></p:notes>`
      );
    }
  });
  return zipSync(files).buffer as ArrayBuffer;
}

describe('extractPptxText', () => {
  it('maps slides to pages and includes speaker notes', async () => {
    const buf = buildPptx(['Title\nBullet one', '', 'Third slide'], { 1: 'Speaker notes here' });
    const out = await extractPptxText(buf);
    expect(out.pageCount).toBe(3);
    expect(out.pages[0]).toContain('Title');
    expect(out.pages[0]).toContain('Bullet one');
    expect(out.pages[0]).toContain('Notes:\nSpeaker notes here');
    expect(out.pages[1]).toBe('');
    expect(out.pages[2]).toBe('Third slide');
  });

  it('reports the slide count when the deck is over the limit', async () => {
    const count = MAX_PPTX_SLIDES + 1;
    const buf = buildPptx(Array.from({ length: count }, (_, i) => `Slide ${i + 1}`));
    await expect(extractPptxText(buf)).rejects.toMatchObject({
      code: 'PPTX_TOO_LARGE',
      message: `This deck has ${count} slides — the limit is ${MAX_PPTX_SLIDES}.`
    });
  });
});
