import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { uid } from '../utils/format';

/** Returns location.search with `key` set (or removed when value is null). */
function withParam(search, key, value) {
  const p = new URLSearchParams(search);
  if (value == null) p.delete(key); else p.set(key, value);
  const s = p.toString();
  return s ? `?${s}` : '';
}

const UICtx = createContext(null);

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // Dialogs form a stack: a confirmation opened from inside a dialog sits on top of it, and closing it
  // returns to the dialog underneath (with its state intact).
  const [dialogs, setDialogs] = useState([]); // [{ key, type, props }]
  const dialog = dialogs.length ? dialogs[dialogs.length - 1] : null;
  // The previewed file lives in the URL (?preview=<id>) so Back/refresh/bookmarks work.
  const location = useLocation();
  const navigate = useNavigate();
  const locRef = useRef(location);
  locRef.current = location;
  const closingRef = useRef(null);
  const [siblings, setSiblings] = useState([]);
  const previewId = new URLSearchParams(location.search).get('preview');
  const preview = useMemo(() => (previewId ? { id: previewId, siblings } : null), [previewId, siblings]);
  const [menu, setMenu] = useState(null); // { x, y, items }
  const [detailsId, setDetailsId] = useState(null);
  // Ask any open details view (side panel or preview info) to switch tab: { tab, n } — n changes on every request.
  // A view that mounts just after the request (e.g. the panel opening) also honours it, via id + at.
  const [detailsTab, setDetailsTabState] = useState({ tab: null, id: null, at: 0, n: 0 });
  const requestDetailsTab = useCallback((tab, id = null) => setDetailsTabState((p) => ({ tab, id, at: Date.now(), n: p.n + 1 })), []);
  const [mobileNav, setMobileNav] = useState(false);
  // Current working folder: target for New / Upload. inFolder=false means no folder page is open.
  const [cwd, setCwd] = useState({ parentId: null, space: 'my', writable: true, inFolder: false, label: 'My Folders' });
  const timers = useRef({});

  const remaining = useRef({}); // id -> { left, started }

  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    delete remaining.current[id];
  }, []);

  const startTimer = useCallback((id, ms) => {
    clearTimeout(timers.current[id]);
    remaining.current[id] = { left: ms, started: Date.now() };
    timers.current[id] = setTimeout(() => dismissToast(id), ms);
  }, [dismissToast]);

  const toast = useCallback((message, opts = {}) => {
    const id = uid('t');
    const t = { id, message, type: opts.type || 'info', action: opts.action || null };
    setToasts((prev) => {
      const next = [...prev, t];
      // Keep at most 4. Drop plain messages first so an Undo isn't pushed out by later notices.
      while (next.length > 4) {
        const i = next.findIndex((x) => !x.action && x.id !== id);
        const gone = next.splice(i >= 0 ? i : 0, 1)[0];
        clearTimeout(timers.current[gone.id]);
      }
      return next;
    });
    startTimer(id, opts.duration || (opts.action ? 8000 : opts.type === 'error' ? 6000 : 4000));
    return id;
  }, [startTimer]);

  /** Hovering or focusing a toast keeps it on screen; leaving resumes the countdown. */
  const pauseToast = useCallback((id) => {
    const r = remaining.current[id];
    if (!r || r.paused) return;
    clearTimeout(timers.current[id]);
    remaining.current[id] = { left: Math.max(1500, r.left - (Date.now() - r.started)), paused: true };
  }, []);
  const resumeToast = useCallback((id) => {
    const r = remaining.current[id];
    if (r?.paused) startTimer(id, r.left);
  }, [startTimer]);

  /**
   * Open a dialog. Normally it replaces whatever is open; a confirmation (or `{ stack: true }`) opened
   * while another dialog is showing goes on top of it instead.
   */
  const openDialog = useCallback((type, props = {}, opts = {}) => {
    setMenu(null);
    setDialogs((st) => {
      const entry = { key: uid('dlg'), type, props };
      const stack = opts.stack ?? (type === 'confirm' && st.length > 0);
      return stack ? [...st, entry] : [entry];
    });
  }, []);
  const pushDialog = useCallback((type, props = {}) => openDialog(type, props, { stack: true }), [openDialog]);
  /**
   * Close a dialog: by key (what each dialog's onClose does, so closing one never closes another that was
   * opened in the meantime), or the top one when no key is given.
   */
  const closeDialog = useCallback((key) => setDialogs((st) => (typeof key === 'string' ? st.filter((d) => d.key !== key) : st.slice(0, -1))), []);
  const closeAllDialogs = useCallback(() => setDialogs([]), []);

  const openPreview = useCallback((id, sibs = []) => {
    setMenu(null);
    setSiblings(sibs);
    const loc = locRef.current;
    if (new URLSearchParams(loc.search).get('preview') === id) return; // already open (e.g. the second click of a double-click)
    navigate({ pathname: loc.pathname, search: withParam(loc.search, 'preview', id) }, { state: { previewPushed: true } });
  }, [navigate]);
  const closePreview = useCallback(() => {
    const loc = locRef.current;
    const id = new URLSearchParams(loc.search).get('preview');
    if (!id || closingRef.current === loc.key) return;
    closingRef.current = loc.key;
    // If we pushed the preview entry, step back so Back doesn't reopen it; otherwise just drop the param.
    if (loc.state?.previewPushed) navigate(-1);
    else navigate({ pathname: loc.pathname, search: withParam(loc.search, 'preview', null) }, { replace: true });
  }, [navigate]);
  /** Switch the previewed file in place (prev/next) without adding history entries. */
  const setPreview = useCallback((p) => {
    if (!p) { closePreview(); return; }
    if (p.siblings) setSiblings(p.siblings);
    const loc = locRef.current;
    navigate({ pathname: loc.pathname, search: withParam(loc.search, 'preview', p.id) }, { replace: true, state: loc.state });
  }, [navigate, closePreview]);

  const showMenu = useCallback((pos, items) => setMenu({ x: pos.x, y: pos.y, items }), []);
  const hideMenu = useCallback(() => setMenu(null), []);

  const value = useMemo(() => ({
    toasts, toast, dismissToast, pauseToast, resumeToast,
    dialog, dialogs, openDialog, pushDialog, closeDialog, closeAllDialogs,
    preview, openPreview, closePreview, setPreview,
    menu, showMenu, hideMenu,
    detailsId, setDetailsId, detailsTab, requestDetailsTab,
    mobileNav, setMobileNav,
    cwd, setCwd,
  }), [cwd, toasts, toast, dismissToast, pauseToast, resumeToast, dialog, dialogs, openDialog, pushDialog, closeDialog, closeAllDialogs, preview, openPreview, closePreview, setPreview, menu, showMenu, hideMenu, detailsId, detailsTab, requestDetailsTab, mobileNav]);

  return <UICtx.Provider value={value}>{children}</UICtx.Provider>;
}

export function useUI() {
  const ctx = useContext(UICtx);
  if (!ctx) throw new Error('useUI must be used inside UIProvider');
  return ctx;
}

/** Inside a dialog: is it the topmost one? (Only the top dialog reacts to Escape, backdrop clicks and focus.) */
export const DialogLayerCtx = createContext({ top: true, depth: 0 });
export const useDialogLayer = () => useContext(DialogLayerCtx);
