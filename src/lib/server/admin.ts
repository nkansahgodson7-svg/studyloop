import type { Client } from '@libsql/client';
import { type } from 'arktype';
import { NextResponse } from 'next/server';
import { hashPassword } from './crypto';
import { createUser, isUniqueViolation, listUsers, setUserDisabled } from './repo';
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

export interface DayCount {
  date: string;
  count: number;
}

export interface AdminStats {
  users: { total: number; admins: number; disabled: number; newLast7d: number };
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
      sql: `SELECT COUNT(*) AS total FROM (
              SELECT nb.user_id AS uid
                FROM review_log rl
                JOIN cards c ON c.id = rl.card_id
                JOIN notebooks nb ON nb.id = c.notebook_id
               WHERE rl.graded_at >= ?
              UNION
              SELECT nb.user_id AS uid
                FROM chat_messages m
                JOIN notebooks nb ON nb.id = m.notebook_id
               WHERE m.role = 'user' AND m.created_at >= ?
            )`,
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
      newLast7d: num(users?.['newLast7d'])
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
      activeUsers7d: num(active?.['total'])
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
