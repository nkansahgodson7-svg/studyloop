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
