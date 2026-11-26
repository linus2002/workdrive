import { memo, useRef } from 'react';
import { MoreVertical, Star, Users, Link2, Lock, MessageSquare, CornerUpRight } from 'lucide-react';
import { FileIcon, Highlight, thumbUrl, FolderGlyph } from '../common';
import { formatDate, formatSize } from '../../utils/format';
import { getFileType } from '../../utils/fileTypes';
import { itemCount, openCommentCount, labelsOf, shortcutTarget } from '../../store/selectors';
import { useDropTarget, dragSourceProps } from './dnd';
import Snippet from '../../search/Snippet';
import { Checkbox } from './FileList';
import { usePdfThumb } from './usePdfThumb';
import CardPreview from './CardPreview';
import { useImageThumb } from './useImageThumb';
import { blobRegistry } from '../../store/DriveStore';

const coarse = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/**
 * Touch: a tap opens the item (or toggles it while you're selecting), a long press selects it.
 * Mouse/keyboard keep click-to-select, double-click-to-open.
 */
function useTapBehaviour(item, { selectionMode, onClick, onOpen, toggleSelect }) {
  const timer = useRef(null);
  const longPressed = useRef(false);
  const start = useRef(null);
  const cancel = () => { clearTimeout(timer.current); timer.current = null; };
  return {
    onPointerDown: (e) => {
      if (e.pointerType !== 'touch') return;
      longPressed.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      cancel();
      timer.current = setTimeout(() => { longPressed.current = true; toggleSelect(item); navigator.vibrate?.(15); }, 500);
    },
    onPointerMove: (e) => { if (timer.current && start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel(); },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClick: (e) => {
      if (longPressed.current) { longPressed.current = false; e.preventDefault(); return; }
      if (coarse() && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        if (selectionMode) toggleSelect(item); else onOpen(item);
        return;
      }
      onClick(e, item);
    },
    onContextMenuCapture: (e) => {
      // The long press already selected the item; don't also pop the menu over it.
      if (longPressed.current) { e.preventDefault(); e.stopPropagation(); }
    },
  };
}

function CardThumb({ item }) {
  const url = useImageThumb(item, thumbUrl(item));
  const pdfThumb = usePdfThumb(item);
  if (url) return <img src={url} alt="" className="card-img" draggable={false} loading="lazy" />;
  if (getFileType(item.ext).category === 'image' && blobRegistry.has(item.id)) return <div className="card-icon-thumb" aria-hidden="true" />; // small copy on its way
  if (pdfThumb) return <img src={pdfThumb} alt={`First page of ${item.name}`} className="card-pdf" draggable={false} />;
  return <CardPreview item={item} />;
}

export const FolderTile = memo(function FolderTile({ item, state, selected, focused, selectionMode, onClick, onOpen, onContext, onMore, toggleSelect, query, selectedIds, draggable, canDropInto, teamColor }) {
  const drop = useDropTarget(item.id, item.space, canDropInto);
  const tap = useTapBehaviour(item, { selectionMode, onClick, onOpen, toggleSelect });
  const n = itemCount(state.items, item.id);
  return (
    <div className={`folder-tile ${selected ? 'selected' : ''} ${focused ? 'focused' : ''} ${drop.over ? 'drop-over' : ''}`} data-id={item.id} {...tap} onDoubleClick={() => onOpen(item)} onContextMenu={(e) => onContext(e, item)}
      {...dragSourceProps(item, selectedIds, draggable)} {...drop.props} role="row" id={`fi-${item.id}`} aria-selected={selected} aria-label={`${item.name}, folder, ${n} item${n === 1 ? '' : 's'}`}>
      <div className={`tile-check ${selected || selectionMode ? 'show' : ''}`} role="gridcell"><Checkbox checked={selected} onChange={() => toggleSelect(item)} label={`Select ${item.name}`} /></div>
      {!(selected || selectionMode) && <FolderGlyph size={30} shared={item.sharedWith?.length > 0} color={item.color || teamColor} />}
      <div className="min0 grow" role="gridcell">
        <div className="card-name-row">
          <div className="tile-name truncate" title={item.name}><Highlight text={item.name} query={query} /></div>
          {labelsOf(state, item).length > 0 && (
            <span className="label-dots" title={labelsOf(state, item).map((l) => l.name).join(', ')}>
              {labelsOf(state, item).slice(0, 4).map((l) => <span key={l.id} className="label-dot" style={{ background: l.color }} />)}
            </span>
          )}
        </div>
        <div className="tile-meta">{n} item{n === 1 ? '' : 's'}</div>
      </div>
      {/* Star and menu button sit in their own cell (a grid row may only contain cells). */}
      <span className="tile-actions" role="gridcell">
        {item.favorite && <span className="fav-star-wrap" role="img" aria-label="Favorite" title="Favorite"><Star size={13} className="fav-star" fill="currentColor" aria-hidden="true" /></span>}
        <button className="icon-btn sm" onClick={(e) => { e.stopPropagation(); onMore(e, item); }} aria-label={`More actions for ${item.name}`}><MoreVertical size={16} /></button>
      </span>
    </div>
  );
});

export const FileCard = memo(function FileCard({ item, state, selected, focused, selectionMode, onClick, onOpen, onContext, onMore, toggleSelect, query, selectedIds, draggable, context, showSnippets }) {
  const tap = useTapBehaviour(item, { selectionMode, onClick, onOpen, toggleSelect });
  const isShortcut = item.type === 'shortcut';
  const target = isShortcut ? shortcutTarget(state, item) : null;
  const t = getFileType(isShortcut ? target?.ext : item.ext);
  const shared = item.sharedWith?.length > 0;
  const meta = isShortcut
    ? (target ? `Shortcut to ${target.type === 'folder' ? 'folder' : t.label}` : 'Broken shortcut')
    : `${t.label} · ${formatSize(item.size)} · ${context === 'trash' ? `Deleted ${formatDate(item.trashedAt)}` : formatDate(item.modifiedAt)}`;
  return (
    <div className={`file-card ${selected ? 'selected' : ''} ${focused ? 'focused' : ''} ${isShortcut && !target ? 'broken' : ''}`} data-id={item.id} {...tap} onDoubleClick={() => onOpen(item)} onContextMenu={(e) => onContext(e, item)}
      {...dragSourceProps(item, selectedIds, draggable)} role="row" id={`fi-${item.id}`} aria-selected={selected} aria-label={`${item.name}, ${meta}`}>
      <div className="card-thumb" role="gridcell">
        {target?.type === 'folder'
          ? <div className="card-icon-thumb"><FolderGlyph size={64} color={target.color || undefined} /></div>
          : <CardThumb item={target || item} />}
        {isShortcut && <span className="card-shortcut" role="img" aria-label="Shortcut" title="Shortcut"><CornerUpRight size={14} strokeWidth={2.6} /></span>}
        <div className={`tile-check ${selected || selectionMode ? 'show' : ''}`}><Checkbox checked={selected} onChange={() => toggleSelect(item)} label={`Select ${item.name}`} /></div>
        <div className="card-badges">
          {item.favorite && <span className="card-badge fav" role="img" aria-label="Favorite" title="Favorite"><Star size={12} fill="currentColor" aria-hidden="true" /></span>}
          {shared && <span className="card-badge" role="img" aria-label="Shared with people" title="Shared with people"><Users size={12} aria-hidden="true" /></span>}
          {item.link?.enabled && <span className="card-badge" role="img" aria-label="Link sharing on" title="Link sharing on"><Link2 size={12} aria-hidden="true" /></span>}
          {item.lock && !item.trashed && <span className="card-badge lock" role="img" title="Locked" aria-label="Locked"><Lock size={12} aria-hidden="true" /></span>}
          {openCommentCount(item) > 0 && !item.trashed && <span className="card-badge" role="img" title={`${openCommentCount(item)} open comment${openCommentCount(item) === 1 ? '' : 's'}`} aria-label={`${openCommentCount(item)} open comment${openCommentCount(item) === 1 ? '' : 's'}`}><MessageSquare size={12} aria-hidden="true" />{openCommentCount(item)}</span>}
        </div>
      </div>
      <div className="card-body" role="gridcell">
        <FileIcon item={item} size={20} />
        <div className="min0 grow">
          <div className="card-name-row">
            <div className="card-name truncate" title={item.name}><Highlight text={item.name} query={query} /></div>
            {!item.trashed && labelsOf(state, item).length > 0 && (
              <span className="label-dots" title={labelsOf(state, item).map((l) => l.name).join(', ')}>
                {labelsOf(state, item).slice(0, 4).map((l) => <span key={l.id} className="label-dot" style={{ background: l.color }} />)}
              </span>
            )}
          </div>
          <div className="card-meta truncate" title={meta}>{meta}</div>
          {showSnippets && query && <Snippet id={item.id} q={query} name={item.name} radius={0} />}
        </div>
        <button className="icon-btn sm" onClick={(e) => { e.stopPropagation(); onMore(e, item); }} aria-label={`More actions for ${item.name}`}><MoreVertical size={16} /></button>
      </div>
    </div>
  );
});
