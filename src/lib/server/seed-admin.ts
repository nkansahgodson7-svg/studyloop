import { pathToFileURL } from 'node:url';
import type { Client } from '@libsql/client';
import { hashPassword } from './crypto';
import { MIN_PASSWORD_LENGTH } from '../password';
import { createUser, findUserByEmail } from './repo';

export interface SeedInput {
  email: string;
  password: string;
}

export async function seedAdmin(
  db: Client,
  input: SeedInput
): Promise<{ id: number; email: string; role: 'admin' }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error('seed-admin requires a valid ADMIN_EMAIL'), { code: 'INVALID_EMAIL' });
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw Object.assign(
      new Error(`seed-admin requires an ADMIN_PASSWORD of at least ${MIN_PASSWORD_LENGTH} characters`),
      { code: 'WEAK_PASSWORD' }
    );
  }

  const existing = await findUserByEmail(db, email);
  if (existing) {
    if (existing.role !== 'admin') {
      await db.execute({ sql: "UPDATE users SET role = 'admin' WHERE id = ?", args: [existing.id] });
    }
    return { id: existing.id, email: existing.email, role: 'admin' };
  }

  const created = await createUser(db, {
    email,
    passwordHash: await hashPassword(input.password),
    role: 'admin'
  });
  return { id: created.id, email: created.email, role: 'admin' };
}

export const DEMO_EMAIL = 'demo@studyloop.app';

/** The demo account is only created when a password is supplied explicitly. */
export async function ensureDemoUser(
  db: Client,
  password: string
): Promise<{ id: number; email: string }> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw Object.assign(
      new Error(`DEMO_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`),
      { code: 'WEAK_PASSWORD' }
    );
  }
  const existing = await findUserByEmail(db, DEMO_EMAIL);
  if (existing) {
    return { id: existing.id, email: existing.email };
  }
  const created = await createUser(db, {
    email: DEMO_EMAIL,
    passwordHash: await hashPassword(password),
    role: 'user'
  });
  return { id: created.id, email: created.email };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(entry).href === import.meta.url;
}

if (isMainModule()) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error('usage: ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed:admin');
    process.exitCode = 1;
  } else {
    try {
      const { getDb, applySchema } = await import('@/lib/db');
      const db = getDb();
      await applySchema(db);
      const admin = await seedAdmin(db, { email, password });
      const demoPassword = process.env.DEMO_PASSWORD;
      if (demoPassword) {
        await ensureDemoUser(db, demoPassword);
      }
      await db.close();
      console.log(`admin ready: ${admin.email}`);
      console.log(demoPassword ? `demo user ready: ${DEMO_EMAIL}` : 'demo user skipped (set DEMO_PASSWORD to create it)');
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
