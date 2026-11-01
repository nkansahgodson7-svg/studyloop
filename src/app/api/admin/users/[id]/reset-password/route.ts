import { getDb } from '@/lib/db';
import { adminResetPassword } from '@/lib/server/admin';

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  adminResetPassword(getDb(), req, (await ctx.params).id);
