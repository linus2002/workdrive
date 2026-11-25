import { useMemo, useState } from 'react';
import { NavLink, useParams, Navigate, useNavigate } from 'react-router-dom';
import { Users, FolderKanban, HardDrive, Building2, ShieldCheck, ScrollText, UserPlus, Search, MoreVertical, Download, Ban, CheckCircle2, Trash2, PenLine, Mail, Tag, ListPlus, Plus, Archive, MonitorSmartphone, ScanText, ShieldAlert, UserMinus, Palette, UserRoundSearch } from 'lucide-react';
import GuestsTab from '../sharing/GuestsTab';
import BrandingTab from '../sharing/BrandingTab';
import { LabelChip } from '../components/dialogs/OrganizeDialogs';
import { RetentionTab, SessionsTab, SearchTab } from './AdminSecurity';
import StorageAnalytics from './StorageAnalytics';
import DataProtectionTab from '../dlp/DataProtectionTab';
import { useDrive, useMe } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { teamUsage, itemList } from '../store/selectors';
import { formatSize, formatDate, formatDateTime } from '../utils/format';
import PageHeader from '../components/layout/PageHeader';
import { Avatar, AvatarStack, Modal, Switch, ProgressBar, EmptyState, FolderGlyph } from '../components/common';
import { Section, SettingRow } from './SettingsView';

const TABS = [
  { id: 'users', label: 'Users', icon: Users },
  { id: 'teams', label: 'Teams', icon: FolderKanban },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'organization', label: 'Organization', icon: Building2 },
  { id: 'organize', label: 'Labels & fields', icon: Tag },
  { id: 'search', label: 'Search & OCR', icon: ScanText },
  { id: 'dlp', label: 'Data protection', icon: ShieldAlert },
  { id: 'policies', label: 'Permission policies', icon: ShieldCheck },
  { id: 'guests', label: 'External collaborators', icon: UserRoundSearch },
  { id: 'branding', label: 'Public page branding', icon: Palette },
  { id: 'retention', label: 'Data retention', icon: Archive },
  { id: 'sessions', label: 'Sessions & devices', icon: MonitorSmartphone },
  { id: 'audit', label: 'Audit logs', icon: ScrollText },
];

const userUsage = (state, id) => itemList(state).filter((i) => i.type === 'file' && i.ownerId === id).reduce((s, i) => s + i.size, 0);

function UserDialog({ user, onClose }) {
  const { state, api } = useDrive();
  const { toast } = useUI();
  const [f, setF] = useState(user ? { ...user } : { name: '', email: '', role: 'Member', title: '', dept: '' });
  const emailTaken = state.users.some((u) => u.email.toLowerCase() === f.email.trim().toLowerCase() && u.id !== user?.id);
  // Your own role can't be changed here (no locking yourself out), and the last active admin can't be demoted.
  const isSelf = user?.id === state.meId;
  const lastAdmin = user?.role === 'Admin' && f.role !== 'Admin' && state.users.filter((x) => x.role === 'Admin' && x.status !== 'disabled').length <= 1;
  const err = !f.name.trim() ? 'Name is required' : lastAdmin ? 'This is the last active admin. Make someone else an admin first.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) ? 'Enter a valid email' : emailTaken ? 'A user with this email already exists' : null;
  const submit = (e) => {
    e.preventDefault();
    if (err) return;
    if (user) { api.updateUser(user.id, { name: f.name.trim(), email: f.email.trim(), role: isSelf ? user.role : f.role, title: f.title, dept: f.dept }); toast('User updated', { type: 'success' }); }
    else { api.addUser({ name: f.name.trim(), email: f.email.trim(), role: f.role, title: f.title, dept: f.dept }); toast(`Invitation sent to ${f.email.trim()}`, { type: 'success' }); }
    onClose();
  };
  return (
    <Modal title={user ? 'Edit user' : 'Invite user'} onClose={onClose} width={480} icon={user ? <PenLine size={20} /> : <UserPlus size={20} />}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" form="user-form" disabled={!!err}>{user ? 'Save' : 'Send invite'}</button></>}>
      <form id="user-form" className="form" onSubmit={submit}>
        <label className="field"><span className="field-label">Full name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span className="field-label">Email</span><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder={`name@${state.org.domain}`} /></label>
        <div className="form-grid">
          <label className="field"><span className="field-label">Role</span><select className="select full" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} disabled={isSelf} title={isSelf ? 'You can’t change your own role' : undefined}><option>Admin</option><option>Member</option><option>Guest</option></select></label>
          <label className="field"><span className="field-label">Department</span><input className="input" value={f.dept} onChange={(e) => setF({ ...f, dept: e.target.value })} /></label>
        </div>
        <label className="field"><span className="field-label">Job title</span><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        {err && (f.email || lastAdmin) && <span className="field-error">{err}</span>}
      </form>
    </Modal>
  );
}

function UsersTab() {
  const { state, api } = useDrive();
  const ui = useUI();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [edit, setEdit] = useState(null); // user | 'new'
  const list = state.users.filter((u) => (role === 'all' || u.role === role || u.status === role) && (u.name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase())));
  const active = state.users.filter((u) => u.status === 'active').length;
  // Granting or removing Admin changes who can run the whole organization: confirm first.
  const changeRole = (u, role) => {
    if (role === u.role) return;
    const apply = () => { api.updateUser(u.id, { role }); ui.toast(`${u.name} is now ${role}`, { type: 'success' }); };
    if (role !== 'Admin' && u.role !== 'Admin') { apply(); return; }
    const admins = state.users.filter((x) => x.role === 'Admin' && x.status !== 'disabled').length;
    ui.openDialog('confirm', role === 'Admin'
      ? { title: `Make ${u.name} an admin?`, message: `${u.name} will be able to manage users, policies, security and all data in the organization.`, confirmLabel: 'Make admin', onConfirm: apply }
      : { title: `Remove admin rights from ${u.name}?`, message: `${u.name} will become a ${role} and lose access to the Admin Console.${admins <= 1 ? ' This is the last active admin.' : ''}`, confirmLabel: 'Change role', danger: true, onConfirm: apply });
  };
  const menu = (e, u) => {
    const r = e.currentTarget.getBoundingClientRect();
    const self = u.id === state.meId;
    const selfHint = self ? 'You can’t change your own account' : undefined;
    ui.showMenu({ x: r.right - 200, y: r.bottom + 4 }, [
      { label: 'Edit user', icon: PenLine, onClick: () => setEdit(u) },
      u.status === 'invited' && { label: 'Resend invite', icon: Mail, onClick: () => ui.toast(`Invitation re-sent to ${u.email}`, { type: 'success' }) },
      u.status === 'disabled'
        ? { label: 'Reactivate', icon: CheckCircle2, onClick: () => { api.updateUser(u.id, { status: 'active' }); ui.toast(`${u.name} reactivated`, { type: 'success' }); } }
        : { label: 'Deactivate', icon: Ban, disabled: self, hint: selfHint, onClick: () => ui.openDialog('confirm', {
          title: `Deactivate ${u.name}?`, message: `${u.name} will be signed out and won't be able to sign in until reactivated. Their files stay where they are.`,
          confirmLabel: 'Deactivate', danger: true,
          onConfirm: () => {
            const prev = u.status;
            api.updateUser(u.id, { status: 'disabled' });
            ui.toast(`${u.name} deactivated`, { type: 'success', action: { label: 'Undo', onClick: () => api.updateUser(u.id, { status: prev }) } });
          },
        }) },
      { label: 'Offboard / transfer data…', icon: UserMinus, disabled: self, hint: selfHint, onClick: () => ui.openDialog('offboard', { userId: u.id }) },
      { divider: true },
      { label: 'Remove user…', icon: Trash2, danger: true, disabled: self, hint: selfHint, onClick: () => ui.openDialog('offboard', { userId: u.id, account: 'delete' }) },
    ].filter(Boolean));
  };
  return (
    <>
      <div className="stat-row">
        <div className="stat"><span className="stat-label">Total users</span><span className="stat-value">{state.users.length}</span></div>
        <div className="stat"><span className="stat-label">Active</span><span className="stat-value">{active}</span></div>
        <div className="stat"><span className="stat-label">Pending invites</span><span className="stat-value">{state.users.filter((u) => u.status === 'invited').length}</span></div>
        <div className="stat"><span className="stat-label">Admins</span><span className="stat-value">{state.users.filter((u) => u.role === 'Admin').length}</span></div>
      </div>
      <Section title="User management" desc="Invite people, assign roles and control account status." actions={<button className="btn btn-primary btn-sm" onClick={() => setEdit('new')}><UserPlus size={15} /> Invite user</button>}>
        <div className="table-tools">
          <div className="input-icon"><Search size={15} /><input className="input" aria-label="Search users" placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter users">
            <option value="all">All users</option><option value="Admin">Admins</option><option value="Member">Members</option><option value="Guest">Guests</option><option value="invited">Invited</option><option value="disabled">Deactivated</option>
          </select>
        </div>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
          <table className="table">
            <thead><tr><th>User</th><th>Role</th><th className="hide-sm">Department</th><th>Status</th><th className="hide-sm">Storage</th><th className="hide-sm">Joined</th><th /></tr></thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id}>
                  <td><div className="cell-name-inline"><Avatar user={u} size={30} /><div className="min0"><div className="strong truncate">{u.name}{u.id === state.meId && ' (you)'}</div><div className="muted small truncate">{u.email}</div></div></div></td>
                  <td>
                    <select className="select select-sm" value={u.role} disabled={u.id === state.meId} title={u.id === state.meId ? 'You can’t change your own account' : undefined} onChange={(e) => changeRole(u, e.target.value)} aria-label={`Role for ${u.name}`}>
                      <option>Admin</option><option>Member</option><option>Guest</option>
                    </select>
                  </td>
                  <td className="hide-sm muted">{u.dept || '—'}</td>
                  <td><span className={`pill pill-${u.status === 'active' ? 'green' : u.status === 'invited' ? 'amber' : 'gray'}`}>{u.status === 'active' ? 'Active' : u.status === 'invited' ? 'Invited' : 'Deactivated'}</span>
                    {u.offboardedAt && <div className="muted small" title={`Offboarded ${formatDateTime(u.offboardedAt)}`}>Offboarded{u.offboardedTo ? ` → ${u.offboardedTo === state.meId ? 'you' : state.users.find((x) => x.id === u.offboardedTo)?.name.split(' ')[0] || 'someone'}` : ''}</div>}</td>
                  <td className="hide-sm muted">{formatSize(userUsage(state, u.id))}</td>
                  <td className="hide-sm muted">{formatDate(u.joined)}</td>
                  <td className="t-right"><button className="icon-btn sm" onClick={(e) => menu(e, u)} aria-label={`Actions for ${u.name}`}><MoreVertical size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <EmptyState compact icon={Users} title="No users found" text="Try a different search or filter." />}
        </div>
      </Section>
      {edit && <UserDialog user={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function TeamsTab() {
  const { state, api } = useDrive();
  const ui = useUI();
  const navigate = useNavigate();
  return (
    <Section title="Team management" desc="All team folders in the organization." actions={<button className="btn btn-primary btn-sm" onClick={() => ui.openDialog('teamCreate')}>Create team folder</button>}>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
        <table className="table">
          <thead><tr><th>Team folder</th><th>Members</th><th className="hide-sm">Admins</th><th>Storage</th><th className="hide-sm">Quota</th><th /></tr></thead>
          <tbody>
            {state.teams.map((t) => {
              const used = teamUsage(state, t.id);
              const users = t.members.map((m) => state.users.find((u) => u.id === m.userId)).filter(Boolean);
              return (
                <tr key={t.id}>
                  <td><div className="cell-name-inline"><FolderGlyph size={24} color={t.color} team /><div className="min0"><button className="link-btn strong" onClick={() => navigate(`/team-folders/${t.id}`)}>{t.name}</button><div className="muted small truncate">{t.description}</div></div></div></td>
                  <td><button className="members-btn" onClick={() => ui.openDialog('teamMembers', { teamId: t.id })}><AvatarStack users={users} max={3} size={22} /> <span className="muted small">{users.length}</span></button></td>
                  <td className="hide-sm muted">{t.members.filter((m) => m.role === 'Admin').map((m) => state.users.find((u) => u.id === m.userId)?.name).join(', ')}</td>
                  <td style={{ minWidth: 140 }}><div className="team-usage inline"><ProgressBar value={(used / t.quota) * 100} /><span>{formatSize(used)}</span></div></td>
                  <td className="hide-sm">
                    <select className="select select-sm" value={t.quota} onChange={(e) => { api.updateTeam(t.id, { quota: Number(e.target.value) }); ui.toast('Quota updated', { type: 'success' }); }} aria-label={`Quota for ${t.name}`}>
                      {[10, 25, 50, 75, 100, 250].map((g) => <option key={g} value={g * 1024 ** 3}>{g} GB</option>)}
                    </select>
                  </td>
                  <td className="t-right"><button className="btn btn-secondary btn-sm" onClick={() => ui.openDialog('teamActivity', { teamId: t.id })}>Activity</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function StorageTab() {
  const { state, api } = useDrive();
  const { toast } = useUI();
  const total = itemList(state).filter((i) => i.type === 'file').reduce((s, i) => s + i.size, 0);
  const users = [...state.users].map((u) => ({ u, used: userUsage(state, u.id) })).sort((a, b) => b.used - a.used);
  return (
    <>
      <StorageAnalytics />
      <Section title="Quotas" desc={`${formatSize(total)} of ${formatSize(state.org.quota)} used across the organization`}>
        <SettingRow title="Per-user storage quota" desc="Applies to each user's My Folders space.">
          <select className="select" aria-label="Per-user storage quota" value={state.org.userQuota} onChange={(e) => { api.updateOrg({ userQuota: Number(e.target.value) }); toast('User quota updated', { type: 'success' }); }}>
            {[0.5, 1, 5, 15, 100].map((g) => <option key={g} value={g * 1024 ** 3}>{g >= 1 ? `${g} GB` : `${g * 1024} MB`}</option>)}
          </select>
        </SettingRow>
      </Section>
      <Section title="Usage by user">
        <div className="usage-list">
          {users.map(({ u, used }) => (
            <div key={u.id} className="usage-row">
              <Avatar user={u} size={28} />
              <span className="usage-name truncate">{u.name}</span>
              <ProgressBar value={(used / state.org.userQuota) * 100} />
              <span className="muted small nowrap">{formatSize(used)}</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function OrgTab() {
  const { state, api } = useDrive();
  const { toast } = useUI();
  const [f, setF] = useState({ name: state.org.name, domain: state.org.domain });
  return (
    <Section title="Organization settings" desc="Basic information about your organization.">
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (!f.name.trim()) return; api.updateOrg({ name: f.name.trim(), domain: f.domain.trim() }); toast('Organization updated', { type: 'success' }); }}>
        <div className="form-grid">
          <label className="field"><span className="field-label">Organization name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field"><span className="field-label">Primary domain</span><input className="input" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} /></label>
          <label className="field"><span className="field-label">Data center</span><select className="select full" defaultValue="us"><option value="us">United States</option><option value="eu">Europe</option><option value="in">India</option><option value="au">Australia</option></select></label>
        </div>
        <div className="btn-row end"><button className="btn btn-primary" disabled={f.name === state.org.name && f.domain === state.org.domain}>Save changes</button></div>
      </form>
    </Section>
  );
}

const FIELD_TYPE_LABEL = { text: 'Text', number: 'Number', date: 'Date', select: 'Dropdown' };

function OrganizeTab() {
  const { state, api } = useDrive();
  const ui = useUI();
  const navigate = useNavigate();
  const labels = state.org.labels || [];
  const templates = state.org.dataTemplates || [];
  const all = Object.values(state.items);
  const labelUse = (id) => all.filter((i) => i.labels?.includes(id)).length;
  const tplUse = (id) => all.filter((i) => i.meta?.templateId === id).length;

  const removeLabel = (l) => {
    const n = labelUse(l.id);
    ui.openDialog('confirm', {
      title: `Delete label “${l.name}”?`, message: n ? `It will be removed from ${n} item${n === 1 ? '' : 's'}. Files themselves are not affected.` : 'This label is not used on any items.',
      confirmLabel: 'Delete label', danger: true, onConfirm: () => { api.deleteLabel(l.id); ui.toast('Label deleted', { type: 'success' }); },
    });
  };
  const removeTpl = (t) => {
    const n = tplUse(t.id);
    ui.openDialog('confirm', {
      title: `Delete “${t.name}” template?`, message: n ? `Custom field values on ${n} file${n === 1 ? '' : 's'} will be removed. Files themselves are not affected.` : 'This template is not used on any files.',
      confirmLabel: 'Delete template', danger: true, onConfirm: () => { api.deleteDataTemplate(t.id); ui.toast('Template deleted', { type: 'success' }); },
    });
  };

  return (
    <>
      <Section title="Labels" desc="Coloured tags everyone in the organization can apply to files and folders."
        actions={<button className="btn btn-primary btn-sm" onClick={() => ui.openDialog('labelEdit', {})}><Plus size={15} /> New label</button>}>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
          <table className="table">
            <thead><tr><th>Label</th><th>Used on</th><th /></tr></thead>
            <tbody>
              {labels.map((l) => {
                const n = labelUse(l.id);
                return (
                  <tr key={l.id}>
                    <td><LabelChip label={l} /></td>
                    <td>{n ? <button className="link-btn" onClick={() => navigate(`/search?label=${l.id}`)}>{n} item{n === 1 ? '' : 's'}</button> : <span className="muted">Not used</span>}</td>
                    <td className="row-actions">
                      <button className="icon-btn" onClick={() => ui.openDialog('labelEdit', { labelId: l.id })} aria-label={`Edit ${l.name}`} data-tip="Edit"><PenLine size={15} /></button>
                      <button className="icon-btn" onClick={() => removeLabel(l)} aria-label={`Delete ${l.name}`} data-tip="Delete"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!labels.length && <EmptyState compact icon={Tag} title="No labels yet" text="Create labels such as Confidential or Approved." />}
        </div>
      </Section>

      <Section title="Data templates" desc="Sets of custom fields (e.g. invoice number, due date) that people fill in on files and can search by."
        actions={<button className="btn btn-primary btn-sm" onClick={() => ui.openDialog('dataTemplate', {})}><Plus size={15} /> New template</button>}>
        <div className="tpl-cards">
          {templates.map((t) => {
            const n = tplUse(t.id);
            return (
              <div key={t.id} className="tpl-card">
                <div className="tpl-card-head">
                  <ListPlus size={18} className="muted" />
                  <div className="grow min0"><strong className="truncate block">{t.name}</strong>{t.description && <span className="muted small truncate block">{t.description}</span>}</div>
                  <button className="icon-btn" onClick={() => ui.openDialog('dataTemplate', { templateId: t.id })} aria-label={`Edit ${t.name}`} data-tip="Edit"><PenLine size={15} /></button>
                  <button className="icon-btn" onClick={() => removeTpl(t)} aria-label={`Delete ${t.name}`} data-tip="Delete"><Trash2 size={15} /></button>
                </div>
                <div className="chip-row">{t.fields.map((fd) => <span key={fd.id} className="field-pill">{fd.name} · {FIELD_TYPE_LABEL[fd.type]}</span>)}</div>
                <div className="small">{n ? <button className="link-btn" onClick={() => navigate(`/search?tpl=${t.id}`)}>Used on {n} file{n === 1 ? '' : 's'}</button> : <span className="muted">Not used yet</span>}</div>
              </div>
            );
          })}
        </div>
        {!templates.length && <EmptyState compact icon={ListPlus} title="No data templates" text="Create a template to capture structured details on files." />}
      </Section>
    </>
  );
}

function PoliciesTab() {
  const { state, api } = useDrive();
  const { toast } = useUI();
  const p = state.org.policies;
  const set = (k, v) => { api.updateOrg({ policies: { [k]: v } }); toast('Policy updated', { type: 'success' }); };
  const [domains, setDomains] = useState(p.allowedDomains);
  return (
    <>
      <Section title="Sharing policies" desc="Control how members can share files inside and outside the organization.">
        <SettingRow title="Allow external sharing" desc="Members can share with people outside your domain."><Switch checked={p.externalSharing} onChange={(v) => set('externalSharing', v)} label="External sharing" /></SettingRow>
        <SettingRow title="Allow public links" desc="“Anyone with the link” access for shared links."><Switch checked={p.publicLinks} onChange={(v) => set('publicLinks', v)} label="Public links" /></SettingRow>
        <SettingRow title="Require password for public links"><Switch checked={p.linkPasswordRequired} onChange={(v) => set('linkPasswordRequired', v)} label="Require link password" /></SettingRow>
        <SettingRow title="Default link expiry" desc="New public links expire after this many days.">
          <select className="select" aria-label="Default link expiry" value={p.linkExpiryDays} onChange={(e) => set('linkExpiryDays', Number(e.target.value))}>{[0, 7, 14, 30, 90].map((d) => <option key={d} value={d}>{d ? `${d} days` : 'Never'}</option>)}</select>
        </SettingRow>
        <SettingRow title="Restrict downloads for viewers" desc="Viewers can preview files but not download them."><Switch checked={p.downloadRestriction} onChange={(v) => set('downloadRestriction', v)} label="Restrict downloads" /></SettingRow>
        <SettingRow title="Watermark public links" desc="Always overlay a watermark on files opened through “Anyone with the link” shares."><Switch checked={!!p.watermarkPublicLinks} onChange={(v) => set('watermarkPublicLinks', v)} label="Watermark public links" /></SettingRow>
        <SettingRow title="Allow file requests" desc="Members can create upload-only links that let anyone send files into a folder."><Switch checked={p.fileRequests !== false} onChange={(v) => set('fileRequests', v)} label="Allow file requests" /></SettingRow>
        <SettingRow title="Allowed external domains" desc="Comma-separated. Leave empty to allow any domain.">
          <div className="inline-form"><input className="input" aria-label="Allowed external domains" value={domains} onChange={(e) => setDomains(e.target.value)} /><button className="btn btn-secondary btn-sm" disabled={domains === p.allowedDomains} onClick={() => set('allowedDomains', domains)}>Save</button></div>
        </SettingRow>
      </Section>
      <Section title="Security policies">
        <SettingRow title="Enforce two-factor authentication" desc="All members must set up 2FA at next sign-in."><Switch checked={p.twoFactor} onChange={(v) => set('twoFactor', v)} label="Enforce 2FA" /></SettingRow>
        <SettingRow title="Session timeout">
          <select className="select" aria-label="Session timeout" value={p.sessionTimeout} onChange={(e) => set('sessionTimeout', Number(e.target.value))}>{[15, 30, 60, 240, 720].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}</option>)}</select>
        </SettingRow>
      </Section>
    </>
  );
}

function AuditTab() {
  const { state } = useDrive();
  const [q, setQ] = useState('');
  const [actor, setActor] = useState('all');
  const [action, setAction] = useState('all');
  const actions = useMemo(() => [...new Set(state.audit.map((a) => a.action))].sort(), [state.audit]);
  const list = state.audit.filter((a) => (actor === 'all' || a.actorId === actor) && (action === 'all' || a.action === action)
    && (!q || `${a.target} ${a.details}`.toLowerCase().includes(q.toLowerCase())));
  const exportCsv = () => {
    const rows = [['Time', 'User', 'Action', 'Target', 'Details', 'IP'], ...list.map((a) => [new Date(a.at).toISOString(), state.users.find((u) => u.id === a.actorId)?.name || '', a.action, a.target, a.details || '', a.ip])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const el = document.createElement('a'); el.href = url; el.download = 'audit-log.csv'; el.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <Section title="Audit logs" desc="A record of activity across your organization." actions={<button className="btn btn-secondary btn-sm" onClick={exportCsv}><Download size={14} /> Export CSV</button>}>
      <div className="table-tools">
        <div className="input-icon"><Search size={15} /><input className="input" aria-label="Search the audit log" placeholder="Search target or details" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="select" value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Filter by user"><option value="all">All users</option>{state.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <select className="select" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action"><option value="all">All actions</option>{actions.map((a) => <option key={a}>{a}</option>)}</select>
      </div>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
        <table className="table">
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Target</th><th className="hide-sm">Details</th><th className="hide-sm">IP address</th></tr></thead>
          <tbody>
            {list.slice(0, 200).map((a) => {
              const u = state.users.find((x) => x.id === a.actorId);
              return (
                <tr key={a.id}>
                  <td className="nowrap muted">{formatDateTime(a.at)}</td>
                  <td><span className="cell-owner"><Avatar user={u} size={28} /><span className="truncate">{u?.name || 'Removed user'}</span></span></td>
                  <td><span className="pill pill-gray">{a.action}</span></td>
                  <td className="truncate-cell">{a.target}</td>
                  <td className="hide-sm muted truncate-cell">{a.details}</td>
                  <td className="hide-sm muted mono">{a.ip}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length && <EmptyState compact icon={ScrollText} title="No matching events" />}
      </div>
    </Section>
  );
}

export default function AdminView() {
  const { tab = 'users' } = useParams();
  const me = useMe();
  if (me?.role !== 'Admin') return <div className="page"><EmptyState icon={ShieldCheck} title="Admins only" text="You need administrator access to manage the organization." /></div>;
  if (!TABS.find((t) => t.id === tab)) return <Navigate to="/admin/users" replace />;
  const Panel = { users: UsersTab, teams: TeamsTab, storage: StorageTab, organization: OrgTab, organize: OrganizeTab, policies: PoliciesTab, retention: RetentionTab, sessions: SessionsTab, search: SearchTab, dlp: DataProtectionTab, guests: GuestsTab, branding: BrandingTab, audit: AuditTab }[tab];
  return (
    <div className="page admin-console">
      <PageHeader title="Admin Console" subtitle="Manage users, teams, storage and security for your organization." />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Admin sections">
          {TABS.map((t) => <NavLink key={t.id} to={`/admin/${t.id}`} className={({ isActive }) => `settings-link ${isActive ? 'active' : ''}`}><t.icon size={16} /> {t.label}</NavLink>)}
        </nav>
        <div className="settings-content wide"><Panel /></div>
      </div>
    </div>
  );
}
