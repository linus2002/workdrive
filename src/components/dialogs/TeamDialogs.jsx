import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, UserPlus, X, PenLine, Activity, Search } from 'lucide-react';
import { useDrive } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { formatDate } from '../../utils/format';
import { teamRoleOf } from '../../store/selectors';
import { isGuest, sharingPolicyBlock, defaultGuestExpiry } from '../../sharing/guests';
import { checkSpaceShare } from '../../dlp/dlp';
import { Modal, Avatar, RoleSelect, EmptyState } from '../common';
import { colourName } from './OrganizeDialogs';

const TEAM_ROLES = ['Admin', 'Organizer', 'Editor', 'Viewer'];
const ROLE_DESC = { Admin: 'Full control, manage members & settings', Organizer: 'Manage files and members', Editor: 'Add and edit files', Viewer: 'View and download only' };
const COLORS = ['#1686D9', '#D946EF', '#0EA5A4', '#16A34A', '#EA7A1A', '#6366F1', '#E5484D', '#A16207'];

function MemberPicker({ exclude, onAdd }) {
  const { state } = useDrive();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('Editor');
  const options = state.users.filter((u) => !exclude.includes(u.id) && u.status !== 'disabled' && (u.name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="member-picker">
      <div className="member-picker-row">
        <div className="input-icon grow"><Search size={15} /><input className="input" placeholder="Search people in your organization" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <RoleSelect value={role} onChange={setRole} roles={TEAM_ROLES} />
      </div>
      <div className="member-options">
        {options.length === 0 && <div className="muted small pad">No more people to add.</div>}
        {options.map((u) => (
          <button key={u.id} className="suggest-row" onClick={() => onAdd(u.id, role)}>
            <Avatar user={u} size={28} />
            <span className="min0 grow"><span className="strong">{u.name}</span><span className="muted small block truncate">{u.email}</span></span>
            <UserPlus size={16} className="muted" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function TeamCreateDialog({ onClose }) {
  const { state, api } = useDrive();
  const { toast } = useUI();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [members, setMembers] = useState([]);
  const [touched, setTouched] = useState(false);
  const exists = state.teams.some((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  const err = !name.trim() ? 'Team folder name is required' : exists ? 'A team folder with this name already exists' : null;
  const submit = (e) => {
    e?.preventDefault();
    setTouched(true);
    if (err) return;
    const id = api.createTeam({ name: name.trim(), description: description.trim(), members, color });
    toast(`Team folder "${name.trim()}" created`, { type: 'success' });
    onClose();
    navigate(`/team-folders/${id}`);
  };
  return (
    <Modal title="Create team folder" onClose={onClose} width={560} icon={<Users size={20} />}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={touched && !!err}>Create</button>
      </>}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Team folder name</span>
          <input className={`input ${touched && err ? 'invalid' : ''}`} value={name} onChange={(e) => { setName(e.target.value); setTouched(true); }} placeholder="e.g. Customer Success" />
          {touched && err && <span className="field-error">{err}</span>}
        </label>
        <label className="field">
          <span className="field-label">Description <span className="muted">(optional)</span></span>
          <textarea className="input textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What will this team store here?" />
        </label>
        <div className="field">
          <span className="field-label">Colour</span>
          <div className="color-row" role="group" aria-label="Team folder colour">
            {COLORS.map((c) => <button type="button" key={c} className={`color-dot ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={colourName(c)} aria-pressed={color === c} />)}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Members ({members.length + 1})</span>
          <div className="member-list">
            <div className="access-row"><Avatar user={state.users.find((u) => u.id === state.meId)} size={26} /><span className="grow">You</span><span className="muted small">Admin</span></div>
            {members.map((m) => {
              const u = state.users.find((x) => x.id === m.userId);
              return (
                <div key={m.userId} className="access-row">
                  <Avatar user={u} size={26} /><span className="grow truncate">{u.name}</span>
                  <RoleSelect small value={m.role} roles={TEAM_ROLES} onChange={(r) => setMembers(members.map((x) => (x.userId === m.userId ? { ...x, role: r } : x)))} />
                  <button type="button" className="icon-btn sm" onClick={() => setMembers(members.filter((x) => x.userId !== m.userId))} aria-label={`Remove ${u.name}`}><X size={15} /></button>
                </div>
              );
            })}
          </div>
          <MemberPicker exclude={[state.meId, ...members.map((m) => m.userId)]} onAdd={(userId, role) => setMembers([...members, { userId, role }])} />
        </div>
      </form>
    </Modal>
  );
}

export function TeamMembersDialog({ teamId, onClose }) {
  const { state, api } = useDrive();
  const { toast, openDialog } = useUI();
  const team = state.teams.find((t) => t.id === teamId);
  const [adding, setAdding] = useState(false);
  if (!team) return null;
  const myRole = teamRoleOf(state, team.id); // null when not a member or the membership expired
  const canManage = myRole === 'admin' || myRole === 'organizer';
  const admins = team.members.filter((m) => m.role === 'Admin').length;
  const rank = (r) => TEAM_ROLES.length - TEAM_ROLES.indexOf(r); // Admin highest
  const changeRole = (m, u, role) => {
    if (role === m.role) return;
    const apply = () => { api.setTeamMemberRole(team.id, m.userId, role); toast(`${u.name} is now ${role}`, { type: 'success' }); };
    const self = m.userId === state.meId;
    const demoting = rank(role) < rank(m.role);
    if (demoting && (self || m.role === 'Admin')) {
      openDialog('confirm', {
        title: self ? `Change your own role to ${role}?` : `Change ${u.name} from Admin to ${role}?`,
        message: self
          ? `You'll lose your ${m.role} permissions in "${team.name}"${rank(role) < rank('Organizer') ? ' and won’t be able to manage members or undo this yourself' : ''}.`
          : `${u.name} will no longer be able to manage members and settings of "${team.name}".`,
        confirmLabel: 'Change role', danger: true,
        onConfirm: apply,
      });
      return;
    }
    apply();
  };
  return (
    <Modal title={`${team.name} · Members`} subtitle={`${team.members.length} members`} onClose={onClose} width={580} icon={<Users size={20} />}
      footer={<>
        <span className="grow muted small">{canManage ? 'Changes are saved automatically.' : 'Only admins and organizers can manage members.'}</span>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </>}>
      {canManage && (adding ? (
        <div className="add-panel">
          <div className="row-between"><strong>Add members</strong><button className="link-btn" onClick={() => setAdding(false)}>Close</button></div>
          <MemberPicker exclude={team.members.map((m) => m.userId)} onAdd={(userId, role) => {
            const u = state.users.find((x) => x.id === userId);
            const guest = isGuest(state, u);
            const add = () => {
              // Guests get time-limited access, as when sharing a file with them.
              const expires = guest ? defaultGuestExpiry(state) : null;
              api.addTeamMembers(team.id, [{ userId, role, ...(expires ? { expires, sharedAt: Date.now(), sharedBy: state.meId } : {}) }]);
              api.pushNotification({ type: 'team', actorId: state.meId, text: `added ${u.name} to "${team.name}" as ${role}`, link: `/team-folders/${team.id}` });
              toast(`${u.name} added as ${role}${expires ? ` until ${formatDate(expires)}` : ''}`, { type: 'success' });
            };
            if (!guest) { add(); return; }
            // Adding a guest shares the whole team folder outside the organization: same rules as the Share dialog.
            const why = sharingPolicyBlock(state, u.email);
            if (why) { toast(why, { type: 'error' }); return; }
            const verdict = checkSpaceShare(state, team.id, 'external');
            if (verdict.decision === 'block') {
              api.logEvent('Share blocked (DLP)', team.name, `Add guest ${u.email} · ${verdict.files.length} file(s) with sensitive data`, { teamId: team.id });
              toast(`Can't add ${u.name}: "${team.name}" contains ${verdict.files.length} file${verdict.files.length === 1 ? '' : 's'} with sensitive data`, { type: 'error', duration: 7000 });
              return;
            }
            if (verdict.decision === 'warn') {
              openDialog('confirm', {
                title: 'Share sensitive files outside the organization?',
                message: `"${team.name}" contains ${verdict.files.length} file${verdict.files.length === 1 ? '' : 's'} with sensitive data. ${u.name} (${u.email}) is outside ${state.org.name}.`,
                confirmLabel: 'Add anyway', danger: true,
                onConfirm: () => { api.logEvent('DLP warning overridden', team.name, `Added guest ${u.email}`, { teamId: team.id }); add(); },
              });
              return;
            }
            add();
          }} />
        </div>
      ) : (
        <button className="btn btn-secondary" onClick={() => setAdding(true)}><UserPlus size={15} /> Add members</button>
      ))}
      <div className="member-list roomy">
        {team.members.map((m) => {
          const u = state.users.find((x) => x.id === m.userId);
          if (!u) return null;
          const lastAdmin = m.role === 'Admin' && admins === 1;
          return (
            <div key={m.userId} className="access-row big">
              <Avatar user={u} size={34} />
              <div className="grow min0">
                <div className="strong truncate">{u.name}{u.id === state.meId && ' (you)'}</div>
                <div className="muted small truncate">{u.email}</div>
              </div>
              {canManage && !lastAdmin ? (
                <>
                  <select className="select select-sm" value={m.role} onChange={(e) => changeRole(m, u, e.target.value)} title={ROLE_DESC[m.role]} aria-label={`Role for ${u.name}`}>
                    {TEAM_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button className="icon-btn sm" onClick={() => openDialog('confirm', {
                    title: `Remove ${u.name}?`, message: `${u.name} will lose access to all files in "${team.name}".`, confirmLabel: 'Remove', danger: true,
                    onConfirm: () => { api.removeTeamMember(team.id, m.userId); toast(`${u.name} removed`, { type: 'success' }); },
                  })} aria-label={`Remove ${u.name}`} data-tip="Remove member"><X size={15} /></button>
                </>
              ) : <span className="pill pill-gray" title={lastAdmin ? 'A team folder needs at least one admin' : ROLE_DESC[m.role]}>{m.role}</span>}
            </div>
          );
        })}
      </div>
      <div className="role-legend">
        {TEAM_ROLES.map((r) => <div key={r}><strong>{r}</strong> — {ROLE_DESC[r]}</div>)}
      </div>
    </Modal>
  );
}

export function TeamRenameDialog({ teamId, onClose }) {
  const { state, api } = useDrive();
  const { toast } = useUI();
  const team = state.teams.find((t) => t.id === teamId);
  const [name, setName] = useState(team?.name || '');
  const [description, setDescription] = useState(team?.description || '');
  if (!team) return null;
  const err = !name.trim() ? 'Name is required' : state.teams.some((t) => t.id !== teamId && t.name.toLowerCase() === name.trim().toLowerCase()) ? 'Name already in use' : null;
  const submit = (e) => {
    e.preventDefault();
    if (err) return;
    api.updateTeam(teamId, { name: name.trim(), description: description.trim() });
    toast('Team folder updated', { type: 'success' });
    onClose();
  };
  return (
    <Modal title="Rename team folder" onClose={onClose} width={460} icon={<PenLine size={20} />}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" form="team-rename" disabled={!!err}>Save</button></>}>
      <form id="team-rename" className="form" onSubmit={submit}>
        <label className="field"><span className="field-label">Name</span><input className={`input ${err ? 'invalid' : ''}`} value={name} onChange={(e) => setName(e.target.value)} />{err && <span className="field-error">{err}</span>}</label>
        <label className="field"><span className="field-label">Description</span><textarea className="input textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      </form>
    </Modal>
  );
}

export function TeamActivityDialog({ teamId, onClose }) {
  const { state } = useDrive();
  const team = state.teams.find((t) => t.id === teamId);
  const entries = useMemo(() => {
    if (!team) return [];
    const names = new Set(Object.values(state.items).filter((i) => i.space === teamId).map((i) => i.name));
    return state.audit.filter((a) => a.teamId === teamId || a.target === team.name || a.details === team.name || names.has(a.target)).slice(0, 60);
  }, [state, team, teamId]);
  if (!team) return null;
  return (
    <Modal title={`${team.name} · Activity`} onClose={onClose} width={560} icon={<Activity size={20} />}>
      {entries.length === 0 ? <EmptyState compact icon={Activity} title="No activity yet" text="Uploads, edits and membership changes will appear here." /> : (
        <ul className="activity-list roomy">
          {entries.map((a) => {
            const u = state.users.find((x) => x.id === a.actorId);
            return (
              <li key={a.id}>
                <Avatar user={u} size={30} />
                <div className="min0 grow">
                  <div><strong>{u?.id === state.meId ? 'You' : u?.name || 'System'}</strong> {a.action.toLowerCase()} <strong>{a.target}</strong></div>
                  {a.details && <div className="muted small">{a.details}</div>}
                </div>
                <span className="muted small nowrap">{formatDate(a.at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
