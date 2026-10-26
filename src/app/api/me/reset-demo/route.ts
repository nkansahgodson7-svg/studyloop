import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from '@/lib/server/auth';
import { resetDemoData } from '@/lib/server/demo';
import { getDb } from '@/lib/db';

export async function POST(req: Request): Promise<NextResponse> {
  const db = getDb();
  try {
    const user = await requireUser(db, req);
    const result = await resetDemoData(db, user.id, new Date());
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
