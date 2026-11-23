// Data loss prevention: find sensitive data in a file's indexed text and decide whether a share may go ahead.
// Detection is pattern-based with validation (Luhn, IBAN checksum, format rules) to keep false positives down.
import { getEntry } from '../search/searchIndex';
import { descendantIds, effectiveShares, ancestors } from '../store/selectors';

const digits = (s) => s.replace(/\D/g, '');

function luhn(num) {
  let sum = 0; let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = Number(num[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
function ibanValid(raw) {
  const s = raw.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of moved) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}
/** Card number prefixes of real networks (Visa, Mastercard, Amex, Discover, JCB, Diners, UnionPay). */
const cardNetwork = (d) => /^(4|5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720)|3[47]|6011|65|64[4-9]|35(2[89]|[3-8]\d)|30[0-5]|36|38|62)/.test(d);
/**
 * True when the match is part of a longer run of numbers (e.g. a row of spreadsheet cells), not a standalone value.
 * An expiry date right after a card number ("4111 … 1111 12/27") is not a run: that's how cards are written down.
 */
const inNumberRun = (text, index, length) => {
  if (/\d[ -]?$/.test(text.slice(Math.max(0, index - 3), index))) return true;
  const after = text.slice(index + length, index + length + 8);
  return /^[ -]?\d/.test(after) && !/^[ -]?\d{1,2}\/\d{2}(?:\d{2})?(?!\d)/.test(after);
};

/** Keep only the last 4 characters visible. */
const mask = (s, keep = 4) => { const t = s.trim(); return t.length <= keep ? '••••' : `${t.slice(0, -keep).replace(/[A-Za-z0-9]/g, '•')}${t.slice(-keep)}`; };

export const SEVERITY = { high: { rank: 3, label: 'High', tone: 'red' }, medium: { rank: 2, label: 'Medium', tone: 'amber' }, low: { rank: 1, label: 'Low', tone: 'gray' } };

export const DETECTORS = [
  { id: 'card', name: 'Payment card numbers', one: 'payment card number', many: 'payment card numbers', severity: 'high', re: /\b(?:\d[ -]?){12,18}\d\b(?!\/\d)/g, // (?!/\d): stop before a following MM/YY expiry
    // Luhn checksum + a real card network prefix + not embedded in a longer run of numbers (tables of figures).
    valid: (m, text, index) => { const d = digits(m); return d.length >= 13 && d.length <= 19 && !/^(\d)\1+$/.test(d) && cardNetwork(d) && luhn(d) && !inNumberRun(text, index, m.length); } },
  { id: 'iban', name: 'Bank IBANs', one: 'IBAN', many: 'IBANs', severity: 'high', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/gi, valid: ibanValid },
  { id: 'bank', name: 'Bank account numbers', one: 'bank account number', many: 'bank account numbers', severity: 'medium', re: /\b(?:account|acct|a\/c)\s*(?:no\.?|number|#)?\s*[:#]?\s*(\d[\d -]{6,18}\d)\b/gi, valid: (m) => digits(m).length >= 8 },
  { id: 'ph_tin', name: 'Philippine TINs', one: 'TIN', many: 'TINs', severity: 'high', re: /\b\d{3}-\d{3}-\d{3}(?:-\d{3,5})?\b/g },
  { id: 'ph_sss', name: 'Philippine SSS numbers', one: 'SSS number', many: 'SSS numbers', severity: 'high', re: /\b\d{2}-\d{7}-\d\b/g },
  { id: 'us_ssn', name: 'US Social Security numbers', one: 'US SSN', many: 'US SSNs', severity: 'high', re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  { id: 'secret', name: 'Passwords & API keys', one: 'password or API key', many: 'passwords or API keys', severity: 'high', re: /\b(?:AKIA[0-9A-Z]{16}|(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{16,}|gh[pousr]_[0-9A-Za-z]{30,})\b|\b(?:password|passwd|pwd)\s*[:=]\s*\S{4,}/gi },
  { id: 'emails', name: 'Email address lists', one: 'email address', many: 'email addresses', severity: 'low', min: 5, re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { id: 'phones', name: 'Phone number lists', one: 'phone number', many: 'phone numbers', severity: 'low', min: 5, re: /(?:\+63[ -]?|\b0)9\d{2}[ -]?\d{3}[ -]?\d{4}\b|\+\d{1,3}[ -]?\(?\d{2,4}\)?[ -]?\d{3,4}[ -]?\d{3,4}\b/g },
];
export const detectorById = Object.fromEntries(DETECTORS.map((d) => [d.id, d]));

/** Scan text. Returns [{ id, name, severity, count, samples: [masked] }], highest severity first. */
export function scanText(text, enabled = null) {
  if (!text) return [];
  const out = [];
  for (const d of DETECTORS) {
    if (enabled && enabled[d.id] === false) continue;
    const found = new Set();
    for (const m of text.matchAll(d.re)) {
      const value = m[1] && d.id === 'bank' ? m[1] : m[0];
      if (!d.valid || d.valid(value, text, m.index)) found.add(value.trim());
      if (found.size > 500) break;
    }
    if (found.size >= (d.min || 1)) out.push({ id: d.id, name: d.name, severity: d.severity, count: found.size, samples: [...found].slice(0, 3).map((v) => (d.id === 'emails' ? v.replace(/^[^@]{1,}/, (u) => `${u[0]}•••`) : mask(v))) });
  }
  return out.sort((a, b) => SEVERITY[b.severity].rank - SEVERITY[a.severity].rank || b.count - a.count);
}

// Findings depend on the indexed text and the policy; cache per item so lists stay fast.
const cache = new Map(); // id -> { key, findings }

/** Sensitive-data findings for a file (from its indexed text), minus ones marked "not sensitive". */
export function findingsFor(state, item) {
  const policy = state.org.policies.dlp;
  if (!policy?.enabled || item?.type !== 'file') return [];
  const entry = getEntry(item.id);
  if (!entry?.text) return [];
  const ignore = item.dlpIgnore || [];
  const key = `${entry.key}|${entry.at}|${JSON.stringify(policy.detectors || {})}|${ignore.join(',')}`;
  const hit = cache.get(item.id);
  if (hit?.key === key) return hit.findings;
  const findings = scanText(entry.text, policy.detectors).filter((f) => !ignore.includes(f.id));
  cache.set(item.id, { key, findings });
  return findings;
}

export const topSeverity = (findings) => findings.reduce((best, f) => (!best || SEVERITY[f.severity].rank > SEVERITY[best].rank ? f.severity : best), null);
const atLeast = (sev, min) => !!sev && SEVERITY[sev].rank >= SEVERITY[min || 'medium'].rank;

/** Files whose sensitive data a share of `item` would expose (the file itself, or a folder's contents). */
export function sensitiveWithin(state, item) {
  if (!item) return [];
  const ids = item.type === 'folder' ? descendantIds(state.items, item.id) : [item.id];
  const min = state.org.policies.dlp?.minSeverity;
  return ids.map((id) => state.items[id]).filter((i) => i && !i.trashed && i.type === 'file')
    .map((i) => ({ item: i, findings: findingsFor(state, i) }))
    .filter((x) => atLeast(topSeverity(x.findings), min));
}

const domainOf = (email) => (email || '').split('@')[1]?.toLowerCase() || '';
export const isExternalUser = (state, user) => !!user && domainOf(user.email) !== state.org.domain.toLowerCase();

const publicLinkOn = (link) => !!(link?.enabled && link.access === 'anyone' && !(link.expires && link.expires < Date.now()));

/** How a file/folder is exposed outside the organization right now (a public link on a parent folder counts). */
export function exposureOf(state, item) {
  const publicLink = publicLinkOn(item.link) || ancestors(state.items, item.id).some((a) => publicLinkOn(a.link));
  const external = effectiveShares(state.items, item.id).map((s) => state.users.find((u) => u.id === s.userId)).filter((u) => isExternalUser(state, u));
  return { publicLink, external };
}

/**
 * Under a "block" policy for public links: is any file this share would expose not yet scanned in its current
 * version (new upload, just edited)? Until it is, treat it as possibly sensitive instead of letting it through.
 */
export function scanPending(state, item) {
  const p = state.org.policies.dlp;
  if (!item || !p?.enabled || p.action !== 'block' || !p.publicLinks) return false;
  const ids = item.type === 'folder' ? descendantIds(state.items, item.id) : [item.id];
  return ids.map((id) => state.items[id]).some((f) => f && f.type === 'file' && !f.trashed
    && !getEntry(f.id)?.key?.startsWith(`${f.version || 1}|${f.size}|${f.modifiedAt}|`));
}

/** Like checkShare, for everything in a team folder (adding a member gives access to all of it). */
export function checkSpaceShare(state, space, kind) {
  const p = state.org.policies.dlp;
  if (!p?.enabled || p.action === 'monitor') return { decision: 'allow', files: [] };
  if ((kind === 'public' && !p.publicLinks) || (kind === 'external' && !p.external)) return { decision: 'allow', files: [] };
  const roots = Object.values(state.items).filter((i) => i.space === space && !i.parentId && !i.trashed);
  const files = roots.flatMap((r) => sensitiveWithin(state, r));
  if (!files.length) return { decision: 'allow', files };
  return { decision: p.action === 'block' ? 'block' : 'warn', files };
}

/**
 * Policy decision for a share. kind: 'public' (anyone-with-link) | 'external' (people outside the domain).
 * Returns { decision: 'allow' | 'warn' | 'block', files: [{ item, findings }] }.
 */
export function checkShare(state, item, kind) {
  const p = state.org.policies.dlp;
  if (!p?.enabled || p.action === 'monitor') return { decision: 'allow', files: [] };
  if ((kind === 'public' && !p.publicLinks) || (kind === 'external' && !p.external)) return { decision: 'allow', files: [] };
  const files = sensitiveWithin(state, item);
  if (!files.length) return { decision: 'allow', files };
  return { decision: p.action === 'block' ? 'block' : 'warn', files };
}

/** One-line summary like "2 payment card numbers, 1 IBAN". */
export function summarize(findings, max = 3) {
  const parts = findings.slice(0, max).map((f) => { const d = detectorById[f.id]; return `${f.count} ${f.count === 1 ? d.one : d.many}`; });
  return parts.join(', ') + (findings.length > max ? ` +${findings.length - max} more` : '');
}

export const DEFAULT_DLP = {
  enabled: true, action: 'warn', minSeverity: 'medium', publicLinks: true, external: true,
  detectors: Object.fromEntries(DETECTORS.map((d) => [d.id, true])),
};
