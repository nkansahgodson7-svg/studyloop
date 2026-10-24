import { getDb } from '@/lib/db';
import { cardsDelete, cardsEdit } from '@/lib/server/cards';

export const PATCH = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  cardsEdit(getDb(), req, (await ctx.params).id);

export const DELETE = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  cardsDelete(getDb(), req, (await ctx.params).id);
