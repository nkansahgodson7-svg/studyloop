import { getDb } from '@/lib/db';
import { requireUser, errorResponse } from '@/lib/server/auth';
import { deleteSource } from '@/lib/server/repo';
import { sourceGet } from '@/lib/server/sources';
import { deleteSourceFile } from '@/lib/server/source-files';
import { NextResponse } from 'next/server';

export const GET = async (req: Request, ctx: { params: Promise<{ id: string; sourceId: string }> }) => {
  const params = await ctx.params;
  return sourceGet(getDb(), req, params.id, params.sourceId);
};

export const DELETE = async (req: Request, ctx: { params: Promise<{ id: string; sourceId: string }> }) => {
  try {
    const user = await requireUser(getDb(), req);
    const params = await ctx.params;
    const notebookId = Number(params.id);
    const sourceId = Number(params.sourceId);
    if (!Number.isInteger(notebookId) || !Number.isInteger(sourceId)) {
      return NextResponse.json({ error: 'unknown source' }, { status: 404 });
    }
    const { deleted, fileKey } = await deleteSource(getDb(), sourceId, user.id);
    if (!deleted) {
      return NextResponse.json({ error: 'unknown source' }, { status: 404 });
    }
    if (fileKey) await deleteSourceFile(fileKey);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
