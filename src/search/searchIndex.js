// The full-text index: extracted text per file, kept in memory and persisted to IndexedDB.
// React components subscribe with useSearchIndex(), which re-renders them when entries change.
import { useSyncExternalStore } from 'react';

const DB_NAME = 'workvault-drive-index';
const STORE = 'entries';
const entries = new Map(); // id -> { key, text, source, confidence, at, error }
const status = { pending: 0, current: null, loaded: false, ocrReady: false };
const listeners = new Set();
let version = 0;

const emit = () => { version++; listeners.forEach((l) => l()); };
export const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
export const getVersion = () => version;
export function useSearchIndex() { return useSyncExternalStore(subscribe, getVersion); }

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
const write = (fn) => db().then((d) => new Promise((res) => { const t = d.transaction(STORE, 'readwrite'); fn(t.objectStore(STORE)); t.oncomplete = res; t.onerror = res; t.onabort = res; })).catch(() => {});

/** Load persisted entries once at start-up. */
export async function loadIndex() {
  if (status.loaded) return;
  try {
    const d = await db();
    await new Promise((resolve) => {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { entries.set(c.key, c.value); c.continue(); } else resolve(); };
      req.onerror = () => resolve();
    });
  } catch { /* index starts empty */ }
  status.loaded = true;
  emit();
}

export const getEntry = (id) => entries.get(id) || null;
export const allEntries = () => entries;
export function setEntry(id, entry) { entries.set(id, entry); write((s) => s.put(entry, id)); emit(); }
export function removeEntry(id) { if (entries.delete(id)) { write((s) => s.delete(id)); emit(); } }
export function clearIndex() { entries.clear(); write((s) => s.clear()); emit(); }

export const indexStatus = () => status;
/** Only notifies when something actually changed (the indexer re-runs on every notification). */
export function setStatus(patch) {
  if (Object.entries(patch).every(([k, v]) => status[k] === v)) return;
  Object.assign(status, patch);
  emit();
}

/* ---------------- Matching + snippets ---------------- */
const terms = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);

/** True when every word of the query appears in the file's indexed text. */
export function contentMatches(id, q) {
  const e = entries.get(id);
  if (!e?.text) return false;
  const t = e.text.toLowerCase();
  return terms(q).every((w) => t.includes(w));
}

/** ~160 characters around the first match, with the matched words marked: [{ text, hit }]. */
export function snippet(id, q, radius = 70) {
  const e = entries.get(id);
  if (!e?.text) return null;
  const words = terms(q);
  const lower = e.text.toLowerCase();
  const at = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0));
  if (!Number.isFinite(at)) return null;
  const start = Math.max(0, at - radius);
  const end = Math.min(e.text.length, at + Math.max(radius * 1.4, 120));
  const raw = `${start ? '…' : ''}${e.text.slice(start, end).replace(/\s+/g, ' ')}${end < e.text.length ? '…' : ''}`;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return { parts: raw.split(re).filter(Boolean).map((p) => ({ text: p, hit: words.includes(p.toLowerCase()) })), source: e.source };
}

/**
 * Was this index entry made from the item's current contents? Keys are `version|size|<anything>|flags`: the
 * third part used to be the modified time, which also changes on renames, so it's ignored (renames don't re-index).
 */
export const indexedCurrent = (entry, item) => {
  const k = entry?.key?.split('|');
  return !!k && k[0] === String(item.version || 1) && k[1] === String(item.size);
};
