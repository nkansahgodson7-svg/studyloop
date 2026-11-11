// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import { signSessionCookie } from './lib/server/session-cookie';

const SECRET = 'middleware-test-secret-0123456789';

async function signedCookie(mustChangePassword = false, ttlMs = 60_000): Promise<string> {
  const value = await signSessionCookie({
    token: 'db-token',
    expiresAt: Date.now() + ttlMs,
    mustChangePassword
  });
  return value!;
}

function request(pathname: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    headers: cookie ? { cookie: `sl_session=${cookie}` } : {}
  });
}

function location(res: Response): string | null {
  return res.headers.get('location');
}

function passes(res: Response): boolean {
  return res.headers.get('x-middleware-next') === '1';
}

describe('middleware session gating', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    vi.stubEnv('ENCRYPTION_SECRET', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('redirects to /login when there is no cookie', async () => {
    const res = await middleware(request('/notebooks/1'));
    expect(location(res)).toBe('http://localhost/login');
  });

  it('lets a valid signed cookie through', async () => {
    expect(passes(await middleware(request('/notebooks/1', await signedCookie())))).toBe(true);
  });

  it('bounces a tampered or unsigned cookie to /login and clears it', async () => {
    const valid = await signedCookie();
    const [version, , signature] = valid.split('.');
    const forged = `${version}.${Buffer.from(
      JSON.stringify({ t: 'other-token', e: Date.now() + 60_000, m: 0 })
    ).toString('base64url')}.${signature}`;

    const tampered = await middleware(request('/notebooks/1', forged));
    expect(location(tampered)).toBe('http://localhost/login');
    expect(tampered.headers.get('set-cookie')).toContain('sl_session=');

    expect(location(await middleware(request('/notebooks/1', 'bare-legacy-token')))).toBe(
      'http://localhost/login'
    );
  });

  it('redirects an expired cookie to /login', async () => {
    const expired = await signedCookie(false, -1_000);
    expect(location(await middleware(request('/notebooks/1', expired)))).toBe(
      'http://localhost/login'
    );
  });

  it('sends a signed-in visitor away from public pages', async () => {
    expect(location(await middleware(request('/login', await signedCookie())))).toBe(
      'http://localhost/'
    );
  });

  it('forces the change-password screen until the flag clears', async () => {
    const pending = await signedCookie(true);
    expect(location(await middleware(request('/review', pending)))).toBe(
      'http://localhost/change-password'
    );
    expect(passes(await middleware(request('/change-password', pending)))).toBe(true);
  });
});
