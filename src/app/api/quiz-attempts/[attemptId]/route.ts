import { getDb } from '@/lib/db';
import { quizAttemptGet, quizAttemptPatch } from '@/lib/server/quiz-api';

type Context = { params: Promise<{ attemptId: string }> };

export const GET = async (req: Request, ctx: Context) =>
  quizAttemptGet(getDb(), req, (await ctx.params).attemptId);

export const PATCH = async (req: Request, ctx: Context) =>
  quizAttemptPatch(getDb(), req, (await ctx.params).attemptId);
