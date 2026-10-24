import type { Client } from '@libsql/client';
import { type } from 'arktype';
import { NextResponse } from 'next/server';
import { hashPassword } from './crypto';
import { createUser, listUsers, setUserDisabled } from './repo';
import { errorResponse, requireAdmin } from './auth';

const MIN_PASSWORD_LENGTH = 12;

const NewUserBody = type({
  email: 'string.email',
  password: 'string',
  'role?': "'admin' | 'user'"
});

const DisableBody = type({
  disabled: 'boolean'
});

export async function adminListUsers(db: Client, req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(db, req);
  } catch (error) {
    return errorResponse(error);
  }
  return NextResponse.json(await listUsers(db));
}

export async function adminCreateUser(db: Client, req: Request): Promise<NextResponse> {
  let guardError: unknown;
  try {
    await requireAdmin(db, req);
  } catch (error) {
    guardError = error;
  }
  if (guardError) {
    return errorResponse(guardError);
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const body = NewUserBody(parsedBody);
  if (body instanceof type.errors) {
    return NextResponse.json({ error: 'email, password and optional role required' }, { status: 400 });
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
      role: body.role ?? 'user'
    });
    return NextResponse.json({ id: user.id, email: user.email, role: user.role }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'email already registered' }, { status: 409 });
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string }).code ?? '';
  return code.startsWith('SQLITE_CONSTRAINT') && /\bUNIQUE\b/i.test((error as Error).message ?? '');
}

export async function adminSetDisabled(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
  try {
    await requireAdmin(db, req);
  } catch (error) {
    return errorResponse(error);
  }

  const id = Number(idRaw);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'unknown user' }, { status: 404 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const body = DisableBody(parsedBody);
  if (body instanceof type.errors) {
    return NextResponse.json({ error: 'disabled boolean required' }, { status: 400 });
  }

  const exists = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [id] });
  if (exists.rows.length === 0) {
    return NextResponse.json({ error: 'unknown user' }, { status: 404 });
  }

  await setUserDisabled(db, id, body.disabled);
  return NextResponse.json({ ok: true, disabled: body.disabled, id });
}
