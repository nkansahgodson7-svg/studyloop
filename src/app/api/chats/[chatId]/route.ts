import { getDb } from '@/lib/db';
import { chatDelete, chatDetail, chatRename } from '@/lib/server/conversations';

export const GET = async (req: Request, ctx: { params: Promise<{ chatId: string }> }) =>
  chatDetail(getDb(), req, (await ctx.params).chatId);

export const PATCH = async (req: Request, ctx: { params: Promise<{ chatId: string }> }) =>
  chatRename(getDb(), req, (await ctx.params).chatId);

export const DELETE = async (req: Request, ctx: { params: Promise<{ chatId: string }> }) =>
  chatDelete(getDb(), req, (await ctx.params).chatId);
