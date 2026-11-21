/** Browser storage quota and persistence (navigator.storage). See ./index.js. */

/**
 * { supported, usage, quota, persisted } — bytes used / available to this site and whether the browser
 * has promised not to evict the data under storage pressure. Numbers are null when the browser won't say.
 */
export async function storageInfo() {
  const s = typeof navigator !== 'undefined' ? navigator.storage : null;
  if (!s?.estimate) return { supported: false, usage: null, quota: null, persisted: null };
  let est = {};
  let persisted = null;
  try { est = await s.estimate(); } catch { /* not available */ }
  try { persisted = s.persisted ? await s.persisted() : null; } catch { /* not available */ }
  return { supported: true, usage: est.usage ?? null, quota: est.quota ?? null, persisted };
}

/** Ask the browser to keep this site's data. Resolves to { supported, granted }. Never throws. */
export async function requestPersistence() {
  const s = typeof navigator !== 'undefined' ? navigator.storage : null;
  if (!s?.persist) return { supported: false, granted: false };
  try {
    if (s.persisted && await s.persisted()) return { supported: true, granted: true };
    return { supported: true, granted: !!(await s.persist()) };
  } catch {
    return { supported: true, granted: false };
  }
}
