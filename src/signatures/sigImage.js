// Signature image helpers: stroke smoothing for the draw pad, and clean-up of uploaded signature images.

/* ------------------------------------------------------------------ */
/* Drawn strokes                                                       */
/* ------------------------------------------------------------------ */
// A raw stroke is [{ x, y, t, p }] (position in CSS px, time in ms, pen pressure or 0).
// It is turned into a smooth, pen-like path: jitter removed, corners rounded, and width
// varying with speed (or pressure) the way ink does.

/** Raw points -> [[x, y, width], ...], smoothed. */
export function smoothStroke(raw, base = 2.8) {
  if (!raw.length) return [];
  // 1. Drop points that are too close together (hand tremor, duplicate events).
  const pts = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const a = pts[pts.length - 1]; const b = raw[i];
    if (Math.hypot(b.x - a.x, b.y - a.y) >= 1.6 || i === raw.length - 1) pts.push(b);
  }
  // 2. Width from pressure (pens) or speed (mouse / finger): faster strokes are thinner.
  let w = base;
  const withW = pts.map((p, i) => {
    let target;
    if (p.p > 0 && p.p !== 0.5) target = base * (0.55 + p.p * 0.9);
    else if (i === 0) target = base;
    else {
      const q = pts[i - 1];
      const v = Math.hypot(p.x - q.x, p.y - q.y) / Math.max(1, p.t - q.t); // px per ms
      target = base * Math.max(0.5, Math.min(1.3, 1.38 - v * 0.3));
    }
    w = i === 0 ? target : w * 0.72 + target * 0.28;
    return [p.x, p.y, w];
  });
  // 3. Moving average to remove jitter (end points stay put so the stroke keeps its length).
  let out = movingAverage(withW, 2);
  // 4. Chaikin corner cutting for round curves.
  out = chaikin(chaikin(out));
  // 5. Taper the ends slightly, like a real pen lifting off.
  const n = out.length;
  if (n > 6) {
    for (let i = 0; i < Math.min(4, n / 3); i++) {
      const f = 0.55 + (i / 4) * 0.45;
      out[i][2] *= f; out[n - 1 - i][2] *= f;
    }
  }
  return out;
}

function movingAverage(pts, r) {
  if (pts.length < 3) return pts;
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    const k = Math.min(r, i, pts.length - 1 - i);
    let sx = 0; let sy = 0; let sw = 0;
    for (let j = i - k; j <= i + k; j++) { sx += pts[j][0]; sy += pts[j][1]; sw += pts[j][2]; }
    const c = 2 * k + 1;
    return [sx / c, sy / c, sw / c];
  });
}

function chaikin(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]; const b = pts[i + 1];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] * 0.75 + b[2] * 0.25]);
    out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] * 0.25 + b[2] * 0.75]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Paint a smoothed stroke as quadratic curves through segment midpoints. */
export function paintStroke(ctx, pts, color) {
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (!pts.length) return;
  if (pts.length < 3) {
    // A tap or a tiny tick: a dot, or a short line.
    const [x0, y0, w0] = pts[0]; const [x1, y1] = pts[pts.length - 1];
    if (Math.hypot(x1 - x0, y1 - y0) < 1) { ctx.beginPath(); ctx.arc(x0, y0, w0 * 0.75, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.lineWidth = w0; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); return;
  }
  let [px, py] = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y, w] = pts[i];
    const mx = (x + pts[i + 1][0]) / 2; const my = (y + pts[i + 1][1]) / 2;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(x, y, mx, my); ctx.stroke();
    px = mx; py = my;
  }
  const last = pts[pts.length - 1];
  ctx.lineWidth = last[2];
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(last[0], last[1]); ctx.stroke();
}

/** Crop a canvas to its non-transparent pixels and return a PNG signature value. */
export function trimCanvas(canvas, pad = 8) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  if (!width || !height) return null;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > 12) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  if (maxX < 0) return null;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width, maxX + pad + 1); maxY = Math.min(height, maxY + pad + 1);
  const out = document.createElement('canvas');
  out.width = maxX - minX; out.height = maxY - minY;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return { type: 'image', dataUrl: out.toDataURL('image/png'), w: out.width, h: out.height };
}

/* ------------------------------------------------------------------ */
/* Uploaded images                                                     */
/* ------------------------------------------------------------------ */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml,image/avif,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.avif';

/** Decode any browser-supported image file into an <img>/<canvas> source. */
export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('No file')); return; }
    if (file.type && !file.type.startsWith('image/')) { reject(new Error('That file isn’t an image. Choose a PNG, JPG, WEBP, GIF, BMP or SVG file.')); return; }
    if (file.size > MAX_UPLOAD_BYTES) { reject(new Error('That image is larger than 15 MB. Choose a smaller file.')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const heic = /\.(heic|heif)$/i.test(file.name || '');
      reject(new Error(heic ? 'HEIC photos can’t be opened in the browser. Export it as JPG or PNG first.' : 'This image couldn’t be opened. Try a PNG or JPG file.'));
    };
    img.src = url;
  });
}

export const INK_OPTIONS = [
  { id: 'original', label: 'Original', color: null },
  { id: 'black', label: 'Black', color: [17, 24, 39] },
  { id: 'blue', label: 'Blue', color: [11, 42, 111] },
];

/**
 * Turn a photo or scan of a signature into clean ink on a transparent background.
 * - removeBg: paper/background becomes transparent (threshold picked automatically), edges stay anti-aliased
 * - ink: 'original' | 'black' | 'blue'
 * Images that already have transparency keep it (background removal then only affects their opaque pixels).
 * The result's `opaque` is true when the source had no transparency of its own.
 * Returns { type: 'image', dataUrl, w, h } or throws if no signature is found.
 */
export function cleanSignatureImage(img, { removeBg = true, ink = 'original', maxSide = 1400 } = {}) {
  const iw = img.naturalWidth || img.width; const ih = img.naturalHeight || img.height;
  if (!iw || !ih) throw new Error('This image is empty.');
  const scale = Math.min(1, maxSide / Math.max(iw, ih));
  const W = Math.max(1, Math.round(iw * scale)); const H = Math.max(1, Math.round(ih * scale));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const im = ctx.getImageData(0, 0, W, H);
  const d = im.data;
  const n = W * H;

  // Already transparent (e.g. an exported PNG signature)? Keep its alpha.
  let clear = 0; let visible = 0;
  for (let i = 3; i < d.length; i += 4) { if (d[i] < 200) clear++; if (d[i] > 12) visible++; }
  if (!visible) throw new Error('This image is completely transparent, so there’s no signature in it. Choose a different file.');
  const hasAlpha = clear > n * 0.05;

  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  // A partly transparent image may still contain white paper (e.g. a scan pasted on a transparent canvas):
  // remove the background from its opaque pixels. If the opaque pixels are just ink, its alpha is already clean.
  let opaque = 0; let lightOpaque = 0;
  if (hasAlpha) for (let i = 0; i < n; i++) if (d[i * 4 + 3] >= 200) { opaque++; if (lum[i] > 180) lightOpaque++; }
  const paperInAlpha = hasAlpha && opaque > n * 0.02 && lightOpaque > opaque * 0.3;
  const doRemove = removeBg && (!hasAlpha || paperInAlpha);

  if (doRemove) {
    // Is the background light (ink darker) or dark (light ink, e.g. chalk on a board)? Use the luminance
    // most of the image has (the paper), not just the border, which may be a table or a shadow.
    const darkBg = !hasAlpha && dominantLum(lum) < 110;
    const work = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Transparent areas count as background so they don't look like ink.
      const a = d[i * 4 + 3] / 255;
      const v = darkBg ? 255 - lum[i] : lum[i];
      work[i] = v * a + 255 * (1 - a);
    }
    // Even out uneven lighting from phone photos: compare each pixel to a blurred background estimate.
    const bg = boxBlur(work, W, H, Math.max(8, Math.round(Math.max(W, H) / 30)));
    const diff = new Float32Array(n);
    for (let i = 0; i < n; i++) diff[i] = Math.max(0, bg[i] - work[i]);
    // Otsu threshold on "how much darker than its surroundings" a pixel is.
    const t = Math.max(18, otsu(diff));
    const lo = t * 0.55; const hi = t * 1.35;
    for (let i = 0; i < n; i++) {
      const a = diff[i] <= lo ? 0 : diff[i] >= hi ? 1 : (diff[i] - lo) / (hi - lo);
      d[i * 4 + 3] = Math.min(d[i * 4 + 3], Math.round(a * 255));
      if (darkBg && ink === 'original') { d[i * 4] = 255 - d[i * 4]; d[i * 4 + 1] = 255 - d[i * 4 + 1]; d[i * 4 + 2] = 255 - d[i * 4 + 2]; }
    }
    despeckle(d, W, H);
  }

  // Recolouring only makes sense when the alpha marks the ink; on an opaque image it would fill the whole box.
  const realAlpha = doRemove || hasAlpha;
  const inkColor = INK_OPTIONS.find((o) => o.id === ink)?.color;
  if (inkColor && realAlpha) {
    for (let i = 0; i < n; i++) { d[i * 4] = inkColor[0]; d[i * 4 + 1] = inkColor[1]; d[i * 4 + 2] = inkColor[2]; }
  } else if (doRemove) {
    // Deepen faint ink (pencil, ballpoint photographed in soft light) so it reads on the page.
    for (let i = 0; i < n; i++) {
      if (!d[i * 4 + 3]) continue;
      for (let k = 0; k < 3; k++) d[i * 4 + k] = Math.round(d[i * 4 + k] * 0.72);
    }
  }
  ctx.putImageData(im, 0, 0);

  const out = trimCanvas(c, 6);
  if (!out) throw new Error('No signature was found in this image. Use a photo of dark ink on light paper, or turn off “Remove background”.');
  return { ...out, opaque: !hasAlpha };
}

/** The most common luminance (16-level histogram peak) — for a signature photo, the paper. */
function dominantLum(lum) {
  const hist = new Array(16).fill(0);
  for (let i = 0; i < lum.length; i++) hist[Math.min(15, lum[i] >> 4)]++;
  let best = 0;
  for (let i = 1; i < 16; i++) if (hist[i] > hist[best]) best = i;
  return best * 16 + 8;
}

/** Cleans the image and stores very wide results at a sensible size (signatures are small on the page). */
export async function cleanSignatureFile(img, opts, maxW = 900) {
  const v = cleanSignatureImage(img, opts);
  if (v.w <= maxW) return v;
  const src = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = v.dataUrl; });
  const s = maxW / v.w;
  const c = document.createElement('canvas');
  c.width = Math.round(v.w * s); c.height = Math.max(1, Math.round(v.h * s));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return { type: 'image', dataUrl: c.toDataURL('image/png'), w: c.width, h: c.height, opaque: v.opaque };
}

function boxBlur(src, W, H, r) {
  // Separable box blur via running sums (twice, approximating a Gaussian).
  const pass = (input) => {
    const tmp = new Float32Array(W * H); const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      let s = 0; const row = y * W;
      for (let x = -r; x <= r; x++) s += input[row + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[row + x] = s / (2 * r + 1);
        s += input[row + Math.min(W - 1, x + r + 1)] - input[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        out[y * W + x] = s / (2 * r + 1);
        s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
      }
    }
    return out;
  };
  return pass(pass(src));
}

function otsu(values) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < values.length; i++) hist[Math.min(255, Math.round(values[i]))]++;
  const total = values.length;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0; let wB = 0; let best = 0; let t = 0;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB; const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; t = i; }
  }
  return t;
}

/** Remove isolated specks (dust, paper grain) that have almost no ink around them. */
function despeckle(d, W, H) {
  const a = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = d[i * 4 + 3] > 40 ? 1 : 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!a[i]) continue;
      const nb = a[i - 1] + a[i + 1] + a[i - W] + a[i + W] + a[i - W - 1] + a[i - W + 1] + a[i + W - 1] + a[i + W + 1];
      if (nb <= 1) d[i * 4 + 3] = 0;
    }
  }
}
