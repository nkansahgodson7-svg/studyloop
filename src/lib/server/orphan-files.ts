import type { Client } from '@libsql/client';
import { UTApi } from 'uploadthing/server';
import { sourceFilesEnabled } from './source-files';

/**
 * A PowerPoint upload is only linked to a source after the browser finishes
 * uploading *and* the source POST succeeds. If the POST fails (rate limit,
 * closed tab, validation), the stored original is left behind. This sweep
 * removes those files.
 *
 * Only `.ppt`/`.pptx` files older than the grace period are considered, so an
 * upload that is still being attached to its source is never deleted.
 */

const PAGE_SIZE = 500;
const DELETE_BATCH = 100;
const DB_BATCH = 200;
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const POWERPOINT_NAME = /\.pptx?$/i;

export type StoredFile = {
  key: string;
  name: string;
  status: string;
  uploadedAt: number;
};

export type SourceFileStorage = {
  listFiles(opts: {
    limit: number;
    offset: number;
  }): Promise<{ files: readonly StoredFile[]; hasMore: boolean }>;
  deleteFiles(keys: string[]): Promise<{ deletedCount: number }>;
};

export type OrphanCleanupResult = {
  storage: 'enabled' | 'disabled';
  scanned: number;
  candidates: number;
  referenced: number;
  deleted: number;
  skippedRecent: number;
  failed: number;
};

/** UploadThing has reported `uploadedAt` in seconds and milliseconds across versions. */
function uploadedAtMs(value: number): number {
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function defaultStorage(): SourceFileStorage {
  const api = new UTApi();
  return {
    listFiles: ({ limit, offset }) => api.listFiles({ limit, offset }),
    deleteFiles: async (keys) => api.deleteFiles(keys)
  };
}

async function referencedKeys(db: Client, keys: string[]): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (let index = 0; index < keys.length; index += DB_BATCH) {
    const batch = keys.slice(index, index + DB_BATCH);
    const placeholders = batch.map(() => '?').join(', ');
    const result = await db.execute({
      sql: `SELECT file_key FROM sources WHERE file_key IN (${placeholders})`,
      args: batch
    });
    for (const row of result.rows) {
      if (row['file_key'] != null) referenced.add(String(row['file_key']));
    }
  }
  return referenced;
}

export async function cleanupOrphanedSourceFiles(
  db: Client,
  opts: {
    now?: number;
    graceMs?: number;
    dryRun?: boolean;
    storage?: SourceFileStorage;
  } = {}
): Promise<OrphanCleanupResult> {
  const storage = opts.storage ?? (sourceFilesEnabled() ? defaultStorage() : null);
  const result: OrphanCleanupResult = {
    storage: storage ? 'enabled' : 'disabled',
    scanned: 0,
    candidates: 0,
    referenced: 0,
    deleted: 0,
    skippedRecent: 0,
    failed: 0
  };
  if (!storage) return result;

  const cutoff = (opts.now ?? Date.now()) - (opts.graceMs ?? ORPHAN_GRACE_MS);
  const candidates: string[] = [];
  const seen = new Set<string>();

  let offset = 0;
  for (;;) {
    const page = await storage.listFiles({ limit: PAGE_SIZE, offset });
    for (const file of page.files) {
      result.scanned += 1;
      if (file.status !== 'Uploaded') continue;
      if (!POWERPOINT_NAME.test(file.name)) continue;
      if (uploadedAtMs(file.uploadedAt) > cutoff) {
        result.skippedRecent += 1;
        continue;
      }
      if (seen.has(file.key)) continue;
      seen.add(file.key);
      candidates.push(file.key);
    }
    if (!page.hasMore || page.files.length === 0) break;
    offset += page.files.length;
  }
  result.candidates = candidates.length;
  if (candidates.length === 0 || opts.dryRun) return result;

  const referenced = await referencedKeys(db, candidates);
  result.referenced = referenced.size;
  const orphans = candidates.filter((key) => !referenced.has(key));
  if (orphans.length === 0) return result;

  for (let index = 0; index < orphans.length; index += DELETE_BATCH) {
    const batch = orphans.slice(index, index + DELETE_BATCH);
    try {
      const { deletedCount } = await storage.deleteFiles(batch);
      result.deleted += deletedCount;
      result.failed += Math.max(0, batch.length - deletedCount);
    } catch {
      result.failed += batch.length;
    }
  }
  return result;
}
