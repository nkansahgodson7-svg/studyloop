import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'sl_session';
const PUBLIC_PATHS = new Set(['/login', '/signup']);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (PUBLIC_PATHS.has(pathname)) {
    if (hasSession) {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next|icon|favicon.ico|.*\\.).*)']
};
