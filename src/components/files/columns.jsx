import { Link } from 'react-router-dom';
import { Users, Link2, Lock, ShieldCheck } from 'lucide-react';
import { Avatar } from '../common';
import { formatDate, formatSize } from '../../utils/format';
import { getFileType } from '../../utils/fileTypes';
import { t } from '../../i18n';
import { effectiveShares, folderSize, itemCount, locationOf, ancestors, spaceLabel, parentRoute, shortcutTarget, holdOn, blocksPermanentDelete } from '../../store/selectors';

// Cells render with the active language (t from ../../i18n); the views that show them re-render on a language change.
const ROLE_LABEL = { viewer: 'Viewer', commenter: 'Commenter', editor: 'Editor', owner: 'Owner' };

function SharedCell({ item, state }) {
  const shares = effectiveShares(state.items, item.id);
  const link = item.link?.enabled;
  if (item.space.startsWith('t')) {
    const team = state.teams.find((tm) => tm.id === item.space);
    return <span className="cell-shared"><Users size={14} /> {t('{n, plural, one {# member} other {# members}}', { n: team?.members.length || 0 })}</span>;
  }
  if (!shares.length && !link) return <span className="cell-shared muted"><Lock size={13} /> {t('Only you')}</span>;
  return (
    <span className="cell-shared shared">
      {shares.length > 0 && <><Users size={14} /> {t('{n, plural, one {# person} other {# people}}', { n: shares.length })}</>}
      {link && <span className="link-chip" title={t('Link sharing on')}><Link2 size={12} /></span>}
    </span>
  );
}

/** Size column for a shortcut: it takes no space, so say what it points to (or that it's broken). */
function ShortcutCell({ item, state }) {
  const target = shortcutTarget(state, item);
  return target ? <span title={t('Shortcut to {name}', { name: target.name })}>{t('Shortcut')}</span> : <span className="text-danger" title={t('The original was deleted or you lost access')}>{t('Broken shortcut')}</span>;
}

/** When Trash retention will permanently delete an item (or why it won't). */
function PurgeCell({ item, state }) {
  if (blocksPermanentDelete(state, item.id)) return <span className="hold-chip" title={holdOn(state, item.id)?.name || t('Legal hold')}><ShieldCheck size={12} /> {t('Legal hold')}</span>;
  const days = state.org.policies.trashRetentionDays;
  if (!days || !item.trashedAt) return <span className="cell-muted">{t('Never')}</span>;
  const left = Math.ceil((item.trashedAt + days * 86400000 - Date.now()) / 86400000);
  return <span className={`cell-muted ${left <= 7 ? 'text-danger' : ''}`}>{left <= 0 ? t('At next cleanup') : t('{n, plural, one {In # day} other {In # days}}', { n: left })}</span>;
}

function OwnerCell({ userId, state }) {
  const u = state.users.find((x) => x.id === userId);
  return <span className="cell-owner"><Avatar user={u} size={28} /><span className="truncate">{u ? (u.id === state.meId ? t('Me') : u.name) : t('Unknown')}</span></span>;
}

/** Column registry. Each column: label, sort (value getter), render, width */
export const COLUMNS = {
  owner: { get label() { return t('Owner'); }, width: '160px', sort: (i, s) => s.users.find((u) => u.id === i.ownerId)?.name || '', render: (i, s) => <OwnerCell userId={i.ownerId} state={s} /> },
  modified: { get label() { return t('Modified'); }, width: '150px', sort: (i) => i.modifiedAt, render: (i, s) => <span className="cell-muted" title={new Date(i.modifiedAt).toLocaleString()}>{formatDate(i.modifiedAt)}{i.modifiedBy && i.modifiedBy !== s.meId ? <span className="cell-sub"> {t('by {name}', { name: s.users.find((u) => u.id === i.modifiedBy)?.name.split(' ')[0] })}</span> : null}</span> },
  size: { get label() { return t('Size'); }, width: '110px', sort: (i, s) => (i.type === 'folder' ? -1 : i.size), render: (i, s) => <span className="cell-muted">{i.type === 'folder' ? t('{n, plural, one {# item} other {# items}}', { n: itemCount(s.items, i.id) }) : i.type === 'shortcut' ? <ShortcutCell item={i} state={s} /> : formatSize(i.size)}</span> },
  shared: { get label() { return t('Shared'); }, width: '140px', sort: (i, s) => effectiveShares(s.items, i.id).length + (i.link?.enabled ? 0.5 : 0), render: (i, s) => <SharedCell item={i} state={s} /> },
  type: { get label() { return t('Type'); }, width: '130px', sort: (i) => (i.type === 'folder' ? '' : i.type === 'shortcut' ? 'Shortcut' : getFileType(i.ext).name), render: (i) => <span className="cell-muted">{i.type === 'folder' ? t('Folder') : i.type === 'shortcut' ? t('Shortcut') : getFileType(i.ext).name}</span> },
  sharedBy: { get label() { return t('Shared by'); }, width: '170px', sort: (i, s) => s.users.find((u) => u.id === i.ownerId)?.name || '', render: (i, s) => <OwnerCell userId={i.sharedWith.find((x) => x.userId === s.meId)?.sharedBy || i.ownerId} state={s} /> },
  sharedOn: { get label() { return t('Shared on'); }, width: '130px', sort: (i, s) => i.sharedWith.find((x) => x.userId === s.meId)?.sharedAt || 0, render: (i, s) => <span className="cell-muted">{formatDate(i.sharedWith.find((x) => x.userId === s.meId)?.sharedAt)}</span> },
  permission: { get label() { return t('Permission'); }, width: '120px', sort: (i, s) => i.sharedWith.find((x) => x.userId === s.meId)?.role || '', render: (i, s) => { const r = effectiveShares(s.items, i.id).find((x) => x.userId === s.meId)?.role; return <span className={`pill pill-${r === 'editor' ? 'green' : r === 'commenter' ? 'amber' : 'gray'}`}>{ROLE_LABEL[r] ? t(ROLE_LABEL[r]) : '—'}</span>; } },
  sharedWith: { get label() { return t('Shared with'); }, width: '180px', sort: (i) => i.sharedWith.length, render: (i, s) => {
    const users = i.sharedWith.map((x) => s.users.find((u) => u.id === x.userId)).filter(Boolean);
    return <span className="cell-owner">{users.slice(0, 3).map((u) => <Avatar key={u.id} user={u} size={28} />)}<span className="cell-muted">{users.length ? t('{n, plural, one {# person} other {# people}}', { n: users.length }) : ''}{i.link?.enabled ? `${users.length ? ' + ' : ''}${t('link')}` : ''}</span></span>;
  } },
  lastOpened: { get label() { return t('Last opened'); }, width: '150px', sort: (i) => i.lastOpened || 0, render: (i) => <span className="cell-muted">{i.lastOpened ? formatDate(i.lastOpened) : '—'}</span> },
  location: { get label() { return t('Location'); }, width: '220px', sort: (i, s) => locationOf(s, i), render: (i, s) => (
    <Link className="cell-muted truncate cell-loc-link" to={`${parentRoute(s, i)}?highlight=${i.id}`} title={t('Show in {name}', { name: locationOf(s, i) })}
      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {locationOf(s, i)}
    </Link>
  ) },
  deletedOn: { get label() { return t('Deleted'); }, width: '140px', sort: (i) => i.trashedAt, render: (i) => <span className="cell-muted">{formatDate(i.trashedAt)}</span> },
  purgeIn: { get label() { return t('Auto-deletes'); }, width: '150px', sort: (i, s) => (blocksPermanentDelete(s, i.id) ? Infinity : i.trashedAt), render: (i, s) => <PurgeCell item={i} state={s} /> },
  originalLocation: { get label() { return t('Original location'); }, width: '220px', sort: (i, s) => locationOf(s, i), render: (i, s) => {
    const chain = ancestors(s.items, i.id).map((a) => a.name);
    const loc = [spaceLabel(s, i.space), ...chain].join(' / ');
    return <span className="cell-muted truncate" title={loc}>{loc}</span>;
  } },
  folderSize: { get label() { return t('Size'); }, width: '110px', sort: (i, s) => (i.type === 'folder' ? folderSize(s.items, i.id) : i.size), render: (i, s) => <span className="cell-muted">{formatSize(i.type === 'folder' ? folderSize(s.items, i.id) : i.size)}</span> },
};

export const nameSort = (i) => i.name.toLowerCase();
