// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isSignedSessionCookie,
  signSessionCookie,
  verifySessionCookie
} from './session-cookie';

const SECRET = 'session-secret-for-tests-0123456789';

describe('session cookie envelope', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    vi.stubEnv('ENCRYPTION_SECRET', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips the token, expiry and forced-change flag', async () => {
    const expiresAt = Date.now() + 60_000;
    const value = await signSessionCookie({ token: 'abc123', expiresAt, mustChangePassword: true });
    expect(value).not.toBeNull();
    expect(isSignedSessionCookie(value!)).toBe(true);

    const parsed = await verifySessionCookie(value!);
    expect(parsed).toEqual({ token: 'abc123', expiresAt, mustChangePassword: true });
  });

  it('rejects a tampered payload', async () => {
    const value = (await signSessionCookie({
      token: 'abc123',
      expiresAt: Date.now() + 60_000,
      mustChangePassword: false
    }))!;
    const [version, body, signature] = value.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ t: 'someone-else', e: Date.now() + 60_000, m: 0 })
    ).toString('base64url');

    expect(forgedBody).not.toBe(body);
    expect(await verifySessionCookie([version, forgedBody, signature].join('.'))).toBeNull();
  });

  it('rejects a cookie signed with another secret', async () => {
    const value = (await signSessionCookie({
      token: 'abc123',
      expiresAt: Date.now() + 60_000,
      mustChangePassword: false
    }))!;
    vi.stubEnv('SESSION_SECRET', 'a-different-secret');
    expect(await verifySessionCookie(value)).toBeNull();
  });

  it('rejects an expired cookie', async () => {
    const value = (await signSessionCookie({
      token: 'abc123',
      expiresAt: 1_000,
      mustChangePassword: false
    }))!;
    expect(await verifySessionCookie(value, 1_001)).toBeNull();
    expect(await verifySessionCookie(value, 999)).not.toBeNull();
  });

  it('rejects malformed values and bare tokens', async () => {
    expect(await verifySessionCookie('not-a-cookie')).toBeNull();
    expect(await verifySessionCookie('v1.only-two-parts')).toBeNull();
    expect(isSignedSessionCookie('bare-session-token')).toBe(false);
  });

  it('falls back to ENCRYPTION_SECRET when SESSION_SECRET is unset', async () => {
    vi.stubEnv('SESSION_SECRET', '');
    vi.stubEnv('ENCRYPTION_SECRET', 'encryption-secret-for-tests');
    const value = await signSessionCookie({
      token: 'abc123',
      expiresAt: Date.now() + 60_000,
      mustChangePassword: false
    });
    expect(await verifySessionCookie(value!)).toMatchObject({ token: 'abc123' });
  });
});
