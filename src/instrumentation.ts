/**
 * Runs once when the server process starts (Next.js instrumentation hook),
 * before any request is served.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateRuntimeEnv } = await import('./lib/server/env');
    validateRuntimeEnv();
  }
}
