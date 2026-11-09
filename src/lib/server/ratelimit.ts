import type { Client } from '@libsql/client';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
// Expired rows are purged on roughly 1 in 50 writes so the table stays small
// without needing a cron job.
const PURGE_PROBABILITY = 0.02;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  /** Attempts allowed per window. */
  max?: number;
  windowMs?: number;
  /** Injectable clock for tests. */
  now?: number;
}

/**
 * Trusted-proxy aware client IP.
 *
 * X-Forwarded-For is client-controlled except for the entries your own proxies
 * append. With TRUST_PROXY_HOPS=N (the number of proxies in front of the app),
 * the Nth address from the right is used, which a client cannot forge. Without
 * it, the leftmost entry is used (fine behind Vercel, which overwrites the
 * header, but spoofable behind a proxy that appends).
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((part) => part.trim()).filter(Boolean);
    const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
    if (Number.isInteger(hops) && hops >= 1 && parts.length > 0) {
      return parts[Math.max(0, parts.length - hops)] ?? 'unknown';
    }
    return parts[0] ?? 'unknown';
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Counts one attempt against `key` and reports whether it is still allowed.
 *
 * State lives in the database, so every server instance (and every serverless
 * invocation) sees the same counters. The upsert is a single statement, so
 * concurrent requests cannot both read the same count.
 */
export async function rateLimit(
  db: Client,
  key: string,
  options: RateLimitOptions = {}
): Promise<RateLimitResult> {
  const now = options.now ?? Date.now();
  const max = options.max ?? MAX_ATTEMPTS;
  const windowMs = options.windowMs ?? WINDOW_MS;
  const resetAt = now + windowMs;

  const result = await db.execute({
    sql: `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET
            count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
            reset_at = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.reset_at END
          RETURNING count, reset_at`,
    args: [key, resetAt, now, now, resetAt]
  });

  if (Math.random() < PURGE_PROBABILITY) {
    await db
      .execute({ sql: 'DELETE FROM rate_limits WHERE reset_at <= ?', args: [now] })
      .catch(() => undefined);
  }

  const row = result.rows[0];
  const count = Number(row?.['count'] ?? 1);
  const bucketResetAt = Number(row?.['reset_at'] ?? resetAt);
  if (count > max) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucketResetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Read-only check: does not count as an attempt. */
export async function rateLimitStatus(
  db: Client,
  key: string,
  options: RateLimitOptions = {}
): Promise<RateLimitResult> {
  const now = options.now ?? Date.now();
  const max = options.max ?? MAX_ATTEMPTS;
  const result = await db.execute({
    sql: 'SELECT count, reset_at FROM rate_limits WHERE key = ?',
    args: [key]
  });
  const row = result.rows[0];
  if (!row) return { allowed: true, retryAfterSeconds: 0 };
  const resetAt = Number(row['reset_at']);
  if (resetAt <= now || Number(row['count']) < max) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
}

export async function clearRateLimit(db: Client, key: string): Promise<void> {
  await db.execute({ sql: 'DELETE FROM rate_limits WHERE key = ?', args: [key] });
}

export async function resetRateLimits(db: Client): Promise<void> {
  await db.execute('DELETE FROM rate_limits');
}
