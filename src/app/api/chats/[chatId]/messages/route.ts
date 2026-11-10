import { getDb } from '@/lib/db';
import { messagePost } from '@/lib/server/chat';

export const POST = async (req: Request, ctx: { params: Promise<{ chatId: string }> }) =>
  messagePost(getDb(), req, (await ctx.params).chatId);
