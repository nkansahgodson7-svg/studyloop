import type { Client } from '@libsql/client';
import { type } from 'arktype';
import { NextResponse } from 'next/server';
import { verifyPassword } from './crypto';
import { createSession, findUserByEmail, findUserBySession, revokeSession, type SessionUser } from './repo';

export const SESSION_COOKIE = 'sl_session';

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE && rest.length > 0) {
      return rest.join('=');
    }
  }
  return null;
}

export async function requireUser(db: Client, req: Request): Promise<SessionUser> {
  const token = readSessionToken(req);
  const user = token ? await findUserBySession(db, token, new Date()) : null;
  if (!token || !user) {
    throw new HttpError(401, 'authentication required');
  }
  return user;
}

export async function requireAdmin(db: Client, req: Request): Promise<SessionUser> {
  const user = await requireUser(db, req);
  if (user.role !== 'admin') {
    throw new HttpError(403, 'admin required');
  }
  return user;
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}

export const cookieBase = {
  name: SESSION_COOKIE,
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production'
};

const SESSION_MAX_AGE = 7 * 24 * 3600;

const Credentials = type({
  email: 'string.email',
  password: 'string'
});

export async function login(db: Client, req: Request): Promise<NextResponse> {
  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const credentials = Credentials(parsedBody);
  if (credentials instanceof type.errors) {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 });
  }

  const { email, password } = credentials;
  const user = await findUserByEmail(db, email);
  const valid = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !valid) {
    return NextResponse.json({ error: 'invalid email or password' }, { status: 401 });
  }
  if (user.disabled) {
    return NextResponse.json({ error: 'account disabled' }, { status: 403 });
  }

  const token = await createSession(db, user.id);
  const res = NextResponse.json({
    id: user.id,
    email: user.email,
    role: user.role,
    hasPersonalKey: user.llmKeyEncrypted != null
  });
  res.cookies.set({ ...cookieBase, value: token, maxAge: SESSION_MAX_AGE });
  return res;
}

export async function logout(db: Client, req: Request): Promise<NextResponse> {
  const token = readSessionToken(req);
  if (token) {
    await revokeSession(db, token);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ ...cookieBase, value: '', maxAge: 0 });
  return res;
}

export async function me(db: Client, req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    return NextResponse.json(user);
  } catch (error) {
    return errorResponse(error);
  }
}
