import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Menu as MenuIcon, Plus, Upload, Bell, HelpCircle, FolderPlus, FileUp, FolderUp, FileText, Sheet, Presentation,
  LayoutTemplate, ChevronDown, User, SlidersHorizontal, HardDrive, Building2, LogOut, CheckCheck, Share2,
  MessageSquare, Users, UploadCloud, Info, Moon, Sun, CheckSquare, BadgeCheck, PenTool,
} from 'lucide-react';
import { useDrive, useMe } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { useUploads } from '../../store/UploadContext';
import { myUsage } from '../../store/selectors';
import { formatDate, formatSize } from '../../utils/format';
import { Avatar, MenuList, usePopover, ProgressBar, EmptyState } from '../common';
import SearchBar from './SearchBar';
import { useT } from '../../i18n';

export function CreateNewMenu({ label: labelProp, className = '' }) {
  const { openDialog, cwd, toast } = useUI();
  const t = useT();
  const label = t(labelProp ?? 'New'); // callers pass English; unknown strings fall back unchanged
  const uploads = useUploads();
  const pop = usePopover();
  const fileRef = useRef(null);
  const folderRef = useRef(null);
  const guard = (fn) => () => {
    if (!cwd.writable) { toast(t('You have view-only access to this folder'), { type: 'warning' }); return; }
    fn();
  };
  // Uploads never dead-end on a view-only folder: the Upload dialog lets you pick a writable destination
  // (it defaults to My Folders when the current folder isn't writable).
  const direct = cwd.inFolder && cwd.writable;
  const items = [
    { label: t('New folder'), icon: FolderPlus, onClick: guard(() => openDialog('createFolder', { parentId: cwd.parentId, space: cwd.space })) },
    { divider: true },
    // Outside a writable folder page, go through the dialog so the destination is visible and choosable.
    { label: t('Upload files'), icon: FileUp, onClick: () => (direct ? fileRef.current?.click() : openDialog('upload')) },
    { label: t('Upload folder'), icon: FolderUp, onClick: () => (direct ? folderRef.current?.click() : openDialog('upload')) },
    { divider: true },
    { label: t('New document'), icon: FileText, onClick: guard(() => openDialog('createDoc', { kind: 'docx' })) },
    { label: t('New spreadsheet'), icon: Sheet, onClick: guard(() => openDialog('createDoc', { kind: 'xlsx' })) },
    { label: t('New presentation'), icon: Presentation, onClick: guard(() => openDialog('createDoc', { kind: 'pptx' })) },
    { divider: true },
    { label: t('Create from template'), icon: LayoutTemplate, onClick: guard(() => openDialog('templatePicker')) },
  ];
  const onFiles = (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    uploads.upload(files, cwd.parentId, cwd.space);
  };
  return (
    <div className={`popover-anchor ${className}`} ref={pop.ref}>
      <button className="btn btn-primary new-btn" onClick={pop.toggle} aria-haspopup="menu" aria-expanded={pop.open} aria-label={label} data-tip={label}>
        <Plus size={17} strokeWidth={2.4} /><span className="btn-text">{label}</span><ChevronDown size={14} className="btn-caret" />
      </button>
      {pop.open && <div className="popover pop-in align-left new-menu-pop"><MenuList items={items} onClose={() => pop.setOpen(false)} /></div>}
      <input ref={fileRef} type="file" multiple hidden onChange={onFiles} />
      <input ref={folderRef} type="file" multiple hidden webkitdirectory="" directory="" onChange={onFiles} />
    </div>
  );
}

const NOTIF_ICON = { share: Share2, comment: MessageSquare, team: Users, upload: UploadCloud, system: Info, task: CheckSquare, approval: BadgeCheck, signature: PenTool };

function NotificationsPanel() {
  const { state, api } = useDrive();
  const { openDialog } = useUI();
  const t = useT();
  const navigate = useNavigate();
  const pop = usePopover();
  const unread = state.notifications.filter((n) => !n.read).length;
  // There's no way to restore cleared notifications, so ask first.
  const clearAll = () => {
    const n = state.notifications.length;
    pop.setOpen(false);
    openDialog('confirm', {
      title: t('Clear all notifications?'), message: t('{n, plural, one {All # notification will be removed. This can\'t be undone.} other {All # notifications will be removed. This can\'t be undone.}}', { n }),
      confirmLabel: t('Clear all'), cancelLabel: t('Keep'), danger: true, onConfirm: () => api.clearNotifications(),
    });
  };
  return (
    <div className="popover-anchor" ref={pop.ref}>
      <button className="icon-btn topbar-icon" onClick={pop.toggle} data-tip={t('Notifications')} aria-label={unread ? t('Notifications, {n} unread', { n: unread }) : t('Notifications')}>
        <Bell size={19} strokeWidth={1.8} />
        {unread > 0 && <span className={`dot-badge ${unread > 9 ? 'wide' : ''}`} aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {pop.open && (
        <div className="popover pop-in notif-pop">
          <div className="pop-head">
            <strong>{t('Notifications')}</strong>
            <div className="pop-head-actions">
              <button className="link-btn" onClick={() => api.markAllNotificationsRead()} disabled={!unread}><CheckCheck size={14} /> {t('Mark all read')}</button>
              {state.notifications.length > 0 && <button className="link-btn" onClick={clearAll}>{t('Clear all')}</button>}
            </div>
          </div>
          <div className="notif-list">
            {state.notifications.length === 0 && <EmptyState icon={Bell} title={t("You're all caught up")} text={t('New activity on your files will appear here.')} compact />}
            {state.notifications.map((n) => {
              const actor = state.users.find((u) => u.id === n.actorId);
              const Icon = NOTIF_ICON[n.type] || Info;
              return (
                <button key={n.id} className={`notif ${n.read ? '' : 'unread'}`} onClick={() => { api.markNotification(n.id); pop.setOpen(false); if (n.link) navigate(n.link); }}>
                  {actor ? <Avatar user={actor} size={32} /> : <span className="notif-sys"><Icon size={16} /></span>}
                  <span className="notif-body">
                    <span>{actor && <strong>{actor.name} </strong>}{n.text}</span>
                    <span className="notif-meta"><Icon size={12} /> {formatDate(n.at)}</span>
                  </span>
                  {!n.read && <span className="unread-dot" role="img" aria-label={t('Unread')} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function UserProfileMenu() {
  const { state, api } = useDrive();
  const me = useMe();
  const t = useT();
  const navigate = useNavigate();
  const pop = usePopover();
  const used = myUsage(state);
  const isDark = state.settings.theme === 'dark';
  const items = [
    { label: t('Profile'), icon: User, onClick: () => navigate('/settings/profile') },
    { label: t('Preferences'), icon: SlidersHorizontal, onClick: () => navigate('/settings/preferences') },
    { label: t('Storage'), icon: HardDrive, onClick: () => navigate('/settings/storage') },
    me?.role === 'Admin' && { label: t('Admin Console'), icon: Building2, onClick: () => navigate('/admin') },
    { label: isDark ? t('Light theme') : t('Dark theme'), icon: isDark ? Sun : Moon, onClick: () => api.updateSettings({ theme: isDark ? 'light' : 'dark' }) },
    { divider: true },
    { label: t('Sign out'), icon: LogOut, danger: true, onClick: () => { api.signOut(); navigate('/login', { replace: true }); } },
  ].filter(Boolean);
  return (
    <div className="popover-anchor" ref={pop.ref}>
      <button className="avatar-btn" onClick={pop.toggle} aria-haspopup="menu" aria-expanded={pop.open} data-tip={t('Account menu')}>
        <span aria-hidden="true"><Avatar user={me} size={32} title="" /></span>
        <span className="sr-only">{t('Account menu')}</span>
      </button>
      {pop.open && (
        <div className="popover pop-in profile-pop">
          <div className="profile-head">
            <Avatar user={me} size={44} />
            <div className="min0">
              <div className="profile-name truncate">{me.name}</div>
              <div className="profile-email truncate">{me.email}</div>
              <div className="profile-org">{state.org.name}</div>
            </div>
          </div>
          <div className="profile-storage">
            <ProgressBar value={(used / state.org.userQuota) * 100} />
            <span>{t('{used} of {quota} used', { used: formatSize(used), quota: formatSize(state.org.userQuota) })}</span>
          </div>
          <MenuList items={items} onClose={() => pop.setOpen(false)} />
        </div>
      )}
    </div>
  );
}

export default function Topbar() {
  const { setMobileNav, openDialog, mobileNav } = useUI();
  const t = useT();
  return (
    <header className="topbar">
      <button className="icon-btn hamburger" onClick={() => setMobileNav(true)} aria-label={t('Open navigation')} aria-expanded={mobileNav}><MenuIcon size={20} /></button>
      <SearchBar />
      <div className="topbar-actions">
        <CreateNewMenu />
        <button className="btn btn-secondary upload-btn" onClick={() => openDialog('upload')} data-tip={t('Upload files')}>
          <Upload size={16} /><span className="btn-text">{t('Upload')}</span>
        </button>
        <span className="topbar-divider" />
        <NotificationsPanel />
        <button className="icon-btn topbar-icon hide-sm" onClick={() => openDialog('help')} data-tip={t('Help')} aria-label={t('Help')}><HelpCircle size={19} strokeWidth={1.8} /></button>
        <UserProfileMenu />
      </div>
    </header>
  );
}
