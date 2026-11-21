import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Download, ExternalLink, Link2Off, Clock, ShieldAlert, Lock, KeyRound, Loader2, AlertTriangle, X } from 'lucide-react';
import { useDrive, useMe } from '../store/DriveStore';
import { fileBlob } from '../store/useItemActions';
import { isTrashedDeep, accessOf } from '../store/selectors';
import { getFileType } from '../utils/fileTypes';
import { formatSize } from '../utils/format';
import { saveBlob } from '../utils/exporters';
import { linkStatus, deviceLabel, sessionIp } from '../utils/sharing';
import { verifySecret, storedSecret } from '../data/storage/secrets';
import { checkShare } from '../dlp/dlp';
import { useSearchIndex, indexStatus } from '../search/searchIndex';
import { FileIcon } from '../components/common';
import { viewerFor, Watermark, useIsDark } from '../views/PublicViews';
import { brandingOf, brandVars, DEFAULT_LOGO } from './branding';

/** File types that render inside an embed. */
export const EMBED_CATEGORIES = ['image', 'pdf', 'text', 'document', 'spreadsheet', 'presentation', 'video', 'audio'];
export const embeddable = (item) => !!item && item.type === 'file' && EMBED_CATEGORIES.includes(getFileType(item.ext).category);

export const embedUrl = (id, { header = true, download = true, theme = 'auto' } = {}) => {
  const q = new URLSearchParams();
  if (!header) q.set('header', '0');
  if (!download) q.set('download', '0');
  if (theme !== 'auto') q.set('theme', theme);
  const qs = q.toString();
  return `${window.location.origin}/embed/${id}${qs ? `?${qs}` : ''}`;
};

function EmbedNote({ icon: Icon, title, text, href }) {
  return (
    <div className="embed-note">
      <Icon size={22} />
      <strong>{title}</strong>
      {text && <span className="muted small">{text}</span>}
      {href && <a className="btn btn-secondary btn-sm" href={href} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open in a new tab</a>}
    </div>
  );
}

/**
 * /embed/:id — a chrome-less viewer meant to sit inside an <iframe> on another website.
 * Only works for files shared with "Anyone with the link"; every other rule of the link (expiry, password,
 * download permission, watermark, data protection) still applies.
 * Options: ?header=0 hides the title bar, ?download=0 hides the download button, ?theme=light|dark.
 */
export default function EmbedView() {
  const { id } = useParams();
  const loc = useLocation();
  const { state, api } = useDrive();
  const signedIn = useMe();
  useSearchIndex(); // re-render when the index (which the DLP check reads) has loaded
  const indexReady = indexStatus().loaded;
  const dark = useIsDark();
  const q = new URLSearchParams(loc.search);
  const showHeader = q.get('header') !== '0';
  const showDownload = q.get('download') !== '0';
  const theme = q.get('theme');
  const [unlocked, setUnlocked] = useState(false);
  const [pwd, setPwd] = useState('');
  const [checking, setChecking] = useState(false);
  const [pwdErr, setPwdErr] = useState('');
  const [dlErr, setDlErr] = useState('');

  useEffect(() => { if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme; }, [theme]);

  const item = state.items[id];
  const alive = item && !isTrashedDeep(state.items, id);
  const status = alive ? linkStatus(state, item) : { ok: false, reason: 'off' };
  // ?preview=1 is the owner's preview inside the Share tools (not a real visit). Only honoured for a
  // signed-in person who can open the file, so it can't be used to hide visits from the link activity.
  const isPreview = q.get('preview') === '1' && !!signedIn && !state.signedOut && !!alive && accessOf(state, item) !== 'none';
  const isPublic = status.ok && status.link.access === 'anyone';
  // The DLP check reads the search index, which loads asynchronously: wait for it instead of letting files through.
  const dlpPending = isPublic && !indexReady;
  const dlpBlocked = isPublic && indexReady && checkShare(state, item, 'public').decision === 'block';
  const needsPassword = isPublic && status.passwordProtected && !unlocked;
  const canView = isPublic && !dlpPending && !dlpBlocked && !needsPassword && embeddable(item);
  const b = brandingOf(state);
  const linkHref = `/link/${id}`;

  const visitor = useMemo(() => ({ who: null, device: deviceLabel(), ip: sessionIp(), via: 'embed' }), []);
  const logged = useRef(false);
  useEffect(() => {
    if (canView && !isPreview && !logged.current) { logged.current = true; api.logLinkAccess(id, { ...visitor, event: 'viewed' }); }
  }, [canView]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async () => {
    const fresh = api.get();
    const st = linkStatus(fresh, fresh.items[id]);
    if (!st.ok || !st.canDownload || st.link.access !== 'anyone') return;
    // Re-check data protection at the moment of download (the index or the policy may have changed).
    if (!indexStatus().loaded || checkShare(fresh, fresh.items[id], 'public').decision === 'block') { setDlErr('This file can’t be downloaded right now.'); return; }
    let blob;
    try {
      blob = (await fileBlob(item)) || new Blob([`${item.name}\n\nSample file in the prototype.`], { type: 'text/plain' });
    } catch {
      setDlErr('This file’s contents aren’t available right now.');
      return;
    }
    setDlErr('');
    saveBlob(blob, blob.type === 'text/plain' && getFileType(item.ext).category !== 'text' ? `${item.name}.txt` : item.name);
    if (!isPreview) api.logLinkAccess(id, { ...visitor, event: 'downloaded', file: item.name });
  };

  // Passwords are stored as a PBKDF2 hash, so checking one is asynchronous.
  const checkPassword = async (e) => {
    e.preventDefault();
    if (!pwd || checking) return;
    setChecking(true);
    let ok = false;
    try { ok = await verifySecret(pwd, storedSecret(status.link)); } catch { /* treated as wrong */ }
    setChecking(false);
    if (ok) { setUnlocked(true); setPwdErr(''); return; }
    setPwdErr('That password is not correct.');
    if (!isPreview) api.logLinkAccess(id, { ...visitor, event: 'password-failed' });
  };

  let body;
  if (!alive || status.reason === 'off') body = <EmbedNote icon={Link2Off} title="This file is no longer available" text="The owner may have deleted it or turned off sharing." />;
  else if (status.reason === 'expired') body = <EmbedNote icon={Clock} title="This link has expired" />;
  else if (status.reason === 'public-off') body = <EmbedNote icon={Lock} title="Public links are turned off by the organization" href={linkHref} />;
  else if (status.reason === 'needs-password') body = <EmbedNote icon={KeyRound} title="This link isn’t ready yet" text="The owner still needs to finish setting it up." />;
  else if (!isPublic) body = <EmbedNote icon={Lock} title="This file can’t be shown here" text="It’s only shared with signed-in people." href={linkHref} />;
  else if (dlpPending) body = <EmbedNote icon={Loader2} title="Checking…" />;
  else if (dlpBlocked) body = <EmbedNote icon={ShieldAlert} title="This file can’t be shown publicly" text="It contains sensitive information." />;
  else if (needsPassword) {
    body = (
      <form className="embed-note" onSubmit={checkPassword}>
        <KeyRound size={22} />
        <strong>Password required</strong>
        <div className="embed-pwd">
          <input className="input input-sm" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Password" aria-label="Password" />
          <button className="btn btn-primary btn-sm" disabled={!pwd || checking}>{checking ? 'Checking…' : 'Open'}</button>
        </div>
        {pwdErr && !checking && <span className="field-error" role="alert">{pwdErr}</span>}
      </form>
    );
  } else if (!embeddable(item)) body = <EmbedNote icon={ExternalLink} title={item.name} text="This type of file can’t be previewed here." href={linkHref} />;
  else body = viewerFor(item, status.canDownload ? download : undefined);

  const wm = canView && status.watermark ? `Shared link · ${visitor.ip} · ${new Date().toLocaleDateString()}` : null;
  const protect = canView && !status.canDownload ? { onContextMenu: (e) => e.preventDefault(), onCopy: (e) => e.preventDefault() } : {};

  return (
    <div className={`embed-page ${b.enabled ? 'branded' : ''}`} style={brandVars(b, dark)}>
      {showHeader && alive && (
        <header className="embed-bar">
          <FileIcon item={item} size={22} />
          <div className="min0 grow">
            <div className="embed-title truncate">{item.name}</div>
            {canView && <div className="muted small truncate">{formatSize(item.size)} · {(b.enabled && b.displayName?.trim()) || state.org.name}</div>}
          </div>
          {canView && showDownload && status.canDownload && <button className="icon-btn" onClick={download} aria-label="Download" data-tip="Download"><Download size={16} /></button>}
          <a className="icon-btn" href={linkHref} target="_blank" rel="noreferrer" aria-label="Open in a new tab" data-tip="Open in a new tab"><ExternalLink size={16} /></a>
          <img className="embed-logo" src={(b.enabled && b.logo) || DEFAULT_LOGO} alt="" />
        </header>
      )}
      {dlErr && <div className="embed-msg" role="alert"><AlertTriangle size={14} /> <span className="grow">{dlErr}</span><button type="button" className="icon-btn sm" onClick={() => setDlErr('')} aria-label="Dismiss"><X size={14} /></button></div>}
      <div className={`embed-stage ${canView && !status.canDownload ? 'no-copy' : ''}`} {...protect}>
        {body}
        {wm && <Watermark text={wm} />}
      </div>
    </div>
  );
}
