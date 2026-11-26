// Minimal ZIP reader: stored (0) and deflate (8) entries, using the browser's DecompressionStream.
// ZIP64 and encrypted archives are reported as unsupported rather than mis-read.

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

export class ZipError extends Error {}

const utf8 = new TextDecoder('utf-8');
const cp437ish = new TextDecoder('latin1');

/** Parse the central directory. Returns [{ path, dir, size, csize, method, offset, encrypted, date }]. */
export function readZipIndex(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record sits in the last 22 + 65535 (comment) bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('This file is not a valid ZIP archive.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new ZipError('ZIP64 archives are not supported yet.');
  const out = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CEN_SIG) throw new ZipError('The archive is damaged (bad central directory).');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const time = view.getUint16(p + 12, true);
    const day = view.getUint16(p + 14, true);
    const csize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const rawName = bytes.subarray(p + 46, p + 46 + nameLen);
    const path = ((flags & 0x800) ? utf8 : cp437ish).decode(rawName).replace(/\\/g, '/');
    const date = new Date(1980 + (day >> 9), ((day >> 5) & 15) - 1, day & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2).getTime();
    out.push({ path, dir: path.endsWith('/'), size, csize, method, offset, encrypted: !!(flags & 1), date });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') throw new ZipError('This browser cannot decompress ZIP files.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read entries' bytes. Returns [{ path, dir, data: Uint8Array, date }].
 * `only(path)` limits it to the entries you need (e.g. word/document.xml): the others aren't decompressed,
 * so a 100 MB presentation full of media doesn't have all its pictures unpacked just to read one slide.
 */
export async function readZip(blob, { maxEntries = 2000, maxBytes = 300 * 1024 * 1024, only = null } = {}) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const all = readZipIndex(bytes);
  if (all.length > maxEntries) throw new ZipError(`The archive has ${all.length} entries; the limit is ${maxEntries}.`);
  const index = only ? all.filter((e) => !e.dir && only(e.path)) : all;
  const total = index.reduce((s, e) => s + e.size, 0);
  if (total > maxBytes) throw new ZipError('The archive is too large to extract in the browser.');
  const out = [];
  for (const e of index) {
    if (e.dir) { out.push({ path: e.path, dir: true, data: null, date: e.date }); continue; }
    if (e.encrypted) throw new ZipError('Password-protected archives are not supported.');
    if (view.getUint32(e.offset, true) !== LOC_SIG) throw new ZipError('The archive is damaged (bad local header).');
    const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
    const raw = bytes.subarray(start, start + e.csize);
    let data;
    if (e.method === 0) data = raw.slice();
    else if (e.method === 8) data = await inflateRaw(raw);
    else throw new ZipError(`Compression method ${e.method} is not supported.`);
    out.push({ path: e.path, dir: false, data, date: e.date });
  }
  return out;
}

/** Drop unsafe / junk paths: absolute paths, "..", macOS resource forks. */
export function safeZipPath(path) {
  const parts = path.split('/').filter((s) => s && s !== '.');
  if (!parts.length || parts.includes('..') || parts[0] === '__MACOSX' || parts[parts.length - 1] === '.DS_Store') return null;
  return parts;
}
