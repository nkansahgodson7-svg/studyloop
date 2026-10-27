import { beforeEach, describe, expect, it } from 'vitest';
import { clientIp, rateLimit, resetRateLimits } from './ratelimit';

describe('rateLimit', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it('allows five attempts per window and blocks the sixth', () => {
    const now = 1_000_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(rateLimit('signup:1.2.3.4', now).allowed).toBe(true);
    }

    const blocked = rateLimit('signup:1.2.3.4', now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets the bucket after the window elapses', () => {
    const now = 1_000_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      rateLimit('signup:5.6.7.8', now);
    }
    expect(rateLimit('signup:5.6.7.8', now).allowed).toBe(false);

    expect(rateLimit('signup:5.6.7.8', now + 15 * 60 * 1000 + 1).allowed).toBe(true);
  });

  it('tracks separate keys independently', () => {
    const now = 1_000_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      rateLimit('signup:9.9.9.9', now);
    }

    expect(rateLimit('signup:9.9.9.9', now).allowed).toBe(false);
    expect(rateLimit('signup:8.8.8.8', now).allowed).toBe(true);
  });
});

describe('clientIp', () => {
  it("uses the first address in x-forwarded-for and falls back to 'unknown'", () => {
    const forwarded = new Request('http://x', {
      headers: { 'x-forwarded-for': '203.0.113.4, 10.0.0.1' }
    });
    expect(clientIp(forwarded)).toBe('203.0.113.4');

    expect(clientIp(new Request('http://x'))).toBe('unknown');
  });
});
