import type { Client } from '@libsql/client';
import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from './auth';
import { streakDaysForUser } from './cards';

export interface UserSummary {
  streak: number;
  dueTotal: number;
  cardsTotal: number;
  mastery: number;
  reviewedToday: number;
}

export async function userSummary(db: Client, userId: number, now: Date): Promise<UserSummary> {
  const nowISO = now.toISOString();
  const [streak, counts, reviewed] = await Promise.all([
    streakDaysForUser(db, userId, now),
    db.execute({
      sql: `SELECT COUNT(*) AS total,
                   SUM(CASE WHEN r.due <= ? THEN 1 ELSE 0 END) AS due,
                   SUM(CASE WHEN r.state >= 3 THEN 3 ELSE r.state END) AS mastery_sum
            FROM reviews r
            JOIN cards c ON c.id = r.card_id
            JOIN notebooks nb ON nb.id = c.notebook_id
            WHERE nb.user_id = ?`,
      args: [nowISO, userId]
    }),
    db.execute({
      sql: `SELECT COUNT(DISTINCT r.card_id) AS n FROM review_log r
            JOIN cards c ON c.id = r.card_id
            JOIN notebooks nb ON nb.id = c.notebook_id
            WHERE nb.user_id = ? AND substr(r.graded_at, 1, 10) = substr(?, 1, 10)`,
      args: [userId, nowISO]
    })
  ]);

  const row = counts.rows[0];
  const total = row ? Number(row.total) : 0;
  const due = row ? Number(row.due ?? 0) : 0;
  const masterySum = row ? Number(row.mastery_sum ?? 0) : 0;
  return {
    streak,
    dueTotal: due,
    cardsTotal: total,
    mastery: total === 0 ? 0 : Math.round((masterySum / (total * 3)) * 100),
    reviewedToday: reviewed.rows[0] ? Number(reviewed.rows[0].n) : 0
  };
}

export async function summaryGet(db: Client, req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(db, req);
    return NextResponse.json(await userSummary(db, user.id, new Date()));
  } catch (error) {
    return errorResponse(error);
  }
}
