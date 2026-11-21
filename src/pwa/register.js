// Service worker registration, "Update available" and "Install app" state for the PWA.
// The worker only runs in production builds (the Vite dev server serves modules that must never be cached).

const state = { updateReady: false, canInstall: false };
const listeners = new Set();
const emit = (patch) => { Object.assign(state, patch); listeners.forEach((fn) => fn({ ...state })); };

export const getPwaState = () => ({ ...state });
export function subscribePwa(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ---------- Install (beforeinstallprompt) ---------- */
let installEvent = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // show our own "Install app" chip instead of the browser's mini-infobar
    installEvent = e;
    emit({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => { installEvent = null; emit({ canInstall: false }); });
}

/** Shows the browser's install prompt. Resolves to 'accepted' | 'dismissed' | 'unavailable'. */
export async function promptInstall() {
  const e = installEvent;
  if (!e) return 'unavailable';
  installEvent = null;
  emit({ canInstall: false });
  e.prompt();
  const choice = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
  return choice?.outcome || 'dismissed';
}

/* ---------- Service worker ---------- */
/** The build's identity: the content-hashed name of the entry script in an index.html. */
const versionFrom = (doc) => {
  const src = doc.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src') || '';
  return (src.match(/\/assets\/([^/?#]+)\.js/) || [])[1] || '';
};
let pageVersion = '';
let waitingWorker = null;
let reloading = false;

function onWaiting(worker) {
  if (!navigator.serviceWorker.controller) return; // first install: it activates by itself
  const v = new URL(worker.scriptURL).searchParams.get('v');
  if (v === pageVersion) { worker.postMessage({ type: 'SKIP_WAITING' }); return; } // this page already is the new version
  waitingWorker = worker;
  emit({ updateReady: true });
}

function track(reg) {
  if (reg.waiting) onWaiting(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => { if (w.state === 'installed') onWaiting(w); });
  });
}

/** Looks for a newer deploy: a different entry script in the server's index.html means a new version. */
async function checkForUpdate() {
  if (!navigator.onLine || reloading) return;
  try {
    const res = await fetch('/index.html', { cache: 'no-store' });
    if (!res.ok) return;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const v = versionFrom(doc);
    if (!v || v === pageVersion) return;
    const reg = await navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(v)}`, { updateViaCache: 'none' });
    track(reg);
  } catch { /* offline or blocked: try again later */ }
}

/** Activates the waiting worker and reloads into the new version. */
export function applyUpdate() {
  if (!waitingWorker) { window.location.reload(); return; }
  reloading = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  setTimeout(() => window.location.reload(), 3000); // in case controllerchange never comes
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  pageVersion = versionFrom(document) || 'app';
  const start = async () => {
    try {
      const reg = await navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(pageVersion)}`, { updateViaCache: 'none' });
      track(reg);
      // Chunks loaded before the worker took control aren't in its cache yet: hand it the list.
      const ready = await navigator.serviceWorker.ready;
      const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.includes('/assets/'));
      ready.active?.postMessage({ type: 'CACHE_URLS', urls });
    } catch (e) {
      console.warn('Service worker registration failed', e); // eslint-disable-line no-console
    }
    setInterval(checkForUpdate, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  };
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
}

