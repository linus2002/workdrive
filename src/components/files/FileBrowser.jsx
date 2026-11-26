import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useDrive } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { useItemActions } from '../../store/useItemActions';
import { accessOf, canEdit, lockedByOther, shortcutTarget } from '../../store/selectors';
import { itemCategory } from '../../utils/fileTypes';
import { EmptyState, SkeletonRows } from '../common';
import FileToolbar from './FileToolbar';
import { FileRow, FileListHeader } from './FileList';
import { FileCard, FolderTile } from './FileGrid';
import { COLUMNS, nameSort } from './columns';
import FileDetailsPanel from './FileDetailsPanel';
import { useDropTarget } from './dnd';
import { t as tr } from '../../i18n'; // `t` is a local timer name here

const PAGE = 40;
const DAY = 86400000;
const VIRTUAL_MIN = 150; // folders with more items than this only render the rows on screen
const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches;

/**
 * Windowing for one block of equally sized rows (a list, or a CSS grid whose column count is read from its
 * resolved `grid-template-columns`). `ref` goes on the element holding the rows; it gets padding for the rows
 * that aren't rendered. Row height and gap are measured from the first rendered child (falls back to --row-h).
 */
function useWindowing(scrollRef, count, enabled, { overscan = 4, stickyOffset } = {}) {
  const ref = useRef(null);
  const metrics = useRef({ cols: 1, rowH: 0, gap: 0 });
  const [range, setRange] = useState({ first: 0, last: 20, cols: 1, stride: 0 });
  const rangeRef = useRef(range);

  const compute = useCallback(() => {
    const el = ref.current, sc = scrollRef.current;
    if (!enabled || !el || !sc) return;
    const cs = getComputedStyle(el);
    const isGrid = cs.display.includes('grid');
    const cols = isGrid ? Math.max(1, cs.gridTemplateColumns.split(' ').filter((t) => t && t !== 'none').length) : 1;
    const gap = isGrid ? parseFloat(cs.rowGap) || 0 : 0;
    const child = el.firstElementChild;
    const cssRow = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h')) || 52;
    const rowH = (child && child.getBoundingClientRect().height) || metrics.current.rowH || cssRow;
    metrics.current = { cols, rowH, gap };
    const stride = rowH + gap;
    const viewTop = sc.getBoundingClientRect().top - el.getBoundingClientRect().top; // viewport top, relative to el
    const totalRows = Math.ceil(count / cols);
    const first = Math.max(0, Math.min(totalRows - 1, Math.floor(viewTop / stride) - overscan));
    const last = Math.max(first, Math.min(totalRows - 1, Math.ceil((viewTop + sc.clientHeight) / stride) + overscan));
    const r = rangeRef.current;
    if (r.first === first && r.last === last && r.cols === cols && Math.abs(r.stride - stride) < 0.5) return; // only set state on a real change
    rangeRef.current = { first, last, cols, stride };
    setRange(rangeRef.current);
  }, [scrollRef, count, enabled, overscan]);

  useLayoutEffect(() => { compute(); });
  useEffect(() => {
    const sc = scrollRef.current;
    if (!enabled || !sc) return undefined;
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(compute); };
    sc.addEventListener('scroll', on, { passive: true });
    const ro = new ResizeObserver(on);
    ro.observe(sc);
    if (ref.current) ro.observe(ref.current);
    return () => { cancelAnimationFrame(raf); sc.removeEventListener('scroll', on); ro.disconnect(); };
  }, [enabled, compute, scrollRef]);

  if (!enabled) return { ref, enabled: false, start: 0, end: count, style: undefined, cols: 1, pageRows: 10, scrollToIndex: null };
  const { first, last, cols, stride } = range;
  const totalRows = Math.ceil(count / cols);
  const start = Math.min(count, first * cols);
  const end = Math.min(count, (last + 1) * cols);
  const renderedRows = Math.max(0, Math.ceil((end - start) / cols));
  const s = stride || metrics.current.rowH + metrics.current.gap || 52;
  const style = { paddingTop: first * s, paddingBottom: Math.max(0, (totalRows - first - renderedRows) * s) };
  const sc = scrollRef.current;
  const pageRows = Math.max(1, Math.floor((sc?.clientHeight || 600) / s) - 1);
  /** Scroll so item `i` is visible ('nearest') or centred, and render it straight away. */
  const scrollToIndex = (i, block = 'nearest') => {
    const el = ref.current, box = scrollRef.current;
    if (!el || !box) return;
    const { rowH, gap } = metrics.current;
    const st = rowH + gap;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop + Math.floor(i / cols) * st;
    const sticky = stickyOffset?.() || 0;
    if (block === 'center') box.scrollTop = top - (box.clientHeight - rowH) / 2;
    else if (top < box.scrollTop + sticky) box.scrollTop = top - sticky;
    else if (top + rowH > box.scrollTop + box.clientHeight) box.scrollTop = top + rowH - box.clientHeight;
    compute();
  };
  return { ref, enabled: true, start, end, style, cols, pageRows, scrollToIndex };
}

/** In a grid, the item one row above/below `fromId` (closest horizontally), using the laid-out positions. */
function gridNeighbour(root, ids, fromId, dir) {
  const els = ids.map((id) => root?.querySelector(`[data-id="${id}"]`)).filter(Boolean);
  const cur = root?.querySelector(`[data-id="${fromId}"]`);
  if (!cur || !els.length) return null;
  const c = cur.getBoundingClientRect();
  const cx = c.left + c.width / 2;
  const rows = els.map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => (dir > 0 ? r.top > c.top + 4 : r.top < c.top - 4));
  if (!rows.length) return null;
  const rowTop = dir > 0 ? Math.min(...rows.map((x) => x.r.top)) : Math.max(...rows.map((x) => x.r.top));
  const inRow = rows.filter((x) => Math.abs(x.r.top - rowTop) < 4);
  inRow.sort((a, b) => Math.abs(a.r.left + a.r.width / 2 - cx) - Math.abs(b.r.left + b.r.width / 2 - cx));
  return inRow[0]?.el.getAttribute('data-id') || null;
}

function matchesModified(ts, f) {
  if (f === 'any') return true;
  const now = new Date();
  if (f === 'today') return new Date(ts).toDateString() === now.toDateString();
  if (f === '7d') return Date.now() - ts <= 7 * DAY;
  if (f === '30d') return Date.now() - ts <= 30 * DAY;
  if (f === 'year') return new Date(ts).getFullYear() === now.getFullYear();
  return true;
}

export default function FileBrowser({
  items, context = 'browse', columns = ['owner', 'modified', 'size', 'shared'], emptyState, query = '',
  dropTarget, loadingKey, defaultSort = { key: 'name', dir: 'asc' }, foldersFirst = true, showFilters = true,
  backgroundMenu, fallbackDetailsItem, teamColor, initialFilters, inFolder = false, toolbarFilters, showSnippets = false,
}) {
  const { state, api } = useDrive();
  const ui = useUI();
  const location = useLocation();
  const navigate = useNavigate();
  const actions = useItemActions();
  const view = state.settings.defaultView;
  const setView = (v) => api.updateSettings({ defaultView: v });
  const detailsOpen = state.settings.showDetailsPanel;
  const closeDetails = () => api.updateSettings({ showDetailsPanel: false });
  const kbMenuAt = useRef(0); // when the keyboard opened a context menu (to ignore the native contextmenu that follows)

  const [sort, setSort] = useState(defaultSort);
  const [filters, setFilters] = useState({ type: 'all', modified: 'any', owner: 'any', ...(initialFilters || {}) });
  const [selected, setSelected] = useState(() => new Set());
  const [anchor, setAnchor] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [visible, setVisible] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const sentinel = useRef(null);
  const rootRef = useRef(null);

  // Simulated fetch latency to show skeletons when location changes
  // New location: clear selection, filters and the details panel so nothing carries over silently.
  useEffect(() => {
    setLoading(true);
    setSelected(new Set());
    setFocusId(null);
    setAnchor(null);
    setVisible(PAGE);
    setFilters({ type: 'all', modified: 'any', owner: 'any', ...(initialFilters || {}) });
    ui.setDetailsId(fallbackDetailsItem?.id || null);
    // On phones the details panel is a bottom sheet: don't pop it open just because the (desktop) setting is on.
    if (isPhone() && state.settings.showDetailsPanel) closeDetails();
    const t = setTimeout(() => setLoading(false), 260);
    return () => clearTimeout(t);
  }, [loadingKey]); // eslint-disable-line

  useEffect(() => { if (initialFilters) setFilters((f) => ({ ...f, ...initialFilters })); }, [initialFilters?.type]); // eslint-disable-line

  const processed = useMemo(() => {
    const getter = sort.key === 'name' ? nameSort : (i) => COLUMNS[sort.key]?.sort(i, state);
    const list = items.filter((i) => {
      if (filters.type !== 'all' && itemCategory(i) !== filters.type) return false;
      if (!matchesModified(context === 'trash' ? i.trashedAt : i.modifiedAt, filters.modified)) return false;
      if (filters.owner === 'me' && i.ownerId !== state.meId) return false;
      if (filters.owner === 'others' && i.ownerId === state.meId) return false;
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (foldersFirst && a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      const va = getter(a), vb = getter(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [items, filters, sort, state, foldersFirst, context]);

  // prune selection when items disappear
  useEffect(() => {
    setSelected((sel) => {
      const ids = new Set(processed.map((i) => i.id));
      const next = new Set([...sel].filter((id) => ids.has(id)));
      return next.size === sel.size ? sel : next;
    });
  }, [processed]);

  // ?highlight=<id> (from "Show in folder" / notifications): select and scroll to that item once loaded.
  const highlightId = new URLSearchParams(location.search).get('highlight');
  useEffect(() => {
    if (loading || !highlightId) return;
    const idx = processed.findIndex((i) => i.id === highlightId);
    if (idx >= 0) {
      setVisible((v) => Math.max(v, idx + 1));
      setSelected(new Set([highlightId]));
      setAnchor(highlightId);
      setFocusId(highlightId);
      setTimeout(() => revealRef.current(highlightId, 'center'), 30);
    }
    const p = new URLSearchParams(location.search);
    p.delete('highlight');
    navigate({ pathname: location.pathname, search: p.toString() ? `?${p}` : '' }, { replace: true, state: location.state });
  }, [loading, highlightId]); // eslint-disable-line

  // Big folders render only the rows on screen (windowing) instead of paging in 40 at a time.
  const virtual = !loading && processed.length > VIRTUAL_MIN && !(showSnippets && query); // snippet rows vary in height
  const shown = useMemo(() => (virtual ? processed : processed.slice(0, visible)), [virtual, processed, visible]);
  const folders = useMemo(() => shown.filter((i) => i.type === 'folder'), [shown]);
  const files = useMemo(() => shown.filter((i) => i.type !== 'folder'), [shown]); // files and shortcuts
  const gridOrder = useMemo(() => [...folders, ...files], [folders, files]); // the order the grid shows them in
  const headHeight = useCallback(() => rootRef.current?.querySelector('.file-head')?.offsetHeight || 0, []);
  const listWin = useWindowing(rootRef, processed.length, virtual && view === 'list', { stickyOffset: headHeight });
  const folderWin = useWindowing(rootRef, folders.length, virtual && view === 'grid', { overscan: 2 });
  const fileWin = useWindowing(rootRef, files.length, virtual && view === 'grid', { overscan: 2 });

  /** Bring an item into view, rendering it first if it's outside the rendered window/page. */
  const reveal = (id, block = 'nearest') => {
    if (virtual) {
      if (view === 'list') listWin.scrollToIndex?.(processed.findIndex((i) => i.id === id), block);
      else {
        const fi = folders.findIndex((i) => i.id === id);
        if (fi >= 0) folderWin.scrollToIndex?.(fi, block); else fileWin.scrollToIndex?.(files.findIndex((i) => i.id === id), block);
      }
      return;
    }
    const pi = processed.findIndex((i) => i.id === id);
    if (pi >= visible) { setVisible(Math.min(processed.length, pi + PAGE)); setTimeout(() => rootRef.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block }), 30); return; }
    rootRef.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block });
  };
  const revealRef = useRef(reveal);
  revealRef.current = reveal;

  /** Grid Up/Down by arithmetic on column counts (virtualized grids don't have every tile in the DOM). */
  const gridStep = (id, dir) => {
    const F = folders.length;
    const gi = gridOrder.findIndex((i) => i.id === id);
    if (gi < 0) return gridOrder[0];
    const fc = folderWin.cols || 1, xc = fileWin.cols || 1;
    if (gi < F) {
      const col = gi % fc;
      if (dir > 0) {
        if (gi + fc < F) return gridOrder[gi + fc];
        if (Math.floor(gi / fc) < Math.floor((F - 1) / fc)) return gridOrder[F - 1]; // into the short last row
        return files.length ? gridOrder[F + Math.min(col, xc - 1, files.length - 1)] : null;
      }
      return gi - fc >= 0 ? gridOrder[gi - fc] : null;
    }
    const j = gi - F, col = j % xc;
    if (dir > 0) return j + xc < files.length ? gridOrder[gi + xc] : (Math.floor(j / xc) < Math.floor((files.length - 1) / xc) ? gridOrder[gridOrder.length - 1] : null);
    if (j - xc >= 0) return gridOrder[gi - xc];
    if (!F) return null;
    const lastRowStart = Math.floor((F - 1) / fc) * fc;
    return gridOrder[Math.min(lastRowStart + col, F - 1)];
  };

  const selectedItems = useMemo(() => processed.filter((i) => selected.has(i.id)), [processed, selected]);

  // keep details panel in sync with single selection
  useEffect(() => {
    if (selectedItems.length === 1) ui.setDetailsId(selectedItems[0].id);
  }, [selectedItems]); // eslint-disable-line

  // infinite scroll
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setVisible((v) => Math.min(processed.length, v + PAGE));
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [processed.length, visible, loading, view]);

  const toggleSelect = useCallback((item) => {
    setSelected((s) => { const n = new Set(s); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; });
    setAnchor(item.id);
    setFocusId(item.id);
  }, []);

  const onRowClick = useCallback((e, item) => {
    if (e.shiftKey && anchor) {
      const ids = (view === 'grid' ? gridOrder : processed).map((i) => i.id);
      const [a, b] = [ids.indexOf(anchor), ids.indexOf(item.id)].sort((x, y) => x - y);
      setSelected(new Set(ids.slice(a, b + 1)));
    } else if (e.metaKey || e.ctrlKey) {
      toggleSelect(item);
      return;
    } else {
      setSelected(new Set([item.id]));
      setAnchor(item.id);
    }
    setFocusId(item.id);
  }, [anchor, processed, gridOrder, view, toggleSelect]);

  const onOpen = useCallback((item) => actions.open(item, processed), [actions, processed]);

  const menuForTarget = useCallback((item) => {
    const sel = selected.has(item.id) ? processed.filter((i) => selected.has(i.id)) : [item];
    return actions.menuFor(sel, context === 'trash' ? 'trash' : 'browse', { siblings: processed, inFolder });
  }, [actions, selected, processed, context, inFolder]);

  const onContext = useCallback((e, item) => {
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - kbMenuAt.current < 600) return; // already opened from the keyboard
    if (!selected.has(item.id)) { setSelected(new Set([item.id])); setAnchor(item.id); }
    ui.showMenu({ x: e.clientX, y: e.clientY }, menuForTarget(item));
  }, [selected, ui, menuForTarget]);

  const onMore = useCallback((e, item) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!selected.has(item.id)) { setSelected(new Set([item.id])); setAnchor(item.id); }
    ui.showMenu({ x: r.right - 200, y: r.bottom + 4 }, menuForTarget(item));
  }, [selected, ui, menuForTarget]);

  const bulkActions = useMemo(() => ({
    share: (it) => {
      const target = it.type === 'shortcut' ? shortcutTarget(state, it) : it; // a shortcut shares its original
      if (target) ui.openDialog('share', { id: target.id }); else ui.toast('The original of this shortcut is no longer available', { type: 'error' });
    },
    download: actions.download,
    move: (its) => {
      const locked = its.filter((i) => lockedByOther(state, i));
      const viewOnly = its.filter((i) => !locked.includes(i) && !canEdit(accessOf(state, i)));
      const free = its.filter((i) => !locked.includes(i) && !viewOnly.includes(i));
      if (locked.length) ui.toast(`${locked.length} locked file${locked.length === 1 ? '' : 's'} can't be moved`, { type: 'error' });
      if (viewOnly.length) ui.toast(`${viewOnly.length} view-only item${viewOnly.length === 1 ? '' : 's'} can't be moved`, { type: 'warning' });
      if (free.length) ui.openDialog('moveCopy', { ids: free.map((i) => i.id), mode: 'move' });
    },
    copy: (its) => ui.openDialog('moveCopy', { ids: its.map((i) => i.id), mode: 'copy' }),
    setFavorite: actions.setFavorite,
    trash: actions.trash,
    restore: actions.restore,
    deleteForever: actions.deleteForever,
    menu: (its) => actions.menuFor(its, context === 'trash' ? 'trash' : 'browse', { siblings: processed, inFolder }),
  }), [ui, actions, context, processed, inFolder, state]);

  // Keyboard shortcuts
  const keyHandler = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (ui.dialog || ui.preview || ui.menu) return;
      // Ignore keys while typing, but not when focus is just on a selection checkbox. Check the event target
      // too: a field can blur itself while handling the key (the search box does on Enter / Escape).
      const isTypingEl = (el) => {
        const tag = el?.tagName;
        return tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['checkbox', 'radio'].includes(el.type)) || !!el?.isContentEditable;
      };
      if (isTypingEl(document.activeElement) || isTypingEl(e.target)) return;
      if (document.querySelector('.popover')) return;
      const idx = processed.findIndex((i) => i.id === focusId);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault(); setSelected(new Set(processed.map((i) => i.id)));
      } else if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
        // Keyboard context menu for the focused (or selected) item.
        const target = (idx >= 0 && processed[idx]) || selectedItems[0];
        if (!target || !rootRef.current?.contains(document.activeElement)) return;
        e.preventDefault();
        kbMenuAt.current = Date.now();
        if (!selected.has(target.id)) { setSelected(new Set([target.id])); setAnchor(target.id); }
        const el = rootRef.current.querySelector(`[data-id="${target.id}"]`);
        const r = el?.getBoundingClientRect();
        ui.showMenu({ x: r ? r.left + Math.min(48, r.width / 2) : 80, y: r ? r.top + Math.min(r.height, 36) : 120 }, menuForTarget(target));
      } else if (e.key === 'Escape') {
        if (detailsOpen && isPhone()) { closeDetails(); return; }
        setSelected(new Set());
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && view === 'grid')) {
        e.preventDefault();
        const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
        // Step through the order on screen: the grid shows folders first even when the list doesn't.
        const order = view === 'grid' ? gridOrder : processed;
        const oi = order.findIndex((i) => i.id === focusId);
        let next = order[Math.max(0, Math.min(order.length - 1, oi < 0 ? 0 : oi + step))];
        if (virtual && view === 'grid' && idx >= 0) {
          const gi = gridOrder.findIndex((i) => i.id === focusId);
          next = (e.key === 'ArrowDown' || e.key === 'ArrowUp') ? (gridStep(focusId, step) || processed[idx]) : gridOrder[Math.max(0, Math.min(gridOrder.length - 1, gi + step))];
        } else if (view === 'grid' && idx >= 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          // Up/Down move by one visual row in the grid.
          const id = gridNeighbour(rootRef.current, gridOrder.map((i) => i.id), processed[idx].id, step);
          next = id ? gridOrder.find((i) => i.id === id) : (step > 0 ? gridOrder[gridOrder.length - 1] : processed[idx]);
          if (step > 0 && !id && visible < processed.length) setVisible((v) => Math.min(processed.length, v + PAGE));
        }
        if (!next) return;
        setFocusId(next.id);
        if (e.shiftKey) setSelected((s) => new Set([...s, next.id])); else { setSelected(new Set([next.id])); setAnchor(next.id); }
        reveal(next.id);
      } else if (['Home', 'End', 'PageUp', 'PageDown'].includes(e.key) && processed.length && rootRef.current?.contains(document.activeElement)) {
        if (['BUTTON', 'A', 'INPUT'].includes(document.activeElement?.tagName) && document.activeElement.type !== 'checkbox') return;
        e.preventDefault();
        const order = view === 'grid' ? gridOrder : processed;
        const oi = Math.max(0, order.findIndex((i) => i.id === focusId));
        const win = view === 'list' ? listWin : (oi < folders.length ? folderWin : fileWin);
        const jump = Math.max(1, win.pageRows) * (view === 'grid' ? Math.max(1, win.cols) : 1);
        const ni = e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : e.key === 'PageDown' ? Math.min(order.length - 1, oi + jump) : Math.max(0, oi - jump);
        const next = order[ni];
        if (!next) return;
        setFocusId(next.id);
        if (e.shiftKey && anchor) {
          const ids = order.map((i) => i.id);
          const [a, b] = [ids.indexOf(anchor), ids.indexOf(next.id)].sort((x, y) => x - y);
          setSelected(new Set(ids.slice(a, b + 1)));
        } else { setSelected(new Set([next.id])); setAnchor(next.id); }
        reveal(next.id);
      } else if (e.key === 'Enter' && (selectedItems.length === 1 || (!selectedItems.length && idx >= 0))) {
        if (['BUTTON', 'A', 'INPUT'].includes(document.activeElement?.tagName)) return; // let buttons, links and checkboxes handle it
        onOpen(selectedItems[0] || processed[idx]);
      } else if (e.key === ' ' && selectedItems.length === 1 && selectedItems[0].type === 'file') {
        if (['BUTTON', 'A', 'INPUT'].includes(document.activeElement?.tagName)) return; // let buttons, links and checkboxes handle it
        e.preventDefault(); onOpen(selectedItems[0]);
      } else if ((e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) && selectedItems.length) {
        // Plain Backspace is "go back" for many users, so only Delete (or ⌘⌫ on Mac) trashes.
        e.preventDefault();
        // actions.trash handles mixed selections (it trashes what it can and says what it skipped, e.g. view-only items).
        if (context === 'trash') actions.deleteForever(selectedItems);
        else actions.trash(selectedItems);
      } else if (e.key === 'F2' && selectedItems.length > 1 && context !== 'trash') {
        e.preventDefault();
        ui.openDialog('bulkRename', { ids: selectedItems.map((i) => i.id) });
      } else if (e.key === 'F2' && selectedItems.length === 1 && context !== 'trash') {
        e.preventDefault();
        if (lockedByOther(state, selectedItems[0])) ui.toast(`"${selectedItems[0].name}" is locked and can't be renamed`, { type: 'error' });
        else if (canEdit(accessOf(state, selectedItems[0]))) ui.openDialog('rename', { id: selectedItems[0].id });
      } else if (e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.metaKey && selectedItems.length === 1) {
        actions.showDetails(selectedItems[0]);
      }
    };
    keyHandler.current = onKey;
  }); // the handler is refreshed every render so it sees the current window, focus and selection
  // One stable listener that calls the latest handler (re-subscribing on every render could miss a key press).
  useEffect(() => {
    const onKey = (e) => keyHandler.current?.(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const drop = useDropTarget(dropTarget?.parentId ?? null, dropTarget?.space || 'my', !!dropTarget?.enabled);

  const onBackgroundContext = (e) => {
    if (Date.now() - kbMenuAt.current < 600) { e.preventDefault(); return; }
    if (!backgroundMenu) return;
    e.preventDefault();
    setSelected(new Set());
    ui.showMenu({ x: e.clientX, y: e.clientY }, [
      ...backgroundMenu,
      { divider: true },
      { label: view === 'list' ? 'Switch to grid view' : 'Switch to list view', onClick: () => setView(view === 'list' ? 'grid' : 'list') },
      { label: 'Select all', onClick: () => setSelected(new Set(processed.map((i) => i.id))), shortcut: 'Ctrl+A' },
    ]);
  };

  const onSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  const sortOptions = [{ key: 'name', label: 'Name' }, ...columns.map((k) => ({ key: k, label: COLUMNS[k].label }))];

  const draggable = context !== 'trash';
  const canDropInto = (item) => context !== 'trash' && canEdit(accessOf(state, item));

  const detailsItem = (ui.detailsId && state.items[ui.detailsId]) || fallbackDetailsItem || null;

  const quickShare = useCallback((it) => ui.openDialog('share', { id: it.id }), [ui]);
  const quickDownload = useCallback((it) => actions.download([it]), [actions]);
  const quickRestore = useCallback((it) => actions.restore([it]), [actions]);
  const common = { state, query, selectedIds: selected, selectionMode: selected.size > 0, onOpen, onContext, onMore, toggleSelect, draggable, context, teamColor, showSnippets };

  return (
    <div className={`browser ${detailsOpen ? 'with-details' : ''}`}>
      <div className="browser-main">
        <FileToolbar
          selectedItems={selectedItems} clearSelection={() => setSelected(new Set())} context={context} actions={bulkActions}
          filters={filters} setFilters={setFilters} sort={sort} setSort={setSort} sortOptions={sortOptions} customFilters={toolbarFilters}
          view={view} setView={setView} detailsOpen={detailsOpen} toggleDetails={() => api.updateSettings({ showDetailsPanel: !detailsOpen })}
          totalCount={processed.length} onSelectAll={() => setSelected(new Set(processed.map((i) => i.id)))} showFilters={showFilters}
        />
        <div
          className={`browser-body ${drop.over ? 'drop-over' : ''} ${virtual ? 'virtualized' : ''}`}
          ref={rootRef}
          tabIndex={0}
          role="group"
          aria-label="Files. Use arrow keys to move, Enter to open, Shift+F10 for actions."
          // Screen readers announce the item the arrow keys moved to (focus stays on this container).
          aria-activedescendant={focusId && processed.some((i) => i.id === focusId) ? `fi-${focusId}` : undefined}
          onFocus={(e) => { if (e.target === e.currentTarget && !focusId && processed[0]) setFocusId(processed[0].id); }}
          onClick={(e) => { if (e.target === e.currentTarget || e.target.classList.contains('file-grid') || e.target.classList.contains('grid-section')) setSelected(new Set()); }}
          onContextMenu={onBackgroundContext}
          {...drop.props}
        >
          {loading ? (
            <SkeletonRows rows={8} grid={view === 'grid'} />
          ) : processed.length === 0 ? (
            items.length > 0 ? (
              <EmptyState icon={emptyState?.icon} title="No items match your filters" text="Try a different type, date or owner filter." action={<button className="btn btn-secondary" onClick={() => setFilters({ type: 'all', modified: 'any', owner: 'any' })}>Clear filters</button>} />
            ) : (
              <EmptyState {...emptyState} />
            )
          ) : view === 'list' ? (
            <div className={`file-list cols-${columns.length}`} role="grid" aria-multiselectable="true" aria-rowcount={processed.length + 1} style={{ '--cols': columns.map((k) => `minmax(90px, ${COLUMNS[k].width})`).join(' ') }}>
              <FileListHeader columns={columns} sort={sort} onSort={onSort}
                allChecked={selected.size > 0 && selected.size === processed.length} someChecked={selected.size > 0}
                onToggleAll={() => setSelected(selected.size === processed.length ? new Set() : new Set(processed.map((i) => i.id)))} />
              <div className="file-rows" role="rowgroup" ref={listWin.ref} style={listWin.style}>
                {shown.slice(listWin.start, listWin.end).map((item, i) => (
                  <FileRow key={item.id} item={item} rowIndex={listWin.start + i + 2} columns={columns} selected={selected.has(item.id)} focused={focusId === item.id}
                    onRowClick={onRowClick} onQuickShare={quickShare} onQuickDownload={quickDownload}
                    onQuickRestore={quickRestore} canDropInto={canDropInto(item)} {...common} />
                ))}
              </div>
            </div>
          ) : (
            <div className="grid-wrap">
              {folders.length > 0 && (
                <>
                  {foldersFirst && <div className="grid-section">{tr('Folders')}</div>}
                  <div className="folder-grid" ref={folderWin.ref} style={folderWin.style} role="grid" aria-label={tr('Folders')} aria-multiselectable="true">
                    {folders.slice(folderWin.start, folderWin.end).map((item) => <FolderTile key={item.id} item={item} selected={selected.has(item.id)} focused={focusId === item.id} onClick={onRowClick} canDropInto={canDropInto(item)} {...common} />)}
                  </div>
                </>
              )}
              {files.length > 0 && (
                <>
                  {foldersFirst && folders.length > 0 && <div className="grid-section">{tr('Files')}</div>}
                  <div className="file-grid" ref={fileWin.ref} style={fileWin.style} role="grid" aria-label={tr('Files')} aria-multiselectable="true">
                    {files.slice(fileWin.start, fileWin.end).map((item) => <FileCard key={item.id} item={item} selected={selected.has(item.id)} focused={focusId === item.id} onClick={onRowClick} {...common} />)}
                  </div>
                </>
              )}
            </div>
          )}
          {!loading && !virtual && visible < processed.length && (
            <div className="load-more" ref={sentinel}><Loader2 size={16} className="spin" /> Loading more… ({visible} of {processed.length})</div>
          )}
          {drop.over && <div className="drop-hint">Drop to {dropTarget?.label ? `add to "${dropTarget.label}"` : 'upload here'}</div>}
        </div>
      </div>
      {detailsOpen && <div className="details-scrim" onClick={closeDetails} aria-hidden="true" />}
      {detailsOpen && (
        <FileDetailsPanel item={detailsItem} onClose={closeDetails} selectionCount={selectedItems.length} />
      )}
    </div>
  );
}
