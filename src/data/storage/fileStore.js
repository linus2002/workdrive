/**
 * fileStore: file bytes (Blobs) keyed by blob key — an item id, or `<id>@v<no>` for an older version.
 * Browser implementation: IndexedDB database `workvault-drive-files`, object store `blobs`
 * (localStorage is far too small for real files). See ./index.js for the interface contract.
 *
 * Every method returns a Promise and rejects on failure (callers that don't care add .catch()).
 */

const DB_NAME = 'workvault-drive-files';
const STORE = 'blobs';

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
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function cursorAll() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const out = [];
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) { out.push([c.key, c.value]); c.continue(); } else resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

export const fileStore = {
  /** Save (or overwrite) the bytes for `id`. */
  put: (id, blob) => tx('readwrite', (s) => s.put(blob, id)),
  /** The Blob for `id`, or undefined. */
  get: (id) => tx('readonly', (s) => s.get(id)),
  delete: (id) => tx('readwrite', (s) => s.delete(id)),
  /** Every stored blob key. */
  list: () => tx('readonly', (s) => s.getAllKeys()).then((keys) => keys || []),
  /** [[id, Blob], ...] for every stored file. Resolves to [] when the store can't be opened. */
  loadAll: () => cursorAll().catch(() => []),
  clear: () => tx('readwrite', (s) => s.clear()),
  /** Replace everything with `entries` ([[id, Blob], ...]) in one transaction (all or nothing). */
  replaceAll: (entries) => tx('readwrite', (s) => { s.clear(); for (const [id, blob] of entries) s.put(blob, id); }),
  /** { count, bytes } of the stored files. */
  async usage() {
    const all = await cursorAll().catch(() => []);
    return { count: all.length, bytes: all.reduce((n, [, b]) => n + (b?.size || 0), 0) };
  },
};
