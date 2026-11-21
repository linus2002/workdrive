import {
  List, LayoutGrid, ArrowUpDown, Filter, CalendarDays, User, X, Share2, Download, FolderInput, Copy, Star, Trash2,
  RotateCcw, XCircle, PanelRightOpen, PanelRightClose, Check, ArrowUp, ArrowDown, MoreHorizontal,
} from 'lucide-react';
import { CATEGORY_FILTERS } from '../../utils/fileTypes';
import { usePopover, MenuList } from '../common';
import { t as tNow, useT } from '../../i18n';

// Labels are getters so they read in the active language wherever these lists are used.
const option = (id, label) => ({ id, get label() { return tNow(label); } });
export const MODIFIED_FILTERS = [
  option('any', 'Any time'),
  option('today', 'Today'),
  option('7d', 'Last 7 days'),
  option('30d', 'Last 30 days'),
  option('year', 'This year'),
];
export const OWNER_FILTERS = [
  option('any', 'Anyone'),
  option('me', 'Owned by me'),
  option('others', 'Not owned by me'),
];

/** Pill-style filter button with a dropdown menu. Options: { id, label, icon? } or { header } for a section title. */
export function FilterDropdown({ icon: Icon, label, value, options, onChange, defaultId = 'any' }) {
  const pop = usePopover();
  const t = useT();
  const tr = (s) => (typeof s === 'string' ? t(s) : s); // option lists come from several places; unknown strings stay as-is
  const current = options.find((o) => o.id === value);
  const active = value !== defaultId;
  return (
    <div className="popover-anchor filter-pill" ref={pop.ref}>
      <button type="button" className={`filter-btn ${active ? 'active' : ''}`} onClick={pop.toggle} aria-haspopup="menu" aria-expanded={pop.open}
        aria-label={active ? `${tr(label)}: ${tr(current?.label)}` : undefined}>
        <Icon size={14} />
        <span>{active ? tr(current?.label) : tr(label)}</span>
      </button>
      {/* A sibling of the filter button (not nested inside it) so both are real, separately focusable buttons. */}
      {active && <button type="button" className="filter-clear" aria-label={t('Clear {name} filter', { name: tr(label) })} onClick={() => onChange(defaultId)}><X size={12} /></button>}
      {pop.open && (
        <div className="popover pop-in align-left">
          <MenuList items={options.map((o) => (o.header ? { header: tr(o.header) } : { label: tr(o.label), icon: o.icon, check: o.id === value, onClick: () => onChange(o.id) }))} onClose={() => pop.setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function SortDropdown({ sort, setSort, options }) {
  const pop = usePopover();
  const t = useT();
  const label = t(options.find((o) => o.key === sort.key)?.label || 'Name');
  return (
    <div className="popover-anchor" ref={pop.ref}>
      <button className="filter-btn ghost" onClick={pop.toggle} aria-haspopup="menu" aria-label={t('Sort by {name}', { name: label })}>
        <ArrowUpDown size={14} /><span className="hide-xs">{label}</span>
        {sort.dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
      </button>
      {pop.open && (
        <div className="popover pop-in">
          <MenuList
            onClose={() => pop.setOpen(false)}
            items={[
              { header: t('Sort by') },
              ...options.map((o) => ({ label: t(o.label), check: o.key === sort.key, onClick: () => setSort({ key: o.key, dir: sort.dir }) })),
              { divider: true },
              { label: t('Ascending'), icon: ArrowUp, check: sort.dir === 'asc', onClick: () => setSort({ ...sort, dir: 'asc' }) },
              { label: t('Descending'), icon: ArrowDown, check: sort.dir === 'desc', onClick: () => setSort({ ...sort, dir: 'desc' }) },
            ]}
          />
        </div>
      )}
    </div>
  );
}

export default function FileToolbar({
  selectedItems, clearSelection, context, actions, filters, setFilters, sort, setSort, sortOptions,
  view, setView, detailsOpen, toggleDetails, totalCount, onSelectAll, showFilters = true, customFilters,
}) {
  const n = selectedItems.length;
  const moreMenu = usePopover();
  const t = useT();

  if (n > 0) {
    const allFav = selectedItems.every((i) => i.favorite);
    const isTrash = context === 'trash';
    const bulk = isTrash
      ? [
        { label: t('Restore'), icon: RotateCcw, onClick: () => actions.restore(selectedItems) },
        { label: t('Delete permanently'), icon: XCircle, danger: true, onClick: () => actions.deleteForever(selectedItems) },
      ]
      : [
        n === 1 && { label: t('Share'), icon: Share2, onClick: () => actions.share(selectedItems[0]) },
        { label: t('Download'), icon: Download, onClick: () => actions.download(selectedItems) },
        { label: t('Move'), icon: FolderInput, onClick: () => actions.move(selectedItems) },
        { label: t('Copy'), icon: Copy, onClick: () => actions.copy(selectedItems) },
        { label: allFav ? t('Unfavorite') : t('Favorite'), icon: Star, onClick: () => actions.setFavorite(selectedItems, !allFav) },
        { label: t('Move to Trash'), icon: Trash2, danger: true, onClick: () => actions.trash(selectedItems) },
      ].filter(Boolean);
    return (
      <div className="file-toolbar selection-mode" role="toolbar" aria-label={t('Selection actions')}>
        <button className="icon-btn" onClick={clearSelection} aria-label={t('Clear selection')} data-tip={t('Clear selection')}><X size={17} /></button>
        <span className="sel-count">{t('{n} selected', { n })}</span>
        {n < totalCount && <button className="link-btn" onClick={onSelectAll}>{t('Select all {n}', { n: totalCount })}</button>}
        <div className="sel-actions">
          {bulk.map((b) => (
            <button key={b.label} type="button" className={`tool-btn ${b.danger ? 'danger' : ''}`} onClick={b.onClick} data-tip={b.label} aria-label={b.label}>
              <b.icon size={16} aria-hidden="true" /><span className="tool-label" aria-hidden="true">{b.label}</span>
            </button>
          ))}
          <div className="popover-anchor" ref={moreMenu.ref}>
            <button type="button" className="tool-btn" onClick={moreMenu.toggle} aria-label={t('More actions')} aria-haspopup="menu" aria-expanded={moreMenu.open} data-tip={t('More actions')}><MoreHorizontal size={16} /></button>
            {moreMenu.open && <div className="popover pop-in"><MenuList items={actions.menu(selectedItems)} onClose={() => moreMenu.setOpen(false)} /></div>}
          </div>
        </div>
        <div className="toolbar-right">
          <button className={`icon-btn ${detailsOpen ? 'active' : ''}`} onClick={toggleDetails} data-tip={detailsOpen ? t('Hide details') : t('Show details')} aria-label={t('Toggle details panel')}>
            {detailsOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="file-toolbar" role="toolbar" aria-label={t('File view options')}>
      {customFilters ? <div className="filters">{customFilters}</div> : showFilters && (
        <div className="filters">
          <Filter size={14} className="muted hide-xs" />
          <FilterDropdown icon={LayoutGrid} label={t('Type')} value={filters.type} options={CATEGORY_FILTERS} onChange={(v) => setFilters({ ...filters, type: v })} defaultId="all" />
          <FilterDropdown icon={CalendarDays} label={t('Modified')} value={filters.modified} options={MODIFIED_FILTERS} onChange={(v) => setFilters({ ...filters, modified: v })} />
          {context !== 'trash' && <FilterDropdown icon={User} label={t('Owner')} value={filters.owner} options={OWNER_FILTERS} onChange={(v) => setFilters({ ...filters, owner: v })} />}
          {(filters.type !== 'all' || filters.modified !== 'any' || filters.owner !== 'any') && (
            <button className="link-btn" onClick={() => setFilters({ type: 'all', modified: 'any', owner: 'any' })}>{t('Reset')}</button>
          )}
        </div>
      )}
      <div className="toolbar-right">
        <span className="item-total hide-sm">{t('{n, plural, one {# item} other {# items}}', { n: totalCount })}</span>
        <SortDropdown sort={sort} setSort={setSort} options={sortOptions} />
        <div className="view-switch" role="radiogroup" aria-label={t('View')}>
          <button role="radio" aria-checked={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} data-tip={t('List view')} aria-label={t('List view')}><List size={16} /></button>
          <button role="radio" aria-checked={view === 'grid'} className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} data-tip={t('Grid view')} aria-label={t('Grid view')}><LayoutGrid size={16} /></button>
        </div>
        <button className={`icon-btn ${detailsOpen ? 'active' : ''}`} onClick={toggleDetails} data-tip={detailsOpen ? t('Hide details') : t('Show details')} aria-label={t('Toggle details panel')}>
          {detailsOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
        </button>
      </div>
    </div>
  );
}

export { Check };
