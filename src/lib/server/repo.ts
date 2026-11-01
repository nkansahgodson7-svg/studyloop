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
  mustChangePassword: boolean;
  passwordExpiresAt: string | null;
  createdAt: string;
}

export interface SessionUser {
  id: number;
  email: string;
  role: UserRole;
  hasPersonalKey: boolean;
  disabled: boolean;
  mustChangePassword: boolean;
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
    sql: 'SELECT id, email, pw_hash, llm_key_encrypted, role, disabled, must_change_password, password_expires_at, created_at FROM users WHERE id = ?',
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
    mustChangePassword: Number(row['must_change_password']) === 1,
    passwordExpiresAt: (row['password_expires_at'] as string | null) ?? null,
    createdAt: String(row['created_at'])
  };
}

export async function findEnabledUserByEmail(db: Client, email: string): Promise<UserRow | null> {
  const result = await db.execute({
    sql: 'SELECT id, email, pw_hash, llm_key_encrypted, role, disabled, must_change_password, password_expires_at, created_at FROM users WHERE email = ? AND disabled = 0',
    args: [email.toLowerCase()]
  });
  const row = result.rows[0];
  return row ? rowToUser(row) : null;
}

export async function findUserByEmail(db: Client, email: string): Promise<UserRow | null> {
  const result = await db.execute({
    sql: 'SELECT id, email, pw_hash, llm_key_encrypted, role, disabled, must_change_password, password_expires_at, created_at FROM users WHERE email = ?',
    args: [email.toLowerCase()]
  });
  const row = result.rows[0];
  return row ? rowToUser(row) : null;
}

export async function createSession(db: Client, userId: number): Promise<string> {
  const token = sessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 3600e3).toISOString();
  await db.execute({
    sql: 'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    args: [token, userId, expiresAt, now.toISOString()]
  });
  return token;
}

export async function findUserBySession(db: Client, token: string, now: Date): Promise<SessionUser | null> {
  // Disabled accounts are returned so callers can explain *why* access was
  // denied; `requireUser` is responsible for rejecting them.
  const result = await db.execute({
    sql: `SELECT u.id, u.email, u.role, u.llm_key_encrypted, u.disabled,
                 u.must_change_password
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.token = ? AND s.expires_at > ?`,
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
    hasPersonalKey: row['llm_key_encrypted'] != null,
    disabled: Number(row['disabled']) === 1,
    mustChangePassword: Number(row['must_change_password']) === 1
  };
}

export async function revokeAllSessionsForUser(db: Client, userId: number): Promise<void> {
  await db.execute({ sql: 'DELETE FROM sessions WHERE user_id = ?', args: [userId] });
}

export async function revokeOtherSessionsForUser(
  db: Client,
  userId: number,
  keepToken: string
): Promise<void> {
  await db.execute({
    sql: 'DELETE FROM sessions WHERE user_id = ? AND token != ?',
    args: [userId, keepToken]
  });
}

export async function revokeSession(db: Client, token: string): Promise<void> {
  await db.execute({ sql: 'DELETE FROM sessions WHERE token = ?', args: [token] });
}

export interface AdminNotebookRow {
  id: number;
  title: string;
  createdAt: string;
  sources: number;
  cards: number;
}

export interface AdminUserRow {
  id: number;
  email: string;
  role: UserRole;
  disabled: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  counts: {
    notebooks: number;
    sources: number;
    cards: number;
    reviews: number;
    reviews7d: number;
    chats: number;
    generatedCards: number;
  };
  notebooks: AdminNotebookRow[];
}

export async function listUsers(db: Client): Promise<AdminUserRow[]> {
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [result, notebookResult] = await Promise.all([
    db.execute({
      sql: `WITH activity AS (
              SELECT events.uid AS uid, MAX(events.ts) AS last_active
                FROM (
                  SELECT nb.user_id AS uid, nb.created_at AS ts FROM notebooks nb
                  UNION ALL
                  SELECT nb.user_id AS uid, s.created_at AS ts
                    FROM sources s JOIN notebooks nb ON nb.id = s.notebook_id
                  UNION ALL
                  SELECT nb.user_id AS uid, c.created_at AS ts
                    FROM cards c JOIN notebooks nb ON nb.id = c.notebook_id
                  UNION ALL
                  SELECT nb.user_id AS uid, rl.graded_at AS ts
                    FROM review_log rl
                    JOIN cards c ON c.id = rl.card_id
                    JOIN notebooks nb ON nb.id = c.notebook_id
                  UNION ALL
                  SELECT nb.user_id AS uid, m.created_at AS ts
                    FROM chat_messages m JOIN notebooks nb ON nb.id = m.notebook_id
                   WHERE m.role = 'user'
                  UNION ALL
                  SELECT se.user_id AS uid, se.created_at AS ts
                    FROM sessions se WHERE se.created_at IS NOT NULL
                  UNION ALL
                  SELECT qa.user_id AS uid, qa.created_at AS ts FROM quiz_attempts qa
                ) events
              GROUP BY events.uid
            )
            SELECT u.id, u.email, u.role, u.disabled, u.created_at, a.last_active,
                   (SELECT COUNT(*) FROM notebooks nb WHERE nb.user_id = u.id) AS notebooks,
                   (SELECT COUNT(*) FROM sources s JOIN notebooks nb ON nb.id = s.notebook_id
                     WHERE nb.user_id = u.id) AS sources,
                   (SELECT COUNT(*) FROM cards c JOIN notebooks nb ON nb.id = c.notebook_id
                     WHERE nb.user_id = u.id) AS cards,
                   (SELECT COUNT(*) FROM review_log rl
                     JOIN cards c ON c.id = rl.card_id
                     JOIN notebooks nb ON nb.id = c.notebook_id
                     WHERE nb.user_id = u.id) AS reviews,
                   (SELECT COUNT(*) FROM review_log rl
                     JOIN cards c ON c.id = rl.card_id
                     JOIN notebooks nb ON nb.id = c.notebook_id
                     WHERE nb.user_id = u.id AND rl.graded_at >= ?) AS reviews7d,
                   (SELECT COUNT(*) FROM chat_messages m JOIN notebooks nb ON nb.id = m.notebook_id
                     WHERE nb.user_id = u.id AND m.role = 'user') AS chats,
                   (SELECT COUNT(*) FROM cards c JOIN notebooks nb ON nb.id = c.notebook_id
                     WHERE nb.user_id = u.id AND c.generated_at IS NOT NULL) AS generated_cards
              FROM users u
              LEFT JOIN activity a ON a.uid = u.id
             ORDER BY u.created_at, u.id`,
      args: [since7]
    }),
    db.execute({
      sql: `SELECT nb.id, nb.user_id, nb.title, nb.created_at,
                   (SELECT COUNT(*) FROM sources s WHERE s.notebook_id = nb.id) AS sources,
                   (SELECT COUNT(*) FROM cards c WHERE c.notebook_id = nb.id) AS cards
              FROM notebooks nb
             ORDER BY nb.created_at DESC, nb.id DESC`,
      args: []
    })
  ]);

  const notebooksByUser = new Map<number, AdminNotebookRow[]>();
  for (const row of notebookResult.rows) {
    const userId = Number(row['user_id']);
    const list = notebooksByUser.get(userId) ?? [];
    list.push({
      id: Number(row['id']),
      title: String(row['title']),
      createdAt: String(row['created_at']),
      sources: Number(row['sources'] ?? 0),
      cards: Number(row['cards'] ?? 0)
    });
    notebooksByUser.set(userId, list);
  }

  return result.rows.map((row) => {
    const id = Number(row['id']);
    return {
      id,
      email: String(row['email']),
      role: row['role'] === 'admin' ? 'admin' : 'user',
      disabled: Number(row['disabled']) === 1,
      createdAt: String(row['created_at']),
      lastActiveAt: row['last_active'] == null ? null : String(row['last_active']),
      counts: {
        notebooks: Number(row['notebooks'] ?? 0),
        sources: Number(row['sources'] ?? 0),
        cards: Number(row['cards'] ?? 0),
        reviews: Number(row['reviews'] ?? 0),
        reviews7d: Number(row['reviews7d'] ?? 0),
        chats: Number(row['chats'] ?? 0),
        generatedCards: Number(row['generated_cards'] ?? 0)
      },
      notebooks: notebooksByUser.get(id) ?? []
    };
  });
}

export async function updateUserPassword(
  db: Client,
  userId: number,
  passwordHash: string,
  options: { mustChangePassword?: boolean; passwordExpiresAt?: string | null } = {}
): Promise<void> {
  await db.execute({
    sql: `UPDATE users
          SET pw_hash = ?, must_change_password = ?, password_expires_at = ?
          WHERE id = ?`,
    args: [
      passwordHash,
      options.mustChangePassword ? 1 : 0,
      options.passwordExpiresAt ?? null,
      userId
    ]
  });
}

export async function countAdmins(db: Client): Promise<number> {
  const result = await db.execute("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0");
  return Number(result.rows[0]?.['n'] ?? 0);
}

/** Removes the user and every row they own, so deletes work even without FK pragmas. */
export async function deleteUser(db: Client, userId: number): Promise<boolean> {
  const notebookFilter = 'SELECT id FROM notebooks WHERE user_id = ?';
  const cardFilter = `SELECT c.id FROM cards c JOIN notebooks nb ON nb.id = c.notebook_id WHERE nb.user_id = ?`;
  const sourceFilter = `SELECT s.id FROM sources s JOIN notebooks nb ON nb.id = s.notebook_id WHERE nb.user_id = ?`;
  await db.batch([
    { sql: 'DELETE FROM quiz_attempts WHERE user_id = ?', args: [userId] },
    { sql: `DELETE FROM quiz_items WHERE notebook_id IN (${notebookFilter})`, args: [userId] },
    { sql: `DELETE FROM review_log WHERE card_id IN (${cardFilter})`, args: [userId] },
    { sql: `DELETE FROM reviews WHERE card_id IN (${cardFilter})`, args: [userId] },
    { sql: `DELETE FROM chat_messages WHERE notebook_id IN (${notebookFilter})`, args: [userId] },
    { sql: `DELETE FROM source_chunks WHERE source_id IN (${sourceFilter})`, args: [userId] },
    { sql: `DELETE FROM cards WHERE notebook_id IN (${notebookFilter})`, args: [userId] },
    { sql: `DELETE FROM sources WHERE notebook_id IN (${notebookFilter})`, args: [userId] },
    { sql: 'DELETE FROM notebooks WHERE user_id = ?', args: [userId] },
    { sql: 'DELETE FROM sessions WHERE user_id = ?', args: [userId] },
    { sql: 'DELETE FROM users WHERE id = ?', args: [userId] }
  ]);
  const check = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [userId] });
  return check.rows.length === 0;
}

export async function setUserDisabled(db: Client, userId: number, disabled: boolean): Promise<void> {
  await db.execute({ sql: 'UPDATE users SET disabled = ? WHERE id = ?', args: [disabled ? 1 : 0, userId] });
  // Sessions are kept while disabled so requests can report the real reason
  // (an "account disabled" screen instead of a silent sign-out). On re-enable
  // they are purged, so access always requires a fresh login.
  if (!disabled) {
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
