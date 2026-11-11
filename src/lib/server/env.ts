/**
 * Startup checks for configuration the app cannot work without. A missing
 * secret used to surface only when a user happened to hit the affected
 * feature (an LLM-key save failing with a 500, say); here it fails the boot
 * instead, so a misconfigured deployment never looks healthy.
 */
export function validateRuntimeEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }
  const missing: string[] = [];
  if (!env.ENCRYPTION_SECRET?.trim()) {
    missing.push('ENCRYPTION_SECRET');
  }
  const url = env.TURSO_DATABASE_URL?.trim();
  if (url && !url.startsWith('file:') && !env.TURSO_AUTH_TOKEN?.trim()) {
    missing.push('TURSO_AUTH_TOKEN');
  }
  if (missing.length > 0) {
    throw new Error(`missing required production environment: ${missing.join(', ')}`);
  }
}
