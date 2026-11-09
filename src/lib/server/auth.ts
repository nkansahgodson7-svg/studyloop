import type { Client } from '@libsql/client';
import { type } from 'arktype';
import { NextResponse } from 'next/server';
import { hashPassword, needsRehash, verifyPassword, verifySecret } from './crypto';
import { clearRateLimit, clientIp, rateLimit, rateLimitStatus } from './ratelimit';
import { MIN_PASSWORD_LENGTH } from '../password';
import {
  createSession,
  createUser,
  findUserByEmail,
  findUserBySession,
  getUser,
  isUniqueViolation,
  revokeOtherSessionsForUser,
  revokeSession,
  updateUserPassword,
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

const PASSWORD_CHANGE_ALLOWED_PATHS = new Set([
  '/api/auth/me',
  '/api/auth/change-password'
]);

function requestPathname(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return '';
  }
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
  if (
    user.mustChangePassword &&
    !PASSWORD_CHANGE_ALLOWED_PATHS.has(requestPathname(req))
  ) {
    throw new HttpError(403, 'password change required', 'password_change_required');
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

const Credentials = type({
  email: 'string.email',
  password: 'string'
});

const SignupBody = type({
  email: 'string.email',
  password: 'string',
  inviteCode: 'string'
});

const ChangePasswordBody = type({
  currentPassword: 'string',
  newPassword: 'string'
});

async function issueSession(db: Client, user: UserRow, status = 200): Promise<NextResponse> {
  const token = await createSession(db, user.id);
  const res = NextResponse.json(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      hasPersonalKey: user.llmKeyEncrypted != null,
      mustChangePassword: user.mustChangePassword
    },
    { status }
  );
  res.cookies.set({ ...cookieBase, value: token, maxAge: SESSION_MAX_AGE });
  return res;
}

// The account key deliberately ignores the IP: X-Forwarded-For can be forged,
// and an attacker rotating it must not get a fresh budget per guess. The
// trade-off is that someone can lock a known email out for one window.
const LOGIN_MAX_PER_ACCOUNT = 10;
const LOGIN_MAX_PER_IP = 30;

function tooManyAttempts(retryAfterSeconds: number): NextResponse {
  const res = NextResponse.json(
    { error: 'too many attempts — try again later' },
    { status: 429 }
  );
  res.headers.set('retry-after', String(retryAfterSeconds));
  return res;
}

// Verified against when the email is unknown, so response time does not reveal
// which addresses are registered.
let dummyHash: Promise<string> | null = null;

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
  const ip = clientIp(req);
  const accountKey = `login:acct:${email.toLowerCase()}`;
  const ipKey = `login:ip:${ip}`;
  const accountGate = await rateLimitStatus(db, accountKey, { max: LOGIN_MAX_PER_ACCOUNT });
  if (!accountGate.allowed) {
    return tooManyAttempts(accountGate.retryAfterSeconds);
  }
  const ipGate = await rateLimitStatus(db, ipKey, { max: LOGIN_MAX_PER_IP });
  if (!ipGate.allowed) {
    return tooManyAttempts(ipGate.retryAfterSeconds);
  }

  const user = await findUserByEmail(db, email);
  let valid: boolean;
  if (user) {
    valid = await verifyPassword(password, user.passwordHash);
  } else {
    dummyHash ??= hashPassword('studyloop-dummy-password');
    await verifyPassword(password, await dummyHash);
    valid = false;
  }
  if (!user || !valid) {
    // Only failures count toward the limits; a correct login resets them.
    await rateLimit(db, accountKey, { max: LOGIN_MAX_PER_ACCOUNT });
    await rateLimit(db, ipKey, { max: LOGIN_MAX_PER_IP });
    return NextResponse.json({ error: 'invalid email or password' }, { status: 401 });
  }
  await clearRateLimit(db, accountKey);
  if (needsRehash(user.passwordHash)) {
    // Transparently upgrade old hashes now that we hold the plaintext.
    await db.execute({
      sql: 'UPDATE users SET pw_hash = ? WHERE id = ?',
      args: [await hashPassword(password), user.id]
    });
  }
  if (user.disabled) {
    return NextResponse.json({ error: 'account disabled' }, { status: 403 });
  }
  if (user.passwordExpiresAt && new Date(user.passwordExpiresAt) <= new Date()) {
    return NextResponse.json(
      {
        error: 'temporary password expired — ask an admin to reset it',
        code: 'password_expired'
      },
      { status: 403 }
    );
  }

  return issueSession(db, user);
}

export async function signup(
  db: Client,
  req: Request,
  inviteCode = process.env.SIGNUP_INVITE_CODE
): Promise<NextResponse> {
  const gate = await rateLimit(db, `signup:${clientIp(req)}`);
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

  if (body.password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `password requires at least ${MIN_PASSWORD_LENGTH} characters` },
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

export async function changePassword(db: Client, req: Request): Promise<NextResponse> {
  let user: SessionUser;
  try {
    user = await requireUser(db, req);
    const gate = await rateLimit(db, `change-password:${user.id}`);
    if (!gate.allowed) {
      const res = NextResponse.json(
        { error: 'too many attempts — try again later' },
        { status: 429 }
      );
      res.headers.set('retry-after', String(gate.retryAfterSeconds));
      return res;
    }
  } catch (error) {
    return errorResponse(error);
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const body = ChangePasswordBody(parsedBody);
  if (body instanceof type.errors) {
    return NextResponse.json(
      { error: 'current password and new password required' },
      { status: 400 }
    );
  }
  if (body.newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `password requires at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }

  const record = await getUser(db, user.id);
  if (!(await verifyPassword(body.currentPassword, record.passwordHash))) {
    return NextResponse.json({ error: 'current password is incorrect' }, { status: 400 });
  }
  if (body.newPassword === body.currentPassword) {
    return NextResponse.json(
      { error: 'new password must be different from the current password' },
      { status: 400 }
    );
  }

  await updateUserPassword(db, user.id, await hashPassword(body.newPassword));
  const token = readSessionToken(req);
  if (token) {
    await revokeOtherSessionsForUser(db, user.id, token);
  }

  return NextResponse.json({ ok: true, role: user.role });
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
