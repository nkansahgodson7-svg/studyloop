import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'sl_session';
const FORCE_CHANGE_PATH = '/change-password';
const PUBLIC_PATHS = new Set(['/login', '/signup', '/account-disabled']);

interface SessionState {
  valid: boolean;
  mustChangePassword: boolean;
}

/**
 * A cookie only proves a session *was* issued. Disabled accounts and expired
 * sessions keep their cookie until it is cleared, so validate before treating
 * the visitor as signed in. Otherwise `/login` bounces them back to `/`, the
 * page's 401 handler sends them to `/login`, and the app flickers on skeletons
 * forever.
 */
async function sessionState(req: NextRequest): Promise<SessionState> {
  const cookie = req.headers.get('cookie');
  if (!cookie) return { valid: false, mustChangePassword: false };
  try {
    const res = await fetch(new URL('/api/auth/me', req.url), {
      headers: { cookie, accept: 'application/json' },
      cache: 'no-store'
    });
    if (!res.ok) return { valid: false, mustChangePassword: false };
    const body = (await res.json().catch(() => null)) as
      | { mustChangePassword?: boolean }
      | null;
    return { valid: true, mustChangePassword: Boolean(body?.mustChangePassword) };
  } catch {
    return { valid: false, mustChangePassword: false };
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (PUBLIC_PATHS.has(pathname)) {
    if (!hasSession) {
      return NextResponse.next();
    }
    const state = await sessionState(req);
    if (state.valid) {
      return NextResponse.redirect(
        new URL(state.mustChangePassword ? FORCE_CHANGE_PATH : '/', req.url)
      );
    }
    const res = NextResponse.next();
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (!hasSession) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  const state = await sessionState(req);
  if (!state.valid) {
    const res = NextResponse.redirect(new URL('/login', req.url));
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }
  if (state.mustChangePassword && pathname !== FORCE_CHANGE_PATH) {
    return NextResponse.redirect(new URL(FORCE_CHANGE_PATH, req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next|icon|favicon.ico|.*\\.).*)']
};
