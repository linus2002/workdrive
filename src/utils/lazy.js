import { lazy } from 'react';

/**
 * React.lazy for a named export: lazyNamed(() => import('./X'), 'Thing').
 * If a chunk fails to load (e.g. the app was updated while this tab was open), reload once to pick up the new files.
 */
export function lazyNamed(loader, name = 'default') {
  return lazy(() => loader().then((m) => ({ default: m[name] })).catch((err) => {
    try {
      const key = 'workvault-drive:chunk-reload';
      if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); window.location.reload(); return new Promise(() => {}); }
    } catch { /* storage unavailable */ }
    throw err;
  }));
}
