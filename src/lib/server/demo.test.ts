// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from './crypto';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createNotebook } from './notebooks';
import { createUser } from './repo';
import { DEMO_SEED, resetDemoData } from './demo';

describe('resetDemoData()', () => {
  let db: Parameters<typeof resetDemoData>[0];
  let userId: number;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-demo-')), 'demo.db'));
    await applySchema(db);
    const user = await createUser(db, { email: 'demo@x.local', passwordHash: await hashPassword('p'), role: 'user' });
    userId = user.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('seeds the three demo notebooks with sources, cards and review state', async () => {
    const result = await resetDemoData(db, userId, new Date());
    const expectedCards = DEMO_SEED.reduce((total, seed) => total + seed.cards.length + seed.generated.length, 0);
    const expectedSources = DEMO_SEED.reduce((total, seed) => total + seed.sources.length, 0);
    expect(result).toEqual({ notebooks: 3, sources: expectedSources, cards: expectedCards });

    const nb = await db.execute({
      sql: "SELECT id, title FROM notebooks WHERE user_id = ? ORDER BY id",
      args: [userId]
    });
    expect(nb.rows.map((row) => String(row.title))).toEqual(DEMO_SEED.map((seed) => seed.title));

    const src = await db.execute({
      sql: "SELECT meta, kind FROM sources WHERE notebook_id = ?",
      args: [Number(nb.rows[0]!.id)]
    });
    expect(src.rows.length).toBe(DEMO_SEED[0]!.sources.length);
    expect(src.rows.every((row) => String(row.meta).includes('chunk'))).toBe(true);

    const duePast = await db.execute({
      sql: "SELECT COUNT(*) AS n FROM reviews r JOIN cards c ON c.id = r.card_id WHERE c.notebook_id = ? AND r.due <= ? AND r.state != 0",
      args: [Number(nb.rows[0]!.id), new Date().toISOString()]
    });
    expect(Number(duePast.rows[0]!.n)).toBeGreaterThan(0);
  });

  it('replaces previously existing notebooks', async () => {
    await createNotebook(db, userId, 'My own notebook');
    const result = await resetDemoData(db, userId, new Date());
    expect(result.notebooks).toBe(3);
    const titles = await db.execute({
      sql: 'SELECT title FROM notebooks WHERE user_id = ?',
      args: [userId]
    });
    expect(titles.rows.length).toBe(3);
  });
});
