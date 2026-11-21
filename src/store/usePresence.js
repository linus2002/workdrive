import { useEffect, useState } from 'react';
import { useDrive } from './DriveStore';
import { peopleWithAccess } from './selectors';

// Simulated real-time presence. There is no backend, so "who else has this file open" is derived
// deterministically from the file id and a time window: it stays stable for a couple of minutes,
// then shifts, which is enough to show how presence looks. A lock always shows its holder as editing.

const WINDOW_MS = 2 * 60 * 1000;
const hash = (s) => [...s].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381);

/** Returns [{ user, mode: 'editing' | 'viewing' }] for people other than the current user. */
export function usePresence(item) {
  const { state } = useDrive();
  const [slot, setSlot] = useState(() => Math.floor(Date.now() / WINDOW_MS));
  useEffect(() => {
    const t = setInterval(() => setSlot(Math.floor(Date.now() / WINDOW_MS)), 20000);
    return () => clearInterval(t);
  }, []);

  if (!item || item.type !== 'file' || item.trashed) return [];
  const others = peopleWithAccess(state, item).filter((u) => u.id !== state.meId && u.status === 'active');
  const out = [];
  const lockHolder = item.lock && item.lock.by !== state.meId ? state.users.find((u) => u.id === item.lock.by) : null;
  if (lockHolder) out.push({ user: lockHolder, mode: 'editing' });

  const pool = others.filter((u) => u.id !== lockHolder?.id);
  const h = hash(`${item.id}:${slot}`);
  // Roughly 45% of collaborative files have someone else looking at them right now.
  if (pool.length && h % 100 < 45) {
    const count = 1 + (h >> 7) % Math.min(2, pool.length);
    for (let i = 0; i < count; i++) out.push({ user: pool[(h + i * 7) % pool.length], mode: 'viewing' });
  }
  return out.filter((p, i, a) => a.findIndex((x) => x.user.id === p.user.id) === i);
}
