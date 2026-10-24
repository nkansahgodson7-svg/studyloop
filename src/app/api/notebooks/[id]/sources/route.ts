import { getDb } from '@/lib/db';
import { sourcesList, textSourceCreate } from '@/lib/server/sources';

export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  sourcesList(getDb(), req, (await ctx.params).id);

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  textSourceCreate(getDb(), req, (await ctx.params).id);
