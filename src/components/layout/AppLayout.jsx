import { Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { UploadCloud } from 'lucide-react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import DialogHost from '../dialogs/DialogHost';
import { UploadPanel } from '../dialogs/UploadDialog';
import { lazyNamed } from '../../utils/lazy';
import ErrorBoundary from '../common/ErrorBoundary';

const FilePreview = lazyNamed(() => import('../preview/FilePreview'));
import { ContextMenuHost, Toasts } from '../common';
import { useDrive, currentSessionId } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { useUploads } from '../../store/UploadContext';
import { readDrop } from '../../utils/dropFiles';
import useLiveNotifications from '../../notifications/useLiveNotifications';

/** Full-window overlay shown when OS files are dragged anywhere over the app. */
function GlobalDropOverlay() {
  const { cwd, toast, openDialog } = useUI();
  const uploads = useUploads();
  const [active, setActive] = useState(false);
  useEffect(() => {
    let depth = 0;
    const isFiles = (e) => e.dataTransfer?.types?.includes('Files') && !e.dataTransfer.types.includes('application/x-workvault-items');
    const enter = (e) => { if (!isFiles(e)) return; depth++; setActive(true); };
    const leave = (e) => { if (!isFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setActive(false); };
    const over = (e) => { if (isFiles(e)) e.preventDefault(); };
    // Capture phase: always hide the overlay, even when an inner drop target stops propagation.
    const reset = () => { depth = 0; setActive(false); };
    const drop = (e) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      // Reads dropped folders too (their contents keep their structure).
      readDrop(e.dataTransfer).then((files) => {
        if (!files.length && !files.emptyDirs.length) return;
        // Outside a writable folder, let the Upload dialog pick (it defaults to a writable destination).
        if (!cwd.inFolder || !cwd.writable) { openDialog('upload', { initialFiles: files }); return; }
        uploads.upload(files, cwd.parentId, cwd.space);
      }).catch(() => toast('Could not read the dropped items', { type: 'error' }));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', reset, true);
    window.addEventListener('dragend', reset, true);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', reset, true);
      window.removeEventListener('dragend', reset, true);
      window.removeEventListener('drop', drop);
    };
  }, [cwd, uploads, toast, openDialog]);
  if (!active) return null;
  return (
    <div className="global-drop" aria-hidden="true">
      <div className="global-drop-card">
        <UploadCloud size={40} strokeWidth={1.4} /><strong>Drop files to upload</strong>
        <span>{cwd.inFolder && cwd.writable ? `They will be added to "${cwd.label}"` : "You'll choose a destination folder next"}</span>
      </div>
    </div>
  );
}

const GO = { m: '/folders', t: '/team-folders', s: '/shared-with-me', r: '/recent', f: '/favorites', a: '/activity', k: '/tasks', p: '/approvals', x: '/trash' };

/** App-wide keys: ? (shortcuts sheet), G then a letter (go to), N (new folder), U (upload). */
function useGlobalShortcuts() {
  const ui = useUI();
  const navigate = useNavigate();
  const pendingG = useRef(0);
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const el = document.activeElement;
      const typing = el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || (el?.tagName === 'INPUT' && !['checkbox', 'radio'].includes(el.type)) || el?.isContentEditable;
      if (typing || ui.dialog || ui.menu || document.querySelector('.popover')) return;
      if (ui.preview) return; // the preview has its own keys, "?" included
      if (e.key === '?') { e.preventDefault(); ui.openDialog('shortcuts'); return; }
      const k = e.key.toLowerCase();
      if (pendingG.current && Date.now() - pendingG.current < 1500 && GO[k]) { e.preventDefault(); pendingG.current = 0; navigate(GO[k]); return; }
      pendingG.current = 0;
      if (k === 'g' && !e.shiftKey) { pendingG.current = Date.now(); return; }
      if (k === 'n' && !e.shiftKey) {
        e.preventDefault();
        if (!ui.cwd.writable) { ui.toast('You have view-only access here', { type: 'warning' }); return; }
        ui.openDialog('createFolder', { parentId: ui.cwd.parentId, space: ui.cwd.space });
      } else if (k === 'u' && !e.shiftKey) {
        e.preventDefault();
        ui.openDialog('upload');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui, navigate]);
}

/**
 * Session timeout policy: sign out after N minutes without input while the app is open.
 * Activity also refreshes this session's "last active" time (at most once a minute).
 */
function useIdleTimeout() {
  const { state, api } = useDrive();
  const { toast, dismissToast } = useUI();
  const minutes = state.org.policies.sessionTimeout || 0;
  const last = useRef(Date.now());
  const touched = useRef(0);
  const warning = useRef(null); // id of the "you'll be signed out" toast
  useEffect(() => {
    const clearWarning = () => { if (warning.current) { dismissToast(warning.current); warning.current = null; } };
    const bump = () => {
      last.current = Date.now();
      clearWarning();
      if (Date.now() - touched.current > 60000) { touched.current = Date.now(); const sid = currentSessionId(); if (sid) api.touchSession(sid); }
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = setInterval(() => {
      if (!minutes) return;
      const idle = Date.now() - last.current;
      if (idle > minutes * 60000) { clearWarning(); api.signOut('idle'); return; }
      // Warn a minute ahead; any click or key press (including the button) keeps the session alive.
      if (idle > minutes * 60000 - 60000 && !warning.current) {
        const left = Math.max(5, Math.round((minutes * 60000 - idle) / 1000));
        warning.current = toast(`You'll be signed out in ${left} seconds because of inactivity.`, {
          type: 'warning', duration: left * 1000 + 2000, action: { label: 'Stay signed in', onClick: () => { bump(); } },
        });
      }
    }, 5000);
    return () => { events.forEach((e) => window.removeEventListener(e, bump)); clearInterval(timer); };
  }, [api, minutes, toast, dismissToast]);
}

/**
 * Tab strips that scroll sideways (Settings / Admin sections, page tabs on phones): keep the selected tab in
 * view, after navigating and after tapping a tab, so people can see where they are.
 */
function centerActiveTab(strip, tab) {
  if (!strip || !tab || strip.scrollWidth <= strip.clientWidth + 1) return;
  const s = strip.getBoundingClientRect();
  const t = tab.getBoundingClientRect();
  strip.scrollLeft += (t.left + t.width / 2) - (s.left + s.width / 2);
}
const STRIPS = 'main .tabs, main .settings-nav';
const ACTIVE = '.active, [aria-selected="true"], [aria-current="page"]';
function useActiveTabInView(location) {
  useEffect(() => {
    const run = () => document.querySelectorAll(STRIPS).forEach((strip) => centerActiveTab(strip, strip.querySelector(ACTIVE)));
    // Screens load lazily: try again once they've rendered.
    const timers = [0, 120, 400].map((ms) => setTimeout(run, ms));
    return () => timers.forEach(clearTimeout);
  }, [location.pathname, location.search]);
  useEffect(() => {
    const onClick = (e) => {
      const tab = e.target.closest?.(`${STRIPS.split(', ').map((x) => `${x} > *`).join(', ')}`);
      if (tab) setTimeout(() => centerActiveTab(tab.parentElement, tab.parentElement.querySelector(ACTIVE) || tab), 0);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
}

export default function AppLayout() {
  useGlobalShortcuts();
  useIdleTimeout();
  useLiveNotifications();
  const { state, persistError } = useDrive();
  const { setMobileNav, hideMenu, closeDialog, closePreview, toast, preview } = useUI();
  const location = useLocation();
  useActiveTabInView(location);

  // Leaving a page closes anything floating over it (menus, mobile nav, dialogs).
  useEffect(() => { setMobileNav(false); hideMenu(); closeDialog(); }, [location.pathname]); // eslint-disable-line
  useEffect(() => { if (persistError) toast(persistError, { type: 'warning' }); }, [persistError]); // eslint-disable-line

  return (
    <div className={`app ${state.settings.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      <Sidebar />
      <div className="app-main">
        <Topbar />
        <main id="main" className="main" tabIndex={-1}>
          {/* A crashing screen keeps the sidebar and top bar usable; going to another page clears the error. */}
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<div className="screen-loading" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /> <span className="sr-only">Loading…</span></div>}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      {preview && (
        <ErrorBoundary variant="preview" resetKey={preview.id} onClose={closePreview}>
          <Suspense fallback={<div className="preview-loading" role="status"><span className="spinner" aria-hidden="true" /><span className="sr-only">Opening file…</span></div>}><FilePreview /></Suspense>
        </ErrorBoundary>
      )}
      <DialogHost />
      <ContextMenuHost />
      <UploadPanel />
      <Toasts />
      <GlobalDropOverlay />
    </div>
  );
}
