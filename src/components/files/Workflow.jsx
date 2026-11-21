import { useState } from 'react';
import { Check, Pencil, Trash2, CalendarClock, CheckCircle2, XCircle, Clock, BellRing, BadgeCheck, Plus, CheckSquare, AlertTriangle } from 'lucide-react';
import { useDrive } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { useItemActions } from '../../store/useItemActions';
import { canEdit, canCommentAccess, accessOf } from '../../store/selectors';
import { formatDate } from '../../utils/format';
import { dueInfo, PRIORITY, APPROVAL_STATUS, waitingOnMe, itemVisible, approvalFor, tasksFor } from '../../utils/productivity';
import { Avatar, FileIcon } from '../common';

const nameOf = (state, id) => (id === state.meId ? 'You' : state.users.find((u) => u.id === id)?.name || 'Someone');

export function DueChip({ due, done }) {
  const info = dueInfo(due);
  if (!info) return null;
  return <span className={`due-chip ${done ? 'done' : info.tone}`}><CalendarClock size={12} /> {done ? `Was due ${formatDate(due)}` : info.label}</span>;
}

/** Clickable file name that opens the item (or says it's gone). */
export function ItemChip({ itemId }) {
  const { state } = useDrive();
  const actions = useItemActions();
  const it = state.items[itemId];
  if (!itemVisible(state, itemId)) return <span className="item-chip gone">{it ? it.name : 'Deleted item'}{it?.trashed ? ' (in Trash)' : ''}</span>;
  return <button className="item-chip" onClick={() => actions.open(it, [it])} title={`Open ${it.name}`}><FileIcon item={it} size={16} /><span className="truncate">{it.name}</span></button>;
}

/* ------------------------------------------------------------------ */
export function TaskRow({ task, showItem = true }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const done = task.status === 'done';
  const mine = task.assigneeId === state.meId;
  const created = task.createdBy === state.meId;
  const canToggle = (mine || created) && itemVisible(state, task.itemId);
  const pr = PRIORITY[task.priority] || PRIORITY.normal;
  const toggle = () => {
    api.setTaskDone(task.id, !done);
    ui.toast(done ? 'Task reopened' : 'Task completed', { type: 'success', action: done ? null : { label: 'Undo', onClick: () => api.setTaskDone(task.id, false) } });
  };
  const remove = () => ui.openDialog('confirm', { title: 'Delete task?', message: `“${task.title}” will be removed.`, confirmLabel: 'Delete', danger: true, onConfirm: () => api.deleteTask(task.id) });
  const assignee = state.users.find((u) => u.id === task.assigneeId);
  return (
    <div className={`task-row ${done ? 'done' : ''}`}>
      <button className={`task-check ${done ? 'on' : ''}`} onClick={toggle} disabled={!canToggle} aria-pressed={done} aria-label={done ? `Reopen “${task.title}”` : `Complete “${task.title}”`}>
        {done && <Check size={13} strokeWidth={3} />}
      </button>
      <div className="min0 grow">
        <div className="task-title">{task.title}</div>
        {task.note && <div className="muted small task-note">{task.note}</div>}
        <div className="task-meta">
          {showItem && <ItemChip itemId={task.itemId} />}
          {task.priority !== 'normal' && <span className={`prio prio-${pr.tone}`}>{pr.label}</span>}
          <DueChip due={task.due} done={done} />
          <span className="muted small">{mine && created ? 'Your task' : mine ? `From ${nameOf(state, task.createdBy)}` : `Assigned to ${assignee?.name || 'someone'}`}{done && task.completedAt ? ` · done ${formatDate(task.completedAt)}` : ''}</span>
        </div>
      </div>
      {!mine && <Avatar user={assignee} size={26} />}
      {created && (
        <div className="row-actions">
          <button className="icon-btn sm" onClick={() => ui.openDialog('task', { taskId: task.id })} aria-label="Edit task" data-tip="Edit"><Pencil size={14} /></button>
          <button className="icon-btn sm" onClick={remove} aria-label="Delete task" data-tip="Delete"><Trash2 size={14} /></button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
const DECISION_ICON = { approved: CheckCircle2, rejected: XCircle, pending: Clock };

export function ApprovalCard({ approval: a, showItem = true }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const [deciding, setDeciding] = useState(null); // 'approved' | 'rejected'
  const [comment, setComment] = useState('');
  const it = state.items[a.itemId];
  const st = APPROVAL_STATUS[a.status];
  const mineToDecide = waitingOnMe(state, a) && itemVisible(state, a.itemId);
  const myRequest = a.requestedBy === state.meId;
  const changed = it && a.status === 'pending' && (it.version || 1) > a.version;
  const done = a.approvers.filter((p) => p.decision !== 'pending').length;

  const decide = () => {
    if (deciding === 'rejected' && !comment.trim()) return;
    const status = api.decideApproval(a.id, deciding, comment);
    ui.toast(status === 'approved' ? `“${it?.name}” is approved` : status === 'rejected' ? 'Changes requested' : 'Your approval was recorded. Waiting for the others.', { type: 'success' });
    setDeciding(null);
    setComment('');
  };

  return (
    <div className={`approval-card tone-${st.tone}`}>
      <div className="approval-head">
        <span className={`pill pill-${st.tone === 'red' ? 'red' : st.tone}`}>{st.short}</span>
        {showItem && <ItemChip itemId={a.itemId} />}
        <span className="grow" />
        {a.status === 'pending' && <DueChip due={a.due} />}
      </div>
      <div className="small">
        <strong>{nameOf(state, a.requestedBy)}</strong> requested approval {formatDate(a.requestedAt)} · {a.mode === 'all' ? 'everyone must approve' : 'any one approver'}
        {a.status !== 'pending' && a.decidedAt ? <span className="muted"> · {st.label.toLowerCase()} {formatDate(a.decidedAt)}</span> : null}
      </div>
      {a.message && <blockquote className="request-msg">{a.message}</blockquote>}
      {changed && <div className="field-warn"><AlertTriangle size={13} /> The file changed after the request (now version {it.version}, requested on version {a.version}).</div>}
      <ul className="approver-list">
        {a.approvers.map((p) => {
          const Icon = DECISION_ICON[p.decision];
          return (
            <li key={p.userId} className={`dec-${p.decision}`}>
              <Avatar user={state.users.find((u) => u.id === p.userId)} size={24} />
              <span className="min0 grow">
                <span className="truncate block">{nameOf(state, p.userId)} <span className="muted">· {p.decision === 'pending' ? 'waiting' : `${p.decision} ${formatDate(p.at)}`}</span></span>
                {p.comment && <span className="muted small block">“{p.comment}”</span>}
              </span>
              <Icon size={16} className="dec-icon" />
            </li>
          );
        })}
      </ul>
      {a.status === 'pending' && a.approvers.length > 1 && <div className="muted small">{done} of {a.approvers.length} responded</div>}

      {mineToDecide && !deciding && (
        <div className="btn-row">
          <button className="btn btn-primary btn-sm" onClick={() => setDeciding('approved')}><CheckCircle2 size={14} /> Approve</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setDeciding('rejected')}><XCircle size={14} /> Request changes</button>
        </div>
      )}
      {deciding && (
        <div className="decide-box">
          <textarea className="input textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus
            placeholder={deciding === 'approved' ? 'Add a comment (optional)' : 'What needs to change? (required)'} aria-label="Decision comment" />
          <div className="btn-row end">
            <button className="btn btn-secondary btn-sm" onClick={() => { setDeciding(null); setComment(''); }}>Cancel</button>
            <button className={`btn btn-sm ${deciding === 'approved' ? 'btn-primary' : 'btn-danger'}`} onClick={decide} disabled={deciding === 'rejected' && !comment.trim()}>
              {deciding === 'approved' ? 'Approve' : 'Request changes'}
            </button>
          </div>
        </div>
      )}
      {myRequest && a.status === 'pending' && (
        <div className="btn-row">
          <button className="btn btn-secondary btn-sm" onClick={() => { api.logEvent('Approval reminder sent', it?.name || '', a.approvers.filter((p) => p.decision === 'pending').map((p) => nameOf(state, p.userId)).join(', '), { itemId: a.itemId }); ui.toast('Reminder sent', { type: 'success' }); }}><BellRing size={14} /> Remind</button>
          <button className="btn btn-ghost btn-sm" onClick={() => ui.openDialog('confirm', { title: 'Cancel approval request?', message: 'Approvers will no longer be able to respond.', confirmLabel: 'Cancel request', danger: true, onConfirm: () => { api.cancelApproval(a.id); ui.toast('Approval request cancelled', { type: 'success' }); } })}>Cancel request</button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/** Details-panel section: the item's approval state and its open tasks. */
export function WorkflowSection({ item }) {
  const { state } = useDrive();
  const ui = useUI();
  const access = accessOf(state, item);
  const tasks = tasksFor(state, item.id).filter((t) => t.status === 'open');
  const approval = item.type === 'file' ? approvalFor(state, item.id) : null;
  const canTask = canCommentAccess(access) && !item.trashed;
  const canApprove = item.type === 'file' && canEdit(access) && !item.trashed && approval?.status !== 'pending';
  if (!tasks.length && !approval && !canTask) return null;
  return (
    <div className="details-section workflow-section">
      <div className="details-section-head">
        <span>Tasks{item.type === 'file' ? ' & approval' : ''}</span>
        <span className="row-actions">
          {canTask && <button className="link-btn" onClick={() => ui.openDialog('task', { itemId: item.id })}><Plus size={13} /> Task</button>}
          {canApprove && <button className="link-btn" onClick={() => ui.openDialog('approval', { itemId: item.id })}><BadgeCheck size={13} /> Approval</button>}
        </span>
      </div>
      {approval && <ApprovalCard approval={approval} showItem={false} />}
      {tasks.map((t) => <TaskRow key={t.id} task={t} showItem={false} />)}
      {!tasks.length && !approval && <div className="muted small"><CheckSquare size={13} /> No open tasks.</div>}
    </div>
  );
}
