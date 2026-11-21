/**
 * Workspace backup format (one .zip):
 *   manifest.json   { app, appName, format, exportedAt, seedVersion, counts: { items, files, fileBytes }, files: { <blobKey>: { type, size } } }
 *   state.json      the full workspace state minus session-only fields (see portableState)
 *   files/<blobKey> bytes of every stored file, including older versions (`<id>@v<no>`); keys are URI-encoded
 */
import { makeZip } from '../utils/exporters';
import { readZip, ZipError } from '../utils/zip';
import { fileStore } from '../data/storage';
import { blobRegistry, blobsReady, portableState, SEED_VERSION } from '../store/DriveStore';

export const BACKUP_APP = 'workvault-drive';
export const BACKUP_FORMAT = 1;
const FILES_DIR = 'files/';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Every stored blob that still belongs to an item: [[key, Blob], ...]. */
async function collectBlobs(state) {
  // Wait (briefly) for saved bytes to load at start-up so nothing is missed.
  await Promise.race([blobsReady, new Promise((r) => setTimeout(r, 5000))]);
  const all = new Map(await fileStore.loadAll());
  for (const [k, v] of blobRegistry) if (!all.has(k) && v?.blob) all.set(k, v.blob);
  return [...all].filter(([k]) => state.items[String(k).split('@')[0]]);
}

/**
 * Build the backup zip. onProgress({ phase: 'files' | 'zip', done, total }) is called as it goes.
 * Returns { blob, filename, manifest }.
 */
export async function buildBackup(state, onProgress = () => {}) {
  const blobs = await collectBlobs(state);
  const entries = [];
  const files = {};
  let fileBytes = 0;
  onProgress({ phase: 'files', done: 0, total: blobs.length });
  for (let i = 0; i < blobs.length; i++) {
    const [key, blob] = blobs[i];
    entries.push({ path: FILES_DIR + encodeURIComponent(key), data: new Uint8Array(await blob.arrayBuffer()) });
    files[key] = { type: blob.type || '', size: blob.size };
    fileBytes += blob.size;
    onProgress({ phase: 'files', done: i + 1, total: blobs.length });
    if (i % 10 === 9) await tick();
  }
  const portable = portableState(state);
  const manifest = {
    app: BACKUP_APP,
    appName: document.title || 'WorkDrive',
    format: BACKUP_FORMAT,
    exportedAt: Date.now(),
    seedVersion: state.seedVersion,
    counts: { items: Object.keys(state.items).length, files: blobs.length, fileBytes },
    files,
  };
  onProgress({ phase: 'zip', done: 0, total: 1 });
  await tick();
  const blob = makeZip([
    { path: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
    { path: 'state.json', data: JSON.stringify(portable) },
    ...entries,
  ]);
  onProgress({ phase: 'zip', done: 1, total: 1 });
  const d = new Date(manifest.exportedAt);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { blob, filename: `workspace-backup-${stamp}.zip`, manifest };
}

export class BackupError extends Error {}

const parseJson = (entry, what) => {
  try { return JSON.parse(new TextDecoder().decode(entry.data)); } catch { throw new BackupError(`The backup’s ${what} is damaged and can’t be read.`); }
};

/**
 * Read and validate a backup zip. Returns { manifest, state, files: [[key, Blob], ...] }.
 * Throws BackupError with a message fit for people.
 */
export async function readBackup(file) {
  if (!file) throw new BackupError('Choose a backup file.');
  let entries;
  try {
    entries = await readZip(file, { maxEntries: 60000, maxBytes: 2 * 1024 * 1024 * 1024 });
  } catch (e) {
    if (e instanceof ZipError) throw new BackupError(/not a valid ZIP/.test(e.message) ? 'This file isn’t a .zip backup.' : e.message);
    throw new BackupError('The file couldn’t be read. It may be too large for this browser.');
  }
  const byPath = new Map(entries.filter((e) => !e.dir).map((e) => [e.path, e]));
  const m = byPath.get('manifest.json');
  if (!m) throw new BackupError('This .zip isn’t a workspace backup (manifest.json is missing).');
  const manifest = parseJson(m, 'manifest');
  if (manifest?.app !== BACKUP_APP) throw new BackupError('This .zip was not exported from this app, so it can’t be imported.');
  if (typeof manifest.format !== 'number' || manifest.format > BACKUP_FORMAT) throw new BackupError('This backup was made by a newer version of the app. Update the app, then try again.');
  const s = byPath.get('state.json');
  if (!s) throw new BackupError('The backup is incomplete (state.json is missing).');
  const state = parseJson(s, 'workspace data');
  if (state?.version !== 1 || !state.items || typeof state.items !== 'object' || !Array.isArray(state.users)) throw new BackupError('The backup’s workspace data isn’t in a format this app understands.');
  if ((state.seedVersion || 1) > SEED_VERSION) throw new BackupError('This backup was made by a newer version of the app. Update the app, then try again.');
  const meta = manifest.files || {};
  const files = [];
  for (const [path, e] of byPath) {
    if (!path.startsWith(FILES_DIR)) continue;
    let key;
    try { key = decodeURIComponent(path.slice(FILES_DIR.length)); } catch { continue; }
    if (!key || key.includes('/')) continue;
    files.push([key, new Blob([e.data], { type: meta[key]?.type || '' })]);
  }
  const expected = manifest.counts?.files;
  if (typeof expected === 'number' && files.length < expected) throw new BackupError(`The backup is incomplete: ${expected - files.length} of ${expected} files are missing.`);
  return { manifest, state, files };
}
