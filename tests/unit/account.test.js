import { describe, it, expect } from 'vitest';
import { totpCode, verifyTotp, newTotpSecret, totpUri } from '../../src/utils/totp.js';
import { checkPassword, passwordPatch, DEMO_PASSWORD, twoFactorOn, twoFactorMissing } from '../../src/store/account.js';

// RFC 6238 appendix B test secret ("12345678901234567890" in ASCII), base32-encoded. Codes are the last 6 digits.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('authenticator codes (TOTP)', () => {
  it('matches the RFC 6238 test vectors', async () => {
    expect(await totpCode(RFC_SECRET, 59_000)).toBe('287082');
    expect(await totpCode(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(await totpCode(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
    expect(await totpCode(RFC_SECRET, 2_000_000_000_000)).toBe('279037');
  });
  it('accepts the current code and one step either side, nothing else', async () => {
    const t = 1_700_000_000_000;
    expect(await verifyTotp(RFC_SECRET, await totpCode(RFC_SECRET, t), t)).toBe(true);
    expect(await verifyTotp(RFC_SECRET, await totpCode(RFC_SECRET, t - 30_000), t)).toBe(true);
    expect(await verifyTotp(RFC_SECRET, await totpCode(RFC_SECRET, t - 90_000), t)).toBe(false);
    expect(await verifyTotp(RFC_SECRET, '12345', t)).toBe(false);
    expect(await verifyTotp(null, '123456', t)).toBe(false);
  });
  it('makes 32-character base32 secrets and a scannable otpauth URL', () => {
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(newTotpSecret()).not.toBe(s);
    expect(totpUri(s, 'a@b.com', 'WorkDrive')).toBe(`otpauth://totp/WorkDrive%3Aa%40b.com?secret=${s}&issuer=WorkDrive&algorithm=SHA1&digits=6&period=30`);
  });
});

describe('your password', () => {
  it('uses the sample password until you set one, then only the new one', async () => {
    const s = { settings: { security: {} } };
    expect(await checkPassword(s, DEMO_PASSWORD)).toBe(true);
    expect(await checkPassword(s, 'something else')).toBe(false);
    const changed = { settings: (await passwordPatch(s, 'N3w-passphrase')) };
    expect(JSON.stringify(changed)).not.toContain('N3w-passphrase'); // only the hash is kept
    expect(await checkPassword(changed, 'N3w-passphrase')).toBe(true);
    expect(await checkPassword(changed, DEMO_PASSWORD)).toBe(false);
  });
  it('knows when 2FA is set up and when the organization still needs it', () => {
    const base = { org: { policies: { twoFactor: true } }, settings: { security: {} } };
    expect(twoFactorOn(base)).toBe(false);
    expect(twoFactorMissing(base)).toBe(true);
    const on = { ...base, settings: { security: { twoFactor: true, totpSecret: RFC_SECRET } } };
    expect(twoFactorOn(on)).toBe(true);
    expect(twoFactorMissing(on)).toBe(false);
    expect(twoFactorMissing({ ...base, org: { policies: { twoFactor: false } } })).toBe(false);
  });
});
