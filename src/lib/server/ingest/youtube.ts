import type { Client } from '@libsql/client';
import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from '../auth';
import { ownNotebook } from '../notebooks';
import { ingestTextSource } from './ingest';

export const YOUTUBE_URL_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com']);

export interface TranscriptSegment {
  text: string;
  startMs: number;
}

export interface FetchedTranscript {
  videoId: string;
  title: string;
  segments: TranscriptSegment[];
}

export type TranscriptFetcher = (videoId: string) => Promise<FetchedTranscript>;

export function extractVideoId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && /^[0-9A-Za-z_-]{5,20}$/.test(id) ? id : null;
  }
  if (YOUTUBE_URL_HOSTS.has(host)) {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v');
      return id && /^[0-9A-Za-z_-]{5,20}$/.test(id) ? id : null;
    }
    const shorts = url.pathname.match(/^\/shorts\/([0-9A-Za-z_-]{5,20})/);
    return shorts?.[1] ?? null;
  }
  return null;
}

export function parseTranscriptText(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function youtubeFailure(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

let innertube: Promise<import('youtubei.js').Innertube> | null = null;

function getInnertube(): Promise<import('youtubei.js').Innertube> {
  if (!innertube) {
    innertube = import('youtubei.js')
      .then(({ Innertube }) => Innertube.create())
      .catch((error) => {
        innertube = null; // retry on next request
        throw error;
      });
  }
  return innertube;
}

async function realFetchTranscript(videoId: string): Promise<FetchedTranscript> {
  const yt = await getInnertube();
  const info = await yt.getInfo(videoId);
  if (!info) {
    throw youtubeFailure('NO_TRANSCRIPT', 'video not found');
  }
  const title = info.basic_info?.title ?? 'YouTube video';

  const tracks = info.captions?.caption_tracks ?? [];
  const track = tracks.find((candidate) => candidate.language_code?.toLowerCase().startsWith('en')) ?? tracks[0];
  if (!track) {
    throw youtubeFailure('NO_TRANSCRIPT', 'no transcript available for this video');
  }

  const res = await fetch(`${track.base_url}&fmt=json3`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw youtubeFailure('NO_TRANSCRIPT', `transcript request failed (${res.status})`);
  }
  const raw = await res.text();
  if (raw.trim().length === 0) {
    throw youtubeFailure('NO_TRANSCRIPT', 'no transcript available for this video');
  }
  let json: { events?: Array<{ tStartMs?: number; segs?: Array<{ utf8: string }> }> };
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    throw youtubeFailure('NO_TRANSCRIPT', 'transcript response could not be parsed');
  }
  const segments: TranscriptSegment[] = [];
  for (const event of json.events ?? []) {
    const text = (event.segs ?? []).map((seg) => seg.utf8 ?? '').join(' ').replace(/\s+/g, ' ').trim();
    if (text.length > 0) {
      segments.push({ text, startMs: event.tStartMs ?? 0 });
    }
  }
  if (segments.length === 0) {
    throw youtubeFailure('NO_TRANSCRIPT', 'no transcript available for this video');
  }

  return { videoId, title, segments };
}

const FETCH_TIMEOUT_MS = 45_000;

async function timedFetchTranscript(videoId: string, fetchTranscript: TranscriptFetcher): Promise<FetchedTranscript> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fetchTranscript(videoId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(youtubeFailure('TIMEOUT', 'transcript fetch timed out')), FETCH_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const statusForCode: Record<string, number> = {
  NO_TRANSCRIPT: 502,
  TIMEOUT: 504,
  LIMIT_REACHED: 409
};

export async function youtubeSourceCreate(
  db: Client,
  req: Request,
  idRaw: string,
  fetchTranscript: TranscriptFetcher = realFetchTranscript
): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    const notebookId = Number(idRaw);
    if (!Number.isInteger(notebookId)) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }
    const notebook = await ownNotebook(db, user.id, notebookId);
    if (!notebook) {
      return NextResponse.json({ error: 'unknown notebook' }, { status: 404 });
    }

    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const url = typeof (parsedBody as { url?: unknown })?.url === 'string' ? (parsedBody as { url: string }).url : '';
    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json({ error: 'a YouTube video URL is required' }, { status: 400 });
    }

    const fetched = await timedFetchTranscript(videoId, fetchTranscript);
    const lastStartMs = fetched.segments.reduce((max, segment) => Math.max(max, segment.startMs), 0);
    const durationMin = Math.max(1, Math.round(lastStartMs / 60_000));
    const result = await ingestTextSource(db, {
      notebookId,
      title: fetched.title,
      text: parseTranscriptText(fetched.segments),
      url,
      kind: 'youtube'
    });
    await db.execute({
      sql: 'UPDATE sources SET meta = ? WHERE id = ?',
      args: [`${durationMin} min · ${result.chunks} chunks`, result.id]
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && statusForCode[code]) {
      return NextResponse.json({ error: (error as Error).message }, { status: statusForCode[code]! });
    }
    return errorResponse(error);
  }
}
