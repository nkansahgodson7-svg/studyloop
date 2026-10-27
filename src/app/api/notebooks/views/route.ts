import { getDb } from '@/lib/db';
import { notebooksViews } from '@/lib/server/notebooks';

export const GET = (req: Request) => notebooksViews(getDb(), req);
