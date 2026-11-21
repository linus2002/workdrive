import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SearchX, Search, Filter, LayoutGrid, User, CalendarDays, HardDrive, Tag, ListPlus, ScanText, ShieldAlert } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { isTrashedDeep, canSee, organizeText } from '../store/selectors';
import { contentMatches, getEntry, useSearchIndex } from '../search/searchIndex';
import { findingsFor, topSeverity, exposureOf } from '../dlp/dlp';
import { itemCategory, CATEGORY_FILTERS } from '../utils/fileTypes';
import { searchItems } from '../components/layout/SearchBar';
import FileBrowser from '../components/files/FileBrowser';
import PageHeader from '../components/layout/PageHeader';
import { FilterDropdown } from '../components/files/FileToolbar';

/** Menu icon that renders a label's colour dot. */
const dotIcon = (color) => function LabelDot({ className }) { return <span className={`label-dot lg ${className || ''}`} style={{ background: color }} />; };

const LOCATIONS = [
  { id: 'all', label: 'Everywhere' },
  { id: 'my', label: 'My Folders' },
  { id: 'team', label: 'Team Folders' },
  { id: 'shared', label: 'Shared with Me' },
];

const DAY = 24 * 3600 * 1000;
const MODIFIED = [
  { id: 'any', label: 'Any time' },
  { id: 'today', label: 'Today', test: (t) => t >= new Date().setHours(0, 0, 0, 0) },
  { id: '7d', label: 'Last 7 days', test: (t) => t >= Date.now() - 7 * DAY },
  { id: '30d', label: 'Last 30 days', test: (t) => t >= Date.now() - 30 * DAY },
  { id: '90d', label: 'Last 90 days', test: (t) => t >= Date.now() - 90 * DAY },
  { id: 'year', label: 'This year', test: (t) => t >= new Date(new Date().getFullYear(), 0, 1).getTime() },
  { id: 'older', label: 'Older than a year', test: (t) => t < Date.now() - 365 * DAY },
];

const MB = 1024 * 1024;
const SIZES = [
  { id: 'any', label: 'Any size' },
  { id: 's', label: 'Under 1 MB', test: (i) => i.type === 'file' && i.size < MB },
  { id: 'm', label: '1 – 10 MB', test: (i) => i.type === 'file' && i.size >= MB && i.size < 10 * MB },
  { id: 'l', label: '10 – 100 MB', test: (i) => i.type === 'file' && i.size >= 10 * MB && i.size < 100 * MB },
  { id: 'xl', label: 'Over 100 MB', test: (i) => i.type === 'file' && i.size >= 100 * MB },
];

// URL param → default value. Anything not at its default counts as an active filter.
const DEFAULTS = { type: 'all', in: 'all', owner: 'any', modified: 'any', size: 'any', label: 'any', tpl: 'any', match: 'any', dlp: 'any' };
const MATCH = [
  { id: 'any', label: 'Name or contents' },
  { id: 'name', label: 'Name & details only' },
  { id: 'content', label: 'Inside files' },
  { id: 'ocr', label: 'Text in images & scans' },
];

export default function SearchView() {
  const { state } = useDrive();
  const loc = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(loc.search);
  const q = params.get('q') || '';
  const f = Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => [k, params.get(k === 'in' ? 'in' : k) || d]));
  const active = Object.entries(DEFAULTS).filter(([k, d]) => f[k] !== d).map(([k]) => k);
  const labels = state.org.labels || [];
  const templates = state.org.dataTemplates || [];

  const setParam = (k, v) => {
    const p = new URLSearchParams(loc.search);
    if (v === DEFAULTS[k]) p.delete(k); else p.set(k, v);
    navigate(`/search?${p.toString()}`, { replace: true });
  };
  const clearFilters = () => navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search', { replace: true });

  const indexVersion = useSearchIndex(); // results refresh as file contents get indexed
  const results = useMemo(() => {
    // Nothing to search for yet → show the "Search your drive" empty state, not every item.
    if (!q.trim() && !active.length) return [];
    let list = q.trim()
      ? searchItems(state, q)
      : Object.values(state.items).filter((i) => !isTrashedDeep(state.items, i.id) && canSee(state, i));
    if (f.type !== 'all') list = list.filter((i) => itemCategory(i) === f.type);
    if (f.in === 'my') list = list.filter((i) => i.space === 'my');
    if (f.in === 'team') list = list.filter((i) => i.space.startsWith('t'));
    if (f.in === 'shared') list = list.filter((i) => i.space === 'user');
    if (f.owner === 'me') list = list.filter((i) => i.ownerId === state.meId);
    else if (f.owner === 'others') list = list.filter((i) => i.ownerId !== state.meId);
    else if (f.owner !== 'any') list = list.filter((i) => i.ownerId === f.owner);
    const mod = MODIFIED.find((m) => m.id === f.modified);
    if (mod?.test) list = list.filter((i) => mod.test(i.modifiedAt));
    const size = SIZES.find((s) => s.id === f.size);
    if (size?.test) list = list.filter(size.test);
    if (f.label === 'none') list = list.filter((i) => !i.labels?.length);
    else if (f.label !== 'any') list = list.filter((i) => i.labels?.includes(f.label));
    if (f.tpl === 'with') list = list.filter((i) => i.meta);
    else if (f.tpl !== 'any') list = list.filter((i) => i.meta?.templateId === f.tpl);
    if (f.dlp !== 'any') {
      list = list.filter((i) => { const sev = topSeverity(findingsFor(state, i)); return f.dlp === 'high' ? sev === 'high' : f.dlp === 'exposed' ? !!sev && (exposureOf(state, i).publicLink || exposureOf(state, i).external.length > 0) : !!sev; });
    }
    if (q.trim() && f.match !== 'any') {
      const inText = (i) => contentMatches(i.id, q);
      if (f.match === 'content') list = list.filter(inText);
      else if (f.match === 'ocr') list = list.filter((i) => inText(i) && getEntry(i.id)?.source === 'ocr');
      else {
        // Matched by what's *about* the file (name, type, owner, labels, custom fields), not by its contents.
        const qq = q.trim().toLowerCase();
        list = list.filter((i) => i.name.toLowerCase().includes(qq) || i.ext === qq.replace('.', '') || organizeText(state, i).includes(qq)
          || state.users.find((u) => u.id === i.ownerId)?.name.toLowerCase().includes(qq));
      }
    }
    return list;
  }, [state, q, loc.search, indexVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = labels.find((l) => l.id === f.label);
  const tpl = templates.find((t) => t.id === f.tpl);
  const typeLabel = CATEGORY_FILTERS.find((c) => c.id === f.type)?.label;
  const title = q ? `Results for “${q}”` : label && active.length === 1 ? `Label: ${label.name}` : tpl && active.length === 1 ? tpl.name : f.type !== 'all' && active.length === 1 ? typeLabel : active.length ? 'Filtered results' : 'Search';
  const owners = useMemo(() => state.users.filter((u) => u.id !== state.meId && Object.values(state.items).some((i) => i.ownerId === u.id && canSee(state, i))), [state]);

  return (
    <div className="page page-browser">
      <PageHeader
        title={title}
        subtitle={q.trim() || active.length ? `${results.length} result${results.length === 1 ? '' : 's'}` : undefined}
        actions={(
          <div className="seg search-scope" role="radiogroup" aria-label="Location">
            {LOCATIONS.map((l) => (
              <button key={l.id} role="radio" aria-checked={f.in === l.id} className={f.in === l.id ? 'active' : ''} onClick={() => setParam('in', l.id)}>{l.label}</button>
            ))}
          </div>
        )}
      />

      <FileBrowser
        toolbarFilters={(
          <>
            <Filter size={14} className="muted hide-xs" aria-hidden="true" />
            <FilterDropdown icon={LayoutGrid} label="Type" value={f.type} defaultId="all" onChange={(v) => setParam('type', v)}
              options={CATEGORY_FILTERS.map((c) => (c.id === 'all' ? { ...c, label: 'Any type' } : c))} />
            <FilterDropdown icon={User} label="Owner" value={f.owner} onChange={(v) => setParam('owner', v)}
              options={[{ id: 'any', label: 'Anyone' }, { id: 'me', label: 'Owned by me' }, { id: 'others', label: 'Not owned by me' },
                ...(owners.length ? [{ header: 'People' }, ...owners.map((u) => ({ id: u.id, label: u.name }))] : [])]} />
            <FilterDropdown icon={CalendarDays} label="Modified" value={f.modified} onChange={(v) => setParam('modified', v)} options={MODIFIED} />
            <FilterDropdown icon={HardDrive} label="Size" value={f.size} onChange={(v) => setParam('size', v)} options={SIZES} />
            <FilterDropdown icon={Tag} label="Label" value={f.label} onChange={(v) => setParam('label', v)}
              options={[{ id: 'any', label: 'Any label' }, { id: 'none', label: 'No label' }, ...(labels.length ? [{ header: 'Labels' }] : []),
                ...labels.map((l) => ({ id: l.id, label: l.name, icon: dotIcon(l.color) }))]} />
            {templates.length > 0 && (
              <FilterDropdown icon={ListPlus} label="Custom fields" value={f.tpl} onChange={(v) => setParam('tpl', v)}
                options={[{ id: 'any', label: 'Any' }, { id: 'with', label: 'Has custom fields' }, { header: 'Data template' }, ...templates.map((t) => ({ id: t.id, label: t.name }))]} />
            )}
            {state.org.policies.dlp?.enabled && (
              <FilterDropdown icon={ShieldAlert} label="Sensitive data" value={f.dlp} onChange={(v) => setParam('dlp', v)}
                options={[{ id: 'any', label: 'Any file' }, { id: 'with', label: 'Contains sensitive data' }, { id: 'high', label: 'High severity' }, { id: 'exposed', label: 'Sensitive and shared outside' }]} />
            )}
            {q.trim() && <FilterDropdown icon={ScanText} label="Match in" value={f.match} onChange={(v) => setParam('match', v)} options={MATCH} />}
            {active.filter((k) => k !== 'in').length > 1 && <button className="link-btn" onClick={clearFilters}>Clear all</button>}
          </>
        )}
        items={results}
        query={q}
        showSnippets
        loadingKey={`search:${q}:${loc.search}`}
        columns={['location', 'owner', 'modified', 'size']}
        foldersFirst={false}
        defaultSort={{ key: 'modified', dir: 'desc' }}
        emptyState={q || active.length
          ? { icon: SearchX, title: q ? `No results for “${q}”` : 'Nothing matches these filters', text: active.length ? 'Try removing a filter or searching a different location.' : 'Check the spelling, try a broader term, or search in a different location.' }
          : { icon: Search, title: 'Search your drive', text: 'Type in the search bar, or pick a filter above: type, owner, date, size, label or custom fields.' }}
      />
    </div>
  );
}
