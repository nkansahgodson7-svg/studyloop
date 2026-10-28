import { getDb } from '@/lib/db';
import { adminStats } from '@/lib/server/admin';

export const GET = (req: Request) => adminStats(getDb(), req);
