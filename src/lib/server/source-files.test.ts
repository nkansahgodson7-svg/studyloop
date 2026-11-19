// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { utapi } = vi.hoisted(() => ({
  utapi: {
    uploadFiles: vi.fn(),
    deleteFiles: vi.fn(),
    getFileUrls: vi.fn(),
    generateSignedURL: vi.fn()
  }
}));

vi.mock('uploadthing/server', () => ({
  UTApi: class {
    uploadFiles(...args: unknown[]) {
      return utapi.uploadFiles(...args);
    }
    deleteFiles(...args: unknown[]) {
      return utapi.deleteFiles(...args);
    }
    getFileUrls(...args: unknown[]) {
      return utapi.getFileUrls(...args);
    }
    generateSignedURL(...args: unknown[]) {
      return utapi.generateSignedURL(...args);
    }
  }
}));

import {
  MAX_RELAYED_FILE_BYTES,
  downloadSourceFileByCustomId,
  signedSourceFileUrl,
  storeSourceFile
} from './source-files';

const PPT = 'application/vnd.ms-powerpoint';

beforeEach(() => {
  process.env.UPLOADTHING_TOKEN = 'test-token';
  for (const fn of Object.values(utapi)) fn.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.UPLOADTHING_TOKEN;
});

describe('storeSourceFile', () => {
  it('does nothing when storage is not configured', async () => {
    delete process.env.UPLOADTHING_TOKEN;
    expect(await storeSourceFile(new Uint8Array([1]), 'deck.ppt', PPT)).toBeNull();
    expect(utapi.uploadFiles).not.toHaveBeenCalled();
  });

  it('falls back to the app default ACL when private uploads are rejected', async () => {
    utapi.uploadFiles
      .mockRejectedValueOnce(new Error('private ACL requires a paid plan'))
      .mockResolvedValueOnce({ data: { key: 'stored-key' } });

    expect(await storeSourceFile(new Uint8Array([1]), 'deck.ppt', PPT)).toBe('stored-key');
    expect(utapi.uploadFiles).toHaveBeenCalledTimes(2);
    expect(utapi.uploadFiles.mock.calls[0]?.[1]).toEqual({ acl: 'private' });
    expect(utapi.uploadFiles.mock.calls[1]).toHaveLength(1);
  });

  it('falls back when the private upload returns an error result', async () => {
    utapi.uploadFiles
      .mockResolvedValueOnce({ error: { message: 'ACL not allowed' } })
      .mockResolvedValueOnce({ data: { key: 'public-key' } });

    expect(await storeSourceFile(new Uint8Array([1]), 'deck.ppt', PPT)).toBe('public-key');
  });

  it('returns null when both upload attempts fail', async () => {
    utapi.uploadFiles.mockRejectedValue(new Error('storage down'));
    expect(await storeSourceFile(new Uint8Array([1]), 'deck.ppt', PPT)).toBeNull();
  });
});

describe('downloadSourceFileByCustomId', () => {
  it('downloads from the public URL when signing is unavailable', async () => {
    utapi.getFileUrls.mockResolvedValue({
      data: [{ key: 'file-key', url: 'https://ufs.example/file-key' }]
    });
    utapi.generateSignedURL.mockRejectedValue(new Error('private files are paid-only'));
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadSourceFileByCustomId('7-upload');

    expect(utapi.getFileUrls).toHaveBeenCalledWith(['7-upload'], { keyType: 'customId' });
    expect(fetchMock).toHaveBeenCalledWith('https://ufs.example/file-key');
    expect(result?.key).toBe('file-key');
    expect(Array.from(result?.bytes ?? [])).toEqual([1, 2, 3]);
  });

  it('prefers a signed URL when the file is private', async () => {
    utapi.getFileUrls.mockResolvedValue({
      data: [{ key: 'file-key', url: 'https://ufs.example/file-key' }]
    });
    utapi.generateSignedURL.mockResolvedValue({ ufsUrl: 'https://signed.example/file-key' });
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([4])));
    vi.stubGlobal('fetch', fetchMock);

    expect((await downloadSourceFileByCustomId('7-upload'))?.key).toBe('file-key');
    expect(fetchMock).toHaveBeenCalledWith('https://signed.example/file-key');
  });

  it('falls back to the public URL when the signed URL cannot be fetched', async () => {
    utapi.getFileUrls.mockResolvedValue({
      data: [{ key: 'file-key', url: 'https://ufs.example/file-key' }]
    });
    utapi.generateSignedURL.mockResolvedValue({ ufsUrl: 'https://signed.example/file-key' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9])));
    vi.stubGlobal('fetch', fetchMock);

    expect((await downloadSourceFileByCustomId('7-upload'))?.key).toBe('file-key');
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://signed.example/file-key');
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://ufs.example/file-key');
  });

  it('refuses a download declared larger than the relay limit', async () => {
    utapi.getFileUrls.mockResolvedValue({
      data: [{ key: 'file-key', url: 'https://ufs.example/file-key' }]
    });
    utapi.generateSignedURL.mockResolvedValue({ ufsUrl: 'https://signed.example/file-key' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ 'content-length': String(MAX_RELAYED_FILE_BYTES + 1) }),
        arrayBuffer: async () => new ArrayBuffer(0)
      }))
    );

    expect(await downloadSourceFileByCustomId('7-upload')).toBeNull();
  });
});

describe('signedSourceFileUrl', () => {
  it('falls back to the public URL on the free plan', async () => {
    utapi.generateSignedURL.mockRejectedValue(new Error('private files are paid-only'));
    utapi.getFileUrls.mockResolvedValue({
      data: [{ key: 'file-key', url: 'https://ufs.example/file-key' }]
    });

    expect(await signedSourceFileUrl('file-key')).toBe('https://ufs.example/file-key');
  });
});
