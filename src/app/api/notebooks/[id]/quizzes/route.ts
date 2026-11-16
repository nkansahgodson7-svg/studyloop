import { getDb } from '@/lib/db';
import { quizList } from '@/lib/server/quiz-api';

export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  quizList(getDb(), req, (await ctx.params).id);
