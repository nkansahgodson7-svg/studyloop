import { getDb } from '@/lib/db';
import { saveKey, clearKey } from '@/lib/server/llmkey';

export const PUT = (req: Request) => saveKey(getDb(), req);

export const DELETE = (req: Request) => clearKey(getDb(), req);
