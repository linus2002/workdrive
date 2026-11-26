// Time-based one-time passwords (RFC 6238, as used by Google Authenticator, Microsoft Authenticator, Authy...):
// 6 digits, 30-second steps, HMAC-SHA1. Uses WebCrypto, so it works in the browser without libraries.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A new random secret, base32-encoded (160 bits, the size authenticator apps expect). */
export function newTotpSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Bytes(secret) {
  const clean = String(secret).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of clean) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

/** The 6-digit code for `secret` at time `ms` (default now). */
export async function totpCode(secret, ms = Date.now(), step = 30) {
  let counter = Math.floor(ms / 1000 / step);
  const msg = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) { msg[i] = counter & 0xff; counter = Math.floor(counter / 256); }
  const key = await crypto.subtle.importKey('raw', base32Bytes(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = mac[mac.length - 1] & 0x0f;
  const n = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

/** Does `code` match now, or one step either side (to allow for clock drift and typing time)? */
export async function verifyTotp(secret, code, ms = Date.now()) {
  const c = String(code || '').replace(/\D/g, '');
  if (!secret || c.length !== 6) return false;
  for (const d of [0, -1, 1]) if (await totpCode(secret, ms + d * 30_000) === c) return true; // eslint-disable-line no-await-in-loop
  return false;
}

/** otpauth:// URL for the QR code an authenticator app scans. */
export const totpUri = (secret, account, issuer) => `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** "ABCD EFGH ..." for typing the secret by hand. */
export const groupSecret = (secret) => secret.replace(/(.{4})/g, '$1 ').trim();
