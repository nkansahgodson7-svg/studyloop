import { getDb } from '@/lib/db';
import { cardsBatchAdd } from '@/lib/server/cards';

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  cardsBatchAdd(getDb(), req, (await ctx.params).id);
