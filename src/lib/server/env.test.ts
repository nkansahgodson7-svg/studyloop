import { describe, expect, it } from 'vitest';
import { validateRuntimeEnv } from './env';

const prod = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({
    NODE_ENV: 'production',
    ENCRYPTION_SECRET: 'secret',
    TURSO_DATABASE_URL: 'libsql://example.turso.io',
    TURSO_AUTH_TOKEN: 'token',
    ...extra
  }) as NodeJS.ProcessEnv;

describe('validateRuntimeEnv', () => {
  it('passes a complete production environment', () => {
    expect(() => validateRuntimeEnv(prod())).not.toThrow();
  });

  it('ignores missing secrets outside production', () => {
    expect(() => validateRuntimeEnv({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('fails when ENCRYPTION_SECRET is missing', () => {
    expect(() => validateRuntimeEnv(prod({ ENCRYPTION_SECRET: '' }))).toThrow(
      /ENCRYPTION_SECRET/
    );
  });

  it('fails when a remote database has no auth token', () => {
    expect(() => validateRuntimeEnv(prod({ TURSO_AUTH_TOKEN: '' }))).toThrow(
      /TURSO_AUTH_TOKEN/
    );
  });

  it('does not require an auth token for a local file database', () => {
    expect(() =>
      validateRuntimeEnv(prod({ TURSO_DATABASE_URL: 'file:data/local.db', TURSO_AUTH_TOKEN: '' }))
    ).not.toThrow();
  });
});
