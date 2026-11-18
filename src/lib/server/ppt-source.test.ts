import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from './crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createNotebook } from './notebooks';
import { createSession, createUser } from './repo';
import { pptSourceCreate } from './sources';

const { download } = vi.hoisted(() => ({ download: vi.fn() }));

// Storage and the binary parser are the two things a unit test cannot provide;
// everything else (auth, ownership, ingest) runs for real.
vi.mock('./source-files', () => ({
  downloadSourceFileByCustomId: (customId: string) => download(customId),
  storeSourceFile: async () => null,
  signedSourceFileUrl: async () => null,
  sourceFilesEnabled: () => true
}));

vi.mock('./ingest/ppt', () => ({
  extractPptText: () => ({
    pageCount: 2,
    text: 'slide one\fslide two',
    pages: ['slide one', 'slide two']
  })
}));

describe('legacy .ppt relay', () => {
  let db: Client;
  let userId: number;
  let notebookId: number;
  let token: string;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-ppt-')), 'ppt.db'));
    await applySchema(db);
    const user = await createUser(db, {
      email: 'relay@x.local',
      passwordHash: await hashPassword('p'),
      role: 'user'
    });
    userId = user.id;
    notebookId = (await createNotebook(db, user.id, 'Deck notebook')).id;
    token = await createSession(db, user.id);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => {
    download.mockReset();
  });

  function relay(body: unknown): Promise<Response> {
    return pptSourceCreate(
      db,
      new Request(`http://x/api/notebooks/${notebookId}/sources/ppt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
        body: JSON.stringify(body)
      }),
      String(notebookId)
    ) as unknown as Promise<Response>;
  }

  it('rejects an upload id minted for another user', async () => {
    const res = await relay({ title: 'deck.ppt', customId: `${userId + 1}-stolen` });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid upload' });
    expect(download).not.toHaveBeenCalled();
  });

  it('rejects an upload id without a user prefix', async () => {
    const res = await relay({ title: 'deck.ppt', customId: 'abc123' });
    expect(res.status).toBe(400);
    expect(download).not.toHaveBeenCalled();
  });

  it('rejects a relayed file that is not a .ppt', async () => {
    const res = await relay({ title: 'deck.pptx', customId: `${userId}-abc` });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'only .ppt files are accepted here' });
    expect(download).not.toHaveBeenCalled();
  });

  it('reports a stored upload that cannot be read', async () => {
    download.mockResolvedValue(null);
    const res = await relay({ title: 'deck.ppt', customId: `${userId}-abc` });
    expect(res.status).toBe(404);
    expect(download).toHaveBeenCalledWith(`${userId}-abc`);
  });

  it('indexes the downloaded deck and keeps its key for the preview', async () => {
    download.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), key: 'stored-key' });
    const res = await relay({ title: 'The diode2025.ppt', customId: `${userId}-abc` });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; title: string };
    expect(body.title).toBe('The diode2025.ppt');

    const row = await db.execute({
      sql: 'SELECT kind, meta, file_key FROM sources WHERE id = ?',
      args: [body.id]
    });
    expect(row.rows[0]?.['kind']).toBe('ppt');
    expect(row.rows[0]?.['meta']).toBe('2 slides · 2 chunks');
    expect(row.rows[0]?.['file_key']).toBe('stored-key');
  });
});
