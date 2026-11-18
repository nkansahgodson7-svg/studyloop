import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cleanupOrphanedSourceFiles } from '@/lib/server/orphan-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Scheduled cleanup of PowerPoint originals that never got attached to a source. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 404 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const summary = await cleanupOrphanedSourceFiles(getDb());
  return NextResponse.json(summary);
}
