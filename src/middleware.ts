import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'sl_session';
const FORCE_CHANGE_COOKIE = 'sl_force_change';
const FORCE_CHANGE_PATH = '/change-password';
const PUBLIC_PATHS = new Set(['/login', '/signup', '/account-disabled']);

/**
 * A cookie only proves a session *was* issued. Disabled accounts and expired
 * sessions keep their cookie until it is cleared, so validate before treating
 * the visitor as signed in. Otherwise `/login` bounces them back to `/`, the
 * page's 401 handler sends them to `/login`, and the app flickers on skeletons
 * forever.
 */
async function hasValidSession(req: NextRequest): Promise<boolean> {
  const cookie = req.headers.get('cookie');
  if (!cookie) return false;
  try {
    const res = await fetch(new URL('/api/auth/me', req.url), {
      headers: { cookie, accept: 'application/json' },
      cache: 'no-store'
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const mustChangePassword = req.cookies.get(FORCE_CHANGE_COOKIE)?.value === '1';

  if (PUBLIC_PATHS.has(pathname)) {
    if (!hasSession) {
      return NextResponse.next();
    }
    if (await hasValidSession(req)) {
      return NextResponse.redirect(new URL(mustChangePassword ? FORCE_CHANGE_PATH : '/', req.url));
    }
    const res = NextResponse.next();
    res.cookies.delete(SESSION_COOKIE);
    res.cookies.delete(FORCE_CHANGE_COOKIE);
    return res;
  }

  if (!hasSession) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (mustChangePassword && pathname !== FORCE_CHANGE_PATH) {
    return NextResponse.redirect(new URL(FORCE_CHANGE_PATH, req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next|icon|favicon.ico|.*\\.).*)']
};
