import { getDb } from '@/lib/db';
import { quizDelete, quizDetail } from '@/lib/server/quiz-api';

type Context = { params: Promise<{ examId: string }> };

export const GET = async (req: Request, ctx: Context) =>
  quizDetail(getDb(), req, (await ctx.params).examId);

export const DELETE = async (req: Request, ctx: Context) =>
  quizDelete(getDb(), req, (await ctx.params).examId);
