import { getDb } from '@/lib/db';
import { notebooksDetail, notebooksDelete } from '@/lib/server/notebooks';

export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  notebooksDetail(getDb(), req, (await ctx.params).id);

export const DELETE = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  notebooksDelete(getDb(), req, (await ctx.params).id);
