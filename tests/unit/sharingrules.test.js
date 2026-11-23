import { describe, it, expect } from 'vitest';
import { scanText, exposureOf } from '../../src/dlp/dlp.js';
import { planRestore } from '../../src/restore/restore.js';

const ids = (findings) => findings.map((f) => f.id);

describe('sensitive data detectors', () => {
  it('finds a card number written with its expiry date', () => {
    expect(ids(scanText('Card: 4111 1111 1111 1111 12/27'))).toContain('card');
    expect(ids(scanText('Card: 4111 1111 1111 1111 12/2027'))).toContain('card');
  });
  it('still ignores card-like numbers inside a run of figures', () => {
    expect(ids(scanText('4111 1111 1111 1111 2 3 4'))).not.toContain('card');
  });
  it('finds IBANs written in lower case', () => {
    expect(ids(scanText('iban gb82 west 1234 5698 7654 32'))).toContain('iban');
  });
});

describe('exposure of files inside a public folder', () => {
  const state = {
    org: { domain: 'example.com' },
    users: [],
    items: {
      pub: { id: 'pub', type: 'folder', parentId: null, link: { enabled: true, access: 'anyone' }, sharedWith: [] },
      sub: { id: 'sub', type: 'folder', parentId: 'pub', sharedWith: [] },
      f: { id: 'f', type: 'file', parentId: 'sub', sharedWith: [] },
      priv: { id: 'priv', type: 'file', parentId: null, sharedWith: [] },
    },
  };
  it('counts a public link on any parent folder', () => {
    expect(exposureOf(state, state.items.f).publicLink).toBe(true);
    expect(exposureOf(state, state.items.priv).publicLink).toBe(false);
  });
  it('ignores an expired parent link', () => {
    const s = { ...state, items: { ...state.items, pub: { ...state.items.pub, link: { enabled: true, access: 'anyone', expires: 1 } } } };
    expect(exposureOf(s, s.items.f).publicLink).toBe(false);
  });
});

describe('restore to a date never makes a folder loop', () => {
  // At T (=100): root > A > B. Since then B moved to root and A moved into B; then someone else locked A.
  const T = 100;
  const state = {
    meId: 'me',
    items: {
      root: { id: 'root', type: 'folder', name: 'Root', parentId: null, space: 'my', createdAt: 0 },
      A: { id: 'A', type: 'folder', name: 'A', parentId: 'B', space: 'my', createdAt: 0, lock: { by: 'u2' } },
      B: { id: 'B', type: 'folder', name: 'B', parentId: 'root', space: 'my', createdAt: 0 },
    },
    journal: [
      { id: 'j1', at: 200, itemId: 'B', kind: 'change', before: { name: 'B', parentId: 'A', space: 'my', trashed: false, version: 1, type: 'folder' } },
      { id: 'j2', at: 300, itemId: 'A', kind: 'change', before: { name: 'A', parentId: 'root', space: 'my', trashed: false, version: 1, type: 'folder' } },
    ],
  };
  it('moves B to the top instead of back under A (A is locked and stays inside B)', () => {
    const plan = planRestore(state, { folderId: 'root' }, T);
    expect(plan.skipped.map((s) => s.itemId)).toContain('A');
    const b = plan.ops.find((o) => o.itemId === 'B');
    expect(b.patch.parentId).toBe('root');
  });
});
