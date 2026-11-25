import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserRoundSearch, Search, ChevronDown, ChevronRight, MoreVertical, CalendarPlus, CalendarX2, Hourglass, Trash2, Ban, CheckCircle2,
  Download, Eraser, X, Globe2, FolderKanban, Mail,
} from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { folderRoute, parentRoute } from '../store/selectors';
import { formatDate, formatDateTime, toDateInput, fromDateInput, pastDateError } from '../utils/format';
import { Avatar, Modal, EmptyState, FileIcon, FolderGlyph } from '../components/common';
import { Section, SettingRow } from '../views/SettingsView';
import { guestRows, guestsCsv, ACCESS_STATE, DAY } from './guests';

const ITEM_ROLES = ['viewer', 'commenter', 'editor'];
const TEAM_ROLES = ['viewer', 'editor', 'organizer'];
const ROLE_VERB = { viewer: 'view', commenter: 'comment on', editor: 'edit', organizer: 'organize', admin: 'manage' };
const FILTERS = [
  { id: 'all', label: 'All guests' },
  { id: 'expiring', label: 'Expiring within 7 days' },
  { id: 'expired', label: 'Access expired' },
  { id: 'open', label: 'Has access with no expiry' },
  { id: 'invited', label: 'Invite not accepted' },
  { id: 'none', label: 'No access left' },
];
const endOfDay = (t) => new Date(t).setHours(23, 59, 59, 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function relDays(t, now = Date.now()) {
  const d = Math.round((endOfDay(t) - endOfDay(now)) / DAY);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

function ExpiryChip({ expires, trashed }) {
  if (trashed) return <span className="pill pill-gray">In trash</span>;
  const st = !expires ? 'open' : expires <= Date.now() ? 'expired' : expires - Date.now() <= 7 * DAY ? 'expiring' : 'active';
  return (
    <span className={`pill ${ACCESS_STATE[st].pill}`} title={expires ? formatDateTime(expires) : 'Access never ends'}>
      <Hourglass size={11} /> {expires ? `${st === 'expired' ? 'Ended' : 'Ends'} ${formatDate(expires)}` : 'No end date'}
    </span>
  );
}

/** Set one expiration date for several of a guest's resources. */
function BulkExpiryDialog({ row, keys, onClose }) {
  const { api } = useDrive();
  const { toast } = useUI();
  const n = keys ? keys.length : row.resources.length;
  const single = keys && keys.length === 1 ? row.resources.find((r) => r.key === keys[0]) : null;
  const [date, setDate] = useState(toDateInput(single?.expires && single.expires > Date.now() ? single.expires : Date.now() + 30 * DAY));
  const apply = (exp) => {
    api.setGuestExpiry(row.user.id, exp, keys);
    toast(exp && typeof exp === 'object' ? `Access extended by ${exp.extendDays} days` : exp ? `Access now ends on ${formatDate(exp)}` : 'Expiration removed', { type: 'success' });
    onClose();
  };
  return (
    <Modal title="Change when access ends" subtitle={`${row.user.name} · ${single ? single.name : plural(n, 'resource')}`} onClose={onClose} width={440} icon={<Hourglass size={18} />}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!fromDateInput(date) || !!pastDateError(date)} onClick={() => apply(fromDateInput(date))}>Set date</button></>}>
      <label className="field"><span className="field-label">Access ends</span>
        <input className="input" type="date" value={date} min={toDateInput(Date.now())} onChange={(e) => setDate(e.target.value)} data-autofocus aria-invalid={!!pastDateError(date) || undefined} />
        {pastDateError(date) && <span className="field-error">{pastDateError(date)}</span>}
      </label>
      <div className="chip-row">
        {[7, 30, 90].map((d) => <button key={d} type="button" className="btn btn-secondary btn-sm" onClick={() => setDate(toDateInput(Date.now() + d * DAY))}>{d} days from today</button>)}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => apply({ extendDays: 30 })}>{single ? 'Extend by 30 days' : 'Extend each by 30 days'}</button>
      </div>
      <p className="muted small">Guests lose access at the end of that day. Expired access can be renewed here at any time.</p>
      <button type="button" className="link-btn" onClick={() => apply(null)}><CalendarX2 size={13} /> Remove the end date (access never ends)</button>
    </Modal>
  );
}

function ResourceRows({ row, onChangeExpiry }) {
  const { state, api } = useDrive();
  const ui = useUI();
  const navigate = useNavigate();
  const open = (r) => {
    if (r.kind === 'team') navigate(`/team-folders/${r.id}`);
    else if (r.item.type === 'folder') navigate(folderRoute(r.item));
    else navigate(`${parentRoute(state, r.item)}?preview=${r.id}`);
  };
  if (!row.resources.length) return <div className="guest-empty muted small">No files, folders or team folders are shared with {row.user.name.split(' ')[0]}.</div>;
  return (
    <table className="table guest-res">
      <thead><tr><th>Resource</th><th>Access</th><th className="hide-sm">Shared by</th><th>Access ends</th><th /></tr></thead>
      <tbody>
        {row.resources.map((r) => {
          const by = state.users.find((u) => u.id === r.sharedBy);
          // Team roles: Viewer / Editor / Organizer (Admin only shown when the guest already has it).
          const roles = r.kind === 'team' ? (r.role === 'admin' ? [...TEAM_ROLES, 'admin'] : TEAM_ROLES) : ITEM_ROLES;
          return (
            <tr key={r.key} className={r.state === 'expired' || r.trashed ? 'is-expired' : ''}>
              <td data-label="Resource">
                <div className="cell-name-inline">
                  {r.kind === 'team' ? <FolderGlyph size={22} color={r.team.color} team /> : <FileIcon item={r.item} size={22} />}
                  <div className="min0">
                    <button className="link-btn strong truncate block" onClick={() => open(r)} disabled={r.trashed}>{r.name}</button>
                    <div className="muted small truncate">{r.kind === 'team' ? <><FolderKanban size={11} /> Team folder member</> : r.location}</div>
                  </div>
                </div>
              </td>
              <td data-label="Access">
                <select className="select select-sm" value={roles.includes(r.role) ? r.role : roles[0]} aria-label={`Access to ${r.name}`}
                  onChange={(e) => { api.setGuestRole(row.user.id, r.key, e.target.value); ui.toast(`${row.user.name} can now ${ROLE_VERB[e.target.value] || 'open'} ${r.name}`, { type: 'success' }); }}>
                  {roles.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
                </select>
              </td>
              <td className="hide-sm muted small" data-label="Shared by">{by?.name || '—'}{r.sharedAt ? <div>{formatDate(r.sharedAt)}</div> : null}</td>
              <td data-label="Access ends">
                <div className="guest-exp">
                  <ExpiryChip expires={r.expires} trashed={r.trashed} />
                  {!r.trashed && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChangeExpiry(r)} aria-label={`Change when access to ${r.name} ends`}>Change…</button>}
                  {!r.trashed && r.expires && (
                    <button type="button" className="link-btn small" aria-label={`Remove the end date for ${r.name}`}
                      onClick={() => {
                        const prev = r.expires;
                        const setExp = (v) => (r.kind === 'team' ? api.setMemberExpiry(r.id, row.user.id, v) : api.setShareExpiry(r.id, row.user.id, v));
                        setExp(null);
                        ui.toast(`Access to ${r.name} no longer ends`, { type: 'success', action: { label: 'Undo', onClick: () => setExp(prev) } });
                      }}>Remove end date</button>
                  )}
                </div>
                {r.expires && !r.trashed && <div className="muted small">{r.state === 'expired' ? `ended ${relDays(r.expires)}` : `ends ${relDays(r.expires)}`}</div>}
              </td>
              <td className="t-right guest-res-actions">
                <button className="icon-btn sm" aria-label={`Remove access to ${r.name}`} data-tip="Remove access"
                  onClick={() => ui.openDialog('confirm', {
                    title: `Remove access to “${r.name}”?`, message: `${row.user.name} will no longer be able to open it.`, confirmLabel: 'Remove access', danger: true,
                    onConfirm: () => { api.revokeGuestAccess(row.user.id, [r.key]); ui.toast(`Removed ${row.user.name}’s access to ${r.name}`, { type: 'success' }); },
                  })}><X size={15} /></button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function GuestsTab() {
  const { state, api } = useDrive();
  const ui = useUI();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState('all');
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(() => new Set());
  const [bulk, setBulk] = useState(null); // { row, keys }
  const rows = useMemo(() => guestRows(state), [state]);
  const domains = useMemo(() => [...new Set(rows.map((r) => r.domain))].sort(), [rows]);
  const p = state.org.policies;

  const list = rows.filter((r) => {
    if (domain !== 'all' && r.domain !== domain) return false;
    if (filter === 'expiring' && !r.expiring) return false;
    if (filter === 'expired' && !r.expired) return false;
    if (filter === 'open' && !r.noExpiry) return false;
    if (filter === 'invited' && r.user.status !== 'invited') return false;
    if (filter === 'none' && r.live) return false;
    const t = q.trim().toLowerCase();
    return !t || `${r.user.name} ${r.user.email} ${r.user.dept || ''}`.toLowerCase().includes(t) || r.resources.some((x) => x.name.toLowerCase().includes(t));
  }).sort((a, b) => (a.nextExpiry || Infinity) - (b.nextExpiry || Infinity) || a.user.name.localeCompare(b.user.name));

  const totals = {
    guests: rows.length,
    domains: domains.length,
    grants: rows.reduce((s, r) => s + r.live, 0),
    expiring: rows.reduce((s, r) => s + r.expiring, 0),
    expired: rows.reduce((s, r) => s + r.expired, 0),
    open: rows.reduce((s, r) => s + r.noExpiry, 0),
  };

  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([guestsCsv(state, list)], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'external-collaborators.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  // Only guests' grants are purged (the same ones counted here), never members' access.
  const purge = () => ui.openDialog('confirm', {
    title: 'Remove all expired access?', message: `${plural(totals.expired, 'expired grant')} will be deleted from files and team folders. Guests already can’t use them; this just tidies up the list.`,
    confirmLabel: `Remove ${totals.expired} expired`, onConfirm: () => { const n = api.purgeExpiredAccess(rows.map((r) => r.user.id)); ui.toast(n ? `${plural(n, 'expired grant')} removed` : 'Nothing to remove', { type: 'success' }); },
  });
  const menu = (e, r) => {
    const rect = e.currentTarget.getBoundingClientRect();
    ui.showMenu({ x: rect.right - 230, y: rect.bottom + 4 }, [
      { label: 'Extend all access by 30 days', icon: CalendarPlus, disabled: !r.resources.length, onClick: () => { api.setGuestExpiry(r.user.id, { extendDays: 30 }); ui.toast(`${r.user.name}’s access extended by 30 days`, { type: 'success' }); } },
      { label: 'Change when all access ends…', icon: Hourglass, disabled: !r.resources.length, onClick: () => setBulk({ row: r, keys: null }) },
      { label: 'End all access now…', icon: CalendarX2, disabled: !r.live, onClick: () => ui.openDialog('confirm', {
        title: `End all of ${r.user.name}’s access now?`, message: `Their access to ${plural(r.live, 'resource')} ends immediately. You can renew it later from this page.`,
        confirmLabel: 'End access now', danger: true,
        onConfirm: () => { api.setGuestExpiry(r.user.id, Date.now() - 1000, r.resources.filter((x) => x.state !== 'expired').map((x) => x.key)); ui.toast(`${r.user.name} no longer has access`, { type: 'success' }); },
      }) },
      r.user.status === 'invited' && { label: 'Resend invitation', icon: Mail, onClick: () => ui.toast(`Invitation re-sent to ${r.user.email}`, { type: 'success' }) },
      { divider: true },
      r.user.status === 'disabled'
        ? { label: 'Reactivate account', icon: CheckCircle2, onClick: () => { api.updateUser(r.user.id, { status: 'active' }); ui.toast(`${r.user.name} reactivated`, { type: 'success' }); } }
        : { label: 'Block sign-in…', icon: Ban, onClick: () => ui.openDialog('confirm', {
          title: `Block ${r.user.name} from signing in?`, message: 'They can’t sign in or open anything shared with them until you reactivate the account. Their access settings are kept.',
          confirmLabel: 'Block sign-in', danger: true,
          onConfirm: () => { const prev = r.user.status; api.updateUser(r.user.id, { status: 'disabled' }); ui.toast(`${r.user.name} can no longer sign in`, { type: 'success', action: { label: 'Undo', onClick: () => api.updateUser(r.user.id, { status: prev || 'active' }) } }); },
        }) },
      { label: 'Remove all access…', icon: Trash2, danger: true, disabled: !r.resources.length, onClick: () => ui.openDialog('confirm', {
        title: `Remove all of ${r.user.name}’s access?`, message: `They lose access to ${plural(r.resources.length, 'resource')}. Their account stays, so you can share with them again later.`,
        confirmLabel: 'Remove all access', danger: true,
        onConfirm: () => { const n = api.revokeGuestAccess(r.user.id); ui.toast(`Removed ${plural(n, 'resource')} from ${r.user.name}`, { type: 'success' }); },
      }) },
    ].filter(Boolean));
  };

  return (
    <>
      <div className="stat-row">
        <div className="stat"><span className="stat-label">External collaborators</span><span className="stat-value">{totals.guests}</span></div>
        <div className="stat"><span className="stat-label">Organizations</span><span className="stat-value">{totals.domains}</span></div>
        <div className="stat"><span className="stat-label">Active grants</span><span className="stat-value">{totals.grants}</span></div>
        <button className={`stat stat-btn ${filter === 'expiring' ? 'on' : ''}`} onClick={() => setFilter(filter === 'expiring' ? 'all' : 'expiring')}><span className="stat-label">Expiring in 7 days</span><span className={`stat-value ${totals.expiring ? 'warn-text' : ''}`}>{totals.expiring}</span></button>
        <button className={`stat stat-btn ${filter === 'open' ? 'on' : ''}`} onClick={() => setFilter(filter === 'open' ? 'all' : 'open')}><span className="stat-label">No expiration set</span><span className="stat-value">{totals.open}</span></button>
      </div>

      <Section title="Guest access policy" desc="Applies when members share with people outside the organization.">
        <SettingRow title="Default access duration" desc="New guest access ends automatically after this time. Members can change it per person.">
          <select className="select" value={p.guestAccessDays ?? 30} onChange={(e) => { api.updateOrg({ policies: { guestAccessDays: Number(e.target.value) } }); ui.toast('Guest access policy updated', { type: 'success' }); }}>
            {[7, 14, 30, 60, 90, 180, 0].map((d) => <option key={d} value={d}>{d ? `${d} days` : 'Never expires'}</option>)}
          </select>
        </SettingRow>
        <SettingRow title="External sharing" desc={p.externalSharing ? `Allowed${p.allowedDomains.trim() ? ` · only ${p.allowedDomains}` : ' with any domain'}` : 'Turned off: members can’t add new guests.'}>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/admin/policies')}><Globe2 size={14} /> Sharing policies</button>
        </SettingRow>
      </Section>

      <Section title="External collaborators" desc="Everyone outside your organization, what they can open, and when that access ends."
        actions={<>
          <button className="btn btn-secondary btn-sm" onClick={purge} disabled={!totals.expired}><Eraser size={14} /> Remove expired ({totals.expired})</button>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!list.length}><Download size={14} /> Export CSV</button>
        </>}>
        <div className="table-tools">
          <div className="input-icon"><Search size={15} /><input className="input" placeholder="Search guests or files" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search guests" /></div>
          <select className="select" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Filter by organization">
            <option value="all">All domains</option>{domains.map((d) => <option key={d} value={d}>@{d}</option>)}
          </select>
          <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by access">
            {FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table className="table guest-table">
            <thead><tr><th style={{ width: 28 }} /><th>Guest</th><th className="hide-sm">Domain</th><th>Access</th><th>Next access end</th><th className="hide-sm">Last active</th><th /></tr></thead>
            <tbody>
              {list.map((r) => {
                const isOpen = open.has(r.user.id);
                return (
                  <Fragment key={r.user.id}>
                    <tr className={`guest-row ${isOpen ? 'open' : ''}`}>
                      <td><button className="icon-btn xs" onClick={() => toggle(r.user.id)} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} ${r.user.name}’s resources`}>{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button></td>
                      <td>
                        <button className="guest-who" onClick={() => toggle(r.user.id)}>
                          <Avatar user={r.user} size={30} />
                          <span className="min0">
                            <span className="guest-name-row">
                              <span className="strong truncate">{r.user.name}</span>
                              {r.user.status === 'invited' && <span className="pill pill-amber">Invited</span>}
                              {r.user.status === 'disabled' && <span className="pill pill-gray">Blocked</span>}
                            </span>
                            <span className="muted small truncate block">{r.user.email}{r.user.dept ? ` · ${r.user.dept}` : ''}</span>
                          </span>
                        </button>
                      </td>
                      <td className="hide-sm muted">@{r.domain}</td>
                      <td>
                        <span className="strong">{plural(r.live, 'resource')}</span>
                        {r.expired > 0 && <div className="muted small">{r.expired} expired</div>}
                      </td>
                      <td>
                        {r.nextExpiry ? <><ExpiryChip expires={r.nextExpiry} /><div className="muted small">{relDays(r.nextExpiry)}</div></>
                          : r.live ? <ExpiryChip expires={null} /> : <span className="muted small">No active access</span>}
                        {r.nextExpiry && r.noExpiry > 0 && <div className="muted small">+{r.noExpiry} with no expiry</div>}
                      </td>
                      <td className="hide-sm muted small">{r.lastSeen ? formatDate(r.lastSeen) : r.user.status === 'invited' ? 'Never signed in' : '—'}</td>
                      <td className="t-right"><button className="icon-btn sm" onClick={(e) => menu(e, r)} aria-label={`Actions for ${r.user.name}`}><MoreVertical size={16} /></button></td>
                    </tr>
                    {isOpen && (
                      <tr className="guest-detail"><td colSpan={7}><ResourceRows row={r} onChangeExpiry={(res) => setBulk({ row: r, keys: [res.key] })} /></td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!list.length && <EmptyState compact icon={UserRoundSearch} title={rows.length ? 'No guests match' : 'No external collaborators yet'} text={rows.length ? 'Try a different search or filter.' : 'People outside your organization appear here once something is shared with them.'} />}
        </div>
      </Section>
      {bulk && <BulkExpiryDialog row={rows.find((x) => x.user.id === bulk.row.user.id) || bulk.row} keys={bulk.keys} onClose={() => setBulk(null)} />}
    </>
  );
}
