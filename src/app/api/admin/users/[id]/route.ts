import { getDb } from '@/lib/db';
import { adminDeleteUser, adminSetDisabled } from '@/lib/server/admin';

export const PATCH = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  adminSetDisabled(getDb(), req, (await ctx.params).id);

export const DELETE = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  adminDeleteUser(getDb(), req, (await ctx.params).id);
