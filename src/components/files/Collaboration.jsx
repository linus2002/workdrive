import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Send, CheckCircle2, RotateCcw, Trash2, PenLine, Reply, History, Upload, Download, Lock, Unlock, Eye, GitCompare } from 'lucide-react';
import { comparable } from '../../viewing/CompareDialog';
import { useDrive, versionKey } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { fileBlob } from '../../store/useItemActions';
import { usePresence } from '../../store/usePresence';
import {
  accessOf, canCommentAccess, canManage, canModify, canForceUnlock, lockedByOther, peopleWithAccess, versionNo, quotaError,
} from '../../store/selectors';
import { formatDate, formatDateTime, formatSize, splitName } from '../../utils/format';
import { getFileType } from '../../utils/fileTypes';
import { saveBlob } from '../../utils/exporters';
import { Avatar, EmptyState } from '../common';

const nameOf = (state, id) => (id === state.meId ? 'You' : state.users.find((u) => u.id === id)?.name || 'Unknown user');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ------------------------------------------------------------------ */
/* Comment text with highlighted @mentions                             */
/* ------------------------------------------------------------------ */
function CommentText({ text, users }) {
  const parts = useMemo(() => {
    const names = users.map((u) => escapeRe(u.name)).sort((a, b) => b.length - a.length);
    if (!names.length) return [text];
    return text.split(new RegExp(`(@(?:${names.join('|')}))`, 'g'));
  }, [text, users]);
  return (
    <div className="comment-text">
      {parts.map((p, i) => (p.startsWith('@') && users.some((u) => `@${u.name}` === p) ? <span key={i} className="mention">{p}</span> : p))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Textarea with @mention suggestions                                  */
/* ------------------------------------------------------------------ */
function MentionInput({ item, value, onChange, onSubmit, onCancel, placeholder, autoFocus, submitLabel = 'Comment' }) {
  const { state } = useDrive();
  const ref = useRef(null);
  const [query, setQuery] = useState(null); // text after "@" while choosing, or null
  const [active, setActive] = useState(0);

  const withAccess = useMemo(() => new Set(peopleWithAccess(state, item).map((u) => u.id)), [state, item]);
  const suggestions = useMemo(() => {
    if (query == null) return [];
    const q = query.toLowerCase();
    return state.users
      .filter((u) => u.id !== state.meId && u.status !== 'disabled' && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().startsWith(q)))
      .sort((a, b) => Number(withAccess.has(b.id)) - Number(withAccess.has(a.id)) || a.name.localeCompare(b.name))
      .slice(0, 6);
  }, [query, state.users, state.meId, withAccess]);

  const detect = (text, caret) => {
    const m = text.slice(0, caret).match(/(?:^|\s)@([^\s@][^@\n]{0,24})?$/);
    setQuery(m ? (m[1] || '') : null);
    setActive(0);
  };

  const pick = (u) => {
    const el = ref.current;
    const caret = el.selectionStart;
    const before = value.slice(0, caret).replace(/@([^@\n]{0,25})$/, `@${u.name} `);
    const next = before + value.slice(caret);
    pendingCaret.current = before.length; // placed right after the new value renders, before the next keystroke
    onChange(next);
    setQuery(null);
  };
  const pendingCaret = useRef(null);
  useLayoutEffect(() => {
    if (pendingCaret.current == null || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [value]);

  const onKeyDown = (e) => {
    e.stopPropagation(); // keep file-browser shortcuts (Delete, F2, arrows) out of the composer
    if (suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[active]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (value.trim()) onSubmit(); }
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
  };

  return (
    <div className="mention-input">
      <textarea
        ref={ref} className="input textarea" rows={2} value={value} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={onKeyDown} onBlur={() => setTimeout(() => setQuery(null), 150)} aria-label={placeholder}
      />
      {suggestions.length > 0 && (
        <ul className="mention-list" role="listbox" aria-label="Mention someone">
          {suggestions.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === active}>
              <button type="button" className={i === active ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); pick(u); }}>
                <Avatar user={u} size={22} />
                <span className="min0 grow"><span className="truncate block">{u.name}</span><span className="muted small truncate block">{u.email}</span></span>
                {!withAccess.has(u.id) && <span className="pill pill-gray">No access</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mention-foot">
        <span className="muted small">Type @ to mention · Enter to send</span>
        <span className="grow" />
        {onCancel && <button type="button" className="btn btn-sm btn-secondary" onClick={onCancel}>Cancel</button>}
        <button type="button" className="btn btn-sm btn-primary" onClick={onSubmit} disabled={!value.trim()}><Send size={13} /> {submitLabel}</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Comments tab                                                        */
/* ------------------------------------------------------------------ */
function CommentItem({ item, c, replies, canComment, users, onReply, isReply }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.text);
  const author = state.users.find((u) => u.id === c.userId);
  const mine = c.userId === state.meId;
  const canDelete = mine || canManage(accessOf(state, item));

  const remove = () => ui.openDialog('confirm', {
    title: 'Delete comment?', message: replies?.length ? 'This comment and its replies will be deleted.' : 'This comment will be deleted.',
    confirmLabel: 'Delete', danger: true, onConfirm: () => { api.deleteComment(item.id, c.id); ui.toast('Comment deleted', { type: 'success' }); },
  });

  return (
    <div className={`comment ${isReply ? 'reply' : ''} ${c.resolved ? 'resolved' : ''}`}>
      <Avatar user={author} size={isReply ? 22 : 26} />
      <div className="min0 grow">
        <div className="comment-head">
          <strong className="truncate">{nameOf(state, c.userId)}</strong>
          <span className="muted small" title={formatDateTime(c.at)}>{formatDate(c.at)}{c.editedAt ? ' · edited' : ''}</span>
        </div>
        {editing ? (
          <MentionInput item={item} value={draft} onChange={setDraft} autoFocus submitLabel="Save" placeholder="Edit comment"
            onCancel={() => { setEditing(false); setDraft(c.text); }}
            onSubmit={() => { api.editComment(item.id, c.id, draft); setEditing(false); }} />
        ) : <CommentText text={c.text} users={users} />}
        {!editing && !item.trashed && (
          <div className="comment-actions">
            {!isReply && canComment && <button className="link-btn" onClick={onReply}><Reply size={13} /> Reply</button>}
            {!isReply && canComment && (c.resolved
              ? <button className="link-btn" onClick={() => api.resolveComment(item.id, c.id, false)}><RotateCcw size={13} /> Reopen</button>
              : <button className="link-btn" onClick={() => { api.resolveComment(item.id, c.id, true); ui.toast('Comment resolved', { type: 'success' }); }}><CheckCircle2 size={13} /> Resolve</button>)}
            {mine && <button className="link-btn" onClick={() => setEditing(true)}><PenLine size={13} /> Edit</button>}
            {canDelete && <button className="link-btn danger" onClick={remove}><Trash2 size={13} /> Delete</button>}
          </div>
        )}
        {c.resolved && !isReply && <div className="muted small resolved-note"><CheckCircle2 size={12} /> Resolved by {nameOf(state, c.resolvedBy)} · {formatDate(c.resolvedAt)}</div>}
      </div>
    </div>
  );
}

export function CommentsTab({ item }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [filter, setFilter] = useState('open');

  const access = accessOf(state, item);
  const canComment = canCommentAccess(access) && !item.trashed;
  const comments = item.comments || [];
  const top = comments.filter((c) => !c.parentId);
  const shown = top.filter((c) => (filter === 'all' ? true : filter === 'open' ? !c.resolved : c.resolved)).sort((a, b) => b.at - a.at);
  const counts = { open: top.filter((c) => !c.resolved).length, resolved: top.filter((c) => c.resolved).length };

  const notifyMentions = (comment) => {
    if (!comment.mentions.length) return;
    const withAccess = new Set(peopleWithAccess(state, item).map((u) => u.id));
    const names = comment.mentions.map((id) => state.users.find((u) => u.id === id)?.name.split(' ')[0]).filter(Boolean);
    const noAccess = comment.mentions.filter((id) => !withAccess.has(id));
    if (noAccess.length) {
      const who = noAccess.map((id) => state.users.find((u) => u.id === id)?.name).join(', ');
      ui.toast(`${who} can't open this file yet`, { type: 'info', action: { label: 'Share', onClick: () => ui.openDialog('share', { id: item.id }) } });
    } else {
      ui.toast(`${names.join(', ')} ${names.length === 1 ? 'was' : 'were'} notified`, { type: 'success' });
    }
  };

  const submit = () => {
    if (!draft.trim()) return;
    const c = api.addComment(item.id, draft);
    setDraft('');
    setFilter((f) => (f === 'resolved' ? 'open' : f));
    notifyMentions(c);
  };
  const submitReply = (parentId) => {
    if (!replyDraft.trim()) return;
    const c = api.addComment(item.id, replyDraft, parentId);
    setReplyDraft('');
    setReplyTo(null);
    notifyMentions(c);
  };

  return (
    <div className="details-body comments-tab">
      {canComment ? (
        <MentionInput item={item} value={draft} onChange={setDraft} onSubmit={submit} placeholder="Add a comment…" />
      ) : (
        <div className="notice muted small">{item.trashed ? 'Comments are read-only for items in Trash.' : 'You have view-only access. Ask the owner for commenter access to join the discussion.'}</div>
      )}

      {top.length > 0 && (
        <div className="seg-filter" role="tablist" aria-label="Filter comments">
          {[['open', `Open (${counts.open})`], ['resolved', `Resolved (${counts.resolved})`], ['all', 'All']].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      )}

      {top.length === 0 && <EmptyState compact icon={MessageSquare} title="No comments yet" text={canComment ? 'Start a discussion. Use @ to bring someone in.' : 'Comments from collaborators will show up here.'} />}
      {top.length > 0 && shown.length === 0 && <div className="muted small center-text">No {filter} comments.</div>}

      <div className="comment-threads">
        {shown.map((c) => {
          const replies = comments.filter((r) => r.parentId === c.id).sort((a, b) => a.at - b.at);
          return (
            <div key={c.id} className="comment-thread">
              <CommentItem item={item} c={c} replies={replies} canComment={canComment} users={state.users} onReply={() => { setReplyTo(c.id); setReplyDraft(''); }} />
              {replies.map((r) => <CommentItem key={r.id} item={item} c={r} canComment={canComment} users={state.users} isReply />)}
              {replyTo === c.id && (
                <div className="reply-box">
                  <MentionInput item={item} value={replyDraft} onChange={setReplyDraft} autoFocus submitLabel="Reply" placeholder="Write a reply…"
                    onCancel={() => setReplyTo(null)} onSubmit={() => submitReply(c.id)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Versions tab                                                        */
/* ------------------------------------------------------------------ */
const readAs = (file, kind) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  if (kind === 'text') r.readAsText(file); else r.readAsDataURL(file);
});

async function versionDownload(item, v) {
  const [base, ext] = splitName(item.name);
  const name = `${base} (version ${v.no})${ext ? `.${ext}` : ''}`;
  let blob = null;
  try { blob = await fileBlob({ ...item, id: versionKey(item.id, v.no), size: v.size, content: v.content, sheet: v.sheet, slides: v.slides, dataUrl: v.dataUrl, mime: v.mime }); } catch { blob = null; }
  if (blob) { saveBlob(blob, name); return true; }
  saveBlob(new Blob([`${item.name} — version ${v.no}\n\nThis sample version has no downloadable contents in the prototype.\n${v.content || ''}`], { type: 'text/plain' }), `${name}.txt`);
  return false;
}

export function VersionsTab({ item }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const inputRef = useRef(null);
  const [pending, setPending] = useState(null); // File waiting for a note
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const modifiable = canModify(state, item) && !item.trashed;
  const manager = canManage(accessOf(state, item));
  const versions = item.versions || [];
  const current = versionNo(item);
  const lockedOther = lockedByOther(state, item);

  const choose = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const [, ext] = splitName(file.name);
    if (ext !== item.ext) { ui.toast(`Choose a .${item.ext} file to upload as a new version of "${item.name}"`, { type: 'error' }); return; }
    setPending(file);
    setNote('');
  };

  const upload = async () => {
    if (!pending || busy) return;
    setBusy(true);
    const cat = getFileType(item.ext).category;
    const extra = {};
    try {
      if (cat === 'text' && pending.size < 1024 * 1024) extra.content = await readAs(pending, 'text');
      if (pending.size <= 400 * 1024 && ['image', 'pdf'].includes(cat)) extra.dataUrl = await readAs(pending, 'url');
    } catch { /* blob only */ }
    const overQuota = quotaError(state, item.space, Math.max(0, pending.size - (item.size || 0)));
    const ok = api.uploadVersion(item.id, pending, extra, note.trim());
    setBusy(false);
    if (ok) {
      setPending(null);
      ui.toast(`Uploaded version ${current + 1}`, { type: 'success' });
    } else if (overQuota) {
      ui.toast(`${overQuota}. Free up space or ask an admin for more, then try again.`, { type: 'error' });
    } else {
      setPending(null);
      ui.toast(lockedByOther(state, item) ? 'This file is locked by someone else' : 'Could not upload this version', { type: 'error' });
    }
  };

  const restore = (v) => ui.openDialog('confirm', {
    title: `Restore version ${v.no}?`,
    message: `Version ${v.no} becomes the current version (${current + 1}). The current version is kept in the history, so nothing is lost.`,
    confirmLabel: 'Restore',
    onConfirm: () => { const ok = api.restoreVersion(item.id, v.id); ui.toast(ok ? `Restored version ${v.no}` : 'Could not restore — the file is locked', { type: ok ? 'success' : 'error' }); },
  });

  const remove = (v) => ui.openDialog('confirm', {
    title: `Delete version ${v.no}?`, message: 'This version will be removed from the history permanently.', confirmLabel: 'Delete', danger: true,
    onConfirm: () => {
      if (api.deleteVersion(item.id, v.id) === false) ui.toast('This file is on legal hold: its versions are preserved', { type: 'warning' });
      else ui.toast(`Version ${v.no} deleted`, { type: 'success' });
    },
  });

  const download = async (v) => {
    const real = await versionDownload(item, v);
    api.logEvent('Version downloaded', item.name, `Version ${v.no}`, { itemId: item.id });
    ui.toast(real ? `Downloading version ${v.no}` : 'Sample version downloaded as a text placeholder', { type: real ? 'success' : 'info' });
  };

  return (
    <div className="details-body versions-tab">
      {lockedOther && <div className="notice warn small"><Lock size={13} /> Locked by {nameOf(state, item.lock.by)}. New versions can't be added until it's unlocked.</div>}
      {modifiable && !pending && (
        <>
          <input ref={inputRef} type="file" hidden accept={item.ext ? `.${item.ext}` : undefined} onChange={choose} />
          <button className="btn btn-secondary btn-block" onClick={() => inputRef.current?.click()}><Upload size={15} /> Upload new version</button>
        </>
      )}
      {pending && (
        <div className="version-upload">
          <div className="small"><strong className="truncate block">{pending.name}</strong><span className="muted">{formatSize(pending.size)} · becomes version {current + 1}</span></div>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') upload(); }} placeholder="What changed? (optional)" autoFocus aria-label="Version note" maxLength={120} />
          <div className="row-end">
            <button className="btn btn-sm btn-secondary" onClick={() => setPending(null)} disabled={busy}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={upload} disabled={busy}><Upload size={13} /> {busy ? 'Uploading…' : 'Upload'}</button>
          </div>
        </div>
      )}

      {versions.length > 0 && comparable(item) && (
        <button className="btn btn-ghost btn-block" onClick={() => ui.openDialog('compareVersions', { itemId: item.id })}><GitCompare size={15} /> Compare versions</button>
      )}
      <ol className="version-list" aria-label="Version history">
        <li className="version current">
          <span className="version-no">v{current}</span>
          <div className="min0 grow">
            <div className="version-head"><strong>Current version</strong><span className="pill pill-blue">Latest</span></div>
            <div className="muted small">{nameOf(state, item.modifiedBy)} · {formatDateTime(item.modifiedAt)} · {formatSize(item.size)}</div>
            {item.versionNote && <div className="version-note">{item.versionNote}</div>}
          </div>
        </li>
        {versions.map((v) => (
          <li key={v.id} className="version">
            <span className="version-no">v{v.no}</span>
            <div className="min0 grow">
              <div className="version-head"><strong>Version {v.no}</strong></div>
              <div className="muted small">{nameOf(state, v.by)} · {formatDateTime(v.at)} · {formatSize(v.size)}</div>
              {v.note && <div className="version-note">{v.note}</div>}
              <div className="comment-actions">
                {comparable(item) && <button className="link-btn" onClick={() => ui.openDialog('compareVersions', { itemId: item.id, left: v.id, right: 'current' })}><GitCompare size={13} /> Compare with current</button>}
                <button className="link-btn" onClick={() => download(v)}><Download size={13} /> Download</button>
                {modifiable && <button className="link-btn" onClick={() => restore(v)}><RotateCcw size={13} /> Restore</button>}
                {manager && !item.trashed && <button className="link-btn danger" onClick={() => remove(v)}><Trash2 size={13} /> Delete</button>}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {versions.length === 0 && <EmptyState compact icon={History} title="No earlier versions" text="Each time the file is edited or a new version is uploaded, the previous one is kept here." />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lock banner + presence                                              */
/* ------------------------------------------------------------------ */
export function useLockActions() {
  const { state, api } = useDrive();
  const ui = useUI();
  const lock = (item) => {
    api.lockItem(item.id);
    ui.toast(`"${item.name}" is locked. Others can view it but can't make changes.`, { type: 'success' });
  };
  const unlock = (item) => {
    if (item.lock?.by === state.meId) { api.unlockItem(item.id); ui.toast(`"${item.name}" unlocked`, { type: 'success' }); return; }
    ui.openDialog('confirm', {
      title: 'Force unlock?',
      message: `${nameOf(state, item.lock.by)} has this file checked out. Unlocking it may overwrite changes they haven't saved yet.`,
      confirmLabel: 'Unlock', danger: true,
      onConfirm: () => { api.unlockItem(item.id); ui.toast(`"${item.name}" unlocked`, { type: 'success' }); },
    });
  };
  return { lock, unlock };
}

export function LockBanner({ item }) {
  const { state } = useDrive();
  const { unlock } = useLockActions();
  if (!item.lock) return null;
  const mine = item.lock.by === state.meId;
  return (
    <div className={`lock-banner ${mine ? 'mine' : ''}`} role="status">
      <Lock size={14} />
      <span className="grow min0">
        {mine ? 'You locked this file' : <>Locked by <strong>{nameOf(state, item.lock.by)}</strong></>}
        <span className="muted small block">Since {formatDate(item.lock.at)}. {mine ? 'Others can view it but not change it.' : 'You can view it, but changes are blocked.'}</span>
      </span>
      {canForceUnlock(state, item) && !item.trashed && <button className="btn btn-sm btn-secondary" onClick={() => unlock(item)}><Unlock size={13} /> Unlock</button>}
    </div>
  );
}

/** Avatars of people who have the file open right now. */
export function PresenceStack({ item, dark, withLabel = true }) {
  const people = usePresence(item);
  if (!people.length) return null;
  const editing = people.filter((p) => p.mode === 'editing');
  const first = (p) => p.user.name.split(' ')[0];
  const label = editing.length
    ? `${first(editing[0])} is editing${people.length > 1 ? ` · ${people.length - 1} viewing` : ''}`
    : people.length === 1 ? `${first(people[0])} is viewing` : `${first(people[0])} and ${people.length - 1} other viewing`;
  return (
    <div className={`presence ${dark ? 'on-dark' : ''}`} aria-label={`Also here: ${people.map((p) => `${p.user.name} (${p.mode})`).join(', ')}`}>
      <div className="presence-stack">
        {people.map((p) => (
          <span key={p.user.id} className={`presence-ring ${p.mode}`} data-tip={`${p.user.name} · ${p.mode}`}><Avatar user={p.user} size={24} /></span>
        ))}
      </div>
      {withLabel && <span className="presence-label hide-sm">{editing.length ? <PenLine size={12} /> : <Eye size={12} />} {label}</span>}
    </div>
  );
}
