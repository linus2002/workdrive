// Your own sign-in credentials (password and authenticator-app 2FA), kept in Settings → Security.
// Browser-only for now: the password is stored as a salted PBKDF2 hash (see data/storage/secrets.js), never as text.
import { hashSecret, verifySecret } from '../data/storage/secrets';

/** Password of the sample account until you set your own in Settings → Security. */
export const DEMO_PASSWORD = 'demo1234';
export const MIN_PASSWORD = 8;

export const securityOf = (state) => state.settings?.security || {};

/** Is `plain` your current password? */
export async function checkPassword(state, plain) {
  const stored = securityOf(state).passwordHash;
  return stored ? verifySecret(plain, stored) : plain === DEMO_PASSWORD;
}

/** Settings patch that sets a new password. */
export async function passwordPatch(state, plain) {
  return { security: { ...securityOf(state), passwordHash: await hashSecret(plain), passwordChangedAt: Date.now() } };
}

/** 2FA is on and set up (has a secret to check codes against). */
export const twoFactorOn = (state) => !!(securityOf(state).twoFactor && securityOf(state).totpSecret);

/** The organization requires 2FA and you haven't set it up yet. */
export const twoFactorMissing = (state) => !!state.org?.policies?.twoFactor && !twoFactorOn(state);
