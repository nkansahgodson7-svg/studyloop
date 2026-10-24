import { getDb } from '@/lib/db';
import { cardsAdd, cardsList } from '@/lib/server/cards';

export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  cardsList(getDb(), req, (await ctx.params).id);

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  cardsAdd(getDb(), req, (await ctx.params).id);
