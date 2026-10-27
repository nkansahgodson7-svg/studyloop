import { getDb } from '@/lib/db';
import { signup } from '@/lib/server/auth';

export const POST = (req: Request) => signup(getDb(), req);
