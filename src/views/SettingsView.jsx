import { Suspense, useEffect, useMemo, useState } from 'react';
import { NavLink, useParams, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { User, SlidersHorizontal, Bell, Palette, Languages, Shield, HardDrive, Monitor, Moon, Sun, Smartphone, Laptop, RotateCcw, DatabaseBackup } from 'lucide-react';
import { useDrive, useMe, currentSessionId } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { myUsage, usageByCategory } from '../store/selectors';
import { formatSize, formatDate, formatDateTime } from '../utils/format';
import { getFileType } from '../utils/fileTypes';
import PageHeader from '../components/layout/PageHeader';
import { Avatar, Switch, ProgressBar } from '../components/common';
import { colourName } from '../components/dialogs/OrganizeDialogs';
import { lazyNamed } from '../utils/lazy';
import LanguagePicker from '../i18n/LanguagePicker';
import { checkPassword, passwordPatch, twoFactorOn } from '../store/account';
import { newTotpSecret, verifyTotp, totpUri, groupSecret } from '../utils/totp';
import { qrSvg } from '../sharing/qr';
import { useUnsavedGuard } from '../utils/useUnsavedGuard';

const BackupPanel = lazyNamed(() => import('../backup/BackupPanel'));

/** Segmented control announced as a radio group. options: [[value, label]] */
function Seg({ label, value, options, onChange }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'language', label: 'Language & region', icon: Languages },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'backup', label: 'Backup & restore', icon: DatabaseBackup },
];

export function SettingRow({ title, desc, children }) {
  return (
    <div className="setting-row">
      <div className="setting-text"><div className="setting-title">{title}</div>{desc && <div className="setting-desc">{desc}</div>}</div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export function Section({ title, desc, children, actions }) {
  return (
    <section className="settings-card">
      <div className="settings-card-head"><div><h2>{title}</h2>{desc && <p>{desc}</p>}</div>{actions}</div>
      {children}
    </section>
  );
}

function Profile() {
  const { api } = useDrive();
  const me = useMe();
  const { toast } = useUI();
  const [form, setForm] = useState({ name: me.name, title: me.title || '', dept: me.dept || '', phone: me.phone || '', email: me.email });
  const dirty = ['name', 'title', 'dept', 'phone'].some((k) => form[k] !== (me[k] || ''));
  useUnsavedGuard(dirty, 'You have unsaved profile changes. Leave without saving?');
  const save = (e) => { e.preventDefault(); if (!form.name.trim()) return; api.updateUser(me.id, { name: form.name.trim(), title: form.title, dept: form.dept, phone: form.phone }); toast('Profile updated', { type: 'success' }); };
  const colors = ['#1686D9', '#D946EF', '#0EA5A4', '#16A34A', '#EA7A1A', '#6366F1', '#E5484D'];
  return (
    <Section title="Profile information" desc="This is how teammates see you across the workspace.">
      <form className="form" onSubmit={save}>
        <div className="profile-edit">
          <Avatar user={me} size={64} />
          <div>
            <div className="field-label" id="avatar-colour-label">Avatar colour</div>
            <div className="color-row" role="group" aria-labelledby="avatar-colour-label">{colors.map((c) => <button type="button" key={c} className={`color-dot ${me.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => api.updateUser(me.id, { color: c })} aria-label={colourName(c)} aria-pressed={me.color === c} />)}</div>
          </div>
        </div>
        <div className="form-grid">
          <label className="field"><span className="field-label">Full name</span><input className={`input ${!form.name.trim() ? 'invalid' : ''}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span className="field-label">Email</span><input className="input" value={form.email} disabled /><span className="field-hint">Managed by your organization admin.</span></label>
          <label className="field"><span className="field-label">Job title</span><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label className="field"><span className="field-label">Department</span><input className="input" value={form.dept} onChange={(e) => setForm({ ...form, dept: e.target.value })} /></label>
          <label className="field"><span className="field-label">Phone</span><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 0100" /></label>
          <label className="field"><span className="field-label">Role</span><input className="input" value={me.role} disabled /></label>
        </div>
        <div className="btn-row end">
          <button type="button" className="btn btn-secondary" disabled={!dirty} onClick={() => setForm({ name: me.name, title: me.title || '', dept: me.dept || '', phone: me.phone || '', email: me.email })}>Discard</button>
          <button className="btn btn-primary" disabled={!dirty || !form.name.trim()}>Save changes</button>
        </div>
      </form>
    </Section>
  );
}

function Preferences() {
  const { state, api } = useDrive();
  const holds = (state.org.legalHolds || []).filter((h) => h.active).length; // reset would wipe held files
  const { toast, openDialog } = useUI();
  const s = state.settings;
  return (
    <Section title="Account preferences" desc="Control how files and folders behave for you.">
      <SettingRow title="Default view" desc="Layout used when opening folders.">
        <Seg label="Default view" value={s.defaultView} options={[['list', 'List'], ['grid', 'Grid']]} onChange={(v) => api.updateSettings({ defaultView: v })} />
      </SettingRow>
      <SettingRow title="Show details panel" desc="Keep the information panel open on the right side.">
        <Switch checked={s.showDetailsPanel} onChange={(v) => api.updateSettings({ showDetailsPanel: v })} label="Show details panel" />
      </SettingRow>
      <SettingRow title="Confirm before moving to Trash" desc="Ask for confirmation every time you delete items.">
        <Switch checked={s.confirmDelete} onChange={(v) => api.updateSettings({ confirmDelete: v })} label="Confirm delete" />
      </SettingRow>
      <SettingRow title="Collapse sidebar" desc="Show only icons in the navigation sidebar.">
        <Switch checked={s.sidebarCollapsed} onChange={(v) => api.updateSettings({ sidebarCollapsed: v })} label="Collapse sidebar" />
      </SettingRow>
      <SettingRow title="Reset demo data" desc={holds ? `Not available while ${holds} legal hold${holds === 1 ? ' is' : 's are'} active (Admin Console → Data retention).` : 'Restore the original sample files, teams and settings.'}>
        <button className="btn btn-danger-outline" disabled={!!holds} onClick={() => openDialog('confirm', {
          title: 'Reset demo data?', message: 'All files, teams and settings go back to the original samples. Your changes will be lost.',
          confirmLabel: 'Reset demo data', danger: true,
          onConfirm: () => { if (api.reset()) toast('Demo data restored', { type: 'success' }); else toast('Release active legal holds before resetting', { type: 'error' }); },
        })}><RotateCcw size={15} /> Reset</button>
      </SettingRow>
    </Section>
  );
}

function Notifications() {
  const { state, api } = useDrive();
  const { toast } = useUI();
  const n = state.settings.notifications;
  const set = (k) => (v) => api.updateSettings({ notifications: { ...n, [k]: v } });
  return (
    <>
      <Section title="Delivery" desc="Choose where you receive notifications.">
        <SettingRow title="Email notifications" desc="Get a message in your inbox."><Switch checked={n.email} onChange={set('email')} label="Email notifications" /></SettingRow>
        <SettingRow title="Desktop notifications" desc="Show browser notifications while the app is open.">
          <Switch checked={n.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted'} onChange={async (v) => {
            if (v) {
              let perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
              if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch { /* noop */ } }
              if (perm !== 'granted') {
                toast(perm === 'unsupported' ? 'This browser doesn’t support desktop notifications' : 'Desktop notifications are blocked. Allow them in your browser’s site settings, then try again.', { type: 'warning' });
                return;
              }
            }
            set('desktop')(v);
          }} label="Desktop notifications" />
        </SettingRow>
        <SettingRow title="Pop-up alerts" desc="Show a short message in the corner when something new arrives."><Switch checked={n.popups !== false} onChange={set('popups')} label="Pop-up alerts" /></SettingRow>
        <SettingRow title="Weekly digest" desc="A summary of activity in your team folders every Monday."><Switch checked={n.weeklyDigest} onChange={set('weeklyDigest')} label="Weekly digest" /></SettingRow>
      </Section>
      <Section title="Live activity" desc="Teammates comment, share, upload and assign tasks on your workspace every minute or two, and you're notified as it happens (demo).">
        <SettingRow title="Live teammate activity"><Switch checked={n.live !== false} onChange={set('live')} label="Live teammate activity" /></SettingRow>
        <SettingRow title="Try it now" desc="Have a teammate do something right away.">
          <button className="btn btn-secondary btn-sm" onClick={() => api.simulateActivity()}>Simulate activity</button>
        </SettingRow>
      </Section>
      <Section title="Activity" desc="Pick which events notify you.">
        <SettingRow title="Someone shares a file with me"><Switch checked={n.shares} onChange={set('shares')} label="Shares" /></SettingRow>
        <SettingRow title="Comments and mentions"><Switch checked={n.comments} onChange={set('comments')} label="Comments" /></SettingRow>
        <SettingRow title="Uploads to my team folders"><Switch checked={n.uploads} onChange={set('uploads')} label="Uploads" /></SettingRow>
        <SettingRow title="Team membership changes"><Switch checked={n.teamChanges} onChange={set('teamChanges')} label="Team changes" /></SettingRow>
      </Section>
    </>
  );
}

function Appearance() {
  const { state, api } = useDrive();
  const s = state.settings;
  const themes = [{ id: 'light', label: 'Light', icon: Sun }, { id: 'dark', label: 'Dark', icon: Moon }, { id: 'system', label: 'System', icon: Monitor }];
  return (
    <Section title="Appearance" desc="Customize how the workspace looks on this device.">
      <div className="theme-cards">
        {themes.map((t) => (
          <button key={t.id} className={`theme-card ${s.theme === t.id ? 'active' : ''}`} onClick={() => api.updateSettings({ theme: t.id })} aria-pressed={s.theme === t.id}>
            <span className={`theme-swatch ${t.id}`}><span /><span /><span /></span>
            <span className="theme-label"><t.icon size={15} /> {t.label}</span>
          </button>
        ))}
      </div>
      <SettingRow title="Density" desc="Compact mode fits more rows on screen.">
        <Seg label="Density" value={s.density} options={[['comfortable', 'Comfortable'], ['compact', 'Compact']]} onChange={(v) => api.updateSettings({ density: v })} />
      </SettingRow>
    </Section>
  );
}

function Language() {
  const { state, api } = useDrive();
  const { toast } = useUI();
  return (
    <Section title="Language & region" desc="Display language and formatting preferences.">
      <SettingRow title="Display language" desc="Menus, the file list, sign-in and common messages are translated. Other screens are still in English.">
        <LanguagePicker />
      </SettingRow>
      <SettingRow title="Time zone" desc="Used for dates and activity timestamps.">
        <select className="select" aria-label="Time zone" value={state.settings.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone}
          onChange={(e) => { api.updateSettings({ timeZone: e.target.value }); toast(`Time zone set to ${e.target.value}`, { type: 'success' }); }}>
          {[state.settings.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC', 'America/New_York', 'Europe/London', 'Asia/Manila', 'Asia/Kolkata', 'Asia/Tokyo'].filter((v, i, a) => v && a.indexOf(v) === i).map((z) => <option key={z}>{z}</option>)}
        </select>
      </SettingRow>
      <SettingRow title="Date format" desc="How dates appear in file lists.">
        <Seg label="Date format" value={state.settings.dateFormat} options={[['relative', 'Relative'], ['absolute', 'Absolute']]} onChange={(v) => api.updateSettings({ dateFormat: v })} />
      </SettingRow>
    </Section>
  );
}

function Security() {
  const { state, api } = useDrive();
  const { toast } = useUI();
  const sec = state.settings.security;
  const [pw, setPw] = useState({ cur: '', next: '', confirm: '' });
  const sid = currentSessionId();
  const sessions = (state.sessions || []).filter((s) => s.userId === state.meId && !s.endedAt)
    .map((s) => ({ ...s, current: s.id === sid, icon: /iOS|Android/.test(s.device) ? Smartphone : Laptop }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActive - a.lastActive);
  const recent = state.audit.filter((a) => a.actorId === state.meId && /^Signed (in|out)$|^Session ended$|^Signed out everywhere$/.test(a.action)).slice(0, 6);
  const strength = pw.next.length >= 12 && /[A-Z]/.test(pw.next) && /\d/.test(pw.next) ? 'strong' : pw.next.length >= 8 ? 'fair' : pw.next ? 'weak' : '';
  const err = pw.confirm && pw.next !== pw.confirm ? 'Passwords do not match' : null;
  const pwProblem = !pw.cur ? 'Enter your current password' : pw.next.length < 8 ? 'New password must be at least 8 characters' : pw.next !== pw.confirm ? 'Confirm the new password' : pw.next === pw.cur ? 'Choose a password different from the current one' : null;
  const [pwError, setPwError] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const changePassword = async (e) => {
    e.preventDefault();
    if (pwProblem || pwBusy) return;
    setPwBusy(true);
    const ok = await checkPassword(state, pw.cur);
    if (!ok) { setPwBusy(false); setPwError('Your current password is wrong'); api.logEvent('Password change failed', 'Account', 'Wrong current password'); return; }
    api.updateSettings(await passwordPatch(state, pw.next));
    setPwBusy(false); setPwError('');
    toast('Password changed. Use it the next time you sign in.', { type: 'success' });
    setPw({ cur: '', next: '', confirm: '' });
    api.logEvent('Password changed', 'Account');
  };
  // Two-factor: a real authenticator-app secret (TOTP). It's only turned on after a correct code from the app.
  const [params, setParams] = useSearchParams();
  const required = !!state.org.policies.twoFactor;
  const [enrol, setEnrol] = useState(null); // null | { secret, code, error }
  const [disabling, setDisabling] = useState(null); // null | { code, error }
  const startEnrol = () => setEnrol({ secret: newTotpSecret(), code: '', error: '' });
  // Arriving from sign-in because the organization requires 2FA: start the setup straight away.
  useEffect(() => { if (params.get('setup') === '2fa' && !twoFactorOn(state) && !enrol) startEnrol(); }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const codeOk = /^\d{6}$/.test(enrol?.code || '');
  const me = state.users.find((u) => u.id === state.meId);
  const finishEnrol = async (e) => {
    e.preventDefault();
    if (!codeOk) return;
    if (!(await verifyTotp(enrol.secret, enrol.code))) { setEnrol({ ...enrol, code: '', error: 'That code isn’t right. Make sure your phone’s clock is correct and try the newest code.' }); return; }
    api.updateSettings({ security: { ...sec, twoFactor: true, totpSecret: enrol.secret, twoFactorSince: Date.now() } });
    setEnrol(null);
    if (params.get('setup')) setParams({}, { replace: true });
    toast('Two-factor authentication is on. You’ll be asked for a code each time you sign in.', { type: 'success' });
    api.logEvent('Two-factor authentication enabled', 'Account');
  };
  const finishDisable = async (e) => {
    e.preventDefault();
    if (!(await verifyTotp(sec.totpSecret, disabling.code))) { setDisabling({ code: '', error: 'That code isn’t right' }); return; }
    api.updateSettings({ security: { ...sec, twoFactor: false, totpSecret: null } });
    setDisabling(null);
    toast('Two-factor authentication turned off', { type: 'warning' });
    api.logEvent('Two-factor authentication disabled', 'Account');
  };
  return (
    <>
      <Section title="Password" desc="Use at least 8 characters with a mix of letters and numbers.">
        <form className="form narrow" onSubmit={changePassword}>
          <label className="field"><span className="field-label">Current password</span><input type="password" className="input" value={pw.cur} onChange={(e) => { setPw({ ...pw, cur: e.target.value }); setPwError(''); }} autoComplete="current-password" /></label>
          <label className="field"><span className="field-label">New password</span><input type="password" className="input" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
            {strength && <span className={`strength ${strength}`}><span /> {strength === 'strong' ? 'Strong' : strength === 'fair' ? 'Fair' : 'Too weak'}</span>}</label>
          <label className="field"><span className="field-label">Confirm new password</span><input type="password" className={`input ${err ? 'invalid' : ''}`} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" />{err && <span className="field-error">{err}</span>}</label>
          <div className="btn-row">
            <button className="btn btn-primary" disabled={!!pwProblem || pwBusy} aria-describedby={pwProblem ? 'pw-hint' : undefined}>Change password</button>
            {pwProblem && (pw.cur || pw.next || pw.confirm) && <span className="muted small" id="pw-hint">{pwProblem}</span>}
            {pwError && <span className="field-error" role="alert">{pwError}</span>}
          </div>
        </form>
      </Section>
      <Section title="Sign-in security">
        <SettingRow title="Two-factor authentication" desc="Require a verification code from your authenticator app.">
          <Switch checked={twoFactorOn(state) || !!enrol} disabled={required && twoFactorOn(state)} onChange={(v) => {
            if (v) { startEnrol(); return; }
            if (enrol) { setEnrol(null); return; }
            setDisabling({ code: '', error: '' });
          }} label="Two-factor authentication" />
        </SettingRow>
        {required && !twoFactorOn(state) && !enrol && <div className="banner warning" role="alert">Your organization requires two-factor authentication. Turn it on to keep using WorkDrive.</div>}
        {required && twoFactorOn(state) && <p className="muted small">Required by your organization, so it can’t be turned off.</p>}
        {disabling && (
          <form className="twofa-enrol" onSubmit={finishDisable} aria-label="Turn off two-factor authentication">
            <label className="field"><span className="field-label">To turn it off, enter a code from your authenticator app</span>
              <input className="input twofa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={disabling.code}
                onChange={(e) => setDisabling({ code: e.target.value.replace(/\D/g, '').slice(0, 6), error: '' })} placeholder="123456" />
              {disabling.error && <span className="field-error">{disabling.error}</span>}
            </label>
            <div className="btn-row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDisabling(null)}>Cancel</button>
              <button className="btn btn-danger btn-sm" disabled={disabling.code.length !== 6}>Turn off</button>
            </div>
          </form>
        )}
        {enrol && (
          <form className="twofa-enrol" onSubmit={finishEnrol} aria-label="Set up two-factor authentication">
            <ol className="twofa-steps">
              <li>In your authenticator app (Google Authenticator, Microsoft Authenticator, …) add an account by scanning this code:
                <img className="twofa-qr" alt="QR code for your authenticator app" src={`data:image/svg+xml;utf8,${encodeURIComponent(qrSvg(totpUri(enrol.secret, me?.email || 'account', 'WorkDrive')))}`} />
                <span className="muted small">Can’t scan it? Enter this key instead:</span>
                <code className="twofa-key">{groupSecret(enrol.secret)}</code></li>
              <li>
                <label className="field"><span className="field-label">Enter the 6-digit code from the app</span>
                  <input className="input twofa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
                    value={enrol.code} onChange={(e) => setEnrol({ ...enrol, code: e.target.value.replace(/\D/g, '').slice(0, 6), error: '' })} placeholder="123456" />
                  {enrol.error && <span className="field-error">{enrol.error}</span>}
                </label>
              </li>
            </ol>
            <div className="btn-row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEnrol(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" disabled={!codeOk}>Verify and turn on</button>
              {!codeOk && <span className="muted small">Enter all 6 digits</span>}
            </div>
          </form>
        )}
        <SettingRow title="New sign-in alerts" desc="Email me when my account is accessed from a new device.">
          <Switch checked={sec.loginAlerts} onChange={(v) => api.updateSettings({ security: { ...sec, loginAlerts: v } })} label="Sign-in alerts" />
        </SettingRow>
      </Section>
      <Section title="Active sessions" desc="Devices currently signed in to your account. Sign out any you don't recognise, then change your password."
        actions={sessions.length > 1 && <button className="btn btn-secondary btn-sm" onClick={() => { const n = api.endUserSessions(state.meId, sid); toast(`Signed out of ${n} other session${n === 1 ? '' : 's'}`, { type: 'success' }); }}>Sign out all others</button>}>
        <div className="session-list">
          {sessions.map((s) => (
            <div key={s.id} className="access-row big">
              <span className="notif-sys"><s.icon size={16} /></span>
              <div className="grow min0">
                <div className="strong">{s.device} {s.current && <span className="pill pill-green">This device</span>}</div>
                <div className="muted small">{s.location} · {s.ip} · signed in {formatDate(s.startedAt)} · {s.current ? 'active now' : `last active ${formatDate(s.lastActive)}`}</div>
              </div>
              {s.current
                ? <button className="btn btn-secondary btn-sm" onClick={() => api.signOut()}>Sign out</button>
                : <button className="btn btn-secondary btn-sm" onClick={() => { api.endSession(s.id, 'Signed out by the account owner'); toast(`Signed out ${s.device}`, { type: 'success' }); }}>Sign out</button>}
            </div>
          ))}
        </div>
        {recent.length > 0 && (
          <div className="recent-signins">
            <div className="setting-title">Recent sign-in activity</div>
            {recent.map((a) => <div key={a.id} className="muted small">{formatDateTime(a.at)} · {a.action}{a.details ? ` · ${a.details}` : ''}</div>)}
          </div>
        )}
      </Section>
    </>
  );
}

export function StorageBreakdown({ filter, total, quota }) {
  const { state } = useDrive();
  const byExt = usageByCategory(state, filter);
  const groups = {};
  for (const [ext, size] of Object.entries(byExt)) {
    const t = getFileType(ext);
    const key = t.category;
    groups[key] = groups[key] || { size: 0, color: t.color, label: { document: 'Documents', spreadsheet: 'Spreadsheets', presentation: 'Presentations', pdf: 'PDFs', image: 'Images', video: 'Videos', archive: 'Archives', text: 'Text', other: 'Other' }[key] || key };
    groups[key].size += size;
  }
  const list = Object.values(groups).sort((a, b) => b.size - a.size);
  return (
    <div className="storage-breakdown">
      <div className="stack-bar">{list.map((g) => <span key={g.label} style={{ width: `${(g.size / quota) * 100}%`, background: g.color }} title={`${g.label}: ${formatSize(g.size)}`} />)}</div>
      <div className="legend">
        {list.map((g) => <div key={g.label} className="legend-item"><span className="legend-dot" style={{ background: g.color }} />{g.label}<span className="muted">{formatSize(g.size)}</span></div>)}
        <div className="legend-item"><span className="legend-dot" style={{ background: 'var(--border)' }} />Free<span className="muted">{formatSize(Math.max(0, quota - total))}</span></div>
      </div>
    </div>
  );
}

function Backup() {
  return <Suspense fallback={<div className="muted small">Loading…</div>}><BackupPanel /></Suspense>;
}

function Storage() {
  const { state } = useDrive();
  const navigate = useNavigate();
  const used = myUsage(state);
  const quota = state.org.userQuota;
  const trash = Object.values(state.items).filter((i) => i.trashed && i.space === 'my').reduce((s, i) => s + i.size, 0);
  const largest = useMemo(() => Object.values(state.items).filter((i) => i.type === 'file' && i.space === 'my' && !i.trashed).sort((a, b) => b.size - a.size).slice(0, 5), [state.items]);
  return (
    <>
      <Section title="Storage usage" desc={`${formatSize(used)} of ${formatSize(quota)} used`}>
        <div className="big-meter"><ProgressBar value={(used / quota) * 100} tone={used / quota > 0.9 ? 'danger' : ''} /><span>{Math.round((used / quota) * 100)}%</span></div>
        <StorageBreakdown filter={(i) => i.space === 'my'} total={used} quota={quota} />
      </Section>
      <Section title="Free up space">
        <SettingRow title="Browser storage and backups" desc="See how much space this browser allows, keep your data from being cleared, and export a backup.">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/settings/backup')}>Backup & restore</button>
        </SettingRow>
        <SettingRow title="Trash" desc={`${formatSize(trash)} in Trash still counts toward your storage.`}><button className="btn btn-secondary btn-sm" onClick={() => navigate('/trash')}>Review Trash</button></SettingRow>
        <div className="largest">
          <div className="setting-title">Largest files</div>
          {largest.map((f) => <div key={f.id} className="access-row"><span className="grow truncate">{f.name}</span><span className="muted small">{formatSize(f.size)}</span></div>)}
        </div>
      </Section>
    </>
  );
}

export default function SettingsView() {
  const { tab = 'profile' } = useParams();
  if (!TABS.find((t) => t.id === tab)) return <Navigate to="/settings/profile" replace />;
  const Panel = { profile: Profile, preferences: Preferences, notifications: Notifications, appearance: Appearance, language: Language, security: Security, storage: Storage, backup: Backup }[tab];
  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Manage your personal account and preferences." />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {TABS.map((t) => <NavLink key={t.id} to={`/settings/${t.id}`} className={({ isActive }) => `settings-link ${isActive ? 'active' : ''}`}><t.icon size={16} /> {t.label}</NavLink>)}
        </nav>
        <div className="settings-content"><Panel /></div>
      </div>
    </div>
  );
}
