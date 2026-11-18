// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySchema, makeLocalDb } from '@/lib/db';
import { createNotebook } from './notebooks';
import { createUser } from './repo';
import {
  ORPHAN_GRACE_MS,
  cleanupOrphanedSourceFiles,
  type SourceFileStorage,
  type StoredFile
} from './orphan-files';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const OLD = NOW - ORPHAN_GRACE_MS - 60_000;

function file(key: string, name: string, overrides: Partial<StoredFile> = {}): StoredFile {
  return { key, name, status: 'Uploaded', uploadedAt: OLD, ...overrides };
}

function fakeStorage(files: StoredFile[], deleted: string[]): SourceFileStorage {
  return {
    listFiles: async ({ limit, offset }) => ({
      files: files.slice(offset, offset + limit),
      hasMore: offset + limit < files.length
    }),
    deleteFiles: async (keys) => {
      deleted.push(...keys);
      return { deletedCount: keys.length };
    }
  };
}

describe('cleanupOrphanedSourceFiles', () => {
  let db: Client;

  beforeAll(async () => {
    db = makeLocalDb(join(await mkdtemp(join(tmpdir(), 'studyloop-orphans-')), 'orphans.db'));
    await applySchema(db);
    const user = await createUser(db, {
      email: 'orphans@x.local',
      passwordHash: 'x',
      role: 'user'
    });
    const notebook = await createNotebook(db, user.id, 'Slides');
    await db.execute({
      sql: `INSERT INTO sources (notebook_id, kind, title, file_key, text)
            VALUES (?, 'ppt', 'Kept deck', 'keep.pptx', 'slide text')`,
      args: [notebook.id]
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('deletes only old, unreferenced PowerPoint uploads', async () => {
    const deleted: string[] = [];
    const summary = await cleanupOrphanedSourceFiles(db, {
      now: NOW,
      storage: fakeStorage(
        [
          file('keep.pptx', 'keep.pptx'),
          file('orphan.pptx', 'orphan.pptx'),
          file('legacy.ppt', 'legacy.ppt'),
          file('recent.pptx', 'recent.pptx', { uploadedAt: NOW - 60_000 }),
          file('notes.pdf', 'notes.pdf'),
          file('pending.pptx', 'pending.pptx', { status: 'Uploading' })
        ],
        deleted
      )
    });

    expect(deleted.sort()).toEqual(['legacy.ppt', 'orphan.pptx']);
    expect(summary).toMatchObject({
      storage: 'enabled',
      scanned: 6,
      candidates: 3,
      referenced: 1,
      deleted: 2,
      skippedRecent: 1,
      failed: 0
    });
  });

  it('reports candidates without deleting on a dry run', async () => {
    const deleted: string[] = [];
    const summary = await cleanupOrphanedSourceFiles(db, {
      now: NOW,
      dryRun: true,
      storage: fakeStorage([file('orphan.pptx', 'orphan.pptx')], deleted)
    });

    expect(deleted).toEqual([]);
    expect(summary).toMatchObject({ candidates: 1, referenced: 0, deleted: 0 });
  });

  it('counts failed deletions instead of aborting the sweep', async () => {
    const storage: SourceFileStorage = {
      listFiles: async () => ({
        files: [file('a.pptx', 'a.pptx'), file('b.pptx', 'b.pptx')],
        hasMore: false
      }),
      deleteFiles: async () => {
        throw new Error('storage unavailable');
      }
    };
    const summary = await cleanupOrphanedSourceFiles(db, { now: NOW, storage });
    expect(summary).toMatchObject({ deleted: 0, failed: 2 });
  });
});
