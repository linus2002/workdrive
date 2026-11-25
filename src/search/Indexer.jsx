import { useEffect, useRef } from 'react';
import { useDrive, blobRegistry } from '../store/DriveStore';
import { getFileType } from '../utils/fileTypes';
import { extractText } from './extract';
import { loadIndex, getEntry, setEntry, removeEntry, allEntries, setStatus, indexStatus, useSearchIndex } from './searchIndex';
import { suggestFor } from './suggest';
import { shutdownOcr } from './ocr';

const OCR_TYPES = new Set(['image', 'pdf']);

/** Changes whenever the file's content (or whether OCR applies to it) changes, so it gets re-indexed. */
export function indexKey(item, ocrOn) {
  const cat = getFileType(item.ext).category;
  // The third part is a placeholder (it was the modified time, which renames change too); see sameKey.
  return `${item.version || 1}|${item.size}|0|${blobRegistry.has(item.id) ? 'b' : ''}${OCR_TYPES.has(cat) && ocrOn ? '|o' : ''}`;
}

/** Same contents and flags, ignoring the third part (old keys had the modified time there). */
export const sameKey = (a, b) => { if (!a || !b) return false; const x = a.split('|'); const y = b.split('|'); x[2] = y[2] = ''; return x.join('|') === y.join('|'); };

const RETRY_AFTER = 60_000;
const MAX_TRIES = 3;
/** Not indexed in its current form, or the last try failed (offline OCR, ...) and it's time to try again. */
const needsIndex = (item, ocrOn) => {
  if (item.type !== 'file' || item.trashed) return false;
  const e = getEntry(item.id);
  if (!sameKey(e?.key, indexKey(item, ocrOn))) return true;
  return e.source === 'error' && (e.tries || 1) < MAX_TRIES && Date.now() - e.at > RETRY_AFTER;
};
// Cheap formats first, OCR candidates last, so search becomes useful quickly.
const cost = (item) => (OCR_TYPES.has(getFileType(item.ext).category) ? 1 : 0);

/** Background indexer: renders nothing. Mounted once for the whole app. */
export default function Indexer() {
  const { state, api, blobsVersion } = useDrive();
  const stateRef = useRef(state);
  stateRef.current = state;
  const running = useRef(false);
  const startedAt = useRef(Date.now()); // auto-labeling only touches files added after this
  const indexVersion = useSearchIndex();

  useEffect(() => { loadIndex(); }, []);

  // The OCR engine holds a worker and ~10 MB of WebAssembly: release it when it can't be used.
  useEffect(() => {
    if (state.signedOut || state.org.policies.ocr === false) shutdownOcr();
  }, [state.signedOut, state.org.policies.ocr]);

  useEffect(() => {
    if (state.signedOut || !blobsVersion || !indexStatus().loaded || running.current) return;
    for (const id of [...allEntries().keys()]) if (!state.items[id]) removeEntry(id); // permanently deleted
    running.current = true;
    (async () => {
      // Each pass lists the work once (not once per file, which made indexing thousands of files slow),
      // then takes files in order, skipping any that changed or were indexed meanwhile. Another pass picks up the rest.
      let queue = [];
      for (;;) {
        const s = stateRef.current;
        if (s.signedOut) break;
        const ocrOn = s.org.policies.ocr !== false;
        if (!queue.length) {
          queue = Object.values(s.items).filter((i) => needsIndex(i, ocrOn)).sort((a, b) => cost(a) - cost(b)).map((i) => i.id);
          if (!queue.length) break;
        }
        setStatus({ pending: queue.length });
        const item = s.items[queue.shift()];
        if (!item || !needsIndex(item, ocrOn)) continue;
        setStatus({ current: item.id });
        const key = indexKey(item, ocrOn);
        let text = '';
        try {
          const r = await extractText(item, { ocr: ocrOn }); // eslint-disable-line no-await-in-loop
          text = r?.text || '';
          setEntry(item.id, r ? { ...r, key, at: Date.now() } : { key, text: '', source: 'none', at: Date.now() });
        } catch (e) {
          const prev = getEntry(item.id);
          const tries = prev?.key === key && prev.source === 'error' ? (prev.tries || 1) + 1 : 1;
          setEntry(item.id, { key, text: '', source: 'error', error: e?.message || String(e), at: Date.now(), tries });
        }
        // Automatic labeling (admin opt-in) for files added after the app started.
        const fresh = stateRef.current.items[item.id];
        if (fresh && stateRef.current.org.policies.smartLabels === 'auto' && fresh.createdAt >= startedAt.current && !fresh.autoLabeled) {
          const sug = suggestFor(stateRef.current, fresh, text);
          if (sug.labels.length || sug.template) {
            api.applySuggestions(fresh.id, { labelIds: sug.labels.map((l) => l.label.id), meta: sug.template ? { templateId: sug.template.tpl.id, values: sug.template.values } : null }, { auto: true });
          } else api.markAutoLabeled(fresh.id);
        }
        await new Promise((r) => setTimeout(r, 25)); // eslint-disable-line no-await-in-loop
      }
      setStatus({ current: null, pending: 0 });
      running.current = false;
    })();
  }, [state.items, state.signedOut, state.org.policies.ocr, blobsVersion, indexVersion, api]);

  return null;
}
