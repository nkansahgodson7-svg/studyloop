import { getDb } from '@/lib/db';
import { quizGenerate } from '@/lib/server/quiz-generate';

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  quizGenerate(getDb(), req, (await ctx.params).id);
