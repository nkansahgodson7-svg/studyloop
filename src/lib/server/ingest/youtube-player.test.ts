// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  fetchTranscriptFromPlayer,
  parseTimedTextXml,
  parseVtt,
  type FetchLike
} from './youtube';

const VIDEO_ID = 'jNQXAC9IVRw';
const TRACK_URL = `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&hl=en&signature=abc.def`;

const PLAYER_RESPONSE = JSON.stringify({
  playabilityStatus: { status: 'OK' },
  videoDetails: { videoId: VIDEO_ID, title: 'Me at the zoo', lengthSeconds: '19' },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: TRACK_URL,
          languageCode: 'en',
          name: { simpleText: 'English' }
        }
      ]
    }
  }
});

const TRANSCRIPT_JSON = JSON.stringify({
  wireMagic: 'pb3',
  events: [
    { tStartMs: 1200, segs: [{ utf8: 'All right, so here we are, in front of the\nelephants' }] },
    { tStartMs: 5318, segs: [{ utf8: 'the cool thing about these guys is that they have really...' }] }
  ]
});

interface Captured {
  url: string;
  method?: string;
  body?: string;
  headers?: HeadersInit;
}

function stubPlayer(requests: Captured[] = []): FetchLike {
  return async (input: string, init?: RequestInit) => {
    requests.push({
      url: input,
      method: init?.method,
      body: typeof init?.body === 'string' ? init.body : undefined,
      headers: init?.headers
    });
    if (input.includes('/youtubei/v1/player')) {
      return new Response(PLAYER_RESPONSE, {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (input.includes('/api/timedtext')) {
      return new Response(TRANSCRIPT_JSON, {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response('not found', { status: 404 });
  };
}

describe('youtube player ingestion', () => {
  it('asks the mobile player endpoint for caption tracks and fetches them', async () => {
    const requests: Captured[] = [];
    const result = await fetchTranscriptFromPlayer(VIDEO_ID, { fetchImpl: stubPlayer(requests) });

    expect(result.videoId).toBe(VIDEO_ID);
    expect(result.title).toBe('Me at the zoo');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.startMs).toBe(1200);
    expect(result.segments[0]?.text).toContain('in front of the elephants');

    const playerRequest = requests.find((request) => request.url.includes('/youtubei/v1/player'));
    expect(playerRequest?.method).toBe('POST');
    const body = JSON.parse(playerRequest?.body ?? '{}');
    expect(body.videoId).toBe(VIDEO_ID);
    expect(body.context.client.clientName).toBe('IOS');

    const trackRequest = requests.find((request) => request.url.includes('/api/timedtext'));
    expect(trackRequest?.url).toContain('fmt=json3');
  });

  it('falls back past a bot-checked client instead of failing the request', async () => {
    const attempts: string[] = [];
    const gated: FetchLike = async (input: string, init?: RequestInit) => {
      if (input.includes('/youtubei/v1/player')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          context: { client: { clientName: string } };
        };
        const clientName = body.context.client.clientName;
        attempts.push(clientName);
        if (clientName === 'IOS') {
          return new Response(
            JSON.stringify({
              playabilityStatus: {
                status: 'LOGIN_REQUIRED',
                reason: "Sign in to confirm you're not a bot."
              }
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(PLAYER_RESPONSE, {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input.includes('/api/timedtext')) {
        return new Response(TRANSCRIPT_JSON, {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response('not found', { status: 404 });
    };

    const result = await fetchTranscriptFromPlayer(VIDEO_ID, { fetchImpl: gated });
    expect(result.segments).toHaveLength(2);
    expect(attempts[0]).toBe('IOS');
    expect(attempts.length).toBeGreaterThan(1);
  });

  it('treats a rejected client version as retryable, not as a missing transcript', async () => {
    const attempts: string[] = [];
    const rejected: FetchLike = async (input: string, init?: RequestInit) => {
      if (input.includes('/youtubei/v1/player')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          context: { client: { clientName: string } };
        };
        const clientName = body.context.client.clientName;
        attempts.push(clientName);
        if (clientName === 'IOS') {
          return new Response(
            JSON.stringify({
              playabilityStatus: {
                status: 'ERROR',
                reason: 'YouTube is no longer supported in this application or device.'
              }
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(PLAYER_RESPONSE, {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input.includes('/api/timedtext')) {
        return new Response(TRANSCRIPT_JSON, {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response('not found', { status: 404 });
    };

    const result = await fetchTranscriptFromPlayer(VIDEO_ID, { fetchImpl: rejected });
    expect(result.segments).toHaveLength(2);
    expect(attempts).toEqual(['IOS', 'ANDROID']);
  });

  it('reports BOT_CHECK when every client is gated or rejected', async () => {
    const allRejected: FetchLike = async () =>
      new Response(
        JSON.stringify({
          playabilityStatus: {
            status: 'ERROR',
            reason: 'YouTube is no longer supported in this application or device.'
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    await expect(fetchTranscriptFromPlayer(VIDEO_ID, { fetchImpl: allRejected })).rejects.toMatchObject({
      code: 'BOT_CHECK'
    });
  });

  it('reports BOT_CHECK when every client is bot-gated', async () => {
    const allGated: FetchLike = async () =>
      new Response(
        JSON.stringify({
          playabilityStatus: { status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot." }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    await expect(fetchTranscriptFromPlayer(VIDEO_ID, { fetchImpl: allGated })).rejects.toMatchObject({
      code: 'BOT_CHECK'
    });
  });

  it('reports NO_CAPTIONS when the player response has no tracks', async () => {
    const noTracks: FetchLike = async () =>
      new Response(JSON.stringify({ playabilityStatus: { status: 'OK' }, videoDetails: { title: 'x' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    await expect(fetchTranscriptFromPlayer(VIDEO_ID, { fetchImpl: noTracks })).rejects.toMatchObject({
      code: 'NO_CAPTIONS'
    });
  });
});

describe('timedtext parsers', () => {
  it('parses srv3 paragraph tracks', () => {
    const raw =
      '<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="1200" d="2160">All right, so here we are</p><p t="5318" d="2656">the cool thing about these guys</p></body></timedtext>';
    expect(parseTimedTextXml(raw)).toEqual([
      { text: 'All right, so here we are', startMs: 1200 },
      { text: 'the cool thing about these guys', startMs: 5318 }
    ]);
  });

  it('parses WebVTT timestamps without an hours component', () => {
    const raw = 'WEBVTT\n\n00:01.200 --> 00:03.360\nAll right, so here we are\n';
    expect(parseVtt(raw)).toEqual([{ text: 'All right, so here we are', startMs: 1200 }]);
  });
});
