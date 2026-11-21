import { useMemo, useState } from 'react';
import { Share2, Link2, Globe2, Building2, Lock, X, Copy, Mail, CalendarClock, KeyRound, UserPlus, Download, Droplets, ExternalLink, Check, ShieldAlert, QrCode, Code2, Hourglass, Eye, EyeOff, Users, AlertTriangle } from 'lucide-react';
import { isGuest, defaultGuestExpiry, accessState } from '../../sharing/guests';
import { useDrive } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { effectiveShares, accessOf, canEdit, canManage } from '../../store/selectors';
import { toDateInput, fromDateInput, formatDate, formatDateTime } from '../../utils/format';
import { LINK_EVENTS, linkStatus } from '../../utils/sharing';
import { hashSecret, hasSecret } from '../../data/storage/secrets';
import { checkShare, summarize, isExternalUser } from '../../dlp/dlp';
import { Modal, Avatar, RoleSelect, Switch, FileIcon } from '../common';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VIA = { qr: 'via QR code', embed: 'via embed' };
const domainOf = (email) => String(email || '').split('@')[1]?.toLowerCase() || '';

export default function ShareDialog({ id, onClose }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const { toast } = ui;
  const item = state.items[id];
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState([]); // [{userId}] or {email}
  const [role, setRole] = useState('viewer');
  const [message, setMessage] = useState('');
  const [notify, setNotify] = useState(true);
  const [focus, setFocus] = useState(false);
  const [pwd, setPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [showAllLog, setShowAllLog] = useState(false);
  const [dlpPrompt, setDlpPrompt] = useState(null); // { kind, verdict, proceed } while a DLP warning is open

  const access = accessOf(state, item);
  const manage = canEdit(access);
  const policies = state.org.policies;

  // Include expired grants so owners can see (and renew) access that has run out.
  const shares = item ? effectiveShares(state.items, item.id, { includeExpired: true }) : [];
  const owner = item ? state.users.find((u) => u.id === item.ownerId) : null;
  const team = item?.space.startsWith('t') ? state.teams.find((t) => t.id === item.space) : null;

  const orgDomain = String(state.org.domain || '').toLowerCase();
  /** Why sharing with this address isn't allowed by the admin's sharing policy (null when it is). */
  const policyBlock = (email) => {
    const domain = domainOf(email);
    if (domain === orgDomain) return null;
    if (!policies.externalSharing) return 'External sharing is disabled by your administrator';
    const allowed = String(policies.allowedDomains || '').split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
    if (allowed.length && !allowed.includes(domain)) return `Sharing with @${domain} is not allowed by policy`;
    return null;
  };

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.users.filter((u) => u.id !== state.meId && u.id !== item?.ownerId && !shares.some((s) => s.userId === u.id) && !pending.some((p) => p.userId === u.id)
      && (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))).slice(0, 6)
      .map((u) => ({ user: u, blocked: policyBlock(u.email) }));
  }, [query, state.users, shares, pending, state.meId, item, policies]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;

  /** Refuse yourself, the owner, someone who already has access or is already listed, and addresses the policy blocks. */
  const addPending = (u) => {
    if (u.id === state.meId) { toast('You already have access to this item', { type: 'info' }); return; }
    if (u.id === item.ownerId) { toast(`${u.name} owns this ${item.type}`, { type: 'info' }); return; }
    if (pending.some((p) => p.userId === u.id)) { toast(`${u.name} is already in the list`, { type: 'info' }); return; }
    if (shares.some((s) => s.userId === u.id)) { toast(`${u.name} already has access. Change their permission below.`, { type: 'info' }); return; }
    const blocked = policyBlock(u.email);
    if (blocked) { toast(blocked, { type: 'error' }); return; }
    setPending((p) => [...p, { userId: u.id }]);
    setQuery('');
  };
  const addEmail = () => {
    const v = query.trim().replace(/[,;]$/, '');
    if (!v) return;
    const existing = state.users.find((u) => u.email.toLowerCase() === v.toLowerCase());
    if (existing) { addPending(existing); return; }
    if (!EMAIL.test(v)) { toast('Enter a valid email address', { type: 'error' }); return; }
    if (pending.some((p) => p.email && p.email.toLowerCase() === v.toLowerCase())) { toast(`${v} is already in the list`, { type: 'info' }); return; }
    const blocked = policyBlock(v);
    if (blocked) { toast(blocked, { type: 'error' }); return; }
    setPending((p) => [...p, { email: v }]);
    setQuery('');
  };

  /**
   * Data loss prevention gate. kind: 'public' | 'external'. Runs `proceed` when the policy allows it,
   * shows an in-dialog warning when it warns, and refuses (with a reason) when it blocks.
   */
  const guarded = (kind, proceed) => {
    const verdict = checkShare(state, item, kind);
    if (verdict.decision === 'allow') { proceed(); return; }
    const what = kind === 'public' ? 'Public link' : 'Sharing outside the organization';
    if (verdict.decision === 'block') {
      api.logEvent('Share blocked (DLP)', item.name, `${what} · ${verdict.files.length} file(s) with sensitive data`, { itemId: item.id });
      toast(`${what} blocked: this ${item.type} contains sensitive data (${summarize(verdict.files[0].findings, 2)})`, { type: 'error', duration: 7000 });
      return;
    }
    setDlpPrompt({ kind, verdict, proceed });
  };

  // Decided by email domain: a new address at your own domain is a colleague (Member), not a guest.
  const isExternalPending = (p) => (p.userId ? isExternalUser(state, state.users.find((u) => u.id === p.userId)) : domainOf(p.email) !== orgDomain);
  const send = () => (pending.some(isExternalPending) ? guarded('external', doSend) : doSend());
  const guestExpiry = defaultGuestExpiry(state);
  const doSend = () => {
    const now = Date.now();
    const entries = [];
    for (const p of pending) {
      let userId = p.userId;
      const external = isExternalPending(p);
      if (!userId) {
        // New address: invite them (colleagues at your domain join as Members, everyone else as Guests).
        userId = api.addUser({ name: p.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), email: p.email, role: external ? 'Guest' : 'Member', invitedBy: state.meId });
      }
      // People outside the organization get time-limited access (admin policy); they can be renewed later.
      entries.push({ userId, role, sharedAt: now, sharedBy: state.meId, ...(external && guestExpiry ? { expires: guestExpiry } : {}) });
    }
    api.setShares(item.id, [...item.sharedWith, ...entries]);
    toast(`Shared "${item.name}" with ${entries.length} ${entries.length === 1 ? 'person' : 'people'}${notify ? ' · notification sent' : ''}`, { type: 'success' });
    setPending([]);
    setMessage('');
  };

  const changeRole = (userId, r) => {
    api.setShares(item.id, item.sharedWith.map((s) => (s.userId === userId ? { ...s, role: r } : s)));
    toast('Permission updated', { type: 'success' });
  };
  const remove = (userId) => {
    const u = state.users.find((x) => x.id === userId);
    const entry = item.sharedWith.find((s) => s.userId === userId);
    api.setShares(item.id, item.sharedWith.filter((s) => s.userId !== userId));
    toast(`Removed access for ${u?.name}`, {
      type: 'success',
      action: entry ? { label: 'Undo', onClick: () => { const cur = api.get().items[item.id]?.sharedWith || []; if (!cur.some((s) => s.userId === userId)) api.setShares(item.id, [...cur, entry]); } } : null,
    });
  };

  const link = item.link || { enabled: false, access: 'org', role: 'viewer', expires: null, password: false };
  const setLink = (patch) => api.setLink(item.id, { ...link, ...patch });
  const linkUrl = `${window.location.origin}/link/${item.id}`;
  // Admin policy: public links must have a password (the toggle is locked on and the link waits for one).
  const pwdForced = !!policies.linkPasswordRequired && link.access === 'anyone';
  const pwdOn = !!link.password || pwdForced;
  const pwdSet = hasSecret(link);
  // Only a PBKDF2 digest of the password is stored (secretHash); hashing is async, so re-read the link afterwards.
  const savePassword = async () => {
    setSavingPwd(true);
    try {
      const secretHash = await hashSecret(pwd);
      const cur = api.get().items[item.id]?.link || link;
      api.setLink(item.id, { ...cur, secret: null, secretHash, password: true });
      setPwd(''); setShowPwd(false);
      toast('Link password saved', { type: 'success' });
    } catch (e) {
      toast(e?.message || 'Could not save the password', { type: 'error' });
    } finally {
      setSavingPwd(false);
    }
  };
  const status = linkStatus(state, item);

  /** Turn link sharing on through the same checks as the switch (public-link policy, DLP). `after(turnedOn)` runs once it is on. */
  const enableLink = (after) => {
    if (link.enabled) { after?.(false); return; }
    if (link.access === 'anyone' && policies.publicLinks) {
      guarded('public', () => { setLink({ enabled: true, ...(policies.linkPasswordRequired ? { password: true } : {}) }); after?.(true); });
      return;
    }
    setLink({ enabled: true, ...(link.access === 'anyone' ? { access: 'org' } : {}) });
    after?.(true);
  };
  const writeLink = async (msg) => {
    try { await navigator.clipboard.writeText(linkUrl); toast(msg, { type: 'success' }); }
    catch { toast(linkUrl, { type: 'info', duration: 8000 }); }
  };
  const copy = () => (!link.enabled && !manage ? toast('Link sharing is off. Only owners and editors can turn it on.', { type: 'info' }) : enableLink((turnedOn) => writeLink(turnedOn ? 'Link sharing turned on and copied' : 'Link copied to clipboard')));

  // Closing with people still in the "to share" list asks first, so invites aren't dropped silently.
  const requestClose = () => {
    if (!pending.length) { onClose(); return; }
    ui.openDialog('confirm', {
      title: `Discard ${pending.length} pending invite${pending.length === 1 ? '' : 's'}?`,
      message: 'The people you added haven’t been sent anything yet.',
      confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true,
      onConfirm: onClose,
    });
  };
  const clearLog = () => {
    const prev = item.linkLog || [];
    api.clearLinkLog(item.id);
    toast('Link activity cleared', {
      type: 'success',
      action: { label: 'Undo', onClick: () => { const cur = api.get().items[item.id]?.linkLog || []; api.updateItem(item.id, { linkLog: [...cur, ...prev].slice(0, 300) }, { touch: false }); } },
    });
  };
  const teamManage = !!team && (canManage(access) || state.users.find((u) => u.id === state.meId)?.role === 'Admin');

  const limitHit = !!link.maxDownloads && (link.downloads || 0) >= link.maxDownloads;
  const forcedWm = link.access === 'anyone' && !!policies.watermarkPublicLinks;
  const log = item.linkLog || [];
  const stats = {
    views: log.filter((e) => e.event === 'viewed').length,
    downloads: log.filter((e) => e.event === 'downloaded').length,
    failed: log.filter((e) => e.event === 'password-failed').length,
    visitors: new Set(log.filter((e) => e.event === 'viewed').map((e) => e.who?.email || `${e.ip}|${e.device}`)).size,
  };

  const ROLE_HELP = { viewer: 'Can view and download', commenter: 'Can view and comment', editor: 'Can view, edit and share' };

  return (
    <Modal title={<span className="share-title">Share <span className="share-item"><FileIcon item={item} size={20} /> <span className="truncate">{item.name}</span></span></span>}
      onClose={requestClose} width={560} icon={<Share2 size={20} />}
      footer={<>
        <button className="btn btn-secondary" onClick={copy}><Link2 size={15} /> Copy link</button>
        <span className="grow" />
        {pending.length > 0 ? (
          <>
            <button className="btn btn-secondary" onClick={() => setPending([])}>Cancel</button>
            <button className="btn btn-primary" onClick={send}><Mail size={15} /> Share</button>
          </>
        ) : <button className="btn btn-primary" onClick={onClose}>Done</button>}
      </>}>
      {!manage && <div className="banner warning">You have {access} access. Only owners and editors can change sharing.</div>}
      {dlpPrompt && (
        <div className="dlp-prompt" role="alertdialog" aria-label="Sensitive data warning">
          <div className="dlp-prompt-head"><ShieldAlert size={18} /> <strong>{dlpPrompt.kind === 'public' ? 'Make this public?' : `Share outside ${state.org.name}?`}</strong></div>
          <p className="small">This {item.type} contains sensitive data. {dlpPrompt.kind === 'public' ? 'Anyone with the link could see it.' : 'People outside your organization could see it.'}</p>
          <ul className="dlp-files">
            {dlpPrompt.verdict.files.slice(0, 4).map(({ item: f, findings }) => <li key={f.id}><strong>{f.name}</strong> <span className="muted">· {summarize(findings)}</span></li>)}
            {dlpPrompt.verdict.files.length > 4 && <li className="muted">and {dlpPrompt.verdict.files.length - 4} more files</li>}
          </ul>
          <div className="btn-row end">
            <button className="btn btn-secondary btn-sm" onClick={() => setDlpPrompt(null)}>Cancel</button>
            <button className="btn btn-danger btn-sm" onClick={() => {
              api.logEvent('DLP warning overridden', item.name, `${dlpPrompt.kind === 'public' ? 'Public link' : 'External sharing'} · ${summarize(dlpPrompt.verdict.files[0].findings, 2)}`, { itemId: item.id });
              dlpPrompt.proceed();
              setDlpPrompt(null);
            }}>Share anyway</button>
          </div>
        </div>
      )}

      {team && (
        <div className="banner info share-team-note">
          <Users size={16} />
          <span className="grow">People get access to team folder files through team membership.</span>
          <button className="btn btn-secondary btn-sm" onClick={() => ui.openDialog('teamMembers', { teamId: team.id })}>{teamManage ? 'Manage members' : 'View members'}</button>
        </div>
      )}
      {manage && !team && (
        <div className="share-add">
          <div className={`people-input ${focus ? 'focus' : ''}`}>
            {pending.map((p, i) => {
              const u = p.userId && state.users.find((x) => x.id === p.userId);
              return (
                <span key={i} className="token">
                  {u ? <Avatar user={u} size={18} /> : <Mail size={13} />}
                  {u ? u.name : p.email}
                  <button onClick={() => setPending(pending.filter((_, j) => j !== i))} aria-label="Remove"><X size={12} /></button>
                </span>
              );
            })}
            <input
              value={query}
              placeholder={pending.length ? 'Add more…' : 'Add people or email addresses'}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocus(true)}
              onBlur={() => setTimeout(() => setFocus(false), 150)}
              onKeyDown={(e) => {
                if (['Enter', ',', ';', 'Tab'].includes(e.key) && query.trim()) {
                  e.preventDefault();
                  const first = suggestions.find((x) => !x.blocked);
                  if (query.includes('@')) addEmail();
                  else if (first) addPending(first.user);
                  else if (suggestions[0]) toast(suggestions[0].blocked, { type: 'error' });
                  else addEmail();
                }
                if (e.key === 'Backspace' && !query && pending.length) setPending(pending.slice(0, -1));
              }}
              aria-label="Add people or email addresses"
            />
            <RoleSelect value={role} onChange={setRole} small />
          </div>
          {focus && (suggestions.length > 0 || query.includes('@')) && (
            <div className="people-suggest pop-in">
              {suggestions.map(({ user: u, blocked }) => (
                <button key={u.id} className={`suggest-row ${blocked ? 'is-blocked' : ''}`} aria-disabled={!!blocked} title={blocked || undefined}
                  onMouseDown={(e) => { e.preventDefault(); if (blocked) toast(blocked, { type: 'error' }); else addPending(u); }}>
                  <Avatar user={u} size={28} />
                  <span className="min0"><span className="strong">{u.name}</span><span className="muted small block truncate">{blocked || u.email}</span></span>
                </button>
              ))}
              {query.includes('@') && !suggestions.length && (
                <button className="suggest-row" onMouseDown={(e) => { e.preventDefault(); addEmail(); }}>
                  <span className="notif-sys"><UserPlus size={15} /></span><span>Invite <strong>{query.trim()}</strong></span>
                </button>
              )}
            </div>
          )}
          {pending.length > 0 && (
            <div className="share-compose">
              <div className="muted small">{ROLE_HELP[role]}</div>
              <textarea className="input textarea" rows={2} placeholder="Add a message (optional)" value={message} onChange={(e) => setMessage(e.target.value)} />
              <label className="check-row"><input type="checkbox" className="cb" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify people by email</label>
              {guestExpiry && pending.some(isExternalPending) && <div className="muted small"><Hourglass size={12} /> Access for people outside {state.org.name} ends {formatDate(guestExpiry)}. You can change this after sharing.</div>}
            </div>
          )}
        </div>
      )}

      <div className="share-section">
        <div className="share-section-title">People with access</div>
        {team && (
          <div className="access-row big">
            <span className="team-dot" style={{ background: team.color }}><Building2 size={14} /></span>
            <div className="grow min0"><div className="strong">{team.name} team</div><div className="muted small">{team.members.length} members · access via team folder</div></div>
            <span className="muted small">Team roles</span>
          </div>
        )}
        {!team && owner && (
          <div className="access-row big">
            <Avatar user={owner} size={32} />
            <div className="grow min0"><div className="strong truncate">{owner.name}{owner.id === state.meId && ' (you)'}</div><div className="muted small truncate">{owner.email}</div></div>
            <span className="muted small">Owner</span>
          </div>
        )}
        {!team && shares.map((s) => {
          const u = state.users.find((x) => x.id === s.userId);
          if (!u) return null;
          const direct = !s.inheritedFrom;
          const guest = isGuest(state, u);
          const ex = accessState(s.expires);
          return (
            <div key={s.userId} className={`access-row big ${ex === 'expired' ? 'is-expired' : ''}`}>
              <Avatar user={u} size={32} />
              <div className="grow min0">
                <div className="strong truncate">{u.name}{u.id === state.meId && ' (you)'} {guest && <span className="pill pill-blue">Guest</span>} {u.status === 'invited' && <span className="pill pill-amber">Invited</span>}</div>
                <div className="muted small truncate">{s.inheritedFrom ? `Inherited from “${s.inheritedFrom}”` : `${u.email}${s.sharedAt ? ' · shared ' + formatDate(s.sharedAt) : ''}`}</div>
                {(s.expires || (guest && direct && manage)) && (
                  <div className={`access-expiry ex-${ex}`}>
                    <Hourglass size={12} />
                    {ex === 'expired' ? <span>Access ended {formatDate(s.expires)}</span> : s.expires ? <span>Access ends {formatDate(s.expires)}</span> : <span>Access never ends</span>}
                    {manage && direct && (
                      <>
                        <input type="date" className="input input-date" value={toDateInput(s.expires)} min={toDateInput(Date.now())} aria-label={`Access ends for ${u.name}`}
                          onChange={(e) => { const exp = fromDateInput(e.target.value); if (!exp) return; api.setShareExpiry(item.id, s.userId, exp); toast(`Access ends ${formatDate(exp)}`, { type: 'success' }); }} />
                        {s.expires && <button className="btn btn-secondary btn-sm" onClick={() => { api.setShareExpiry(item.id, s.userId, null); toast('Access end date removed', { type: 'success' }); }}>Remove end date</button>}
                      </>
                    )}
                  </div>
                )}
              </div>
              {manage && direct ? (
                <>
                  <RoleSelect value={s.role} onChange={(r) => changeRole(s.userId, r)} small />
                  <button className="icon-btn sm" onClick={() => remove(s.userId)} data-tip="Remove access" aria-label={`Remove access for ${u.name}`}><X size={15} /></button>
                </>
              ) : <span className="muted small cap">{s.role}</span>}
            </div>
          );
        })}
        {!shares.length && !team && <div className="muted small pad-y">Not shared with anyone yet.</div>}
      </div>

      <div className="share-section link-section">
        <div className="share-section-title">
          <span>Link sharing</span>
          <Switch checked={link.enabled} onChange={(v) => {
            if (v) enableLink(() => toast('Link sharing turned on', { type: 'success' }));
            else { setLink({ enabled: false }); toast('Link sharing turned off', { type: 'success' }); }
          }} label="Link sharing" disabled={!manage} />
        </div>
        {link.enabled ? (
          <div className="link-box">
            <div className="link-row">
              <span className="link-icon">{link.access === 'anyone' ? <Globe2 size={18} /> : link.access === 'org' ? <Building2 size={18} /> : <Lock size={18} />}</span>
              <select className="select" value={link.access} onChange={(e) => { const access = e.target.value; if (access === 'anyone') guarded('public', () => setLink({ access, ...(policies.linkPasswordRequired ? { password: true } : {}) })); else setLink({ access }); }} disabled={!manage} aria-label="Who can use the link">
                <option value="restricted">Restricted — only people added</option>
                <option value="org">Anyone at {state.org.name}</option>
                <option value="anyone" disabled={!policies.publicLinks}>Anyone with the link{!policies.publicLinks ? ' (disabled by admin)' : ''}</option>
              </select>
              <RoleSelect value={link.role} onChange={(r) => setLink({ role: r })} small disabled={!manage} />
            </div>
            {status.reason === 'public-off' && <div className="banner warning small"><AlertTriangle size={14} /> Public links are turned off by your administrator, so this link doesn’t work. Choose who can use it above.</div>}
            {status.reason === 'needs-password' && <div className="banner warning small"><KeyRound size={14} /> Set a password to activate this link. Your administrator requires one for public links.</div>}
            {status.reason === 'expired' && <div className="banner warning small"><CalendarClock size={14} /> This link expired {formatDate(link.expires)}. Change or remove the expiry date to turn it back on.</div>}
            <div className="link-url">
              <input className="input" readOnly value={linkUrl} onFocus={(e) => e.target.select()} aria-label="Share link" />
              <button className="btn btn-secondary" onClick={copy}><Copy size={14} /> Copy</button>
            </div>
            <div className="link-tools">
              <button className="btn btn-secondary btn-sm" onClick={() => ui.pushDialog('linkTools', { itemId: item.id, tab: 'qr' })}><QrCode size={14} /> QR code</button>
              {item.type === 'file' && <button className="btn btn-secondary btn-sm" onClick={() => ui.pushDialog('linkTools', { itemId: item.id, tab: 'embed' })}><Code2 size={14} /> Embed</button>}
            </div>
            <div className="link-opts">
              <label className="link-opt">
                <CalendarClock size={16} className="muted" />
                <span className="grow">Link expires<span className="muted small block">{link.expires ? `At the end of ${formatDate(link.expires)}` : 'Never'}</span></span>
                <input type="date" className="input input-date" value={toDateInput(link.expires)} min={toDateInput(Date.now())} disabled={!manage} aria-label="Link expires"
                  onChange={(e) => { const exp = fromDateInput(e.target.value); if (exp) setLink({ expires: exp }); }} />
                {link.expires && manage && <button type="button" className="icon-btn sm" onClick={(e) => { e.preventDefault(); setLink({ expires: null }); }} aria-label="Remove link expiry date" data-tip="Never expires"><X size={15} /></button>}
              </label>
              <div className="link-opt">
                <KeyRound size={16} className="muted" />
                <span className="grow">Password protection{policies.linkPasswordRequired && <span className="muted small"> (required by policy)</span>}</span>
                <Switch checked={pwdOn} onChange={(v) => setLink({ password: v, ...(v ? {} : { secret: null, secretHash: null }) })} label="Password protection" disabled={!manage || pwdForced} />
              </div>
              {pwdOn && manage && (
                <div className="link-opt sub">
                  {pwdSet && !pwd ? <span className="grow muted small"><Check size={13} /> Password is set</span>
                    : <span className="grow muted small">{pwdSet ? 'New password' : pwdForced ? 'Set a password to activate this link' : 'Set a password — until then the link opens without one'}</span>}
                  <span className="pwd-field">
                    <input type={showPwd ? 'text' : 'password'} className="input input-sm" placeholder={pwdSet ? 'Change password' : 'Set link password'} value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" aria-label="Link password" />
                    <button type="button" className="icon-btn sm" onClick={() => setShowPwd(!showPwd)} aria-label={showPwd ? 'Hide password' : 'Show password'} aria-pressed={showPwd}>{showPwd ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                  </span>
                  <button className="btn btn-secondary btn-sm" disabled={pwd.length < 4 || savingPwd} onClick={savePassword}>{savingPwd ? 'Saving…' : 'Save'}</button>
                </div>
              )}
              <div className="link-opt">
                <Download size={16} className="muted" />
                <span className="grow">Allow download<span className="muted small block">{link.allowDownload === false ? 'View only: no download, copy or right-click' : 'People with the link can download'}</span></span>
                <Switch checked={link.allowDownload !== false} onChange={(v) => setLink({ allowDownload: v })} label="Allow download" disabled={!manage} />
              </div>
              {link.allowDownload !== false && (
                <div className="link-opt sub">
                  <span className="grow">Download limit{link.maxDownloads ? <span className="muted small block">{link.downloads || 0} of {link.maxDownloads} used{limitHit ? ' · limit reached' : ''}</span> : null}</span>
                  {link.downloads > 0 && link.maxDownloads && manage && <button className="link-btn" onClick={() => { api.resetLinkDownloads(item.id); toast('Download count reset', { type: 'success' }); }}>Reset</button>}
                  <select className="select select-sm" value={link.maxDownloads || ''} onChange={(e) => setLink({ maxDownloads: e.target.value ? Number(e.target.value) : null })} disabled={!manage} aria-label="Download limit">
                    <option value="">No limit</option>
                    {[1, 3, 5, 10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} download{n === 1 ? '' : 's'}</option>)}
                  </select>
                </div>
              )}
              <div className="link-opt">
                <Droplets size={16} className="muted" />
                <span className="grow">Watermark previews<span className="muted small block">{forcedWm ? 'Required by your administrator for public links' : 'Overlays the viewer’s email (or connection details) on the file'}</span></span>
                <Switch checked={!!link.watermark || forcedWm} onChange={(v) => setLink({ watermark: v })} label="Watermark previews" disabled={!manage || forcedWm} />
              </div>
            </div>
            <a className="link-btn preview-as" href={`/link/${item.id}?as=guest`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Preview as an outside visitor</a>
          </div>
        ) : (
          <div className="muted small">Turn on link sharing to let others open this {item.type} with a link.</div>
        )}
      </div>

      {log.length > 0 && (
        <div className="share-section">
          <div className="share-section-title">
            <span>Link activity</span>
            {manage && <button className="link-btn" onClick={clearLog}>Clear</button>}
          </div>
          <div className="link-stats">
            <span><strong>{stats.views}</strong> view{stats.views === 1 ? '' : 's'}</span>
            <span><strong>{stats.downloads}</strong> download{stats.downloads === 1 ? '' : 's'}</span>
            <span><strong>{stats.visitors}</strong> visitor{stats.visitors === 1 ? '' : 's'}</span>
            {stats.failed > 0 && <span className="warn-text"><strong>{stats.failed}</strong> failed password{stats.failed === 1 ? '' : 's'}</span>}
          </div>
          <ul className="link-log">
            {log.slice(0, showAllLog ? 100 : 5).map((e) => {
              const ev = LINK_EVENTS[e.event] || { label: e.event, tone: 'gray' };
              return (
                <li key={e.id}>
                  <span className={`log-dot tone-${ev.tone}`} />
                  <div className="grow min0">
                    <div className="truncate"><strong>{e.who ? e.who.name : 'Anonymous visitor'}</strong> <span className="muted">· {ev.label.toLowerCase()}{e.file && e.file !== item.name ? ` “${e.file}”` : ''}{e.via ? ` ${VIA[e.via] || ''}` : ''}</span></div>
                    <div className="muted small truncate">{formatDateTime(e.at)} · {e.device}{e.ip ? ` · ${e.ip}` : ''}{e.who?.email ? ` · ${e.who.email}` : ''}</div>
                  </div>
                </li>
              );
            })}
          </ul>
          {log.length > 5 && <button className="link-btn" onClick={() => setShowAllLog(!showAllLog)}>{showAllLog ? 'Show less' : `Show all ${log.length}`}</button>}
        </div>
      )}
    </Modal>
  );
}
