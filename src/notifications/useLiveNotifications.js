import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';

// The first teammate action comes soon after opening the app, later ones every minute or two.
const FIRST = [15_000, 30_000];
const NEXT = [45_000, 120_000];
const between = ([a, b]) => a + Math.random() * (b - a);
// Only one open tab simulates teammates: the one that claimed this key most recently.
const CLAIM_KEY = 'workvault-drive:live-activity-at';

function claim() {
  try {
    const last = Number(localStorage.getItem(CLAIM_KEY)) || 0;
    if (Date.now() - last < NEXT[0] * 0.8) return false; // another tab just did it
    localStorage.setItem(CLAIM_KEY, String(Date.now()));
  } catch { /* storage blocked: just go ahead */ }
  return true;
}

export const notificationText = (state, n) => {
  const actor = state.users.find((u) => u.id === n.actorId);
  return actor ? `${actor.name} ${n.text}` : n.text;
};

/**
 * Keeps notifications live: simulates teammates working on the shared workspace, and announces each new
 * notification (from this tab, another tab, a file request, a signer, ...) with a toast and, when the app is
 * in the background, a desktop notification.
 */
export default function useLiveNotifications() {
  const { state, api } = useDrive();
  const { toast } = useUI();
  const navigate = useNavigate();
  const prefs = state.settings.notifications || {};
  const live = !state.signedOut && prefs.live !== false;

  // ---- Teammate activity ----
  useEffect(() => {
    if (!live) return undefined;
    let timer;
    const schedule = (range) => {
      timer = setTimeout(() => {
        if (document.visibilityState === 'visible' && claim()) api.simulateActivity();
        schedule(NEXT);
      }, between(range));
    };
    schedule(FIRST);
    return () => clearTimeout(timer);
  }, [live, api]);

  // ---- Announce new notifications ----
  const seen = useRef(null);
  const latest = useRef({ state, prefs, navigate, toast, api });
  latest.current = { state, prefs, navigate, toast, api };
  useEffect(() => {
    const list = state.notifications;
    if (seen.current === null || state.signedOut) { seen.current = new Set(list.map((n) => n.id)); return; }
    const fresh = list.filter((n) => !seen.current.has(n.id) && !n.read && Date.now() - n.at < 60_000);
    for (const n of list) seen.current.add(n.id);
    if (!fresh.length) return;
    const { prefs: p, navigate: go, toast: show, api: a, state: s } = latest.current;
    const open = (n) => { a.markNotification(n.id); if (n.link) go(n.link); };
    const visible = document.visibilityState === 'visible';

    if (visible && p.popups !== false) {
      for (const n of fresh.slice(0, 3)) show(notificationText(s, n), { type: 'info', action: n.link ? { label: 'View', onClick: () => open(n) } : null });
    }
    if (p.desktop && !(visible && document.hasFocus()) && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const n of fresh.slice(0, 3)) {
        try {
          const dn = new Notification('WorkVault Drive', { body: notificationText(s, n), tag: n.id, icon: '/icon-192.png' });
          dn.onclick = () => { window.focus(); open(n); dn.close(); };
        } catch { /* some browsers only allow notifications from a service worker */ }
      }
    }
  }, [state.notifications, state.signedOut]);
}
