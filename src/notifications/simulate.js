// Teammate activity for the browser-only prototype: there's no server, so other people's actions are simulated
// on the real workspace data (a comment is really added to the file, a shared file really appears in
// "Shared with Me", ...). Every event returns the new state plus the notification it should raise.

import { uid } from '../utils/format';
import { accessOf, parentRoute, teamRoleOf, uniqueName } from '../store/selectors';

const pick = (list, rnd) => list[Math.floor(rnd() * list.length)];
const quote = (s) => (s.length > 70 ? `${s.slice(0, 67)}…` : s);

const COMMENTS = [
  'Looks good to me. Just one typo on the second page.',
  'Can we add the numbers for last quarter here?',
  'I left a few suggestions. Let me know what you think.',
  'Is this the final version, or are we still waiting on legal?',
  'Great work. Sharing this with the team today.',
  'The figures in section 3 don’t match the summary. Can you check?',
  'Could you update the dates before Friday’s meeting?',
  'Approved from my side.',
];
const MENTIONS = [
  'can you take a look at this before the review?',
  'do you have the latest numbers for this?',
  'please confirm this is ready to send.',
];
const NEW_FILES = [
  ['Meeting Notes', 'docx', 'Meeting notes\n\nAttendees: the team\n\nDecisions\n• Ship the first milestone next week\n• Review open risks on Thursday\n\nAction items\n• Share the updated plan with everyone'],
  ['Weekly Report', 'docx', 'Weekly report\n\nHighlights\n• Work is on track for the milestone\n• Two items need a decision\n\nNext week\n• Finish the review and publish'],
  ['Budget Draft', 'xlsx', null],
  ['Proposal', 'pdf', null],
  ['Checklist', 'txt', 'Checklist\n\n[x] Draft ready\n[ ] Review by the team\n[ ] Final sign-off'],
  ['Presentation', 'pptx', null],
];
const TASKS = ['Review the latest changes', 'Add your comments by Friday', 'Check the numbers in the summary', 'Update the timeline section'];

const isActive = (s, id) => id !== s.meId && s.users.find((u) => u.id === id)?.status === 'active';
const liveFiles = (s) => Object.values(s.items).filter((i) => i.type === 'file' && !i.trashed);
const preview = (s, it) => `${parentRoute(s, it)}?highlight=${it.id}&preview=${it.id}`;
const audit = (s, actorId, action, target, details, itemId) => ({
  ...s, audit: [{ id: uid('a'), actorId, action, target, details, at: Date.now(), ip: '10.0.1.' + (20 + Math.floor(Math.random() * 60)), ...(itemId ? { itemId } : {}) }, ...s.audit].slice(0, 500),
});

/** Who else can comment on / see this file: its direct shares, or the members of its team folder. */
function collaborators(s, it, roles) {
  if (it.space?.startsWith('t')) {
    return (s.teams.find((t) => t.id === it.space)?.members || []).filter((m) => roles.includes(m.role.toLowerCase())).map((m) => m.userId);
  }
  const ids = (it.sharedWith || []).filter((x) => roles.includes(x.role)).map((x) => x.userId);
  if (it.ownerId !== s.meId) ids.push(it.ownerId);
  return ids;
}

function comment(s, rnd) {
  const options = [];
  for (const it of liveFiles(s)) {
    if (accessOf(s, it) === 'none') continue;
    for (const u of collaborators(s, it, ['owner', 'admin', 'organizer', 'editor', 'commenter'])) if (isActive(s, u)) options.push([it, u]);
  }
  if (!options.length) return null;
  const [it, actorId] = pick(options, rnd);
  const me = s.users.find((u) => u.id === s.meId);
  const mention = rnd() < 0.35;
  const text = mention ? `@${me.name} ${pick(MENTIONS, rnd)}` : pick(COMMENTS, rnd);
  const c = { id: uid('c'), userId: actorId, text, at: Date.now(), parentId: null, resolved: false, resolvedBy: null, resolvedAt: null, editedAt: null, mentions: mention ? [s.meId] : [], simulated: true };
  let ns = { ...s, items: { ...s.items, [it.id]: { ...it, comments: [...(it.comments || []), c] } } };
  ns = audit(ns, actorId, 'Commented', it.name, quote(text), it.id);
  return {
    state: ns,
    notification: {
      type: 'comment', actorId, link: preview(ns, it),
      text: mention ? `mentioned you on "${it.name}": "${quote(text.replace(`@${me.name} `, ''))}"` : `commented on "${it.name}": "${quote(text)}"`,
    },
  };
}

function share(s, rnd) {
  const actors = s.users.filter((u) => isActive(s, u.id));
  if (!actors.length) return null;
  const actor = pick(actors, rnd);
  const [base, ext, content] = pick(NEW_FILES, rnd);
  const role = pick(['viewer', 'commenter', 'editor'], rnd);
  const now = Date.now();
  const name = uniqueName(s, `${base} - ${actor.name.split(' ')[0]}.${ext}`, null, 'user');
  const id = uid('f');
  const item = {
    id, name, type: 'file', ext, size: 40_000 + Math.floor(rnd() * 900_000), parentId: null, space: 'user', ownerId: actor.id,
    createdAt: now, modifiedAt: now, modifiedBy: actor.id, lastOpened: null, favorite: false, trashed: false, trashedAt: null, trashedBy: null,
    sharedWith: [{ userId: s.meId, role, sharedAt: now, sharedBy: actor.id }], link: null, content, sheet: null, slides: null, dataUrl: null,
    mime: null, thumb: null, description: '', version: 1, versions: [], comments: [], lock: null, labels: [], color: null, meta: null, linkLog: [], uploadedBy: null, simulated: true,
  };
  let ns = { ...s, items: { ...s.items, [id]: item }, __journal: [{ id: uid('j'), at: now, itemId: id, kind: 'create', actorId: actor.id, before: null }] };
  ns = audit(ns, actor.id, 'File shared', name, `${s.users.find((u) => u.id === s.meId)?.name} → ${role[0].toUpperCase()}${role.slice(1)}`, id);
  return { state: ns, notification: { type: 'share', actorId: actor.id, text: `shared "${name}" with you (${role})`, link: `/shared-with-me?highlight=${id}&preview=${id}` } };
}

function upload(s, rnd) {
  const options = [];
  for (const t of s.teams) {
    if (!teamRoleOf(s, t.id)) continue;
    for (const m of t.members) if (isActive(s, m.userId) && ['admin', 'organizer', 'editor'].includes(m.role.toLowerCase())) options.push([t, m.userId]);
  }
  if (!options.length) return null;
  const [team, actorId] = pick(options, rnd);
  const folders = Object.values(s.items).filter((i) => i.type === 'folder' && i.space === team.id && !i.trashed);
  const parentId = folders.length && rnd() < 0.6 ? pick(folders, rnd).id : null;
  const [base, ext, content] = pick(NEW_FILES, rnd);
  const now = Date.now();
  const name = uniqueName(s, `${base}.${ext}`, parentId, team.id);
  const id = uid('f');
  const item = {
    id, name, type: 'file', ext, size: 40_000 + Math.floor(rnd() * 2_000_000), parentId, space: team.id, ownerId: actorId,
    createdAt: now, modifiedAt: now, modifiedBy: actorId, lastOpened: null, favorite: false, trashed: false, trashedAt: null, trashedBy: null,
    sharedWith: [], link: null, content, sheet: null, slides: null, dataUrl: null, mime: null, thumb: null, description: '',
    version: 1, versions: [], comments: [], lock: null, labels: [], color: null, meta: null, linkLog: [], uploadedBy: null, simulated: true,
  };
  const where = parentId ? `${team.name} / ${s.items[parentId].name}` : team.name;
  let ns = { ...s, items: { ...s.items, [id]: item }, __journal: [{ id: uid('j'), at: now, itemId: id, kind: 'create', actorId, before: null }] };
  ns = audit(ns, actorId, 'File uploaded', name, where, id);
  return { state: ns, notification: { type: 'upload', actorId, text: `uploaded "${name}" to ${where}`, link: preview(ns, item) } };
}

function task(s, rnd) {
  // Either someone finishes a task you gave them, or gives you a new one.
  const mine = (s.tasks || []).filter((t) => t.status === 'open' && t.createdBy === s.meId && isActive(s, t.assigneeId));
  if (mine.length && rnd() < 0.5) {
    const t = pick(mine, rnd);
    const ns = { ...s, tasks: s.tasks.map((x) => (x.id === t.id ? { ...x, status: 'done', completedAt: Date.now(), completedBy: t.assigneeId } : x)) };
    return { state: ns, notification: { type: 'task', actorId: t.assigneeId, text: `completed the task "${t.title}"`, link: '/tasks' } };
  }
  const options = [];
  for (const it of liveFiles(s)) {
    if (accessOf(s, it) === 'none') continue;
    for (const u of collaborators(s, it, ['owner', 'admin', 'organizer', 'editor'])) if (isActive(s, u)) options.push([it, u]);
  }
  if (!options.length) return null;
  const [it, actorId] = pick(options, rnd);
  const title = pick(TASKS, rnd);
  const due = new Date(); due.setDate(due.getDate() + 2 + Math.floor(rnd() * 5)); due.setHours(23, 59, 59, 0);
  const t = { id: uid('tk'), itemId: it.id, title, note: '', assigneeId: s.meId, createdBy: actorId, createdAt: Date.now(), due: due.getTime(), priority: pick(['normal', 'normal', 'high', 'low'], rnd), status: 'open', completedAt: null, completedBy: null, simulated: true };
  return { state: { ...s, tasks: [t, ...(s.tasks || [])] }, notification: { type: 'task', actorId, text: `assigned you a task on "${it.name}": "${title}"`, link: '/tasks' } };
}

const EVENTS = [[comment, 4], [share, 2], [upload, 3], [task, 2]];

/** One random teammate action: { state, notification } or null when nothing fits the workspace. */
export function simulateEvent(s, rnd = Math.random) {
  const pool = EVENTS.flatMap(([fn, w]) => Array(w).fill(fn));
  for (let i = 0; i < 6; i++) {
    const r = pick(pool, rnd)(s, rnd);
    if (r) return { ...r, state: pruneSimulated(r.state) };
  }
  return null;
}

// Simulated activity keeps only its newest few results, so a tab left open for days can't fill browser storage.
export const SIM_LIMITS = { files: 20, comments: 40, tasks: 15 };

/** Drop the oldest simulated files, comments and tasks beyond SIM_LIMITS (things you've worked on are kept). */
export function pruneSimulated(s) {
  let items = s.items;
  const touched = (it) => it.modifiedBy === s.meId || it.favorite || it.trashed || (it.comments || []).some((c) => c.userId === s.meId);
  const simFiles = Object.values(items).filter((i) => i.simulated && !touched(i)).sort((a, b) => b.createdAt - a.createdAt);
  if (simFiles.length > SIM_LIMITS.files) {
    items = { ...items };
    for (const it of simFiles.slice(SIM_LIMITS.files)) delete items[it.id];
  }
  const simComments = [];
  for (const it of Object.values(items)) for (const c of it.comments || []) if (c.simulated) simComments.push([it.id, c]);
  if (simComments.length > SIM_LIMITS.comments) {
    const drop = new Set(simComments.sort((a, b) => b[1].at - a[1].at).slice(SIM_LIMITS.comments).map(([, c]) => c.id));
    const hasReply = new Set(Object.values(items).flatMap((it) => (it.comments || []).map((c) => c.parentId)).filter(Boolean));
    if (items === s.items) items = { ...items };
    for (const [id] of simComments) {
      const it = items[id];
      const kept = it.comments.filter((c) => !drop.has(c.id) || hasReply.has(c.id)); // keep threads someone replied to
      if (kept.length !== it.comments.length) items[id] = { ...it, comments: kept };
    }
  }
  let tasks = s.tasks;
  const simTasks = (tasks || []).filter((t) => t.simulated).sort((a, b) => b.createdAt - a.createdAt);
  if (simTasks.length > SIM_LIMITS.tasks) {
    const drop = new Set(simTasks.slice(SIM_LIMITS.tasks).map((t) => t.id));
    tasks = tasks.filter((t) => !drop.has(t.id));
  }
  // Simulated tasks on files that were just removed go too.
  if (items !== s.items && (tasks || []).some((t) => t.simulated && !items[t.itemId])) tasks = tasks.filter((t) => !t.simulated || items[t.itemId]);
  return items === s.items && tasks === s.tasks ? s : { ...s, items, tasks };
}

/** Which Settings → Notifications switch governs each kind (kinds not listed always notify). */
export const NOTIF_PREF = { share: 'shares', comment: 'comments', upload: 'uploads', team: 'teamChanges' };
export const wantsNotification = (s, n) => {
  if (n.actorId && n.actorId === s.meId) return false; // never notify people about their own actions
  const key = NOTIF_PREF[n.type];
  return !key || s.settings?.notifications?.[key] !== false;
};
