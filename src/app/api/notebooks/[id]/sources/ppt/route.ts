import { getDb } from '@/lib/db';
import { pptSourceCreate } from '@/lib/server/sources';

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  pptSourceCreate(getDb(), req, (await ctx.params).id);