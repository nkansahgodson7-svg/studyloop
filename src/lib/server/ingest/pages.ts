export interface DetectedChapter {
  label: string;
  fromPage: number;
  toPage: number;
}

/**
 * Chapter headings we recognise at the top of a page:
 *   Chapter 3, Unit 2, Module IV, Section 1.2, Part B ...
 * The page body is intentionally not scanned: running headers and references
 * to "chapter 3" inside prose would create false boundaries.
 */
const HEADING_RE = /^\s*(chapter|unit|module|section|part)\s+([0-9]+|[ivxlcdm]+|[a-z])\b/i;

function firstLine(page: string): string {
  for (const line of page.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return '';
}

export function detectChapters(pages: string[]): DetectedChapter[] {
  const starts: Array<{ label: string; fromPage: number }> = [];
  pages.forEach((page, index) => {
    const line = firstLine(page);
    if (line.length === 0 || line.length > 160 || !HEADING_RE.test(line)) {
      return;
    }
    const label = line.slice(0, 160);
    // Running headers often repeat the same heading on every page. Keep only
    // the first occurrence so one chapter is not split into one per page.
    if (starts.length > 0 && starts[starts.length - 1]!.label === label) {
      return;
    }
    starts.push({ label, fromPage: index + 1 });
  });

  return starts.map((start, index) => ({
    label: start.label,
    fromPage: start.fromPage,
    toPage: (starts[index + 1]?.fromPage ?? pages.length + 1) - 1
  }));
}
