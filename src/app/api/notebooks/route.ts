import { getDb } from '@/lib/db';
import { notebooksCreate, notebooksList } from '@/lib/server/notebooks';

export const GET = (req: Request) => notebooksList(getDb(), req);

export const POST = (req: Request) => notebooksCreate(getDb(), req);
