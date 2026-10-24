'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';

interface SourceRow {
  id: number;
  kind: 'pdf' | 'youtube' | 'text';
  title: string;
  url: string | null;
  createdAt: string;
}

const MAX_PDF_BYTES = 40 * 1024 * 1024;

type NotebookState = 'loading' | 'missing';

export default function NotebookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [notebooks, setNotebooks] = useState<Record<number, string> | NotebookState>('loading');
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [srcText, setSrcText] = useState('');
  const [srcTitle, setSrcTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  async function handlePdf(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setNotice(null);

    if (file.size > MAX_PDF_BYTES) {
      setError('PDF is larger than 40 MB.');
      return;
    }
    setPdfBusy(true);
    try {
      const { extractPdfText } = await import('@/lib/pdf/extract');
      const { pageCount, text } = await extractPdfText(await file.arrayBuffer());
      if (text.length < 20) {
        setError('PDF had no extractable text (is it scanned images?).');
        return;
      }
      const res = await fetch(`/api/notebooks/${id}/sources`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: file.name, text, kind: 'pdf' })
      });
      if (res.status === 201) {
        const body = (await res.json()) as { chunks: number };
        setNotice(`Saved PDF (${pageCount} pages) — split into ${body.chunks} searchable chunk${body.chunks === 1 ? '' : 's'}.`);
        await load();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? `PDF save failed (${res.status})`);
    } catch (extractError) {
      setError(extractError instanceof Error ? extractError.message : 'PDF extraction failed');
    } finally {
      setPdfBusy(false);
    }
  }

  const load = useCallback(async () => {
    const listRes = await fetch('/api/notebooks');
    if (listRes.status === 401 || listRes.status === 403) {
      setNotebooks('missing');
      return;
    }
    if (listRes.ok) {
      const all = (await listRes.json()) as { id: number; title: string }[];
      if (!all.some((nb) => nb.id === Number(id))) {
        setNotebooks('missing');
        return;
      }
      const titleMap: Record<number, string> = {};
      for (const nb of all) {
        titleMap[nb.id] = nb.title;
      }
      setNotebooks(titleMap);

      const srcRes = await fetch(`/api/notebooks/${id}/sources`);
      if (srcRes.ok) {
        setSources((await srcRes.json()) as SourceRow[]);
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAddSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/notebooks/${id}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: srcTitle, text: srcText })
    });
    if (res.status === 201) {
      const body = (await res.json()) as { chunks: number };
      setNotice(`Saved source — split into ${body.chunks} searchable chunk${body.chunks === 1 ? '' : 's'}.`);
      setSrcText('');
      setSrcTitle('');
      await load();
      return;
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    setError(body?.error ?? `Save failed (${res.status})`);
  }

  if (notebooks === 'missing') {
    return (
      <main>
        <h1>Not found</h1>
        <p>
          <Link href="/notebooks">Back to notebooks</Link>
        </p>
      </main>
    );
  }

  const headingText = notebooks === 'loading' ? 'Loading…' : notebooks[Number(id)];

  return (
    <main>
      <h1>
        <Link href="/notebooks">Notebooks</Link> / {headingText}
      </h1>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}

      <section aria-label="Add a text source">
        <h2>Add a text source</h2>
        <form onSubmit={handleAddSource}>
          <label htmlFor="src-title">Title</label>
          <input
            id="src-title"
            type="text"
            value={srcTitle}
            onChange={(e) => setSrcTitle(e.target.value)}
            placeholder="Lecture notes"
          />
          <label htmlFor="src-text">Paste text</label>
          <textarea
            id="src-text"
            required
            rows={8}
            value={srcText}
            onChange={(e) => setSrcText(e.target.value)}
            placeholder="Paste any study material here"
          />
          <button type="submit">Save source</button>
        </form>

        <form
          aria-label="Add a PDF source"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <label htmlFor="pdf-file">Upload PDF (up to 100 pages, 40 MB)</label>
          <input
            id="pdf-file"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => void handlePdf(e)}
            disabled={pdfBusy}
          />
        </form>
        {pdfBusy ? <p role="status" aria-busy="true">Extracting PDF…</p> : null}
      </section>

      <section aria-label="Sources">
        <h2>Sources</h2>
        {sources === null ? (
          <p>Loading…</p>
        ) : sources.length === 0 ? (
          <p>No sources yet — paste text above.</p>
        ) : (
          <ul>
            {sources.map((source) => (
              <li key={source.id}>
                [{source.kind}] {source.title}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
