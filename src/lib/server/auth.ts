import type { Client } from '@libsql/client';
import { type } from 'arktype';
import { NextResponse } from 'next/server';
import { hashPassword, verifyPassword, verifySecret } from './crypto';
import { clientIp, rateLimit } from './ratelimit';
import {
  createSession,
  createUser,
  findUserByEmail,
  findUserBySession,
  isUniqueViolation,
  revokeSession,
  type SessionUser,
  type UserRow
} from './repo';

export const SESSION_COOKIE = 'sl_session';

export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
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
  if (user.disabled) {
    throw new HttpError(403, 'account disabled', 'account_disabled');
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
    return NextResponse.json(
      { error: error.message, ...(error.code ? { code: error.code } : {}) },
      { status: error.status }
    );
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

const MIN_SIGNUP_PASSWORD_LENGTH = 8;

const Credentials = type({
  email: 'string.email',
  password: 'string'
});

const SignupBody = type({
  email: 'string.email',
  password: 'string',
  inviteCode: 'string'
});

async function issueSession(db: Client, user: UserRow, status = 200): Promise<NextResponse> {
  const token = await createSession(db, user.id);
  const res = NextResponse.json(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      hasPersonalKey: user.llmKeyEncrypted != null
    },
    { status }
  );
  res.cookies.set({ ...cookieBase, value: token, maxAge: SESSION_MAX_AGE });
  return res;
}

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

  return issueSession(db, user);
}

export async function signup(
  db: Client,
  req: Request,
  inviteCode = process.env.SIGNUP_INVITE_CODE
): Promise<NextResponse> {
  const gate = rateLimit(`signup:${clientIp(req)}`);
  if (!gate.allowed) {
    const res = NextResponse.json(
      { error: 'too many attempts — try again later' },
      { status: 429 }
    );
    res.headers.set('retry-after', String(gate.retryAfterSeconds));
    return res;
  }

  if (!inviteCode) {
    return NextResponse.json({ error: 'signup is closed' }, { status: 503 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const body = SignupBody(parsedBody);
  if (body instanceof type.errors) {
    return NextResponse.json(
      { error: 'email, password and invite code required' },
      { status: 400 }
    );
  }

  if (!verifySecret(body.inviteCode, inviteCode)) {
    return NextResponse.json({ error: 'invalid invite code' }, { status: 403 });
  }

  if (body.password.length < MIN_SIGNUP_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `password requires at least ${MIN_SIGNUP_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }

  try {
    const user = await createUser(db, {
      email: body.email,
      passwordHash: await hashPassword(body.password),
      role: 'user'
    });
    return issueSession(db, user, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'email already registered' }, { status: 409 });
    }
    throw error;
  }
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
