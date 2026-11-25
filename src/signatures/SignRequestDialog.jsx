import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PenTool, Plus, Trash2, ArrowUp, ArrowDown, UserPlus, Wand2, MousePointerClick, Check, AlertTriangle } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { fileBlob } from '../store/useItemActions';
import { uid, toDateInput, fromDateInput } from '../utils/format';
import { Modal } from '../components/common';
import { PdfPages, usePdfDocument } from '../viewing/PdfPages';
import { FIELD_KINDS, SIGNER_COLORS, isEmail } from './signing';
import { FieldBox } from './SignUI';
import { sharingPolicyBlock, domainOf } from '../sharing/guests';
import { checkShare, summarize } from '../dlp/dlp';

const STEPS = ['Recipients', 'Place fields', 'Review & send'];
const blankSigner = () => ({ key: uid('s'), userId: null, name: '', email: '', external: true });

export default function SignRequestDialog({ itemId, onClose }) {
  const { state, api, blobsVersion } = useDrive();
  const ui = useUI();
  const navigate = useNavigate();
  const item = state.items[itemId];
  const [step, setStep] = useState(0);
  const [signers, setSigners] = useState([blankSigner()]);
  const [sequential, setSequential] = useState(false);
  const [fields, setFields] = useState([]);
  const [active, setActive] = useState(0);
  // Nothing is armed at first, and the field type disarms after each placement, so stray taps don't drop fields.
  const [armed, setArmed] = useState(null);
  const [selected, setSelected] = useState(null);
  const [title, setTitle] = useState(`Please sign: ${item?.name.replace(/\.pdf$/i, '') || ''}`);
  const [message, setMessage] = useState('');
  const [due, setDue] = useState(toDateInput(Date.now() + 7 * 86400000));
  const [tried, setTried] = useState(false);
  // blobsVersion: reload when saved file bytes finish loading (large uploads after a reload / in a new tab).
  const pdf = usePdfDocument(() => fileBlob(item), `${itemId}@${item?.version || 1}@${blobsVersion}`);
  const noBytes = !!pdf.error && /aren.t available in this browser/i.test(pdf.error);

  const people = useMemo(() => state.users.filter((u) => u.status !== 'disabled'), [state.users]);
  const colorOf = (i) => SIGNER_COLORS[i % SIGNER_COLORS.length];

  /* ---------- recipients ---------- */
  const setSigner = (i, patch) => setSigners((l) => l.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const pickPerson = (i, value) => {
    if (value === '__ext') setSigner(i, { userId: null, external: true, name: '', email: '' });
    else { const u = people.find((x) => x.id === value); if (u) setSigner(i, { userId: u.id, external: false, name: u.name, email: u.email }); }
  };
  const addMe = () => {
    const me = people.find((u) => u.id === state.meId);
    if (signers.some((s) => s.userId === state.meId)) return;
    const blankIdx = signers.findIndex((s) => !s.name && !s.email);
    const entry = { key: uid('s'), userId: me.id, name: me.name, email: me.email, external: false };
    setSigners((l) => (blankIdx >= 0 ? l.map((s, j) => (j === blankIdx ? entry : s)) : [...l, entry]));
  };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= signers.length) return;
    setSigners((l) => { const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    // Fields follow their signer.
    setFields((fs) => fs.map((f) => ({ ...f, signerIndex: f.signerIndex === i ? j : f.signerIndex === j ? i : f.signerIndex })));
  };
  const remove = (i) => {
    setSigners((l) => l.filter((_, j) => j !== i));
    setFields((fs) => fs.filter((f) => f.signerIndex !== i).map((f) => ({ ...f, signerIndex: f.signerIndex > i ? f.signerIndex - 1 : f.signerIndex })));
    setActive(0);
  };
  const emails = signers.map((s) => s.email.trim().toLowerCase());
  const signerError = (s, i) => {
    if (!s.name.trim()) return 'Enter a name';
    if (!isEmail(s.email.trim())) return 'Enter a valid email address';
    if (emails.indexOf(emails[i]) !== i) return 'This person is already a signer';
    // Signers outside the organization get the document, so the admin's sharing policy applies to them too.
    return sharingPolicyBlock(state, s.email.trim());
  };
  const recipientsOk = signers.length > 0 && signers.every((s, i) => !signerError(s, i));

  /* ---------- fields ---------- */
  const place = (page, nx, ny) => {
    if (!armed) { setSelected(null); return; }
    const size = pdf.sizes?.[page - 1] || { w: 612, h: 792 };
    const k = FIELD_KINDS[armed];
    const fw = k.w; const fh = k.h * (size.w / size.h);
    const f = { key: uid('f'), signerIndex: active, kind: armed, page, x: Math.max(0, Math.min(1 - fw, nx - fw / 2)), y: Math.max(0, Math.min(1 - fh, ny - fh / 2)), w: fw, h: fh };
    setFields((l) => [...l, f]);
    setSelected(f.key);
    setArmed(null);
  };
  /** One-click "signature block": signature + date (and name) for the active signer at the end of the last page. */
  const autoPlace = () => {
    if (!pdf.sizes) return;
    const page = pdf.sizes.length;
    const size = pdf.sizes[page - 1];
    const ratio = size.w / size.h;
    const used = fields.filter((f) => f.page === page).reduce((m, f) => Math.max(m, f.y + f.h), 0.62);
    const y = Math.min(0.9, used + 0.03);
    const sigH = FIELD_KINDS.signature.h * ratio; const lineH = FIELD_KINDS.date.h * ratio;
    const add = [
      { kind: 'signature', x: 0.08, y, w: FIELD_KINDS.signature.w, h: sigH },
      { kind: 'name', x: 0.4, y: y + sigH - lineH, w: FIELD_KINDS.name.w, h: lineH },
      { kind: 'date', x: 0.68, y: y + sigH - lineH, w: FIELD_KINDS.date.w, h: lineH },
    ].map((f) => ({ ...f, key: uid('f'), signerIndex: active, page }));
    setFields((l) => [...l, ...add]);
    setTimeout(() => document.querySelector(`.sign-compose [data-page="${page}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
  };
  const missingSig = signers.map((_, i) => !fields.some((f) => f.signerIndex === i && f.kind === 'signature'));
  const fieldsOk = !missingSig.some(Boolean);

  const isExternal = (s) => domainOf(s.email.trim()) !== String(state.org.domain || '').toLowerCase();
  /** Sending to people outside the organization goes through the same sensitive-data check as sharing. */
  const send = () => {
    if (!signers.some(isExternal)) { doSend(); return; }
    const verdict = checkShare(state, item, 'external');
    if (verdict.decision === 'allow') { doSend(); return; }
    const found = summarize(verdict.files[0].findings, 2);
    if (verdict.decision === 'block') {
      api.logEvent('Signature request blocked (DLP)', item.name, `External signer · ${found}`, { itemId: item.id });
      ui.toast(`Can't send to people outside the organization: this file contains sensitive data (${found})`, { type: 'error', duration: 7000 });
      return;
    }
    ui.pushDialog('confirm', {
      title: 'Send sensitive data outside the organization?',
      message: `This file contains ${found}. People outside the organization will be able to open it.`,
      confirmLabel: 'Send anyway', danger: true,
      onConfirm: () => {
        api.logEvent('DLP warning overridden', item.name, `Signature request to external signer · ${found}`, { itemId: item.id });
        setTimeout(doSend, 0); // after the confirmation closes, so this dialog is the one that closes
      },
    });
  };
  const doSend = () => {
    const id = api.createSignRequest({
      itemId, title, message, sequential, due: fromDateInput(due),
      signers: signers.map((s) => ({ userId: s.userId, name: s.name, email: s.email })),
      fields: fields.map(({ signerIndex, kind, page, x, y, w, h }) => ({ signerIndex, kind, page, x, y, w, h })),
    });
    onClose();
    const meFirst = signers.findIndex((s) => s.userId === state.meId);
    const myTurn = meFirst >= 0 && (!sequential || meFirst === 0);
    ui.toast(`Sent to ${signers.length} ${signers.length === 1 ? 'person' : 'people'} for signing`, {
      type: 'success',
      action: myTurn
        ? { label: 'Sign now', onClick: () => { const r = api.get().signRequests.find((x) => x.id === id); const me = r?.signers.find((s) => s.userId === state.meId); if (me) ui.openDialog('signDocument', { requestId: id, signerId: me.id }); } }
        : { label: 'Track', onClick: () => navigate('/signatures?tab=sent') },
    });
  };

  const next = () => {
    setTried(true);
    if (step === 0 && !recipientsOk) return;
    if (step === 1 && (!fieldsOk || pdf.error)) return;
    setTried(false);
    if (step < 2) setStep(step + 1); else send();
  };

  // Closing (X, Escape, backdrop) after something was entered asks before throwing it away.
  const dirty = fields.length > 0 || message.trim() !== '' || signers.some((s) => s.name.trim() || s.email.trim());
  const close = () => {
    if (!dirty) { onClose(); return; }
    ui.openDialog('confirm', {
      title: 'Discard this signature request?',
      message: 'The signers, fields and message you entered will be lost.',
      confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true, onConfirm: onClose,
    });
  };

  if (!item) return null;

  const missingNames = signers.filter((_, i) => missingSig[i]).map((s) => (s.userId === state.meId ? 'you' : s.name || 'unnamed signer'));
  const stepError = tried && step === 1 && !pdf.error && !fieldsOk
    ? `Each signer needs at least one signature field: ${missingNames.join(', ')}`
    : tried && step === 0 && !recipientsOk ? 'Fix the highlighted signers to continue.' : '';

  const footer = (
    <>
      <div className="sign-steps" aria-label="Steps">
        {STEPS.map((s, i) => <span key={s} className={`sign-step ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`}>{i < step ? <Check size={12} /> : i + 1} {s}</span>)}
      </div>
      <span className="grow" />
      {stepError && <span className="field-error sign-step-error" role="alert"><AlertTriangle size={13} /> {stepError}</span>}
      {step > 0 && <button className="btn btn-secondary" onClick={() => { setTried(false); setStep(step - 1); }}>Back</button>}
      {step === 1 && pdf.error
        ? <button className="btn btn-secondary" onClick={onClose}>Close</button>
        : <button className="btn btn-primary" onClick={next}>{step < 2 ? 'Next' : <><PenTool size={15} /> Send for signing</>}</button>}
    </>
  );

  return (
    <Modal title="Request signatures" subtitle={item.name} onClose={close} width={step === 1 ? 1180 : 720} className={`sign-compose step-${step}`} icon={<PenTool size={18} />} footer={footer}>
      {step === 0 && (
        <div className="sign-recipients">
          <p className="muted small">Add everyone who needs to sign. People outside your organization sign through a secure link — no account needed.</p>
          <ol className="recip-list">
            {signers.map((s, i) => {
              const err = tried ? signerError(s, i) : null;
              return (
                <li key={s.key} className="recip-row">
                  <span className="recip-color" style={{ background: colorOf(i) }}>{sequential ? i + 1 : ''}</span>
                  <select className="select" value={s.userId || (s.external ? '__ext' : '')} onChange={(e) => pickPerson(i, e.target.value)} aria-label={`Signer ${i + 1}`}>
                    <option value="__ext">Someone outside the directory…</option>
                    <optgroup label="People in your organization">
                      {people.map((u) => <option key={u.id} value={u.id}>{u.id === state.meId ? `${u.name} (me)` : u.name}</option>)}
                    </optgroup>
                  </select>
                  <input className="input" value={s.name} onChange={(e) => setSigner(i, { name: e.target.value })} placeholder="Full name" disabled={!s.external} aria-label="Name" />
                  <input className="input" value={s.email} onChange={(e) => setSigner(i, { email: e.target.value })} placeholder="Email address" type="email" disabled={!s.external} aria-label="Email" />
                  <span className="recip-actions">
                    <button className="icon-btn sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={14} /></button>
                    <button className="icon-btn sm" onClick={() => move(i, 1)} disabled={i === signers.length - 1} aria-label="Move down"><ArrowDown size={14} /></button>
                    <button className="icon-btn sm" onClick={() => remove(i)} disabled={signers.length === 1} aria-label="Remove signer"><Trash2 size={14} /></button>
                  </span>
                  {err && <span className="field-error recip-err">{err}</span>}
                </li>
              );
            })}
          </ol>
          <div className="btn-row">
            <button className="btn btn-secondary btn-sm" onClick={() => setSigners((l) => [...l, blankSigner()])} disabled={signers.length >= 6}><Plus size={14} /> Add signer</button>
            <button className="btn btn-ghost btn-sm" onClick={addMe} disabled={signers.some((s) => s.userId === state.meId)}><UserPlus size={14} /> Add me</button>
          </div>
          <label className="check-row"><input type="checkbox" checked={sequential} onChange={(e) => setSequential(e.target.checked)} /> Signers sign in the order listed <span className="muted small">(each person is asked only after the one before them signs)</span></label>
        </div>
      )}

      {step === 1 && pdf.error && (
        <div className="sign-load-error" role="alert">
          <AlertTriangle size={22} />
          <div>
            <strong>This PDF couldn't be opened, so signature fields can't be placed on it.</strong>
            <p className="small">{noBytes ? 'This file’s contents aren’t available in this browser. Open the request from the browser where the file was uploaded, or upload the file again.' : pdf.error}</p>
            <p className="muted small">Fields are positioned on the document's pages, so the pages have to load first. Go back to change the signers, or close and try again later.</p>
          </div>
        </div>
      )}
      {step === 1 && !pdf.error && (
        <div className="sign-place">
          <aside className="sign-palette">
            <div className="palette-label">Fields for</div>
            <div role="radiogroup" aria-label="Signer">
              {signers.map((s, i) => (
                <button key={s.key} role="radio" aria-checked={active === i} className={`palette-signer ${active === i ? 'on' : ''}`} onClick={() => { setActive(i); setSelected(null); }} style={{ '--sf': colorOf(i) }}>
                  <span className="recip-color" style={{ background: colorOf(i) }} />
                  <span className="min0 grow"><span className="truncate block">{s.userId === state.meId ? 'Me' : s.name}</span><span className="muted small">{fields.filter((f) => f.signerIndex === i).length} fields</span></span>
                  {tried && missingSig[i] && <span className="pill pill-red">No signature</span>}
                </button>
              ))}
            </div>
            <div className="palette-label">Choose a field, then click the page</div>
            <div className="palette-fields" role="radiogroup" aria-label="Field type">
              {Object.entries(FIELD_KINDS).map(([k, v]) => (
                <button key={k} role="radio" aria-checked={armed === k} className={`palette-field ${armed === k ? 'on' : ''}`} style={{ '--sf': colorOf(active) }} onClick={() => setArmed(armed === k ? null : k)}>
                  <MousePointerClick size={14} /> {v.label}
                </button>
              ))}
            </div>
            <button className="btn btn-secondary btn-sm full" onClick={autoPlace} disabled={!pdf.sizes}><Wand2 size={14} /> Add signature block</button>
            <p className="muted small">Adds signature, name and date for {signers[active]?.userId === state.meId ? 'you' : signers[active]?.name || 'this signer'} at the end of the document. Drag fields to move them; drag the corner to resize.</p>
          </aside>
          <div className={`sign-canvas ${armed ? 'armed' : ''}`}>
            <div className={`sign-place-hint ${armed ? 'on' : ''}`} aria-live="polite">
              <MousePointerClick size={14} /> {armed ? `Click the page to place a ${FIELD_KINDS[armed].label.toLowerCase()} field` : 'Choose a field type, then click the page to place it'}
            </div>
            <PdfPages pdf={pdf} maxWidth={760} onPageClick={place}
              overlay={(page, w, h) => fields.filter((f) => f.page === page).map((f) => (
                <FieldBox key={f.key} f={f} w={w} h={h} color={colorOf(f.signerIndex)} mode="compose" selected={selected === f.key}
                  label={`${signers[f.signerIndex]?.userId === state.meId ? 'Me' : signers[f.signerIndex]?.name.split(' ')[0] || 'Signer'} · ${FIELD_KINDS[f.kind].label}`}
                  onSelect={() => { setSelected(f.key); setActive(f.signerIndex); }}
                  onChange={(patch) => setFields((l) => l.map((x) => (x.key === f.key ? { ...x, ...patch } : x)))}
                  onDelete={() => { setFields((l) => l.filter((x) => x.key !== f.key)); setSelected(null); }} />
              ))} />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="sign-review">
          <label className="field"><span className="field-label">Subject</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label>
          <label className="field"><span className="field-label">Message <span className="muted">(optional)</span></span>
            <textarea className="input textarea" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Add a note for the signers" /></label>
          <label className="field"><span className="field-label">Sign by <span className="muted">(optional — the request expires after this date)</span></span>
            <input className="input" type="date" value={due} min={toDateInput(Date.now())} onChange={(e) => setDue(e.target.value)} style={{ maxWidth: 200 }} /></label>
          <div className="details-section">
            <div className="details-section-head"><span>{signers.length} signer{signers.length === 1 ? '' : 's'}{sequential ? ', in this order' : ''}</span></div>
            <ol className="signer-list">
              {signers.map((s, i) => (
                <li key={s.key}>
                  <span className="sg-dot" style={{ background: colorOf(i) }}>{i + 1}</span>
                  <span className="min0 grow"><span className="truncate block">{s.userId === state.meId ? `${s.name} (me)` : s.name}</span><span className="muted small">{s.email}</span></span>
                  <span className="muted small">{fields.filter((f) => f.signerIndex === i).map((f) => FIELD_KINDS[f.kind].label).join(', ')}</span>
                </li>
              ))}
            </ol>
          </div>
          <p className="muted small">Each signer gets a link to sign. You can track who has viewed and signed on the Signatures page; when everyone has signed, a signed copy with a certificate of completion is saved next to the original.</p>
        </div>
      )}
    </Modal>
  );
}
