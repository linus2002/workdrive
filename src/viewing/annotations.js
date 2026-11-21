// Markup annotations: data model + canvas drawing (used when exporting a flattened copy).
// Coordinates are normalized to the page/image box (0..1) so markup survives zoom and resizing.
//
//   pen / highlight: { pts: [[x,y],...] }     rect: { x, y, w, h }     note / text / stamp: { x, y }
//   all: { id, kind, page, color, by, at }    text: { text, size }      note: { text }   stamp: { label }

export const COLORS = ['#E5484D', '#F59E0B', '#16A34A', '#1686D9', '#7C3AED', '#111827'];
export const HIGHLIGHT_COLORS = ['#FDE047', '#86EFAC', '#93C5FD', '#F9A8D4', '#FDBA74'];
export const STAMPS = [
  { label: 'APPROVED', color: '#16A34A' },
  { label: 'REVIEWED', color: '#1686D9' },
  { label: 'DRAFT', color: '#6B7280' },
  { label: 'CONFIDENTIAL', color: '#B91C1C' },
  { label: 'REJECTED', color: '#DC2626' },
  { label: 'PAID', color: '#0E7490' },
];

// Sizes relative to page width, shared by the SVG layer and the canvas export.
export const SIZE = { pen: 0.0035, highlight: 0.02, rect: 0.003, text: 0.022, stamp: 0.026, note: 0.03 };
export const MIN_PX = { pen: 1.6, highlight: 8, rect: 1.6, text: 11, stamp: 11, note: 18 };
export const px = (kind, w) => Math.max(MIN_PX[kind], SIZE[kind] * w);

/** Smooth SVG/canvas path through freehand points (quadratic curves through midpoints). */
export function smoothPath(pts, w, h) {
  if (!pts.length) return '';
  const P = pts.map(([x, y]) => [x * w, y * h]);
  if (P.length === 1) return `M${P[0][0]} ${P[0][1]} l0.01 0`;
  let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
  for (let i = 1; i < P.length - 1; i++) {
    const mx = (P[i][0] + P[i + 1][0]) / 2; const my = (P[i][1] + P[i + 1][1]) / 2;
    d += ` Q${P[i][0].toFixed(1)} ${P[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = P[P.length - 1];
  return `${d} L${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
}

/** Stamp box geometry (shared so the SVG and the export look identical). */
export function stampBox(a, w) {
  const font = px('stamp', w);
  const textW = a.label.length * font * 0.68;
  const bw = textW + font * 1.4;
  const bh = font * 2.35;
  return { font, textW, bw, bh };
}

export const fmtStampDate = (t) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** Bounding box in px, used for selection outlines and hit-testing. */
export function bbox(a, w, h) {
  if (a.pts) {
    const xs = a.pts.map((p) => p[0] * w); const ys = a.pts.map((p) => p[1] * h);
    const pad = px(a.kind, w) / 2 + 2;
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  }
  if (a.kind === 'rect') return { x: a.x * w, y: a.y * h, w: a.w * w, h: a.h * h };
  if (a.kind === 'stamp') { const s = stampBox(a, w); return { x: a.x * w - s.bw / 2, y: a.y * h - s.bh / 2, w: s.bw, h: s.bh }; }
  if (a.kind === 'note') { const s = px('note', w); return { x: a.x * w - s / 2, y: a.y * h - s / 2, w: s, h: s }; }
  if (a.kind === 'text') {
    const f = px('text', w) * (a.size || 1);
    const lines = (a.text || ' ').split('\n');
    return { x: a.x * w, y: a.y * h, w: Math.max(...lines.map((l) => l.length)) * f * 0.56 + 4, h: lines.length * f * 1.25 };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

/** Move an annotation by (dx, dy) in normalized units. */
export function moved(a, dx, dy) {
  if (a.pts) return { ...a, pts: a.pts.map(([x, y]) => [x + dx, y + dy]) };
  return { ...a, x: a.x + dx, y: a.y + dy };
}

/** Paint annotations onto a canvas of size w × h (export). Notes become numbered markers plus a legend. */
export function drawAnnotations(ctx, list, w, h, nameOf = () => '') {
  ctx.save();
  let noteNo = 0;
  for (const a of list) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (a.kind === 'pen' || a.kind === 'highlight') {
      ctx.globalAlpha = a.kind === 'highlight' ? 0.38 : 1;
      ctx.globalCompositeOperation = a.kind === 'highlight' ? 'multiply' : 'source-over';
      ctx.strokeStyle = a.color; ctx.lineWidth = px(a.kind, w);
      ctx.stroke(new Path2D(smoothPath(a.pts, w, h)));
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    } else if (a.kind === 'rect') {
      ctx.strokeStyle = a.color; ctx.lineWidth = px('rect', w);
      ctx.strokeRect(a.x * w, a.y * h, a.w * w, a.h * h);
    } else if (a.kind === 'text') {
      const f = px('text', w) * (a.size || 1);
      ctx.fillStyle = a.color; ctx.font = `600 ${f}px Poppins, Segoe UI, Arial, sans-serif`; ctx.textBaseline = 'top';
      (a.text || '').split('\n').forEach((l, i) => ctx.fillText(l, a.x * w + 2, a.y * h + i * f * 1.25));
    } else if (a.kind === 'stamp') {
      const s = stampBox(a, w);
      const x = a.x * w - s.bw / 2; const y = a.y * h - s.bh / 2;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = a.color; ctx.lineWidth = Math.max(2, s.font * 0.14);
      roundRect(ctx, x, y, s.bw, s.bh, s.font * 0.3); ctx.stroke();
      ctx.fillStyle = a.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `800 ${s.font}px Poppins, Segoe UI, Arial, sans-serif`;
      ctx.fillText(a.label, a.x * w, y + s.bh * 0.4, s.textW);
      ctx.font = `500 ${s.font * 0.42}px Poppins, Segoe UI, Arial, sans-serif`;
      ctx.fillText(`${nameOf(a.by)} · ${fmtStampDate(a.at)}`.toUpperCase(), a.x * w, y + s.bh * 0.8, s.bw - s.font * 0.6);
      ctx.textAlign = 'start'; ctx.globalAlpha = 1;
    } else if (a.kind === 'note') {
      noteNo++;
      const s = px('note', w);
      const x = a.x * w - s / 2; const y = a.y * h - s / 2;
      ctx.fillStyle = '#FACC15'; roundRect(ctx, x, y, s, s, s * 0.18); ctx.fill();
      ctx.strokeStyle = '#A16207'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#422006'; ctx.font = `700 ${s * 0.55}px Poppins, Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(noteNo), a.x * w, a.y * h + 1);
      ctx.textAlign = 'start';
    }
  }
  ctx.restore();
  return noteNo;
}

/** Appends a "Notes" legend at the bottom of a canvas copy (returns a new, taller canvas) when a page has notes. */
export function withNotesLegend(canvas, notes, nameOf) {
  if (!notes.length) return canvas;
  const w = canvas.width;
  const f = Math.max(12, w * 0.014);
  const lineH = f * 1.45;
  const ctxM = canvas.getContext('2d');
  ctxM.font = `${f}px Poppins, Arial, sans-serif`;
  const maxW = w - f * 4;
  const rows = [];
  notes.forEach((n, i) => {
    const words = `${i + 1}. ${n.text || '(empty note)'} — ${nameOf(n.by)}`.split(' ');
    let line = '';
    for (const word of words) {
      const t = line ? `${line} ${word}` : word;
      if (ctxM.measureText(t).width > maxW && line) { rows.push(line); line = `   ${word}`; } else line = t;
    }
    rows.push(line);
  });
  const extra = Math.ceil(f * 3 + rows.length * lineH);
  const out = document.createElement('canvas');
  out.width = w; out.height = canvas.height + extra;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, out.height);
  ctx.drawImage(canvas, 0, 0);
  ctx.fillStyle = '#FEF9C3'; ctx.fillRect(0, canvas.height, w, extra);
  ctx.fillStyle = '#422006'; ctx.font = `700 ${f}px Poppins, Arial, sans-serif`; ctx.textBaseline = 'top';
  ctx.fillText('Notes', f * 2, canvas.height + f);
  ctx.font = `${f}px Poppins, Arial, sans-serif`;
  rows.forEach((r, i) => ctx.fillText(r, f * 2, canvas.height + f * 2.4 + i * lineH));
  return out;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
