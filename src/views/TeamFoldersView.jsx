import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users, MoreVertical, UserPlus, PenLine, Activity, Trash2, FolderOpen, LayoutGrid, List } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { teamUsage, canManage, teamRoleOf } from '../store/selectors';
import { formatSize, formatDate } from '../utils/format';
import PageHeader from '../components/layout/PageHeader';
import { AvatarStack, Avatar, FolderGlyph, ProgressBar, EmptyState } from '../components/common';

export default function TeamFoldersView() {
  const { state, api } = useDrive();
  const ui = useUI();
  const navigate = useNavigate();
  const [scope, setScope] = useState('mine');
  const view = state.settings.defaultView;

  const teams = useMemo(() => state.teams.filter((t) => scope === 'all' || t.members.some((m) => m.userId === state.meId)), [state.teams, scope, state.meId]);
  // Role only while the membership is active (an expired membership gives no access).
  const myRole = (t) => { const r = teamRoleOf(state, t.id); return r ? r[0].toUpperCase() + r.slice(1) : null; };
  const expired = (t) => !teamRoleOf(state, t.id) && t.members.some((m) => m.userId === state.meId);
  const openTeam = (t) => (myRole(t) ? navigate(`/team-folders/${t.id}`)
    : ui.toast(expired(t) ? `Your access to "${t.name}" has expired. Ask a team admin to extend it.` : `You're not a member of "${t.name}". Ask a team admin to add you.`, { type: 'warning' }));
  const rolePill = (t, role) => (role ? <span className={`pill pill-${role === 'Admin' ? 'blue' : 'gray'}`}>{role}</span>
    : expired(t) ? <span className="pill pill-amber" title="Your membership has expired">Access expired</span> : null);

  const menu = (e, t) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const role = teamRoleOf(state, t.id) || '';
    ui.showMenu({ x: r.right - 210, y: r.bottom + 4 }, [
      { label: 'Open', icon: FolderOpen, onClick: () => openTeam(t), disabled: !role, hint: !role ? (expired(t) ? 'Your access has expired' : 'You’re not a member of this team folder') : undefined },
      { label: canManage(role) ? 'Manage members' : 'View members', icon: UserPlus, onClick: () => ui.openDialog('teamMembers', { teamId: t.id }) },
      { label: 'Rename', icon: PenLine, onClick: () => ui.openDialog('teamRename', { teamId: t.id }), disabled: !canManage(role), hint: !canManage(role) ? 'Only team admins and organizers can rename' : undefined },
      { label: 'View activity', icon: Activity, onClick: () => ui.openDialog('teamActivity', { teamId: t.id }) },
      { divider: true },
      { label: 'Delete', icon: Trash2, danger: true, disabled: role !== 'admin', hint: role !== 'admin' ? 'Only team admins can delete a team folder' : undefined, onClick: () => ui.openDialog('confirm', {
        title: `Delete "${t.name}"?`, message: `All files in this team folder will be permanently deleted for all ${t.members.length} members. This can't be undone.`, confirmLabel: 'Delete team folder', danger: true,
        confirmText: t.name, confirmPrompt: <>Type the team folder name <strong>{t.name}</strong> to confirm</>,
        onConfirm: () => { const r = api.deleteTeam(t.id); if (!r.deleted) { ui.toast(`Can't delete: ${r.held} item${r.held === 1 ? ' is' : 's are'} on legal hold. Release the hold first.`, { type: 'error', duration: 7000 }); return; } ui.toast('Team folder deleted', { type: 'success' }); },
      }) },
    ]);
  };

  return (
    <div className="page">
      <PageHeader title="Team Folders" subtitle="Shared spaces where teams store, organize and collaborate on files."
        actions={<button className="btn btn-primary" onClick={() => ui.openDialog('teamCreate')}><Plus size={16} /> <span className="btn-text">Create team folder</span></button>}>
        <div className="file-toolbar plain">
          <div className="seg" role="radiogroup" aria-label="Scope">
            <button role="radio" aria-checked={scope === 'mine'} className={scope === 'mine' ? 'active' : ''} onClick={() => setScope('mine')}>My team folders</button>
            <button role="radio" aria-checked={scope === 'all'} className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>All in organization</button>
          </div>
          <div className="toolbar-right">
            <div className="view-switch" role="radiogroup" aria-label="Layout">
              <button role="radio" aria-checked={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => api.updateSettings({ defaultView: 'list' })} aria-label="List view" data-tip="List view"><List size={16} /></button>
              <button role="radio" aria-checked={view === 'grid'} className={view === 'grid' ? 'active' : ''} onClick={() => api.updateSettings({ defaultView: 'grid' })} aria-label="Grid view" data-tip="Grid view"><LayoutGrid size={16} /></button>
            </div>
          </div>
        </div>
      </PageHeader>
      <div className="page-scroll">
        {teams.length === 0 && <EmptyState icon={Users} title="No team folders" text="Create a team folder to collaborate with your teammates." action={<button className="btn btn-primary" onClick={() => ui.openDialog('teamCreate')}>Create team folder</button>} />}
        {view === 'grid' ? (
          <div className="team-grid">
            {teams.map((t) => {
              const used = teamUsage(state, t.id);
              const members = t.members.map((m) => state.users.find((u) => u.id === m.userId)).filter(Boolean);
              const role = myRole(t);
              return (
                <div key={t.id} className="team-card" role="button" tabIndex={0} onClick={() => openTeam(t)}
                  onKeyDown={(e) => e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openTeam(t))}>
                  <div className="team-card-top">
                    <FolderGlyph size={38} color={t.color} team />
                    <button className="icon-btn sm" onClick={(e) => menu(e, t)} aria-label={`Options for ${t.name}`}><MoreVertical size={16} /></button>
                  </div>
                  <div className="team-name">{t.name}</div>
                  <div className="team-desc">{t.description}</div>
                  <div className="team-meta">
                    <AvatarStack users={members} max={4} size={24} />
                    {rolePill(t, role) || <span className="pill pill-gray">Not a member</span>}
                  </div>
                  <div className="team-usage"><ProgressBar value={(used / t.quota) * 100} /><span>{formatSize(used)} of {formatSize(t.quota)}</span></div>
                </div>
              );
            })}
          </div>
        ) : teams.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Team folder</th><th>Members</th><th className="hide-sm">Owner</th><th className="hide-sm">Storage</th><th>Your role</th><th className="hide-sm">Created</th><th /></tr></thead>
              <tbody>
                {teams.map((t) => {
                  const used = teamUsage(state, t.id);
                  const members = t.members.map((m) => state.users.find((u) => u.id === m.userId)).filter(Boolean);
                  const owner = state.users.find((u) => u.id === t.ownerId);
                  const role = myRole(t);
                  return (
                    <tr key={t.id} className="clickable" tabIndex={0} onClick={() => openTeam(t)} onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && openTeam(t)}>
                      <td><div className="cell-name-inline"><FolderGlyph size={24} color={t.color} team /><div className="min0"><div className="strong truncate">{t.name}</div><div className="muted small truncate">{t.description}</div></div></div></td>
                      <td><button className="members-btn" aria-label={`${canManage(teamRoleOf(state, t.id) || '') ? 'Manage' : 'View'} members of ${t.name}`} onClick={(e) => { e.stopPropagation(); ui.openDialog('teamMembers', { teamId: t.id }); }}><AvatarStack users={members} max={3} size={22} /></button></td>
                      <td className="hide-sm"><span className="cell-owner"><Avatar user={owner} size={28} />{owner?.name}</span></td>
                      <td className="hide-sm" style={{ minWidth: 150 }}><div className="team-usage inline"><ProgressBar value={(used / t.quota) * 100} /><span>{formatSize(used)}</span></div></td>
                      <td>{rolePill(t, role) || <span className="muted">—</span>}</td>
                      <td className="hide-sm muted">{formatDate(t.createdAt)}</td>
                      <td className="t-right"><button className="icon-btn sm" onClick={(e) => menu(e, t)} aria-label={`Options for ${t.name}`}><MoreVertical size={16} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
