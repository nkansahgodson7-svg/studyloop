// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '../crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createNotebook } from '../notebooks';
import { createUser } from '../repo';
import { ingestTextSource, searchChunks, listSources } from './ingest';

const PHOTOSYNTHESIS_PARAGRAPH = `Photosynthesis converts light energy into chemical energy.
Chloroplasts absorb photons through pigments such as chlorophyll a and b.
The light reactions occur in the thylakoid membranes of the chloroplast.
The Calvin cycle fixes carbon dioxide into glucose using ATP and NADPH.
Stomata regulate gas exchange on the surface of leaves.`;

const PHOTOSYNTHESIS_TEXT = Array.from({ length: 12 }, () => PHOTOSYNTHESIS_PARAGRAPH).join('\n\n');

const CELL_TEXT = 'Glycolysis is the first stage of cellular respiration and happens in the cytoplasm.';

describe('text source ingest + FTS search', () => {
  let db: Client;
  let notebookId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-ingest-')), 'ingest.db'));
    await applySchema(db);
    const user = await createUser(db, { email: 'ingest@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    const notebook = await createNotebook(db, user.id, 'Bio 1');
    notebookId = notebook.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('stores the source, chunked rows and the FTS index; list matches', async () => {
    const result = await ingestTextSource(db, {
      notebookId,
      title: 'Photosynthesis notes',
      text: PHOTOSYNTHESIS_TEXT
    });

    expect(result.id).toBeGreaterThanOrEqual(1);
    expect(result.chunks).toBeGreaterThan(1);

    const sources = await listSources(db, notebookId);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.title).toBe('Photosynthesis notes');
    expect(sources[0]!.kind).toBe('text');

    const chunks = await db.execute({ sql: 'SELECT COUNT(*) n FROM source_chunks WHERE source_id = ?', args: [result.id] });
    expect(Number(chunks.rows[0]!.n)).toBe(result.chunks);
  });

  it('FTS top-k returns the chunk containing the keyword', async () => {
    await ingestTextSource(db, { notebookId, title: 'Cell respiration notes', text: CELL_TEXT });

    const hits = await searchChunks(db, notebookId, 'photosynthesis', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.text.toLowerCase()).toContain('photosynthesis');

    const hitSourceIds = new Set(hits.map((hit) => hit.sourceId));
    expect(hitSourceIds.size).toBe(1);
  });

  it('search finds the small single-chunk source too', async () => {
    const hits = await searchChunks(db, notebookId, 'glycolysis', 5);
    expect(hits.length).toBe(1);
    expect(hits[0]!.text).toContain('Glycolysis is the first stage');
  });

  it('returns nothing for unrelated queries', async () => {
    const hits = await searchChunks(db, notebookId, 'zebraxqq', 5);
    expect(hits).toEqual([]);
  });

  it('respects ownership only through notebook scoping', async () => {
    const other = await createUser(db, { email: 'other2@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    const otherNotebook = await createNotebook(db, other.id, 'Other notebook');
    const hits = await searchChunks(db, otherNotebook.id, 'photosynthesis', 5);
    expect(hits).toEqual([]);
  });

  it('rejects ingest into a notebook owned by someone else', async () => {
    const other = await createUser(db, { email: 'other3@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    const otherNotebook = await createNotebook(db, other.id, 'Not mine');
    await expect(
      ingestTextSource(db, { notebookId: otherNotebook.id, title: 'x', text: 'hello', userId: 999999 })
    ).rejects.toMatchObject({ code: 'FORBIDDEN_NOTEBOOK' });
  });

  it('rejects empty text with 400-style error', async () => {
    await expect(
      ingestTextSource(db, { notebookId, title: 'x', text: '   ' })
    ).rejects.toMatchObject({ code: 'INVALID_TEXT' });
  });
});
