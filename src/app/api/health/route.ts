import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(): Promise<NextResponse> {
  await getDb().execute('SELECT 1');
  return NextResponse.json({ ok: true });
}
