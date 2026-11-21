// E-signature requests: statuses, field definitions, and rendering of the signed copy.
//
// request: { id, itemId, version, title, message, createdBy, createdAt, due, sequential, status, completedAt,
//            signers: [{ id, userId|null, name, email, order, color, status, sentAt, viewedAt, signedAt, declinedAt, reason, device, ip }],
//            fields:  [{ id, signerId, kind, page, x, y, w, h, value }],   (x/y/w/h normalized to the page)
//            events:  [{ at, kind, signerId?, by?, detail? }], signedFileId }
// Request status: sent → viewed → signed (everyone signed), or declined / cancelled. Expired is derived from `due`.
import { versionKey } from '../store/DriveStore';
import { fileBlob } from '../store/useItemActions';
import { isTrashedDeep } from '../store/selectors';
import { flattenPdf, textPagesCanvas } from '../viewing/pdfWriter';
import { computeStatus, SIGNER_COLORS } from './status';

export { computeStatus, SIGNER_COLORS };

export const FIELD_KINDS = {
  signature: { label: 'Signature', w: 0.26, h: 0.065 },
  initials: { label: 'Initials', w: 0.1, h: 0.065 },
  date: { label: 'Date signed', w: 0.18, h: 0.035 },
  name: { label: 'Full name', w: 0.24, h: 0.035 },
  text: { label: 'Text', w: 0.24, h: 0.035 },
};

export const REQUEST_STATUS = {
  sent: { label: 'Sent', tone: 'blue' },
  viewed: { label: 'Viewed', tone: 'amber' },
  partial: { label: 'Partially signed', tone: 'blue' },
  signed: { label: 'Signed', tone: 'green' },
  declined: { label: 'Declined', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
  expired: { label: 'Expired', tone: 'expired' },
};
export const SIGNER_STATUS = {
  waiting: { label: 'Waiting for turn', tone: 'gray' },
  sent: { label: 'Sent', tone: 'blue' },
  viewed: { label: 'Viewed', tone: 'amber' },
  signed: { label: 'Signed', tone: 'green' },
  declined: { label: 'Declined', tone: 'red' },
};

export const isOpen = (r) => r.status === 'sent' || r.status === 'viewed';
/**
 * Status for display: an open request past its due date shows as expired; an open request that some
 * (but not all) signers have signed shows as partially signed.
 */
export const displayStatus = (r) => {
  if (isOpen(r) && r.due && r.due < Date.now()) return 'expired';
  if (isOpen(r) && r.signers.some((s) => s.status === 'signed')) return 'partial';
  return r.status;
};
/** Open and not past its due date: it can still be signed, reminded or cancelled. */
export const isActive = (r) => isOpen(r) && displayStatus(r) !== 'expired';

/** Why a request's document can't be shown: 'deleted' (missing), 'trashed', or null when it's fine. */
export function docGone(state, r) {
  if (!state.items[r.itemId]) return 'deleted';
  if (isTrashedDeep(state.items, r.itemId)) return 'trashed';
  return null;
}
/** The signer can sign now: their turn, the request is active, and the document still exists. */
export const canSignNow = (state, r, sg) => !!sg && (sg.status === 'sent' || sg.status === 'viewed') && isActive(r) && !docGone(state, r);
/** The detail of the last 'cancelled' event (why the request was cancelled), or ''. */
export const cancelReason = (r) => [...(r.events || [])].reverse().find((e) => e.kind === 'cancelled')?.detail || '';

/** Requests where the signed-in user still has to sign (their turn has come). */
export function signWaitingForMe(state) {
  return (state.signRequests || [])
    .filter((r) => isActive(r) && !docGone(state, r))
    .map((r) => ({ ...r, mySigner: r.signers.find((s) => s.userId === state.meId && (s.status === 'sent' || s.status === 'viewed')) }))
    .filter((r) => r.mySigner);
}
export const signCount = (state) => signWaitingForMe(state).length;
export const signRequestsFor = (state, itemId) => (state.signRequests || []).filter((r) => r.itemId === itemId && !docGone(state, r)).sort((a, b) => b.createdAt - a.createdAt);

export const signingLink = (r, s) => `${window.location.origin}/sign/${r.id}/${s.id}`;
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e || '');
export const initialsOf = (name) => (name || '').split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 3).join('').toUpperCase();
export const fmtSignDate = (t) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export const SIGNATURE_FONTS = [
  { id: 'dancing', css: '"Dancing Script", "Segoe Script", cursive', label: 'Classic' },
  { id: 'vibes', css: '"Great Vibes", "Brush Script MT", cursive', label: 'Elegant' },
  { id: 'caveat', css: 'Caveat, "Segoe Print", cursive', label: 'Casual' },
];
export const fontCss = (id) => (SIGNATURE_FONTS.find((f) => f.id === id) || SIGNATURE_FONTS[0]).css;

/** The PDF exactly as it was when the request was sent (an older version if the file changed since). */
export async function requestPdf(state, r) {
  const item = state.items[r.itemId];
  if (!item) throw new Error('The document no longer exists.');
  if ((item.version || 1) === r.version) return fileBlob(item);
  const v = (item.versions || []).find((x) => x.no === r.version);
  if (!v) throw new Error(`Version ${r.version} of this document, which was sent for signing, no longer exists (it was removed from the version history). Ask the sender to send a new request.`);
  return fileBlob({ ...item, id: versionKey(item.id, v.no), content: v.content, dataUrl: v.dataUrl, mime: v.mime, size: v.size });
}

const loadImage = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });

/** Draw a filled field value into a box on a canvas. */
export async function drawFieldValue(ctx, f, x, y, w, h) {
  const v = f.value;
  if (v == null || v === '') return;
  if (typeof v === 'object' && v.type === 'image') {
    const img = await loadImage(v.dataUrl);
    const s = Math.min(w / img.width, h / img.height);
    ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
  } else if (typeof v === 'object' && v.type === 'typed') {
    const css = fontCss(v.font);
    await document.fonts?.load?.(`48px ${css}`).catch(() => {});
    let size = h * 0.72;
    ctx.font = `${size}px ${css}`;
    while (ctx.measureText(v.text).width > w * 0.96 && size > 8) { size -= 1; ctx.font = `${size}px ${css}`; }
    ctx.fillStyle = '#0B2A6F'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(v.text, x + 2, y + h * 0.55);
  } else {
    let size = h * 0.62;
    ctx.font = `500 ${size}px Poppins, Arial, sans-serif`;
    const text = String(v);
    while (ctx.measureText(text).width > w * 0.98 && size > 7) { size -= 1; ctx.font = `500 ${size}px Poppins, Arial, sans-serif`; }
    ctx.fillStyle = '#111827'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(text, x + 2, y + h / 2);
  }
  if (f.kind === 'signature' || f.kind === 'initials') {
    ctx.strokeStyle = '#94A3B8'; ctx.lineWidth = Math.max(1, h * 0.03);
    ctx.beginPath(); ctx.moveTo(x, y + h - 1); ctx.lineTo(x + w, y + h - 1); ctx.stroke();
  }
}

const EVENT_TEXT = {
  created: 'Request created and sent', sent: 'Sent for signing', viewed: 'Opened the document', signed: 'Signed the document',
  declined: 'Declined to sign', cancelled: 'Request cancelled', reminded: 'Reminder sent', completed: 'All parties signed',
};
export const eventText = (e) => EVENT_TEXT[e.kind] || e.kind;

/**
 * Builds the completed, signed PDF: the original pages with the signatures placed, plus an audit certificate.
 * Returns a Blob; `blob.flattened` is true when the original couldn't be edited (encrypted / damaged) and the
 * pages were rendered to images instead.
 */
export async function signedCopyBlob(state, r) {
  const src = await requestPdf(state, r);
  const signerName = (id) => r.signers.find((s) => s.id === id)?.name || '';
  const fmt = (t) => (t ? new Date(t).toLocaleString() : '—');
  const blocks = [
    { pairs: [['Document', state.items[r.itemId]?.name || ''], ['Request', r.title], ['Request ID', r.id], ['Sent by', state.users.find((u) => u.id === r.createdBy)?.name || ''], ['Sent', fmt(r.createdAt)], ['Completed', fmt(r.completedAt)]] },
    { rule: true },
    { heading: 'Signers' },
  ];
  for (const s of [...r.signers].sort((a, b) => a.order - b.order)) {
    blocks.push({ text: `${s.order}. ${s.name} <${s.email}>`, bold: true, size: 22 });
    blocks.push({ pairs: [['Status', s.status], ['Viewed', fmt(s.viewedAt)], ['Signed', fmt(s.signedAt)], ['Device / IP', [s.device, s.ip].filter(Boolean).join(' · ') || '—']], indent: 24 });
  }
  blocks.push({ rule: true }, { heading: 'History' });
  for (const e of r.events || []) blocks.push({ text: `${fmt(e.at)} — ${e.signerId ? `${signerName(e.signerId)}: ` : ''}${eventText(e)}${e.detail ? ` (${e.detail})` : ''}`, size: 18 });
  const info = { title: `${r.title} (signed)`, subject: 'Signed document', author: state.users.find((u) => u.id === r.createdBy)?.name || '' };
  // Preferred: draw onto the original PDF (text stays selectable, the file stays small).
  try {
    const { stampSignedPdf } = await import('../viewing/pdfStamp');
    const bytes = await stampSignedPdf(new Uint8Array(await src.arrayBuffer()), {
      fields: r.fields, renderPng: renderFieldPng, info,
      certificate: { title: 'Certificate of completion', subtitle: 'Electronic signature record', blocks },
    });
    const blob = new Blob([bytes], { type: 'application/pdf' });
    blob.flattened = false;
    return blob;
  } catch (e) {
    console.warn('Signed copy: could not edit the original PDF, flattening it instead.', e); // eslint-disable-line no-console
  }
  // Fallback (encrypted or damaged PDFs): pages rendered to images. `flattened` lets callers mention it.
  const cert = textPagesCanvas('Certificate of completion', blocks, { subtitle: 'Electronic signature record' });
  const blob = await flattenPdf(src, async (ctx, page, w, h) => {
    for (const f of r.fields.filter((x) => x.page === page)) {
      await drawFieldValue(ctx, f, f.x * w, f.y * h, f.w * w, f.h * h); // eslint-disable-line no-await-in-loop
    }
  }, { extraPages: cert, info });
  blob.flattened = true;
  return blob;
}

/**
 * A field's value drawn on a transparent canvas, as a PNG data URL (for pdf-lib): typed signatures need the web
 * signature fonts, and text outside the standard PDF fonts' character set needs the browser's fonts.
 */
async function renderFieldPng(f, wPt, hPt) {
  const k = 4; // px per point
  const c = document.createElement('canvas');
  c.width = Math.max(4, Math.round(wPt * k)); c.height = Math.max(4, Math.round(hPt * k));
  const ctx = c.getContext('2d');
  if (f.value && typeof f.value === 'object' && f.value.type === 'image') {
    const img = await loadImage(f.value.dataUrl);
    const s = Math.min(c.width / img.width, c.height / img.height);
    ctx.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s);
  } else {
    await drawFieldValue(ctx, { ...f, kind: 'value' }, 0, 0, c.width, c.height); // 'value': no signature line (pdf-lib draws it)
  }
  return c.toDataURL('image/png');
}
