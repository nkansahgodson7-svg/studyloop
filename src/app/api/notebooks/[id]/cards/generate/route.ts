import { getDb } from '@/lib/db';
import { cardsGenerate } from '@/lib/server/cards';

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  cardsGenerate(getDb(), req, (await ctx.params).id);
