import { getDb } from '@/lib/db';
import { quizAttemptSubmit } from '@/lib/server/quiz-api';

export const POST = async (req: Request, ctx: { params: Promise<{ attemptId: string }> }) =>
  quizAttemptSubmit(getDb(), req, (await ctx.params).attemptId);
