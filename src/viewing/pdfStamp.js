// Draws signatures and markup onto an existing PDF with pdf-lib, keeping the original pages (vector text stays
// selectable, file size stays small). The coordinate math is pure and works without a DOM (tested in node).
//
// Positions in the app are normalized 0..1 from the TOP-LEFT of the page as pdf.js shows it (viewport at scale 1,
// which applies /Rotate and the CropBox). pageFrame() turns that into a PDF transformation matrix so everything
// below draws in "upright viewport points": origin bottom-left of the page as displayed, x right, y up.
import {
  PDFDocument, StandardFonts, rgb, BlendMode, LineCapStyle, LineJoinStyle,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, setLineJoin,
} from 'pdf-lib';
import { px, stampBox, smoothPath, fmtStampDate } from './annotations.js';

/* ------------------------------------------------------------------ */
/* Coordinates                                                         */
/* ------------------------------------------------------------------ */
const normBox = (b) => {
  const x0 = Math.min(b.x, b.x + b.width); const y0 = Math.min(b.y, b.y + b.height);
  return { x0, y0, x1: x0 + Math.abs(b.width), y1: y0 + Math.abs(b.height) };
};

/**
 * Frame of a page as pdf.js displays it.
 * @param mediaBox {x,y,width,height}, cropBox (optional, defaults to mediaBox), rotate (degrees, any multiple of 90)
 * @returns { W, H, rot, matrix: [a,b,c,d,e,f] (upright viewport points → PDF user space), toPdf(nx, ny) → [x, y] }
 */
export function pageFrame({ mediaBox, cropBox, rotate = 0 }) {
  const m = normBox(mediaBox);
  const c = cropBox ? normBox(cropBox) : m;
  // pdf.js uses the CropBox clipped to the MediaBox (and the MediaBox when they don't overlap).
  let x0 = Math.max(m.x0, c.x0); let y0 = Math.max(m.y0, c.y0); let x1 = Math.min(m.x1, c.x1); let y1 = Math.min(m.y1, c.y1);
  if (x1 <= x0 || y1 <= y0) ({ x0, y0, x1, y1 } = m);
  const rot = ((Math.round((rotate || 0) / 90) * 90) % 360 + 360) % 360;
  const pw = x1 - x0; const ph = y1 - y0;
  const W = rot % 180 ? ph : pw; const H = rot % 180 ? pw : ph;
  // (u, w) upright viewport point (y up) → PDF (x, y) = (a*u + c*w + e, b*u + d*w + f)
  const matrix = {
    0: [1, 0, 0, 1, x0, y0],
    90: [0, 1, -1, 0, x1, y0],
    180: [-1, 0, 0, -1, x1, y1],
    270: [0, -1, 1, 0, x0, y1],
  }[rot];
  const toPdf = (nx, ny) => {
    const u = nx * W; const w = H - ny * H;
    const [a, b, cc, d, e, f] = matrix;
    return [a * u + cc * w + e, b * u + d * w + f];
  };
  return { W, H, rot, matrix, toPdf };
}

/** pageFrame for a pdf-lib page. */
export function framePage(page) {
  const mb = page.getMediaBox();
  let cb = null;
  try { cb = page.getCropBox(); } catch { cb = null; }
  return pageFrame({ mediaBox: mb, cropBox: cb, rotate: page.getRotation().angle });
}

/** Normalized field box (top-left origin) → rectangle in upright points { x, y (bottom), w, h }. */
export const boxIn = (fr, b) => ({ x: b.x * fr.W, y: fr.H - (b.y + b.h) * fr.H, w: b.w * fr.W, h: b.h * fr.H });

/* ------------------------------------------------------------------ */
/* Text helpers (WinAnsi for the standard fonts)                       */
/* ------------------------------------------------------------------ */
const charSets = new WeakMap();
function charSet(font) {
  let s = charSets.get(font);
  if (!s) { s = new Set(font.getCharacterSet()); charSets.set(font, s); }
  return s;
}
/** True when every character of `text` can be drawn with `font`. */
export const encodable = (font, text) => [...String(text)].every((ch) => ch === '\n' || charSet(font).has(ch.codePointAt(0)));

// Code points written as numbers so the source stays plain ASCII.
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const SPACES = new Set([9, ...range(0x2000, 0x200a), 0x202f, 0x205f, 0x3000]); // tab, en/em/thin/narrow spaces…
const INVISIBLE = new Set([13, 0x200b, 0x200c, 0x200d, 0xfeff]); // CR, zero-width characters, BOM
const isCombining = (c) => c >= 0x300 && c <= 0x36f; // accents left over by NFKD
/** Replace what the font can't encode: odd spaces → space, accents dropped when that helps, anything else → '?'. */
export function safeText(font, text) {
  const set = charSet(font);
  let out = '';
  for (const ch of String(text ?? '')) {
    const cp = ch.codePointAt(0);
    if (set.has(cp)) { out += ch; continue; }
    if (SPACES.has(cp)) { out += ' '; continue; }
    if (INVISIBLE.has(cp)) continue;
    const base = ch.normalize('NFKD').split('').filter((c) => !isCombining(c.charCodeAt(0))).join('');
    out += base && [...base].every((c) => set.has(c.codePointAt(0))) ? base : '?';
  }
  return out;
}

export function hexColor(hex) {
  const h = String(hex || '#000').replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(f, 16) || 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Largest size ≤ start (down to min) at which `text` fits in maxW. */
export function fitSize(font, text, start, maxW, min = 4) {
  let s = start;
  while (s > min && font.widthOfTextAtSize(text, s) > maxW) s -= 0.5;
  return Math.max(min, s);
}

const roundRectPath = (w, h, r) => `M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} V${r} Q0 0 ${r} 0 Z`;

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */
/** Load PDF bytes with pdf-lib; throws for encrypted / unreadable files (callers then fall back to flattening). */
export async function loadPdf(bytes) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

/**
 * Prepare a page for drawing in upright viewport points: the original content is wrapped in q/Q (so a
 * transformation it leaves behind can't move our marks), then our CTM is set. Returns the frame.
 */
export function beginPage(page) {
  page.node.normalize();
  const start = page.doc.context.register(page.createContentStream(pushGraphicsState()));
  const end = page.doc.context.register(page.createContentStream(popGraphicsState()));
  page.node.wrapContentStreams(start, end);
  const fr = framePage(page);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...fr.matrix), setLineJoin(LineJoinStyle.Round));
  return fr;
}
export const endPage = (page) => page.pushOperators(popGraphicsState());

function setInfo(doc, info = {}) {
  if (info.title) doc.setTitle(info.title);
  if (info.author) doc.setAuthor(info.author);
  if (info.subject) doc.setSubject(info.subject);
  doc.setProducer('WorkDrive');
  doc.setCreator('WorkDrive');
  const now = new Date();
  doc.setCreationDate(now);
  doc.setModificationDate(now);
}

const imageCaches = new WeakMap(); // doc -> Map(src -> embedded image): the same signature is embedded once
async function embedImage(doc, src) {
  if (!src) return null;
  if (!imageCaches.has(doc)) imageCaches.set(doc, new Map());
  const imageCache = imageCaches.get(doc);
  if (imageCache.has(src)) return imageCache.get(src);
  let img = null;
  if (typeof src === 'string' && /^data:image\/png/i.test(src)) img = await doc.embedPng(src);
  else if (typeof src === 'string' && /^data:image\/jpe?g/i.test(src)) img = await doc.embedJpg(src);
  else if (src instanceof Uint8Array) img = await doc.embedPng(src);
  imageCache.set(src, img);
  return img;
}

/** Draw an image fitted inside a box (keeping its aspect ratio, centred). */
function drawFitted(page, img, b) {
  const s = Math.min(b.w / img.width, b.h / img.height);
  const w = img.width * s; const h = img.height * s;
  page.drawImage(img, { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, width: w, height: h });
}

/* ------------------------------------------------------------------ */
/* Signature fields                                                    */
/* ------------------------------------------------------------------ */
/**
 * Draw one filled field. `renderPng(f, wPt, hPt)` (browser only, optional) returns a PNG data URL of the value
 * drawn on a canvas; it is used for typed signatures (web fonts) and for text the standard font can't encode.
 */
export async function drawField(doc, page, fr, f, fonts, renderPng) {
  const v = f.value;
  if (v == null || v === '') return;
  const b = boxIn(fr, f);
  if (typeof v === 'object' && v.type === 'image') {
    let img = null;
    try { img = await embedImage(doc, v.dataUrl); } catch { img = null; }
    if (!img && renderPng) img = await embedImage(doc, await renderPng(f, b.w, b.h));
    if (img) drawFitted(page, img, b);
  } else if (typeof v === 'object' && v.type === 'typed') {
    if (renderPng) {
      const img = await embedImage(doc, await renderPng(f, b.w, b.h));
      if (img) page.drawImage(img, { x: b.x, y: b.y, width: b.w, height: b.h });
    } else {
      drawFittedText(page, safeText(fonts.oblique, v.text), fonts.oblique, b, 0.72, 0.96, hexColor('#0B2A6F'), 0.55);
    }
  } else {
    const text = String(v).replace(/\s*\n\s*/g, ' ');
    if (!encodable(fonts.regular, text) && renderPng) {
      const img = await embedImage(doc, await renderPng(f, b.w, b.h));
      if (img) page.drawImage(img, { x: b.x, y: b.y, width: b.w, height: b.h });
    } else {
      drawFittedText(page, safeText(fonts.regular, text), fonts.regular, b, 0.62, 0.98, hexColor('#111827'), 0.5);
    }
  }
  if (f.kind === 'signature' || f.kind === 'initials') {
    const t = Math.max(0.5, b.h * 0.03);
    page.drawLine({ start: { x: b.x, y: b.y + t / 2 }, end: { x: b.x + b.w, y: b.y + t / 2 }, thickness: t, color: hexColor('#94A3B8') });
  }
}

/** Text in a box: starts at `rel` × box height, shrinks to fit `fill` × width; `mid` = vertical centre (from the top). */
function drawFittedText(page, text, font, b, rel, fill, color, mid) {
  const size = fitSize(font, text, b.h * rel, b.w * fill - 2, 3.5);
  const cy = b.y + b.h * (1 - mid);
  page.drawText(text, { x: b.x + 1, y: cy - size * 0.35, size, font, color });
}

export async function standardFonts(doc) {
  const [regular, bold, oblique] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold), doc.embedFont(StandardFonts.HelveticaOblique),
  ]);
  return { regular, bold, oblique };
}

/**
 * Signed copy: fields drawn on the original pages, then a certificate appended.
 * @returns Uint8Array of the new PDF
 */
export async function stampSignedPdf(bytes, { fields = [], renderPng, info, certificate } = {}) {
  const doc = await loadPdf(bytes);
  const fonts = await standardFonts(doc);
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const onPage = fields.filter((f) => f.page === i + 1 && f.value != null && f.value !== '');
    if (!onPage.length) continue;
    const page = pages[i];
    const fr = beginPage(page);
    for (const f of onPage) await drawField(doc, page, fr, f, fonts, renderPng); // eslint-disable-line no-await-in-loop
    endPage(page);
  }
  if (certificate) drawTextPages(doc, fonts, certificate.title, certificate.blocks, { subtitle: certificate.subtitle });
  setInfo(doc, info);
  return doc.save();
}

/* ------------------------------------------------------------------ */
/* Markup                                                              */
/* ------------------------------------------------------------------ */
/** Draw annotations on a page (in upright points). `noteNo(a)` gives a note's number. */
export function drawMarks(page, fr, list, fonts, nameOf = () => '', noteNo = () => '') {
  const { W, H } = fr;
  for (const a of list) {
    if (a.kind === 'pen' || a.kind === 'highlight') {
      if (!a.pts?.length) continue;
      page.drawSvgPath(smoothPath(a.pts, W, H), {
        x: 0, y: H, borderColor: hexColor(a.color), borderWidth: px(a.kind, W), borderLineCap: LineCapStyle.Round,
        ...(a.kind === 'highlight' ? { borderOpacity: 0.38, blendMode: BlendMode.Multiply } : {}),
      });
    } else if (a.kind === 'rect') {
      page.drawRectangle({ x: a.x * W, y: H - (a.y + a.h) * H, width: a.w * W, height: a.h * H, borderColor: hexColor(a.color), borderWidth: px('rect', W) });
    } else if (a.kind === 'text') {
      const f = px('text', W) * (a.size || 1);
      (a.text || '').split('\n').forEach((l, i) => {
        if (!l) return;
        page.drawText(safeText(fonts.bold, l), { x: a.x * W + 2, y: H - a.y * H - i * f * 1.25 - f * 0.8, size: f, font: fonts.bold, color: hexColor(a.color) });
      });
    } else if (a.kind === 'stamp') {
      const s = stampBox(a, W);
      const left = a.x * W - s.bw / 2; const top = H - a.y * H + s.bh / 2; // top edge, y up
      const col = hexColor(a.color);
      page.drawSvgPath(roundRectPath(s.bw, s.bh, s.font * 0.3), {
        x: left, y: top, color: rgb(1, 1, 1), opacity: 0.35, borderColor: col, borderOpacity: 0.9, borderWidth: Math.max(1, s.font * 0.14),
      });
      const label = safeText(fonts.bold, a.label);
      const ls = fitSize(fonts.bold, label, s.font, s.textW);
      const lw = fonts.bold.widthOfTextAtSize(label, ls);
      page.drawText(label, { x: a.x * W - lw / 2, y: top - s.bh * 0.4 - ls * 0.35, size: ls, font: fonts.bold, color: col, opacity: 0.9 });
      const sub = safeText(fonts.regular, `${nameOf(a.by)} · ${fmtStampDate(a.at)}`.toUpperCase());
      const ss = fitSize(fonts.regular, sub, s.font * 0.42, s.bw - s.font * 0.6, 2);
      const sw = fonts.regular.widthOfTextAtSize(sub, ss);
      page.drawText(sub, { x: a.x * W - sw / 2, y: top - s.bh * 0.8 - ss * 0.35, size: ss, font: fonts.regular, color: col, opacity: 0.9 });
    } else if (a.kind === 'note') {
      const s = px('note', W);
      const cx = a.x * W; const cy = H - a.y * H;
      page.drawSvgPath(roundRectPath(s, s, s * 0.18), { x: cx - s / 2, y: cy + s / 2, color: hexColor('#FACC15'), borderColor: hexColor('#A16207'), borderWidth: 0.8 });
      const t = String(noteNo(a));
      const ts = s * 0.55;
      const tw = fonts.bold.widthOfTextAtSize(t, ts);
      page.drawText(t, { x: cx - tw / 2, y: cy - ts * 0.36, size: ts, font: fonts.bold, color: hexColor('#422006') });
    }
  }
}

/**
 * Marked-up copy: marks drawn on the original pages, a numbered "Notes" page appended when there are notes.
 * Marks on pages the document doesn't have are left out. `notesPage(notes)` → { title, subtitle, blocks } (optional).
 * @returns Uint8Array
 */
export async function stampMarkupPdf(bytes, { list = [], nameOf = () => '', info, notesPage } = {}) {
  const doc = await loadPdf(bytes);
  const fonts = await standardFonts(doc);
  const pages = doc.getPages();
  const marks = list.filter((a) => (a.page || 1) >= 1 && (a.page || 1) <= pages.length);
  // Notes are numbered across the whole document (page order) so the markers match the list on the last page.
  const notes = marks.filter((a) => a.kind === 'note').map((a, i) => ({ a, i })).sort((p, q) => (p.a.page || 1) - (q.a.page || 1) || p.i - q.i).map((p) => p.a);
  const numbers = new Map(notes.map((n, i) => [n, i + 1]));
  for (let i = 0; i < pages.length; i++) {
    const onPage = marks.filter((a) => (a.page || 1) === i + 1);
    if (!onPage.length) continue;
    const fr = beginPage(pages[i]);
    // Notes on top of everything else, as on screen.
    drawMarks(pages[i], fr, [...onPage.filter((a) => a.kind !== 'note'), ...onPage.filter((a) => a.kind === 'note')], fonts, nameOf, (a) => numbers.get(a));
    endPage(pages[i]);
  }
  if (notes.length && notesPage) {
    const p = notesPage(notes);
    drawTextPages(doc, fonts, p.title, p.blocks, { subtitle: p.subtitle });
  }
  setInfo(doc, info);
  return { bytes: await doc.save(), notes, pageCount: pages.length };
}

/* ------------------------------------------------------------------ */
/* Text pages (certificate, notes list) — native, selectable text      */
/* ------------------------------------------------------------------ */
/**
 * Same layout and blocks as pdfWriter.textPagesCanvas, drawn as US-Letter PDF pages appended to `doc`.
 * blocks: [{ heading }, { text, muted?, bold?, size?, indent? }, { pairs: [[label, value], ...], indent? }, { rule: true }]
 * (sizes are in the canvas units of textPagesCanvas; everything is scaled by 0.5 to points).
 */
export function drawTextPages(doc, fonts, title, blocks, { subtitle = '', generated = `Generated ${new Date().toLocaleString()}` } = {}) {
  const k = 0.5; // canvas px → pt (1224 × 1584 → 612 × 792)
  const W = 1224; const H = 1584; const M = 96;
  const bottom = H - M - 30;
  const out = [];
  let page = null;
  let y = M;
  let heading = null;
  const C = { ink: hexColor('#111827'), muted: hexColor('#6B7280'), faint: hexColor('#9CA3AF'), rule: hexColor('#E5E7EB'), brand: hexColor('#1686D9') };
  const fontOf = (weight) => (weight >= 600 ? fonts.bold : fonts.regular);
  // Canvas 'top' baseline → PDF baseline about 0.8 em lower.
  const text = (t, x, yTop, size, weight, color) => {
    const font = fontOf(weight);
    const s = safeText(font, t);
    if (!s) return;
    page.drawText(s, { x: x * k, y: (H - yTop - size * 0.8) * k, size: size * k, font, color });
  };
  const width = (t, size, weight) => fontOf(weight).widthOfTextAtSize(safeText(fontOf(weight), t), size);
  const newPage = () => {
    page = doc.addPage([W * k, H * k]);
    out.push(page);
    page.drawRectangle({ x: 0, y: (H - 14) * k, width: W * k, height: 14 * k, color: C.brand });
    y = M;
    if (out.length === 1) {
      text(title, M, y, 40, 700, C.ink); y += 58;
      if (subtitle) { text(subtitle, M, y, 22, 400, C.muted); y += 44; }
    } else {
      text(`${title} (continued)`, M, y, 28, 700, C.ink); y += 50;
      if (heading) { text(`${heading} (continued)`, M, y, 22, 600, C.muted); y += 38; }
    }
  };
  const room = (need) => { if (y + need > bottom) newPage(); };
  const wrap = (t, maxW, size, weight) => {
    const lines = [];
    for (const para of String(t ?? '').split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const tt = line ? `${line} ${word}` : word;
        if (width(tt, size, weight) > maxW && line) { lines.push(line); line = word; } else line = tt;
      }
      lines.push(line);
    }
    return lines;
  };
  newPage();
  for (const b of blocks || []) {
    const ind = b.indent || 0;
    if (b.rule) { room(26); page.drawRectangle({ x: M * k, y: (H - y - 10) * k, width: (W - M * 2) * k, height: 2 * k, color: C.rule }); y += 26; continue; }
    if (b.heading) {
      heading = null;
      room(56 + 60);
      y += 14; text(b.heading, M, y, 26, 600, C.ink); y += 42;
      heading = b.heading;
      continue;
    }
    if (b.pairs) {
      for (const [label, value] of b.pairs) {
        const lines = wrap(value, W - M * 2 - 260 - ind, 20, 400);
        room(Math.max(1, lines.length) * 28 + 6);
        text(label, M + ind, y, 20, 600, C.muted);
        lines.forEach((l, i) => text(l, M + 260 + ind, y + i * 28, 20, 400, C.ink));
        y += Math.max(1, lines.length) * 28 + 6;
      }
      continue;
    }
    if (b.image) continue; // images aren't used on native text pages
    const size = b.size || 20; const lh = size * 1.45; const weight = b.bold ? 600 : 400;
    for (const l of wrap(b.text || '', W - M * 2 - ind, size, weight)) {
      room(lh);
      text(l, M + ind, y, size, weight, b.muted ? C.muted : C.ink); y += lh;
    }
    y += 8;
  }
  out.forEach((p, i) => {
    page = p;
    text(generated, M, H - 60, 16, 400, C.faint);
    if (out.length > 1) {
      const t = `Page ${i + 1} of ${out.length}`;
      text(t, W - M - width(t, 16, 400), H - 60, 16, 400, C.faint);
    }
  });
  return out;
}
