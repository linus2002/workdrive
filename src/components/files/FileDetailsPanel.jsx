import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Share2, Download, Star, ExternalLink, Link2, Info, Activity, Lock, Unlock, Globe2, Building2, MessageSquare, History, FolderOpen, ShieldCheck } from 'lucide-react';
import { useDrive } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { useItemActions } from '../../store/useItemActions';
import { accessOf, canEdit, canModify, canForceUnlock, effectiveShares, folderRoute, folderSize, itemCount, locationOf, spaceRoute, openCommentCount, versionNo, labelsOf, templateOf, formatFieldValue, shortcutTarget, holdOn } from '../../store/selectors';
import { LabelChip } from '../dialogs/OrganizeDialogs';
import { WorkflowSection } from './Workflow';
import { SignSection } from '../../signatures/SignUI';
import TextPanel from '../../search/TextPanel';
import SensitivePanel from '../../dlp/SensitivePanel';
import { CommentsTab, VersionsTab, LockBanner, PresenceStack, useLockActions } from './Collaboration';
import { formatDateTime, formatSize, formatDate } from '../../utils/format';
import { getFileType } from '../../utils/fileTypes';
import { Avatar, EmptyState, FileIcon, thumbUrl, FolderGlyph } from '../common';
import { usePdfThumb } from './usePdfThumb';

const ROLE = { viewer: 'Viewer', commenter: 'Commenter', editor: 'Editor' };

const FILE_ONLY_TABS = ['comments', 'versions'];

/** Details for a shortcut: what it points to, where that lives, and where the shortcut itself is. */
function ShortcutDetails({ item }) {
  const { state } = useDrive();
  const actions = useItemActions();
  const navigate = useNavigate();
  const target = shortcutTarget(state, item);
  const parent = item.parentId ? state.items[item.parentId] : null;
  const owner = state.users.find((u) => u.id === item.ownerId);
  return (
    <>
      <div className="details-hero">
        <div className="details-icon"><FileIcon item={item} size={52} /></div>
        <div className="details-name" title={item.name}>{item.name}</div>
        <div className="details-type">Shortcut</div>
        {!item.trashed && target && (
          <div className="details-actions">
            <button className="btn btn-primary btn-sm" onClick={() => actions.open(item)}><ExternalLink size={14} /> Open {target.type === 'folder' ? 'folder' : 'file'}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => actions.showInFolder(target)}><FolderOpen size={14} /> Show original</button>
          </div>
        )}
      </div>
      <div className="details-body">
        {!target && <div className="banner warning">The original was deleted, moved to Trash, or you no longer have access. You can remove this shortcut.</div>}
        <dl className="info-list">
          <dt>Points to</dt><dd>{target ? <button className="link-btn wrap" onClick={() => actions.open(item)}>{target.name}</button> : <span className="muted">Unavailable</span>}</dd>
          {target && <><dt>Original in</dt><dd><button className="link-btn wrap" onClick={() => actions.showInFolder(target)}>{locationOf(state, target)}</button></dd></>}
          {target?.type === 'file' && <><dt>Size</dt><dd>{formatSize(target.size)}</dd><dt>Modified</dt><dd>{formatDateTime(target.modifiedAt)}</dd></>}
          <dt>Shortcut in</dt><dd><button className="link-btn wrap" onClick={() => navigate(parent ? folderRoute(parent) : spaceRoute(item.space))}>{locationOf(state, item)}</button></dd>
          <dt>Created</dt><dd>{formatDateTime(item.createdAt)}{owner ? ` by ${owner.id === state.meId ? 'me' : owner.name}` : ''}</dd>
        </dl>
        <p className="muted small">A shortcut doesn't copy anything. Changes to the original show up everywhere, and removing the shortcut leaves the original untouched.</p>
      </div>
    </>
  );
}

export function DetailsContent(props) {
  return props.item.type === 'shortcut' ? <ShortcutDetails item={props.item} /> : <ItemDetails {...props} />;
}

function ItemDetails({ item, compact, initialTab, onTabChange }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const actions = useItemActions();
  const navigate = useNavigate();
  const lockActions = useLockActions();
  const isFile = item.type === 'file';
  const allowed = (t) => t && (isFile || !FILE_ONLY_TABS.includes(t));
  const [tab, setTabState] = useState(() => {
    const req = ui.detailsTab;
    if (req.id === item.id && Date.now() - req.at < 1500 && allowed(req.tab)) return req.tab; // just asked for, as this view opened
    return allowed(initialTab) ? initialTab : 'details';
  });
  const setTab = (t) => { setTabState(t); onTabChange?.(t); };
  // Follow "open comments / version history" requests from menus and the preview toolbar.
  const lastReq = useRef(ui.detailsTab.n);
  useEffect(() => {
    if (ui.detailsTab.n === lastReq.current) return;
    lastReq.current = ui.detailsTab.n;
    if (allowed(ui.detailsTab.tab) && (!ui.detailsTab.id || ui.detailsTab.id === item.id)) setTab(ui.detailsTab.tab);
  }, [ui.detailsTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [desc, setDesc] = useState(item.description || '');
  useEffect(() => setDesc(item.description || ''), [item.id, item.description]);

  const access = accessOf(state, item);
  const editable = canEdit(access);
  const modifiable = canModify(state, item);
  const comments = openCommentCount(item);
  const labels = labelsOf(state, item);
  const tpl = templateOf(state, item);
  const hold = holdOn(state, item.id);
  const owner = state.users.find((u) => u.id === item.ownerId);
  const modBy = state.users.find((u) => u.id === item.modifiedBy);
  const shares = effectiveShares(state.items, item.id);
  const team = item.space.startsWith('t') ? state.teams.find((t) => t.id === item.space) : null;
  const pdfThumb = usePdfThumb(item);
  const thumb = thumbUrl(item);
  const activity = state.audit.filter((a) => a.itemId === item.id || a.target === item.name).slice(0, 25);
  const parent = item.parentId ? state.items[item.parentId] : null;

  const goLocation = () => navigate(parent ? folderRoute(parent) : spaceRoute(item.space));

  return (
    <>
      <div className="details-hero">
        {thumb ? <img src={thumb} alt="" className="details-thumb" /> : pdfThumb ? <img src={pdfThumb} alt={`First page of ${item.name}`} className="details-thumb pdf" /> : (
          <div className="details-icon">{item.type === 'folder' ? <FolderGlyph size={56} shared={item.sharedWith?.length > 0} color={item.color || team?.color || undefined} /> : <FileIcon item={item} size={52} />}</div>
        )}
        <div className="details-name" title={item.name}>{item.name}</div>
        <div className="details-type">{item.type === 'folder' ? 'Folder' : getFileType(item.ext).name}</div>
        {!item.trashed && (
          <div className="details-actions">
            <button className="icon-btn bordered" onClick={() => actions.open(item, [item])} data-tip="Open" aria-label="Open"><ExternalLink size={16} /></button>
            <button className="icon-btn bordered" onClick={() => ui.openDialog('share', { id: item.id })} data-tip="Share" aria-label="Share"><Share2 size={16} /></button>
            <button className="icon-btn bordered" onClick={() => actions.download([item])} data-tip="Download" aria-label="Download"><Download size={16} /></button>
            <button className="icon-btn bordered" onClick={() => actions.copyLink(item)} data-tip="Copy link" aria-label="Copy link"><Link2 size={16} /></button>
            <button className={`icon-btn bordered ${item.favorite ? 'fav-on' : ''}`} onClick={() => actions.setFavorite([item], !item.favorite)} data-tip={item.favorite ? 'Remove favorite' : 'Add to favorites'} aria-label="Toggle favorite">
              <Star size={16} fill={item.favorite ? 'currentColor' : 'none'} />
            </button>
            {isFile && !item.lock && editable && (
              <button className="icon-btn bordered" onClick={() => lockActions.lock(item)} data-tip="Lock file" aria-label="Lock file"><Lock size={16} /></button>
            )}
            {isFile && item.lock && canForceUnlock(state, item) && (
              <button className="icon-btn bordered lock-on" onClick={() => lockActions.unlock(item)} data-tip="Unlock file" aria-label="Unlock file"><Unlock size={16} /></button>
            )}
          </div>
        )}
        {isFile && <PresenceStack item={item} />}
      </div>
      {isFile && item.lock && <div className="details-lock"><LockBanner item={item} /></div>}

      <div className="tabs small" role="tablist">
        <button role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}><Info size={14} /> Details</button>
        <button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}><Activity size={14} /> Activity</button>
        {isFile && (
          <button role="tab" aria-selected={tab === 'comments'} className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>
            <MessageSquare size={14} /> Comments{comments > 0 && <span className="tab-count">{comments}</span>}
          </button>
        )}
        {isFile && <button role="tab" aria-selected={tab === 'versions'} className={tab === 'versions' ? 'active' : ''} onClick={() => setTab('versions')}><History size={14} /> Versions</button>}
      </div>

      {tab === 'comments' && isFile ? <CommentsTab item={item} /> : tab === 'versions' && isFile ? <VersionsTab item={item} /> : tab === 'details' ? (
        <div className="details-body">
          {hold && <div className="banner hold"><ShieldCheck size={16} /> <span>On legal hold: <strong>{hold.name}</strong>. It can't be permanently deleted while the hold is active.</span></div>}
          <SensitivePanel item={item} />
          {!item.trashed && <WorkflowSection item={item} />}
          <SignSection item={item} />
          <dl className="info-list">
            <dt>Type</dt><dd>{item.type === 'folder' ? 'Folder' : `${getFileType(item.ext).name} (.${item.ext})`}</dd>
            {isFile && <><dt>Version</dt><dd><button className="link-btn" onClick={() => setTab('versions')}>v{versionNo(item)}{item.versions?.length ? ` · ${item.versions.length} earlier` : ''}</button></dd></>}
            <dt>Size</dt><dd>{item.type === 'folder' ? `${formatSize(folderSize(state.items, item.id))} · ${itemCount(state.items, item.id)} item${itemCount(state.items, item.id) === 1 ? '' : 's'}` : formatSize(item.size)}</dd>
            <dt>Location</dt><dd><button className="link-btn wrap" onClick={goLocation}>{locationOf(state, item)}</button></dd>
            <dt>Owner</dt><dd className="with-avatar"><Avatar user={owner} size={20} />{owner?.id === state.meId ? 'Me' : owner?.name}</dd>
            <dt>Modified</dt><dd>{formatDateTime(item.modifiedAt)}{modBy ? ` by ${modBy.id === state.meId ? 'me' : modBy.name}` : ''}</dd>
            <dt>Created</dt><dd>{formatDateTime(item.createdAt)}</dd>
            {item.uploadedBy && (
              <><dt>Uploaded by</dt><dd>{item.uploadedBy.name}{item.uploadedBy.email ? <span className="muted block small">{item.uploadedBy.email}</span> : null}<span className="muted block small">via file request</span></dd></>
            )}
            {item.lastOpened && <><dt>Opened</dt><dd>{formatDateTime(item.lastOpened)}</dd></>}
            {item.trashed && <><dt>Deleted</dt><dd>{formatDateTime(item.trashedAt)}</dd></>}
            <dt>Your access</dt><dd className="cap">{access}</dd>
          </dl>

          <div className="details-section">
            <div className="details-section-head">
              <span>Who has access</span>
              {!item.trashed && <button className="link-btn" onClick={() => ui.openDialog('share', { id: item.id })}>Manage</button>}
            </div>
            {team ? (
              <div className="access-row"><FolderGlyph size={20} color={team.color} team /><span className="grow">Team: {team.name}</span><span className="muted">{team.members.length} member{team.members.length === 1 ? '' : 's'}</span></div>
            ) : (
              <div className="access-row"><Avatar user={owner} size={24} /><span className="grow truncate">{owner?.name}</span><span className="muted">Owner</span></div>
            )}
            {shares.map((s) => {
              const u = state.users.find((x) => x.id === s.userId);
              return (
                <div key={s.userId} className="access-row">
                  <Avatar user={u} size={24} /><span className="grow truncate">{u?.name}{s.inheritedFrom && <span className="muted"> · via {s.inheritedFrom}</span>}</span>
                  <span className="muted">{ROLE[s.role]}</span>
                </div>
              );
            })}
            <div className="access-row link-row">
              {item.link?.enabled ? (item.link.access === 'anyone' ? <Globe2 size={16} /> : <Building2 size={16} />) : <Lock size={16} />}
              <span className="grow">{item.link?.enabled ? (item.link.access === 'anyone' ? 'Anyone with the link' : `Anyone at ${state.org.name}`) : 'Link sharing off'}</span>
              {item.link?.enabled && <span className="muted">{ROLE[item.link.role]}</span>}
            </div>
          </div>

          <div className="details-section">
            <div className="details-section-head">
              <span>Labels</span>
              {editable && !item.trashed && <button className="link-btn" onClick={() => ui.openDialog('labels', { ids: [item.id] })}>{labels.length ? 'Edit' : 'Add'}</button>}
            </div>
            {labels.length ? (
              <div className="chip-row">
                {labels.map((l) => (
                  <LabelChip key={l.id} label={l} onClick={(x) => navigate(`/search?label=${x.id}`)}
                    onRemove={editable && !item.trashed ? (x) => api.setLabel([item.id], x.id, false) : undefined} />
                ))}
              </div>
            ) : <div className="muted small">No labels</div>}
          </div>

          {isFile && (tpl || modifiable) && (
            <div className="details-section">
              <div className="details-section-head">
                <span>Custom fields{tpl ? <span className="muted"> · {tpl.name}</span> : ''}</span>
                {modifiable && !item.trashed && <button className="link-btn" onClick={() => ui.openDialog('metadata', { id: item.id })}>{tpl ? 'Edit' : 'Add'}</button>}
              </div>
              {tpl ? (
                <dl className="info-list meta-list">
                  {tpl.fields.map((f) => {
                    const v = formatFieldValue(f, item.meta.values?.[f.id]);
                    return <Fragment key={f.id}><dt>{f.name}</dt><dd className={v ? '' : 'muted'}>{v || '—'}</dd></Fragment>;
                  })}
                </dl>
              ) : <div className="muted small">Attach a data template such as Invoice or Contract to record structured details.</div>}
            </div>
          )}

          <TextPanel item={item} />

          <div className="details-section">
            <label className="details-section-head" htmlFor={`desc-${item.id}`}><span>Description</span></label>
            <textarea id={`desc-${item.id}`} className="input textarea" rows={3} value={desc} disabled={!modifiable || item.trashed}
              placeholder={modifiable ?'Add a description…' : 'No description'} onChange={(e) => setDesc(e.target.value)}
              onBlur={() => { if (desc !== (item.description || '')) { api.updateItem(item.id, { description: desc }, { touch: false }); ui.toast('Description saved', { type: 'success' }); } }} />
          </div>
        </div>
      ) : (
        <div className="details-body">
          {activity.length === 0 && <EmptyState compact icon={Activity} title="No recent activity" text="Edits, shares and downloads will show up here." />}
          <ul className="activity-list">
            {activity.map((a) => {
              const u = state.users.find((x) => x.id === a.actorId);
              return (
                <li key={a.id}>
                  <Avatar user={u} size={26} />
                  <div className="min0">
                    <div><strong>{u?.id === state.meId ? 'You' : u?.name}</strong> · {a.action.toLowerCase()}</div>
                    {a.details && <div className="muted small truncate">{a.details}</div>}
                    <div className="muted small">{formatDate(a.at)}</div>
                  </div>
                </li>
              );
            })}
            <li>
              <Avatar user={owner} size={26} />
              <div><div><strong>{owner?.id === state.meId ? 'You' : owner?.name}</strong> · created this {item.type}</div><div className="muted small">{formatDate(item.createdAt)}</div></div>
            </li>
          </ul>
        </div>
      )}
    </>
  );
}

export default function FileDetailsPanel({ item, onClose, selectionCount }) {
  return (
    <aside className="details-panel slide-in" aria-label="Details">
      <div className="details-head">
        <strong>Details</strong>
        <button className="icon-btn" onClick={onClose} aria-label="Close details"><X size={18} /></button>
      </div>
      <div className="details-scroll">
        {selectionCount > 1 ? (
          <EmptyState compact icon={Info} title={`${selectionCount} items selected`} text="Select a single item to view its details." />
        ) : item ? (
          <DetailsContent key={item.id} item={item} />
        ) : (
          <EmptyState compact icon={Info} title="No item selected" text="Select a file or folder to see its details and activity." />
        )}
      </div>
    </aside>
  );
}
