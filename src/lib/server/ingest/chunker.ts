const TARGET = 1200;
const OVERLAP = 150;

const BOUNDARY_RATIO = 0.5;

export interface PageChunk {
  text: string;
  page: number;
}

/**
 * Chunk each page independently so a chunk never straddles a page boundary.
 * Overlap stays within the page, which keeps the page number attached to every
 * chunk accurate.
 */
export function chunkPages(pages: string[]): PageChunk[] {
  const chunks: PageChunk[] = [];
  pages.forEach((page, index) => {
    for (const text of chunkText(page)) {
      chunks.push({ text, page: index + 1 });
    }
  });
  return chunks;
}

export function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) {
    return [];
  }
  if (normalized.length <= TARGET) {
    return [normalized];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + TARGET, normalized.length);
    if (end < normalized.length) {
      const window = normalized.slice(start, end);
      const paragraph = window.lastIndexOf('\n\n');
      if (paragraph > window.length * BOUNDARY_RATIO) {
        end = start + paragraph + 2;
      } else {
        const sentence = Math.max(window.lastIndexOf('. ')+ 1, window.lastIndexOf('.\n') + 1, window.lastIndexOf('\n') + 1);
        if (sentence > window.length * BOUNDARY_RATIO) {
          end = start + sentence;
        } else {
          const space = window.lastIndexOf(' ');
          if (space > window.length * BOUNDARY_RATIO) {
            end = start + space + 1;
          }
        }
      }
    }
    const chunk = normalized.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    if (end >= normalized.length) {
      break;
    }
    start = Math.max(end - OVERLAP, start + 1);
  }
  return chunks;
}
