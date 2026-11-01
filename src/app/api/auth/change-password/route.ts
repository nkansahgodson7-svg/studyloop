import { getDb } from '@/lib/db';
import { changePassword } from '@/lib/server/auth';

export const POST = (req: Request) => changePassword(getDb(), req);
