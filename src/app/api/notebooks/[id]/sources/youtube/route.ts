import { getDb } from '@/lib/db';
import { youtubeSourceCreate } from '@/lib/server/ingest/youtube';

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  youtubeSourceCreate(getDb(), req, (await ctx.params).id);
