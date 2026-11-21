import { describe, it, expect } from 'vitest';
import { toDateInput, fromDateInput } from '../../src/utils/format.js';
import { teamRoleOf, canDownload, quotaError, writableFolders, accessOf } from '../../src/store/selectors.js';
import { ORG } from '../../src/data/mockData.js';
import { mockState, itemNamed } from './helpers.jsx';

describe('date inputs', () => {
  it('round-trips a date through the input format (end of day, local time)', () => {
    const ts = new Date(2026, 1, 28, 9, 30).getTime();
    const str = toDateInput(ts);
    expect(str).toBe('2026-02-28');
    const back = fromDateInput(str);
    expect(new Date(back).getDate()).toBe(28);
    expect(new Date(back).getHours()).toBe(23);
    expect(toDateInput(back)).toBe(str);
    const start = fromDateInput(str, { endOfDay: false });
    expect(toDateInput(start)).toBe(str);
    expect(new Date(start).getHours()).toBe(0);
  });
  it('pads single-digit months and days', () => {
    expect(toDateInput(new Date(2026, 0, 5).getTime())).toBe('2026-01-05');
  });
  it('treats empty or malformed values as no date', () => {
    expect(toDateInput(null)).toBe('');
    expect(toDateInput(0)).toBe('');
    expect(fromDateInput('')).toBeNull();
    expect(fromDateInput('not-a-date')).toBeNull();
  });
});

describe('team roles and permissions', () => {
  const state = mockState();
  it("reads the current user's team role (lower-case), null for non-members", () => {
    expect(teamRoleOf(state, 't4')).toBe('viewer'); // Design Studio: the demo admin is only a viewer
    expect(teamRoleOf(state, 't2')).toBe('editor');
    expect(teamRoleOf(state, 't3')).toBe('admin');
    expect(teamRoleOf(state, 't4', 'u4')).toBe('admin');
    expect(teamRoleOf(state, 't1', 'u5')).toBeNull();
    expect(teamRoleOf(state, 'no-such-team')).toBeNull();
  });
  it('an expired team membership gives no role', () => {
    const teams = state.teams.map((t) => (t.id === 't2' ? { ...t, members: t.members.map((m) => (m.userId === 'u1' ? { ...m, expires: Date.now() - 1 } : m)) } : t));
    expect(teamRoleOf({ ...state, teams }, 't2')).toBeNull();
  });
  it('canDownload: anyone with access, unless viewers are restricted by policy', () => {
    const mockup = itemNamed('Dashboard Mockup.png'); // Design Studio, viewer access
    expect(accessOf(state, mockup)).toBe('viewer');
    expect(canDownload(state, mockup)).toBe(true);
    const restricted = { ...state, org: { ...ORG, policies: { ...ORG.policies, downloadRestriction: true } } };
    expect(canDownload(restricted, mockup)).toBe(false);
    expect(canDownload(restricted, itemNamed('Company Overview.pptx'))).toBe(true); // owner
    expect(canDownload({ ...state, meId: 'u5' }, mockup)).toBe(false); // not a member
  });
});

describe('quota', () => {
  const state = mockState();
  it("allows uploads that fit and refuses ones that don't", () => {
    expect(quotaError(state, 'my', 0)).toBeNull();
    expect(quotaError(state, 'my', 1024)).toBeNull();
    expect(quotaError(state, 'my', ORG.userQuota + 1)).toMatch(/My Folders/);
    expect(quotaError(state, 't4', 1024)).toBeNull();
    expect(quotaError(state, 't4', 76 * 1024 ** 3)).toMatch(/Design Studio/);
  });
});

describe('writable folders', () => {
  const state = mockState();
  const list = writableFolders(state);
  it('starts with My Folders and lists nested folders with their paths', () => {
    expect(list[0]).toMatchObject({ id: null, space: 'my', root: true, path: 'My Folders' });
    const nested = list.find((f) => f.depth >= 2);
    expect(nested).toBeTruthy();
    expect(nested.path.split(' / ')).toHaveLength(nested.depth + 1);
  });
  it('includes teams the user can write to and leaves out view-only teams', () => {
    const teamRoots = list.filter((f) => f.team).map((f) => f.space);
    expect(teamRoots).toContain('t2');
    expect(teamRoots).toContain('t3');
    expect(teamRoots).not.toContain('t4');
    expect(list.some((f) => f.space === 't4')).toBe(false);
  });
  it('never lists trashed folders', () => {
    const trashed = new Set(Object.values(state.items).filter((i) => i.trashed && i.type === 'folder').map((i) => i.id));
    expect(list.some((f) => trashed.has(f.id))).toBe(false);
  });
});
