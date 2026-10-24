import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from './crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import {
  createSession,
  createUser,
  setUserDisabled,
  findEnabledUserByEmail,
  findUserBySession,
  revokeAllSessionsForUser
} from './repo';

describe('users + sessions data layer', () => {
  let dir: string;
  let db: Client;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'studyloop-repo-'));
    db = makeLocalDb(join(dir, 'repo.db'));
    await applySchema(db);
  });

  afterAll(async () => {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('creates a user and finds them by case-insensitive email', async () => {
    const owner = await createUser(db, {
      email: 'owner@test.local',
      passwordHash: await hashPassword('correct horse battery staple'),
      role: 'admin'
    });

    const found = await findEnabledUserByEmail(db, 'OWNER@test.local');
    expect(found?.id).toBe(owner.id);
    expect(found?.email).toBe('owner@test.local');
    expect(found?.role).toBe('admin');
  });

  it('returns null for unknown email', async () => {
    expect(await findEnabledUserByEmail(db, 'ghost@test.local')).toBeNull();
  });

  it('session round-trip resolves the same user', async () => {
    const owner = await seedUser(db, 'session.user@test.local');
    const token = await createSession(db, owner.id);

    const resolved = await findUserBySession(db, token, new Date());
    expect(resolved?.id).toBe(owner.id);
    expect(resolved).not.toHaveProperty('passwordHash');
  });

  it('rejects an expired session', async () => {
    const owner = await seedUser(db, 'expiry.user@test.local');
    const token = await createSession(db, owner.id);

    const later = new Date(Date.now() + 30 * 24 * 3600e3);
    expect(await findUserBySession(db, token, later)).toBeNull();
  });

  it('disabled user is invisible to sessions; revocation purges tokens', async () => {
    const owner = await seedUser(db, 'disable.user@test.local');
    const token = await createSession(db, owner.id);

    await setUserDisabled(db, owner.id, true);
    expect(await findUserBySession(db, token, new Date())).toBeNull();
    expect(await findEnabledUserByEmail(db, 'disable.user@test.local')).toBeNull();

    await setUserDisabled(db, owner.id, false);
    expect(await findEnabledUserByEmail(db, 'disable.user@test.local')).not.toBeNull();

    await revokeAllSessionsForUser(db, owner.id);
    expect(await findUserBySession(db, token, new Date())).toBeNull();
  });

  it('duplicate email is rejected', async () => {
    await seedUser(db, 'dupe.user@test.local');
    await expect(
      createUser(db, {
        email: 'dupe.user@test.local',
        passwordHash: 'hash',
        role: 'user'
      })
    ).rejects.toThrow();
  });
});

async function seedUser(db: Client, email: string) {
  return createUser(db, { email, passwordHash: await hashPassword('pw-for-tests'), role: 'user' });
}
