import { useEffect, useMemo, useRef, useState } from 'react';
import { Palette, Upload, Trash2, RotateCcw, ExternalLink, FileText, Download, Inbox, UploadCloud, AlertTriangle, Eye } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { linkStatus, requestStatus } from '../utils/sharing';
import { Switch, Modal } from '../components/common';
import { Section, SettingRow } from '../views/SettingsView';
import { PublicShell, Welcome } from '../views/PublicViews';
import {
  DEFAULT_BRANDING, ACCENT_PRESETS, HEADER_PRESETS, DEFAULT_LOGO, brandingOf, isHex, contrast, processLogo,
} from './branding';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ColorField({ label, value, onChange, presets, onValidity }) {
  const [text, setText] = useState(value);
  const set = (v) => { setText(v); onValidity?.(isHex(v)); if (isHex(v)) onChange(v.toUpperCase()); };
  // Follow outside changes (presets, discard, reset) without fighting a half-typed value.
  useEffect(() => { setText((t) => (isHex(t) && t.toUpperCase() === value.toUpperCase() ? t : value)); }, [value]);
  return (
    <div className="color-field">
      <div className="color-swatches" role="radiogroup" aria-label={label}>
        {presets.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={value.toUpperCase() === c} aria-label={c} title={c}
            className={`color-swatch ${value.toUpperCase() === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set(c)} />
        ))}
      </div>
      <label className="color-custom">
        <input type="color" value={isHex(value) && value.length === 7 ? value : '#000000'} onChange={(e) => set(e.target.value)} aria-label={`${label}: pick a colour`} />
        <input className={`input input-sm mono ${isHex(text) ? '' : 'invalid'}`} value={text} onChange={(e) => set(e.target.value.trim())} maxLength={7} aria-label={`${label}: hex value`} />
      </label>
    </div>
  );
}

const PREVIEW_W = 1100; // the preview draws a desktop-width page (1100 × 760 px), scaled to fit the dialog
const PREVIEW_H = 760;

/** A scaled-down copy of the real public page, drawn with the draft branding. */
function BrandPreview({ draft, page }) {
  const { state } = useDrive();
  const me = state.users.find((u) => u.id === state.meId);
  const ref = useRef(null);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => { const w = e.contentRect.width; if (w) setScale(Math.min(1, w / PREVIEW_W)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="brand-preview" ref={ref} aria-label="Preview" inert="" style={{ height: Math.round(PREVIEW_H * scale) }}>
      <div className="brand-preview-inner" style={{ width: PREVIEW_W, height: PREVIEW_H, transform: `scale(${scale})` }}>
        <PublicShell brand={draft} wide={page === 'link'} preview right={<span className="btn btn-secondary btn-sm">Sign in</span>}>
          {page === 'link' ? (
            <>
              <Welcome kind="link" sender={me?.name} file="Q3 Business Review.pdf" brand={draft} />
              <div className="public-head">
                <span className="brand-preview-file"><FileText size={22} /></span>
                <div className="min0 grow"><h1 className="truncate">Q3 Business Review.pdf</h1><div className="muted small">Shared by {me?.name} · 3.2 MB</div></div>
                <span className="btn btn-primary"><Download size={15} /> Download</span>
              </div>
              <div className="brand-preview-doc"><span /><span /><span /><span className="short" /></div>
            </>
          ) : (
            <div className="request-card">
              <span className="gate-icon"><Inbox size={26} /></span>
              <h1>Signed contracts</h1>
              <p className="muted">{me?.name} from {state.org.name} is requesting files.</p>
              <Welcome kind="request" sender={me?.name} file="Contracts" brand={draft} />
              <div className="request-drop"><UploadCloud size={30} /><strong>Drop files here or click to choose</strong></div>
              <span className="btn btn-primary btn-block"><UploadCloud size={16} /> Upload</span>
            </div>
          )}
        </PublicShell>
      </div>
    </div>
  );
}

export default function BrandingTab() {
  const { state, api } = useDrive();
  const ui = useUI();
  const saved = brandingOf(state);
  const [draft, setDraft] = useState(saved);
  const [page, setPage] = useState('link');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [logoErr, setLogoErr] = useState('');
  const [badColor, setBadColor] = useState({}); // field -> true while its hex text is invalid
  const [fieldsKey, setFieldsKey] = useState(0); // remounts the colour fields on discard/reset
  const fileRef = useRef(null);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const emailErr = draft.supportEmail.trim() && !EMAIL.test(draft.supportEmail.trim()) ? 'Enter a valid email address' : '';
  const accentContrast = contrast(draft.accentColor, '#FFFFFF');
  const colorErr = !isHex(draft.accentColor) || !isHex(draft.headerColor) || Object.values(badColor).some(Boolean);
  const err = emailErr || (colorErr ? 'Colours must be hex values like #1686D9' : '');

  // Don't lose an unsaved draft silently: warn before leaving the page, and before in-app links navigate away.
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    const onUnload = (e) => { if (!dirtyRef.current) return; e.preventDefault(); e.returnValue = ''; };
    const onClick = (e) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.('a[href]');
      if (!a || a.target === '_blank' || a.closest('.branding-layout')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      // eslint-disable-next-line no-alert
      if (!window.confirm('You have unsaved branding changes. Leave without saving?')) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => { window.removeEventListener('beforeunload', onUnload); document.removeEventListener('click', onClick, true); };
  }, []);
  const discard = () => { setDraft(saved); setBadColor({}); setFieldsKey((k) => k + 1); };

  // Real pages to open, so admins can see the result in context.
  const sample = useMemo(() => Object.values(state.items).find((i) => !i.trashed && i.type === 'file' && linkStatus(state, i).ok && i.link.access === 'anyone'), [state]);
  const sampleReq = (state.fileRequests || []).find((r) => requestStatus(r, Date.now(), state) === 'active');

  const pickLogo = async (file) => {
    if (!file) return;
    setLogoErr('');
    try { set({ logo: await processLogo(file) }); } catch (e) { setLogoErr(e.message); }
  };
  const save = () => {
    if (err) return;
    api.updateOrg({ branding: { ...draft, displayName: draft.displayName.trim(), supportEmail: draft.supportEmail.trim(), footerText: draft.footerText.trim() } });
    ui.toast('Branding saved. Public pages now use it.', { type: 'success' });
  };
  const reset = () => ui.openDialog('confirm', {
    title: 'Reset branding to defaults?', message: 'The logo, colours and messages on public pages go back to the standard WorkDrive look. This is saved right away.',
    confirmLabel: 'Reset', danger: true,
    onConfirm: () => { api.updateOrg({ branding: { ...DEFAULT_BRANDING } }); setDraft({ ...DEFAULT_BRANDING }); setBadColor({}); setFieldsKey((k) => k + 1); ui.toast('Branding reset', { type: 'success' }); },
  });

  return (
    <div className="branding-layout">
      <div className="branding-form">
        {dirty && (
          <div className="banner warning branding-dirty" role="status">
            <AlertTriangle size={15} /> <span className="grow">You have unsaved changes. Public pages still use the saved branding.</span>
            <button type="button" className="btn btn-primary btn-sm" disabled={!!err} onClick={save}>Save</button>
          </div>
        )}
        <Section title="Public page branding" desc="Your logo, colours and messages on pages people outside the organization see: shared links, file requests and embedded files."
          actions={<>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreviewOpen(true)}><Eye size={14} /> Preview</button>
            <Switch checked={draft.enabled} onChange={(v) => set({ enabled: v })} label="Use custom branding" />
          </>}>
          <fieldset className="plain-fieldset" disabled={!draft.enabled}>
            <SettingRow title="Logo" desc="PNG or SVG with a transparent background works best. Shown in the page header, on embeds and in the middle of QR codes.">
              <div className="logo-field">
                <span className="logo-box" style={isHex(draft.headerColor) ? { backgroundColor: draft.headerColor, backgroundImage: 'none' } : undefined} title="Shown on your header colour"><img src={draft.logo || DEFAULT_LOGO} alt="Current logo" /></span>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={(e) => { pickLogo(e.target.files?.[0]); e.target.value = ''; }} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}><Upload size={14} /> {draft.logo ? 'Replace' : 'Upload'}</button>
                {draft.logo && <button type="button" className="icon-btn sm" onClick={() => set({ logo: null, hideName: false })} aria-label="Remove logo" data-tip="Remove logo"><Trash2 size={15} /></button>}
              </div>
            </SettingRow>
            {logoErr && <p className="field-error">{logoErr}</p>}
            {draft.logo && (
              <label className="check-row brand-check"><input type="checkbox" className="cb" checked={!!draft.hideName} onChange={(e) => set({ hideName: e.target.checked })} /> My logo already includes our name (hide the name next to it)</label>
            )}
            <SettingRow title="Display name" desc="Shown next to the logo and in messages.">
              <input className="input" value={draft.displayName} onChange={(e) => set({ displayName: e.target.value })} placeholder={state.org.name} maxLength={60} />
            </SettingRow>
            <SettingRow title="Accent colour" desc="Buttons, links and highlights.">
              <ColorField key={`accent-${fieldsKey}`} label="Accent colour" value={draft.accentColor} onChange={(v) => set({ accentColor: v })} presets={ACCENT_PRESETS} onValidity={(ok) => setBadColor((b) => ({ ...b, accent: !ok }))} />
            </SettingRow>
            {isHex(draft.accentColor) && accentContrast < 3 && (
              <p className="brand-warn"><AlertTriangle size={13} /> White text on this colour is hard to read (contrast {accentContrast.toFixed(1)}:1). Choose a darker accent for accessible buttons.</p>
            )}
            <SettingRow title="Header colour" desc="Text in the header switches to black or white automatically.">
              <ColorField key={`header-${fieldsKey}`} label="Header colour" value={draft.headerColor} onChange={(v) => set({ headerColor: v })} presets={HEADER_PRESETS} onValidity={(ok) => setBadColor((b) => ({ ...b, header: !ok }))} />
            </SettingRow>
            <SettingRow title="Page background">
              <div className="seg seg-sm" role="radiogroup" aria-label="Page background">
                <button type="button" role="radio" aria-checked={draft.background === 'plain'} className={draft.background === 'plain' ? 'active' : ''} onClick={() => set({ background: 'plain' })}>Plain</button>
                <button type="button" role="radio" aria-checked={draft.background === 'tint'} className={draft.background === 'tint' ? 'active' : ''} onClick={() => set({ background: 'tint' })}>Tinted with accent</button>
              </div>
            </SettingRow>
          </fieldset>
        </Section>

        <Section title="Welcome messages" desc="Shown at the top of public pages. Use {sender}, {org} and {file} to fill in names automatically.">
          <fieldset className="plain-fieldset" disabled={!draft.enabled}>
            <label className="field"><span className="field-label">Shared links</span>
              <textarea className="input textarea" rows={2} maxLength={300} value={draft.welcomeLink} onChange={(e) => set({ welcomeLink: e.target.value })} placeholder="e.g. {sender} from {org} shared this with you." />
              <span className="muted small t-right">{draft.welcomeLink.length}/300</span>
            </label>
            <label className="field"><span className="field-label">File request pages</span>
              <textarea className="input textarea" rows={2} maxLength={300} value={draft.welcomeRequest} onChange={(e) => set({ welcomeRequest: e.target.value })} placeholder="e.g. Upload your files for {sender}. Only {org} can see them." />
              <span className="muted small t-right">{draft.welcomeRequest.length}/300</span>
            </label>
          </fieldset>
        </Section>

        <Section title="Footer">
          <fieldset className="plain-fieldset" disabled={!draft.enabled}>
            <SettingRow title="Footer text"><input className="input" value={draft.footerText} onChange={(e) => set({ footerText: e.target.value })} maxLength={120} placeholder={`Shared securely with ${state.org.name} WorkDrive`} /></SettingRow>
            <SettingRow title="Support email" desc="Visitors can contact this address for help.">
              <div><input className={`input ${emailErr ? 'invalid' : ''}`} type="email" value={draft.supportEmail} onChange={(e) => set({ supportEmail: e.target.value })} placeholder={`support@${state.org.domain}`} />{emailErr && <span className="field-error block">{emailErr}</span>}</div>
            </SettingRow>
            <SettingRow title="Show “Powered by WorkDrive”"><Switch checked={draft.poweredBy} onChange={(v) => set({ poweredBy: v })} label="Show Powered by WorkDrive" /></SettingRow>
          </fieldset>
        </Section>

        <div className="branding-actions">
          <button className="btn btn-secondary" onClick={reset}><RotateCcw size={14} /> Reset to defaults</button>
          <button className="btn btn-secondary" onClick={() => setPreviewOpen(true)}><Eye size={14} /> Preview</button>
          <span className="grow" />
          {err ? <span className="field-error" role="alert">{err}</span> : dirty && <span className="muted small">Unsaved changes</span>}
          <button className="btn btn-secondary" disabled={!dirty && !colorErr} onClick={discard}>Discard</button>
          <button className="btn btn-primary" disabled={!dirty || !!err} onClick={save}>Save branding</button>
        </div>
      </div>

      {previewOpen && (
        <Modal title="Preview public pages" subtitle={dirty ? 'Showing your unsaved changes' : 'Showing the saved branding'} onClose={() => setPreviewOpen(false)} width={860} icon={<Palette size={18} />}
          footer={<>
            <div className="branding-live-links">
              {sample && <a className="link-btn" href={`/link/${sample.id}?as=guest`} target="_blank" rel="noreferrer"><Eye size={13} /> Open a real shared link</a>}
              {sampleReq && <a className="link-btn" href={`/request/${sampleReq.id}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open a real file request</a>}
              {dirty && <span className="muted small">Save first to see changes on real pages.</span>}
            </div>
            <span className="grow" />
            <button className="btn btn-primary" onClick={() => setPreviewOpen(false)}>Done</button>
          </>}>
          <div className="seg seg-sm branding-preview-tabs" role="radiogroup" aria-label="Preview page">
            <button type="button" role="radio" aria-checked={page === 'link'} className={page === 'link' ? 'active' : ''} onClick={() => setPage('link')}>Shared link</button>
            <button type="button" role="radio" aria-checked={page === 'request'} className={page === 'request' ? 'active' : ''} onClick={() => setPage('request')}>File request</button>
          </div>
          <BrandPreview draft={draft} page={page} />
        </Modal>
      )}
    </div>
  );
}
