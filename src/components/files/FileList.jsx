import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, MoreVertical, Share2, ChevronUp, ChevronDown, Download, RotateCcw, Lock, MessageSquare, Clock, XCircle, ShieldAlert } from 'lucide-react';
import { FileIcon, Highlight } from '../common';
import { openCommentCount, labelsOf } from '../../store/selectors';
import { approvalFor, APPROVAL_STATUS } from '../../utils/productivity';
import Snippet from '../../search/Snippet';
import { useSearchIndex } from '../../search/searchIndex';
import { findingsFor, topSeverity, summarize } from '../../dlp/dlp';

/** Up to two label chips next to a name (+N for the rest). Clicking a chip searches by that label. */
/** Labels in a table row: compact colour dots (names on hover) so rows stay uncluttered. Full chips are in details. */
export function RowLabels({ item, state, max = 3 }) {
  const navigate = useNavigate();
  const labels = labelsOf(state, item);
  if (!labels.length || item.trashed) return null;
  const names = labels.map((l) => l.name).join(', ');
  return (
    <span className="row-dots" title={`Labels: ${names}`} aria-label={`Labels: ${names}`} role="img">
      {labels.slice(0, max).map((l) => (
        // Mouse shortcut only (the dots aren't interactive for assistive tech; labels are searchable from details).
        <span key={l.id} className="row-dot" style={{ '--lc': l.color }} aria-hidden="true"
          onClick={(e) => { e.stopPropagation(); navigate(`/search?label=${l.id}`); }} />
      ))}
      {labels.length > max && <span className="label-more">+{labels.length - max}</span>}
    </span>
  );
}

/** Lock + open-comment indicators shown next to a file name. */
export function CollabBadges({ item, state }) {
  useSearchIndex(); // sensitive-data badges appear once the file's text is indexed
  if (item.type !== 'file' || item.trashed) return null;
  const dlp = findingsFor(state, item);
  const dlpSev = topSeverity(dlp);
  const comments = openCommentCount(item);
  const holder = item.lock ? (item.lock.by === state.meId ? 'you' : state.users.find((u) => u.id === item.lock.by)?.name || 'another user') : null;
  const approval = approvalFor(state, item.id);
  const ap = approval && approval.status !== 'approved' ? approval : null; // approved files already carry the label
  if (!holder && !comments && !ap && !dlpSev) return null;
  const ApIcon = ap?.status === 'pending' ? Clock : XCircle;
  return (
    <span className="collab-badges">
      {dlpSev && <span className={`collab-badge dlp-${dlpSev}`} title={`Sensitive data: ${summarize(dlp)}`} aria-label={`Contains sensitive data: ${summarize(dlp)}`}><ShieldAlert size={12} /></span>}
      {ap && <span className={`collab-badge appr-${ap.status}`} title={APPROVAL_STATUS[ap.status].label} aria-label={APPROVAL_STATUS[ap.status].label}><ApIcon size={12} /></span>}
      {holder && <span className={`collab-badge lock ${item.lock.by === state.meId ? 'mine' : ''}`} title={`Locked by ${holder}`} aria-label={`Locked by ${holder}`}><Lock size={12} /></span>}
      {comments > 0 && <span className="collab-badge" title={`${comments} open comment${comments === 1 ? '' : 's'}`} aria-label={`${comments} open comment${comments === 1 ? '' : 's'}`}><MessageSquare size={12} />{comments}</span>}
    </span>
  );
}
import { COLUMNS } from './columns';
import { t } from '../../i18n';
import { formatDate, formatSize } from '../../utils/format';
import { getFileType } from '../../utils/fileTypes';
import { useDropTarget, dragSourceProps } from './dnd';

function Checkbox({ checked, indeterminate, onChange, label }) {
  return (
    <span className="cb-wrap" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <input type="checkbox" className="cb" checked={checked} ref={(el) => { if (el) el.indeterminate = !!indeterminate; }} onChange={onChange} aria-label={label} />
    </span>
  );
}
export { Checkbox };

export const FileRow = memo(function FileRow({
  item, state, columns, selected, focused, onRowClick, onOpen, onContext, onMore, onQuickShare, onQuickDownload, onQuickRestore, toggleSelect,
  query, selectedIds, draggable, canDropInto, context, teamColor, showSnippets, rowIndex,
}) {
  const drop = useDropTarget(item.id, item.space, item.type === 'folder' && canDropInto);
  const sub = item.type === 'folder' ? t('Folder') : item.type === 'shortcut' ? t('Shortcut') : `${getFileType(item.ext).label} · ${formatSize(item.size)}`;
  return (
    <div
      className={`file-row ${selected ? 'selected' : ''} ${focused ? 'focused' : ''} ${drop.over ? 'drop-over' : ''}`}
      role="row"
      aria-rowindex={rowIndex}
      aria-selected={selected}
      data-id={item.id}
      onClick={(e) => onRowClick(e, item)}
      onDoubleClick={() => onOpen(item)}
      onContextMenu={(e) => onContext(e, item)}
      {...dragSourceProps(item, selectedIds, draggable)}
      {...drop.props}
    >
      <div className="cell cell-check" role="gridcell"><Checkbox checked={selected} onChange={() => toggleSelect(item)} label={`Select ${item.name}`} /></div>
      <div className="cell cell-name" role="gridcell">
        <FileIcon item={item} size={30} thumbs teamColor={teamColor} />
        <div className="name-wrap min0">
          <button className="name-text truncate" onClick={(e) => { e.stopPropagation(); onOpen(item); }} title={item.name} tabIndex={-1}>
            <Highlight text={item.name} query={query} />
          </button>
          <span className="name-sub">{context === 'trash' ? t('Deleted {date}', { date: formatDate(item.trashedAt) }) : `${sub} · ${formatDate(item.modifiedAt)}`}</span>
          {showSnippets && query && <Snippet id={item.id} q={query} name={item.name} radius={0} />}
        </div>
        <RowLabels item={item} state={state} />
        <CollabBadges item={item} state={state} />
        {item.favorite && <span className="fav-star-wrap" role="img" aria-label="Favorite" title="Favorite"><Star size={13} className="fav-star" fill="currentColor" aria-hidden="true" /></span>}
      </div>
      {columns.map((key) => (
        <div key={key} className={`cell cell-${key}`} role="gridcell">{COLUMNS[key].render(item, state)}</div>
      ))}
      <div className="cell cell-actions" role="gridcell">
        {context === 'trash' ? (
          <button className="icon-btn sm row-quick" onClick={(e) => { e.stopPropagation(); onQuickRestore(item); }} data-tip="Restore" aria-label={`Restore ${item.name}`}><RotateCcw size={16} /></button>
        ) : (
          <>
            <button className="icon-btn sm row-quick" onClick={(e) => { e.stopPropagation(); onQuickShare(item); }} data-tip="Share" aria-label={`Share ${item.name}`}><Share2 size={16} /></button>
            <button className="icon-btn sm row-quick" onClick={(e) => { e.stopPropagation(); onQuickDownload(item); }} data-tip="Download" aria-label={`Download ${item.name}`}><Download size={16} /></button>
          </>
        )}
        <button className="icon-btn sm" onClick={(e) => { e.stopPropagation(); onMore(e, item); }} aria-label={`More actions for ${item.name}`} data-tip="More actions"><MoreVertical size={16} /></button>
      </div>
    </div>
  );
});

export function FileListHeader({ columns, sort, onSort, allChecked, someChecked, onToggleAll }) {
  const ariaSort = (k) => (sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  const Head = ({ k, label, className }) => (
    <button className={`th ${className || ''} ${sort.key === k ? 'sorted' : ''}`} onClick={() => onSort(k)}>
      {label}
      {sort.key === k && (sort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
    </button>
  );
  return (
    <div className="file-row file-head" role="row" aria-rowindex={1}>
      <div className="cell cell-check" role="columnheader" aria-label={t('Select all')}><Checkbox checked={allChecked} indeterminate={someChecked && !allChecked} onChange={onToggleAll} label={t('Select all')} /></div>
      <div className="cell cell-name" role="columnheader" aria-sort={ariaSort('name')}><Head k="name" label={t('Name')} /></div>
      {columns.map((key) => <div key={key} className={`cell cell-${key}`} role="columnheader" aria-sort={ariaSort(key)}><Head k={key} label={COLUMNS[key].label} /></div>)}
      <div className="cell cell-actions" role="columnheader"><span className="sr-only">{t('Actions')}</span></div>
    </div>
  );
}
