import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, hashPassword, sessionToken, verifyPassword, verifySecret } from './crypto';

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

describe('BYO-key envelope', () => {
  it('encrypts and decrypts a stored LLM key without leaking plaintext', async () => {
    const blob = encryptSecret('gsk_secret123', 'envelope-secret-at-least-32-bytes-long!!!');
    expect(blob).not.toContain('gsk_secret123');

    expect(decryptSecret(blob, 'envelope-secret-at-least-32-bytes-long!!!')).toBe('gsk_secret123');
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
