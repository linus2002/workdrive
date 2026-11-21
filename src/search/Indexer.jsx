import { useEffect, useRef } from 'react';
import { useDrive, blobRegistry } from '../store/DriveStore';
import { getFileType } from '../utils/fileTypes';
import { extractText } from './extract';
import { loadIndex, getEntry, setEntry, removeEntry, allEntries, setStatus, indexStatus, useSearchIndex } from './searchIndex';
import { suggestFor } from './suggest';

const OCR_TYPES = new Set(['image', 'pdf']);

/** Changes whenever the file's content (or whether OCR applies to it) changes, so it gets re-indexed. */
export function indexKey(item, ocrOn) {
  const cat = getFileType(item.ext).category;
  return `${item.version || 1}|${item.size}|${item.modifiedAt}|${blobRegistry.has(item.id) ? 'b' : ''}${OCR_TYPES.has(cat) && ocrOn ? '|o' : ''}`;
}

const needsIndex = (item, ocrOn) => item.type === 'file' && !item.trashed && getEntry(item.id)?.key !== indexKey(item, ocrOn);
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

  useEffect(() => {
    if (state.signedOut || !blobsVersion || !indexStatus().loaded || running.current) return;
    for (const id of [...allEntries().keys()]) if (!state.items[id]) removeEntry(id); // permanently deleted
    running.current = true;
    (async () => {
      for (;;) {
        const s = stateRef.current;
        if (s.signedOut) break;
        const ocrOn = s.org.policies.ocr !== false;
        const queue = Object.values(s.items).filter((i) => needsIndex(i, ocrOn)).sort((a, b) => cost(a) - cost(b));
        setStatus({ pending: queue.length });
        if (!queue.length) break;
        const item = queue[0];
        setStatus({ current: item.id });
        const key = indexKey(item, ocrOn);
        let text = '';
        try {
          const r = await extractText(item, { ocr: ocrOn }); // eslint-disable-line no-await-in-loop
          text = r?.text || '';
          setEntry(item.id, r ? { ...r, key, at: Date.now() } : { key, text: '', source: 'none', at: Date.now() });
        } catch (e) {
          setEntry(item.id, { key, text: '', source: 'error', error: e?.message || String(e), at: Date.now() });
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
