import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, BadgeCheck, Activity, Search } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useItemActions } from '../store/useItemActions';
import { spaceLabel } from '../store/selectors';
import { formatDateTime } from '../utils/format';
import { taskGroup, itemVisible, waitingOnMe, activityEntries, activityPhrase, ACTIVITY_CATEGORIES } from '../utils/productivity';
import PageHeader from '../components/layout/PageHeader';
import { EmptyState, Avatar, FileIcon } from '../components/common';
import { TaskRow, ApprovalCard } from '../components/files/Workflow';

function Tabs({ tabs, value, onChange, label }) {
  return (
    <div className="tabs page-tabs" role="tablist" aria-label={label}>
      {tabs.map(([id, text, count]) => (
        <button key={id} role="tab" aria-selected={value === id} className={value === id ? 'active' : ''} onClick={() => onChange(id)}>
          {text}{count ? <span className="tab-count">{count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */
const GROUPS = [['overdue', 'Overdue'], ['today', 'Due today'], ['upcoming', 'Upcoming'], ['nodate', 'No due date']];

export function TasksView() {
  const { state } = useDrive();
  const [tab, setTab] = useState('mine');
  const [q, setQ] = useState('');
  const all = (state.tasks || []).filter((t) => state.items[t.itemId]);
  const mine = all.filter((t) => t.assigneeId === state.meId && t.status === 'open' && itemVisible(state, t.itemId));
  const created = all.filter((t) => t.createdBy === state.meId && t.assigneeId !== state.meId && t.status === 'open');
  const done = all.filter((t) => t.status === 'done' && (t.assigneeId === state.meId || t.createdBy === state.meId)).sort((a, b) => b.completedAt - a.completedAt);
  const list = (tab === 'mine' ? mine : tab === 'created' ? created : done)
    .filter((t) => !q || `${t.title} ${t.note} ${state.items[t.itemId]?.name}`.toLowerCase().includes(q.toLowerCase()));
  const sorted = [...list].sort((a, b) => (a.due || Infinity) - (b.due || Infinity) || (a.priority === 'high' ? -1 : 0));
  const overdue = mine.filter((t) => taskGroup(t) === 'overdue').length;

  return (
    <div className="page">
      <PageHeader title="Tasks" subtitle={overdue ? `${mine.length} open · ${overdue} overdue` : `${mine.length} open task${mine.length === 1 ? '' : 's'} assigned to you`}
        actions={<div className="input-icon search-sm"><Search size={15} /><input className="input" placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" /></div>} />
      <div className="page-scroll">
        <Tabs label="Task lists" value={tab} onChange={setTab} tabs={[['mine', 'Assigned to me', mine.length], ['created', 'Assigned by me', created.length], ['done', 'Completed']]} />
        {!sorted.length ? (
          <EmptyState icon={CheckSquare} title={q ? 'No matching tasks' : tab === 'done' ? 'Nothing completed yet' : tab === 'created' ? "You haven't assigned any tasks" : "You're all caught up"}
            text={tab === 'done' ? '' : 'Open the ⋮ menu on any file or folder (or right-click it) and choose “Add task” to create one.'} />
        ) : tab === 'done' ? (
          <div className="task-list">{sorted.map((t) => <TaskRow key={t.id} task={t} />)}</div>
        ) : (
          GROUPS.map(([g, label]) => {
            const rows = sorted.filter((t) => taskGroup(t) === g);
            if (!rows.length) return null;
            return (
              <section key={g} className={`task-group group-${g}`}>
                <h2>{label} <span className="muted">{rows.length}</span></h2>
                <div className="task-list">{rows.map((t) => <TaskRow key={t.id} task={t} />)}</div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Approvals                                                           */
/* ------------------------------------------------------------------ */
export function ApprovalsView() {
  const { state } = useDrive();
  const all = (state.approvals || []).filter((a) => state.items[a.itemId]);
  const waiting = all.filter((a) => waitingOnMe(state, a) && itemVisible(state, a.itemId));
  const requested = all.filter((a) => a.requestedBy === state.meId && a.status === 'pending');
  const history = all.filter((a) => a.status !== 'pending' && (a.requestedBy === state.meId || a.approvers.some((p) => p.userId === state.meId)))
    .sort((a, b) => (b.decidedAt || 0) - (a.decidedAt || 0));
  const [tab, setTab] = useState(waiting.length ? 'waiting' : 'requested');
  const list = tab === 'waiting' ? waiting : tab === 'requested' ? requested : history;
  return (
    <div className="page">
      <PageHeader title="Approvals" subtitle={waiting.length ? `${waiting.length} waiting for your decision` : 'Nothing is waiting for you'} />
      <div className="page-scroll">
        <Tabs label="Approval lists" value={tab} onChange={setTab} tabs={[['waiting', 'Waiting for me', waiting.length], ['requested', 'Requested by me', requested.length], ['history', 'History']]} />
        {!list.length ? (
          <EmptyState icon={BadgeCheck} title={tab === 'waiting' ? 'No approvals waiting for you' : tab === 'requested' ? 'No open requests' : 'No past approvals'}
            text={tab === 'history' ? '' : 'Open the ⋮ menu on a file (or right-click it) and choose “Request approval” to ask colleagues to sign off.'} />
        ) : (
          <div className="approval-list">{list.map((a) => <ApprovalCard key={a.id} approval={a} />)}</div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Activity feed                                                       */
/* ------------------------------------------------------------------ */
const dayLabel = (t) => {
  const d = new Date(t); const today = new Date(); const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};

export function ActivityView() {
  const { state, api } = useDrive();
  const actions = useItemActions();
  const [seenAt] = useState(() => state.settings.activitySeenAt || 0); // "new" is relative to the previous visit
  useEffect(() => { api.markActivitySeen(); }, [api]);
  const [space, setSpace] = useState('all');
  const [person, setPerson] = useState('all');
  const [cat, setCat] = useState('all');
  const [limit, setLimit] = useState(60);

  const entries = useMemo(() => activityEntries(state), [state]);
  const myTeams = state.teams.filter((t) => t.members.some((m) => m.userId === state.meId));
  const people = useMemo(() => state.users.filter((u) => entries.some((e) => e.actorId === u.id)), [state.users, entries]);
  const filtered = entries.filter((e) => (space === 'all' || (space === 'my' ? e.space === 'my' : e.space === space))
    && (person === 'all' || (person === 'others' ? e.actorId !== state.meId : e.actorId === person))
    && (cat === 'all' || e.category === cat));
  const shown = filtered.slice(0, limit);
  const newCount = filtered.filter((e) => e.at > seenAt && e.actorId !== state.meId).length;

  let lastDay = null;
  let dividerShown = false;
  return (
    <div className="page">
      <PageHeader title="Activity" subtitle={newCount ? `${newCount} new since your last visit` : 'What’s been happening across your files and teams'} />
      <div className="page-scroll">
        <div className="activity-filters">
          <select className="select select-sm" value={space} onChange={(e) => setSpace(e.target.value)} aria-label="Where">
            <option value="all">All my files & teams</option>
            <option value="my">My Folders</option>
            {myTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="select select-sm" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Who">
            <option value="all">Everyone</option>
            <option value="others">Everyone but me</option>
            {people.map((u) => <option key={u.id} value={u.id}>{u.id === state.meId ? 'Me' : u.name}</option>)}
          </select>
          <div className="chip-row">
            <button className={`chip ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>All</button>
            {ACTIVITY_CATEGORIES.map((c) => <button key={c.id} className={`chip ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(c.id)}>{c.label}</button>)}
          </div>
        </div>

        {!shown.length ? (
          <EmptyState icon={Activity} title="No activity matches" text="Try another team, person or kind of activity." />
        ) : (
          <ol className="feed">
            {shown.map((e) => {
              const u = state.users.find((x) => x.id === e.actorId);
              const day = dayLabel(e.at);
              const showDay = day !== lastDay;
              lastDay = day;
              const isNew = e.at > seenAt && e.actorId !== state.meId;
              const showDivider = !isNew && !dividerShown && newCount > 0 && e.at <= seenAt;
              if (showDivider) dividerShown = true;
              return (
                <li key={e.id} className="feed-li">
                  {showDivider && <div className="feed-divider"><span>Earlier</span></div>}
                  {showDay && <h2 className="feed-day">{day}</h2>}
                  <div className={`feed-item ${isNew ? 'new' : ''}`}>
                    <Avatar user={u} size={32} />
                    <div className="min0 grow">
                      <div className="feed-text">
                        <strong>{u ? (u.id === state.meId ? 'You' : u.name) : 'Someone'}</strong> <span className="feed-action">{activityPhrase(e.action)}</span>{' '}
                        {e.item ? (
                          <button className="item-chip" onClick={() => actions.open(e.item, [e.item])}><FileIcon item={e.item} size={16} /><span className="truncate">{e.item.name}</span></button>
                        ) : <strong className="feed-target">{e.target}</strong>}
                      </div>
                      {e.details && <div className="muted small feed-details">{e.details}</div>}
                      <div className="muted small">{formatDateTime(e.at)}{(() => { const where = e.space ? spaceLabel(state, e.space) : ''; return where && where !== e.target && where !== e.details ? ` · ${where}` : ''; })()}</div>
                    </div>
                    {isNew && <span className="new-dot" role="img" aria-label="New" />}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {filtered.length > limit && <div className="btn-row center"><button className="btn btn-secondary" onClick={() => setLimit(limit + 60)}>Show more</button></div>}      </div>
    </div>
  );
}
