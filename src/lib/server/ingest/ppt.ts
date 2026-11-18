import PPT from 'ppt-to-text';

export interface ExtractedPpt {
  pageCount: number;
  text: string;
  pages: string[];
}

/**
 * Extract per-slide text from a legacy binary .ppt file. Returns one string per
 * slide (possibly empty for image-only slides) so the ingest core can keep the
 * slide→page mapping, matching the PDF path.
 */
export function extractPptText(data: ArrayBuffer | Buffer): ExtractedPpt {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const pres = (PPT as any).readBuffer(buffer);
  const arr: string[] = (PPT as any).utils.to_text(pres) ?? [];
  const pages = arr.map((s) => (typeof s === 'string' ? s.trim() : ''));
  // Empty slides stay as empty strings so slide numbering is preserved.
  const text = pages.join('\f');
  return { pageCount: pages.length, text, pages };
}