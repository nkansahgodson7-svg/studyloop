import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '../crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createNotebook } from '../notebooks';
import { createUser, createSession } from '../repo';
import { ingestTextSource, listSources } from './ingest';
import { textSourceCreate } from '../sources';

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
        kind: 'youtube' as never
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
