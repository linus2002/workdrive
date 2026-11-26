import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Menu as MenuIcon, Plus, Upload, Bell, HelpCircle, FolderPlus, FileUp, FolderUp, FileText, Sheet, Presentation,
  LayoutTemplate, ChevronDown, User, SlidersHorizontal, HardDrive, Building2, LogOut, CheckCheck, Share2,
  MessageSquare, Users, UploadCloud, Info, Moon, Sun, CheckSquare, BadgeCheck, PenTool, Settings, Mail, MailOpen, X,
} from 'lucide-react';
import { useDrive, useMe } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { useUploads } from '../../store/UploadContext';
import { myUsage } from '../../store/selectors';
import { formatDate, formatDateTime, formatSize } from '../../utils/format';
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

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

function NotificationsPanel() {
  const { state, api } = useDrive();
  const { openDialog } = useUI();
  const t = useT();
  const navigate = useNavigate();
  const pop = usePopover();
  const [filter, setFilter] = useState('all');
  const unread = state.notifications.filter((n) => !n.read).length;

  // "Just now" / "5 min ago" keep counting while the panel is open.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!pop.open) return undefined;
    const id = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(id);
  }, [pop.open]);

  // Ring the bell when the unread count goes up.
  const [ring, setRing] = useState(false);
  const prevUnread = useRef(unread);
  useEffect(() => {
    if (unread > prevUnread.current) { setRing(true); const id = setTimeout(() => setRing(false), 1200); prevUnread.current = unread; return () => clearTimeout(id); }
    prevUnread.current = unread;
    return undefined;
  }, [unread]);

  const shown = filter === 'unread' ? state.notifications.filter((n) => !n.read) : state.notifications;
  // When a row disappears (removed, or marked read in the Unread view), move focus to the next row's main button
  // (or the previous one, or the panel) instead of letting it fall back to the page.
  const listRef = useRef(null);
  const keepFocus = (e, id, removing) => {
    const leaves = removing || (filter === 'unread' && !state.notifications.find((x) => x.id === id)?.read);
    if (!leaves) return;
    const rows = [...(listRef.current?.querySelectorAll('.notif') || [])];
    const i = rows.indexOf(e.currentTarget.closest('.notif'));
    const target = rows[i + 1] || rows[i - 1];
    setTimeout(() => (target?.querySelector('.notif-main') || listRef.current?.closest('.notif-pop'))?.focus(), 0);
  };
  const today = startOfToday();
  const groups = [[t('Today'), shown.filter((n) => n.at >= today)], [t('Earlier'), shown.filter((n) => n.at < today)]].filter(([, l]) => l.length);
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
      <button className={`icon-btn topbar-icon ${ring ? 'bell-ring' : ''}`} onClick={pop.toggle} aria-haspopup="dialog" aria-expanded={pop.open} data-tip={t('Notifications')} aria-label={unread ? t('Notifications, {n} unread', { n: unread }) : t('Notifications')}>
        <Bell size={19} strokeWidth={1.8} />
        {unread > 0 && <span className={`dot-badge ${unread > 9 ? 'wide' : ''}`} aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {pop.open && (
        <div className="popover pop-in notif-pop" role="dialog" aria-label={t('Notifications')} tabIndex={-1}>
          <div className="pop-head">
            <strong>{t('Notifications')}</strong>
            <div className="pop-head-actions">
              <button className="link-btn" onClick={() => api.markAllNotificationsRead()} disabled={!unread}><CheckCheck size={14} /> {t('Mark all read')}</button>
              {state.notifications.length > 0 && <button className="link-btn" onClick={clearAll}>{t('Clear all')}</button>}
              <button className="icon-btn" onClick={() => { pop.setOpen(false); navigate('/settings/notifications'); }} aria-label={t('Notification settings')} data-tip={t('Settings')}><Settings size={15} /></button>
            </div>
          </div>
          <div className="notif-tabs" role="group" aria-label={t('Show')}>
            <button aria-pressed={filter === 'all'} className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>{t('All')}</button>
            <button aria-pressed={filter === 'unread'} className={filter === 'unread' ? 'active' : ''} onClick={() => setFilter('unread')}>{t('Unread')}{unread > 0 && <span className="count">{unread}</span>}</button>
          </div>
          <div className="notif-list" ref={listRef}>
            {shown.length === 0 && (filter === 'unread' && state.notifications.length
              ? <EmptyState icon={CheckCheck} title={t('No unread notifications')} text={t('You have read everything.')} compact />
              : <EmptyState icon={Bell} title={t("You're all caught up")} text={t('New activity on your files will appear here.')} compact />)}
            {groups.map(([label, list]) => (
              <div key={label} role="group" aria-label={label}>
                <div className="notif-group">{label}</div>
                {list.map((n) => {
                  const actor = state.users.find((u) => u.id === n.actorId);
                  const Icon = NOTIF_ICON[n.type] || Info;
                  return (
                    <div key={n.id} className={`notif ${n.read ? '' : 'unread'}`}>
                      <button className="notif-main" onClick={() => { api.markNotification(n.id); pop.setOpen(false); if (n.link) navigate(n.link); }}>
                        {actor ? <Avatar user={actor} size={32} /> : <span className="notif-sys"><Icon size={16} /></span>}
                        <span className="notif-body">
                          <span>{actor && <strong>{actor.name} </strong>}{n.text}</span>
                          <span className="notif-meta"><Icon size={12} /> <time dateTime={new Date(n.at).toISOString()} title={formatDateTime(n.at)}>{formatDate(n.at)}</time></span>
                        </span>
                      </button>
                      <span className="notif-actions">
                        <button className="icon-btn" onClick={(e) => { keepFocus(e, n.id); api.markNotification(n.id, !n.read); }} aria-label={n.read ? t('Mark as unread') : t('Mark as read')} data-tip={n.read ? t('Mark as unread') : t('Mark as read')}>
                          {n.read ? <Mail size={14} /> : <MailOpen size={14} />}
                        </button>
                        <button className="icon-btn" onClick={(e) => { keepFocus(e, n.id, true); api.removeNotification(n.id); }} aria-label={t('Remove notification')} data-tip={t('Remove')}><X size={14} /></button>
                      </span>
                      {!n.read && <span className="unread-dot" role="img" aria-label={t('Unread')} />}
                    </div>
                  );
                })}
              </div>
            ))}
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
