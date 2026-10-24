// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '../crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createNotebook } from '../notebooks';
import { createUser, createSession } from '../repo';
import { listSources } from './ingest';
import { youtubeSourceCreate, extractVideoId, parseTranscriptText } from './youtube';

const TRANSCRIPT = 'Welcome to cellular respiration. ATP synthase uses the proton gradient. Oxidative phosphorylation follows glycolysis.';

describe('youtube()', () => {
  let db: Client;
  let notebookId: number;
  let token: string;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-yt-')), 'yt.db'));
    await applySchema(db);
    const user = await createUser(db, { email: 'yt@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    notebookId = (await createNotebook(db, user.id, 'Youtube notebook')).id;
    token = await createSession(db, user.id);
  });

  afterAll(async () => {
    await db.close();
  });

  it('parses a video id from youtube and youtu.be urls', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=abc123XYZ_-')).toBe('abc123XYZ_-');
    expect(extractVideoId('https://youtu.be/abc123XYZ_-')).toBe('abc123XYZ_-');
    expect(extractVideoId('https://www.youtube.com/watch?v=abc123XYZ_-&t=120s')).toBe('abc123XYZ_-');
    expect(extractVideoId('https://evil.com/watch?v=abc')).toBeNull();
    expect(extractVideoId('not a url')).toBeNull();
  });

  it('turns transcript segments into readable prose', () => {
    const text = parseTranscriptText([
      { text: 'Welcome to cellular respiration.', startMs: 0 },
      { text: 'ATP synthase uses the proton gradient.', startMs: 2341 },
      { text: 'Oxidative phosphorylation follows glycolysis.', startMs: 7800 }
    ]);
    expect(text).toBe(TRANSCRIPT);
  });

  it('ingests a youtube source via the injected fetcher (mocked)', async () => {
    const res = await youtubeSourceCreate(db, await new Request(`http://x/api/notebooks/${notebookId}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=abc123XYZ_-' })
    }), String(notebookId), async (videoId) => ({
      videoId,
      title: 'Cell respiration lecture',
      segments: [
        { text: 'Welcome to cellular respiration.', startMs: 0 },
        { text: 'ATP synthase uses the proton gradient.', startMs: 2341 }
      ]
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe('Cell respiration lecture');
    expect(body.chunks).toBeGreaterThanOrEqual(1);

    const sources = await listSources(db, notebookId);
    const youtubeSource = sources.find((s) => s.kind === 'youtube');
    expect(youtubeSource?.url).toBe('https://www.youtube.com/watch?v=abc123XYZ_-');
  });

  it('rejects invalid urls with 400', async () => {
    const res = await youtubeSourceCreate(db, await new Request(`http://x/api/notebooks/${notebookId}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
      body: JSON.stringify({ url: 'https://vimeo.com/123' })
    }), String(notebookId), async () => {
      throw new Error('should not be called');
    });
    expect(res.status).toBe(400);
  });

  it('maps fetcher failures to 502', async () => {
    const res = await youtubeSourceCreate(db, await new Request(`http://x/api/notebooks/${notebookId}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
      body: JSON.stringify({ url: 'https://youtu.be/dead0000000' })
    }), String(notebookId), async () => {
      throw Object.assign(new Error('no transcript available'), { code: 'NO_TRANSCRIPT' });
    });
    expect(res.status).toBe(502);
  });

  it('rejects ingest for a foreign notebook with 404', async () => {
    const foreign = await createUser(db, { email: 'yt2@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    const otherNotebook = await createNotebook(db, foreign.id, 'Foreign yt');
    const res = await youtubeSourceCreate(db, await new Request(`http://x/api/notebooks/${otherNotebook.id}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
      body: JSON.stringify({ url: 'https://youtu.be/abc123XYZ_-' })
    }), String(otherNotebook.id), async () => ({ videoId: 'abc123XYZ_-', title: 't', segments: [] }));
    expect(res.status).toBe(404);
  });
});
