import type { Client } from '@libsql/client';
import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from '../auth';
import { ownNotebook } from '../notebooks';
import { ingestTextSource } from './ingest';
import { YOUTUBE_INGEST_LIMIT, rateLimitResponse } from '../ratelimit';

export const YOUTUBE_URL_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
  'music.youtube.com',
  'youtube-nocookie.com'
]);

export interface TranscriptSegment {
  text: string;
  startMs: number;
}

export interface FetchedTranscript {
  videoId: string;
  title: string;
  segments: TranscriptSegment[];
  durationSeconds?: number;
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

interface PlayerClient {
  name: string;
  version: string;
  userAgent: string;
  extra?: Record<string, string | number>;
}

/**
 * The web player's caption-track URLs carry `exp=xpe`, YouTube's
 * proof-of-origin guard. They answer 200 with an empty body outside a real
 * browser. The player endpoint answers mobile clients with ordinary signed
 * URLs, so we ask it first and fetch those instead.
 */
const PLAYER_CLIENTS: PlayerClient[] = [
  {
    name: 'IOS',
    version: '20.11.6',
    userAgent: 'com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)',
    extra: { deviceModel: 'iPhone10,4', osName: 'iOS', osVersion: '16.7.7.20H330' }
  },
  {
    name: 'ANDROID',
    version: '21.03.36',
    userAgent:
      'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip',
    extra: { androidSdkVersion: 36 }
  },
  // Cloud/Vercel egress is often challenged by the phone clients; the VR and
  // embedded-TV clients tend to answer without a proof-of-origin token.
  {
    name: 'ANDROID_VR',
    version: '1.60.19',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; en_US; Quest 3 Build/SQ3A.220605.009.A1) gzip',
    extra: {
      androidSdkVersion: 32,
      deviceModel: 'Quest 3',
      osName: 'Android',
      osVersion: '12'
    }
  },
  {
    name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    version: '2.0',
    userAgent:
      'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
    extra: { clientScreen: 'EMBED' }
  },
  {
    name: 'WEB_EMBEDDED_PLAYER',
    version: '1.20241120.01.00',
    userAgent: BROWSER_HEADERS['user-agent']!,
    extra: { clientScreen: 'EMBED' }
  }
];

const PLAYER_ENDPOINT = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

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
    if (url.pathname === '/watch' || url.pathname === '/watch/') {
      const id = url.searchParams.get('v');
      return id && /^[0-9A-Za-z_-]{5,20}$/.test(id) ? id : null;
    }
    // /shorts/, /live/, /embed/ and legacy /v/ URLs all put the id in the path.
    const pathId = url.pathname.match(/^\/(?:shorts|live|embed|v)\/([0-9A-Za-z_-]{5,20})(?:[/?]|$)/);
    return pathId?.[1] ?? null;
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

/**
 * One line per strategy attempt. YouTube's answer depends on the egress IP, so
 * when ingestion fails in a deployed environment these lines are the only way
 * to tell "the video has no captions" from "this server is being refused".
 */
function logAttempt(videoId: string, strategy: string, error: unknown): void {
  const code = (error as { code?: string })?.code ?? 'UNKNOWN';
  const message = (error as Error)?.message ?? String(error);
  console.warn(`[youtube] ${videoId} ${strategy}: ${code} — ${message}`);
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
 * `start` in the default format is seconds; srv3/`<p>` tags use `t` in ms.
 */
export function parseTimedTextXml(raw: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  const textRe = /<text\b[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = textRe.exec(raw)) !== null) {
    const startSeconds = parseFloat(match[1]!);
    const text = decodeXmlEntities(match[2]!)
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 0 && Number.isFinite(startSeconds)) {
      segments.push({ text, startMs: Math.round(startSeconds * 1000) });
    }
  }
  if (segments.length > 0) return segments;

  // srv3: <timedtext format="3"><body><p t="1200" d="2160">...</p>
  const paragraphRe = /<p\b[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  while ((match = paragraphRe.exec(raw)) !== null) {
    const startMs = Number(match[1]);
    const text = decodeXmlEntities(match[2]!)
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 0 && Number.isFinite(startMs)) {
      segments.push({ text, startMs });
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
    const match = timingLine.match(/(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})\s*-->/);
    if (!match) continue;
    const hours = Number(match[1] ?? 0);
    const startMs =
      (hours * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 + Number(match[4]);
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
// Videos can expose dozens of translated tracks; trying every one turns a
// single bad captions response into a minute-long request.
const MAX_TRACK_ATTEMPTS = 4;

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

async function fetchTrackText(
  baseUrl: string,
  format: string,
  fetchImpl: FetchLike,
  headers: Record<string, string> = BROWSER_HEADERS
): Promise<string> {
  const separator = baseUrl.includes('?') ? '&' : '?';
  const url = format ? `${baseUrl}${separator}fmt=${format}` : baseUrl;
  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, fetchImpl, {
    headers: { ...headers, referer: 'https://www.youtube.com/' }
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
async function fetchFromTrack(
  track: CaptionTrack,
  fetchImpl: FetchLike,
  headers?: Record<string, string>
): Promise<TranscriptSegment[]> {
  const base = trackBaseUrl(track);
  if (!base) throw youtubeFailure('NO_CAPTIONS', 'no transcript available for this video');

  const formats = ['json3', 'srv3', ''];
  for (const format of formats) {
    try {
      const raw = await fetchTrackText(base, format, fetchImpl, headers);
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

  const trackOrder = orderCaptionTracks(tracks, options.language ?? 'en').slice(0, MAX_TRACK_ATTEMPTS);
  for (const track of trackOrder) {
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

interface PlayerInfo {
  title: string;
  durationSeconds: number | null;
  tracks: CaptionTrack[];
}

interface PlayerResponseBody {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: { title?: string; lengthSeconds?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
}

async function fetchPlayerInfo(
  videoId: string,
  client: PlayerClient,
  fetchImpl: FetchLike
): Promise<PlayerInfo> {
  const res = await fetchWithTimeout(PLAYER_ENDPOINT, FETCH_TIMEOUT_MS, fetchImpl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': client.userAgent,
      'accept-language': 'en-US,en;q=0.9'
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: client.name,
          clientVersion: client.version,
          hl: 'en',
          gl: 'US',
          ...client.extra
        }
      },
      videoId
    })
  });
  if (!res.ok) {
    throw youtubeFailure('FETCH_FAILED', `video info request failed (${res.status})`);
  }

  let body: PlayerResponseBody;
  try {
    body = (await res.json()) as PlayerResponseBody;
  } catch {
    throw youtubeFailure('FETCH_FAILED', 'video info response was not valid JSON');
  }

  const status = body.playabilityStatus?.status;
  if (status && status !== 'OK') {
    const reason = body.playabilityStatus?.reason ?? '';
    // "Sign in to confirm you're not a bot" is about this server's IP, not the
    // video, so another client or strategy may still get the captions.
    if (status === 'LOGIN_REQUIRED' || /not a bot|sign in to confirm/i.test(reason)) {
      throw youtubeFailure('BOT_CHECK', reason || 'YouTube requires sign-in for this request');
    }
    // "YouTube is no longer supported in this application or device" is a
    // rejection of the client/version we sent, not of the video, so the next
    // client is worth trying.
    if (/no longer supported|update your (app|application|browser)|unsupported client/i.test(reason)) {
      throw youtubeFailure('CLIENT_REJECTED', reason);
    }
    throw youtubeFailure('NO_TRANSCRIPT', reason || 'video is not available for transcript extraction');
  }

  const length = Number(body.videoDetails?.lengthSeconds);
  return {
    title: body.videoDetails?.title?.trim() || 'YouTube video',
    durationSeconds: Number.isFinite(length) && length > 0 ? length : null,
    tracks: body.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  };
}

/**
 * Primary strategy: ask InnerTube's player endpoint as a mobile client. Its
 * caption URLs are plain signed timedtext links, so they work from server
 * egress instead of returning the web player's empty 200.
 */
export async function fetchTranscriptFromPlayer(
  videoId: string,
  options: { fetchImpl?: FetchLike; language?: string } = {}
): Promise<FetchedTranscript> {
  const fetchImpl = options.fetchImpl ?? (fetch as FetchLike);
  const language = options.language ?? 'en';
  let lastError: unknown;
  // Set when YouTube is refusing this server (bot check) or the client ids we
  // send are no longer accepted. Both are reported as BOT_CHECK so the route
  // can explain the block instead of leaking a client-specific message.
  let gated = false;

  for (const client of PLAYER_CLIENTS) {
    let info: PlayerInfo;
    try {
      info = await fetchPlayerInfo(videoId, client, fetchImpl);
    } catch (error) {
      logAttempt(videoId, client.name, error);
      const code = (error as { code?: string })?.code;
      if (code === 'BOT_CHECK' || code === 'CLIENT_REJECTED') {
        gated = true;
        lastError = error;
        continue;
      }
      // "Private video", "removed", age-gated: the same answer from every
      // client, so stop early.
      if (code === 'NO_TRANSCRIPT') {
        throw error;
      }
      lastError = error;
      continue;
    }

    if (info.tracks.length === 0) {
      logAttempt(videoId, client.name, youtubeFailure('NO_CAPTIONS', 'no caption tracks'));
      lastError = youtubeFailure('NO_CAPTIONS', 'no transcript available for this video');
      continue;
    }

    const headers = {
      'user-agent': client.userAgent,
      'accept-language': 'en-US,en;q=0.9'
    };
    const trackOrder = orderCaptionTracks(info.tracks, language).slice(0, MAX_TRACK_ATTEMPTS);
    for (const track of trackOrder) {
      try {
        const segments = await fetchFromTrack(track, fetchImpl, headers);
        if (segments.length > 0) {
          return {
            videoId,
            title: info.title,
            segments,
            durationSeconds: info.durationSeconds ?? undefined
          };
        }
      } catch {
        // try the next track
      }
    }
    logAttempt(videoId, client.name, youtubeFailure('NO_TRANSCRIPT', 'caption fetch failed'));
    lastError = youtubeFailure('NO_TRANSCRIPT', 'no transcript available for this video');
  }

  if (gated) {
    throw youtubeFailure('BOT_CHECK', 'YouTube rejected every client from this server');
  }
  const code = (lastError as { code?: string } | undefined)?.code;
  if (typeof code === 'string') throw lastError;
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
  let primaryError: unknown;
  try {
    return await fetchTranscriptFromPlayer(videoId);
  } catch (error) {
    primaryError = error;
    logAttempt(videoId, 'inner-tube-player', error);
    // A definite "this video is unavailable / has no transcript" answer is
    // worth returning immediately; the watch page and youtubei.js would only
    // repeat it. A bot check is about our IP, so keep falling back.
    const code = (error as { code?: string })?.code;
    if (code === 'NO_TRANSCRIPT') {
      throw error;
    }
  }

  try {
    return await fetchTranscriptFromWatchPage(videoId);
  } catch (watchError) {
    logAttempt(videoId, 'watch-page', watchError);
    const watchCode = (watchError as { code?: string })?.code;
    if (watchCode !== 'FETCH_FAILED' && watchCode !== 'NO_CAPTIONS') {
      throw watchError;
    }
  }

  try {
    return await fetchViaInnertube(videoId);
  } catch (fallbackError) {
    logAttempt(videoId, 'youtubei-js', fallbackError);
    // Prefer the bot-check answer: it is the one that tells the user what to do
    // (YouTube is blocking this server, not the video).
    if ((primaryError as { code?: string } | undefined)?.code === 'BOT_CHECK') {
      throw primaryError;
    }
    const fallbackCode = (fallbackError as { code?: string })?.code;
    throw fallbackCode ? fallbackError : primaryError;
  }
}

const statusForCode: Record<string, number> = {
  NO_TRANSCRIPT: 502,
  NO_CAPTIONS: 502,
  EMPTY_RESPONSE: 502,
  FETCH_FAILED: 502,
  BOT_CHECK: 502,
  CLIENT_REJECTED: 502,
  TIMEOUT: 504,
  LIMIT_REACHED: 409
};

const BLOCKED_MESSAGE =
  'YouTube is blocking transcript requests from this server right now. Open the video, copy its transcript, and add it with Paste text.';

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
    const durationSeconds = fetched.durationSeconds ?? lastStartMs / 1000;
    const durationMin = Math.max(1, Math.round(durationSeconds / 60));
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
      const message =
        code === 'BOT_CHECK' || code === 'CLIENT_REJECTED'
          ? BLOCKED_MESSAGE
          : (error as Error).message || 'no transcript available for this video';
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