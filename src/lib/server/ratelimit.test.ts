import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySchema, makeLocalDb } from '../db';
import {
  clearRateLimit,
  clientIp,
  rateLimit,
  rateLimitResponse,
  rateLimitStatus,
  resetRateLimits
} from './ratelimit';

describe('rateLimit (database-backed)', () => {
  let dir: string;
  let db: Client;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'studyloop-ratelimit-'));
    db = makeLocalDb(join(dir, 'ratelimit.db'));
    await applySchema(db);
  });

  beforeEach(async () => {
    await resetRateLimits(db);
  });

  afterAll(async () => {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('allows five attempts per window and blocks the sixth', async () => {
    const now = 1_000_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await rateLimit(db, 'signup:1.2.3.4', { now })).allowed).toBe(true);
    }
    const blocked = await rateLimit(db, 'signup:1.2.3.4', { now });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets the bucket after the window elapses', async () => {
    const now = 1_000_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await rateLimit(db, 'signup:5.6.7.8', { now });
    }
    expect((await rateLimit(db, 'signup:5.6.7.8', { now })).allowed).toBe(false);
    expect((await rateLimit(db, 'signup:5.6.7.8', { now: now + 15 * 60 * 1000 + 1 })).allowed).toBe(true);
  });

  it('tracks separate keys independently', async () => {
    const now = 1_000_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await rateLimit(db, 'signup:9.9.9.9', { now });
    }
    expect((await rateLimit(db, 'signup:9.9.9.9', { now })).allowed).toBe(false);
    expect((await rateLimit(db, 'signup:8.8.8.8', { now })).allowed).toBe(true);
  });

  it('honours a custom max', async () => {
    const now = 1_000_000;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await rateLimit(db, 'k', { now, max: 10 })).allowed).toBe(true);
    }
    expect((await rateLimit(db, 'k', { now, max: 10 })).allowed).toBe(false);
  });

  it('counts correctly under concurrent requests', async () => {
    const now = 1_000_000;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => rateLimit(db, 'burst', { now, max: 5 }))
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.filter((r) => !r.allowed)).toHaveLength(15);
  });

  it('rateLimitResponse returns null while allowed and a 429 with retry-after when spent', async () => {
    const now = 1_000_000;
    expect(await rateLimitResponse(db, 'gate', { now, max: 1 })).toBeNull();

    const res = await rateLimitResponse(db, 'gate', { now, max: 1 });
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await res?.json()).toMatchObject({ error: expect.stringContaining('too many') });
  });

  it('status does not consume an attempt and clear removes the bucket', async () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect((await rateLimitStatus(db, 'peek', { now })).allowed).toBe(true);
    }
    for (let i = 0; i < 5; i++) await rateLimit(db, 'peek', { now });
    expect((await rateLimitStatus(db, 'peek', { now })).allowed).toBe(false);

    await clearRateLimit(db, 'peek');
    expect((await rateLimitStatus(db, 'peek', { now })).allowed).toBe(true);
  });
});

describe('clientIp', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the first address in x-forwarded-for and falls back to 'unknown'", () => {
    const forwarded = new Request('http://x', {
      headers: { 'x-forwarded-for': '203.0.113.4, 10.0.0.1' }
    });
    expect(clientIp(forwarded)).toBe('203.0.113.4');
    expect(clientIp(new Request('http://x'))).toBe('unknown');
  });

  it('with TRUST_PROXY_HOPS, ignores client-forged leading entries', () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    // Attacker sends "1.1.1.1"; our single trusted proxy appends the real peer.
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.50' }
    });
    expect(clientIp(req)).toBe('203.0.113.50');
  });
});
