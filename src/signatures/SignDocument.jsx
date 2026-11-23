import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, PenTool, CheckCircle2, XCircle, Hourglass, Ban, ArrowDown, Download, ShieldCheck, Clock, Trash2, FileX2, Loader2 } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { deviceLabel, sessionIp } from '../utils/sharing';
import { formatDateTime } from '../utils/format';
import { Modal } from '../components/common';
import { PdfPages, usePdfDocument } from '../viewing/PdfPages';
import { FIELD_KINDS, displayStatus, fmtSignDate, requestPdf, docGone, cancelReason } from './signing';
import { FieldBox, AdoptSignature, useSignedCopy } from './SignUI';

const isFilled = (v) => v != null && v !== '';
const NO_BYTES = 'This file’s contents aren’t available in this browser. Ask the sender to open the request from the browser where the file was uploaded.';
const coarsePointer = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/**
 * The signer's view: the document with their fields to fill. Works in the app (as a full-screen layer)
 * and on the public signing link. `onClose` is omitted on the public page.
 */
export function SignDocument({ requestId, signerId, onClose }) {
  const { state, api, blobsVersion } = useDrive();
  const ui = useUI();
  const signedCopy = useSignedCopy();
  const r = (state.signRequests || []).find((x) => x.id === requestId);
  const sg = r?.signers.find((x) => x.id === signerId);
  const gone = r ? docGone(state, r) : null;
  const myFields = useMemo(() => (r && sg ? r.fields.filter((f) => f.signerId === sg.id) : []), [r, sg]);
  // Someone signed in here who isn't this signer (the sender checking the page, or another colleague): show
  // the page read-only, and don't mark it viewed or record their device as the signer's.
  const viewerId = state.signedOut ? null : state.meId;
  const notSigner = !!r && !!sg && !!viewerId && (sg.userId ? viewerId !== sg.userId : viewerId === r.createdBy);
  // Reload when saved file bytes finish loading (blobsVersion), so a large upload isn't shown as missing.
  const pdf = usePdfDocument(() => requestPdf(api.get(), r), `${requestId}@${gone || ''}@${blobsVersion}`);

  const initialValues = () => Object.fromEntries(myFields.map((f) => [f.id, f.kind === 'date' ? fmtSignDate(Date.now()) : f.kind === 'name' ? sg.name : null]));
  const [values, setValues] = useState(initialValues);
  const [adopted, setAdopted] = useState({ signature: null, initials: null });
  const [adopting, setAdopting] = useState(null); // field kind being adopted
  const [finishing, setFinishing] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pulse, setPulse] = useState(null);
  const [, setTick] = useState(0); // re-render when the due date passes
  const scrollRef = useRef(null);

  // Opening the document marks it viewed (once).
  useEffect(() => {
    if (sg?.status === 'sent' && displayStatus(r) !== 'expired' && !gone && !notSigner) api.markSignViewed(r.id, sg.id, { device: deviceLabel(), ip: sessionIp() });
  }, [sg?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Expiry is derived from the clock: re-check it while the page is open.
  useEffect(() => {
    if (!r?.due) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [r?.due]);

  const st = r ? displayStatus(r) : null;
  const pdfMissing = !!pdf.error;
  const canSign = !!r && !!sg && (sg.status === 'sent' || sg.status === 'viewed') && ['sent', 'viewed'].includes(r.status) && st !== 'expired' && !gone && !notSigner;
  // Something the signer entered that closing would throw away.
  const dirty = canSign && (!!adopted.signature || !!adopted.initials || myFields.some((f) => f.kind !== 'date' && f.kind !== 'name' && isFilled(values[f.id])));

  // Leaving the public page (closing the tab) with unsaved work asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const close = onClose && (() => {
    if (!dirty) { onClose(); return; }
    ui.openDialog('confirm', {
      title: 'Leave without signing?',
      message: 'Your signature and the fields you filled in will be discarded. The document stays unsigned until you finish.',
      confirmLabel: 'Discard and close', cancelLabel: 'Keep signing', danger: true, onConfirm: onClose,
    });
  });

  if (!r || !sg) return <Shell onClose={onClose}><Status icon={Ban} title="This signing link isn't valid" text="The request may have been deleted, or the link is incomplete." /></Shell>;

  const required = myFields.length;
  const filled = myFields.filter((f) => isFilled(values[f.id])).length;
  const left = required - filled;
  const done = left === 0;

  const fill = (f) => {
    if (f.kind === 'signature' || f.kind === 'initials') {
      if (adopted[f.kind] && !isFilled(values[f.id])) setValues((v) => ({ ...v, [f.id]: adopted[f.kind] }));
      else setAdopting(f.kind);
    }
  };
  const adopt = (value) => {
    const kind = adopting;
    setAdopted((a) => ({ ...a, [kind]: value }));
    // Every field of this kind takes the adopted mark.
    setValues((v) => ({ ...v, ...Object.fromEntries(myFields.filter((f) => f.kind === kind).map((f) => [f.id, value])) }));
    setAdopting(null);
  };
  const nextField = () => {
    const f = myFields.find((x) => !isFilled(values[x.id])) || myFields[0];
    if (!f) return;
    const el = scrollRef.current?.querySelector(`[data-field="${f.id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else scrollRef.current?.querySelector(`[data-page="${f.page}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPulse(f.id);
    setTimeout(() => setPulse(null), 1600);
  };

  /** Why the request can't be completed right now (checked again when Finish is clicked). */
  const blocker = () => {
    const now = api.get();
    const cur = (now.signRequests || []).find((x) => x.id === r.id);
    if (!cur) return 'This request no longer exists.';
    if (docGone(now, cur) === 'trashed') return 'The document was moved to Trash, so it can no longer be signed.';
    if (docGone(now, cur)) return 'The document was deleted, so it can no longer be signed.';
    if (cur.due && cur.due < Date.now()) return 'This request expired while you were signing. Ask the sender to send it again.';
    if (cur.status === 'cancelled') return 'The sender cancelled this request while you were signing.';
    return null;
  };
  const startFinish = () => {
    const why = blocker();
    if (why) { setTick((n) => n + 1); ui.toast(why, { type: 'error', duration: 6000 }); return; }
    setFinishing(true);
  };

  const finish = async () => {
    const why = blocker();
    if (why) { setFinishing(false); setTick((n) => n + 1); ui.toast(why, { type: 'error', duration: 6000 }); return; }
    setBusy(true);
    const nr = api.completeSigner(r.id, sg.id, values, { device: deviceLabel(), ip: sessionIp() });
    setFinishing(false);
    if (!nr) {
      setBusy(false); setTick((n) => n + 1);
      ui.toast(blocker() || 'This request can no longer be signed.', { type: 'error', duration: 6000 });
      return;
    }
    if (nr.status === 'signed') await signedCopy(nr, { silent: true });
    setBusy(false);
    ui.toast(nr.status === 'signed' ? 'Signed. Everyone has now signed — the signed copy is ready.' : 'Signed. The others will be notified.', { type: 'success', duration: 5000 });
  };
  const download = async () => {
    setDownloading(true);
    try { await signedCopy(r, { download: true, silent: true }); } finally { setDownloading(false); }
  };

  const signWord = coarsePointer() ? 'Tap to sign' : 'Sign';
  const overlay = (page, w, h) => r.fields.filter((f) => f.page === page).map((f) => {
    const owner = r.signers.find((s) => s.id === f.signerId);
    const minePending = f.signerId === sg.id && canSign;
    if (minePending) {
      const ff = { ...f, value: values[f.id] };
      if (f.kind === 'text') {
        return (
          <FieldBox key={f.id} f={ff} w={w} h={h} color={owner.color} mode="sign" highlight={pulse === f.id} filled={isFilled(values[f.id])}>
            <input className="sf-input" value={values[f.id] || ''} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))} onClick={(e) => e.stopPropagation()} placeholder="Type here" aria-label={`Text field ${myFields.filter((x) => x.kind === 'text').indexOf(f) + 1}`} style={{ fontSize: Math.max(10, f.h * h * 0.5) }} />
          </FieldBox>
        );
      }
      const label = f.kind === 'signature' ? signWord : f.kind === 'initials' ? (coarsePointer() ? 'Tap to initial' : 'Initial') : FIELD_KINDS[f.kind].label;
      return <FieldBox key={f.id} f={ff} w={w} h={h} color={owner.color} mode="sign" highlight={pulse === f.id} label={label} onActivate={() => fill(f)} />;
    }
    // Other signers' fields: their value once signed, otherwise a faint placeholder.
    return <FieldBox key={f.id} f={f} w={w} h={h} color={owner?.color || '#94A3B8'} mode="view" label={`${owner?.name || 'Signer'} · ${FIELD_KINDS[f.kind].label}`} />;
  });

  const item = state.items[r.itemId];
  const signedDownload = r.status === 'signed'
    ? <button className="btn btn-primary btn-sm" onClick={download} disabled={downloading} aria-busy={downloading}>{downloading ? <Loader2 size={14} className="spin" /> : <Download size={14} />} {downloading ? 'Preparing…' : 'Download signed copy'}</button>
    : null;
  let banner = null;
  if (gone) {
    banner = gone === 'trashed'
      ? <Status icon={Trash2} title="The document was moved to Trash" text="It can no longer be viewed or signed here. Ask the sender to restore it or send a new request." action={signedDownload} />
      : <Status icon={FileX2} title="The document was deleted" text="It can no longer be viewed or signed. Ask the sender to send a new request." action={signedDownload} />;
  } else if (r.status === 'cancelled') {
    const why = cancelReason(r);
    banner = <Status icon={Ban} title="This request was cancelled" text={why ? `${why.replace(/\.$/, '')}. It can no longer be signed.` : 'The sender cancelled it, so it can no longer be signed.'} />;
  } else if (st === 'expired' && sg.status !== 'signed') banner = <Status icon={Clock} title="This request has expired" text={`It had to be signed by ${formatDateTime(r.due)}. Ask the sender to send it again.`} />;
  else if (sg.status === 'declined') banner = <Status icon={XCircle} title="You declined to sign" text={sg.reason ? `Your reason: “${sg.reason}”` : ''} />;
  else if (r.status === 'declined') banner = <Status icon={XCircle} title="Another signer declined" text="This request is closed, so it can no longer be signed." />;
  else if (sg.status === 'waiting') {
    const before = r.signers.filter((s) => s.order < sg.order && s.status !== 'signed').map((s) => s.name).join(', ');
    banner = <Status icon={Hourglass} title="It's not your turn yet" text={`This document is signed in order. You'll be able to sign after ${before || 'the previous signers'}.`} />;
  } else if (sg.status === 'signed') {
    banner = (
      <Status icon={CheckCircle2} tone="ok" title={r.status === 'signed' ? 'Everyone has signed' : "You've signed this document"}
        text={r.status === 'signed' ? 'The signed copy, with a certificate of completion, is ready.' : `Signed ${formatDateTime(sg.signedAt)}. Waiting for ${r.signers.filter((s) => s.status !== 'signed').map((s) => s.name).join(', ')}.`}
        action={signedDownload} />
    );
  }
  if (!gone && pdfMissing) {
    const noBytes = /aren.t available in this browser/i.test(pdf.error);
    banner = (
      <>
        {banner}
        <Status icon={FileX2} title="The document can't be shown" text={noBytes ? NO_BYTES : `${pdf.error}${canSign ? ' Until it can be opened, it can’t be signed.' : ''}`} />
      </>
    );
  }

  const signable = canSign && !pdfMissing && !!pdf.sizes;
  const finishWhy = !signable ? '' : left > 0 ? `Fill ${left} more required field${left === 1 ? '' : 's'}` : '';

  return (
    <Shell onClose={close}
      head={(
        <>
          <div className="min0 grow">
            <div className="truncate strong">{r.title}</div>
            <div className="sign-sub truncate">{item?.name} · Signing as <strong>{sg.name}</strong> ({sg.email})</div>
          </div>
          {canSign && !pdfMissing && (
            <>
              <span className="sign-progress" aria-live="polite" title={`${filled} of ${required} fields filled`}>{filled} of {required}<span className="sign-progress-unit"> field{required === 1 ? '' : 's'}</span></span>
              <button className="btn btn-ghost-dark hide-xs" onClick={nextField}><ArrowDown size={15} /> Next field</button>
              <button className="btn btn-ghost-dark" onClick={() => setDeclining(true)}>Decline</button>
              <button className="btn btn-primary" disabled={!done || busy || !signable} onClick={startFinish} title={finishWhy || undefined} aria-describedby={finishWhy ? 'sign-finish-why' : undefined}><PenTool size={15} /> {busy ? 'Finishing…' : 'Finish'}</button>
            </>
          )}
          {canSign && pdfMissing && <button className="btn btn-ghost-dark" onClick={() => setDeclining(true)}>Decline</button>}
        </>
      )}>
      {notSigner && <div className="sign-message" role="status"><strong>Preview only.</strong> You're signed in as {state.users.find((u) => u.id === viewerId)?.name || 'someone else'}; only {sg.name} can sign here.</div>}
      {r.message && canSign && !pdfMissing && <div className="sign-message"><strong>Message from the sender:</strong> {r.message}</div>}
      {finishWhy && <div id="sign-finish-why" className="sign-finish-why hide-xs" aria-live="polite">{finishWhy} to finish.</div>}
      {banner}
      {!gone && !pdfMissing && (
        <div className="sign-doc" ref={scrollRef}>
          <PdfPages pdf={pdf} overlay={overlay} maxWidth={860} />
        </div>
      )}
      {signable && (
        <div className="sign-mobilebar" role="toolbar" aria-label="Signing">
          <span className="sign-mobilebar-why">{finishWhy || 'All fields filled. Tap Finish to sign.'}</span>
          <button className="btn btn-secondary btn-sm" onClick={nextField}><ArrowDown size={15} /> Next field</button>
        </div>
      )}

      {adopting && <AdoptSignature kind={adopting} name={sg.name} onAdopt={adopt} onClose={() => setAdopting(null)} />}
      {finishing && (
        <Modal title="Finish signing?" onClose={() => setFinishing(false)} width={460} icon={<ShieldCheck size={18} />}
          footer={<><button className="btn btn-secondary" onClick={() => setFinishing(false)}>Review again</button><button className="btn btn-primary" onClick={finish} disabled={busy}>Sign document</button></>}>
          <p>You're signing <strong>{item?.name}</strong> as <strong>{sg.name}</strong>. Your signature, the time, this device ({deviceLabel()}) and the network address are recorded in the document's certificate.</p>
          <p className="muted small">After you sign you can't change your fields.</p>
        </Modal>
      )}
      {declining && <DeclineDialog onClose={() => setDeclining(false)} onDecline={(reason) => {
        setDeclining(false);
        const why = blocker();
        if (why) { setTick((n) => n + 1); ui.toast(why, { type: 'error', duration: 6000 }); return; }
        api.declineSigner(r.id, sg.id, reason);
        ui.toast('You declined to sign. The sender has been told.', { type: 'success' });
      }} />}
    </Shell>
  );
}

function DeclineDialog({ onClose, onDecline }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Decline to sign?" subtitle="The sender will see your reason, and the request will be closed for everyone." onClose={onClose} width={480} icon={<XCircle size={18} />}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-danger" disabled={!reason.trim()} onClick={() => onDecline(reason)}>Decline</button></>}>
      <label className="field"><span className="field-label">Reason (required)</span>
        <textarea className="input textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The payment terms need to change first." /></label>
    </Modal>
  );
}

function Status({ icon: Icon, title, text, action, tone }) {
  return (
    <div className={`sign-status ${tone === 'ok' ? 'ok' : ''}`} role="status">
      <Icon size={20} />
      <div className="min0 grow"><strong>{title}</strong>{text && <div className="small">{text}</div>}</div>
      {action}
    </div>
  );
}

function Shell({ onClose, head, children }) {
  const body = (
    <div className={`sign-shell ${onClose ? 'overlay' : 'page'}`} role={onClose ? 'dialog' : undefined} aria-modal={onClose ? 'true' : undefined} aria-label="Sign document">
      <header className="preview-bar sign-bar">
        {onClose && <button className="icon-btn on-dark" onClick={onClose} aria-label="Close" data-tip="Close"><X size={20} /></button>}
        <PenTool size={20} className="sign-bar-icon" />
        {head || <div className="grow strong">Sign document</div>}
      </header>
      <div className="sign-body">{children}</div>
    </div>
  );
  return onClose ? createPortal(body, document.body) : body;
}

/** In-app dialog wrapper. */
export function SignDocumentDialog({ requestId, signerId, onClose }) {
  useEffect(() => {
    // Escape goes through the same close path as the X button (which asks first when something is filled).
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) document.querySelector('.sign-shell.overlay .sign-bar .icon-btn')?.click(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <SignDocument requestId={requestId} signerId={signerId} onClose={onClose} />;
}
