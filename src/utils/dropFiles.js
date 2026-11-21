// Turn a drop event into files, walking into dropped folders.
// A dropped folder arrives in dataTransfer.files as a zero-byte stand-in, so we read the FileSystem entries instead.

/** Must be called synchronously inside the drop handler: the DataTransfer is emptied once the event ends. */
export function dropEntries(dataTransfer) {
  const items = [...(dataTransfer?.items || [])].filter((i) => i.kind === 'file');
  const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  if (!entries.length || entries.some((e) => !e)) return { entries: null, files: [...(dataTransfer?.files || [])] };
  return { entries, files: null };
}

const fileOf = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));
const readAll = (dir) => new Promise((resolve, reject) => {
  const reader = dir.createReader();
  const out = [];
  const next = () => reader.readEntries((batch) => { if (!batch.length) resolve(out); else { out.push(...batch); next(); } }, reject);
  next(); // readEntries returns at most ~100 entries per call
});

/**
 * Resolve the result of dropEntries() into File objects.
 * Files inside folders get a `relativePath` ("Folder/sub/file.txt"); the returned array also carries
 * `emptyDirs` (paths of folders with nothing in them) so they can be recreated too.
 */
export async function filesFromEntries({ entries, files }) {
  if (!entries) return Object.assign(files, { emptyDirs: [] });
  const out = [];
  const emptyDirs = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const f = await fileOf(entry);
      if (prefix) Object.defineProperty(f, 'relativePath', { value: `${prefix}${f.name}` });
      out.push(f);
    } else if (entry.isDirectory) {
      const kids = await readAll(entry);
      const path = `${prefix}${entry.name}/`;
      if (!kids.length) emptyDirs.push(path.slice(0, -1));
      for (const k of kids) await walk(k, path); // eslint-disable-line no-await-in-loop
    }
  };
  for (const e of entries) await walk(e, ''); // eslint-disable-line no-await-in-loop
  return Object.assign(out, { emptyDirs });
}

/** Convenience: sync-capture then resolve. */
export function readDrop(dataTransfer) {
  return filesFromEntries(dropEntries(dataTransfer));
}
