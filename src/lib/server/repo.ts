import type { Client, InValue } from '@libsql/client';
import { sessionToken } from './crypto';

export type UserRole = 'admin' | 'user';

export interface UserRow {
  id: number;
  email: string;
  passwordHash: string;
  llmKeyEncrypted: string | null;
  role: UserRole;
  disabled: boolean;
  createdAt: string;
}

export interface SessionUser {
  id: number;
  email: string;
  role: UserRole;
  hasPersonalKey: boolean;
}

export const SESSION_TTL_DAYS = 7;

export async function createUser(
  db: Client,
  input: { email: string; passwordHash: string; role: UserRole }
): Promise<UserRow> {
  const result = await db.execute({
    sql: 'INSERT INTO users (email, pw_hash, role) VALUES (?, ?, ?)',
    args: [input.email.toLowerCase(), input.passwordHash, input.role]
  });
  return getUser(db, Number(result.lastInsertRowid!));
}

export async function getUser(db: Client, id: number): Promise<UserRow> {
  const result = await db.execute({
    sql: 'SELECT id, email, pw_hash, llm_key_encrypted, role, disabled, created_at FROM users WHERE id = ?',
    args: [id]
  });
  const row = result.rows[0];
  if (!row) {
    throw new Error('user not found');
  }
  return rowToUser(row);
}

function rowToUser(row: Record<string, InValue>): UserRow {
  return {
    id: Number(row['id']),
    email: String(row['email']),
    passwordHash: String(row['pw_hash']),
    llmKeyEncrypted: (row['llm_key_encrypted'] as string | null) ?? null,
    role: row['role'] === 'admin' ? 'admin' : 'user',
    disabled: Number(row['disabled']) === 1,
    createdAt: String(row['created_at'])
  };
}

export async function findEnabledUserByEmail(db: Client, email: string): Promise<UserRow | null> {
  const result = await db.execute({
    sql: 'SELECT id, email, pw_hash, llm_key_encrypted, role, disabled, created_at FROM users WHERE email = ? AND disabled = 0',
    args: [email.toLowerCase()]
  });
  const row = result.rows[0];
  return row ? rowToUser(row) : null;
}

export async function findUserByEmail(db: Client, email: string): Promise<UserRow | null> {
  const result = await db.execute({
    sql: 'SELECT id, email, pw_hash, llm_key_encrypted, role, disabled, created_at FROM users WHERE email = ?',
    args: [email.toLowerCase()]
  });
  const row = result.rows[0];
  return row ? rowToUser(row) : null;
}

export async function createSession(db: Client, userId: number): Promise<string> {
  const token = sessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600e3).toISOString();
  await db.execute({
    sql: 'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
    args: [token, userId, expiresAt]
  });
  return token;
}

export async function findUserBySession(db: Client, token: string, now: Date): Promise<SessionUser | null> {
  const result = await db.execute({
    sql: `SELECT u.id, u.email, u.role, u.llm_key_encrypted
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.token = ? AND s.expires_at > ? AND u.disabled = 0`,
    args: [token, now.toISOString()]
  });
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: Number(row['id']),
    email: String(row['email']),
    role: row['role'] === 'admin' ? 'admin' : 'user',
    hasPersonalKey: row['llm_key_encrypted'] != null
  };
}

export async function revokeAllSessionsForUser(db: Client, userId: number): Promise<void> {
  await db.execute({ sql: 'DELETE FROM sessions WHERE user_id = ?', args: [userId] });
}

export async function revokeSession(db: Client, token: string): Promise<void> {
  await db.execute({ sql: 'DELETE FROM sessions WHERE token = ?', args: [token] });
}

export interface AdminUserRow {
  id: number;
  email: string;
  role: UserRole;
  disabled: boolean;
  createdAt: string;
}

export async function listUsers(db: Client): Promise<AdminUserRow[]> {
  const result = await db.execute({
    sql: 'SELECT id, email, role, disabled, created_at FROM users ORDER BY created_at, id',
    args: []
  });
  return result.rows.map((row) => ({
    id: Number(row['id']),
    email: String(row['email']),
    role: row['role'] === 'admin' ? 'admin' : 'user',
    disabled: Number(row['disabled']) === 1,
    createdAt: String(row['created_at'])
  }));
}

export async function setUserDisabled(db: Client, userId: number, disabled: boolean): Promise<void> {
  await db.execute({ sql: 'UPDATE users SET disabled = ? WHERE id = ?', args: [disabled ? 1 : 0, userId] });
  if (disabled) {
    await revokeAllSessionsForUser(db, userId);
  }
}

export async function deleteSource(db: Client, sourceId: number, userId: number): Promise<boolean> {
  const res = await db.execute({
    sql: 'DELETE FROM sources WHERE id = ? AND notebook_id IN (SELECT id FROM notebooks WHERE user_id = ?)',
    args: [sourceId, userId]
  });
  return (res.rowsAffected ?? 0) > 0;
}

export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string }).code ?? '';
  return code.startsWith('SQLITE_CONSTRAINT') && /\bUNIQUE\b/i.test((error as Error).message ?? '');
}
