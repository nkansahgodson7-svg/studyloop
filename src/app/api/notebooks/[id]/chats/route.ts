import { getDb } from '@/lib/db';
import { chatsCreate, chatsList } from '@/lib/server/conversations';

export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  chatsList(getDb(), req, (await ctx.params).id);

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  chatsCreate(getDb(), req, (await ctx.params).id);
