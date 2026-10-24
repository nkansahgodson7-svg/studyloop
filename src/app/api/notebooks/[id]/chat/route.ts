import { getDb } from '@/lib/db';
import { chatStream } from '@/lib/server/chat';

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  chatStream(getDb(), req, (await ctx.params).id);
