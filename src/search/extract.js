// Pull searchable text out of a file: plain text, PDF text layers, Office Open XML (docx/xlsx/pptx),
// ZIP listings, and OCR for images and scanned PDFs.
import { blobRegistry } from '../store/DriveStore';
import { getFileType } from '../utils/fileTypes';
import { dataUrlToBlob } from '../utils/exporters';
import { sampleSheet, sampleSlides, sampleText } from '../utils/sampleContent';
import { readZip, readZipIndex } from '../utils/zip';
import { loadPdfjs } from '../utils/pdfThumb';
import { recognize } from './ocr';

export const MAX_TEXT = 60000; // characters kept per file

const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const stripXml = (xml) => decodeXml(xml.replace(/<[^>]+>/g, ''));
const tidy = (t) => t.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);

/** The file's real bytes, if it has any (uploads, or small files stored as data URLs). */
function realBlob(item) {
  const reg = blobRegistry.get(item.id);
  if (reg) return reg.blob;
  if (item.dataUrl) return dataUrlToBlob(item.dataUrl);
  return null;
}
const isSvg = (blob) => blob?.type === 'image/svg+xml';

/* ---------------- Office Open XML ---------------- */
async function zipEntries(blob, test) {
  const entries = await readZip(blob, { maxEntries: 5000, only: test }); // only the parts we read get unpacked
  return entries.filter((e) => !e.dir && test(e.path)).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}
const xmlOf = (e) => new TextDecoder().decode(e.data);

async function docxText(blob) {
  const [doc] = await zipEntries(blob, (p) => p === 'word/document.xml');
  if (!doc) return '';
  return stripXml(xmlOf(doc).replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n'));
}
/* ---- Structured first-page content for grid thumbnails ---- */

/** Paragraphs of a .docx: [{ text, heading }] (headings: Title / Heading styles). */
export async function docxParagraphs(blob, max = 60) {
  const [doc] = await zipEntries(blob, (p) => p === 'word/document.xml');
  if (!doc) return [];
  const out = [];
  for (const p of xmlOf(doc).split('</w:p>')) {
    if (out.length >= max) break;
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] || '';
    const text = stripXml(p.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n')).trim();
    if (!text) continue; // empty paragraphs are just spacing
    // Headings: a Title/Heading style, or a short paragraph whose runs are all bold.
    const runs = p.match(/<w:r[ >][\s\S]*?<\/w:r>/g) || [];
    const allBold = runs.length > 0 && runs.every((r) => !/<w:t[ >]/.test(r) || /<w:b(?: w:val="(?:1|true)")?\/>/.test(r));
    out.push({ text, heading: /^(Title|Heading|Subtitle)/i.test(style) || (allBold && text.length < 120) });
  }
  return out;
}

/** Top-left cells of the first worksheet of an .xlsx as rows of strings. */
export async function xlsxGrid(blob, maxRows = 30, maxCols = 10) {
  const parts = await zipEntries(blob, (p) => p === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
  const shared = parts.find((e) => e.path === 'xl/sharedStrings.xml');
  const sheet = parts.find((e) => e.path.startsWith('xl/worksheets/'));
  if (!sheet) return [];
  const strings = shared ? xmlOf(shared).split('</si>').slice(0, -1).map((si) => stripXml(si.replace(/<rPh[\s\S]*?<\/rPh>/g, ''))) : [];
  const colNo = (ref) => [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const rows = [];
  const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const xml = xmlOf(sheet);
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const ref = /\br="([A-Z]+)(\d+)"/.exec(m[1]);
    if (!ref) continue;
    const r = Number(ref[2]) - 1; const c = colNo(ref[1]);
    if (r >= maxRows) break;
    if (c >= maxCols) continue;
    const type = /\bt="(\w+)"/.exec(m[1])?.[1];
    const body = m[2] || '';
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    const val = type === 's' ? strings[Number(v)] ?? '' : type === 'inlineStr' ? stripXml(body) : decodeXml(v ?? '');
    (rows[r] ||= [])[c] = val;
  }
  let width = 0;
  for (let i = 0; i < rows.length; i++) width = Math.max(width, rows[i]?.length || 0);
  return Array.from({ length: rows.length }, (_, i) => Array.from({ length: width }, (__, j) => rows[i]?.[j] ?? ''));
}

/** Title and body of the first slide of a .pptx. */
export async function pptxFirstSlide(blob) {
  const [slide] = await zipEntries(blob, (p) => /^ppt\/slides\/slide1\.xml$/.test(p));
  if (!slide) return null;
  const lines = xmlOf(slide).split('</a:p>').map((p) => stripXml(p).trim()).filter(Boolean);
  return { title: lines[0] || '', body: lines.slice(1).join('\n') };
}

/** Title and text of every slide of a .pptx, in order. */
export async function pptxSlides(blob, max = 200) {
  const slides = await zipEntries(blob, (p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
  return slides.slice(0, max).map((e) => {
    const lines = xmlOf(e).split('</a:p>').map((p) => stripXml(p).trim()).filter(Boolean);
    return { title: lines[0] || '', body: lines.slice(1).join('\n') };
  });
}

async function xlsxText(blob) {
  const parts = await zipEntries(blob, (p) => p === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
  return parts.map((e) => stripXml(xmlOf(e).replace(/<\/(si|row|c)>/g, (m) => (m === '</c>' ? ' ' : '\n')))).join('\n');
}
async function pptxText(blob) {
  const slides = await zipEntries(blob, (p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
  return slides.map((e, i) => `Slide ${i + 1}\n${stripXml(xmlOf(e).replace(/<\/a:p>/g, '\n'))}`).join('\n\n');
}

/* ---------------- PDF ---------------- */
async function pdfDoc(blob) {
  const lib = await loadPdfjs();
  return lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
}
async function pdfText(blob, maxPages = 60) {
  const doc = await pdfDoc(blob);
  try {
    const pages = Math.min(doc.numPages, maxPages);
    const out = [];
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i); // eslint-disable-line no-await-in-loop
      const tc = await page.getTextContent(); // eslint-disable-line no-await-in-loop
      out.push(tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
    }
    return { text: out.join('\n\n'), pages };
  } finally { doc.destroy(); }
}
/** Scanned PDFs have no text layer: render each page and OCR it. */
async function pdfOcr(blob, maxPages = 10) {
  const doc = await pdfDoc(blob);
  try {
    const pages = Math.min(doc.numPages, maxPages);
    const out = []; let conf = 0;
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i); // eslint-disable-line no-await-in-loop
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise; // eslint-disable-line no-await-in-loop
      const r = await recognize(canvas); // eslint-disable-line no-await-in-loop
      out.push(r.text); conf += r.confidence;
    }
    return { text: out.join('\n\n'), confidence: pages ? Math.round(conf / pages) : 0 };
  } finally { doc.destroy(); }
}

/* ---------------- Images ---------------- */
async function imageOcr(blob) {
  // Tesseract can't read SVG; rasterize it first (large enough for small print).
  return recognize(isSvg(blob) ? await rasterizeSvg(blob) : blob);
}

/** SVG → canvas at 2× its own size (keeps proportions, so text isn't stretched). */
async function rasterizeSvg(blob, scale = 2) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const w = Math.min(4000, (img.naturalWidth || 800) * scale); const h = Math.min(6000, (img.naturalHeight || 600) * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Extract text for the search index.
 * Returns { text, source, confidence? } — source: text | document | spreadsheet | slides | pdf | ocr | archive
 * or null when the type has no text to extract (video, legacy binary formats, decorative sample images).
 */
export async function extractText(item, { ocr = true } = {}) {
  const cat = getFileType(item.ext).category;
  const blob = realBlob(item);

  // Only MAX_TEXT characters are kept: read just the start of a big file (UTF-8 is at most 4 bytes a character).
  if (cat === 'text') return { text: tidy(item.content ?? (blob ? await blob.slice(0, MAX_TEXT * 4).text() : '')), source: 'text' };

  if (cat === 'pdf') {
    if (!blob) return { text: tidy(item.content ?? sampleText(item)), source: 'pdf' };
    const { text, pages } = await pdfText(blob);
    // Fewer than ~20 characters per page means there's no real text layer: treat it as a scan.
    if (text.replace(/\s/g, '').length >= 20 * pages || !ocr) return { text: tidy(text), source: 'pdf' };
    const r = await pdfOcr(blob);
    return { text: tidy(r.text), source: 'ocr', confidence: r.confidence };
  }

  if (cat === 'document') {
    if (item.ext === 'docx' && blob) return { text: tidy(await docxText(blob)), source: 'document' };
    if (item.content || !blob) return { text: tidy(item.content ?? sampleText(item)), source: 'document' };
    return null; // legacy .doc / .odt bytes
  }
  if (cat === 'spreadsheet') {
    if (item.ext === 'csv' && blob) return { text: tidy(await blob.slice(0, MAX_TEXT * 4).text()), source: 'spreadsheet' };
    if (item.ext === 'xlsx' && blob) return { text: tidy(await xlsxText(blob)), source: 'spreadsheet' };
    if (item.sheet || !blob) return { text: tidy(sampleSheet(item).map((r) => r.join(' ')).join('\n')), source: 'spreadsheet' };
    return null;
  }
  if (cat === 'presentation') {
    if (item.ext === 'pptx' && blob) return { text: tidy(await pptxText(blob)), source: 'slides' };
    if (item.slides || !blob) return { text: tidy(sampleSlides(item).map((s) => `${s.title}\n${s.body}`).join('\n\n')), source: 'slides' };
    return null;
  }
  if (cat === 'archive' && item.ext === 'zip' && blob) {
    const names = readZipIndex(await blob.arrayBuffer()).filter((e) => !e.dir).map((e) => e.path);
    return { text: tidy(names.join('\n')), source: 'archive' };
  }
  if (cat === 'image') {
    if (!blob) return null; // generated sample artwork has no text worth reading
    if (!ocr) return { text: '', source: 'ocr', skipped: true };
    const r = await imageOcr(blob);
    return { text: tidy(r.text), source: 'ocr', confidence: r.confidence };
  }
  return null;
}
