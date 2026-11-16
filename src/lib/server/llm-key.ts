import type { Client } from '@libsql/client';
import { loadUserPlainKey } from './llmkey';

/**
 * The key used for model calls: the user's own key first, then the deployment
 * default. Lives outside chat.ts so generation modules can use it without an
 * import cycle.
 */
export async function resolveLlmKey(db: Client, userId: number): Promise<string | null> {
  const personal = await loadUserPlainKey(db, userId);
  if (personal && personal.trim().length > 0) {
    return personal;
  }
  const envKey = process.env.GROQ_API_KEY;
  return envKey && envKey.trim().length > 0 ? envKey : null;
}
