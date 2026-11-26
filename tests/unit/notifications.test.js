import { describe, it, expect } from 'vitest';
import { simulateEvent, wantsNotification } from '../../src/notifications/simulate.js';
import { accessOf } from '../../src/store/selectors.js';
import { mockState } from './helpers.jsx';

/** Deterministic random numbers for repeatable runs. */
const seeded = (seed) => () => { // mulberry32
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('live teammate activity', () => {
  it('always produces a real change and a notification from someone else', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = mockState();
      const r = simulateEvent(s, seeded(seed));
      expect(r).toBeTruthy();
      expect(r.state).not.toBe(s);
      const n = r.notification;
      expect(n.actorId).toBeTruthy();
      expect(n.actorId).not.toBe(s.meId);
      expect(s.users.find((u) => u.id === n.actorId)?.status).toBe('active');
      expect(['comment', 'share', 'upload', 'task']).toContain(n.type);
      expect(n.text.length).toBeGreaterThan(5);
    }
  });

  it('a comment notification adds that comment to a file you can open', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const s = mockState();
      const r = simulateEvent(s, seeded(seed));
      if (r.notification.type !== 'comment') continue;
      const id = new URL(r.notification.link, 'http://x').searchParams.get('preview');
      const it = r.state.items[id];
      expect(accessOf(r.state, it)).not.toBe('none');
      expect(it.comments.at(-1).userId).toBe(r.notification.actorId);
      return;
    }
    throw new Error('no comment event generated');
  });

  it('shared and uploaded files land where you can see them', () => {
    let checked = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const s = mockState();
      const r = simulateEvent(s, seeded(seed));
      if (!['share', 'upload'].includes(r.notification.type)) continue;
      const added = Object.keys(r.state.items).filter((k) => !s.items[k]);
      expect(added).toHaveLength(1);
      const it = r.state.items[added[0]];
      expect(accessOf(r.state, it)).not.toBe('none');
      expect(it.ownerId).toBe(r.notification.actorId);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('produces every kind of activity', () => {
    const kinds = new Set();
    for (let seed = 1; seed <= 80; seed++) kinds.add(simulateEvent(mockState(), seeded(seed)).notification.type);
    expect([...kinds].sort()).toEqual(['comment', 'share', 'task', 'upload']);
  });
});

describe('notification preferences', () => {
  const s = mockState();
  it('never notifies you about your own actions', () => {
    expect(wantsNotification(s, { type: 'team', actorId: s.meId })).toBe(false);
  });
  it('follows the Settings switches per kind', () => {
    const off = { ...s, settings: { notifications: { comments: false } } };
    expect(wantsNotification(off, { type: 'comment', actorId: 'u2' })).toBe(false);
    expect(wantsNotification(off, { type: 'share', actorId: 'u2' })).toBe(true);
    expect(wantsNotification(off, { type: 'signature', actorId: 'u2' })).toBe(true);
  });
});

describe('simulated activity stays bounded', () => {
  it('keeps only the newest simulated files, comments and tasks', async () => {
    const { pruneSimulated, SIM_LIMITS } = await import('../../src/notifications/simulate.js');
    let s = { ...mockState(), tasks: [], settings: { notifications: {} } };
    let seed = 7;
    const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 400; i++) {
      const r = simulateEvent(s, rnd);
      s = r.state;
    }
    const files = Object.values(s.items).filter((i) => i.simulated);
    const comments = Object.values(s.items).flatMap((i) => (i.comments || []).filter((c) => c.simulated));
    const tasks = s.tasks.filter((t) => t.simulated);
    expect(files.length).toBeLessThanOrEqual(SIM_LIMITS.files);
    expect(comments.length).toBeLessThanOrEqual(SIM_LIMITS.comments);
    expect(tasks.length).toBeLessThanOrEqual(SIM_LIMITS.tasks);
    expect(tasks.every((t) => s.items[t.itemId])).toBe(true);
    expect(pruneSimulated(s)).toBe(s); // nothing left to prune
  });

  it('keeps simulated files you have worked on', async () => {
    const { pruneSimulated, SIM_LIMITS } = await import('../../src/notifications/simulate.js');
    const base = mockState();
    const items = { ...base.items };
    for (let i = 0; i < SIM_LIMITS.files + 5; i++) items[`sim${i}`] = { id: `sim${i}`, type: 'file', simulated: true, createdAt: i, modifiedBy: 'u2', comments: [] };
    items.sim0 = { ...items.sim0, favorite: true };
    const out = pruneSimulated({ ...base, items, tasks: [] });
    expect(out.items.sim0).toBeTruthy(); // favorited: kept although it's the oldest
    expect(out.items.sim1).toBeUndefined();
    expect(Object.values(out.items).filter((i) => i.simulated && !i.favorite)).toHaveLength(SIM_LIMITS.files);
  });
});
