import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '../crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createNotebook } from '../notebooks';
import { createUser, createSession } from '../repo';
import { ingestTextSource, listSources, searchChunksInSources } from './ingest';
import { chaptersGet, textSourceCreate } from '../sources';

const PDF_TEXT =
  'Page one extracted words. '.repeat(30) + '\n' + 'Page two extracted words. '.repeat(30);

describe('pdf kind through the text ingest core', () => {
  let db: Client;
  let notebookId: number;
  let token: string;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-pdf-')), 'pdf.db'));
    await applySchema(db);
    const user = await createUser(db, { email: 'pdf@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    notebookId = (await createNotebook(db, user.id, 'PDF notebook')).id;
    token = await createSession(db, user.id);
  });

  afterAll(async () => {
    await db.close();
  });

  it('stores a pdf-kind source with extracted text and searchable chunks', async () => {
    const result = await ingestTextSource(db, {
      notebookId,
      title: 'Lecture slides.pdf',
      text: PDF_TEXT,
      kind: 'pdf'
    });

    expect(result.id).toBeGreaterThanOrEqual(1);
    expect(result.chunks).toBeGreaterThan(1);

    const sources = await listSources(db, notebookId);
    expect(sources[0]!.kind).toBe('pdf');
    expect(sources[0]!.title).toBe('Lecture slides.pdf');
  });

  it('rejects an unsupported kind in the data layer', async () => {
    await expect(
      ingestTextSource(db, {
        notebookId,
        title: 'Bot kind',
        text: PDF_TEXT,
        kind: 'audio' as never
      })
    ).rejects.toMatchObject({ code: 'INVALID_KIND' });
  });

  it('API accepts kind "pdf" and stores the source', async () => {
    const res = await textSourceCreate(db, await new Request(`http://x/api/notebooks/${notebookId}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
      body: JSON.stringify({ title: 'Via API slide.pdf', text: PDF_TEXT, kind: 'pdf' })
    }), String(notebookId));
    expect(res.status).toBe(201);
    const raw = await db.execute({ sql: "SELECT kind FROM sources WHERE title = 'Via API slide.pdf'", args: [] });
    expect(String(raw.rows[0]!.kind)).toBe('pdf');
  });

  it('API rejects an unknown kind with 400', async () => {
    const res = await textSourceCreate(db, await new Request(`http://x/api/notebooks/${notebookId}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
      body: JSON.stringify({ title: 'Bot kind', text: PDF_TEXT, kind: 'audio' })
    }), String(notebookId));
    expect(res.status).toBe(400);
  });

  it('API rejects oversized text with 413', async () => {
    const res = await textSourceCreate(db, await new Request(`http://x/api/notebooks/${notebookId}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
      body: JSON.stringify({ title: 'Huge', text: 'a'.repeat(2_000_001) })
    }), String(notebookId));
    expect(res.status).toBe(413);
  });

  it('max text under the cap still works', async () => {
    const res = await textSourceCreate(db, await new Request(`http://x/api/notebooks/${notebookId}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
      body: JSON.stringify({ title: 'Boundary', text: 'word '.repeat(100_000) })
    }), String(notebookId));
    expect(res.status).toBe(201);
  });
});

const PAGED_PAGES = [
  'Chapter 1: Cells\nAll living things are made of cells.',
  'Cells contain organelles such as mitochondria.',
  'Chapter 2: Tissues\nGroups of similar cells form tissues.',
  'Tissues combine to form organs.'
];

describe('page-aware pdf ingest', () => {
  let db: Client;
  let notebookId: number;
  let token: string;
  let legacySourceId: number;
  let pagedSourceId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-pages-')), 'pages.db'));
    await applySchema(db);
    const user = await createUser(db, { email: 'pages@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    notebookId = (await createNotebook(db, user.id, 'Paged PDF notebook')).id;
    token = await createSession(db, user.id);
    legacySourceId = (await ingestTextSource(db, {
      notebookId,
      title: 'Legacy slides.pdf',
      text: PDF_TEXT,
      kind: 'pdf'
    })).id;
    pagedSourceId = (await ingestTextSource(db, {
      notebookId,
      title: 'Paged slides.pdf',
      pages: PAGED_PAGES,
      kind: 'pdf'
    })).id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('stores page arrays with form-feed text and page-tagged chunks', async () => {
    const raw = await db.execute({ sql: 'SELECT text FROM sources WHERE id = ?', args: [pagedSourceId] });
    expect(String(raw.rows[0]!.text)).toBe(PAGED_PAGES.join('\f'));

    const chunks = await db.execute({
      sql: 'SELECT ord, page, text FROM source_chunks WHERE source_id = ? ORDER BY ord',
      args: [pagedSourceId]
    });
    expect(chunks.rows.map((row) => Number(row.page))).toEqual([1, 2, 3, 4]);
    expect(String(chunks.rows[0]!.text)).toContain('Chapter 1: Cells');

    const sources = await listSources(db, notebookId);
    expect(sources.find((source) => source.id === pagedSourceId)?.pageCount).toBe(4);
    expect(sources.find((source) => source.id === legacySourceId)?.pageCount).toBeNull();
  });

  it('scopes FTS hits to the selected page-aware sources', async () => {
    const hits = await searchChunksInSources(db, notebookId, [pagedSourceId], 'mitochondria', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sourceId).toBe(pagedSourceId);
    expect(hits[0]!.page).toBe(2);

    const excluded = await searchChunksInSources(db, notebookId, [legacySourceId], 'mitochondria', 5);
    expect(excluded).toEqual([]);
  });

  it('API accepts a pages array and reports the page count', async () => {
    const res = await textSourceCreate(db, await new Request(`http://x/api/notebooks/${notebookId}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
      body: JSON.stringify({ title: 'API pages.pdf', pages: PAGED_PAGES, kind: 'pdf' })
    }), String(notebookId));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; chunks: number };
    expect(body.chunks).toBe(4);

    const raw = await db.execute({ sql: 'SELECT text, meta FROM sources WHERE id = ?', args: [body.id] });
    expect(String(raw.rows[0]!.text)).toBe(PAGED_PAGES.join('\f'));
    expect(String(raw.rows[0]!.meta)).toBe('4 pages · 4 chunks');
  });

  it('API rejects malformed pages payloads', async () => {
    const badEntry = await textSourceCreate(db, await new Request(`http://x/api/notebooks/${notebookId}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
      body: JSON.stringify({ title: 'Bad pages', pages: ['ok', 42], kind: 'pdf' })
    }), String(notebookId));
    expect(badEntry.status).toBe(400);

    const notArray = await textSourceCreate(db, await new Request(`http://x/api/notebooks/${notebookId}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
      body: JSON.stringify({ title: 'Bad pages', pages: 'not an array', kind: 'pdf' })
    }), String(notebookId));
    expect(notArray.status).toBe(400);

    const empty = await textSourceCreate(db, await new Request(`http://x/api/notebooks/${notebookId}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
      body: JSON.stringify({ title: 'Empty pages', pages: [], kind: 'pdf' })
    }), String(notebookId));
    expect(empty.status).toBe(400);
  });

  it('detects chapters from stored pages and returns none for unpaged sources', async () => {
    const res = await chaptersGet(
      db,
      new Request(`http://x/api/notebooks/${notebookId}/sources/${pagedSourceId}/chapters`, {
        headers: { cookie: `sl_session=${token}` }
      }),
      String(notebookId),
      String(pagedSourceId)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { label: 'Chapter 1: Cells', fromPage: 1, toPage: 2 },
      { label: 'Chapter 2: Tissues', fromPage: 3, toPage: 4 }
    ]);

    const legacy = await chaptersGet(
      db,
      new Request(`http://x/api/notebooks/${notebookId}/sources/${legacySourceId}/chapters`, {
        headers: { cookie: `sl_session=${token}` }
      }),
      String(notebookId),
      String(legacySourceId)
    );
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toEqual([]);

    const missing = await chaptersGet(
      db,
      new Request(`http://x/api/notebooks/${notebookId}/sources/99999/chapters`, {
        headers: { cookie: `sl_session=${token}` }
      }),
      String(notebookId),
      '99999'
    );
    expect(missing.status).toBe(404);
  });
});
