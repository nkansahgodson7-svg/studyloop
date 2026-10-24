import { getDb } from '@/lib/db';
import { chatMessagesGet } from '@/lib/server/chat';

export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  chatMessagesGet(getDb(), req, (await ctx.params).id);
