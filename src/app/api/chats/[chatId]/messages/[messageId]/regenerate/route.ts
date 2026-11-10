import { getDb } from '@/lib/db';
import { messageRegenerate } from '@/lib/server/chat';

export const POST = async (
  req: Request,
  ctx: { params: Promise<{ chatId: string; messageId: string }> }
) => {
  const params = await ctx.params;
  return messageRegenerate(getDb(), req, params.chatId, params.messageId);
};
