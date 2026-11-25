/**
 * thumbStore: generated preview images (PDF first pages, video frames), keyed by `<kind>:<item id>@<version>`.
 * Kept out of the workspace state on purpose: localStorage is small (about 5 MB) and these can always be made
 * again from the file. Browser implementation: an in-memory cache in front of the IndexedDB database
 * `workvault-drive-thumbs`. Values are small plain objects ({ url, duration? }).
 */
import { useEffect, useState } from 'react';

const DB_NAME = 'workvault-drive-thumbs';
const STORE = 'thumbs';
const MAX_SAVED = 1500; // past this many, the saved cache is emptied and rebuilt as files are viewed

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.then(trim).catch(() => { dbPromise = null; });
  }
  return dbPromise;
}
function run(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
function trim(d) {
  const req = d.transaction(STORE, 'readonly').objectStore(STORE).count();
  req.onsuccess = () => { if (req.result > MAX_SAVED) d.transaction(STORE, 'readwrite').objectStore(STORE).clear(); };
}

const memory = new Map(); // key -> value
const pending = new Map(); // key -> Promise<value | null>
const failedAt = new Map(); // key -> retry token of the attempt that failed

/**
 * The cached thumbnail for `key`, making it with `make()` (→ value | null) the first time it's needed.
 * `retry` is a token (e.g. how many times file bytes were loaded): a failed attempt is tried again when it changes.
 * Returns null while loading or when no thumbnail can be made.
 */
export function useThumb(key, make, retry = 0) {
  const [value, setValue] = useState(() => (key && memory.get(key)) || null);
  useEffect(() => {
    if (!key) { setValue(null); return undefined; }
    if (memory.has(key)) { setValue(memory.get(key)); return undefined; }
    setValue(null);
    if (failedAt.get(key) === retry) return undefined;
    let alive = true;
    if (!pending.has(key)) {
      const job = (async () => {
        let v = await run('readonly', (s) => s.get(key)).catch(() => undefined);
        if (v == null) {
          v = await make().catch(() => null);
          if (v) run('readwrite', (s) => s.put(v, key)).catch(() => {});
        }
        if (v) { memory.set(key, v); failedAt.delete(key); } else failedAt.set(key, retry);
        return v || null;
      })().finally(() => pending.delete(key));
      pending.set(key, job);
    }
    pending.get(key).then((v) => { if (alive) setValue(v); });
    return () => { alive = false; };
  }, [key, retry]); // eslint-disable-line react-hooks/exhaustive-deps -- `make` is recreated each render
  return value;
}

/** Forget every thumbnail (e.g. when the workspace is reset). */
export function clearThumbs() {
  memory.clear();
  failedAt.clear();
  return run('readwrite', (s) => s.clear()).catch(() => {});
}
