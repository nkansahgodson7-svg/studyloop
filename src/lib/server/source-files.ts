import { UTApi } from 'uploadthing/server';

/** Largest stored deck the relay will pull back for server-side parsing. */
export const MAX_RELAYED_FILE_BYTES = 40 * 1024 * 1024;

/**
 * Original uploads live in UploadThing. Private ACLs are paid-only there, so
 * uploads fall back to the app's default ACL (public-read on the free plan) and
 * are served by their unguessable URL. Everything is optional: without
 * UPLOADTHING_TOKEN the app keeps working from extracted text and the preview
 * falls back to text thumbnails.
 */
export function sourceFilesEnabled(): boolean {
  return Boolean(process.env.UPLOADTHING_TOKEN?.trim());
}

let api: UTApi | null = null;

function utapi(): UTApi {
  api ??= new UTApi();
  return api;
}

/** Uploads bytes and returns the UploadThing file key, or null if storage is unavailable. */
export async function storeSourceFile(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
  type: string
): Promise<string | null> {
  if (!sourceFilesEnabled()) return null;
  const file = new File([bytes], name, { type });
  try {
    const result = await utapi().uploadFiles(file, { acl: 'private' });
    if (!result.error && result.data) return result.data.key;
  } catch {
    // Private ACL is paid-only; retry with the app's default ACL below.
  }
  try {
    const result = await utapi().uploadFiles(file);
    if (result.error || !result.data) return null;
    return result.data.key;
  } catch {
    return null;
  }
}

/** Best-effort removal of a stored original when its source is deleted. */
export async function deleteSourceFile(key: string): Promise<void> {
  if (!sourceFilesEnabled()) return;
  try {
    await utapi().deleteFiles(key);
  } catch {
    // The source row is already gone; an orphaned object is not worth failing on.
  }
}

export interface DownloadedSourceFile {
  bytes: Uint8Array<ArrayBuffer>;
  key: string;
}

/**
 * Fetches an upload by the custom id assigned at upload time. UploadThing only
 * signs the URL, it does not check who owns the file, so callers must verify
 * the id belongs to the requesting user before calling this.
 */
export async function downloadSourceFileByCustomId(customId: string): Promise<DownloadedSourceFile | null> {
  if (!sourceFilesEnabled()) return null;
  try {
    // Resolving the custom id also hands back the real file key, which is what
    // the source row needs for previews later on.
    const found = await utapi().getFileUrls([customId], { keyType: 'customId' });
    const entry = found?.data?.[0];
    const key = entry?.key;
    if (!key) return null;
    // Private files need a signature; public files (free plan) are readable at
    // their unguessable URL. Try both so the relay works on either plan.
    const urls: string[] = [];
    try {
      urls.push((await utapi().generateSignedURL(key)).ufsUrl);
    } catch {
      // Private files are paid-only; the public URL below may still work.
    }
    if (entry?.url && entry.url !== urls[0]) urls.push(entry.url);
    for (const url of urls) {
      const res = await fetch(url);
      if (!res.ok) continue;
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > MAX_RELAYED_FILE_BYTES) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_RELAYED_FILE_BYTES) return null;
      return { bytes, key };
    }
    return null;
  } catch {
    return null;
  }
}

/** Short-lived signed URL for a private file, or the public URL on the free plan. */
export async function signedSourceFileUrl(key: string): Promise<string | null> {
  if (!sourceFilesEnabled()) return null;
  try {
    const { ufsUrl } = await utapi().generateSignedURL(key, { expiresIn: '10 minutes' });
    return ufsUrl;
  } catch {
    try {
      const found = await utapi().getFileUrls([key]);
      return found?.data?.[0]?.url ?? null;
    } catch {
      return null;
    }
  }
}
