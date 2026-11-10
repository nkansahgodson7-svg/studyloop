import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionCookie } from './lib/server/session-cookie';

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
 *
 * The cookie is signed, so this check needs no network call. Revocation and
 * disabled accounts are still enforced by the API layer on every data request,
 * which is what the pages ultimately depend on.
 */
async function sessionState(req: NextRequest): Promise<SessionState> {
  const value = req.cookies.get(SESSION_COOKIE)?.value;
  if (!value) return { valid: false, mustChangePassword: false };
  const session = await verifySessionCookie(value);
  if (!session) return { valid: false, mustChangePassword: false };
  return { valid: true, mustChangePassword: session.mustChangePassword };
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
  matcher: ['/((?!api|_next|icon|favicon.ico|.*\\\\.).*)']
};
