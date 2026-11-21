// Helpers for tasks, approvals and the activity feed.
import { isTrashedDeep, accessOf } from '../store/selectors';

const DAY = 86400000;
const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** "Overdue · 2 days", "Due today", "Due tomorrow", "Due Fri, Nov 28" with a tone for styling. */
export function dueInfo(due, now = Date.now()) {
  if (!due) return null;
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  if (days < 0) return { tone: 'overdue', label: `Overdue · ${-days} day${days === -1 ? '' : 's'}` };
  if (days === 0) return { tone: 'today', label: 'Due today' };
  if (days === 1) return { tone: 'soon', label: 'Due tomorrow' };
  const d = new Date(due);
  return { tone: days <= 3 ? 'soon' : 'later', label: `Due ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` };
}

/** Bucket for the task list: overdue | today | upcoming | nodate | done */
export function taskGroup(t, now = Date.now()) {
  if (t.status === 'done') return 'done';
  if (!t.due) return 'nodate';
  const days = Math.round((startOfDay(t.due) - startOfDay(now)) / DAY);
  return days < 0 ? 'overdue' : days === 0 ? 'today' : 'upcoming';
}

export const PRIORITY = { high: { label: 'High', tone: 'red' }, normal: { label: 'Normal', tone: 'gray' }, low: { label: 'Low', tone: 'blue' } };

/** Item still exists, isn't in Trash, and you can see it. */
export const itemVisible = (state, id) => !!state.items[id] && !isTrashedDeep(state.items, id) && accessOf(state, state.items[id]) !== 'none';

export const tasksFor = (state, itemId) => (state.tasks || []).filter((t) => t.itemId === itemId);

/** Most relevant approval for an item: the pending one, else the latest decided one. */
export function approvalFor(state, itemId) {
  const list = (state.approvals || []).filter((a) => a.itemId === itemId && a.status !== 'cancelled').sort((a, b) => b.requestedAt - a.requestedAt);
  return list.find((a) => a.status === 'pending') || list[0] || null;
}

export const myDecision = (state, a) => a.approvers.find((p) => p.userId === state.meId)?.decision || null;
export const waitingOnMe = (state, a) => a.status === 'pending' && myDecision(state, a) === 'pending';

export const APPROVAL_STATUS = {
  pending: { label: 'Awaiting approval', short: 'Pending', tone: 'amber' },
  approved: { label: 'Approved', short: 'Approved', tone: 'green' },
  rejected: { label: 'Changes requested', short: 'Rejected', tone: 'red' },
  cancelled: { label: 'Cancelled', short: 'Cancelled', tone: 'gray' },
};

// ---- Activity feed ----

export const ACTIVITY_CATEGORIES = [
  { id: 'files', label: 'Uploads & edits', match: /upload|created|edited|version|renamed|moved|copied|restored|extracted|received|shortcut/i },
  { id: 'sharing', label: 'Sharing', match: /share|link|request|permission|member/i },
  { id: 'comments', label: 'Comments', match: /comment|replied/i },
  { id: 'work', label: 'Tasks, approvals & signatures', match: /task|approv|reject|reminder|sign/i },
  { id: 'deletes', label: 'Deletions', match: /delet|trash/i },
  { id: 'organize', label: 'Labels, fields & locks', match: /label|custom field|locked|unlocked|template/i },
];
// Account and admin housekeeping is not "activity on your files".
const HIDDEN = /^(sign(ed)? (in|out)|user (invited|updated|removed)|organization settings updated)$/i;

/** Which feed category an audit action belongs to (first match wins; work beats files). */
export function activityCategory(action) {
  const order = ['work', 'comments', 'deletes', 'organize', 'sharing', 'files'];
  for (const id of order) if (ACTIVITY_CATEGORIES.find((c) => c.id === id).match.test(action)) return id;
  return 'files';
}

/**
 * Audit events the signed-in user may see in the activity feed, enriched with the item (when it
 * still exists and is visible) and the space it happened in.
 */
export function activityEntries(state) {
  const myTeams = new Set(state.teams.filter((t) => t.members.some((m) => m.userId === state.meId)).map((t) => t.id));
  const byName = new Map();
  for (const i of Object.values(state.items)) if (!i.trashed && accessOf(state, i) !== 'none' && !byName.has(i.name)) byName.set(i.name, i);
  const out = [];
  for (const a of state.audit) {
    if (HIDDEN.test(a.action)) continue;
    let item = a.itemId ? state.items[a.itemId] : null;
    if (!item && !a.itemId) item = byName.get(a.target) || null; // older events only carry the name
    const space = item?.space || a.teamId || null;
    const visible = item ? accessOf(state, item) !== 'none' : a.teamId ? myTeams.has(a.teamId) : a.actorId === state.meId;
    if (!visible) continue;
    out.push({ ...a, item: item && !isTrashedDeep(state.items, item.id) && accessOf(state, item) !== 'none' ? item : null, space, category: activityCategory(a.action) });
  }
  return out;
}

// Audit actions are labels ("Task completed"); the feed reads as sentences ("completed a task on …").
const PHRASES = {
  'signature requested': 'requested signatures on', 'document signed': 'signed', 'signature declined': 'declined to sign',
  'signature request completed': 'finished collecting signatures on', 'signature request cancelled': 'cancelled the signature request for',
  'signature request viewed': 'opened the signature request for', 'signature reminder sent': 'sent a signing reminder for',
  'markup saved': 'marked up', 'downloaded with markup': 'downloaded a marked-up copy of', 'versions compared': 'compared versions of',
  'approval complete': 'gave final approval to', 'approval rejected': 'closed the approval with changes requested on',
  'approval requested': 'requested approval on', 'approval cancelled': 'cancelled the approval on', 'approval reminder sent': 'sent an approval reminder for',
  approved: 'approved', rejected: 'requested changes on',
  'task assigned': 'assigned a task on', 'task completed': 'completed a task on', 'task reopened': 'reopened a task on',
  commented: 'commented on', 'replied to comment': 'replied to a comment on', 'comment resolved': 'resolved a comment on', 'comment reopened': 'reopened a comment on',
  'label added': 'labelled', 'label removed': 'removed a label from', 'custom fields updated': 'updated custom fields on', 'custom fields removed': 'removed custom fields from',
  'new version': 'saved a new version of', 'new version uploaded': 'uploaded a new version of', 'version restored': 'restored an earlier version of', 'version deleted': 'deleted a version of', 'version downloaded': 'downloaded an old version of',
  'file locked': 'locked', 'file unlocked': 'unlocked', 'link created': 'created a share link for', 'file shared': 'shared',
  'member added': 'added a member to', 'member removed': 'removed a member from', 'permission changed': 'changed permissions on',
  'file deleted': 'moved to Trash', 'permanently deleted': 'permanently deleted', restored: 'restored', 'archive extracted': 'extracted',
  'shortcut created': 'created a shortcut to', 'bulk renamed': 'bulk renamed', 'files received via request': 'received files through the request',
  'file request created': 'created a file request for', 'team folder created': 'created the team folder', 'team folder renamed': 'renamed the team folder',
};
export function activityPhrase(action) {
  const a = action.toLowerCase();
  return PHRASES[a] || a.replace(/^(file|folder) /, '');
}

/** Events by other people since the Activity page was last opened. */
export const newActivityCount = (state) => activityEntries(state).filter((e) => e.actorId !== state.meId && e.at > (state.settings.activitySeenAt || 0)).length;

/** Counts for sidebar badges. */
export function productivityCounts(state) {
  const openMine = (state.tasks || []).filter((t) => t.assigneeId === state.meId && t.status === 'open' && itemVisible(state, t.itemId));
  return {
    tasks: openMine.length,
    overdue: openMine.filter((t) => taskGroup(t) === 'overdue').length,
    approvals: (state.approvals || []).filter((a) => waitingOnMe(state, a) && itemVisible(state, a.itemId)).length,
  };
}
