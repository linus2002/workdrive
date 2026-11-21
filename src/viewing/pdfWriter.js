// Builds a PDF whose pages are JPEG images. This is the FALLBACK for burning markup and signatures into a
// document when pdf-lib can't edit the original (encrypted / damaged files): each page is rendered with pdf.js,
// drawn on, and written back out at its original page size. The normal path is ./pdfStamp.js, which draws onto
// the original pages. The text-page canvases below are also used for image (PNG) exports.
import { loadPdfjs } from '../utils/pdfThumb';

const enc = new TextEncoder();

/**
 * @param pages [{ jpeg: Uint8Array, pxW, pxH, ptW, ptH }]
 * @param info  { title, author, subject } (optional document metadata)
 */
export function imagesToPdf(pages, info = {}) {
  const chunks = [];
  let length = 0;
  const offsets = [];
  const push = (part) => { const b = typeof part === 'string' ? enc.encode(part) : part; chunks.push(b); length += b.length; };
  const esc = (s) => String(s || '').replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?');

  const n = pages.length;
  // Object ids: 1 catalog, 2 pages, 3 info, then per page: page, content, image.
  const pageId = (i) => 4 + i * 3;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const obj = (id, body) => { offsets[id] = length; push(`${id} 0 obj\n`); body(); push('\nendobj\n'); };

  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${n} >>`));
  const date = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  obj(3, () => push(`<< /Title (${esc(info.title)}) /Author (${esc(info.author)}) /Subject (${esc(info.subject)}) /Producer (WorkDrive) /CreationDate (D:${date}) >>`));
  pages.forEach((p, i) => {
    const id = pageId(i);
    const w = +p.ptW.toFixed(2); const h = +p.ptH.toFixed(2);
    obj(id, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`));
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    obj(id + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(id + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push('\nendstream');
    });
  });
  const xref = length;
  const count = 4 + n * 3;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}

const canvasJpeg = (canvas, q = 0.9) => new Promise((resolve, reject) => {
  canvas.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error('Could not encode page'))), 'image/jpeg', q);
});

/**
 * Render every page of `pdfBlob`, let `draw(ctx, pageNo, w, h)` paint on top, and return a new PDF.
 * `extraPages` are canvases appended at the end (e.g. a signing certificate), sized as US Letter.
 */
export async function flattenPdf(pdfBlob, draw, { extraPages = [], info, maxWidth = 1700 } = {}) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await pdfBlob.arrayBuffer()), isEvalSupported: false }).promise;
  const out = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i); // eslint-disable-line no-await-in-loop
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.2, maxWidth / base.width);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise; // eslint-disable-line no-await-in-loop
      await draw(ctx, i, canvas.width, canvas.height); // eslint-disable-line no-await-in-loop
      out.push({ jpeg: await canvasJpeg(canvas), pxW: canvas.width, pxH: canvas.height, ptW: base.width, ptH: base.height }); // eslint-disable-line no-await-in-loop
    }
  } finally { doc.destroy(); }
  for (const c of extraPages) {
    out.push({ jpeg: await canvasJpeg(c, 0.92), pxW: c.width, pxH: c.height, ptW: 612, ptH: 612 * (c.height / c.width) }); // eslint-disable-line no-await-in-loop
  }
  return imagesToPdf(out, info);
}

/**
 * A US-Letter text page as a canvas (for certificates and note summaries appended to flattened PDFs).
 * blocks: [{ heading }, { text, muted?, mono? }, { pairs: [[label, value], ...] }, { image: HTMLImageElement|Canvas, h }, { rule: true }]
 * Single page: content that doesn't fit is cut off. Use textPagesCanvas for long content.
 */
export function textPageCanvas(title, blocks, { subtitle = '' } = {}) {
  return layoutTextPages(title, blocks, { subtitle, single: true })[0];
}

/**
 * Like textPageCanvas, but continues onto as many pages as needed. Returns an array of canvases; pages after
 * the first repeat the title with "(continued)", a heading that runs over is repeated, and every page is numbered.
 */
export function textPagesCanvas(title, blocks, { subtitle = '' } = {}) {
  return layoutTextPages(title, blocks, { subtitle, single: false });
}

function layoutTextPages(title, blocks, { subtitle = '', single = false }) {
  const W = 1224; const H = 1584; const M = 96;
  const bottom = H - M - 30; // keep room for the footer
  const pages = [];
  let ctx = null;
  let y = M;
  let full = false; // single-page mode: the page is full
  let heading = null; // the last heading, repeated when its section continues on a new page
  const font = (size, weight = 400) => { ctx.font = `${weight} ${size}px Poppins, Segoe UI, Arial, sans-serif`; };
  const newPage = () => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    ctx = c.getContext('2d');
    pages.push(c);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1686D9'; ctx.fillRect(0, 0, W, 14);
    ctx.textBaseline = 'top';
    y = M;
    if (pages.length === 1) {
      font(40, 700); ctx.fillStyle = '#111827'; ctx.fillText(title, M, y); y += 58;
      if (subtitle) { font(22); ctx.fillStyle = '#6B7280'; ctx.fillText(subtitle, M, y); y += 44; }
    } else {
      font(28, 700); ctx.fillStyle = '#111827'; ctx.fillText(`${title} (continued)`, M, y); y += 50;
      if (heading) { font(22, 600); ctx.fillStyle = '#6B7280'; ctx.fillText(`${heading} (continued)`, M, y); y += 38; }
    }
  };
  /** Make room for `need` px; returns false when there's no room (single-page mode). */
  const room = (need) => {
    if (full) return false;
    if (y + need <= bottom) return true;
    if (single) { full = true; return false; }
    newPage();
    return true;
  };
  const wrap = (text, maxW) => {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const t = line ? `${line} ${word}` : word;
        if (ctx.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
      }
      out.push(line);
    }
    return out;
  };
  newPage();
  for (const b of blocks) {
    if (full) break;
    if (b.rule) { if (!room(26)) break; ctx.fillStyle = '#E5E7EB'; ctx.fillRect(M, y + 8, W - M * 2, 2); y += 26; continue; }
    if (b.heading) {
      heading = null;
      if (!room(56 + 60)) break; // a heading needs at least a line under it
      y += 14; font(26, 600); ctx.fillStyle = '#111827'; ctx.fillText(b.heading, M, y); y += 42;
      heading = b.heading;
      continue;
    }
    if (b.image) {
      const h = b.h || 60; const w = (b.image.width / b.image.height) * h;
      if (!room(h + 8)) break;
      ctx.drawImage(b.image, M + (b.indent || 0), y, Math.min(w, W - M * 2), h); y += h + 8; continue;
    }
    if (b.pairs) {
      for (const [label, value] of b.pairs) {
        font(20); const lines = wrap(value, W - M * 2 - 260 - (b.indent || 0));
        if (!room(Math.max(1, lines.length) * 28 + 6)) break;
        font(20, 600); ctx.fillStyle = '#6B7280'; ctx.fillText(label, M + (b.indent || 0), y);
        font(20); ctx.fillStyle = '#111827';
        lines.forEach((l, i) => ctx.fillText(l, M + 260 + (b.indent || 0), y + i * 28));
        y += Math.max(1, lines.length) * 28 + 6;
      }
      continue;
    }
    const size = b.size || 20; const lh = size * 1.45;
    font(size, b.bold ? 600 : 400);
    const lines = wrap(b.text || '', W - M * 2 - (b.indent || 0));
    for (const l of lines) {
      if (!room(lh)) break;
      font(size, b.bold ? 600 : 400); ctx.fillStyle = b.muted ? '#6B7280' : '#111827';
      ctx.fillText(l, M + (b.indent || 0), y); y += lh;
    }
    y += 8;
  }
  const generated = `Generated ${new Date().toLocaleString()}`;
  pages.forEach((c, i) => {
    ctx = c.getContext('2d');
    font(16); ctx.fillStyle = '#9CA3AF'; ctx.textBaseline = 'top';
    ctx.textAlign = 'left'; ctx.fillText(generated, M, H - 60);
    if (pages.length > 1) { ctx.textAlign = 'right'; ctx.fillText(`Page ${i + 1} of ${pages.length}`, W - M, H - 60); ctx.textAlign = 'left'; }
  });
  return pages;
}
