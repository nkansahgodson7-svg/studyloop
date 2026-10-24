import { getDb } from '@/lib/db';
import { me } from '@/lib/server/auth';

export const GET = (req: Request) => me(getDb(), req);
