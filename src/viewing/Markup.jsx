import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  MousePointer2, PenLine, Highlighter, Square, Type, StickyNote, Stamp, Eraser, Undo2, Redo2, Save, X, ChevronDown, Trash2,
} from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { accessOf, canEdit } from '../store/selectors';
import { fileBlob } from '../store/useItemActions';
import { getFileType, genThumb } from '../utils/fileTypes';
import { formatDateTime, uid } from '../utils/format';
import { saveBlob } from '../utils/exporters';
import { loadPdfjs } from '../utils/pdfThumb';
import { realUrl } from '../components/preview/Viewers';
import { PdfPages, usePdfDocument } from './PdfPages';
import { flattenPdf, textPagesCanvas } from './pdfWriter';
import {
  COLORS, HIGHLIGHT_COLORS, STAMPS, px, smoothPath, stampBox, bbox, moved, drawAnnotations, withNotesLegend, fmtStampDate,
} from './annotations';

export const TOOLS = [
  { id: 'select', label: 'Select & move', icon: MousePointer2, key: 'v' },
  { id: 'pen', label: 'Pen', icon: PenLine, key: 'p' },
  { id: 'highlight', label: 'Highlighter', icon: Highlighter, key: 'h' },
  { id: 'rect', label: 'Box', icon: Square, key: 'r' },
  { id: 'text', label: 'Text', icon: Type, key: 't' },
  { id: 'note', label: 'Sticky note', icon: StickyNote, key: 'n' },
  { id: 'stamp', label: 'Stamp', icon: Stamp, key: 's' },
  { id: 'eraser', label: 'Eraser', icon: Eraser, key: 'e' },
];
const DRAW_TOOLS = ['pen', 'highlight', 'rect'];

export const supportsMarkup = (item) => ['pdf', 'image'].includes(getFileType(item?.ext).category);

const typingIn = (el) => !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

/* ------------------------------------------------------------------ */
/* Session state: the working copy of the annotations while editing    */
/* ------------------------------------------------------------------ */
export function useMarkup(item) {
  const { state } = useDrive();
  const [active, setActive] = useState(false);
  const [list, setListRaw] = useState([]);
  const [base, setBase] = useState(null); // the list the session started from (dirty = list differs from it)
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [hl, setHl] = useState(HIGHLIGHT_COLORS[0]);
  const [stamp, setStamp] = useState(STAMPS[0]);
  const [selected, setSelected] = useState(null);
  // The note / text mark being typed: { kind, id, snap (list before it was added, or before this edit), isNew, recorded }.
  const [focus, setFocusRaw] = useState(null);
  const focusRef = useRef(null);
  const listRef = useRef(list);
  listRef.current = list;
  const setFocus = (f) => { focusRef.current = f; setFocusRaw(f); };

  useEffect(() => { setActive(false); setSelected(null); setBase(null); setFocus(null); }, [item?.id]);

  // Editors (and the owner) may change anyone's marks; everyone else only their own.
  const editsOthers = !!item && canEdit(accessOf(state, item));
  const mayChange = useCallback((a) => !!a && (a.by === state.meId || editsOthers), [state.meId, editsOthers]);

  /** Apply a change; `record=false` updates without an undo step (used while dragging / typing). */
  const change = useCallback((fn, record = true) => {
    const prev = listRef.current;
    const next = typeof fn === 'function' ? fn(prev) : fn;
    if (next === prev) return;
    if (record) { setPast((p) => [...p.slice(-80), prev]); setFuture([]); }
    listRef.current = next;
    setListRaw(next);
  }, []);
  const checkpoint = useCallback((snapshot) => { setPast((p) => [...p.slice(-80), snapshot]); setFuture([]); }, []);

  /** Add a note/text mark without an undo step; the step is recorded once text is actually typed. */
  const addTyped = (a) => {
    const snap = listRef.current;
    change((l) => [...l, a], false);
    setFocus({ kind: a.kind, id: a.id, snap, isNew: true, recorded: false });
  };
  /** Open an existing note/text mark for typing. */
  const editTyped = (a) => {
    if (focusRef.current?.id === a.id) return;
    finishTyped();
    setFocus({ kind: a.kind, id: a.id, snap: listRef.current, isNew: false, recorded: false });
  };
  /** Live text update from the editor (so nothing typed is lost if the user saves without pressing Done). */
  const typeText = (id, text) => {
    const f = focusRef.current;
    if (!f || f.id !== id) return;
    const cur = listRef.current.find((x) => x.id === id);
    if (!cur || cur.text === text) return;
    if (!f.recorded && text.trim()) { checkpoint(f.snap); focusRef.current = { ...f, recorded: true }; }
    change((l) => l.map((x) => (x.id === id ? { ...x, text } : x)), false);
  };
  /** Close the open editor; a new mark that never got text is removed again (leaving no undo step). */
  function finishTyped() {
    const f = focusRef.current;
    if (!f) return;
    setFocus(null);
    const cur = listRef.current.find((x) => x.id === f.id);
    if (!cur) return;
    if (!(cur.text || '').trim() && (f.isNew || cur.kind === 'text')) {
      const l = listRef.current;
      const untouched = f.isNew && l.length === f.snap.length + 1 && f.snap.every((x, i) => l[i] === x);
      if (f.isNew && !f.recorded && untouched) change(f.snap, false);
      else change((x) => x.filter((y) => y.id !== f.id), !f.recorded && !f.isNew);
    }
  }
  const remove = (id) => {
    if (focusRef.current?.id === id) setFocus(null);
    change((l) => l.filter((x) => x.id !== id));
    setSelected(null);
  };

  const dirty = active && base !== null && list !== base;

  return {
    active, list, tool, color: tool === 'highlight' ? hl : color, stamp, selected, dirty, focus,
    pen: color, hl, editsOthers, mayChange,
    setTool: (t) => { finishTyped(); setTool(t); setSelected(null); },
    setColor: (c) => (tool === 'highlight' ? setHl(c) : setColor(c)),
    setStamp, setSelected, change, checkpoint, addTyped, editTyped, typeText, finishTyped, remove,
    /** The list to save: flushes the open editor and drops empty text marks / my empty notes. */
    cleaned() {
      finishTyped();
      return listRef.current.filter((a) => !(a.kind === 'text' && !(a.text || '').trim()) && !(a.kind === 'note' && !(a.text || '').trim() && a.by === state.meId));
    },
    start() { const l = item.annotations || []; listRef.current = l; setListRaw(l); setBase(l); setPast([]); setFuture([]); setSelected(null); setFocus(null); setActive(true); },
    stop() { setActive(false); setSelected(null); setBase(null); setFocus(null); },
    undo() {
      finishTyped();
      if (!past.length) return;
      setFuture((f) => [listRef.current, ...f]);
      const prev = past[past.length - 1];
      listRef.current = prev; setListRaw(prev); setPast(past.slice(0, -1)); setSelected(null);
    },
    redo() {
      finishTyped();
      if (!future.length) return;
      setPast((p) => [...p, listRef.current]);
      listRef.current = future[0]; setListRaw(future[0]); setFuture(future.slice(1));
    },
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Overlay for one page / image                                        */
/* ------------------------------------------------------------------ */
function Shape({ a, w, h, nameOf }) {
  switch (a.kind) {
    case 'pen':
    case 'highlight':
      return <path d={smoothPath(a.pts, w, h)} fill="none" stroke={a.color} strokeWidth={px(a.kind, w)} strokeLinecap="round" strokeLinejoin="round"
        opacity={a.kind === 'highlight' ? 0.38 : 1} style={a.kind === 'highlight' ? { mixBlendMode: 'multiply' } : undefined} />;
    case 'rect':
      return <rect x={a.x * w} y={a.y * h} width={a.w * w} height={a.h * h} fill="none" stroke={a.color} strokeWidth={px('rect', w)} rx={2} />;
    case 'text': {
      const f = px('text', w) * (a.size || 1);
      return (
        <text x={a.x * w + 2} y={a.y * h} fill={a.color} fontSize={f} fontWeight={600} dominantBaseline="hanging" style={{ whiteSpace: 'pre' }}>
          {(a.text || '').split('\n').map((l, i) => <tspan key={i} x={a.x * w + 2} dy={i ? f * 1.25 : 0}>{l || ' '}</tspan>)}
        </text>
      );
    }
    case 'stamp': {
      const s = stampBox(a, w);
      const x = a.x * w - s.bw / 2; const y = a.y * h - s.bh / 2;
      return (
        <g opacity={0.9}>
          <rect x={x} y={y} width={s.bw} height={s.bh} rx={s.font * 0.3} fill="rgba(255,255,255,0.35)" stroke={a.color} strokeWidth={Math.max(2, s.font * 0.14)} />
          <text x={a.x * w} y={y + s.bh * 0.4} fill={a.color} fontSize={s.font} fontWeight={800} textAnchor="middle" dominantBaseline="central" textLength={s.textW} lengthAdjust="spacingAndGlyphs">{a.label}</text>
          <text x={a.x * w} y={y + s.bh * 0.8} fill={a.color} fontSize={s.font * 0.42} fontWeight={500} textAnchor="middle" dominantBaseline="central">{`${nameOf(a.by)} · ${fmtStampDate(a.at)}`.toUpperCase()}</text>
        </g>
      );
    }
    case 'note': {
      const s = px('note', w);
      return (
        <g className="annot-note-icon">
          <rect x={a.x * w - s / 2} y={a.y * h - s / 2} width={s} height={s} rx={s * 0.18} fill="#FACC15" stroke="#A16207" strokeWidth={1.5} />
          <path d={`M${a.x * w - s * 0.25} ${a.y * h - s * 0.12}h${s * 0.5}M${a.x * w - s * 0.25} ${a.y * h + s * 0.08}h${s * 0.34}`} stroke="#713F12" strokeWidth={Math.max(1.5, s * 0.08)} strokeLinecap="round" />
        </g>
      );
    }
    default: return null;
  }
}

/**
 * Draws a page's annotations and, when `m` (an active markup session) is given, lets the user add,
 * select, move and erase them. Without a session it is read-only (notes can still be opened).
 */
export function AnnotationLayer({ page, w, h, list, m }) {
  const { state } = useDrive();
  const nameOf = useCallback((id) => (id === state.meId ? state.users.find((u) => u.id === id)?.name || 'Me' : state.users.find((u) => u.id === id)?.name || 'Someone'), [state.users, state.meId]);
  const svgRef = useRef(null);
  const [draft, setDraft] = useState(null); // shape being drawn
  const [viewNote, setViewNote] = useState(null); // read-only mode: note id with its popover open
  const drag = useRef(null);
  const editing = !!m?.active;
  const tool = editing ? m.tool : null;
  const mine = list.filter((a) => a.page === page);
  const openNote = editing ? (m.focus?.kind === 'note' ? m.focus.id : null) : viewNote;
  const editText = editing && m.focus?.kind === 'text' ? m.focus.id : null;

  const norm = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
  };
  const base = () => ({ id: uid('an'), page, by: state.meId, at: Date.now() });

  const onDown = (e) => {
    if (!editing || e.button > 0) return;
    // A tap elsewhere while a note or text box is open just closes it (instead of starting a second one).
    if (m.focus) { e.preventDefault(); m.finishTyped(); return; }
    const [x, y] = norm(e);
    if (tool === 'pen' || tool === 'highlight') {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraft({ ...base(), kind: tool, color: m.color, pts: [[x, y]] });
    } else if (tool === 'rect') {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraft({ ...base(), kind: 'rect', color: m.color, x, y, w: 0, h: 0, ox: x, oy: y });
    } else if (tool === 'note') {
      e.preventDefault(); // keep focus for the note's textarea
      m.addTyped({ ...base(), kind: 'note', x, y, text: '' });
    } else if (tool === 'text') {
      e.preventDefault(); // otherwise the pointerdown's default focus change blurs (and removes) the new text box
      m.addTyped({ ...base(), kind: 'text', x, y, text: '', color: m.color, size: 1 });
    } else if (tool === 'stamp') {
      m.change((l) => [...l, { ...base(), kind: 'stamp', x, y, label: m.stamp.label, color: m.stamp.color }]);
    } else if (tool === 'select') {
      m.setSelected(null);
    }
  };
  const onMove = (e) => {
    if (drag.current) {
      const [x, y] = norm(e);
      const d = drag.current;
      const dx = x - d.x; const dy = y - d.y;
      if (Math.abs(dx) + Math.abs(dy) < 0.002 && !d.moved) return;
      if (!d.moved) { d.moved = true; m.checkpoint(m.list); }
      m.change((l) => l.map((a) => (a.id === d.id ? moved(d.orig, dx, dy) : a)), false);
      return;
    }
    if (!draft) return;
    const [x, y] = norm(e);
    if (draft.pts) {
      const last = draft.pts[draft.pts.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) > 0.002) setDraft({ ...draft, pts: [...draft.pts, [x, y]] });
    } else setDraft({ ...draft, x: Math.min(x, draft.ox), y: Math.min(y, draft.oy), w: Math.abs(x - draft.ox), h: Math.abs(y - draft.oy) });
  };
  const onUp = () => {
    if (drag.current) { drag.current = null; return; }
    if (!draft) return;
    const { ox, oy, ...a } = draft; // eslint-disable-line no-unused-vars
    if (a.kind !== 'rect' || (a.w > 0.01 && a.h > 0.01)) m.change((l) => [...l, a]);
    setDraft(null);
  };

  const onShapeDown = (e, a) => {
    if (!editing) { if (a.kind === 'note') { e.stopPropagation(); setViewNote(viewNote === a.id ? null : a.id); } return; }
    if (m.focus && m.focus.id !== a.id) { e.stopPropagation(); e.preventDefault(); m.finishTyped(); return; }
    if (tool === 'eraser') {
      e.stopPropagation();
      if (m.mayChange(a)) m.remove(a.id);
      return;
    }
    if (tool === 'select') {
      e.stopPropagation();
      m.setSelected(a.id);
      if (!m.mayChange(a)) return; // others' marks can be selected (to see them) but not moved
      const [x, y] = norm(e);
      drag.current = { id: a.id, x, y, orig: a, moved: false };
      svgRef.current.setPointerCapture?.(e.pointerId);
      return;
    }
    if (a.kind === 'note') { e.stopPropagation(); e.preventDefault(); if (openNote === a.id) m.finishTyped(); else m.editTyped(a); }
  };
  const onShapeDouble = (a) => {
    if (!editing) return;
    if (a.kind === 'text' && m.mayChange(a)) m.editTyped(a);
    if (a.kind === 'note') m.editTyped(a);
  };

  // Delete the selected annotation from the keyboard.
  useEffect(() => {
    if (!editing || !m.selected || !mine.some((a) => a.id === m.selected)) return undefined;
    const onKey = (e) => {
      if (typingIn(document.activeElement)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const a = mine.find((x) => x.id === m.selected);
        if (!m.mayChange(a)) return;
        e.preventDefault(); m.remove(a.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const sel = editing && m.selected ? mine.find((a) => a.id === m.selected) : null;
  const selBox = sel ? bbox(sel, w, h) : null;
  const note = openNote ? mine.find((a) => a.id === openNote) : null;
  const textA = editText ? mine.find((a) => a.id === editText) : null;
  const cursor = !editing ? 'default' : { select: 'default', eraser: 'cell', text: 'text' }[tool] || 'crosshair';
  // Only drawing tools block touch scrolling/pinch; with the others the page can still be panned and zoomed.
  const touchAction = editing && DRAW_TOOLS.includes(tool) ? 'none' : 'pan-x pan-y pinch-zoom';

  return (
    <div className={`annot-layer ${editing ? 'editing' : ''}`} style={{ width: w, height: h }}>
      <svg ref={svgRef} width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ cursor, pointerEvents: editing ? 'auto' : 'none', touchAction }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {mine.map((a) => {
          const locked = editing && ['select', 'eraser'].includes(tool) && !m.mayChange(a);
          return (
            <g key={a.id} className={`annot annot-${a.kind} ${editing && tool === 'eraser' && !locked ? 'erasable' : ''}`}
              style={{ pointerEvents: editing || a.kind === 'note' ? 'auto' : 'none', cursor: tool === 'select' && !locked ? 'move' : locked ? 'not-allowed' : undefined, touchAction: editing && ['select', 'eraser'].includes(tool) && !locked ? 'none' : undefined }}
              onPointerDown={(e) => onShapeDown(e, a)} onDoubleClick={() => onShapeDouble(a)}>
              {(a.pts || a.kind === 'rect') && editing && <HitArea a={a} w={w} h={h} />}
              {!(a.kind === 'text' && editText === a.id) && <Shape a={a} w={w} h={h} nameOf={nameOf} />}
            </g>
          );
        })}
        {draft && <Shape a={draft} w={w} h={h} nameOf={nameOf} />}
        {selBox && <rect className="annot-sel" x={selBox.x - 3} y={selBox.y - 3} width={selBox.w + 6} height={selBox.h + 6} rx={3} />}
      </svg>

      {selBox && m.mayChange(sel) && (
        <button type="button" className="annot-sel-del" style={{ left: Math.min(w - 14, selBox.x + selBox.w + 3), top: Math.max(-10, selBox.y - 14) }}
          onPointerDown={(e) => e.stopPropagation()} onClick={() => m.remove(sel.id)} aria-label="Delete selected mark" data-tip="Delete (Del)">
          <Trash2 size={13} />
        </button>
      )}
      {textA && <TextEditor key={textA.id} a={textA} w={w} h={h} onChange={(t) => m.typeText(textA.id, t)} onDone={() => m.finishTyped()} />}
      {note && (
        <NotePopover key={note.id} a={note} w={w} h={h} editable={editing && note.by === state.meId} author={nameOf(note.by)}
          onChange={(t) => m.typeText(note.id, t)}
          onClose={() => { if (editing) m.finishTyped(); else setViewNote(null); }}
          onDelete={editing && m.mayChange(note) ? () => m.remove(note.id) : null} />
      )}
    </div>
  );
}

/** Invisible wide stroke so thin lines are easy to pick with select/eraser. */
function HitArea({ a, w, h }) {
  if (a.pts) return <path d={smoothPath(a.pts, w, h)} fill="none" stroke="transparent" strokeWidth={Math.max(14, px(a.kind, w) + 10)} />;
  return <rect x={a.x * w} y={a.y * h} width={a.w * w} height={a.h * h} fill="none" stroke="transparent" strokeWidth={14} />;
}

/** Ctrl/Cmd+S inside an editor is left to bubble (the toolbar saves); every other key stays in the editor. */
const editorKeys = (e, done) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return; }
  e.stopPropagation();
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); done(); }
};

function TextEditor({ a, w, h, onChange, onDone }) {
  const [v, setV] = useState(a.text || '');
  const ref = useRef(null);
  useLayoutEffect(() => {
    ref.current?.focus();
    const raf = requestAnimationFrame(() => ref.current?.focus()); // in case the pointer event moved focus afterwards
    return () => cancelAnimationFrame(raf);
  }, []);
  const f = px('text', w) * (a.size || 1);
  return (
    <textarea ref={ref} className="annot-text-input" value={v} onChange={(e) => { setV(e.target.value); onChange(e.target.value); }} rows={Math.max(1, v.split('\n').length)}
      style={{ left: a.x * w, top: a.y * h, fontSize: f, color: a.color, maxWidth: w - a.x * w - 4 }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={onDone} onKeyDown={(e) => editorKeys(e, () => e.currentTarget.blur())}
      aria-label="Annotation text" placeholder="Type…" />
  );
}

function NotePopover({ a, w, h, editable, author, onChange, onClose, onDelete }) {
  const [v, setV] = useState(a.text || '');
  const left = Math.min(Math.max(8, a.x * w + 14), Math.max(8, w - 250));
  const top = Math.min(a.y * h + 14, Math.max(8, h - 170));
  return (
    <div className="annot-note-pop" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Note">
      <div className="small muted">{author} · {formatDateTime(a.at)}</div>
      {editable ? (
        <textarea className="input textarea" rows={3} value={v} onChange={(e) => { setV(e.target.value); onChange(e.target.value); }} autoFocus placeholder="Write a note…" aria-label="Note text"
          onKeyDown={(e) => editorKeys(e, onClose)} />
      ) : <p className="annot-note-text">{a.text || <span className="muted">Empty note</span>}</p>}
      <div className="btn-row end">
        {onDelete && <button className="btn btn-ghost btn-sm annot-note-del" onClick={onDelete}><Trash2 size={13} /> Delete</button>}
        <button className="btn btn-primary btn-sm" onClick={onClose}>{editable ? 'Done' : 'Close'}</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toolbar                                                             */
/* ------------------------------------------------------------------ */
export function MarkupToolbar({ m, onCancel, onSave, saving }) {
  const ui = useUI();
  const [stampOpen, setStampOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const stampRef = useRef(null);
  const menuRef = useRef(null);
  const palette = m.tool === 'highlight' ? HIGHLIGHT_COLORS : COLORS;

  const openStamp = () => {
    if (stampOpen) { setStampOpen(false); return; }
    const r = stampRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 190)), top: r.bottom + 6 });
    setStampOpen(true);
  };
  // The stamp menu closes on an outside press or Escape (and Escape doesn't also cancel the markup session).
  useEffect(() => {
    if (!stampOpen) return undefined;
    const onDown = (e) => { if (!menuRef.current?.contains(e.target) && !stampRef.current?.contains(e.target)) setStampOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setStampOpen(false); stampRef.current?.focus(); } };
    const onScroll = () => setStampOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onScroll);
    return () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onScroll); };
  }, [stampOpen]);

  useEffect(() => {
    const onKey = (e) => {
      if (ui.dialog || ui.menu) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); onSave(); return; }
      if (typingIn(document.activeElement) || e.altKey) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) m.redo(); else m.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); m.redo(); return; }
      if (e.ctrlKey || e.metaKey) return;
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t) m.setTool(t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const others = m.list.some((a) => !m.mayChange(a));
  const clearable = m.list.filter((a) => m.mayChange(a));
  const clearAll = () => ui.openDialog('confirm', {
    title: others ? 'Clear your marks?' : 'Clear all marks?',
    message: others
      ? `Your ${clearable.length} mark${clearable.length === 1 ? '' : 's'} will be removed. Marks added by others stay. You can undo this until you save.`
      : `All ${clearable.length} mark${clearable.length === 1 ? '' : 's'} will be removed. You can undo this until you save.`,
    confirmLabel: 'Clear', danger: true,
    onConfirm: () => { m.finishTyped(); m.change((l) => l.filter((a) => !m.mayChange(a))); m.setSelected(null); },
  });

  return (
    <div className="markup-bar" role="toolbar" aria-label="Markup tools">
      <div className="markup-scroll">
        <div className="markup-group">
          {TOOLS.map((t) => (t.id === 'stamp' ? (
            <div key={t.id} className="markup-stamp">
              <button ref={stampRef} className={`icon-btn on-dark ${m.tool === 'stamp' ? 'active' : ''}`} onClick={() => { m.setTool('stamp'); openStamp(); }} aria-label={`Stamp: ${m.stamp.label}`} aria-haspopup="menu" aria-expanded={stampOpen} data-tip={`Stamp: ${m.stamp.label} (S)`}>
                <Stamp size={17} /><ChevronDown size={11} />
              </button>
              {stampOpen && menuPos && (
                <div className="markup-stamp-menu" role="menu" ref={menuRef} style={menuPos}>
                  {STAMPS.map((s) => (
                    <button key={s.label} role="menuitem" onClick={() => { m.setStamp(s); m.setTool('stamp'); setStampOpen(false); }} className={m.stamp.label === s.label ? 'active' : ''}>
                      <span className="stamp-chip" style={{ color: s.color, borderColor: s.color }}>{s.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <button key={t.id} className={`icon-btn on-dark ${m.tool === t.id ? 'active' : ''}`} onClick={() => { m.setTool(t.id); setStampOpen(false); }} aria-label={t.label} aria-pressed={m.tool === t.id} data-tip={`${t.label} (${t.key.toUpperCase()})`}>
              <t.icon size={17} />
            </button>
          )))}
        </div>
        {['pen', 'highlight', 'rect', 'text'].includes(m.tool) && (
          <div className="markup-group" role="radiogroup" aria-label="Colour">
            {palette.map((c) => (
              <button key={c} role="radio" aria-checked={m.color === c} className={`mk-swatch ${m.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => m.setColor(c)} aria-label={`Colour ${c}`} />
            ))}
          </div>
        )}
        <div className="markup-group">
          <button className="icon-btn on-dark" onClick={m.undo} disabled={!m.canUndo} aria-label="Undo" data-tip="Undo (Ctrl+Z)"><Undo2 size={17} /></button>
          <button className="icon-btn on-dark" onClick={m.redo} disabled={!m.canRedo} aria-label="Redo" data-tip="Redo (Ctrl+Y)"><Redo2 size={17} /></button>
          <button className="btn btn-ghost-dark btn-sm" onClick={clearAll} disabled={!clearable.length} aria-label={others ? 'Clear my marks' : 'Clear all marks'}>{others ? 'Clear mine' : 'Clear all'}</button>
        </div>
      </div>
      <span className="markup-count hide-sm">{m.list.length} mark{m.list.length === 1 ? '' : 's'}</span>
      <div className="markup-end">
        <button className="btn btn-ghost-dark btn-sm" onClick={onCancel} aria-label="Cancel markup"><X size={14} /> <span className="btn-text">Cancel</span></button>
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={!m.dirty || saving} aria-label="Save markup"><Save size={14} /> {saving ? 'Saving…' : 'Save markup'}</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Viewers with markup                                                  */
/* ------------------------------------------------------------------ */
/** Image with an annotation overlay sized to the rendered image. */
export function MarkedImage({ item, zoom, m, show }) {
  const url = realUrl(item) || (item.thumb?.startsWith('gen:') ? genThumb(item.thumb.slice(4)) : genThumb(1));
  const imgRef = useRef(null);
  const stageRef = useRef(null);
  const [size, setSize] = useState(null);
  // Fit the image to the stage in pixels. Percentage max sizes don't work here: the wrapper is sized by the
  // image itself, so they collapse (an SVG without its own width/height rendered at 0x0).
  const [stage, setStage] = useState(null);
  const [natural, setNatural] = useState(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      setStage((p) => (p && p.w === w && p.h === h ? p : { w: Math.max(1, w), h: Math.max(1, h) }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const nat = natural?.url === url ? natural : null; // ignore the previous image's size while a new one loads
  const fit = stage && nat ? Math.min(1, stage.w / natural.w, stage.h / natural.h) : null;
  const imgStyle = fit ? { width: Math.round(nat.w * fit), height: Math.round(nat.h * fit), maxWidth: 'none', maxHeight: 'none' } : undefined;
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return undefined;
    const measure = () => setSize(el.clientWidth ? { w: el.clientWidth, h: el.clientHeight } : null);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [url]);
  const list = m?.active ? m.list : (show ? item.annotations || [] : []);
  return (
    <div className="viewer-center checker" ref={stageRef}>
      <div className="markup-wrap" style={{ transform: `scale(${zoom})` }}>
        <img ref={imgRef} src={url} alt={item.name} className="preview-img markup-img" style={imgStyle} draggable={false}
          onLoad={() => {
            const img = imgRef.current;
            // SVGs without their own size report 0: fall back to a 16:10 box that fills the stage.
            setNatural(img.naturalWidth && img.naturalHeight ? { url, w: img.naturalWidth, h: img.naturalHeight } : { url, w: 1600, h: 1000 });
            setSize({ w: img.clientWidth, h: img.clientHeight });
          }} />
        {size && (list.length > 0 || m?.active) && <AnnotationLayer page={1} w={size.w} h={size.h} list={list} m={m} />}
      </div>
    </div>
  );
}

/** PDF rendered page by page with an annotation overlay on each page. */
export function MarkedPdf({ item, zoom, m, show }) {
  const { blobsVersion } = useDrive();
  // fileBlob throws when an uploaded file's bytes aren't in this browser; usePdfDocument shows that message.
  const pdf = usePdfDocument(() => fileBlob(item), `${item.id}@${item.version || 1}#${blobsVersion}`);
  const list = m?.active ? m.list : (show ? item.annotations || [] : []);
  return <PdfPages pdf={pdf} zoom={zoom} overlay={(page, w, h) => <AnnotationLayer page={page} w={w} h={h} list={list} m={m} />} />;
}

/* ------------------------------------------------------------------ */
/* Export a flattened copy                                             */
/* ------------------------------------------------------------------ */
const loadImage = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });

async function pdfPageCount(blob) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  try { return doc.numPages; } finally { doc.destroy(); }
}

/**
 * Number of pages of the file's current contents (1 for images), or null while unknown. Only loads the PDF when
 * `enabled` (used to tell whether markup from another version points at pages that no longer exist).
 */
export function usePageCount(item, enabled) {
  const { blobsVersion } = useDrive();
  const [n, setN] = useState(null);
  const isPdf = getFileType(item?.ext).category === 'pdf';
  useEffect(() => {
    setN(null);
    if (!item || !enabled || !isPdf) return undefined;
    let alive = true;
    fileBlob(item).then(pdfPageCount).then((c) => { if (alive) setN(c); }).catch(() => {});
    return () => { alive = false; };
  }, [item?.id, item?.version, enabled, isPdf, blobsVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return null;
  return isPdf ? n : 1;
}

/**
 * Returns { blob, name, flattened } for a copy of the file with its markup burned in. PDFs keep their original
 * pages (marks drawn as vectors); `flattened` is true when the PDF couldn't be edited and was rendered to images.
 */
export async function exportWithMarkup(item, list, nameOf) {
  const base = item.name.replace(/\.[^.]+$/, '');
  if (getFileType(item.ext).category === 'image') {
    const url = realUrl(item) || genThumb(item.thumb?.replace('gen:', '') || 1);
    const img = await loadImage(url);
    const isSvg = /^data:image\/svg|\.svg$/i.test(url) || item.ext === 'svg';
    let w = img.naturalWidth || 1600; let h = img.naturalHeight || 1000;
    const scale = isSvg ? 1600 / w : Math.min(1, 4000 / Math.max(w, h));
    w = Math.round(w * scale); h = Math.round(h * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    drawAnnotations(ctx, list, w, h, nameOf);
    const out = withNotesLegend(c, list.filter((a) => a.kind === 'note'), nameOf);
    const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
    return { blob, name: `${base} (marked up).png` };
  }
  let src;
  try { src = await fileBlob(item); } catch (e) {
    throw new Error(`${e?.message || 'The contents of this file aren’t available.'} The marked-up copy can’t be created.`);
  }
  const info = { title: `${base} (marked up)`, subject: 'Annotated copy' };
  const notesBlocks = (notes) => notes.map((n, i) => ({ text: `${i + 1}. Page ${n.page} — ${n.text || '(empty note)'}  (${nameOf(n.by)}, ${formatDateTime(n.at)})` }));
  // Preferred: draw the marks as vectors onto the original PDF (its text stays selectable, the file stays small).
  // Marks saved on another version may point at pages this version doesn't have: they are left out.
  try {
    const { stampMarkupPdf } = await import('./pdfStamp');
    const res = await stampMarkupPdf(new Uint8Array(await src.arrayBuffer()), {
      list, nameOf, info, notesPage: (notes) => ({ title: 'Notes', subtitle: item.name, blocks: notesBlocks(notes) }),
    });
    const blob = new Blob([res.bytes], { type: 'application/pdf' });
    return { blob, name: `${base} (marked up).pdf`, flattened: false };
  } catch (e) {
    console.warn('Markup export: could not edit the original PDF, flattening it instead.', e); // eslint-disable-line no-console
  }
  // Fallback (encrypted or damaged PDFs): pages rendered to images with the marks painted on.
  const pages = await pdfPageCount(src).catch(() => null);
  if (pages) list = list.filter((a) => (a.page || 1) <= pages);
  // Notes are numbered across the whole document (page order) so the markers match the list on the last page.
  const notes = list.filter((a) => a.kind === 'note').map((a, i) => ({ a, i })).sort((p, q) => (p.a.page || 1) - (q.a.page || 1) || p.i - q.i).map((p) => p.a);
  const extra = notes.length ? textPagesCanvas('Notes', notesBlocks(notes), { subtitle: item.name }) : [];
  const blob = await flattenPdf(src, (ctx, page, w, h) => {
    const onPage = list.filter((a) => (a.page || 1) === page);
    ctx.save();
    drawAnnotations(ctx, onPage.filter((a) => a.kind !== 'note'), w, h, nameOf);
    for (const n of onPage.filter((a) => a.kind === 'note')) {
      const s = px('note', w);
      drawAnnotations(ctx, [{ ...n }], w, h, nameOf);
      ctx.fillStyle = '#FACC15'; ctx.fillRect(n.x * w - s * 0.35, n.y * h - s * 0.35, s * 0.7, s * 0.7);
      ctx.fillStyle = '#422006'; ctx.font = `700 ${s * 0.55}px Poppins, Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(notes.indexOf(n) + 1), n.x * w, n.y * h + 1);
    }
    ctx.restore();
  }, { extraPages: extra, info });
  return { blob, name: `${base} (marked up).pdf`, flattened: true };
}

export function useNameOf() {
  const { state } = useDrive();
  return useMemo(() => (id) => state.users.find((u) => u.id === id)?.name || 'Someone', [state.users]);
}

/** Saves the marked-up copy; resolves to { name, flattened } so callers can mention a flattened fallback. */
export async function downloadWithMarkup(item, list, nameOf) {
  const { blob, name, flattened = false } = await exportWithMarkup(item, list, nameOf);
  saveBlob(blob, name);
  return { name, flattened };
}
