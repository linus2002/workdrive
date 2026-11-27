import { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  FolderClosed, Users, FileText, UserRoundCheck, Share2, Clock, Star, Trash2, ChevronRight, LayoutTemplate,
  ShieldCheck, Settings, LifeBuoy, PanelLeftClose, PanelLeftOpen, X, PinOff, Inbox, Activity, CheckSquare, BadgeCheck, PenTool, Tag,
} from 'lucide-react';
import { signCount } from '../../signatures/signing';
import { requestStatus } from '../../utils/sharing';
import { productivityCounts, newActivityCount } from '../../utils/productivity';
import { useDrive } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { childIds, ancestors, myUsage, accessOf, canEdit, trashedForMe, isTrashedDeep, canSee, folderRoute, parentRoute, locationOf, resolveItem, teamRoleOf, shareActive } from '../../store/selectors';
import { formatSize } from '../../utils/format';
import { FolderGlyph, FileIcon, ProgressBar } from '../common';
import { useDropTarget } from '../files/dnd';
import { useT } from '../../i18n';

/** Folders directly inside `parentId` (or at the root of `space`), A–Z. Uses the cached child index, not a full scan. */
function subfolders(items, parentId, space) {
  return childIds(items, parentId).map((id) => items[id])
    .filter((i) => i && i.type === 'folder' && !i.trashed && (parentId || i.space === space))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function TreeNode({ folder, depth, activeChain, onNavigate }) {
  const { state } = useDrive();
  const t = useT();
  const location = useLocation();
  const [open, setOpen] = useState(activeChain.has(folder.id));
  useEffect(() => { if (activeChain.has(folder.id)) setOpen(true); }, [activeChain, folder.id]);
  const kids = useMemo(() => subfolders(state.items, folder.id), [state.items, folder.id]);
  const to = folder.space.startsWith('t') ? `/team-folders/${folder.space}/${folder.id}` : `/folders/${folder.id}`;
  // Also highlight a collapsed ancestor of the current folder, so you never lose your place.
  const active = location.pathname === to || (!open && activeChain.has(folder.id));
  const drop = useDropTarget(folder.id, folder.space, canEdit(accessOf(state, folder)));
  return (
    <li>
      <div className={`tree-row ${active ? 'active' : ''} ${drop.over ? 'drop-over' : ''}`} style={{ paddingLeft: 10 + depth * 14 }} {...drop.props}>
        <button className={`tree-toggle ${open ? 'open' : ''} ${kids.length ? '' : 'invisible'}`} onClick={() => setOpen(!open)} aria-label={open ? t('Collapse {name}', { name: folder.name }) : t('Expand {name}', { name: folder.name })} aria-expanded={kids.length ? open : undefined} tabIndex={kids.length ? 0 : -1} aria-hidden={kids.length ? undefined : true}>
          <ChevronRight size={14} />
        </button>
        <NavLink to={to} className="tree-link" onClick={onNavigate} title={folder.name}>
          <FolderGlyph size={16} color={folder.color || undefined} />
          <span className="truncate">{folder.name}</span>
        </NavLink>
      </div>
      {open && kids.length > 0 && (
        <ul className="tree">
          {kids.map((k) => <TreeNode key={k.id} folder={k} depth={depth + 1} activeChain={activeChain} onNavigate={onNavigate} />)}
        </ul>
      )}
    </li>
  );
}

/** Sidebar row for one team folder, expandable into its folder tree. */
function TeamNode({ team, activeChain, onNavigate }) {
  const { state } = useDrive();
  const t = useT();
  const location = useLocation();
  const inTeam = location.pathname === `/team-folders/${team.id}` || location.pathname.startsWith(`/team-folders/${team.id}/`);
  const [open, setOpen] = useState(inTeam);
  useEffect(() => { if (inTeam) setOpen(true); }, [inTeam]);
  const kids = useMemo(() => subfolders(state.items, null, team.id), [state.items, team.id]);
  const role = teamRoleOf(state, team.id); // null once the membership has expired
  const drop = useDropTarget(null, team.id, canEdit(role || 'none'));
  // Highlight the team row when you're inside it but the folder you're in isn't visible in the tree.
  const active = location.pathname === `/team-folders/${team.id}` || (inTeam && !open);
  return (
    <li>
      <div className={`tree-row ${active ? 'active' : ''} ${drop.over ? 'drop-over' : ''}`} style={{ paddingLeft: 24 }} {...drop.props}>
        <button className={`tree-toggle ${open ? 'open' : ''} ${kids.length ? '' : 'invisible'}`} onClick={() => setOpen(!open)} aria-label={open ? t('Collapse {name}', { name: team.name }) : t('Expand {name}', { name: team.name })} aria-expanded={kids.length ? open : undefined} tabIndex={kids.length ? 0 : -1} aria-hidden={kids.length ? undefined : true}>
          <ChevronRight size={14} />
        </button>
        <NavLink to={`/team-folders/${team.id}`} end className="tree-link" onClick={onNavigate} title={team.name}>
          <FolderGlyph size={16} color={team.color} />
          <span className="truncate">{team.name}</span>
        </NavLink>
      </div>
      {open && kids.length > 0 && (
        <ul className="tree">
          {kids.map((k) => <TreeNode key={k.id} folder={k} depth={2} activeChain={activeChain} onNavigate={onNavigate} />)}
        </ul>
      )}
    </li>
  );
}

function NavItem({ to, icon: Icon, label, collapsed, badge, badgeTone = '', expandable, expanded, onToggle, end, onNavigate, dropProps, dropOver, forceActive }) {
  const t = useT();
  return (
    <div className={`nav-item-wrap ${dropOver ? 'drop-over' : ''}`} {...(dropProps || {})}>
      {/* The name comes from the label text itself (kept for screen readers even when the sidebar shows icons only),
          plus the count as hidden text; the tooltip shows the label when icons only. */}
      <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive || forceActive ? 'active' : ''}`} data-tip={label} data-tip-pos="right" onClick={onNavigate}>
        <Icon size={18} strokeWidth={1.8} className="nav-icon" aria-hidden="true" />
        <span className={collapsed ? 'sr-only' : 'nav-label'}>{label}</span>
        {badge ? <span className="sr-only"> ({badge})</span> : null}
        {!collapsed && badge ? <span className={`nav-badge ${badgeTone}`} aria-hidden="true">{badge}</span> : null}
        {collapsed && badge ? <span className={`nav-dot ${badgeTone}`} aria-hidden="true" /> : null}
      </NavLink>
      {expandable && !collapsed && (
        <button className={`nav-expand ${expanded ? 'open' : ''}`} onClick={onToggle} aria-label={expanded ? t('Collapse {name}', { name: label }) : t('Expand {name}', { name: label })} aria-expanded={expanded}>
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}

export default function Sidebar() {
  const { state, api } = useDrive();
  const { openDialog, mobileNav, setMobileNav } = useUI();
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const collapsed = state.settings.sidebarCollapsed && !mobileNav;
  const [openMy, setOpenMy] = useState(true);
  const [openTeams, setOpenTeams] = useState(true);
  const onNavigate = () => setMobileNav(false);

  // Mobile drawer: move focus into it when it opens, close on Escape, and hand focus back when it closes.
  const asideRef = useRef(null);
  const returnFocus = useRef(null);
  useEffect(() => {
    if (!mobileNav) {
      const el = returnFocus.current;
      returnFocus.current = null;
      if (el && document.contains(el)) el.focus({ preventScroll: true });
      return undefined;
    }
    returnFocus.current = document.activeElement;
    const timer = setTimeout(() => asideRef.current?.querySelector('.sidebar-close')?.focus(), 50);
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setMobileNav(false); } };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey); };
  }, [mobileNav, setMobileNav]);

  // Icon-only sidebar: show each entry's label in a floating flyout on hover/focus. It is fixed-positioned
  // (portal) so it isn't clipped by the scrolling nav and doesn't create a horizontal scrollbar.
  const [flyout, setFlyout] = useState(null);
  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return undefined;
    const show = (e) => {
      const el = e.target.closest?.('.sidebar-nav [data-tip]');
      if (!el || aside.offsetWidth > 100 || !window.matchMedia('(min-width: 721px)').matches) { setFlyout(null); return; }
      const r = el.getBoundingClientRect();
      setFlyout({ text: el.getAttribute('data-tip'), top: r.top + r.height / 2, left: r.right + 10, active: el.classList.contains('active') });
    };
    const hide = (e) => { if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget) || !e.relatedTarget.closest?.('[data-tip]')) setFlyout(null); };
    const nav = aside.querySelector('.sidebar-nav');
    const clear = () => setFlyout(null);
    aside.addEventListener('mouseover', show);
    aside.addEventListener('focusin', show);
    aside.addEventListener('mouseleave', clear);
    aside.addEventListener('focusout', hide);
    nav?.addEventListener('scroll', clear, { passive: true });
    return () => {
      aside.removeEventListener('mouseover', show);
      aside.removeEventListener('focusin', show);
      aside.removeEventListener('mouseleave', clear);
      aside.removeEventListener('focusout', hide);
      nav?.removeEventListener('scroll', clear);
    };
  }, []);
  useEffect(() => { setFlyout(null); }, [location.pathname, location.search, collapsed]);

  const activeChain = useMemo(() => {
    const m = location.pathname.match(/\/(?:folders|team-folders\/[^/]+)\/([^/]+)/);
    const id = m?.[1];
    if (!id || !state.items[id]) return new Set();
    return new Set([...ancestors(state.items, id).map((a) => a.id), id]);
  }, [location.pathname, state.items]);

  const rootFolders = useMemo(() => subfolders(state.items, null, 'my'), [state.items]);
  const myTeams = state.teams.filter((tm) => teamRoleOf(state, tm.id)); // expired memberships drop out
  const trashCount = trashedForMe(state).length;

  // Which section is the current folder in? Used to highlight a parent entry when its tree is hidden.
  const curFolderId = location.pathname.match(/^\/folders\/([^/]+)/)?.[1];
  const curSpace = curFolderId ? state.items[curFolderId]?.space : null;
  const inMySub = curSpace === 'my';
  const inSharedSub = curSpace === 'user';
  const inTeamSection = location.pathname.startsWith('/team-folders/');
  useEffect(() => { if (inMySub) setOpenMy(true); }, [inMySub, curFolderId]);
  useEffect(() => { if (inTeamSection) setOpenTeams(true); }, [inTeamSection]);
  const unseenShared = Object.values(state.items).filter((i) => i.space === 'user' && !i.parentId && i.sharedWith.some((s) => s.userId === state.meId && shareActive(s)) && !i.lastOpened).length;
  const used = myUsage(state);
  const quota = state.org.userQuota;
  const pct = (used / quota) * 100;
  const usedText = t('{used} of {quota} used', { used: formatSize(used), quota: formatSize(quota) });
  const rootDrop = useDropTarget(null, 'my', true);
  const me = state.users.find((u) => u.id === state.meId);

  const [openLabels, setOpenLabels] = useState(true);
  const work = useMemo(() => ({ ...productivityCounts(state), signatures: signCount(state) }), [state]);
  const newActivity = useMemo(() => newActivityCount(state), [state]);
  const openRequests =(state.fileRequests || []).filter((r) => r.createdBy === state.meId && requestStatus(r, Date.now(), state) === 'active').length;
  const labels = state.org.labels || [];
  const activeLabel = new URLSearchParams(location.search).get('label');
  const pinned = useMemo(() => (state.settings.pinned || [])
    .map((id) => state.items[id])
    .filter((it) => it && !isTrashedDeep(state.items, it.id) && canSee(state, it)), [state]);
  const labelCounts = useMemo(() => {
    const out = {};
    for (const it of Object.values(state.items)) {
      if (!it.labels?.length || it.trashed || !canSee(state, it)) continue;
      for (const l of it.labels) out[l] = (out[l] || 0) + 1;
    }
    return out;
  }, [state]);

  return (
    <>
      {mobileNav && <div className="sidebar-scrim" onClick={() => setMobileNav(false)} />}
      <aside ref={asideRef} className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileNav ? 'mobile-open' : ''}`} aria-label={t('Primary')}>
        <div className="sidebar-brand">
          <button className="brand" onClick={() => { navigate('/folders'); onNavigate(); }} aria-label={t('Bishnoi One WorkDrive home')}>
            <img className="brand-logo" src="/logo.png" alt="" />
            {!collapsed && <span className="brand-name"><span>Bishnoi One</span>{' '}<span>WorkDrive</span></span>}
          </button>
          <button className="icon-btn sidebar-collapse" onClick={() => api.updateSettings({ sidebarCollapsed: !state.settings.sidebarCollapsed })} data-tip={collapsed ? t('Expand sidebar') : t('Collapse sidebar')} data-tip-pos="right" aria-label={t('Toggle sidebar')}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <button className="icon-btn sidebar-close" onClick={() => setMobileNav(false)} aria-label={t('Close menu')}><X size={18} /></button>
        </div>

        <nav className="sidebar-nav">
          {pinned.length > 0 && (
            // Icon-only sidebar (collapsed, or 721-960px): pinned items as icon entries with tooltips.
            <div className="nav-mini-section" aria-label={t('Pinned')}>
              <ul className="nav-mini-list">
                {pinned.map((it) => {
                  const r = resolveItem(state, it) || it;
                  const to = r.type === 'folder' ? folderRoute(r) : r.type === 'file' ? `${parentRoute(state, r)}?highlight=${r.id}&preview=${r.id}` : `${parentRoute(state, it)}?highlight=${it.id}`;
                  return (
                    <li key={it.id}>
                      <NavLink to={to} className="nav-mini" onClick={onNavigate} aria-label={t('Pinned: {name}', { name: it.name })} data-tip={it.name} data-tip-pos="right">
                        <FileIcon item={it} size={18} />
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
              <div className="nav-sep" />
            </div>
          )}
          {!collapsed && pinned.length > 0 && (
            <div className="pinned-section">
              <div className="nav-section">{t('Pinned')}</div>
              <ul className="tree pinned-list">
                {pinned.map((it) => {
                  const r = resolveItem(state, it) || it; // pinned shortcuts open their original
                  const to = r.type === 'folder' ? folderRoute(r) : r.type === 'file' ? `${parentRoute(state, r)}?highlight=${r.id}&preview=${r.id}` : `${parentRoute(state, it)}?highlight=${it.id}`;
                  const active = r.type === 'folder' && location.pathname === folderRoute(r);
                  return (
                    <li key={it.id}>
                      <div className={`tree-row pinned-row ${active ? 'active' : ''}`} style={{ paddingLeft: 10 }}>
                        <NavLink to={to} className="tree-link" onClick={onNavigate} title={`${it.name} · ${locationOf(state, it)}`}>
                          <FileIcon item={it} size={16} />
                          <span className="truncate">{it.name}</span>
                        </NavLink>
                        <button className="icon-btn xs unpin" onClick={() => api.setPinned(it.id, false)} aria-label={t('Unpin {name}', { name: it.name })} data-tip={t('Unpin')}><PinOff size={13} /></button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="nav-sep" />
            </div>
          )}
          <NavItem to="/folders" icon={FolderClosed} label={t('My Folders')} collapsed={collapsed} expandable expanded={openMy} onToggle={() => setOpenMy(!openMy)} end onNavigate={onNavigate} dropProps={rootDrop.props} dropOver={rootDrop.over}
            forceActive={inMySub && (collapsed || !openMy)} />
          {openMy && !collapsed && rootFolders.length > 0 && (
            <ul className="tree">
              {rootFolders.map((f) => <TreeNode key={f.id} folder={f} depth={1} activeChain={activeChain} onNavigate={onNavigate} />)}
            </ul>
          )}
          <NavItem to="/team-folders" icon={Users} label={t('Team Folders')} collapsed={collapsed} expandable expanded={openTeams} onToggle={() => setOpenTeams(!openTeams)} end onNavigate={onNavigate}
            forceActive={inTeamSection && (collapsed || !openTeams)} />
          {openTeams && !collapsed && (
            <ul className="tree">
              {myTeams.map((tm) => <TeamNode key={tm.id} team={tm} activeChain={activeChain} onNavigate={onNavigate} />)}
            </ul>
          )}

          <div className="nav-sep" />
          <NavItem to="/my-files" icon={FileText} label={t('All my files')} collapsed={collapsed} onNavigate={onNavigate} />
          <NavItem to="/shared-with-me" icon={UserRoundCheck} label={t('Shared with Me')} collapsed={collapsed} badge={unseenShared || null} onNavigate={onNavigate} forceActive={inSharedSub} />
          <NavItem to="/shared-by-me" icon={Share2} label={t('Shared by Me')} collapsed={collapsed} onNavigate={onNavigate} />
          <NavItem to="/file-requests" icon={Inbox} label={t('File Requests')} collapsed={collapsed} onNavigate={onNavigate} badge={openRequests || null} />
          <NavItem to="/recent" icon={Clock} label={t('Recent Files')} collapsed={collapsed} onNavigate={onNavigate} />
          <NavItem to="/favorites" icon={Star} label={t('Favorites')} collapsed={collapsed} onNavigate={onNavigate} />
          <NavItem to="/trash" icon={Trash2} label={t('Trash')} collapsed={collapsed} badge={trashCount || null} onNavigate={onNavigate} />

          <div className="nav-sep" />
          <NavItem to="/activity" icon={Activity} label={t('Activity')} collapsed={collapsed} badge={newActivity || null} onNavigate={onNavigate} />
          <NavItem to="/tasks" icon={CheckSquare} label={t('Tasks')} collapsed={collapsed} badge={work.tasks || null} badgeTone={work.overdue ? 'alert' : ''} onNavigate={onNavigate} />
          <NavItem to="/approvals" icon={BadgeCheck} label={t('Approvals')} collapsed={collapsed} badge={work.approvals || null} badgeTone={work.approvals ? 'alert' : ''} onNavigate={onNavigate} />
          <NavItem to="/signatures" icon={PenTool} label={t('Signatures')} collapsed={collapsed} badge={work.signatures || null} badgeTone={work.signatures ? 'alert' : ''} onNavigate={onNavigate} />

          {labels.length > 0 && (
            <div className="nav-mini-section" aria-label={t('Labels')}>
              <div className="nav-sep" />
              <ul className="nav-mini-list">
                {labels.map((l) => (
                  <li key={l.id}>
                    <NavLink to={`/search?label=${l.id}`} className={() => `nav-mini ${location.pathname === '/search' && activeLabel === l.id ? 'active' : ''}`} onClick={onNavigate}
                      aria-label={`${t('Label: {name}', { name: l.name })}${labelCounts[l.id] ? ` (${labelCounts[l.id]})` : ''}`} data-tip={l.name} data-tip-pos="right">
                      <Tag size={16} style={{ color: l.color }} aria-hidden="true" />
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!collapsed && labels.length > 0 && (
            <div className="labels-section">
              <div className="nav-sep" />
              <button className="nav-section nav-section-toggle" onClick={() => setOpenLabels(!openLabels)} aria-expanded={openLabels}>
                <span>{t('Labels')}</span><ChevronRight size={13} className={`chev ${openLabels ? 'open' : ''}`} />
              </button>
              {openLabels && (
                <ul className="tree label-nav">
                  {labels.map((l) => {
                    const active = location.pathname === '/search' && activeLabel === l.id;
                    return (
                      <li key={l.id}>
                        <NavLink to={`/search?label=${l.id}`} className={() => `tree-row tree-link label-nav-row ${active ? 'active' : ''}`} style={{ paddingLeft: 14 }} onClick={onNavigate}>
                          <span className="label-dot lg" style={{ background: l.color }} />
                          <span className="truncate grow">{l.name}</span>
                          {labelCounts[l.id] ? <span className="nav-count">{labelCounts[l.id]}</span> : null}
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          <div className="nav-sep" />
          {!collapsed && <div className="nav-section">{t('Workspace')}</div>}
          <NavItem to="/templates" icon={LayoutTemplate} label={t('Templates')} collapsed={collapsed} onNavigate={onNavigate} />
          {me?.role === 'Admin' && <NavItem to="/admin" icon={ShieldCheck} label={t('Admin Console')} collapsed={collapsed} onNavigate={onNavigate} />}
          <NavItem to="/settings" icon={Settings} label={t('Settings')} collapsed={collapsed} onNavigate={onNavigate} />
          <button className="nav-item" onClick={() => { openDialog('help'); onNavigate(); }} aria-label={t('Help & support')} data-tip={t('Help & support')} data-tip-pos="right">
            <LifeBuoy size={18} strokeWidth={1.8} className="nav-icon" />{!collapsed && <span className="nav-label">{t('Help & support')}</span>}
          </button>
        </nav>

        <div className="sidebar-footer">
          {!collapsed && (
            <button className="storage-card" onClick={() => { navigate('/settings/storage'); onNavigate(); }}>
              <div className="storage-head"><span>{t('Storage')}</span><span className="muted">{Math.round(pct)}%</span></div>
              <ProgressBar label={t('Storage used')} value={pct} tone={pct > 90 ? 'danger' : pct > 75 ? 'warning' : ''} />
              <div className="storage-meta">{usedText}</div>
            </button>
          )}
          <button type="button" className="storage-mini" onClick={() => { navigate('/settings/storage'); onNavigate(); }}
            aria-label={`${t('Storage')}: ${usedText}`} data-tip={usedText} data-tip-pos="right">
            <ProgressBar label={t('Storage used')} value={pct} tone={pct > 90 ? 'danger' : pct > 75 ? 'warning' : ''} />
          </button>
        </div>
      </aside>
      {flyout && createPortal(
        <div className={`sidebar-flyout ${flyout.active ? 'active' : ''}`} style={{ top: flyout.top, left: flyout.left }} aria-hidden="true">{flyout.text}</div>,
        document.body,
      )}
    </>
  );
}
