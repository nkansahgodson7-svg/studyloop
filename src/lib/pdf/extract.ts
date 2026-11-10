import type { PDFDocumentProxy } from 'pdfjs-dist';

export const MAX_PDF_PAGES = 100;
export const MAX_PDF_BYTES = 40 * 1024 * 1024;

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export interface ExtractedPdf {
  pageCount: number;
  text: string;
  pages: string[];
}

export async function extractPdfText(data: ArrayBuffer): Promise<ExtractedPdf> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  let pdf: PDFDocumentProxy;
  try {
    pdf = await task.promise;
  } catch {
    throw Object.assign(new Error('not a readable PDF'), { code: 'BAD_PDF' });
  }
  if (pdf.numPages > MAX_PDF_PAGES) {
    await task.destroy();
    throw Object.assign(new Error(`PDF has ${pdf.numPages} pages — limit is ${MAX_PDF_PAGES}`), {
      code: 'PDF_TOO_LARGE'
    });
  }
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .filter(Boolean)
      .join(' ');
    pageTexts.push(line.trim());
  }
  const pageCount = pdf.numPages;
  await task.destroy();

  // Form feed is the page separator: the server stores this text verbatim and
  // the chapter scanner splits it back into pages.
  const text = pageTexts.join('\f');
  return { pageCount, text, pages: pageTexts };
}
