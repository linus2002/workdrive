import { useState, useRef } from 'react';
import { useDrive } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { useUploads } from '../../store/UploadContext';
import { spaceLabel, accessOf, canEdit } from '../../store/selectors';
import { readDrop } from '../../utils/dropFiles';

export const DRAG_TYPE = 'application/x-workvault-items';

/** Drag-source props for an item (drags the whole selection if the item is selected). */
export function dragSourceProps(item, selectedIds, enabled = true) {
  if (!enabled) return {};
  return {
    draggable: true,
    onDragStart: (e) => {
      const ids = selectedIds?.has(item.id) ? [...selectedIds] : [item.id];
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'copyMove';
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.textContent = ids.length > 1 ? `${ids.length} items` : item.name;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 12, 12);
      setTimeout(() => ghost.remove(), 0);
    },
  };
}

/** Drop target that moves dragged items into a folder or uploads dropped OS files there. */
export function useDropTarget(folderId, space, enabled = true) {
  const { api, state } = useDrive();
  const { toast } = useUI();
  const uploads = useUploads();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  if (!enabled) return { over: false, props: {} };
  const accepts = (e) => e.dataTransfer.types.includes(DRAG_TYPE) || e.dataTransfer.types.includes('Files');
  return {
    over,
    props: {
      onDragEnter: (e) => { if (!accepts(e)) return; e.preventDefault(); depth.current++; setOver(true); },
      onDragOver: (e) => { if (!accepts(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'move'; },
      onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
      onDrop: (e) => {
        depth.current = 0;
        setOver(false);
        if (!accepts(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const raw = e.dataTransfer.getData(DRAG_TYPE);
        if (raw) {
          const all = JSON.parse(raw).filter((id) => id !== folderId);
          if (!all.length) return;
          // Only items you can edit may be moved (same rule as the Move dialog / context menu).
          const ids = all.filter((id) => canEdit(accessOf(state, state.items[id])));
          const denied = all.length - ids.length;
          if (!ids.length) { toast(`You don't have permission to move ${denied > 1 ? 'these items' : 'this item'}`, { type: 'warning' }); return; }
          const origin = ids.map((id) => ({ id, parentId: state.items[id]?.parentId || null, space: state.items[id]?.space }));
          const res = api.moveItems(ids, folderId, space);
          const target = folderId ? state.items[folderId]?.name : spaceLabel(state, space);
          const skipped = [denied + (res.denied || 0) && `${denied + (res.denied || 0)} view-only`, res.locked && `${res.locked} locked`, res.held && `${res.held} on legal hold`].filter(Boolean).join(', ');
          const undo = { label: 'Undo', onClick: () => {
            const groups = new Map();
            origin.forEach((o) => { const k = `${o.space}|${o.parentId || ''}`; if (!groups.has(k)) groups.set(k, { ...o, ids: [] }); groups.get(k).ids.push(o.id); });
            groups.forEach((g) => api.moveItems(g.ids, g.parentId, g.space));
          } };
          if (res.moved) toast(`Moved ${res.moved} item${res.moved > 1 ? 's' : ''} to "${target}"${skipped ? ` · skipped ${skipped}` : ''}`, { type: 'success', action: undo });
          else if (skipped) toast(`Nothing was moved: ${skipped}`, { type: 'warning' });
          else if (res.skipped) toast('Items are already in that folder', { type: 'info' });
        } else if (e.dataTransfer.files?.length) {
          readDrop(e.dataTransfer).then((files) => uploads.upload(files, folderId, space)).catch(() => toast('Could not read the dropped items', { type: 'error' }));
        }
      },
    },
  };
}
