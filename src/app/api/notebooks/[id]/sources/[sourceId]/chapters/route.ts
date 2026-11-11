import { getDb } from '@/lib/db';
import { chaptersGet } from '@/lib/server/sources';

export const GET = async (req: Request, ctx: { params: Promise<{ id: string; sourceId: string }> }) => {
  const params = await ctx.params;
  return chaptersGet(getDb(), req, params.id, params.sourceId);
};
