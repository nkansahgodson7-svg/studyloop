import { getDb } from '@/lib/db';
import { login } from '@/lib/server/auth';

export const POST = (req: Request) => login(getDb(), req);
