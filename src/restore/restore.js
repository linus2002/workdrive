// "Restore a folder to a date": rebuild what each item looked like at time T from the change journal,
// then plan the operations that bring a folder (or a whole team space) back to that state.
import { descendantIds, lockedByOther } from '../store/selectors';

const snap = (it) => ({ name: it.name, parentId: it.parentId, space: it.space, trashed: !!it.trashed, version: it.version || 1, type: it.type, ext: it.ext, size: it.size });

/** Map of itemId -> snapshot at time T (null = didn't exist then). Covers current items and items in the journal. */
export function stateAt(state, T) {
  const journal = state.journal || [];
  const firstAfter = new Map(); // itemId -> first journal entry after T
  for (const e of journal) if (e.at > T && !firstAfter.has(e.itemId)) firstAfter.set(e.itemId, e);
  const out = new Map();
  const ids = new Set([...Object.keys(state.items), ...journal.map((e) => e.itemId)]);
  for (const id of ids) {
    const e = firstAfter.get(id);
    const cur = state.items[id];
    if (e) out.set(id, e.kind === 'create' ? null : e.before);
    else if (cur) {
      // No journal entry since T: the item is as it is now — except what we can safely infer from older data.
      if ((cur.createdAt || 0) > T) { out.set(id, null); continue; } // created after T, before journaling began
      const s = snap(cur);
      if (cur.trashed && cur.trashedAt && cur.trashedAt > T) s.trashed = false; // put in Trash after T
      out.set(id, s);
    }
    else out.set(id, null); // gone before T
  }
  return out;
}

/** scope: { folderId } (everything inside that folder) or { space } (a whole team folder). */
function inScope(scope, getParent, getSpace, id) {
  if (scope.space) return getSpace(id) === scope.space;
  let p = getParent(id); let guard = 0;
  while (p && guard++ < 200) { if (p === scope.folderId) return true; p = getParent(p); }
  return false;
}

const KIND_LABEL = { rename: 'Rename back', move: 'Move back', untrash: 'Restore from Trash', retrash: 'Move back to Trash', revert: 'Revert content', trash: 'Move to Trash (added later)' };
export { KIND_LABEL };

/**
 * Plan a restore. Returns {
 *   ops: [{ itemId, name, kinds, patch, versionId, detail }],
 *   gone: [{ itemId, name }]  — existed at T but were permanently deleted since (can't be brought back),
 *   skipped: [{ itemId, name, reason }]
 * }
 */
export function planRestore(state, scope, T) {
  const at = stateAt(state, T);
  const parentAt = (id) => at.get(id)?.parentId ?? state.items[id]?.parentId ?? null;
  const spaceAt = (id) => at.get(id)?.space ?? state.items[id]?.space;
  const parentNow = (id) => state.items[id]?.parentId ?? null;
  const spaceNow = (id) => state.items[id]?.space;
  const scopeIds = new Set();
  for (const [id, s] of at) if (s && inScope(scope, parentAt, spaceAt, id)) scopeIds.add(id);
  const nowIn = scope.space ? Object.values(state.items).filter((i) => i.space === scope.space).map((i) => i.id) : descendantIds(state.items, scope.folderId);
  nowIn.forEach((id) => { if (inScope(scope, parentNow, spaceNow, id)) scopeIds.add(id); });
  if (scope.folderId) scopeIds.delete(scope.folderId);

  const ops = []; const gone = []; const skipped = [];
  for (const id of scopeIds) {
    const then = at.get(id); const cur = state.items[id];
    if (then && !cur) { gone.push({ itemId: id, name: then.name }); continue; }
    if (!cur) continue;
    if (!then) {
      // Added after T: take it out of the way (to Trash), never delete.
      if (!cur.trashed) ops.push({ itemId: id, name: cur.name, kinds: ['trash'], patch: { trashed: true, trashedAt: Date.now() }, detail: 'Added after this point' });
      continue;
    }
    const kinds = []; const patch = {}; const notes = [];
    if (then.name !== cur.name) { kinds.push('rename'); patch.name = then.name; notes.push(`“${cur.name}” → “${then.name}”`); }
    if ((then.parentId || null) !== (cur.parentId || null) || then.space !== cur.space) {
      const parent = then.parentId ? state.items[then.parentId] : null;
      const parentOk = !then.parentId || (parent && (!parent.trashed || at.get(then.parentId)?.trashed === false));
      kinds.push('move');
      Object.assign(patch, parentOk ? { parentId: then.parentId || null, space: then.space } : { parentId: scope.folderId || null, space: then.space });
      notes.push(parentOk ? `back to ${then.parentId ? `“${parent.name}”` : 'the top level'}` : 'original folder is gone: to the top of this folder');
    }
    if (then.trashed !== !!cur.trashed) {
      if (cur.trashed) { kinds.push('untrash'); Object.assign(patch, { trashed: false, trashedAt: null, trashedBy: null }); }
      else { kinds.push('retrash'); Object.assign(patch, { trashed: true, trashedAt: Date.now() }); }
    }
    let versionId = null;
    if (cur.type === 'file' && (cur.version || 1) !== then.version) {
      const v = (cur.versions || []).find((x) => x.no === then.version);
      if (v) { kinds.push('revert'); versionId = v.id; notes.push(`content back to version ${then.version}`); }
      else skipped.push({ itemId: id, name: cur.name, reason: `Version ${then.version} is no longer kept, so its content can't be reverted` });
    }
    if (!kinds.length) continue; // unchanged since then
    // Someone else has it checked out: leave it alone (only reported when it actually needed restoring).
    if (lockedByOther(state, cur)) { skipped.push({ itemId: id, name: cur.name, reason: 'Locked by another user' }); continue; }
    ops.push({ itemId: id, name: cur.name, kinds, patch, versionId, detail: notes.join(' · ') });
  }
  // Items left where they are (locked, or not needed) can make the planned moves form a loop (A inside B inside A),
  // which would hide both from the tree. Any move that would end up inside itself goes to the top instead.
  const newParent = new Map(ops.filter((o) => 'parentId' in o.patch).map((o) => [o.itemId, o.patch.parentId || null]));
  const parentAfter = (id) => (newParent.has(id) ? newParent.get(id) : state.items[id]?.parentId ?? null);
  for (const op of ops) {
    if (!newParent.has(op.itemId)) continue;
    let p = parentAfter(op.itemId);
    for (let n = 0; p && n < 1000; n++) {
      if (p === op.itemId) {
        op.patch.parentId = scope.folderId || null;
        newParent.set(op.itemId, op.patch.parentId);
        op.detail = [op.detail, 'its old place would put it inside itself: to the top of this folder'].filter(Boolean).join(' · ');
        break;
      }
      p = parentAfter(p);
    }
  }
  // Parents before children (untrash/move a folder before its contents), then by name.
  const depth = (id) => { let d = 0; let p = state.items[id]?.parentId; while (p && d < 200) { d++; p = state.items[p]?.parentId; } return d; };
  ops.sort((a, b) => depth(a.itemId) - depth(b.itemId) || a.name.localeCompare(b.name));
  return { ops, gone, skipped };
}

/** Human-readable description of one journal entry (what changed). */
export function describeEntry(state, entry) {
  const journal = state.journal || [];
  const next = journal.find((e) => e.itemId === entry.itemId && e.at > entry.at && e.id !== entry.id);
  const after = next ? next.before : state.items[entry.itemId] ? snap(state.items[entry.itemId]) : null;
  const b = entry.before;
  const name = (after || b)?.name || 'an item';
  if (entry.kind === 'create') return { text: `added “${name}”`, name };
  if (entry.kind === 'delete') return { text: `permanently deleted “${b.name}”`, name: b.name };
  if (!after) return { text: `changed “${b.name}”`, name: b.name };
  const parts = [];
  if (b.name !== after.name) parts.push(`renamed “${b.name}” to “${after.name}”`);
  if (!b.trashed && after.trashed) parts.push(`moved “${after.name}” to Trash`);
  if (b.trashed && !after.trashed) parts.push(`restored “${after.name}” from Trash`);
  if ((b.parentId || null) !== (after.parentId || null) || b.space !== after.space) parts.push(`moved “${after.name}”`);
  if (b.version !== after.version) parts.push(`${after.version > b.version ? 'edited' : 'changed the version of'} “${after.name}”`);
  return { text: parts.join(', ') || `changed “${after.name}”`, name: after.name };
}

/** Journal entries inside a scope, newest first. */
export function scopeHistory(state, scope, limit = 40) {
  const now = new Map(Object.values(state.items).map((i) => [i.id, i]));
  const parentOf = (id, e) => (e?.before?.parentId ?? now.get(id)?.parentId ?? null);
  const spaceOf = (id, e) => (e?.before?.space ?? now.get(id)?.space);
  return [...(state.journal || [])].reverse().filter((e) => {
    if (scope.space) return spaceOf(e.itemId, e) === scope.space || now.get(e.itemId)?.space === scope.space;
    let p = parentOf(e.itemId, e); let g = 0;
    while (p && g++ < 200) { if (p === scope.folderId) return true; p = now.get(p)?.parentId ?? null; }
    let q = now.get(e.itemId)?.parentId; g = 0;
    while (q && g++ < 200) { if (q === scope.folderId) return true; q = now.get(q)?.parentId; }
    return false;
  }).slice(0, limit);
}
