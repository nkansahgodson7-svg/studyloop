import { getDb } from '@/lib/db';
import { quizMissedCards } from '@/lib/server/quiz-api';

export const POST = async (req: Request, ctx: { params: Promise<{ attemptId: string }> }) =>
  quizMissedCards(getDb(), req, (await ctx.params).attemptId);
