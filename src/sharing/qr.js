// QR codes for share links and file-request links: canvas (PNG) and SVG output, optional centre logo.
import qrcode from 'qrcode-generator';

/** Boolean module matrix for `text`. With a logo we use the highest error correction so the code still scans. */
export function qrMatrix(text, { logo = false } = {}) {
  const qr = qrcode(0, logo ? 'H' : 'M');
  qr.addData(unescape(encodeURIComponent(text))); // UTF-8 bytes
  qr.make();
  const n = qr.getModuleCount();
  const rows = [];
  for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(qr.isDark(r, c)); rows.push(row); }
  return rows;
}

const loadImg = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });

/** The logo covers at most this share of the code's width (well inside what level-H correction recovers). */
const LOGO_SHARE = 0.22;

/**
 * Draw the QR code on a canvas.
 * opts: { size (px), fg, bg, margin (modules), logo (image URL or null), rounded (dots instead of squares) }
 */
export async function qrCanvas(text, { size = 512, fg = '#111827', bg = '#ffffff', margin = 4, logo = null, rounded = false } = {}) {
  const m = qrMatrix(text, { logo: !!logo });
  const n = m.length;
  const cell = size / (n + margin * 2);
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = fg;
  const finder = (r, col) => (r < 7 && col < 7) || (r < 7 && col >= n - 7) || (r >= n - 7 && col < 7);
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      if (!m[r][col]) continue;
      const x = (col + margin) * cell; const y = (r + margin) * cell;
      if (rounded && !finder(r, col)) { ctx.beginPath(); ctx.arc(x + cell / 2, y + cell / 2, cell * 0.46, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(cell), Math.ceil(cell));
    }
  }
  if (logo) {
    try {
      const img = await loadImg(logo);
      const box = size * LOGO_SHARE;
      const ratio = img.width / img.height;
      const w = ratio >= 1 ? box : box * ratio; const h = ratio >= 1 ? box / ratio : box;
      const pad = cell * 0.9;
      ctx.fillStyle = bg;
      roundRect(ctx, size / 2 - w / 2 - pad, size / 2 - h / 2 - pad, w + pad * 2, h + pad * 2, cell);
      ctx.fill();
      ctx.drawImage(img, size / 2 - w / 2, size / 2 - h / 2, w, h);
    } catch { /* logo failed to load: plain code is still valid */ }
  }
  return c;
}

/** Standalone SVG markup (scales to any print size). Logo is embedded as an <image>. */
export function qrSvg(text, { fg = '#111827', bg = '#ffffff', margin = 4, logo = null, logoRatio = 1 } = {}) {
  const m = qrMatrix(text, { logo: !!logo });
  const n = m.length; const total = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (m[r][c]) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  }
  let logoEl = '';
  if (logo) {
    const box = total * LOGO_SHARE;
    const w = logoRatio >= 1 ? box : box * logoRatio; const h = logoRatio >= 1 ? box / logoRatio : box;
    const x = total / 2 - w / 2; const y = total / 2 - h / 2;
    logoEl = `<rect x="${(x - 0.9).toFixed(2)}" y="${(y - 0.9).toFixed(2)}" width="${(w + 1.8).toFixed(2)}" height="${(h + 1.8).toFixed(2)}" rx="1" fill="${bg}"/>`
      + `<image href="${logo}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${bg}"/><path fill="${fg}" d="${d}"/>${logoEl}</svg>`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Image URL -> { url: data URL, ratio } so the SVG download is self-contained. Null if it can't be loaded. */
export async function logoInfo(src) {
  if (!src) return null;
  try {
    const img = await loadImg(src);
    if (src.startsWith('data:')) return { url: src, ratio: img.width / img.height };
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return { url: c.toDataURL('image/png'), ratio: img.width / img.height };
  } catch { return null; }
}
