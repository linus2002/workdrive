import { useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, X, Clock, ArrowRight, FileText, Image, Sheet, Presentation, Folder, Video } from 'lucide-react';
import { useDrive } from '../../store/DriveStore';
import { useUI } from '../../store/UIContext';
import { useItemActions } from '../../store/useItemActions';
import { isTrashedDeep, locationOf, canSee, organizeText } from '../../store/selectors';
import { contentMatches, useSearchIndex } from '../../search/searchIndex';
import Snippet from '../../search/Snippet';
import { itemCategory } from '../../utils/fileTypes';
import { FileIcon, Highlight, usePopover } from '../common';
import { useT } from '../../i18n';

const QUICK = [
  { type: 'folder', label: 'Folders', icon: Folder },
  { type: 'document', label: 'Documents', icon: FileText },
  { type: 'spreadsheet', label: 'Spreadsheets', icon: Sheet },
  { type: 'presentation', label: 'Presentations', icon: Presentation },
  { type: 'image', label: 'Images', icon: Image },
  { type: 'video', label: 'Videos', icon: Video },
];

/**
 * Items matching `q`, best first. Matching is cheap and runs on everything; the costlier checks (in the trash?
 * can you see it?) run only on matches, in ranked order, and stop once `limit` results are found.
 */
export function searchItems(state, q, limit = Infinity) {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const users = Object.fromEntries(state.users.map((u) => [u.id, u]));
  const ext = query.replace('.', '');
  const scored = [];
  for (const i of Object.values(state.items)) {
    if (i.trashed) continue;
    const name = i.name.toLowerCase();
    let score = 0;
    if (name === query) score = 100;
    else if (name.startsWith(query)) score = 60;
    else if (name.includes(query)) score = 40;
    else if (i.ext === ext) score = 25;
    else if (itemCategory(i).startsWith(query)) score = 20;
    else if (users[i.ownerId]?.name.toLowerCase().includes(query)) score = 15;
    else if (organizeText(state, i).includes(query)) score = 12; // labels + custom field values
    else if (contentMatches(i.id, query) || (i.content || '').toLowerCase().includes(query)) score = 10; // text inside the file (incl. OCR)
    if (score) scored.push({ i, score: score + (i.lastOpened ? 5 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || b.i.modifiedAt - a.i.modifiedAt);
  const out = [];
  for (const { i } of scored) {
    if (isTrashedDeep(state.items, i.id) || !canSee(state, i)) continue;
    out.push(i);
    if (out.length >= limit) break;
  }
  return out;
}

export default function SearchBar() {
  const { state, api } = useDrive();
  const ui = useUI();
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const actions = useItemActions();
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const pop = usePopover();
  const inputRef = useRef(null);
  const params = new URLSearchParams(location.search);
  const [q, setQ] = useState(location.pathname === '/search' ? params.get('q') || '' : '');
  const [hi, setHi] = useState(-1);

  // Keep the box in sync with the URL (Back/Forward between searches), clear it elsewhere.
  useEffect(() => {
    setQ(location.pathname === '/search' ? new URLSearchParams(location.search).get('q') || '' : '');
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      // Not while a preview or dialog is covering the page (the search box isn't usable then).
      if (uiRef.current.preview || uiRef.current.dialog) return;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && !document.activeElement?.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const indexVersion = useSearchIndex(); // re-run when newly indexed text arrives
  // Search once typing pauses (not on every keystroke), and only while the suggestions are showing.
  const [dq, setDq] = useState(q);
  useEffect(() => { const id = setTimeout(() => setDq(q), q ? 120 : 0); return () => clearTimeout(id); }, [q]);
  const results = useMemo(() => (pop.open && dq.trim() ? searchItems(state, dq, 7) : []), [pop.open && state, dq, indexVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (value = q, type) => {
    const v = value.trim();
    if (!v && !type) return;
    if (v) api.addRecentSearch(v);
    pop.setOpen(false);
    inputRef.current?.blur();
    const sp = new URLSearchParams();
    if (v) sp.set('q', v);
    if (type) sp.set('type', type);
    navigate(`/search?${sp.toString()}`);
  };

  const pick = (item) => {
    api.addRecentSearch(q);
    pop.setOpen(false);
    inputRef.current?.blur();
    actions.open(item, [item]);
  };

  // Arrow keys walk the results, or the recent searches while the box is empty.
  const recents = state.recentSearches;
  const optCount = q.trim() ? results.length : recents.length;
  const activeId = pop.open && hi >= 0 && hi < optCount ? `search-opt-${hi}` : undefined;
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); pop.setOpen(true); setHi((h) => Math.min(optCount - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(-1, h - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (!q.trim() && hi >= 0 && recents[hi]) { setQ(recents[hi]); submit(recents[hi]); }
      else if (hi >= 0 && results[hi]) pick(results[hi]);
      else submit();
    }
    else if (e.key === 'Escape') { pop.setOpen(false); setHi(-1); inputRef.current?.blur(); }
    else if (e.key === 'Tab') { pop.setOpen(false); setHi(-1); }
  };
  // Close when focus leaves the search box and its dropdown.
  const onBlur = (e) => { if (!pop.ref.current?.contains(e.relatedTarget)) { pop.setOpen(false); setHi(-1); } };

  return (
    <div className={`searchbar ${pop.open ? 'focused' : ''}`} ref={pop.ref} onBlur={onBlur}>
      <Search size={17} className="search-icon" />
      <input
        ref={inputRef}
        type="search"
        placeholder={t('Search files, folders, owners…')}
        value={q}
        onChange={(e) => { setQ(e.target.value); setHi(-1); pop.setOpen(true); }}
        onFocus={() => pop.setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label={t('Search')}
        aria-expanded={pop.open}
        aria-controls="search-suggestions"
        role="combobox"
        aria-autocomplete="list"
        aria-activedescendant={activeId}
      />
      {q ? <button className="icon-btn search-clear" onClick={() => { setQ(''); inputRef.current?.focus(); }} aria-label={t('Clear search')}><X size={16} /></button>
        : <kbd className="search-kbd">/</kbd>}
      {pop.open && (
        // mousedown is cancelled so clicking a row doesn't blur the input (which would close the dropdown first)
        <div className="search-pop pop-in" id="search-suggestions" role="listbox" aria-label={t('Search suggestions')} onMouseDown={(e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); }}>
          {!q.trim() ? (
            <>
              <div className="search-section">
                <div className="search-section-title">{t('Search by type')}</div>
                <div className="chip-row">
                  {QUICK.map((c) => (
                    <button key={c.type} className="chip" onClick={() => submit('', c.type)}><c.icon size={14} />{t(c.label)}</button>
                  ))}
                </div>
              </div>
              {(state.org.labels || []).length > 0 && (
                <div className="search-section">
                  <div className="search-section-title">{t('Search by label')}</div>
                  <div className="chip-row">
                    {state.org.labels.map((l) => (
                      <button key={l.id} className="chip" onClick={() => { pop.setOpen(false); inputRef.current?.blur(); navigate(`/search?label=${l.id}`); }}>
                        <span className="label-dot" style={{ background: l.color }} />{l.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="search-section">
                <div className="search-section-title">
                  {t('Recent searches')}
                  {state.recentSearches.length > 0 && <button className="link-btn" onClick={() => api.clearRecentSearches()}>{t('Clear')}</button>}
                </div>
                {state.recentSearches.length === 0 && <div className="search-empty">{t('No recent searches')}</div>}
                {state.recentSearches.map((r, idx) => (
                  <div key={r} id={`search-opt-${idx}`} className={`search-row recent ${idx === hi ? 'hi' : ''}`} role="option" aria-selected={idx === hi} tabIndex={-1}
                    onMouseEnter={() => setHi(idx)} onClick={() => { setQ(r); submit(r); }}>
                    <Clock size={15} className="muted" />
                    <span className="grow">{r}</span>
                    <button className="icon-btn xs" onClick={(e) => { e.stopPropagation(); api.removeRecentSearch(r); }} aria-label={t('Remove {name}', { name: r })}><X size={13} /></button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="search-section">
              {results.length === 0 && <div className="search-empty">{t('No matches for “{q}”. Press Enter to search everywhere.', { q })}</div>}
              {results.map((r, idx) => (
                <div key={r.id} id={`search-opt-${idx}`} className={`search-row ${idx === hi ? 'hi' : ''}`} role="option" aria-selected={idx === hi} onMouseEnter={() => setHi(idx)} onClick={() => pick(r)}>
                  <FileIcon item={r} size={24} thumbs />
                  <div className="grow min0">
                    <div className="truncate"><Highlight text={r.name} query={q} /></div>
                    <div className="search-sub truncate">{locationOf(state, r)}</div>
                    <Snippet id={r.id} q={q} name={r.name} />
                  </div>
                </div>
              ))}
              <button className="search-all" onClick={() => submit()}>
                <Search size={15} /> {t('See all results for “{q}”', { q })} <ArrowRight size={14} className="ml-auto" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
