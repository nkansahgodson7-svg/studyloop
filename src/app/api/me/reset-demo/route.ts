import { NextResponse } from 'next/server';
import { errorResponse, requireUser } from '@/lib/server/auth';
import { resetDemoData } from '@/lib/server/demo';
import { DEMO_EMAIL } from '@/lib/server/seed-admin';
import { getDb } from '@/lib/db';

export async function POST(req: Request): Promise<NextResponse> {
  const db = getDb();
  try {
    const user = await requireUser(db, req);
    // Resetting deletes every notebook and restores the seeded set — that is a
    // demo affordance, not something a real account should be able to trigger.
    if (user.email.toLowerCase() !== DEMO_EMAIL) {
      return NextResponse.json(
        { error: 'demo data can only be reset from the demo account' },
        { status: 403 }
      );
    }
    const result = await resetDemoData(db, user.id, new Date());
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
