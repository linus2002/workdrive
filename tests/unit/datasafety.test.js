import { describe, it, expect } from 'vitest';
import { descendantIds, childIds, lockedInside } from '../../src/store/selectors.js';
import { __test } from '../../src/store/DriveStore.jsx';

const { mergeStates } = __test;

const tree = () => ({
  root: { id: 'root', type: 'folder', parentId: null },
  a: { id: 'a', type: 'folder', parentId: 'root' },
  f1: { id: 'f1', type: 'file', parentId: 'a' },
  f2: { id: 'f2', type: 'file', parentId: 'root' },
  other: { id: 'other', type: 'file', parentId: null },
});

describe('folder walks', () => {
  it('lists every descendant, nested ones included', () => {
    expect(descendantIds(tree(), 'root').sort()).toEqual(['a', 'f1', 'f2']);
    expect(descendantIds(tree(), 'f1')).toEqual([]);
    expect(childIds(tree(), 'root').sort()).toEqual(['a', 'f2']);
  });
  it('sees changes once the items object is replaced (as every state update does)', () => {
    const items = tree();
    expect(descendantIds(items, 'a')).toEqual(['f1']);
    const next = { ...items, f3: { id: 'f3', type: 'file', parentId: 'a' } };
    expect(descendantIds(next, 'a').sort()).toEqual(['f1', 'f3']);
  });
});

describe('locks inside folders', () => {
  const state = (lockBy) => ({ meId: 'me', items: { ...tree(), f1: { ...tree().f1, lock: lockBy ? { by: lockBy } : null } } });
  it("finds a file someone else checked out deep inside a folder", () => {
    expect(lockedInside(state('u2'), 'root')?.id).toBe('f1');
    expect(lockedInside(state('u2'), 'a')?.id).toBe('f1');
    expect(lockedInside(state('u2'), 'f2')).toBeNull();
  });
  it('ignores my own locks', () => {
    expect(lockedInside(state('me'), 'root')).toBeNull();
  });
});

describe('merging another tab’s save with unsaved changes', () => {
  const base = {
    items: { x: { id: 'x', name: 'X' }, y: { id: 'y', name: 'Y' }, z: { id: 'z', name: 'Z' } },
    audit: [{ id: 'a1' }],
    journal: [{ id: 'j1' }],
    settings: { theme: 'light' },
  };
  it('keeps my edits and theirs when they touch different items', () => {
    const ours = { ...base, items: { ...base.items, x: { id: 'x', name: 'X mine' } } };
    // Another tab saved: a fresh copy (new objects, as after JSON parsing) with y renamed.
    const theirs = JSON.parse(JSON.stringify(base));
    theirs.items.y.name = 'Y theirs';
    const m = mergeStates(base, ours, theirs);
    expect(m.items.x.name).toBe('X mine');
    expect(m.items.y.name).toBe('Y theirs');
    expect(m.items.z.name).toBe('Z');
  });
  it('keeps items I created or deleted', () => {
    const items = { ...base.items, n: { id: 'n', name: 'New' } };
    delete items.z;
    const ours = { ...base, items };
    const theirs = JSON.parse(JSON.stringify(base));
    const m = mergeStates(base, ours, theirs);
    expect(m.items.n?.name).toBe('New');
    expect(m.items.z).toBeUndefined();
  });
  it('keeps new log entries from both tabs, in each list’s order', () => {
    const ours = { ...base, audit: [{ id: 'a-mine' }, ...base.audit], journal: [...base.journal, { id: 'j-mine' }] };
    const theirs = JSON.parse(JSON.stringify(base));
    theirs.audit.unshift({ id: 'a-theirs' });
    theirs.journal.push({ id: 'j-theirs' });
    const m = mergeStates(base, ours, theirs);
    expect(m.audit.map((e) => e.id)).toEqual(['a-mine', 'a-theirs', 'a1']);
    expect(m.journal.map((e) => e.id)).toEqual(['j1', 'j-theirs', 'j-mine']);
  });
  it('takes their value for anything I did not change', () => {
    const theirs = JSON.parse(JSON.stringify(base));
    theirs.settings.theme = 'dark';
    const m = mergeStates(base, { ...base }, theirs);
    expect(m.settings.theme).toBe('dark');
  });
});
