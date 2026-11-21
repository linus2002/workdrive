import { describe, it, expect } from 'vitest';
import { ITEMS, USERS, TEAMS, ORG, ME } from '../../src/data/mockData.js';
import { effectiveShares, accessOf } from '../../src/store/selectors.js';
import { guestRows, guestsCsv, accessState, resourcesOf, defaultGuestExpiry } from '../../src/sharing/guests.js';
import { qrMatrix, qrSvg } from '../../src/sharing/qr.js';
import { contrast, textOn, fillMessage, brandVars, mix, DEFAULT_BRANDING } from '../../src/sharing/branding.js';
import { mockState, itemNamed } from './helpers.jsx';

const DAY = 86400000;
const state = mockState();
const { items } = state;
const nda = itemNamed('Signed NDA.pdf');

describe('guest access', () => {
  it('seeds four sample guests', () => {
    expect(USERS.filter((u) => u.role === 'Guest')).toHaveLength(4);
  });
  it('leaves expired shares out of effective access (owners can still see them)', () => {
    const live = effectiveShares(items, nda.id);
    expect(live.some((s) => s.userId === 'ug1')).toBe(true);
    expect(live.some((s) => s.userId === 'ug2')).toBe(false);
    expect(effectiveShares(items, nda.id, { includeExpired: true }).some((s) => s.userId === 'ug2')).toBe(true);
  });
  it('a live share grants access, an expired one does not', () => {
    expect(accessOf({ ...state, meId: 'ug1' }, nda)).toBe('viewer');
    expect(accessOf({ ...state, meId: 'ug2' }, nda)).toBe('none');
  });
  it('guest team membership grants access until it expires', () => {
    const hospitalItem = { id: 'x', space: 't-hospital', ownerId: 'u1' };
    expect(accessOf({ ...state, meId: 'ug4' }, hospitalItem)).toBe('viewer');
    const expiredTeams = TEAMS.map((t) => (t.id === 't-hospital' ? { ...t, members: t.members.map((m) => (m.userId === 'ug4' ? { ...m, expires: Date.now() - 1000 } : m)) } : t));
    expect(accessOf({ ...state, teams: expiredTeams, meId: 'ug4' }, hospitalItem)).toBe('none');
  });
  it('a folder share is inherited by the files inside', () => {
    expect(accessOf({ ...state, meId: 'ug3' }, itemNamed('Homepage Hero.jpg'))).toBe('editor');
  });

  const rows = guestRows(state);
  const by = (id) => rows.find((r) => r.user.id === id);
  it('lists each guest with live / expired / expiring counts', () => {
    expect(rows).toHaveLength(4);
    expect(by('ug2')).toMatchObject({ live: 1, expired: 1 });
    expect(by('ug1')).toMatchObject({ state: 'expiring', expiring: 1 });
    expect(by('ug3')).toMatchObject({ noExpiry: 1, state: 'open' });
    expect(by('ug4').resources.some((r) => r.kind === 'team')).toBe(true);
    expect(by('ug4').expired).toBe(1);
    expect(rows.some((r) => r.user.id === ME)).toBe(false);
  });
  it('sorts resources soonest-expiring first', () => {
    const res = resourcesOf(state, 'ug1');
    expect(res[0].expires).toBeLessThanOrEqual(res[1].expires);
  });
  it('buckets expiry dates', () => {
    expect(accessState(null)).toBe('open');
    expect(accessState(Date.now() - 1)).toBe('expired');
    expect(accessState(Date.now() + 3 * DAY)).toBe('expiring');
    expect(accessState(Date.now() + 30 * DAY)).toBe('active');
  });
  it('defaults new guest access to the policy length (0 = never expires)', () => {
    const d = defaultGuestExpiry(state);
    expect(d).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(d).toBeLessThan(Date.now() + 31 * DAY);
    expect(defaultGuestExpiry({ ...state, org: { ...ORG, policies: { ...ORG.policies, guestAccessDays: 0 } } })).toBeNull();
  });
  it('exports one CSV row per guest resource', () => {
    const csv = guestsCsv(state, rows);
    expect(csv.split('\n')).toHaveLength(1 + rows.reduce((s, r) => s + Math.max(1, r.resources.length), 0));
    expect(csv).toContain('Expired');
  });
});

describe('QR codes', () => {
  const url = 'https://drive.example/link/i42?src=qr';
  const m = qrMatrix(url);
  it('builds a square matrix of a valid QR size', () => {
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect((m.length - 17) % 4).toBe(0);
    expect(m.every((r) => r.length === m.length)).toBe(true);
  });
  it('has a finder pattern in the corner', () => {
    expect(m[0][0] && m[0][6] && !m[1][1] && m[2][2]).toBeTruthy();
  });
  it('the high-error-correction code for a logo is the same size or larger', () => {
    expect(qrMatrix(url, { logo: true }).length).toBeGreaterThanOrEqual(m.length);
  });
  it('renders SVG', () => {
    const svg = qrSvg('hello');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<path');
  });
});

describe('branding', () => {
  it('computes contrast ratios', () => {
    expect(Math.round(contrast('#FFFFFF', '#000000'))).toBe(21);
  });
  it('picks readable header text', () => {
    expect(textOn('#0B1F3A')).toBe('#FFFFFF');
    expect(textOn('#FFFFFF')).toBe('#111827');
  });
  it('fills welcome message placeholders', () => {
    expect(fillMessage('{sender} from {org} shared {file}', { sender: 'Ana', org: 'Getmeds', file: 'a.pdf' })).toBe('Ana from Getmeds shared a.pdf');
  });
  it('produces CSS variables only when branding is on', () => {
    expect(brandVars({ ...DEFAULT_BRANDING, accentColor: '#DC2626' })['--primary']).toBe('#DC2626');
    expect(Object.keys(brandVars({ ...DEFAULT_BRANDING, enabled: false }))).toHaveLength(0);
  });
  it('mixes colours', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
});

it('sample data has unique item ids', () => {
  expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
});
