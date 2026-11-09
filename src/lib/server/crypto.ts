import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;
const KEY_LEN = 32;
const SALT_LEN = 16;

// Current password-hash cost. Stored per hash, so it can be raised later
// without invalidating existing users.
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
// Node's default maxmem (32 MiB) is too small for N=2^15, r=8.
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
// Pre-v2 hashes used Node's defaults (N=16384, r=8, p=1).
const LEGACY_PARAMS = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM
  });
  return `scrypt2$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

function parseHash(
  stored: string
): { N: number; r: number; p: number; salt: Buffer; key: Buffer } | null {
  const parts = stored.split('$');
  if (parts[0] === 'scrypt' && parts.length === 3 && parts[1] && parts[2]) {
    return {
      ...LEGACY_PARAMS,
      salt: Buffer.from(parts[1], 'base64url'),
      key: Buffer.from(parts[2], 'base64url')
    };
  }
  if (parts[0] === 'scrypt2' && parts.length === 6) {
    const [, n, r, p, saltB64, keyB64] = parts;
    const N = Number(n);
    const R = Number(r);
    const P = Number(p);
    if (!Number.isInteger(N) || !Number.isInteger(R) || !Number.isInteger(P) || !saltB64 || !keyB64) {
      return null;
    }
    return { N, r: R, p: P, salt: Buffer.from(saltB64, 'base64url'), key: Buffer.from(keyB64, 'base64url') };
  }
  return null;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed || parsed.key.length === 0) {
    return false;
  }
  const key = await scrypt(password, parsed.salt, parsed.key.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: SCRYPT_MAXMEM
  });
  return timingSafeEqual(key, parsed.key);
}

/** True for legacy hashes or hashes made with weaker parameters than today's. */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  return !parsed || parsed.N < SCRYPT_N || parsed.r < SCRYPT_R || parsed.p < SCRYPT_P;
}

function derivedKey(secret: string): Buffer {
  return createHmac('sha256', secret).digest();
}

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derivedKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), encrypted.toString('base64url'), tag.toString('base64url')].join('$');
}

export function decryptSecret(blob: string, secret: string): string {
  const [version, ivB64, ctB64, tagB64] = blob.split('$');
  if (version !== 'v1' || !ivB64 || !ctB64 || !tagB64) {
    throw new Error('unrecognized secret envelope');
  }
  const decipher = createDecipheriv('aes-256-gcm', derivedKey(secret), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
}

export function sessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Constant-time comparison for short secrets such as invite codes.
 * Hashing first keeps the comparison independent of the inputs' lengths.
 */
export function verifySecret(provided: string, expected: string): boolean {
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
