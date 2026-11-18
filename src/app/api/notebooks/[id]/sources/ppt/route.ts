import { getDb } from '@/lib/db';
import { pptSourceCreate } from '@/lib/server/sources';

// Parsing a large legacy deck plus indexing its slides can outlast the default
// function budget.
export const maxDuration = 60;

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  pptSourceCreate(getDb(), req, (await ctx.params).id);