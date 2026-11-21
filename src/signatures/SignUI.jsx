import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  PenTool, CheckCircle2, XCircle, Clock, Eye, Send, Link2, ExternalLink, BellRing, Download, History, AlertTriangle, FileCheck2, Hourglass, Ban, X,
  Sparkles, Undo2, ImageUp, Loader2,
} from 'lucide-react';
import {
  smoothStroke, paintStroke, trimCanvas, loadImageFile, cleanSignatureFile, INK_OPTIONS, UPLOAD_ACCEPT,
} from './sigImage';
import { useDrive, registerBlob } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { useItemActions, fileBlob } from '../store/useItemActions';
import { Link } from 'react-router-dom';
import { accessOf, canEdit } from '../store/selectors';
import { formatDate, formatDateTime } from '../utils/format';
import { saveBlob } from '../utils/exporters';
import { Modal, Avatar } from '../components/common';
import { ItemChip, DueChip } from '../components/files/Workflow';
import {
  FIELD_KINDS, REQUEST_STATUS, SIGNER_STATUS, SIGNATURE_FONTS, displayStatus, fontCss, initialsOf, isActive, signingLink, signedCopyBlob, signRequestsFor, eventText,
  cancelReason, docGone,
} from './signing';

/* ------------------------------------------------------------------ */
/* A field on a page                                                   */
/* ------------------------------------------------------------------ */
export function FieldValue({ f, h }) {
  const v = f.value;
  if (v && typeof v === 'object' && v.type === 'image') return <img className="sf-img" src={v.dataUrl} alt="Signature" draggable={false} />;
  if (v && typeof v === 'object' && v.type === 'typed') return <span className="sf-typed" style={{ fontFamily: fontCss(v.font), fontSize: h * 0.68 }}>{v.text}</span>;
  return <span className="sf-text" style={{ fontSize: Math.max(9, h * 0.55) }}>{String(v)}</span>;
}

/**
 * mode: 'compose' (drag/resize/delete), 'sign' (the signer's own fields: click to fill), 'view' (read-only)
 */
export function FieldBox({ f, w, h, color, label, mode, selected, onSelect, onChange, onDelete, onActivate, filled, highlight, children }) {
  const style = { left: f.x * w, top: f.y * h, width: f.w * w, height: f.h * h, '--sf': color };
  const startDrag = (e, kind) => {
    if (mode !== 'compose') return;
    e.stopPropagation(); e.preventDefault();
    onSelect?.();
    const sx = e.clientX; const sy = e.clientY; const o = { ...f };
    const move = (ev) => {
      const dx = (ev.clientX - sx) / w; const dy = (ev.clientY - sy) / h;
      if (kind === 'move') onChange({ x: Math.max(0, Math.min(1 - o.w, o.x + dx)), y: Math.max(0, Math.min(1 - o.h, o.y + dy)) });
      else onChange({ w: Math.max(0.04, Math.min(1 - o.x, o.w + dx)), h: Math.max(0.015, Math.min(1 - o.y, o.h + dy)) });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const hasValue = f.value != null && f.value !== '';
  // A field that holds its own control (a text input) is a plain box: the input is the focusable, labelled control.
  const isButton = mode === 'sign' && !children;
  const Tag = isButton ? 'button' : 'div';
  const signMark = mode === 'sign' && !hasValue && (f.kind === 'signature' || f.kind === 'initials');
  return (
    <Tag type={isButton ? 'button' : undefined} className={`sign-field mode-${mode} kind-${f.kind} ${children ? 'has-input' : ''} ${selected ? 'selected' : ''} ${hasValue || filled ? 'filled' : ''} ${highlight ? 'pulse' : ''}`}
      style={style} data-field={f.id}
      onPointerDown={(e) => startDrag(e, 'move')}
      onClick={isButton ? (e) => { e.stopPropagation(); onActivate?.(); } : mode === 'sign' ? (e) => { e.stopPropagation(); e.currentTarget.querySelector('input,textarea')?.focus(); } : undefined}
      aria-label={isButton ? `${FIELD_KINDS[f.kind].label}${hasValue ? ' (filled)' : ''}` : undefined}>
      {children || (hasValue ? <FieldValue f={f} h={f.h * h} /> : <span className="sf-label">{signMark && <PenTool size={12} aria-hidden="true" />}{label || FIELD_KINDS[f.kind].label}</span>)}
      {mode === 'compose' && selected && (
        <>
          <button type="button" className="sf-del" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDelete(); }} aria-label="Remove field"><X size={11} /></button>
          <span className="sf-resize" onPointerDown={(e) => startDrag(e, 'resize')} aria-hidden="true" />
        </>
      )}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/* Adopt a signature (type or draw)                                     */
/* ------------------------------------------------------------------ */
const PEN_COLORS = [{ id: 'blue', label: 'Blue ink', color: '#0B2A6F' }, { id: 'black', label: 'Black ink', color: '#111827' }];

/**
 * Signature pad. Strokes are recorded as raw points and re-drawn smoothed (jitter removed, curves
 * rounded, width varying with speed like a real pen), so shaky mouse or finger input comes out clean.
 */
function DrawPad({ onChange }) {
  const ref = useRef(null);
  const strokes = useRef([]); // finished: { raw, pts }
  const live = useRef(null); // raw points of the stroke being drawn
  const [count, setCount] = useState(0);
  const [pen, setPen] = useState(PEN_COLORS[0].id);
  const color = PEN_COLORS.find((p) => p.id === pen).color;
  // Read by paint code that may run from a stale closure (the ResizeObserver set up on mount).
  const colorRef = useRef(color);
  colorRef.current = color;
  const pointerId = useRef(null); // the one pointer drawing the current stroke

  const paintAll = (ctx, scale) => {
    const ink = colorRef.current;
    ctx.save(); ctx.setTransform(scale, 0, 0, scale, 0, 0);
    for (const s of strokes.current) paintStroke(ctx, s.pts, ink);
    if (live.current) paintStroke(ctx, smoothStroke(live.current), ink);
    ctx.restore();
  };
  const redraw = () => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    paintAll(ctx, c.width / c.clientWidth || 1);
  };
  const exportValue = () => {
    const c = ref.current;
    if (!strokes.current.length) return null;
    // Render at high resolution so the signature stays crisp when placed on the page.
    const scale = Math.max(3, window.devicePixelRatio || 1);
    const out = document.createElement('canvas');
    out.width = Math.round(c.clientWidth * scale); out.height = Math.round(c.clientHeight * scale);
    paintAll(out.getContext('2d'), scale);
    return trimCanvas(out, 12);
  };

  useEffect(() => {
    const c = ref.current;
    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr);
      redraw();
    };
    size();
    const ro = new ResizeObserver(size); ro.observe(c);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { redraw(); if (strokes.current.length) onChange(exportValue()); }, [pen]); // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e) => {
    const r = ref.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp, p: e.pointerType === 'pen' ? e.pressure : 0 };
  };
  const down = (e) => {
    // Ignore a second finger (or a palm) while a stroke is being drawn.
    if (e.button > 0 || !e.isPrimary || live.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerId.current = e.pointerId;
    live.current = [point(e)];
    redraw();
  };
  const move = (e) => {
    if (!live.current || e.pointerId !== pointerId.current) return;
    const evs = e.nativeEvent.getCoalescedEvents ? e.nativeEvent.getCoalescedEvents() : [];
    if (evs.length) for (const ev of evs) live.current.push(point(ev)); else live.current.push(point(e));
    redraw();
  };
  const up = (e) => {
    if (!live.current || e.pointerId !== pointerId.current) return;
    const raw = live.current; live.current = null; pointerId.current = null;
    strokes.current.push({ raw, pts: smoothStroke(raw) });
    setCount(strokes.current.length);
    redraw();
    onChange(exportValue());
  };
  const undo = () => { strokes.current.pop(); setCount(strokes.current.length); redraw(); onChange(exportValue()); };
  const clear = () => { strokes.current = []; setCount(0); redraw(); onChange(null); };

  return (
    <div className="draw-pad-wrap">
      <div className="draw-pad">
        <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Draw your signature" />
        <div className="draw-pad-line" aria-hidden="true" />
        {!count && <span className="draw-pad-hint" aria-hidden="true">Sign here</span>}
      </div>
      <div className="draw-pad-bar">
        <div className="pen-colors" role="radiogroup" aria-label="Ink colour">
          {PEN_COLORS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={pen === p.id} aria-label={p.label} title={p.label}
              className={`pen-color ${pen === p.id ? 'on' : ''}`} style={{ '--pen': p.color }} onClick={() => setPen(p.id)} />
          ))}
        </div>
        <span className="muted small"><Sparkles size={12} /> Lines are smoothed automatically</span>
        <span className="draw-pad-actions">
          <button type="button" className="link-btn" onClick={undo} disabled={!count}><Undo2 size={13} /> Undo</button>
          <button type="button" className="link-btn" onClick={clear} disabled={!count}>Clear</button>
        </span>
      </div>
    </div>
  );
}

/** Upload a photo, scan or PNG of a handwritten signature; the background is removed automatically. */
function UploadPad({ onChange }) {
  const inputRef = useRef(null);
  const [img, setImg] = useState(null);
  const [fileName, setFileName] = useState('');
  const [removeBg, setRemoveBg] = useState(true);
  const [ink, setInk] = useState('original');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [over, setOver] = useState(false);

  const pick = async (file) => {
    if (!file) return;
    setError(''); setBusy(true);
    try {
      const im = await loadImageFile(file);
      setImg(im); setFileName(file.name || 'Image');
    } catch (e) {
      setError(e.message); setImg(null); setPreview(null); onChange(null);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!img) return undefined;
    let cancelled = false;
    setBusy(true);
    // Let the spinner paint before the (synchronous) pixel work.
    const t = setTimeout(async () => {
      try {
        const v = await cleanSignatureFile(img, { removeBg, ink });
        if (cancelled) return;
        setPreview(v); setError(''); onChange({ type: 'image', dataUrl: v.dataUrl });
      } catch (e) {
        if (cancelled) return;
        setPreview(null); setError(e.message); onChange(null);
      } finally { if (!cancelled) setBusy(false); }
    }, 30);
    return () => { cancelled = true; clearTimeout(t); };
  }, [img, removeBg, ink]); // eslint-disable-line react-hooks/exhaustive-deps

  // An opaque image without background removal can't be recoloured (it would fill the whole box).
  const inkLocked = !removeBg && !!preview?.opaque;

  const reset = () => { setImg(null); setPreview(null); setFileName(''); setError(''); onChange(null); };

  return (
    <div className="sig-upload">
      <input ref={inputRef} type="file" accept={UPLOAD_ACCEPT} hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      {!img ? (
        <button type="button" className={`sig-drop ${over ? 'over' : ''}`} onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}>
          {busy ? <Loader2 size={22} className="spin" /> : <ImageUp size={26} />}
          <strong>Upload an image of your signature</strong>
          <span className="muted small">Drag a file here or click to browse. PNG, JPG, WEBP, GIF, BMP or SVG, up to 15 MB.</span>
          <span className="muted small">Tip: sign on plain white paper and take a well-lit photo.</span>
        </button>
      ) : (
        <>
          <div className="sig-upload-preview checker">
            {preview ? <img src={preview.dataUrl} alt="Your signature" /> : <span className="muted small">{busy ? 'Cleaning up…' : 'No signature found'}</span>}
            {busy && preview && <span className="sig-upload-busy"><Loader2 size={16} className="spin" /></span>}
          </div>
          <div className="sig-upload-opts">
            <label className="check-row"><input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} /> Remove background</label>
            <div className="seg seg-sm" role="radiogroup" aria-label="Ink colour" aria-describedby={inkLocked ? 'sig-ink-hint' : undefined}>
              {INK_OPTIONS.map((o) => (
                <button key={o.id} type="button" role="radio" aria-checked={(inkLocked ? 'original' : ink) === o.id} className={(inkLocked ? 'original' : ink) === o.id ? 'active' : ''} disabled={inkLocked} onClick={() => setInk(o.id)}>{o.label}</button>
              ))}
            </div>
            <span className="sig-upload-file muted small" title={fileName}>{fileName}</span>
            <button type="button" className="link-btn" onClick={() => inputRef.current?.click()}>Replace</button>
            <button type="button" className="link-btn" onClick={reset}>Remove</button>
          </div>
        </>
      )}
      {img && inkLocked && <p id="sig-ink-hint" className="muted small sig-ink-hint">Turn on “Remove background” to change the ink colour. This image has no transparent background, so recolouring would fill the whole picture.</p>}
      {error && <p className="sig-upload-error"><AlertTriangle size={13} /> {error}</p>}
    </div>
  );
}

/** Text that shrinks its font size to fit its box instead of being cut off. */
function FitText({ children, max, min, style }) {
  const ref = useRef(null);
  const [size, setSize] = useState(max);
  const fit = () => {
    const el = ref.current;
    if (!el || !el.clientWidth) return;
    let px = max;
    el.style.fontSize = `${px}px`;
    while (px > min && el.scrollWidth > el.clientWidth + 1) { px -= 1; el.style.fontSize = `${px}px`; }
    setSize(px);
  };
  useLayoutEffect(fit, [children, max, min]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.fonts?.ready?.then(() => fit()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref} className="fit-text" style={{ ...style, fontSize: size }}>{children}</span>;
}

export function AdoptSignature({ kind, name, onAdopt, onClose }) {
  const isInitials = kind === 'initials';
  const [tab, setTab] = useState('type');
  const [text, setText] = useState(isInitials ? initialsOf(name) : name);
  const [font, setFont] = useState(SIGNATURE_FONTS[0].id);
  const [drawn, setDrawn] = useState(null);
  const [uploaded, setUploaded] = useState(null);
  const value = tab === 'type' ? (text.trim() ? { type: 'typed', text: text.trim(), font } : null) : tab === 'draw' ? drawn : uploaded;
  return (
    <Modal title={isInitials ? 'Adopt your initials' : 'Adopt your signature'} subtitle="This is how your signature will appear on the document." onClose={onClose} width={560} icon={<PenTool size={18} />}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!value} onClick={() => onAdopt(value)}>Adopt and sign</button></>}>
      <div className="tabs small" role="tablist">
        <button role="tab" aria-selected={tab === 'type'} className={tab === 'type' ? 'active' : ''} onClick={() => setTab('type')}>Type</button>
        <button role="tab" aria-selected={tab === 'draw'} className={tab === 'draw' ? 'active' : ''} onClick={() => setTab('draw')}>Draw</button>
        <button role="tab" aria-selected={tab === 'upload'} className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}>Upload</button>
      </div>
      <div role="tabpanel" hidden={tab !== 'type'}>
          <label className="field"><span className="field-label">{isInitials ? 'Initials' : 'Full name'}</span>
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={isInitials ? 5 : 60} data-autofocus /></label>
          <div className="sig-fonts" role="radiogroup" aria-label="Style">
            {SIGNATURE_FONTS.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={font === f.id} className={`sig-font ${font === f.id ? 'on' : ''}`} onClick={() => setFont(f.id)}>
                <FitText style={{ fontFamily: f.css }} max={28} min={11}>{text || (isInitials ? 'AB' : 'Your name')}</FitText>
                <small className="muted">{f.label}</small>
              </button>
            ))}
          </div>
      </div>
      {/* All tabs stay mounted, so what you see on the active tab is exactly what gets adopted. */}
      <div role="tabpanel" hidden={tab !== 'draw'}><DrawPad onChange={setDrawn} /></div>
      <div role="tabpanel" hidden={tab !== 'upload'}><UploadPad onChange={setUploaded} /></div>
      <p className="muted small">By selecting “Adopt and sign”, you agree that this mark is the electronic representation of your {isInitials ? 'initials' : 'signature'}, with the same effect as a handwritten one.</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Signed copy                                                         */
/* ------------------------------------------------------------------ */
// Signed copies being generated, by request id, so a second click (or the auto-save after the last signature)
// reuses the one in progress instead of creating a duplicate "(signed).pdf".
const inflight = new Map(); // reqId -> { promise, download }

/** Create (or re-download) the signed PDF for a completed request. */
export function useSignedCopy() {
  const { api } = useDrive();
  const ui = useUI();
  const create = async (req, { download = false, silent = false } = {}) => {
    const state = api.get();
    // Right after the last signature the store snapshot may not include it yet; use whichever copy is newer.
    const stored = (state.signRequests || []).find((x) => x.id === req.id);
    const newer = !stored || (req.events?.length || 0) > (stored.events?.length || 0);
    const r = newer ? { ...(stored || {}), ...req, signedFileId: stored?.signedFileId || req.signedFileId || null } : stored;
    const existing = r.signedFileId && state.items[r.signedFileId];
    try {
      if (existing && download) { saveBlob(await fileBlob(existing), existing.name); return existing.id; }
      if (existing) return existing.id;
      const blob = await signedCopyBlob(api.get(), r);
      const item = state.items[r.itemId];
      const base = (item?.name || r.title).replace(/\.pdf$/i, '');
      if (download && !item) { saveBlob(blob, `${base} (signed).pdf`); return null; }
      const home = item && item.space !== 'user' ? { parentId: item.parentId, space: item.space } : { parentId: null, space: 'my' };
      const created = api.createFile({ name: `${base} (signed).pdf`, ext: 'pdf', size: blob.size, mime: 'application/pdf', uploaded: true, ...home });
      registerBlob(created.id, blob);
      api.attachSignedCopy(r.id, created.id);
      if (download) saveBlob(blob, created.name);
      if (!silent || blob.flattened) {
        ui.toast(`Signed copy saved as "${created.name}"${blob.flattened ? '. The original PDF couldn’t be edited, so its pages were saved as images.' : ''}`, { type: blob.flattened ? 'info' : 'success', duration: blob.flattened ? 8000 : undefined });
      }
      return created.id;
    } catch (e) {
      ui.toast(e?.message ? `Could not create the signed copy. ${e.message}` : 'Could not create the signed copy', { type: 'error' });
      return null;
    }
  };
  const save = async (r, opts = {}) => {
    const pending = inflight.get(r.id);
    if (pending) {
      const id = await pending.promise;
      if (opts.download && !pending.download && id) {
        const it = api.get().items[id];
        if (it) { try { saveBlob(await fileBlob(it), it.name); } catch { ui.toast('Could not download the signed copy', { type: 'error' }); } }
      }
      return id;
    }
    const entry = { download: !!opts.download, promise: create(r, opts) };
    inflight.set(r.id, entry);
    try { return await entry.promise; } finally { inflight.delete(r.id); }
  };
  return save;
}

/* ------------------------------------------------------------------ */
/* Request card (Signatures page, details panel)                        */
/* ------------------------------------------------------------------ */
const SIGNER_ICON = { waiting: Hourglass, sent: Send, viewed: Eye, signed: CheckCircle2, declined: XCircle };
const nameOfUser = (state, id) => (id === state.meId ? 'You' : state.users.find((u) => u.id === id)?.name || 'Someone');

export function SignRequestCard({ r, showItem = true, compact = false }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const actions = useItemActions();
  const signedCopy = useSignedCopy();
  const [history, setHistory] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const item = state.items[r.itemId];
  const st = displayStatus(r);
  const meta = REQUEST_STATUS[st];
  const mine = r.createdBy === state.meId;
  const gone = docGone(state, r);
  // Expired requests (and ones whose document is gone) can't be signed or reminded: no signing actions.
  const open = isActive(r) && !gone;
  const mySigner = open ? r.signers.find((s) => s.userId === state.meId && (s.status === 'sent' || s.status === 'viewed')) : null;
  const signedN = r.signers.filter((s) => s.status === 'signed').length;
  const changed = item && open && (item.version || 1) > r.version;
  const versionGone = changed && !(item.versions || []).some((v) => v.no === r.version);
  const whyCancelled = st === 'cancelled' ? cancelReason(r) : '';
  const download = async () => {
    setDownloading(true);
    try { await signedCopy(r, { download: true, silent: true }); } finally { setDownloading(false); }
  };
  const signerName = (id) => r.signers.find((s) => s.id === id)?.name || '';

  const copy = (s) => {
    navigator.clipboard?.writeText(signingLink(r, s)).then(() => ui.toast(`Signing link for ${s.name} copied`, { type: 'success' })).catch(() => ui.toast(signingLink(r, s), { type: 'info', duration: 8000 }));
  };
  const cancel = () => ui.openDialog('confirm', {
    title: 'Cancel this signature request?', message: 'Signers will no longer be able to open or sign the document. Signatures already collected are kept in the history.',
    confirmLabel: 'Cancel request', cancelLabel: 'Keep request', danger: true, onConfirm: () => { api.cancelSignRequest(r.id); ui.toast('Signature request cancelled', { type: 'success' }); },
  });

  return (
    <div className={`sign-card tone-${meta.tone} ${compact ? 'compact' : ''}`}>
      <div className="approval-head">
        <span className={`pill pill-${meta.tone}`}>{meta.label}</span>
        {showItem ? <ItemChip itemId={r.itemId} /> : <strong className="truncate">{r.title}</strong>}
        <span className="grow" />
        {open && r.due && <DueChip due={r.due} />}
      </div>
      {showItem && <div className="strong small">{r.title}</div>}
      <div className="small muted">
        {mine ? 'You' : nameOfUser(state, r.createdBy)} sent this {formatDate(r.createdAt)}{r.sequential ? ' · signing in order' : ''}
        {st === 'signed' && r.completedAt ? ` · completed ${formatDate(r.completedAt)}` : ''}
      </div>
      {r.message && !compact && <blockquote className="request-msg">{r.message}</blockquote>}
      {changed && !versionGone && <div className="field-warn"><AlertTriangle size={13} /> The file changed after it was sent (now version {item.version}). Signers see version {r.version}.</div>}
      {versionGone && <div className="field-warn"><AlertTriangle size={13} /> Version {r.version}, which was sent for signing, has been removed from the file's version history, so this request can't be signed. Cancel it and send a new request.</div>}
      {whyCancelled && <div className="small muted sign-cancel-reason"><Ban size={13} /> Cancelled: {whyCancelled}</div>}
      {gone && isActive(r) && <div className="field-warn"><AlertTriangle size={13} /> {gone === 'trashed' ? 'The document is in the Trash, so it can’t be signed.' : 'The document was deleted, so it can’t be signed.'}</div>}

      <ol className="signer-list">
        {[...r.signers].sort((a, b) => a.order - b.order).map((s) => {
          const Icon = SIGNER_ICON[s.status] || Clock;
          const when = s.signedAt || s.declinedAt || s.viewedAt || s.sentAt;
          const user = s.userId ? state.users.find((u) => u.id === s.userId) : null;
          return (
            <li key={s.id} className={`sg-${s.status}`}>
              {user ? <Avatar user={user} size={24} /> : <span className="sg-dot" style={{ background: s.color }}>{initialsOf(s.name).slice(0, 2)}</span>}
              <span className="min0 grow">
                <span className="truncate block">{r.sequential && <span className="muted">{s.order}. </span>}{s.userId === state.meId ? 'You' : s.name} <span className="muted small">· {s.email}</span></span>
                <span className="muted small block">{SIGNER_STATUS[s.status].label}{when && s.status !== 'waiting' ? ` ${formatDate(when)}` : ''}</span>
                {s.reason && <span className="small block sg-reason">“{s.reason}”</span>}
              </span>
              {mine && open && (s.status === 'sent' || s.status === 'viewed') && s.userId !== state.meId && (
                <span className="row-actions show">
                  <button className="icon-btn sm" onClick={() => copy(s)} aria-label={`Copy signing link for ${s.name}`} data-tip="Copy signing link"><Link2 size={14} /></button>
                  <a className="icon-btn sm" href={`/sign/${r.id}/${s.id}`} target="_blank" rel="noreferrer" aria-label={`Open the signing page as ${s.name}`} data-tip="Open signing page"><ExternalLink size={14} /></a>
                </span>
              )}
              <Icon size={16} className="dec-icon" />
            </li>
          );
        })}
      </ol>
      {r.signers.length > 1 && <div className="muted small">{signedN} of {r.signers.length} signed</div>}

      <div className="btn-row">
        {mySigner && <button className="btn btn-primary btn-sm" onClick={() => ui.openDialog('signDocument', { requestId: r.id, signerId: mySigner.id })}><PenTool size={14} /> Sign now</button>}
        {st === 'signed' && (
          <>
            <button className="btn btn-secondary btn-sm" onClick={download} disabled={downloading} aria-busy={downloading}>{downloading ? <Loader2 size={14} className="spin" /> : <Download size={14} />} {downloading ? 'Preparing…' : 'Download signed copy'}</button>
            {r.signedFileId && state.items[r.signedFileId] && !state.items[r.signedFileId].trashed && (
              <button className="btn btn-ghost btn-sm" onClick={() => actions.open(state.items[r.signedFileId], [r.signedFileId])}><FileCheck2 size={14} /> Open</button>
            )}
          </>
        )}
        {mine && open && (
          <>
            <button className="btn btn-secondary btn-sm" onClick={() => { api.remindSigners(r.id); ui.toast('Reminder sent', { type: 'success' }); }}><BellRing size={14} /> Remind</button>
            <button className="btn btn-ghost btn-sm" onClick={cancel}><Ban size={14} /> Cancel request</button>
          </>
        )}
        <span className="grow" />
        <button className="link-btn" onClick={() => setHistory(!history)} aria-expanded={history}><History size={13} /> History</button>
      </div>
      {history && (
        <ol className="sign-history">
          {(r.events || []).slice().reverse().map((e, i) => (
            <li key={i}><span className="muted small">{formatDateTime(e.at)}</span> <span className="small">{e.signerId ? <strong>{signerName(e.signerId)}</strong> : e.by ? <strong>{nameOfUser(state, e.by)}</strong> : null} {eventText(e).toLowerCase()}{e.detail ? ` · ${e.detail}` : ''}</span></li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Details-panel section for a PDF: its signature requests and a shortcut to send one. */
export function SignSection({ item }) {
  const { state } = useDrive();
  const ui = useUI();
  if (item.type !== 'file' || item.ext !== 'pdf') return null;
  const list = signRequestsFor(state, item.id);
  const canSend = canEdit(accessOf(state, item)) && !item.trashed;
  if (!list.length && !canSend) return null;
  return (
    <div className="details-section">
      <div className="details-section-head">
        <span>Signatures</span>
        {canSend && <button className="link-btn" onClick={() => ui.openDialog('signRequest', { itemId: item.id })}><PenTool size={13} /> Request signature</button>}
      </div>
      {list.slice(0, 2).map((r) => <SignRequestCard key={r.id} r={r} showItem={false} compact />)}
      {list.length > 2 && <Link className="link-btn" to="/signatures?tab=all">See all {list.length} requests</Link>}
      {!list.length && <div className="muted small">Send this PDF to one or more people to sign.</div>}
    </div>
  );
}
