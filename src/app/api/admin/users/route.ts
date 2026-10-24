import { getDb } from '@/lib/db';
import { adminCreateUser, adminListUsers } from '@/lib/server/admin';

export const GET = (req: Request) => adminListUsers(getDb(), req);

export const POST = (req: Request) => adminCreateUser(getDb(), req);
