import { useMemo, useState } from 'react';
import { History, AlertTriangle, RotateCcw, Info } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { lockedByOther } from '../store/selectors';
import { formatDateTime } from '../utils/format';
import { Modal, Avatar, FileIcon } from '../components/common';
import { planRestore, scopeHistory, describeEntry, KIND_LABEL } from './restore';

/** <input type="datetime-local" step="1"> value (local time, to the second) for a timestamp. */
const toLocal = (t) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 19); };
const fromLocal = (v) => (v ? new Date(v).getTime() : null);

/** Restore a folder (folderId) or a whole team folder (space) to how it was at a chosen time. */
export default function RestoreDialog({ folderId, space, onClose }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const scope = folderId ? { folderId } : { space };
  const scopeName = folderId ? state.items[folderId]?.name : state.teams.find((t) => t.id === space)?.name || 'Team folder';
  const history = useMemo(() => scopeHistory(state, scope, 40), [state, folderId, space]); // eslint-disable-line react-hooks/exhaustive-deps
  // The exact point in time (ms). The picker shows it to the second; "Before this" sets it to 1 ms before a change.
  const [T, setT] = useState(() => (history[0] ? history[0].at - 1 : Date.now() - 86400000));
  const plan = useMemo(() => (T ? planRestore(state, scope, T) : { ops: [], gone: [], skipped: [] }), [state, T, folderId, space]); // eslint-disable-line react-hooks/exhaustive-deps
  const [off, setOff] = useState(() => new Set()); // op itemIds the user unticked
  const chosen = plan.ops.filter((op) => !off.has(op.itemId));
  const future = T && T > Date.now();

  const counts = chosen.reduce((m, op) => { op.kinds.forEach((k) => { m[k] = (m[k] || 0) + 1; }); return m; }, {});
  const pick = (t) => { setT(t); setOff(new Set()); };
  const run = () => {
    const label = `to ${formatDateTime(T)}`;
    // The store skips items that are missing or locked by someone else; count those up front so the toast is accurate.
    const skippedOps = chosen.filter((op) => !state.items[op.itemId] || lockedByOther(state, state.items[op.itemId]));
    const skippedIds = new Set(skippedOps.map((op) => op.itemId));
    const res = api.applyRestore(chosen, { label, scopeName });
    const changed = new Set(chosen.filter((op) => !skippedIds.has(op.itemId) && (Object.keys(op.patch).length || op.versionId)).map((op) => op.itemId)).size;
    const reverted = res?.reverted || 0;
    const parts = [
      `${changed} item${changed === 1 ? '' : 's'} changed`,
      reverted ? `${reverted} content revert${reverted === 1 ? '' : 's'}` : '',
      skippedOps.length ? `${skippedOps.length} skipped (locked by someone else or no longer there)` : '',
    ].filter(Boolean).join(', ');
    ui.toast(changed || reverted ? `Restored “${scopeName}” ${label}: ${parts}` : `Nothing was restored: ${parts}`, { type: changed || reverted ? (skippedOps.length ? 'warning' : 'success') : 'warning', duration: 6000 });
    onClose();
  };

  return (
    <Modal title={`Restore “${scopeName}” to an earlier time`} subtitle="Undo renames, moves, deletions and edits made since a point in time" onClose={onClose} width={760} icon={<History size={20} />}
      footer={<>
        <span className="muted small grow">{chosen.length ? `${chosen.length} item${chosen.length === 1 ? '' : 's'} will change` : 'Nothing to restore for this time'}</span>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={run} disabled={!chosen.length || future}><RotateCcw size={15} /> Restore {chosen.length || ''}</button>
      </>}>
      <div className="restore-grid">
        <div className="restore-left">
          <label className="field"><span className="field-label">Restore to</span>
            <input className="input" type="datetime-local" step="1" value={T ? toLocal(T) : ''} max={toLocal(Date.now())} onChange={(e) => pick(fromLocal(e.target.value))} aria-label="Restore to date and time" />
          </label>
          <div className="chip-row">
            {[['1 hour ago', 3600000], ['Yesterday', 86400000], ['7 days ago', 7 * 86400000]].map(([l, ms]) => <button key={l} className="chip" onClick={() => pick(Date.now() - ms)}>{l}</button>)}
          </div>
          <div className="restore-history">
            <div className="setting-title">Recent changes</div>
            {!history.length && <div className="muted small">No changes recorded in this folder yet. Changes are tracked from now on.</div>}
            {history.map((e) => {
              const u = state.users.find((x) => x.id === e.actorId);
              const active = T && e.at > T;
              return (
                <div key={e.id} className={`hist-row ${active ? 'undone' : ''}`}>
                  <Avatar user={u} size={22} />
                  <div className="min0 grow">
                    <div className="small"><strong>{u?.id === state.meId ? 'You' : u?.name || 'Someone'}</strong> {describeEntry(state, e).text}</div>
                    <div className="muted small">{formatDateTime(e.at)}</div>
                  </div>
                  <button className="link-btn" onClick={() => pick(e.at - 1)} data-tip="Restore to just before this">Before this</button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="restore-right">
          <div className="setting-title">What will change {T ? <span className="muted small">· back to {formatDateTime(T)}</span> : null}</div>
          {future && <div className="banner warning">Choose a time in the past.</div>}
          {!future && !plan.ops.length && <div className="muted small pad-y"><Info size={13} /> “{scopeName}” already looks the way it did then.</div>}
          {plan.ops.length > 0 && (
            <>
              <div className="chip-row restore-counts">{Object.entries(counts).map(([k, n]) => <span key={k} className={`pill ${k === 'trash' || k === 'retrash' ? 'pill-amber' : 'pill-blue'}`}>{KIND_LABEL[k]}: {n}</span>)}</div>
              <ul className="restore-ops">
                {plan.ops.map((op) => {
                  const it = state.items[op.itemId];
                  return (
                    <li key={op.itemId}>
                      <input type="checkbox" className="cb" checked={!off.has(op.itemId)} onChange={(e) => setOff((s) => { const n = new Set(s); if (e.target.checked) n.delete(op.itemId); else n.add(op.itemId); return n; })} aria-label={`Include ${op.name}`} />
                      {it && <FileIcon item={it} size={20} />}
                      <div className="min0 grow">
                        <div className="truncate strong small">{op.name}</div>
                        <div className="muted small">{op.kinds.map((k) => KIND_LABEL[k]).join(' · ')}{op.detail ? ` — ${op.detail}` : ''}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {plan.gone.length > 0 && (
            <div className="banner warning restore-note"><AlertTriangle size={15} /><span>{plan.gone.length} item{plan.gone.length === 1 ? ' was' : 's were'} permanently deleted since then and can't be brought back: {plan.gone.slice(0, 4).map((g) => `“${g.name}”`).join(', ')}{plan.gone.length > 4 ? '…' : ''}</span></div>
          )}
          {plan.skipped.length > 0 && (
            <div className="muted small restore-note">Skipped: {plan.skipped.map((s) => `“${s.name}” (${s.reason.toLowerCase()})`).join('; ')}</div>
          )}
          <p className="muted small">Nothing is deleted: files added after this time go to Trash, and edited files keep their newer content in version history. You can restore again to undo this.</p>
        </div>
      </div>
    </Modal>
  );
}
