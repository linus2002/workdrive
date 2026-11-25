import { useEffect, useMemo, useState } from 'react';
import { QrCode, Code2, Copy, Download, Printer, Globe2, ShieldAlert, Info, Check, ImageIcon, AlertTriangle, RotateCcw, KeyRound } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { accessOf, canEdit } from '../store/selectors';
import { linkStatus, linkUrl, requestUrl, requestStatus } from '../utils/sharing';
import { saveBlob } from '../utils/exporters';
import { checkShare, summarize } from '../dlp/dlp';
import { Modal, Switch } from '../components/common';
import { hasSecret } from '../data/storage/secrets';
import { qrCanvas, qrSvg, logoInfo } from './qr';
import { brandingOf, DEFAULT_LOGO, isHex, contrast } from './branding';
import { embeddable, embedUrl } from './EmbedView';

const SIZES = [{ px: 256, label: 'Small · 256 px' }, { px: 512, label: 'Medium · 512 px' }, { px: 1024, label: 'Large · 1024 px (print)' }];
const EMBED_SIZES = [
  { id: 'responsive', label: 'Responsive (fills the page width)' },
  { id: '640x480', label: '640 × 480' },
  { id: '800x600', label: '800 × 600' },
  { id: '1024x768', label: '1024 × 768' },
  { id: 'custom', label: 'Custom size' },
];
const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const safeName = (n) => String(n || 'qr-code').replace(/[\\/:*?"<>|]+/g, '-');

async function copyText(text, toast, what = 'Copied to clipboard') {
  try { await navigator.clipboard.writeText(text); toast(what, { type: 'success' }); } catch { toast('Copy failed. Select the text and copy it manually.', { type: 'error' }); }
}

/* ------------------------------------------------------------------ */
/* QR code                                                             */
/* ------------------------------------------------------------------ */
function QrPanel({ url, title, notice }) {
  const { state } = useDrive();
  const { toast } = useUI();
  const brand = brandingOf(state);
  const brandLogo = (brand.enabled && brand.logo) || DEFAULT_LOGO;
  const [size, setSize] = useState(512);
  const [color, setColor] = useState(brand.enabled ? 'brand' : 'black');
  const [withLogo, setWithLogo] = useState(true);
  const [dots, setDots] = useState(false);
  const [png, setPng] = useState(null);
  const [genError, setGenError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const accent = isHex(brand.accentColor) ? brand.accentColor : '#1686D9';
  // Light colours on white don't scan reliably: below 3:1 contrast we fall back to black.
  const lowContrast = contrast(accent, '#FFFFFF') < 3;
  const fg = color === 'brand' && !lowContrast ? accent : '#111827';
  const ready = !!png && !genError;

  useEffect(() => {
    let alive = true;
    setPng(null);
    setGenError(false);
    qrCanvas(url, { size, fg, logo: withLogo ? brandLogo : null, rounded: dots })
      .then((c) => { if (alive) setPng(c.toDataURL('image/png')); })
      .catch(() => { if (alive) setGenError(true); });
    return () => { alive = false; };
  }, [url, size, fg, withLogo, dots, brandLogo, attempt]);

  const downloadPng = async () => {
    try {
      const c = await qrCanvas(url, { size, fg, logo: withLogo ? brandLogo : null, rounded: dots });
      c.toBlob((b) => (b ? saveBlob(b, `${safeName(title)} - QR.png`) : toast('The QR code couldn’t be saved. Try again.', { type: 'error' })), 'image/png');
    } catch { toast('The QR code couldn’t be created. Try again.', { type: 'error' }); }
  };
  const downloadSvg = async () => {
    try {
      const logo = withLogo ? await logoInfo(brandLogo) : null;
      const svg = qrSvg(url, { fg, logo: logo?.url, logoRatio: logo?.ratio || 1 });
      saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${safeName(title)} - QR.svg`);
    } catch { toast('The QR code couldn’t be created. Try again.', { type: 'error' }); }
  };
  const copyImage = async () => {
    try {
      const c = await qrCanvas(url, { size, fg, logo: withLogo ? brandLogo : null, rounded: dots });
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      toast('QR code copied as an image', { type: 'success' });
    } catch { toast('Your browser can’t copy images. Download it instead.', { type: 'error' }); }
  };
  const print = () => {
    if (!ready) return;
    const w = window.open('', '_blank', 'width=520,height=680');
    if (!w) { toast('Allow pop-ups to print the QR code', { type: 'error' }); return; }
    const org = (brand.enabled && brand.displayName?.trim()) || state.org.name;
    w.document.write(`<!doctype html><title>${attr(title)} – QR code</title><style>body{font-family:Poppins,Segoe UI,Arial,sans-serif;text-align:center;padding:40px;color:#111827}img.qr{width:320px;height:320px}h1{font-size:20px;margin:16px 0 4px}p{color:#6b7280;font-size:13px;word-break:break-all}img.logo{height:36px}</style>`
      + `<img class="logo" src="${attr(brandLogo)}" alt=""><h1>${attr(title)}</h1><p>Scan with your phone camera to open</p><img class="qr" src="${png}" alt="QR code"><p>${attr(url)}</p><p>${attr(org)}</p><script>window.onload=()=>{setTimeout(()=>{window.print()},200)}</` + 'script>');
    w.document.close();
  };

  return (
    <div className="qr-panel">
      <div className="qr-preview">
        {genError ? (
          <div className="qr-error" role="alert">
            <AlertTriangle size={22} />
            <span className="small">The QR code couldn’t be created.</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttempt((n) => n + 1)}><RotateCcw size={14} /> Retry</button>
          </div>
        ) : png ? <img src={png} alt={`QR code for ${title}`} /> : <div className="qr-skel" aria-label="Creating QR code" />}
        <span className="muted small truncate" title={url}>{url}</span>
      </div>
      <div className="qr-opts">
        {notice}
        <label className="field"><span className="field-label">Size</span>
          <select className="select full" value={size} onChange={(e) => setSize(Number(e.target.value))}>{SIZES.map((s) => <option key={s.px} value={s.px}>{s.label}</option>)}</select>
        </label>
        <div className="field"><span className="field-label">Colour</span>
          <div className="seg seg-sm" role="radiogroup" aria-label="QR colour">
            <button type="button" role="radio" aria-checked={color === 'black'} className={color === 'black' ? 'active' : ''} onClick={() => setColor('black')}>Black</button>
            <button type="button" role="radio" aria-checked={color === 'brand'} className={color === 'brand' ? 'active' : ''} onClick={() => setColor('brand')}><span className="qr-swatch" style={{ background: accent }} /> Brand colour</button>
          </div>
          {color === 'brand' && lowContrast && <span className="field-warn"><AlertTriangle size={12} /> Your brand colour is too light to scan reliably, so the code uses black.</span>}
        </div>
        <label className="check-row"><input type="checkbox" className="cb" checked={withLogo} onChange={(e) => setWithLogo(e.target.checked)} /> Logo in the middle</label>
        <label className="check-row"><input type="checkbox" className="cb" checked={dots} onChange={(e) => setDots(e.target.checked)} /> Rounded dots</label>
        <div className="qr-actions">
          <button className="btn btn-primary btn-sm" onClick={downloadPng} disabled={!ready}><Download size={14} /> PNG</button>
          <button className="btn btn-secondary btn-sm" onClick={downloadSvg} disabled={!ready}><Download size={14} /> SVG</button>
          <button className="btn btn-secondary btn-sm" onClick={copyImage} disabled={!ready}><ImageIcon size={14} /> Copy image</button>
          <button className="btn btn-secondary btn-sm" onClick={print} disabled={!ready}><Printer size={14} /> Print</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Embed code                                                          */
/* ------------------------------------------------------------------ */
function EmbedPanel({ item }) {
  const { state, api } = useDrive();
  const { toast } = useUI();
  const [size, setSize] = useState('responsive');
  // Custom size: keep what's typed, clamp when the field loses focus.
  const [wRaw, setWRaw] = useState('720');
  const [hRaw, setHRaw] = useState('540');
  const clampW = (v) => Math.max(200, Math.min(2400, Math.round(Number(v)) || 720));
  const clampH = (v) => Math.max(150, Math.min(2400, Math.round(Number(v)) || 540));
  const w = clampW(wRaw);
  const h = clampH(hRaw);
  const [header, setHeader] = useState(true);
  const [download, setDownload] = useState(true);
  const [theme, setTheme] = useState('auto');
  const [kind, setKind] = useState('iframe');
  const [confirm, setConfirm] = useState(null); // DLP warning before making the link public

  const manage = canEdit(accessOf(state, item));
  const policies = state.org.policies;
  const status = linkStatus(state, item);
  const isPublic = status.ok && status.link.access === 'anyone';
  const dlDisabled = isPublic && !status.canDownload;
  const accent = isHex(brandingOf(state).accentColor) ? brandingOf(state).accentColor : '#1686D9';

  const src = embedUrl(item.id, { header, download: download && !dlDisabled, theme });
  const [fw, fh] = size === 'custom' ? [w, h] : size === 'responsive' ? [null, null] : size.split('x').map(Number);
  const title = attr(item.name);
  const snippet = useMemo(() => {
    if (kind === 'button') {
      return `<a href="${attr(linkUrl(item.id))}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:8px;background:${accent};color:${contrast(accent, '#FFFFFF') >= 3 ? '#fff' : '#111827'};font:600 14px/1.2 system-ui,sans-serif;text-decoration:none;">View ${title}</a>`;
    }
    if (!fw) {
      return `<div style="position:relative;width:100%;padding-top:75%;">\n  <iframe src="${attr(src)}" title="${title}" style="position:absolute;inset:0;width:100%;height:100%;border:1px solid #e5e7eb;border-radius:8px;" loading="lazy" allow="fullscreen" allowfullscreen></iframe>\n</div>`;
    }
    return `<iframe src="${attr(src)}" width="${fw}" height="${fh}" title="${title}" style="border:1px solid #e5e7eb;border-radius:8px;" loading="lazy" allow="fullscreen" allowfullscreen></iframe>`;
  }, [kind, src, fw, fh, title, item.id, accent]);

  if (!embeddable(item)) {
    return <div className="embed-empty"><Info size={18} /> <span>{item.type === 'folder' ? 'Folders can’t be embedded. Share the link or a QR code instead.' : 'This type of file can’t be previewed on a website. Share the link or a QR code instead.'}</span></div>;
  }

  const pwdRequired = !!policies.linkPasswordRequired;
  const makePublic = () => {
    const apply = () => {
      const prev = item.link || { role: 'viewer', expires: null, password: false };
      // The admin's "require password for public links" policy applies here too.
      api.setLink(item.id, { ...prev, enabled: true, access: 'anyone', ...(pwdRequired ? { password: true } : {}) });
      if (pwdRequired && !hasSecret(prev)) toast('Public link set up. Set a password in the Share dialog to activate it.', { type: 'info', duration: 7000 });
      else toast('Anyone with the link can now view this file', { type: 'success' });
      setConfirm(null);
    };
    const v = checkShare(state, item, 'public');
    if (v.decision === 'block') { toast(`Blocked: this file contains sensitive data (${summarize(v.files[0].findings, 2)})`, { type: 'error', duration: 7000 }); return; }
    if (v.decision === 'warn') { setConfirm({ v, apply }); return; }
    apply();
  };

  if (!isPublic && status.reason === 'needs-password') {
    return (
      <div className="embed-gate">
        <KeyRound size={22} />
        <strong>Set a password to activate this link</strong>
        <p className="muted small">Your administrator requires a password on public links. Set one in the Share dialog; visitors to the embed will be asked for it.</p>
      </div>
    );
  }
  if (!isPublic) {
    return (
      <div className="embed-gate">
        <Globe2 size={22} />
        <strong>Embedding needs a public link</strong>
        <p className="muted small">Websites show the file to everyone, so the link must be set to “Anyone with the link”.{status.ok ? '' : status.reason === 'expired' ? ' The current link has expired.' : status.reason === 'public-off' ? '' : ' Link sharing is off.'}</p>
        {!policies.publicLinks ? <p className="small warn-text">Public links are turned off by your administrator.</p>
          : !manage ? <p className="small muted">Ask the owner or an editor to turn on a public link.</p>
            : status.reason === 'expired' ? <p className="small muted">Change the expiration date in the Share dialog first.</p>
              : <>
                <button className="btn btn-primary btn-sm" onClick={makePublic}><Globe2 size={14} /> Allow anyone with the link</button>
                {pwdRequired && !hasSecret(item.link) && <p className="small muted">Your administrator requires a password on public links, so you’ll need to set one in the Share dialog before the embed works.</p>}
              </>}
        {confirm && (
          <div className="dlp-prompt" role="alertdialog" aria-label="Sensitive data warning">
            <div className="dlp-prompt-head"><ShieldAlert size={18} /> <strong>Make this public?</strong></div>
            <p className="small">This file contains sensitive data ({summarize(confirm.v.files[0].findings, 2)}). Anyone who visits a page with the embed could see it.</p>
            <div className="btn-row end">
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn btn-danger btn-sm" onClick={() => { api.logEvent('DLP warning overridden', item.name, `Public link for embed · ${summarize(confirm.v.files[0].findings, 2)}`, { itemId: item.id }); confirm.apply(); }}>Make public anyway</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="embed-panel">
      <div className="embed-opts">
        <div className="seg seg-sm full" role="radiogroup" aria-label="Snippet type">
          <button type="button" role="radio" aria-checked={kind === 'iframe'} className={kind === 'iframe' ? 'active' : ''} onClick={() => setKind('iframe')}>Embedded viewer</button>
          <button type="button" role="radio" aria-checked={kind === 'button'} className={kind === 'button' ? 'active' : ''} onClick={() => setKind('button')}>Link button</button>
        </div>
        {kind === 'iframe' && (
          <>
            <label className="field"><span className="field-label">Size</span>
              <select className="select full" value={size} onChange={(e) => setSize(e.target.value)}>{EMBED_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
            </label>
            {size === 'custom' && (
              <div className="form-grid">
                <label className="field"><span className="field-label">Width (px)</span><input className="input" type="number" inputMode="numeric" min={200} max={2400} value={wRaw} onChange={(e) => setWRaw(e.target.value)} onBlur={() => setWRaw(String(w))} /></label>
                <label className="field"><span className="field-label">Height (px)</span><input className="input" type="number" inputMode="numeric" min={150} max={2400} value={hRaw} onChange={(e) => setHRaw(e.target.value)} onBlur={() => setHRaw(String(h))} /></label>
              </div>
            )}
            <div className="field"><span className="field-label">Theme</span>
              <div className="seg seg-sm" role="radiogroup" aria-label="Theme">
                {['auto', 'light', 'dark'].map((t) => <button key={t} type="button" role="radio" aria-checked={theme === t} className={theme === t ? 'active' : ''} onClick={() => setTheme(t)}>{t === 'auto' ? 'Match visitor' : t[0].toUpperCase() + t.slice(1)}</button>)}
              </div>
            </div>
            <div className="link-opt"><span className="grow">Show title bar</span><Switch checked={header} onChange={setHeader} label="Show title bar" /></div>
            <div className="link-opt"><span className="grow">Download button{dlDisabled && <span className="muted small block">Downloads are off for this link</span>}</span><Switch checked={download && !dlDisabled} onChange={setDownload} label="Download button" disabled={dlDisabled} /></div>
          </>
        )}
      </div>
      <div className="embed-out">
        <div className="embed-code">
          <textarea className="input mono" readOnly rows={kind === 'button' ? 4 : 5} value={snippet} onFocus={(e) => e.target.select()} aria-label="Embed code" />
          <button className="btn btn-primary btn-sm" onClick={() => copyText(snippet, toast, 'Embed code copied')}><Copy size={14} /> Copy code</button>
        </div>
        {kind === 'iframe' ? (
          <div className="embed-live">
            <span className="muted small">Preview</span>
            <iframe src={`${src}${src.includes('?') ? '&' : '?'}preview=1`} title={`Preview of ${item.name}`} />
          </div>
        ) : (
          <div className="embed-live"><span className="muted small">Preview</span><div className="embed-btn-preview"><span className="embed-btn-sample" style={{ background: accent, color: contrast(accent, '#FFFFFF') >= 3 ? '#fff' : '#111827' }}>View {item.name}</span></div></div>
        )}
        <p className="muted small"><Check size={12} /> The link’s rules still apply on other websites: expiry date, password, download limit, watermark and data protection. Views are recorded as “via embed” in link activity.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */
/** QR code + embed code for a shared item (itemId) or a file request (requestId). */
export default function LinkToolsDialog({ itemId, requestId, tab: initialTab = 'qr', onClose }) {
  const { state } = useDrive();
  const ui = useUI();
  const { toast } = ui;
  // Opened from the Share dialog it is stacked on top, so closing simply returns to Share (with its state).
  const item = itemId ? state.items[itemId] : null;
  const req = requestId ? (state.fileRequests || []).find((r) => r.id === requestId) : null;
  const [tab, setTab] = useState(item ? initialTab : 'qr');
  if (!item && !req) return null;

  const title = item ? item.name : req.title;
  let url; let notice = null;
  if (item) {
    url = `${linkUrl(item.id)}?src=qr`;
    const st = linkStatus(state, item);
    if (!st.ok) {
      notice = (
        <div className="banner warning small">
          {st.reason === 'expired' ? 'This link has expired, so the code won’t open anything until you change the expiry date.'
            : st.reason === 'public-off' ? 'Public links are turned off by your administrator, so the code won’t open anything. Choose a different link setting in the Share dialog.'
              : st.reason === 'needs-password' ? 'Set a password to activate this link. Your administrator requires one for public links.'
                : 'Link sharing is off, so the code won’t open anything yet. Turn on link sharing in the Share dialog.'}
        </div>
      );
    }
    else if (st.link.access === 'org') notice = <div className="banner info small">Only people at {state.org.name} can open it, after signing in.</div>;
    else if (st.link.access === 'restricted') notice = <div className="banner info small">Only people the file is shared with can open it.</div>;
  } else {
    url = requestUrl(req.id);
    if (requestStatus(req, Date.now(), state) !== 'active') notice = <div className="banner warning small">This request is not accepting uploads right now.</div>;
  }

  // Avoid a flash of the old tab when reopened on a different item.
  const showTab = item ? tab : 'qr';
  // The embed is pointless for file requests (uploads need the full page), so only the QR tab is shown for them.
  return (
    <Modal title={item ? 'QR code & embed' : 'QR code for upload link'} subtitle={title} onClose={onClose} width={720} icon={<QrCode size={20} />}
      footer={<><button className="btn btn-secondary" onClick={() => copyText(item ? linkUrl(item.id) : url, toast, 'Link copied')}><Copy size={14} /> Copy link</button><span className="grow" /><button className="btn btn-primary" onClick={onClose}>Done</button></>}>
      {item && (
        <div className="tabs small" role="tablist">
          <button role="tab" aria-selected={showTab === 'qr'} className={showTab === 'qr' ? 'active' : ''} onClick={() => setTab('qr')}><QrCode size={14} /> QR code</button>
          <button role="tab" aria-selected={showTab === 'embed'} className={showTab === 'embed' ? 'active' : ''} onClick={() => setTab('embed')}><Code2 size={14} /> Embed on a website</button>
        </div>
      )}
      {showTab === 'qr' ? <QrPanel url={url} title={title} notice={notice} /> : <EmbedPanel item={item} />}
    </Modal>
  );
}
