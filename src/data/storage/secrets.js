/**
 * Password hashing for link passwords (`item.link.secretHash`) and file-request passwords (`req.secretHash`).
 *
 * Passwords are never stored in plain text: we keep a PBKDF2-SHA256 digest
 *   { alg: 'pbkdf2-sha256', iter, salt, hash }   (salt / hash are base64)
 * and check a typed password by deriving it again with the same salt.
 *
 * Note: in this browser-only prototype the digest still lives next to the data it protects, so this stops
 * casual disclosure (exports, devtools, backups) rather than a determined local attacker. A server-backed
 * implementation should verify on the server and never send the digest to the browser.
 */

export const SECRET_ALG = 'pbkdf2-sha256';
const ITERATIONS = 150000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

const toB64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function derive(plain, salt, iter) {
  if (!globalThis.crypto?.subtle) throw new Error('This browser cannot check passwords (WebCrypto is unavailable).');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(plain)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, HASH_BITS);
  return new Uint8Array(bits);
}

/** Hash a plain password → { alg, iter, salt, hash }. */
export async function hashSecret(plain) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(plain, salt, ITERATIONS);
  return { alg: SECRET_ALG, iter: ITERATIONS, salt: toB64(salt), hash: toB64(hash) };
}

/**
 * Does `plain` match the stored digest? `stored` may also be a legacy plain-text string
 * (data saved before hashing, for the moment before the start-up migration finishes).
 */
export async function verifySecret(plain, stored) {
  if (!stored) return false;
  if (typeof stored === 'string') return String(plain) === stored;
  if (stored.alg !== SECRET_ALG || !stored.salt || !stored.hash) return false;
  const want = fromB64(stored.hash);
  const got = await derive(plain, fromB64(stored.salt), stored.iter || ITERATIONS);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

/** Is a password set on this link / file request? (hashed, or legacy plain text awaiting migration) */
export const hasSecret = (o) => !!(o?.secretHash || o?.secret);

/** The value to pass to verifySecret for a link / file request. */
export const storedSecret = (o) => o?.secretHash || o?.secret || null;
