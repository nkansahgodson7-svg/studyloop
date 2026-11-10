/**
 * Signed envelope around the opaque session token.
 *
 * The token itself still lives in the `sessions` table and every API handler
 * looks it up there, so revocation is immediate. The envelope exists so
 * middleware can answer "is this cookie ours and unexpired?" without a network
 * round-trip (previously it made an HTTP call to /api/auth/me on every page
 * load).
 *
 * Edge-safe: WebCrypto only, no node builtins, so middleware can import it.
 */

export const SESSION_COOKIE_VERSION = 'v1';

export interface SessionCookie {
  token: string;
  /** Absolute expiry in ms since epoch. */
  expiresAt: number;
  mustChangePassword: boolean;
}

interface Payload {
  t: string;
  e: number;
  m: 0 | 1;
}

// Development/test only: keeps local runs working without extra setup. Boot
// validation requires ENCRYPTION_SECRET in production, so this is never used
// there.
const DEV_FALLBACK_SECRET = 'studyloop-insecure-development-session-secret';

function cookieSecret(): string | null {
  const configured =
    process.env.SESSION_SECRET?.trim() || process.env.ENCRYPTION_SECRET?.trim();
  if (configured) {
    return configured;
  }
  return process.env.NODE_ENV === 'production' ? null : DEV_FALLBACK_SECRET;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array | null {
  try {
    const padded =
      value.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
    keyCache.set(secret, key);
  }
  return key;
}

/** True for values produced by `signSessionCookie` (vs. a bare legacy token). */
export function isSignedSessionCookie(value: string): boolean {
  return value.startsWith(`${SESSION_COOKIE_VERSION}.`);
}

export async function signSessionCookie(session: SessionCookie): Promise<string | null> {
  const secret = cookieSecret();
  if (!secret) {
    return null;
  }
  const payload: Payload = {
    t: session.token,
    e: session.expiresAt,
    m: session.mustChangePassword ? 1 : 0
  };
  const body = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(`${SESSION_COOKIE_VERSION}.${body}`)
  );
  return `${SESSION_COOKIE_VERSION}.${body}.${encodeBase64Url(new Uint8Array(signature))}`;
}

/**
 * Returns the session carried by a signed cookie, or null when the signature,
 * the shape, or the expiry does not check out.
 */
export async function verifySessionCookie(
  value: string,
  now = Date.now()
): Promise<SessionCookie | null> {
  const secret = cookieSecret();
  if (!secret) {
    return null;
  }
  const parts = value.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [version, body, signature] = parts as [string, string, string];
  if (version !== SESSION_COOKIE_VERSION || !body || !signature) {
    return null;
  }
  const signatureBytes = decodeBase64Url(signature);
  if (!signatureBytes) {
    return null;
  }
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    signatureBytes as BufferSource,
    new TextEncoder().encode(`${SESSION_COOKIE_VERSION}.${body}`)
  );
  if (!valid) {
    return null;
  }
  const payloadBytes = decodeBase64Url(body);
  if (!payloadBytes) {
    return null;
  }
  let payload: Payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as Payload;
  } catch {
    return null;
  }
  if (
    typeof payload?.t !== 'string' ||
    payload.t.length === 0 ||
    typeof payload?.e !== 'number' ||
    payload.e <= now
  ) {
    return null;
  }
  return {
    token: payload.t,
    expiresAt: payload.e,
    mustChangePassword: payload.m === 1
  };
}
