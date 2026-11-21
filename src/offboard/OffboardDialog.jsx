import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserMinus, AlertTriangle, CheckCircle2, FolderOpen, Info } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { formatSize } from '../utils/format';
import { Modal, Avatar } from '../components/common';
import { offboardSummary, transferCandidates, DEFAULT_OFFBOARD } from './offboard';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Offboard a departing user: review everything they own or are responsible for, pick who takes it over,
 * then transfer it and close the account. `account` presets the outcome ('deactivate' | 'delete').
 */
export default function OffboardDialog({ userId, account = 'deactivate', onClose }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const navigate = useNavigate();
  const user = state.users.find((u) => u.id === userId);
  const sum = useMemo(() => (user ? offboardSummary(state, userId) : null), [state, userId, user]);
  const people = transferCandidates(state, userId);
  const [to, setTo] = useState(state.meId);
  const [opt, setOpt] = useState({ ...DEFAULT_OFFBOARD, account });
  const [result, setResult] = useState(null);
  if (!user && !result) return null;
  const toUser = state.users.find((u) => u.id === to);
  const set = (k) => (e) => setOpt((o) => ({ ...o, [k]: e.target.checked }));

  if (result) {
    const r = result;
    const lines = [
      (r.files || r.folders) && `${[r.files && plural(r.files, 'file'), r.folders && plural(r.folders, 'folder')].filter(Boolean).join(' and ')} now owned by ${r.toName}`,
      r.movedToMe > 0 && `${plural(r.movedToMe, 'item')} from their own space moved to My Folders → “${r.folderName}”`,
      r.tasks > 0 && `${plural(r.tasks, 'open task')} reassigned`,
      r.approvals > 0 && `${r.toName} replaces them on ${plural(r.approvals, 'pending approval')}`,
      r.requested > 0 && `${plural(r.requested, 'approval request')} handed over`,
      r.fileRequests > 0 && `${plural(r.fileRequests, 'file request')} transferred`,
      r.locks > 0 && `${plural(r.locks, 'lock')} released`,
      r.shares > 0 && `Removed from ${plural(r.shares, 'shared item')}`,
      r.teams > 0 && `Removed from ${plural(r.teams, 'team folder')}`,
      r.promoted.length > 0 && `${r.toName} is now Admin of ${r.promoted.join(', ')}`,
      r.sessions > 0 && `${plural(r.sessions, 'session')} signed out`,
      r.account === 'delete' ? 'Account deleted' : r.account === 'deactivate' ? 'Account deactivated (history kept; can be reactivated)' : 'Account left active',
    ].filter(Boolean);
    return (
      <Modal title={`${r.name} has been offboarded`} icon={<CheckCircle2 size={18} />} onClose={onClose} width={520}
        footer={<>
          {r.folderId && <button className="btn" onClick={() => { onClose(); navigate(`/folders/${r.folderId}`); }}><FolderOpen size={15} /> Open transferred files</button>}
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </>}>
        <ul className="offb-result">{lines.map((l) => <li key={l}><CheckCircle2 size={14} /> {l}</li>)}</ul>
        <p className="muted small">Recorded in the audit log as “User offboarded”.</p>
      </Modal>
    );
  }

  const personalCount = sum.personal.length;
  const rows = [
    { k: 'transferFiles', n: sum.owned.length, label: 'Transfer ownership of their files and folders', detail: sum.owned.length ? `${plural(sum.ownedFiles.length, 'file')} (${formatSize(sum.ownedSize)}) in ${plural(sum.ownedTop.length, 'place')}. Sharing on them stays as it is.${to === state.meId && personalCount ? ` Items in their own space go to My Folders → “Transferred from ${user.name}”.` : ''}` : 'They don’t own any files.' },
    { k: 'reassignTasks', n: sum.tasks.length, label: 'Reassign their open tasks', detail: sum.tasks.map((t) => t.title).join(' · ') },
    { k: 'replaceApprover', n: sum.approving.length, label: 'Replace them as an approver', detail: `${plural(sum.approving.length, 'pending approval')} waiting on them` },
    { k: 'handoverApprovals', n: sum.requested.length, label: 'Hand over approvals they requested', detail: `${plural(sum.requested.length, 'pending request')}` },
    { k: 'transferRequests', n: sum.fileRequests.length, label: 'Transfer their file requests', detail: sum.fileRequests.map((f) => f.title || f.name || 'File request').join(' · ') },
    { k: 'releaseLocks', n: sum.locks.length, label: 'Release files they have checked out', detail: sum.locks.map((i) => i.name).join(' · ') },
    { k: 'removeShares', n: sum.sharedWithThem.length, label: 'Remove their access to files shared with them', detail: `${plural(sum.sharedWithThem.length, 'item')} shared with them` },
    { k: 'leaveTeams', n: sum.teams.length, label: 'Remove them from team folders', detail: sum.teams.map((t) => `${t.team.name} (${t.role}${t.soleAdmin ? `, only Admin: ${toUser?.name || 'the new owner'} becomes Admin` : ''})`).join(' · ') },
  ];
  const needsTo = rows.some((x) => x.n > 0 && opt[x.k] && x.k !== 'releaseLocks' && x.k !== 'removeShares' && x.k !== 'leaveTeams') || sum.teams.some((t) => t.soleAdmin);
  const del = opt.account === 'delete';
  const blocked = del && sum.owned.length > 0 && !opt.transferFiles;

  const run = () => {
    const r = api.offboardUser(userId, { ...opt, newOwnerId: to });
    if (!r) { ui.toast('Could not offboard this user', { type: 'error' }); return; }
    setResult({ ...r, name: user.name, toName: toUser?.name, account: opt.account, folderName: `Transferred from ${user.name}` });
  };

  return (
    <Modal title={`Offboard ${user.name}`} subtitle={user.email} icon={<UserMinus size={18} />} onClose={onClose} width={620} className="offb-modal"
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className={`btn ${del ? 'btn-danger' : 'btn-primary'}`} disabled={blocked || (needsTo && !to)} onClick={run}>{del ? 'Transfer and delete user' : opt.account === 'deactivate' ? 'Transfer and deactivate' : 'Transfer'}</button>
      </>}>
      <div className="offb-who">
        <Avatar user={user} size={36} />
        <div className="min0"><div className="strong">{user.name}</div><div className="muted small">{[user.title, user.dept, user.role].filter(Boolean).join(' · ')}</div></div>
        <span className="offb-arrow" aria-hidden>→</span>
        <label className="field offb-to"><span className="field-label">Transfer to</span>
          <select className="select" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Transfer to">
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === state.meId ? ' (you)' : ''}{p.status === 'invited' ? ' (invited)' : ''}</option>)}
          </select>
        </label>
      </div>

      <div className="offb-list" role="group" aria-label="What to hand over">
        {rows.map((x) => (
          <label key={x.k} className={`offb-row ${x.n ? '' : 'is-empty'}`}>
            <input type="checkbox" checked={!!opt[x.k] && x.n > 0} disabled={!x.n} onChange={set(x.k)} />
            <span className="offb-text">
              <span className="offb-label">{x.label} <span className="pill pill-gray">{x.n}</span></span>
              {x.n > 0 && x.detail && <span className="muted small offb-detail">{x.detail}</span>}
            </span>
          </label>
        ))}
      </div>
      {sum.sessions.length > 0 && opt.account !== 'keep' && <div className="offb-note"><Info size={14} /> {plural(sum.sessions.length, 'active session')} will be signed out.</div>}

      <div className="field"><span className="field-label">Their account</span>
        <div className="offb-accounts">
          {[['deactivate', 'Deactivate', 'They can’t sign in; their name stays on history. Can be reactivated.'], ['delete', 'Delete', 'Removes the account. History keeps the actions but not the person.'], ['keep', 'Keep active', 'Only hand over the work (e.g. moving to another role).']].map(([v, l, d]) => (
            <label key={v} className={`offb-acct ${opt.account === v ? 'is-on' : ''}`}>
              <input type="radio" name="offb-account" value={v} checked={opt.account === v} onChange={() => setOpt((o) => ({ ...o, account: v }))} />
              <span><span className="strong">{l}</span><span className="muted small">{d}</span></span>
            </label>
          ))}
        </div>
      </div>
      {blocked && <div className="field-warn"><AlertTriangle size={13} /> Transfer their files first: deleting the account would leave {plural(sum.owned.length, 'item')} without an owner.</div>}
    </Modal>
  );
}
