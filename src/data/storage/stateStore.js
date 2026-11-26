/**
 * stateStore: where the workspace state (one JSON document) is kept.
 * Browser implementation: localStorage key `workvault-drive:v1`. See ./index.js for the interface contract.
 */

const STATE_KEY = 'workvault-drive:v1';

/**
 * Smaller copy of the state for when the full one doesn't fit the storage quota. First only data that also lives
 * in the file store goes (embedded file data, and the text of old versions whose bytes are stored); only if that
 * still doesn't fit (trimHistory) are the journal and audit log shortened.
 */
function slimState(state, trimHistory) {
  const slimItem = (v) => {
    const versions = (v.versions || []).map((x) => (x.dataUrl || (x.hasBlob && x.content != null) ? { ...x, dataUrl: null, content: x.hasBlob ? null : x.content } : x));
    const changed = v.dataUrl || versions.some((x, i) => x !== v.versions[i]);
    return changed ? { ...v, dataUrl: null, versions, sessionOnly: !!v.dataUrl } : v;
  };
  const slim = { ...state, items: Object.fromEntries(Object.entries(state.items).map(([k, v]) => [k, slimItem(v)])) };
  return trimHistory ? { ...slim, journal: (state.journal || []).slice(-800), audit: (state.audit || []).slice(0, 200) } : slim;
}

const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

export const stateStore = {
  key: STATE_KEY,

  /** The saved state object exactly as stored (migrations are the caller's job), or null if none / unreadable. */
  load() {
    try { return parse(localStorage.getItem(STATE_KEY)); } catch { return null; }
  },

  /**
   * Save the whole state. Returns { ok: true } | { ok: true, slim: true } (saved without embedded file
   * data because the full copy didn't fit) | { ok: false, error }.
   */
  save(state) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
      return { ok: true };
    } catch {
      try {
        localStorage.setItem(STATE_KEY, JSON.stringify(slimState(state, false)));
        return { ok: true, slim: true };
      } catch {
        try {
          localStorage.setItem(STATE_KEY, JSON.stringify(slimState(state, true)));
          return { ok: true, slim: true, trimmed: true };
        } catch (e) {
          return { ok: false, error: e };
        }
      }
    }
  },

  /**
   * Call onExternalChange(savedState | null) when another tab saves the state (null = unreadable data).
   * Not called for our own saves or for removals. Returns an unsubscribe function.
   */
  subscribe(onExternalChange) {
    const onStorage = (e) => {
      if (e.key !== STATE_KEY || !e.newValue) return;
      onExternalChange(parse(e.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  },

  /** Forget the saved state. */
  clear() {
    try { localStorage.removeItem(STATE_KEY); } catch { /* storage unavailable */ }
  },
};
