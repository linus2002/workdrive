import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, Share2, MoreVertical, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Info, Star, PenLine, Save, Check, Maximize2, MessageSquare, Lock, Highlighter, Eye, EyeOff, FileDown, GalleryHorizontalEnd, PenTool, Keyboard, AlertTriangle, RotateCcw, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { useDrive } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { useItemActions } from '../../store/useItemActions';
import { accessOf, canEdit, canCommentAccess, locationOf, isTrashedDeep, lockedByOther, openCommentCount, versionNo } from '../../store/selectors';
import { PresenceStack } from '../files/Collaboration';
import { getFileType } from '../../utils/fileTypes';
import { formatSize, formatDate } from '../../utils/format';
import { sampleSheet, sampleSlides, sampleText } from '../../utils/sampleContent';
import { FileIcon } from '../common';
import { DetailsContent } from '../files/FileDetailsPanel';
import { PdfViewer, TextViewer, DocViewer, SheetViewer, SlidesViewer, VideoViewer, AudioViewer, ArchiveViewer, NoPreview, realUrl, pdfNeedsCanvas } from './Viewers';
import { MarkedImage, MarkedPdf, MarkupToolbar, useMarkup, supportsMarkup, downloadWithMarkup, useNameOf, usePageCount, TOOLS } from '../../viewing/Markup';
import { Filmstrip, Slideshow } from '../../viewing/Gallery';
import { signWaitingForMe } from '../../signatures/signing';
import { FindContext } from '../../viewing/PdfPages';

/** File types whose preview shows text that can be searched with the find bar. */
const SEARCHABLE = ['text', 'document', 'spreadsheet', 'presentation', 'pdf', 'archive'];
const FIND_SKIP = 'button, textarea, input, select, script, style, .code-ln, .paper-num, .pdf-page-no, [aria-hidden="true"], [data-find-skip]';
const FIND_BLOCK = 'p, li, td, th, h1, h2, h3, h4, h5, h6, pre, blockquote, dt, dd, .code-line, div, tr';
const hasHighlights = () => typeof CSS !== 'undefined' && !!CSS.highlights && typeof window.Highlight === 'function';

/** Ranges for every (case-insensitive) occurrence of `q` in the visible text under `root`. */
function textMatches(root, q) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segs = [];
  const ok = new Map();
  let text = '';
  let lastBlock = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p || !n.nodeValue) continue;
    let vis = ok.get(p);
    if (vis === undefined) { vis = !p.closest(FIND_SKIP) && p.getClientRects().length > 0; ok.set(p, vis); }
    if (!vis) continue;
    const block = p.closest(FIND_BLOCK);
    if (block !== lastBlock) { if (text) text += '\n'; lastBlock = block; } // no matches across lines/cells
    segs.push({ n, start: text.length });
    text += n.nodeValue;
  }
  const hay = text.toLowerCase();
  const needle = q.toLowerCase();
  if (!needle || hay.length !== text.length) return [];
  const at = (k, end) => { // text offset -> [node, offset]
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].start < k || (!end && segs[mid].start === k)) lo = mid; else hi = mid - 1; }
    return [segs[lo].n, k - segs[lo].start];
  };
  const out = [];
  for (let i = hay.indexOf(needle); i >= 0 && out.length < 2000; i = hay.indexOf(needle, i + needle.length)) {
    const r = document.createRange();
    const [a, ao] = at(i, false);
    const [b, bo] = at(i + needle.length, true);
    r.setStart(a, ao); r.setEnd(b, bo);
    out.push(r);
  }
  return out;
}

/** Highlights matches of `query` in the rendered text inside `rootRef` (CSS Custom Highlights; selection as fallback). */
function useTextFind(rootRef, enabled, query, index, report) {
  const [version, setVersion] = useState(0);
  const scrolled = useRef('');
  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !query || !root) return undefined;
    let t = 0;
    const mo = new MutationObserver((list) => {
      if (list.every((m) => m.target.parentElement?.closest?.('[data-find-skip]') || m.target.closest?.('[data-find-skip]'))) return;
      clearTimeout(t); t = setTimeout(() => setVersion((v) => v + 1), 200);
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => { clearTimeout(t); mo.disconnect(); };
  }, [enabled, query, rootRef]);
  useEffect(() => {
    const root = rootRef.current;
    const clear = () => { if (hasHighlights()) { CSS.highlights.delete('wd-find'); CSS.highlights.delete('wd-find-current'); } };
    if (!enabled || !root) { clear(); scrolled.current = ''; return undefined; }
    if (!query) { clear(); scrolled.current = ''; report({ count: 0, pending: false }); return clear; }
    const ranges = textMatches(root, query);
    report({ count: ranges.length, pending: false });
    const cur = ranges.length ? ranges[((index % ranges.length) + ranges.length) % ranges.length] : null;
    if (hasHighlights()) {
      CSS.highlights.set('wd-find', new window.Highlight(...ranges));
      if (cur) CSS.highlights.set('wd-find-current', new window.Highlight(cur)); else CSS.highlights.delete('wd-find-current');
    } else if (cur) {
      const sel = window.getSelection();
      sel?.removeAllRanges(); sel?.addRange(cur);
    }
    const key = `${query}#${index}`;
    if (cur && scrolled.current !== key) { // scroll only when the query or the step changes, not on re-renders
      scrolled.current = key;
      cur.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    return clear;
  }, [enabled, query, index, version, rootRef, report]);
}

function FindBar({ value, onChange, result, index, unavailable, onNext, onPrev, onClose, inputRef }) {
  const { count, pending } = result;
  const status = unavailable ? 'Search isn’t available in this view'
    : !value.trim() ? '' : pending && !count ? 'Searching…' : count ? `${(((index % count) + count) % count) + 1} of ${count}${pending ? '+' : ''}` : 'No results';
  return (
    <div className="find-bar" role="search" aria-label="Find in file" data-find-skip>
      <Search size={15} aria-hidden="true" className="find-icon" />
      <input ref={inputRef} className="find-input" value={value} placeholder="Find in file" aria-label="Find in file" spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) onPrev(); else onNext(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
          else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); e.currentTarget.select(); }
        }} />
      <span className={`find-count ${unavailable ? 'wide' : ''}`} role="status" aria-live="polite">{status}</span>
      <button className="icon-btn on-dark sm" onClick={onPrev} disabled={!count || unavailable} aria-label="Previous match" data-tip="Previous (Shift+Enter)"><ChevronUp size={16} /></button>
      <button className="icon-btn on-dark sm" onClick={onNext} disabled={!count || unavailable} aria-label="Next match" data-tip="Next (Enter)"><ChevronDown size={16} /></button>
      <button className="icon-btn on-dark sm" onClick={onClose} aria-label="Close find" data-tip="Close (Esc)"><X size={16} /></button>
    </div>
  );
}

const typingIn = (el) => !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
const NARROW = '(max-width: 480px)';

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW).matches || false);
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW);
    if (!mq) return undefined;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return narrow;
}

function ShortcutsPopover({ cat, markup, onClose, find }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (!ref.current?.contains(e.target) && !e.target.closest?.('.kbd-help-btn')) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopImmediatePropagation(); onClose(); } };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [onClose]);
  const rows = [
    ['← / →', 'Previous / next file'],
    ['+ / −', 'Zoom in / out'],
    ['Esc', markup ? 'Cancel markup' : 'Close preview'],
    ['Ctrl+S', 'Save'],
  ];
  if (find) rows.push(['Ctrl+F', 'Find in file'], ['Enter / Shift+Enter', 'Next / previous match']);
  if (cat === 'presentation') rows.push(['PgUp / PgDn', 'Previous / next slide']);
  if (cat === 'audio') rows.push(['Space / K', 'Play / pause'], ['J / L', 'Back / forward 10 seconds']);
  if (cat === 'image') rows.push(['Slideshow: Space', 'Play / pause'], ['Slideshow: F', 'Full screen']);
  if (markup) {
    rows.push(...TOOLS.map((t) => [t.key.toUpperCase(), t.label]));
    rows.push(['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Del', 'Delete selected mark']);
  }
  return (
    <div className="kbd-help" ref={ref} role="dialog" aria-label="Keyboard shortcuts">
      <div className="kbd-help-head"><strong>Keyboard shortcuts</strong><button className="icon-btn" onClick={onClose} aria-label="Close keyboard shortcuts"><X size={16} /></button></div>
      <dl>
        {rows.map(([k, l]) => <div key={k + l} className="kbd-row"><dt><kbd>{k}</kbd></dt><dd>{l}</dd></div>)}
      </dl>
    </div>
  );
}

export default function FilePreview() {
  const { state, api } = useDrive();
  const ui = useUI();
  const actions = useItemActions();
  const { preview, closePreview, setPreview } = ui;
  const item = preview ? state.items[preview.id] : null;
  const [zoom, setZoom] = useState(1);
  const [info, setInfo] = useState(() => window.innerWidth > 1100);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [sheet, setSheet] = useState([]);
  const [slides, setSlides] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [infoTab, setInfoTab] = useState('details');
  const m = useMarkup(item);
  const [showMarkup, setShowMarkup] = useState(true);
  const [staleHidden, setStaleHidden] = useState(false);
  const [slideshow, setSlideshow] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const nameOf = useNameOf();
  const narrow = useNarrow();
  // Find in file
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [findQuery, setFindQuery] = useState(''); // debounced
  const [findIdx, setFindIdx] = useState(0);
  const [findResult, setFindResult] = useState({ count: 0, pending: false });
  const [findEngine, setFindEngine] = useState(null); // null: search the rendered text · 'pdf' · 'none'
  const findInput = useRef(null);
  const stageRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => { setFindQuery(findText.trim() ? findText : ''); setFindIdx(0); }, 150);
    return () => clearTimeout(t);
  }, [findText]);
  const report = useCallback((r) => setFindResult((p) => (p.count === r.count && p.pending === r.pending ? p : r)), []);
  const findCtx = useMemo(() => ({ query: findOpen ? findQuery : '', index: findIdx, setEngine: setFindEngine, report }), [findOpen, findQuery, findIdx, report]);
  useTextFind(stageRef, findOpen && findEngine === null, findOpen ? findQuery : '', findIdx, report);
  const openFind = () => {
    setFindOpen(true);
    setTimeout(() => { findInput.current?.focus(); findInput.current?.select(); }, 0);
  };
  const closeFind = () => { setFindOpen(false); setFindResult({ count: 0, pending: false }); };
  const stepFind = (d) => { if (findResult.count) setFindIdx((i) => (((i + d) % findResult.count) + findResult.count) % findResult.count); };

  // Menus ("Comments", "Version history") ask for a details tab: show it in the info panel.
  const lastTabReq = useRef(ui.detailsTab.n);
  useEffect(() => {
    if (ui.detailsTab.n === lastTabReq.current) return;
    lastTabReq.current = ui.detailsTab.n;
    if (preview && ui.detailsTab.tab) { setInfoTab(ui.detailsTab.tab); setInfo(true); }
  }, [ui.detailsTab, preview]);
  const openInfoTab = (tab) => { setInfoTab(tab); setInfo(true); ui.requestDetailsTab(tab, preview?.id); };

  // Siblings only apply if they contain the previewed file (a preview opened from a link/notification has none).
  const siblings = useMemo(() => {
    if (!preview) return [];
    const list = (preview.siblings || []).filter((id) => state.items[id] && !state.items[id].trashed);
    return list.includes(preview.id) ? list : [preview.id];
  }, [preview, state.items]);
  const idx = siblings.indexOf(preview?.id);
  const imageSiblings = useMemo(() => siblings.filter((id) => getFileType(state.items[id]?.ext).category === 'image'), [siblings, state.items]);

  // Per-file view state never carries over to the next file.
  useEffect(() => { setZoom(1); setEditing(false); setDirty(false); setShowMarkup(true); setStaleHidden(false); setKeysOpen(false); setFindOpen(false); }, [preview?.id]);
  // No find bar while editing text or marking up (Ctrl+F then falls through to the browser's own find).
  useEffect(() => { if (editing || m.active) setFindOpen(false); }, [editing, m.active]);

  const cat = item ? getFileType(item.ext).category : null;
  const canFind = !!item && SEARCHABLE.includes(cat) && !editing && !m.active;
  const editable = item && canEdit(accessOf(state, item)) && !item.trashed;
  const lockedOther = item && lockedByOther(state, item);
  const lockHolder = lockedOther ? state.users.find((u) => u.id === item.lock.by)?.name : null;
  const isLegacyBinary = item && !!realUrl(item) && item.content == null && !item.sheet && !item.slides;
  const supportsEdit = item && (cat === 'text' || (['document', 'spreadsheet', 'presentation'].includes(cat) && !isLegacyBinary));

  const unsaved = dirty || m.dirty;
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;

  const discard = () => { setEditing(false); setDirty(false); m.stop(); };
  /** Run `fn` now, or after confirming that unsaved edits / markup may be thrown away. */
  const guard = (fn, { title = 'Discard unsaved changes?', message } = {}) => {
    if (!unsavedRef.current) { fn(); return; }
    ui.openDialog('confirm', {
      title,
      message: message || (m.dirty ? 'Your markup hasn’t been saved. If you continue, it will be lost.' : 'Your edits haven’t been saved. If you continue, they will be lost.'),
      confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true,
      onConfirm: () => { discard(); unsavedRef.current = false; fn(); },
    });
  };

  const go = (d) => {
    const next = siblings[idx + d];
    if (!next) return;
    guard(() => { setPreview({ ...preview, id: next }); api.markOpened(next); });
  };
  const close = () => guard(() => closePreview());
  const cancelMarkup = () => { if (!m.dirty) m.stop(); else guard(() => {}, { title: 'Discard your markup changes?' }); };
  const saveMarkup = () => {
    const list = m.cleaned();
    if (!m.dirty && list.length === (m.list || []).length) { m.stop(); return; }
    api.saveAnnotations(item.id, list);
    m.stop();
    setShowMarkup(true);
    setStaleHidden(false);
    ui.toast(list.length ? `Markup saved · ${list.length} mark${list.length === 1 ? '' : 's'}` : 'Markup removed', { type: 'success' });
  };
  const exportMarkup = async () => {
    ui.toast('Preparing a copy with markup…', { type: 'info' });
    try {
      await downloadWithMarkup(item, item.annotations || [], nameOf);
      api.logEvent('Downloaded with markup', item.name, `${(item.annotations || []).length} marks`, { itemId: item.id });
    } catch (e) {
      ui.toast(e?.message || 'Could not create the marked-up copy', { type: 'error', duration: 6000 });
    }
  };

  // Browser Back / Alt+← / mouse back would close the preview and lose unsaved work: undo the step and ask first.
  useEffect(() => {
    if (!preview || !unsaved) return undefined;
    let restoring = false;
    let leaving = false;
    const onPop = (e) => {
      if (leaving || (!unsavedRef.current && !restoring)) return; // e.g. closePreview() right after "Discard"
      e.stopImmediatePropagation(); // keep the router from closing the preview
      if (restoring) { restoring = false; return; }
      restoring = true;
      window.history.go(1);
      ui.openDialog('confirm', {
        title: 'Discard unsaved changes?',
        message: 'You have unsaved changes in this preview. Leave and discard them?',
        confirmLabel: 'Discard and leave', cancelLabel: 'Keep editing', danger: true,
        onConfirm: () => { leaving = true; discard(); unsavedRef.current = false; window.history.back(); },
      });
    };
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('popstate', onPop, true);
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('popstate', onPop, true); window.removeEventListener('beforeunload', onUnload); };
  }, [preview?.id, unsaved]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!preview) return undefined;
    const onKey = (e) => {
      if (ui.dialog || ui.menu) return;
      const typing = typingIn(document.activeElement);
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f' && canFind) { e.preventDefault(); openFind(); return; }
      if (e.key === 'Escape' && !typing) { e.preventDefault(); if (keysOpen) setKeysOpen(false); else if (findOpen) closeFind(); else if (m.active) cancelMarkup(); else close(); return; }
      if (typing) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { if (editing) { e.preventDefault(); save(); } return; }
      if (e.altKey || e.metaKey || e.ctrlKey) return; // Alt+← is browser Back, Ctrl/Cmd+± is browser zoom
      if (e.key === '?') { e.preventDefault(); setKeysOpen((o) => !o); return; }
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(3, z + 0.25));
      if (e.key === '-') setZoom((z) => Math.max(0.5, z - 0.25));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const gone = preview && (!item || item.type !== 'file' || accessOf(state, item) === 'none' || (isTrashedDeep(state.items, item.id) && !item.trashed));
  useEffect(() => { if (gone) closePreview(); }, [gone, closePreview]);

  // Markup saved on a different version may not line up with this one.
  const annots = item?.annotations || [];
  const staleVersion = !!(item && annots.length && item.annotatedVersion && item.annotatedVersion !== (item.version || 1));
  const pageCount = usePageCount(item, staleVersion);

  if (!preview || !item || gone) return null;

  const startEdit = () => {
    if (cat === 'spreadsheet') setSheet(sampleSheet(item).map((r) => [...r]));
    else if (cat === 'presentation') setSlides(sampleSlides(item).map((s) => ({ ...s })));
    else setDraft(item.content ?? (cat === 'document' ? sampleText(item) : ''));
    setEditing(true);
    setDirty(false);
  };
  function save() {
    if (!editing) return;
    if (!dirty) { ui.toast('No changes to save', { type: 'info' }); return; }
    const patch = cat === 'spreadsheet' ? { sheet, size: JSON.stringify(sheet).length + 4096 }
      : cat === 'presentation' ? { slides, size: JSON.stringify(slides).length + 8192 }
      : { content: draft, size: new Blob([draft]).size };
    if (!api.saveVersion(item.id, patch)) {
      ui.toast(`${lockHolder || 'Someone else'} locked this file. Copy your changes before closing.`, { type: 'error', duration: 6000 });
      return;
    }
    setEditing(false);
    setDirty(false);
    ui.toast(`Saved as version ${versionNo(item) + 1}`, { type: 'success' });
  }
  const wrap = (setter) => (v) => { setter(v); setDirty(true); };
  const cancelEdit = () => { if (!dirty) { setEditing(false); return; } guard(() => {}); };

  // Marks on pages this version doesn't have aren't counted (or shown, or exported).
  const visibleAnnots = pageCount ? annots.filter((a) => (a.page || 1) <= pageCount) : annots;
  const annotCount = visibleAnnots.length;
  // PDFs render on canvases (instead of the browser's viewer) while marking up or when saved markup is shown.
  const pdfCanvas = cat === 'pdf' && (m.active || (annotCount > 0 && showMarkup));
  const pdfInline = cat === 'pdf' && realUrl(item) && !pdfCanvas && !pdfNeedsCanvas();
  const canMarkup = supportsMarkup(item) && canCommentAccess(accessOf(state, item)) && !item.trashed && !editing;
  const zoomable = ['image', 'pdf', 'document'].includes(cat) && !editing && !pdfInline;
  const showStrip = cat === 'image' && imageSiblings.length > 1 && !m.active;
  const mySign = cat === 'pdf' ? signWaitingForMe(state).find((r) => r.itemId === item.id) : null;
  const canRequestSign = cat === 'pdf' && !item.trashed && canEdit(accessOf(state, item));
  const showStale = staleVersion && !staleHidden && (m.active || (annotCount > 0 && showMarkup));
  const pickImage = (id) => { if (id !== item.id) guard(() => { setPreview({ ...preview, id }); api.markOpened(id); }); };

  const clearStale = () => ui.openDialog('confirm', {
    title: 'Clear markup?', message: `All ${annots.length} mark${annots.length === 1 ? '' : 's'} on this file will be removed for everyone.`,
    confirmLabel: 'Clear markup', danger: true,
    onConfirm: () => { api.saveAnnotations(item.id, []); ui.toast('Markup cleared', { type: 'success' }); },
  });

  // On phones the secondary actions live in the More menu so the title and primary actions keep their room.
  const narrowItems = () => {
    if (!narrow) return [];
    const out = [];
    if (zoomable) {
      out.push({ label: 'Zoom in', icon: ZoomIn, onClick: () => setZoom((z) => Math.min(3, z + 0.25)) });
      out.push({ label: 'Zoom out', icon: ZoomOut, onClick: () => setZoom((z) => Math.max(0.5, z - 0.25)) });
      if (zoom !== 1) out.push({ label: `Reset zoom (${Math.round(zoom * 100)}%)`, icon: RotateCcw, onClick: () => setZoom(1) });
    }
    if (canFind) out.push({ label: 'Find in file', icon: Search, onClick: openFind });
    if (canMarkup && !m.active) out.push({ label: 'Markup', icon: Highlighter, onClick: () => { m.start(); setInfo(false); } });
    if (annotCount > 0 && !m.active) {
      out.push({ label: showMarkup ? `Hide markup (${annotCount})` : `Show markup (${annotCount})`, icon: showMarkup ? EyeOff : Eye, onClick: () => setShowMarkup(!showMarkup) });
      out.push({ label: 'Download with markup', icon: FileDown, onClick: exportMarkup });
    }
    if (supportsEdit && editable && !lockedOther && !editing && !m.active) out.push({ label: 'Edit', icon: PenLine, onClick: startEdit });
    if (!item.trashed && !m.active) out.push({ label: 'Comments', icon: MessageSquare, onClick: () => openInfoTab('comments') });
    if (!m.active) out.push({ label: 'File information', icon: Info, onClick: () => openInfoTab('details') });
    if (!item.trashed) out.push({ label: 'Share', icon: Share2, onClick: () => ui.openDialog('share', { id: item.id }) });
    out.push({ label: 'Keyboard shortcuts', icon: Keyboard, onClick: () => setKeysOpen(true) });
    if (out.length) out.push({ divider: true });
    return out;
  };
  const more = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    // Item actions (Show in folder, Move, Trash, …) leave or change the file: confirm before losing unsaved work.
    const fileItems = actions.menuFor([item], item.trashed ? 'trash' : 'browse')
      .filter((x) => !['Open', 'Preview'].includes(x.label))
      .map((x) => (x.divider || !x.onClick ? x : { ...x, onClick: (...args) => guard(() => x.onClick(...args)) }));
    ui.showMenu({ x: Math.max(8, r.right - 220), y: r.bottom + 4 }, [...narrowItems(), ...fileItems]);
  };

  const viewer = () => {
    switch (cat) {
      case 'image': return <MarkedImage item={item} zoom={zoom} m={m} show={showMarkup} />;
      case 'pdf': return pdfCanvas ? <MarkedPdf item={item} zoom={zoom} m={m} show={showMarkup} /> : <PdfViewer item={item} zoom={zoom} onDownload={() => actions.download([item])} />;
      case 'audio': return <AudioViewer item={item} />;
      case 'text': return <TextViewer item={item} editing={editing} draft={draft} setDraft={wrap(setDraft)} />;
      case 'document': return <DocViewer item={item} editing={editing} draft={draft} setDraft={wrap(setDraft)} zoom={zoom} />;
      case 'spreadsheet': return <SheetViewer item={item} editing={editing} sheet={sheet} setSheet={wrap(setSheet)} />;
      case 'presentation': return <SlidesViewer item={item} editing={editing} slides={slides} setSlides={wrap(setSlides)} />;
      case 'video': return <VideoViewer item={item} />;
      case 'archive': return <ArchiveViewer item={item} onExtract={!item.trashed && item.ext === 'zip' ? () => { closePreview(); actions.extractZip(item); } : undefined} />;
      default: return <NoPreview item={item} onDownload={() => actions.download([item])} />;
    }
  };

  return createPortal(
    <div className="preview-overlay fade-in" role="dialog" aria-modal="true" aria-label={`Preview of ${item.name}`}>
      <header className="preview-bar">
        <button className="icon-btn on-dark" onClick={close} aria-label="Close preview" data-tip="Close (Esc)"><X size={20} /></button>
        <FileIcon item={item} size={26} />
        <div className="preview-title min0">
          <div className="truncate strong">{item.name}{unsaved && <span className="unsaved"> · Unsaved changes</span>}</div>
          <div className="preview-sub truncate">
            {formatSize(item.size)} · Modified {formatDate(item.modifiedAt)} ·{' '}
            <button className="preview-loc" onClick={() => guard(() => actions.showInFolder(item))} aria-label={`Show in folder: ${locationOf(state, item)}`} data-tip="Show in folder">
              {locationOf(state, item)}
            </button>
          </div>
        </div>
        {siblings.length > 1 && (
          <div className="preview-nav hide-sm">
            <button className="icon-btn on-dark" disabled={idx <= 0} onClick={() => go(-1)} aria-label="Previous file" data-tip="Previous (←)"><ChevronLeft size={18} /></button>
            <span>{idx + 1} / {siblings.length}</span>
            <button className="icon-btn on-dark" disabled={idx >= siblings.length - 1} onClick={() => go(1)} aria-label="Next file" data-tip="Next (→)"><ChevronRight size={18} /></button>
          </div>
        )}
        <div className="preview-actions">
          {zoomable && !narrow && (
            <div className={`zoom-group ${m.active ? '' : 'hide-sm'}`}>
              <button className="icon-btn on-dark" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out" data-tip="Zoom out (−)"><ZoomOut size={17} /></button>
              <button className="zoom-val" onClick={() => setZoom(1)} aria-label={`Zoom ${Math.round(zoom * 100)}%, reset`} data-tip="Reset zoom">{Math.round(zoom * 100)}%</button>
              <button className="icon-btn on-dark" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} aria-label="Zoom in" data-tip="Zoom in (+)"><ZoomIn size={17} /></button>
            </div>
          )}
          {!narrow && canFind && (
            <button className={`icon-btn on-dark ${findOpen ? 'active' : ''}`} onClick={() => (findOpen ? closeFind() : openFind())} aria-label="Find in file" aria-pressed={findOpen} data-tip="Find in file (Ctrl+F)"><Search size={18} /></button>
          )}
          {!narrow && canMarkup && !m.active && (
            <button className="btn btn-ghost-dark" onClick={() => { m.start(); setInfo(false); }} aria-label="Markup" data-tip="Draw, highlight, add notes and stamps"><Highlighter size={15} /> <span className="btn-text">Markup</span></button>
          )}
          {!narrow && annotCount > 0 && !m.active && (
            <>
              <button className={`icon-btn on-dark with-count ${showMarkup ? 'active' : ''}`} onClick={() => setShowMarkup(!showMarkup)} aria-pressed={showMarkup} aria-label={showMarkup ? `Hide markup (${annotCount})` : `Show markup (${annotCount})`} data-tip={showMarkup ? 'Hide markup' : 'Show markup'}>
                {showMarkup ? <Eye size={18} /> : <EyeOff size={18} />}<span className="btn-count">{annotCount}</span>
              </button>
              <button className="icon-btn on-dark hide-xs" onClick={exportMarkup} aria-label="Download with markup" data-tip="Download with markup"><FileDown size={18} /></button>
            </>
          )}
          {mySign && !m.active && <button className="btn btn-primary" onClick={() => guard(() => ui.openDialog('signDocument', { requestId: mySign.id, signerId: mySign.mySigner.id }))} aria-label="Sign this document"><PenTool size={15} /> <span className="btn-text">Sign</span></button>}
          {!mySign && canRequestSign && !m.active && (
            <button className="icon-btn on-dark hide-xs" onClick={() => ui.openDialog('signRequest', { itemId: item.id })} aria-label="Request signature" data-tip="Request signature"><PenTool size={18} /></button>
          )}
          {cat === 'image' && imageSiblings.length > 1 && !m.active && (
            <button className="icon-btn on-dark hide-xs" onClick={() => setSlideshow(true)} aria-label="Slideshow" data-tip="Slideshow"><GalleryHorizontalEnd size={18} /></button>
          )}
          <PresenceStack item={item} dark />
          {supportsEdit && editable && lockedOther && !editing && (
            <span className="lock-chip" data-tip={`${lockHolder} has this file checked out`} aria-label={`Locked by ${lockHolder}`}><Lock size={13} /> <span className="btn-text">Locked by {lockHolder?.split(' ')[0]}</span></span>
          )}
          {supportsEdit && editable && (!lockedOther || editing) && (editing ? (
            <>
              <button className="btn btn-ghost-dark" onClick={cancelEdit} aria-label="Cancel editing">Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!dirty} aria-label="Save changes"><Save size={15} /> <span className="btn-text">Save</span></button>
            </>
          ) : !narrow && !m.active && (
            <button className="btn btn-ghost-dark" onClick={startEdit} aria-label="Edit"><PenLine size={15} /> <span className="btn-text">Edit</span></button>
          ))}
          {!narrow && !item.trashed && <button className="icon-btn on-dark" onClick={() => ui.openDialog('share', { id: item.id })} aria-label="Share" data-tip="Share"><Share2 size={18} /></button>}
          <button className="icon-btn on-dark" onClick={() => actions.download([item])} aria-label="Download" data-tip="Download"><Download size={18} /></button>
          {!item.trashed && (
            <button className={`icon-btn on-dark hide-xs ${item.favorite ? 'fav-on' : ''}`} onClick={() => actions.setFavorite([item], !item.favorite)} aria-label={item.favorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={!!item.favorite} data-tip={item.favorite ? 'Remove from favorites' : 'Add to favorites'}>
              <Star size={18} fill={item.favorite ? 'currentColor' : 'none'} />
            </button>
          )}
          {realUrl(item) && ['pdf', 'image', 'video'].includes(cat) && (
            <a className="icon-btn on-dark hide-xs" href={realUrl(item)} target="_blank" rel="noreferrer" aria-label="Open in new tab" data-tip="Open in new tab"><Maximize2 size={17} /></a>
          )}
          {!narrow && !item.trashed && (
            <button className={`icon-btn on-dark with-count ${info && infoTab === 'comments' ? 'active' : ''}`} onClick={() => (info && infoTab === 'comments' ? setInfo(false) : openInfoTab('comments'))} aria-label={openCommentCount(item) ? `Comments (${openCommentCount(item)} open)` : 'Comments'} data-tip="Comments">
              <MessageSquare size={18} />{openCommentCount(item) > 0 && <span className="btn-count">{openCommentCount(item)}</span>}
            </button>
          )}
          {!narrow && <button className={`icon-btn on-dark ${info && infoTab !== 'comments' ? 'active' : ''}`} onClick={() => (info ? setInfo(false) : openInfoTab('details'))} aria-label="Toggle file information" aria-pressed={info && infoTab !== 'comments'} data-tip="File information"><Info size={18} /></button>}
          {!narrow && (
            <div className="kbd-help-wrap hide-sm">
              <button className={`icon-btn on-dark kbd-help-btn ${keysOpen ? 'active' : ''}`} onClick={() => setKeysOpen(!keysOpen)} aria-label="Keyboard shortcuts" aria-expanded={keysOpen} data-tip="Keyboard shortcuts (?)"><Keyboard size={18} /></button>
            </div>
          )}
          <button className="icon-btn on-dark" onClick={more} aria-label="More actions" data-tip="More actions"><MoreVertical size={18} /></button>
        </div>
        {keysOpen && <ShortcutsPopover cat={cat} markup={m.active} find={canFind} onClose={() => setKeysOpen(false)} />}
      </header>
      {m.active && <MarkupToolbar m={m} onCancel={cancelMarkup} onSave={saveMarkup} />}
      {showStale && (
        <div className="markup-stale" role="status">
          <AlertTriangle size={15} />
          <span className="grow min0">Markup was added on version {item.annotatedVersion}. It may not line up with this version{annots.length > annotCount ? ` (${annots.length - annotCount} mark${annots.length - annotCount === 1 ? ' is' : 's are'} on pages this version doesn’t have)` : ''}.</span>
          {!m.active && <button className="btn btn-ghost-dark btn-sm" onClick={() => { setShowMarkup(false); setStaleHidden(true); }}>Hide</button>}
          {!m.active && editable && <button className="btn btn-ghost-dark btn-sm" onClick={clearStale}>Clear markup</button>}
          {m.active && <button className="icon-btn on-dark" onClick={() => setStaleHidden(true)} aria-label="Dismiss"><X size={15} /></button>}
        </div>
      )}
      <div className="preview-body">
        <div className={`preview-stage ${showStrip ? 'with-strip' : ''}`} ref={stageRef}>
          <FindContext.Provider value={findCtx}>{viewer()}</FindContext.Provider>
          {findOpen && canFind && (
            <FindBar value={findText} onChange={setFindText} result={findResult} index={findIdx} unavailable={findEngine === 'none'} inputRef={findInput}
              onNext={() => stepFind(1)} onPrev={() => stepFind(-1)} onClose={() => { closeFind(); stageRef.current?.closest('.preview-overlay')?.focus?.(); }} />
          )}
          {showStrip && <Filmstrip ids={imageSiblings} current={item.id} onPick={pickImage} />}
          {siblings.length > 1 && idx > 0 && !m.active && <button className="stage-arrow left" onClick={() => go(-1)} aria-label="Previous file"><ChevronLeft size={26} /></button>}
          {siblings.length > 1 && idx < siblings.length - 1 && !m.active && <button className="stage-arrow right" onClick={() => go(1)} aria-label="Next file"><ChevronRight size={26} /></button>}
          {editing && <div className="edit-hint"><Check size={13} /> Editing · Ctrl+S to save</div>}
        </div>
        {info && !m.active && (
          <aside className="preview-info slide-in">
            <div className="details-head"><strong>File information</strong><button className="icon-btn" onClick={() => setInfo(false)} aria-label="Close information"><X size={18} /></button></div>
            <div className="details-scroll"><DetailsContent key={item.id} item={item} initialTab={infoTab} onTabChange={setInfoTab} /></div>
          </aside>
        )}
      </div>
      {slideshow && <Slideshow ids={imageSiblings} startId={item.id} onClose={() => setSlideshow(false)} onChange={(id) => { if (id !== item.id) setPreview({ ...preview, id }); }} />}
    </div>,
    document.body,
  );
}
