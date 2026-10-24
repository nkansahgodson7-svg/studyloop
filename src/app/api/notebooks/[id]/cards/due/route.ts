import { getDb } from '@/lib/db';
import { cardsDue } from '@/lib/server/cards';

export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  cardsDue(getDb(), req, (await ctx.params).id);
