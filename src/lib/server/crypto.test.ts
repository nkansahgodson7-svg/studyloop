import { createCipheriv, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  needsRehash,
  sessionToken,
  verifyPassword,
  verifySecret
} from './crypto';

describe('password hashing', () => {
  it('hashes and verifies a password, refusing wrong ones', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).not.toContain('correct horse');
    expect(await verifyPassword('correct horse', hash)).toBe(true);

    const otherHash = await hashPassword('correct horse');
    expect(otherHash).not.toBe(hash);

    expect(await verifyPassword('wrong horse', hash)).toBe(false);
  });

  it('writes scrypt2 hashes with explicit cost params, and does not want them rehashed', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).toMatch(/^scrypt2\$\d+\$\d+\$\d+\$/);
    expect(needsRehash(hash)).toBe(false);
  });

  // Regression: hashes written by the scrypt2 format were rejected outright by
  // verifyPassword, locking every account created after the cost bump out.
  it('verifies a scrypt2 hash produced by another process', async () => {
    const stored = 'scrypt2$32768$8$1$' + Buffer.from('salt-bytes-here!').toString('base64url') + '$';
    const salt = Buffer.from('salt-bytes-here!');
    const key = (await scrypt('pw-from-scrypt2', salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 128 * 1024 * 1024
    })) as Buffer;
    const full = stored + key.toString('base64url');

    expect(await verifyPassword('pw-from-scrypt2', full)).toBe(true);
    expect(await verifyPassword('wrong', full)).toBe(false);
    expect(needsRehash(full)).toBe(false);
  });

  it('still verifies legacy scrypt hashes and flags them for rehash', async () => {
    const salt = Buffer.from('legacy-salt-16b!');
    const key = (await scrypt('legacy-pw', salt, 32)) as Buffer;
    const legacy = `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;

    expect(await verifyPassword('legacy-pw', legacy)).toBe(true);
    expect(needsRehash(legacy)).toBe(true);
  });

  it('refuses malformed hashes instead of throwing', async () => {
    for (const bad of ['', 'nonsense', 'scrypt$$', 'scrypt2$1$2$3$', 'bcrypt$a$b']) {
      expect(await verifyPassword('anything', bad)).toBe(false);
      expect(needsRehash(bad)).toBe(true);
    }
  });
});

describe('password hash upgrades', () => {
  it('does not flag fresh hashes for rehash but flags legacy ones', async () => {
    expect(needsRehash(await hashPassword('fresh-password'))).toBe(false);
    expect(needsRehash('scrypt$c2FsdA$a2V5')).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
  });
});

describe('BYO-key envelope', () => {
  it('encrypts and decrypts a stored LLM key without leaking plaintext', async () => {
    const blob = encryptSecret('gsk_secret123', 'envelope-secret-at-least-32-bytes-long!!!');
    expect(blob).not.toContain('gsk_secret123');

    expect(decryptSecret(blob, 'envelope-secret-at-least-32-bytes-long!!!')).toBe('gsk_secret123');
  });

  it('writes v2 envelopes and still reads legacy v1 envelopes', () => {
    const secret = 'envelope-secret-at-least-32-bytes-long!!!';
    expect(encryptSecret('gsk_x', secret).startsWith('v2$')).toBe(true);

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', createHmac('sha256', secret).digest(), iv);
    const ct = Buffer.concat([cipher.update('gsk_old', 'utf8'), cipher.final()]);
    const v1 = ['v1', iv.toString('base64url'), ct.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('$');
    expect(decryptSecret(v1, secret)).toBe('gsk_old');
  });

  it('fails to decrypt with the wrong secret', () => {
    const blob = encryptSecret('gsk_secret123', 'secret-A'.repeat(4));
    expect(() => decryptSecret(blob, 'secret-B'.repeat(4))).toThrow();
  });
});

describe('invite secrets', () => {
  it('accepts the exact secret and rejects any other value', () => {
    expect(verifySecret('invite-code-123', 'invite-code-123')).toBe(true);
    expect(verifySecret('invite-code-124', 'invite-code-123')).toBe(false);
    expect(verifySecret('invite-code-123 ', 'invite-code-123')).toBe(false);
    expect(verifySecret('', 'invite-code-123')).toBe(false);
    expect(verifySecret('a-much-longer-guess', 'invite-code-123')).toBe(false);
  });
});

describe('session tokens', () => {
  it('generates high-entropy unpredictable tokens', () => {
    const a = sessionToken();
    const b = sessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
