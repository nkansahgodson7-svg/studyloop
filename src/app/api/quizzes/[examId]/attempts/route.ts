import { getDb } from '@/lib/db';
import { quizStartAttempt } from '@/lib/server/quiz-api';

export const POST = async (req: Request, ctx: { params: Promise<{ examId: string }> }) =>
  quizStartAttempt(getDb(), req, (await ctx.params).examId);
