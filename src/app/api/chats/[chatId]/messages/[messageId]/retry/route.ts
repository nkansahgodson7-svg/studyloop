import { getDb } from '@/lib/db';
import { messageRetry } from '@/lib/server/chat';

export const POST = async (
  req: Request,
  ctx: { params: Promise<{ chatId: string; messageId: string }> }
) => {
  const params = await ctx.params;
  return messageRetry(getDb(), req, params.chatId, params.messageId);
};
