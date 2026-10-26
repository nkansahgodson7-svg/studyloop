import { getDb } from '@/lib/db';
import { summaryGet } from '@/lib/server/summary';

export const GET = (req: Request) => summaryGet(getDb(), req);
