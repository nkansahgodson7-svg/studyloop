import { getDb } from '@/lib/db';
import { notebooksDelete } from '@/lib/server/notebooks';

export const DELETE = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  notebooksDelete(getDb(), req, (await ctx.params).id);
