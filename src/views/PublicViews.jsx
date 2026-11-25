import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import {
  Link2Off, Clock, KeyRound, LogIn, ShieldAlert, Download, ExternalLink, Eye, ChevronRight, Folder, UploadCloud, X,
  CheckCircle2, Inbox, Lock, FileUp, ArrowLeft, Mail, MessageSquareText, Loader2, AlertTriangle,
} from 'lucide-react';
import { brandingOf, brandVars, fillMessage, DEFAULT_LOGO } from '../sharing/branding';
import { useDrive, useMe, registerBlob } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { readUploadExtras, MAX_FILE_SIZE } from '../store/UploadContext';
import { fileBlob } from '../store/useItemActions';
import { accessOf, canEdit, quotaError, isTrashedDeep, folderRoute, parentRoute } from '../store/selectors';
import { getFileType } from '../utils/fileTypes';
import { formatSize, formatDate, formatDateTime, splitName } from '../utils/format';
import { saveBlob } from '../utils/exporters';
import { linkStatus, requestStatus, deviceLabel, sessionIp } from '../utils/sharing';
import { verifySecret, hasSecret, storedSecret } from '../data/storage/secrets';
import { checkShare, scanPending } from '../dlp/dlp';
import { isGuest } from '../sharing/guests';
import { useSearchIndex, indexStatus } from '../search/searchIndex';
import { FileIcon, Toasts, ProgressBar } from '../components/common';
import { ImageViewer, PdfViewer, TextViewer, DocViewer, SheetViewer, SlidesViewer, VideoViewer, AudioViewer, ArchiveViewer, NoPreview } from '../components/preview/Viewers';

/* ------------------------------------------------------------------ */
/* Shared chrome                                                       */
/* ------------------------------------------------------------------ */
/** Is the app currently showing the dark theme? (public pages follow the visitor's theme) */
const isDark = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';

/** Follows theme changes (data-theme on <html>) so branded colours re-render when the visitor switches theme. */
export function useIsDark() {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const el = document.documentElement;
    const mo = new MutationObserver(() => setDark(isDark()));
    mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    setDark(isDark());
    return () => mo.disconnect();
  }, []);
  return dark;
}

/**
 * Page chrome for everything outsiders see. Uses the organization's branding (logo, colours, name, footer)
 * when an admin has set it up; `brand` overrides the saved branding (used by the admin live preview).
 */
export function PublicShell({ children, wide, right, brand, preview = false }) {
  const { state } = useDrive();
  const b = brand || brandingOf(state);
  const on = b.enabled;
  const name = (on && b.displayName?.trim()) || state.org.name;
  const logo = (on && b.logo) || DEFAULT_LOGO;
  const dark = useIsDark();
  return (
    <div className={`public-page ${on ? 'branded' : ''}`} style={brandVars(b, dark)}>
      <header className="public-bar">
        <img className={`brand-logo ${on && b.logo ? 'custom' : ''}`} src={logo} alt={on && b.logo ? `${name} logo` : ''} />
        {!(on && b.logo && b.hideName) && <span className="public-org" title={name}>{name}{(!on || b.poweredBy) && <span className="public-product"> · WorkDrive</span>}</span>}
        <span className="grow" />
        {right}
      </header>
      <main className={`public-main ${wide ? 'wide' : ''}`}>{children}</main>
      <footer className="public-foot muted small">
        {on && b.footerText?.trim() ? <span>{b.footerText.trim()}</span> : <span>Shared securely with {state.org.name} WorkDrive</span>}
        {on && b.supportEmail?.trim() && <span> · <a href={`mailto:${b.supportEmail.trim()}`}><Mail size={12} /> {b.supportEmail.trim()}</a></span>}
        {on && b.poweredBy && (b.footerText?.trim() || b.logo) && <span className="public-powered"> · Powered by WorkDrive</span>}
      </footer>
      {!preview && <Toasts />}
    </div>
  );
}

/** The organization's welcome message for a public page ('link' or 'request'). */
export function Welcome({ kind, sender, file, brand }) {
  const { state } = useDrive();
  const b = brand || brandingOf(state);
  const raw = kind === 'request' ? b.welcomeRequest : b.welcomeLink;
  if (!b.enabled || !raw?.trim()) return null;
  return (
    <div className="public-welcome">
      <MessageSquareText size={18} />
      <p>{fillMessage(raw.trim(), { sender: sender || 'Someone', org: (b.displayName?.trim()) || state.org.name, file })}</p>
    </div>
  );
}

function Gate({ icon: Icon, tone = '', title, text, children }) {
  return (
    <div className="gate-card">
      <span className={`gate-icon ${tone}`}><Icon size={26} /></span>
      <h1>{title}</h1>
      {text && <p className="muted">{text}</p>}
      {children}
    </div>
  );
}

/** onSubmit(pwd) may return a Promise (passwords are checked against a hash, asynchronously). */
export function PasswordGate({ onSubmit, error, what = 'file' }) {
  const [pwd, setPwd] = useState('');
  const [checking, setChecking] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!pwd || checking) return;
    setChecking(true);
    try { await onSubmit(pwd); } finally { setChecking(false); }
  };
  return (
    <Gate icon={KeyRound} title="Password required" text={`Enter the password the sender gave you to open this ${what}.`}>
      <form className="gate-form" onSubmit={submit}>
        <input className="input" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Password" aria-label="Password" autoFocus />
        {error && !checking && <span className="field-error" role="alert">{error}</span>}
        <button className="btn btn-primary btn-block" disabled={!pwd || checking}>{checking ? 'Checking…' : 'Continue'}</button>
      </form>
    </Gate>
  );
}

/** Repeating diagonal text drawn over a preview so screenshots carry the viewer's identity. */
export function Watermark({ text }) {
  const bg = useMemo(() => {
    const safe = text.replace(/[<>&"]/g, '');
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='340' height='200'><text x='20' y='120' transform='rotate(-24 170 100)' font-family='Poppins, Segoe UI, sans-serif' font-size='15' fill='rgba(120,120,120,0.26)'>${safe}</text></svg>`;
    return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
  }, [text]);
  return <div className="watermark" style={{ backgroundImage: bg }} aria-hidden="true" />;
}

/** Viewer for public link and embed pages: downloads only go through our own button, which applies the link's rules. */
export function viewerFor(item, onDownload) {
  switch (getFileType(item.ext).category) {
    case 'image': return <ImageViewer item={item} zoom={1} />;
    case 'pdf': return <PdfViewer item={item} zoom={1} contained />;
    case 'text': return <TextViewer item={item} editing={false} />;
    case 'document': return <DocViewer item={item} editing={false} zoom={1} />;
    case 'spreadsheet': return <SheetViewer item={item} editing={false} />;
    case 'presentation': return <SlidesViewer item={item} editing={false} />;
    case 'video': return <VideoViewer item={item} contained />;
    case 'audio': return <AudioViewer item={item} />;
    case 'archive': return <ArchiveViewer item={item} />;
    default: return <NoPreview item={item} onDownload={onDownload} />;
  }
}

/* ------------------------------------------------------------------ */
/* /link/:id — what a recipient sees when opening a shared link        */
/* ------------------------------------------------------------------ */
export function PublicLinkView() {
  const { id } = useParams();
  const loc = useLocation();
  const { state, api } = useDrive();
  const ui = useUI();
  const signedIn = useMe();
  useSearchIndex(); // the DLP check reads indexed text; re-render once it has loaded
  const indexReady = indexStatus().loaded;
  // ?as=guest lets the owner preview exactly what an anonymous outsider sees.
  const params = new URLSearchParams(loc.search);
  const asGuest = params.get('as') === 'guest';
  const via = params.get('src') === 'qr' ? 'qr' : null; // links printed as QR codes carry ?src=qr
  const me = !state.signedOut && !asGuest ? signedIn : null;
  const item = state.items[id];
  const alive = item && !isTrashedDeep(state.items, id);
  // Someone who can already open the item, previewing as a visitor: record nothing and don't use up downloads.
  // Anyone else adding ?as=guest is just a visitor (otherwise it would hide downloads and password guesses).
  const previewOnly = asGuest && !!signedIn && !state.signedOut && !!alive && accessOf(state, item) !== 'none';
  const status = alive ? linkStatus(state, item) : { ok: false, reason: 'off' };
  const myAccess = me && alive ? accessOf(state, item) : 'none';
  const hasAccess = myAccess !== 'none';
  const [unlocked, setUnlocked] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [path, setPath] = useState([]); // folder ids below the shared folder
  const [openId, setOpenId] = useState(null); // file being viewed inside a shared folder

  const visitor = useMemo(() => ({ who: me ? { name: me.name, email: me.email } : null, device: deviceLabel(), ip: sessionIp() }), [me]);
  const logged = useRef({});
  const logOnce = (key, entry) => {
    if (previewOnly || logged.current[key]) return;
    logged.current[key] = true;
    api.logLinkAccess(id, { ...visitor, via, ...entry });
  };

  // Data loss prevention: under a "block" policy, outsiders can't open sensitive files through a public link.
  // The check reads the search index, which loads asynchronously, so it is "pending" until then.
  const dlpApplies = status.ok && status.link.access === 'anyone' && !hasAccess;
  const dlpPending = dlpApplies && (!indexReady || scanPending(state, item));
  const dlpBlocked = dlpApplies && indexReady && checkShare(state, item, 'public').decision === 'block';
  const needsSignIn = status.ok && status.link.access !== 'anyone' && !me;
  // "Anyone at {org}" links: a signed-in outsider or Guest-role account is not "at" the organization.
  const notInOrg = status.ok && status.link.access === 'org' && !!me && !hasAccess && isGuest({ ...state, meId: null }, me);
  const noPermission = status.ok && status.link.access === 'restricted' && me && !hasAccess;
  const needsPassword = status.ok && status.passwordProtected && !unlocked && !hasAccess;
  const canView = status.ok && !dlpPending && !dlpBlocked && !needsSignIn && !notInOrg && !noPermission && !needsPassword;

  useEffect(() => { if (alive && status.reason === 'expired') logOnce('expired', { event: 'blocked-expired' }); }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (dlpBlocked) logOnce('dlp', { event: 'blocked-dlp' }); }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (canView) logOnce('viewed', { event: 'viewed' }); }); // eslint-disable-line react-hooks/exhaustive-deps

  const tryPassword = async (pwd) => {
    let ok = false;
    try { ok = await verifySecret(pwd, storedSecret(status.link)); } catch { /* treated as wrong */ }
    if (ok) { setUnlocked(true); setPwdError(''); return; }
    if (!previewOnly) api.logLinkAccess(id, { ...visitor, via, event: 'password-failed' });
    setPwdError('That password is not correct.');
  };

  const download = async (file) => {
    const fresh = api.get();
    const st = linkStatus(fresh, fresh.items[id]); // fresh: the limit may have just been reached
    if (!st.ok || !st.canDownload) {
      if (st.limitReached) {
        if (!previewOnly) api.logLinkAccess(id, { ...visitor, via, event: 'blocked-limit', file: file.name });
        ui.toast('The download limit for this link has been reached', { type: 'error' });
      }
      return;
    }
    // Re-check data protection at the moment of download.
    if (st.link.access === 'anyone' && !hasAccess) {
      if (!indexStatus().loaded || scanPending(fresh, fresh.items[id])) { ui.toast('Still checking this file. Try again in a moment.', { type: 'info' }); return; }
      if (checkShare(fresh, fresh.items[id], 'public').decision === 'block') { ui.toast('This file can’t be downloaded: it contains sensitive information.', { type: 'error' }); return; }
    }
    let blob;
    try {
      blob = (await fileBlob(file)) || new Blob([`${file.name}\n\nSample file in the prototype.`], { type: 'text/plain' });
    } catch {
      ui.toast('This file’s contents aren’t available right now.', { type: 'error' });
      return;
    }
    saveBlob(blob, blob.type === 'text/plain' && !file.name.endsWith('.txt') && getFileType(file.ext).category !== 'text' ? `${file.name}.txt` : file.name);
    if (!previewOnly) api.logLinkAccess(id, { ...visitor, via, event: 'downloaded', file: file.name });
    ui.toast(previewOnly ? `Downloading "${file.name}" (preview: not counted)` : `Downloading "${file.name}"`, { type: 'success' });
  };

  const owner = alive ? state.users.find((u) => u.id === item.ownerId) : null;
  const right = signedIn && !state.signedOut ? (
    <span className="public-who muted small" title={asGuest ? undefined : `Signed in as ${signedIn.name}`}>
      {asGuest ? <><span className="public-who-long">Previewing as an outside visitor</span><span className="public-who-short">Visitor preview</span></>
        : <><span className="public-who-long">Signed in as </span><span className="public-who-name">{signedIn.name}</span></>}
    </span>
  ) : <Link className="btn btn-secondary btn-sm" to={`/login?next=${encodeURIComponent(loc.pathname)}`}><LogIn size={14} /> Sign in</Link>;

  if (!alive || status.reason === 'off') {
    return <PublicShell right={right}><Gate icon={Link2Off} title="This link is no longer available" text="The item may have been deleted, or the owner turned off link sharing." /></PublicShell>;
  }
  if (status.reason === 'public-off') {
    return <PublicShell right={right}><Gate icon={Lock} title="Public links are turned off by the organization" text={`${state.org.name} no longer allows “Anyone with the link” sharing. Ask ${owner?.name || 'the owner'} to share it with you directly.`} /></PublicShell>;
  }
  if (status.reason === 'needs-password') {
    return <PublicShell right={right}><Gate icon={KeyRound} title="This link isn’t ready yet" text={`${owner?.name || 'The owner'} still needs to finish setting it up. Try again later.`} /></PublicShell>;
  }
  if (dlpPending) {
    return <PublicShell right={right}><Gate icon={Loader2} title="Checking…" text="Getting this link ready." /></PublicShell>;
  }
  if (status.reason === 'expired') {
    return <PublicShell right={right}><Gate icon={Clock} title="This link has expired" text={`It stopped working on ${formatDate(status.link.expires)}. Ask ${owner?.name || 'the owner'} for a new link.`} /></PublicShell>;
  }
  if (dlpBlocked) {
    return <PublicShell right={right}><Gate icon={ShieldAlert} tone="warn" title="This file can't be shared publicly" text={`${state.org.name}'s data protection policy blocks public access to files that contain sensitive information. Ask ${owner?.name || 'the owner'} to share it with you directly.`} /></PublicShell>;
  }
  if (needsSignIn) {
    return (
      <PublicShell right={right}>
        <Gate icon={LogIn} title={`Sign in to ${state.org.name}`} text={status.link.access === 'org' ? `This link only works for people at ${state.org.name}.` : 'This link only works for people it was shared with.'}>
          <Link className="btn btn-primary" to={`/login?next=${encodeURIComponent(`/link/${id}`)}`}>Sign in</Link>
        </Gate>
      </PublicShell>
    );
  }
  if (notInOrg) {
    return <PublicShell right={right}><Gate icon={ShieldAlert} title="You need permission" text={`This link only works for people at ${state.org.name}. Ask ${owner?.name || 'the owner'} to share it with ${me.email} directly.`} /></PublicShell>;
  }
  if (noPermission) {
    return <PublicShell right={right}><Gate icon={ShieldAlert} title="You need permission" text={`${owner?.name || 'The owner'} hasn't shared this ${item.type} with ${me.email}.`} /></PublicShell>;
  }
  if (needsPassword) {
    return <PublicShell right={right}><PasswordGate onSubmit={tryPassword} error={pwdError} what={item.type} /></PublicShell>;
  }

  // ---- viewing ----
  const isFolder = item.type === 'folder';
  const folderId = path.length ? path[path.length - 1] : item.id;
  const children = isFolder
    ? Object.values(state.items).filter((c) => c.parentId === folderId && !c.trashed).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1))
    : [];
  const viewing = isFolder ? (openId ? state.items[openId] : null) : item;
  const wm = status.watermark ? `${me ? me.email : `Shared link · ${visitor.ip}`} · ${new Date().toLocaleDateString()}` : null;
  const protect = !status.canDownload ? { onContextMenu: (e) => e.preventDefault(), onCopy: (e) => e.preventDefault() } : {};

  const downloadInfo = status.link.allowDownload === false ? 'View only' : status.limitReached ? 'Download limit reached' : status.remaining != null ? `${status.remaining} download${status.remaining === 1 ? '' : 's'} left` : null;

  return (
    <PublicShell wide right={right}>
      {!hasAccess && <Welcome kind="link" sender={owner?.name} file={item.name} />}
      <div className="public-head">
        {viewing && isFolder ? (
          <button className="icon-btn" onClick={() => setOpenId(null)} aria-label="Back to folder"><ArrowLeft size={18} /></button>
        ) : <FileIcon item={item} size={34} />}
        <div className="min0 grow">
          <h1 className="truncate">{viewing ? viewing.name : item.name}</h1>
          <div className="muted small truncate">
            Shared by {owner?.name || 'someone'}{viewing && !isFolder ? ` · ${formatSize(item.size)} · Updated ${formatDate(item.modifiedAt)}` : ''}
          </div>
        </div>
        {downloadInfo && <span className={`pill ${status.canDownload ? 'pill-gray' : 'pill-amber'}`}>{status.canDownload ? <Download size={12} /> : <Eye size={12} />} {downloadInfo}</span>}
        {viewing && status.canDownload && <button className="btn btn-primary" onClick={() => download(viewing)}><Download size={15} /> Download</button>}
        {hasAccess && <Link className="btn btn-secondary" to={isFolder ? folderRoute(item) : `${parentRoute(state, item)}?preview=${item.id}`}><ExternalLink size={15} /> Open in WorkDrive</Link>}
      </div>

      {isFolder && !viewing && (
        <div className="public-folder">
          <nav className="breadcrumbs" aria-label="Folder path">
            <button className="crumb" onClick={() => setPath([])}>{item.name}</button>
            {path.map((pid, i) => (
              <span key={pid} className="crumb-wrap"><ChevronRight size={14} className="crumb-sep" /><button className="crumb" onClick={() => setPath(path.slice(0, i + 1))}>{state.items[pid]?.name}</button></span>
            ))}
          </nav>
          <ul className="public-list">
            {children.map((c) => (
              <li key={c.id}>
                <button className="public-row" onClick={() => (c.type === 'folder' ? setPath([...path, c.id]) : setOpenId(c.id))}>
                  {c.type === 'folder' ? <Folder size={22} className="muted" /> : <FileIcon item={c} size={24} />}
                  <span className="grow truncate">{c.name}</span>
                  <span className="muted small">{c.type === 'folder' ? 'Folder' : formatSize(c.size)}</span>
                </button>
                {c.type === 'file' && status.canDownload && <button className="icon-btn" onClick={() => download(c)} aria-label={`Download ${c.name}`} data-tip="Download"><Download size={16} /></button>}
              </li>
            ))}
            {!children.length && <li className="muted pad">This folder is empty.</li>}
          </ul>
        </div>
      )}

      {viewing && (
        <div className={`public-stage ${!status.canDownload ? 'no-copy' : ''}`} {...protect}>
          {viewerFor(viewing, status.canDownload ? () => download(viewing) : undefined)}
          {wm && <Watermark text={wm} />}
        </div>
      )}
      {wm && <p className="muted small center-text"><Lock size={12} /> This file is watermarked with {me ? 'your email address' : 'your connection details'}.</p>}
    </PublicShell>
  );
}

/* ------------------------------------------------------------------ */
/* /request/:id — upload-only page for a file request                  */
/* ------------------------------------------------------------------ */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function FileRequestView() {
  const { id } = useParams();
  const { state, api } = useDrive();
  const ui = useUI();
  const req = (state.fileRequests || []).find((r) => r.id === id);
  const folder = req ? state.items[req.folderId] : null;
  // Closed too when the admin has turned off file requests for the organization.
  const st = req && folder && !isTrashedDeep(state.items, folder.id) ? requestStatus(req, Date.now(), state) : 'missing';
  const requester = req ? state.users.find((u) => u.id === req.createdBy) : null;
  const [unlocked, setUnlocked] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [files, setFiles] = useState([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0); // progress 0..100 while sending
  const [done, setDone] = useState(null); // names sent
  const [touched, setTouched] = useState(false);
  const [failed, setFailed] = useState([]); // names that couldn't be sent in the last attempt
  const inputRef = useRef(null);

  if (st === 'missing' || st === 'closed') {
    return <PublicShell><Gate icon={Inbox} title="This request is closed" text="The person who asked for files is no longer accepting uploads." /></PublicShell>;
  }
  if (st === 'expired') {
    return <PublicShell><Gate icon={Clock} title="This request has expired" text={`Uploads closed on ${formatDate(req.expires)}. Contact ${requester?.name || 'the requester'} if you still need to send files.`} /></PublicShell>;
  }
  if (hasSecret(req) && !unlocked) {
    const check = async (p) => {
      let ok = false;
      try { ok = await verifySecret(p, storedSecret(req)); } catch { /* treated as wrong */ }
      if (ok) { setUnlocked(true); setPwdError(''); } else setPwdError('That password is not correct.');
    };
    return <PublicShell><PasswordGate what="upload page" error={pwdError} onSubmit={check} /></PublicShell>;
  }

  const add = (list) => {
    const incoming = [...list].filter((f) => f.size > 0 || splitName(f.name)[1]);
    const tooBig = incoming.filter((f) => f.size > MAX_FILE_SIZE);
    setFiles((cur) => [...cur, ...incoming.filter((f) => f.size <= MAX_FILE_SIZE && !cur.some((c) => c.name === f.name && c.size === f.size))]);
    if (tooBig.length) ui.toast(`${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} larger than ${formatSize(MAX_FILE_SIZE)}`, { type: 'error' });
  };

  const idErr = req.requireIdentity && (!name.trim() ? 'Enter your name' : !EMAIL.test(email.trim()) ? 'Enter a valid email address' : null);
  const send = async () => {
    setTouched(true);
    if (idErr || !files.length) return;
    // The request may have been closed (or file requests turned off) since the page opened.
    const fresh = api.get();
    const freshReq = (fresh.fileRequests || []).find((r) => r.id === id);
    if (!freshReq || requestStatus(freshReq, Date.now(), fresh) !== 'active') { ui.toast('This request is no longer accepting uploads.', { type: 'error' }); return; }
    // Uploads land with the requester's rights: they must still be able to add files to the folder,
    // and the folder's storage (their My Folders or the team folder) must have room.
    const asRequester = { ...fresh, meId: freshReq.createdBy };
    const target = fresh.items[folder.id];
    if (!target || isTrashedDeep(fresh.items, folder.id) || !canEdit(accessOf(asRequester, target))) { ui.toast('This request is no longer accepting uploads.', { type: 'error' }); return; }
    if (quotaError(asRequester, target.space, files.reduce((n, f) => n + f.size, 0))) { ui.toast('There isn’t enough storage space for these files. Contact the requester.', { type: 'error' }); return; }
    setBusy(5);
    setFailed([]);
    const ids = [];
    const names = [];
    const sent = [];
    const bad = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        try {
          const extras = await readUploadExtras(f);
          const created = api.createFile({
            name: f.name, size: f.size, mime: f.type, parentId: folder.id, space: folder.space, silent: true,
            uploadedBy: { name: name.trim() || 'Anonymous', email: email.trim(), requestId: req.id }, ...extras,
          });
          if (!created?.id) throw new Error('not created');
          registerBlob(created.id, f);
          ids.push(created.id);
          names.push(created.name);
          sent.push(f);
        } catch {
          bad.push(f);
        }
        setBusy(Math.max(5, Math.round(((i + 1) / files.length) * 100)));
        await new Promise((r) => setTimeout(r, 180)); // visible progress
      }
      if (ids.length) api.recordRequestUpload(req.id, { name: name.trim(), email: email.trim(), fileIds: ids, fileNames: names });
    } catch {
      // Anything not recorded as sent counts as failed.
      for (const f of files) if (!sent.includes(f) && !bad.includes(f)) bad.push(f);
    } finally {
      setBusy(0);
    }
    if (bad.length) {
      setFiles(bad);
      setFailed(bad.map((f) => f.name));
      ui.toast(`${bad.length} file${bad.length === 1 ? '' : 's'} couldn’t be uploaded. Try again.`, { type: 'error' });
      if (!ids.length) return;
    } else setFiles([]);
    setDone(names);
  };

  if (done) {
    return (
      <PublicShell>
        <Gate icon={CheckCircle2} tone="ok" title={`${done.length} file${done.length === 1 ? '' : 's'} sent`} text={`${requester?.name || 'The requester'} has been notified. You can close this page.`}>
          <ul className="sent-list">{done.map((n) => <li key={n}><CheckCircle2 size={14} /> {n}</li>)}</ul>
          {failed.length > 0 && <p className="field-error"><AlertTriangle size={13} /> Not sent: {failed.join(', ')}</p>}
          <button className="btn btn-secondary" onClick={() => setDone(null)}><FileUp size={15} /> {failed.length ? 'Retry the files that failed' : 'Send more files'}</button>
        </Gate>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <div className="request-card">
        <span className="gate-icon"><Inbox size={26} /></span>
        <h1>{req.title}</h1>
        <p className="muted">{requester?.name || 'Someone'} from {state.org.name} is requesting files.{req.expires ? ` Open until ${formatDateTime(req.expires)}.` : ''}</p>
        <Welcome kind="request" sender={requester?.name} file={folder?.name} />
        {req.message && <blockquote className="request-msg">{req.message}</blockquote>}

        {req.requireIdentity && (
          <div className="form-grid">
            <label className="field"><span className="field-label">Your name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
            <label className="field"><span className="field-label">Your email</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
          </div>
        )}

        <div
          className={`request-drop ${over ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        >
          <UploadCloud size={30} />
          <strong>Drop files here or click to choose</strong>
          <span className="muted small">Up to {formatSize(MAX_FILE_SIZE)} per file. You won't see what others have uploaded.</span>
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} aria-label="Choose files" />
        </div>

        {files.length > 0 && (
          <ul className="request-files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <FileIcon item={{ type: 'file', ext: splitName(f.name)[1], name: f.name }} size={22} />
                <span className="grow truncate">{f.name}</span>
                <span className="muted small">{formatSize(f.size)}</span>
                {failed.includes(f.name) && <span className="pill pill-red">Failed</span>}
                {!busy && <button className="icon-btn sm" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} data-tip="Remove"><X size={15} /></button>}
              </li>
            ))}
          </ul>
        )}

        {touched && (idErr || !files.length) && <span className="field-error">{idErr || 'Choose at least one file'}</span>}
        {busy > 0 ? (
          <div className="request-progress"><ProgressBar value={busy} /><span className="muted small">Uploading… {busy}%</span></div>
        ) : (
          <button className="btn btn-primary btn-block" onClick={send}><UploadCloud size={16} /> Upload {files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : ''}</button>
        )}
      </div>
    </PublicShell>
  );
}
