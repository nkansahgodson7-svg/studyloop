import { unzipSync } from 'fflate';

export const MAX_PPTX_SLIDES = 100;
export const MAX_PPTX_BYTES = 40 * 1024 * 1024;

export interface ExtractedPptx {
  pageCount: number;
  text: string;
  pages: string[];
}

function unzip(data: ArrayBuffer): Record<string, Uint8Array> {
  // Only inflate the slide and notes XML. Decks carry embedded images and
  // video, and expanding those into memory can fail on a large presentation.
  return unzipSync(new Uint8Array(data), {
    filter: (file) => /^ppt\/(slides\/[^/]+\.xml|slides\/_rels\/[^/]+\.rels|notesSlides\/[^/]+\.xml)$/.test(file.name)
  });
}

function xmlText(xml: string): string {
  // Extract text runs grouped by paragraph.
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const paragraphs = Array.from(doc.getElementsByTagName('a:p'));
  const lines: string[] = [];
  for (const p of paragraphs) {
    const runs = Array.from(p.getElementsByTagName('a:t'));
    const line = runs.map((r) => r.textContent ?? '').join('');
    if (line.trim().length > 0) lines.push(line.trim());
  }
  // Fallback: if no paragraphs found, collect all a:t.
  if (lines.length === 0) {
    const runs = Array.from(doc.getElementsByTagName('a:t'));
    const joined = runs.map((r) => r.textContent ?? '').join(' ').trim();
    if (joined) lines.push(joined);
  }
  return lines.join('\n');
}

export async function extractPptxText(data: ArrayBuffer): Promise<ExtractedPptx> {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzip(data);
  } catch {
    throw Object.assign(new Error('not a readable PPTX'), { code: 'BAD_PPTX' });
  }

  // Determine slide order from presentation.xml if possible.
  const slideFiles = Object.keys(zip).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  // Sort by slide number.
  slideFiles.sort((a, b) => {
    const na = Number(a.match(/slide(\d+)\.xml/)?.[1] ?? 0);
    const nb = Number(b.match(/slide(\d+)\.xml/)?.[1] ?? 0);
    return na - nb;
  });

  if (slideFiles.length === 0) {
    throw Object.assign(new Error('no slides found in presentation'), { code: 'BAD_PPTX' });
  }
  if (slideFiles.length > MAX_PPTX_SLIDES) {
    throw Object.assign(new Error(`This deck has ${slideFiles.length} slides — the limit is ${MAX_PPTX_SLIDES}.`), {
      code: 'PPTX_TOO_LARGE'
    });
  }

  // Build rels map slide -> notes slide file.
  const notesBySlide: Record<string, string> = {};
  for (const slideFile of slideFiles) {
    const slideNum = slideFile.match(/slide(\d+)\.xml/)?.[1];
    const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    const relsBytes = zip[relsPath];
    if (!relsBytes) continue;
    const relsXml = new TextDecoder().decode(relsBytes);
    const relsDoc = new DOMParser().parseFromString(relsXml, 'application/xml');
    const rels = Array.from(relsDoc.getElementsByTagName('Relationship'));
    for (const rel of rels) {
      const type = rel.getAttribute('Type') ?? '';
      if (!type.includes('notesSlide')) continue;
      const target = rel.getAttribute('Target') ?? '';
      // Target like ../notesSlides/notesSlide1.xml
      const resolved = target.replace(/^..\/\//, '').replace(/^\.\.\//, 'ppt/');
      // normalize: ppt/notesSlides/...
      const normalized = resolved.startsWith('ppt/') ? resolved : `ppt/${resolved.replace(/^\//, '')}`;
      // find matching zip key
      const key = Object.keys(zip).find((k) => k === normalized || k.endsWith('/' + target.split('/').pop()!));
      if (key) notesBySlide[slideFile] = key;
    }
  }

  const pageTexts: string[] = [];
  for (const slideFile of slideFiles) {
    const slideXml = new TextDecoder().decode(zip[slideFile]);
    let slideText = xmlText(slideXml);
    const notesKey = notesBySlide[slideFile];
    if (notesKey) {
      const notesXml = new TextDecoder().decode(zip[notesKey]);
      const notesText = xmlText(notesXml);
      if (notesText.trim().length > 0) {
        slideText = slideText ? `${slideText}\n\nNotes:\n${notesText}` : `Notes:\n${notesText}`;
      }
    }
    pageTexts.push(slideText.trim());
  }

  const text = pageTexts.join('\f');
  return { pageCount: pageTexts.length, text, pages: pageTexts };
}