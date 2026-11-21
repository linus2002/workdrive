import { useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation, Link, Navigate } from 'react-router-dom';
import { FolderOpen, FolderPlus, Upload, Share2, UserPlus, MoreHorizontal, PenLine, Activity, Trash2, FileText, Sheet, FolderX, Settings2, Eye, Lock, History } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { useItemActions } from '../store/useItemActions';
import { accessOf, ancestors, canEdit, canManage, childrenOf, folderRoute, isTrashedDeep, teamUsage, teamRoleOf } from '../store/selectors';
import { formatSize } from '../utils/format';
import FileBrowser from '../components/files/FileBrowser';
import PageHeader from '../components/layout/PageHeader';
import { AvatarStack, EmptyState, FolderGlyph, usePopover, MenuList, ProgressBar } from '../components/common';

export default function FolderView({ mode }) {
  const { folderId, teamId } = useParams();
  const { state, api } = useDrive();
  const ui = useUI();
  const actions = useItemActions();
  const navigate = useNavigate();
  const location = useLocation();
  const teamMenu = usePopover();

  const team = mode === 'team' ? state.teams.find((t) => t.id === teamId) : null;
  const folder = folderId ? state.items[folderId] : null;
  const space = folder ? folder.space : team ? team.id : 'my';
  const missing = (folderId && (!folder || folder.type !== 'folder' || isTrashedDeep(state.items, folderId))) || (mode === 'team' && !team);
  // Lowercase role, or null when not a member or the membership has expired.
  const myTeamRole = team ? teamRoleOf(state, team.id) : null;
  const membershipExpired = !!team && !myTeamRole && team.members.some((m) => m.userId === state.meId);
  const isOrgAdmin = state.users.find((u) => u.id === state.meId)?.role === 'Admin'; // org admins can restore any folder

  const access = folder ? accessOf(state, folder) : team ? (myTeamRole || 'none') : 'owner';
  const noAccess = !missing && access === 'none';
  const writable = canEdit(access);
  // Folder opened under the wrong section's URL (e.g. a team folder via /folders/:id) → canonical URL.
  const canonical = folder && !missing ? folderRoute(folder) : null;
  const wrongUrl = canonical && location.pathname.replace(/\/$/, '') !== canonical;
  const blocked = missing || noAccess || wrongUrl;
  const title = folder ? folder.name : team ? team.name : 'My Folders';

  useEffect(() => {
    if (blocked) return;
    ui.setCwd({ parentId: folder?.id || null, space, writable, inFolder: true, label: title });
    ui.setDetailsId(folder?.id || null);
  }, [folder?.id, space, writable, blocked, title]); // eslint-disable-line
  useEffect(() => () => ui.setCwd({ parentId: null, space: 'my', writable: true, inFolder: false, label: 'My Folders' }), []); // eslint-disable-line

  // ?restore=1 (e.g. from an unusual-activity notification) opens "Restore to a date" for this team folder or folder.
  const wantsRestore = new URLSearchParams(location.search).get('restore') === '1';
  useEffect(() => {
    if (!wantsRestore || blocked) return;
    const allowed = canManage(access) || isOrgAdmin;
    // Deferred: the layout closes dialogs when the page changes, and that runs after this effect.
    setTimeout(() => {
      navigate({ pathname: location.pathname, search: '' }, { replace: true }); // same page, so dialogs stay open
      if (allowed) ui.openDialog('restoreFolder', folder ? { folderId: folder.id } : { space });
    }, 0);
  }, [wantsRestore, blocked]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => (blocked ? [] : childrenOf(state, folder?.id || null, space)), [state, folder?.id, space, blocked]);

  if (wrongUrl && !noAccess) return <Navigate to={`${canonical}${location.search}`} replace />;
  if (missing || noAccess) {
    return (
      <div className="page">
        {missing
          ? <EmptyState icon={FolderX} title="Folder not found" text="It may have been moved or deleted." action={<Link className="btn btn-primary" to="/folders">Go to My Folders</Link>} />
          : <EmptyState icon={Lock} title="You don't have access" text={team && !folder ? (membershipExpired ? `Your access to "${team.name}" has expired. Ask a team admin to extend it.` : `You're not a member of "${team.name}". Ask a team admin to add you.`) : 'Ask the owner to share this folder with you.'} action={<Link className="btn btn-primary" to="/folders">Go to My Folders</Link>} />}
      </div>
    );
  }

  // Breadcrumbs — only show ancestors the user can actually open (a shared subfolder starts at itself).
  const fullChain = folder ? [...ancestors(state.items, folder.id), folder] : [];
  const firstVisible = fullChain.findIndex((f) => accessOf(state, f) !== 'none');
  const chain = firstVisible < 0 ? [] : fullChain.slice(firstVisible);
  const rootCrumb = space === 'my' ? { label: 'My Folders', to: '/folders', folderId: null, space: 'my', droppable: true }
    : space === 'user' ? { label: 'Shared with Me', to: '/shared-with-me' }
      : { label: team?.name || state.teams.find((t) => t.id === space)?.name, to: `/team-folders/${space}`, folderId: null, space, droppable: writable };
  const crumbs = [
    ...(space.startsWith('t') ? [{ label: 'Team Folders', to: '/team-folders' }] : []),
    rootCrumb,
    ...chain.map((f) => ({ label: f.name, to: space.startsWith('t') ? `/team-folders/${space}/${f.id}` : `/folders/${f.id}`, folderId: f.id, space, droppable: canEdit(accessOf(state, f)) })),
  ];
  const activeTeam = space.startsWith('t') ? state.teams.find((t) => t.id === space) : null;
  // Inside a team subfolder `team` is null, so read the role for the folder's team.
  const teamRole = activeTeam ? teamRoleOf(state, activeTeam.id) : null;
  const canManageTeam = canManage(teamRole || '');

  const newFolder = () => ui.openDialog('createFolder', { parentId: folder?.id || null, space });
  const backgroundMenu = writable ? [
    { label: 'New folder', icon: FolderPlus, onClick: newFolder },
    { label: 'Upload files', icon: Upload, onClick: () => ui.openDialog('upload') },
    { label: 'New document', icon: FileText, onClick: () => ui.openDialog('createDoc', { kind: 'docx' }) },
    { label: 'New spreadsheet', icon: Sheet, onClick: () => ui.openDialog('createDoc', { kind: 'xlsx' }) },
  ] : null;

  const teamActions = activeTeam && [
    { label: canManageTeam ? 'Members' : 'View members', icon: UserPlus, onClick: () => ui.openDialog('teamMembers', { teamId: activeTeam.id }) },
    canManageTeam && { label: 'Rename team folder', icon: PenLine, onClick: () => ui.openDialog('teamRename', { teamId: activeTeam.id }) },
    { label: 'View activity', icon: Activity, onClick: () => ui.openDialog('teamActivity', { teamId: activeTeam.id }) },
    (canManageTeam || isOrgAdmin) && { label: 'Restore to a date…', icon: History, onClick: () => ui.openDialog('restoreFolder', { space: activeTeam.id }) },
    teamRole === 'admin' && { divider: true },
    teamRole === 'admin' && { label: 'Delete team folder', icon: Trash2, danger: true, onClick: () => ui.openDialog('confirm', {
      title: `Delete "${activeTeam.name}"?`, message: `All files in this team folder will be permanently deleted for all ${activeTeam.members.length} members. This can't be undone.`, confirmLabel: 'Delete team folder', danger: true,
      confirmText: activeTeam.name, confirmPrompt: <>Type the team folder name <strong>{activeTeam.name}</strong> to confirm</>,
      onConfirm: () => { const r = api.deleteTeam(activeTeam.id); if (!r.deleted) { ui.toast(`Can't delete: ${r.held} item${r.held === 1 ? ' is' : 's are'} on legal hold. Release the hold first.`, { type: 'error', duration: 7000 }); return; } navigate('/team-folders'); ui.toast('Team folder deleted', { type: 'success' }); },
    }) },
  ].filter(Boolean);

  const used = activeTeam ? teamUsage(state, activeTeam.id) : 0;
  const memberUsers = activeTeam ? activeTeam.members.map((m) => state.users.find((u) => u.id === m.userId)).filter(Boolean) : [];

  const headerActions = (
    <>
      {!writable && <span className="pill pill-gray"><Eye size={12} /> View only</span>}
      {activeTeam && (
        <button className="members-btn" onClick={() => ui.openDialog('teamMembers', { teamId: activeTeam.id })} data-tip={canManageTeam ? 'Manage members' : 'View members'} aria-label={canManageTeam ? 'Manage members' : 'View members'}>
          <AvatarStack users={memberUsers} max={4} size={26} />
        </button>
      )}
      {folder && (
        <button className="btn btn-secondary" onClick={() => ui.openDialog('share', { id: folder.id })} disabled={!writable && access !== 'owner'} title={!writable && access !== 'owner' ? 'You need edit access to share this folder' : undefined}>
          <Share2 size={15} /><span className="btn-text">Share</span>
        </button>
      )}
      {!activeTeam && !folder && (
        <button className="btn btn-secondary" onClick={newFolder} aria-label="New folder"><FolderPlus size={15} /><span className="btn-text">New folder</span></button>
      )}
      {activeTeam && !folder && (
        <div className="popover-anchor" ref={teamMenu.ref}>
          <button className="icon-btn bordered" onClick={teamMenu.toggle} aria-label="Team folder options" data-tip="Team options"><Settings2 size={17} /></button>
          {teamMenu.open && <div className="popover pop-in"><MenuList items={teamActions} onClose={() => teamMenu.setOpen(false)} /></div>}
        </div>
      )}
      {folder && (
        <button className="icon-btn bordered" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); ui.showMenu({ x: r.right - 220, y: r.bottom + 4 }, actions.menuFor([folder], 'browse')); }} aria-label="Folder options" data-tip="Folder options">
          <MoreHorizontal size={17} />
        </button>
      )}
    </>
  );

  return (
    <div className="page page-browser">
      <PageHeader
        title={title}
        crumbs={crumbs}
        icon={activeTeam && !folder ? <FolderGlyph size={30} color={activeTeam.color} team /> : null}
        subtitle={activeTeam && !folder ? (
          <span className="team-sub">
            <span className="truncate">{activeTeam.description}</span>
            <span className="team-storage"><ProgressBar value={(used / activeTeam.quota) * 100} /> {formatSize(used)} of {formatSize(activeTeam.quota)}</span>
          </span>
        ) : null}
        actions={headerActions}
      />
      <FileBrowser
        items={items}
        loadingKey={`${space}:${folder?.id || 'root'}`}
        inFolder
        dropTarget={{ parentId: folder?.id || null, space, enabled: writable, label: title }}
        backgroundMenu={backgroundMenu}
        fallbackDetailsItem={folder}
        teamColor={undefined}
        emptyState={{
          icon: FolderOpen,
          title: writable ? 'This folder is empty' : 'Nothing here yet',
          text: writable ? 'Drag and drop files here, or use the buttons below to add content.' : 'Files added by the owner will appear here.',
          action: writable && (
            <div className="btn-row center">
              <button className="btn btn-primary" onClick={() => ui.openDialog('upload')}><Upload size={15} /> Upload files</button>
              <button className="btn btn-secondary" onClick={newFolder}><FolderPlus size={15} /> New folder</button>
            </div>
          ),
        }}
      />
    </div>
  );
}
