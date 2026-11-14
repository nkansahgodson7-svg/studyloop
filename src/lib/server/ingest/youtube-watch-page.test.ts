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
import {
  extractCaptionTracks,
  extractVideoTitle,
  fetchTranscriptFromWatchPage,
  type FetchLike
} from './youtube';

const VIDEO_ID = 'dQw4w9WgXcQ';
const TRACK_URL =
  'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ\\u0026ei=abc\\u0026caps=asr\\u0026lang=en\\u0026signature=abc.def\\u0026key=yt8';

// Mirrors the shape YouTube embeds in the watch page: JSON with `\u0026` escapes.
const WATCH_PAGE = `<!doctype html><html><head><title>Rick Astley - Never Gonna Give You Up (Official Video) - YouTube</title></head><body>
<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"${VIDEO_ID}","title":"Rick Astley - Never Gonna Give You Up (Official Video)"},"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"${TRACK_URL}","name":{"simpleText":"English"},"vssId":".en","languageCode":"en","isTranslatable":true},{"baseUrl":"https://www.youtube.com/api/timedtext?v=${VIDEO_ID}\\u0026lang=de","name":{"simpleText":"Deutsch"},"languageCode":"de-DE"}]}}};</script>
</body></html>`;

const TRANSCRIPT_JSON = JSON.stringify({
  events: [
    { tStartMs: 0, segs: [{ utf8: 'We are no strangers to love.' }] },
    { tStartMs: 5200, segs: [{ utf8: 'You know the rules and so do I.' }] },
    { tStartMs: 8100, segs: [{ utf8: 'A full commitment is what I am thinking of.' }] }
  ]
});

function stubFetch(requests: string[] = []): FetchLike {
  return async (input: string) => {
    requests.push(input);
    if (input.includes('/watch')) {
      return new Response(WATCH_PAGE, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (input.includes('/api/timedtext')) {
      return new Response(TRANSCRIPT_JSON, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  };
}

describe('youtube watch-page ingestion', () => {
  it('parses caption tracks and the title out of the watch page', () => {
    const tracks = extractCaptionTracks(WATCH_PAGE);
    expect(tracks).toHaveLength(2);
    expect(tracks[0]?.languageCode).toBe('en');
    expect(tracks[0]?.baseUrl).toContain('signature=abc.def');
    expect(extractVideoTitle(WATCH_PAGE)).toBe('Rick Astley - Never Gonna Give You Up (Official Video)');
  });

  it('returns a non-empty transcript for a known public video', async () => {
    const requests: string[] = [];
    const result = await fetchTranscriptFromWatchPage(VIDEO_ID, { fetchImpl: stubFetch(requests) });
    expect(result.videoId).toBe(VIDEO_ID);
    expect(result.title).toContain('Never Gonna Give You Up');
    expect(result.segments.length).toBe(3);
    expect(result.segments[0]?.text).toBe('We are no strangers to love.');
    expect(requests.some((url) => url.includes('/watch?v=' + VIDEO_ID))).toBe(true);
    expect(requests.some((url) => url.includes('/api/timedtext'))).toBe(true);
  });

  it('reports NO_CAPTIONS when the page has no caption tracks', async () => {
    const noTracks: FetchLike = async () => new Response('<html><title>Some video - YouTube</title></html>');
    await expect(fetchTranscriptFromWatchPage(VIDEO_ID, { fetchImpl: noTracks })).rejects.toMatchObject({
      code: 'NO_CAPTIONS'
    });
  });
});

describe('youtube ingestion path (stubbed network)', () => {
  let db: Client;
  let notebookId: number;
  let token: string;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'yt-watch-')), 'yt.db'));
    await applySchema(db);
    const user = await createUser(db, { email: 'yt-watch@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    notebookId = (await createNotebook(db, user.id, 'Watch page notebook')).id;
    token = await createSession(db, user.id);
  });

  afterAll(async () => {
    await db.close();
  });

  it('stores non-empty transcript text for a known public video', async () => {
    const { youtubeSourceCreate } = await import('./youtube');
    const res = await youtubeSourceCreate(
      db,
      await new Request(`http://x/api/notebooks/${notebookId}/sources`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `sl_session=${token}` },
        body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${VIDEO_ID}` })
      }),
      String(notebookId),
      (videoId) => fetchTranscriptFromWatchPage(videoId, { fetchImpl: stubFetch() })
    );

    expect(res.status).toBe(201);
    const sources = await listSources(db, notebookId);
    const source = sources.find((item) => item.kind === 'youtube');
    expect(source?.title).toContain('Never Gonna Give You Up');
    const textResult = await db.execute({
      sql: 'SELECT text FROM sources WHERE id = ?',
      args: [source!.id]
    });
    const text = String(textResult.rows[0]?.['text'] ?? '');
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('We are no strangers to love.');
  });
});