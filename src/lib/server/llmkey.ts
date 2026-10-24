import type { Client } from '@libsql/client';
import { type } from 'arktype';
import { NextResponse } from 'next/server';
import { decryptSecret, encryptSecret } from './crypto';
import { errorResponse, requireUser } from './auth';

const MIN_KEY_LENGTH = 20;

interface KeyHandlerDeps {
  secretEnv: string;
}

const deps: KeyHandlerDeps = {
  secretEnv: 'ENCRYPTION_SECRET'
};

function encryptionSecret(): string {
  const secret = process.env[deps.secretEnv];
  if (!secret) {
    throw Object.assign(new Error('ENCRYPTION_SECRET is not configured'), { status: 500 });
  }
  return secret;
}

const PutKeyBody = type({
  key: 'string'
});

export async function saveUserKey(db: Client, userId: number, key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed.length < MIN_KEY_LENGTH) {
    throw Object.assign(new Error(`key must be at least ${MIN_KEY_LENGTH} characters`), { status: 400 });
  }
  const encrypted = encryptSecret(trimmed, encryptionSecret());
  await db.execute({
    sql: 'UPDATE users SET llm_key_encrypted = ? WHERE id = ?',
    args: [encrypted, userId]
  });
}

export async function clearUserKey(db: Client, userId: number): Promise<void> {
  await db.execute({
    sql: 'UPDATE users SET llm_key_encrypted = NULL WHERE id = ?',
    args: [userId]
  });
}

export async function loadUserPlainKey(db: Client, userId: number): Promise<string | null> {
  const result = await db.execute({ sql: 'SELECT llm_key_encrypted FROM users WHERE id = ?', args: [userId] });
  const blob = result.rows[0]?.llm_key_encrypted;
  if (blob == null) {
    return null;
  }
  return decryptSecret(String(blob), encryptionSecret());
}

export async function saveKey(db: Client, req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    const body = PutKeyBody(parsedBody);
    if (body instanceof type.errors) {
      return NextResponse.json({ error: 'key string required' }, { status: 400 });
    }
    await saveUserKey(db, user.id, body.key);
    return NextResponse.json({ hasPersonalKey: true }, { status: 201 });
  } catch (error) {
    if (isHttpError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return errorResponse(error);
  }
}

export async function clearKey(db: Client, req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    await clearUserKey(db, user.id);
    return NextResponse.json({ hasPersonalKey: false });
  } catch (error) {
    return errorResponse(error);
  }
}

function isHttpError(error: unknown): error is Error & { status: number } {
  return error instanceof Error && typeof (error as { status?: unknown }).status === 'number';
}
