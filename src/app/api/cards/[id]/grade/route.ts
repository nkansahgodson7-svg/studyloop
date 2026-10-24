import { getDb } from '@/lib/db';
import { cardsGrade } from '@/lib/server/cards';

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  cardsGrade(getDb(), req, (await ctx.params).id);
