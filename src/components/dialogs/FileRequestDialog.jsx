import { useMemo, useState } from 'react';
import { Inbox, Copy, CheckCircle2, QrCode, Eye, EyeOff } from 'lucide-react';
import { useDrive } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { writableFolders } from '../../store/selectors';
import { toDateInput, fromDateInput } from '../../utils/format';
import { requestUrl } from '../../utils/sharing';
import { hashSecret } from '../../data/storage/secrets';
import { Modal, Switch } from '../common';

/** Create an upload-only link into a folder. Without folderId, the user picks the folder. */
export default function FileRequestDialog({ folderId, onClose }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const { toast } = ui;
  const folders = useMemo(() => writableFolders(state).filter((f) => f.id), [state]);
  const [target, setTarget] = useState(folderId || folders[0]?.id || '');
  const folder = state.items[target];
  const [title, setTitle] = useState(folder ? `Files for ${folder.name}` : '');
  const [message, setMessage] = useState('');
  const [expires, setExpires] = useState(toDateInput(Date.now() + 14 * 86400000));
  const [usePwd, setUsePwd] = useState(false);
  const [pwd, setPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [requireIdentity, setRequireIdentity] = useState(true);
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  const err = !state.org.policies.fileRequests ? 'File requests are turned off by your administrator'
    : !folder ? 'Choose a folder' : !title.trim() ? 'Give the request a title' : usePwd && pwd.length < 4 ? 'Password must be at least 4 characters' : null;

  const copy = async (url) => {
    try { await navigator.clipboard.writeText(url); toast('Upload link copied', { type: 'success' }); } catch { toast(url, { type: 'info', duration: 8000 }); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (err || busy) return;
    setBusy(true);
    try {
      // Only a PBKDF2 digest of the password is stored.
      const secretHash = usePwd ? await hashSecret(pwd) : null;
      const id = api.createFileRequest({
        folderId: target, title, message, requireIdentity,
        expires: fromDateInput(expires),
        secretHash,
      });
      setCreated(id);
    } catch (ex) {
      toast(ex?.message || 'Could not create the request', { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    const url = requestUrl(created);
    return (
      <Modal title="File request created" onClose={onClose} width={500} icon={<CheckCircle2 size={20} />}
        footer={<><a className="btn btn-secondary" href={url} target="_blank" rel="noreferrer">Open upload page</a><button className="btn btn-primary" onClick={onClose}>Done</button></>}>
        <p className="muted">Send this link to anyone. They can upload into <strong>{folder?.name}</strong> without seeing its contents{usePwd ? ', after entering the password you set' : ''}.</p>
        <div className="link-url">
          <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Upload link" />
          <button className="btn btn-secondary" onClick={() => copy(url)}><Copy size={14} /> Copy</button>
        </div>
        <button className="btn btn-secondary btn-sm qr-inline" onClick={() => ui.openDialog('linkTools', { requestId: created })}><QrCode size={14} /> Get a QR code</button>
      </Modal>
    );
  }

  return (
    <Modal title="Request files" subtitle="Collect files from anyone, even without a WorkDrive account" onClose={onClose} width={520} icon={<Inbox size={20} />}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" form="fr-form" disabled={!!err || busy}>{busy ? 'Creating…' : 'Create link'}</button></>}>
      <form id="fr-form" className="form" onSubmit={submit}>
        {!folderId ? (
          <label className="field"><span className="field-label">Upload into</span>
            <select className="select full" value={target} onChange={(e) => { setTarget(e.target.value); if (!title.trim() || title.startsWith('Files for ')) setTitle(`Files for ${state.items[e.target.value]?.name}`); }}>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
            </select>
          </label>
        ) : <div className="muted small">Uploads go to <strong>{folder?.name}</strong>.</div>}
        <label className="field"><span className="field-label">Title</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></label>
        <label className="field"><span className="field-label">Instructions <span className="muted">(optional)</span></span>
          <textarea className="input textarea" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Please upload signed contracts as PDF." />
        </label>
        <div className="form-grid">
          <label className="field"><span className="field-label">Closes on</span>
            <input className="input" type="date" value={expires} min={toDateInput(Date.now())} onChange={(e) => setExpires(e.target.value)} />
          </label>
          <div className="field"><span className="field-label">Ask for name and email</span><Switch checked={requireIdentity} onChange={setRequireIdentity} label="Ask for name and email" /></div>
        </div>
        <div className="field">
          <div className="row-between"><span className="field-label">Password protect</span><Switch checked={usePwd} onChange={setUsePwd} label="Password protect" /></div>
          {usePwd && (
            <span className="pwd-field">
              <input className="input" type={showPwd ? 'text' : 'password'} value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Password uploaders must enter" autoComplete="new-password" aria-label="Upload page password" />
              <button type="button" className="icon-btn sm" onClick={() => setShowPwd(!showPwd)} aria-label={showPwd ? 'Hide password' : 'Show password'} aria-pressed={showPwd}>{showPwd ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </span>
          )}
        </div>
        {err && (title || usePwd) && <span className="field-error">{err}</span>}
      </form>
    </Modal>
  );
}
