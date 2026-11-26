// Pure helpers that derive information from store state.

export const itemList = (state) => Object.values(state.items);

/**
 * Cache a whole-workspace scan until the items change (each change makes a new items object). The sidebar and
 * top bar ask for these on every render; with thousands of files, scanning each time made every click slow.
 */
const perItems = (fn) => {
  const cache = new WeakMap(); // items -> Map(key -> value)
  return (state, ...args) => {
    let m = cache.get(state.items);
    if (!m) { m = new Map(); cache.set(state.items, m); }
    const key = `${state.meId}|${args.join('|')}`;
    if (!m.has(key)) m.set(key, fn(state, ...args));
    return m.get(key);
  };
};

/** Is the item (or any ancestor) in the trash? */
export function isTrashedDeep(items, id) {
  let cur = items[id];
  let guard = 0;
  while (cur && guard++ < 100) {
    if (cur.trashed) return true;
    cur = cur.parentId ? items[cur.parentId] : null;
  }
  return false;
}

export const isAlive = (items, id) => !!items[id] && !isTrashedDeep(items, id);

export function childrenOf(state, parentId, space) {
  return itemList(state).filter((i) => !i.trashed && i.parentId === (parentId || null) && (parentId ? true : i.space === space));
}

export function ancestors(items, id) {
  const out = [];
  let cur = items[id];
  let guard = 0;
  while (cur && cur.parentId && guard++ < 100) {
    cur = items[cur.parentId];
    if (cur) out.unshift(cur);
  }
  return out;
}

/**
 * parentId -> child ids, built once per items object (state updates replace the object, so the cache
 * can't go stale). Makes folder walks O(descendants) instead of O(all items x descendants).
 */
const childIndexCache = new WeakMap();
export function childIndex(items) {
  let idx = childIndexCache.get(items);
  if (!idx) {
    idx = new Map();
    for (const it of Object.values(items)) {
      const k = it.parentId ?? null;
      const list = idx.get(k);
      if (list) list.push(it.id); else idx.set(k, [it.id]);
    }
    childIndexCache.set(items, idx);
  }
  return idx;
}

/** Ids of an item's direct children (trashed ones included). */
export const childIds = (items, id) => childIndex(items).get(id) || [];

export function descendantIds(items, id) {
  const idx = childIndex(items);
  const out = [];
  const stack = [id];
  while (stack.length) {
    const kids = idx.get(stack.pop());
    if (!kids) continue;
    for (const k of kids) { out.push(k); stack.push(k); }
  }
  return out;
}

/** Descendants that aren't in Trash, skipping everything inside a trashed subfolder too. */
export function liveDescendantIds(items, id) {
  const idx = childIndex(items);
  const out = [];
  const stack = [id];
  while (stack.length) {
    for (const k of idx.get(stack.pop()) || []) {
      if (items[k].trashed) continue;
      out.push(k);
      stack.push(k);
    }
  }
  return out;
}

export function folderSize(items, id) {
  return liveDescendantIds(items, id).reduce((s, cid) => s + (items[cid].type === 'file' ? items[cid].size : 0), 0);
}

export function itemCount(items, id) {
  let n = 0;
  for (const c of childIds(items, id)) if (!items[c].trashed) n++;
  return n;
}

/** Route path for opening a folder. */
export function folderRoute(item) {
  if (!item) return '/folders';
  if (item.space && item.space.startsWith('t')) return `/team-folders/${item.space}/${item.id}`;
  return `/folders/${item.id}`;
}

/** Route of the folder that contains an item (its parent folder, or its space root). */
export function parentRoute(state, item) {
  const parent = item?.parentId ? state.items[item.parentId] : null;
  if (parent && accessOf(state, parent) !== 'none') return folderRoute(parent);
  return spaceRoute(item?.space);
}

/** Items in Trash that the current user should see (matches the Trash page). */
export const trashedForMe = perItems((state) => Object.values(state.items).filter((i) => i.trashed && (i.space === 'my' || i.trashedBy === state.meId)));

/** Can the current user see this item at all? */
export const canSee = (state, item) => accessOf(state, item) !== 'none';

export function spaceRoute(space) {
  if (space && space.startsWith('t')) return `/team-folders/${space}`;
  if (space === 'user') return '/shared-with-me';
  return '/folders';
}

export function spaceLabel(state, space) {
  if (space === 'my') return 'My Folders';
  if (space === 'user') return 'Shared with Me';
  return state.teams.find((t) => t.id === space)?.name || 'Team Folder';
}

/** Human readable location path, e.g. "My Folders / Projects / Client Portal" */
export function locationOf(state, item) {
  const chain = ancestors(state.items, item.id).map((a) => a.name);
  return [spaceLabel(state, item.space), ...chain].join(' / ');
}

/** A share or team membership whose access-expiration date (if any) hasn't passed. */
export const shareActive = (s, now = Date.now()) => !s?.expires || s.expires > now;

/**
 * Effective sharing entries on the item, including those inherited from ancestors.
 * Shares past their expiration date grant nothing and are left out unless includeExpired is set.
 */
export function effectiveShares(items, id, { includeExpired = false } = {}) {
  const chain = [...ancestors(items, id), items[id]].filter(Boolean);
  const map = new Map();
  for (const node of chain) {
    for (const s of node.sharedWith || []) {
      if (!includeExpired && !shareActive(s)) continue;
      map.set(s.userId, { ...s, inheritedFrom: node.id !== id ? node.name : null });
    }
  }
  return [...map.values()];
}

/** A user's role in a team folder ('admin'|'organizer'|'editor'|'viewer'), or null when not a member or expired. */
export function teamRoleOf(state, teamId, userId = state.meId) {
  const m = state.teams.find((t) => t.id === teamId)?.members.find((x) => x.userId === userId);
  return m && shareActive(m) ? m.role.toLowerCase() : null;
}

/** Can the current user download this item? (any access, unless viewers are restricted by policy) */
export function canDownload(state, item) {
  const a = accessOf(state, item);
  if (a === 'none') return false;
  return !(state.org.policies.downloadRestriction && a === 'viewer');
}

/** Access level of the current user on an item. owner|admin|organizer|editor|commenter|viewer|none */
export function accessOf(state, item) {
  if (!item) return 'none';
  const me = state.meId;
  if (item.space && item.space.startsWith('t')) {
    return teamRoleOf(state, item.space, me) || 'none';
  }
  if (item.ownerId === me && item.space === 'my') return 'owner';
  const share = effectiveShares(state.items, item.id).find((s) => s.userId === me);
  return share ? share.role : item.ownerId === me ? 'owner' : 'none';
}

export const canEdit = (access) => ['owner', 'admin', 'organizer', 'editor'].includes(access);
export const canManage = (access) => ['owner', 'admin', 'organizer'].includes(access);
export const canCommentAccess = (access) => canEdit(access) || access === 'commenter';

// ---- Collaboration: locks, comments, versions ----

/** The file is checked out by someone other than the current user. */
export const lockedByOther = (state, item) => !!(item?.lock && item.lock.by !== state.meId);

/** First item at or inside this one that someone else has checked out (moving/deleting the folder would take it along). */
export const lockedInside = (state, id) => {
  const it = state.items[id];
  if (lockedByOther(state, it)) return it;
  if (it?.type !== 'folder') return null;
  for (const d of descendantIds(state.items, id)) if (lockedByOther(state, state.items[d])) return state.items[d];
  return null;
};

/** Can the current user change this item (edit access and not locked by someone else)? */
export const canModify = (state, item) => canEdit(accessOf(state, item)) && !lockedByOther(state, item);

/** Can the current user remove someone else's lock (file manager or org admin)? */
export function canForceUnlock(state, item) {
  if (!item?.lock) return false;
  if (item.lock.by === state.meId) return true;
  const me = state.users.find((u) => u.id === state.meId);
  return me?.role === 'Admin' || canManage(accessOf(state, item));
}

export const openCommentCount = (item) => (item?.comments || []).filter((c) => !c.parentId && !c.resolved).length;

/** Current version number of a file (1 when it has never been revised). */
export const versionNo = (item) => item?.version || 1;

// ---- Legal hold ----

export const activeHolds = (state) => (state.org?.legalHolds || []).filter((h) => h.active);

/** The active hold that covers an item directly, through a parent folder, or through its whole space. */
export function holdOn(state, id) {
  const it = state.items[id];
  if (!it) return null;
  const chain = new Set([id, ...ancestors(state.items, id).map((a) => a.id)]);
  return activeHolds(state).find((h) => h.spaces?.includes(it.space) || h.itemIds?.some((x) => chain.has(x))) || null;
}

/** Permanently deleting this item would destroy held data (the item, a parent, or anything inside it is held). */
export function blocksPermanentDelete(state, id) {
  if (holdOn(state, id)) return true;
  const held = new Set(activeHolds(state).flatMap((h) => h.itemIds || []));
  return held.size > 0 && descendantIds(state.items, id).some((d) => held.has(d));
}

// ---- Shortcuts ----

/** The item a shortcut points to, or null when it was deleted, trashed or you can't see it. */
export function shortcutTarget(state, item) {
  if (item?.type !== 'shortcut') return null;
  const t = state.items[item.target];
  if (!t || isTrashedDeep(state.items, t.id) || accessOf(state, t) === 'none') return null;
  return t;
}

/** For shortcuts, the target (or null if broken); otherwise the item itself. */
export const resolveItem = (state, item) => (item?.type === 'shortcut' ? shortcutTarget(state, item) : item);

// ---- Organization: labels, custom fields, pins ----

/** Label objects on an item, in org label order (unknown/deleted ids are skipped). */
export function labelsOf(state, item) {
  const ids = item?.labels || [];
  if (!ids.length) return [];
  return (state.org.labels || []).filter((l) => ids.includes(l.id));
}

export const templateOf = (state, item) => (item?.meta ? (state.org.dataTemplates || []).find((t) => t.id === item.meta.templateId) || null : null);

/** Display string for one custom-field value. */
export function formatFieldValue(field, value) {
  if (value === '' || value == null) return '';
  if (field.type === 'number') return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (field.type === 'date') {
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  return String(value);
}

/** Searchable text from an item's labels and custom field values. */
export function organizeText(state, item) {
  const parts = labelsOf(state, item).map((l) => l.name);
  const tpl = templateOf(state, item);
  if (tpl) {
    parts.push(tpl.name);
    for (const f of tpl.fields) { const v = item.meta.values?.[f.id]; if (v !== '' && v != null) parts.push(String(v)); }
  }
  return parts.join(' ').toLowerCase();
}

export const isPinned = (state, id) => (state.settings.pinned || []).includes(id);

/** People who can see the item (for @mentions and presence), excluding nobody. */
export function peopleWithAccess(state, item) {
  if (!item) return [];
  const ids = new Set();
  if (item.space?.startsWith('t')) state.teams.find((t) => t.id === item.space)?.members.forEach((m) => ids.add(m.userId));
  else {
    ids.add(item.ownerId);
    effectiveShares(state.items, item.id).forEach((s) => ids.add(s.userId));
  }
  return state.users.filter((u) => ids.has(u.id));
}

/** Bytes per space (My Folders, each team folder), from one pass over the items. */
const usageBySpace = perItems((state) => {
  const m = new Map();
  for (const i of Object.values(state.items)) if (i.type === 'file') m.set(i.space, (m.get(i.space) || 0) + (i.size || 0));
  return m;
});
export const teamUsage = (state, teamId) => usageBySpace(state).get(teamId) || 0;
export const myUsage = (state) => usageBySpace(state).get('my') || 0;

/**
 * Would adding `bytes` to `space` go over its quota? Returns an error message, or null when it fits.
 * My Folders use the per-user quota; team folders use the team's quota.
 */
export function quotaError(state, space, bytes) {
  if (!bytes) return null;
  if (space === 'my') {
    if (myUsage(state) + bytes > state.org.userQuota) return 'Not enough storage space in My Folders';
  } else if (space && space.startsWith('t')) {
    const t = state.teams.find((x) => x.id === space);
    if (t?.quota && teamUsage(state, space) + bytes > t.quota) return `Not enough storage space in ${t.name}`;
  }
  return null;
}

export function usageByCategory(state, filterFn) {
  const out = {};
  for (const i of itemList(state)) {
    if (i.type !== 'file' || !filterFn(i)) continue;
    out[i.ext] = (out[i.ext] || 0) + i.size;
  }
  return out;
}

/** Folders the current user can write into (for pickers). */
export function writableFolders(state) {
  const items = state.items;
  const res = [];
  const walk = (parentId, space, depth, prefix) => {
    const kids = Object.values(items)
      .filter((i) => i.type === 'folder' && !i.trashed && i.parentId === parentId && (parentId ? true : i.space === space))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const k of kids) {
      res.push({ id: k.id, space, name: k.name, depth, path: `${prefix} / ${k.name}` });
      walk(k.id, space, depth + 1, `${prefix} / ${k.name}`);
    }
  };
  res.push({ id: null, space: 'my', name: 'My Folders', depth: 0, path: 'My Folders', root: true });
  walk(null, 'my', 1, 'My Folders');
  for (const t of state.teams) {
    const role = teamRoleOf(state, t.id);
    if (!role || role === 'viewer') continue;
    res.push({ id: null, space: t.id, name: t.name, depth: 0, path: t.name, root: true, team: true });
    walk(null, t.id, 1, t.name);
  }
  return res;
}

export function uniqueName(state, name, parentId, space, excludeId) {
  const siblings = new Set(
    Object.values(state.items)
      .filter((i) => !i.trashed && i.id !== excludeId && i.parentId === (parentId || null) && (parentId ? true : i.space === space))
      .map((i) => i.name.toLowerCase()),
  );
  if (!siblings.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 1;
  while (siblings.has(`${base} (${n})${ext}`.toLowerCase())) n++;
  return `${base} (${n})${ext}`;
}

export function userById(state, id) {
  return state.users.find((u) => u.id === id);
}
