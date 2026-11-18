import { UTApi } from 'uploadthing/server';

/**
 * Original uploads live in UploadThing (private ACL). Everything is optional:
 * without UPLOADTHING_TOKEN the app keeps working from extracted text and the
 * preview falls back to text thumbnails.
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
  try {
    const result = await utapi().uploadFiles(new File([bytes], name, { type }), { acl: 'private' });
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

/** Short-lived signed URL for a private file. */
export async function signedSourceFileUrl(key: string): Promise<string | null> {
  if (!sourceFilesEnabled()) return null;
  try {
    const { ufsUrl } = await utapi().generateSignedURL(key, { expiresIn: '10 minutes' });
    return ufsUrl;
  } catch {
    return null;
  }
}
