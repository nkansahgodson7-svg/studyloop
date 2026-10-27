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

const scrypt = promisify(scryptCb);
const KEY_LEN = 32;
const SALT_LEN = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = (await scrypt(password, salt, KEY_LEN)) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) {
    return false;
  }
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(keyB64, 'base64url');
  const key = (await scrypt(password, salt, expected.length)) as Buffer;
  return timingSafeEqual(key, expected);
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
