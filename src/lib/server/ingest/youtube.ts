import type { Client } from '@libsql/client';
import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from '../auth';
import { ownNotebook } from '../notebooks';
import { ingestTextSource } from './ingest';
import { YOUTUBE_INGEST_LIMIT, rateLimitResponse } from '../ratelimit';

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

// A caption track as exposed by YouTube's player response. Kept loose so it
// works both with youtubei.js objects and with plain fixtures.
export interface CaptionTrack {
  base_url?: string;
  baseUrl?: string;
  language_code?: string;
  languageCode?: string;
  kind?: string; // 'asr' for auto-generated
  name?: { simpleText?: string } | string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BROWSER_HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9'
};

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

function trackBaseUrl(track: CaptionTrack): string {
  return track.base_url ?? track.baseUrl ?? '';
}

function trackLanguage(track: CaptionTrack): string {
  return (track.language_code ?? track.languageCode ?? '').toLowerCase();
}

function trackKind(track: CaptionTrack): string {
  return (track.kind ?? '').toLowerCase();
}

/**
 * Pick the best caption track: prefer human-uploaded captions over
 * auto-generated ones, prefer the requested language (default English), and
 * fall back to whatever is available.
 */
export function selectCaptionTrack(
  tracks: CaptionTrack[] | null | undefined,
  preferredLanguage = 'en'
): CaptionTrack | null {
  if (!tracks || tracks.length === 0) return null;
  const lang = preferredLanguage.toLowerCase();
  const manual = tracks.filter((t) => trackKind(t) !== 'asr');
  const auto = tracks.filter((t) => trackKind(t) === 'asr');
  const matchLang = (list: CaptionTrack[]): CaptionTrack | undefined =>
    list.find((t) => trackLanguage(t).startsWith(lang)) ??
    list.find((t) => trackLanguage(t).startsWith('en')) ??
    list[0];
  return matchLang(manual) ?? matchLang(auto) ?? tracks[0] ?? null;
}

/** All tracks in preference order (requested language first, manual first). */
export function orderCaptionTracks(tracks: CaptionTrack[], preferredLanguage = 'en'): CaptionTrack[] {
  const lang = preferredLanguage.toLowerCase();
  const score = (track: CaptionTrack): number => {
    const language = trackLanguage(track);
    const manual = trackKind(track) !== 'asr';
    let value = 0;
    if (language.startsWith(lang)) value += 4;
    else if (language.startsWith('en')) value += 2;
    if (manual) value += 1;
    return value;
  };
  return [...tracks].sort((a, b) => score(b) - score(a));
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/**
 * Pull `captionTracks` out of the watch page's embedded player response.
 *
 * The JSON is scanned with a bracket/string-aware walker rather than a regex
 * because track entries contain URLs and translated names that can include
 * brackets and quotes.
 */
export function extractCaptionTracks(html: string): CaptionTrack[] {
  const marker = '"captionTracks":';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return [];
  const arrStart = html.indexOf('[', markerIndex + marker.length);
  if (arrStart < 0) return [];

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = arrStart; i < html.length; i += 1) {
    const ch = html[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        const raw = html.slice(arrStart, i + 1);
        try {
          const parsed = JSON.parse(raw) as unknown;
          return Array.isArray(parsed) ? (parsed as CaptionTrack[]) : [];
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

/** Extract the video title from the watch page HTML. */
export function extractVideoTitle(html: string): string | null {
  const details = html.match(/"videoDetails":\{[^}]*?"title":"((?:\\.|[^"\\])*)"/);
  if (details?.[1]) {
    const title = decodeJsonString(details[1]).trim();
    if (title.length > 0) return title;
  }
  const tag = html.match(/<title>([^<]*)<\/title>/i);
  if (tag?.[1]) {
    const title = decodeXmlEntities(tag[1]).replace(/\s*-\s*YouTube$/i, '').trim();
    if (title.length > 0) return title;
  }
  return null;
}

/** Parse a `json3` timedtext response into segments. */
export function parseJson3(raw: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let json: { events?: Array<{ tStartMs?: number; segs?: Array<{ utf8?: string }> }> };
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    return segments;
  }
  for (const event of json.events ?? []) {
    const text = (event.segs ?? [])
      .map((seg) => seg.utf8 ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 0) {
      segments.push({ text, startMs: event.tStartMs ?? 0 });
    }
  }
  return segments;
}

/**
 * Parse a `srv3` / default XML timedtext response into segments.
 * `start` in timedtext is seconds; convert to ms.
 */
export function parseTimedTextXml(raw: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const re = /<text\b[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const startSeconds = parseFloat(match[1]!);
    const text = decodeXmlEntities(match[2]!)
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 0 && Number.isFinite(startSeconds)) {
      segments.push({ text, startMs: Math.round(startSeconds * 1000) });
    }
  }
  return segments;
}

/** Parse a WebVTT response into segments (best-effort). */
export function parseVtt(raw: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const blocks = raw.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timingLine = lines.find((line) => line.includes('-->'));
    if (!timingLine) continue;
    const match = timingLine.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->/);
    if (!match) continue;
    const startMs =
      (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 + Number(match[4]);
    const textLines = lines.slice(lines.indexOf(timingLine) + 1);
    const text = decodeXmlEntities(textLines.join(' '))
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 0) {
      segments.push({ text, startMs });
    }
  }
  return segments;
}

function parseByFormat(raw: string, format: string): TranscriptSegment[] {
  if (format === 'json3') return parseJson3(raw);
  if (format === 'vtt') return parseVtt(raw);
  return parseTimedTextXml(raw);
}

const FETCH_TIMEOUT_MS = 30_000;
const OVERALL_TIMEOUT_MS = 45_000;

async function fetchWithTimeout(
  url: string,
  ms: number,
  fetchImpl: FetchLike,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTrackText(baseUrl: string, format: string, fetchImpl: FetchLike): Promise<string> {
  const separator = baseUrl.includes('?') ? '&' : '?';
  const url = format ? `${baseUrl}${separator}fmt=${format}` : baseUrl;
  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, fetchImpl, {
    headers: { ...BROWSER_HEADERS, referer: 'https://www.youtube.com/' }
  });
  if (!res.ok) {
    throw youtubeFailure('FETCH_FAILED', `transcript request failed (${res.status})`);
  }
  return res.text();
}

/**
 * Try to extract a transcript from a caption track, attempting several
 * formats until one yields segments.
 */
async function fetchFromTrack(track: CaptionTrack, fetchImpl: FetchLike): Promise<TranscriptSegment[]> {
  const base = trackBaseUrl(track);
  if (!base) throw youtubeFailure('NO_CAPTIONS', 'no transcript available for this video');

  const formats = ['json3', 'srv3', ''];
  for (const format of formats) {
    try {
      const raw = await fetchTrackText(base, format, fetchImpl);
      if (raw.trim().length === 0) continue;
      const segments = parseByFormat(raw, format === '' ? 'xml' : format);
      if (segments.length > 0) return segments;
    } catch {
      // try next format
    }
  }
  throw youtubeFailure('EMPTY_RESPONSE', 'no transcript available for this video');
}

/**
 * Primary strategy: fetch the watch page and read the signed caption-track
 * URLs from the embedded player response. Unlike a bare timedtext request,
 * these URLs carry the signature YouTube expects and work from most egresses.
 */
export async function fetchTranscriptFromWatchPage(
  videoId: string,
  options: { fetchImpl?: FetchLike; language?: string } = {}
): Promise<FetchedTranscript> {
  const fetchImpl = options.fetchImpl ?? (fetch as FetchLike);
  const pageUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`;
  const res = await fetchWithTimeout(pageUrl, FETCH_TIMEOUT_MS, fetchImpl, {
    headers: BROWSER_HEADERS
  });
  if (!res.ok) {
    throw youtubeFailure('FETCH_FAILED', `video page request failed (${res.status})`);
  }
  const html = await res.text();
  const title = extractVideoTitle(html) ?? 'YouTube video';
  const tracks = extractCaptionTracks(html);
  if (tracks.length === 0) {
    throw youtubeFailure('NO_CAPTIONS', 'no transcript available for this video');
  }

  for (const track of orderCaptionTracks(tracks, options.language ?? 'en')) {
    try {
      const segments = await fetchFromTrack(track, fetchImpl);
      if (segments.length > 0) {
        return { videoId, title, segments };
      }
    } catch {
      // try the next track
    }
  }
  throw youtubeFailure('NO_TRANSCRIPT', 'no transcript available for this video');
}

function normalizeSegments(
  raw: Array<{
    text?: string;
    snippet?: { text?: string } | string;
    start_ms?: string | number;
    startMs?: number;
    tStartMs?: number;
  }>
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const item of raw) {
    const textRaw = item.text ?? (typeof item.snippet === 'string' ? item.snippet : item.snippet?.text);
    const text = String(textRaw ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    let startMs = 0;
    if (typeof item.startMs === 'number') startMs = item.startMs;
    else if (typeof item.tStartMs === 'number') startMs = item.tStartMs;
    else if (item.start_ms != null) startMs = Number(item.start_ms);
    if (!Number.isFinite(startMs)) startMs = 0;
    segments.push({ text, startMs });
  }
  return segments;
}

let innertube: Promise<any> | null = null;

function getInnertube(): Promise<any> {
  if (!innertube) {
    innertube = import('youtubei.js')
      .then(({ Innertube }) => Innertube.create())
      .catch((error) => {
        innertube = null;
        throw error;
      });
  }
  return innertube;
}

/**
 * Fallback strategy: youtubei.js. Wrapped so a parser crash in the library
 * never takes down the request.
 */
async function fetchViaInnertube(videoId: string): Promise<FetchedTranscript> {
  let yt: any;
  try {
    yt = await getInnertube();
  } catch {
    throw youtubeFailure('FETCH_FAILED', 'could not initialize YouTube client');
  }

  let info: any;
  let title = 'YouTube video';
  try {
    info = await yt.getInfo(videoId);
    title = info?.basic_info?.title ?? title;
  } catch {
    try {
      const basic = await yt.getBasicInfo(videoId);
      title = basic?.basic_info?.title ?? title;
      info = basic;
    } catch {
      throw youtubeFailure('NO_TRANSCRIPT', 'video not found');
    }
  }

  const tracks: CaptionTrack[] = info?.captions?.caption_tracks ?? [];
  if (tracks.length > 0) {
    for (const track of orderCaptionTracks(tracks, 'en')) {
      try {
        const segments = await fetchFromTrack(track, fetch as FetchLike);
        if (segments.length > 0) return { videoId, title, segments };
      } catch {
        // continue
      }
    }
  }

  try {
    const t = info?.transcript;
    if (t?.content?.body?.initial_segments) {
      const segments = normalizeSegments(t.content.body.initial_segments);
      if (segments.length > 0) return { videoId, title, segments };
    }
  } catch {
    // ignore
  }

  throw youtubeFailure('NO_TRANSCRIPT', 'no transcript available for this video');
}

async function realFetchTranscript(videoId: string): Promise<FetchedTranscript> {
  try {
    return await fetchTranscriptFromWatchPage(videoId);
  } catch (primaryError) {
    // The watch-page path is the reliable one; only fall back when it could
    // not even read tracks, so a genuine no-captions result stays fast.
    const code = (primaryError as { code?: string })?.code;
    if (code !== 'FETCH_FAILED' && code !== 'NO_CAPTIONS') {
      throw primaryError;
    }
    try {
      return await fetchViaInnertube(videoId);
    } catch (fallbackError) {
      const fallbackCode = (fallbackError as { code?: string })?.code;
      throw fallbackCode ? fallbackError : primaryError;
    }
  }
}

const statusForCode: Record<string, number> = {
  NO_TRANSCRIPT: 502,
  NO_CAPTIONS: 502,
  EMPTY_RESPONSE: 502,
  FETCH_FAILED: 502,
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

    const limited = await rateLimitResponse(db, `ingest-youtube:${user.id}`, YOUTUBE_INGEST_LIMIT);
    if (limited) {
      return limited;
    }

    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const body = (parsedBody ?? {}) as { url?: unknown; language?: unknown };
    const url = typeof body.url === 'string' ? body.url : '';
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
      const message = (error as Error).message || 'no transcript available for this video';
      return NextResponse.json({ error: message, code }, { status: statusForCode[code]! });
    }
    return errorResponse(error);
  }
}

const timedFetchTranscript = async (
  videoId: string,
  fetchTranscript: TranscriptFetcher
): Promise<FetchedTranscript> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fetchTranscript(videoId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(youtubeFailure('TIMEOUT', 'transcript fetch timed out')), OVERALL_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};