// Organization branding for public pages (shared links, file requests, embeds).

export const DEFAULT_BRANDING = {
  enabled: true,
  logo: null, // data URL; null uses the product logo
  displayName: '', // shown next to the logo; empty uses the organization name
  hideName: false, // with a custom logo that already contains the name, show the logo only
  headerColor: '#FFFFFF',
  accentColor: '#1686D9',
  background: 'tint', // 'plain' | 'tint' (page background tinted with the accent colour)
  welcomeLink: '',
  welcomeRequest: '',
  footerText: '',
  supportEmail: '',
  poweredBy: true,
};

export const ACCENT_PRESETS = ['#1686D9', '#0E7490', '#16A34A', '#7C3AED', '#DB2777', '#DC2626', '#EA7A1A', '#111827'];
export const HEADER_PRESETS = ['#FFFFFF', '#0B1F3A', '#111827', '#1686D9', '#0E7490', '#14532D', '#4C1D95', '#7F1D1D'];
export const DEFAULT_LOGO = '/logo.png';

export const brandingOf = (state) => ({ ...DEFAULT_BRANDING, ...(state.org.branding || {}) });

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const isHex = (v) => HEX.test(v || '');

export function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n) || h.length !== 6) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** Mix two colours: t=0 -> a, t=1 -> b. */
export const mix = (a, b, t) => { const x = hexToRgb(a); const y = hexToRgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };

/** WCAG relative luminance and contrast ratio. */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const la = luminance(a); const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Black or white, whichever reads better on `bg`. */
export const textOn = (bg) => (contrast(bg, '#FFFFFF') >= contrast(bg, '#111827') ? '#FFFFFF' : '#111827');

/** CSS custom properties that theme a public page with the brand. */
export function brandVars(b, dark = false) {
  if (!b.enabled) return {};
  const accent = isHex(b.accentColor) ? b.accentColor : DEFAULT_BRANDING.accentColor;
  const header = isHex(b.headerColor) ? b.headerColor : DEFAULT_BRANDING.headerColor;
  return {
    '--primary': accent,
    '--primary-hover': mix(accent, '#000000', 0.12),
    '--primary-press': mix(accent, '#000000', 0.22),
    '--primary-soft': dark ? mix(accent, '#111318', 0.82) : mix(accent, '#FFFFFF', 0.9),
    '--primary-soft-2': dark ? mix(accent, '#111318', 0.7) : mix(accent, '#FFFFFF', 0.8),
    '--brand-header': header,
    '--brand-header-text': textOn(header),
    '--brand-page': b.background === 'tint' ? (dark ? mix(accent, '#0f1115', 0.92) : mix(accent, '#FFFFFF', 0.95)) : 'var(--bg-sub)',
    '--brand-accent-text': textOn(accent),
  };
}

/** Fill {sender}, {org} and {file} placeholders in a welcome message. */
export const fillMessage = (text, vars) => String(text || '').replace(/\{(sender|org|file)\}/g, (_, k) => vars[k] || '');

/** Resize an uploaded logo to at most 480×160 and return a PNG data URL (transparency kept). */
export function processLogo(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) { reject(new Error('Choose an image file (PNG, JPG, SVG or WEBP).')); return; }
    if (file.size > 4 * 1024 * 1024) { reject(new Error('The logo must be smaller than 4 MB.')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w0 = img.naturalWidth || 480; const h0 = img.naturalHeight || 160;
      const s = Math.min(1, 480 / w0, 160 / h0);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * s)); c.height = Math.max(1, Math.round(h0 * s));
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image couldn’t be opened.')); };
    img.src = url;
  });
}
