import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { USERS, TEAMS, PRIORITY_TEAMS, ITEMS, NOTIFICATIONS, AUDIT, ORG, ME, FILE_REQUESTS, normalizeLink, TASKS, APPROVALS, PRODUCTIVITY_NOTIFICATIONS, LEGAL_HOLDS, SESSIONS, SIGN_REQUESTS, SIGN_ITEM_NAMES, SIGN_NOTIFICATIONS, GUEST_USERS, GUEST_SHARES, GUEST_MEMBERS, guestShareEntry, guestMemberEntry, BRANDING, SAMPLE_LINK_SECRET_HASH } from '../data/mockData';
import { computeStatus, SIGNER_COLORS } from '../signatures/status';
import { uid } from '../utils/format';
import { descendantIds, childIds, lockedInside, isTrashedDeep, uniqueName, ancestors, lockedByOther, holdOn, blocksPermanentDelete, accessOf, canEdit, teamRoleOf, quotaError, activeHolds, canDownload } from './selectors';
import { deviceLabel, sessionIp } from '../utils/sharing';
import { DEFAULT_OFFBOARD } from '../offboard/offboard';

// ---- This browser's sign-in session id (localStorage when "keep me signed in", else this tab session) ----
const SID_KEY = 'workvault-drive:sid';
export const SIGNOUT_REASON_KEY = 'workvault-drive:signout-reason';
export function currentSessionId() {
  try { return sessionStorage.getItem(SID_KEY) || localStorage.getItem(SID_KEY); } catch { return null; }
}
function rememberSessionId(id, remember) {
  try {
    sessionStorage.removeItem(SID_KEY); localStorage.removeItem(SID_KEY);
    if (id) (remember ? localStorage : sessionStorage).setItem(SID_KEY, id);
  } catch { /* storage unavailable */ }
}
let pendingSid = null;
const newSession = (userId) => ({ id: uid('ss'), userId, device: deviceLabel(), location: 'This browser', ip: sessionIp(), startedAt: Date.now(), lastActive: Date.now(), endedAt: null, endedBy: null });
// All saved data (workspace state + file bytes) is read and written through the data access layer.
// It is browser-only today; a server-backed stateStore/fileStore can replace it without touching screens.
import { stateStore, fileStore, requestPersistence, hashSecret } from '../data/storage';

const SESSION_KEY = 'workvault-drive:session';

export const DEFAULT_SETTINGS = {
  theme: 'light', // light | dark | system
  density: 'comfortable', // comfortable | compact
  language: '', // empty = follow the browser's language when it's supported (see src/i18n)
  dateFormat: 'relative',
  defaultView: 'list',
  sidebarCollapsed: false,
  showDetailsPanel: false,
  confirmDelete: true,
  notifications: { email: true, desktop: false, shares: true, comments: true, uploads: true, teamChanges: true, weeklyDigest: false },
  security: { twoFactor: true, loginAlerts: true },
  pinned: [], // item ids pinned to the sidebar
  activitySeenAt: 0, // last time the Activity page was opened ("new since your last visit")
};

/** Sample pins for a fresh workspace (by name, since sample ids are generated). */
const seedPins = () => ['Projects', 'Reports'].map((n) => ITEMS.find((i) => i.name === n && !i.parentId)?.id).filter(Boolean);

function seedState() {
  const items = {};
  for (const it of ITEMS) items[it.id] = { ...it };
  return {
    version: 1,
    seedVersion: SEED_VERSION,
    signRequests: JSON.parse(JSON.stringify(SIGN_REQUESTS)),
    sessions: JSON.parse(JSON.stringify(SESSIONS)),
    fileRequests: JSON.parse(JSON.stringify(FILE_REQUESTS)),
    tasks: JSON.parse(JSON.stringify(TASKS)),
    approvals: JSON.parse(JSON.stringify(APPROVALS)),
    meId: ME,
    users: USERS.map((u) => ({ ...u })),
    teams: TEAMS.map((t) => ({ ...t, members: t.members.map((m) => ({ ...m })) })),
    items,
    notifications: NOTIFICATIONS.map((n) => ({ ...n })),
    audit: AUDIT.map((a) => ({ ...a })),
    org: JSON.parse(JSON.stringify({ ...ORG, legalHolds: LEGAL_HOLDS })),
    settings: { ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), pinned: seedPins(), activitySeenAt: Date.now() - 2 * 86400000 },
    recentSearches: ['budget', 'invoice', 'brand'],
    signedOut: true,
    remember: true,
  };
}

/** The newest state format this build understands (seedVersion after all migrations). */
export const SEED_VERSION = 13;

/** Turn a saved state object (any seedVersion 1..13) into current state; seed data when missing or unusable. */
function hydrate(parsed) {
  try {
    if (parsed) {
      if (parsed?.version === 1 && parsed.items) {
        const merged = { ...seedState(), ...parsed, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } };
        // One-time migration: add the priority team folders to data saved before they existed.
        if ((parsed.seedVersion || 1) < 2) {
          const have = new Set(merged.teams.map((t) => t.id));
          const fresh = PRIORITY_TEAMS.filter((t) => !have.has(t.id)).map((t) => ({ ...t, members: t.members.map((m) => ({ ...m })) }));
          merged.teams = [...fresh, ...merged.teams];
          merged.seedVersion = 2;
        }
        // One-time migration: seeded notifications now link straight to the file, not just its folder.
        if (merged.seedVersion < 3) {
          const seedLinks = Object.fromEntries(NOTIFICATIONS.map((n) => [n.id, n.link]));
          merged.notifications = merged.notifications.map((n) => (seedLinks[n.id] ? { ...n, link: seedLinks[n.id] } : n));
          merged.seedVersion = 3;
        }
        // One-time migration: rebrand to Getmeds, set the main admin, drop pricing plans.
        if (merged.seedVersion < 4) {
          const seedUser = Object.fromEntries(USERS.map((u) => [u.id, u]));
          merged.users = merged.users.map((u) => {
            if (u.id === ME) return { ...u, name: seedUser[ME].name, email: seedUser[ME].email, title: seedUser[ME].title, dept: seedUser[ME].dept, role: 'Admin' };
            return u.email?.endsWith('@northwind.example') ? { ...u, email: u.email.replace('@northwind.example', '@getmeds.ph') } : u;
          });
          const { plan, ...org } = merged.org; // eslint-disable-line no-unused-vars
          merged.org = {
            ...org,
            name: org.name === 'Northwind Labs' ? ORG.name : org.name,
            domain: org.domain === 'northwind.example' ? ORG.domain : org.domain,
            policies: { ...org.policies, allowedDomains: /northwind\.example/.test(org.policies?.allowedDomains || '') ? ORG.policies.allowedDomains : org.policies?.allowedDomains },
          };
          merged.seedVersion = 4;
        }
        // One-time migration: collaboration fields (versions, comments, locks) + their sample data.
        if (merged.seedVersion < 5) {
          const seedById = Object.fromEntries(ITEMS.map((it) => [it.id, it]));
          merged.items = Object.fromEntries(Object.entries(merged.items).map(([id, it]) => {
            const seed = seedById[id];
            const fresh = seed && seed.name === it.name; // only enrich sample files the user hasn't replaced
            return [id, {
              ...it,
              version: it.version || (fresh ? seed.version : 1),
              versions: it.versions || (fresh ? seed.versions : []),
              comments: it.comments || (fresh ? seed.comments : []),
              lock: it.lock !== undefined ? it.lock : (fresh ? seed.lock : null),
            }];
          }));
          merged.seedVersion = 5;
        }
        // One-time migration: organization (labels, folder colours, custom fields, pins) + sample data.
        if (merged.seedVersion < 6) {
          const seedById = Object.fromEntries(ITEMS.map((it) => [it.id, it]));
          merged.items = Object.fromEntries(Object.entries(merged.items).map(([id, it]) => {
            const seed = seedById[id];
            const fresh = seed && seed.name === it.name;
            return [id, {
              ...it,
              labels: it.labels || (fresh ? seed.labels : []),
              color: it.color !== undefined ? it.color : (fresh ? seed.color : null),
              meta: it.meta !== undefined ? it.meta : (fresh ? seed.meta : null),
            }];
          }));
          merged.org = { ...merged.org, labels: merged.org.labels || ORG.labels, dataTemplates: merged.org.dataTemplates || ORG.dataTemplates };
          if (!parsed.settings?.pinned) merged.settings = { ...merged.settings, pinned: seedPins().filter((id) => merged.items[id]) };
          merged.seedVersion = 6;
        }
        // One-time migration: sharing (link options, access logs, file requests) + sample data.
        if (merged.seedVersion < 7) {
          const seedById = Object.fromEntries(ITEMS.map((it) => [it.id, it]));
          merged.items = Object.fromEntries(Object.entries(merged.items).map(([id, it]) => {
            const seed = seedById[id];
            const fresh = seed && seed.name === it.name;
            // Keep the user's own link settings; only add the new options (and the sample password where the sample link already had one).
            const link = it.link ? normalizeLink({ ...(fresh ? { secretHash: seed.link?.secretHash, maxDownloads: seed.link?.maxDownloads, downloads: seed.link?.downloads, watermark: seed.link?.watermark } : {}), ...it.link }) : null;
            if (link && link.password && !link.secret && !link.secretHash) link.secretHash = SAMPLE_LINK_SECRET_HASH;
            return [id, { ...it, link, linkLog: it.linkLog || (fresh ? seed.linkLog : []), uploadedBy: it.uploadedBy !== undefined ? it.uploadedBy : (fresh ? seed.uploadedBy : null) }];
          }));
          merged.fileRequests = parsed.fileRequests || FILE_REQUESTS.filter((r) => merged.items[r.folderId]).map((r) => JSON.parse(JSON.stringify(r)));
          merged.org = { ...merged.org, policies: { watermarkPublicLinks: false, fileRequests: true, ...merged.org.policies } };
          merged.seedVersion = 7;
        }
        // One-time migration: tasks and approvals (+ their sample notifications).
        if (merged.seedVersion < 8) {
          // Only attach samples to sample files that still exist under their original name.
          const fresh = (itemId) => { const seed = ITEMS.find((i) => i.id === itemId); return seed && merged.items[itemId]?.name === seed.name; };
          merged.tasks = parsed.tasks || TASKS.filter((t) => fresh(t.itemId)).map((t) => ({ ...t }));
          merged.approvals = parsed.approvals || APPROVALS.filter((a) => fresh(a.itemId)).map((a) => JSON.parse(JSON.stringify(a)));
          const have = new Set(merged.notifications.map((n) => n.id));
          merged.notifications = [...PRODUCTIVITY_NOTIFICATIONS.filter((n) => !have.has(n.id)), ...merged.notifications].sort((a, b) => b.at - a.at);
          if (!parsed.settings?.activitySeenAt) merged.settings = { ...merged.settings, activitySeenAt: Date.now() - 2 * 86400000 };
          merged.seedVersion = 8;
        }
        // One-time migration: retention policy fields, legal holds, real sign-in sessions.
        if (merged.seedVersion < 9) {
          const fresh = (itemId) => { const seed = ITEMS.find((i) => i.id === itemId); return seed && merged.items[itemId]?.name === seed.name; };
          merged.org = {
            ...merged.org,
            policies: { maxVersions: 25, ...merged.org.policies },
            legalHolds: parsed.org?.legalHolds || LEGAL_HOLDS.map((h) => ({ ...h, itemIds: h.itemIds.filter(fresh) })).filter((h) => h.itemIds.length),
          };
          merged.sessions = parsed.sessions || JSON.parse(JSON.stringify(SESSIONS));
          merged.seedVersion = 9;
        }
        // One-time migration: search & OCR settings + the sample receipt photo.
        if (merged.seedVersion < 10) {
          merged.org = { ...merged.org, policies: { ocr: true, smartLabels: 'suggest', ...merged.org.policies } };
          const receipt = ITEMS.find((i) => i.name === 'Receipt - Harbor Cafe.png');
          const personal = receipt && merged.items[receipt.parentId];
          if (receipt && !merged.items[receipt.id] && personal && personal.name === 'Personal') merged.items = { ...merged.items, [receipt.id]: { ...receipt } };
          merged.seedVersion = 10;
        }
        // One-time migration: data loss prevention policy + two sample files containing sensitive data.
        if (merged.seedVersion < 11) {
          merged.org = { ...merged.org, policies: { dlp: JSON.parse(JSON.stringify(ORG.policies.dlp)), ...merged.org.policies } };
          for (const name of ['Vendor payment details.txt', 'Payroll export - November.txt']) {
            const seed = ITEMS.find((i) => i.name === name);
            const home = seed && (seed.space === 'my' || merged.teams.some((t) => t.id === seed.space));
            if (home && !merged.items[seed.id]) merged.items = { ...merged.items, [seed.id]: JSON.parse(JSON.stringify(seed)) };
          }
          merged.seedVersion = 11;
        }
        // One-time migration: e-signature requests and the sample agreements they use.
        if (merged.seedVersion < 12) {
          for (const name of SIGN_ITEM_NAMES) {
            const seed = ITEMS.find((i) => i.name === name);
            const home = seed && (seed.space === 'my' || merged.teams.some((t) => t.id === seed.space));
            if (home && !merged.items[seed.id]) merged.items = { ...merged.items, [seed.id]: JSON.parse(JSON.stringify(seed)) };
          }
          merged.signRequests = parsed.signRequests || SIGN_REQUESTS.filter((r) => merged.items[r.itemId]).map((r) => JSON.parse(JSON.stringify(r)));
          const haveN = new Set(merged.notifications.map((n) => n.id));
          merged.notifications = [...SIGN_NOTIFICATIONS.filter((n) => !haveN.has(n.id)), ...merged.notifications];
          merged.seedVersion = 12;
        }
        // One-time migration: public-page branding, guest access policy, and sample external collaborators.
        if (merged.seedVersion < 13) {
          merged.org = { ...merged.org, branding: merged.org.branding || JSON.parse(JSON.stringify(BRANDING)), policies: { guestAccessDays: 30, ...merged.org.policies } };
          const emails = new Set(merged.users.map((u) => u.email.toLowerCase()));
          const added = GUEST_USERS.filter((g) => !emails.has(g.email.toLowerCase()) && !merged.users.some((u) => u.id === g.id));
          merged.users = [...merged.users, ...added.map((g) => ({ ...g }))];
          const ok = new Set(added.map((g) => g.id));
          let items = merged.items;
          for (const g of GUEST_SHARES) {
            if (!ok.has(g[1])) continue;
            const it = Object.values(items).find((i) => i.name === g[0] && i.space === 'my' && !i.trashed);
            if (it && !(it.sharedWith || []).some((x) => x.userId === g[1])) items = { ...items, [it.id]: { ...it, sharedWith: [...(it.sharedWith || []), guestShareEntry(g)] } };
          }
          merged.items = items;
          merged.teams = merged.teams.map((t) => {
            const extra = GUEST_MEMBERS.filter((g) => g[0] === t.id && ok.has(g[1]) && !t.members.some((m) => m.userId === g[1]));
            return extra.length ? { ...t, members: [...t.members, ...extra.map(guestMemberEntry)] } : t;
          });
          merged.seedVersion = 13;
        }
        // "Keep me signed in" off: the sign-in lasts only for this browser session.
        if (merged.remember === false && !sessionStorage.getItem(SESSION_KEY)) merged.signedOut = true;
        return merged;
      }
    }
  } catch { /* ignore corrupted storage */ }
  return seedState();
}

const loadState = () => hydrate(stateStore.load());

// ---- Passwords are stored hashed (see src/data/storage/secrets.js). Old saves may hold plain `secret`s. ----
const plainSecrets = (s) => {
  const items = Object.values(s.items || {}).filter((it) => it.link?.secret).map((it) => [it.id, it.link.secret]);
  const reqs = (s.fileRequests || []).filter((r) => r.secret).map((r) => [r.id, r.secret]);
  return items.length || reqs.length ? { items, reqs } : null;
};
/** Swap plain secrets for their digests (only where the plain value is still the one that was hashed). */
function applySecretHashes(s, itemHashes, reqHashes) {
  let items = s.items;
  let changed = false;
  for (const [id, plain, secretHash] of itemHashes) {
    const it = items[id];
    if (it?.link?.secret !== plain) continue;
    const { secret, ...link } = it.link; // eslint-disable-line no-unused-vars
    items = { ...items, [id]: { ...it, link: { ...link, secretHash } } };
    changed = true;
  }
  const fileRequests = (s.fileRequests || []).map((r) => {
    const h = reqHashes.find(([id, plain]) => id === r.id && r.secret === plain);
    if (!h) return r;
    changed = true;
    const { secret, ...rest } = r; // eslint-disable-line no-unused-vars
    return { ...rest, secretHash: h[2] };
  });
  return changed ? { ...s, items, fileRequests } : s;
}

/** Saved state minus things that only describe this browser tab (used for backups). */
export function portableState(s) {
  const { signedOut, remember, ...rest } = s; // eslint-disable-line no-unused-vars
  return rest;
}

/** Uploaded file bytes, keyed by item id. Backed by IndexedDB so real files survive reloads. */
export const blobRegistry = new Map();

/**
 * Writing file bytes to IndexedDB failed (quota, private mode, blocked storage). The store shows a warning,
 * because those files only live in memory and are gone after a reload.
 */
const blobErrorListeners = new Set();
function reportBlobWriteError() { blobErrorListeners.forEach((fn) => fn()); }
function storeBlob(id, blob) { return fileStore.put(id, blob).catch(reportBlobWriteError); }

/** Register an uploaded file's bytes (in memory + IndexedDB). */
export function registerBlob(id, blob) {
  const prev = blobRegistry.get(id);
  blobRegistry.set(id, { blob, url: URL.createObjectURL(blob) });
  // Copies share a registry entry; only revoke the old URL when nothing else still points at it.
  if (prev?.url && ![...blobRegistry.values()].includes(prev)) URL.revokeObjectURL(prev.url);
  storeBlob(id, blob);
}

/** Resolves once file bytes saved in IndexedDB have been loaded after startup (see fileBlob). */
let markBlobsReady;
export const blobsReady = new Promise((resolve) => { markBlobsReady = resolve; });
let blobsLoaded = false;
blobsReady.then(() => { blobsLoaded = true; });

/** A data: URL as a Blob (to move embedded file data into the file store). */
function dataUrlToBlob(url) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url || '');
  if (!m) return null;
  try {
    if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type: m[1] || 'application/octet-stream' });
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
  } catch { return null; }
}

/**
 * Three-way merge for a save from another tab that arrives while this tab has unsaved changes.
 * base: what both tabs last agreed on; ours: this tab now; theirs: what the other tab saved.
 * Whatever this tab changed since base wins; everything else comes from theirs. Maps (items, ...) merge
 * per key; id-keyed lists (audit, journal, notifications, ...) merge per entry.
 */
const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
function mergeMap(base = {}, ours = {}, theirs = {}) {
  const out = { ...theirs };
  for (const k of new Set([...Object.keys(ours), ...Object.keys(base)])) {
    if (ours[k] === base[k]) continue;
    if (!(k in ours)) delete out[k];
    else out[k] = ours[k];
  }
  return out;
}
function mergeList(base = [], ours = [], theirs = []) {
  if (![...ours, ...theirs].every((e) => e && typeof e === 'object' && 'id' in e)) return ours;
  const baseById = new Map(base.map((e) => [e.id, e]));
  const oursById = new Map(ours.map((e) => [e.id, e]));
  const removed = new Set(base.filter((e) => !oursById.has(e.id)).map((e) => e.id));
  const changed = new Map(ours.filter((e) => baseById.has(e.id) && baseById.get(e.id) !== e).map((e) => [e.id, e]));
  const theirIds = new Set(theirs.map((e) => e.id));
  const added = ours.filter((e) => !baseById.has(e.id) && !theirIds.has(e.id));
  const kept = theirs.filter((e) => !removed.has(e.id)).map((e) => changed.get(e.id) || e);
  // New entries go where this tab put them: lists kept newest-first get them at the front.
  const front = added.length && ours.indexOf(added[0]) === 0;
  return front ? [...added, ...kept] : [...kept, ...added];
}
function mergeStates(base, ours, theirs) {
  const out = { ...theirs };
  for (const k of Object.keys(ours)) {
    if (ours[k] === base?.[k]) continue;
    const b = base?.[k]; const t = theirs[k];
    if (isPlainObject(ours[k]) && isPlainObject(t) && isPlainObject(b)) out[k] = mergeMap(b, ours[k], t);
    else if (Array.isArray(ours[k]) && Array.isArray(t) && Array.isArray(b)) out[k] = mergeList(b, ours[k], t);
    else out[k] = ours[k];
  }
  return out;
}
export const __test = { mergeStates };

// ---- Change journal: what each item looked like before every change (powers "restore a folder to a date") ----
const JOURNAL_FIELDS = ['name', 'parentId', 'space', 'trashed', 'version'];
const JOURNAL_MAX = 5000;
const JOURNAL_DAYS = 180;
const journalSnapshot = (it) => ({ name: it.name, parentId: it.parentId, space: it.space, trashed: !!it.trashed, version: it.version || 1, type: it.type, ext: it.ext, size: it.size });

/**
 * Compare items before/after a state change and append journal entries:
 *   create: { before: null }   change: { before: snapshot }   delete: { before: snapshot }  (deleted = permanently)
 * A change can supply its own entries (e.g. the recovery drill, attributed to another user) via ns.__journal.
 */
function journalChanges(s, ns) {
  if (ns === s) return s;
  let entries = ns.__journal || null;
  if (entries) { ns = { ...ns }; delete ns.__journal; } // eslint-disable-line no-param-reassign
  else if (ns.items !== s.items && s.items && ns.items) {
    const at = Date.now();
    entries = [];
    for (const id of new Set([...Object.keys(s.items), ...Object.keys(ns.items)])) {
      const a = s.items[id]; const b = ns.items[id];
      if (a === b) continue;
      if (!a) entries.push({ id: uid('j'), at, itemId: id, kind: 'create', actorId: ns.meId, before: null });
      else if (!b) entries.push({ id: uid('j'), at, itemId: id, kind: 'delete', actorId: ns.meId, before: journalSnapshot(a) });
      else if (JOURNAL_FIELDS.some((f) => (a[f] ?? null) !== (b[f] ?? null) && !(f === 'version' && (a.version || 1) === (b.version || 1)) && !(f === 'trashed' && !!a.trashed === !!b.trashed))) {
        entries.push({ id: uid('j'), at, itemId: id, kind: 'change', actorId: ns.meId, before: journalSnapshot(a) });
      }
    }
  }
  if (!entries?.length) return ns;
  const cutoff = Date.now() - JOURNAL_DAYS * 86400000;
  return { ...ns, journal: [...(ns.journal || []), ...entries].filter((e) => e.at >= cutoff).slice(-JOURNAL_MAX) };
}

/** Blob key for an older version of a file. */
export const versionKey = (id, no) => `${id}@v${no}`;
const MAX_VERSIONS = 25;

function unregisterBlob(id) {
  const prev = blobRegistry.get(id);
  if (!prev) return;
  // Copies share the same entry; only revoke when no other id still uses it.
  blobRegistry.delete(id);
  if (![...blobRegistry.values()].includes(prev)) URL.revokeObjectURL(prev.url);
  fileStore.delete(id).catch(() => {});
}

/** Replace a registry entry with bytes read back from IndexedDB (revoking the old URL if nothing shares it). */
function replaceRegistered(id, blob) {
  const prev = blobRegistry.get(id);
  blobRegistry.set(id, { blob, url: URL.createObjectURL(blob) });
  if (prev?.url && ![...blobRegistry.values()].includes(prev)) URL.revokeObjectURL(prev.url);
}

const ORPHAN_GRACE_MS = 15000;

const StoreCtx = createContext(null);

export function DriveStoreProvider({ children }) {
  const [state, setState] = useState(loadState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [persistError, setPersistError] = useState(null);
  const [blobError, setBlobError] = useState(null);
  const [blobsVersion, setBlobsVersion] = useState(0);
  // The state both this tab and the saved copy agree on: the base for merging another tab's save.
  const lastSaved = useRef(state);
  const writePending = useRef(false);
  useEffect(() => {
    const onError = () => setBlobError('Some uploaded files couldn’t be saved in this browser (storage is full or blocked). They will be lost when the page is reloaded.');
    blobErrorListeners.add(onError);
    return () => { blobErrorListeners.delete(onError); };
  }, []);

  // Restore uploaded file bytes from IndexedDB, then re-render so viewers pick them up.
  useEffect(() => {
    let alive = true;
    fileStore.loadAll().then((entries) => {
      if (!alive) return;
      const known = stateRef.current.items;
      const orphans = [];
      for (const [id, blob] of entries) {
        if (!known[id.split('@')[0]]) { orphans.push(id); continue; } // version blobs are keyed id@vN
        if (!blobRegistry.has(id)) blobRegistry.set(id, { blob, url: URL.createObjectURL(blob) });
      }
      setBlobsVersion((v) => v + 1);
      markBlobsReady();
      // Another tab may have stored an upload whose state it hasn't saved yet (saves are debounced):
      // wait, then only delete bytes that neither this tab nor the latest saved state knows about.
      if (orphans.length) {
        setTimeout(() => {
          const saved = stateStore.load()?.items || {};
          for (const id of orphans) {
            const base = id.split('@')[0];
            if (!stateRef.current.items[base] && !saved[base] && !blobRegistry.has(id)) fileStore.delete(id).catch(() => {});
          }
        }, ORPHAN_GRACE_MS);
      }
    }).catch(() => markBlobsReady());
    return () => { alive = false; };
  }, []);

  // Several tabs share one saved workspace. When another tab saves, adopt its state (instead of later
  // overwriting it with ours) and pick up any file bytes it uploaded.
  const fromOtherTab = useRef(null);
  useEffect(() => stateStore.subscribe((saved) => {
    let next;
    try { next = hydrate(saved); } catch { return; }
    const mine = stateRef.current;
    // Files whose contents the other tab replaced (new version, restore): our cached bytes are stale.
    const stale = new Set();
    for (const [id, it] of Object.entries(next.items || {})) {
      const was = mine.items?.[id];
      if (was && ((was.version || 1) !== (it.version || 1) || was.size !== it.size || was.modifiedAt !== it.modifiedAt)) stale.add(id);
    }
    if (writePending.current && mine !== lastSaved.current) {
      // Unsaved changes here: keep them on top of the other tab's save (it gets written back shortly).
      const merged = mergeStates(lastSaved.current, mine, next);
      lastSaved.current = next;
      setState(merged);
    } else {
      fromOtherTab.current = next;
      lastSaved.current = next;
      setState(next);
    }
    fileStore.loadAll().then((entries) => {
      let changed = 0;
      for (const [id, blob] of entries) {
        if (!blobRegistry.has(id)) { blobRegistry.set(id, { blob, url: URL.createObjectURL(blob) }); changed++; }
        else if (stale.has(id)) { replaceRegistered(id, blob); changed++; }
      }
      if (changed) setBlobsVersion((v) => v + 1);
    }).catch(() => {});
  }), []);

  // Persist (debounced), with a synchronous flush when the page is hidden/unloaded
  const persistNow = useRef(null);
  useEffect(() => {
    const flush = () => persistNow.current?.();
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('beforeunload', flush); };
  }, []);
  useEffect(() => {
    // State that just arrived from another tab is already saved; writing it back would echo between tabs.
    if (state === fromOtherTab.current) { persistNow.current = null; writePending.current = false; return undefined; }
    let done = false;
    const write = () => {
      if (done) return;
      done = true;
      writePending.current = false;
      // Quota exceeded: the store retries without embedded file data (slim) before giving up.
      const r = stateStore.save(state);
      if (r.ok) lastSaved.current = state;
      if (r.slim) moveEmbeddedToFileStore(state);
      setPersistError(!r.ok ? 'Browser storage is full. Changes will not persist.'
        : r.slim ? 'Browser storage is nearly full: older activity history was shortened to fit.' : null);
    };
    persistNow.current = write;
    writePending.current = true;
    const t = setTimeout(write, 250);
    return () => clearTimeout(t);
  }, [state]);

  /**
   * A slim save drops embedded data: URLs (small uploads, some old versions) from the saved state. Make sure
   * those bytes are in the file store first, or they'd be gone after a reload.
   */
  const moveEmbeddedToFileStore = (s) => {
    for (const it of Object.values(s.items || {})) {
      if (it.dataUrl && !blobRegistry.has(it.id)) { const b = dataUrlToBlob(it.dataUrl); if (b) registerBlob(it.id, b); }
      for (const v of it.versions || []) {
        const key = versionKey(it.id, v.no);
        if (v.dataUrl && !blobRegistry.has(key)) { const b = dataUrlToBlob(v.dataUrl); if (b) registerBlob(key, b); }
      }
    }
  };

  // Every state change goes through here; item changes are recorded in the change journal (see journalChanges).
  const update = useCallback((fn) => setState((s) => journalChanges(s, fn(s) || s)), []);

  // Hash any plain-text link / file-request passwords (old saves, other code paths): async, then saved.
  const hashing = useRef(false);
  const [hashTick, setHashTick] = useState(0); // re-check when a password changed while hashing
  useEffect(() => {
    const todo = !hashing.current && plainSecrets(state);
    if (!todo) return;
    hashing.current = true;
    const hashAll = (list) => Promise.all(list.map(async ([id, plain]) => [id, plain, await hashSecret(plain)]));
    Promise.all([hashAll(todo.items), hashAll(todo.reqs)])
      .then(([ih, rh]) => {
        setState((s) => applySecretHashes(s, ih, rh));
        setTimeout(() => { hashing.current = false; if (plainSecrets(stateRef.current)) setHashTick((n) => n + 1); }, 0);
      })
      .catch(() => { hashing.current = false; /* WebCrypto unavailable: the plain values keep working */ });
  }, [state.items, state.fileRequests, hashTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ask the browser (quietly) to keep our data once someone is signed in; browsers may grant it silently.
  const askedPersist = useRef(false);
  useEffect(() => {
    if (state.signedOut || askedPersist.current) return;
    askedPersist.current = true;
    requestPersistence();
  }, [state.signedOut]);

  const log = (s, action, target, details = '', extra = {}) => ({
    ...s,
    audit: [{ id: uid('a'), actorId: s.meId, action, target, details, at: Date.now(), ip: '10.0.1.24', ...extra }, ...s.audit].slice(0, 500),
  });

  const patchItems = (s, patches) => {
    const items = { ...s.items };
    for (const [id, p] of Object.entries(patches)) if (items[id]) items[id] = { ...items[id], ...p };
    return { ...s, items };
  };

  const api = useMemo(() => {
    const get = () => stateRef.current;

    const newItem = (s, o) => {
      const now = Date.now();
      const space = o.space || 'my';
      const name = uniqueName(s, o.name, o.parentId || null, space);
      return {
        id: o.id || uid('f'), name, type: o.type || 'file', ext: o.ext || '', size: o.size || 0,
        parentId: o.parentId || null, space, ownerId: s.meId, createdAt: now, modifiedAt: now, modifiedBy: s.meId,
        lastOpened: null, favorite: false, trashed: false, trashedAt: null, trashedBy: null, sharedWith: [], link: null,
        content: o.content ?? null, sheet: o.sheet || null, slides: o.slides || null, dataUrl: o.dataUrl || null,
        mime: o.mime || null, thumb: o.thumb || null, description: '',
        version: 1, versions: [], comments: [], lock: null,
        labels: o.labels || [], color: null, meta: o.meta || null,
        linkLog: [], uploadedBy: o.uploadedBy || null,
        ...(o.type === 'shortcut' ? { target: o.target } : {}),
      };
    };

    /** Capture an item's current contents as a version entry, moving its bytes (if any) to the version's blob key. */
    const snapshotVersion = (it) => {
      const no = it.version || 1;
      const reg = blobRegistry.get(it.id);
      if (reg) registerBlob(versionKey(it.id, no), reg.blob);
      return {
        id: uid('v'), no, at: it.modifiedAt, by: it.modifiedBy || it.ownerId, size: it.size, note: it.versionNote || '',
        content: it.content ?? null, sheet: it.sheet || null, slides: it.slides || null, dataUrl: reg ? null : (it.dataUrl || null), mime: it.mime || null,
        hasBlob: !!reg,
      };
    };

    /** Push `snap` onto the history, apply `patch` as the new current version, and trim old versions. */
    const commitVersion = (id, snap, patch, action, details, note = '') => {
      const it = get().items[id];
      const all = [snap, ...(it.versions || [])];
      // Retention policy caps how many old versions are kept; nothing is discarded while a legal hold applies.
      const keep = holdOn(get(), id) ? Infinity : (get().org.policies.maxVersions || MAX_VERSIONS);
      all.slice(keep).forEach((v) => unregisterBlob(versionKey(id, v.no)));
      const nextNo = (it.version || 1) + 1;
      update((s) => log(
        patchItems(s, { [id]: { ...patch, version: nextNo, versionNote: note, versions: all.slice(0, keep), modifiedAt: Date.now(), modifiedBy: s.meId } }),
        action, it.name, `Version ${nextNo}${details ? ` · ${details}` : ''}`, { itemId: id },
      ));
    };

    const mentionsIn = (s, text) => s.users.filter((u) => text.includes(`@${u.name}`)).map((u) => u.id);

    /** Can the current user add or move things into this folder (or space root)? */
    const canWriteTo = (s, parentId, space) => {
      if (parentId) { const p = s.items[parentId]; return !!p && !isTrashedDeep(s.items, parentId) && canEdit(accessOf(s, p)); }
      if (space === 'my') return true;
      if (space && space.startsWith('t')) return ['admin', 'organizer', 'editor'].includes(teamRoleOf(s, space));
      return false;
    };
    /** Would moving `id` to the destination take it outside a legal hold that currently covers it? */
    const leavesHold = (s, id, parentId, space) => {
      const h = holdOn(s, id);
      if (!h) return false;
      if (h.itemIds?.includes(id)) return false; // held by id: the hold follows the item
      const destChain = new Set(parentId ? [parentId, ...ancestors(s.items, parentId).map((a) => a.id)] : []);
      const stillCovered = (h.spaces || []).includes(space) || (h.itemIds || []).some((x) => destChain.has(x));
      return !stillCovered;
    };
    /** Close open signature requests whose document is gone (trashed or deleted). */
    const cancelRequestsFor = (s, itemIds, reason) => {
      const gone = new Set(itemIds);
      if (!(s.signRequests || []).some((r) => gone.has(r.itemId) && ['sent', 'viewed'].includes(r.status))) return s;
      return {
        ...s,
        signRequests: s.signRequests.map((r) => (gone.has(r.itemId) && ['sent', 'viewed'].includes(r.status)
          ? { ...r, status: 'cancelled', events: [...r.events, { at: Date.now(), kind: 'cancelled', by: s.meId, detail: reason }] } : r)),
      };
    };

    const folderCache = new Map();
    const pendingFolders = new Set(); // ids from ensureFolderPath not yet in the rendered state
    const o = {
      get,
      reset() {
        stateStore.clear();
        blobRegistry.forEach((v) => URL.revokeObjectURL(v.url));
        blobRegistry.clear();
        fileStore.clear().catch(() => {});
        setState(seedState());
      },

      /**
       * Replace the whole workspace in this browser with a backup (see src/backup/backup.js).
       * saved: a state object (seedVersion 1..SEED_VERSION); files: [[blobKey, Blob], ...].
       * This tab stays signed in. Throws if the file store or state can't be written.
       */
      async replaceWorkspace(saved, files) {
        const cur = get();
        const next = { ...hydrate(saved), signedOut: cur.signedOut, remember: cur.remember };
        // Save the state first: if it doesn't fit, nothing has been touched yet. If the files then fail to
        // write, put the previous state back so the saved state and the file store still match.
        const r = stateStore.save(next);
        if (!r.ok) throw new Error('Browser storage is full, so the backup could not be saved.');
        try {
          await fileStore.replaceAll(files);
        } catch (e) {
          stateStore.save(cur);
          throw e;
        }
        blobRegistry.forEach((v) => URL.revokeObjectURL(v.url));
        blobRegistry.clear();
        for (const [id, blob] of files) blobRegistry.set(id, { blob, url: URL.createObjectURL(blob) });
        folderCache.clear();
        pendingFolders.clear();
        setState(next);
        setBlobsVersion((v) => v + 1);
        setPersistError(r.slim ? 'Some uploaded file contents are too large to keep after reload.' : null);
      },

      createFolder(name, parentId, space) {
        const id = uid('d');
        update((s) => {
          const it = newItem(s, { id, name, parentId, space, type: 'folder' });
          return log({ ...s, items: { ...s.items, [it.id]: it } }, 'Folder created', it.name, '', { teamId: space?.startsWith('t') ? space : undefined });
        });
        return id;
      },

      createFile(opts) {
        const id = uid('f');
        const created = { id, name: uniqueName(get(), opts.name, opts.parentId || null, opts.space || 'my') };
        update((s) => {
          const it = newItem(s, { ...opts, id, type: 'file' });
          if (opts.silent) return { ...s, items: { ...s.items, [it.id]: it } }; // logged by the caller (e.g. file request uploads)
          return log({ ...s, items: { ...s.items, [it.id]: it } }, opts.uploaded ? 'File uploaded' : 'File created', it.name, opts.space?.startsWith('t') ? 'Team folder' : '', { teamId: opts.space?.startsWith('t') ? opts.space : undefined });
        });
        return created;
      },

      /** Ensure a nested folder path exists (for folder uploads). Returns the leaf folder id. */
      ensureFolderPath(segments, parentId, space) {
        let pid = parentId || null;
        for (const seg of segments) {
          const key = `${space}|${pid}|${seg}`;
          const items = get().items;
          const cached = folderCache.get(key);
          const c = cached && items[cached];
          // A folder created earlier in this same batch isn't in the rendered state yet: trust the cache for it.
          const pending = cached && !c && pendingFolders.has(cached);
          if (c) pendingFolders.delete(cached);
          const cacheOk = pending || (c && c.type === 'folder' && !isTrashedDeep(items, cached) && c.name === seg && c.parentId === pid);
          if (cached && !cacheOk) folderCache.delete(key);
          const existing = cacheOk ? cached
            : Object.values(items).find((i) => i.type === 'folder' && !isTrashedDeep(items, i.id) && i.name === seg && i.parentId === pid && (pid ? true : i.space === space))?.id;
          if (!existing) {
            pid = o.createFolder(seg, pid, space);
            pendingFolders.add(pid);
          } else pid = existing;
          folderCache.set(key, pid);
        }
        return pid;
      },

      renameItem(id, name) {
        update((s) => {
          const it = s.items[id];
          if (!it || lockedByOther(s, it)) return s;
          const finalName = uniqueName(s, name, it.parentId, it.space, id);
          const ext = it.type === 'file' ? (finalName.includes('.') ? finalName.split('.').pop().toLowerCase() : '') : '';
          const ns = patchItems(s, { [id]: { name: finalName, ext: it.type === 'file' ? ext : '', modifiedAt: Date.now(), modifiedBy: s.meId } });
          return log(ns, 'File renamed', finalName, `from "${it.name}"`, { itemId: id });
        });
      },

      /** Rename many items at once. pairs: [{ id, name }]. Returns the number renamed. */
      bulkRename(pairs) {
        const snap = get();
        const todo = pairs.filter((p) => snap.items[p.id] && !lockedByOther(snap, snap.items[p.id]) && p.name.trim() && p.name.trim() !== snap.items[p.id].name);
        if (!todo.length) return 0;
        update((s) => {
          let ns = s;
          for (const { id, name } of todo) {
            const it = ns.items[id];
            const finalName = uniqueName(ns, name.trim(), it.parentId, it.space, id);
            const ext = it.type === 'file' ? (finalName.includes('.') ? finalName.split('.').pop().toLowerCase() : '') : it.ext;
            ns = patchItems(ns, { [id]: { name: finalName, ext, modifiedAt: Date.now(), modifiedBy: s.meId } });
          }
          return log(ns, 'Bulk renamed', `${todo.length} item${todo.length === 1 ? '' : 's'}`, todo.slice(0, 3).map((p) => `"${s.items[p.id].name}" → "${p.name.trim()}"`).join(', ') + (todo.length > 3 ? '…' : ''));
        });
        return todo.length;
      },

      /** Add shortcuts to items in another folder (no copy is made). Returns the new shortcut ids. */
      createShortcuts(ids, parentId, space) {
        const snap = get();
        // Decide ids outside the reducer (React may run reducers twice in development).
        const plan = ids.map((id) => {
          const src = snap.items[id];
          const targetId = src?.type === 'shortcut' ? src.target : id; // a shortcut to a shortcut points at the original
          return snap.items[targetId] ? { sid: uid('s'), targetId } : null;
        }).filter(Boolean);
        if (!plan.length) return [];
        update((s) => {
          let ns = s;
          for (const { sid, targetId } of plan) {
            const it = newItem(ns, { id: sid, name: s.items[targetId].name, type: 'shortcut', target: targetId, parentId, space });
            ns = { ...ns, items: { ...ns.items, [sid]: it } };
          }
          return log(ns, 'Shortcut created', plan.length === 1 ? ns.items[plan[0].sid].name : `${plan.length} items`, parentId ? `in "${s.items[parentId]?.name}"` : '');
        });
        return plan.map((p) => p.sid);
      },

      updateItem(id, patch, { touch = true } = {}) {
        update((s) => {
          if (touch && lockedByOther(s, s.items[id])) return s; // content edits are blocked while someone else has it checked out
          return patchItems(s, { [id]: touch ? { ...patch, modifiedAt: Date.now(), modifiedBy: s.meId } : patch });
        });
      },

      markOpened(id) {
        update((s) => patchItems(s, { [id]: { lastOpened: Date.now() } }));
      },

      /**
       * Returns { moved, skipped, denied, held, locked, lostAccess } (skipped counts everything not moved).
       * lostAccess: the move would leave you without access (e.g. someone else's file, seen through a
       * shared folder, moved into your My Folders).
       */
      moveItems(ids, targetParentId, targetSpace) {
        const snap = get();
        const result = { moved: 0, skipped: 0, denied: 0, held: 0, locked: 0, lostAccess: 0 };
        const why = (s, id) => {
          const it = s.items[id];
          if (!it) return 'gone';
          if (id === targetParentId || (it.type === 'folder' && targetParentId && descendantIds(s.items, id).includes(targetParentId))) return 'invalid';
          if (it.parentId === (targetParentId || null) && it.space === targetSpace) return 'same';
          if (lockedInside(s, id)) return 'locked';
          if (!canEdit(accessOf(s, it)) || !canWriteTo(s, targetParentId, targetSpace)) return 'denied';
          if (leavesHold(s, id, targetParentId, targetSpace)) return 'held';
          const after = { ...s, items: { ...s.items, [id]: { ...it, parentId: targetParentId || null, space: targetSpace } } };
          if (accessOf(after, after.items[id]) === 'none') return 'lostAccess';
          return null;
        };
        for (const id of ids) {
          const w = why(snap, id);
          if (w === 'gone') continue;
          if (w) { result.skipped++; if (w in result) result[w]++; } else result.moved++;
        }
        update((s) => {
          let movedNow = 0;
          const patches = {};
          let ns = s;
          for (const id of ids) {
            const it = s.items[id];
            if (!it || why(s, id)) continue;
            const name = uniqueName(ns, it.name, targetParentId, targetSpace, id);
            patches[id] = { parentId: targetParentId || null, space: targetSpace, name };
            for (const d of descendantIds(s.items, id)) patches[d] = { space: targetSpace };
            ns = patchItems(ns, patches);
            movedNow++;
          }
          return movedNow ? log(ns, 'Moved', `${movedNow} item(s)`, '') : s;
        });
        return result;
      },

      /**
       * Copy items (folders with everything inside). Returns the number of top-level items copied;
       * `copyItems.lastError` explains a refusal (no access to the destination, download restricted, over quota).
       */
      copyItems(ids, targetParentId, targetSpace) {
        const snap = get();
        o.copyItems.lastError = null;
        const valid = (id) => snap.items[id] && !(snap.items[id].type === 'folder' && targetParentId && (id === targetParentId || descendantIds(snap.items, id).includes(targetParentId)));
        if (!canWriteTo(snap, targetParentId, targetSpace)) { o.copyItems.lastError = 'You can’t add files to that folder'; return 0; }
        const roots = ids.filter(valid).filter((id) => canDownload(snap, snap.items[id]));
        if (roots.length < ids.filter(valid).length && !roots.length) { o.copyItems.lastError = 'Your administrator doesn’t allow viewers to copy or download these files'; return 0; }
        // Plan every copy up front: ids are decided here so React's double-run of updaters can't create duplicates.
        const plan = [];
        const walk = (srcId, parentId, isRoot) => {
          const src = snap.items[srcId];
          const copyId = uid('f');
          plan.push({ srcId, copyId, parentId: parentId || null, isRoot });
          childIds(snap.items, srcId).filter((c) => !snap.items[c].trashed).forEach((c) => walk(c, copyId, false));
          return src;
        };
        roots.forEach((id) => walk(id, targetParentId, true));
        const bytes = plan.reduce((n, p) => n + (snap.items[p.srcId].type === 'file' ? snap.items[p.srcId].size || 0 : 0), 0);
        const qErr = quotaError(snap, targetSpace, bytes);
        if (qErr) { o.copyItems.lastError = qErr; return 0; }
        for (const p of plan) {
          if (blobRegistry.has(p.srcId)) { blobRegistry.set(p.copyId, blobRegistry.get(p.srcId)); storeBlob(p.copyId, blobRegistry.get(p.srcId).blob); }
        }
        update((s) => {
          const items = { ...s.items };
          const ns = { ...s, items };
          for (const p of plan) {
            const src = s.items[p.srcId];
            if (!src) continue;
            items[p.copyId] = {
              ...src, id: p.copyId, parentId: p.parentId, space: targetSpace, ownerId: s.meId,
              createdAt: Date.now(), modifiedAt: Date.now(), modifiedBy: s.meId, sharedWith: [], link: null, favorite: false, lastOpened: null,
              version: 1, versions: [], comments: [], lock: null, linkLog: [], uploadedBy: null, annotations: [], annotatedVersion: null,
              name: p.isRoot ? uniqueName(ns, src.name, p.parentId, targetSpace) : src.name,
            };
          }
          return log(ns, 'Copied', `${roots.length} item(s)`, '');
        });
        return roots.length;
      },

      /** Returns { trashed, locked, denied }. Needs edit access; items checked out by someone else are skipped. */
      trashItems(ids) {
        const snap = get();
        const res = { trashed: 0, locked: 0, denied: 0 };
        for (const id of ids) {
          const it = snap.items[id];
          if (!it) continue;
          if (lockedInside(snap, id)) res.locked++;
          else if (!canEdit(accessOf(snap, it)) && it.ownerId !== snap.meId) res.denied++;
          else res.trashed++;
        }
        update((s) => {
          const now = Date.now();
          const patches = {};
          const ok = ids.filter((id) => s.items[id] && !lockedInside(s, id) && (canEdit(accessOf(s, s.items[id])) || s.items[id].ownerId === s.meId));
          if (!ok.length) return s;
          for (const id of ok) patches[id] = { trashed: true, trashedAt: now, trashedBy: s.meId, favorite: false };
          const names = ok.map((id) => s.items[id]?.name).filter(Boolean);
          const ns = cancelRequestsFor(patchItems(s, patches), ok, 'The document was moved to Trash');
          return log(ns, 'File deleted', names.length === 1 ? names[0] : `${names.length} items`, 'Moved to trash');
        });
        return res;
      },

      /** Restore from trash. Returns number restored to root because their original folder is gone. */
      restoreItems(ids) {
        const snap = get();
        const depth = (items, id) => ancestors(items, id).length;
        const restoring = new Set(ids);
        // A parent restored in the same batch is not "gone".
        const relocated = ids.filter((id) => {
          const it = snap.items[id];
          if (!it?.parentId) return false;
          if (!snap.items[it.parentId]) return true;
          const chain = [it.parentId, ...ancestors(snap.items, it.parentId).map((a) => a.id)];
          return chain.some((c) => snap.items[c]?.trashed && !restoring.has(c));
        }).length;
        update((s) => {
          const patches = {};
          let ns = s;
          for (const id of [...ids].sort((a, b) => depth(s.items, a) - depth(s.items, b))) {
            const it = s.items[id];
            if (!it) continue;
            const parentGone = it.parentId && (!ns.items[it.parentId] || isTrashedDeep(ns.items, it.parentId));
            const parentId = parentGone ? null : it.parentId;
            patches[id] = { trashed: false, trashedAt: null, trashedBy: null, parentId, name: uniqueName(ns, it.name, parentId, it.space, id) };
            ns = patchItems(ns, { [id]: patches[id] });
          }
          return log(ns, 'Restored', ids.length === 1 ? s.items[ids[0]]?.name : `${ids.length} items`, 'From trash');
        });
        return relocated;
      },

      /**
       * Permanently delete items. Anything covered by a legal hold, or holding a file someone else has
       * checked out, is kept. Returns { deleted, held, locked }.
       */
      deleteForever(requested, { reason = '' } = {}) {
        const snap = get();
        const present = requested.filter((id) => snap.items[id]);
        const heldIds = present.filter((id) => blocksPermanentDelete(snap, id));
        const lockedIds = present.filter((id) => !heldIds.includes(id) && lockedInside(snap, id));
        const ids = present.filter((id) => !heldIds.includes(id) && !lockedIds.includes(id));
        const held = heldIds.length;
        const locked = lockedIds.length;
        if (!ids.length) return { deleted: 0, held, locked };
        for (const id of ids) for (const d of [id, ...descendantIds(snap.items, id)]) (snap.items[d]?.versions || []).forEach((v) => unregisterBlob(versionKey(d, v.no)));
        const all = ids.flatMap((id) => [id, ...descendantIds(snap.items, id)]);
        all.forEach((d) => unregisterBlob(d));
        update((s) => {
          const items = { ...s.items };
          const names = [];
          for (const id of ids) {
            if (!items[id]) continue;
            names.push(items[id].name);
            for (const d of descendantIds(s.items, id)) delete items[d];
            delete items[id];
          }
          const ns = cancelRequestsFor({ ...s, items }, all, 'The document was permanently deleted');
          return log(ns, 'Permanently deleted', names.length === 1 ? names[0] : `${names.length} items`, reason);
        });
        return { deleted: ids.length, held, locked };
      },

      /** Returns { deleted, held, locked }. */
      emptyTrash() {
        const ids = Object.values(get().items).filter((i) => i.trashed && (i.ownerId === get().meId || i.trashedBy === get().meId)).map((i) => i.id);
        return o.deleteForever(ids);
      },

      // ---- Data retention ----
      /** Trash items older than the retention period (and not on legal hold). */
      retentionCandidates(days = get().org.policies.trashRetentionDays, now = Date.now()) {
        const s = get();
        if (!days) return { due: [], held: [] };
        const old = Object.values(s.items).filter((i) => i.trashed && i.trashedAt && i.trashedAt < now - days * 86400000);
        return { due: old.filter((i) => !blocksPermanentDelete(s, i.id)), held: old.filter((i) => blocksPermanentDelete(s, i.id)) };
      },
      /** Permanently delete expired Trash items. Returns { deleted, held }. */
      runRetention({ manual = false } = {}) {
        const { due, held } = o.retentionCandidates();
        if (!due.length) return { deleted: 0, held: held.length };
        const days = get().org.policies.trashRetentionDays;
        const res = o.deleteForever(due.map((i) => i.id), { reason: `Trash retention: older than ${days} days` });
        update((s) => log(s, 'Retention cleanup', `${res.deleted} item${res.deleted === 1 ? '' : 's'}`, `${manual ? 'Run manually' : 'Automatic'} · ${held.length} kept for legal hold`));
        return { deleted: res.deleted, held: held.length };
      },

      // ---- Legal hold ----
      createLegalHold({ name, note = '', itemIds = [], spaces = [] }) {
        const id = uid('lh');
        update((s) => log({ ...s, org: { ...s.org, legalHolds: [{ id, name: name.trim(), note: note.trim(), itemIds, spaces, createdBy: s.meId, createdAt: Date.now(), active: true, releasedAt: null }, ...(s.org.legalHolds || [])] } },
          'Legal hold placed', name.trim(), `${itemIds.length + spaces.length} location(s)`));
        return id;
      },
      updateLegalHold(id, patch) {
        update((s) => ({ ...s, org: { ...s.org, legalHolds: s.org.legalHolds.map((h) => (h.id === id ? { ...h, ...patch } : h)) } }));
      },
      releaseLegalHold(id) {
        update((s) => {
          const h = s.org.legalHolds.find((x) => x.id === id);
          return log({ ...s, org: { ...s.org, legalHolds: s.org.legalHolds.map((x) => (x.id === id ? { ...x, active: false, releasedAt: Date.now() } : x)) } }, 'Legal hold released', h?.name || id);
        });
      },

      // ---- Sign-in sessions ----
      /** End one session (sign a device out). */
      endSession(id, why = 'Signed out remotely') {
        update((s) => {
          const ss = (s.sessions || []).find((x) => x.id === id);
          if (!ss || ss.endedAt) return s;
          const who = s.users.find((u) => u.id === ss.userId);
          return log({ ...s, sessions: s.sessions.map((x) => (x.id === id ? { ...x, endedAt: Date.now(), endedBy: s.meId } : x)) }, 'Session ended', `${who?.name || 'User'} · ${ss.device}`, why);
        });
      },
      /** Sign a user out everywhere (optionally keeping one session). Returns how many ended. */
      endUserSessions(userId, exceptId = null) {
        const live = (get().sessions || []).filter((x) => x.userId === userId && !x.endedAt && x.id !== exceptId);
        if (!live.length) return 0;
        update((s) => {
          const who = s.users.find((u) => u.id === userId);
          const ids = new Set(live.map((x) => x.id));
          return log({ ...s, sessions: s.sessions.map((x) => (ids.has(x.id) ? { ...x, endedAt: Date.now(), endedBy: s.meId } : x)) }, 'Signed out everywhere', who?.name || 'User', `${live.length} session(s)${exceptId ? ', current kept' : ''}`);
        });
        return live.length;
      },
      touchSession(id) {
        update((s) => ({ ...s, sessions: (s.sessions || []).map((x) => (x.id === id ? { ...x, lastActive: Date.now() } : x)) }));
      },
      /** Make sure this browser has a live session record (e.g. data saved before sessions existed). */
      ensureCurrentSession() {
        const s = get();
        const sid = currentSessionId();
        // pendingSid: an id created moments ago whose state update hasn't rendered yet (effects can run twice).
        if (s.signedOut || (sid && (sid === pendingSid || (s.sessions || []).some((x) => x.id === sid)))) return;
        const ss = newSession(s.meId);
        pendingSid = ss.id;
        rememberSessionId(ss.id, s.remember !== false);
        update((st) => ({ ...st, sessions: [ss, ...(st.sessions || [])] }));
      },

      setFavorite(ids, value) {
        update((s) => patchItems(s, Object.fromEntries(ids.map((id) => [id, { favorite: value }]))));
      },

      setShares(id, sharedWith) {
        update((s) => {
          const prev = s.items[id]?.sharedWith || [];
          const added = sharedWith.filter((x) => !prev.find((p) => p.userId === x.userId));
          let ns = patchItems(s, { [id]: { sharedWith } });
          if (added.length) ns = log(ns, 'File shared', s.items[id].name, added.map((a) => `${s.users.find((u) => u.id === a.userId)?.name || a.userId} (${a.role})`).join(', '), { itemId: id });
          return ns;
        });
      },

      setLink(id, rawLink) {
        const link = normalizeLink(rawLink);
        update((s) => {
          const had = s.items[id]?.link?.enabled;
          let ns = patchItems(s, { [id]: { link } });
          if (link?.enabled && !had) ns = log(ns, 'Link created', s.items[id].name, link.access === 'anyone' ? 'Anyone with the link' : 'Organization', { itemId: id });
          return ns;
        });
      },

      // ---- Guest (external collaborator) access ----
      /** Set or clear (null) when someone's access to a shared item ends. */
      setShareExpiry(itemId, userId, expires) {
        update((s) => {
          const it = s.items[itemId];
          if (!it) return s;
          const ns = patchItems(s, { [itemId]: { sharedWith: it.sharedWith.map((x) => (x.userId === userId ? { ...x, expires: expires || null } : x)) } });
          return log(ns, 'Access expiration changed', it.name, `${s.users.find((u) => u.id === userId)?.name || userId} → ${expires ? new Date(expires).toLocaleDateString() : 'never'}`, { itemId });
        });
      },
      setMemberExpiry(teamId, userId, expires) {
        update((s) => {
          const t = s.teams.find((x) => x.id === teamId);
          if (!t) return s;
          const ns = { ...s, teams: s.teams.map((x) => (x.id === teamId ? { ...x, members: x.members.map((m) => (m.userId === userId ? { ...m, expires: expires || null } : m)) } : x)) };
          return log(ns, 'Access expiration changed', t.name, `${s.users.find((u) => u.id === userId)?.name || userId} → ${expires ? new Date(expires).toLocaleDateString() : 'never'}`, { teamId });
        });
      },
      /** Change the role a guest has on a shared item or team folder. key: 'i:<itemId>' | 't:<teamId>' */
      setGuestRole(userId, key, role) {
        update((s) => {
          const kind = key.slice(0, 1); const id = key.slice(2);
          const name = s.users.find((u) => u.id === userId)?.name || userId;
          if (kind === 'i') {
            if (!s.items[id]) return s;
            return log(patchItems(s, { [id]: { sharedWith: s.items[id].sharedWith.map((x) => (x.userId === userId ? { ...x, role } : x)) } }), 'Permission changed', s.items[id].name, `${name} → ${role}`, { itemId: id });
          }
          const cap = role[0].toUpperCase() + role.slice(1);
          return log({ ...s, teams: s.teams.map((t) => (t.id === id ? { ...t, members: t.members.map((m) => (m.userId === userId ? { ...m, role: cap } : m)) } : t)) }, 'Permission changed', s.teams.find((t) => t.id === id)?.name || id, `${name} → ${cap}`, { teamId: id });
        });
      },
      /**
       * Set the expiration on many of a guest's resources at once. keys: ['i:<id>', 't:<id>'] (all when omitted).
       * expires: a timestamp, null (never), or { extendDays } to push each current date (or today) out.
       */
      setGuestExpiry(userId, expires, keys = null) {
        update((s) => {
          const now = Date.now();
          const pick = (k) => !keys || keys.includes(k);
          const next = (cur) => {
            if (expires && typeof expires === 'object') return new Date(Math.max(cur || 0, now) + expires.extendDays * 86400000).setHours(23, 59, 59, 0);
            return expires || null;
          };
          const items = { ...s.items };
          let n = 0;
          for (const it of Object.values(s.items)) {
            if (!pick(`i:${it.id}`) || !(it.sharedWith || []).some((x) => x.userId === userId)) continue;
            items[it.id] = { ...it, sharedWith: it.sharedWith.map((x) => (x.userId === userId ? { ...x, expires: next(x.expires) } : x)) };
            n++;
          }
          const teams = s.teams.map((t) => {
            if (!pick(`t:${t.id}`) || !t.members.some((m) => m.userId === userId)) return t;
            n++;
            return { ...t, members: t.members.map((m) => (m.userId === userId ? { ...m, expires: next(m.expires) } : m)) };
          });
          const what = expires && typeof expires === 'object' ? `extended ${expires.extendDays} days` : expires ? `expires ${new Date(expires).toLocaleDateString()}` : 'no expiry';
          return log({ ...s, items, teams }, 'Guest access updated', s.users.find((u) => u.id === userId)?.name || userId, `${n} resource(s) · ${what}`);
        });
      },
      /** Remove a guest's access to some (keys) or all of their resources. Returns how many were removed. */
      revokeGuestAccess(userId, keys = null) {
        const s0 = get();
        const pick = (k) => !keys || keys.includes(k);
        const n = Object.values(s0.items).filter((it) => pick(`i:${it.id}`) && (it.sharedWith || []).some((x) => x.userId === userId)).length
          + s0.teams.filter((t) => pick(`t:${t.id}`) && t.members.some((m) => m.userId === userId)).length;
        update((s) => {
          const items = { ...s.items };
          for (const it of Object.values(s.items)) {
            if (pick(`i:${it.id}`) && (it.sharedWith || []).some((x) => x.userId === userId)) items[it.id] = { ...it, sharedWith: it.sharedWith.filter((x) => x.userId !== userId) };
          }
          const teams = s.teams.map((t) => (pick(`t:${t.id}`) ? { ...t, members: t.members.filter((m) => m.userId !== userId) } : t));
          return log({ ...s, items, teams }, 'Guest access removed', s.users.find((u) => u.id === userId)?.name || userId, `${n} resource(s)`);
        });
        return n;
      },
      /** Clean-up: drop every share and team membership whose expiration date has passed. Returns the count. */
      purgeExpiredAccess(userIds = null) {
        const now = Date.now();
        const mine = (id) => !userIds || userIds.includes(id);
        const dead = (x) => mine(x.userId) && x.expires && x.expires <= now;
        const personal = (it) => !(it.space && it.space.startsWith('t')); // shares on team-folder items grant nothing
        const s0 = get();
        const n = Object.values(s0.items).filter(personal).reduce((c, it) => c + (it.sharedWith || []).filter(dead).length, 0) + s0.teams.reduce((c, t) => c + t.members.filter(dead).length, 0);
        if (!n) return 0;
        update((s) => {
          const items = { ...s.items };
          for (const it of Object.values(s.items)) if (personal(it) && (it.sharedWith || []).some(dead)) items[it.id] = { ...it, sharedWith: it.sharedWith.filter((x) => !dead(x)) };
          const teams = s.teams.map((t) => (t.members.some(dead) ? { ...t, members: t.members.filter((m) => !dead(m)) } : t));
          return log({ ...s, items, teams }, 'Expired access removed', 'Guests', `${n} expired grant(s) cleaned up`);
        });
        return n;
      },

      removeMyAccess(id) {
        update((s) => {
          const it = s.items[id];
          return patchItems(s, { [id]: { sharedWith: it.sharedWith.filter((x) => x.userId !== s.meId) } });
        });
      },

      // ---- Version history ----
      /** Save an in-place edit (content / sheet / slides) as a new version. Returns false if blocked by a lock. */
      saveVersion(id, patch, note = '') {
        // Right after a reload the previous bytes may not be loaded yet; snapshotting now would lose them.
        if (!blobsLoaded) { blobsReady.then(() => o.saveVersion(id, patch, note)); return !lockedByOther(get(), get().items[id]); }
        const it = get().items[id];
        if (!it || lockedByOther(get(), it)) return false;
        const snap = snapshotVersion(it);
        // The edited body becomes the source of truth; the previous bytes (if any) move to the version.
        if (blobRegistry.has(id)) unregisterBlob(id);
        commitVersion(id, snap, patch, 'New version', note || 'Edited', note || 'Edited');
        return true;
      },

      /** Replace a file's contents with an uploaded File, keeping the old contents as a version. */
      uploadVersion(id, file, { content = null, dataUrl = null } = {}, note = '') {
        if (!blobsLoaded) { blobsReady.then(() => o.uploadVersion(id, file, { content, dataUrl }, note)); return !lockedByOther(get(), get().items[id]); }
        const it = get().items[id];
        if (!it || lockedByOther(get(), it)) return false;
        if (quotaError(get(), it.space, Math.max(0, file.size - (it.size || 0)))) return false;
        const snap = snapshotVersion(it);
        registerBlob(id, file);
        commitVersion(id, snap, { size: file.size, mime: file.type || it.mime, content, dataUrl, sheet: null, slides: null }, 'New version uploaded', file.name, note || `Uploaded ${file.name}`);
        return true;
      },

      /** Make an older version current again. The current contents are kept as a version too. */
      restoreVersion(id, versionId) {
        if (!blobsLoaded) { blobsReady.then(() => o.restoreVersion(id, versionId)); return !lockedByOther(get(), get().items[id]); }
        const it = get().items[id];
        const v = it?.versions?.find((x) => x.id === versionId);
        if (!it || !v || lockedByOther(get(), it)) return false;
        const snap = snapshotVersion(it);
        const old = blobRegistry.get(versionKey(id, v.no));
        if (old) registerBlob(id, old.blob); else unregisterBlob(id);
        commitVersion(id, snap, { size: v.size, mime: v.mime ?? it.mime, content: v.content, sheet: v.sheet, slides: v.slides, dataUrl: v.dataUrl }, 'Version restored', `Restored version ${v.no}`, `Restored from version ${v.no}`);
        return true;
      },

      deleteVersion(id, versionId) {
        const it = get().items[id];
        const v = it?.versions?.find((x) => x.id === versionId);
        if (!v || holdOn(get(), id)) return false;
        unregisterBlob(versionKey(id, v.no));
        update((s) => log(patchItems(s, { [id]: { versions: (s.items[id].versions || []).filter((x) => x.id !== versionId) } }), 'Version deleted', it.name, `Version ${v.no}`, { itemId: id }));
      },

      // ---- Check-out / check-in ----
      lockItem(id) {
        update((s) => {
          const it = s.items[id];
          if (!it || it.lock) return s;
          return log(patchItems(s, { [id]: { lock: { by: s.meId, at: Date.now() } } }), 'File locked', it.name, 'Checked out for editing', { itemId: id });
        });
      },
      unlockItem(id) {
        update((s) => {
          const it = s.items[id];
          if (!it?.lock) return s;
          const holder = it.lock.by === s.meId ? '' : `Lock held by ${s.users.find((u) => u.id === it.lock.by)?.name || 'another user'} removed`;
          return log(patchItems(s, { [id]: { lock: null } }), 'File unlocked', it.name, holder || 'Checked in', { itemId: id });
        });
      },

      // ---- Comments ----
      addComment(id, text, parentId = null) {
        const s0 = get();
        const comment = {
          id: uid('c'), userId: s0.meId, text: text.trim(), at: Date.now(), parentId, resolved: false, resolvedBy: null, resolvedAt: null, editedAt: null,
          mentions: mentionsIn(s0, text),
        };
        update((s) => {
          const it = s.items[id];
          if (!it) return s;
          const short = comment.text.length > 80 ? `${comment.text.slice(0, 77)}…` : comment.text;
          return log(patchItems(s, { [id]: { comments: [...(it.comments || []), comment] } }), parentId ? 'Replied to comment' : 'Commented', it.name, short, { itemId: id });
        });
        return comment;
      },
      editComment(id, commentId, text) {
        update((s) => patchItems(s, { [id]: { comments: (s.items[id]?.comments || []).map((c) => (c.id === commentId ? { ...c, text: text.trim(), editedAt: Date.now(), mentions: mentionsIn(s, text) } : c)) } }));
      },
      deleteComment(id, commentId) {
        update((s) => patchItems(s, { [id]: { comments: (s.items[id]?.comments || []).filter((c) => c.id !== commentId && c.parentId !== commentId) } }));
      },
      resolveComment(id, commentId, resolved) {
        update((s) => {
          const it = s.items[id];
          const ns = patchItems(s, { [id]: { comments: (it?.comments || []).map((c) => (c.id === commentId ? { ...c, resolved, resolvedBy: resolved ? s.meId : null, resolvedAt: resolved ? Date.now() : null } : c)) } });
          return log(ns, resolved ? 'Comment resolved' : 'Comment reopened', it.name, '', { itemId: id });
        });
      },

      // ---- Labels ----
      /** Add (on=true) or remove a label on several items. */
      setLabel(ids, labelId, on) {
        update((s) => {
          const label = s.org.labels.find((l) => l.id === labelId);
          const patches = {};
          for (const id of ids) {
            const it = s.items[id];
            if (!it) continue;
            const cur = it.labels || [];
            if (on && !cur.includes(labelId)) patches[id] = { labels: [...cur, labelId] };
            if (!on && cur.includes(labelId)) patches[id] = { labels: cur.filter((x) => x !== labelId) };
          }
          const n = Object.keys(patches).length;
          if (!n) return s;
          const names = Object.keys(patches).map((id) => s.items[id].name);
          return log(patchItems(s, patches), on ? 'Label added' : 'Label removed', n === 1 ? names[0] : `${n} items`, label?.name || '', n === 1 ? { itemId: ids[0] } : {});
        });
      },
      createLabel({ name, color }) {
        const id = uid('lb');
        update((s) => log({ ...s, org: { ...s.org, labels: [...s.org.labels, { id, name: name.trim(), color }] } }, 'Label created', name.trim()));
        return id;
      },
      updateLabel(id, patch) {
        update((s) => ({ ...s, org: { ...s.org, labels: s.org.labels.map((l) => (l.id === id ? { ...l, ...patch } : l)) } }));
      },
      deleteLabel(id) {
        update((s) => {
          const label = s.org.labels.find((l) => l.id === id);
          const items = Object.fromEntries(Object.entries(s.items).map(([k, v]) => [k, v.labels?.includes(id) ? { ...v, labels: v.labels.filter((x) => x !== id) } : v]));
          return log({ ...s, items, org: { ...s.org, labels: s.org.labels.filter((l) => l.id !== id) } }, 'Label deleted', label?.name || id);
        });
      },

      // ---- Smart suggestions (rule-based, from extracted text) ----
      /** Apply suggested labels and/or custom fields. auto=true when done by the indexer for new uploads. */
      applySuggestions(id, { labelIds = [], meta = null }, { auto = false } = {}) {
        update((s) => {
          const it = s.items[id];
          if (!it) return s;
          const labels = [...new Set([...(it.labels || []), ...labelIds])];
          const patch = { labels };
          if (meta && !it.meta && !lockedByOther(s, it)) patch.meta = meta;
          if (auto) patch.autoLabeled = true;
          const names = labelIds.map((l) => s.org.labels.find((x) => x.id === l)?.name).filter(Boolean);
          const tpl = patch.meta ? s.org.dataTemplates.find((t) => t.id === meta.templateId)?.name : null;
          const what = [names.length ? `labels: ${names.join(', ')}` : '', tpl ? `${tpl} fields` : ''].filter(Boolean).join(' · ');
          return log(patchItems(s, { [id]: patch }), auto ? 'Auto-labeled' : 'Suggestions applied', it.name, `${what}${auto ? ' (from file text, by rule)' : ''}`, { itemId: id });
        });
      },
      dismissSuggestion(id, key) {
        update((s) => patchItems(s, { [id]: { dismissedSuggestions: [...new Set([...(s.items[id]?.dismissedSuggestions || []), key])] } }));
      },
      /** Mark an item as already considered for automatic labeling (so it's only tried once). */
      markAutoLabeled(id) {
        update((s) => patchItems(s, { [id]: { autoLabeled: true } }));
      },

      // ---- Restore a folder to a date ----
      /**
       * Apply a restore plan (see restore/restore.js). ops: the planned operations to carry out; label: what was restored, to when.
       * Structural changes (names, locations, Trash) happen in one step; content reverts use version history.
       */
      applyRestore(ops, { label, scopeName }) {
        const structural = ops.filter((op) => Object.keys(op.patch).length);
        update((s) => {
          let ns = s;
          for (const op of structural) {
            const it = ns.items[op.itemId];
            if (!it || lockedByOther(ns, it)) continue;
            const p = { ...op.patch };
            if (p.trashed) p.trashedBy = s.meId;
            const parentId = p.parentId !== undefined ? p.parentId : it.parentId;
            const space = p.space || it.space;
            if (!p.trashed) p.name = uniqueName(ns, p.name || it.name, parentId, space, it.id); // avoid clashing with a same-named file
            ns = patchItems(ns, { [it.id]: p });
          }
          return log(ns, 'Folder restored', scopeName, `${label} · ${ops.length} change(s)`);
        });
        let reverted = 0;
        for (const op of ops) if (op.versionId && o.restoreVersion(op.itemId, op.versionId)) reverted++;
        return { structural: structural.length, reverted };
      },

      /**
       * Recovery drill (demo): simulate a ransomware-style incident on the sample "Product & Engineering" files,
       * attributed to Omar Haddad, so restoring to a date can be tried. Returns false when the samples aren't there.
       */
      simulateIncident() {
        const s0 = get();
        const team = s0.teams.find((t) => t.id === 't2');
        const find = (name) => Object.values(s0.items).find((i) => i.space === 't2' && i.name === name && !i.trashed);
        const notes = find('Release Notes 4.2.txt'); const arch = find('Architecture Overview.pptx'); const apiDoc = find('API Design.pdf');
        if (!team || !notes || !arch || !apiDoc) return false;
        const actor = s0.users.some((u) => u.id === 'u7') ? 'u7' : s0.meId;
        const at = Date.now();
        const scramble = (t) => [...(t || 'data')].map((c, i) => String.fromCharCode(33 + ((c.charCodeAt(0) * 7 + i * 13) % 90))).join('').replace(/(.{48})/g, '$1\n');
        const enc = (it, extra = {}) => ({
          name: `${it.name}.locked`, version: (it.version || 1) + 1, modifiedAt: at, modifiedBy: actor, versionNote: '',
          versions: [snapshotVersion(it), ...(it.versions || [])].slice(0, MAX_VERSIONS), ...extra,
        });
        const noteId = uid('f');
        const ransom = { ...newItem(s0, { id: noteId, name: 'READ_ME_TO_RESTORE.txt', ext: 'txt', space: 't2', parentId: null, size: 268, content: 'ALL YOUR FILES HAVE BEEN ENCRYPTED.\n\nTo get them back, send payment to the address below within 48 hours.\n\n(This is a recovery drill created in WorkDrive. Nothing was actually encrypted.)' }), ownerId: actor, modifiedBy: actor };
        const journalEntries = [notes, arch, apiDoc].map((it) => ({ id: uid('j'), at, itemId: it.id, kind: 'change', actorId: actor, before: journalSnapshot(it) }))
          .concat([{ id: uid('j'), at, itemId: noteId, kind: 'create', actorId: actor, before: null }]);
        update((s) => {
          let ns = patchItems(s, {
            [notes.id]: enc(notes, { content: scramble(notes.content), size: (notes.content || '').length + 512 }),
            [arch.id]: enc(arch, { slides: [{ title: '█▓▒░ ENCRYPTED ░▒▓█', body: scramble('slides') }] }),
            [apiDoc.id]: { trashed: true, trashedAt: at, trashedBy: actor },
          });
          ns = { ...ns, items: { ...ns.items, [noteId]: ransom } };
          for (const [action, target] of [['File renamed', `${notes.name}.locked`], ['File renamed', `${arch.name}.locked`], ['File deleted', apiDoc.name], ['File uploaded', 'READ_ME_TO_RESTORE.txt']]) {
            ns = { ...ns, audit: [{ id: uid('a'), actorId: actor, action, target, details: 'Recovery drill', at, ip: '192.0.2.140', teamId: 't2' }, ...ns.audit] };
          }
          ns.notifications = [{ id: uid('n'), type: 'system', actorId: null, text: `Unusual activity in “${team.name}”: 3 files were renamed to .locked or deleted within a minute (recovery drill). You can restore the folder to a time before it happened.`, link: '/team-folders/t2?restore=1', at, read: false }, ...ns.notifications];
          return { ...ns, __journal: journalEntries };
        });
        return true;
      },

      // ---- Data loss prevention ----
      /** Mark one kind of finding on a file as a false positive (or undo that). */
      setDlpIgnore(id, detectorId, ignore, detectorName = detectorId) {
        update((s) => {
          const it = s.items[id];
          if (!it) return s;
          const cur = it.dlpIgnore || [];
          const next = ignore ? [...new Set([...cur, detectorId])] : cur.filter((x) => x !== detectorId);
          return log(patchItems(s, { [id]: { dlpIgnore: next } }), ignore ? 'Sensitive data dismissed' : 'Sensitive data restored', it.name, `${detectorName}${ignore ? ' marked as not sensitive' : ' flagged again'}`, { itemId: id });
        });
      },

      // ---- Folder colours ----
      setFolderColor(ids, color) {
        update((s) => patchItems(s, Object.fromEntries(ids.filter((id) => s.items[id]?.type === 'folder').map((id) => [id, { color }]))));
      },

      // ---- Custom fields (data templates) ----
      /** Attach a data template with values to an item; templateId null removes it. */
      setMetadata(id, templateId, values = {}) {
        update((s) => {
          const it = s.items[id];
          if (!it || lockedByOther(s, it)) return s;
          const tpl = s.org.dataTemplates.find((t) => t.id === templateId);
          const meta = templateId ? { templateId, values } : null;
          return log(patchItems(s, { [id]: { meta } }), templateId ? 'Custom fields updated' : 'Custom fields removed', it.name, tpl?.name || '', { itemId: id });
        });
      },
      saveDataTemplate(tpl) {
        update((s) => {
          const exists = s.org.dataTemplates.some((t) => t.id === tpl.id);
          const list = exists ? s.org.dataTemplates.map((t) => (t.id === tpl.id ? tpl : t)) : [...s.org.dataTemplates, tpl];
          return log({ ...s, org: { ...s.org, dataTemplates: list } }, exists ? 'Data template updated' : 'Data template created', tpl.name, `${tpl.fields.length} fields`);
        });
      },
      deleteDataTemplate(id) {
        update((s) => {
          const tpl = s.org.dataTemplates.find((t) => t.id === id);
          const items = Object.fromEntries(Object.entries(s.items).map(([k, v]) => [k, v.meta?.templateId === id ? { ...v, meta: null } : v]));
          return log({ ...s, items, org: { ...s.org, dataTemplates: s.org.dataTemplates.filter((t) => t.id !== id) } }, 'Data template deleted', tpl?.name || id);
        });
      },

      // ---- Pins (per user) ----
      setPinned(id, on) {
        update((s) => {
          const cur = s.settings.pinned || [];
          const pinned = on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((x) => x !== id);
          return { ...s, settings: { ...s.settings, pinned } };
        });
      },
      reorderPinned(pinned) {
        update((s) => ({ ...s, settings: { ...s.settings, pinned } }));
      },

      // ---- Shared links: access log ----
      /**
       * Record one visit to a shared link. event: viewed | downloaded | password-failed | blocked-expired | blocked-limit
       * who: { name, email } for signed-in visitors, null for anonymous ones.
       */
      logLinkAccess(id, { event, who = null, device = '', ip = '', file = null, via = null }) {
        update((s) => {
          const it = s.items[id];
          if (!it) return s;
          const entry = { id: uid('la'), at: Date.now(), event, who, device, ip, ...(file ? { file } : {}), ...(via ? { via } : {}) };
          const patch = { linkLog: [entry, ...(it.linkLog || [])].slice(0, 300) };
          if (event === 'downloaded' && it.link) patch.link = { ...it.link, downloads: (it.link.downloads || 0) + 1 };
          return patchItems(s, { [id]: patch });
        });
      },
      resetLinkDownloads(id) {
        update((s) => (s.items[id]?.link ? patchItems(s, { [id]: { link: { ...s.items[id].link, downloads: 0 } } }) : s));
      },
      clearLinkLog(id) {
        update((s) => patchItems(s, { [id]: { linkLog: [] } }));
      },

      // ---- File requests (upload-only links into a folder) ----
      createFileRequest({ folderId, title, message = '', expires = null, secretHash = null, secret = null, requireIdentity = true }) {
        const id = uid('fr');
        update((s) => {
          const folder = s.items[folderId];
          // secretHash: a hashSecret() digest. A plain `secret` still works but is hashed right after (see plainSecrets).
          const req = { id, folderId, title: title.trim(), message: message.trim(), createdBy: s.meId, createdAt: Date.now(), expires, secretHash: secretHash || null, ...(secret ? { secret } : {}), requireIdentity, enabled: true, uploads: [] };
          return log({ ...s, fileRequests: [req, ...(s.fileRequests || [])] }, 'File request created', folder?.name || '', req.title, { itemId: folderId });
        });
        return id;
      },
      updateFileRequest(id, patch) {
        update((s) => ({ ...s, fileRequests: s.fileRequests.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
      },
      deleteFileRequest(id) {
        update((s) => {
          const r = s.fileRequests.find((x) => x.id === id);
          return log({ ...s, fileRequests: s.fileRequests.filter((x) => x.id !== id) }, 'File request deleted', r?.title || id);
        });
      },
      /** An outside person uploaded files through a request: record it and notify the requester. */
      recordRequestUpload(id, { name, email, fileIds, fileNames }) {
        update((s) => {
          const r = s.fileRequests.find((x) => x.id === id);
          if (!r) return s;
          const upload = { id: uid('ru'), name: name || 'Anonymous', email: email || '', at: Date.now(), fileIds, fileNames };
          const folder = s.items[r.folderId];
          const who = name || email || 'Someone';
          const route = folder?.space?.startsWith('t') ? `/team-folders/${folder.space}/${folder.id}` : `/folders/${r.folderId}`;
          const ns = {
            ...s,
            fileRequests: s.fileRequests.map((x) => (x.id === id ? { ...x, uploads: [upload, ...x.uploads] } : x)),
            notifications: [{ id: uid('n'), type: 'upload', actorId: null, text: `${who} uploaded ${fileNames.length} file${fileNames.length === 1 ? '' : 's'} to your request "${r.title}"`, link: `${route}?highlight=${fileIds[0]}`, at: Date.now(), read: false }, ...s.notifications],
          };
          return log(ns, 'Files received via request', r.title, `${fileNames.length} file(s) from ${who}${email && name ? ` <${email}>` : ''}`, { itemId: r.folderId });
        });
      },

      // ---- Tasks on files ----
      createTask({ itemId, title, note = '', assigneeId, due = null, priority = 'normal' }) {
        const id = uid('tk');
        update((s) => {
          const it = s.items[itemId];
          const t = { id, itemId, title: title.trim(), note: note.trim(), assigneeId, createdBy: s.meId, createdAt: Date.now(), due, priority, status: 'open', completedAt: null, completedBy: null };
          const who = assigneeId === s.meId ? 'me' : s.users.find((u) => u.id === assigneeId)?.name;
          return log({ ...s, tasks: [t, ...(s.tasks || [])] }, 'Task assigned', it?.name || '', `"${t.title}" → ${who}`, { itemId, teamId: it?.space?.startsWith('t') ? it.space : undefined });
        });
        return id;
      },
      updateTask(id, patch) {
        update((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
      },
      setTaskDone(id, done) {
        update((s) => {
          const t = s.tasks.find((x) => x.id === id);
          if (!t) return s;
          const it = s.items[t.itemId];
          const ns = { ...s, tasks: s.tasks.map((x) => (x.id === id ? { ...x, status: done ? 'done' : 'open', completedAt: done ? Date.now() : null, completedBy: done ? s.meId : null } : x)) };
          return log(ns, done ? 'Task completed' : 'Task reopened', it?.name || '', `"${t.title}"`, { itemId: t.itemId, teamId: it?.space?.startsWith('t') ? it.space : undefined });
        });
      },
      deleteTask(id) {
        update((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
      },

      // ---- Approvals ----
      requestApproval({ itemId, approverIds, mode = 'all', due = null, message = '', applyLabel = true }) {
        const id = uid('ap');
        update((s) => {
          const it = s.items[itemId];
          const a = {
            id, itemId, requestedBy: s.meId, requestedAt: Date.now(), due, message: message.trim(), mode, applyLabel,
            status: 'pending', decidedAt: null, version: it?.version || 1,
            approvers: approverIds.map((userId) => ({ userId, decision: 'pending', at: null, comment: '' })),
          };
          const names = approverIds.map((uid2) => s.users.find((u) => u.id === uid2)?.name).filter(Boolean).join(', ');
          return log({ ...s, approvals: [a, ...(s.approvals || [])] }, 'Approval requested', it?.name || '', `From ${names} (${mode === 'all' ? 'everyone must approve' : 'any one approver'})`, { itemId, teamId: it?.space?.startsWith('t') ? it.space : undefined });
        });
        return id;
      },
      /** The signed-in user approves or rejects. Returns the approval's resulting status. */
      decideApproval(id, decision, comment = '') {
        const a0 = get().approvals.find((x) => x.id === id);
        if (!a0 || a0.status !== 'pending') return a0?.status;
        const approvers = a0.approvers.map((p) => (p.userId === get().meId && p.decision === 'pending' ? { ...p, decision, at: Date.now(), comment: comment.trim() } : p));
        const status = a0.mode === 'any'
          ? decision
          : approvers.some((p) => p.decision === 'rejected') ? 'rejected' : approvers.every((p) => p.decision === 'approved') ? 'approved' : 'pending';
        update((s) => {
          const it = s.items[a0.itemId];
          let ns = { ...s, approvals: s.approvals.map((x) => (x.id === id ? { ...x, approvers, status, decidedAt: status === 'pending' ? null : Date.now() } : x)) };
          // Final approval can tag the file with the organization's "Approved" label.
          const approvedLabel = s.org.labels?.find((l) => l.id === 'lb-approved' || l.name.toLowerCase() === 'approved');
          if (status === 'approved' && a0.applyLabel && approvedLabel && it && !(it.labels || []).includes(approvedLabel.id)) {
            ns = patchItems(ns, { [it.id]: { labels: [...(it.labels || []), approvedLabel.id] } });
          }
          const teamId = it?.space?.startsWith('t') ? it.space : undefined;
          ns = log(ns, decision === 'approved' ? 'Approved' : 'Rejected', it?.name || '', comment.trim() ? `“${comment.trim()}”` : '', { itemId: a0.itemId, teamId });
          return status === 'pending' ? ns : log(ns, status === 'approved' ? 'Approval complete' : 'Approval rejected', it?.name || '', '', { itemId: a0.itemId, teamId });
        });
        return status;
      },
      cancelApproval(id) {
        update((s) => {
          const a = s.approvals.find((x) => x.id === id);
          const it = a && s.items[a.itemId];
          return log({ ...s, approvals: s.approvals.map((x) => (x.id === id ? { ...x, status: 'cancelled', decidedAt: Date.now() } : x)) }, 'Approval cancelled', it?.name || '', '', { itemId: a?.itemId });
        });
      },

      // ---- Markup (annotation layer on PDFs and images; kept separate from the file's contents) ----
      saveAnnotations(id, list) {
        update((s) => {
          const it = s.items[id];
          if (!it) return s;
          const before = (it.annotations || []).length;
          const ns = patchItems(s, { [id]: { annotations: list, annotatedAt: Date.now(), annotatedBy: s.meId, annotatedVersion: it.version || 1 } });
          return log(ns, 'Markup saved', it.name, list.length ? `${list.length} mark${list.length === 1 ? '' : 's'}${before ? ` (was ${before})` : ''}` : 'All markup removed', { itemId: id, teamId: it.space?.startsWith('t') ? it.space : undefined });
        });
      },

      // ---- E-signature requests ----
      /** signers: [{ userId?, name, email }] in signing order; fields: [{ signerIndex, kind, page, x, y, w, h }]. */
      createSignRequest({ itemId, title, message = '', signers, fields, sequential = false, due = null }) {
        const id = uid('sr');
        const now = Date.now();
        update((s) => {
          const it = s.items[itemId];
          if (!it) return s;
          const list = signers.map((x, i) => ({
            id: uid('sg'), userId: x.userId || null, name: x.name.trim(), email: x.email.trim().toLowerCase(), order: i + 1, color: SIGNER_COLORS[i % SIGNER_COLORS.length],
            status: sequential && i > 0 ? 'waiting' : 'sent', sentAt: sequential && i > 0 ? null : now, viewedAt: null, signedAt: null, declinedAt: null, reason: '', device: '', ip: '',
          }));
          const r = {
            id, itemId, version: it.version || 1, title: title.trim() || `Please sign: ${it.name}`, message: message.trim(), createdBy: s.meId, createdAt: now, due, sequential,
            status: 'sent', completedAt: null, signedFileId: null,
            signers: list,
            fields: fields.map((f) => ({ id: uid('fd'), signerId: list[f.signerIndex].id, kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, value: null })),
            events: [{ at: now, kind: 'created', by: s.meId, detail: `${list.length} signer${list.length === 1 ? '' : 's'}${sequential ? ', in order' : ''}` }],
          };
          return log({ ...s, signRequests: [r, ...(s.signRequests || [])] }, 'Signature requested', it.name, `From ${list.map((x) => x.name).join(', ')}`, { itemId, teamId: it.space?.startsWith('t') ? it.space : undefined });
        });
        return id;
      },

      /** A signer opened the document (first time only). */
      markSignViewed(reqId, signerId, { device = '', ip = '' } = {}) {
        update((s) => {
          const r = (s.signRequests || []).find((x) => x.id === reqId);
          const sg = r?.signers.find((x) => x.id === signerId);
          if (!r || !sg || sg.status !== 'sent' || !['sent', 'viewed'].includes(r.status)) return s;
          const signers = r.signers.map((x) => (x.id === signerId ? { ...x, status: 'viewed', viewedAt: Date.now(), device, ip } : x));
          const nr = { ...r, signers, status: computeStatus(signers, r.status), events: [...r.events, { at: Date.now(), kind: 'viewed', signerId }] };
          let ns = { ...s, signRequests: s.signRequests.map((x) => (x.id === reqId ? nr : x)) };
          if (r.createdBy === s.meId && sg.userId !== s.meId) {
            ns = { ...ns, notifications: [{ id: uid('n'), type: 'signature', actorId: sg.userId, text: `${sg.userId ? '' : `${sg.name} `}viewed "${s.items[r.itemId]?.name}" for signing`, link: '/signatures?tab=sent', at: Date.now(), read: false }, ...ns.notifications] };
          }
          return log(ns, 'Signature request viewed', s.items[r.itemId]?.name || '', sg.name, { itemId: r.itemId, actorId: sg.userId });
        });
      },

      /** A signer completes their fields. values: { fieldId: value }. Returns the updated request. */
      completeSigner(reqId, signerId, values, { device = '', ip = '' } = {}) {
        const r = (get().signRequests || []).find((x) => x.id === reqId);
        const sg = r?.signers.find((x) => x.id === signerId);
        if (!r || !sg || !['sent', 'viewed'].includes(sg.status) || !['sent', 'viewed'].includes(r.status)) return null;
        if (r.due && r.due < Date.now()) return null; // expired
        const doc = get().items[r.itemId];
        if (!doc || isTrashedDeep(get().items, r.itemId)) return null;
        const now = Date.now();
        let signers = r.signers.map((x) => (x.id === signerId ? { ...x, status: 'signed', signedAt: now, viewedAt: x.viewedAt || now, device: device || x.device, ip: ip || x.ip } : x));
        const events = [...r.events, { at: now, kind: 'signed', signerId }];
        // Signing in order: hand over to the next person.
        if (r.sequential) {
          const next = [...signers].sort((a, b) => a.order - b.order).find((x) => x.status === 'waiting');
          if (next) { signers = signers.map((x) => (x.id === next.id ? { ...x, status: 'sent', sentAt: now } : x)); events.push({ at: now, kind: 'sent', signerId: next.id }); }
        }
        const status = computeStatus(signers, r.status);
        if (status === 'signed') events.push({ at: now, kind: 'completed' });
        const nr = {
          ...r, signers, status, events, completedAt: status === 'signed' ? now : null,
          fields: r.fields.map((f) => (f.signerId === signerId && values[f.id] !== undefined ? { ...f, value: values[f.id] } : f)),
        };
        update((s) => {
          const it = s.items[r.itemId];
          let ns = { ...s, signRequests: s.signRequests.map((x) => (x.id === reqId ? nr : x)) };
          const notes = [];
          if (r.createdBy === s.meId && sg.userId !== s.meId) notes.push(`${sg.userId ? '' : `${sg.name} `}signed "${it?.name}"`);
          if (status === 'signed' && r.createdBy === s.meId) notes.push(`Everyone has signed "${it?.name}". The signed copy is ready.`);
          const nextUp = r.sequential && signers.find((x) => x.status === 'sent' && x.userId === s.meId && x.id !== signerId);
          if (nextUp) notes.push(`It's your turn to sign "${it?.name}"`);
          if (notes.length) ns = { ...ns, notifications: [...notes.map((text, i) => ({ id: uid('n'), type: 'signature', actorId: i === 0 && !text.startsWith('Everyone') && !text.startsWith("It's") ? sg.userId : null, text, link: '/signatures', at: now, read: false })), ...ns.notifications] };
          const teamId = it?.space?.startsWith('t') ? it.space : undefined;
          ns = log(ns, 'Document signed', it?.name || '', sg.name, { itemId: r.itemId, teamId, actorId: sg.userId });
          return status === 'signed' ? log(ns, 'Signature request completed', it?.name || '', `${signers.length} signer${signers.length === 1 ? '' : 's'}`, { itemId: r.itemId, teamId }) : ns;
        });
        return nr;
      },

      declineSigner(reqId, signerId, reason) {
        update((s) => {
          const r = (s.signRequests || []).find((x) => x.id === reqId);
          const sg = r?.signers.find((x) => x.id === signerId);
          if (!r || !sg || !['sent', 'viewed'].includes(r.status) || !['sent', 'viewed'].includes(sg.status)) return s;
          if (r.due && r.due < Date.now()) return s;
          const now = Date.now();
          const signers = r.signers.map((x) => (x.id === signerId ? { ...x, status: 'declined', declinedAt: now, reason: reason.trim(), viewedAt: x.viewedAt || now } : x));
          const nr = { ...r, signers, status: 'declined', events: [...r.events, { at: now, kind: 'declined', signerId, detail: reason.trim() }] };
          let ns = { ...s, signRequests: s.signRequests.map((x) => (x.id === reqId ? nr : x)) };
          if (r.createdBy === s.meId && sg.userId !== s.meId) {
            ns = { ...ns, notifications: [{ id: uid('n'), type: 'signature', actorId: sg.userId, text: `${sg.userId ? '' : `${sg.name} `}declined to sign "${s.items[r.itemId]?.name}": "${reason.trim()}"`, link: '/signatures?tab=closed', at: now, read: false }, ...ns.notifications] };
          }
          return log(ns, 'Signature declined', s.items[r.itemId]?.name || '', `${sg.name}: “${reason.trim()}”`, { itemId: r.itemId, actorId: sg.userId });
        });
      },

      cancelSignRequest(reqId, reason = '') {
        update((s) => {
          const r = (s.signRequests || []).find((x) => x.id === reqId);
          if (!r || !['sent', 'viewed'].includes(r.status)) return s;
          const nr = { ...r, status: 'cancelled', events: [...r.events, { at: Date.now(), kind: 'cancelled', by: s.meId, detail: reason.trim() }] };
          return log({ ...s, signRequests: s.signRequests.map((x) => (x.id === reqId ? nr : x)) }, 'Signature request cancelled', s.items[r.itemId]?.name || '', reason.trim(), { itemId: r.itemId });
        });
      },

      remindSigners(reqId) {
        update((s) => {
          const r = (s.signRequests || []).find((x) => x.id === reqId);
          if (!r || !['sent', 'viewed'].includes(r.status) || (r.due && r.due < Date.now())) return s;
          const who = r.signers.filter((x) => x.status === 'sent' || x.status === 'viewed');
          const nr = { ...r, events: [...r.events, { at: Date.now(), kind: 'reminded', by: s.meId, detail: who.map((x) => x.name).join(', ') }] };
          return log({ ...s, signRequests: s.signRequests.map((x) => (x.id === reqId ? nr : x)) }, 'Signature reminder sent', s.items[r.itemId]?.name || '', who.map((x) => x.name).join(', '), { itemId: r.itemId });
        });
      },

      attachSignedCopy(reqId, fileId) {
        update((s) => ({ ...s, signRequests: (s.signRequests || []).map((x) => (x.id === reqId ? { ...x, signedFileId: fileId } : x)) }));
      },

      // ---- Activity feed ----
      markActivitySeen() {
        update((s) => ({ ...s, settings: { ...s.settings, activitySeenAt: Date.now() } }));
      },

      // ---- Teams ----
      createTeam({ name, description, members, color }) {
        const id = uid('t');
        update((s) => {
          const team = { id, name, description, color: color || '#1686D9', ownerId: s.meId, createdAt: Date.now(), quota: 50 * 1024 ** 3,
            members: [{ userId: s.meId, role: 'Admin' }, ...members.filter((m) => m.userId !== s.meId)] };
          return log({ ...s, teams: [...s.teams, team] }, 'Team folder created', name, `${team.members.length} members`, { teamId: id });
        });
        return id;
      },
      updateTeam(id, patch) {
        update((s) => {
          const t = s.teams.find((x) => x.id === id);
          let ns = { ...s, teams: s.teams.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
          if (patch.name && patch.name !== t.name) ns = log(ns, 'Team folder renamed', patch.name, `from "${t.name}"`, { teamId: id });
          return ns;
        });
      },
      /** Returns { deleted: true } or { deleted: false, held: n } when a legal hold covers files in the team folder. */
      deleteTeam(id) {
        const snap = get();
        const inTeam = Object.values(snap.items).filter((v) => v.space === id);
        const held = inTeam.filter((v) => holdOn(snap, v.id)).length + (activeHolds(snap).some((h) => h.spaces?.includes(id)) ? 1 : 0);
        if (held) return { deleted: false, held };
        for (const v of inTeam) { unregisterBlob(v.id); (v.versions || []).forEach((x) => unregisterBlob(versionKey(v.id, x.no))); }
        update((s) => {
          const items = Object.fromEntries(Object.entries(s.items).filter(([, v]) => v.space !== id));
          const t = s.teams.find((x) => x.id === id);
          const ns = cancelRequestsFor({ ...s, items, teams: s.teams.filter((x) => x.id !== id) }, inTeam.map((v) => v.id), 'The team folder was deleted');
          return log(ns, 'Team folder deleted', t?.name || id);
        });
        return { deleted: true };
      },
      addTeamMembers(id, members) {
        update((s) => {
          const t = s.teams.find((x) => x.id === id);
          const fresh = members.filter((m) => !t.members.find((x) => x.userId === m.userId));
          const ns = { ...s, teams: s.teams.map((x) => (x.id === id ? { ...x, members: [...x.members, ...fresh] } : x)) };
          return log(ns, 'Member added', t.name, fresh.map((m) => `${s.users.find((u) => u.id === m.userId)?.name} as ${m.role}`).join(', '), { teamId: id });
        });
      },
      removeTeamMember(id, userId) {
        update((s) => {
          const t = s.teams.find((x) => x.id === id);
          const ns = { ...s, teams: s.teams.map((x) => (x.id === id ? { ...x, members: x.members.filter((m) => m.userId !== userId) } : x)) };
          return log(ns, 'Member removed', t.name, s.users.find((u) => u.id === userId)?.name, { teamId: id });
        });
      },
      setTeamMemberRole(id, userId, role) {
        update((s) => {
          const t = s.teams.find((x) => x.id === id);
          const ns = { ...s, teams: s.teams.map((x) => (x.id === id ? { ...x, members: x.members.map((m) => (m.userId === userId ? { ...m, role } : m)) } : x)) };
          return log(ns, 'Permission changed', t.name, `${s.users.find((u) => u.id === userId)?.name} → ${role}`, { teamId: id });
        });
      },

      // ---- Users / org ----
      addUser(u) {
        const id = uid('u');
        const colors = ['#1686D9', '#D946EF', '#0EA5A4', '#EA7A1A', '#16A34A', '#6366F1', '#E5484D'];
        update((s) => log({ ...s, users: [...s.users, { id, status: 'invited', joined: Date.now(), color: colors[s.users.length % colors.length], title: '', dept: '', ...u }] }, 'User invited', u.name, `Role: ${u.role}`));
        return id;
      },
      updateUser(id, patch) {
        update((s) => {
          const ns = { ...s, users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) };
          return id === s.meId ? ns : log(ns, 'User updated', s.users.find((u) => u.id === id)?.name, Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join(', '));
        });
      },
      removeUser(id) {
        update((s) => log({
          ...s,
          users: s.users.filter((u) => u.id !== id),
          teams: s.teams.map((t) => ({ ...t, members: t.members.filter((m) => m.userId !== id) })),
        }, 'User removed', s.users.find((u) => u.id === id)?.name));
      },
      /**
       * Offboard a departing user: hand their files, work and responsibilities to `newOwnerId`,
       * take away their access, and deactivate (or delete) the account. Returns what was done.
       */
      offboardUser(userId, opts = {}) {
        const o = { ...DEFAULT_OFFBOARD, ...opts };
        const s0 = get();
        const leaver = s0.users.find((u) => u.id === userId);
        const to = o.newOwnerId;
        if (!leaver || userId === s0.meId || (o.transferFiles && !to) || to === userId) return null;
        const folderId = uid('d'); // decided outside the reducer (StrictMode runs it twice)
        const now = Date.now();
        const run = (s) => {
          const items = { ...s.items };
          const r = { files: 0, folders: 0, movedToMe: 0, shares: 0, locks: 0, tasks: 0, approvals: 0, requested: 0, fileRequests: 0, teams: 0, promoted: [], sessions: 0, folderId: null };
          const patch = (id, p) => { items[id] = { ...items[id], ...p }; };

          if (o.transferFiles) {
            const owned = Object.values(s.items).filter((i) => i.ownerId === userId);
            const ownedIds = new Set(owned.map((i) => i.id));
            // Their own space (not team folders, not inside someone else's folder): what becomes the new owner's.
            // Only their own top-level items: a file they put inside someone else's folder stays there (ownership still moves).
            const personalTop = owned.filter((i) => i.space === 'user' && !i.parentId);
            void ownedIds;
            for (const it of owned) {
              patch(it.id, { ownerId: to, sharedWith: (it.sharedWith || []).filter((x) => x.userId !== to) });
              if (it.type === 'folder') r.folders++; else r.files++;
            }
            if (to === s.meId && personalTop.length) {
              // Into My Folders, under one folder so nothing gets mixed in with mine.
              const folder = newItem(s, { id: folderId, name: `Transferred from ${leaver.name}`, type: 'folder', space: 'my' });
              items[folder.id] = folder;
              r.folderId = folder.id;
              for (const top of personalTop) {
                patch(top.id, { parentId: folder.id, space: 'my', name: uniqueName({ ...s, items }, top.name, folder.id, 'my', top.id) });
                for (const d of descendantIds(s.items, top.id)) patch(d, { space: 'my', ownerId: s.meId, sharedWith: (items[d].sharedWith || []).filter((x) => x.userId !== s.meId) });
                r.movedToMe++;
              }
            }
          }
          if (o.removeShares || o.account === 'delete') {
            for (const it of Object.values(items)) {
              if ((it.sharedWith || []).some((x) => x.userId === userId)) { patch(it.id, { sharedWith: it.sharedWith.filter((x) => x.userId !== userId) }); r.shares++; }
            }
          }
          if (o.releaseLocks) {
            for (const it of Object.values(items)) if (it.lock?.by === userId) { patch(it.id, { lock: null }); r.locks++; }
          }

          let tasks = s.tasks || [];
          if (o.reassignTasks && to) {
            tasks = tasks.map((t) => (t.assigneeId === userId && t.status === 'open' ? (r.tasks++, { ...t, assigneeId: to }) : t));
          }
          let approvals = s.approvals || [];
          if (o.replaceApprover && to) {
            approvals = approvals.map((a) => {
              if (a.status !== 'pending' || !a.approvers.some((p) => p.userId === userId && p.decision === 'pending')) return a;
              r.approvals++;
              const already = a.approvers.some((p) => p.userId === to) || a.requestedBy === to;
              const approvers = already ? a.approvers.filter((p) => p.userId !== userId) : a.approvers.map((p) => (p.userId === userId ? { ...p, userId: to } : p));
              return approvers.length ? { ...a, approvers } : { ...a, approvers, status: 'cancelled', decidedAt: now };
            });
          }
          if (o.handoverApprovals && to) {
            approvals = approvals.map((a) => {
              if (a.status !== 'pending' || a.requestedBy !== userId) return a;
              r.requested++;
              const approvers = a.approvers.filter((p) => p.userId !== to); // can't approve your own request
              return approvers.length ? { ...a, requestedBy: to, approvers } : { ...a, requestedBy: to, approvers: a.approvers, status: 'cancelled', decidedAt: now };
            });
          }
          let fileRequests = s.fileRequests || [];
          if (o.transferRequests && to) {
            fileRequests = fileRequests.map((fr) => (fr.createdBy === userId ? (r.fileRequests++, { ...fr, createdBy: to }) : fr));
          }

          let teams = s.teams;
          if (o.leaveTeams || o.account === 'delete') {
            teams = s.teams.map((t) => {
              const m = t.members.find((x) => x.userId === userId);
              if (!m) return t;
              r.teams++;
              let members = t.members.filter((x) => x.userId !== userId);
              // Never leave a team folder without an Admin.
              if (m.role === 'Admin' && !members.some((x) => x.role === 'Admin') && to) {
                members = members.some((x) => x.userId === to) ? members.map((x) => (x.userId === to ? { ...x, role: 'Admin' } : x)) : [...members, { userId: to, role: 'Admin' }];
                r.promoted.push(t.name);
              }
              return { ...t, members };
            });
          }

          const leaving = o.account !== 'keep';
          const sessions = (s.sessions || []).map((x) => (leaving && x.userId === userId && !x.endedAt ? (r.sessions++, { ...x, endedAt: now, endedBy: s.meId }) : x));
          const users = o.account === 'delete'
            ? s.users.filter((u) => u.id !== userId)
            : s.users.map((u) => (u.id === userId && leaving ? { ...u, status: 'disabled', offboardedAt: now, offboardedTo: to || null } : u));

          const toName = s.users.find((u) => u.id === to)?.name;
          const parts = [
            to && `to ${toName}`,
            (r.files || r.folders) && `${r.files} file(s), ${r.folders} folder(s)`,
            r.tasks && `${r.tasks} task(s)`, r.approvals && `${r.approvals} approval(s) to review`, r.requested && `${r.requested} approval request(s)`,
            r.fileRequests && `${r.fileRequests} file request(s)`, r.locks && `${r.locks} lock(s) released`, r.shares && `${r.shares} share(s) removed`,
            r.teams && `left ${r.teams} team folder(s)`, r.promoted.length && `${toName} now Admin of ${r.promoted.join(', ')}`,
            r.sessions && `${r.sessions} session(s) signed out`, o.account === 'delete' ? 'account deleted' : o.account === 'deactivate' ? 'account deactivated' : 'account kept active',
          ].filter(Boolean);
          return { r, ns: log({ ...s, items, tasks, approvals, fileRequests, teams, sessions, users }, 'User offboarded', leaver.name, parts.join(' · ')) };
        };
        const { r } = run(s0); // what will happen, for the caller
        update((s) => run(s).ns);
        return r;
      },
      updateOrg(patch) {
        update((s) => log({ ...s, org: { ...s.org, ...patch, policies: { ...s.org.policies, ...(patch.policies || {}) } } }, 'Organization settings updated', s.org.name, Object.keys(patch.policies || patch).join(', ')));
      },

      // ---- Notifications ----
      markNotification(id, read = true) {
        update((s) => ({ ...s, notifications: s.notifications.map((n) => (n.id === id ? { ...n, read } : n)) }));
      },
      markAllNotificationsRead() {
        update((s) => ({ ...s, notifications: s.notifications.map((n) => ({ ...n, read: true })) }));
      },
      clearNotifications() {
        update((s) => ({ ...s, notifications: [] }));
      },
      pushNotification(n) {
        update((s) => ({ ...s, notifications: [{ id: uid('n'), at: Date.now(), read: false, actorId: null, ...n }, ...s.notifications] }));
      },

      // ---- Settings / misc ----
      updateSettings(patch) {
        update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
      },
      addRecentSearch(q) {
        const v = q.trim();
        if (!v) return;
        update((s) => ({ ...s, recentSearches: [v, ...s.recentSearches.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 8) }));
      },
      removeRecentSearch(q) {
        update((s) => ({ ...s, recentSearches: s.recentSearches.filter((x) => x !== q) }));
      },
      clearRecentSearches() {
        update((s) => ({ ...s, recentSearches: [] }));
      },
      logEvent(action, target, details, extra) {
        update((s) => log(s, action, target, details, extra));
      },
      setSignedOut(v) {
        update((s) => ({ ...s, signedOut: v }));
      },
      signIn({ remember = true } = {}) {
        try { sessionStorage.setItem(SESSION_KEY, '1'); sessionStorage.removeItem(SIGNOUT_REASON_KEY); } catch { /* storage unavailable */ }
        const ss = newSession(get().meId); // decided outside the reducer (it may run twice in development)
        rememberSessionId(ss.id, remember);
        update((s) => log({ ...s, signedOut: false, remember, sessions: [ss, ...(s.sessions || [])] }, 'Signed in', s.users.find((u) => u.id === s.meId)?.email, `${ss.device} · ${remember ? 'Kept signed in' : 'This session only'}`));
      },
      /** reason: '' (user clicked Sign out) | 'idle' | 'revoked' — shown on the sign-in page. */
      signOut(reason = '') {
        const sid = currentSessionId();
        try { sessionStorage.removeItem(SESSION_KEY); if (reason) sessionStorage.setItem(SIGNOUT_REASON_KEY, reason); } catch { /* storage unavailable */ }
        rememberSessionId(null);
        update((s) => log({
          ...s,
          signedOut: true,
          sessions: (s.sessions || []).map((x) => (x.id === sid && !x.endedAt ? { ...x, endedAt: Date.now(), endedBy: s.meId } : x)),
        }, 'Signed out', s.users.find((u) => u.id === s.meId)?.email, reason === 'idle' ? 'Session timed out (inactive)' : reason === 'revoked' ? 'Session was ended from another device' : ''));
      },
      ancestorsOf(id) {
        return ancestors(get().items, id);
      },
    };
    return o;
  }, [update]);

  // Trash retention runs on start-up and every 30 minutes while the app is open.
  useEffect(() => {
    const run = () => { if (!stateRef.current.signedOut) api.runRetention(); };
    const first = setTimeout(run, 1500);
    const every = setInterval(run, 30 * 60 * 1000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [api]);

  // Keep this browser's session record in step: create it if missing; sign out if it was ended elsewhere.
  const mySession = !state.signedOut ? (state.sessions || []).find((x) => x.id === currentSessionId()) : null;
  const revokedRef = useRef(null);
  useEffect(() => {
    if (state.signedOut) return;
    if (!mySession) api.ensureCurrentSession();
    else if (mySession.endedAt && revokedRef.current !== mySession.id) { revokedRef.current = mySession.id; api.signOut('revoked'); }
  }, [state.signedOut, mySession, api]);

  const shownError = persistError || blobError;
  const value = useMemo(() => ({ state, api, persistError: shownError, blobsVersion }), [state, api, shownError, blobsVersion]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useDrive() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useDrive must be used inside DriveStoreProvider');
  return ctx;
}

export const useMe = () => {
  const { state } = useDrive();
  return state.users.find((u) => u.id === state.meId);
};
