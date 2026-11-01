import { randomBytes } from 'node:crypto';
import type { Client } from '@libsql/client';
import { type } from 'arktype';
import { NextResponse } from 'next/server';
import { hashPassword } from './crypto';
import {
  countAdmins,
  createUser,
  deleteUser,
  isUniqueViolation,
  listUsers,
  revokeAllSessionsForUser,
  setUserDisabled,
  updateUserPassword
} from './repo';
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

function parseUserId(idRaw: string): number | null {
  const id = Number(idRaw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function findTargetUser(
  db: Client,
  id: number
): Promise<{ id: number; email: string; role: 'admin' | 'user' } | null> {
  const result = await db.execute({
    sql: 'SELECT id, email, role FROM users WHERE id = ?',
    args: [id]
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: Number(row['id']),
    email: String(row['email']),
    role: row['role'] === 'admin' ? 'admin' : 'user'
  };
}

/** 19 characters, URL-safe, and long enough for the 12-character minimum. */
export function temporaryPassword(): string {
  return `sl-${randomBytes(12).toString('base64url')}`;
}

export async function adminResetPassword(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
  try {
    await requireAdmin(db, req);
  } catch (error) {
    return errorResponse(error);
  }

  const id = parseUserId(idRaw);
  if (id === null) {
    return NextResponse.json({ error: 'unknown user' }, { status: 404 });
  }
  const target = await findTargetUser(db, id);
  if (!target) {
    return NextResponse.json({ error: 'unknown user' }, { status: 404 });
  }

  const password = temporaryPassword();
  await updateUserPassword(db, id, await hashPassword(password));
  await revokeAllSessionsForUser(db, id);
  return NextResponse.json({
    ok: true,
    id,
    email: target.email,
    temporaryPassword: password
  });
}

export async function adminDeleteUser(db: Client, req: Request, idRaw: string): Promise<NextResponse> {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin(db, req);
  } catch (error) {
    return errorResponse(error);
  }

  const id = parseUserId(idRaw);
  if (id === null) {
    return NextResponse.json({ error: 'unknown user' }, { status: 404 });
  }
  if (id === admin.id) {
    return NextResponse.json({ error: 'you cannot delete your own account' }, { status: 400 });
  }

  const target = await findTargetUser(db, id);
  if (!target) {
    return NextResponse.json({ error: 'unknown user' }, { status: 404 });
  }
  if (target.role === 'admin' && (await countAdmins(db)) <= 1) {
    return NextResponse.json({ error: 'cannot delete the last admin' }, { status: 400 });
  }

  await deleteUser(db, id);
  return NextResponse.json({ ok: true, id });
}

export interface DayCount {
  date: string;
  count: number;
}

export interface AdminStats {
  users: { total: number; admins: number; disabled: number; newLast7d: number; atRisk: number };
  content: { notebooks: number; sources: number; cards: number };
  activity: { reviews: number; dueNow: number; chatPrompts: number; activeUsers7d: number };
  series: { signups: DayCount[]; reviews: DayCount[] };
}

const SERIES_DAYS = 14;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Every day of the window, oldest first, with missing days at zero. */
function zeroFill(rows: Array<Record<string, unknown>>, days: number): DayCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(String(row['day']), num(row['n']));
  }
  const out: DayCount[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date, count: counts.get(date) ?? 0 });
  }
  return out;
}

/**
 * Headline numbers for the admin dashboard. Read-only aggregate queries —
 * no per-user rows, no secrets, and every count is a cheap indexed scan.
 */
export async function computeAdminStats(db: Client): Promise<AdminStats> {
  const since7 = isoDaysAgo(7);
  const since14 = isoDaysAgo(SERIES_DAYS);
  const now = new Date().toISOString();

  const [userRow, contentRow, activityRow, activeRow, signupRows, reviewRows] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) AS total,
              SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins,
              SUM(CASE WHEN disabled = 1 THEN 1 ELSE 0 END) AS disabled,
              SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS newLast7d
            FROM users`,
      args: [since7]
    }),
    db.execute({
      sql: `SELECT (SELECT COUNT(*) FROM notebooks) AS notebooks,
                   (SELECT COUNT(*) FROM sources) AS sources,
                   (SELECT COUNT(*) FROM cards) AS cards`
    }),
    db.execute({
      sql: `SELECT (SELECT COUNT(*) FROM review_log) AS reviews,
                   (SELECT COUNT(*) FROM chat_messages WHERE role = 'user') AS chat_prompts,
                   (SELECT COUNT(*) FROM reviews WHERE due <= ?) AS due_now`,
      args: [now]
    }),
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
            ),
            counted AS (
              SELECT u.id, u.disabled, a.last_active
                FROM users u LEFT JOIN activity a ON a.uid = u.id
            )
            SELECT
              SUM(CASE WHEN disabled = 0 AND last_active >= ? THEN 1 ELSE 0 END) AS active7d,
              SUM(CASE WHEN disabled = 0 AND (last_active IS NULL OR last_active < ?) THEN 1 ELSE 0 END) AS at_risk
              FROM counted`,
      args: [since7, since7]
    }),
    db.execute({
      sql: `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n
            FROM users WHERE created_at >= ? GROUP BY day`,
      args: [since14]
    }),
    db.execute({
      sql: `SELECT substr(graded_at, 1, 10) AS day, COUNT(*) AS n
            FROM review_log WHERE graded_at >= ? GROUP BY day`,
      args: [since14]
    })
  ]);

  const users = userRow.rows[0];
  const content = contentRow.rows[0];
  const activity = activityRow.rows[0];
  const active = activeRow.rows[0];

  return {
    users: {
      total: num(users?.['total']),
      admins: num(users?.['admins']),
      disabled: num(users?.['disabled']),
      newLast7d: num(users?.['newLast7d']),
      atRisk: num(active?.['at_risk'])
    },
    content: {
      notebooks: num(content?.['notebooks']),
      sources: num(content?.['sources']),
      cards: num(content?.['cards'])
    },
    activity: {
      reviews: num(activity?.['reviews']),
      dueNow: num(activity?.['due_now']),
      chatPrompts: num(activity?.['chat_prompts']),
      activeUsers7d: num(active?.['active7d'])
    },
    series: {
      signups: zeroFill(signupRows.rows as Array<Record<string, unknown>>, SERIES_DAYS),
      reviews: zeroFill(reviewRows.rows as Array<Record<string, unknown>>, SERIES_DAYS)
    }
  };
}

export async function adminStats(db: Client, req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(db, req);
  } catch (error) {
    return errorResponse(error);
  }
  try {
    return NextResponse.json(await computeAdminStats(db));
  } catch (error) {
    return errorResponse(error);
  }
}
