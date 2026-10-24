import { getDb } from '@/lib/db';
import { adminSetDisabled } from '@/lib/server/admin';

export const PATCH = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  adminSetDisabled(getDb(), req, (await ctx.params).id);
