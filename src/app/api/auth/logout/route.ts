import { getDb } from '@/lib/db';
import { logout } from '@/lib/server/auth';

export const POST = (req: Request) => logout(getDb(), req);
