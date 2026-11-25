import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useDrive, registerBlob } from './DriveStore';
import { useUI } from './UIContext';
import { uid, splitName, formatSize } from '../utils/format';
import { getFileType } from '../utils/fileTypes';
import { quotaError } from './selectors';

export const MAX_FILE_SIZE = 250 * 1024 * 1024; // per-file upload limit for the prototype
const PERSIST_LIMIT = 400 * 1024; // embed small files in localStorage so they survive reloads

const UploadCtx = createContext(null);

const readAs = (file, kind) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  if (kind === 'text') r.readAsText(file); else r.readAsDataURL(file);
});

/** Read what an uploaded File needs to preview after reload: text content, small images/PDFs as data URLs. */
export async function readUploadExtras(file) {
  const [, ext] = splitName(file.name);
  const cat = getFileType(ext).category;
  const out = { ext };
  try {
    if (cat === 'text' && file.size < 1024 * 1024) out.content = await readAs(file, 'text');
    if (file.size <= PERSIST_LIMIT && ['image', 'pdf'].includes(cat)) out.dataUrl = await readAs(file, 'url');
  } catch { /* fall back to blob only */ }
  return out;
}

/** Existing, non-trashed child of a folder (or space root) with this name, compared case-insensitively. */
function childNamed(state, name, parentId, space) {
  const n = name.toLowerCase();
  return Object.values(state.items).find((i) => !i.trashed && i.parentId === parentId && (parentId ? true : i.space === space) && i.name.toLowerCase() === n) || null;
}

/**
 * Files whose name already exists where they would land. Folder uploads merge into same-named folders,
 * so only files inside folders that already exist can clash.
 * Returns [{ index, name, path, existingId, canReplace, reason }].
 */
export function findUploadConflicts(state, files, parentId, space) {
  const out = [];
  [...files].forEach((file, index) => {
    const rel = file.webkitRelativePath || file.relativePath || '';
    const segs = rel.includes('/') ? rel.split('/').slice(0, -1) : [];
    let pid = parentId;
    for (const seg of segs) {
      const f = childNamed(state, seg, pid, space);
      if (!f || f.type !== 'folder') return; // folder will be created fresh: nothing to clash with
      pid = f.id;
    }
    const existing = childNamed(state, file.name, pid, space);
    if (!existing) return;
    const lockedOther = existing.lock && existing.lock.by !== state.meId;
    const canReplace = existing.type === 'file' && !lockedOther;
    out.push({
      index, name: file.name, path: rel || file.name, existingId: existing.id, canReplace,
      reason: existing.type !== 'file' ? 'A folder with this name exists' : lockedOther ? 'Locked by another user' : null,
    });
  });
  return out;
}

export function UploadProvider({ children }) {
  const { api, state } = useDrive();
  const { toast, openDialog } = useUI();
  const [queue, setQueue] = useState([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const timers = useRef({});
  const starts = useRef({}); // pending start timeouts for queued entries
  const statusOf = useRef({}); // entry id -> current status, readable from timers without stale closures
  const stateRef = useRef(state);
  stateRef.current = state;

  const patch = (id, p) => {
    if (p.status) statusOf.current[id] = p.status;
    setQueue((q) => q.map((x) => (x.id === id ? { ...x, ...p } : x)));
  };

  const finish = useCallback(async (entry) => {
    const { file, parentId, space } = entry;
    if (statusOf.current[entry.id] !== 'uploading') return; // cancelled meanwhile
    const extras = await readUploadExtras(file);
    if (statusOf.current[entry.id] !== 'uploading') return;
    if (entry.replaceId) {
      // "Replace" keeps the existing file (comments, shares, labels) and stores the upload as its new version.
      const target = stateRef.current.items[entry.replaceId];
      const ok = target && !target.trashed && api.uploadVersion(entry.replaceId, file, { content: extras.content ?? null, dataUrl: extras.dataUrl ?? null }, 'Replaced by upload');
      if (ok) patch(entry.id, { status: 'done', progress: 100, itemId: entry.replaceId, finalName: `${target.name} · new version` });
      else patch(entry.id, { status: 'error', progress: 0, error: 'Could not replace (locked, removed, or not enough storage)', retryable: true });
      return;
    }
    const opts = { name: file.name, size: file.size, parentId, space, mime: file.type, uploaded: true, ...extras };
    const created = api.createFile(opts);
    registerBlob(created.id, file);
    patch(entry.id, { status: 'done', progress: 100, itemId: created.id, finalName: created.name });
  }, [api]);

  const run = useCallback((entry) => {
    delete starts.current[entry.id];
    if (statusOf.current[entry.id] && !['queued', 'cancelled', 'error'].includes(statusOf.current[entry.id])) return;
    if (statusOf.current[entry.id] === 'cancelled' && !entry.retrying) return;
    // Simulated network transfer: speed scales with size so progress is visible.
    const total = Math.max(600, Math.min(6000, entry.file.size / 40000));
    const start = Date.now();
    patch(entry.id, { status: 'uploading', progress: 0 });
    timers.current[entry.id] = setInterval(() => {
      const p = Math.min(99, Math.round(((Date.now() - start) / total) * 100));
      patch(entry.id, { progress: p });
      if (p >= 99) {
        clearInterval(timers.current[entry.id]);
        delete timers.current[entry.id];
        finish(entry);
      }
    }, 120);
  }, [finish]);

  /**
   * files: File[] (may carry webkitRelativePath / relativePath for folder uploads, and `emptyDirs`).
   * When some names already exist in the destination, the duplicate dialog opens first; it calls back with
   * opts.decisions: { [fileIndex]: 'replace' | 'keep' | 'skip' }.
   */
  const upload = useCallback((files, parentId, space = 'my', opts = {}) => {
    const emptyDirs = files?.emptyDirs || [];
    if (!files?.length && !emptyDirs.length) return;
    if (!opts.decisions) {
      const conflicts = findUploadConflicts(stateRef.current, files, parentId || null, space);
      if (conflicts.length) { openDialog('uploadConflicts', { files, parentId: parentId || null, space, conflicts }); return; }
    }
    for (const dir of emptyDirs) api.ensureFolderPath(dir.split('/').filter(Boolean), parentId || null, space);
    // Bytes this batch has already claimed, checked against My Folders or the team folder's quota.
    let claimed = 0;
    const entries = [];
    for (const [index, file] of [...files].entries()) {
      const decision = opts.decisions?.[index];
      if (decision === 'skip') continue;
      let pid = parentId || null;
      const rel = file.webkitRelativePath || file.relativePath;
      if (rel && rel.includes('/')) {
        const segs = rel.split('/').slice(0, -1);
        pid = api.ensureFolderPath(segs, parentId || null, space);
      }
      const replaceId = decision === 'replace' ? opts.replaceIds?.[index] : null;
      let error = null;
      if (file.size > MAX_FILE_SIZE) error = `Exceeds ${formatSize(MAX_FILE_SIZE)} file limit`;
      else if (quotaError(stateRef.current, space, claimed + file.size)) error = 'Not enough storage space';
      else if (file.size === 0 && !file.type && !splitName(file.name)[1]) error = 'Empty or unsupported item';
      if (!error) claimed += file.size;
      entries.push({ id: uid('up'), file, name: file.name, size: file.size, parentId: pid, space, replaceId, status: error ? 'error' : 'queued', progress: 0, error, retryable: !error });
    }
    if (!entries.length) {
      if (emptyDirs.length) toast(`Created ${emptyDirs.length} folder${emptyDirs.length === 1 ? '' : 's'}`, { type: 'success' });
      return;
    }
    setQueue((q) => [...entries, ...q.filter((x) => x.status !== 'done' || Date.now() - (x.doneAt || 0) < 1e9)]);
    setPanelOpen(true);
    setMinimized(false);
    entries.forEach((e) => { statusOf.current[e.id] = e.status; });
    entries.filter((e) => !e.error).forEach((e, i) => { starts.current[e.id] = setTimeout(() => run(e), i * 150); });
    const ok = entries.filter((e) => !e.error).length;
    const bad = entries.length - ok;
    if (bad && !ok) toast(`${bad} file${bad > 1 ? 's' : ''} could not be uploaded`, { type: 'error' });
  }, [api, run, toast, openDialog]);

  const cancel = useCallback((id) => {
    clearInterval(timers.current[id]);
    delete timers.current[id];
    clearTimeout(starts.current[id]);
    delete starts.current[id];
    patch(id, { status: 'cancelled' });
  }, []);

  /** Try a cancelled or failed upload again (not ones that are too big or over quota). */
  const retry = useCallback((id) => {
    const e = queue.find((x) => x.id === id);
    if (!e || (e.status === 'error' && !e.retryable)) return;
    patch(id, { error: null, status: 'queued' });
    run({ ...e, retrying: true });
  }, [queue, run]);

  /** Cancel everything that hasn't finished, including files still waiting their turn. */
  const cancelAll = useCallback(() => {
    const ids = new Set([...Object.keys(timers.current), ...Object.keys(starts.current)]);
    ids.forEach(cancel);
  }, [cancel]);

  const clearFinished = useCallback(() => {
    setQueue((q) => q.filter((x) => x.status === 'uploading' || x.status === 'queued'));
  }, []);

  /** Hide the panel. Uploads in progress keep going (the caller confirms before cancelling them). */
  const closePanel = useCallback(({ cancel: stop = false } = {}) => {
    if (stop) cancelAll();
    const busy = Object.keys(timers.current).length + Object.keys(starts.current).length;
    if (!busy || stop) setQueue([]);
    setPanelOpen(false);
  }, [cancelAll]);

  const value = useMemo(() => ({ queue, upload, cancel, retry, cancelAll, clearFinished, panelOpen, closePanel, minimized, setMinimized }),
    [queue, upload, cancel, retry, cancelAll, clearFinished, panelOpen, closePanel, minimized]);
  return <UploadCtx.Provider value={value}>{children}</UploadCtx.Provider>;
}

export const useUploads = () => useContext(UploadCtx);
