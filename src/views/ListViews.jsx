import { useMemo, useState } from 'react';
import { FileText, UserRoundCheck, Share2, Clock, Star, Trash2, Info } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { useUI } from '../store/UIContext';
import { isTrashedDeep, ancestors, trashedForMe, canSee, blocksPermanentDelete, shareActive } from '../store/selectors';
import FileBrowser from '../components/files/FileBrowser';
import PageHeader from '../components/layout/PageHeader';
import { useLocation } from 'react-router-dom';
import { useT } from '../i18n';

const alive = (state) => Object.values(state.items).filter((i) => !isTrashedDeep(state.items, i.id));

export function MyFilesView() {
  const { state } = useDrive();
  const t = useT();
  const items = useMemo(() => alive(state).filter((i) => i.type === 'file' && i.ownerId === state.meId && i.space === 'my'), [state]);
  return (
    <div className="page page-browser">
      <PageHeader title={t('My Files')} subtitle={t('Every file you own, across all of your folders.')} />
      <FileBrowser items={items} loadingKey="my-files" columns={['location', 'modified', 'size', 'shared']} foldersFirst={false}
        defaultSort={{ key: 'modified', dir: 'desc' }}
        emptyState={{ icon: FileText, title: t('No files yet'), text: t('Files you upload or create will appear here.') }} />
    </div>
  );
}

export function SharedWithMeView() {
  const { state } = useDrive();
  const t = useT();
  const items = useMemo(() => alive(state).filter((i) => {
    if (i.ownerId === state.meId) return false;
    if (!i.sharedWith.some((s) => s.userId === state.meId && shareActive(s))) return false;
    // hide items whose ancestor is already shared with me (they appear inside the folder)
    return !ancestors(state.items, i.id).some((a) => a.sharedWith.some((s) => s.userId === state.meId && shareActive(s)));
  }), [state]);
  return (
    <div className="page page-browser">
      <PageHeader title={t('Shared with Me')} subtitle={t('Files and folders other people have shared with you.')} />
      <FileBrowser items={items} loadingKey="swm" columns={['sharedBy', 'sharedOn', 'permission', 'size']} defaultSort={{ key: 'sharedOn', dir: 'desc' }} foldersFirst={false}
        emptyState={{ icon: UserRoundCheck, title: t('Nothing shared with you yet'), text: t('When teammates share files or folders with you, they will show up here.') }} />
    </div>
  );
}

export function SharedByMeView() {
  const { state } = useDrive();
  const t = useT();
  const items = useMemo(() => alive(state).filter((i) => i.ownerId === state.meId && i.space === 'my' && (i.sharedWith.length > 0 || i.link?.enabled)), [state]);
  return (
    <div className="page page-browser">
      <PageHeader title={t('Shared by Me')} subtitle={t('Manage who can access the files and folders you have shared.')} />
      <FileBrowser items={items} loadingKey="sbm" columns={['sharedWith', 'modified', 'size']} foldersFirst={false} defaultSort={{ key: 'modified', dir: 'desc' }}
        emptyState={{ icon: Share2, title: t("You haven't shared anything yet"), text: t('Use Share on any file or folder to give teammates access.') }} />
    </div>
  );
}

export function RecentView() {
  const { state } = useDrive();
  const t = useT();
  const [tab, setTab] = useState('opened');
  const items = useMemo(() => {
    const all = alive(state).filter((i) => i.type === 'file' && canSee(state, i));
    if (tab === 'opened') return all.filter((i) => i.lastOpened).sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 100);
    return all.filter((i) => Date.now() - i.modifiedAt < 30 * 86400000).sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 100);
  }, [state, tab]);
  return (
    <div className="page page-browser">
      <PageHeader title={t('Recent Files')}>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'opened'} className={tab === 'opened' ? 'active' : ''} onClick={() => setTab('opened')}>{t('Recently opened')}</button>
          <button role="tab" aria-selected={tab === 'modified'} className={tab === 'modified' ? 'active' : ''} onClick={() => setTab('modified')}>{t('Recently modified')}</button>
        </div>
      </PageHeader>
      <FileBrowser key={tab} items={items} loadingKey={`recent-${tab}`} foldersFirst={false}
        columns={tab === 'opened' ? ['lastOpened', 'location', 'owner'] : ['modified', 'location', 'owner']}
        defaultSort={tab === 'opened' ? { key: 'lastOpened', dir: 'desc' } : { key: 'modified', dir: 'desc' }}
        emptyState={{ icon: Clock, title: tab === 'opened' ? t('No recently opened files') : t('No recent changes'), text: t('Files you open or edit will appear here for quick access.') }} />
    </div>
  );
}

export function FavoritesView() {
  const { state } = useDrive();
  const t = useT();
  const items = useMemo(() => alive(state).filter((i) => i.favorite), [state]);
  return (
    <div className="page page-browser">
      <PageHeader title={t('Favorites')} subtitle={t('Quick access to the files and folders you starred.')} />
      <FileBrowser items={items} loadingKey="favs" columns={['location', 'modified', 'size']}
        emptyState={{ icon: Star, title: t('No favorites yet'), text: t('Open the ⋮ menu on any file or folder (or right-click it) and choose “Add to Favorites” to add it to Favorites.') }} />
    </div>
  );
}

export function TrashView() {
  const { state, api } = useDrive();
  const ui = useUI();
  const t = useT();
  const items = useMemo(() => trashedForMe(state), [state]);
  const emptyTrash = () => ui.openDialog('confirm', {
    title: t('Empty Trash?'),
    message: t('{n, plural, one {All # item in Trash will be permanently deleted. This action cannot be undone.} other {All # items in Trash will be permanently deleted. This action cannot be undone.}}', { n: items.length }),
    confirmLabel: t('Empty Trash'), cancelLabel: t('Cancel'), danger: true,
    onConfirm: () => {
      const { deleted, held } = api.emptyTrash();
      ui.toast(t('{n, plural, one {# item permanently deleted} other {# items permanently deleted}}', { n: deleted }), { type: 'success' });
      if (held) ui.toast(t('{n, plural, one {# item stays in Trash because of a legal hold} other {# items stay in Trash because of a legal hold}}', { n: held }), { type: 'warning', duration: 6000 });
    },
  });
  const days = state.org.policies.trashRetentionDays;
  const heldCount = items.filter((i) => blocksPermanentDelete(state, i.id)).length;
  const restoreAll = () => {
    const n = items.length;
    ui.openDialog('confirm', {
      title: t('{n, plural, one {Restore all # item?} other {Restore all # items?}}', { n }),
      message: t('{n, plural, one {All # item in Trash will go back to their original folders. Items whose folder no longer exists go to the top level.} other {All # items in Trash will go back to their original folders. Items whose folder no longer exists go to the top level.}}', { n }),
      confirmLabel: t('Restore all'), cancelLabel: t('Cancel'),
      onConfirm: () => {
        const relocated = api.restoreItems(items.map((i) => i.id)) || 0;
        ui.toast(t('{n, plural, one {# item restored} other {# items restored}}', { n }), { type: 'success' });
        if (relocated) ui.toast(t('{n, plural, one {# item went back to the top level because the original folder no longer exists} other {# items went back to the top level because the original folder no longer exists}}', { n: relocated }), { type: 'info' });
      },
    });
  };
  return (
    <div className="page page-browser">
      <PageHeader title={t('Trash')} actions={items.length > 0 && (
        <>
          <button className="btn btn-secondary" onClick={restoreAll}>{t('Restore all')}</button>
          <button className="btn btn-danger-outline" onClick={emptyTrash}><Trash2 size={15} /> {t('Empty Trash')}</button>
        </>
      )}>
        <div className="banner info"><Info size={16} /> {days ? t('Items in Trash are permanently deleted after {days} days.', { days }) : t('Your organization keeps Trash items until you delete them.')} {t('Restoring returns them to their original folder.')}{heldCount ? ` ${t('{n, plural, one {# item is on legal hold and won\'t be deleted.} other {# items are on legal hold and won\'t be deleted.}}', { n: heldCount })}` : ''}</div>
      </PageHeader>
      <FileBrowser items={items} context="trash" loadingKey="trash" columns={['deletedOn', 'purgeIn', 'originalLocation', 'folderSize']} foldersFirst={false}
        defaultSort={{ key: 'deletedOn', dir: 'desc' }}
        emptyState={{ icon: Trash2, title: t('Trash is empty'), text: t('Deleted files and folders are kept here until you remove them permanently.') }} />
    </div>
  );
}

export function useQueryParams() {
  return new URLSearchParams(useLocation().search);
}
