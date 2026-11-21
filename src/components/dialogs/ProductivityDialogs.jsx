import { useMemo, useState } from 'react';
import { CheckSquare, BadgeCheck, Keyboard, X, AlertTriangle } from 'lucide-react';
import { useDrive } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { peopleWithAccess } from '../../store/selectors';
import { toDateInput } from '../../utils/format';
import { Modal, Avatar, FileIcon } from '../common';

const endOfDay = (dateStr) => (dateStr ? new Date(`${dateStr}T23:59:00`).getTime() : null);

/** People to pick from: those with access first, then everyone else (flagged). */
function usePeople(item, { includeMe = true } = {}) {
  const { state } = useDrive();
  return useMemo(() => {
    const withAccess = new Set(peopleWithAccess(state, item).map((u) => u.id));
    return state.users
      .filter((u) => u.status !== 'disabled' && (includeMe || u.id !== state.meId))
      .map((u) => ({ ...u, hasAccess: withAccess.has(u.id) || u.id === state.meId }))
      .sort((a, b) => (a.id === state.meId ? -1 : b.id === state.meId ? 1 : 0) || Number(b.hasAccess) - Number(a.hasAccess) || a.name.localeCompare(b.name));
  }, [state, item, includeMe]);
}

/* ------------------------------------------------------------------ */
/* Task: create or edit                                                */
/* ------------------------------------------------------------------ */
export function TaskDialog({ itemId, taskId, onClose }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const existing = taskId ? state.tasks.find((t) => t.id === taskId) : null;
  const item = state.items[existing?.itemId || itemId];
  const people = usePeople(item);
  const [title, setTitle] = useState(existing?.title || '');
  const [note, setNote] = useState(existing?.note || '');
  const [assigneeId, setAssigneeId] = useState(existing?.assigneeId || state.meId);
  const [due, setDue] = useState(existing?.due ? toDateInput(existing.due) : toDateInput(Date.now() + 2 * 86400000));
  const [priority, setPriority] = useState(existing?.priority || 'normal');
  if (!item) return null;
  const assignee = people.find((p) => p.id === assigneeId);
  const err = !title.trim() ? 'Describe the task' : null;

  const submit = (e) => {
    e.preventDefault();
    if (err) return;
    if (existing) {
      api.updateTask(existing.id, { title: title.trim(), note: note.trim(), assigneeId, due: endOfDay(due), priority });
      ui.toast('Task updated', { type: 'success' });
    } else {
      api.createTask({ itemId: item.id, title, note, assigneeId, due: endOfDay(due), priority });
      ui.toast(assigneeId === state.meId ? 'Task added to your list' : `Task assigned to ${assignee?.name}`, { type: 'success' });
    }
    onClose();
  };

  return (
    <Modal title={existing ? 'Edit task' : 'Add task'} onClose={onClose} width={500} icon={<CheckSquare size={20} />}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" form="task-form" disabled={!!err}>{existing ? 'Save' : 'Add task'}</button></>}>
      <form id="task-form" className="form" onSubmit={submit}>
        <div className="on-item"><FileIcon item={item} size={20} /><span className="truncate">{item.name}</span></div>
        <label className="field"><span className="field-label">Task</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Review the pricing section" maxLength={140} data-autofocus />
        </label>
        <div className="form-grid">
          <label className="field"><span className="field-label">Assign to</span>
            <select className="select full" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.id === state.meId ? `${p.name} (me)` : p.name}{p.hasAccess ? '' : ' · no access'}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">Due date</span>
            <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>
        {assignee && !assignee.hasAccess && <div className="field-warn"><AlertTriangle size={13} /> {assignee.name} can't open this {item.type} yet. Share it with them so they can work on the task.</div>}
        <div className="field"><span className="field-label">Priority</span>
          <div className="seg" role="radiogroup" aria-label="Priority">
            {[['low', 'Low'], ['normal', 'Normal'], ['high', 'High']].map(([v, l]) => <button type="button" key={v} role="radio" aria-checked={priority === v} className={priority === v ? 'active' : ''} onClick={() => setPriority(v)}>{l}</button>)}
          </div>
        </div>
        <label className="field"><span className="field-label">Notes <span className="muted">(optional)</span></span>
          <textarea className="input textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Approval request                                                    */
/* ------------------------------------------------------------------ */
export function ApprovalDialog({ itemId, onClose }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const item = state.items[itemId];
  const people = usePeople(item, { includeMe: false });
  const [picked, setPicked] = useState([]);
  const [mode, setMode] = useState('all');
  const [due, setDue] = useState(toDateInput(Date.now() + 3 * 86400000));
  const [message, setMessage] = useState('');
  const [applyLabel, setApplyLabel] = useState(true);
  const [q, setQ] = useState('');
  if (!item) return null;
  const pending = (state.approvals || []).find((a) => a.itemId === itemId && a.status === 'pending');
  const shown = people.filter((p) => !picked.includes(p.id) && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.email.toLowerCase().includes(q.toLowerCase())));
  const noAccess = picked.map((id) => people.find((p) => p.id === id)).filter((p) => p && !p.hasAccess);
  const err = pending ? 'This file already has a pending approval' : !picked.length ? 'Choose at least one approver' : null;

  const submit = () => {
    if (err) return;
    api.requestApproval({ itemId, approverIds: picked, mode, due: endOfDay(due), message, applyLabel });
    ui.toast(`Approval requested from ${picked.length} ${picked.length === 1 ? 'person' : 'people'}`, { type: 'success' });
    onClose();
  };

  return (
    <Modal title="Request approval" onClose={onClose} width={540} icon={<BadgeCheck size={20} />}
      footer={<><span className="muted small grow">{err && picked.length ? err : ''}</span><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={!!err}>Send request</button></>}>
      <div className="form">
        <div className="on-item"><FileIcon item={item} size={20} /><span className="truncate">{item.name}</span><span className="muted small">· version {item.version || 1}</span></div>
        {pending && <div className="banner warning">An approval is already pending on this file. Cancel it first to start a new one.</div>}
        <div className="field">
          <span className="field-label">Approvers</span>
          {picked.length > 0 && (
            <div className="chip-row">
              {picked.map((id) => {
                const p = people.find((x) => x.id === id);
                return <span key={id} className="token"><Avatar user={p} size={18} />{p?.name}<button type="button" onClick={() => setPicked(picked.filter((x) => x !== id))} aria-label={`Remove ${p?.name}`}><X size={12} /></button></span>;
              })}
            </div>
          )}
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search approvers" data-autofocus />
          <div className="pick-people">
            {shown.slice(0, 6).map((p) => (
              <button type="button" key={p.id} className="suggest-row" onClick={() => { setPicked([...picked, p.id]); setQ(''); }}>
                <Avatar user={p} size={26} />
                <span className="min0 grow"><span className="strong truncate block">{p.name}</span><span className="muted small truncate block">{p.title || p.email}</span></span>
                {!p.hasAccess && <span className="pill pill-gray">No access</span>}
              </button>
            ))}
          </div>
          {noAccess.length > 0 && <div className="field-warn"><AlertTriangle size={13} /> {noAccess.map((p) => p.name).join(', ')} can't open this file yet. Share it with them before they can review.</div>}
        </div>
        {picked.length > 1 && (
          <div className="field"><span className="field-label">Approval rule</span>
            <div className="seg full" role="radiogroup">
              <button type="button" role="radio" aria-checked={mode === 'all'} className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>Everyone must approve</button>
              <button type="button" role="radio" aria-checked={mode === 'any'} className={mode === 'any' ? 'active' : ''} onClick={() => setMode('any')}>Any one approver</button>
            </div>
          </div>
        )}
        <div className="form-grid">
          <label className="field"><span className="field-label">Respond by</span><input className="input" type="date" value={due} min={toDateInput(Date.now())} onChange={(e) => setDue(e.target.value)} /></label>
          <label className="check-row self-end"><input type="checkbox" className="cb" checked={applyLabel} onChange={(e) => setApplyLabel(e.target.checked)} /> Add the “Approved” label when approved</label>
        </div>
        <label className="field"><span className="field-label">Message <span className="muted">(optional)</span></span>
          <textarea className="input textarea" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What should they look at?" />
        </label>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Keyboard shortcuts sheet (press ?)                                  */
/* ------------------------------------------------------------------ */
export const SHORTCUT_GROUPS = [
  ['General', [['?', 'Show keyboard shortcuts'], ['/', 'Focus search'], ['N', 'New folder here'], ['U', 'Upload files here'], ['Esc', 'Close dialog / preview, clear selection']]],
  ['Go to', [['G then M', 'My Folders'], ['G then T', 'Team Folders'], ['G then S', 'Shared with Me'], ['G then R', 'Recent Files'], ['G then F', 'Favorites'], ['G then A', 'Activity'], ['G then K', 'Tasks'], ['G then P', 'Approvals'], ['G then X', 'Trash']]],
  ['Files & folders', [['Enter', 'Open selected item'], ['Space', 'Preview selected file'], ['F2', 'Rename (several selected: bulk rename)'], ['Delete', 'Move to Trash'], ['I', 'Show details']]],
  ['Selection', [['↑ ↓ ← →', 'Move focus'], ['Shift + ↑ / ↓', 'Extend selection'], ['Ctrl + A', 'Select all'], ['Shift + Click', 'Select a range'], ['Ctrl + Click', 'Add to selection']]],
  ['Preview', [['← / →', 'Previous / next file'], ['+ / −', 'Zoom in / out'], ['Ctrl + S', 'Save while editing'], ['Esc', 'Close preview']]],
  ['Comments', [['@', 'Mention someone'], ['Enter', 'Send'], ['Shift + Enter', 'New line']]],
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const keyLabel = (k) => (isMac ? k.replace(/Ctrl/g, '⌘') : k);

export function ShortcutsDialog({ onClose }) {
  return (
    <Modal title="Keyboard shortcuts" subtitle="Press ? anytime to see this list" onClose={onClose} width={760} icon={<Keyboard size={20} />}>
      <div className="shortcut-sheet">
        {SHORTCUT_GROUPS.map(([group, rows]) => (
          <section key={group} className="shortcut-group">
            <h3>{group}</h3>
            {rows.map(([k, d]) => (
              <div key={k + d} className="shortcut-row">
                <span>{d}</span>
                <span className="keys">{keyLabel(k).split(/( then | \+ | \/ | )/).filter((x) => x && x.trim()).map((part, i) => (
                  part !== part.trim() ? <span key={i} className="muted small">{part.trim()}</span> : <kbd key={i}>{part}</kbd>
                ))}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
