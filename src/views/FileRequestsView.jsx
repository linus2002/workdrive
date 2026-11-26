import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Plus, Copy, QrCode, ExternalLink, Trash2, ChevronDown, ChevronRight, KeyRound, CalendarClock, UserRound } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { folderRoute, locationOf, isTrashedDeep } from '../store/selectors';
import { formatDate, formatDateTime, toDateInput, fromDateInput } from '../utils/format';
import { requestStatus, requestUrl } from '../utils/sharing';
import PageHeader from '../components/layout/PageHeader';
import { EmptyState, Switch, FileIcon } from '../components/common';

const STATUS = { active: ['Open', 'pill-green'], expired: ['Expired', 'pill-gray'], closed: ['Closed', 'pill-amber'] };

export default function FileRequestsView() {
  const { state, api } = useDrive();
  const ui = useUI();
  const [open, setOpen] = useState(null);
  // Changing when a request closes (also how an expired request is reopened).
  const [dateEdit, setDateEdit] = useState(null); // null | { id, value: 'YYYY-MM-DD', error }
  const saveDate = (e, r, clear = false) => {
    e?.preventDefault();
    const expires = clear ? null : fromDateInput(dateEdit.value);
    if (!clear && (!expires || expires < Date.now())) { setDateEdit({ ...dateEdit, error: 'Choose today or a later date' }); return; }
    const wasExpired = r.expires && r.expires < Date.now();
    api.updateFileRequest(r.id, { expires, ...(wasExpired ? { enabled: true } : {}) });
    api.logEvent('File request updated', r.title, expires ? `Closes ${formatDate(expires)}` : 'No closing date');
    ui.toast(expires ? `“${r.title}” now closes ${formatDate(expires)}${wasExpired ? ' and is open again' : ''}` : `“${r.title}” no longer closes automatically`, { type: 'success' });
    setDateEdit(null);
  };
  const requests = (state.fileRequests || []).filter((r) => r.createdBy === state.meId).sort((a, b) => b.createdAt - a.createdAt);
  const disabled = !state.org.policies.fileRequests;

  const copy = async (r) => {
    try { await navigator.clipboard.writeText(requestUrl(r.id)); ui.toast('Upload link copied', { type: 'success' }); } catch { ui.toast(requestUrl(r.id), { type: 'info', duration: 8000 }); }
  };
  const remove = (r) => ui.openDialog('confirm', {
    title: `Delete “${r.title}”?`, message: 'The upload link stops working. Files already received stay in the folder.', confirmLabel: 'Delete request', danger: true,
    onConfirm: () => { api.deleteFileRequest(r.id); ui.toast('File request deleted', { type: 'success' }); },
  });

  return (
    <div className="page">
      <PageHeader title="File Requests" subtitle="Upload-only links that let anyone send files into your folders."
        actions={<button className="btn btn-primary" onClick={() => ui.openDialog('fileRequest', {})} disabled={disabled}><Plus size={16} /> New request</button>} />
      <div className="page-scroll">
        {disabled && <div className="banner warning">Your administrator has turned off file requests. Existing links no longer accept uploads.</div>}
        {!requests.length ? (
          <EmptyState icon={Inbox} title="No file requests yet" text="Create a request, share the link, and uploads land straight in the folder you choose."
            action={<button className="btn btn-primary" onClick={() => ui.openDialog('fileRequest', {})} disabled={disabled}><Plus size={16} /> New request</button>} />
        ) : (
          <div className="request-list">
            {requests.map((r) => {
              const folder = state.items[r.folderId];
              const gone = !folder || isTrashedDeep(state.items, folder.id);
              const st = gone ? 'closed' : requestStatus(r, Date.now(), state); // closed while the admin has file requests turned off
              const files = r.uploads.reduce((n, u) => n + u.fileNames.length, 0);
              const expanded = open === r.id;
              return (
                <div key={r.id} className="request-item">
                  <div className="request-row">
                    <button className="icon-btn" onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded} aria-label={expanded ? 'Hide uploads' : 'Show uploads'}>
                      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <span className="request-ic"><Inbox size={18} /></span>
                    <div className="grow min0">
                      <div className="strong truncate">{r.title}</div>
                      <div className="muted small truncate">
                        {gone ? 'Folder deleted' : <Link to={folderRoute(folder)} className="cell-loc-link">{locationOf(state, folder)}</Link>}
                        {' · '}{files} file{files === 1 ? '' : 's'} received
                        {r.expires && <> · <CalendarClock size={12} /> {st === 'expired' ? 'closed' : 'closes'} {formatDate(r.expires)}</>}
                        {(r.secretHash || r.secret) && <> · <KeyRound size={12} /> password</>}
                      </div>
                    </div>
                    <span className={`pill ${STATUS[st][1]}`}>{STATUS[st][0]}</span>
                    <Switch checked={r.enabled && st !== 'expired'} onChange={(v) => { api.updateFileRequest(r.id, { enabled: v }); ui.toast(v ? 'Request reopened' : 'Request closed', { type: 'success' }); }}
                      label={st === 'expired' ? 'Expired: use Closing date to reopen' : r.enabled ? 'Accepting uploads' : 'Closed'} disabled={gone || st === 'expired'} />
                    <button className="icon-btn" onClick={() => setDateEdit(dateEdit?.id === r.id ? null : { id: r.id, value: toDateInput(r.expires), error: '' })} aria-label="Change closing date" data-tip="Closing date" aria-expanded={dateEdit?.id === r.id} disabled={gone}><CalendarClock size={16} /></button>
                    <button className="icon-btn" onClick={() => copy(r)} aria-label="Copy upload link" data-tip="Copy link" disabled={st !== 'active'}><Copy size={16} /></button>
                    <button className="icon-btn" onClick={() => ui.openDialog('linkTools', { requestId: r.id })} aria-label="QR code for upload link" data-tip="QR code" disabled={gone}><QrCode size={16} /></button>
                    <a className="icon-btn" href={requestUrl(r.id)} target="_blank" rel="noreferrer" aria-label="Open upload page" data-tip="Open upload page"><ExternalLink size={16} /></a>
                    <button className="icon-btn" onClick={() => remove(r)} aria-label="Delete request" data-tip="Delete"><Trash2 size={16} /></button>
                  </div>
                  {dateEdit?.id === r.id && (
                    <form className="request-date" onSubmit={(e) => saveDate(e, r)}>
                      <label className="field"><span className="field-label">Closes on</span>
                        <input type="date" className="input" min={toDateInput(Date.now())} value={dateEdit.value} onChange={(e) => setDateEdit({ ...dateEdit, value: e.target.value, error: '' })} autoFocus />
                        {dateEdit.error && <span className="field-error">{dateEdit.error}</span>}
                      </label>
                      <div className="btn-row">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDateEdit(null)}>Cancel</button>
                        {r.expires && <button type="button" className="btn btn-secondary btn-sm" onClick={() => saveDate(null, r, true)}>No closing date</button>}
                        <button className="btn btn-primary btn-sm" disabled={!dateEdit.value}>Save</button>
                      </div>
                    </form>
                  )}
                  {expanded && (
                    <div className="request-uploads">
                      {r.message && <p className="muted small">“{r.message}”</p>}
                      {!r.uploads.length && <div className="muted small">Nothing uploaded yet.</div>}
                      {r.uploads.map((u) => (
                        <div key={u.id} className="upload-entry">
                          <UserRound size={16} className="muted" />
                          <div className="grow min0">
                            <div className="small"><strong>{u.name}</strong>{u.email && <span className="muted"> · {u.email}</span>} <span className="muted">· {formatDateTime(u.at)}</span></div>
                            <div className="chip-row">
                              {u.fileIds.map((fid, i) => {
                                const it = state.items[fid];
                                return it && !it.trashed
                                  ? <Link key={fid} className="chip" to={`${folderRoute(folder)}?highlight=${fid}&preview=${fid}`}><FileIcon item={it} size={14} /> {it.name}</Link>
                                  : <span key={fid} className="chip muted">{u.fileNames[i]} (removed)</span>;
                              })}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
