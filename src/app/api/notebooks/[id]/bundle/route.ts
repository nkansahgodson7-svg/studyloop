import { getDb } from '@/lib/db';
import { notebookBundle } from '@/lib/server/bundle';

export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  notebookBundle(getDb(), req, (await ctx.params).id);
